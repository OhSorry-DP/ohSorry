// ============================================================
// STEP 2: p.eagate.573.jp 도메인 어느 페이지에서나 실행 가능
// ============================================================
// 자동으로 LEVEL 12 / DP 의 difficulty.html 페이지를 fetch 합니다.
// ereter 데이터도 Gist 에서 자동으로 불러옵니다 (사전 작업 불필요).
//
// 동작:
//   1. Gist 에서 ereter JSON 데이터 fetch (localStorage 에 24시간 캐시)
//   2. difficulty.html?difficult=11&style=1&disp=1&offset=0 부터 fetch
//   3. NEXT 링크 없을 때까지 offset 증가시키며 순회
//      각 페이지 사이 3~6초 랜덤 대기 (봇 의심 회피)
//   4. 모든 곡의 클리어램프 + 차트 추출 후 ereter diff 와 매칭
//   5. ★값 추정 (사용자 실력 지표)
//   6. status.html fetch 로 프로필 정보 (DJ 이름, IIDX ID, SP/DP 단위, 쿠프로) 추출
//   7. 추천곡 계산: 안 친 곡 (NO PLAY) 중 ★값 근처 EXH 난이도의 10곡
//   8. 화면에 프로필 카드 + ★값 + 추천곡 표시
//
// 다른 레벨/스타일을 보고 싶으면 코드 안의 difficult/style 값 변경
// 딜레이 조정: DELAY_MIN_MS / DELAY_MAX_MS 변수 변경
//   기본: 600~1800ms (12레벨 8페이지면 총 약 5~14초)
// ============================================================
//
// [DB 모드] window.__dp_render(dbData) 로 호출하면 eagate fetch 없이
//   supabase user_profiles row (dbData) 로 바로 렌더 → 아무 사이트에서나 사용 가능.
//   dbData 없이 호출 (또는 eagate 도메인 자동 실행) 하면 기존 eagate fetch 모드.
//   dbData 형식: { iidx_id, dj_name, sp_rank, dp_rank, charts_json, notes_radar, ... }
// ============================================================

window.__dp_render = async (dbData) => {
  dbData = dbData || null;
  // -------- 0. ereter 데이터 로드 (Gist 에서 자동 fetch) --------
  // ereter.net 데이터는 Gist 에 ereter-data.json 으로 올려둔 걸 가져옵니다.
  // 형식: { extractedAt: "ISO 일시", source, count, charts: [...] }
  //       또는 옛 형식 [{...}, ...] (호환성 유지)
  // 한 번 받으면 24시간 동안 localStorage 에 캐시됨
  // 강제로 새로 받고 싶으면: localStorage.removeItem('ereter_dp_diff_v4'); 후 재실행
  const ERETER_DATA_URL = 'https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw/ereter-data.json';
  // zasa.sakura.ne.jp 의 비공식 ☆12 난이도표 — ereter 미등록 차트 검증용 (보충).
  // 추천곡 / ★값 추정에는 사용 X. "★ 단위별 클리어 램프 표" 의 곡 수 보강만.
  const ZASA_DATA_URL = 'https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw/zasa-data.json';
  // textage 채보 메타 — 채보별 총 노트 수 (notes.DN/DH/DA/DX). noteCount 보강 + missCount 계산용.
  const TEXTAGE_DATA_URL = 'https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw/textage-meta.json';
  const CACHE_KEY = 'ereter_dp_diff_v4';
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;  // 24시간

  // 형식 정규화:
  //   옛 형식: [{...}, ...]  (배열)
  //   v1 형식: { extractedAt, charts: [...] }
  //   v2 형식 (현재): { extractedAt, charts: [...], players: { iidxId: ★ } }
  const normalizePayload = (raw) => {
    if (Array.isArray(raw)) {
      return { charts: raw, extractedAt: null, players: null };
    }
    if (raw && typeof raw === 'object' && Array.isArray(raw.charts)) {
      return {
        charts: raw.charts,
        extractedAt: raw.extractedAt || null,
        players: raw.players && typeof raw.players === 'object' ? raw.players : null,
      };
    }
    return { charts: null, extractedAt: null, players: null };
  };

  let ereterData = null;
  let ereterExtractedAt = null;
  let ereterPlayers = null;  // { iidxId: ★ } 매핑 (있으면)

  // 캐시 확인 + 원격 extractedAt 비교
  let cachedExtractedAt = null;
  let cachedData = null;
  try {
    const stored = localStorage.getItem(CACHE_KEY);
    if (stored) {
      const cached = JSON.parse(stored);
      if (cached && cached.ts && (Date.now() - cached.ts < CACHE_TTL_MS) && Array.isArray(cached.data)) {
        cachedData = cached.data;
        cachedExtractedAt = cached.extractedAt || null;
      }
    }
  } catch {}

  // 항상 Gist 의 최신 extractedAt 빠르게 확인 (HEAD 같은 거 안 됨, GET 짧게)
  // 다행히 ereter-data.json 가 그렇게 크지 않으니 fetch 하면서 compare
  console.log('[step2] ereter 데이터 fetch 중...');
  try {
    const url = ERETER_DATA_URL + '?t=' + Date.now();  // CDN 캐시 우회
    const res = await fetch(url, { cache: 'no-store' });  // 브라우저 캐시도 우회
    if (!res.ok) {
      alert(
        `ereter 데이터를 못 가져왔어요 (HTTP ${res.status}).\n` +
        `Gist URL 확인이 필요합니다:\n${ERETER_DATA_URL}`
      );
      return;
    }
    const raw = await res.json();
    const payloadNorm = normalizePayload(raw);
    if (!payloadNorm.charts || payloadNorm.charts.length === 0) {
      alert('ereter 데이터가 비어있거나 형식이 잘못됐어요.');
      return;
    }
    ereterData = payloadNorm.charts;
    ereterExtractedAt = payloadNorm.extractedAt;
    ereterPlayers = payloadNorm.players;
    if (ereterPlayers) {
      console.log(`[step2] ereter players ★ 매핑: ${Object.keys(ereterPlayers).length}명`);
    }

    // 캐시랑 비교 - 같으면 캐시 그대로 사용한 셈, 다르면 새 데이터
    if (cachedExtractedAt && cachedExtractedAt === ereterExtractedAt) {
      const ageHr = ((Date.now() - JSON.parse(localStorage.getItem(CACHE_KEY) || '{}').ts) / 3600000).toFixed(1);
      console.log(`[step2] ereter 데이터 동일 (캐시와 같음, 캐시 ${ageHr}시간 전)`);
      if (ereterExtractedAt) console.log(`         원본 추출일시: ${ereterExtractedAt}`);
    } else {
      // 새 데이터 → 캐시 갱신 (players 도 포함)
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          ts: Date.now(),
          data: ereterData,
          extractedAt: ereterExtractedAt,
          players: ereterPlayers,
        }));
      } catch {}
      if (cachedExtractedAt) {
        console.log(`[step2] ereter 데이터 갱신됨! (${cachedExtractedAt} → ${ereterExtractedAt})`);
      } else {
        console.log(`[step2] ereter 데이터 ${ereterData.length}개 fetch 완료, 캐시함`);
        if (ereterExtractedAt) console.log(`         원본 추출일시: ${ereterExtractedAt}`);
      }
    }
  } catch (e) {
    console.error('[step2] ereter fetch 실패:', e);
    alert(`ereter 데이터 fetch 실패: ${e.message}\n네트워크 또는 CSP 문제일 수 있습니다.`);
    return;
  }
  console.log(`[step2] ereter 차트 ${ereterData.length}개 로드`);

  // -------- 0.5. zasa 보충 데이터 fetch (선택, 실패해도 무시) --------
  // ereter 에 없는 ☆12 차트를 검증용으로 보충. 추천 / ★ 추정엔 사용 X.
  let zasaData = [];
  try {
    const res = await fetch(ZASA_DATA_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (res.ok) {
      const raw = await res.json();
      if (raw && Array.isArray(raw.charts)) {
        zasaData = raw.charts;
        console.log(`[step2] zasa 보충 차트 ${zasaData.length}개 로드`);
      }
    }
  } catch (e) {
    console.warn('[step2] zasa fetch 실패 (무시 가능):', e.message);
  }

  // -------- 0.55. textage 채보 메타 fetch (선택, 실패해도 무시) --------
  // 채보별 총 노트 수 → charts 의 noteCount 보강 + missCount 계산 (noteCount - pgreat - great).
  let textageSongs = null;
  try {
    const res = await fetch(TEXTAGE_DATA_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (res.ok) {
      const raw = await res.json();
      if (raw && raw.songs && typeof raw.songs === 'object') {
        textageSongs = raw.songs;
        console.log(`[step2] textage 채보 메타 ${Object.keys(textageSongs).length}곡 로드`);
      }
    }
  } catch (e) {
    console.warn('[step2] textage fetch 실패 (무시 가능):', e.message);
  }

  // -------- 0.6. ohSorryRating 데이터 + 외부 ★ 추정 lib fetch (localStorage 캐시) --------
  // v3.3.4: user ★ 추정 로직을 외부 lib 으로 분리. 본체는 fetch + ensemble (oldOSR + OSR) / 2 만.
  //   fetch 실패 시 localStorage 캐시 사용. 캐시도 없으면 ohSorry 동작 불가 (에러 표시).
  const GIST_RAW = 'https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw';
  const OHSORRY_RATING_URL = GIST_RAW + '/ohSorryRating.json';
  const CALC_OLD_OSR_URL = GIST_RAW + '/calc-Old-OSR.js';
  const CALC_OSR_URL = GIST_RAW + '/calc-OSRating.js';
  // v3.3.5: OSR13.5+ (bin50 + 50% 임계 + 상향 bin 부분 보너스) — 13.5 이상 시 ensemble 오버라이드
  const CALC_OSR135_URL = GIST_RAW + '/OSR13.5%2B.js';
  // ohsorry-shelf.js — renderChartRow (추천곡 곡명 클릭 토스트용). 실패해도 무시.
  const CALC_SHELF_URL = GIST_RAW + '/ohsorry-shelf.js';

  // localStorage 캐시 헬퍼 — fetch 실패 시 이전 성공 결과 복원
  const loadWithCache = async (url, cacheKey, isJson) => {
    try {
      const res = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = isJson ? await res.json() : await res.text();
      try {
        localStorage.setItem(cacheKey, isJson ? JSON.stringify(data) : data);
        localStorage.setItem(cacheKey + ':ts', new Date().toISOString());
      } catch {}
      return { data, source: 'fetch' };
    } catch (e) {
      const cached = localStorage.getItem(cacheKey);
      if (cached != null) {
        const ts = localStorage.getItem(cacheKey + ':ts') || '시간 불명';
        console.warn(`[step2] ${cacheKey} fetch 실패 (${e.message}) → localStorage 캐시 사용 (${ts})`);
        return { data: isJson ? JSON.parse(cached) : cached, source: 'cache' };
      }
      throw new Error(`${cacheKey}: fetch 실패 + 캐시 없음 — ${e.message}`);
    }
  };

  // ohSorryRating.json — chart 별 EC/HC/EXH 추정값 (v0.0.2)
  let ohSorryRatings = [], ratingData = null;
  try {
    const { data, source } = await loadWithCache(OHSORRY_RATING_URL, 'ohSorry:ratingData', true);
    ratingData = data;
    if (data && Array.isArray(data.ratings)) {
      ohSorryRatings = data.ratings;
      console.log(`[step2] ohSorryRating ${ohSorryRatings.length}곡 로드 (${source})`);
    }
  } catch (e) {
    console.error('[step2] ohSorryRating 로드 실패:', e.message);
  }

  // calc-Old-OSR.js (v3.3.3 모델) + calc-OSRating.js (v0.0.2 모델) + OSR13.5+.js lib fetch + eval
  //   eval 은 UMD wrapper 라 window.oldOSR / window.ohSorryRating / window.OSR135 글로벌 등록
  let oldOSR = null, ohSorryRatingLib = null, osr135Lib = null, shelfLib = null;
  try {
    const { data: oldOSRSrc, source: oldSrc } = await loadWithCache(CALC_OLD_OSR_URL, 'ohSorry:libOldOSR', false);
    // UMD 가 window 에 등록 — IIFE 실행
    (new Function(oldOSRSrc))();
    oldOSR = window.oldOSR;
    if (!oldOSR) throw new Error('oldOSR global 등록 실패');
    console.log(`[step2] calc-Old-OSR.js v${oldOSR.version} 로드 (${oldSrc})`);
  } catch (e) {
    console.error('[step2] calc-Old-OSR.js 로드 실패:', e.message);
  }
  try {
    const { data: osrSrc, source: newSrc } = await loadWithCache(CALC_OSR_URL, 'ohSorry:libOSR', false);
    (new Function(osrSrc))();
    ohSorryRatingLib = window.ohSorryRating;
    if (!ohSorryRatingLib) throw new Error('ohSorryRating global 등록 실패');
    console.log(`[step2] calc-OSRating.js 로드 (${newSrc})`);
  } catch (e) {
    console.error('[step2] calc-OSRating.js 로드 실패:', e.message);
  }
  // v3.3.5: OSR13.5+ lib (13.5 이상 ★ 정확도 ↑)
  try {
    const { data: osr135Src, source: src135 } = await loadWithCache(CALC_OSR135_URL, 'ohSorry:libOSR135', false);
    (new Function(osr135Src))();
    osr135Lib = window.OSR135;
    if (!osr135Lib) throw new Error('OSR135 global 등록 실패');
    console.log(`[step2] OSR13.5+.js v${osr135Lib.version} 로드 (${src135})`);
  } catch (e) {
    console.error('[step2] OSR13.5+.js 로드 실패:', e.message);
  }
  // ohsorry-shelf.js — 추천곡 곡명 클릭 토스트 (renderChartRow) 용. 실패해도 무시 (토스트만 비활성).
  try {
    const { data: shelfSrc, source: shelfSrcType } = await loadWithCache(CALC_SHELF_URL, 'ohSorry:libShelf', false);
    (new Function(shelfSrc))();
    shelfLib = window.OhSorryShelf;
    if (shelfLib) {
      shelfLib.injectStyle();
      console.log(`[step2] ohsorry-shelf.js v${shelfLib.version} 로드 (${shelfSrcType})`);
    }
  } catch (e) {
    console.warn('[step2] ohsorry-shelf.js 로드 실패 (무시 가능):', e.message);
  }

  // -------- 1. 곡명 정규화 + 인덱싱 --------
  const norm = (s) => (s || '')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[~∼〜～]/g, '~')
    .replace(/[!！]/g, '!')
    .replace(/[?？]/g, '?')
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')')
    // 더블 쿼터 종류 → ASCII " (좌우 / 일본식 / 독일)
    .replace(/[“”„‟〝〞〟]/g, '"')
    // 싱글 쿼터 종류 → ASCII ' (좌우 / backtick / acute / modifier)
    .replace(/[‘’‚‛`´ʼˈˊˋ]/g, "'")
    // 라틴 확장
    .replace(/ƒ/g, 'f')
    .replace(/[Øø]/g, 'o')
    .replace(/[Ææ]/g, 'ae')
    .replace(/ə/g, 'e')
    .replace(/[Œœ]/g, 'oe')
    .replace(/ß/g, 'ss')
    // 키릴 → ASCII (homoglyph 케이스)
    .replace(/[Ии]/g, 'n')
    .replace(/[Аа]/g, 'a')
    .replace(/[Ее]/g, 'e')
    .replace(/[Кк]/g, 'k')
    .replace(/[Мм]/g, 'm')
    .replace(/[Оо]/g, 'o')
    .replace(/[Рр]/g, 'p')
    .replace(/[Сс]/g, 'c')
    .replace(/[Тт]/g, 't')
    .replace(/[Хх]/g, 'x')
    // 대시 변종 → ASCII '-' (가타카나 장음 ー U+30FC 는 제외)
    .replace(/[—–‐‑−]/g, '-')
    // 장식 기호 / 음악 / 수학 기호 제거
    .replace(/[♠-♯]/g, '')
    .replace(/[†‡]/g, '')
    .replace(/[→←↑↓]/g, '')
    .replace(/[※⁂]/g, '')
    .replace(/[★☆]/g, '')
    .replace(/[∫∮∂∇∈∞]/g, '')
    // diacritic 분해 후 라틴 결합 마크만 제거 (Ü → u, ê → e). 일본어 탁점은 보존.
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .normalize('NFKC');

  const ereterMap = new Map();
  for (const c of ereterData) {
    if (!c.title || !c.diff) continue;
    ereterMap.set(norm(c.title) + '|' + c.diff, c);
  }

  // zasa 차트 인덱스 (ereter 와 같은 키 형식)
  const zasaMap = new Map();
  for (const c of zasaData) {
    if (!c.title || !c.diff) continue;
    zasaMap.set(norm(c.title) + '|' + c.diff, c);
  }
  // ohSorry 추정 차트 인덱스 (ereter 와 같은 키 형식, ec/hc 만 — exh 추정 X)
  // ★ 추정 모델 (fitData) 의 fallback 으로만 사용. 다른 로직 영향 X.
  const ratingMap = new Map();
  for (const r of ohSorryRatings) {
    if (!r.title || !r.diff) continue;
    if (typeof r.estEc !== 'number' && typeof r.estHc !== 'number') continue;
    ratingMap.set(norm(r.title) + '|' + r.diff, r);
  }

  // ereter 에 없는 zasa 전용 차트 (★ 단위별 표의 곡 수 보강용)
  const zasaSupplemental = zasaData.filter((c) => {
    const k = norm(c.title) + '|' + c.diff;
    return !ereterMap.has(k);
  });
  if (zasaSupplemental.length > 0) {
    console.log(`[step2] zasa 보충 (ereter 미등록): ${zasaSupplemental.length}곡`);
  }

  // -------- 2. 대상 페이지 설정 (LEVEL 12 + LEVEL 11 / DP) --------
  // p.eagate.573.jp 도메인 안 어느 페이지에서나 실행 가능하도록
  // difficulty.html 의 LEVEL 12 → LEVEL 11 순차 fetch.
  //   difficult: 0~11 (0-indexed, 11=LEVEL 12, 10=LEVEL 11)
  //   style:     0=SP, 1=DP
  // LEVEL 11 도 가져오는 이유: zasa★ 11.6~12.1 인 어려운 lv11 차트의 lamp 데이터를
  //                          ohSorryRating fallback 으로 ★ 추정 / EC·HC 추천에 활용.
  const SERIES = '33';            // 현재 시즌 (Sparkle Shower)
  const style = '1';              // DP
  const disp = '1';
  // 가져올 레벨 목록 (LEVEL 12 → LEVEL 11 순서)
  const LEVELS_TO_FETCH = [
    { difficult: '11', label: 12 },  // LEVEL 12
    { difficult: '10', label: 11 },  // LEVEL 11 (zasa★ 11.6+ 만 추정에 활용됨)
  ];
  const BASE_URL = `https://p.eagate.573.jp/game/2dx/33/djdata/music/difficulty.html`;
  // 호환성을 위해 currentURL 도 만들어둠 (이전 코드와 동일한 변수 이름 사용)
  const currentURL = new URL(BASE_URL);
  // 기존 로그 / UI 용 — 첫 (LEVEL 12) label
  const levelText = LEVELS_TO_FETCH[0].label;

  // 도메인 체크 (잘못된 사이트에서 실행하면 의미 없으니 안내)
  // DB 모드 (dbData 주어짐) 에서는 eagate fetch 를 안 하므로 도메인 체크 스킵
  if (!dbData && !location.hostname.endsWith('p.eagate.573.jp')) {
    alert(
      'p.eagate.573.jp 도메인에서 실행해야 합니다.\n' +
      '먼저 https://p.eagate.573.jp 의 아무 페이지나 열어서 로그인 후, 그 페이지의 콘솔에서 실행하세요.'
    );
    return;
  }

  console.log(`[step2] LEVEL ${LEVELS_TO_FETCH.map(l => l.label).join(' + ')} / ${style === '1' ? 'DP' : 'SP'} 시작`);

  // -------- 3. 페이지 한 장 파싱 --------
  const LAMP_NAMES = {
    0: 'NO PLAY', 1: 'FAILED',  2: 'ASSIST',    3: 'EASY',
    4: 'CLEAR',   5: 'HARD',    6: 'EX HARD',   7: 'FULL COMBO',
  };

  const parseDoc = (doc) => {
    const out = { charts: [], hasNext: false };
    // 곡 목록은 <div class="series-difficulty"> 안의 table
    const rows = doc.querySelectorAll('div.series-difficulty table tr');
    rows.forEach(row => {
      const tds = row.querySelectorAll('td');
      if (tds.length !== 5) return;  // 5개 td 인 곡 row 만
      const titleEl = tds[0].querySelector('a.music_info');
      if (!titleEl) return;
      const title = titleEl.textContent.trim();
      const chartType = tds[1].textContent.trim();
      // DJ LEVEL 이미지 (AAA/AA/A/B/C/D/E/F)
      const djLevelImg = tds[2].querySelector('img');
      let djLevel = null;
      if (djLevelImg) {
        const dm = (djLevelImg.getAttribute('src') || djLevelImg.src || '').match(/\/([A-F]+)\.gif/);
        if (dm) djLevel = dm[1];
      }
      // EX 점수 + Pgreat/Great
      const scoreText = tds[3].textContent.trim();
      const scoreMatch = scoreText.match(/^(\d+)\((\d+)\/(\d+)\)/);
      let exScore = 0, pgreat = 0, great = 0;
      if (scoreMatch) {
        exScore = parseInt(scoreMatch[1], 10);
        pgreat = parseInt(scoreMatch[2], 10);
        great = parseInt(scoreMatch[3], 10);
      } else {
        const m2 = scoreText.match(/^(\d+)/);
        if (m2) exScore = parseInt(m2[1], 10);
      }
      // 미스 카운트 (BP/MISS) — score cell 의 추가 텍스트 또는 다른 td 어디에 있을 수도 있음
      let missCount = null;
      const allText = Array.from(tds).map(td => td.textContent || '').join(' ');
      const missMatch = allText.match(/(?:BP|MISS|BAD)[:\s]*(\d+)/i);
      if (missMatch) missCount = parseInt(missMatch[1], 10);
      // 클리어 램프
      const lampImg = tds[4].querySelector('img');
      if (!lampImg) return;
      const m = (lampImg.getAttribute('src') || lampImg.src || '').match(/clflg(\d+)\.gif/);
      if (!m) return;
      const lampNum = parseInt(m[1], 10);
      out.charts.push({
        title, diff: chartType,
        lampNum, lamp: LAMP_NAMES[lampNum] || `?${lampNum}`,
        exScore, pgreat, great, djLevel, missCount,
      });
    });
    // 다음 페이지가 있는지: <div class="navi-next"> a 가 존재하면 있음
    out.hasNext = !!doc.querySelector('div.next-prev div.navi-next a');
    return out;
  };

  // -------- 4. offset=0,50,100,... 순회 (LEVEL 별로) --------
  let allCharts = [];
  const STEP = 50;
  const MAX_PAGES = 30;  // 무한 루프 방어
  // 사람이 페이지 넘기는 속도와 비슷하게: 페이지마다 3~6초 사이 랜덤 대기
  const DELAY_MIN_MS = 600;
  const DELAY_MAX_MS = 1800;
  const randomDelay = () => DELAY_MIN_MS + Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS);
  let pageCount = 0;

  // DB 모드 — charts_json 으로 allCharts 를 바로 채우고 아래 eagate fetch 블록은 전부 스킵.
  // deep copy — 외부 lib / 본체가 차트 객체를 in-place 가공하므로 호출자 원본 (서열표 등) 오염 방지.
  if (dbData) {
    allCharts = Array.isArray(dbData.charts_json) ? JSON.parse(JSON.stringify(dbData.charts_json)) : [];
    console.log(`[오소리] DB 모드 — charts_json ${allCharts.length}곡 (eagate fetch 스킵)`);
    if (allCharts.length === 0) {
      alert('DB 데이터에 charts_json 이 없습니다.');
      return;
    }
  }

  // 진행 상황을 화면에 표시 (긴 대기 시간 동안 사용자가 진행도 볼 수 있게) — eagate 모드만
  if (!dbData) {
  document.getElementById('__dp_progress')?.remove();
  const progress = document.createElement('div');
  progress.id = '__dp_progress';
  progress.style.cssText = `
    position: fixed; top: 16px; right: 16px; z-index: 999999;
    width: 360px; background: #fff; color: #222;
    font-family: -apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif;
    font-size: 13px; line-height: 1.5;
    border: 1px solid #ccc; border-radius: 8px;
    box-shadow: 0 6px 24px rgba(0,0,0,.18); padding: 14px 16px;
  `;
  progress.innerHTML = `
    <div style="font-weight:600;margin-bottom:6px">DP 점수 계산 중...</div>
    <div id="__dp_progress_text" style="font-size:12px;color:#666">시작합니다</div>
    <div style="background:#eee;height:6px;border-radius:3px;margin-top:8px;overflow:hidden">
      <div id="__dp_progress_bar" style="background:#1d9e75;height:100%;width:0%;transition:width .3s"></div>
    </div>
  `;
  document.body.appendChild(progress);
  }
  const updateProgress = (text, pct) => {
    const t = document.getElementById('__dp_progress_text');
    const b = document.getElementById('__dp_progress_bar');
    if (t) t.textContent = text;
    if (b) b.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  };

  // 한 LEVEL 의 전 페이지를 fetch 해서 charts 를 allCharts 에 push.
  // 실패 시 false 반환 (로그인 만료 등) — 호출자가 중단 처리.
  const fetchOneLevel = async (lvDifficult, lvLabel, basePctStart, basePctEnd) => {
    let lvOffset = 0;
    let lvPageCount = 0;
    const lvSpan = basePctEnd - basePctStart;
    const pctOf = (frac) => Math.min(basePctEnd, basePctStart + lvSpan * Math.max(0, Math.min(1, frac)));

    // 첫 페이지 (offset=0)
    updateProgress(`LEVEL ${lvLabel} page 1 (offset=0) 요청 중...`, pctOf(0.02));
    let firstParse;
    try {
      const firstUrl = `${BASE_URL}?difficult=${lvDifficult}&style=${style}&disp=${disp}&offset=0`;
      const res = await fetch(firstUrl, { credentials: 'include' });
      if (!res.ok) {
        console.error(`[step2] LEVEL ${lvLabel} 첫 페이지 fetch 실패: HTTP ${res.status}`);
        updateProgress(`LEVEL ${lvLabel} 첫 페이지 HTTP ${res.status} 에러`, pctOf(1));
        alert(
          `LEVEL ${lvLabel} 첫 페이지를 가져오지 못했어요 (HTTP ${res.status}).\n로그인 상태인지 확인해주세요.`,
        );
        return false;
      }
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      firstParse = parseDoc(doc);
    } catch (e) {
      console.error(`[step2] LEVEL ${lvLabel} 첫 페이지 fetch 실패:`, e);
      updateProgress(`LEVEL ${lvLabel} 첫 페이지 fetch 실패: ${e.message}`, pctOf(1));
      alert(`LEVEL ${lvLabel} 첫 페이지 fetch 실패: ${e.message}`);
      return false;
    }
    firstParse.charts.forEach((c) => { c.gameLevel = lvLabel; });
    allCharts.push(...firstParse.charts);
    lvPageCount++;
    pageCount++;
    console.log(`[step2] LEVEL ${lvLabel} page ${lvPageCount} (offset=0): ${firstParse.charts.length}곡`);
    updateProgress(`LEVEL ${lvLabel} page ${lvPageCount} (offset=0): ${firstParse.charts.length}곡`, pctOf(0.08));
    if (firstParse.charts.length === 0) {
      // LEVEL 12 의 첫 페이지가 비어있으면 로그인 / 페이지 구조 의심
      if (lvLabel === LEVELS_TO_FETCH[0].label) {
        alert('첫 페이지에서 곡을 못 찾았어요. 로그인 상태가 아니거나 페이지 구조가 변경됐을 수 있습니다.');
        return false;
      }
      // LEVEL 11 등 추가 fetch 의 첫 페이지가 비면 그냥 skip
      console.log(`[step2] LEVEL ${lvLabel} 데이터 없음 — skip`);
      return true;
    }
    let hasNext = firstParse.hasNext;
    lvOffset = STEP;

    while (hasNext && lvPageCount < MAX_PAGES) {
      // 사람처럼 페이지 사이에 대기 (요청 보내기 전에)
      const wait = Math.round(randomDelay());
      const waitStartTs = Date.now();
      while (Date.now() - waitStartTs < wait) {
        const remain = Math.ceil((wait - (Date.now() - waitStartTs)) / 1000);
        updateProgress(
          `LEVEL ${lvLabel} page ${lvPageCount + 1} (offset=${lvOffset}) 다음 요청까지 ${remain}초...`,
          pctOf(lvPageCount / MAX_PAGES),
        );
        await new Promise((r) => setTimeout(r, 250));
      }

      const url = `${currentURL.origin}${currentURL.pathname}?difficult=${lvDifficult}&style=${style}&disp=${disp}&offset=${lvOffset}`;
      try {
        updateProgress(
          `LEVEL ${lvLabel} page ${lvPageCount + 1} (offset=${lvOffset}) 요청 중...`,
          pctOf((lvPageCount + 0.5) / MAX_PAGES),
        );
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) {
          console.warn(`[step2] LEVEL ${lvLabel} HTTP ${res.status} at offset=${lvOffset}, 중단`);
          updateProgress(`LEVEL ${lvLabel} HTTP ${res.status} 에러로 중단`, pctOf(1));
          break;
        }
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const parsed = parseDoc(doc);
        parsed.charts.forEach((c) => { c.gameLevel = lvLabel; });
        allCharts.push(...parsed.charts);
        lvPageCount++;
        pageCount++;
        console.log(`[step2] LEVEL ${lvLabel} page ${lvPageCount} (offset=${lvOffset}): ${parsed.charts.length}곡`);
        updateProgress(
          `LEVEL ${lvLabel} page ${lvPageCount} (offset=${lvOffset}): ${parsed.charts.length}곡 (총 ${allCharts.length}곡)`,
          pctOf((lvPageCount + 1) / MAX_PAGES),
        );
        if (parsed.charts.length === 0) break;
        hasNext = parsed.hasNext;
        lvOffset += STEP;
      } catch (e) {
        console.error(`[step2] LEVEL ${lvLabel} fetch 실패 at offset=${lvOffset}:`, e);
        updateProgress(`LEVEL ${lvLabel} fetch 실패: ${e.message}`, pctOf(1));
        break;
      }
    }
    console.log(`[step2] LEVEL ${lvLabel} 완료: ${lvPageCount}페이지`);
    return true;
  };

  // 각 LEVEL 순차 실행 — 진행도 0~95% 까지 균등 분할 (eagate 모드만)
  if (!dbData) {
  const SPAN = 95 / LEVELS_TO_FETCH.length;
  for (let i = 0; i < LEVELS_TO_FETCH.length; i++) {
    const { difficult: lvD, label: lvL } = LEVELS_TO_FETCH[i];
    const ok = await fetchOneLevel(lvD, lvL, i * SPAN, (i + 1) * SPAN);
    if (!ok) return; // 첫 LEVEL 실패하면 중단
  }
  console.log(`[step2] 전 LEVEL 합산: ${pageCount}페이지 / ${allCharts.length}곡 파싱 완료`);
  updateProgress(`완료! ${pageCount}페이지 ${allCharts.length}곡`, 100);
  // 잠시 후 진행 패널 제거 (점수 패널이 같은 위치에 뜨므로)
  await new Promise(r => setTimeout(r, 500));
  document.getElementById('__dp_progress')?.remove();

  if (allCharts.length === 0) {
    alert('곡을 하나도 못 찾았어요. 페이지 구조가 변경됐을 수 있습니다.');
    return;
  }
  }

  // -------- 4.5. textage 채보 메타로 noteCount 보강 --------
  // textage notes (DN/DH/DA/DX) → noteCount. 이미 있으면 (INF charts) 유지, 없으면 (오소리) textage 로 채움.
  //
  // missCount 는 보강 X — IIDX 판정은 Pgreat/Great/Good/Bad/Poor 이고 MISS COUNT(BP) = Bad+Poor 인데
  // EX 표기 2392(986/420) 에선 Pgreat/Great 만 알 수 있고 Good 을 모름 → BP 계산 불가.
  // (noteCount - pgreat - great = Good+Bad+Poor 라 MISS 가 아님.) EXH 추천은 rate(%) 로 정렬.
  //
  // 매칭 주의:
  //   - textage title 에 HTML 태그 (<font ...>) 가 섞인 곡 多 → norm 전에 태그 제거.
  //   - norm 충돌 (예: "Fly Away" lv8 ↔ "FlyAway" lv12 둘 다 norm "flyaway") → 한 키에 엔트리 배열로
  //     보관하고, 매칭 시 levels[slot] 이 차트 gameLevel 과 일치하는 엔트리를 우선 선택.
  //     (안 그러면 lv12 곡이 lv8 노트수에 매칭돼 rate 가 100% 초과 등 오류)
  if (textageSongs) {
    const stripHtml = (s) => (s || '').replace(/<[^>]*>/g, '');
    // norm(태그제거 title) → [{ notes, levels }, ...]
    const textageMap = {};
    for (const id in textageSongs) {
      const s = textageSongs[id];
      if (!s || !s.notes || !s.title) continue;
      const key = norm(stripHtml(s.title));
      (textageMap[key] = textageMap[key] || []).push({ notes: s.notes, levels: s.levels || {} });
    }
    const DIFF_TO_TEXTAGE = { NORMAL: 'DN', HYPER: 'DH', ANOTHER: 'DA', LEGGENDARIA: 'DX', BEGINNER: 'DB' };
    let filledNote = 0;
    for (const c of allCharts) {
      const entries = textageMap[norm(c.title)];
      if (!entries) continue;
      const tKey = DIFF_TO_TEXTAGE[c.diff];
      if (!tKey) continue;
      // norm 충돌 시 — levels[slot] 이 차트 gameLevel 과 일치하는 엔트리 우선 (없으면 첫 엔트리)
      let chosen = entries[0];
      if (entries.length > 1) {
        chosen = entries.find((e) => e.levels[tKey] === c.gameLevel) || entries[0];
      }
      const nc = chosen.notes[tKey];
      if (typeof nc !== 'number' || nc <= 0) continue;
      if (typeof c.noteCount !== 'number') { c.noteCount = nc; filledNote++; }
    }
    console.log(`[step2] textage 보강 — noteCount ${filledNote}곡`);
  }

  // -------- 5. 매칭 + 점수 계산 --------
  // ereter.net 의 'combined' 분석 페이지와 동일한 방식:
  // 클리어한 모든 단계의 diff 를 합산.
  //   - FULL COMBO (7): EC + HC + EXH (모든 단계 도달)
  //   - EX HARD (6):    EC + HC + EXH (모든 단계 도달)
  //   - HARD (5):       EC + HC       (HARD 까지 도달)
  //   - CLEAR (4):      EC            (EASY 까지)
  //   - EASY (3):       EC            (EASY 까지)
  //   - FAILED/ASSIST/NO PLAY: 0      (어떤 단계도 클리어 못함)
  const lampToScore = (n, ec, hc, exh) => {
    const v = (x) => (typeof x === 'number' ? x : 0);
    if (n >= 6) return v(ec) + v(hc) + v(exh);  // EX HARD / FULL COMBO
    if (n === 5) return v(ec) + v(hc);          // HARD
    if (n >= 3) return v(ec);                   // EASY / CLEAR
    return 0;                                    // FAILED / ASSIST / NO PLAY
  };

  let total = 0, matched = 0, unmatched = 0;
  const perLamp = {}, perLevel = {};
  const details = [];
  const unmatchedSamples = [];
  // ★값 추정용 데이터: (diff, passed) 쌍의 배열
  // 사용자가 시도한 곡(NO PLAY 제외)에 대해 EC/HC/EXH 각 단계마다 한 점씩
  // ASSIST 는 ereter 에서 FAILED 로 처리됨 (모든 단계 fail)
  //
  // v3.3.4: fitData 생성 + runStarModel 호출은 외부 lib (calc-Old-OSR.js / calc-OSRating.js) 안에서 수행.
  // 본체에서는 matched / unmatched / perLamp / details / score 통계만 계산 — 점수 합계 + UI 표시 용도.

  // 모드 결정 — LEVEL 12 플레이 곡 ≥ 30 이면 lv12 only 통계, else lv11+lv12 통합 통계
  const nLv12PlayedAll = allCharts.filter((c) => c.gameLevel === 12 && c.lampNum > 0).length;
  const useOnlyLv12 = nLv12PlayedAll >= 30;
  console.log(
    `[step2] LEVEL 12 플레이 ${nLv12PlayedAll}곡 → ${useOnlyLv12 ? 'lv12 only (이레터 대상곡만)' : 'lv11+lv12 통합'} 통계 모드`,
  );

  for (const c of allCharts) {
    const skipForStats = useOnlyLv12 && c.gameLevel !== 12;
    const e = ereterMap.get(norm(c.title) + '|' + c.diff);
    if (!e) {
      if (!skipForStats) {
        unmatched++;
        if (c.lampNum > 0 && unmatchedSamples.length < 10) {
          unmatchedSamples.push(`${c.title} [${c.diff}] (lamp=${c.lamp})`);
        }
      }
      continue;
    }
    if (!skipForStats) {
      matched++;
      perLamp[c.lamp] = (perLamp[c.lamp] || 0) + 1;
      const score = lampToScore(c.lampNum, e.ec, e.hc, e.exh);
      total += score;
      if (e.level != null) perLevel[e.level] = (perLevel[e.level] || 0) + score;
      if (score > 0) {
        details.push({
          title: c.title, diff: c.diff, level: e.level, lamp: c.lamp,
          ec: e.ec, hc: e.hc, exh: e.exh, score,
        });
      }
    }
  }
  details.sort((a, b) => b.score - a.score);

  console.log(`[step2] 매칭 ${matched} / 미매칭 ${unmatched} / 총점 ${total.toFixed(2)}`);
  if (unmatchedSamples.length > 0) {
    console.log('미매칭된 곡 (플레이 흔적 있는 것 중):');
    unmatchedSamples.forEach(s => console.log('  -', s));
  }

  // -------- 5.5. ★값 추정 (v3.3.5) --------
  // v3.3.5 변경 (분기 D2):
  //   - OSR13.5+.js 추가, OSR135 ≥ 13.0 → OSR135 / else → OSR / fallback → oldOSR
  //   - max(oldOSR, OSR) ensemble 폐기, oldOSR 는 fallback 으로만 유지
  //   - 1021명 검증: 전체 MAE 0.398 → 0.363, max|err| 6.989 → 4.264, bias +0.192 → +0.016
  //   - (표기 변경) group C (12.0+ 클리어 ≥ 30) + OSR135 < 13.0 영역만 oldOSR 로 표기. group A/B (저클리어) 는 OSR 유지. 내부 starEstimateNew 는 추천 풀 baseStar 용으로 유지.
  // v3.3.4 변경:
  //   - 상세통계 패널 UX 정리: 난이도 선택 토글 (Lv12 / Lv11+) 추가
  //     · DOM in-place 갱신 → details 펼침/닫힘 상태 보존
  //     · 난이도별 stacked bar 의 zasa★ levels 동적 (실제 데이터 있는 11.6/11.8/12.0~12.7)
  //     · "★ 추정 비교 · 곡 정보" 와 토글이 같은 row 좌/우 배치
  //   - 모델 자체 변경 X (v3.3.3 그대로)
  // v3.3.3 변경:
  //   - 4종 fitData 동시 수집 + 모델 함수 분리 (runStarModel)
  //     · 이레터넷만 / lv12-only / 11.6+ 전체 / primary (useOnlyLv12 분기 결과)
  //     · 4개 결과 중 max 채택 → 저렙 fallback (★0.01) 자동 보완
  //   - 상세 통계 패널에 ★ 추정 비교 표시 (곡 정보 토글 안)
  //   - lv12 ratingMap fallback 차트 곡명 하늘색 / lv11 진한 연두색 (#9ccc65)
  //   - 추천 풀 lv11+lv12 전곡으로 확장 (zasa < 11.6 lv11 lower-tier 포함)
  //   - EC 정리곡: HC < baseStar - 3 미만 곡 제외 (시간 낭비 방지)
  //   - bug fix: runStarModel 내부 closure 변수 fitData → fit (4 호출 모두 동일 데이터로 돌던 문제)
  // v3.3.2 변경:
  //   - EC-only 사용자 (HC/EXH 클리어 < 10) 에 raw + max_clear 기반 선형 보정 추가
  //     · 16명 EC-only 샘플 fit: true ≈ -0.158 + 0.761*raw_s + 0.250*fEc.max_clear
  //     · MAE 0.637 → 0.374 (41% 감소), 11명 개선 / 3명 작은 악화
  //     · 이레터★ 유무 무관 적용
  // v3.3.1 변경:
  //   - ohSorryRating.json (lv11/12 미등록 차트 추정) 통합 — fitData fallback + EC/HC 추천 풀 포함
  //   - 추정 하한 0.5 → 0.01 (LOW_FALLBACK + RAW_BOUNDS)
  //   - lv11 추정 차트 추천 시 곡명 연한 연두색 표시
  //
  // v3.2.10 변경 (★값 추정 모델 자체는 v3.2.9 그대로):
  //   - 추천곡 challenge offset 동적화: ★0.5 → +1.2, ★14.0 → +0.3 선형 보간
  //   - 6:4 비율 고정 (저레벨 3:7 분기 제거)
  //   - 풀 샘플 10+10=20 → picked 10 (한 쪽 부족 시 다른 쪽에서 보충)
  //
  // v3.2.9 모델: v3.2.7 + 4단계 진입 시 bin 보너스 활성 + ridge 음수 → ridge 0 처리
  //   - 86명 (n_cleared >= 50) 학습 (LOOCV 기준)
  //   - mean abs err: 0.1696 ★ (v3.2.7 의 0.1722 → 1.5% 개선, v3.2.1 대비 14.7%)
  //   - median:       0.1240 ★
  //   - max:          1.2657 ★
  //   - RMSE:         0.2517 ★
  //   - ≤0.10 ★: 35/86 (40.7%)
  //   - ≤0.30 ★: 76/86 (88.4%)
  //
  // 1단계: v3.1.1 의 logistic raw_s (HC × 2 + golden-section)
  //
  // 2단계: 36-feature Ridge 회귀 (α=5.0) — v3.2.1 그대로
  //   - v3.1.1 의 29 feature (raw_s, raw_s², 21 base, 8 AC/FC)
  //   - v3.2 추가 7 feature:
  //     · M: 사용자 도달 stage 의 max ★
  //     · M_top10_avg: top 1~10 cleared 평균 (robust estimator)
  //     · gap_top10: M - top10 (M 이 outlier 인지 신호)
  //     · gap × is_ec/hc/exh: M 의 stage 별 차등 페널티
  //     · prob_sum: S_hat=M_top10_avg 기준 sigmoid prob > 0.99 제외 failed 페널티
  //
  // 4단계 (v3.2.4 + v3.2.7 + v3.2.9): bin clear-rate 누적 post-correction
  //   stage 별 0.1 단위 bin 으로 곡 분류 (NO PLAY 제외, 분모는 시도한 곡만)
  //   rate ≥ 80% 인정, rateW = (rate - 0.8) / 0.2 [linear, 80~100% → 0~1]
  //   MIN_SAMPLES 차등 (EC=4/HC=3/EXH=2)
  //   eligible bin top 3 의 bonus 누적: top1 ×1.0 / top2 ×0.5 / top3 ×0.25, 각 bin × rateW
  //   bonus 차등: EC=0.05 / HC=0.10 / EXH=0.15 (어려운 stage 일수록 강한 신호)
  //   stage 별 implied = top1.bin_start + 누적_bonus → max(EC,HC,EXH) 채택
  //   단방향: implied > pred 일 때만 보너스 적용 (final = pred + diff × 0.7)
  //
  //   v3.2.9: bin 보너스 활성 (implied > raw_s + ridge) AND ridge < 0 일 때
  //     → ridge 의 음수 (페널티) 부분 무시 (RAY 같이 ridge 가 잘못 페널티 준 경우)
  //     → final pred = raw_s + 0 + post + djBoost
  //
  // 5단계 (v3.2.6): djLevel boost
  //   조건: M lamp = EC (3 또는 4) + djLevel(M 곡) ≥ A + raw_s ≥ 3
  //   gap (M - rawS) 곡률 with cutoff: gap < 2.5 → 0, gap ≥ 4.0 → 1, 사이 linear
  //   단방향: M > pred 일 때만 → final = pred + (M - pred) × 0.7 × curveW
  //   POCHI 처럼 lamp 약하지만 max clear 곡 점수 좋은 사용자 보정 (1명 영향, collateral 0)
  //
  // cutoff: n_cleared >= 50 (실전 평가에서 미달 시 v3.1.1 fallback)
  //
  // v3.3.4: ★ 추정 모델 (runStarModel) 은 외부 lib (calc-Old-OSR.js, calc-OSRating.js) 으로 분리됨.
  //   본체에는 stub 만 — 아래 dead code 는 일괄 제거. 외부 lib fetch + ensemble 흐름은 step2 끝에서 처리.

  // ----- v3.3.5: 외부 lib 3종 (oldOSR + OSR + OSR135) 분기 채택 -----
  //   oldOSR (v3.3.3): runStarModel — fallback 용 (OSR 실패 시)
  //   OSR (v0.0.2):    IRT + ridge OLS 기반 user★ 추정 (ereter scale) — 13 미만 영역 메인
  //   OSR135 (v0.0.2): bin50 + 50% 임계 + 상향 bin 부분 보너스 — 13+ 영역 메인 (14+ MAE 0.014)
  //   분기 (D2): OSR135 ≥ 13.0 → OSR135 / else → OSR / 둘 다 없으면 oldOSR
  let starEstimate = null;
  let starRaw = null;
  let starEstimateOld = null;
  let starEstimateNew = null;
  // 4종 모드별 비교용 (상세통계 패널에 작은 텍스트 표시 유지)
  let starEstimateEreterOnly = null;
  let starEstimateLv12Only = null;
  let starEstimateAll = null;
  // INF DB 데이터 판별 — INFOhSorry 가 series:'INF' / version:'INFv...' 로 업로드함
  const isInfData = !!dbData && (dbData.series === 'INF' ||
    (typeof dbData.version === 'string' && dbData.version.indexOf('INF') === 0));
  if (isInfData) {
    // INF DB — INFOhSorry 가 이미 추정한 ★ 를 그대로 사용 (오소리 ★ 모델 재실행 X).
    // INF 와 오소리(아케이드) 는 게임이 달라 오소리 모델을 INF lamp 에 돌리는 건 의미 없음.
    starEstimate = typeof dbData.star_estimate === 'number' ? dbData.star_estimate : null;
    starRaw = typeof dbData.raw_s === 'number' ? dbData.raw_s : null;
    starEstimateNew = starEstimate;  // 추천 풀 baseStar (ohsorryRecBase) 용
    console.log(`[오소리] INF DB 데이터 — ★ 모델 스킵, INF 추정값 ★${starEstimate != null ? starEstimate.toFixed(2) : 'N/A'} 그대로 사용`);
  } else {
  if (oldOSR && ratingData && Array.isArray(ereterData) && ereterData.length > 0) {
    try {
      const ereterPayload = { charts: ereterData, players: ereterPlayers || {} };
      const r = oldOSR.inferUser(allCharts, ratingData, ereterPayload);
      starEstimateOld = r.starEstimate;
      starRaw = r.starRaw;
      starEstimateEreterOnly = r.starEstimates?.ereterOnly ?? null;
      starEstimateLv12Only = r.starEstimates?.lv12Only ?? null;
      starEstimateAll = r.starEstimates?.all ?? null;
      console.log(`[step2] oldOSR (v3.3.3): ★${starEstimateOld != null ? starEstimateOld.toFixed(2) : 'N/A'} (raw=${starRaw != null ? starRaw.toFixed(2) : 'N/A'}, adopted=${r.adopted}, n=${r.fitLen}, lamps=${r.validStages.join('/')})`);
    } catch (e) {
      console.error('[step2] oldOSR.inferUser 실패:', e.message);
    }
  }
  let osrGroup = null;  // tiered 그룹 (A/B/C) — 표기 분기에서 사용
  if (ohSorryRatingLib && ratingData) {
    try {
      // v3.3.4: tiered 사용 (그룹별 scope + B 보정) — lib 에 inferUserTiered 가 있으면 사용
      const useTiered = typeof ohSorryRatingLib.inferUserTiered === 'function';
      const r = useTiered ? ohSorryRatingLib.inferUserTiered(allCharts, ratingData) : ohSorryRatingLib.inferUser(allCharts, ratingData);
      starEstimateNew = typeof r.ereterCompatStar === 'number' ? r.ereterCompatStar : null;
      osrGroup = r.group || null;
      const tieredInfo = useTiered && r.group ? ` [tiered:${r.group} lv12cl=${r.nLv12Cleared} z12cl=${r.nZ12_0upCleared} corr=${r.bandCorrection >= 0 ? '+' : ''}${r.bandCorrection?.toFixed(3) ?? 0}]` : '';
      console.log(`[step2] OSR (v0.0.2${useTiered ? ' tiered' : ''}): ★${starEstimateNew != null ? starEstimateNew.toFixed(2) : 'N/A'}${tieredInfo} (native=${typeof r.nativeStar === 'number' ? r.nativeStar.toFixed(2) : 'N/A'}, n_enriched=${r.nEnriched || 0})`);
    } catch (e) {
      console.error('[step2] ohSorryRating.inferUser 실패:', e.message);
    }
  }
  // v3.3.5: OSR13.5+ 계산 — OSR >= 13.5 + OSR135 >= 13.5 면 오버라이드, 아니면 oldOSR
  let starEstimate135 = null;
  let osr135Meta = null;  // { ec, hc, exh } — spread gate 용 (세 분기 일관성 판정)
  if (osr135Lib && ereterData && Array.isArray(ereterData) && ereterData.length > 0) {
    try {
      const r135 = osr135Lib.inferUser(allCharts, { charts: ereterData });
      starEstimate135 = r135.starEstimate;
      osr135Meta = { ec: r135.ec.final, hc: r135.hc.final, exh: r135.exh.final };
      console.log(`[step2] OSR13.5+ (v${osr135Lib.version}): ★${starEstimate135 != null ? starEstimate135.toFixed(2) : 'N/A'} (adopted=${r135.adopted}, EC=${r135.ec.final.toFixed(2)}, HC=${r135.hc.final.toFixed(2)}, EXH=${r135.exh.final.toFixed(2)})`);
    } catch (e) {
      console.error('[step2] OSR13.5+.inferUser 실패:', e.message);
    }
  }

  // group C 인 경우 oldOSR 의 4종 max 에서 all-11.6+ scope 제외 — ereterOnly / lv12Only 중 max 로 재계산
  //   이유: group C (12.0+ 클리어 ≥ 30) 고수는 ratingMap 의 lv11 추정곡 보강이 오히려 잡음
  //   group C 면 useOnlyLv12=true 보장 (12.0+ 클리어 30+ → lv12 플레이 30+) → primary === lv12Only 라 추가 채택 불필요
  if (osrGroup === 'C' && (starEstimateEreterOnly != null || starEstimateLv12Only != null)) {
    const cands = [starEstimateEreterOnly, starEstimateLv12Only].filter(x => typeof x === 'number');
    const newOldStar = Math.max(...cands);
    console.log(`[step2] group C → oldOSR all-11.6+ 제외, max(ereter=${starEstimateEreterOnly?.toFixed(2) ?? 'N/A'}, lv12=${starEstimateLv12Only?.toFixed(2) ?? 'N/A'}) = ${newOldStar.toFixed(2)} (기존 4종 max ${starEstimateOld?.toFixed(2) ?? 'N/A'})`);
    starEstimateOld = newOldStar;
  }

  // 채택 로직 (v335E — 1021명 검증 통과) — D3 분기 + spread gate:
  //   [신뢰도 게이트] OSR135 세 분기(EC/HC/EXH) 중 0(데이터 없음) 제외, max-min spread > 2.5 면
  //                  OSR135 내부 불일치 → 신뢰 X → baseStar2 직행
  //   spread ≤ 2.5 일 때만 OSR135 사용:
  //     ≥13.5            → OSR135 직행 (14+ 정확도 핵심)
  //     12.5 ≤ x < 13.5  → 블렌드 구간:
  //         osr > osr135 → OSR135 직행 (블렌드가 위로 끌어올림 방지)
  //         diffBlend = baseStar2 ↔ osr135 (osr135 위치로 12.5~13.5 선형)
  //         gapW = clamp((osr135 - osr) / 3) — gap 작으면 diffBlend, 크면 (osr 망가짐) osr135 직행
  //         최종 = diffBlend × (1-gapW) + osr135 × gapW
  //     < 12.5           → baseStar2
  //   group 별 base 값 (baseStar2):
  //     group A·B → OSR  (없으면 oldOSR fallback)
  //     group C   → OSR값 ≥ 11.0 → OSR / < 11.0 → oldOSR / 10.5~11.0 보간
  // 내부 계산용 starEstimateNew (OSR) 는 그대로 유지 — 추천 풀 baseStar (ohsorryRecBase) 에서 사용
  const OSR135_TH = 13.5;       // OSR135 직행 하한
  const BLEND_W = 1.0;          // 12.5~13.5 블렌드 폭
  const GAP_GUARD = 3.0;        // OSR135-OSR gap (osr 망가짐 판정)
  const SPREAD_MAX = 2.5;       // OSR135 세 분기 spread 신뢰 상한
  const isAB135 = osrGroup === 'A' || osrGroup === 'B';
  // group 별 base 값 (baseStar2) + 로그 라벨 (groupLib)
  let baseStar2, groupLib;
  if (isAB135) {
    baseStar2 = starEstimateNew != null ? starEstimateNew : starEstimateOld;
    groupLib = starEstimateNew != null ? 'OSR' : 'oldOSR(fb)';
  } else {
    // group C: 11~13 은 OSR 가 최강 → OSR값 ≥ 11.0 → OSR / < 11.0 → oldOSR / 10.5~11.0 보간
    const C_TH = 11.0, C_W = 0.5;
    if (starEstimateNew != null && starEstimateNew >= C_TH) {
      baseStar2 = starEstimateNew; groupLib = 'OSR(C)';
    } else if (starEstimateNew != null && starEstimateNew >= C_TH - C_W && starEstimateOld != null) {
      const ct = (starEstimateNew - (C_TH - C_W)) / C_W;
      baseStar2 = starEstimateOld * (1 - ct) + starEstimateNew * ct;
      groupLib = 'OSR↔oldOSR(C)';
    } else if (starEstimateOld != null) {
      baseStar2 = starEstimateOld; groupLib = 'oldOSR(C)';
    } else {
      baseStar2 = starEstimateNew; groupLib = 'OSR(C,fb)';
    }
  }
  // OSR135 신뢰도 게이트 — 세 분기 spread > 2.5 면 OSR135 안 씀
  let osr135Trusted = true;
  if (osr135Meta) {
    const stages = [osr135Meta.ec, osr135Meta.hc, osr135Meta.exh].filter((v) => typeof v === 'number' && v > 0.01);
    if (stages.length >= 2 && (Math.max(...stages) - Math.min(...stages)) > SPREAD_MAX) osr135Trusted = false;
  }
  // 채택 분기 (v335E 와 동일)
  if (starEstimate135 == null) {
    starEstimate = baseStar2;
    if (baseStar2 != null) console.log(`[step2] ★ = ${groupLib} ${starEstimate.toFixed(2)} (group ${osrGroup}, OSR135 결과 없음)`);
    else console.error('[step2] 모든 lib 실패 — ★ 추정 불가. lib fetch + localStorage 캐시 모두 실패 가능성');
  } else if (!osr135Trusted) {
    starEstimate = baseStar2 != null ? baseStar2 : starEstimate135;
    const lib = baseStar2 != null ? groupLib : 'OSR13.5+(fb)';
    console.log(`[step2] ★ = ${lib} ${starEstimate.toFixed(2)} (OSR135 spread > ${SPREAD_MAX} → 불신, 세 분기 ${osr135Meta.ec.toFixed(2)}/${osr135Meta.hc.toFixed(2)}/${osr135Meta.exh.toFixed(2)})`);
  } else if (starEstimate135 >= OSR135_TH) {
    starEstimate = starEstimate135;
    console.log(`[step2] ★ = OSR13.5+ ${starEstimate.toFixed(2)} (≥ ${OSR135_TH})`);
  } else if (starEstimate135 < OSR135_TH - BLEND_W || baseStar2 == null) {
    starEstimate = baseStar2 != null ? baseStar2 : starEstimate135;
    const lib = baseStar2 != null ? groupLib : 'OSR13.5+(fb)';
    const reason = baseStar2 != null ? `OSR135 ${starEstimate135.toFixed(2)} < ${OSR135_TH - BLEND_W}` : 'group lib 없음';
    console.log(`[step2] ★ = ${lib} ${starEstimate.toFixed(2)} (${reason})`);
  } else if (starEstimateNew != null && starEstimateNew > starEstimate135) {
    starEstimate = starEstimate135;
    console.log(`[step2] ★ = OSR13.5+ ${starEstimate.toFixed(2)} (osr ${starEstimateNew.toFixed(2)} > osr135 → 직행)`);
  } else {
    const t = (starEstimate135 - (OSR135_TH - BLEND_W)) / BLEND_W;
    const diffBlend = baseStar2 * (1 - t) + starEstimate135 * t;
    if (starEstimateNew == null) {
      starEstimate = diffBlend;
      console.log(`[step2] ★ = diffBlend ${starEstimate.toFixed(2)} (OSR135 ${starEstimate135.toFixed(2)} ↔ ${groupLib} ${baseStar2.toFixed(2)}, t=${t.toFixed(2)})`);
    } else {
      const gapW = Math.max(0, Math.min((starEstimate135 - starEstimateNew) / GAP_GUARD, 1));
      starEstimate = diffBlend * (1 - gapW) + starEstimate135 * gapW;
      console.log(`[step2] ★ = blend ${starEstimate.toFixed(2)} (OSR135 ${starEstimate135.toFixed(2)} ↔ ${groupLib} ${baseStar2.toFixed(2)}, t=${t.toFixed(2)}, gapW=${gapW.toFixed(2)}, group ${osrGroup})`);
    }
  }
  }

  // -------- 5.6. status 페이지에서 프로필 정보 fetch --------
  // 쿠프로(クプロ) 이미지, DJ 이름, IIDX ID, SP/DP 단위(段位), 노트레이더 등
  let profile = null;
  if (dbData) {
    // DB 모드 — supabase row 에서 프로필 구성 (status.html fetch 스킵).
    // 쿠프로 이미지는 DB 에 없음. 노트레이더는 notes_radar 있으면 복원, 없으면 미표시.
    profile = {
      djName: dbData.dj_name || null,
      iidxId: dbData.iidx_id || null,
      spRank: dbData.sp_rank || null,
      dpRank: dbData.dp_rank || null,
    };
    const nr = dbData.notes_radar;
    if (nr && typeof nr === 'object') {
      if (nr.sp && typeof nr.sp === 'object') profile.spRadar = nr.sp;
      if (nr.dp && typeof nr.dp === 'object') profile.dpRadar = nr.dp;
    }
    console.log('[오소리] DB 모드 프로필:', profile);
  } else {
  updateProgress('프로필 정보 fetch 중...', 96);
  try {
    const statusUrl = 'https://p.eagate.573.jp/game/2dx/33/djdata/status.html';
    const res = await fetch(statusUrl, { credentials: 'include' });
    if (res.ok) {
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      profile = {};
      // 쿠프로 이미지 (절대 URL 로 변환)
      const qproImg = doc.querySelector('div.qpro-img img');
      if (qproImg) {
        let src = qproImg.getAttribute('src') || '';
        if (src.startsWith('/')) src = 'https://p.eagate.573.jp' + src;
        else if (!src.startsWith('http')) src = new URL(src, statusUrl).href;
        profile.qproImg = src;
      }
      // DJ 프로필 테이블
      const profileTable = doc.querySelector('div.dj-profile table');
      if (profileTable) {
        profileTable.querySelectorAll('tr').forEach(tr => {
          const tds = tr.querySelectorAll('td');
          if (tds.length === 2) {
            const key = tds[0].textContent.trim();
            const val = tds[1].textContent.trim();
            if (key === 'DJ NAME')        profile.djName = val;
            else if (key === '所属エリア')  profile.area = val;
            else if (key === 'IIDX ID')    profile.iidxId = val;
            else if (key === '所持LIME')   profile.lime = val;
            else if (key === 'プレー回数') profile.playCount = val;
          }
        });
      }
      // 段位 (단위) / ノーツレーダー - dj-rank 영역들 순회
      doc.querySelectorAll('div.dj-rank').forEach(dr => {
        const cn = dr.querySelector('div.cat-name');
        if (!cn) return;
        const catName = cn.textContent.trim();
        if (catName === '段位認定') {
          dr.querySelectorAll('div.rank-cat').forEach(rc => {
            const divs = rc.querySelectorAll('div');
            if (divs.length >= 2) {
              const style = divs[0].textContent.trim();  // 'SP' or 'DP'
              const rank = divs[1].textContent.trim();   // '中伝', '十段', '---' 등
              if (style === 'SP') profile.spRank = rank;
              if (style === 'DP') profile.dpRank = rank;
            }
          });
        } else if (catName === 'ノーツレーダー') {
          dr.querySelectorAll('div.rank-cat').forEach(rc => {
            const style = rc.querySelector('span')?.textContent.trim();
            if (style !== 'SP' && style !== 'DP') return;
            const radar = {};
            // 6각 레이더 이미지 (KONAMI 동적 img_radar.html — relative URL 절대화)
            const img = rc.querySelector('img');
            if (img) {
              let src = img.getAttribute('src') || '';
              if (src.startsWith('/')) src = 'https://p.eagate.573.jp' + src;
              else if (!src.startsWith('http')) src = new URL(src, statusUrl).href;
              radar.img = src;
            }
            // 카테고리별 수치 + 합계
            rc.querySelectorAll('ul li').forEach(li => {
              const ps = li.querySelectorAll('p');
              if (ps.length < 2) return;
              const key = ps[0].textContent.trim();
              const num = parseFloat(ps[1].textContent.trim());
              if (isNaN(num)) return;
              if (key === '合計レーダースコア') radar.total = num;
              else radar[key] = num;  // NOTES / CHORD / PEAK / CHARGE / SCRATCH / SOF-LAN
            });
            if (style === 'SP') profile.spRadar = radar;
            else profile.dpRadar = radar;
          });
        }
      });
      console.log('[step2] 프로필 fetch 완료:', profile);
    } else {
      console.warn(`[step2] 프로필 fetch 실패 HTTP ${res.status}`);
    }
  } catch (e) {
    console.warn('[step2] 프로필 fetch 실패:', e);
  }
  }

  // 레이더 데이터 유효성 — 객체이고 6개 카테고리 중 하나라도 숫자값이 있어야 함.
  // (null / undefined / 빈 객체 {} 면 레이더 영역 자체를 만들지 않음)
  const RADAR_CATS = ['NOTES', 'CHORD', 'PEAK', 'CHARGE', 'SCRATCH', 'SOF-LAN'];
  const hasRadarData = (r) =>
    !!r && typeof r === 'object' &&
    (RADAR_CATS.some((c) => typeof r[c] === 'number') || typeof r.total === 'number');
  const profileHasRadar = !!profile && (hasRadarData(profile.spRadar) || hasRadarData(profile.dpRadar));

  // -------- 5.7. 추천곡 계산 (EC/HC/EXH 3종류) --------
  // 추천곡 기준 ★값: ereter (이레터 원본) / ohsorry (우리 모델 추정) 토글로 선택 가능
  const idNormForRec = profile && profile.iidxId ? profile.iidxId.replace(/-/g, '') : null;
  const eraterTrueStar = (idNormForRec && ereterPlayers) ? ereterPlayers[idNormForRec] : null;

  // EC-only 보정은 runStarModel 함수 내부에서 이미 적용됨 (모든 4종 결과 모두 보정 완료)

  // v3.3.5: D2 의 표기 ★ (starEstimate) 대신 OSR (v0.0.2) 단독값을 추천 baseStar 로 사용
  //   이유: OSR135 의 over-estimation (12점대 +0.46 bias) 을 추천 풀 결정에서 배제
  //   OSR 결과 없으면 starEstimate (D2) 로 fallback
  const ohsorryRecBase = starEstimateNew != null ? starEstimateNew : starEstimate;
  let recBaseMode = eraterTrueStar != null ? 'ereter' : 'ohsorry';
  let recBaseStar = recBaseMode === 'ereter' ? eraterTrueStar : ohsorryRecBase;
  console.log(`[step2] 추천곡 기준: ${recBaseMode} (★${recBaseStar != null ? recBaseStar.toFixed(2) : 'N/A'}, ohsorry=OSR단독 ${ohsorryRecBase != null ? ohsorryRecBase.toFixed(2) : 'N/A'})`);

  const recsEC = [], recsHC = [], recsEXH = [];

  // Fisher-Yates shuffle
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  // 도전곡 최대 offset — baseStar 위로 얼마까지 도전곡 풀에 포함할지.
  //   ★0.5 → +1.0, ★14.0 → +0.3 선형 보간.
  const challengeOffset = (baseStar) => {
    if (baseStar <= 0.5) return 1.0;
    if (baseStar >= 14.0) return 0.3;
    return 1.0 - ((baseStar - 0.5) * 0.7) / 13.5;
  };

  // 3 풀 분리 — stage 별 범위:
  //   HC (기본):
  //     easy = [base, base+0.2], hard = [base+offset-0.3, base+offset], cleanup = [0, base)
  //   EC (살짝 아래로 시프트 — EASY 클리어 부담이 적어 자기 ★ 살짝 아래도 도전 권장):
  //     easy = [base-0.1, base+0.1], hard = [base+offset-0.4, base+offset-0.1], cleanup = [0, base-0.1)
  //   (cleanup 의 상한은 if-else 순서 덕분에 자연스럽게 easy 의 하한까지로 좁혀짐)
  const buildPools = (threshold, getDiffField, baseStar) => {
    const hard = [], easy = [], cleanup = [];
    if (baseStar == null) return { hard, easy, cleanup };
    const offset = challengeOffset(baseStar);
    const isEC = getDiffField === 'ec';
    const hardMax = baseStar + offset - (isEC ? 0.1 : 0);
    const hardMin = baseStar + offset - (isEC ? 0.4 : 0.3);
    const easyMax = baseStar + (isEC ? 0.1 : 0.2);
    const easyMin = baseStar - (isEC ? 0.1 : 0);
    for (const c of allCharts) {
      if (c.lampNum >= threshold) continue;
      let e = ereterMap.get(norm(c.title) + '|' + c.diff);
      let gameLevel = null; // ratingMap fallback 의 게임 LEVEL (11 / 12)
      if (!e || e.level == null) {
        // 추천 풀은 모든 사용자에게 lv11+lv12 전체 (ereter + ratingMap fallback)
        // 이레터★ 유무 / useOnlyLv12 무관 — 추천 다양성 확보
        const r = ratingMap.get(norm(c.title) + '|' + c.diff);
        if (!r || typeof r.zasaLevel !== 'number') continue;
        e = {
          level: r.zasaLevel,
          ec: typeof r.estEc === 'number' ? r.estEc : null,
          hc: typeof r.estHc === 'number' ? r.estHc : null,
          exh: null,
          ec_n: r.nEcCleared || 0,
          hc_n: r.nHcCleared || 0,
          exh_n: 0,
        };
        gameLevel = r.gameLevel ?? null;
      }
      // 추천 풀은 lv11+lv12 전곡 — zasa★ < 11.6 인 lv11 lower-tier 도 포함 (저실력 사용자에게 lv11 추천 보장).
      // 상한 12.7 만 유지 (rating 미래 확장 대비 안전망).
      if (e.level > 12.7) continue;
      const dv = e[getDiffField];
      if (typeof dv !== 'number') continue;
      const item = {
        title: c.title, chart: c.diff, level: e.level,
        ec: e.ec, hc: e.hc, exh: e.exh,
        ec_n: e.ec_n, hc_n: e.hc_n, exh_n: e.exh_n,
        diffValue: dv, currentLamp: c.lamp,
        margin: baseStar - dv,
        gameLevel, // 11 이면 lv11 추정 차트 (ohSorryRating fallback) → UI 에서 색상 구분
      };
      // 하드 우선 (overlap 시 약 도전과 중복 방지)
      if (dv >= hardMin && dv <= hardMax && dv > easyMax) {
        hard.push(item);
      } else if (dv >= easyMin && dv <= easyMax) {
        easy.push(item);
      } else if (dv < baseStar) {
        // EC 정리곡: 하드클 난이도가 baseStar - 3 미만이면 너무 쉬워서 제외 (시간 낭비 방지)
        if (isEC && typeof e.hc === 'number' && e.hc < baseStar - 3) continue;
        cleanup.push(item);
      }
    }
    return { hard, easy, cleanup };
  };

  const buildRecs = (threshold, getDiffField, baseStar) => {
    const { hard, easy, cleanup } = buildPools(threshold, getDiffField, baseStar);
    const countField = getDiffField + '_n';
    const keyOf = r => (r.title || '') + '|' + r.chart;

    // 각 풀 → 카운트 desc top 10 + 그 외 풀에서 순 랜덤 5 = 후보 (최대 15곡)
    const sample15 = (pool) => {
      const sorted = [...pool].sort((a, b) => (b[countField] || 0) - (a[countField] || 0));
      const top10 = sorted.slice(0, 10);
      const usedKeys = new Set(top10.map(keyOf));
      const rest = pool.filter(r => !usedKeys.has(keyOf(r)));
      const rand5 = shuffle(rest).slice(0, 5);
      return [...top10, ...rand5];
    };
    const hardCands = sample15(hard);
    const easyCands = sample15(easy);
    const cleanupCands = sample15(cleanup);

    // 후보 셔플 → N곡 표시 (하드 2 / 약 도전 5 / 정리 3)
    const hardPicked = shuffle(hardCands).slice(0, 2);
    const easyPicked = shuffle(easyCands).slice(0, 5);
    const cleanupPicked = shuffle(cleanupCands).slice(0, 3);

    const used = new Set([...hardPicked, ...easyPicked, ...cleanupPicked].map(keyOf));

    // 한 풀 부족 시 다른 풀 후보에서 보충 (총 10 유지)
    let need = 10 - hardPicked.length - easyPicked.length - cleanupPicked.length;
    let extras = [];
    if (need > 0) {
      const allCands = [...hardCands, ...easyCands, ...cleanupCands];
      const rest = allCands.filter(r => !used.has(keyOf(r)));
      extras = shuffle(rest).slice(0, need);
      extras.forEach(r => used.add(keyOf(r)));
    }

    // 표시 순서: 카테고리 무관, 전체 10곡 ★ asc 통합 정렬
    return [...hardPicked, ...easyPicked, ...cleanupPicked, ...extras]
      .sort((a, b) => a.diffValue - b.diffValue);
  };

  // EXH 전용 추천 — EC/HC 와 별개 로직.
  //   EXH 미클리어 (lamp < 6) 곡 중 자기 실력 (baseStar) 이하인 곡만,
  //   EXH ★ 낮은 순으로 30곡 → rate(%) 높은 순으로 정렬 → 10곡 표시.
  //   (미스 카운트는 Good 수치를 몰라 못 구함 → rate = exScore / (noteCount*2) 로 클리어 근접도 판단.)
  //   rate 없는 곡 (noteCount 미보강 / 미플레이) 은 뒤로 밀어서 정렬.
  //   baseStar 가 없으면 (실력값 추정 불가) 빈 배열 반환.
  const buildExhRecs = (baseStar) => {
    if (baseStar == null) return [];
    const candidates = [];
    for (const c of allCharts) {
      if (c.lampNum >= 6) continue;
      const e = ereterMap.get(norm(c.title) + '|' + c.diff);
      if (!e || e.level == null) continue;
      if (e.level < 11.6 || e.level > 12.7) continue;
      if (typeof e.exh !== 'number') continue;
      // 실력 +1 이상 곡 제외 (도전 살짝 허용) + 실력 -2 미만 곡 제외 (너무 쉬움)
      if (e.exh > baseStar + 1) continue;
      if (e.exh < baseStar - 2) continue;
      // rate = EX 점수 / 만점 (= noteCount*2). noteCount 없거나 미플레이면 null.
      const rate = (typeof c.exScore === 'number' && typeof c.noteCount === 'number' && c.noteCount > 0)
        ? c.exScore / (c.noteCount * 2) : null;
      candidates.push({
        title: c.title, chart: c.diff, level: e.level,
        ec: e.ec, hc: e.hc, exh: e.exh,
        ec_n: e.ec_n, hc_n: e.hc_n, exh_n: e.exh_n,
        diffValue: e.exh, currentLamp: c.lamp,
        rate: rate,
      });
    }
    // 1. EXH ★ 낮은 순 → top 30
    candidates.sort((a, b) => a.diffValue - b.diffValue);
    const top30 = candidates.slice(0, 30);
    // 2. rate 높은 순 (null 은 뒤로) → 10곡
    top30.sort((a, b) => {
      const ra = a.rate;
      const rb = b.rate;
      if (ra == null && rb == null) return 0;
      if (ra == null) return 1;
      if (rb == null) return -1;
      return rb - ra;
    });
    return top30.slice(0, 10);
  };

  // EC 는 실력값 없을 때 0.3 으로 fallback (저렙 진입자도 추천 받을 수 있게)
  // HC / EXH 는 실력값 없으면 빈 배열
  const EC_FALLBACK_BASE = 0.3;
  const ecBase = recBaseStar != null ? recBaseStar : EC_FALLBACK_BASE;
  recsEC.push(...buildRecs(3, 'ec', ecBase));
  if (recBaseStar != null) {
    recsHC.push(...buildRecs(5, 'hc', recBaseStar));
    recsEXH.push(...buildExhRecs(recBaseStar));
  }
  console.log(`[step2] 추천곡: EC ${recsEC.length}, HC ${recsHC.length}, EXH ${recsEXH.length}`);

  const topEC  = recsEC;
  const topHC  = recsHC;
  const topEXH = recsEXH;

  // 다시 뽑기 버튼에서 사용할 수 있도록 노출
  // (panel 생성 후 클릭으로 재호출 → DOM 부분 업데이트)
  window.__dp_rerollRecs = (stage) => {
    if (stage === 'exh') return recBaseStar != null ? buildExhRecs(recBaseStar) : [];
    if (stage === 'hc')  return recBaseStar != null ? buildRecs(5, 'hc', recBaseStar) : [];
    if (stage === 'ec')  return buildRecs(3, 'ec', recBaseStar != null ? recBaseStar : EC_FALLBACK_BASE);
    return [];
  };

  // -------- 6. 화면에 표시 --------
  document.getElementById('__dp_score_panel')?.remove();
  // 다시 계산 — 패널 제거 후 같은 Gist 다시 fetch + eval (캐시 우회).
  // DB 모드는 재 fetch 없이 같은 dbData 로 다시 렌더.
  window.__dp_rerun = () => {
    document.getElementById('__dp_score_panel')?.remove();
    document.getElementById('__dp_progress')?.remove();
    document.getElementById('__dp_confirm_rerun')?.remove();
    if (dbData) {
      window.__dp_render(dbData);
      return;
    }
    fetch('https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw/2-calc-score.js?t=' + Date.now())
      .then(r => r.text())
      .then(eval);
  };
  // 클릭 위치 근처에 재실행 확인 팝업 — 외부 클릭/취소 시 닫힘
  window.__dp_confirmRerun = (x, y) => {
    document.getElementById('__dp_confirm_rerun')?.remove();
    const box = document.createElement('div');
    box.id = '__dp_confirm_rerun';
    // 일단 화면 밖에 두고 크기 측정 후 viewport 안으로 조정
    box.style.cssText = `
      position: fixed; left: -9999px; top: -9999px; z-index: 9999999;
      background: #fff; color: #222;
      border: 1px solid #ccc; border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,.2);
      padding: 10px 12px;
      font-family: -apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif;
      font-size: 13px; line-height: 1.4;
    `;
    box.innerHTML = `
      <div style="margin-bottom:8px;white-space:nowrap">스크립트를 재실행 할까요?</div>
      <div style="display:flex;gap:6px;justify-content:flex-end">
        <button class="dp-confirm-no" style="border:1px solid #ddd;background:#fff;color:#555;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px">취소</button>
        <button class="dp-confirm-yes" style="border:1px solid #1d9e75;background:#1d9e75;color:#fff;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px">재실행</button>
      </div>
    `;
    document.body.appendChild(box);
    // viewport edge clamp — 클릭 위치 오른쪽 우선, 공간 없으면 왼쪽 / 세로는 가운데 정렬
    const w = box.offsetWidth, h = box.offsetHeight;
    const M = 8;
    let left = x + 12;
    if (left + w > window.innerWidth - M) left = x - w - 12;
    if (left < M) left = M;
    if (left + w > window.innerWidth - M) left = window.innerWidth - w - M;
    let top = y - h / 2;
    if (top < M) top = M;
    if (top + h > window.innerHeight - M) top = window.innerHeight - h - M;
    box.style.left = left + 'px';
    box.style.top = top + 'px';
    box.querySelector('.dp-confirm-no').onclick = (e) => { e.stopPropagation(); box.remove(); };
    box.querySelector('.dp-confirm-yes').onclick = (e) => { e.stopPropagation(); box.remove(); window.__dp_rerun(); };
    // 외부 클릭 시 닫기 (현재 클릭 이벤트 끝난 후 listener 등록)
    setTimeout(() => {
      const onDismiss = (e) => {
        if (!box.contains(e.target)) {
          box.remove();
          document.removeEventListener('mousedown', onDismiss, true);
          document.removeEventListener('touchstart', onDismiss, true);
        }
      };
      document.addEventListener('mousedown', onDismiss, true);
      document.addEventListener('touchstart', onDismiss, true);
    }, 0);
  };
  // ★값 표시용 — 최소 0.1 (그 이하로 추정돼도 0.1 로 floor), 그 외 2자리 반올림
  const fmt = (n) => Math.max(0.1, Math.round(n * 100) / 100);
  const escHtml = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const panel = document.createElement('div');
  panel.id = '__dp_score_panel';
  panel.innerHTML = `
    <style>
      #__dp_score_panel {
        position: fixed; top: 8px; right: 8px; left: 8px; z-index: 999999;
        max-width: 380px; max-height: 92vh; overflow: auto;
        margin-left: auto;
        background: #fff; color: #222;
        font-family: -apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif;
        font-size: 13px; line-height: 1.5;
        border: 1px solid #ccc; border-radius: 8px;
        box-shadow: 0 6px 24px rgba(0,0,0,.18);
        padding: 12px 14px;
        box-sizing: border-box;
        /* 패널 전체 줄바뀜 방지 — 모든 하위 요소가 상속 (긴 텍스트는 overflow:auto 로 스크롤) */
        white-space: nowrap;
      }
      /* 명시적으로 줄바뀜 막아야 하는 하위 요소들 (자체 white-space 룰 가진 것 덮어쓰기) */
      #__dp_score_panel * { white-space: nowrap; }
      @media (min-width: 768px) {
        /* 데스크톱: 우상단 고정, 너비 고정 (다시 뽑기 시 출렁임 방지) */
        #__dp_score_panel { left: auto; top: 16px; right: 16px; padding: 14px 16px; width: 380px; }
      }
      #__dp_score_panel h3 { margin: 0 0 6px; font-size: 15px; font-weight: 600; }
      #__dp_score_panel .meta { color: #666; font-size: 11px; margin-bottom: 10px; }
      #__dp_score_panel table { width: 100%; border-collapse: collapse; font-size: 12px; }
      #__dp_score_panel td { padding: 3px 6px; border-bottom: 1px solid #eee; text-align: left; color: #212529; }
      #__dp_score_panel th { padding: 3px 6px; text-align: left; background: #f6f6f6; font-weight: 600; color: #212529; border: none; }
      #__dp_score_panel th.num { text-align: right; }
      #__dp_score_panel th[colspan] { text-align: center; }
      #__dp_score_panel td.num { text-align: right; font-variant-numeric: tabular-nums; }
      #__dp_score_panel .close { position: absolute; top: 10px; right: 12px; z-index: 2; cursor: pointer; color: #888; border: none; background: none; font-size: 18px; line-height: 1; padding: 0; }
      #__dp_score_panel .close:hover { color: #212529; }
      #__dp_score_panel details { margin-top: 10px; }
      #__dp_score_panel summary { cursor: pointer; font-weight: 500; padding: 4px 0; outline: none; }
      /* details.toggle - 끝에 작은 ∨ / ∧ 마커 */
      #__dp_score_panel details.toggle > summary { list-style: none; }
      #__dp_score_panel details.toggle > summary::-webkit-details-marker { display: none; }
      #__dp_score_panel details.toggle > summary::after { content: '∨'; font-size: 9px; color: #c0c0c0; margin-left: 6px; }
      #__dp_score_panel details.toggle[open] > summary::after { content: '∧'; }
      #__dp_score_panel summary:hover { color: #495057; }
      /* 추천곡 details 전용: summary 가 flex 레이아웃, 화살표는 span, 다시뽑기 버튼은 우측 끝 */
      #__dp_score_panel details.toggle-rec > summary { display: flex; align-items: center; list-style: none; }
      #__dp_score_panel details.toggle-rec > summary::-webkit-details-marker { display: none; }
      #__dp_score_panel details.toggle-rec > summary::after { content: ''; margin: 0; }
      #__dp_score_panel details.toggle-rec .rec-summary-text { flex: 0 0 auto; }
      #__dp_score_panel details.toggle-rec .rec-summary-marker { flex: 0 0 auto; font-size: 9px; color: #c0c0c0; margin-left: 6px; }
      #__dp_score_panel details.toggle-rec[open] .rec-summary-marker::before { content: '∧'; }
      #__dp_score_panel details.toggle-rec:not([open]) .rec-summary-marker::before { content: '∨'; }
      #__dp_score_panel details.toggle-rec .rec-reroll { margin-left: auto; background: none; border: none; padding: 8px 12px; margin-top: -8px; margin-right: -12px; margin-bottom: -8px; font-size: 14px; color: #888; cursor: pointer; line-height: 1; display: none; }
      #__dp_score_panel details.toggle-rec[open] .rec-reroll { display: inline-block; }
      #__dp_score_panel details.toggle-rec .rec-reroll:hover { color: #333; }
      #__dp_score_panel details.toggle-rec .rec-reroll:active { color: #000; }
      #__dp_score_panel .profile { display: flex; gap: 12px; align-items: center; padding: 12px; background: #f8f9fb; border-radius: 6px; margin-bottom: 0; }
      #__dp_score_panel .profile-img { flex-shrink: 0; width: 64px; height: 64px; background: #e9ecef; border-radius: 4px; overflow: hidden; }
      #__dp_score_panel .profile-img img { width: 100%; height: 100%; object-fit: cover; }
      #__dp_score_panel .profile-info { flex: 1; min-width: 0; }
      #__dp_score_panel .profile-name { font-size: 16px; font-weight: 600; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #__dp_score_panel .profile-id { font-size: 11px; color: #666; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #__dp_score_panel .profile-rank { display: flex; gap: 10px; margin-top: 6px; font-size: 13px; flex-wrap: nowrap; white-space: nowrap; overflow: hidden; }
      #__dp_score_panel .profile-rank span { white-space: nowrap; font-weight: 700; }
      #__dp_score_panel .profile-rank b { color: #6c757d; margin-right: 3px; font-weight: 600; }
      /* 중전 (은빛) / 개전 (금빛) 은은하게 반짝이는 그라데이션 */
      #__dp_score_panel .rank-chuden, #__dp_score_panel .rank-kaiden {
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        color: transparent;
        background-size: 200% 100%;
        animation: __dp_shimmer 6s linear infinite;
      }
      #__dp_score_panel .rank-chuden {
        /* 베이스: 차분한 회색 → 살짝 밝아졌다가 → 다시 회색 */
        background-image: linear-gradient(90deg, #8c95a0 0%, #8c95a0 40%, #c7ccd2 50%, #8c95a0 60%, #8c95a0 100%);
      }
      #__dp_score_panel .rank-kaiden {
        /* 베이스: 차분한 금 → 살짝 밝아졌다가 → 다시 금 */
        background-image: linear-gradient(90deg, #c8a347 0%, #c8a347 40%, #ead78a 50%, #c8a347 60%, #c8a347 100%);
      }
      /* b 태그 (SP/DP 라벨) 는 그라데이션 영향 안 받게 */
      #__dp_score_panel .rank-chuden b, #__dp_score_panel .rank-kaiden b {
        -webkit-text-fill-color: #6c757d;
        color: #6c757d;
      }
      @keyframes __dp_shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
      #__dp_score_panel .profile-star { flex-shrink: 0; text-align: center; padding: 4px 4px 4px 8px; min-width: 72px; }
      #__dp_score_panel .profile-star-value { font-size: 22px; font-weight: 700; color: #212529; line-height: 1.1; margin: 2px 0; }
      #__dp_score_panel .profile-star-note { font-size: 9px; color: #888; line-height: 1.1; }
      /* ノーツレーダー — 기본 숨김, 프로필 카드의 토글 버튼으로 노출 (.open 클래스) */
      #__dp_score_panel .notes-radar { display: none; gap: 6px; padding: 8px; background: #f8f9fb; border-radius: 0 0 6px 6px; margin-top: 0; margin-bottom: 10px; position: relative; }
      #__dp_score_panel .notes-radar.open { display: flex; }
      #__dp_score_panel .nr-close { position: absolute; top: 4px; right: 8px; z-index: 2; background: none; border: none; padding: 0; cursor: pointer; color: #888; font-size: 11px; line-height: 1; text-decoration: underline; }
      #__dp_score_panel .nr-close:hover { color: #212529; }
      #__dp_score_panel .nr-box { flex: 1; min-width: 0; background: transparent; padding: 4px 6px; margin: 0; display: flex; flex-direction: column; gap: 2px; align-items: center; }
      #__dp_score_panel .nr-header { text-align: center; font-weight: 700; font-size: 12px; letter-spacing: 1.5px; margin: 0; padding: 0; line-height: 1.1; }
      #__dp_score_panel .nr-header.sp { color: #52a447; }
      #__dp_score_panel .nr-header.dp { color: #b066d8; }
      #__dp_score_panel .nr-svg { display: block; overflow: visible; }
      #__dp_score_panel .nr-detail { margin-top: 6px; padding-top: 5px; border-top: 1px dashed #d6dae0; width: 100%; }
      #__dp_score_panel .profile-star .nr-toggle { font-size: 9px; color: #666; cursor: pointer; margin-top: 10px; text-decoration: underline; user-select: none; line-height: 1.2; }
      #__dp_score_panel .profile-star .nr-toggle:hover { color: #212529; }
      #__dp_score_panel .nr-stats { width: 100%; display: flex; flex-direction: column; gap: 1px; font-size: 11px; line-height: 1.35; font-variant-numeric: tabular-nums; }
      #__dp_score_panel .nr-stat { display: flex; justify-content: space-between; gap: 6px; }
      #__dp_score_panel .nr-stat .label { font-weight: 700; }
      #__dp_score_panel .nr-stat .value { color: #212529; }
      #__dp_score_panel .nr-total { display: flex; justify-content: space-between; padding-top: 3px; margin-top: 2px; border-top: 1px solid #e9ecef; font-size: 10.5px; font-weight: 600; }
      #__dp_score_panel .nr-total .label { color: #495057; }
      #__dp_score_panel .nr-total .value { color: #212529; font-variant-numeric: tabular-nums; }
      #__dp_score_panel .nr-stat[data-cat="NOTES"]   .label { color: #e91e63; }
      #__dp_score_panel .nr-stat[data-cat="CHORD"]   .label { color: #44b544; }
      #__dp_score_panel .nr-stat[data-cat="PEAK"]    .label { color: #ff8c00; }
      #__dp_score_panel .nr-stat[data-cat="CHARGE"]  .label { color: #b066d8; }
      #__dp_score_panel .nr-stat[data-cat="SCRATCH"] .label { color: #dc3545; }
      #__dp_score_panel .nr-stat[data-cat="SOF-LAN"] .label { color: #1ec5e8; }
      /* 추천곡 기준 토글 (ereter / OhSorry) — 우측 정렬 */
      #__dp_score_panel .rec-mode-toggle {
        margin-top: 10px;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
      }
      #__dp_score_panel .rec-mode-label {
        font-size: 11px; color: #888;
        white-space: nowrap;
      }
      #__dp_score_panel .rec-mode-options {
        font-size: 12px;
        white-space: nowrap;
      }
      #__dp_score_panel .rec-mode-opt {
        cursor: pointer;
        color: #aaa;
        transition: color 0.15s;
      }
      #__dp_score_panel .rec-mode-opt:hover {
        color: #555;
      }
      #__dp_score_panel .rec-mode-opt.active {
        color: #212529;
        font-weight: 700;
        cursor: default;
      }
      #__dp_score_panel .rec-mode-sep {
        color: #ccc;
        margin: 0 8px;
      }
      #__dp_score_panel .recs { margin-top: 12px; }
      #__dp_score_panel .rec-item { padding: 4px 0; font-size: 12px; display: flex; align-items: center; gap: 6px; border-bottom: 1px solid #eee; }
      #__dp_score_panel .rec-item:last-child { border-bottom: none; }
      #__dp_score_panel .rec-item .rec-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #__dp_score_panel .rec-item .rec-title-clickable { cursor: pointer; }
      #__dp_score_panel .rec-item .rec-title-clickable:hover { font-weight: 700; }
      /* 우측 3개 컬럼 정렬: 실력난이도 ★ / 서열표 ☆ / 보면종류 */
      #__dp_score_panel .rec-item .rec-diff { flex: 0 0 42px; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
      #__dp_score_panel .rec-item .rec-level { flex: 0 0 32px; text-align: right; color: #888; font-variant-numeric: tabular-nums; font-size: 11px; }
      #__dp_score_panel .rec-item .rec-chart { flex: 0 0 12px; text-align: center; font-weight: 600; font-size: 11px; }
    </style>
    <button class="close" onclick="document.getElementById('__dp_score_panel').remove()" title="닫기">×</button>

    ${profile ? `
      <div class="profile">
        ${profile.qproImg ? `<div class="profile-img"><img src="${escHtml(profile.qproImg)}" alt="qpro"></div>` : ''}
        <div class="profile-info">
          <div class="profile-name">${escHtml(profile.djName || 'DJ')}</div>
          <div class="profile-id">IIDX ID: ${escHtml(profile.iidxId || '-')}</div>
          ${(profile.spRank || profile.dpRank) ? (() => {
            // 단위별 스타일 매핑
            //   1~8段: 파란색 / 9~10段: 빨간색
            //   中伝: 은빛 반짝 / 皆伝: 금빛 반짝
            //   기타 (無段/級 등): 회색
            // 단위는 한자 숫자로 표기됨 (一段/二段/.../九段/十段)
            const KANJI_NUM = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
            const rankStyle = (rank) => {
              if (!rank) return { color: '#6c757d', cls: '' };
              if (rank.includes('皆伝')) return { color: null, cls: 'rank-kaiden' };
              if (rank.includes('中伝')) return { color: null, cls: 'rank-chuden' };
              // 段 매칭: 한자 (一~十) 또는 아라비아 숫자
              const mKanji = rank.match(/([一二三四五六七八九十]+)\s*段/);
              const mDigit = rank.match(/(\d+)\s*段/);
              let n = null;
              if (mKanji) {
                // 십 단위 한자 ("十" 단독은 10, "十一" 등은 거의 없음)
                const s = mKanji[1];
                if (s === '十') n = 10;
                else if (s.length === 1 && KANJI_NUM[s]) n = KANJI_NUM[s];
                else n = null;  // 복합 한자는 안 다룸
              } else if (mDigit) {
                n = parseInt(mDigit[1], 10);
              }
              if (n != null) {
                if (n >= 9) return { color: '#dc3545', cls: '' };  // 빨강
                return { color: '#1971c2', cls: '' };  // 파랑
              }
              return { color: '#6c757d', cls: '' };  // 기본
            };
            const renderRank = (label, rank) => {
              if (!rank) return '';
              const { color, cls } = rankStyle(rank);
              const styleAttr = color ? `style="color:${color}"` : '';
              const classAttr = cls ? `class="${cls}"` : '';
              return `<span ${classAttr} ${styleAttr}><b>${label}</b>${escHtml(rank)}</span>`;
            };
            return `
              <div class="profile-rank">
                ${renderRank('SP', profile.spRank)}
                ${renderRank('DP', profile.dpRank)}
              </div>
            `;
          })() : ''}
        </div>
        ${starEstimate != null ? (() => {
          // 상세통계 토글 — 레이더 유무와 무관하게 항상 표시 (starEstimate 있으면 #__detail_stats 가 있음).
          // 이전엔 hasRadar 일 때만 버튼이 떠서, 레이더 없는 (DB 모드 / 구버전 업로드) 유저는
          // #__detail_stats 가 display:none 인 채로 열 방법이 없었음.
          const radarToggle = `<div class="nr-toggle" onclick="window.__dp_toggleRadar()">상세통계 ▼</div>`;
          // 위에서 이미 계산한 eraterTrueStar 변수 재사용
          if (eraterTrueStar != null) {
            const diff = starEstimate - eraterTrueStar;
            const diffStr = (diff >= 0 ? '+' : '') + diff.toFixed(2);
            const diffColor = Math.abs(diff) <= 0.1 ? '#52a447' : (Math.abs(diff) <= 0.3 ? '#dcaf45' : '#dc3545');
            return `
              <div class="profile-star">
                <div class="profile-star-value">★${fmt(starEstimate)}</div>
                <div class="profile-star-note">ereter: ★${eraterTrueStar.toFixed(2)} <span style="color:${diffColor};font-weight:600">(${diffStr})</span></div>
                ${radarToggle}
              </div>
            `;
          }
          return `
            <div class="profile-star">
              <div class="profile-star-value">★${fmt(starEstimate)}</div>
              <div class="profile-star-note">ereter.net 근사치 ±0.1</div>
              ${radarToggle}
            </div>
          `;
        })() : ''}
      </div>
    ` : '<div class="meta">프로필 정보를 가져올 수 없었어요</div>'}

    ${profileHasRadar ? (() => {
      const CATS = ['NOTES', 'CHORD', 'PEAK', 'CHARGE', 'SCRATCH', 'SOF-LAN'];
      // SVG 레이더 배치 (시계방향): 위(NOTES) → 우상(PEAK) → 우하(SCRATCH) → 아래(SOF-LAN) → 좌하(CHARGE) → 좌상(CHORD)
      const SVG_ORDER = ['NOTES', 'PEAK', 'SCRATCH', 'SOF-LAN', 'CHARGE', 'CHORD'];
      const fmt2 = (v) => (v != null && !isNaN(v)) ? v.toFixed(2) : '—';
      // KONAMI 공식: 6각형 max=100, 100 넘으면 폴리곤이 6각형 밖으로 삐져나옴 (overflow: visible 로 표시)
      const RADAR_MAX = 100;
      const LABEL_TEXT  = { NOTES: 'NOTES', CHORD: 'CHORD', PEAK: 'PEAK', CHARGE: 'CHARGE', SCRATCH: 'SCRATCH', 'SOF-LAN': 'SOF-LAN' };
      const LABEL_COLOR = { NOTES: '#e91e63', CHORD: '#44b544', PEAK: '#ff8c00', CHARGE: '#b066d8', SCRATCH: '#dc3545', 'SOF-LAN': '#1ec5e8' };
      const renderSvg = (radar, color) => {
        const size = 130, cx = size / 2, cy = size / 2, R = 38, LR = 50;
        const pt = (i, scale) => {
          const a = -Math.PI / 2 + (i / 6) * 2 * Math.PI;
          return `${(cx + Math.cos(a) * R * scale).toFixed(1)},${(cy + Math.sin(a) * R * scale).toFixed(1)}`;
        };
        const bgPoly = SVG_ORDER.map((_, i) => pt(i, 1)).join(' ');
        const innerPoly = SVG_ORDER.map((_, i) => pt(i, 0.5)).join(' ');
        const dataPoly = SVG_ORDER.map((c, i) => {
          const v = Math.max((radar[c] || 0) / RADAR_MAX, 0);  // clamp 없음 — 100 넘으면 6각형 밖으로
          return pt(i, v);
        }).join(' ');
        const spokes = SVG_ORDER.map((_, i) => {
          const a = -Math.PI / 2 + (i / 6) * 2 * Math.PI;
          return `<line x1="${cx}" y1="${cy}" x2="${(cx + Math.cos(a) * R).toFixed(1)}" y2="${(cy + Math.sin(a) * R).toFixed(1)}" stroke="#d6dae0" stroke-width="0.5"/>`;
        }).join('');
        const labels = SVG_ORDER.map((c, i) => {
          const a = -Math.PI / 2 + (i / 6) * 2 * Math.PI;
          const tx = cx + Math.cos(a) * LR;
          const ty = cy + Math.sin(a) * LR;
          return `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" fill="${LABEL_COLOR[c]}" font-size="8" font-weight="700" text-anchor="middle" dominant-baseline="central">${LABEL_TEXT[c]}</text>`;
        }).join('');
        return `<svg class="nr-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
          <polygon points="${bgPoly}" fill="#fff" stroke="#c0c6cc" stroke-width="0.8"/>
          <polygon points="${innerPoly}" fill="none" stroke="#d6dae0" stroke-width="0.5"/>
          ${spokes}
          <polygon points="${dataPoly}" fill="${color}" fill-opacity="0.55"/>
          ${labels}
        </svg>`;
      };
      const renderBox = (style, radar) => {
        if (!hasRadarData(radar)) return '';
        const cls = style.toLowerCase();
        // 폴리곤 색 = 6개 수치 중 최댓값 카테고리의 색
        const topCat = CATS.reduce((top, c) => (radar[c] || 0) > (radar[top] || 0) ? c : top, CATS[0]);
        const color = LABEL_COLOR[topCat];
        return `
          <div class="nr-box">
            ${renderSvg(radar, color)}
            <div class="nr-header ${cls}" style="color: ${color}">${style}</div>
            <div class="nr-detail">
              <div class="nr-stats">
                ${CATS.map(c => `
                  <div class="nr-stat" data-cat="${c}">
                    <span class="label">${c}</span>
                    <span class="value">${fmt2(radar[c])}</span>
                  </div>
                `).join('')}
              </div>
              <div class="nr-total">
                <span class="label">합계 레이더 스코어</span>
                <span class="value">${fmt2(radar.total)}</span>
              </div>
            </div>
          </div>
        `;
      };
      return `
        <div class="notes-radar">
          <button type="button" class="nr-close" onclick="window.__dp_hideRadar()" title="노트레이더 숨기기">레이더 닫기</button>
          ${renderBox('SP', profile.spRadar)}
          ${renderBox('DP', profile.dpRadar)}
        </div>
      `;
    })() : ''}

    <div id="__rec_wrapper" style="display:contents">
    ${(() => {
      // 난이도 (HYPER/ANOTHER/LEGGENDARIA) 색상
      //   HYPER = 연한 금색
      //   ANOTHER = 연한 빨강
      //   LEGGENDARIA = 연한 마젠타
      const chartColor = (chart) => {
        if (!chart) return '#888';
        const c = chart.toUpperCase();
        if (c.startsWith('L') || c.includes('LEGG')) return '#d678c8';  // 연한 마젠타
        if (c.startsWith('A')) return '#e88080';  // 연한 빨강
        if (c.startsWith('H')) return '#dcaf45';  // 연한 금
        return '#888';
      };
      // 추천 항목들을 HTML 로 렌더링 (다시 뽑기에서도 재사용)
      const renderRecItems = (recs, color) => {
        if (recs.length === 0) {
          return `<div class="meta" style="padding:6px 8px;color:#888">★값 근처에 추천할 곡이 없어요.</div>`;
        }
        return recs.map(r => {
          const chartLetter = (r.chart || '?')[0];
          const cColor = chartColor(r.chart);
          // ratingMap fallback 차트 색상 구분: lv11 → 연두색 / lv12 → 하늘색
          const titleStyle =
            r.gameLevel === 11 ? ' style="color:#9ccc65"' :
            r.gameLevel === 12 ? ' style="color:#87ceeb"' : '';
          const titleTooltip =
            r.gameLevel === 11 ? ' title="ohSorry 추정 ★ (게임 LEVEL 11, ereter 미등록)"' :
            r.gameLevel === 12 ? ' title="ohSorry 추정 ★ (게임 LEVEL 12, ereter 미등록)"' : '';
          return `
            <div class="rec-item">
              <span class="rec-chart" style="color:${cColor}" title="${r.chart || ''}">${chartLetter}</span>
              <div class="rec-title rec-title-clickable" data-t="${escHtml(r.title)}" data-c="${escHtml(r.chart || '')}"${titleTooltip}><span${titleStyle}>${escHtml(r.title)}</span><span style="color:#aaa;font-weight:400;margin-left:4px;font-size:10.5px">${r.currentLamp || ''}</span></div>
              <span class="rec-diff" style="color:${color}" title="실력 ★">★${r.diffValue.toFixed(2)}</span>
              <span class="rec-level" title="서열표 ☆">☆${r.level.toFixed(1)}</span>
            </div>
          `;
        }).join('');
      };
      // 다시 뽑기 함수 (window 에 노출 → 버튼 onclick 에서 호출)
      window.__dp_renderRecItems = renderRecItems;
      window.__dp_rerollAndRender = (stage, color) => {
        const newRecs = window.__dp_rerollRecs(stage);
        const container = document.getElementById(`__dp_recs_${stage}`);
        if (container) container.innerHTML = window.__dp_renderRecItems(newRecs, color);
        const counter = document.getElementById(`__dp_recs_count_${stage}`);
        if (counter) counter.textContent = newRecs.length;
      };

      const renderRec = (label, recs, color, stage) => {
        const openAttr = stage === 'ec' ? ' open' : '';
        return `
          <details class="toggle-rec"${openAttr} style="margin-top:10px">
            <summary style="color:#212529;font-weight:600">
              <span class="rec-summary-text">
                <span style="color:${color}">${label}</span> 클리어 추천
                (<span id="__dp_recs_count_${stage}">${recs.length}</span>곡)
              </span>
              <span class="rec-summary-marker"></span>
              <button type="button" class="rec-reroll"
                onclick="event.preventDefault();event.stopPropagation();window.__dp_rerollAndRender('${stage}','${color}');return false;"
                onmousedown="event.stopPropagation();"
                ontouchstart="event.stopPropagation();"
                title="추천곡 다시 뽑기">↻</button>
            </summary>
            <div id="__dp_recs_${stage}" class="recs" style="margin-top:6px">
              ${renderRecItems(recs, color)}
            </div>
          </details>
        `;
      };
      // 추천곡 기준 ★ 토글 (ereter / OhSorry)
      //   ereter 데이터 없으면 토글 숨김 (OhSorry 단일 모드로 자동 동작)
      //   디자인: 두 줄 (라벨 / 옵션), 글씨 클릭으로 전환, 가운데 구분자 |
      const recModeToggle = (() => {
        if (eraterTrueStar == null) return '';
        const ereterActive = recBaseMode === 'ereter';
        const ohsorryActive = recBaseMode === 'ohsorry';
        return `
          <div class="rec-mode-toggle">
            <button type="button" class="rec-reroll" style="margin-right:auto;background:none;border:none;padding:0;font-size:14px;color:#888;cursor:pointer;line-height:1"
              onclick="event.preventDefault();event.stopPropagation();window.__dp_confirmRerun(event.clientX, event.clientY);return false;"
              onmousedown="event.stopPropagation();"
              ontouchstart="event.stopPropagation();"
              title="다시 계산">↻</button>
            <span class="rec-mode-label">추천곡 기준 :</span>
            <div class="rec-mode-options">
              <span class="rec-mode-opt ${ereterActive ? 'active' : ''}" data-mode="ereter"
                onclick="window.__dp_setRecBase && window.__dp_setRecBase('ereter')"
                title="이레터넷 원본 ★값 기준">ereter</span>
              <span class="rec-mode-sep">|</span>
              <span class="rec-mode-opt ${ohsorryActive ? 'active' : ''}" data-mode="ohsorry"
                onclick="window.__dp_setRecBase && window.__dp_setRecBase('ohsorry')"
                title="OhSorry (우리 모델) 추정 ★값 기준">OhSorry</span>
            </div>
          </div>
        `;
      })();

      // 추천곡 모드 변경 핸들러
      const STAGE_COLORS = { ec: '#52a447', hc: '#dc3545', exh: '#d4a017' };
      window.__dp_setRecBase = (mode) => {
        if (mode === 'ereter' && eraterTrueStar == null) return;
        recBaseMode = mode;
        recBaseStar = mode === 'ereter' ? eraterTrueStar : ohsorryRecBase;
        for (const stage of ['ec', 'hc', 'exh']) {
          const newRecs = window.__dp_rerollRecs(stage);
          const container = document.getElementById(`__dp_recs_${stage}`);
          if (container) container.innerHTML = window.__dp_renderRecItems(newRecs, STAGE_COLORS[stage]);
          const counter = document.getElementById(`__dp_recs_count_${stage}`);
          if (counter) counter.textContent = newRecs.length;
        }
        document.querySelectorAll('.rec-mode-opt').forEach(b => {
          b.classList.toggle('active', b.dataset.mode === mode);
        });
      };

      return recModeToggle + [
        renderRec('EASY',    topEC,  '#52a447', 'ec'),    // 연두
        renderRec('HARD',    topHC,  '#dc3545', 'hc'),    // 빨강
        renderRec('EX-HARD', topEXH, '#d4a017', 'exh'),   // 금색
      ].join('');
    })()}
    </div>

    <div id="__detail_stats" style="margin-top:10px">
      ${(() => {
        // ===== dev 전용: 12레벨만 / 11렙 포함 toggle (in-place 갱신, details open state 보존) =====
        // 두 mode (lv12 / all) 의 stats 를 미리 계산 → 토글 시 DOM 의 텍스트/너비/visibility 만 갱신.
        const lampOrder = [
          { key: 'FULL COMBO', label: 'F-COMBO',   color: '#00d4dd' },
          { key: 'EX HARD',    label: 'EXH-CLEAR', color: '#dcaf45' },
          { key: 'HARD',       label: 'H-CLEAR',   color: '#dc3545' },
          { key: 'CLEAR',      label: 'CLEAR',     color: '#212529' },
          { key: 'EASY',       label: 'E-CLEAR',   color: '#52a447' },
          { key: 'ASSIST',     label: 'A-CLEAR',   color: '#9966cc' },
          { key: 'FAILED',     label: 'FAILED',    color: '#dc3545' },
        ];
        const djOrder = [
          { key: 'AAA', color: '#dcaf45' }, { key: 'AA',  color: '#dcaf45' },
          { key: 'A',   color: '#52a447' }, { key: 'B',   color: '#1971c2' },
          { key: 'C',   color: '#888' },    { key: 'D',   color: '#888' },
          { key: 'E',   color: '#dc3545' }, { key: 'F',   color: '#dc3545' },
        ];
        // levels: ereter / zasa 데이터에 실제 존재하는 zasa★ 값만 (11.6~12.7 범위).
        // 데이터에 없는 11.7 / 11.9 같은 빈 row 는 안 만듦.
        const levels = (() => {
          const set = new Set();
          for (const e of ereterData) {
            if (e.level == null || e.level < 11.6 || e.level > 12.7) continue;
            set.add(e.level.toFixed(1));
          }
          for (const z of zasaSupplemental) {
            if (z.level == null || z.level < 11.6 || z.level > 12.7) continue;
            set.add(z.level.toFixed(1));
          }
          return [...set].map(parseFloat).sort((a, b) => a - b);
        })();
        const lampPalette = [
          { key: 'fc',  color: '#00aab2', label: 'FC' },
          { key: 'exh', color: '#dcaf45', label: 'EX-HARD' },
          { key: 'hd',  color: '#dc3545', label: 'HARD' },
          { key: 'cl',  color: '#7dd3da', label: 'CLEAR' },
          { key: 'ez',  color: '#52a447', label: 'EASY' },
          { key: 'as',  color: '#9966cc', label: 'ASSIST' },
          { key: 'fa',  color: '#999',    label: 'FAILED' },
          { key: 'np',  color: '#e9ecef', label: 'NO PLAY' },
        ];
        const djPalette = [
          { key: 'AAA',   color: '#ffcc44', label: 'AAA' },
          { key: 'AA',    color: '#dcaf45', label: 'AA' },
          { key: 'A',     color: '#dc3545', label: 'A' },
          { key: 'B',     color: '#1971c2', label: 'B' },
          { key: 'C',     color: '#9ed870', label: 'C' },
          { key: 'lower', color: '#b0b0b0', label: 'D↓' },
          { key: 'none',  color: '#e9ecef', label: 'NP' },
        ];
        // mode 별 stats 계산.
        // CLEAR TYPE / DJ LEVEL 표: 사용자 charts (gameLevel 필터링) 그대로.
        // 난이도 별 stacked bar: zasa 데이터만 사용 (ereter / ratingMap 무시).
        //   - lv12 mode: zasa.gameLevel === 12 만
        //   - all mode: zasa.gameLevel === 11 || 12
        const computeStats = (mode) => {
          const isLv = (gl) => mode === 'lv12' ? gl === 12 : (gl === 11 || gl === 12);
          const charts = allCharts.filter(c => isLv(c.gameLevel));
          // 1) CLEAR TYPE / DJ LEVEL
          const clearTypeCount = { 'FULL COMBO': 0, 'EX HARD': 0, 'HARD': 0, 'CLEAR': 0, 'EASY': 0, 'ASSIST': 0, 'FAILED': 0, 'NO PLAY': 0 };
          const djCount = {};
          for (const c of charts) {
            if (clearTypeCount[c.lamp] !== undefined) clearTypeCount[c.lamp]++;
            if (c.djLevel) djCount[c.djLevel] = (djCount[c.djLevel] || 0) + 1;
          }
          // 2) 난이도 별 stacked bar
          const lampStats = {};
          const djStats = {};
          for (const lv of levels) {
            lampStats[lv.toFixed(1)] = { total: 0, fc: 0, exh: 0, hd: 0, cl: 0, ez: 0, as: 0, fa: 0, np: 0, played: 0 };
            djStats[lv.toFixed(1)]   = { total: 0, AAA: 0, AA: 0, A: 0, B: 0, C: 0, lower: 0, none: 0 };
          }
          // total: ereter (모두 lv12) + zasa 보충 (gameLevel 필터)
          // ereter 는 11.6~12.7 의 모든 0.1 step 을 채우고, zasa 는 ereter 미등록만 보강
          for (const e of ereterData) {
            if (e.level == null) continue;
            // ereter 는 모두 lv12 — Lv11+ 모드에서도 그대로 카운트
            const k = e.level.toFixed(1);
            if (lampStats[k]) lampStats[k].total++;
            if (djStats[k]) djStats[k].total++;
          }
          for (const z of zasaSupplemental) {
            if (z.level == null) continue;
            if (!isLv(z.gameLevel)) continue;
            const k = z.level.toFixed(1);
            if (lampStats[k]) lampStats[k].total++;
            if (djStats[k]) djStats[k].total++;
          }
          // user 플레이 카운트: ereterMap 우선, 없으면 zasaMap fallback (gameLevel 필터)
          for (const c of charts) {
            const key = norm(c.title) + '|' + c.diff;
            let k = null;
            const e = ereterMap.get(key);
            if (e && e.level != null) {
              k = e.level.toFixed(1); // ereter 매칭 — lv12 (이미 charts 가 isLv 통과)
            } else {
              const z = zasaMap.get(key);
              if (z && z.level != null && isLv(z.gameLevel)) k = z.level.toFixed(1);
            }
            if (!k || !lampStats[k]) continue;
            if (c.lampNum >= 1) lampStats[k].played++;
            if (c.lampNum === 7) lampStats[k].fc++;
            else if (c.lampNum === 6) lampStats[k].exh++;
            else if (c.lampNum === 5) lampStats[k].hd++;
            else if (c.lampNum === 4) lampStats[k].cl++;
            else if (c.lampNum === 3) lampStats[k].ez++;
            else if (c.lampNum === 2) lampStats[k].as++;
            else if (c.lampNum === 1) lampStats[k].fa++;
            if (c.djLevel) {
              if (['AAA', 'AA', 'A', 'B', 'C'].includes(c.djLevel)) djStats[k][c.djLevel]++;
              else if (['D', 'E', 'F'].includes(c.djLevel)) djStats[k].lower++;
            }
          }
          for (const lv of levels) {
            const k = lv.toFixed(1);
            lampStats[k].np = Math.max(0, lampStats[k].total - lampStats[k].played);
            const s = djStats[k];
            s.none = Math.max(0, s.total - (s.AAA + s.AA + s.A + s.B + s.C + s.lower));
          }
          return { clearTypeCount, djCount, lampStats, djStats };
        };
        // 두 mode 모두 미리 계산 → window 에 cache (toggle 시 재계산 X)
        const statsByMode = {
          lv12: computeStats('lv12'),
          all: computeStats('all'),
        };
        window.__dp_statsByMode = statsByMode;

        // 초기 렌더 — 모든 row 항상 그림 (total === 0 인 row 는 display:none).
        // 각 cell 에 data-* 속성 부여 → toggle 시 그 속성으로 찾아서 in-place 갱신.
        const initialMode = 'lv12';
        const initStats = statsByMode[initialMode];
        // CLEAR TYPE / DJ LEVEL 표
        const buildTable = () => {
          const rows = Math.max(lampOrder.length, djOrder.length);
          let html = '<table style="margin-bottom:8px"><tr><th colspan="2">CLEAR TYPE</th><th colspan="2">DJ LEVEL</th></tr>';
          for (let i = 0; i < rows; i++) {
            const l = lampOrder[i];
            const d = djOrder[i];
            html += '<tr>';
            if (l) html += `<td style="color:${l.color};font-weight:600">${l.label}</td><td class="num" data-clear-type="${l.key}">${initStats.clearTypeCount[l.key] || 0} 곡</td>`;
            else html += '<td></td><td></td>';
            if (d) html += `<td style="color:${d.color};font-weight:600">${d.key}</td><td class="num" data-dj-count="${d.key}">${initStats.djCount[d.key] || 0} 곡</td>`;
            else html += '<td></td><td></td>';
            html += '</tr>';
          }
          html += '</table>';
          return html;
        };
        // 스택드 row — 모든 segment 항상 그림 (count===0 이면 width:0 + display:none).
        const buildBarRow = (lv, kind, palette, statsForLv) => {
          const total = statsForLv.total;
          const segHtml = palette.map(p => {
            const count = statsForLv[p.key] || 0;
            const pct = total > 0 ? (count / total * 100).toFixed(2) : '0';
            const display = count > 0 ? '' : 'display:none;';
            return `<div data-seg="${p.key}" data-label="${p.label}" style="${display}background:${p.color};width:${pct}%;height:100%" title="${p.label}: ${count}곡"></div>`;
          }).join('');
          // 11.6~12.7 의 모든 row 항상 표시 (total === 0 이어도 row 자체는 보임)
          return `
            <div data-bar-row="${lv.toFixed(1)}" data-bar-kind="${kind}"
              style="display:flex;align-items:center;gap:6px;font-size:11px;line-height:1;margin-bottom:3px">
              <span style="flex-shrink:0;width:34px;color:#666;font-variant-numeric:tabular-nums">★${lv.toFixed(1)}</span>
              <span data-total style="flex-shrink:0;width:24px;text-align:right;color:#888;font-variant-numeric:tabular-nums">${total}</span>
              <div style="flex:1;height:12px;display:flex;border-radius:2px;overflow:hidden;background:#f5f5f5">${segHtml}</div>
            </div>`;
        };
        const renderLegend = (palette) => `
          <div style="display:flex;flex-wrap:nowrap;gap:6px 10px;font-size:10px;color:#666;margin-bottom:6px;white-space:nowrap;overflow:hidden">
            ${palette.map(p => `<span style="display:inline-flex;align-items:center;gap:3px">
              <span style="display:inline-block;width:9px;height:9px;background:${p.color};border-radius:1px"></span>
              ${p.label}
            </span>`).join('')}
          </div>`;
        const buildBars = () => {
          let h = '';
          h += `<details class="toggle" style="margin-top:8px"><summary style="font-weight:600;color:#212529">난이도 별 클리어 램프</summary>`;
          h += `<div style="margin-top:6px">${renderLegend(lampPalette)}`;
          for (const lv of levels) h += buildBarRow(lv, 'lamp', lampPalette, initStats.lampStats[lv.toFixed(1)]);
          h += `</div></details>`;
          h += `<details class="toggle" style="margin-top:6px"><summary style="font-weight:600;color:#212529">난이도 별 DJ LEVEL</summary>`;
          h += `<div style="margin-top:6px">${renderLegend(djPalette)}`;
          for (const lv of levels) h += buildBarRow(lv, 'dj', djPalette, initStats.djStats[lv.toFixed(1)]);
          h += `</div></details>`;
          return h;
        };

        // toggle 클릭 시 — DOM in-place 갱신 (innerHTML 교체 X → details open state 보존)
        window.__dp_setLvMode = (mode) => {
          const stats = window.__dp_statsByMode && window.__dp_statsByMode[mode];
          if (!stats) return;
          // CLEAR TYPE 셀
          document.querySelectorAll('[data-clear-type]').forEach(el => {
            const k = el.getAttribute('data-clear-type');
            el.textContent = (stats.clearTypeCount[k] || 0) + ' 곡';
          });
          // DJ LEVEL 셀
          document.querySelectorAll('[data-dj-count]').forEach(el => {
            const k = el.getAttribute('data-dj-count');
            el.textContent = (stats.djCount[k] || 0) + ' 곡';
          });
          // 스택드 row
          document.querySelectorAll('[data-bar-row]').forEach(row => {
            const lv = row.getAttribute('data-bar-row');
            const kind = row.getAttribute('data-bar-kind');
            const s = (kind === 'lamp' ? stats.lampStats : stats.djStats)[lv];
            if (!s) return;
            const totalEl = row.querySelector('[data-total]');
            if (totalEl) totalEl.textContent = String(s.total);
            row.style.display = s.total === 0 ? 'none' : 'flex';
            row.querySelectorAll('[data-seg]').forEach(seg => {
              const key = seg.getAttribute('data-seg');
              const count = s[key] || 0;
              const pct = s.total > 0 ? (count / s.total * 100).toFixed(2) : '0';
              seg.style.width = pct + '%';
              seg.style.display = count > 0 ? '' : 'none';
              const label = seg.getAttribute('data-label') || key;
              seg.setAttribute('title', label + ': ' + count + '곡');
            });
          });
          // toggle 활성 표시 (텍스트 색/굵기)
          document.querySelectorAll('.dp-lv-toggle-btn').forEach(b => {
            const active = b.getAttribute('data-mode') === mode;
            b.classList.toggle('active', active);
            b.style.color = active ? '#212529' : '#888';
            b.style.fontWeight = active ? '600' : '400';
          });
        };

        // ★ 추정 비교 · 곡 정보 details 의 inner content (난이도 토글 row 의 왼쪽에 배치)
        const infoInner = `
          <div class="meta" style="margin:4px 0 0;white-space:nowrap">${pageCount}페이지 · ${useOnlyLv12 ? allCharts.filter(c => c.gameLevel === 12).length : allCharts.length}곡 · 매칭 ${matched} · 미매칭 ${unmatched}${useOnlyLv12 ? ' · LEVEL 12 only' : ''}</div>
          ${(() => {
            const fmtStar = v => v != null ? `★${v.toFixed(2)}` : '—';
            const rows = [
              { label: '이레터넷 대상곡만',    val: starEstimateEreterOnly },
              { label: 'LEVEL 12 (이레터+추정)', val: starEstimateLv12Only   },
              { label: '11.6+ 전체 (lv11+12)',  val: starEstimateAll        },
              { label: 'OSR v0.0.2 (zasa+plays)', val: starEstimateNew },
            ];
            const items = rows.map(r => `<div style="color:#888">${r.label}: <b style="color:#444">${fmtStar(r.val)}</b></div>`).join('');
            return `<div class="meta" style="margin:6px 0 0;font-size:11px;line-height:1.6">${items}</div>`;
          })()}
        `;
        return `
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:8px">
            <details class="toggle" style="flex:0 1 auto;margin:0;position:relative">
              <summary style="font-size:11px;color:#888;cursor:pointer">★ 추정 비교 · 곡 정보</summary>
              <div class="info-popup" style="position:absolute;top:100%;left:0;margin-top:4px;background:#fff;border:1px solid #e0e0e0;border-radius:4px;padding:6px 10px;z-index:10;box-shadow:0 2px 8px rgba(0,0,0,.08);white-space:nowrap">${infoInner}</div>
            </details>
            <div class="dp-lv-toggle" style="display:flex;align-items:center;gap:4px;font-size:11px;color:#888;flex-shrink:0">
              <span style="margin-right:2px">난이도 선택 :</span>
              <span class="dp-lv-toggle-btn active" data-mode="lv12"
                style="cursor:pointer;color:#212529;font-weight:600"
                onclick="window.__dp_setLvMode('lv12')">DP12</span>
              <span style="color:#ccc">|</span>
              <span class="dp-lv-toggle-btn" data-mode="all"
                style="cursor:pointer;color:#888;font-weight:400"
                onclick="window.__dp_setLvMode('all')">DP11+</span>
            </div>
          </div>
          <div id="__dp_detail_filtered">${buildTable()}${buildBars()}</div>
        `;
      })()}
    </div>

    ${ereterExtractedAt ? (() => {
      // 날짜는 한국식 (yyyy.mm.dd), 시간은 영문 AM/PM. 패널 최하단에 표시.
      const d = new Date(ereterExtractedAt);
      const date = `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
      const h24 = d.getHours();
      const ampm = h24 >= 12 ? 'PM' : 'AM';
      const h12 = h24 % 12 || 12;
      const time = `${h12}:${String(d.getMinutes()).padStart(2,'0')} ${ampm}`;
      return `<div class="meta" style="text-align:center;color:#888;font-size:10.5px;margin-top:12px;margin-bottom:0">${date} ${time} ereter parsed</div>`;
    })() : ''}
  `;
  document.body.appendChild(panel);

  // 추천곡 곡명 클릭 → 차트 row 토스트 (ohsorry-shelf renderChartRow) — 클릭 위치에 표시.
  // 이벤트 위임 — rec 항목은 다시뽑기 / 모드변경 시 재렌더되므로 panel 에 한 번만 바인딩.
  const showRowToast = (chartObj, x, y) => {
    if (!shelfLib || !shelfLib.renderChartRow) return;
    document.getElementById('__dp_row_toast')?.remove();
    const t = document.createElement('div');
    t.id = '__dp_row_toast';
    t.innerHTML = shelfLib.renderChartRow(chartObj);
    t.style.cssText = 'position:fixed;left:0;top:0;width:320px;max-width:calc(100vw - 16px);z-index:9999999;box-shadow:0 6px 24px rgba(0,0,0,.5);border-radius:4px;cursor:pointer';
    document.body.appendChild(t);
    const rect = t.getBoundingClientRect();
    const m = 8;
    let left = x - rect.width / 2, top = y + 14;
    left = Math.max(m, Math.min(left, window.innerWidth - rect.width - m));
    if (top + rect.height + m > window.innerHeight) top = y - rect.height - 14;
    top = Math.max(m, top);
    t.style.left = left + 'px';
    t.style.top = top + 'px';
    t.addEventListener('click', () => t.remove());
    clearTimeout(showRowToast.__timer);
    showRowToast.__timer = setTimeout(() => t.remove(), 4000);
  };
  panel.addEventListener('click', (e) => {
    const el = e.target.closest('.rec-title-clickable');
    if (!el) return;
    const found = allCharts.find((c) => c.title === el.dataset.t && c.diff === el.dataset.c);
    if (found) showRowToast(found, e.clientX, e.clientY);
  });

  // 상세통계 토글 — 프로필 카드의 "상세통계 ▼" 클릭 시 .notes-radar + #__detail_stats 둘 다 같이 보이기/숨기기
  // 노트레이더 안의 X 버튼 (window.__dp_hideRadar) 은 노트레이더만 숨김 — 토글 상태에는 영향 X
  if (panel.querySelector('#__detail_stats')) {
    panel.querySelector('#__detail_stats').style.display = 'none';
  }
  let __radarToggleOpen = false;  // X 와 독립적인 토글 자체 상태
  window.__dp_toggleRadar = () => {
    __radarToggleOpen = !__radarToggleOpen;
    const nr = panel.querySelector('.notes-radar');
    const ds = panel.querySelector('#__detail_stats');
    const btn = panel.querySelector('.profile-star .nr-toggle');
    if (__radarToggleOpen) {
      if (nr) nr.classList.add('open');
      if (ds) ds.style.display = '';
      if (btn) btn.textContent = '상세통계 ▲';
    } else {
      if (nr) nr.classList.remove('open');
      if (ds) ds.style.display = 'none';
      if (btn) btn.textContent = '상세통계 ▼';
    }
  };
  window.__dp_hideRadar = () => {
    const nr = panel.querySelector('.notes-radar');
    if (nr) nr.classList.remove('open');
  };

  // 표시 순서: 프로필 → 노트레이더 → 상세통계 → 추천곡 (제일 아래)
  // 추천곡 wrapper 를 상세통계 details 뒤로 이동
  {
    const recWrap = panel.querySelector('#__rec_wrapper');
    const detailStats = panel.querySelector('#__detail_stats');
    if (recWrap && detailStats) detailStats.after(recWrap);
  }

  // DJ LEVEL / EX 점수 통계 (★11.6 ~ ★12.7, 즉 공식 ☆12 전체)
  const isTwelve = (c) => {
    const e = ereterMap.get(norm(c.title) + '|' + c.diff);
    return e && e.level != null && e.level >= 11.6 && e.level <= 12.7;
  };
  const playedTwelve = allCharts.filter(c => c.lampNum > 0 && isTwelve(c));
  const djLevelDist = {};
  for (const c of playedTwelve) {
    const lv = c.djLevel || '-';
    djLevelDist[lv] = (djLevelDist[lv] || 0) + 1;
  }
  const djLevelOrder = ['AAA', 'AA', 'A', 'B', 'C', 'D', 'E', 'F', '-'];
  const djLevelStr = djLevelOrder.filter(k => djLevelDist[k]).map(k => `${k}:${djLevelDist[k]}`).join(' ');
  console.log(`[step2] 12렙 DJ LEVEL 분포: ${djLevelStr}`);

  window.__dp_result = { total, matched, unmatched, details, perLevel, perLamp, allCharts, pageCount, ereterExtractedAt, starEstimate, starRaw, profile, recsEC, recsHC, recsEXH, djLevelDist };
  console.log('💾 결과 데이터: window.__dp_result');
  console.log('   - allCharts: 곡별 lamp + djLevel + exScore + pgreat + great');

  // -------- 7. Supabase user_profiles UPSERT --------
  //   user_profiles: iidx_id PK 로 UPSERT (매번 덮어쓰기 + charts_json 저장)
  //   실패해도 사용자 경험에 영향 없도록 fire-and-forget
  //   DB 모드는 조회용 렌더라 재업로드 안 함 (DB 데이터를 그대로 덮어쓰는 의미 없음)
  (async () => {
    if (dbData) {
      console.log('[오소리] DB 모드 — user_profiles 재업로드 skip');
      return;
    }
    const SUPABASE_URL = 'https://ryesiijulrlmstmhzpnv.supabase.co';
    // Legacy JWT anon key (publishable key 는 RLS 호환성 문제로 사용 X)
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5ZXNpaWp1bHJsbXN0bWh6cG52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNzAxNDAsImV4cCI6MjA5Mzc0NjE0MH0.KaKa241XpXbRkdM0C3euyUM3jOX673ijd319HFFFxwA';

    if (!profile || !profile.iidxId) {
      console.log('[step2] user_profiles 저장 skip: 프로필 없음');
      return;
    }
    const iidxIdNorm = profile.iidxId.replace(/-/g, '');

    // lamp 통계 — 실력추정 scope 와 동일
    //   useOnlyLv12 면 LEVEL 12 차트만 (ereter + ratingMap fallback)
    //   else: 전체 11.6+ (ereter + ratingMap fallback, lv11 포함)
    let nPlayedLv12 = 0, fcCount = 0, exhCount = 0, hcCount = 0, nClearedLv12 = 0;
    for (const c of allCharts) {
      if (useOnlyLv12 && c.gameLevel !== 12) continue;
      const e = ereterMap.get(norm(c.title) + '|' + c.diff);
      if (!e || e.level == null || e.level < 11.6 || e.level > 12.7) {
        // ereter 미등록 — ratingMap 으로 카운트 (lv11/12 fallback)
        const r = ratingMap.get(norm(c.title) + '|' + c.diff);
        if (r && r.zasaLevel >= 11.6 && r.zasaLevel <= 12.7) {
          if (c.lampNum > 0) nPlayedLv12++;
          if (c.lampNum >= 3) nClearedLv12++;
          if (c.lampNum >= 5) hcCount++;
          if (c.lampNum >= 6) exhCount++;
          if (c.lampNum === 7) fcCount++;
        }
        continue;
      }
      if (c.lampNum > 0) nPlayedLv12++;
      if (c.lampNum >= 3) nClearedLv12++;
      if (c.lampNum >= 5) hcCount++;
      if (c.lampNum >= 6) exhCount++;
      if (c.lampNum === 7) fcCount++;
    }

    const payload = {
      iidx_id: iidxIdNorm,
      dj_name: profile.djName || null,
      star_estimate: starEstimate != null ? Number(starEstimate.toFixed(4)) : null,
      ereter_star: eraterTrueStar != null ? Number(eraterTrueStar) : null,
      raw_s: starRaw != null ? Number(starRaw.toFixed(4)) : null,
      version: 'v3.3.5',
      sp_rank: profile.spRank || null,
      dp_rank: profile.dpRank || null,
      n_cleared: nClearedLv12,
      n_played_lv12: nPlayedLv12,
      fc_count: fcCount,
      hc_count: hcCount,
      exh_count: exhCount,
      level_filter: 'lv12',
      series: SERIES,
      charts_json: allCharts,
      notes_radar: profileHasRadar
        ? { sp: hasRadarData(profile.spRadar) ? profile.spRadar : null, dp: hasRadarData(profile.dpRadar) ? profile.dpRadar : null }
        : null,
    };

    try {
      // RPC: security definer function 호출 (RLS 우회)
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/upsert_user_profile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({ p: payload }),
      });
      if (res.ok) {
        console.log('[step2] user_profiles upsert 성공');
      } else {
        const errText = await res.text().catch(() => '');
        console.warn(`[step2] user_profiles 실패: HTTP ${res.status}`, errText);
      }
    } catch (e) {
      console.warn('[step2] user_profiles 실패:', e.message);
    }
  })();
};

// eagate 도메인이면 자동 실행 (콘솔에 붙여넣는 기존 사용법 그대로).
// 그 외 사이트는 window.__dp_render(dbData) 로 DB 데이터를 넘겨 호출.
if (location.hostname.endsWith('p.eagate.573.jp')) {
  window.__dp_render(null);
} else {
  console.log('[오소리] eagate 외 도메인 — window.__dp_render(dbData) 로 DB 데이터를 넘겨 호출하세요.');
}
