// calc-rival-ohsorry.js — 라이벌 오소리 wrapper (v3.3.8)
//
// 모듈 분리:
//   - calcOhsorryCore.js (v0.0.346) : 계산
//   - ohsorryRender.js   (v0.0.346) : UI
//   - dbConn.js          (v0.0.403) : supabase RPC
//   - eagateFetch.js     (v0.0.1)   : p.eagate.573.jp difficulty/series.html fetch
//
// 이 wrapper 는 위 모듈들을 gist 에서 fetch + eval 한 뒤:
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
// supabase version 컬럼: `${WRAPPER_VERSION}-core${CORE_VERSION_SHORT}` (예: 'v3.3.8-core346')
// ============================================================

(async function () {
  const WRAPPER_VERSION = 'v3.3.8';
  const GIST_BASE = 'https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw';
  const CORE_URL     = GIST_BASE + '/calcOhsorryCore.js';
  const RENDER_URL   = GIST_BASE + '/ohsorryRender.js';
  const DB_URL       = GIST_BASE + '/dbConn.js';
  const NORM_URL     = GIST_BASE + '/normTitle.js';
  const EAGATE_URL   = GIST_BASE + '/eagateFetch.js';

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

  // 모듈 fetch 동안 표시할 로딩 UI — 오소리 본체 wrapper 와 동일한 #__dp_progress 박스 구조.
  // OhsorryRender 가 로드된 뒤에는 같은 ID 요소를 갱신해서 사용하므로 시각적으로 자연스럽게 이어짐.
  function showLoadingProgress(msg, pct) {
    let el = document.getElementById('__dp_progress');
    if (!el) {
      el = document.createElement('div');
      el.id = '__dp_progress';
      el.style.cssText =
        'position:fixed;top:16px;right:16px;z-index:9999;background:#fff;border:1px solid #ddd;border-radius:8px;padding:12px 14px;width:280px;max-width:calc(100vw - 32px);box-sizing:border-box;box-shadow:0 4px 12px rgba(0,0,0,.08);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#212529';
      el.innerHTML = `
        <div style="font-size:13px;font-weight:600;margin-bottom:6px;word-break:break-word;overflow-wrap:anywhere">라이벌 오소리 로딩 중...</div>
        <div id="__dp_progress_text" style="font-size:12px;color:#666;word-break:break-word;overflow-wrap:anywhere">시작합니다</div>
        <div style="margin-top:8px;background:#eee;border-radius:4px;height:6px;overflow:hidden">
          <div id="__dp_progress_bar" style="background:#1d9e75;height:100%;width:0%;transition:width .3s"></div>
        </div>
      `;
      document.body.appendChild(el);
    }
    const t = document.getElementById('__dp_progress_text');
    const b = document.getElementById('__dp_progress_bar');
    if (t && typeof msg === 'string') t.textContent = msg;
    if (b && typeof pct === 'number') b.style.width = Math.max(0, Math.min(100, pct)) + '%';
  }

  function hideLoadingProgress() {
    document.getElementById('__dp_progress')?.remove();
  }

  // eagate fetch 모드 — 무조건 시리즈 (전곡, 약 1분). 레벨별 선택 모달 제거 (사용자 결정으로 단순화).
  //   호출처 (__dp_batch_rival_by_iidx / __dp_render_rival) 흐름 유지 위해 Promise 시그니처만 유지.
  function askFetchOptions() {
    return Promise.resolve({ fetchMode: 'series', levels: undefined });
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

  // 단위 int → 한자 (setup_users.sql 매핑 — 12=皆伝 / 11=中伝 / 10~1=十段~初段 / 0=一級 / -8~-1=九級~二級).
  //   string (이미 한자) 으로 들어오면 그대로.
  function rankToKanji(r) {
    if (typeof r === 'string') return r || '-';
    if (typeof r !== 'number') return '-';
    if (r === 12) return '皆伝';
    if (r === 11) return '中伝';
    if (r >= 1 && r <= 10) return ['初','二','三','四','五','六','七','八','九','十'][r-1] + '段';
    if (r === 0) return '一級';
    if (r >= -8 && r <= -1) return ['二','三','四','五','六','七','八','九'][-r-1] + '級';
    return '-';
  }

  // batch 종료 시 라이벌 목록 패널 — 각 행 클릭 시 ohSorryWeb 의 그 유저 카드 새 탭 open.
  function renderRivalList(rivals) {
    document.getElementById('__dp_rival_list')?.remove();
    const ov = document.createElement('div');
    ov.id = '__dp_rival_list';
    ov.style.cssText =
      'position:fixed;top:60px;right:20px;z-index:10001;background:#1a1a1a;border:1px solid #444;border-radius:8px;' +
      'padding:14px 16px;color:#e9ecef;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
      'max-width:380px;max-height:80vh;overflow-y:auto;box-shadow:0 4px 24px rgba(0,0,0,.5);font-size:13px';
    const rowsHtml = rivals.map((r) => {
      const dpRank = rankToKanji(r.dp_rank);
      return `<div class="__dp_rival_row" data-id="${r.iidx_id}" `
        + `style="display:flex;gap:10px;padding:6px 8px;border-radius:4px;cursor:pointer;align-items:center">`
        + `<span style="flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${(r.dj_name || '?').replace(/[<>]/g, '')}</span>`
        + `<span style="font-family:monospace;font-size:11px;opacity:0.7">${r.iidx_id}</span>`
        + `<span style="color:#ff9bce;font-weight:700;min-width:36px;text-align:right">${dpRank}</span>`
        + `</div>`;
    }).join('');
    ov.innerHTML =
      `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px">`
      + `<div style="font-size:13px;font-weight:700">라이벌 ${rivals.length}명 — 클릭 시 ohSorryWeb 새 탭</div>`
      + `<button id="__dp_rival_close" style="background:transparent;border:0;color:#888;cursor:pointer;font-size:20px;line-height:1;padding:0 4px">×</button>`
      + `</div>`
      + rowsHtml;
    document.body.appendChild(ov);
    ov.querySelector('#__dp_rival_close').addEventListener('click', () => ov.remove());
    ov.querySelectorAll('.__dp_rival_row').forEach((row) => {
      row.addEventListener('mouseenter', () => { row.style.background = '#232830'; });
      row.addEventListener('mouseleave', () => { row.style.background = ''; });
      row.addEventListener('click', () => {
        const id = row.dataset.id;
        if (id) window.open(`https://ohsorry.vercel.app/#user@${id}`, '_blank');
      });
    });
  }

  // IIDX ID 리스트 (쉼표/줄바꿈/공백 구분) → 각 ID 마다 토큰 추출 → 순회 Core.compute 호출.
  //   기존 ohsorryRender (패널) 그리지 않음 — 마지막에 라이벌 목록 패널 (renderRivalList) 만 표시.
  //   각 라이벌마다 supabase upsert (uploadResult 자동 호출) 는 그대로 동작.
  window.__dp_batch_rival_by_iidx = async (idsRaw) => {
    const ids = String(idsRaw || '').split(/[,\n\s]+/)
      .map(s => s.trim().replace(/-/g, ''))
      .filter(s => /^\d{8}$/.test(s));
    if (ids.length === 0) {
      alert('유효한 IIDX ID 가 없습니다 (8자리 숫자 / 하이픈 OK).');
      return;
    }
    const fetchOpts = await askFetchOptions();
    console.log(`[라이벌오소리] 일괄 처리 시작 — ${ids.length}명`);
    const rivals = [];  // 결과 누적 — { iidx_id, dj_name, dp_rank }
    // ohsorryRender.show 임시 swap — Core.compute 가 자동 호출하는 패널 렌더링 차단.
    //   ohsorryRender 가 아직 안 load 됐을 수도 있으니 첫 호출 후 swap.
    let renderShowSwapped = false;
    const swapRender = () => {
      if (renderShowSwapped || !window.OhsorryRender || !window.OhsorryRender.show) return;
      window.OhsorryRender.__origShow = window.OhsorryRender.show;
      window.OhsorryRender.show = async () => {};  // no-op
      renderShowSwapped = true;
    };
    const restoreRender = () => {
      if (renderShowSwapped && window.OhsorryRender && window.OhsorryRender.__origShow) {
        window.OhsorryRender.show = window.OhsorryRender.__origShow;
        delete window.OhsorryRender.__origShow;
        renderShowSwapped = false;
      }
    };
    try {
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        console.log(`[라이벌오소리] [${i + 1}/${ids.length}] IIDX ID ${id} 토큰 조회...`);
        try {
          const who = ids.length > 1 ? ` (${i + 1}/${ids.length})` : '';
          showLoadingProgress(`라이벌 검색 중${who}`, 3);
          const token = await window.__dp_fetch_rival_token(id);
          if (!token) {
            console.warn(`[라이벌오소리] IIDX ID ${id} — 검색 결과 없음 (skip)`);
            continue;
          }
          console.log(`[라이벌오소리] IIDX ID ${id} → 토큰 ${token.slice(0, 16)}... 라이벌 오소리 실행`);
          const result = await window.__dp_render_rival(null, token, fetchOpts);
          // 첫 compute 후 ohsorryRender 가 로드됨 — 그 다음부터 swap.
          swapRender();
          // result.dbPayload 에서 정보 추출
          if (result && result.dbPayload && result.dbPayload.iidx_id) {
            rivals.push({
              iidx_id: result.dbPayload.iidx_id,
              dj_name: result.dbPayload.dj_name,
              dp_rank: result.dbPayload.dp_rank,
            });
          }
        } catch (e) {
          console.error(`[라이벌오소리] IIDX ID ${id} 처리 실패:`, e);
        }
      }
    } finally {
      hideLoadingProgress();
      restoreRender();
    }
    console.log(`[라이벌오소리] 일괄 처리 완료 — ${ids.length}명 (수집 ${rivals.length}명)`);
    // 첫 라이벌은 swap 전 패널이 그려졌을 수 있음 — 정리.
    document.getElementById('__dp_score_panel')?.remove();
    if (rivals.length > 0) renderRivalList(rivals);
  };

  window.__dp_render_rival = async (dbData, overrideRivalToken, fetchOptsArg) => {
    // 우선순위: overrideRivalToken (batch) > URL 의 rival 쿼리 > dbData 모드 (토큰 불필요)
    const rivalToken = overrideRivalToken || new URLSearchParams(location.search).get('rival');
    if (!dbData && !rivalToken) {
      const input = prompt('라이벌 IIDX ID 입력 (쉼표/줄바꿈 구분, 여러 명 가능 — 빈값 취소):');
      if (!input || !input.trim()) return;
      return window.__dp_batch_rival_by_iidx(input);
    }
    // 곡 수집 범위 — batch 가 fetchOptsArg 로 넘겨주면 그대로 사용 (라이벌마다 다시 안 물음).
    // 단일 라이벌 (URL 토큰 등) 진입이면 여기서 1회 모달. dbData 모드는 charts_json 사용 → 생략.
    let fetchOpts = fetchOptsArg || null;
    if (!dbData && !fetchOpts) {
      fetchOpts = await askFetchOptions();
    }
    // 모듈 모두 load — normTitle 먼저 (dbConn / Core 가 의존)
    showLoadingProgress('normTitle 로드 중', 5);
    try {
      await loadModule(NORM_URL,   'OhsorryNorm');
      showLoadingProgress('dbConn 로드 중', 25);
      await loadModule(DB_URL,     'OhsorryDb');
      showLoadingProgress('render 로드 중', 50);
      await loadModule(RENDER_URL, 'OhsorryRender');
      showLoadingProgress('core 로드 중', 75);
      const Core = await loadModule(CORE_URL, 'OhsorryCore');
      // eagateFetch — DB 모드 (dbData 있음) 에선 supabase charts_json 으로 채우므로 불필요. fetch 모드만 load.
      if (!dbData) {
        showLoadingProgress('eagateFetch 로드 중', 95);
        await loadModule(EAGATE_URL, 'OhsorryEagateFetch');
      }
      showLoadingProgress('계산 시작', 100);
      return Core.compute({
        mode: 'rival',
        dbData: dbData || null,
        rivalToken: rivalToken,
        wrapperVersion: WRAPPER_VERSION,
        fetchMode: fetchOpts ? fetchOpts.fetchMode : undefined,
        levels: fetchOpts ? fetchOpts.levels : undefined,
      });
    } finally {
      // Core.compute 호출 직후 로딩 박스 제거 — 이어서 Core 가 OhsorryRender.showProgress 로
      // 같은 ID(#__dp_progress) 박스를 새로 만들어 진행률을 표시함.
      hideLoadingProgress();
    }
  };

  // eagate 도메인이면 자동 실행. 라이벌 페이지면 자동 토큰 추출, 아니면 IIDX prompt → batch.
  if (location.hostname.endsWith('p.eagate.573.jp')) {
    window.__dp_render_rival(null);
  } else {
    console.log('[오소리/라이벌 v3.3.8] eagate 외 도메인 — window.__dp_render_rival(dbData) 로 DB 데이터를 넘겨 호출하세요.');
  }
})();
