// dbConn.js — 오소리 DB 통신 모듈 (v0.0.408)
// v0.0.408 — upsertUserChartScores 가 row 의 play_style(0=SP/1=DP, 기본 1) 통과 + dedup PK 에 play_style 포함.
//            (scores 04 마이그레이션 대응. SP 행 적재는 calcOhsorryCore 의 SP 크롤 패스에서 play_style:0 으로 전달.)
//
// 새 디비 (users + user_radars + scores) 로 마이그레이션.
//   - upsertUserProfile: upsert_user + upsert_user_radar (sp/dp)
//   - upsertUserChartScores: songs 매핑 캐시 + upsert_scores (text→int + title→song_id 변환)
//   - uploadResult: 결과 패널 렌더 직후 호출되는 trigger — DB 모드 skip / payload 검증 / 결과 로깅
//   - fetchUserProfile 은 다음 단계 (TODO)
//
// 본체 / 라이벌 wrapper 가 fetch + eval 해서 사용 (window.OhsorryDb 로 노출).
//
// v0.0.403 — uploadResult trigger 흡수:
//   - 기존 ohsorryRender 안에 박혀있던 'OhsorryDb.upsertUserProfile + upsertUserChartScores
//     호출 + DB 모드 skip + 결과 로깅' 흐름을 이 모듈로 이관. render 는 이제 한 줄로 호출.
//   - 별도 dbUpload 모듈로 뺄까 검토했지만 둘 다 supabase 라 한 모듈에 두는 게 자연스러움.
//
// v0.0.407 — 패턴 점수 알고리즘 재설계 (quantile score 평균):
//   - 기존 (v0.0.406, 미사용/제거): patterns raw pt × rate% 의 절대 실력값.
//   - 신규: feature-scores-slim.json (gist, precomputed quantile score 차트별 0~100) fetch.
//     make_grid_data RPC → plays 차트마다 score lookup → feature 별 평균
//       (score=0 인 곡은 분모 제외 — CHARGE/SOF-LAN 의 baseline 0 곡 + 다른 feature 의 raw=0 곡).
//   - user_radars 의 os_* 컬럼이 plays 차트의 quantile score 평균 (0~100).

// v0.0.405 — songs 마스터 자동 등록 (ensure_song RPC):
//   - 신곡 (songs 마스터 미등록) 이 eagate 에서 들어오면 ensure_song RPC 로 자동 INSERT.
//   - ac 비트 (1=AC, 2=INF) 자동 결정: playedVersion 0=INF→2, 그 외=AC→1.
//   - LEGGENDARIA 차트는 legen 비트만, 그 외는 ac 비트만 set.
//   - RPC 실패 (SQL 미적용 / 권한 X) 시 graceful — 기존처럼 unmatched skip.
//   - songs cache 도 즉시 갱신 → 같은 곡의 다른 차트 row 가 재매칭됨.
//   - 사전 조건: ohSorryAdmin/sql/setup_song_master.sql 의 ensure_song RPC 적용 (anon GRANT 포함).
//
// v0.0.402 — LAMP_MAP 에 풀네임 alias 추가:
//   - calcOhsorryCore.js 의 LAMP_NAMES (NO PLAY / FAILED / EASY / CLEAR / HARD / EX HARD / FULL COMBO) 매칭
//   - 이전엔 abbreviation (NP/F/EC/...) 만 매핑 → 풀네임 lamp 가 null 처리 → scores.lamp 다 NULL 이슈
//
// v0.0.401 — 동명이곡 매칭 재설계:
//   - songs 캐시 구조: Map<normKey, [{ song_id, title, ac }]> (array)
//   - 라이브 OVERRIDES (normTitle 안의 NORM_OVERRIDES) 가 raw 다른 케이스 (ZEИITH vs Zenith 등) 4건 분리
//   - raw 같은 동명이곡 (ADVANCE 295=INF vs 338=AC 등 10건) 은 ac 비트맵 + played_version 매칭
//   - 같은 PK (song_id, iidx_id, diff, played_version) 중복 row 안전망 dedup (best ex_score)
//   - TITLE_ALIASES 는 normTitle.js 로 이동
//
// 인터페이스 (시그니처 유지 — 호출 측 호환):
//   window.OhsorryDb = {
//     VERSION: '0.0.401',
//     upsertUserProfile(payload):   users + user_radars upsert (새 RPC 2종)
//     upsertUserChartScores(rows):  scores 매핑 + upsert
//     fetchUserProfile(iidxId):     (구) get_user_profile_full RPC — 향후 새 디비로 교체
//   }
// ============================================================

window.OhsorryDb = (function () {
  const SUPABASE_URL = 'https://cvxpeecxiawddmrzbdvn.supabase.co';
  // Legacy JWT anon key (publishable key 는 RLS 호환성 문제로 사용 X) — 본체와 동일
  const SUPABASE_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2eHBlZWN4aWF3ZGRtcnpiZHZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5ODMxMzQsImV4cCI6MjA5NDU1OTEzNH0.lWnnSsSIFFLs7NsJq5yI6fe9HPiT9yQ3Pj-8sgfGuxI';
  const HEADERS = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: 'Bearer ' + SUPABASE_KEY,
  };

  // 원격 service status — gist 의 service-status.json 으로 uploadEnabled toggle.
  // fail-closed: fetch 실패 시 disabled 로 취급 (모든 upload 차단).
  // 캐시: 5분 메모리.
  const SERVICE_STATUS_URL =
    'https://gist.githubusercontent.com/OhSorry-DP/30c3ba6f87df9847291c42ea216a8d2a/raw/service-status.json';
  const SERVICE_STATUS_CACHE_MS = 5 * 60 * 1000;
  let statusCache = null;
  let statusCachedAt = 0;
  async function fetchServiceStatus() {
    const now = Date.now();
    if (statusCache && now - statusCachedAt < SERVICE_STATUS_CACHE_MS) {
      return statusCache;
    }
    try {
      const res = await fetch(SERVICE_STATUS_URL + '?t=' + now, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      statusCache = data;
      statusCachedAt = now;
      return data;
    } catch (e) {
      console.warn('[OhsorryDb] service status fetch 실패, fail-closed:', e.message);
      return {
        uploadEnabled: false,
        shelfEnabled: false,
        message: '서비스 상태 확인 실패 — 잠시 후 다시 시도해주세요.',
      };
    }
  }
  // upload 차단 체크 — return null 이면 통과, error object 면 차단.
  async function checkUploadEnabled() {
    const status = await fetchServiceStatus();
    if (!status.uploadEnabled) {
      return { ok: false, error: status.message || 'upload disabled by remote service status' };
    }
    return null;
  }

  // ─── 새 디비 매핑 helper ─────────────────────────────────────
  // eagate 단위 (한자) → int (-8~12). '---' 또는 미지정 → null.
  const RANK_MAP = {
    '皆伝': 12, '中伝': 11,
    '十段': 10, '九段': 9, '八段': 8, '七段': 7, '六段': 6, '五段': 5,
    '四段': 4, '三段': 3, '二段': 2, '初段': 1,
    '一級': 0, '二級': -1, '三級': -2, '四級': -3,
    '五級': -4, '六級': -5, '七級': -6, '八級': -7, '九級': -8,
  };
  function rankToInt(s) {
    if (!s || s === '---') return null;
    return Object.prototype.hasOwnProperty.call(RANK_MAP, s) ? RANK_MAP[s] : null;
  }
  // notes_radar 의 eagate 키 → user_radars 컬럼 매핑
  const RADAR_KEY_MAP = {
    NOTES: 'notes', PEAK: 'peak', CHARGE: 'charge',
    CHORD: 'chord', SCRATCH: 'scratch', 'SOF-LAN': 'soft',
  };
  // 차트 difficulty → int
  const DIFF_MAP = { BEGINNER: 0, NORMAL: 1, HYPER: 2, ANOTHER: 3, LEGGENDARIA: 4 };
  // 클리어 lamp → int. abbreviation + 풀네임 (calcOhsorryCore 의 LAMP_NAMES) 둘 다 받음.
  const LAMP_MAP = {
    NP: 0, F: 1, AC: 2, EC: 3, NC: 4, HC: 5, EX: 6, FC: 7, PFC: 7,
    'NO PLAY': 0, FAILED: 1, ASSIST: 2, EASY: 3, CLEAR: 4, HARD: 5, 'EX HARD': 6, 'FULL COMBO': 7,
  };

  // 곡명 정규화 — window.OhsorryNorm.norm (별도 모듈, wrapper 가 먼저 fetch + eval).
  // TITLE_ALIASES / NORM_OVERRIDES 도 normTitle 모듈 안으로 이동됨.
  const normTitle = window.OhsorryNorm.norm;

  // songs 마스터 캐시 — Map<normKey, [{ song_id, title, ac }]>
  //   첫 호출 시 페이징 fetch + 메모리 보관 (supabase REST max-rows 1000 → 1000 씩 페이지).
  //   동명이곡:
  //     - raw 다른 케이스 (Zenith vs ZEИITH 등) → normTitle 의 NORM_OVERRIDES 로 다른 normKey
  //     - raw 같은 케이스 (ADVANCE 295=INF vs 338=AC 등) → 같은 normKey 의 array, ac 비트맵으로 구분
  let songsCache = null;
  async function getSongsCache() {
    if (songsCache) return songsCache;
    const byNorm = new Map();
    const pageSize = 1000;
    let offset = 0;
    let totalFetched = 0;
    while (true) {
      const url = SUPABASE_URL +
        `/rest/v1/songs?select=song_id,title,ac,legen&order=song_id.asc&limit=${pageSize}&offset=${offset}`;
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) throw new Error(`songs fetch 실패 HTTP ${res.status}`);
      const rows = await res.json();
      for (const r of rows) {
        if (!r.title) continue;
        const k = normTitle(r.title);
        if (!k) continue;
        const entry = { song_id: r.song_id, title: r.title, ac: r.ac, legen: r.legen };
        if (!byNorm.has(k)) byNorm.set(k, []);
        byNorm.get(k).push(entry);
        // Ø/ø 곡은 eagate 표기가 일관되지 않음 — 'O' 알파벳 alias 도 등록
        // (예: 'ACTØ' → eagate 'ACT0' (norm 의 Ø→0 적용 후 매치)
        //      'S4TØ' → eagate 'S4TO' (alias 'O' 등록으로 매치))
        if (/[Øø]/.test(r.title)) {
          const altTitle = r.title.replace(/[Øø]/g, 'O');
          const kAlt = normTitle(altTitle);
          if (kAlt && kAlt !== k) {
            if (!byNorm.has(kAlt)) byNorm.set(kAlt, []);
            byNorm.get(kAlt).push(entry);
          }
        }
      }
      totalFetched += rows.length;
      if (rows.length < pageSize) break;
      offset += pageSize;
    }
    songsCache = byNorm;
    console.log(`[OhsorryDb] songs 매핑 캐시: ${byNorm.size} unique norm / ${totalFetched} 곡 fetch`);
    return byNorm;
  }

  // textage-meta lookup — norm(title) → textage_song_id Map. 한 번 빌드 후 cache.
  //   ensure_song 호출 시 p_textage_song_id 전달 → ON CONFLICT (textage_song_id) 로 옛 row 와 자동 통합.
  //   supabase songs cache 가 stale 한 경우에도 textage-meta 가 fresh 면 매칭 가능.
  //   cache miss (textage-meta 자체 없음) 면 null 반환 — 기존 동작 (textage_song_id null 로 INSERT).
  let textageByTitle = null;
  function getTextageByTitle() {
    if (textageByTitle !== null) return textageByTitle;
    const meta = (typeof window !== 'undefined' && window.__ohsorryLibCache && window.__ohsorryLibCache.textage) || null;
    if (!meta || !meta.songs) { textageByTitle = new Map(); return textageByTitle; }
    const m = new Map();
    for (const sid in meta.songs) {
      const e = meta.songs[sid];
      if (!e || !e.title) continue;
      const k = normTitle(e.title);
      if (!k) continue;
      if (!m.has(k)) m.set(k, sid);   // 같은 키 중복 시 첫 번째 우선 (parseTextage 가 LEGGENDARIA 분리 entry skip)
    }
    textageByTitle = m;
    return textageByTitle;
  }

  // normKey 후보 array + played_version → song_id 단일 선택
  //   played_version 0 = INF (ac & 2), > 0 = AC (ac & 1)
  //   - 후보 1개면 그대로
  //   - 다수면 ac 비트맵으로 필터 (raw 같은 동명이곡 분리)
  //   - 그래도 다수면 첫 번째 (안전망)
  function pickSongId(candidates, playedVersion) {
    if (!candidates || candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0].song_id;
    const wantInf = playedVersion === 0;
    const mask = wantInf ? 2 : 1;
    const filtered = candidates.filter((c) => (c.ac & mask) !== 0);
    if (filtered.length === 1) return filtered[0].song_id;
    if (filtered.length === 0) return candidates[0].song_id;
    return filtered[0].song_id;
  }

  async function callRpc(name, body) {
    const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${errText}`);
    }
    const txt = await res.text();
    if (!txt) return null;
    try { return JSON.parse(txt); } catch { return txt; }
  }

  async function callUpsertRadar(iidxId, playStyle, sourceRadar) {
    const vals = {};
    for (const [src, dst] of Object.entries(RADAR_KEY_MAP)) {
      const v = sourceRadar[src];
      vals[dst] = typeof v === 'number' ? v : null;
    }
    await callRpc('upsert_user_radar', {
      p_iidx_id: iidxId,
      p_play_style: playStyle,
      p_notes: vals.notes,
      p_peak: vals.peak,
      p_charge: vals.charge,
      p_chord: vals.chord,
      p_scratch: vals.scratch,
      p_soft: vals.soft,
    });
  }

  // 유저 프로필 + radar upsert — 새 디비 (users + user_radars)
  //   payload (기존 dbPayload 호환): { iidx_id, dj_name, star_estimate, ereter_star,
  //                                    sp_rank, dp_rank, notes_radar: { sp, dp }, ... }
  //   기타 필드 (raw_s, version, n_cleared, fc_count 등) 는 무시 (새 디비 미사용).
  //   리턴: { ok: boolean, error?: string }
  async function upsertUserProfile(payload) {
    if (!payload || !payload.iidx_id) {
      return { ok: false, error: 'iidx_id 가 없습니다' };
    }
    const statusErr = await checkUploadEnabled();
    if (statusErr) return statusErr;
    try {
      // 1. users 테이블 (FK 부모) 먼저
      await callRpc('upsert_user', {
        p_iidx_id: payload.iidx_id,
        p_dj_name: payload.dj_name || null,
        p_star: payload.star_estimate != null ? Number(payload.star_estimate) : null,
        p_ereter_star: payload.ereter_star != null ? Number(payload.ereter_star) : null,
        p_sp_rank: rankToInt(payload.sp_rank),
        p_dp_rank: rankToInt(payload.dp_rank),
        p_native_star: payload.native_star != null ? Number(payload.native_star) : null,  // v3.4.0
      });
      // 2. user_radars (SP / DP 각각, 있을 때만)
      const radar = payload.notes_radar;
      if (radar && typeof radar === 'object') {
        if (radar.sp && typeof radar.sp === 'object') {
          await callUpsertRadar(payload.iidx_id, 0, radar.sp);
        }
        if (radar.dp && typeof radar.dp === 'object') {
          await callUpsertRadar(payload.iidx_id, 1, radar.dp);
        }
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // scores bulk upsert — 새 디비 (scores 테이블)
  //   rows (기존 chartScoreRows 호환): [{ played_version, title, iidx_id, diff, ex_score, lamp, date, ... }, ...]
  //   변환:
  //     - title  → song_id (songs 캐시 + norm + ac flag 매칭, 실패 시 skip)
  //     - diff   → int (DIFF_MAP)
  //     - lamp   → int (LAMP_MAP)
  //     - played_version (예: '33') → int (33)
  //   다른 필드 (dj_name, game_level, dj_level, level) 는 무시 (새 디비 미사용).
  //   PK (song_id, iidx_id, diff, played_version) 중복 안전망: dedup 으로 best ex_score 유지.
  //   리턴: { ok: boolean, error?: string, unmatched?: number, inserted?: number }
  async function upsertUserChartScores(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: true };
    }
    const statusErr = await checkUploadEnabled();
    if (statusErr) return statusErr;
    try {
      const songMap = await getSongsCache();
      // dedup map — key: `${song_id}|${iidx_id}|${diff}|${played_version}` → row.
      // 동명이곡 (다른 song_id) 은 키가 다르므로 둘 다 유지됨.
      // 같은 PK 중복 (입력 데이터 자체 중복) 만 best ex_score 로 합침.
      const dedup = new Map();
      // 시리즈 폴더 fetch 시 r.seriesNo (= eamuse list+1, 1~33) 가 채워짐.
      // song_id 별로 시리즈 그룹 모음 → score upsert 후 bump_song_series RPC 로 songs.series_no 갱신.
      const seriesGroups = new Map();  // seriesNo (int) → Set<songId>
      let unmatched = 0;
      let invalidDiff = 0;
      let invalidVersion = 0;
      let autoEnsured = 0;  // ensure_song 으로 마스터에 자동 등록된 신곡 수
      const unmatchedSamples = [];
      const autoEnsuredSamples = [];
      for (const r of rows) {
        if (!r.title || !r.iidx_id) continue;
        const diffInt = DIFF_MAP[r.diff];
        if (diffInt == null) { invalidDiff++; continue; }
        const playedVersion = parseInt(r.played_version, 10);
        if (isNaN(playedVersion)) { invalidVersion++; continue; }
        const candidates = songMap.get(normTitle(r.title));
        let songId = pickSongId(candidates, playedVersion);
        if (songId == null) {
          // songs 마스터에 미등록 신곡 — ensure_song RPC 로 자동 등록.
          //   ac 비트 (1=AC, 2=INF) 결정: playedVersion 0=INF, 그 외=AC.
          //   LEGGENDARIA 차트면 legen 비트만, 그 외는 ac 비트만 set.
          //   RPC 실패 (SQL 미적용 / 권한 X) 시 graceful — 기존처럼 unmatched skip.
          //
          // textage-meta lookup 으로 textage_song_id 찾기 — supabase songs cache 가 stale 한 경우라도
          // textage-meta 에 그 곡이 있으면 textage_song_id 전달 → ensure_song 의 ON CONFLICT (textage_song_id)
          // 분기로 옛 row 와 자동 통합 (= series_no=99 새 row 생성 안 됨).
          const isLeg = r.diff === 'LEGGENDARIA';
          const acBit = playedVersion === 0 ? 2 : 1;
          const txMap = getTextageByTitle();
          const txId = txMap ? (txMap.get(normTitle(r.title)) || null) : null;
          try {
            const ensured = await callRpc('ensure_song', {
              p_title: r.title,
              p_textage_song_id: txId,
              p_ac:    isLeg ? null : acBit,
              p_legen: isLeg ? acBit : null,
            });
            const newId = typeof ensured === 'number' ? ensured : parseInt(ensured, 10);
            if (!Number.isFinite(newId) || newId <= 0) throw new Error('ensure_song returned non-numeric');
            songId = newId;
            // songs cache 갱신 — 같은 row 묶음의 다음 차트가 재매칭 가능하도록.
            const k = normTitle(r.title);
            if (!songMap.has(k)) songMap.set(k, []);
            songMap.get(k).push({
              song_id: songId, title: r.title,
              ac:    isLeg ? 0 : acBit,
              legen: isLeg ? acBit : 0,
            });
            autoEnsured++;
            if (autoEnsuredSamples.length < 10) autoEnsuredSamples.push(r.title);
          } catch (e) {
            unmatched++;
            if (unmatchedSamples.length < 10) unmatchedSamples.push(r.title + ' (' + e.message + ')');
            continue;
          }
        }
        // 시리즈 폴더 fetch 시 채워진 seriesNo (1~33) 를 song_id 별로 모음.
        if (typeof r.seriesNo === 'number' && r.seriesNo > 0) {
          let set = seriesGroups.get(r.seriesNo);
          if (!set) { set = new Set(); seriesGroups.set(r.seriesNo, set); }
          set.add(songId);
        }
        const lampInt = r.lamp != null && LAMP_MAP[r.lamp] != null ? LAMP_MAP[r.lamp] : null;
        const exScore = r.ex_score != null ? Number(r.ex_score) : null;
        const playStyle = (r.play_style === 0 || r.play_style === '0') ? 0 : 1;  // 0=SP, 1=DP(기본)
        const newRow = {
          song_id: songId,
          iidx_id: r.iidx_id,
          diff: diffInt,
          lamp: lampInt,
          ex_score: exScore,
          played_version: playedVersion,
          play_style: playStyle,
          date: r.date,
        };
        const pk = `${songId}|${r.iidx_id}|${diffInt}|${playedVersion}|${playStyle}`;
        const prev = dedup.get(pk);
        if (!prev) {
          dedup.set(pk, newRow);
        } else {
          // 더 좋은 ex_score, 동점이면 더 좋은 lamp 유지
          const prevEx = prev.ex_score || 0;
          const newEx = exScore || 0;
          if (newEx > prevEx || (newEx === prevEx && (lampInt || 0) > (prev.lamp || 0))) {
            dedup.set(pk, newRow);
          }
        }
      }
      const scoreRows = [...dedup.values()];
      if (unmatched > 0) {
        console.warn(`[OhsorryDb] song 매칭 실패 ${unmatched}건 (skip). 샘플:`, unmatchedSamples);
      }
      if (autoEnsured > 0) {
        console.log(`[OhsorryDb] songs 마스터 자동 등록 (ensure_song) ${autoEnsured}건:`, autoEnsuredSamples);
      }
      if (invalidDiff > 0) console.warn(`[OhsorryDb] diff 변환 실패 ${invalidDiff}건 (skip)`);
      if (invalidVersion > 0) console.warn(`[OhsorryDb] played_version 변환 실패 ${invalidVersion}건 (skip)`);
      if (scoreRows.length === 0) {
        return { ok: true, unmatched, inserted: 0, autoEnsured };
      }
      await callRpc('upsert_scores', { p_rows: scoreRows });
      console.log(`[OhsorryDb] scores upsert: ${scoreRows.length}건 (전체 ${rows.length}건 중, dedup 후)`);
      // 시리즈 폴더 fetch 모드일 때만 — songs.series_no 갱신 (eamuse 시리즈 분류 = 신뢰 출처).
      // 시리즈마다 RPC 1번 (배치). 실패해도 score upsert 자체는 성공이므로 fire-and-forget 로깅만.
      let seriesBumped = 0;
      for (const [seriesNo, songIdSet] of seriesGroups) {
        try {
          const updated = await callRpc('bump_song_series', {
            p_song_ids: Array.from(songIdSet),
            p_series_no: seriesNo,
          });
          const n = typeof updated === 'number' ? updated : parseInt(updated, 10);
          if (Number.isFinite(n)) seriesBumped += n;
        } catch (e) {
          console.warn(`[OhsorryDb] bump_song_series(seriesNo=${seriesNo}) 실패 (skip): ${e.message}`);
        }
      }
      if (seriesGroups.size > 0) {
        console.log(`[OhsorryDb] songs.series_no 갱신: ${seriesBumped}건 (${seriesGroups.size}시리즈)`);
      }
      return { ok: true, unmatched, inserted: scoreRows.length, autoEnsured };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // user_profiles 조회 — RPC get_user_profile_full(p_iidx_id text)
  //   같은 iidx_id 의 다중 시즌 row 중 last_updated_at 최신 1건 반환 (RPC 가 이미 그렇게 정렬)
  //   리턴: row (jsonb) 또는 throw
  async function fetchUserProfile(iidxId) {
    const id = String(iidxId || '').trim().replace(/-/g, '');
    if (!id) throw new Error('iidx_id 가 없습니다');
    const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/get_user_profile_full', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ p_iidx_id: id }),
    });
    if (!res.ok) throw new Error(`조회 실패 (HTTP ${res.status})`);
    const data = await res.json();
    if (!data || !data.iidx_id) throw new Error('해당 IIDX ID 의 데이터가 없습니다');
    return data;
  }

  // 기존 user row 의 star / ereter_star 만 조회 (없으면 둘 다 null).
  //   upsert_user 는 star / ereter_star 를 EXCLUDED 로 무조건 덮어쓰는 정책(02_users.sql)이라,
  //   ★분석을 안 하는 SP 모드에서 프로필을 저장할 때 기존 값을 SELECT 해 그대로 재전송해야 보존됨.
  //   (users RLS: FOR SELECT USING(true) + anon GRANT → anon key 로 조회 가능. dbr_pw 만 제외.)
  async function fetchUserStars(iidxId) {
    const id = String(iidxId || '').trim().replace(/-/g, '');
    if (!id) return { star: null, ereter_star: null };
    try {
      const url = SUPABASE_URL + '/rest/v1/users'
        + `?iidx_id=eq.${encodeURIComponent(id)}&select=star,ereter_star&limit=1`;
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) return { star: null, ereter_star: null };
      const rows = await res.json();
      const r = Array.isArray(rows) && rows.length ? rows[0] : null;
      return {
        star: r && r.star != null ? r.star : null,
        ereter_star: r && r.ereter_star != null ? r.ereter_star : null,
      };
    } catch (e) {
      console.warn('[OhsorryDb] fetchUserStars 실패:', e && e.message);
      return { star: null, ereter_star: null };
    }
  }

  // ============================================================
  // uploadResult — 결과 패널 렌더 직후의 supabase 업로드 trigger.
  // ohsorryRender 의 supabase upload 블록을 흡수. DB 모드 (dbData 있음) 자동 skip.
  //
  // 사용:
  //   await window.OhsorryDb.uploadResult(result, { dbData });
  //
  // 반환:
  //   { skipped: true, reason }                              — skip 한 경우
  //   { profile: { ok, error }, scores: { ok, error } | null } — 시도한 경우
  // ============================================================
  async function uploadResult(result, ctx) {
    const opts = ctx || {};

    // 1. DB 모드 — 다른 유저 데이터 열람 중. 절대 upsert 하지 않음.
    if (opts.dbData) {
      console.log('[OhsorryDb] DB 모드 — supabase 재업로드 skip');
      return { skipped: true, reason: 'dbMode' };
    }

    // 2. payload 자체 없음 (Core 가 빌드 안 함) — 조용히 skip.
    if (!result || !result.dbPayload) {
      return { skipped: true, reason: 'no dbPayload' };
    }

    const out = { profile: null, scores: null };

    // 3. 유저 프로필 + radar upsert (upsert_user + upsert_user_radar SP/DP).
    try {
      out.profile = await upsertUserProfile(result.dbPayload);
      if (out.profile && out.profile.ok) console.log('[OhsorryDb] supabase upsert 성공');
      else console.warn('[OhsorryDb] supabase upsert 실패:', out.profile && out.profile.error);
    } catch (e) {
      out.profile = { ok: false, error: e && e.message };
      console.warn('[OhsorryDb] supabase upsert 예외:', e && e.message);
    }

    // 4. 차트 점수 bulk upsert (upsert_scores). chartScoreRows 가 있을 때만.
    if (result.chartScoreRows) {
      try {
        out.scores = await upsertUserChartScores(result.chartScoreRows);
        if (out.scores && out.scores.ok) console.log('[OhsorryDb] chart scores upsert 성공');
        else console.warn('[OhsorryDb] chart scores upsert 실패:', out.scores && out.scores.error);
      } catch (e) {
        out.scores = { ok: false, error: e && e.message };
        console.warn('[OhsorryDb] chart scores upsert 예외:', e && e.message);
      }
    }

    // 5. 사용자 패턴 점수 (quantile score 평균) upsert — feature-scores-slim.json (gist) 활용.
    //    plays 차트 (exScore > 0) 마다 precomputed quantile score (0~100) lookup → feature 별 평균.
    //    score=0 인 곡은 분모 제외 (CHARGE/SOF-LAN baseline + 다른 feature 의 raw=0 곡).
    const iidxId = result.dbPayload && result.dbPayload.iidx_id;
    if (iidxId) {
      try {
        const vec = await computePatternScoreVec(iidxId);
        if (vec) {
          await callUpsertFeatureScore(iidxId, vec);
          console.log('[OhsorryDb] feature score upsert 성공 (NOTES=' + vec.NOTES.toFixed(1) + ' charts=' + vec.__count + ')');
        } else {
          console.warn('[OhsorryDb] pattern 점수 계산 skip (feature-scores fetch 실패 또는 plays 차트 부족)');
        }
      } catch (e) {
        console.warn('[OhsorryDb] pattern 점수 계산/upsert 예외:', e && e.message);
      }
    }
    return out;
  }

  // feature-scores-slim.json + textage-meta.json (둘 다 같은 gist 호스팅).
  //   feature-scores: 차트별 10 feature quantile score (0~100).
  //   textage-meta: 차트별 notes 수 (score rate = ex_score / (notes×2) 계산용).
  //   첫 호출 시 fetch + cache (메모리, 페이지 lifetime).
  const FEATURE_SCORES_URL = 'https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw/feature-scores-slim.json';
  const TEXTAGE_META_URL   = 'https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw/textage-meta.json';
  let featureScoresCache = null;
  let textageMetaCache = null;
  async function getFeatureScores() {
    if (featureScoresCache) return featureScoresCache;
    const res = await fetch(FEATURE_SCORES_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('feature-scores HTTP ' + res.status);
    featureScoresCache = await res.json();
    return featureScoresCache;
  }
  async function getTextageMeta() {
    if (textageMetaCache) return textageMetaCache;
    const res = await fetch(TEXTAGE_META_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('textage-meta HTTP ' + res.status);
    textageMetaCache = await res.json();
    return textageMetaCache;
  }

  // make_grid_data 로 유저의 supabase 저장 차트 받아 → feature 별 top 30 가중합.
  //   1. chart 의 10 feature quantile score (0~100) lookup
  //   2. score rate = ex_score / (notes × 2)  (IIDX 표준 EX rate, 0~1)
  //   3. feature 별로 points = chart_score × score_rate 모은 뒤 내림차순 정렬
  //   4. top 30 만 선택, 가중치 5곡씩 [1, 0.5, 0.25, 0.125, 0.0625, 0.03125] 적용
  //   5. feature_score = Σ(w_i × points_i)  (분모 없음. 30곡 미만이면 자리 비워짐 → 점수 ↓)
  //   user_ohsorry_radars 10 feature (SOF-LAN 은 dump 단계에서 changes/ratio 융합됨).
  //   반환: { NOTES, CHORD, PEAK, CHARGE, SCRATCH, 'SOF-LAN', PHRASE, JACK, TRILL, RAND, __count } 또는 null.
  const TOP_N = 30;
  // 가중치: 1~5위 = 1.0, 6~30위 = 0.90 → 0.05 선형 감소.
  const WEIGHTS = (() => {
    const ws = [];
    for (let i = 0; i < 5; i++) ws.push(1.0);
    for (let i = 0; i < 25; i++) {
      const pct = 90 - i * (90 - 5) / 24;
      ws.push(pct / 100);
    }
    return ws;
  })();
  async function computePatternScoreVec(iidxId) {
    const [fsData, textageMeta] = await Promise.all([
      getFeatureScores().catch(() => null),
      getTextageMeta().catch(() => null),
    ]);
    if (!fsData || !fsData.scores) return null;
    if (!textageMeta || !textageMeta.songs) return null;
    const scores = fsData.scores;
    const songsMeta = textageMeta.songs;

    // PostgREST RPC 는 기본 max_rows=1000. plays 많은 유저는 한 번에 다 못 받으므로
    //   ?limit=&offset= 페이지네이션 (ohSorryWeb api.js / backfill-pattern-score.js 와 동일 패턴).
    const pageSize = 1000;
    const rows = [];
    let offset = 0;
    for (;;) {
      const res = await fetch(
        SUPABASE_URL + `/rest/v1/rpc/make_grid_data?limit=${pageSize}&offset=${offset}`,
        {
          method: 'POST', headers: HEADERS,
          body: JSON.stringify({ p_iidx_id: iidxId }),
        },
      );
      if (!res.ok) throw new Error('make_grid_data HTTP ' + res.status);
      const page = await res.json();
      if (!Array.isArray(page) || page.length === 0) break;
      rows.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
    if (rows.length === 0) return null;

    const DIFF_INT_TO_FEATURE_KEY = { 1: 'DP_NOR', 2: 'DP_HYP', 3: 'DP_ANO', 4: 'DP_LEG' };
    const DIFF_INT_TO_NOTES_KEY   = { 1: 'DN', 2: 'DH', 3: 'DA', 4: 'DX' };
    // 36 dim — mirror-invariant 10 + mirror 11 × L/R 22 + chart-level invariant 4(HSTAIR).
    //   migration_ohsorry_36feat.sql 에서 8 dim(겹계단/계마/양손계단) 추가 — upsert_user_feature_score 37 인자.
    //   ⚠️ 신규 8값은 gist feature-scores-slim.json 이 36키로 배포된 뒤에야 산출됨(28키면 0).
    const FEATS = [
      'NOTES', 'CHORD', 'PEAK', 'CHARGE', 'SCRATCH', 'SOF-LAN', 'PHRASE', 'JACK', 'TRILL', 'RAND',
      'STAIR_UP_L', 'STAIR_UP_R', 'STAIR_DN_L', 'STAIR_DN_R',
      'K1_L', 'K1_R', 'K2_L', 'K2_R', 'K3_L', 'K3_R',
      'K4_L', 'K4_R', 'K5_L', 'K5_R', 'K6_L', 'K6_R', 'K7_L', 'K7_R',
      'DOUBLE_STAIR_L', 'DOUBLE_STAIR_R', 'KEIMA_L', 'KEIMA_R',
      'HSTAIR_ONEHAND', 'HSTAIR_SYNC', 'HSTAIR_SAMESHAPE', 'HSTAIR_DIFFSHAPE',
    ];

    const pointsByFeat = {};
    for (const f of FEATS) pointsByFeat[f] = [];
    let matched = 0;
    for (const r of rows) {
      if (!r || !r.ex_score || r.ex_score <= 0) continue;
      const sid = r.textage_song_id;
      if (!sid) continue;
      const featureKey = DIFF_INT_TO_FEATURE_KEY[r.diff];
      const notesKey   = DIFF_INT_TO_NOTES_KEY[r.diff];
      if (!featureKey || !notesKey) continue;
      const songScores = scores[sid];
      if (!songScores) continue;
      const chartScores = songScores[featureKey];
      if (!chartScores) continue;
      const songMeta = songsMeta[sid];
      if (!songMeta || !songMeta.notes) continue;
      const noteCount = songMeta.notes[notesKey];
      if (!noteCount || noteCount <= 0) continue;
      const scoreRate = r.ex_score / (noteCount * 2);
      matched++;
      for (const f of FEATS) {
        const s = chartScores[f];
        if (typeof s !== 'number' || s <= 0) continue;
        pointsByFeat[f].push(s * scoreRate);
      }
    }
    if (matched === 0) return null;
    const vec = { __count: matched };
    for (const f of FEATS) {
      const top = pointsByFeat[f].sort((a, b) => b - a).slice(0, TOP_N);
      let acc = 0;
      for (let i = 0; i < top.length; i++) acc += top[i] * WEIGHTS[i];
      vec[f] = acc;
    }
    return vec;
  }

  // 오소리 피쳐 스코어 upsert — user_ohsorry_radars (play_style=1, DP).
  // RPC 시그니처: migration_ohsorry_36feat.sql 의 37 인자 (text + 36 numeric).
  //   기존 28 dim 뒤에 신규 8 dim(겹계단/계마/양손계단) append. 신규 인자는 DEFAULT NULL 라 28키 gist 에선 0/null 전송.
  async function callUpsertFeatureScore(iidxId, vec) {
    const numOrNull = (v) => typeof v === 'number' && isFinite(v) ? v : null;
    // payload 직전 신규 8값 로그 (검증용 — window.__OHSORRY_DEBUG_FEAT 켜면 출력)
    if (typeof window !== 'undefined' && window.__OHSORRY_DEBUG_FEAT) {
      console.log('[upsert 신규8]', {
        DOUBLE_STAIR_L: vec.DOUBLE_STAIR_L, DOUBLE_STAIR_R: vec.DOUBLE_STAIR_R,
        KEIMA_L: vec.KEIMA_L, KEIMA_R: vec.KEIMA_R,
        HSTAIR_ONEHAND: vec.HSTAIR_ONEHAND, HSTAIR_SYNC: vec.HSTAIR_SYNC,
        HSTAIR_SAMESHAPE: vec.HSTAIR_SAMESHAPE, HSTAIR_DIFFSHAPE: vec.HSTAIR_DIFFSHAPE,
      });
    }
    await callRpc('upsert_user_feature_score', {
      p_iidx_id:    iidxId,
      p_os_notes:   numOrNull(vec.NOTES),
      p_os_chord:   numOrNull(vec.CHORD),
      p_os_peak:    numOrNull(vec.PEAK),
      p_os_charge:  numOrNull(vec.CHARGE),
      p_os_scratch: numOrNull(vec.SCRATCH),
      p_os_soflan:  numOrNull(vec['SOF-LAN']),
      p_os_phrase:  numOrNull(vec.PHRASE),
      p_os_jack:    numOrNull(vec.JACK),
      p_os_trill:   numOrNull(vec.TRILL),
      p_os_rand:    numOrNull(vec.RAND),
      p_os_stair_up_l: numOrNull(vec.STAIR_UP_L),
      p_os_stair_up_r: numOrNull(vec.STAIR_UP_R),
      p_os_stair_dn_l: numOrNull(vec.STAIR_DN_L),
      p_os_stair_dn_r: numOrNull(vec.STAIR_DN_R),
      p_os_k1_l: numOrNull(vec.K1_L), p_os_k1_r: numOrNull(vec.K1_R),
      p_os_k2_l: numOrNull(vec.K2_L), p_os_k2_r: numOrNull(vec.K2_R),
      p_os_k3_l: numOrNull(vec.K3_L), p_os_k3_r: numOrNull(vec.K3_R),
      p_os_k4_l: numOrNull(vec.K4_L), p_os_k4_r: numOrNull(vec.K4_R),
      p_os_k5_l: numOrNull(vec.K5_L), p_os_k5_r: numOrNull(vec.K5_R),
      p_os_k6_l: numOrNull(vec.K6_L), p_os_k6_r: numOrNull(vec.K6_R),
      p_os_k7_l: numOrNull(vec.K7_L), p_os_k7_r: numOrNull(vec.K7_R),
      // 신규 8
      p_os_double_stair_l: numOrNull(vec.DOUBLE_STAIR_L), p_os_double_stair_r: numOrNull(vec.DOUBLE_STAIR_R),
      p_os_keima_l: numOrNull(vec.KEIMA_L), p_os_keima_r: numOrNull(vec.KEIMA_R),
      p_os_hstair_onehand: numOrNull(vec.HSTAIR_ONEHAND), p_os_hstair_sync: numOrNull(vec.HSTAIR_SYNC),
      p_os_hstair_sameshape: numOrNull(vec.HSTAIR_SAMESHAPE), p_os_hstair_diffshape: numOrNull(vec.HSTAIR_DIFFSHAPE),
    });
  }

  return {
    VERSION: '0.0.411',
    upsertUserProfile: upsertUserProfile,
    upsertUserChartScores: upsertUserChartScores,
    uploadResult: uploadResult,
    fetchUserProfile: fetchUserProfile,
    fetchUserStars: fetchUserStars,
    fetchServiceStatus: fetchServiceStatus,
    getSongsByNorm: getSongsCache,  // Map<normKey, [{ song_id, title, ac, legen }]> — INF/AC 차트 단위 필터링용
  };
})();
