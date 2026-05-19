// dbConn.js — 오소리 DB 통신 모듈 (v0.0.402)
//
// 새 디비 (users + user_radars + scores) 로 마이그레이션.
//   - upsertUserProfile: upsert_user + upsert_user_radar (sp/dp)
//   - upsertUserChartScores: songs 매핑 캐시 + upsert_scores (text→int + title→song_id 변환)
//   - fetchUserProfile 은 다음 단계 (TODO)
//
// 본체 / 라이벌 wrapper 가 fetch + eval 해서 사용 (window.OhsorryDb 로 노출).
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
        `/rest/v1/songs?select=song_id,title,ac&order=song_id.asc&limit=${pageSize}&offset=${offset}`;
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) throw new Error(`songs fetch 실패 HTTP ${res.status}`);
      const rows = await res.json();
      for (const r of rows) {
        if (!r.title) continue;
        const k = normTitle(r.title);
        if (!k) continue;
        const entry = { song_id: r.song_id, title: r.title, ac: r.ac };
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
      let unmatched = 0;
      let invalidDiff = 0;
      let invalidVersion = 0;
      const unmatchedSamples = [];
      for (const r of rows) {
        if (!r.title || !r.iidx_id) continue;
        const diffInt = DIFF_MAP[r.diff];
        if (diffInt == null) { invalidDiff++; continue; }
        const playedVersion = parseInt(r.played_version, 10);
        if (isNaN(playedVersion)) { invalidVersion++; continue; }
        const candidates = songMap.get(normTitle(r.title));
        const songId = pickSongId(candidates, playedVersion);
        if (songId == null) {
          unmatched++;
          if (unmatchedSamples.length < 10) unmatchedSamples.push(r.title);
          continue;
        }
        const lampInt = r.lamp != null && LAMP_MAP[r.lamp] != null ? LAMP_MAP[r.lamp] : null;
        const exScore = r.ex_score != null ? Number(r.ex_score) : null;
        const newRow = {
          song_id: songId,
          iidx_id: r.iidx_id,
          diff: diffInt,
          lamp: lampInt,
          ex_score: exScore,
          played_version: playedVersion,
          date: r.date,
        };
        const pk = `${songId}|${r.iidx_id}|${diffInt}|${playedVersion}`;
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
      if (invalidDiff > 0) console.warn(`[OhsorryDb] diff 변환 실패 ${invalidDiff}건 (skip)`);
      if (invalidVersion > 0) console.warn(`[OhsorryDb] played_version 변환 실패 ${invalidVersion}건 (skip)`);
      if (scoreRows.length === 0) {
        return { ok: true, unmatched, inserted: 0 };
      }
      await callRpc('upsert_scores', { p_rows: scoreRows });
      console.log(`[OhsorryDb] scores upsert: ${scoreRows.length}건 (전체 ${rows.length}건 중, dedup 후)`);
      return { ok: true, unmatched, inserted: scoreRows.length };
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

  return {
    VERSION: '0.0.402',
    upsertUserProfile: upsertUserProfile,
    upsertUserChartScores: upsertUserChartScores,
    fetchUserProfile: fetchUserProfile,
    fetchServiceStatus: fetchServiceStatus,
  };
})();
