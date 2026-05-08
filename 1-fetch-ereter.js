// ============================================================
// STEP 1: ereter.net 어느 페이지에서나 실행 가능
// ============================================================
// perlevel 페이지가 아니어도 fetch 로 자동으로 받아서 파싱합니다.
//
// 페이지 구조 (확인됨):
//  - 단일 <table class="tablesorter">
//  - 헤더: ☆ | Title | EC diff | HC diff | EXH diff | EC count | HC count | EXH count
//  - 첫 컬럼: ☆12.0 같은 레벨 표시
//  - Title 셀: <a>곡명 <span style="color:#XXX">(차트종류)</span></a>
//  - diff 값: <td sort-value="0.77..."> ← 정확한 값은 sort-value 속성
//  - 차트색: ANOTHER=#fba8c1, LEGGENDARIA=#ce8ef9, HYPER=#efef51
// ============================================================

(async () => {
  const TARGET_PATH = '/iidxsongs/analytics/perlevel/';
  const TARGET_URL = `${location.protocol}//ereter.net${TARGET_PATH}`;

  // 도메인 체크
  if (!location.hostname.endsWith('ereter.net')) {
    alert(
      'ereter.net 도메인에서 실행해야 합니다.\n' +
      '먼저 ereter.net 을 열어서 그 페이지의 콘솔에서 실행하세요.'
    );
    return;
  }

  // perlevel 페이지면 현재 DOM 사용, 아니면 fetch 로 받아서 파싱
  let doc;
  if (location.pathname.includes('/iidxsongs/analytics/perlevel')) {
    doc = document;
    console.log('[ereter] 현재 페이지 DOM 사용');
  } else {
    console.log(`[ereter] perlevel 페이지 fetch 중... (${TARGET_PATH})`);
    try {
      const res = await fetch(TARGET_PATH, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      doc = new DOMParser().parseFromString(html, 'text/html');
      console.log(`[ereter] fetch 성공 (${html.length} bytes)`);
    } catch (e) {
      console.error('[ereter] fetch 실패:', e);
      alert('perlevel 페이지 fetch 실패: ' + e.message);
      return;
    }
  }

  // tablesorter 클래스는 클라이언트 JS 가 동적으로 추가하므로 SSR HTML 에는 없음.
  // 대신 thead 안에 ☆ 컬럼이 있는 table 을 직접 찾음.
  let table = doc.querySelector('table.tablesorter');
  if (!table) {
    // fallback: ☆ 가 첫 th 인 table 검색
    const tables = doc.querySelectorAll('table');
    for (const t of tables) {
      const firstTh = t.querySelector('thead th');
      if (firstTh && firstTh.textContent.trim() === '☆') {
        table = t;
        break;
      }
    }
  }
  if (!table) {
    console.error('[ereter] perlevel table 을 찾을 수 없습니다');
    alert('테이블을 찾을 수 없어요. 페이지 구조가 변경됐을 수 있습니다.');
    return;
  }

  const charts = [];
  // SSR 에는 tablesorter-no-sort 같은 클래스 없으니 모든 tbody tr 사용 (헤더 row 는 thead 라 제외됨)
  const rows = table.querySelectorAll('tbody tr');
  console.log(`[ereter] ${rows.length}개 row 발견`);

  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    if (cells.length < 5) return;

    // ☆12.3 → 12.3
    const levelText = cells[0].textContent.trim().replace(/[☆\s]/g, '');
    const level = parseFloat(levelText);

    // Title: 곡명 + 차트 종류 (span)
    const titleCell = cells[1];
    const chartSpan = titleCell.querySelector('span');
    let chartType = '';
    if (chartSpan) {
      // (ANOTHER) 등에서 괄호 제거
      chartType = chartSpan.textContent.trim().replace(/[()]/g, '');
    }
    // span 을 떼어낸 텍스트가 곡명
    let title = titleCell.textContent;
    if (chartSpan) title = title.replace(chartSpan.textContent, '');
    title = title.trim();

    // diff 값들 — sort-value 속성에서 정확한 값 (반올림 안된 원본)
    const getDiff = (idx) => {
      const sv = cells[idx]?.getAttribute('sort-value');
      const v = sv != null ? parseFloat(sv) : null;
      return Number.isFinite(v) ? v : null;
    };
    const ec  = getDiff(2);
    const hc  = getDiff(3);
    const exh = getDiff(4);

    // count 정보 (전체 IIDX 플레이어 중 그 단계 클리어한 수, 누적)
    // td[5] = EC count, td[6] = HC count, td[7] = EXH count
    const getCount = (idx) => {
      const txt = cells[idx]?.textContent.trim();
      const v = parseInt(txt, 10);
      return Number.isFinite(v) ? v : null;
    };
    const ec_n  = getCount(5);
    const hc_n  = getCount(6);
    const exh_n = getCount(7);

    if (!title || (ec == null && hc == null && exh == null)) return;

    charts.push({ title, diff: chartType, level, ec, hc, exh, ec_n, hc_n, exh_n });
  });

  console.log(`[ereter] 총 ${charts.length}개 차트 추출`);
  if (charts.length === 0) {
    console.warn('아무것도 추출 못함');
    alert('차트를 하나도 못 찾았어요. 페이지 구조가 변경됐을 수 있습니다.');
    return;
  }
  console.table(charts.slice(0, 5));

  // ========================================================
  // /iidxplayers/ 페이지에서 사용자별 원본 ★값도 같이 가져옴
  //   - 각 사용자의 trueStar (ereter 가 산정한 ★)
  //   - 형식: { iidxId: starValue }
  //   - 2-calc-score 가 자기 IIDX ID 로 자기 ★ 조회해서 비교 표시
  // ========================================================
  console.log('[ereter] /iidxplayers/ 에서 사용자 ★값 fetch 중...');
  const players = {};
  let playerCount = 0;
  try {
    const playersRes = await fetch('/iidxplayers/', { credentials: 'same-origin' });
    if (playersRes.ok) {
      const playersHtml = await playersRes.text();
      const pdoc = new DOMParser().parseFromString(playersHtml, 'text/html');
      // tablesorter 클래스 없을 수 있음 (SSR), Rank 컬럼 가진 table 으로 fallback
      let ptable = pdoc.querySelector('table.tablesorter');
      if (!ptable) {
        const tables = pdoc.querySelectorAll('table');
        for (const t of tables) {
          const firstTh = t.querySelector('thead th');
          if (firstTh && firstTh.textContent.trim() === 'Rank') {
            ptable = t;
            break;
          }
        }
      }
      if (ptable) {
        const prows = ptable.querySelectorAll('tbody tr');
        prows.forEach(row => {
          const tds = row.querySelectorAll('td');
          if (tds.length !== 4) return;
          // td[2]: IIDX ID 표시 (XXXX-XXXX) - href 에서 8자리 IIDX ID 추출
          const idLink = tds[2].querySelector('a');
          if (!idLink) return;
          const idMatch = (idLink.getAttribute('href') || '').match(/iidxid=(\d+)/);
          if (!idMatch) return;
          const iidxId = idMatch[1];
          // td[3]: Clear ability — sort-value 의 정확한 ★ 값
          const sv = tds[3].getAttribute('sort-value');
          const starValue = sv != null ? parseFloat(sv) : null;
          if (!Number.isFinite(starValue)) return;
          players[iidxId] = starValue;
          playerCount++;
        });
        console.log(`[ereter] 사용자 ★값 ${playerCount}명 추출`);
      } else {
        console.warn('[ereter] /iidxplayers/ 의 table.tablesorter 찾기 실패');
      }
    } else {
      console.warn(`[ereter] /iidxplayers/ fetch 실패 HTTP ${playersRes.status}`);
    }
  } catch (e) {
    console.warn('[ereter] /iidxplayers/ fetch 실패:', e.message);
    // 사용자 ★ 데이터 없어도 곡 데이터는 정상 진행
  }

  // JSON 출력 형식: { extractedAt: "ISO 일시", charts: [...], players: {id:★} }
  const payload = {
    extractedAt: new Date().toISOString(),
    source: location.href,
    count: charts.length,
    playerCount,
    charts,
    players,
  };
  const json = JSON.stringify(payload);

  // 클립보드에 복사 (Gist 에 붙여넣기 위함)
  navigator.clipboard.writeText(json).then(() => {
    console.log('%c[ereter] ✅ JSON 이 클립보드에 복사되었습니다!', 'color:#1d9e75;font-weight:bold;font-size:14px');
    console.log(`   추출 일시: ${payload.extractedAt}`);
    console.log(`   차트 수:   ${payload.count}`);
    console.log('이제 Gist 의 ereter-data.json 파일을 갱신하세요.');
    console.log('  1) https://gist.github.com 에서 해당 Gist 편집');
    console.log('  2) ereter-data.json 박스의 내용을 전부 지우고 Ctrl+V');
    console.log('  3) "Update secret gist" 클릭');
  }).catch(err => {
    console.warn('클립보드 복사 실패. JSON 을 수동으로 복사하세요:');
    console.log(json);
  });

  window.__ereter_charts = charts;
  window.__ereter_payload = payload;
  window.__ereter_download = () => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'ereter-data.json'; a.click();
    URL.revokeObjectURL(url);
  };
  console.log('💾 파일로 저장하려면: __ereter_download()');
  console.log('🔍 추출된 데이터: __ereter_charts (배열) / __ereter_payload (메타정보 포함)');
})();
