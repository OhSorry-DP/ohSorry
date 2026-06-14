// ohsorryShelf.js — 서열표 standalone 렌더 모듈 (INFOhSorry Dp12Table 포팅)
//
// ohSorry/modules/ 에 위치, gist 로 배포 — ohSorry 본체 / ohSorryWeb 게스트 페이지가
// gist 에서 fetch 해서 사용 (consumer 2곳).
//
// 게스트 페이지 (vanilla JS) 가 fetch + eval 해서 사용:
//   eval(libText);                       // window.OhSorryShelf 등록
//   OhSorryShelf.injectStyle();          // CSS 한 번 주입
//   const html = OhSorryShelf.renderShelf(charts, {
//     groupField: 'level',               // 그룹화 기준 필드 (INF=level)
//     fallbackField: 'zasaLevel',        // groupField 없을 때 fallback (INF 만 사용)
//     zasaData: { charts: [...] },        // 오소리 유저 — zasa-data.json 직접 매칭 (있으면 우선)
//     gameLevel: 12,                     // 11 또는 12 — 해당 레벨 곡만
//     sortBy: 'title',                   // 'title' | 'lamp-desc' | 'lamp-asc' | 'djlv-desc' | 'djlv-asc'
//     rightField: 'djlv',                // 'djlv' | 'exscore' — 곡 셀 우측 오버레이 (EX SCORE 도 DJ Level 색)
//   });
//   container.innerHTML = html;
//
//   OhSorryShelf.renderLegend();              // lamp 색상 범례 HTML
//   OhSorryShelf.renderStackbar(charts, 12, { zasaData });  // 표 전체 lamp 분포 스택드바 HTML
//     zasaData (선택) — 오소리 유저: 미플레이 zasa 곡을 NP 로 카운트 (없으면 charts 만 집계)
//   OhSorryShelf.renderChartRow(chart);       // INFOhSorry DP탭 모바일 1행 HTML (곡명 클릭 토스트용)
//
// 곡 base 결정:
//   - opts.zasaData 있으면 (오소리 유저): zasa-data.charts 를 base 로 깔고 charts_json 매칭.
//     매칭 안 된 zasa 곡은 NP placeholder 로 추가 → 미플레이 곡도 격자에 표시.
//     charts_json 에만 있고 zasa 미등록인 곡은 '미분류' 그룹.
//   - 없으면 (INF 유저): charts 그대로 순회, 그룹 ★ 는 groupField → fallbackField 순
//
// charts: supabase user_profiles.charts_json — [{ title, diff, slot, lamp, lampNum,
//         level, zasaLevel, gameLevel, djLevel, ... }]
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OhSorryShelf = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 스택드 바 segment 순서 (좋은 → 나쁜). PFC 는 FC 에 통합.
  var LAMP_BAR_ORDER = ['FC', 'EX', 'HC', 'NC', 'EC', 'AC', 'F', 'NP'];
  var LAMP_LABEL = {
    NP: 'NO PLAY', F: 'FAILED', AC: 'ASSIST', EC: 'EASY', NC: 'CLEAR',
    HC: 'HARD', EX: 'EX-HARD', FC: 'FULL COMBO', PFC: 'PERFECT FC',
  };
  // lamp-box 배경색 — 게스트 페이지 다크 테마 기준
  var LAMP_BG = {
    NP: '#3a3a3a', AC: '#9966cc', EC: '#7bc16a', NC: '#5cb8ea',
    HC: '#e9ecef', EX: '#dcaf45', F: '#7a3030',
    FC: 'linear-gradient(to bottom right, #0d47a1, #e3f2fd)',
    PFC: 'linear-gradient(to bottom right, #0d47a1, #e3f2fd)',
  };
  var SLOT_LABEL = { DPN: 'NORMAL', DPH: 'HYPER', DPA: 'ANOTHER', DPL: 'LEGGENDARIA' };
  // lamp string → 강도 number (정렬용). charts_json 에 lampNum 있으면 그걸 우선.
  var LAMP_NUM = { NP: 0, F: 1, AC: 2, EC: 3, NC: 4, HC: 5, EX: 6, FC: 7, PFC: 7 };
  // lampNum (0~7) → 약어 코드. charts_json 의 lamp 포맷이 소스마다 다름:
  //   INFOhSorry  = 약어 ('HC', 'EX', 'NP' ...)
  //   오소리(2-calc-score) = 풀네임 ('HARD', 'EX HARD', 'NO PLAY' ...)
  // → lampNum 은 양쪽 다 0~7 숫자로 통일돼 있으므로 이걸 1순위로 사용.
  var NUM_TO_LAMP = ['NP', 'F', 'AC', 'EC', 'NC', 'HC', 'EX', 'FC'];
  // 풀네임 → 약어 (lampNum 도 없을 때의 최후 fallback)
  var FULLNAME_TO_LAMP = {
    'NO PLAY': 'NP', 'FAILED': 'F', 'ASSIST': 'AC', 'EASY': 'EC',
    'CLEAR': 'NC', 'HARD': 'HC', 'EX HARD': 'EX', 'FULL COMBO': 'FC',
  };
  // 차트 row (INFOhSorry DP탭 모바일 1행) 용 — slot 별 색 / DJ Level 커트라인
  var SLOT_COLOR = {
    DPN: '#74c0fc', DPH: '#efef51', DPA: '#fba8c1', DPL: '#ce8ef9',
    SPN: '#74c0fc', SPH: '#efef51', SPA: '#fba8c1', SPL: '#ce8ef9',
  };
  var RATE_CUTS = [{ name: 'A', pct: 6 / 9 }, { name: 'AA', pct: 7 / 9 }, { name: 'AAA', pct: 8 / 9 }];
  // diff → slot 역매핑 — 오소리 charts_json 은 slot 없이 diff ('ANOTHER' 등) 만 보유
  var DIFF_TO_SLOT = { NORMAL: 'DPN', HYPER: 'DPH', ANOTHER: 'DPA', LEGGENDARIA: 'DPL', BEGINNER: 'DPB' };

  // 곡명 정규화 — zasa-data 매칭용 (oldOSR.js 등과 동일 풀버전)
  // norm — 브라우저 (gist eval) 환경: window.OhsorryNorm (먼저 load 필수) / Node 환경: require
  const norm = (typeof window !== 'undefined' && window.OhsorryNorm && window.OhsorryNorm.norm)
    ? window.OhsorryNorm.norm
    : require('./normTitle').norm;
  function decEnt(s) {
    if (!s) return s;
    var m = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#039;': "'", '&apos;': "'", '&nbsp;': ' ' };
    return s.replace(/&(amp|lt|gt|quot|#039|apos|nbsp);/g, function (x) { return m[x] || x; })
      .replace(/&#x([0-9a-fA-F]+);/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(parseInt(d, 10)); });
  }

  function lampOf(c) {
    // 1순위: lampNum (INFOhSorry / 오소리 양쪽 charts_json 모두 0~7 숫자 보유)
    if (typeof c.lampNum === 'number' && NUM_TO_LAMP[c.lampNum]) return NUM_TO_LAMP[c.lampNum];
    // 2순위: lamp 문자열 — 약어 ('HC') 또는 'PFC'
    var l = c.lamp === 'PFC' ? 'FC' : (c.lamp || 'NP');
    if (LAMP_BAR_ORDER.indexOf(l) >= 0) return l;
    // 3순위: 풀네임 ('HARD' 등 — 오소리 charts_json 구버전 / lampNum 누락 시)
    return FULLNAME_TO_LAMP[l] || 'NP';
  }
  function lampNumOf(c) {
    if (typeof c.lampNum === 'number') return c.lampNum;
    return LAMP_NUM[lampOf(c)] != null ? LAMP_NUM[lampOf(c)] : 0;
  }
  // DJ Level 정렬 순서 — 높을수록 좋음. 미플레이 / null 은 0 (가장 아래).
  var DJLV_ORDER = { AAA: 8, AA: 7, A: 6, B: 5, C: 4, D: 3, E: 2, F: 1 };
  function djlvOf(c) {
    var l = c.lamp === 'NP' || lampOf(c) === 'NP' ? null : (c.djLevel || c.letter || null);
    return l ? (DJLV_ORDER[l] || 0) : 0;
  }
  // slot 결정 — INF charts 는 slot 보유, 오소리 charts 는 diff 로 derive (난이도 색 / † 구별용)
  function slotOf(c) {
    if (c.slot) return c.slot;
    return DIFF_TO_SLOT[c.diff] || '';
  }
  function letterColor(l) {
    if (l === 'AAA' || l === 'AA') return '#dcaf45';
    if (l === 'A') return '#52a447';
    if (l === 'B') return '#74c0fc';
    if (l === 'C' || l === 'D') return '#888';
    if (l === 'E' || l === 'F') return '#ff6b6b';
    return '#aaa';
  }
  // DJ Level — EX 점수 → 등급 / 등급 → 하한 EX 컷 (max = noteCount*2). ohSorryWeb rankingModal 과 동일 로직.
  var DJ_CUT_NUM = { F: 0, E: 2, D: 3, C: 4, B: 5, A: 6, AA: 7, AAA: 8 };
  function djLevelFromScore(exScore, noteCount) {
    if (typeof exScore !== 'number' || typeof noteCount !== 'number' || noteCount <= 0) return null;
    var r = exScore / (noteCount * 2);
    if (r >= 8 / 9) return 'AAA';
    if (r >= 7 / 9) return 'AA';
    if (r >= 6 / 9) return 'A';
    if (r >= 5 / 9) return 'B';
    if (r >= 4 / 9) return 'C';
    if (r >= 3 / 9) return 'D';
    if (r >= 2 / 9) return 'E';
    return 'F';
  }
  // 해당 등급의 하한 EX 컷 (그 등급에 막 진입하는 최소 점수).
  function djGradeMinEx(grade, noteCount) {
    if (DJ_CUT_NUM[grade] == null || !(noteCount > 0)) return null;
    return Math.ceil(noteCount * 2 * DJ_CUT_NUM[grade] / 9);
  }
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  // CSS 주입 (한 번만)
  var STYLE_ID = '__ohsorry_shelf_style';
  function injectStyle() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      // 컬럼: [lamp 분포 스택드바 | 난이도 라벨 | 곡 목록] — 스택바를 제일 왼쪽으로
      '.shelf-group { display: grid; grid-template-columns: 6px 64px 1fr; }',
      '.shelf-group + .shelf-group { margin-top: 22px; }',
      // 그룹별 lamp 분포 세로 스택드 바 (상위 클리어램프가 아래로 — column-reverse)
      '.shelf-level-stackbar { display: flex; flex-direction: column-reverse; align-self: stretch; width: 6px; flex-shrink: 0; }',
      '.shelf-level-stackbar-seg { display: block; width: 100%; flex-grow: 0; flex-shrink: 0; }',
      // 난이도 라벨 셀
      '.shelf-level { font-size: 13px; font-weight: 700; color: #f8f9fa; display: flex; flex-direction: column; align-items: flex-end; justify-content: center; gap: 2px; padding-right: 8px; }',
      '.shelf-level-count { font-size: 10.5px; font-weight: 400; color: #6c757d; }',
      // 곡 목록
      '.shelf-songs { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); }',
      '.shelf-song { padding: 0; font-size: 12px; border-bottom: 1px solid #2d2d2d; display: flex; align-items: stretch; gap: 6px; min-height: 26px; position: relative; overflow: hidden; }',
      '.shelf-song-lampbox { flex-shrink: 0; display: block; width: 6px; align-self: stretch; }',
      '.shelf-song-text { flex: 1 1 auto; white-space: nowrap; align-self: center; color: #e9ecef; }',
      '.shelf-song.slot-DPL .shelf-song-text { color: #ce8ef9; }',
      // ANOTHER (DPA) 는 lv11/12 서열표의 대다수라 기본색 유지 — HYPER/NORMAL/LEGGENDARIA 만 강조
      '.shelf-song.slot-DPH .shelf-song-text { color: #efef51; }',
      '.shelf-song.slot-DPN .shelf-song-text { color: #74c0fc; }',
      '.shelf-song.lamp-NP { opacity: 0.45; }',
      // DJ Level 우측 오버레이
      '.shelf-song-djlv { position: absolute; right: 0; top: 0; bottom: 0; display: flex; align-items: center; font-size: 10px; font-weight: 700; letter-spacing: -0.3px; z-index: 1; pointer-events: none; background: #1a1a1a; padding: 0 5px 0 3px; }',
      // 곡 셀 세 번째 줄 (EX스코어 + DJ레벨) — 모바일 전용, PC 에선 숨김.
      '.shelf-song-meta { display: none; }',
      // 레벨 토글 — INFOhSorry .dp12-level-tab 스타일 (밑줄 강조)
      '.shelf-section-title { display: flex; align-items: center; gap: 12px; margin: 12px 0; border-bottom: 1px solid #343a40; }',
      '.shelf-level-tabs { display: inline-flex; }',
      '.shelf-lv-tab { background: transparent; border: none; border-bottom: 3px solid transparent; color: #6c757d; padding: 5px 35px; font-size: 15px; font-weight: 600; cursor: pointer; font-family: inherit; margin-bottom: -1px; }',
      '.shelf-lv-tab:hover:not(.active) { color: #ced4da; }',
      '.shelf-lv-tab.active { color: #f8f9fa; border-bottom-color: #ff6b9d; }',
      // 툴바 — lamp 범례 (좌) + 정렬 토글 + 캡처 버튼 (우)
      '.shelf-toolbar { display: flex; align-items: center; gap: 16px; margin: 0 0 14px; flex-wrap: wrap; }',
      '.shelf-lamp-legend { display: flex; flex-wrap: wrap; gap: 6px 12px; font-size: 11px; color: #adb5bd; }',
      '.shelf-lamp-legend-item { display: flex; align-items: center; gap: 4px; }',
      // 범례 색박스 — 표 안 .shelf-song-lampbox 와 같은 6px 폭
      '.shelf-lamp-legend-swatch { display: inline-block; width: 6px; height: 14px; flex-shrink: 0; }',
      // 정렬 토글 — INFOhSorry .dp12-sort 스타일 (박스 X, 텍스트만)
      '.shelf-sort { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-left: auto; flex-shrink: 0; }',
      '.shelf-sort-btn { padding: 0; border: none; background: none; cursor: pointer; font-family: inherit; font-size: 13px; color: #6c757d; }',
      '.shelf-sort-btn:hover:not(.active) { color: #ced4da; }',
      '.shelf-sort-btn.active { color: #f8f9fa; font-weight: 700; }',
      '.shelf-sort-sep { color: #495057; font-size: 13px; user-select: none; }',
      '.shelf-capture-btn { margin-left: 8px; padding: 5px 16px; border: 1px solid #343a40; background: #2d2d2d; color: #ced4da; border-radius: 4px; cursor: pointer; font-family: inherit; font-size: 13px; flex-shrink: 0; }',
      '.shelf-capture-btn:hover:not(:disabled) { background: #3a3a3a; color: #f8f9fa; }',
      '.shelf-capture-btn:disabled { cursor: wait; opacity: 0.5; }',
      // 표 전체 lamp 분포 스택드 바 — 서열표 최상단 (legend 위)
      '.shelf-stackbar { display: flex; width: 100%; max-width: 500px; height: 24px; margin: 16px 0 0 0; border-radius: 4px; overflow: hidden; font-size: 11px; font-weight: 600; }',
      '.shelf-stackbar-seg { display: flex; align-items: center; justify-content: center; color: #fff; text-shadow: 0 0 2px rgba(0,0,0,0.5); min-width: 0; overflow: hidden; white-space: nowrap; }',
      // 곡명 클릭 가능 표시
      '.shelf-song-clickable { cursor: pointer; }',
      '.shelf-song-clickable:hover .shelf-song-text { font-weight: 700; }',
      // 차트 row (INFOhSorry DP탭 모바일 1행 포팅) — 곡명 클릭 토스트용
      '.shelf-row { display: grid; grid-template-columns: 8px 32px minmax(0, 1fr) auto 60px; grid-template-rows: auto auto; column-gap: 8px; row-gap: 2px; background: #2d2d2d; padding: 4px 8px 4px 0; align-items: center; border-radius: 4px; font-variant-numeric: tabular-nums; overflow: hidden; white-space: nowrap; }',
      '.shelf-row-lamp { grid-row: 1 / 3; grid-column: 1; align-self: stretch; }',
      '.shelf-row-level { grid-row: 1 / 3; grid-column: 2; align-self: stretch; display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: 700; line-height: 1; white-space: nowrap; }',
      '.shelf-row-title { grid-row: 1; grid-column: 3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 500; color: #e9ecef; }',
      '.shelf-row-rate { grid-row: 2; grid-column: 3; min-height: 22px; position: relative; overflow: hidden; display: flex; align-items: center; justify-content: flex-end; }',
      '.shelf-row-rate-bg { position: absolute; inset: 0; background: #232323; }',
      '.shelf-row-rate-fill { position: absolute; left: 0; top: 0; bottom: 0; background: linear-gradient(to right, #c44444, #e58484); }',
      '.shelf-row-rate-cut { position: absolute; top: 0; bottom: 0; width: 1px; background: #555; z-index: 1; }',
      '.shelf-row-rate-text { position: relative; z-index: 2; padding-right: 8px; font-size: 11.5px; color: #e9ecef; display: inline-flex; align-items: baseline; gap: 3px; }',
      '.shelf-row-rate-pct { font-size: 10px; color: #ced4da; }',
      '.shelf-row-rate-letter { font-weight: 700; }',
      '.shelf-row-rate-empty { position: relative; z-index: 2; padding-right: 8px; color: #6c757d; }',
      '.shelf-row-lamptext { grid-row: 1; grid-column: 4 / 6; display: flex; align-items: center; justify-content: flex-end; font-weight: 700; font-size: 12px; padding-right: 6px; color: #ced4da; }',
      '.shelf-row-sc-label { grid-row: 1; grid-column: 4; display: flex; align-items: center; justify-content: flex-end; color: #6c757d; font-size: 11px; }',
      '.shelf-row-sc-value { grid-row: 1; grid-column: 5; display: flex; align-items: center; justify-content: flex-end; font-weight: 700; font-size: 14px; padding-right: 6px; color: #f8f9fa; }',
      '.shelf-row-miss-label { grid-row: 2; grid-column: 4; display: flex; align-items: center; justify-content: flex-end; color: #6c757d; font-size: 11px; }',
      '.shelf-row-miss-value { grid-row: 2; grid-column: 5; display: flex; align-items: center; justify-content: flex-end; font-size: 13px; padding-right: 6px; color: #e9ecef; }',
      '.shelf-empty { color: #6c757d; text-align: center; padding: 30px; }',
      // PC: lamp 범례 + 하단 전체 스택바 좌측 margin = 레벨열 너비(64px) — INFOhSorry .dp12-stackbar 와 동일
      '@media (min-width: 769px) {',
      '  .shelf-lamp-legend { margin-left: 64px; }',
      '  .shelf-stackbar { margin-left: 64px; }',
      '}',
      // 모바일 — 레벨 라벨이 위 row, 곡 목록 3열 고정, 스택바 숨김.
      //   .shelf-level 은 sticky — containing block 이 .shelf-group 이라 그 그룹 범위 안에서만
      //   상단 고정되고, 다음 그룹이 올라오면 자연히 밀려 사라짐.
      '@media (max-width: 768px) {',
      '  .shelf-group { grid-template-columns: 1fr; grid-template-rows: auto auto; }',
      '  .shelf-level-stackbar { display: none; }',
      '  .shelf-level { font-size: 15px; flex-direction: row; align-items: baseline; justify-content: flex-start; gap: 6px; padding: 4px 0; border-bottom: 1px solid #2d2d2d; position: sticky; top: 0; z-index: 3; background: #1a1a1a; }',
      '  .shelf-songs { grid-template-columns: repeat(3, minmax(0, 1fr)); }',
      // 곡 셀 — 세로 스택 2줄 고정 (min-height): 곡명 + EX스코어/DJ레벨 한 줄. meta 없으면 곡명 2줄.
      '  .shelf-song { flex-direction: column; align-items: stretch; gap: 3px; padding: 5px 7px 5px 13px; font-size: 13px; min-height: 30px; }',
      // lampbox — 세로 레이아웃에선 absolute 좌측 6px 띠 (flex stretch 시 가로 전체로 퍼지는 것 방지).
      '  .shelf-song-lampbox { position: absolute; left: 0; top: 0; bottom: 0; width: 6px; }',
      // 곡명 — 1줄, 넘치면 말줄임표(…) 없이 끝을 그대로 자름 (text-overflow: clip).
      '  .shelf-song-text { align-self: stretch; white-space: nowrap; overflow: hidden; text-overflow: clip; line-height: 1.25; font-size: 13px; }',
      // PC 우측 오버레이 숨기고, 세 번째 줄 meta 로 EX스코어(좌)+DJ레벨(우) 동시 표시.
      '  .shelf-song-djlv { display: none; }',
      // 2번째 줄: 왼쪽=DJ등급(색)+작은 회색 +컷대비, 오른쪽=흰색 EXScore.
      '  .shelf-song-meta { display: flex; justify-content: flex-start; align-items: baseline; gap: 2px; margin-top: auto; font-size: 11px; font-weight: 700; line-height: 1; white-space: nowrap; overflow: hidden; }',
      '  .shelf-song-meta-dj { flex-shrink: 0; }',
      // EX스코어 — 흰색, 우측 정렬(margin-left:auto).
      '  .shelf-song-meta-ex { color: #f8f9fa; font-variant-numeric: tabular-nums; margin-left: auto; }',
      // +컷대비 (예: +167) — 더 작고 회색.
      '  .shelf-song-meta-diff { font-size: 9px; color: #888; font-variant-numeric: tabular-nums; }',
      // meta(EX/DJ) 가 빈 셀 — meta 줄 숨기고 곡명을 2줄까지 (말줄임표 없이 끝 잘림). 셀 높이는 min-height 로 2줄 유지.
      '  .shelf-song-nometa .shelf-song-meta { display: none; }',
      '  .shelf-song-nometa .shelf-song-text { white-space: normal; max-height: 2.5em; overflow: hidden; }',
      '  .shelf-stackbar { max-width: none; }',
      '}',
    ].join('\n');
    document.head.appendChild(style);
  }

  // 그룹 내 곡 정렬 — INFOhSorry Dp12Table 과 동일.
  //   'title'      : 곡명 오름차순
  //   'lamp-desc'  : 램프 강한 순 / 'lamp-asc' : 약한 순
  //   'djlv-desc'  : DJ Level 높은 순 / 'djlv-asc' : 낮은 순
  //   (lamp / djlv 동률 시 곡명 오름차순 tie-break)
  function sortSongs(songs, sortBy) {
    if (sortBy === 'lamp-desc' || sortBy === 'lamp-asc') {
      var lampAsc = sortBy === 'lamp-asc';
      songs.sort(function (a, b) {
        var ln = lampAsc ? lampNumOf(a) - lampNumOf(b) : lampNumOf(b) - lampNumOf(a);
        if (ln !== 0) return ln;
        return (a.title || '').localeCompare(b.title || '');
      });
    } else if (sortBy === 'djlv-desc' || sortBy === 'djlv-asc') {
      var djAsc = sortBy === 'djlv-asc';
      songs.sort(function (a, b) {
        var dn = djAsc ? djlvOf(a) - djlvOf(b) : djlvOf(b) - djlvOf(a);
        if (dn !== 0) return dn;
        return (a.title || '').localeCompare(b.title || '');
      });
    } else {
      songs.sort(function (a, b) { return (a.title || '').localeCompare(b.title || ''); });
    }
  }

  // charts → gameLevel 필터 + 그룹 ★ 결정 → 그룹화 → 격자 HTML
  function renderShelf(charts, opts) {
    opts = opts || {};
    var groupField = opts.groupField || 'level';
    var fallbackField = opts.fallbackField || null;
    var gameLevel = opts.gameLevel;
    var sortBy = opts.sortBy || 'title';
    var rightField = opts.rightField === 'exscore' ? 'exscore' : 'djlv';

    // 곡명 클릭 → 원본 charts 인덱스 역참조용 (.shelf-song[data-ck])
    var idxOf = new Map();
    for (var ii = 0; ii < charts.length; ii++) idxOf.set(charts[ii], ii);

    var list = [];
    if (opts.zasaData && Array.isArray(opts.zasaData.charts)) {
      // 오소리(아케이드) 유저 — zasa-data.charts 를 base 로 깔고 charts_json 매칭.
      // 매칭 안 된 zasa 곡은 NP placeholder 로 추가 → 미플레이 곡도 격자에 표시.
      // charts_json 에만 있고 zasa 에 없는 곡 (zasa 미등록 신곡 등) 은 '미분류' 그룹.
      var chartIdx = {};
      for (var ci = 0; ci < charts.length; ci++) {
        var cc = charts[ci];
        chartIdx[norm(decEnt(cc.title)) + '|' + cc.diff] = cc;
      }
      var zasaKeySet = {};
      for (var zi = 0; zi < opts.zasaData.charts.length; zi++) {
        var zc = opts.zasaData.charts[zi];
        if (gameLevel != null && zc.gameLevel !== gameLevel) continue;
        var zkey = norm(zc.title) + '|' + zc.diff;
        zasaKeySet[zkey] = true;
        var matched = chartIdx[zkey];
        if (matched) {
          list.push({ c: matched, lv: zc.level });
        } else {
          // NP placeholder — 클릭 토스트 비활성 (idxOf 에 없으니 ck=-1)
          list.push({
            c: {
              title: zc.title,
              diff: zc.diff,
              gameLevel: zc.gameLevel,
              lamp: 'NP',
              lampNum: 0,
              slot: DIFF_TO_SLOT[zc.diff] || '',
            },
            lv: zc.level,
          });
        }
      }
      // charts_json 에만 있는 곡 (zasa 미등록) — 미분류 그룹으로 따로 추가
      for (var ci2 = 0; ci2 < charts.length; ci2++) {
        var cc2 = charts[ci2];
        if (gameLevel != null && cc2.gameLevel !== gameLevel) continue;
        var ckey = norm(decEnt(cc2.title)) + '|' + cc2.diff;
        if (!zasaKeySet[ckey]) list.push({ c: cc2, lv: null });
      }
    } else {
      // INF 유저 — charts_json 그대로 순회, groupField → fallbackField
      for (var i = 0; i < charts.length; i++) {
        var c = charts[i];
        if (gameLevel != null && c.gameLevel !== gameLevel) continue;
        var lv = c[groupField];
        if (typeof lv !== 'number' && fallbackField) lv = c[fallbackField];
        list.push({ c: c, lv: typeof lv === 'number' ? lv : null });
      }
    }
    if (list.length === 0) return '<div class="shelf-empty">해당 레벨의 곡 데이터가 없습니다.</div>';

    // 레벨별 그룹 — Map(lv → 곡[])
    var UNCLASSIFIED = -1;
    var groups = {};
    for (var j = 0; j < list.length; j++) {
      var key = list[j].lv != null ? list[j].lv : UNCLASSIFIED;
      if (!groups[key]) groups[key] = [];
      groups[key].push(list[j].c);
    }
    // 정렬 — 큰 ★ → 작은 ★ → 미분류
    var keys = Object.keys(groups).map(Number).sort(function (a, b) {
      if (a === UNCLASSIFIED) return 1;
      if (b === UNCLASSIFIED) return -1;
      return b - a;
    });

    var html = '';
    for (var k = 0; k < keys.length; k++) {
      var gkey = keys[k];
      var songs = groups[gkey];
      // 그룹 내 정렬 (opts.sortBy)
      sortSongs(songs, sortBy);

      // lamp 분포 stackbar
      var counts = {};
      for (var s = 0; s < songs.length; s++) {
        var lp = lampOf(songs[s]);
        counts[lp] = (counts[lp] || 0) + 1;
      }
      var stackHtml = '';
      for (var bi = 0; bi < LAMP_BAR_ORDER.length; bi++) {
        var lamp = LAMP_BAR_ORDER[bi];
        var cnt = counts[lamp] || 0;
        if (cnt === 0) continue;
        var pct = (cnt / songs.length) * 100;
        stackHtml += '<span class="shelf-level-stackbar-seg" style="flex-basis:' + pct.toFixed(2) + '%;background:' + LAMP_BG[lamp] + '" title="' + escHtml(LAMP_LABEL[lamp] || lamp) + ': ' + cnt + '곡"></span>';
      }

      // 곡 격자
      var songsHtml = '';
      for (var si = 0; si < songs.length; si++) {
        var sc = songs[si];
        var lampBox = lampOf(sc);
        var scSlot = slotOf(sc);
        var isLegg = scSlot === 'DPL';
        var dj = lampBox === 'NP' ? '' : (sc.djLevel || sc.letter || '');
        // EX 스코어 — 미플레이 / 0 / 비수치는 빈 문자열.
        var exText = (lampBox !== 'NP' && typeof sc.exScore === 'number' && sc.exScore > 0)
          ? String(sc.exScore) : '';
        // PC 우측 오버레이 — rightField 토글값 (exscore | djlv). 색은 둘 다 DJ Level 색 (letterColor).
        var rightText = rightField === 'exscore' ? exText : dj;
        var rightColor = dj ? letterColor(dj) : '';
        var djStyle = rightColor ? ' style="color:' + rightColor + '"' : '';
        var slotLabel = SLOT_LABEL[scSlot] || scSlot || '';
        var tooltip = escHtml(sc.title) + ' [' + escHtml(slotLabel) + '] ' + escHtml(LAMP_LABEL[lampBox] || lampBox);
        var ck = idxOf.has(sc) ? idxOf.get(sc) : -1;
        // placeholder (NP — idxOf 에 없는 zasa-only 곡) 은 클릭 토스트 정보가 없어 비활성
        var clickClass = ck >= 0 ? ' shelf-song-clickable' : '';
        // 모바일 — EX스코어·DJ레벨 둘 다 없으면(미플레이 등) meta 줄 대신 곡명을 2줄로.
        var noMetaClass = (!exText && !dj) ? ' shelf-song-nometa' : '';
        // 모바일 meta 줄 — "DJ등급 EX스코어 등급+컷대비" (예: B 2229 B+167).
        //   noteCount 있으면 EX 기준 등급 재계산(정확) + 등급 컷 대비 차이. 없으면 등급만.
        var nc = (typeof sc.noteCount === 'number' && sc.noteCount > 0) ? sc.noteCount : 0;
        var metaGrade = (exText && nc) ? djLevelFromScore(sc.exScore, nc) : dj;
        var metaGradeStyle = metaGrade ? ' style="color:' + letterColor(metaGrade) + '"' : '';
        var metaDiff = '';  // +컷대비 (등급 글자 없이 "+167" 만 — 등급은 meta-dj 가 색으로 표시)
        if (exText && nc && metaGrade) {
          var gmin = djGradeMinEx(metaGrade, nc);
          if (gmin != null && sc.exScore - gmin >= 0) metaDiff = '+' + (sc.exScore - gmin);
        }
        songsHtml += '<div class="shelf-song' + clickClass + noMetaClass + ' slot-' + escHtml(scSlot) + ' lamp-' + lampBox + '" data-ck="' + ck + '" title="' + tooltip + '">'
          + '<span class="shelf-song-lampbox" style="background:' + LAMP_BG[lampBox] + '"></span>'
          + '<span class="shelf-song-text">' + (isLegg ? '† ' : '') + escHtml(sc.title) + '</span>'
          + '<span class="shelf-song-djlv"' + djStyle + '>' + escHtml(rightText) + '</span>'
          // 모바일 meta 줄 — 왼쪽: DJ등급(색)+작은 회색 +컷대비, 오른쪽: 흰색 EXScore. PC 에선 CSS 로 숨김.
          + '<span class="shelf-song-meta">'
          + (metaGrade ? '<span class="shelf-song-meta-dj"' + metaGradeStyle + '>' + escHtml(metaGrade) + '</span>' : '')
          + (metaDiff ? '<span class="shelf-song-meta-diff">' + escHtml(metaDiff) + '</span>' : '')
          + (exText ? '<span class="shelf-song-meta-ex">' + escHtml(exText) + '</span>' : '')
          + '</span>'
          + '</div>';
      }

      var lvLabel = gkey === UNCLASSIFIED ? '미분류' : Number(gkey).toFixed(1);
      html += '<div class="shelf-group">'
        + '<div class="shelf-level-stackbar" title="그룹 lamp 분포 (' + songs.length + '곡)">' + stackHtml + '</div>'
        + '<div class="shelf-level">' + lvLabel + '<span class="shelf-level-count">' + songs.length + '곡</span></div>'
        + '<div class="shelf-songs">' + songsHtml + '</div>'
        + '</div>';
    }
    return html;
  }

  // lamp 색상 박스 범례 HTML (좋은 → 나쁜 순)
  function renderLegend() {
    var h = '<div class="shelf-lamp-legend">';
    for (var i = 0; i < LAMP_BAR_ORDER.length; i++) {
      var lamp = LAMP_BAR_ORDER[i];
      h += '<span class="shelf-lamp-legend-item">'
        + '<span class="shelf-lamp-legend-swatch" style="background:' + LAMP_BG[lamp] + '"></span>'
        + '<span>' + escHtml(LAMP_LABEL[lamp] || lamp) + '</span>'
        + '</span>';
    }
    return h + '</div>';
  }

  // 표 전체 lamp 분포 스택드 바 HTML — gameLevel 로 필터한 charts 전체 집계
  //   opts.zasaData — 있으면 zasa-data.charts 를 base 로 깔고 charts 매칭, 미매칭 zasa 곡은 NP 로 카운트
  //     (오소리(아케이드) charts_json 은 플레이한 곡만 들어있어 이 옵션 없으면 NP 가 0 으로 잘못 집계됨)
  function renderStackbar(charts, gameLevel, opts) {
    opts = opts || {};
    var counts = {};
    var total = 0;
    if (opts.zasaData && Array.isArray(opts.zasaData.charts)) {
      // zasa base — 미매칭 zasa 곡은 NP, charts_json 에만 있는 곡 (미분류) 은 본인 lamp 로 추가
      var chartIdx = {};
      for (var ci = 0; ci < charts.length; ci++) {
        var cc = charts[ci];
        chartIdx[norm(decEnt(cc.title)) + '|' + cc.diff] = cc;
      }
      var zasaKeySet = {};
      for (var zi = 0; zi < opts.zasaData.charts.length; zi++) {
        var zc = opts.zasaData.charts[zi];
        if (gameLevel != null && zc.gameLevel !== gameLevel) continue;
        var zkey = norm(zc.title) + '|' + zc.diff;
        zasaKeySet[zkey] = true;
        var matched = chartIdx[zkey];
        var lpz = matched ? lampOf(matched) : 'NP';
        counts[lpz] = (counts[lpz] || 0) + 1;
        total++;
      }
      for (var ci2 = 0; ci2 < charts.length; ci2++) {
        var cc2 = charts[ci2];
        if (gameLevel != null && cc2.gameLevel !== gameLevel) continue;
        var ckey = norm(decEnt(cc2.title)) + '|' + cc2.diff;
        if (zasaKeySet[ckey]) continue;
        var lpu = lampOf(cc2);
        counts[lpu] = (counts[lpu] || 0) + 1;
        total++;
      }
    } else {
      for (var i = 0; i < charts.length; i++) {
        var c = charts[i];
        if (gameLevel != null && c.gameLevel !== gameLevel) continue;
        var lp = lampOf(c);
        counts[lp] = (counts[lp] || 0) + 1;
        total++;
      }
    }
    if (total === 0) return '';
    var h = '<div class="shelf-stackbar">';
    for (var bi = 0; bi < LAMP_BAR_ORDER.length; bi++) {
      var lamp = LAMP_BAR_ORDER[bi];
      var cnt = counts[lamp] || 0;
      if (cnt === 0) continue;
      var pct = (cnt / total) * 100;
      var dark = (lamp === 'HC' || lamp === 'NP');
      h += '<span class="shelf-stackbar-seg" style="flex-basis:' + pct.toFixed(2) + '%;background:' + LAMP_BG[lamp]
        + (dark ? ';color:#555;text-shadow:none' : '') + '" title="' + escHtml(LAMP_LABEL[lamp] || lamp) + ': ' + cnt + '곡">' + cnt + '</span>';
    }
    return h + '</div>';
  }

  // INFOhSorry DP탭 모바일 1행 (.ct-tr) 포팅 — 곡명 클릭 토스트용.
  //   col: [lamp 8px | level 32px | title(r1)/rate(r2) | score/miss label | score/miss value]
  //   c: charts_json 한 곡. noteCount / exScore / missCount / slot 은 소스(오소리/INF)별로 없을 수 있음.
  function renderChartRow(c) {
    var lamp = lampOf(c);
    var locked = c.unlocked === false;
    var played = lamp !== 'NP' && !locked;
    var gameLevel = c.gameLevel != null ? c.gameLevel : '-';
    var cSlot = slotOf(c);
    var slotColor = SLOT_COLOR[cSlot] || '#f8f9fa';
    var isLegg = cSlot === 'DPL';
    var noteCount = typeof c.noteCount === 'number' ? c.noteCount : 0;
    var exScore = typeof c.exScore === 'number' ? c.exScore : 0;
    // 아케이드(오소리) charts 는 pgreat 만 있고 Good 수치가 없어 MISS COUNT(BP) 를 못 구함 → '-' 표기.
    // INF charts (pgreat 없음, Reflux tsv 의 missCount 보유) 만 실제 미스 표시.
    var isArcade = typeof c.pgreat === 'number';
    var missCount = (!isArcade && typeof c.missCount === 'number') ? c.missCount : -1;
    var letter = c.djLevel || c.letter || '';
    var rate = (played && noteCount > 0) ? exScore / (noteCount * 2) : null;

    var lampCell = '<div class="shelf-row-lamp" style="background:' + LAMP_BG[lamp] + '"></div>';
    var levelCell = '<div class="shelf-row-level" style="color:' + slotColor + '">' + escHtml(gameLevel) + '</div>';
    var titleCell = '<div class="shelf-row-title">' + (isLegg ? '† ' : '') + escHtml(c.title || '') + '</div>';

    var rateCell;
    if (rate != null) {
      var pct = Math.max(0, Math.min(1, rate)) * 100;
      var cuts = '';
      for (var i = 0; i < RATE_CUTS.length; i++) {
        cuts += '<div class="shelf-row-rate-cut" style="left:' + (RATE_CUTS[i].pct * 100).toFixed(2) + '%"></div>';
      }
      rateCell = '<div class="shelf-row-rate">'
        + '<div class="shelf-row-rate-bg"></div>'
        + '<div class="shelf-row-rate-fill" style="width:' + pct.toFixed(2) + '%"></div>'
        + cuts
        + '<span class="shelf-row-rate-text">'
        + '<span class="shelf-row-rate-pct">(' + (rate * 100).toFixed(2) + '%)</span>'
        + '<span class="shelf-row-rate-letter" style="color:' + letterColor(letter) + '">' + escHtml(letter || '-') + '</span>'
        + '</span></div>';
    } else {
      rateCell = '<div class="shelf-row-rate"><span class="shelf-row-rate-empty">-</span></div>';
    }

    var rightCells;
    if (played) {
      // 아케이드(오소리) 는 MISS 못 구함 → 라벨/값 비움 (영역/그리드 칸은 그대로 유지).
      var missLabel = isArcade ? '' : 'MISS';
      var missVal = isArcade ? '' : (missCount >= 0 ? missCount.toLocaleString() : '-');
      rightCells = '<div class="shelf-row-sc-label">SCORE</div>'
        + '<div class="shelf-row-sc-value">' + (exScore > 0 ? exScore.toLocaleString() : '-') + '</div>'
        + '<div class="shelf-row-miss-label">' + missLabel + '</div>'
        + '<div class="shelf-row-miss-value">' + missVal + '</div>';
    } else {
      rightCells = '<div class="shelf-row-lamptext">' + escHtml(locked ? '잠김' : (LAMP_LABEL[lamp] || lamp)) + '</div>';
    }

    return '<div class="shelf-row' + (locked ? ' locked' : '') + (played ? ' played' : '') + '">'
      + lampCell + levelCell + titleCell + rateCell + rightCells + '</div>';
  }

  // INF ID 인데 ohSorry 본체가 만든 오소리식 데이터일 때 — charts 의 누락 필드를 zasa 매칭으로 보강.
  // gameLevel / level / zasaLevel 셋 다 누락 시에만 zasa.charts 의 값으로 채움 (이미 있으면 유지).
  // in-place 가공 (호출자가 deep copy 한 charts 를 넘기는 게 안전).
  function enrichChartsWithZasa(charts, zasaData) {
    if (!Array.isArray(charts) || !zasaData || !Array.isArray(zasaData.charts)) return;
    var zasaMap = {};
    for (var i = 0; i < zasaData.charts.length; i++) {
      var z = zasaData.charts[i];
      zasaMap[norm(z.title) + '|' + z.diff] = z;
    }
    for (var j = 0; j < charts.length; j++) {
      var c = charts[j];
      var z2 = zasaMap[norm(decEnt(c.title)) + '|' + c.diff];
      if (!z2) continue;
      if (typeof c.gameLevel !== 'number') c.gameLevel = z2.gameLevel;
      if (typeof c.level !== 'number') c.level = z2.level;
      if (typeof c.zasaLevel !== 'number') c.zasaLevel = z2.level;
    }
  }

  return {
    version: '0.0.26',
    injectStyle: injectStyle,
    LAMP_BG: LAMP_BG,                  // 외부에서 램프 색 재사용용 (ohSorryWeb users.js 플레이데이터 탭 등)
    djLevelFromScore: djLevelFromScore,
    renderShelf: renderShelf,
    renderLegend: renderLegend,
    renderStackbar: renderStackbar,
    renderChartRow: renderChartRow,
    enrichChartsWithZasa: enrichChartsWithZasa,
  };
}));
