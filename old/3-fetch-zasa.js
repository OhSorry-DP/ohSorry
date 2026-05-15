// ============================================================
// STEP 3 (선택): zasa.sakura.ne.jp/dp/run.php 보충 데이터 추출
// ============================================================
// ereter.net 에 없는 차트를 보완하기 위해 zasa 의 비공식 난이도표를 긁어옵니다.
// zasa 페이지에는 ☆10/11/12 차트가 모두 있고, 각각 decimal 난이도 (11.7, 12.3 등) 가 매겨져 있어요.
// 우리는 이 중 decimal 11.6~12.7 차트만 추출하되, 게임 LEVEL (☆10/11/12) 도 함께 보존해서
// 나중에 레벨별로 분리해 검증할 수 있게 합니다.
//
// 사용 방법:
//   1. https://zasa.sakura.ne.jp/dp/run.php 페이지 열기
//   2. F12 → Console → 이 스크립트 붙여넣기 + Enter
//   3. 클립보드에 복사된 JSON 을 Gist 의 zasa-data.json 에 붙여넣기 (또는 __zasa_download())
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
      // 게임 LEVEL 무관 — ☆10/11/12 등 어느 prefix 든 매칭. gameLevel 도 같이 캡처.
      // (이전 버전은 ☆12 prefix 만 잡아서 게임 L11 의 zasa★ 11.6~12.1 차트가 다 누락됐음.)
      const m = span.textContent.trim().match(/☆(\d+)\s*\(([0-9]+\.[0-9]+)\)/);
      if (!m) continue;
      const gameLevel = parseInt(m[1], 10);
      const level = parseFloat(m[2]);
      if (!Number.isFinite(level) || level < 10.2 || level > 12.7) continue;
      charts.push({ title, diff, gameLevel, level });
    }
  });

  // 게임 LEVEL 별 분포 통계
  const byGameLevel = {};
  for (const c of charts) {
    byGameLevel[c.gameLevel] = (byGameLevel[c.gameLevel] || 0) + 1;
  }
  console.log(`[zasa] 추출된 차트 (decimal ★11.6~12.7): ${charts.length}개`);
  for (const k of Object.keys(byGameLevel).sort()) {
    console.log(`   게임 LEVEL ${k}: ${byGameLevel[k]}곡`);
  }

  const payload = {
    extractedAt: new Date().toISOString(),
    source: location.href,
    count: charts.length,
    countByGameLevel: byGameLevel,
    charts,
  };
  const json = JSON.stringify(payload);

  navigator.clipboard
    .writeText(json)
    .then(() => {
      console.log('%c[zasa] ✅ JSON 이 클립보드에 복사되었습니다!', 'color:#1d9e75;font-weight:bold;font-size:14px');
      console.log(`   추출 일시: ${payload.extractedAt}`);
      console.log(`   총 차트 수: ${payload.count}`);
      console.log('Gist 의 zasa-data.json 을 갱신하거나 __zasa_download() 로 파일 저장.');
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
