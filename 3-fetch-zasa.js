// ============================================================
// STEP 3 (선택): zasa.sakura.ne.jp/dp/run.php 보충 데이터 추출
// ============================================================
// ereter.net 에 없는 ☆12 차트를 보완하기 위해 zasa 의 비공식 난이도표를 긁어옵니다.
// 결과는 추천곡 / ★값 추정에는 사용 X — 오로지 "★ 단위별 클리어 램프 표" 의 곡 수
// 보강용으로만 사용 (ereter 미등록 차트 검증).
//
// 사용 방법:
//   1. https://zasa.sakura.ne.jp/dp/run.php 페이지 열기
//   2. F12 → Console → 이 스크립트 붙여넣기 + Enter
//   3. 클립보드에 복사된 JSON 을 Gist 의 새 파일 zasa-data.json 에 붙여넣기
//   4. 2-calc-score.js 가 이 데이터를 함께 fetch (Gist 같은 위치)
// ============================================================

(async () => {
  if (!location.hostname.endsWith('zasa.sakura.ne.jp')) {
    alert(
      'zasa.sakura.ne.jp 도메인에서 실행해야 합니다.\n' +
      'https://zasa.sakura.ne.jp/dp/run.php 를 열고 그 페이지에서 실행하세요.'
    );
    return;
  }

  // span class → 우리가 쓰는 차트 표기 (ereter / 2-calc-score 와 일치)
  const SPAN_TO_DIFF = { H: 'HYPER', A: 'ANOTHER', L: 'LEGGENDARIA' };

  const table = document.querySelector('table.run');
  if (!table) {
    alert('table.run 을 못 찾았어요. 페이지 구조가 바뀐 것 같습니다.');
    return;
  }

  const charts = [];
  const rows = table.querySelectorAll('tr');
  rows.forEach((tr) => {
    const tds = tr.querySelectorAll('td');
    if (tds.length !== 4) return; // 헤더 row 등은 td 가 1~2개라 자동 skip
    const titleCell = tds[3];
    if (!titleCell.classList.contains('music')) return;
    const title = titleCell.textContent.trim();
    if (!title) return;

    for (let i = 0; i < 3; i++) {
      const a = tds[i].querySelector('a.music');
      if (!a) continue;
      const span = a.querySelector('span');
      if (!span) continue;
      const diff = SPAN_TO_DIFF[span.className];
      if (!diff) continue;
      const m = span.textContent.trim().match(/☆12 \(([0-9]+\.[0-9]+)\)/);
      if (!m) continue;
      const level = parseFloat(m[1]);
      if (!Number.isFinite(level) || level < 11.6 || level > 12.7) continue;
      charts.push({ title, diff, level });
    }
  });

  console.log(`[zasa] 추출된 ☆12 차트 (★11.6~12.7): ${charts.length}개`);

  const payload = {
    extractedAt: new Date().toISOString(),
    source: location.href,
    count: charts.length,
    charts,
  };
  const json = JSON.stringify(payload);

  navigator.clipboard
    .writeText(json)
    .then(() => {
      console.log('%c[zasa] ✅ JSON 이 클립보드에 복사되었습니다!', 'color:#1d9e75;font-weight:bold;font-size:14px');
      console.log(`   추출 일시: ${payload.extractedAt}`);
      console.log(`   차트 수:   ${payload.count}`);
      console.log('Gist 에 zasa-data.json 파일을 새로 만들거나 갱신하세요.');
      console.log('  1) https://gist.github.com 에서 해당 Gist 편집');
      console.log('  2) "Add file" → 파일명 zasa-data.json');
      console.log('  3) Ctrl+V');
      console.log('  4) "Update gist" 클릭');
    })
    .catch((err) => {
      console.warn('클립보드 복사 실패. 수동으로 JSON 을 복사하세요:');
      console.log(json);
    });

  window.__zasa_charts = charts;
  window.__zasa_payload = payload;
  window.__zasa_download = () => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'zasa-data.json';
    a.click();
    URL.revokeObjectURL(url);
  };
  console.log('💾 파일로 저장: __zasa_download()');
})();
