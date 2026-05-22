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

  // eagate fetch 모드에서 곡 데이터 수집 범위를 묻는 모달 (ohsorry.js 와 동일 구조).
  //   - 레벨별 : 선택한 LEVEL 폴더만 (difficulty_rival.html). 기본 11·12 체크.
  //   - 전곡   : 시리즈 폴더 전체 (series.html, 약 1분).
  // batch (여러 라이벌) 처리 시 루프 시작 전에 1회만 띄우고 모든 라이벌에 공통 적용.
  // resolve 값 → Core.compute 의 opts.fetchMode / opts.levels 로 전달.
  function askFetchOptions() {
    return new Promise((resolve) => {
      document.getElementById('__dp_fetch_modal')?.remove();
      const ov = document.createElement('div');
      ov.id = '__dp_fetch_modal';
      ov.style.cssText =
        'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
      // 레벨 — 체크박스는 숨기고 label 클릭으로 토글. 선택 상태는 paintLv 가 글자색/굵기로 표시.
      const lvBtns = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((lv) =>
        '<label style="display:inline-flex;align-items:center;justify-content:center;' +
        'min-width:24px;padding:4px 6px;font-size:13px;cursor:pointer;user-select:none">' +
        `<input type="checkbox" class="__dplv" value="${lv}"${lv >= 11 ? ' checked' : ''} style="display:none">${lv}</label>`,
      ).join('');
      ov.innerHTML = `
        <div style="background:#fff;border-radius:12px;padding:22px 24px;width:330px;max-width:calc(100vw - 32px);box-sizing:border-box;box-shadow:0 8px 32px rgba(0,0,0,.25);color:#212529">
          <div style="font-size:15px;font-weight:700;margin-bottom:3px">라이벌 오소리 — 곡 데이터 불러오기</div>
          <div style="font-size:12px;color:#888;margin-bottom:16px">라이벌의 어떤 곡을 가져올까요? (여러 명이면 모두 공통 적용)</div>
          <label style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px;cursor:pointer">
            <input type="radio" name="__dpfm" value="level" checked style="margin-top:2px">
            <span><b style="font-size:13px">레벨별</b><br><span style="font-size:11px;color:#888">선택한 LEVEL 폴더만 (빠름)</span></span>
          </label>
          <div id="__dp_lv_box" style="display:flex;flex-wrap:wrap;gap:8px 10px;padding:6px 10px 12px 28px">${lvBtns}</div>
          <label style="display:flex;align-items:flex-start;gap:8px;margin-bottom:18px;cursor:pointer">
            <input type="radio" name="__dpfm" value="series" style="margin-top:2px">
            <span><b style="font-size:13px">전곡</b><br><span style="font-size:11px;color:#888">시리즈 폴더 전체 — 라이벌 1명당 약 1분</span></span>
          </label>
          <button id="__dp_fetch_ok" style="width:100%;padding:9px 0;border:0;border-radius:7px;background:#1d9e75;color:#fff;font-size:13px;font-weight:600;cursor:pointer">시작</button>
        </div>
      `;
      document.body.appendChild(ov);
      const lvBox = ov.querySelector('#__dp_lv_box');
      // 레벨 선택 표시 — 꺼짐: 연한 글자 / 켜짐: 진한 + 볼드. (기본 체크박스가 한눈에 안 보여서)
      const paintLv = (label) => {
        const on = label.querySelector('input').checked;
        label.style.color = on ? '#212529' : '#ced4da';
        label.style.fontWeight = on ? '700' : '400';
      };
      ov.querySelectorAll('#__dp_lv_box label').forEach((label) => {
        paintLv(label);
        label.querySelector('input').addEventListener('change', () => paintLv(label));
      });
      // 레벨별 라디오가 선택됐을 때만 레벨 체크박스 활성화
      const syncLvBox = () => {
        const isLevel = ov.querySelector('input[name="__dpfm"]:checked').value === 'level';
        lvBox.style.opacity = isLevel ? '1' : '.35';
        lvBox.style.pointerEvents = isLevel ? 'auto' : 'none';
      };
      ov.querySelectorAll('input[name="__dpfm"]').forEach((r) => { r.onchange = syncLvBox; });
      syncLvBox();
      ov.querySelector('#__dp_fetch_ok').onclick = () => {
        const mode = ov.querySelector('input[name="__dpfm"]:checked').value;
        let levels = [];
        if (mode === 'level') {
          levels = [...ov.querySelectorAll('.__dplv:checked')].map((c) => Number(c.value));
          if (levels.length === 0) {
            alert('레벨을 하나 이상 선택하거나 전곡을 골라주세요.');
            return;
          }
        }
        ov.remove();
        resolve({ fetchMode: mode, levels });
      };
    });
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
    // 여러 명이어도 곡 수집 범위는 맨 처음 한 번만 선택 → 모든 라이벌에 공통 적용
    const fetchOpts = await askFetchOptions();
    console.log(`[라이벌오소리] 일괄 처리 시작 — ${ids.length}명`);
    try {
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        console.log(`[라이벌오소리] [${i + 1}/${ids.length}] IIDX ID ${id} 토큰 조회...`);
        try {
          // 토큰 검색 구간에도 로딩 박스 표시 — prompt 확인 직후부터 모듈 로딩까지 끊김 없이 이어짐.
          // (이게 없으면 모듈 로딩 박스가 토큰 검색 뒤에 잠깐만 떴다 사라져 거의 안 보임.)
          const who = ids.length > 1 ? ` (${i + 1}/${ids.length})` : '';
          showLoadingProgress(`라이벌 검색 중${who}`, 3);
          const token = await window.__dp_fetch_rival_token(id);
          if (!token) {
            console.warn(`[라이벌오소리] IIDX ID ${id} — 검색 결과 없음 (skip)`);
            continue;
          }
          console.log(`[라이벌오소리] IIDX ID ${id} → 토큰 ${token.slice(0, 16)}... 라이벌 오소리 실행`);
          await window.__dp_render_rival(null, token, fetchOpts);
        } catch (e) {
          console.error(`[라이벌오소리] IIDX ID ${id} 처리 실패:`, e);
        }
      }
    } finally {
      // 마지막 라이벌이 검색 실패(토큰 없음)로 끝나면 박스가 남으므로 정리.
      // 성공 케이스에선 Core 가 이미 자기 진행률 박스를 제거한 뒤라 no-op.
      hideLoadingProgress();
    }
    console.log(`[라이벌오소리] 일괄 처리 완료 — ${ids.length}명`);
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
      showLoadingProgress('dbConn 로드 중', 30);
      await loadModule(DB_URL,     'OhsorryDb');
      showLoadingProgress('render 로드 중', 55);
      await loadModule(RENDER_URL, 'OhsorryRender');
      showLoadingProgress('core 로드 중', 80);
      const Core = await loadModule(CORE_URL, 'OhsorryCore');
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
    console.log('[오소리/라이벌 v3.3.6] eagate 외 도메인 — window.__dp_render_rival(dbData) 로 DB 데이터를 넘겨 호출하세요.');
  }
})();
