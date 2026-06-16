// ============================================================
// calcOhsorryCore — 오소리 본체 / 라이벌오소리 크롤러의 핵심 모듈.
// ============================================================
// [구조개편 2C] 크롤 → 별값(★) → supabase 업로드 전용. 추천/렌더/표시는 ohSorryWeb·ohSorryRating(gist 모듈)이 담당.
//   웹·INF 는 코어를 안 쓰고(코어-free, ohsorryRender 직접 호출), 코어는 eagate 업로더에서만 실행된다.
//
// 동작:
//   1. Gist 에서 ereter / zasa / textage / ohSorryRating JSON + 별값 lib(OSR13.5+/onlyOSR/onlyOSRtoEreter) fetch
//   2. eagateFetch 모듈로 series.html 시리즈 폴더 크롤 (클리어램프 + EX점수 + 차트). gameLevel 은 textage 역추정.
//   3. 별값(★) 추정 = onlyOSRtoEreter (native onlyOSR → ereter★, OSR13.5 tier)
//   4. status.html 로 프로필(DJ명 / IIDX ID / SP·DP 단위 / 노트레이더) 추출
//   5. dbConn.uploadResult 직접 호출 — users 프로필 + scores + 28피처(user_ohsorry_radars) 업로드
//   6. 완료 박스(djName / iidxId / 단위 + 오소리웹 버튼). own=박스, rival=조용히 업로드(최종 목록은 wrapper)
//
// opts:
//   mode: 'own' | 'rival'  (기본 'own')
//   rivalToken: rival 모드 시 URL 의 rival 토큰 (옵션 — 본인 모드는 무시)
//   seriesList / playStyle: 크롤 범위 (wrapper 모달이 결정 — 시리즈 list 값 0~32, 생략 시 전체)
//   wrapperVersion: wrapper 자기 버전 — supabase version 컬럼은
//                   `${wrapperVersion}-core${CORE_VERSION_SHORT}` 조합 (예: 'v3.4.0-core396')
// 콘솔에서 직접 실행 시 (eamuse 페이지 / 운영자 진단 / ohSorryWeb 사이드 카드 등) lib 로드 + step2 진행 동안
// 사용자 가시화용 floating spinner. compute 시작 시 추가 → 끝 / 에러 시 제거.
function __ohsorryShowSpinner() {
  if (typeof document === 'undefined') return null;
  const existing = document.getElementById('__ohsorry_loading_spinner');
  if (existing) existing.remove();
  if (!document.getElementById('__ohsorry_spin_style')) {
    const styleEl = document.createElement('style');
    styleEl.id = '__ohsorry_spin_style';
    styleEl.textContent = '@keyframes __ohsorry_spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(styleEl);
  }
  const el = document.createElement('div');
  el.id = '__ohsorry_loading_spinner';
  el.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;display:flex;align-items:center;gap:8px;background:rgba(20,23,28,0.92);color:#fff;padding:8px 14px;border-radius:6px;font-size:12.5px;font-family:system-ui,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.25)';
  el.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:__ohsorry_spin .8s linear infinite"></span><span>오소리 분석 로딩 중...</span>';
  document.body.appendChild(el);
  return el;
}
function __ohsorryHideSpinner() {
  document.getElementById('__ohsorry_loading_spinner')?.remove();
}
// [구조개편 Phase 2B] 헤드리스 업로드 완료 박스 — 추천/렌더 패널 없이 "✅ 업로드 완료 + 식별정보 한 줄 + 오소리웹 버튼".
//   profile: { djName, iidxId, spRank, dpRank }, style: 'SP' | 'DP'(기본). 단위(rank)는 eagate 段位 한자 문자열('中伝' 등).
//   별값/피처/점수는 업로드만 하고 상세 표시는 오소리웹으로 위임 (설계서 §5 A+식별정보).
function __ohsorryShowDone(profile, style) {
  if (typeof document === 'undefined') return;
  __ohsorryHideSpinner();
  document.getElementById('__ohsorry_done')?.remove();
  const p = profile || {};
  const dj = (p.djName || '?').replace(/[<>]/g, '');
  const id = p.iidxId || '';
  const idNorm = id.replace(/-/g, '');   // 딥링크/표시는 하이픈 제거(supabase iidx_id 형식)
  const webUrl = idNorm ? `https://iidx.in/#user@${idNorm}#tab@recent` : 'https://iidx.in/';
  const rankRaw = (style === 'SP' ? p.spRank : p.dpRank) || '';
  const hasRank = rankRaw && rankRaw !== '---' && rankRaw !== '-';
  const rankLine = hasRank ? `<span style="font-weight:700">${(style === 'SP' ? 'SP' : 'DP')} ${String(rankRaw).replace(/[<>]/g, '')}</span>` : '';
  const el = document.createElement('div');
  el.id = '__ohsorry_done';
  el.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;background:#fff;border:1px solid #d7dbe0;border-radius:8px;padding:14px 16px;width:260px;max-width:calc(100vw - 24px);box-sizing:border-box;box-shadow:0 6px 18px rgba(0,0,0,.18);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#212529';
  el.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">' +
      '<div style="font-size:14px;font-weight:700;color:#1d9e75">✅ 업로드 완료</div>' +
      '<button id="__ohsorry_done_x" style="background:transparent;border:0;color:#aaa;cursor:pointer;font-size:18px;line-height:1;padding:0 2px">×</button>' +
    '</div>' +
    `<div style="font-size:13px;font-weight:600;word-break:break-all">${dj}</div>` +
    (id ? `<div style="font-size:11px;color:#868e96;font-family:monospace;margin-top:1px">${id}</div>` : '') +
    (rankLine ? `<div style="font-size:12px;margin-top:4px">${rankLine}</div>` : '') +
    `<a href="${webUrl}" target="_blank" rel="noopener" ` +
      'style="display:block;margin-top:12px;padding:8px 0;text-align:center;background:#1d9e75;color:#fff;font-size:12.5px;font-weight:600;border-radius:6px;text-decoration:none">오소리웹에서 내 카드 보기 →</a>';
  document.body.appendChild(el);
  el.querySelector('#__ohsorry_done_x')?.addEventListener('click', () => el.remove());
}

window.OhsorryCore = {
  VERSION: '0.0.399',
  compute: async (opts) => {
  __ohsorryShowSpinner();
  opts = opts || {};
  const mode = opts.mode || 'own';
  const isRival = mode === 'rival';
  const rivalToken = opts.rivalToken || null;
  const wrapperVersion = opts.wrapperVersion || 'unknown';
  const CORE_VERSION_SHORT = '0.0.399'.replace(/^0\.0\./, '');  // '399' — series 단일화 + seriesList 선택 + SP/DP gameLevel 역추정 + 완료박스 내 카드 딥링크(iidx.in)
  const dbVersionString = `${wrapperVersion}-core${CORE_VERSION_SHORT}`;
  // -------- 0. ereter 데이터 로드 (Gist 에서 자동 fetch) --------
  // ereter.net 데이터는 Gist 에 ereter-data.json 으로 올려둔 걸 가져옵니다.
  // 형식: { extractedAt: "ISO 일시", source, count, charts: [...] }
  //       또는 옛 형식 [{...}, ...] (호환성 유지)
  // 한 번 받으면 24시간 동안 localStorage 에 캐시됨
  // 강제로 새로 받고 싶으면: localStorage.removeItem('ereter_dp_diff_v4'); 후 재실행
  const ERETER_DATA_URL = 'https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw/ereter-data.json';
  // textage 채보 메타 — 채보별 총 노트 수 (notes.DN/DH/DA/DX) + 채보 levels. series 모드 gameLevel 역추정 + noteCount 보강.
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

  // 캐시 확인 + 원격 extractedAt 비교 (extractedAt 만 비교에 사용)
  let cachedExtractedAt = null;
  try {
    const stored = localStorage.getItem(CACHE_KEY);
    if (stored) {
      const cached = JSON.parse(stored);
      if (cached && cached.ts && (Date.now() - cached.ts < CACHE_TTL_MS) && Array.isArray(cached.data)) {
        cachedExtractedAt = cached.extractedAt || null;
      }
    }
  } catch {}

  // 항상 Gist 의 최신 extractedAt 빠르게 확인 (HEAD 같은 거 안 됨, GET 짧게)
  // 다행히 ereter-data.json 가 그렇게 크지 않으니 fetch 하면서 compare
  // batch (라이벌 다수) 처리 시 두 번째부터 ereter fetch 도 skip — 메모리 캐시
  if (window.__ohsorryEreterCache) {
    ereterData = window.__ohsorryEreterCache.charts;
    ereterExtractedAt = window.__ohsorryEreterCache.extractedAt;
    ereterPlayers = window.__ohsorryEreterCache.players;
    console.log(`[step2] ereter 메모리 캐시 hit (${ereterData.length}개)`);
  } else {
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
  // 메모리 캐시 저장 — 다음 compute 호출 시 fetch skip
  window.__ohsorryEreterCache = { charts: ereterData, extractedAt: ereterExtractedAt, players: ereterPlayers };
  }
  console.log(`[step2] ereter 차트 ${ereterData.length}개 로드`);

  // 모듈 lifetime memory cache — batch (라이벌 다수) 처리 시 두 번째 호출부터 외부 lib fetch skip.
  // 페이지 reload 시 다시 받음 (localStorage 캐시는 24h TTL 별도로 동작).
  window.__ohsorryLibCache = window.__ohsorryLibCache || {};

  // -------- 0.55. textage 채보 메타 fetch (선택, 실패해도 무시) --------
  // 채보별 총 노트 수 → charts 의 noteCount 보강 + missCount 계산 (noteCount - pgreat - great).
  //   캐시 형식 호환 — ohSorryWeb 일부 경로가 raw 전체 (`{generatedAt, count, songs}`) 를 set
  //   하는 케이스 보완. `.songs` 가 있으면 그것만 사용, 없으면 자체 (= 곡 id → entry Map).
  let textageSongs = null;
  if (window.__ohsorryLibCache.textage) {
    const cached = window.__ohsorryLibCache.textage;
    textageSongs = (cached && cached.songs && typeof cached.songs === 'object') ? cached.songs : cached;
    console.log(`[step2] textage 채보 메타 ${Object.keys(textageSongs).length}곡 (memory cache hit)`);
  } else try {
    const res = await fetch(TEXTAGE_DATA_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (res.ok) {
      const raw = await res.json();
      if (raw && raw.songs && typeof raw.songs === 'object') {
        textageSongs = raw.songs;
        window.__ohsorryLibCache.textage = textageSongs;
        console.log(`[step2] textage 채보 메타 ${Object.keys(textageSongs).length}곡 로드`);
      }
    }
  } catch (e) {
    console.warn('[step2] textage fetch 실패 (무시 가능):', e.message);
  }

  // -------- 0.6. ohSorryRating 데이터 + 별값 lib fetch (localStorage 캐시) --------
  //   fetch 실패 시 localStorage 캐시 사용. 캐시도 없으면 별값 산출 불가.
  const GIST_RAW = 'https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw';
  const OHSORRY_RATING_URL = GIST_RAW + '/ohSorryRating.json';
  // v3.3.5: OSR13.5+ (bin50 + 50% 임계 + 상향 bin 부분 보너스) — onlyOSRtoEreter 의 13.5 tier 의존
  const CALC_OSR135_URL = GIST_RAW + '/OSR13.5%2B.js';
  // v3.4.0: onlyOSR (전체곡 50% native) + onlyOSRtoEreter (ereter★ 변환, OSR13.5 tier). [Phase 2-0] oldOSR/osr/adopt 제거
  const CALC_ONLYOSR_URL = GIST_RAW + '/onlyOSR.js';
  const CALC_ONLYOSR2E_URL = GIST_RAW + '/onlyOSRtoEreter.js';

  // 외부 lib 메모리 캐시 (페이지 lifetime 유지) — batch (라이벌 다수) 처리 시 두 번째부터 fetch skip
  if (!window.__ohsorryLibCache) window.__ohsorryLibCache = {};

  // localStorage 캐시 헬퍼 — memory > network fetch > localStorage 순으로 fallback
  const loadWithCache = async (url, cacheKey, isJson) => {
    // memory cache 우선 — batch (라이벌 다수) 처리 시 두 번째 호출부터 fetch skip
    if (window.__ohsorryLibCache[cacheKey]) {
      return window.__ohsorryLibCache[cacheKey];
    }
    try {
      const res = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = isJson ? await res.json() : await res.text();
      try {
        localStorage.setItem(cacheKey, isJson ? JSON.stringify(data) : data);
        localStorage.setItem(cacheKey + ':ts', new Date().toISOString());
      } catch {}
      const result = { data, source: 'fetch' };
      window.__ohsorryLibCache[cacheKey] = result;
      return result;
    } catch (e) {
      const cached = localStorage.getItem(cacheKey);
      if (cached != null) {
        const ts = localStorage.getItem(cacheKey + ':ts') || '시간 불명';
        console.warn(`[step2] ${cacheKey} fetch 실패 (${e.message}) → localStorage 캐시 사용 (${ts})`);
        const result = { data: isJson ? JSON.parse(cached) : cached, source: 'cache' };
        window.__ohsorryLibCache[cacheKey] = result;
        return result;
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

  // [Phase 2-0] 별값 lib: OSR13.5+ + onlyOSR + onlyOSRtoEreter (구 oldOSR/osr/adopt 제거 — 결과가 사장됐었음).
  //   eval 은 UMD wrapper 라 window.OSR135 / window.onlyOSR / window.onlyOSRtoEreter 글로벌 등록.
  let osr135Lib = null;
  let onlyOSRLib = null, onlyOSR2eLib = null;  // v3.4.0 (+ Phase 2-0)
  // v3.3.5: OSR13.5+ lib (13.5 이상 ★ 정확도 ↑) — onlyOSRtoEreter 13.5 tier 의 window.OSR135 의존
  try {
    const { data: osr135Src, source: src135 } = await loadWithCache(CALC_OSR135_URL, 'ohSorry:libOSR135', false);
    (new Function(osr135Src))();
    osr135Lib = window.OSR135;
    if (!osr135Lib) throw new Error('OSR135 global 등록 실패');
    console.log(`[step2] OSR13.5+.js v${osr135Lib.version} 로드 (${src135})`);
  } catch (e) {
    console.error('[step2] OSR13.5+.js 로드 실패:', e.message);
  }
  // v3.4.0: onlyOSR + onlyOSRtoEreter (★ = native 50% → ereter 변환, OSR13.5 tier). window.OhsorryNorm/OSR135 선행 필요(이미 로드됨).
  try {
    const { data: ooSrc } = await loadWithCache(CALC_ONLYOSR_URL, 'ohSorry:libOnlyOSR', false);
    (new Function(ooSrc))();
    onlyOSRLib = window.onlyOSR;
    if (!onlyOSRLib) throw new Error('onlyOSR global 등록 실패');
    const { data: o2eSrc } = await loadWithCache(CALC_ONLYOSR2E_URL, 'ohSorry:libOnlyOSR2e', false);
    (new Function(o2eSrc))();
    onlyOSR2eLib = window.onlyOSRtoEreter;
    if (!onlyOSR2eLib) throw new Error('onlyOSRtoEreter global 등록 실패');
    console.log(`[step2] onlyOSR v${onlyOSRLib.version} + onlyOSRtoEreter v${onlyOSR2eLib.version} 로드`);
  } catch (e) {
    console.warn('[step2] onlyOSR/onlyOSRtoEreter 로드 실패 — ★/native_star 미산출(기존 supabase 값 보존):', e.message);
  }
  // -------- 1. 곡명 정규화 + 인덱싱 --------
  // [중복 제거] 곡명 norm = normTitle.js 단일 정본(window.OhsorryNorm, wrapper 가 먼저 fetch+eval).
  //   인라인 "간이 norm" 폐기 — 웹/INF/레이팅과 같은 강한 norm 으로 통일(Ø→0 등). dbConn 도 동일 모듈.
  const norm = window.OhsorryNorm.norm;

  const ereterMap = new Map();
  for (const c of ereterData) {
    if (!c.title || !c.diff) continue;
    ereterMap.set(norm(c.title) + '|' + c.diff, c);
  }

  // ohSorry 추정 차트 인덱스 (ereter 와 같은 키 형식, ec/hc 만) — chartScoreRows 의 level fallback 용.
  const ratingMap = new Map();
  for (const r of ohSorryRatings) {
    if (!r.title || !r.diff) continue;
    if (typeof r.estEc !== 'number' && typeof r.estHc !== 'number') continue;
    ratingMap.set(norm(r.title) + '|' + r.diff, r);
  }

  // -------- 2. 대상 페이지 설정 (series 단일 모드) --------
  // [2026-06-16] level 모드 폐기 — series.html 시리즈 폴더 단위만. 시리즈가 seriesNo 를 주므로
  //   dbConn 의 song_id / textage_song_id / series_no 매칭이 정확. gameLevel 은 textage 로 역추정(4.5).
  //   wrapper 모달이 수집할 시리즈를 고름 — opts.seriesList(eamuse list 값 0~32 배열). 생략 시 전체 33개.
  const SERIES = '33';            // 현재 시즌 (Sparkle Shower)
  const isSpMode = opts.playStyle === 'SP';   // SP 모드 — style=0 크롤 + ★분석 스킵(경량)
  const style = isSpMode ? '0' : '1';         // 0=SP / 1=DP
  const disp = '1';
  const seriesList = (Array.isArray(opts.seriesList) && opts.seriesList.length > 0)
    ? [...new Set(opts.seriesList.map(Number).filter((n) => n >= 0 && n <= 32))].sort((a, b) => a - b)
    : Array.from({ length: 33 }, (_, i) => i);   // 전체 33개 (기본)
  // 별값(★)은 전체 차트가 있어야 정확 — 일부 시리즈만 크롤하면 데이터 불완전 → 별값 계산 skip(기존 supabase 값 보존).
  const fullCrawl = seriesList.length >= 33;

  // 도메인 체크 — eagate(p.eagate.573.jp) 에서만 의미 있음. 다른 도메인이면 안내 후 이동.
  if (!location.hostname.endsWith('p.eagate.573.jp')) {
    const msg = isRival
      ? '라이벌 오소리는 p.eagate.573.jp 의 라이벌 페이지에서 실행해야 합니다. 이동할까요?'
      : 'p.eagate.573.jp 에서 실행해야 결과를 볼 수 있어요. 이동할까요?';
    if (window.confirm(msg)) location.href = 'https://p.eagate.573.jp/';
    return;
  }

  // -------- 3. eagate 페이지 파싱은 modules/eagateFetch.js (v0.0.1+) 로 분리 --------
  //   parseDoc (difficulty.html level 모드) + parseSeriesDoc (series.html series 모드)
  //   둘 다 eagateFetch 모듈 안의 private 함수. core 는 결과 차트 배열만 받음.

  // -------- 4. allCharts / pageCount — eagateFetch 결과 보관 --------
  let allCharts = [];
  let pageCount = 0;

  // 진행 상황을 화면에 표시 (긴 대기 시간 동안 사용자가 진행도 볼 수 있게)
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
  const updateProgress = (text, pct) => {
    const t = document.getElementById('__dp_progress_text');
    const b = document.getElementById('__dp_progress_bar');
    if (t) t.textContent = text;
    if (b) b.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  };

  // 수집 실행 — eagateFetch 모듈에 위임 (modules/eagateFetch.js). { ok, charts, pageCount } return.
  if (!window.OhsorryEagateFetch || !window.OhsorryEagateFetch.collectCharts) {
    alert('eagateFetch 모듈이 로드되지 않았어요. 페이지 새로고침 후 재시도해주세요.');
    return;
  }
  const r = await window.OhsorryEagateFetch.collectCharts({
    seriesList,
    series: SERIES,
    style, disp,
    isRival, rivalToken,
    updateProgress,
  });
  if (!r.ok) return;  // 수집 실패 → 중단 (alert 는 eagateFetch 내부에서 이미 표시)
  allCharts = r.charts;
  pageCount = r.pageCount;
  updateProgress(`완료! 시리즈 ${pageCount}개 ${allCharts.length}곡`, 100);
  // 잠시 후 진행 패널 제거 (점수 패널이 같은 위치에 뜨므로)
  await new Promise((rs) => setTimeout(rs, 500));
  document.getElementById('__dp_progress')?.remove();

  if (allCharts.length === 0) {
    alert('곡을 하나도 못 찾았어요. 페이지 구조가 변경됐을 수 있습니다.');
    return;
  }

  // -------- 4.5. textage 로 gameLevel 역추정 (series 페이지엔 레벨 정보 없음) --------
  //   series.html 은 게임레벨(★)을 안 주므로 textage levels 로 채운다. style 별 키: SP=S* / DP=D*.
  //   gameLevel 용도: dbPayload lv12 카운트 + chartScoreRows.game_level + SP 점수 필터.
  //   (noteCount 는 업로드에 안 쓰여 미보강 — 피처는 dbConn 이 자체 계산.)
  //   동명이곡(norm 충돌, 한 키에 여러 엔트리)은 해당 diff 채보가 실재(레벨≥1)하는 엔트리 우선.
  const SP_DIFF_KEY = { NORMAL: 'SN', HYPER: 'SH', ANOTHER: 'SA', LEGGENDARIA: 'SX', BEGINNER: 'SB' };
  const DP_DIFF_KEY = { NORMAL: 'DN', HYPER: 'DH', ANOTHER: 'DA', LEGGENDARIA: 'DX', BEGINNER: 'DB' };
  let textageLevelsByNorm = null;
  if (textageSongs) {
    const stripHtml = (s) => (s || '').replace(/<[^>]*>/g, '');
    textageLevelsByNorm = {};
    for (const id in textageSongs) {
      const s = textageSongs[id];
      if (!s || !s.levels || !s.title) continue;
      const key = norm(stripHtml(s.title));
      (textageLevelsByNorm[key] = textageLevelsByNorm[key] || []).push(s.levels);
    }
  }
  function fillGameLevel(charts, isSp) {
    if (!textageLevelsByNorm) return;
    const KEY = isSp ? SP_DIFF_KEY : DP_DIFF_KEY;
    let filled = 0;
    for (const c of charts) {
      if (c.gameLevel != null) continue;
      const entries = textageLevelsByNorm[norm(c.title)];
      if (!entries) continue;
      const tKey = KEY[c.diff];
      if (!tKey) continue;
      const chosen = entries.find((e) => typeof e[tKey] === 'number' && e[tKey] >= 1) || entries[0];
      if (typeof chosen[tKey] === 'number' && chosen[tKey] >= 1) { c.gameLevel = chosen[tKey]; filled++; }
    }
    console.log(`[step2] textage gameLevel 역추정(${isSp ? 'SP' : 'DP'}): ${filled}곡`);
  }
  fillGameLevel(allCharts, isSpMode);

  // -------- 4.6. series 모드 — 실재하지 않는 채보 칸 제거 --------
  // series.html 은 곡마다 BEGINNER~LEGGENDARIA 5칸을 항상 렌더한다 (DP BEGINNER 처럼
  // 채보가 없는 칸도 clflg0 + ---.gif + 0(0/0) 으로). 아래 중 하나라도 만족하면 남긴다:
  //   - textage levels 로 게임레벨이 확인된 차트
  //   - 플레이 흔적이 있는 차트 — 클리어램프(lampNum>0) 또는 EX점수(exScore>0).
  //     점수 0 이어도 램프(FAILED~FULL COMBO)만 있으면 실재 채보로 보고 유지.
  //   - ereter / rating 에 등록된 차트
  {
    const before = allCharts.length;
    allCharts = allCharts.filter((c) =>
      c.gameLevel != null ||
      c.lampNum > 0 ||
      c.exScore > 0 ||
      ereterMap.has(norm(c.title) + '|' + c.diff) ||
      ratingMap.has(norm(c.title) + '|' + c.diff),
    );
    console.log(`[step2] series 유령 차트 제거: ${before} → ${allCharts.length}차트`);
  }

  // -------- 5. lv12-only 판정 (업로드 lv12 카운트 분기용) --------
  //   LEVEL 12 플레이 곡 ≥ 30 → lv12 only, 미만 → lv11+lv12 통합. dbPayload 의 n_cleared/n_played 카운트에 사용.
  const nLv12PlayedAll = allCharts.filter((c) => c.gameLevel === 12 && c.lampNum > 0).length;
  const useOnlyLv12 = nLv12PlayedAll >= 30;
  console.log(`[step2] LEVEL 12 플레이 ${nLv12PlayedAll}곡 → ${useOnlyLv12 ? 'lv12 only' : 'lv11+lv12 통합'} (업로드 카운트)`);

  // ----- 별값 (★) — v3.4.0: onlyOSR(전체곡 native 50%) + onlyOSRtoEreter(ereter★, OSR13.5 tier) -----
  //   onlyOSRtoEreter 가 산출. 실패/미로드 시 star/native_star = null → 업로드에서 기존 supabase 값 보존 + console.warn.
  let starEstimate = null;
  let starRaw = null;     // raw_s 는 현재 산출 안 함(업로드 시 null) — 컬럼 호환 유지
  let nativeStar = null;
  if (!fullCrawl) {
    console.log('[step2] 일부 시리즈만 크롤 — 별값(★) 계산 skip (전체 차트 필요, 기존 supabase 값 보존)');
  } else if (onlyOSR2eLib && ratingData) {
    try {
      const r2e = onlyOSR2eLib.inferEreter(allCharts, ratingData, { charts: ereterData, players: ereterPlayers || {} });
      if (typeof r2e.ereterStar === 'number') {
        starEstimate = r2e.ereterStar;
        nativeStar = typeof r2e.ohsorryStar === 'number' ? r2e.ohsorryStar : null;
        console.log(`[step2] ★ = onlyOSRtoEreter ${starEstimate.toFixed(2)} (native ${nativeStar != null ? nativeStar.toFixed(2) : 'N/A'}, tier ${r2e.tier})`);
      } else {
        console.warn('[step2] onlyOSRtoEreter ereterStar 없음 — ★/native_star 미산출(기존 supabase 값 보존)');
      }
    } catch (e) { console.warn('[step2] onlyOSRtoEreter 실패 — ★/native_star 미산출(기존 supabase 값 보존):', e.message); }
  } else {
    console.warn('[step2] onlyOSRtoEreter 미로드 — ★/native_star 미산출(기존 supabase 값 보존)');
  }

  // -------- 5.6. status 페이지에서 프로필 정보 fetch --------
  // 쿠프로(クプロ) 이미지, DJ 이름, IIDX ID, SP/DP 단위(段位), 노트레이더 등
  let profile = null;
  updateProgress('프로필 정보 fetch 중...', 96);
  try {
    const statusUrl = isRival
      ? 'https://p.eagate.573.jp/game/2dx/33/djdata/rival/rival_status.html?rival=' + encodeURIComponent(rivalToken)
      : 'https://p.eagate.573.jp/game/2dx/33/djdata/status.html';
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

  // 레이더 데이터 유효성 — 객체이고 6개 카테고리 중 하나라도 숫자값이 있어야 함.
  // (null / undefined / 빈 객체 {} 면 레이더 영역 자체를 만들지 않음)
  const RADAR_CATS = ['NOTES', 'CHORD', 'PEAK', 'CHARGE', 'SCRATCH', 'SOF-LAN'];
  const hasRadarData = (r) =>
    !!r && typeof r === 'object' &&
    (RADAR_CATS.some((c) => typeof r[c] === 'number') || typeof r.total === 'number');
  const profileHasRadar = !!profile && (hasRadarData(profile.spRadar) || hasRadarData(profile.dpRadar));

  // ===== SP 모드 (경량) — ★추정/추천 전부 스킵. 점수 크롤 + DJ명/단위 + 오소리웹 이동 패널. =====
  //   본인(own)이면 SP10~12 자동 업로드(play_style:0). 라이벌/DB모드는 표시만(업로드 X).
  if (isSpMode) {
    const spIidx = profile && profile.iidxId ? profile.iidxId.replace(/-/g, '') : null;
    const spPlayed = (allCharts || []).filter((c) => c.exScore > 0 || c.lampNum > 0);
    let spUploaded = null;
    if (!isRival && spIidx && window.OhsorryDb && window.OhsorryDb.upsertUserChartScores) {
      // 5.6b. 프로필(users + user_radars) 저장 — SP 모드는 ★분석을 안 하므로 star/ereter_star 를 새로
      //   계산하지 않는다. upsert_user 가 그 둘을 EXCLUDED 로 무조건 덮어쓰는 정책(02_users.sql)이라,
      //   기존 값을 조회해 그대로 재전송(없으면 null). dj_name/sp_rank/dp_rank/radar 는 status fetch 값으로 갱신.
      try {
        let prevStar = null, prevEreterStar = null;
        if (window.OhsorryDb.fetchUserStars) {
          const prev = await window.OhsorryDb.fetchUserStars(spIidx);
          if (prev) { prevStar = prev.star; prevEreterStar = prev.ereter_star; }
        }
        await window.OhsorryDb.upsertUserProfile({
          iidx_id: spIidx,
          dj_name: profile.djName || null,
          star_estimate: prevStar,       // 기존값 보존 (없으면 null)
          ereter_star: prevEreterStar,   // 기존값 보존 (없으면 null)
          sp_rank: profile.spRank || null,
          dp_rank: profile.dpRank || null,
          notes_radar: profileHasRadar
            ? { sp: hasRadarData(profile.spRadar) ? profile.spRadar : null, dp: hasRadarData(profile.dpRadar) ? profile.dpRadar : null }
            : null,
        });
      } catch (e) { console.warn('[SP profile upsert]', e && e.message); }

      const spRows = spPlayed
        .filter((c) => c.gameLevel >= 10 && c.gameLevel <= 12)
        .map((c) => ({
          played_version: SERIES, title: c.title, iidx_id: spIidx, diff: c.diff,
          game_level: c.gameLevel, ex_score: c.exScore != null ? c.exScore : null,
          lamp: c.lamp || null, play_style: 0, date: new Date().toISOString(),
        }));
      if (spRows.length) {
        try { const res = await window.OhsorryDb.upsertUserChartScores(spRows); spUploaded = (res && res.ok) ? spRows.length : null; }
        catch (e) { console.warn('[SP upload]', e && e.message); }
      }
    }
    const spResult = {
      spMode: true, mode, isRival, wrapperVersion, dbVersionString,
      profile, spRank: profile ? (profile.spRank || null) : null,
      iidxId: spIidx, spChartCount: spPlayed.length, spUploaded,
    };
    // own 만 완료 박스(rival SP 는 DP 경로 끝에서 보강 업로드).
    if (!isRival) __ohsorryShowDone(profile, 'SP');
    __ohsorryHideSpinner();
    return spResult;
  }

  // -------- 5.7. ereter★ (업로드 ereter_star 용) --------
  //   ereter.net 이 산정한 그 유저의 ★ (있으면). dbPayload.ereter_star 로 저장.
  const idNormForRec = profile && profile.iidxId ? profile.iidxId.replace(/-/g, '') : null;
  const eraterTrueStar = (idNormForRec && ereterPlayers) ? ereterPlayers[idNormForRec] : null;

  // -------- 6. 업로드 payload build (users 프로필 + scores rows) --------
  let dbPayload = null;
  let chartScoreRows = null;
  if (profile && profile.iidxId) {
    const iidxIdNorm = profile.iidxId.replace(/-/g, '');
    const nowIso = new Date().toISOString();
    // 부분 크롤이면 별값 미계산 → 기존 star 를 조회해 그대로 재전송(upsert_user 의 star EXCLUDED 덮어쓰기로 null wipe 방지).
    //   native_star 는 COALESCE 라 null 전송 시 자동 보존. ereter_star 는 ereter 룩업(크롤 무관)이라 그대로.
    let preservedStar = null;
    if (!fullCrawl && window.OhsorryDb && window.OhsorryDb.fetchUserStars) {
      try { const prev = await window.OhsorryDb.fetchUserStars(iidxIdNorm); if (prev && prev.star != null) preservedStar = prev.star; } catch {}
    }
    let nPlayedLv12 = 0, fcCount = 0, exhCount = 0, hcCount = 0, nClearedLv12 = 0;
    for (const c of allCharts) {
      if (useOnlyLv12 && c.gameLevel !== 12) continue;
      const e = ereterMap.get(norm(c.title) + '|' + c.diff);
      if (!e || e.level == null || e.level < 11.6 || e.level > 12.7) {
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
    dbPayload = {
      iidx_id: iidxIdNorm,
      dj_name: profile.djName || null,
      star_estimate: starEstimate != null ? Number(starEstimate.toFixed(4)) : (preservedStar != null ? Number(preservedStar) : null),  // 부분 크롤이면 기존값 보존
      native_star: nativeStar != null ? Number(nativeStar.toFixed(4)) : null,  // v3.4.0: onlyOSR 전체곡 native (null → COALESCE 보존)
      ereter_star: eraterTrueStar != null ? Number(eraterTrueStar) : null,
      raw_s: starRaw != null ? Number(starRaw.toFixed(4)) : null,
      version: dbVersionString,
      sp_rank: profile.spRank || null,
      dp_rank: profile.dpRank || null,
      n_cleared: nClearedLv12,
      n_played_lv12: nPlayedLv12,
      fc_count: fcCount,
      hc_count: hcCount,
      exh_count: exhCount,
      level_filter: 'lv12',
      series: SERIES,
      // v3.3.6 core 0.0.345 — charts_json=null. user_chart_scores 가 single source of truth.
      //   게스트 페이지 서열표는 get_user_charts RPC 로 fallback. INFOhSorry / ereter backfill 도 동일.
      //   디스크 부담 큰 jsonb (~270KB/user) 제거 + 중복 데이터 정리.
      charts_json: null,
      notes_radar: profileHasRadar
        ? { sp: hasRadarData(profile.spRadar) ? profile.spRadar : null, dp: hasRadarData(profile.dpRadar) ? profile.dpRadar : null }
        : null,
    };
    // 점수가 있거나, 한 번이라도 플레이해 램프가 붙은(FAILED 포함) 차트만 — NO PLAY 만 제외
    chartScoreRows = allCharts.filter((c) => c.exScore > 0 || c.lampNum > 0).map((c) => {
      const key = norm(c.title) + '|' + c.diff;
      const r = ratingMap.get(key);
      const e = ereterMap.get(key);
      return {
        played_version: SERIES,
        level: r && typeof r.zasaLevel === 'number' ? r.zasaLevel : (e && typeof e.level === 'number' ? e.level : null),
        title: c.title,
        iidx_id: iidxIdNorm,
        dj_name: profile.djName || null,
        diff: c.diff,
        game_level: c.gameLevel != null ? c.gameLevel : null,
        dj_level: c.djLevel != null ? c.djLevel : null,
        ex_score: c.exScore != null ? c.exScore : null,
        lamp: c.lamp || null,
        date: nowIso,
      };
    });
  }

  // result — 업로드 전용. uploadResult 는 dbPayload + chartScoreRows 만 사용(피처는 dbConn 이 iidx_id 로 자체 계산).
  //   rivalOhsorry 배치가 result.dbPayload(iidx_id/dj_name/dp_rank)로 최종 목록을 만들므로 dbPayload 는 노출.
  const result = { dbPayload, chartScoreRows };

  // -------- 7. 업로드 (users 프로필 + scores + 피처) --------
  //   own = 완료 박스(djName/iidxId/단위 + 오소리웹 버튼), rival = 조용히 업로드(최종 목록은 wrapper renderRivalList).
  if (window.OhsorryDb && window.OhsorryDb.uploadResult) {
    try {
      const up = await window.OhsorryDb.uploadResult(result);
      if (up && up.skipped) console.log(`[오소리] 업로드 skip (${up.reason})`);
      else {
        console.log('[오소리] 업로드 완료 — https://iidx.in 에서 내 카드 확인.');
        if (!isRival) __ohsorryShowDone(profile, 'DP');
      }
    } catch (e) {
      console.warn('[OhsorryCore] uploadResult 예외:', e && e.message);
    }
  } else {
    console.warn('[OhsorryCore] OhsorryDb.uploadResult 없음 — 업로드 못 함');
  }

  // 라이벌도 SP 같이 — DP 업로드 후 라이벌 SP 도 series 크롤해 play_style:0 으로 업로드(웹 SP 표시용).
  //   수집 시리즈는 DP 와 동일(seriesList). 점수 행은 아래에서 gameLevel 10~12 로 필터.
  if (isRival && profile && profile.iidxId
      && window.OhsorryEagateFetch && window.OhsorryEagateFetch.collectCharts
      && window.OhsorryDb && window.OhsorryDb.upsertUserChartScores) {
    try {
      const spR = await window.OhsorryEagateFetch.collectCharts({
        seriesList, series: SERIES,
        style: '0', disp, isRival: true, rivalToken,
        updateProgress: (msg) => console.log('[rival SP]', msg),
      });
      if (spR && spR.ok) {
        fillGameLevel(spR.charts || [], true);   // series 페이지엔 레벨 없음 → SP textage 레벨로 역추정 (필터용)
        const spIid = profile.iidxId.replace(/-/g, '');
        const nowIsoR = new Date().toISOString();
        const spRows = (spR.charts || [])
          .filter((c) => (c.exScore > 0 || c.lampNum > 0) && c.gameLevel >= 10 && c.gameLevel <= 12)
          .map((c) => ({
            played_version: SERIES, title: c.title, iidx_id: spIid, diff: c.diff,
            game_level: c.gameLevel, ex_score: c.exScore != null ? c.exScore : null,
            lamp: c.lamp || null, play_style: 0, date: nowIsoR,
          }));
        if (spRows.length) await window.OhsorryDb.upsertUserChartScores(spRows);
      }
    } catch (e) { console.warn('[rival SP] 실패:', e && e.message); }
  }

  __ohsorryHideSpinner();
  return result;
  // compute: async (opts) => { ... } 의 본문 끝
  },
};
// 자동 실행 / 노출 함수 (__dp_render, __dp_render_rival 등) 는 wrapper 가 담당.
// core 자체는 window.OhsorryCore 만 등록하고 종료.
