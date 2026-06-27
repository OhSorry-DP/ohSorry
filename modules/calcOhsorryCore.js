// ============================================================
// calcOhsorryCore — 오소리 크롤러 핵심 모듈 (본인 + 라이벌 통합 — 라이벌은 IIDX ID 입력으로 분기).
// ============================================================
// [구조개편 2C] 크롤 → 별값(★) → supabase 업로드 전용. 추천/렌더/표시는 ohSorryWeb·ohSorryRating(gist 모듈)이 담당.
//   웹·INF 는 코어를 안 쓰고(코어-free, ohsorryRender 직접 호출), 코어는 eagate 업로더에서만 실행된다.
//
// 동작:
//   1. Gist 에서 ereter / textage / ohSorryRating JSON + 별값 lib(OSR13.5+/onlyOSR/onlyOSRtoEreter) fetch
//   2. eagateFetch 모듈로 series.html 시리즈 폴더 크롤 (클리어램프 + EX점수 + 차트). gameLevel 은 textage 역추정.
//   3. 별값(★) 추정 = onlyOSRtoEreter (native onlyOSR → ereter★, OSR13.5 tier)
//   4. status.html 로 프로필(DJ명 / IIDX ID / SP·DP 단위 / 노트레이더) 추출
//   5. dbConn.uploadResult 직접 호출 — users 프로필 + scores + 28피처(user_ohsorry_radars) 업로드
//   6. 완료 박스(djName / iidxId / 단위 + 오소리웹 버튼) — own·rival 공통. SP/DP 는 모달 토글대로(DP만/SP만).
//
// opts:
//   mode: 'own' | 'rival'  (기본 'own')
//   rivalToken: rival 모드 시 URL 의 rival 토큰 (옵션 — 본인 모드는 무시)
//   seriesList / playStyle: 크롤 범위 (wrapper 모달이 결정 — 시리즈 list 값 0~32, 생략 시 전체)
//   suppressDone: true 면 완료 박스(__ohsorryShowDone) 생략 — 여러 명 처리 시 wrapper 가 showDoneList 로 한 번에 표시
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
// 완료 박스 "오소리웹 카드" 링크 — SP 면 SP 리센트(#ps@SP), DP 는 기본(웹 기본 모드). idNorm=하이픈 제거 IIDX ID.
function __ohsorryCardUrl(idNorm, style) {
  if (!idNorm) return 'https://iidx.in/';
  const ps = style === 'SP' ? '#ps@SP' : '';
  return `https://iidx.in/#user@${idNorm}${ps}#tab@recent`;
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
  const webUrl = __ohsorryCardUrl(idNorm, style);
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

// 여러 명(IIDX ID 여러 개) 업로드 완료 시 — DJ명 · IIDX ID · 단위 · 이동버튼을 한 줄(가로)로 한 명씩.
//   entries: [{ profile, style:'SP'|'DP' }]. 1명이면 단일 박스(__ohsorryShowDone)로 위임.
function __ohsorryShowDoneList(entries) {
  if (typeof document === 'undefined') return;
  __ohsorryHideSpinner();
  document.getElementById('__ohsorry_done')?.remove();
  const list = (entries || []).filter((e) => e && e.profile);
  if (list.length === 0) return;
  if (list.length === 1) { __ohsorryShowDone(list[0].profile, list[0].style); return; }
  const rowsHtml = list.map((e) => {
    const p = e.profile || {};
    const dj = (p.djName || '?').replace(/[<>]/g, '');
    const id = p.iidxId || '';
    const idNorm = id.replace(/-/g, '');
    const webUrl = __ohsorryCardUrl(idNorm, e.style);
    const rankRaw = (e.style === 'SP' ? p.spRank : p.dpRank) || '';
    const hasRank = rankRaw && rankRaw !== '---' && rankRaw !== '-';
    const rankTxt = hasRank ? `${e.style === 'SP' ? 'SP' : 'DP'} ${String(rankRaw).replace(/[<>]/g, '')}` : '';
    // 한 줄: DJ명(가변·말줄임) · IIDX ID(고정) · 단위(고정) · 이동(고정)
    return (
      '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid #f0f1f3;white-space:nowrap">' +
        `<span title="${dj}" style="flex:1 1 auto;min-width:40px;overflow:hidden;text-overflow:ellipsis;font-size:13px;font-weight:600">${dj}</span>` +
        (id ? `<span style="flex:none;font-size:11px;color:#868e96;font-family:monospace">${id}</span>` : '') +
        (rankTxt ? `<span style="flex:none;font-size:11.5px;color:#495057">${rankTxt}</span>` : '') +
        `<a href="${webUrl}" target="_blank" rel="noopener" ` +
          'style="flex:none;padding:6px 9px;background:#1d9e75;color:#fff;font-size:11.5px;font-weight:600;border-radius:6px;text-decoration:none">이동 →</a>' +
      '</div>'
    );
  }).join('');
  const el = document.createElement('div');
  el.id = '__ohsorry_done';
  el.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;background:#fff;border:1px solid #d7dbe0;border-radius:8px;padding:12px 14px 14px;width:max-content;max-width:min(360px, calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;box-sizing:border-box;box-shadow:0 6px 18px rgba(0,0,0,.18);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#212529';
  el.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:2px">' +
      `<div style="font-size:14px;font-weight:700;color:#1d9e75">✅ 업로드 완료 (${list.length}명)</div>` +
      '<button id="__ohsorry_done_x" style="background:transparent;border:0;color:#aaa;cursor:pointer;font-size:18px;line-height:1;padding:0 2px">×</button>' +
    '</div>' +
    rowsHtml;
  document.body.appendChild(el);
  el.querySelector('#__ohsorry_done_x')?.addEventListener('click', () => el.remove());
}

// ============================================================
// 공유 헬퍼 — compute / prefetch / fetchProfile / fetchRivalToken 가 함께 쓰는 데이터 로딩·파싱.
//   window 캐시(__ohsorryEreterCache / __ohsorryLibCache)로 idempotent — 두 번째 호출은 즉시 반환.
// ============================================================
// var (const 아님) — wrapper 가 모듈을 매 실행 재eval 하므로 최상위 재선언 SyntaxError 방지.
var __GIST_RAW = 'https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw';
var __URLS = {
  ereter:    __GIST_RAW + '/ereter-data.json',
  textage:   __GIST_RAW + '/textage-meta.json',
  rating:    __GIST_RAW + '/ohSorryRating.json',
  osr135:    __GIST_RAW + '/OSR13.5%2B.js',     // onlyOSRtoEreter 13.5 tier 의존
  onlyOSR:   __GIST_RAW + '/onlyOSR.js',
  onlyOSR2e: __GIST_RAW + '/onlyOSRtoEreter.js',
  cpi:       __GIST_RAW + '/cpi.json',          // SP12 채보별 램프 CPI (SP 대표 실력값 산출)
  cpiStar:   __GIST_RAW + '/cpiStar.js',        // CPI → 発狂★相当 변환 커널
  spSkillCpi:__GIST_RAW + '/spSkillCpi.js',     // 유저 SP 대표 실력값(sp_cpi/sp_star) 산출 커널(cpiStar 의존)
};
var __ERETER_CACHE_KEY = 'ereter_dp_diff_v4';
var __EAGATE = 'https://p.eagate.573.jp';

// ereter-data.json 형식 정규화 (배열 / {charts} / {charts,players}).
function __normalizeEreterPayload(raw) {
  if (Array.isArray(raw)) return { charts: raw, extractedAt: null, players: null };
  if (raw && typeof raw === 'object' && Array.isArray(raw.charts)) {
    return { charts: raw.charts, extractedAt: raw.extractedAt || null, players: (raw.players && typeof raw.players === 'object') ? raw.players : null };
  }
  return { charts: null, extractedAt: null, players: null };
}

// localStorage 캐시 헬퍼 — memory > network fetch > localStorage 순 fallback.
async function __loadWithCache(url, cacheKey, isJson) {
  window.__ohsorryLibCache = window.__ohsorryLibCache || {};
  if (window.__ohsorryLibCache[cacheKey]) return window.__ohsorryLibCache[cacheKey];
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
      const result = { data: isJson ? JSON.parse(cached) : cached, source: 'cache' };
      window.__ohsorryLibCache[cacheKey] = result;
      return result;
    }
    throw new Error(`${cacheKey}: fetch 실패 + 캐시 없음 — ${e.message}`);
  }
}

// ereter 로드 — 메모리 캐시 우선, network, localStorage fallback. 실패 시 null.
async function __loadEreter() {
  if (window.__ohsorryEreterCache) return window.__ohsorryEreterCache;
  try {
    const res = await fetch(__URLS.ereter + '?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const p = __normalizeEreterPayload(await res.json());
    if (!p.charts || !p.charts.length) throw new Error('빈 데이터');
    window.__ohsorryEreterCache = { charts: p.charts, extractedAt: p.extractedAt, players: p.players };
    try { localStorage.setItem(__ERETER_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: p.charts, extractedAt: p.extractedAt, players: p.players })); } catch {}
    console.log(`[데이터] ereter ${p.charts.length}곡 로드`);
    return window.__ohsorryEreterCache;
  } catch (e) {
    try {
      const s = JSON.parse(localStorage.getItem(__ERETER_CACHE_KEY) || 'null');
      if (s && Array.isArray(s.data)) {
        window.__ohsorryEreterCache = { charts: s.data, extractedAt: s.extractedAt, players: s.players };
        console.warn('[데이터] ereter fetch 실패 → localStorage 캐시 사용:', e.message);
        return window.__ohsorryEreterCache;
      }
    } catch {}
    console.error('[데이터] ereter 로드 실패 (캐시 없음):', e.message);
    return null;
  }
}

// textage 채보 메타 — 캐시 우선. 실패해도 무시(null). gameLevel 역추정용 levels(SP/DP).
async function __loadTextage() {
  window.__ohsorryLibCache = window.__ohsorryLibCache || {};
  if (window.__ohsorryLibCache.textage) {
    const c = window.__ohsorryLibCache.textage;
    return (c && c.songs && typeof c.songs === 'object') ? c.songs : c;
  }
  try {
    const res = await fetch(__URLS.textage + '?t=' + Date.now(), { cache: 'no-store' });
    if (res.ok) {
      const raw = await res.json();
      if (raw && raw.songs && typeof raw.songs === 'object') {
        window.__ohsorryLibCache.textage = raw.songs;
        console.log(`[데이터] textage ${Object.keys(raw.songs).length}곡 로드`);
        return raw.songs;
      }
    }
  } catch (e) { console.warn('[데이터] textage fetch 실패 (무시 가능):', e.message); }
  return null;
}

// 별값 lib eval — OSR13.5+ → onlyOSR → onlyOSRtoEreter. window.OSR135/onlyOSR/onlyOSRtoEreter 글로벌 등록.
async function __loadStarLibs() {
  try {
    const { data } = await __loadWithCache(__URLS.osr135, 'ohSorry:libOSR135', false);
    (new Function(data))();
  } catch (e) { console.error('[데이터] OSR13.5+ 로드 실패:', e.message); }
  try {
    const { data: oo } = await __loadWithCache(__URLS.onlyOSR, 'ohSorry:libOnlyOSR', false);
    (new Function(oo))();
    const { data: o2e } = await __loadWithCache(__URLS.onlyOSR2e, 'ohSorry:libOnlyOSR2e', false);
    (new Function(o2e))();
  } catch (e) { console.warn('[데이터] onlyOSR/onlyOSRtoEreter 로드 실패 — ★ 미산출:', e.message); }
  return window.onlyOSRtoEreter || null;   // 별값 산출에 직접 쓰는 건 onlyOSRtoEreter (OSR13.5+/onlyOSR 은 글로벌 의존)
}

// SP12 CPI 데이터 (cpi.json) — 캐시 우선. 실패해도 무시(null) → SP 대표 실력값 미산출(기존값 보존).
async function __loadCpi() {
  window.__ohsorryLibCache = window.__ohsorryLibCache || {};
  if (window.__ohsorryLibCache.cpi) return window.__ohsorryLibCache.cpi;
  try {
    const { data } = await __loadWithCache(__URLS.cpi, 'ohSorry:cpi', true);
    if (Array.isArray(data)) { window.__ohsorryLibCache.cpi = data; console.log(`[데이터] cpi ${data.length}채보 로드`); return data; }
  } catch (e) { console.warn('[데이터] cpi fetch 실패 (SP 대표 실력값 skip):', e.message); }
  return null;
}

// SP 대표 실력값 커널 eval — cpiStar → spSkillCpi 순(spSkillCpi 가 window.cpiStar 의존). window.spSkillCpi 등록.
async function __loadSpStarLibs() {
  if (window.spSkillCpi && window.cpiStar) return window.spSkillCpi;
  try {
    const { data: cs } = await __loadWithCache(__URLS.cpiStar, 'ohSorry:libCpiStar', false);
    (new Function(cs))();
    const { data: ss } = await __loadWithCache(__URLS.spSkillCpi, 'ohSorry:libSpSkillCpi', false);
    (new Function(ss))();
  } catch (e) { console.warn('[데이터] cpiStar/spSkillCpi 로드 실패 — SP 대표 실력값 skip:', e.message); }
  return window.spSkillCpi || null;
}

// 전체 데이터 로드 (compute + prefetch 공유). 모달 떠 있는 동안 미리 호출하면 compute 가 캐시 hit.
async function __loadCoreData() {
  const ereter = await __loadEreter();
  const textageSongs = await __loadTextage();
  let ratingData = null, ohSorryRatings = [];
  try {
    const { data } = await __loadWithCache(__URLS.rating, 'ohSorry:ratingData', true);
    ratingData = data;
    if (data && Array.isArray(data.ratings)) ohSorryRatings = data.ratings;
  } catch (e) { console.error('[데이터] ohSorryRating 로드 실패:', e.message); }
  const onlyOSR2eLib = await __loadStarLibs();   // OSR13.5+/onlyOSR 는 글로벌 등록(side-effect), 반환은 onlyOSRtoEreter
  const cpiData = await __loadCpi();              // SP12 CPI (SP 모드 대표 실력값용, 실패 시 null)
  const spSkillLib = await __loadSpStarLibs();    // window.spSkillCpi (computeUserSpCpi), 실패 시 null
  return {
    ereterData: ereter ? ereter.charts : null,
    ereterPlayers: ereter ? ereter.players : null,
    textageSongs, ratingData, ohSorryRatings,
    onlyOSR2eLib, cpiData, spSkillLib,
  };
}

// status.html(own) / rival_status.html(rival) → 프로필 파싱 { djName, iidxId, spRank, dpRank, spRadar, dpRadar }.
async function __fetchProfile(opts) {
  opts = opts || {};
  const statusUrl = opts.isRival
    ? __EAGATE + '/game/2dx/33/djdata/rival/rival_status.html?rival=' + encodeURIComponent(opts.rivalToken)
    : __EAGATE + '/game/2dx/33/djdata/status.html';
  const res = await fetch(statusUrl, { credentials: 'include' });
  if (!res.ok) { console.warn('[프로필] fetch 실패 HTTP ' + res.status); return null; }
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  const profile = {};
  // DJ 프로필 테이블 — 업로드에 쓰는 DJ NAME / IIDX ID 만.
  const profileTable = doc.querySelector('div.dj-profile table');
  if (profileTable) {
    profileTable.querySelectorAll('tr').forEach(tr => {
      const tds = tr.querySelectorAll('td');
      if (tds.length === 2) {
        const key = tds[0].textContent.trim();
        const val = tds[1].textContent.trim();
        if (key === 'DJ NAME')      profile.djName = val;
        else if (key === 'IIDX ID') profile.iidxId = val;
      }
    });
  }
  // 段位(단위) / ノーツレーダー
  doc.querySelectorAll('div.dj-rank').forEach(dr => {
    const cn = dr.querySelector('div.cat-name');
    if (!cn) return;
    const catName = cn.textContent.trim();
    if (catName === '段位認定') {
      dr.querySelectorAll('div.rank-cat').forEach(rc => {
        const divs = rc.querySelectorAll('div');
        if (divs.length >= 2) {
          const style = divs[0].textContent.trim();
          const rank = divs[1].textContent.trim();
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
          if (src.startsWith('/')) src = __EAGATE + src;
          else if (!src.startsWith('http')) src = new URL(src, statusUrl).href;
          radar.img = src;
        }
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
  return profile;
}

// IIDX ID → 라이벌 토큰 (rival_search.html POST). 못 찾으면 null.
async function __fetchRivalToken(iidxId) {
  const fd = new FormData();
  fd.append('iidxid', String(iidxId).replace(/-/g, ''));
  fd.append('mode', '1');
  const res = await fetch(__EAGATE + '/game/2dx/33/rival/rival_search.html', { method: 'POST', credentials: 'include', body: fd });
  if (!res.ok) throw new Error('rival_search HTTP ' + res.status);
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  const link = doc.querySelector('table#result a[href*="rival_status.html?rival="]');
  if (!link) return null;
  const m = (link.getAttribute('href') || '').match(/rival=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

window.OhsorryCore = {
  VERSION: '0.0.407',
  prefetch: __loadCoreData,        // 모달 떠 있는 동안 미리 호출 → compute 캐시 hit (로딩 단축)
  fetchProfile: __fetchProfile,    // wrapper 가 모달 상단 프로필 채울 때
  fetchRivalToken: __fetchRivalToken,  // IIDX ID → 라이벌 토큰 (라이벌 모드 판정)
  showDoneList: __ohsorryShowDoneList, // wrapper 가 여러 명 결과를 한 번에 리스트로 표시
  compute: async (opts) => {
  __ohsorryShowSpinner();
  opts = opts || {};
  const mode = opts.mode || 'own';
  const isRival = mode === 'rival';
  const rivalToken = opts.rivalToken || null;
  const wrapperVersion = opts.wrapperVersion || 'unknown';
  const CORE_VERSION_SHORT = '0.0.408'.replace(/^0\.0\./, '');  // '408' — SP 모드 대표 실력값(sp_cpi/sp_star) 산출·업로드
  const dbVersionString = `${wrapperVersion}-core${CORE_VERSION_SHORT}`;

  // -------- 0. 데이터 로드 (ereter/textage/ohSorryRating + 별값 lib) — 모듈 공유 __loadCoreData --------
  //   wrapper 가 모달 떠 있는 동안 Core.prefetch() 로 미리 호출했으면 캐시 hit 으로 즉시 반환(로딩 단축).
  const __D = await __loadCoreData();
  if (!__D.ereterData) {
    alert('ereter 데이터를 못 가져왔어요. 네트워크/Gist 확인 후 다시 시도해주세요.');
    __ohsorryHideSpinner();
    return;
  }
  const { ereterData, ereterPlayers, textageSongs, ratingData, ohSorryRatings, onlyOSR2eLib, cpiData, spSkillLib } = __D;

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
  const seriesList = (Array.isArray(opts.seriesList) && opts.seriesList.length > 0)
    ? [...new Set(opts.seriesList.map(Number).filter((n) => n >= 0 && n <= 32))].sort((a, b) => a - b)
    : Array.from({ length: 33 }, (_, i) => i);   // 전체 33개 (기본)
  // 별값(★)은 전체 차트가 있어야 정확 — 일부 시리즈만 크롤하면 데이터 불완전 → 별값 계산 skip(기존 supabase 값 보존).
  const fullCrawl = seriesList.length >= 33;

  // 도메인 체크 — eagate(p.eagate.573.jp) 에서만 의미 있음(wrapper 가 먼저 체크하지만 직접 호출 대비).
  if (!location.hostname.endsWith('p.eagate.573.jp')) {
    if (window.confirm('p.eagate.573.jp 에서 실행해야 합니다. 이동할까요?')) location.href = 'https://p.eagate.573.jp/';
    return;
  }

  // -------- 3. eagate series 페이지 파싱은 modules/eagateFetch.js 로 분리 (core 는 차트 배열만 받음) --------

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
    style,
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

  // -------- 5.6. 프로필 — own 은 wrapper 가 모달용으로 미리 fetch 한 opts.profile 재사용, rival 은 여기서 fetch --------
  //   own: 같은 status.html 을 두 번 안 받음(모달에서 이미 받음). rival: rival_status.html(토큰)로 라이벌 프로필.
  updateProgress('프로필 정보 fetch 중...', 96);
  let profile = (!isRival && opts.profile) ? opts.profile : await __fetchProfile({ isRival, rivalToken });
  console.log('[step2] 프로필:', profile);

  // 레이더 데이터 유효성 — 객체이고 6개 카테고리 중 하나라도 숫자값이 있어야 함.
  // (null / undefined / 빈 객체 {} 면 레이더 영역 자체를 만들지 않음)
  const RADAR_CATS = ['NOTES', 'CHORD', 'PEAK', 'CHARGE', 'SCRATCH', 'SOF-LAN'];
  const hasRadarData = (r) =>
    !!r && typeof r === 'object' &&
    (RADAR_CATS.some((c) => typeof r[c] === 'number') || typeof r.total === 'number');
  const profileHasRadar = !!profile && (hasRadarData(profile.spRadar) || hasRadarData(profile.dpRadar));

  // ===== SP 모드 (경량) — ★추정/추천 전부 스킵. 점수 크롤 + DJ명/단위 + 오소리웹 이동 패널. =====
  //   own·rival 모두 SP10~12 자동 업로드(play_style:0) + 완료 박스. (대상 IIDX ID 의 프로필/점수를 갱신.)
  if (isSpMode) {
    const spIidx = profile && profile.iidxId ? profile.iidxId.replace(/-/g, '') : null;
    const spPlayed = (allCharts || []).filter((c) => c.exScore > 0 || c.lampNum > 0);
    let spUploaded = null;
    if (spIidx && window.OhsorryDb && window.OhsorryDb.upsertUserChartScores) {
      // 5.6b. 프로필(users + user_radars) 저장 — SP 모드는 ★분석을 안 하므로 star/ereter_star 를 새로
      //   계산하지 않는다. upsert_user 가 그 둘을 EXCLUDED 로 무조건 덮어쓰는 정책(02_users.sql)이라,
      //   기존 값을 조회해 그대로 재전송(없으면 null). dj_name/sp_rank/dp_rank/radar 는 status fetch 값으로 갱신.
      try {
        let prevStar = null, prevEreterStar = null;
        if (window.OhsorryDb.fetchUserStars) {
          const prev = await window.OhsorryDb.fetchUserStars(spIidx);
          if (prev) { prevStar = prev.star; prevEreterStar = prev.ereter_star; }
        }
        // SP 대표 실력값 — SP12 클리어(allCharts) × cpi.json 으로 실력선(클리어율 85% 교차, 게이지 통합) 산출.
        //   표본<5(SP12 클리어 5곡 미만)면 null → upsert_user COALESCE 로 기존 sp_cpi/sp_star 보존.
        let spCpiInt = null, spStarRounded = null;
        if (spSkillLib && cpiData) {
          try {
            const sp = spSkillLib.computeUserSpCpi(allCharts, cpiData, { normFn: norm, mode: 'unified' });
            spCpiInt = sp.cpiInt; spStarRounded = sp.starRounded;
            console.log(`[SP] 대표 실력값 sp_cpi=${spCpiInt} sp_star=${spStarRounded} (pairs ${sp.nPairs})`);
          } catch (e) { console.warn('[SP] computeUserSpCpi 실패:', e && e.message); }
        }
        await window.OhsorryDb.upsertUserProfile({
          iidx_id: spIidx,
          dj_name: profile.djName || null,
          star_estimate: prevStar,       // 기존값 보존 (없으면 null)
          ereter_star: prevEreterStar,   // 기존값 보존 (없으면 null)
          sp_rank: profile.spRank || null,
          dp_rank: profile.dpRank || null,
          sp_cpi: spCpiInt,              // SP 대표 실력값(CPI). null(표본부족)이면 COALESCE 보존
          sp_star: spStarRounded,        // 発狂★相当
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
      profile, style: 'SP', spRank: profile ? (profile.spRank || null) : null,
      iidxId: spIidx, spChartCount: spPlayed.length, spUploaded,
    };
    // own·rival 모두 완료 박스(대상 IIDX ID 의 카드로 이동). 여러 명이면 wrapper 가 리스트로(suppressDone).
    if (!opts.suppressDone) __ohsorryShowDone(profile, 'SP');
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
      raw_s: null,                  // 현재 미산출 (컬럼 호환). native_star/star_estimate 가 별값 정본.
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
  //   profile/style 은 wrapper 의 여러-명 완료 리스트(showDoneList)용.
  const result = { dbPayload, chartScoreRows, profile, style: 'DP' };

  // -------- 7. 업로드 (users 프로필 + scores + 피처) --------
  //   own·rival 모두 완료 박스(djName/iidxId/단위 + 대상 카드 버튼). 대상 IIDX ID 의 데이터를 갱신.
  if (window.OhsorryDb && window.OhsorryDb.uploadResult) {
    try {
      const up = await window.OhsorryDb.uploadResult(result);
      if (up && up.skipped) console.log(`[오소리] 업로드 skip (${up.reason})`);
      else {
        console.log('[오소리] 업로드 완료 — https://iidx.in 에서 카드 확인.');
        if (!opts.suppressDone) __ohsorryShowDone(profile, 'DP');   // 여러 명이면 wrapper 가 리스트로
      }
    } catch (e) {
      console.warn('[OhsorryCore] uploadResult 예외:', e && e.message);
    }
  } else {
    console.warn('[OhsorryCore] OhsorryDb.uploadResult 없음 — 업로드 못 함');
  }

  __ohsorryHideSpinner();
  return result;
  // compute: async (opts) => { ... } 의 본문 끝
  },
};
// 자동 실행 / 모달 / 라이벌 분기는 wrapper(ohsorry.js)가 담당. core 는 함수만 노출.
// core 자체는 window.OhsorryCore 만 등록하고 종료.
