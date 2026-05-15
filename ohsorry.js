// 2-calc-score.js — 오소리 본체 wrapper (v3.3.6)
//
// 모듈 분리:
//   - calcOhsorryCore.js (v0.0.335) : 계산 (ereter/zasa fetch + 페이지 순회 + ★ 추정 + 추천곡 + result build)
//   - ohsorryRender.js   (v0.0.335) : UI (진행률 + 결과 패널 + 추천곡 sortable + 캡처)
//   - dbConn.js          (v0.0.335) : supabase RPC (upsertUserProfile / fetchUserProfile)
//
// 이 wrapper 는 세 모듈을 gist 에서 fetch + eval 한 뒤 Core.compute({mode:'own'}) 만 호출.
//
// 사용법:
//   1. p.eagate.573.jp 도메인 어느 페이지에서나 자동 실행 (eagate fetch 모드)
//   2. 다른 사이트에서 window.__dp_render(dbData) 로 supabase row 를 직접 넘겨 호출 (DB 모드)
//
// supabase version 컬럼: `${WRAPPER_VERSION}-core${CORE_VERSION_SHORT}` (예: 'v3.3.6-core335')
// ============================================================

(async function () {
  const WRAPPER_VERSION = 'v3.3.6';
  const GIST_BASE = 'https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw';
  const CORE_URL   = GIST_BASE + '/calcOhsorryCore.js';
  const RENDER_URL = GIST_BASE + '/ohsorryRender.js';
  const DB_URL     = GIST_BASE + '/dbConn.js';

  async function loadModule(url, globalName) {
    if (window[globalName]) return window[globalName];
    const r = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error(`${globalName} 모듈 로드 실패: HTTP ${r.status}`);
    const text = await r.text();
    // eslint-disable-next-line no-eval
    (0, eval)(text);
    if (!window[globalName]) throw new Error(`window.${globalName} 전역 등록 실패`);
    return window[globalName];
  }

  window.__dp_render = async (dbData) => {
    // 모듈 셋 모두 load (이미 로드돼 있으면 즉시 반환)
    await loadModule(DB_URL,     'OhsorryDb');
    await loadModule(RENDER_URL, 'OhsorryRender');
    const Core = await loadModule(CORE_URL, 'OhsorryCore');
    return Core.compute({
      mode: 'own',
      dbData: dbData || null,
      wrapperVersion: WRAPPER_VERSION,
    });
  };

  // eagate 도메인이면 자동 실행 (콘솔에 붙여넣는 기존 사용법 그대로).
  // 그 외 사이트는 window.__dp_render(dbData) 로 DB 데이터를 넘겨 호출.
  if (location.hostname.endsWith('p.eagate.573.jp')) {
    window.__dp_render(null);
  } else {
    console.log('[오소리 v3.3.6] eagate 외 도메인 — window.__dp_render(dbData) 로 DB 데이터를 넘겨 호출하세요.');
  }
})();
