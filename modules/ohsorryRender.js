// ohsorryRender.js — 오소리 결과 렌더 모듈 (v0.0.347)
//
// calcOhsorryCore.compute() 가 반환한 result 객체를 받아 화면 패널 + 추천곡 + supabase upload.
// 본체 / 라이벌 wrapper 가 fetch + eval 해서 사용.
//
// 인터페이스:
//   window.OhsorryRender = {
//     VERSION,
//     showProgress(msg, pct),
//     hideProgress(),
//     show(result, opts),
//   }
//
// result 객체 (core compute 가 반환 — 모든 closure 변수를 담음):
//   {
//     mode, isRival, dbData, wrapperVersion, dbVersionString,
//     profile, profileHasRadar,
//     starEstimate, starRaw, starEstimateNew, starEstimateOld,
//     starEstimateEreterOnly, starEstimateLv12Only, starEstimateAll, eraterTrueStar,
//     starEstimate135, osr135Meta, osrGroup,
//     allCharts,
//     ereterData, zasaSupplemental, ereterMap, zasaMap, ratingMap, ereterExtractedAt, ereterPlayers,
//     ohsorryRecBase, recBaseStar, recBaseMode,
//     topEC, topHC, topEXH,
//     pageCount, useOnlyLv12, matched, unmatched, details, perLevel, perLamp,
//     recsEC, recsHC, recsEXH,
//     total,
//     norm, hasRadarData, SERIES, shelfLib,
//   }
// ============================================================

window.OhsorryRender = {
  VERSION: '0.0.347',

  // 진행률 UI — core 의 onProgress 콜백에서 호출
  showProgress: function (msg, pct) {
    let progress = document.getElementById('__dp_progress');
    if (!progress) {
      progress = document.createElement('div');
      progress.id = '__dp_progress';
      progress.style.cssText =
        'position:fixed;top:16px;right:16px;z-index:9999;background:#fff;border:1px solid #ddd;border-radius:8px;padding:12px 14px;width:280px;max-width:calc(100vw - 32px);box-sizing:border-box;box-shadow:0 4px 12px rgba(0,0,0,.08);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#212529';
      progress.innerHTML = `
        <div style="font-size:13px;font-weight:600;margin-bottom:6px;word-break:break-word;overflow-wrap:anywhere">오소리 진행 중</div>
        <div id="__dp_progress_text" style="font-size:12px;color:#666;word-break:break-word;overflow-wrap:anywhere">시작합니다</div>
        <div style="margin-top:8px;background:#eee;border-radius:4px;height:6px;overflow:hidden">
          <div id="__dp_progress_bar" style="background:#1d9e75;height:100%;width:0%;transition:width .3s"></div>
        </div>
      `;
      document.body.appendChild(progress);
    }
    const t = document.getElementById('__dp_progress_text');
    const b = document.getElementById('__dp_progress_bar');
    if (t && typeof msg === 'string') t.textContent = msg;
    if (b && typeof pct === 'number') b.style.width = Math.max(0, Math.min(100, pct)) + '%';
  },

  hideProgress: function () {
    document.getElementById('__dp_progress')?.remove();
  },

  // 도메인이 다른 곳일 때 "이동할까요?" 토스트 — [이동] / [닫기] 두 버튼.
  // [이동] 클릭 시 targetUrl 로 location.href 이동. [닫기] 또는 외부 클릭 시 자동 닫힘.
  confirmRedirect: function (message, targetUrl) {
    document.getElementById('__dp_redirect_toast')?.remove();
    const box = document.createElement('div');
    box.id = '__dp_redirect_toast';
    box.style.cssText =
      'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999999;' +
      'background:#1a1a1a;color:#e9ecef;border:1px solid #495057;border-radius:8px;' +
      'padding:14px 18px;box-shadow:0 6px 24px rgba(0,0,0,.4);' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Apple SD Gothic Neo","Pretendard",sans-serif;' +
      'font-size:14px;max-width:calc(100vw - 32px);';
    box.innerHTML = `
      <div style="margin-bottom:10px;color:#ced4da">${message || '이동할까요?'}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="__dp_redirect_no" style="background:transparent;border:1px solid #495057;color:#adb5bd;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px;font-family:inherit">닫기</button>
        <button class="__dp_redirect_yes" style="background:#ff6b9d;border:none;color:#1a1a1a;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:700;font-family:inherit">이동</button>
      </div>
    `;
    document.body.appendChild(box);
    box.querySelector('.__dp_redirect_no').onclick = () => box.remove();
    box.querySelector('.__dp_redirect_yes').onclick = () => {
      if (targetUrl) location.href = targetUrl;
      box.remove();
    };
  },

  // 결과 패널 + 추천곡 + supabase upload
  show: async function (result, opts) {
    if (!result) {
      console.error('[OhsorryRender] result 가 비어있습니다');
      return;
    }
    // ===== result 분해 — core compute 가 담아 보낸 closure 변수들 =====
    const {
      mode, isRival, dbData, wrapperVersion, dbVersionString,
      profile, profileHasRadar, hasRadarData,
      starEstimate, starRaw, starEstimateNew, starEstimateOld,
      starEstimateEreterOnly, starEstimateLv12Only, starEstimateAll, eraterTrueStar,
      allCharts,
      ereterData, zasaSupplemental, ereterMap, zasaMap, ratingMap, ereterExtractedAt,
      ohsorryRecBase,
      topEC, topHC, topEXH,
      pageCount, useOnlyLv12, matched, unmatched, details, perLevel, perLamp,
      recsEC, recsHC, recsEXH,
      total,
      norm, SERIES, shelfLib,
    } = result;
    // 재할당 되는 변수는 let
    let recBaseMode = result.recBaseMode;
    let recBaseStar = result.recBaseStar;

    // ===== core 의 line 1285~2160 (panel build) 코드 그대로 옮김 =====
    document.getElementById('__dp_score_panel')?.remove();
    // 다시 계산 — 패널 제거 후 같은 Gist 다시 fetch + eval (캐시 우회).
    // DB 모드는 재 fetch 없이 같은 dbData 로 다시 렌더.
    window.__dp_rerun = () => {
      document.getElementById('__dp_score_panel')?.remove();
      document.getElementById('__dp_progress')?.remove();
      document.getElementById('__dp_confirm_rerun')?.remove();
      if (dbData) {
        // 재실행 — 같은 opts 로 core compute 호출 (wrapper 우회). dbData / mode / rivalToken 유지.
        const w = wrapperVersion || 'unknown';
        // wrapper 가 다시 fetch 하는 흐름: gist 의 wrapper (2-calc-score.js 또는 calc-rival-ohsorry.js) 를 다시 받음
        const wurl = (mode === 'rival')
          ? 'https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw/rivalOhsorry.js'
          : 'https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw/ohsorry.js';
        fetch(wurl + '?t=' + Date.now()).then(r => r.text()).then(eval);
        return;
      }
      const wurl = (mode === 'rival')
        ? 'https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw/rivalOhsorry.js'
        : 'https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw/ohsorry.js';
      fetch(wurl + '?t=' + Date.now()).then(r => r.text()).then(eval);
    };
    // 클릭 위치 근처에 재실행 확인 팝업 — 외부 클릭/취소 시 닫힘
    window.__dp_confirmRerun = (x, y) => {
      document.getElementById('__dp_confirm_rerun')?.remove();
      const box = document.createElement('div');
      box.id = '__dp_confirm_rerun';
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
    const fmt = (n) => Math.max(0.1, Math.round(n * 100) / 100);
    const escHtml = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

    // ===== Panel build — core 의 line 1355~2160 본문 그대로 (closure 변수는 위 result 분해로 받음) =====
    const panel = document.createElement('div');
    panel.id = '__dp_score_panel';
    panel.innerHTML = `
      <style>
        #__dp_score_panel {
          position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 999999;
          width: 100%; height: 100vh; height: 100dvh; max-height: 100dvh;
          overflow: auto;
          background: #fff; color: #222;
          font-family: -apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif;
          font-size: 13px; line-height: 1.5;
          border: none; border-radius: 0;
          padding: 12px 14px;
          box-sizing: border-box;
          white-space: nowrap;
        }
        #__dp_score_panel * { white-space: nowrap; }
        @media (min-width: 768px) {
          #__dp_score_panel {
            top: 16px; right: 16px; left: auto; bottom: auto;
            width: 380px; height: auto; max-height: 92vh;
            padding: 14px 16px;
            border: 1px solid #ccc; border-radius: 8px;
            box-shadow: 0 6px 24px rgba(0,0,0,.18);
          }
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
        #__dp_score_panel details.toggle > summary { list-style: none; }
        #__dp_score_panel details.toggle > summary::-webkit-details-marker { display: none; }
        #__dp_score_panel details.toggle > summary::after { content: '∨'; font-size: 9px; color: #c0c0c0; margin-left: 6px; }
        #__dp_score_panel details.toggle[open] > summary::after { content: '∧'; }
        #__dp_score_panel summary:hover { color: #495057; }
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
        #__dp_score_panel .profile-img-col { display: flex; flex-direction: column; align-items: center; gap: 4px; flex-shrink: 0; }
        #__dp_score_panel .profile-img { width: 64px; height: 64px; background: #e9ecef; border-radius: 4px; overflow: hidden; }
        #__dp_score_panel .profile-img img { width: 100%; height: 100%; object-fit: cover; }
        #__dp_score_panel .profile-web-link { font-size: 10px; color: #666; text-decoration: underline; cursor: pointer; line-height: 1.2; white-space: nowrap; }
        #__dp_score_panel .profile-web-link:hover { color: #212529; }
        #__dp_score_panel .profile-info { flex: 1; min-width: 0; }
        #__dp_score_panel .profile-name { font-size: 16px; font-weight: 600; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        #__dp_score_panel .profile-id { font-size: 11px; color: #666; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        #__dp_score_panel .profile-rank { display: flex; gap: 10px; margin-top: 6px; font-size: 13px; flex-wrap: nowrap; white-space: nowrap; overflow: hidden; }
        #__dp_score_panel .profile-rank span { white-space: nowrap; font-weight: 700; }
        #__dp_score_panel .profile-rank b { color: #6c757d; margin-right: 3px; font-weight: 600; }
        #__dp_score_panel .rank-chuden, #__dp_score_panel .rank-kaiden {
          background-clip: text; -webkit-background-clip: text;
          -webkit-text-fill-color: transparent; color: transparent;
          background-size: 200% 100%;
          animation: __dp_shimmer 6s linear infinite;
        }
        #__dp_score_panel .rank-chuden { background-image: linear-gradient(90deg, #8c95a0 0%, #8c95a0 40%, #c7ccd2 50%, #8c95a0 60%, #8c95a0 100%); }
        #__dp_score_panel .rank-kaiden { background-image: linear-gradient(90deg, #c8a347 0%, #c8a347 40%, #ead78a 50%, #c8a347 60%, #c8a347 100%); }
        #__dp_score_panel .rank-chuden b, #__dp_score_panel .rank-kaiden b { -webkit-text-fill-color: #6c757d; color: #6c757d; }
        @keyframes __dp_shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        #__dp_score_panel .profile-star { flex-shrink: 0; text-align: center; padding: 4px 4px 4px 8px; min-width: 72px; }
        #__dp_score_panel .profile-star-value { font-size: 22px; font-weight: 700; color: #212529; line-height: 1.1; margin: 2px 0; }
        #__dp_score_panel .profile-star-note { font-size: 9px; color: #888; line-height: 1.1; }
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
        #__dp_score_panel .rec-mode-toggle { margin-top: 10px; display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
        #__dp_score_panel .rec-mode-label { font-size: 11px; color: #888; white-space: nowrap; }
        #__dp_score_panel .rec-mode-options { font-size: 12px; white-space: nowrap; }
        #__dp_score_panel .rec-mode-opt { cursor: pointer; color: #aaa; transition: color 0.15s; }
        #__dp_score_panel .rec-mode-opt:hover { color: #555; }
        #__dp_score_panel .rec-mode-opt.active { color: #212529; font-weight: 700; cursor: default; }
        #__dp_score_panel .rec-mode-sep { color: #ccc; margin: 0 8px; }
        #__dp_score_panel .rec-review-toggle { margin-right: auto; display: flex; align-items: center; gap: 4px; cursor: pointer; -webkit-user-select: none; user-select: none; }
        #__dp_score_panel .rec-review-toggle .rrt-check { font-size: 13px; line-height: 1; color: #ccc; transition: color 0.15s; }
        #__dp_score_panel .rec-review-toggle .rrt-label { font-size: 12px; color: #888; transition: color 0.15s; }
        #__dp_score_panel .rec-review-toggle:hover .rrt-label { color: #555; }
        #__dp_score_panel .rec-review-toggle.active .rrt-check { color: #212529; }
        #__dp_score_panel .rec-review-toggle.active .rrt-label { color: #212529; font-weight: 600; }
        #__dp_score_panel .recs { margin-top: 12px; }
        #__dp_score_panel .rec-item { padding: 4px 0; font-size: 12px; display: flex; align-items: center; gap: 6px; border-bottom: 1px solid #eee; }
        #__dp_score_panel .rec-item:last-child { border-bottom: none; }
        #__dp_score_panel .rec-item .rec-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        #__dp_score_panel .rec-item .rec-title-clickable { cursor: pointer; }
        #__dp_score_panel .rec-item .rec-title-clickable:hover { font-weight: 700; }
        #__dp_score_panel .rec-item .rec-diff { flex: 0 0 42px; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
        #__dp_score_panel .rec-item .rec-level { flex: 0 0 32px; text-align: right; color: #888; font-variant-numeric: tabular-nums; font-size: 11px; }
        #__dp_score_panel .rec-item .rec-chart { flex: 0 0 12px; text-align: center; font-weight: 600; font-size: 11px; }
      </style>
      <button class="close" onclick="document.getElementById('__dp_score_panel').remove()" title="닫기">×</button>

      ${profile ? `
        <div class="profile">
          ${(profile.qproImg || profile.iidxId) ? `
            <div class="profile-img-col">
              ${profile.qproImg ? `<div class="profile-img"><img src="${escHtml(profile.qproImg)}" alt="qpro"></div>` : ''}
              ${profile.iidxId ? `<a class="profile-web-link" href="https://ohsorry.vercel.app/#user@${escHtml(profile.iidxId)}" target="_blank" rel="noopener">오소리웹으로 이동</a>` : ''}
            </div>
          ` : ''}
          <div class="profile-info">
            <div class="profile-name">${escHtml(profile.djName || 'DJ')}</div>
            <div class="profile-id">IIDX ID: ${escHtml(profile.iidxId || '-')}</div>
            ${(profile.spRank || profile.dpRank) ? (() => {
              const KANJI_NUM = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
              const rankStyle = (rank) => {
                if (!rank) return { color: '#6c757d', cls: '' };
                if (rank.includes('皆伝')) return { color: null, cls: 'rank-kaiden' };
                if (rank.includes('中伝')) return { color: null, cls: 'rank-chuden' };
                const mKanji = rank.match(/([一二三四五六七八九十]+)\s*段/);
                const mDigit = rank.match(/(\d+)\s*段/);
                let n = null;
                if (mKanji) {
                  const s = mKanji[1];
                  if (s === '十') n = 10;
                  else if (s.length === 1 && KANJI_NUM[s]) n = KANJI_NUM[s];
                  else n = null;
                } else if (mDigit) {
                  n = parseInt(mDigit[1], 10);
                }
                if (n != null) {
                  if (n >= 9) return { color: '#dc3545', cls: '' };
                  return { color: '#1971c2', cls: '' };
                }
                return { color: '#6c757d', cls: '' };
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
            const radarToggle = `<div class="nr-toggle" onclick="window.__dp_toggleRadar()">상세통계 ▼</div>`;
            if (eraterTrueStar != null) {
              const diff = starEstimate - eraterTrueStar;
              const diffStr = (diff >= 0 ? '+' : '') + diff.toFixed(2);
              const diffColor = Math.abs(diff) <= 0.1 ? '#52a447' : (Math.abs(diff) <= 0.3 ? '#dcaf45' : '#dc3545');
              return `
                <div class="profile-star">
                  <div class="profile-star-value">★${fmt(starEstimate).toFixed(2)}</div>
                  <div class="profile-star-note">ereter: ★${eraterTrueStar.toFixed(2)} <span style="color:${diffColor};font-weight:600">(${diffStr})</span></div>
                  ${radarToggle}
                </div>
              `;
            }
            return `
              <div class="profile-star">
                <div class="profile-star-value">★${fmt(starEstimate).toFixed(2)}</div>
                <div class="profile-star-note">ereter.net 근사치 ±0.1</div>
                ${radarToggle}
              </div>
            `;
          })() : ''}
        </div>
      ` : '<div class="meta">프로필 정보를 가져올 수 없었어요</div>'}

      ${profileHasRadar ? (() => {
        const CATS = ['NOTES', 'CHORD', 'PEAK', 'CHARGE', 'SCRATCH', 'SOF-LAN'];
        const SVG_ORDER = ['NOTES', 'PEAK', 'SCRATCH', 'SOF-LAN', 'CHARGE', 'CHORD'];
        const fmt2 = (v) => (v != null && !isNaN(v)) ? v.toFixed(2) : '—';
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
            const v = Math.max((radar[c] || 0) / RADAR_MAX, 0);
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
        const chartColor = (chart) => {
          if (!chart) return '#888';
          const c = chart.toUpperCase();
          if (c.startsWith('L') || c.includes('LEGG')) return '#d678c8';
          if (c.startsWith('A')) return '#e88080';
          if (c.startsWith('H')) return '#dcaf45';
          return '#888';
        };
        const renderRecItems = (recs, color) => {
          if (recs.length === 0) {
            return `<div class="meta" style="padding:6px 8px;color:#888">★값 근처에 추천할 곡이 없어요.</div>`;
          }
          return recs.map(r => {
            const chartLetter = (r.chart || '?')[0];
            const cColor = chartColor(r.chart);
            const titleStyle =
              r.gameLevel === 11 ? ' style="color:#9ccc65"' :
              r.gameLevel === 12 ? ' style="color:#87ceeb"' : '';
            const titleTooltip =
              r.gameLevel === 11 ? ' title="ohSorry 추정 ★ (게임 LEVEL 11, ereter 미등록)"' :
              r.gameLevel === 12 ? ' title="ohSorry 추정 ★ (게임 LEVEL 12, ereter 미등록)"' : '';
            // FLIP 권장 마크 — calcOhsorryCore 가 sample15 정렬 시 _matchByHand 캐시 저장.
            //   best === 'flip' 이면 FLIP 배치 (양손 바꿈) 가 더 잘 맞는 곡이라 작은 핑크 배지 표시.
            const flipBadge = r._matchByHand && r._matchByHand.best === 'flip'
              ? ` <span class="rec-flip" title="FLIP 배치 (양손 바꿈) 가 더 잘 맞아요" style="color:#ff6b9d;font-size:9px;font-weight:700;margin-left:3px;padding:0 3px;border:1px solid #ff6b9d;border-radius:2px;line-height:1.2">FLIP</span>`
              : '';
            return `
              <div class="rec-item">
                <span class="rec-chart" style="color:${cColor}" title="${r.chart || ''}">${chartLetter}</span>
                <div class="rec-title rec-title-clickable" data-t="${escHtml(r.title)}" data-c="${escHtml(r.chart || '')}"${titleTooltip}><span${titleStyle}>${escHtml(r.title)}</span><span style="color:#aaa;font-weight:400;margin-left:4px;font-size:10.5px">${r.currentLamp || ''}</span>${flipBadge}</div>
                <span class="rec-diff" style="color:${color}" title="실력 ★">★${r.diffValue.toFixed(2)}</span>
                <span class="rec-level" title="서열표 ☆">☆${r.level.toFixed(1)}</span>
              </div>
            `;
          }).join('');
        };
        window.__dp_renderRecItems = renderRecItems;
        let recLevelMode = result.recLevelModeDefault === 'lv12' ? 'lv12' : 'all';
        let recDjMode = result.recDjModeDefault === 'on' ? 'on' : 'off';
        const rerenderRecStage = (stage, color) => {
          const newRecs = window.__dp_rerollRecs(stage, recBaseStar, recLevelMode, recDjMode);
          const container = document.getElementById(`__dp_recs_${stage}`);
          if (container) container.innerHTML = window.__dp_renderRecItems(newRecs, color);
          const counter = document.getElementById(`__dp_recs_count_${stage}`);
          if (counter) counter.textContent = newRecs.length;
        };
        const rerenderAllRecs = () => {
          const STAGE_COLORS = { ec: '#52a447', hc: '#dc3545', exh: '#d4a017' };
          for (const stage of ['ec', 'hc', 'exh']) rerenderRecStage(stage, STAGE_COLORS[stage]);
        };
        window.__dp_rerollAndRender = rerenderRecStage;

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
        // 복습곡 (램프는 클리어했지만 DJ레벨 미달인 곡) 추천 포함 체크박스
        // 체크 해제: ✓ 연한 회색 / 체크: ✔ 기본 글자색 (︎ = 텍스트 스타일 강제, 이모지 렌더링 방지)
        // '추천 범위' 토글 행 안에 첫 자식으로 삽입 → margin-right:auto 로 같은 줄 왼쪽 끝에 배치
        const recDjToggle = `
          <span class="rec-review-toggle${recDjMode === 'on' ? ' active' : ''}"
            onclick="window.__dp_setRecDjMode && window.__dp_setRecDjMode()"
            title="램프는 클리어했지만 DJ레벨이 부족한 곡(복습곡)도 추천에 포함">
            <span class="rrt-check">${recDjMode === 'on' ? '✔︎' : '✓︎'}</span>
            <span class="rrt-label">복습곡 ${recDjMode === 'on' ? '포함' : '제외'}</span>
          </span>
        `;
        const recLevelToggle = `
          <div class="rec-mode-toggle" style="margin-top:4px">
            ${recDjToggle}
            <span class="rec-mode-label">추천 범위 :</span>
            <div class="rec-mode-options">
              <span class="rec-level-mode-opt${recLevelMode === 'lv12' ? ' active' : ''}" data-mode="lv12"
                style="cursor:pointer;color:${recLevelMode === 'lv12' ? '#212529' : '#aaa'};font-weight:${recLevelMode === 'lv12' ? '700' : '400'};transition:color .15s"
                onclick="window.__dp_setRecLevelMode && window.__dp_setRecLevelMode('lv12')"
                title="게임 LEVEL 12 차트만 추천">DP12</span>
              <span class="rec-mode-sep">|</span>
              <span class="rec-level-mode-opt${recLevelMode === 'all' ? ' active' : ''}" data-mode="all"
                style="cursor:pointer;color:${recLevelMode === 'all' ? '#212529' : '#aaa'};font-weight:${recLevelMode === 'all' ? '700' : '400'};transition:color .15s"
                onclick="window.__dp_setRecLevelMode && window.__dp_setRecLevelMode('all')"
                title="게임 LEVEL 11 + 12 차트 추천">DP11+</span>
            </div>
          </div>
        `;

        window.__dp_setRecBase = (mode) => {
          if (mode === 'ereter' && eraterTrueStar == null) return;
          recBaseMode = mode;
          recBaseStar = mode === 'ereter' ? eraterTrueStar : ohsorryRecBase;
          rerenderAllRecs();
          document.querySelectorAll('.rec-mode-opt').forEach(b => {
            b.classList.toggle('active', b.dataset.mode === mode);
          });
        };
        window.__dp_setRecLevelMode = (mode) => {
          recLevelMode = mode === 'lv12' ? 'lv12' : 'all';
          rerenderAllRecs();
          document.querySelectorAll('.rec-level-mode-opt').forEach(b => {
            const active = b.getAttribute('data-mode') === recLevelMode;
            b.classList.toggle('active', active);
            b.style.color = active ? '#212529' : '#aaa';
            b.style.fontWeight = active ? '700' : '400';
          });
        };
        window.__dp_setRecDjMode = (mode) => {
          // 인자 없으면 토글, 'on'/'off' 명시하면 그 값으로
          if (mode === 'on' || mode === 'off') recDjMode = mode;
          else recDjMode = recDjMode === 'on' ? 'off' : 'on';
          rerenderAllRecs();
          const el = document.querySelector('.rec-review-toggle');
          if (el) {
            el.classList.toggle('active', recDjMode === 'on');
            const chk = el.querySelector('.rrt-check');
            if (chk) chk.textContent = recDjMode === 'on' ? '✔︎' : '✓︎';
            const lbl = el.querySelector('.rrt-label');
            if (lbl) lbl.textContent = '복습곡 ' + (recDjMode === 'on' ? '포함' : '제외');
          }
        };

        return recModeToggle + recLevelToggle + [
          renderRec('EASY',    topEC,  '#52a447', 'ec'),
          renderRec('HARD',    topHC,  '#dc3545', 'hc'),
          renderRec('EX-HARD', topEXH, '#d4a017', 'exh'),
        ].join('');
      })()}
      </div>

      <div id="__detail_stats" style="margin-top:10px">
        ${(() => {
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
          // ★ 구간 버킷 — DP12(★11.6~12.7) + DP11(lv11 ★10.2~12.1) 합집합.
          // 막대는 이 합집합으로 한 번만 그리고, 모드별 곡 수 0 구간은 숨김(buildBarRow / __dp_setLvMode).
          const levels = (() => {
            const set = new Set();
            for (const e of ereterData) {
              if (e.level == null || e.level < 10 || e.level > 12.7) continue;
              set.add(e.level.toFixed(1));
            }
            for (const z of zasaSupplemental) {
              if (z.level == null || z.level < 10 || z.level > 12.7) continue;
              set.add(z.level.toFixed(1));
            }
            return [...set].map(parseFloat).sort((a, b) => a - b);
          })();
          const lampPalette = [
            { key: 'fc',  color: '#00aab2', label: 'FC' },
            { key: 'exh', color: '#ffcc44', label: 'EX-HARD' },
            { key: 'hd',  color: '#dc3545', label: 'HARD' },
            { key: 'cl',  color: '#7dd3da', label: 'CLEAR' },
            { key: 'ez',  color: '#52a447', label: 'EASY' },
            { key: 'as',  color: '#9966cc', label: 'ASSIST' },
            { key: 'fa',  color: '#999',    label: 'FAILED' },
            { key: 'np',  color: '#e9ecef', label: 'NO PLAY' },
          ];
          const djPalette = [
            { key: 'AAA',   color: '#ffcc44', label: 'AAA' },
            { key: 'AA',    color: '#ffaa33', label: 'AA' },
            { key: 'A',     color: '#dc3545', label: 'A' },
            { key: 'B',     color: '#1971c2', label: 'B' },
            { key: 'C',     color: '#9ed870', label: 'C' },
            { key: 'lower', color: '#b0b0b0', label: 'D↓' },
            { key: 'none',  color: '#e9ecef', label: 'NP' },
          ];
          const computeStats = (mode) => {
            const isLv = (gl) => mode === 'lv12' ? gl === 12 : gl === 11;
            const charts = allCharts.filter(c => isLv(c.gameLevel));
            const clearTypeCount = { 'FULL COMBO': 0, 'EX HARD': 0, 'HARD': 0, 'CLEAR': 0, 'EASY': 0, 'ASSIST': 0, 'FAILED': 0, 'NO PLAY': 0 };
            const djCount = {};
            for (const c of charts) {
              if (clearTypeCount[c.lamp] !== undefined) clearTypeCount[c.lamp]++;
              if (c.djLevel) djCount[c.djLevel] = (djCount[c.djLevel] || 0) + 1;
            }
            const lampStats = {};
            const djStats = {};
            for (const lv of levels) {
              lampStats[lv.toFixed(1)] = { total: 0, fc: 0, exh: 0, hd: 0, cl: 0, ez: 0, as: 0, fa: 0, np: 0, played: 0 };
              djStats[lv.toFixed(1)]   = { total: 0, AAA: 0, AA: 0, A: 0, B: 0, C: 0, lower: 0, none: 0 };
            }
            // ereter 데이터는 gameLevel 필드가 없고 전부 lv12 → lv12 모드에서만 분모(total)에 합산.
            if (mode === 'lv12') {
              for (const e of ereterData) {
                if (e.level == null) continue;
                const k = e.level.toFixed(1);
                if (lampStats[k]) lampStats[k].total++;
                if (djStats[k]) djStats[k].total++;
              }
            }
            for (const z of zasaSupplemental) {
              if (z.level == null) continue;
              if (!isLv(z.gameLevel)) continue;
              const k = z.level.toFixed(1);
              if (lampStats[k]) lampStats[k].total++;
              if (djStats[k]) djStats[k].total++;
            }
            for (const c of charts) {
              const key = norm(c.title) + '|' + c.diff;
              let k = null;
              const e = ereterMap.get(key);
              if (e && e.level != null) {
                k = e.level.toFixed(1);
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
          const statsByMode = { lv12: computeStats('lv12'), lv11: computeStats('lv11') };
          window.__dp_statsByMode = statsByMode;
          const initStats = statsByMode['lv12'];
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
          const buildBarRow = (lv, kind, palette, statsForLv) => {
            const total = statsForLv.total;
            const segHtml = palette.map(p => {
              const count = statsForLv[p.key] || 0;
              const pct = total > 0 ? (count / total * 100).toFixed(2) : '0';
              const display = count > 0 ? '' : 'display:none;';
              return `<div data-seg="${p.key}" data-label="${p.label}" style="${display}background:${p.color};width:${pct}%;height:100%" title="${p.label}: ${count}곡"></div>`;
            }).join('');
            return `
              <div data-bar-row="${lv.toFixed(1)}" data-bar-kind="${kind}"
                style="display:${total === 0 ? 'none' : 'flex'};align-items:center;gap:6px;font-size:11px;line-height:1;margin-bottom:3px">
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
          window.__dp_setLvMode = (mode) => {
            const stats = window.__dp_statsByMode && window.__dp_statsByMode[mode];
            if (!stats) return;
            document.querySelectorAll('[data-clear-type]').forEach(el => {
              const k = el.getAttribute('data-clear-type');
              el.textContent = (stats.clearTypeCount[k] || 0) + ' 곡';
            });
            document.querySelectorAll('[data-dj-count]').forEach(el => {
              const k = el.getAttribute('data-dj-count');
              el.textContent = (stats.djCount[k] || 0) + ' 곡';
            });
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
            document.querySelectorAll('.dp-lv-toggle-btn').forEach(b => {
              const active = b.getAttribute('data-mode') === mode;
              b.classList.toggle('active', active);
              b.style.color = active ? '#212529' : '#888';
              b.style.fontWeight = active ? '600' : '400';
            });
          };
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
                <span class="dp-lv-toggle-btn" data-mode="lv11"
                  style="cursor:pointer;color:#888;font-weight:400"
                  onclick="window.__dp_setLvMode('lv11')">DP11</span>
              </div>
            </div>
            <div id="__dp_detail_filtered">${buildTable()}${buildBars()}</div>
          `;
        })()}
      </div>

      ${ereterExtractedAt ? (() => {
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

    // 추천곡 곡명 클릭 → 차트 row 토스트 (ohsorryShelf renderChartRow)
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

    // 상세통계 토글
    if (panel.querySelector('#__detail_stats')) {
      panel.querySelector('#__detail_stats').style.display = 'none';
    }
    let __radarToggleOpen = false;
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

    // 추천곡 wrapper 를 상세통계 details 뒤로 이동
    {
      const recWrap = panel.querySelector('#__rec_wrapper');
      const detailStats = panel.querySelector('#__detail_stats');
      if (recWrap && detailStats) detailStats.after(recWrap);
    }

    // window.__dp_result 노출 (개발용)
    window.__dp_result = { total, matched, unmatched, details, perLevel, perLamp, allCharts, pageCount, ereterExtractedAt, starEstimate, starRaw, profile, recsEC, recsHC, recsEXH };
    console.log('💾 결과 데이터: window.__dp_result');

    // ===== supabase upload — OhsorryDb.uploadResult 위임 (DB 모드는 자동 skip) =====
    // 트리거 로직이 dbConn v0.0.403 에 흡수됨 — render 는 한 줄 호출.
    if (window.OhsorryDb && window.OhsorryDb.uploadResult) {
      try { await window.OhsorryDb.uploadResult(result, { dbData }); }
      catch (e) { console.warn('[OhsorryRender] uploadResult 예외:', e && e.message); }
    }
  },
};
