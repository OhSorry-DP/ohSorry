// 2-calc-score.js — 오소리 본체 wrapper (v3.3.7)
//
// 모듈 분리:
//   - calcOhsorryCore.js (v0.0.335) : 계산 (ereter/zasa fetch + 페이지 순회 + ★ 추정 + 추천곡 + result build)
//   - ohsorryRender.js   (v0.0.346) : UI (진행률 + 결과 패널 + 추천곡 sortable + 캡처)
//   - dbConn.js          (v0.0.403) : supabase RPC + uploadResult trigger (DB 모드 자동 skip)
//
// 이 wrapper 는 위 모듈들을 gist 에서 fetch + eval 한 뒤 Core.compute({mode:'own'}) 만 호출.
//
// 사용법:
//   1. p.eagate.573.jp 도메인 어느 페이지에서나 자동 실행 (eagate fetch 모드)
//   2. 다른 사이트에서 window.__dp_render(dbData) 로 supabase row 를 직접 넘겨 호출 (DB 모드)
//
// supabase version 컬럼: `${WRAPPER_VERSION}-core${CORE_VERSION_SHORT}` (예: 'v3.3.6-core335')
// ============================================================

(async function () {
  const WRAPPER_VERSION = 'v3.3.7';
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

  // 모듈 fetch 동안 표시할 로딩 UI — OhsorryRender.showProgress 와 같은 #__dp_progress 박스 구조.
  // OhsorryRender 가 로드된 뒤에는 같은 ID 요소를 갱신해서 사용하므로 시각적으로 자연스럽게 이어짐.
  function showLoadingProgress(msg, pct) {
    let el = document.getElementById('__dp_progress');
    if (!el) {
      el = document.createElement('div');
      el.id = '__dp_progress';
      el.style.cssText =
        'position:fixed;top:16px;right:16px;z-index:9999;background:#fff;border:1px solid #ddd;border-radius:8px;padding:12px 14px;width:280px;max-width:calc(100vw - 32px);box-sizing:border-box;box-shadow:0 4px 12px rgba(0,0,0,.08);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#212529';
      el.innerHTML = `
        <div style="font-size:13px;font-weight:600;margin-bottom:6px;word-break:break-word;overflow-wrap:anywhere">오소리 로딩 중...</div>
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

  // eagate fetch 모드에서 곡 데이터 수집 범위를 묻는 모달.
  //   - 레벨별 : 선택한 LEVEL 폴더만 (difficulty.html). 기본 11·12 체크.
  //   - 전곡   : 시리즈 폴더 전체 (series.html, 약 1분).
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
          <div style="font-size:15px;font-weight:700;margin-bottom:3px">오소리 — 곡 데이터 불러오기</div>
          <div style="font-size:12px;color:#888;margin-bottom:16px">어떤 곡을 가져올까요?</div>
          <label style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px;cursor:pointer">
            <input type="radio" name="__dpfm" value="level" checked style="margin-top:2px">
            <span><b style="font-size:13px">레벨별</b><br><span style="font-size:11px;color:#888">선택한 LEVEL 폴더만 (빠름)</span></span>
          </label>
          <div id="__dp_lv_box" style="display:flex;flex-wrap:wrap;gap:8px 10px;padding:6px 10px 12px 28px">${lvBtns}</div>
          <label style="display:flex;align-items:flex-start;gap:8px;margin-bottom:18px;cursor:pointer">
            <input type="radio" name="__dpfm" value="series" style="margin-top:2px">
            <span><b style="font-size:13px">전곡</b><br><span style="font-size:11px;color:#888">시리즈 폴더 전체 — 약 1분 소요</span></span>
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

  window.__dp_render = async (dbData) => {
    // eagate fetch 모드 (dbData 없음 + eagate 도메인) 면 곡 수집 범위를 먼저 묻는다.
    // DB 모드 (dbData 있음) 는 charts_json 을 그대로 쓰므로 모달 생략.
    let fetchOpts = null;
    if (!dbData && location.hostname.endsWith('p.eagate.573.jp')) {
      fetchOpts = await askFetchOptions();
    }
    // 모듈 모두 load (이미 로드돼 있으면 즉시 반환)
    // normTitle 먼저 — dbConn / Core / RenderingShelf 등이 의존
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
        mode: 'own',
        dbData: dbData || null,
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

  // eagate 도메인이면 자동 실행 (콘솔에 붙여넣는 기존 사용법 그대로).
  // 그 외 사이트는 window.__dp_render(dbData) 로 DB 데이터를 넘겨 호출.
  if (location.hostname.endsWith('p.eagate.573.jp')) {
    window.__dp_render(null);
  } else {
    console.log('[오소리 v3.3.6] eagate 외 도메인 — window.__dp_render(dbData) 로 DB 데이터를 넘겨 호출하세요.');
  }
})();

