// ============================================================
// STEP 3 (선택): zasa.sakura.ne.jp/dp/run.php 보충 데이터 추출
// ============================================================
// ereter.net 에 없는 차트를 보완하기 위해 zasa 의 비공식 난이도표를 긁어옵니다.
// zasa 페이지에는 ☆10/11/12 차트가 모두 있고, 각각 decimal 난이도 (11.7, 12.3 등) 가 매겨져 있어요.
//
// 추출 규칙 (한 곡당):
//   1. ANOTHER 가 있으면 ANOTHER 추가
//   2. LEGGENDARIA 가 있으면 LEGGENDARIA 추가
//   3. HYPER 는 다음 중 하나일 때 추가:
//      (a) ANOTHER 와 LEGGENDARIA 가 모두 없는 경우 (fallback)
//      (b) HYPER 의 게임 LEVEL 이 11 또는 12 인 경우 (★11/12 HYPER 는 항상 포함)
//   → decimal 범위 필터 없음. 메인 채보 위주.
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

    // 한 row 의 3 셀 (HYPER / ANOTHER / LEGGENDARIA) 을 먼저 parsed 에 모은 뒤,
    // 위 규칙 (A/L 우선 + HYPER 는 fallback 또는 ★11/12) 따라 charts 에 push.
    const parsed = {};  // { HYPER: { gameLevel, level }, ANOTHER: {...}, LEGGENDARIA: {...} }
    for (let i = 0; i < 3; i++) {
      const a = tds[i].querySelector('a.music');
      if (!a) continue;
      const span = a.querySelector('span');
      if (!span) continue;
      const diff = SPAN_TO_DIFF[span.className];
      if (!diff) continue;
      // ☆10/11/12 등 어느 prefix 든 매칭. gameLevel 도 같이 캡처. decimal 범위 필터 없음.
      const m = span.textContent.trim().match(/☆(\d+)\s*\(([0-9]+\.[0-9]+)\)/);
      if (!m) continue;
      const gameLevel = parseInt(m[1], 10);
      const level = parseFloat(m[2]);
      if (!Number.isFinite(level)) continue;
      parsed[diff] = { gameLevel, level };
    }
    if (parsed.ANOTHER) {
      charts.push({ title, diff: 'ANOTHER', gameLevel: parsed.ANOTHER.gameLevel, level: parsed.ANOTHER.level });
    }
    if (parsed.LEGGENDARIA) {
      charts.push({ title, diff: 'LEGGENDARIA', gameLevel: parsed.LEGGENDARIA.gameLevel, level: parsed.LEGGENDARIA.level });
    }
    if (parsed.HYPER) {
      const noAdvanced = !parsed.ANOTHER && !parsed.LEGGENDARIA;
      const isHyperHi = parsed.HYPER.gameLevel === 11 || parsed.HYPER.gameLevel === 12;
      if (noAdvanced || isHyperHi) {
        charts.push({ title, diff: 'HYPER', gameLevel: parsed.HYPER.gameLevel, level: parsed.HYPER.level });
      }
    }
  });

  // 게임 LEVEL 별 / diff 별 분포 통계
  const byGameLevel = {};
  const byDiff = {};
  for (const c of charts) {
    byGameLevel[c.gameLevel] = (byGameLevel[c.gameLevel] || 0) + 1;
    byDiff[c.diff] = (byDiff[c.diff] || 0) + 1;
  }
  console.log(`[zasa] 추출된 차트: ${charts.length}개 (메인 채보 위주 — A/L 우선 + ★11/12 HYPER)`);
  for (const k of Object.keys(byGameLevel).sort((a, b) => Number(a) - Number(b))) {
    console.log(`   게임 LEVEL ${k}: ${byGameLevel[k]}곡`);
  }
  console.log(`   diff 별: ${Object.keys(byDiff).map(d => d + ' ' + byDiff[d]).join(' / ')}`);

  const payload = {
    extractedAt: new Date().toISOString(),
    source: location.href,
    count: charts.length,
    countByGameLevel: byGameLevel,
    countByDiff: byDiff,
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
