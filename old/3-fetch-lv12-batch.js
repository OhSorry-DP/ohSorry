// ============================================================
// 3-fetch-lv12-batch.js  (브라우저 콘솔에서 실행)
// ------------------------------------------------------------
//   ereter.net 의 /level/12/ 페이지를 104개 사용자에 대해 순회 fetch.
//   각 페이지에서 곡별 lamp / EX score / 스코어 랭크 추출.
//   완료 후 lv12-batch.json 파일로 자동 다운로드.
//
//   실행 위치: ereter.net 어느 페이지에서나 (CORS 회피 위해 같은 도메인)
//   소요 시간: 104명 × 1.5초 ≈ 3분
//
//   주의: 폴리트 간격 (1.5초) 으로 호출 — 변경하지 말 것
// ============================================================
(async () => {
  const IDS = ["01456165","03509151","03760050","04004817","07020593","07530087","08731683","09120068","09875755","09894911","10134731","10887101","11932516","12137559","12537528","13157742","14325646","15116402","15488912","17198290","17300326","17309187","17988690","18599513","19647555","20318019","21534170","22217173","22297011","22978022","23659841","23804204","24127864","24128891","24879081","25024917","25080291","26572387","26673343","26903287","27313019","27785455","27911855","28092363","28333792","28764505","29122928","29978936","33055059","33195365","33831270","35353683","35491034","39112018","40013281","40892273","40938772","42339574","44179703","45802201","47886065","50717747","50942235","51919775","51944487","52281125","52430618","55892000","60837914","62048326","62732698","63610157","66008468","66617683","71110978","71734268","71755177","71799587","72882791","73539851","74326711","74748366","76159212","78944913","79290374","82317647","82933778","83523699","86198494","87352045","90392614","90414125","91017778","91539428","92975971","93618604","93758806","94223617","96261082","96307375","97008595","97230469","98652452","99797691"];
  const DELAY_MS = 1500;

  // 도메인 체크 (CORS 우회 + 실수 방지)
  if (!location.hostname.endsWith('ereter.net')) {
    alert('ereter.net 도메인에서 실행해야 합니다.\nereter.net 의 아무 페이지에서 콘솔을 열어 다시 실행하세요.');
    return;
  }

  // ---------- 진행 패널 ----------
  document.getElementById('__lv12_progress')?.remove();
  const panel = document.createElement('div');
  panel.id = '__lv12_progress';
  panel.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a1a;color:#eee;padding:14px 18px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.5);font:13px/1.5 monospace;min-width:300px';
  panel.innerHTML = '<div style="font-weight:bold;margin-bottom:6px;color:#ffd166">lv12 batch fetch</div><div id="__lv12_status">준비 중...</div><div id="__lv12_log" style="margin-top:8px;max-height:200px;overflow-y:auto;font-size:11px;color:#aaa"></div>';
  document.body.appendChild(panel);
  const setStatus = (s) => { document.getElementById('__lv12_status').textContent = s; };
  const log = (s, color) => {
    const l = document.getElementById('__lv12_log');
    const line = document.createElement('div');
    if (color) line.style.color = color;
    line.textContent = s;
    l.appendChild(line);
    l.scrollTop = l.scrollHeight;
  };

  // ---------- 파서 (parse-raw-lv12.js 와 동일 로직) ----------
  const ENTITY = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#039;': "'", '&apos;': "'", '&nbsp;': ' ' };
  const decode = (s) =>
    s
      .replace(/&(amp|lt|gt|quot|#039|apos|nbsp);/g, m => ENTITY[m] || m)
      .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16))) // hex (예: &#x27; → ')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
  const LAMP_NAMES = { 0:'NO PLAY',1:'FAILED',2:'ASSIST',3:'EASY',4:'CLEAR',5:'HARD',6:'EX-HARD',7:'FULL COMBO' };

  function parseRow(rowHtml) {
    const tds = [...rowHtml.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map(m => ({ attr: m[1].trim(), inner: m[2] }));
    if (tds.length !== 6) return null;
    const level = parseFloat(tds[0].inner.replace(/[☆\s]/g, ''));
    const titleA = tds[1].inner;
    const span = titleA.match(/<span[^>]*>\(([^)]+)\)<\/span>/);
    const diff = span ? span[1].trim() : '';
    let title = titleA.replace(/<a[^>]*>/g, '').replace(/<\/a>/g, '').replace(/<span[^>]*>[\s\S]*?<\/span>/g, '').trim();
    title = decode(title);
    const rankText = tds[2].inner.replace(/<[^>]+>/g, '').trim();
    const rank = /^\d+$/.test(rankText) ? parseInt(rankText, 10) : null;
    const exScoreSV = (tds[3].attr.match(/sort-value="([0-9.]+)"/) || [])[1];
    const exScore = exScoreSV ? parseInt(exScoreSV, 10) : null;
    const pgGr = tds[3].inner.match(/\((\d+)\s*\/\s*(\d+)\)/);
    const pgreat = pgGr ? parseInt(pgGr[1], 10) : null;
    const great  = pgGr ? parseInt(pgGr[2], 10) : null;
    const scorePctSV = (tds[4].attr.match(/sort-value="([0-9.]+)"/) || [])[1];
    const scorePercent = scorePctSV ? parseFloat(scorePctSV) : null;
    const rankAlphaMatch = tds[4].inner.match(/width:\s*3em[^>]*>\s*([A-Z+-]+)\s*</);
    const scoreRank = rankAlphaMatch ? rankAlphaMatch[1] : null;
    const lampSV = (tds[5].attr.match(/sort-value="(\d+)"/) || [])[1];
    const lampNum = lampSV != null ? parseInt(lampSV, 10) : 0;
    const lampText = LAMP_NAMES[lampNum] || tds[5].inner.replace(/<[^>]+>/g, '').trim() || 'NO PLAY';
    return { title, diff, level, rank, exScore, pgreat, great, scorePercent, scoreRank, lampNum, lampText };
  }

  function parseLv12(html, iidxId) {
    const djMatch = html.match(/<h3>([^<]+?)<\/h3>\s*<h5>\(IIDX ID\s*:/);
    const djName = djMatch ? decode(djMatch[1].trim()) : null;
    const tStart = html.indexOf('data-sort="table"');
    if (tStart < 0) throw new Error('테이블 못찾음');
    const tEnd = html.indexOf('</table>', tStart);
    const fullTable = html.slice(tStart, tEnd);
    const theadEnd = fullTable.indexOf('</thead>');
    const tableHtml = theadEnd >= 0 ? fullTable.slice(theadEnd) : fullTable;
    // 서버 SSR HTML 은 role="row" 없음 — <tr[^>]*> 로 매칭
    const rowHtmls = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m => m[1]);
    const charts = [];
    for (const r of rowHtmls) {
      const p = parseRow(r);
      if (p) charts.push(p);
    }
    return { iidxId, djName, chartCount: charts.length, charts };
  }

  // ---------- main loop ----------
  const results = [];
  let success = 0, failed = 0;
  for (let i = 0; i < IDS.length; i++) {
    const id = IDS[i];
    setStatus(`[${i+1}/${IDS.length}] ${id} fetch 중... (성공 ${success}, 실패 ${failed})`);
    try {
      const r = await fetch(`/iidxplayerdata/${id}/level/12/`, { credentials: 'same-origin' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const html = await r.text();
      const data = parseLv12(html, id);
      results.push(data);
      success++;
      log(`[${i+1}/${IDS.length}] ${id} ${data.djName}: ${data.chartCount}곡`, '#bfffb4');
    } catch (e) {
      failed++;
      results.push({ iidxId: id, error: e.message });
      log(`[${i+1}/${IDS.length}] ${id} 실패: ${e.message}`, '#ff8888');
    }
    if (i < IDS.length - 1) await new Promise(r => setTimeout(r, DELAY_MS));
  }

  setStatus(`완료: 성공 ${success} / 실패 ${failed} — 다운로드 중...`);

  const payload = { collectedAt: new Date().toISOString(), source: 'ereter.net /level/12/', count: results.length, users: results };
  const json = JSON.stringify(payload, null, 2);

  // 파일 다운로드
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'lv12-batch.json'; a.click();
  URL.revokeObjectURL(url);

  setStatus(`✅ lv12-batch.json 다운로드됨 (성공 ${success}/${IDS.length})`);
  console.log('window.__lv12_results 에 결과 보관됨');
  window.__lv12_results = payload;
})();
