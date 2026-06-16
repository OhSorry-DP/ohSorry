// ohsorry.js — 오소리 본체 wrapper (v3.5.2). (legacy gist URL 2-calc-score.js 가 이 파일로 redirect)
//
// 모듈(gist): normTitle / dbConn / calcOhsorryCore / eagateFetch. (render 안 받음 — 코어가 완료 박스 내장.)
//
// 흐름:
//   1. p.eagate.573.jp 에서 실행 → 시리즈 선택 모달 즉시 표시.
//   2. 모듈 로드 → Core.fetchProfile() 로 본인 DJ명/단위/IIDX ID 를 모달 상단에 채움.
//   3. 데이터(별값 lib/ereter/textage) 백그라운드 prefetch(Core.prefetch) → compute 로딩 단축.
//   4. 시작 → IIDX input 이 본인이면 own, 다른 사람이면 그 사람을 라이벌로(Core.fetchRivalToken → rival 모드).
//      SP/DP 토글은 own·rival 공통 — DP 누르면 DP만, SP 누르면 SP만 크롤·업로드.
//
// supabase version 컬럼: `${WRAPPER_VERSION}-core${CORE_VERSION_SHORT}` (예: 'v3.5.2-core404')
// ============================================================

(async function () {
  const WRAPPER_VERSION = 'v3.5.2';   // 라이벌도 SP/DP 토글 그대로 + IIDX 여러 명 입력 → 완료 리스트
  const GIST_BASE = 'https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw';
  const CORE_URL     = GIST_BASE + '/calcOhsorryCore.js';
  const DB_URL       = GIST_BASE + '/dbConn.js';
  const NORM_URL     = GIST_BASE + '/normTitle.js';
  const EAGATE_URL   = GIST_BASE + '/eagateFetch.js';

  async function loadModule(url, globalName) {
    // 매 실행 재fetch+eval — 버전 갱신 시 stale window.<globalName> 으로 옛 코드가 도는 것 방지.
    //   (core 는 최상위 var 라 재eval 안전. 데이터 캐시 __ohsorryEreterCache/__ohsorryLibCache 는 별도 유지.)
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

  // 시리즈 + 프로필 헤더 + IIDX input 모달. 즉시 표시되고, 프로필은 fillProfile(profile) 로 나중에 채움.
  //   반환 { choice: Promise<{seriesList, playStyle, targetId}>, fillProfile }
  function askFetchOptions() {
    document.getElementById('__dp_fetch_modal')?.remove();
    const ov = document.createElement('div');
    ov.id = '__dp_fetch_modal';
    ov.style.cssText =
      'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
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
    ov.innerHTML = `
      <style>
        #__dp_fetch_modal .__dp_card{width:min(680px, calc(100vw - 24px))}
        @media (max-width:560px){
          #__dp_fetch_modal{align-items:stretch;justify-content:stretch}
          #__dp_fetch_modal .__dp_card{width:100vw;max-width:100vw;height:100vh;max-height:100vh;border-radius:0;padding:16px 16px env(safe-area-inset-bottom,16px)}
        }
      </style>
      <div class="__dp_card" style="background:#fff;border-radius:12px;padding:20px 22px;box-sizing:border-box;box-shadow:0 8px 32px rgba(0,0,0,.25);color:#212529;display:flex;flex-direction:column;max-height:calc(100vh - 32px)">
        <div style="font-size:15px;font-weight:700;margin-bottom:10px;flex:none">오소리 — 업로드</div>
        <div style="background:#f8f9fa;border-radius:8px;padding:10px 12px;margin-bottom:10px;flex:none">
          <div id="__dp_prof_name" style="font-size:14px;font-weight:700;word-break:break-all">프로필 불러오는 중...</div>
          <div id="__dp_prof_rank" style="font-size:12px;color:#868e96;margin-top:2px"></div>
        </div>
        <div style="font-size:11px;color:#888;margin-bottom:4px;flex:none">IIDX ID <span style="color:#1d9e75">— 다른 사람 ID = 라이벌 분석 / 여러 명은 공백·쉼표로 구분</span></div>
        <input id="__dp_iidx" type="text" inputmode="numeric" placeholder="0000-0000" disabled
          style="width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #ced4da;border-radius:7px;font-size:14px;font-family:monospace;margin-bottom:12px;flex:none">
        <div id="__dp_ps_tabs" style="display:flex;margin-bottom:12px;border:1px solid #dee2e6;border-radius:8px;overflow:hidden;flex:none">
          <button type="button" class="__dp_ps_tab" data-ps="DP" style="flex:1;padding:8px 0;border:0;background:#1d9e75;color:#fff;font-size:13px;font-weight:700;cursor:pointer">DP</button>
          <button type="button" class="__dp_ps_tab" data-ps="SP" style="flex:1;padding:8px 0;border:0;background:#f1f3f5;color:#868e96;font-size:13px;font-weight:700;cursor:pointer">SP</button>
        </div>
        <div style="font-size:12px;color:#888;margin-bottom:6px;flex:none">시리즈 (기본 전체 — 전곡 약 1분, 좁으면 ←→ 스크롤). 일부만 고르면 별값 갱신은 생략.</div>
        <label style="display:flex;align-items:center;gap:7px;padding:4px 6px;margin-bottom:6px;cursor:pointer;font-size:12px;font-weight:700;color:#1d9e75;flex:none">
          <input type="checkbox" id="__dp_all" checked><span>전체</span></label>
        <div id="__dp_series_box" style="display:flex;flex-direction:row;gap:10px;overflow-x:auto;overflow-y:hidden;border:1px solid #e9ecef;border-radius:8px;padding:8px;margin-bottom:14px;flex:1 1 auto;min-height:0">${groupsHtml}</div>
        <button id="__dp_fetch_ok" disabled style="width:100%;padding:11px 0;border:0;border-radius:7px;background:#1d9e75;color:#fff;font-size:13.5px;font-weight:600;cursor:pointer;flex:none;opacity:.5">불러오는 중...</button>
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
    ov.querySelectorAll('.__dpgrptog').forEach((g) => {
      g.addEventListener('change', () => {
        ov.querySelectorAll('.__dpgrp' + g.dataset.grp).forEach((c) => { c.checked = g.checked; });
        syncTop();
      });
    });
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
    let resolveChoice;
    const choice = new Promise((res) => { resolveChoice = res; });
    ov.querySelector('#__dp_fetch_ok').onclick = () => {
      const seriesList = allCbs().filter((c) => c.checked).map((c) => Number(c.value) - 1);  // series_no → list 값
      if (seriesList.length === 0) { alert('시리즈를 하나 이상 선택해주세요.'); return; }
      const targetId = (ov.querySelector('#__dp_iidx').value || '').trim();
      ov.remove();
      resolveChoice({ seriesList, playStyle, targetId });
    };
    // 프로필 fetch 끝나면 호출 — 헤더 채우고 IIDX input(본인 id) 채우고 시작 활성화.
    function fillProfile(profile) {
      const nameEl = ov.querySelector('#__dp_prof_name');
      const rankEl = ov.querySelector('#__dp_prof_rank');
      const input = ov.querySelector('#__dp_iidx');
      const ok = ov.querySelector('#__dp_fetch_ok');
      if (profile && profile.iidxId) {
        nameEl.textContent = profile.djName || '(이름 없음)';
        const fmt = (s) => (s && s !== '---' && s !== '-') ? s : null;
        const parts = [];
        if (fmt(profile.spRank)) parts.push('SP ' + profile.spRank);
        if (fmt(profile.dpRank)) parts.push('DP ' + profile.dpRank);
        rankEl.textContent = parts.join('   ·   ') || '단위 없음';
        input.value = profile.iidxId;
      } else {
        nameEl.textContent = '프로필을 못 불러왔어요';
        rankEl.textContent = 'IIDX ID 를 직접 입력해주세요';
      }
      input.disabled = false;
      ok.disabled = false; ok.style.opacity = '1'; ok.textContent = '시작';
    }
    return { choice, fillProfile };
  }

  // 메인 흐름 — 모달 즉시 표시 → 모듈 로드 → 본인 프로필 채움 → 데이터 prefetch → 시작 시 own/rival 분기.
  async function run() {
    if (!location.hostname.endsWith('p.eagate.573.jp')) {
      if (window.confirm('p.eagate.573.jp 에서 실행해야 합니다. 이동할까요?')) location.href = 'https://p.eagate.573.jp/';
      return;
    }
    const ui = askFetchOptions();   // 모달 즉시 표시 (시리즈는 정적, 프로필/시작은 로드 후 활성화)
    let Core;
    try {
      await loadModule(NORM_URL,  'OhsorryNorm');
      await loadModule(DB_URL,    'OhsorryDb');
      Core = await loadModule(CORE_URL, 'OhsorryCore');
      await loadModule(EAGATE_URL, 'OhsorryEagateFetch');
    } catch (e) {
      alert('모듈 로드 실패: ' + (e && e.message) + '\n새로고침 후 다시 시도해주세요.');
      return;
    }
    // 본인 프로필 fetch → 모달 헤더 + IIDX input 채움
    let ownProfile = null;
    try { ownProfile = await Core.fetchProfile({ isRival: false }); }
    catch (e) { console.warn('[오소리] 프로필 fetch 실패:', e && e.message); }
    ui.fillProfile(ownProfile);
    // 데이터(별값 lib/ereter/textage/rating) 백그라운드 prefetch — 모달 보는 동안 미리 받아 compute 단축
    Core.prefetch().catch(() => {});
    // 시작 대기
    const { seriesList, playStyle, targetId } = await ui.choice;
    const ownNorm = ((ownProfile && ownProfile.iidxId) || '').replace(/-/g, '');
    // 여러 IIDX ID 지원 — 공백·쉼표·줄바꿈으로 구분. 본인 ID 면 own, 그 외는 라이벌. 중복 제거.
    const rawIds = (targetId || '').split(/[\s,]+/).map((s) => s.replace(/-/g, '').trim()).filter(Boolean);
    const targets = [...new Set(rawIds.length ? rawIds : (ownNorm ? [ownNorm] : []))];
    if (targets.length === 0) { alert('IIDX ID 를 입력해주세요.'); return; }
    const multi = targets.length > 1;
    const doneEntries = [];   // [{ profile, style }] — 완료 후 한 번에 리스트로 표시
    try {
      for (let i = 0; i < targets.length; i++) {
        const tNorm = targets[i];
        const isRival = tNorm !== ownNorm;
        const tag = multi ? ` (${i + 1}/${targets.length})` : '';
        let rivalToken;
        if (isRival) {
          showLoadingProgress(`라이벌 ${tNorm} 검색 중...${tag}`, 5);
          try { rivalToken = await Core.fetchRivalToken(tNorm); }
          catch (e) {
            if (!multi) { hideLoadingProgress(); alert('라이벌 검색 실패: ' + (e && e.message)); return; }
            console.warn('[오소리] 라이벌 검색 실패', tNorm, e && e.message); continue;
          }
          if (!rivalToken) {
            const msg = `IIDX ID ${tNorm} 의 라이벌을 못 찾았어요.\n(ID 오타 / 라이벌 등록·공개 설정 확인)`;
            if (!multi) { hideLoadingProgress(); alert(msg); return; }
            console.warn('[오소리]', msg.replace(/\n/g, ' ')); continue;
          }
        }
        const res = await Core.compute({
          mode: isRival ? 'rival' : 'own',
          rivalToken: rivalToken || undefined,
          wrapperVersion: WRAPPER_VERSION,
          seriesList,
          playStyle,                                     // own·rival 공통 — DP 누르면 DP만, SP 누르면 SP만
          profile: isRival ? undefined : ownProfile,     // own 은 모달에서 받은 프로필 재사용(status 재fetch 안 함)
          suppressDone: true,                            // 완료 박스는 wrapper 가 아래서 리스트로 한 번에
        });
        if (res && res.profile) doneEntries.push({ profile: res.profile, style: res.style || playStyle });
      }
      if (doneEntries.length === 0) alert('업로드된 결과가 없어요. (라이벌 미발견 / 곡 수집 실패)');
      else Core.showDoneList(doneEntries);
      return doneEntries;
    } finally {
      hideLoadingProgress();
    }
  }
  window.__dp_run = run;   // 외부 재실행용

  if (location.hostname.endsWith('p.eagate.573.jp')) {
    run();
  } else {
    console.log(`[오소리 ${WRAPPER_VERSION}] p.eagate.573.jp 에서 실행하세요.`);
  }
})();

