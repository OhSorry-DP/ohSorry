// calc-rival-ohsorry.js — 라이벌 오소리 wrapper (v3.3.6)
//
// 모듈 분리:
//   - calcOhsorryCore.js (v0.0.335) : 계산
//   - ohsorryRender.js   (v0.0.335) : UI
//   - dbConn.js          (v0.0.335) : supabase RPC
//
// 이 wrapper 는 세 모듈을 gist 에서 fetch + eval 한 뒤:
//   - IIDX ID 로 rival 토큰 조회 (rival_search.html POST)
//   - 다수 라이벌 batch 처리
//   - window.__dp_render_rival 노출 (URL 토큰 / override 토큰 / IIDX prompt → batch 분기)
//
// 사용법:
//   1. 라이벌 페이지 (difficulty_rival.html?rival=<토큰>) 에서 자동 실행
//   2. 다른 eagate 페이지에서 실행 시 IIDX ID prompt → 검색 → batch
//   3. window.__dp_render_rival(null, token) 로 토큰 직접 주입 (batch 흐름)
//   4. window.__dp_batch_rival_by_iidx('1511-6402, 1234-5678, ...') 로 다수 IIDX ID batch
//
// supabase version 컬럼: `${WRAPPER_VERSION}-core${CORE_VERSION_SHORT}` (예: 'v3.3.6-core335')
// ============================================================

(async function () {
  const WRAPPER_VERSION = 'v3.3.6';
  const GIST_BASE = 'https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw';
  const CORE_URL   = GIST_BASE + '/calcOhsorryCore.js';
  const RENDER_URL = GIST_BASE + '/ohsorryRender.js';
  const DB_URL     = GIST_BASE + '/dbConn.js';
  const NORM_URL   = GIST_BASE + '/normTitle.js';

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

  // IIDX ID (8자리 숫자) → 라이벌 토큰 조회 헬퍼.
  // rival_search.html 에 form POST 보내고 result 테이블의 첫 a href 에서 토큰 추출.
  window.__dp_fetch_rival_token = async (iidxId) => {
    const url = 'https://p.eagate.573.jp/game/2dx/33/rival/rival_search.html';
    const fd = new FormData();
    fd.append('iidxid', iidxId);
    fd.append('mode', '1');
    const res = await fetch(url, { method: 'POST', credentials: 'include', body: fd });
    if (!res.ok) throw new Error(`rival_search HTTP ${res.status}`);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const link = doc.querySelector('table#result a[href*="rival_status.html?rival="]');
    if (!link) return null;
    const m = (link.getAttribute('href') || '').match(/rival=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  };

  // IIDX ID 리스트 (쉼표/줄바꿈/공백 구분) → 각 ID 마다 토큰 추출 → 순회 __dp_render_rival 호출.
  // 라이벌마다 패널이 다시 그려지므로 마지막 라이벌만 화면에 남고, supabase 는 모두 upload 됨.
  window.__dp_batch_rival_by_iidx = async (idsRaw) => {
    const ids = String(idsRaw || '').split(/[,\n\s]+/)
      .map(s => s.trim().replace(/-/g, ''))
      .filter(s => /^\d{8}$/.test(s));
    if (ids.length === 0) {
      alert('유효한 IIDX ID 가 없습니다 (8자리 숫자 / 하이픈 OK).');
      return;
    }
    console.log(`[라이벌오소리] 일괄 처리 시작 — ${ids.length}명`);
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      console.log(`[라이벌오소리] [${i + 1}/${ids.length}] IIDX ID ${id} 토큰 조회...`);
      try {
        const token = await window.__dp_fetch_rival_token(id);
        if (!token) {
          console.warn(`[라이벌오소리] IIDX ID ${id} — 검색 결과 없음 (skip)`);
          continue;
        }
        console.log(`[라이벌오소리] IIDX ID ${id} → 토큰 ${token.slice(0, 16)}... 라이벌 오소리 실행`);
        await window.__dp_render_rival(null, token);
      } catch (e) {
        console.error(`[라이벌오소리] IIDX ID ${id} 처리 실패:`, e);
      }
    }
    console.log(`[라이벌오소리] 일괄 처리 완료 — ${ids.length}명`);
  };

  window.__dp_render_rival = async (dbData, overrideRivalToken) => {
    // 우선순위: overrideRivalToken (batch) > URL 의 rival 쿼리 > dbData 모드 (토큰 불필요)
    const rivalToken = overrideRivalToken || new URLSearchParams(location.search).get('rival');
    if (!dbData && !rivalToken) {
      const input = prompt('라이벌 IIDX ID 입력 (쉼표/줄바꿈 구분, 여러 명 가능 — 빈값 취소):');
      if (!input || !input.trim()) return;
      return window.__dp_batch_rival_by_iidx(input);
    }
    // 모듈 모두 load — normTitle 먼저 (dbConn / Core 가 의존)
    await loadModule(NORM_URL,   'OhsorryNorm');
    await loadModule(DB_URL,     'OhsorryDb');
    await loadModule(RENDER_URL, 'OhsorryRender');
    const Core = await loadModule(CORE_URL, 'OhsorryCore');
    return Core.compute({
      mode: 'rival',
      dbData: dbData || null,
      rivalToken: rivalToken,
      wrapperVersion: WRAPPER_VERSION,
    });
  };

  // eagate 도메인이면 자동 실행. 라이벌 페이지면 자동 토큰 추출, 아니면 IIDX prompt → batch.
  if (location.hostname.endsWith('p.eagate.573.jp')) {
    window.__dp_render_rival(null);
  } else {
    console.log('[오소리/라이벌 v3.3.6] eagate 외 도메인 — window.__dp_render_rival(dbData) 로 DB 데이터를 넘겨 호출하세요.');
  }
})();
