// ohsorry.js — 오소리 본체 wrapper (v3.4.0). (legacy gist URL 2-calc-score.js 가 이 파일로 redirect)
//
// 모듈 분리:
//   - calcOhsorryCore.js (v0.0.346) : 계산 (★ 추정 + 추천곡 + result build) — DB 모드면 ★ lib fetch 도 skip
//   - ohsorryRender.js   (v0.0.346) : UI (진행률 + 결과 패널 + 추천곡 sortable + 캡처)
//   - dbConn.js          (v0.0.403) : supabase RPC + uploadResult trigger (DB 모드 자동 skip)
//   - eagateFetch.js     (v0.0.1)   : p.eagate.573.jp difficulty/series.html fetch (DB 모드면 wrapper 가 안 받음)
//
// 이 wrapper 는 위 모듈들을 gist 에서 fetch + eval 한 뒤 Core.compute({mode:'own'|'rival'}) 호출.
// DB 모드 (dbData 있음 = ohSorryWeb 게스트 페이지 / INFOhSorry 등) 일 때는 eagateFetch 를 fetch 하지 않음 —
// 그쪽은 supabase 의 charts_json 으로 채우므로 eagate 페이지 fetch 자체가 불필요.
//
// 사용법:
//   1. p.eagate.573.jp 어느 페이지에서나 자동 실행 (eagate fetch 모드)
//      - URL 에 ?rival=<토큰> 있으면 rival 모드 자동 진입 (라이벌 페이지 띄워둔 채 실행)
//      - 그 외는 own 모드 (본인 데이터)
//   2. 다른 사이트에서 window.__dp_render(dbData) 로 supabase row 를 직접 넘겨 호출 (DB 모드)
//
// supabase version 컬럼: `${WRAPPER_VERSION}-core${CORE_VERSION_SHORT}` (예: 'v3.3.9-core346')
// ============================================================

(async function () {
  const WRAPPER_VERSION = 'v3.4.0';   // [구조개편 2C] eagate 크롤→별값→업로드 전용 (render 모듈 안 받음)
  const GIST_BASE = 'https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw';
  const CORE_URL     = GIST_BASE + '/calcOhsorryCore.js';
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

  // 수집할 시리즈를 고르는 모달 (series 단일 모드). 기본 전체 선택.
  //   체크된 series_no → list 값(series_no-1) 배열로 resolve. SP/DP 탭 공통.
  // resolve 값 → Core.compute 의 opts.seriesList / opts.playStyle 로 전달.
  const SERIES_NAMES = {
    1: '1st & substream', 2: '2nd style', 3: '3rd style', 4: '4th style', 5: '5th style',
    6: '6th style', 7: '7th style', 8: '8th style', 9: '9th style', 10: '10th style',
    11: 'IIDX RED', 12: 'HAPPY SKY', 13: 'DistorteD', 14: 'GOLD', 15: 'DJ TROOPERS',
    16: 'EMPRESS', 17: 'SIRIUS', 18: 'Resort Anthem', 19: 'Lincle', 20: 'tricoro',
    21: 'SPADA', 22: 'PENDUAL', 23: 'copula', 24: 'SINOBUZ', 25: 'CANNON BALLERS',
    26: 'Rootage', 27: 'HEROIC VERSE', 28: 'BISTROVER', 29: 'CastHour', 30: 'RESIDENT',
    31: 'EPOLIS', 32: 'Pinky Crush', 33: 'Sparkle Shower',
  };
  // 10시리즈 단위 그룹 (역순 — 최신 위). 각 그룹에 전체 토글 체크박스.
  const SERIES_GROUPS = [
    { label: '최신~30', from: 30, to: 33 },
    { label: '29~20',  from: 20, to: 29 },
    { label: '19~10',  from: 10, to: 19 },
    { label: '9~1',    from: 1,  to: 9 },
  ];
  function askFetchOptions(isRival) {
    return new Promise((resolve) => {
      document.getElementById('__dp_fetch_modal')?.remove();
      const ov = document.createElement('div');
      ov.id = '__dp_fetch_modal';
      ov.style.cssText =
        'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
      // 그룹별 HTML — 각 그룹이 세로 컬럼(헤더 토글 + 시리즈 newest-first). 컬럼들을 가로로 나열(좌→우 스크롤).
      const groupsHtml = SERIES_GROUPS.map((g) => {
        const items = [];
        for (let sn = g.to; sn >= g.from; sn--) {
          items.push(
            `<label style="display:flex;align-items:center;gap:6px;padding:3px 5px;cursor:pointer;font-size:12px;white-space:nowrap">` +
            `<input type="checkbox" class="__dpsr __dpgrp${g.from}" value="${sn}" checked>` +
            `<span style="color:#868e96;font-variant-numeric:tabular-nums;min-width:16px;text-align:right">${sn}</span>` +
            `<span>${SERIES_NAMES[sn]}</span></label>`,
          );
        }
        return (
          `<div style="flex:0 0 auto;min-width:138px">` +
          `<label style="display:flex;align-items:center;gap:6px;padding:4px 5px;margin-bottom:2px;cursor:pointer;background:#f1f3f5;border-radius:6px;font-size:12px;font-weight:700;color:#495057;white-space:nowrap">` +
          `<input type="checkbox" class="__dpgrptog" data-grp="${g.from}" checked><span>${g.label}</span></label>` +
          items.join('') +
          `</div>`
        );
      }).join('');
      const titleText = isRival ? '라이벌 오소리 — 시리즈 선택' : '오소리 — 시리즈 선택';
      ov.innerHTML = `
        <div style="background:#fff;border-radius:12px;padding:20px 22px;width:340px;max-width:calc(100vw - 32px);box-sizing:border-box;box-shadow:0 8px 32px rgba(0,0,0,.25);color:#212529;display:flex;flex-direction:column;max-height:calc(100vh - 48px)">
          <div style="font-size:15px;font-weight:700;margin-bottom:3px">${titleText}</div>
          <div style="font-size:12px;color:#888;margin-bottom:12px">가져올 시리즈를 고르세요 (기본 전체 — 전곡은 약 1분). ←→ 가로 스크롤</div>
          ${isRival ? '' : `<div id="__dp_ps_tabs" style="display:flex;margin-bottom:12px;border:1px solid #dee2e6;border-radius:8px;overflow:hidden;flex:none">
            <button type="button" class="__dp_ps_tab" data-ps="DP" style="flex:1;padding:8px 0;border:0;background:#1d9e75;color:#fff;font-size:13px;font-weight:700;cursor:pointer">DP</button>
            <button type="button" class="__dp_ps_tab" data-ps="SP" style="flex:1;padding:8px 0;border:0;background:#f1f3f5;color:#868e96;font-size:13px;font-weight:700;cursor:pointer">SP</button>
          </div>`}
          <label style="display:flex;align-items:center;gap:7px;padding:4px 6px;margin-bottom:6px;cursor:pointer;font-size:12px;font-weight:700;color:#1d9e75;flex:none">
            <input type="checkbox" id="__dp_all" checked><span>전체</span></label>
          <div id="__dp_series_box" style="display:flex;flex-direction:row;gap:10px;overflow-x:auto;overflow-y:hidden;border:1px solid #e9ecef;border-radius:8px;padding:8px;margin-bottom:14px">${groupsHtml}</div>
          <button id="__dp_fetch_ok" style="width:100%;padding:9px 0;border:0;border-radius:7px;background:#1d9e75;color:#fff;font-size:13px;font-weight:600;cursor:pointer;flex:none">시작</button>
        </div>
      `;
      document.body.appendChild(ov);
      let playStyle = 'DP';
      ov.querySelectorAll('.__dp_ps_tab').forEach((b) => {
        b.onclick = () => {
          playStyle = b.dataset.ps;
          ov.querySelectorAll('.__dp_ps_tab').forEach((x) => {
            const on = x.dataset.ps === playStyle;
            x.style.background = on ? '#1d9e75' : '#f1f3f5';
            x.style.color = on ? '#fff' : '#868e96';
          });
        };
      });
      const allCbs = () => [...ov.querySelectorAll('.__dpsr')];
      // 그룹 토글 → 그룹 내 전부 on/off
      ov.querySelectorAll('.__dpgrptog').forEach((g) => {
        g.addEventListener('change', () => {
          ov.querySelectorAll('.__dpgrp' + g.dataset.grp).forEach((c) => { c.checked = g.checked; });
          syncTop();
        });
      });
      // 개별 체크 → 그룹/전체 토글 상태 갱신
      const syncTop = () => {
        SERIES_GROUPS.forEach((g) => {
          const tog = ov.querySelector(`.__dpgrptog[data-grp="${g.from}"]`);
          const box = [...ov.querySelectorAll('.__dpgrp' + g.from)];
          if (tog) tog.checked = box.length > 0 && box.every((c) => c.checked);
        });
        const all = ov.querySelector('#__dp_all');
        if (all) all.checked = allCbs().every((c) => c.checked);
      };
      allCbs().forEach((c) => c.addEventListener('change', syncTop));
      ov.querySelector('#__dp_all').addEventListener('change', (e) => {
        allCbs().forEach((c) => { c.checked = e.target.checked; });
        ov.querySelectorAll('.__dpgrptog').forEach((g) => { g.checked = e.target.checked; });
      });
      ov.querySelector('#__dp_fetch_ok').onclick = () => {
        const seriesList = allCbs().filter((c) => c.checked).map((c) => Number(c.value) - 1);  // series_no → list 값
        if (seriesList.length === 0) { alert('시리즈를 하나 이상 선택해주세요.'); return; }
        ov.remove();
        resolve({ seriesList, playStyle });
      };
    });
  }

  window.__dp_render = async (dbData, renderOpts) => {
    // 라이벌 페이지에서 실행했는지 감지 — URL 의 ?rival=<토큰> 유무로 판단 (rivalOhsorry 와 동일 기준).
    // dbData 모드 (게스트 페이지 등 외부 호출) 는 무조건 own.
    const rivalToken = (!dbData && location.hostname.endsWith('p.eagate.573.jp'))
      ? new URLSearchParams(location.search).get('rival')
      : null;
    const isRival = !!rivalToken;

    // eagate fetch 모드 (dbData 없음 + eagate 도메인) 면 곡 수집 범위를 먼저 묻는다.
    // 라이벌 모드도 동일하게 모달 표시 — 라이벌 페이지도 difficulty_rival.html (level) / series.html (series, rival 토큰 포함) 양쪽 다 가능.
    // DB 모드 (dbData 있음) 는 charts_json 을 그대로 쓰므로 모달 생략.
    let fetchOpts = null;
    if (!dbData && location.hostname.endsWith('p.eagate.573.jp')) {
      fetchOpts = await askFetchOptions(isRival);
    }
    // 모듈 모두 load (이미 로드돼 있으면 즉시 반환)
    // normTitle 먼저 — dbConn / Core / RenderingShelf 등이 의존
    showLoadingProgress(isRival ? '라이벌 오소리 시작' : 'normTitle 로드 중', 5);
    try {
      await loadModule(NORM_URL,   'OhsorryNorm');
      showLoadingProgress('dbConn 로드 중', 30);
      await loadModule(DB_URL,     'OhsorryDb');
      showLoadingProgress('core 로드 중', 60);
      const Core = await loadModule(CORE_URL, 'OhsorryCore');
      // [구조개편 2C] core 는 크롤→별값→업로드 전용 — render 모듈 불필요(완료 박스는 core 내장).
      showLoadingProgress('eagateFetch 로드 중', 90);
      await loadModule(EAGATE_URL, 'OhsorryEagateFetch');
      showLoadingProgress('계산 시작', 100);
      return Core.compute({
        mode: isRival ? 'rival' : 'own',
        rivalToken: rivalToken || undefined,
        wrapperVersion: WRAPPER_VERSION,
        seriesList: fetchOpts ? fetchOpts.seriesList : undefined,   // eamuse list 값(0~32) 배열, 생략 시 전체
        playStyle: fetchOpts ? fetchOpts.playStyle : undefined,     // 'SP' | 'DP'(기본)
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
    console.log(`[오소리 ${WRAPPER_VERSION}] eagate 외 도메인 — window.__dp_render(dbData) 로 DB 데이터를 넘겨 호출하세요.`);
  }
})();

