// ============================================================
// STEP 2: p.eagate.573.jp 도메인 어느 페이지에서나 실행 가능
// ============================================================
// 자동으로 LEVEL 12 / DP 의 difficulty.html 페이지를 fetch 합니다.
// ereter 데이터도 Gist 에서 자동으로 불러옵니다 (사전 작업 불필요).
//
// 동작:
//   1. Gist 에서 ereter JSON 데이터 fetch (localStorage 에 24시간 캐시)
//   2. difficulty.html?difficult=11&style=1&disp=1&offset=0 부터 fetch
//   3. NEXT 링크 없을 때까지 offset 증가시키며 순회
//      각 페이지 사이 3~6초 랜덤 대기 (봇 의심 회피)
//   4. 모든 곡의 클리어램프 + 차트 추출 후 ereter diff 와 매칭
//   5. ★값 추정 (사용자 실력 지표)
//   6. status.html fetch 로 프로필 정보 (DJ 이름, IIDX ID, SP/DP 단위, 쿠프로) 추출
//   7. 추천곡 계산: 안 친 곡 (NO PLAY) 중 ★값 근처 EXH 난이도의 10곡
//   8. 화면에 프로필 카드 + ★값 + 추천곡 표시
//
// 다른 레벨/스타일을 보고 싶으면 코드 안의 difficult/style 값 변경
// 딜레이 조정: DELAY_MIN_MS / DELAY_MAX_MS 변수 변경
//   기본: 600~1800ms (12레벨 8페이지면 총 약 5~14초)
// ============================================================

(async () => {
  // -------- 0. ereter 데이터 로드 (Gist 에서 자동 fetch) --------
  // ereter.net 데이터는 Gist 에 ereter-data.json 으로 올려둔 걸 가져옵니다.
  // 형식: { extractedAt: "ISO 일시", source, count, charts: [...] }
  //       또는 옛 형식 [{...}, ...] (호환성 유지)
  // 한 번 받으면 24시간 동안 localStorage 에 캐시됨
  // 강제로 새로 받고 싶으면: localStorage.removeItem('ereter_dp_diff_v4'); 후 재실행
  const ERETER_DATA_URL = 'https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw/ereter-data.json';
  const CACHE_KEY = 'ereter_dp_diff_v4';
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;  // 24시간

  // 형식 정규화:
  //   옛 형식: [{...}, ...]  (배열)
  //   v1 형식: { extractedAt, charts: [...] }
  //   v2 형식 (현재): { extractedAt, charts: [...], players: { iidxId: ★ } }
  const normalizePayload = (raw) => {
    if (Array.isArray(raw)) {
      return { charts: raw, extractedAt: null, players: null };
    }
    if (raw && typeof raw === 'object' && Array.isArray(raw.charts)) {
      return {
        charts: raw.charts,
        extractedAt: raw.extractedAt || null,
        players: raw.players && typeof raw.players === 'object' ? raw.players : null,
      };
    }
    return { charts: null, extractedAt: null, players: null };
  };

  let ereterData = null;
  let ereterExtractedAt = null;
  let ereterPlayers = null;  // { iidxId: ★ } 매핑 (있으면)

  // 캐시 확인 + 원격 extractedAt 비교
  let cachedExtractedAt = null;
  let cachedData = null;
  try {
    const stored = localStorage.getItem(CACHE_KEY);
    if (stored) {
      const cached = JSON.parse(stored);
      if (cached && cached.ts && (Date.now() - cached.ts < CACHE_TTL_MS) && Array.isArray(cached.data)) {
        cachedData = cached.data;
        cachedExtractedAt = cached.extractedAt || null;
      }
    }
  } catch {}

  // 항상 Gist 의 최신 extractedAt 빠르게 확인 (HEAD 같은 거 안 됨, GET 짧게)
  // 다행히 ereter-data.json 가 그렇게 크지 않으니 fetch 하면서 compare
  console.log('[step2] ereter 데이터 fetch 중...');
  try {
    const url = ERETER_DATA_URL + '?t=' + Date.now();  // CDN 캐시 우회
    const res = await fetch(url, { cache: 'no-store' });  // 브라우저 캐시도 우회
    if (!res.ok) {
      alert(
        `ereter 데이터를 못 가져왔어요 (HTTP ${res.status}).\n` +
        `Gist URL 확인이 필요합니다:\n${ERETER_DATA_URL}`
      );
      return;
    }
    const raw = await res.json();
    const payloadNorm = normalizePayload(raw);
    if (!payloadNorm.charts || payloadNorm.charts.length === 0) {
      alert('ereter 데이터가 비어있거나 형식이 잘못됐어요.');
      return;
    }
    ereterData = payloadNorm.charts;
    ereterExtractedAt = payloadNorm.extractedAt;
    ereterPlayers = payloadNorm.players;
    if (ereterPlayers) {
      console.log(`[step2] ereter players ★ 매핑: ${Object.keys(ereterPlayers).length}명`);
    }

    // 캐시랑 비교 - 같으면 캐시 그대로 사용한 셈, 다르면 새 데이터
    if (cachedExtractedAt && cachedExtractedAt === ereterExtractedAt) {
      const ageHr = ((Date.now() - JSON.parse(localStorage.getItem(CACHE_KEY) || '{}').ts) / 3600000).toFixed(1);
      console.log(`[step2] ereter 데이터 동일 (캐시와 같음, 캐시 ${ageHr}시간 전)`);
      if (ereterExtractedAt) console.log(`         원본 추출일시: ${ereterExtractedAt}`);
    } else {
      // 새 데이터 → 캐시 갱신 (players 도 포함)
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          ts: Date.now(),
          data: ereterData,
          extractedAt: ereterExtractedAt,
          players: ereterPlayers,
        }));
      } catch {}
      if (cachedExtractedAt) {
        console.log(`[step2] ereter 데이터 갱신됨! (${cachedExtractedAt} → ${ereterExtractedAt})`);
      } else {
        console.log(`[step2] ereter 데이터 ${ereterData.length}개 fetch 완료, 캐시함`);
        if (ereterExtractedAt) console.log(`         원본 추출일시: ${ereterExtractedAt}`);
      }
    }
  } catch (e) {
    console.error('[step2] ereter fetch 실패:', e);
    alert(`ereter 데이터 fetch 실패: ${e.message}\n네트워크 또는 CSP 문제일 수 있습니다.`);
    return;
  }
  console.log(`[step2] ereter 차트 ${ereterData.length}개 로드`);

  // -------- 1. 곡명 정규화 + 인덱싱 --------
  const norm = (s) => (s || '')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[~∼〜～]/g, '~')
    .replace(/[!！]/g, '!')
    .replace(/[?？]/g, '?')
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')')
    .normalize('NFKC');

  const ereterMap = new Map();
  for (const c of ereterData) {
    if (!c.title || !c.diff) continue;
    ereterMap.set(norm(c.title) + '|' + c.diff, c);
  }

  // -------- 2. 대상 페이지 설정 (LEVEL 12 / DP 고정) --------
  // p.eagate.573.jp 도메인 안 어느 페이지에서나 실행 가능하도록
  // difficulty.html 의 LEVEL 12 + DP 페이지를 직접 fetch 합니다.
  // 다른 레벨/스타일을 보고 싶으면 아래 difficult/style 값을 변경하세요.
  //   difficult: 0~11 (0-indexed, 11=LEVEL 12)
  //   style:     0=SP, 1=DP
  const SERIES = '33';            // 현재 시즌 (Sparkle Shower)
  const difficult = '11';         // LEVEL 12
  const style = '1';              // DP
  const disp = '1';
  const BASE_URL = `https://p.eagate.573.jp/game/2dx/33/djdata/music/difficulty.html`;
  // 호환성을 위해 currentURL 도 만들어둠 (이전 코드와 동일한 변수 이름 사용)
  const currentURL = new URL(BASE_URL);

  // 도메인 체크 (잘못된 사이트에서 실행하면 의미 없으니 안내)
  if (!location.hostname.endsWith('p.eagate.573.jp')) {
    alert(
      'p.eagate.573.jp 도메인에서 실행해야 합니다.\n' +
      '먼저 https://p.eagate.573.jp 의 아무 페이지나 열어서 로그인 후, 그 페이지의 콘솔에서 실행하세요.'
    );
    return;
  }

  const levelText = parseInt(difficult, 10) + 1;  // difficult=11 → LEVEL 12
  console.log(`[step2] LEVEL ${levelText} / ${style === '1' ? 'DP' : 'SP'} 시작`);

  // -------- 3. 페이지 한 장 파싱 --------
  const LAMP_NAMES = {
    0: 'NO PLAY', 1: 'FAILED',  2: 'ASSIST',    3: 'EASY',
    4: 'CLEAR',   5: 'HARD',    6: 'EX HARD',   7: 'FULL COMBO',
  };

  const parseDoc = (doc) => {
    const out = { charts: [], hasNext: false };
    // 곡 목록은 <div class="series-difficulty"> 안의 table
    const rows = doc.querySelectorAll('div.series-difficulty table tr');
    rows.forEach(row => {
      const tds = row.querySelectorAll('td');
      if (tds.length !== 5) return;  // 5개 td 인 곡 row 만
      const titleEl = tds[0].querySelector('a.music_info');
      if (!titleEl) return;
      const title = titleEl.textContent.trim();
      const chartType = tds[1].textContent.trim();
      // DJ LEVEL 이미지 (AAA/AA/A/B/C/D/E/F)
      const djLevelImg = tds[2].querySelector('img');
      let djLevel = null;
      if (djLevelImg) {
        const dm = (djLevelImg.getAttribute('src') || djLevelImg.src || '').match(/\/([A-F]+)\.gif/);
        if (dm) djLevel = dm[1];
      }
      // EX 점수 + Pgreat/Great
      const scoreText = tds[3].textContent.trim();
      const scoreMatch = scoreText.match(/^(\d+)\((\d+)\/(\d+)\)/);
      let exScore = 0, pgreat = 0, great = 0;
      if (scoreMatch) {
        exScore = parseInt(scoreMatch[1], 10);
        pgreat = parseInt(scoreMatch[2], 10);
        great = parseInt(scoreMatch[3], 10);
      } else {
        const m2 = scoreText.match(/^(\d+)/);
        if (m2) exScore = parseInt(m2[1], 10);
      }
      // 클리어 램프
      const lampImg = tds[4].querySelector('img');
      if (!lampImg) return;
      const m = (lampImg.getAttribute('src') || lampImg.src || '').match(/clflg(\d+)\.gif/);
      if (!m) return;
      const lampNum = parseInt(m[1], 10);
      out.charts.push({
        title, diff: chartType,
        lampNum, lamp: LAMP_NAMES[lampNum] || `?${lampNum}`,
        exScore, pgreat, great, djLevel,
      });
    });
    // 다음 페이지가 있는지: <div class="navi-next"> a 가 존재하면 있음
    out.hasNext = !!doc.querySelector('div.next-prev div.navi-next a');
    return out;
  };

  // -------- 4. offset=0,50,100,... 순회 --------
  const allCharts = [];
  let offset = 0;
  const STEP = 50;
  const MAX_PAGES = 30;  // 무한 루프 방어
  // 사람이 페이지 넘기는 속도와 비슷하게: 페이지마다 3~6초 사이 랜덤 대기
  const DELAY_MIN_MS = 600;
  const DELAY_MAX_MS = 1800;
  const randomDelay = () => DELAY_MIN_MS + Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS);
  let pageCount = 0;

  // 진행 상황을 화면에 표시 (긴 대기 시간 동안 사용자가 진행도 볼 수 있게)
  document.getElementById('__dp_progress')?.remove();
  const progress = document.createElement('div');
  progress.id = '__dp_progress';
  progress.style.cssText = `
    position: fixed; top: 16px; right: 16px; z-index: 999999;
    width: 360px; background: #fff; color: #222;
    font-family: -apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif;
    font-size: 13px; line-height: 1.5;
    border: 1px solid #ccc; border-radius: 8px;
    box-shadow: 0 6px 24px rgba(0,0,0,.18); padding: 14px 16px;
  `;
  progress.innerHTML = `
    <div style="font-weight:600;margin-bottom:6px">DP 점수 계산 중...</div>
    <div id="__dp_progress_text" style="font-size:12px;color:#666">시작합니다</div>
    <div style="background:#eee;height:6px;border-radius:3px;margin-top:8px;overflow:hidden">
      <div id="__dp_progress_bar" style="background:#1d9e75;height:100%;width:0%;transition:width .3s"></div>
    </div>
  `;
  document.body.appendChild(progress);
  const updateProgress = (text, pct) => {
    const t = document.getElementById('__dp_progress_text');
    const b = document.getElementById('__dp_progress_bar');
    if (t) t.textContent = text;
    if (b) b.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  };

  // 첫 페이지(offset=0)도 fetch 로 가져옴 (어느 페이지에서 실행해도 동일하게 작동)
  updateProgress(`page 1 (offset=0) 요청 중...`, 2);
  let firstParse;
  try {
    const firstUrl = `${BASE_URL}?difficult=${difficult}&style=${style}&disp=${disp}&offset=0`;
    const res = await fetch(firstUrl, { credentials: 'include' });
    if (!res.ok) {
      console.error(`[step2] 첫 페이지 fetch 실패: HTTP ${res.status}`);
      updateProgress(`첫 페이지 HTTP ${res.status} 에러`, 100);
      alert(
        `첫 페이지를 가져오지 못했어요 (HTTP ${res.status}).\n` +
        `로그인 상태인지 확인해주세요.`
      );
      return;
    }
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    firstParse = parseDoc(doc);
  } catch (e) {
    console.error('[step2] 첫 페이지 fetch 실패:', e);
    updateProgress(`첫 페이지 fetch 실패: ${e.message}`, 100);
    alert(`첫 페이지 fetch 실패: ${e.message}`);
    return;
  }
  allCharts.push(...firstParse.charts);
  pageCount++;
  console.log(`[step2] page ${pageCount} (offset=0): ${firstParse.charts.length}곡`);
  updateProgress(`page ${pageCount} (offset=0): ${firstParse.charts.length}곡`, 8);
  if (firstParse.charts.length === 0) {
    alert(
      '첫 페이지에서 곡을 못 찾았어요. 로그인 상태가 아니거나 페이지 구조가 변경됐을 수 있습니다.'
    );
    document.getElementById('__dp_progress')?.remove();
    return;
  }
  let hasNext = firstParse.hasNext;
  offset = STEP;

  while (hasNext && pageCount < MAX_PAGES) {
    // 사람처럼 페이지 사이에 대기 (요청 보내기 전에)
    const wait = Math.round(randomDelay());
    const waitStartTs = Date.now();
    while (Date.now() - waitStartTs < wait) {
      const remain = Math.ceil((wait - (Date.now() - waitStartTs)) / 1000);
      updateProgress(
        `page ${pageCount + 1} (offset=${offset}) 다음 요청까지 ${remain}초...`,
        Math.min(95, pageCount * 12)
      );
      await new Promise(r => setTimeout(r, 250));
    }

    const url = `${currentURL.origin}${currentURL.pathname}?difficult=${difficult}&style=${style}&disp=${disp}&offset=${offset}`;
    try {
      updateProgress(`page ${pageCount + 1} (offset=${offset}) 요청 중...`, Math.min(95, pageCount * 12 + 5));
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        console.warn(`[step2] HTTP ${res.status} at offset=${offset}, 중단`);
        updateProgress(`HTTP ${res.status} 에러로 중단`, 100);
        break;
      }
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const parsed = parseDoc(doc);
      allCharts.push(...parsed.charts);
      pageCount++;
      console.log(`[step2] page ${pageCount} (offset=${offset}): ${parsed.charts.length}곡`);
      updateProgress(`page ${pageCount} (offset=${offset}): ${parsed.charts.length}곡 (총 ${allCharts.length}곡)`, Math.min(95, pageCount * 12 + 8));
      if (parsed.charts.length === 0) break;
      hasNext = parsed.hasNext;
      offset += STEP;
    } catch (e) {
      console.error(`[step2] fetch 실패 at offset=${offset}:`, e);
      updateProgress(`fetch 실패: ${e.message}`, 100);
      break;
    }
  }
  console.log(`[step2] 총 ${pageCount} 페이지 / ${allCharts.length}곡 파싱 완료`);
  updateProgress(`완료! ${pageCount}페이지 ${allCharts.length}곡`, 100);
  // 잠시 후 진행 패널 제거 (점수 패널이 같은 위치에 뜨므로)
  await new Promise(r => setTimeout(r, 500));
  document.getElementById('__dp_progress')?.remove();

  if (allCharts.length === 0) {
    alert('곡을 하나도 못 찾았어요. 페이지 구조가 변경됐을 수 있습니다.');
    return;
  }

  // -------- 5. 매칭 + 점수 계산 --------
  // ereter.net 의 'combined' 분석 페이지와 동일한 방식:
  // 클리어한 모든 단계의 diff 를 합산.
  //   - FULL COMBO (7): EC + HC + EXH (모든 단계 도달)
  //   - EX HARD (6):    EC + HC + EXH (모든 단계 도달)
  //   - HARD (5):       EC + HC       (HARD 까지 도달)
  //   - CLEAR (4):      EC            (EASY 까지)
  //   - EASY (3):       EC            (EASY 까지)
  //   - FAILED/ASSIST/NO PLAY: 0      (어떤 단계도 클리어 못함)
  const lampToScore = (n, ec, hc, exh) => {
    const v = (x) => (typeof x === 'number' ? x : 0);
    if (n >= 6) return v(ec) + v(hc) + v(exh);  // EX HARD / FULL COMBO
    if (n === 5) return v(ec) + v(hc);          // HARD
    if (n >= 3) return v(ec);                   // EASY / CLEAR
    return 0;                                    // FAILED / ASSIST / NO PLAY
  };

  let total = 0, matched = 0, unmatched = 0;
  const perLamp = {}, perLevel = {};
  const details = [];
  const unmatchedSamples = [];
  // ★값 추정용 데이터: (diff, passed) 쌍의 배열
  // 사용자가 시도한 곡(NO PLAY 제외)에 대해 EC/HC/EXH 각 단계마다 한 점씩
  // ASSIST 는 ereter 에서 FAILED 로 처리됨 (모든 단계 fail)
  const fitData = [];

  for (const c of allCharts) {
    const e = ereterMap.get(norm(c.title) + '|' + c.diff);
    if (!e) {
      unmatched++;
      if (c.lampNum > 0 && unmatchedSamples.length < 10) {
        unmatchedSamples.push(`${c.title} [${c.diff}] (lamp=${c.lamp})`);
      }
      continue;
    }
    matched++;
    perLamp[c.lamp] = (perLamp[c.lamp] || 0) + 1;
    const score = lampToScore(c.lampNum, e.ec, e.hc, e.exh);
    total += score;
    if (e.level != null) perLevel[e.level] = (perLevel[e.level] || 0) + score;
    if (score > 0) {
      details.push({
        title: c.title, diff: c.diff, level: e.level, lamp: c.lamp,
        ec: e.ec, hc: e.hc, exh: e.exh, score,
      });
    }

    // ★값 추정용 데이터 수집 (NO PLAY 제외, ★11.6 ~ ★12.7)
    // ereter 의 ASSIST → FAILED 처리 규칙 적용:
    //   lamp >= 3: EC pass / lamp <  3: EC fail (ASSIST 포함)
    //   lamp >= 5: HC pass / lamp <  5: HC fail
    //   lamp >= 6: EXH pass / lamp < 6: EXH fail
    // NO PLAY (lamp 0) 인 곡은 통계에서 제외
    // stage 별 가중치 적용 (7명 회귀로 결정)
    if (c.lampNum > 0 && e.level != null && e.level >= 11.6 && e.level <= 12.7) {
      if (typeof e.ec  === 'number') fitData.push({ d: e.ec,  p: c.lampNum >= 3 ? 1 : 0, stage: 'ec' });
      if (typeof e.hc  === 'number') fitData.push({ d: e.hc,  p: c.lampNum >= 5 ? 1 : 0, stage: 'hc' });
      if (typeof e.exh === 'number') fitData.push({ d: e.exh, p: c.lampNum >= 6 ? 1 : 0, stage: 'exh' });
    }
  }
  details.sort((a, b) => b.score - a.score);

  console.log(`[step2] 매칭 ${matched} / 미매칭 ${unmatched} / 총점 ${total.toFixed(2)}`);
  if (unmatchedSamples.length > 0) {
    console.log('미매칭된 곡 (플레이 흔적 있는 것 중):');
    unmatchedSamples.forEach(s => console.log('  -', s));
  }

  // -------- 5.5. ★값 추정 (v3.2.10: v3.2.9 + 추천곡 로직 정리) --------
  //
  // v3.2.10 변경 (★값 추정 모델 자체는 v3.2.9 그대로):
  //   - 추천곡 challenge offset 동적화: ★0.5 → +1.2, ★14.0 → +0.3 선형 보간
  //   - 6:4 비율 고정 (저레벨 3:7 분기 제거)
  //   - 풀 샘플 10+10=20 → picked 10 (한 쪽 부족 시 다른 쪽에서 보충)
  //
  // v3.2.9 모델: v3.2.7 + 4단계 진입 시 bin 보너스 활성 + ridge 음수 → ridge 0 처리
  //   - 86명 (n_cleared >= 50) 학습 (LOOCV 기준)
  //   - mean abs err: 0.1696 ★ (v3.2.7 의 0.1722 → 1.5% 개선, v3.2.1 대비 14.7%)
  //   - median:       0.1240 ★
  //   - max:          1.2657 ★
  //   - RMSE:         0.2517 ★
  //   - ≤0.10 ★: 35/86 (40.7%)
  //   - ≤0.30 ★: 76/86 (88.4%)
  //
  // 1단계: v3.1.1 의 logistic raw_s (HC × 2 + golden-section)
  //
  // 2단계: 36-feature Ridge 회귀 (α=5.0) — v3.2.1 그대로
  //   - v3.1.1 의 29 feature (raw_s, raw_s², 21 base, 8 AC/FC)
  //   - v3.2 추가 7 feature:
  //     · M: 사용자 도달 stage 의 max ★
  //     · M_top10_avg: top 1~10 cleared 평균 (robust estimator)
  //     · gap_top10: M - top10 (M 이 outlier 인지 신호)
  //     · gap × is_ec/hc/exh: M 의 stage 별 차등 페널티
  //     · prob_sum: S_hat=M_top10_avg 기준 sigmoid prob > 0.99 제외 failed 페널티
  //
  // 4단계 (v3.2.4 + v3.2.7 + v3.2.9): bin clear-rate 누적 post-correction
  //   stage 별 0.1 단위 bin 으로 곡 분류 (NO PLAY 제외, 분모는 시도한 곡만)
  //   rate ≥ 80% 인정, rateW = (rate - 0.8) / 0.2 [linear, 80~100% → 0~1]
  //   MIN_SAMPLES 차등 (EC=4/HC=3/EXH=2)
  //   eligible bin top 3 의 bonus 누적: top1 ×1.0 / top2 ×0.5 / top3 ×0.25, 각 bin × rateW
  //   bonus 차등: EC=0.05 / HC=0.10 / EXH=0.15 (어려운 stage 일수록 강한 신호)
  //   stage 별 implied = top1.bin_start + 누적_bonus → max(EC,HC,EXH) 채택
  //   단방향: implied > pred 일 때만 보너스 적용 (final = pred + diff × 0.7)
  //
  //   v3.2.9: bin 보너스 활성 (implied > raw_s + ridge) AND ridge < 0 일 때
  //     → ridge 의 음수 (페널티) 부분 무시 (RAY 같이 ridge 가 잘못 페널티 준 경우)
  //     → final pred = raw_s + 0 + post + djBoost
  //
  // 5단계 (v3.2.6): djLevel boost
  //   조건: M lamp = EC (3 또는 4) + djLevel(M 곡) ≥ A + raw_s ≥ 3
  //   gap (M - rawS) 곡률 with cutoff: gap < 2.5 → 0, gap ≥ 4.0 → 1, 사이 linear
  //   단방향: M > pred 일 때만 → final = pred + (M - pred) × 0.7 × curveW
  //   POCHI 처럼 lamp 약하지만 max clear 곡 점수 좋은 사용자 보정 (1명 영향, collateral 0)
  //
  // cutoff: n_cleared >= 50 (실전 평가에서 미달 시 v3.1.1 fallback)
  //
  let starEstimate = null;
  let starRaw = null;
  if (fitData.length >= 30) {
    // ----- 모델 파라미터 (v3.2.9: v3.2.7 + ridge 음수 미적용) -----
    //
    // ALPHA_COEFF 는 v3.1.1 그대로 (HC × 2)
    const ALPHA_COEFF = {
      ec:  [ 194.445153,   41.489739,    6.085698],
      hc:  [ 119.451394,  295.165202,  -20.796304],  // × 2
      exh: [   2.722775,    0.444754,    3.689284],
    };

    // Ridge 회귀 계수 (intercept 포함, 36차원, α=5.0)
    // 순서: [intercept, raw_s, raw_s_sq,
    //         (ec)  max_d_clear, min_d_fail, p50_d_clear, frac_clear, fail_below, clear_above,
    //         (hc)  max_d_clear, min_d_fail, p50_d_clear, frac_clear, fail_below, clear_above,
    //         (exh) max_d_clear, min_d_fail, p50_d_clear, frac_clear, fail_below, clear_above,
    //         (AC)  ac_frac, ac_max_d, ac_p50_d,
    //         (FC)  fc_frac, fc_max_d, fc_p50_d, fc_fail_near, fc_to_exh_ratio,
    //         (v3.2) M, M_top10_avg, gap_top10, gap×is_ec, gap×is_hc, gap×is_exh, prob_sum]
    const RIDGE_COEF = [
      -0.006071, -0.464910, -0.011718,
      +0.112154, -0.007165, -0.046545, -0.059173, -0.049017, +0.224936,
      +0.056395, -0.009976, +0.050729, -0.032504, -0.007578, -0.000059,
      +0.003160, +0.001351, -0.030269, +0.034971, -0.054444, +0.024824,
      // AC/FC
      -0.060741, -0.016712, -0.112941,
      +0.019729, +0.132479, -0.115328, -0.038194, +0.036031,
      // v3.2 추가 (M, M_top10_avg, gap_top10, gap×is_ec, gap×is_hc, gap×is_exh, prob_sum)
      +0.210155, +0.368437, -0.139323, -0.019140, -0.092587, -0.027596, -0.004606,
    ];

    const CUTOFF_N_CLEARED = 50;
    const SIGMA_PROB = 1.0;
    const PROB_NOISE_THRESHOLD = 0.99;

    const MARGIN_TH = 1.3;
    const MIN_CLEAR_PER_LAMP = 10;
    const LOW_FALLBACK = 0.5;
    const RAW_BOUNDS = [0.5, 14.5];

    const alphaOf = (S, st) => {
      const [a0, a1, a2] = ALPHA_COEFF[st];
      return Math.max(a2 * S * S + a1 * S + a0, 0.1);
    };

    // lamp 별 데이터 분리
    const byLamp = { ec: [], hc: [], exh: [] };
    for (const { d, p, stage } of fitData) byLamp[stage].push({ d, p });
    const clearCounts = {
      ec:  byLamp.ec.filter(x => x.p === 1).length,
      hc:  byLamp.hc.filter(x => x.p === 1).length,
      exh: byLamp.exh.filter(x => x.p === 1).length,
    };
    const validStages = ['ec', 'hc', 'exh'].filter(st => clearCounts[st] >= MIN_CLEAR_PER_LAMP);

    if (validStages.length === 0) {
      // 모든 lamp 에서 클리어 < 10: 저렙 fallback
      starRaw = LOW_FALLBACK;
      starEstimate = LOW_FALLBACK;
      console.log(`[step2] ★값 추정: ${LOW_FALLBACK.toFixed(2)} (저렙 fallback, 모든 lamp 에서 클리어 < ${MIN_CLEAR_PER_LAMP} 곡)`);
    } else {
      // 1단계: raw S grid search (negative log-likelihood 최소화)
      // alpha 가 매우 큰 값이라 z 가 쉽게 ±수백에 도달 — clamp 로 안정화
      const Z_CLAMP = 50;
      const negLogLik = (S) => {
        let total = 0;
        for (const st of validStages) {
          const a = alphaOf(S, st);
          for (const { d, p } of byLamp[st]) {
            // z = a × (d - S);  prob = 1/(1+exp(z))
            // log_sigmoid(z) = -softplus(z),  log_1m(z) = z - softplus(z)
            // softplus 안정형: max(z,0) + log(1+exp(-|z|))
            let z = a * (d - S);
            if (z > Z_CLAMP) z = Z_CLAMP;
            else if (z < -Z_CLAMP) z = -Z_CLAMP;
            const sp = Math.max(z, 0) + Math.log(1 + Math.exp(-Math.abs(z)));
            const logSig = -sp;
            const log1m = z - sp;
            total -= (p === 1 ? logSig : log1m);
          }
        }
        return total;
      };

      // grid search (0.5 ~ 14.5, step 0.01)
      const lo = Math.round(RAW_BOUNDS[0] * 100);
      const hi = Math.round(RAW_BOUNDS[1] * 100);
      let bestS = RAW_BOUNDS[0], bestNll = Infinity;
      for (let i = lo; i <= hi; i++) {
        const S = i / 100;
        const nll = negLogLik(S);
        if (nll < bestNll) { bestNll = nll; bestS = S; }
      }

      // Golden-section refinement: grid 의 0.01 step 한계로 인한 정밀도 손실 보정
      // raw_s 가 0.01 빗나가면 features 와의 상호작용으로 final ★ 가 0.07~0.10 차이날 수 있음
      // 그래서 [bestS - 0.01, bestS + 0.01] 구간에서 더 정밀하게 찾음
      const gsLo = Math.max(RAW_BOUNDS[0], bestS - 0.01);
      const gsHi = Math.min(RAW_BOUNDS[1], bestS + 0.01);
      const phi = (Math.sqrt(5) - 1) / 2;  // golden ratio reciprocal
      let aGS = gsLo, bGS = gsHi;
      let cGS = bGS - phi * (bGS - aGS);
      let dGS = aGS + phi * (bGS - aGS);
      let fc = negLogLik(cGS), fd = negLogLik(dGS);
      for (let iter = 0; iter < 30; iter++) {
        if (Math.abs(bGS - aGS) < 1e-5) break;
        if (fc < fd) {
          bGS = dGS; dGS = cGS; fd = fc;
          cGS = bGS - phi * (bGS - aGS);
          fc = negLogLik(cGS);
        } else {
          aGS = cGS; cGS = dGS; fc = fd;
          dGS = aGS + phi * (bGS - aGS);
          fd = negLogLik(dGS);
        }
      }
      const refinedS = (aGS + bGS) / 2;
      if (negLogLik(refinedS) < bestNll) bestS = refinedS;

      starRaw = bestS;

      // 2단계: feature 추출 (lamp 별)
      const lampFeats = (lampData) => {
        let max_clear = 0, min_fail = 0, p50_clear = 0, frac_clear = 0, fail_below = 0, clear_above = 0;
        if (lampData.length === 0) return { max_clear, min_fail, p50_clear, frac_clear, fail_below, clear_above };
        const cleared = lampData.filter(x => x.p === 1).map(x => x.d);
        const failed  = lampData.filter(x => x.p === 0).map(x => x.d);
        if (cleared.length > 0) {
          max_clear = Math.max(...cleared);
          const sorted = [...cleared].sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          p50_clear = sorted.length % 2 === 0 ? (sorted[mid-1] + sorted[mid]) / 2 : sorted[mid];
        }
        if (failed.length > 0) min_fail = Math.min(...failed);
        frac_clear = cleared.length / lampData.length;
        // raw 근처 fail/clear 분포
        let nBelow = 0, failBelow = 0, nAbove = 0, clearAbove = 0;
        for (const { d, p } of lampData) {
          if (d >= bestS - MARGIN_TH && d < bestS) {
            nBelow++;
            if (p === 0) failBelow++;
          }
          if (d > bestS && d <= bestS + MARGIN_TH) {
            nAbove++;
            if (p === 1) clearAbove++;
          }
        }
        if (nBelow > 0) fail_below = failBelow / nBelow;
        if (nAbove > 0) clear_above = clearAbove / nAbove;
        return { max_clear, min_fail, p50_clear, frac_clear, fail_below, clear_above };
      };
      const fEc  = validStages.includes('ec')  ? lampFeats(byLamp.ec)  : { max_clear:0, min_fail:0, p50_clear:0, frac_clear:0, fail_below:0, clear_above:0 };
      const fHc  = validStages.includes('hc')  ? lampFeats(byLamp.hc)  : { max_clear:0, min_fail:0, p50_clear:0, frac_clear:0, fail_below:0, clear_above:0 };
      const fExh = validStages.includes('exh') ? lampFeats(byLamp.exh) : { max_clear:0, min_fail:0, p50_clear:0, frac_clear:0, fail_below:0, clear_above:0 };

      // v3.1 추가: AC (ASSIST 이상) / FC (FULL COMBO) feature 8개
      //   - pool: 시도한 곡 (lampNum > 0) 중 ★11.6 ~ ★12.7 + ereter 매칭
      //   - 각 곡의 EXH ★ 를 d 로 사용 (가장 정보량 풍부한 axis)
      const acfcPool = [];
      for (const c of allCharts) {
        const e = ereterMap.get(norm(c.title) + '|' + c.diff);
        if (!e || e.level == null || e.level < 11.6 || e.level > 12.7) continue;
        if (c.lampNum > 0 && typeof e.exh === 'number') acfcPool.push({ lamp: c.lampNum, d: e.exh });
      }
      let ac_frac = 0, ac_max_d = 0, ac_p50_d = 0;
      let fc_frac = 0, fc_max_d = 0, fc_p50_d = 0, fc_fail_near = 0, fc_to_exh_ratio = 0;
      if (acfcPool.length > 0) {
        const acClearedDs = acfcPool.filter(x => x.lamp >= 2).map(x => x.d);
        const fcClearedDs = acfcPool.filter(x => x.lamp >= 7).map(x => x.d);
        const exhClearedN = acfcPool.filter(x => x.lamp >= 6).length;
        const p50 = arr => {
          if (arr.length === 0) return 0;
          const s = [...arr].sort((a, b) => a - b);
          const mid = Math.floor(s.length / 2);
          return s.length % 2 === 0 ? (s[mid-1] + s[mid]) / 2 : s[mid];
        };
        ac_frac = acClearedDs.length / acfcPool.length;
        ac_max_d = acClearedDs.length ? Math.max(...acClearedDs) : 0;
        ac_p50_d = p50(acClearedDs);
        fc_frac = fcClearedDs.length / acfcPool.length;
        fc_max_d = fcClearedDs.length ? Math.max(...fcClearedDs) : 0;
        fc_p50_d = p50(fcClearedDs);
        // FC fail near rawS (±MARGIN_TH)
        let nNear = 0, fcFailNear = 0;
        for (const x of acfcPool) {
          if (x.d >= bestS - MARGIN_TH && x.d <= bestS + MARGIN_TH) {
            nNear++;
            if (x.lamp < 7) fcFailNear++;
          }
        }
        fc_fail_near = nNear > 0 ? fcFailNear / nNear : 0;
        fc_to_exh_ratio = exhClearedN > 0 ? fcClearedDs.length / exhClearedN : 0;
      }

      // v3.2.1 추가: M / top10 / gap / stage interaction / prob feature
      //   - lv12 페이지 곡 (★11.6~12.7) 중 cleared (lamp >= 3) 의 도달 stage 별 ★
      //     · lamp >= 6 → exh ★
      //     · lamp == 5 → hc ★
      //     · lamp 3,4 → ec ★
      const v32Cleared = [];  // {d, lamp, djLevel} — djLevel 은 v3.2.6 에서 사용
      const v32FailedEc = [];
      for (const c of allCharts) {
        const e = ereterMap.get(norm(c.title) + '|' + c.diff);
        if (!e || e.level == null || e.level < 11.6 || e.level > 12.7) continue;
        if (c.lampNum >= 6 && typeof e.exh === 'number') v32Cleared.push({ d: e.exh, lamp: c.lampNum, djLevel: c.djLevel });
        else if (c.lampNum === 5 && typeof e.hc === 'number') v32Cleared.push({ d: e.hc, lamp: c.lampNum, djLevel: c.djLevel });
        else if (c.lampNum >= 3 && typeof e.ec === 'number') v32Cleared.push({ d: e.ec, lamp: c.lampNum, djLevel: c.djLevel });
        else if (c.lampNum === 1 && typeof e.ec === 'number') v32FailedEc.push(e.ec);
      }
      const n_cleared_v32 = v32Cleared.length;
      let v32_M = 0, v32_M_top10_avg = 0, v32_gap_top10 = 0;
      let v32_gap_x_is_ec = 0, v32_gap_x_is_hc = 0, v32_gap_x_is_exh = 0, v32_prob_sum = 0;
      if (n_cleared_v32 > 0) {
        v32Cleared.sort((a, b) => b.d - a.d);
        v32_M = v32Cleared[0].d;
        const M_lamp = v32Cleared[0].lamp;
        const is_ec  = (M_lamp === 3 || M_lamp === 4) ? 1 : 0;
        const is_hc  = (M_lamp === 5) ? 1 : 0;
        const is_exh = (M_lamp >= 6) ? 1 : 0;
        const padded = [];
        for (let k = 0; k < 10; k++) padded.push(k < v32Cleared.length ? v32Cleared[k].d : v32Cleared[v32Cleared.length - 1].d);
        v32_M_top10_avg = padded.reduce((s, x) => s + x, 0) / 10;
        v32_gap_top10 = v32_M - padded[9];
        v32_gap_x_is_ec  = v32_gap_top10 * is_ec;
        v32_gap_x_is_hc  = v32_gap_top10 * is_hc;
        v32_gap_x_is_exh = v32_gap_top10 * is_exh;
        // prob_sum: S_hat = M_top10_avg, sigmoid prob > 0.99 인 fail 은 노이즈 처리 (제외)
        const S_hat = v32_M_top10_avg;
        for (const d of v32FailedEc) {
          const p = 1 / (1 + Math.exp(-(S_hat - d) / SIGMA_PROB));
          if (p > PROB_NOISE_THRESHOLD) continue;
          v32_prob_sum += p;
        }
      }

      // cutoff 미달이면 v3.1.1 패러다임 fallback
      const isUnderCutoff = n_cleared_v32 < CUTOFF_N_CLEARED;

      // feature vector (RIDGE_COEF 와 같은 순서, 36차원)
      const features = [
        1.0, bestS, bestS * bestS,
        fEc.max_clear,  fEc.min_fail,  fEc.p50_clear,  fEc.frac_clear,  fEc.fail_below,  fEc.clear_above,
        fHc.max_clear,  fHc.min_fail,  fHc.p50_clear,  fHc.frac_clear,  fHc.fail_below,  fHc.clear_above,
        fExh.max_clear, fExh.min_fail, fExh.p50_clear, fExh.frac_clear, fExh.fail_below, fExh.clear_above,
        // AC/FC
        ac_frac, ac_max_d, ac_p50_d,
        fc_frac, fc_max_d, fc_p50_d, fc_fail_near, fc_to_exh_ratio,
        // v3.2 추가
        v32_M, v32_M_top10_avg, v32_gap_top10,
        v32_gap_x_is_ec, v32_gap_x_is_hc, v32_gap_x_is_exh,
        v32_prob_sum,
      ];

      // 3단계: Ridge 보정 계산 (v3.2.9 조건부 적용 위해 일단 변수만 계산)
      let correction = 0;
      for (let i = 0; i < RIDGE_COEF.length; i++) correction += RIDGE_COEF[i] * features[i];

      // 4단계 (v3.2.4 + v3.2.7 + v3.2.9): bin clear-rate 누적 post-correction
      //   stage 별 0.1 단위 bin → rate ≥ 80% + MIN_SAMPLES 충족 → 누적 bonus
      //   bonus 의 rate scaling: rateW = (rate - 0.8) / (1.0 - 0.8) [linear, 80~100% → 0~1]
      //   누적: top1 ×1.0 / top2 ×0.5 / top3 ×0.25
      //   stage 차등 bonus: EC=0.05 / HC=0.10 / EXH=0.15 (어려운 stage 일수록 강한 신호)
      //   MIN_SAMPLES 차등: EC=4 / HC=3 / EXH=2 (어려운 stage 는 작은 표본도 valid)
      //   단방향 (implied > pred 일 때만): final = pred + (implied - pred) × 0.7
      //
      //   v3.2.9: bin 보너스 활성 (implied > raw_s + ridge) AND ridge < 0 일 때
      //     → ridge 의 음수 (페널티) 부분만 무시 (RAY 같이 ridge 가 잘못 페널티 준 경우)
      const STAGE_BONUS_V324 = { ec: 0.05, hc: 0.10, exh: 0.15 };
      const STAGE_MIN_V324   = { ec: 4,    hc: 3,    exh: 2    };
      const NEXT_BIN_W_V324  = [1.0, 0.5, 0.25];
      const POSTCOR_WEIGHT_V324 = 0.7;
      const BIN_W_V324 = 0.1;
      const RATE_LO_V327 = 0.8;  // v3.2.7: rate 80% 이상 인정 (linear scaling)

      let bestImplied = null;
      for (const stage of ['ec', 'hc', 'exh']) {
        const bins = new Map();
        for (const { d, p, stage: st } of fitData) {
          if (st !== stage) continue;
          const start = Math.round(Math.floor(d / BIN_W_V324) * BIN_W_V324 * 10) / 10;
          const key = start.toFixed(1);
          let b = bins.get(key);
          if (!b) { b = { start, total: 0, cleared: 0 }; bins.set(key, b); }
          b.total++;
          if (p === 1) b.cleared++;
        }
        const minSamples = STAGE_MIN_V324[stage];
        const eligible = [];
        for (const b of bins.values()) {
          if (b.total < minSamples) continue;
          const rate = b.cleared / b.total;
          if (rate < RATE_LO_V327) continue;
          // rate scaling: 0.8~1.0 → 0~1 (linear)
          const rateW = (rate - RATE_LO_V327) / (1.0 - RATE_LO_V327);
          if (rateW <= 0) continue;
          eligible.push({ start: b.start, total: b.total, cleared: b.cleared, rate, rateW });
        }
        if (eligible.length === 0) continue;
        eligible.sort((a, b) => b.start - a.start);
        const used = eligible.slice(0, NEXT_BIN_W_V324.length);
        let bonus = 0;
        for (let i = 0; i < used.length; i++) bonus += STAGE_BONUS_V324[stage] * NEXT_BIN_W_V324[i] * used[i].rateW;
        const stageImplied = used[0].start + bonus;
        if (!bestImplied || stageImplied > bestImplied.implied) {
          bestImplied = { stage, implied: stageImplied, bins: used, bonus };
        }
      }

      // v3.2.9: ridge 음수 + bin 보너스 활성일 때 ridge 무시
      const predRidgeApplied = bestS + correction;
      const binActive = bestImplied != null && bestImplied.implied > predRidgeApplied;
      const ridgeMuted = binActive && correction < 0;
      if (ridgeMuted) correction = 0;

      starEstimate = bestS + correction;

      let postCorrection = 0;
      if (bestImplied) {
        const diff = bestImplied.implied - starEstimate;
        if (diff > 0) postCorrection = diff * POSTCOR_WEIGHT_V324;
      }
      starEstimate += postCorrection;

      // 5단계 (v3.2.6 추가): djLevel boost
      //   max clear 곡 (M) 의 lamp 가 EC (3 또는 4) + djLevel ≥ A + raw_s ≥ 3
      //   gap (M - rawS) 곡률 with cutoff: gap < LO 면 0, gap ≥ HI 면 1, 사이 linear
      //   단방향: M > pred 일 때만 끌어올림
      //   POCHI 같은 "lamp 약하지만 점수 좋은 max clear 곡" 사용자 보정
      const DJ_ORD_V326 = { 'F': 0, 'E': 1, 'D': 2, 'C': 3, 'B': 4, 'A': 5, 'AA': 6, 'AAA': 7 };
      const V326_MIN_DJ_ORD = 5;     // A 이상
      const V326_MIN_RAW_S  = 3;
      const V326_GAP_LO     = 2.5;
      const V326_GAP_HI     = 4.0;
      const V326_WEIGHT     = 0.7;

      let djBoost = 0;
      let djBoostInfo = null;
      if (n_cleared_v32 > 0 && bestS >= V326_MIN_RAW_S) {
        const M_lamp_v326 = v32Cleared[0].lamp;
        // EC 만 적용 (HC/EXH/FC 는 ridge 가 이미 잡음)
        if (M_lamp_v326 === 3 || M_lamp_v326 === 4) {
          const M_djLevel = v32Cleared[0].djLevel;
          const djOrd = M_djLevel != null ? DJ_ORD_V326[M_djLevel] : null;
          if (djOrd != null && djOrd >= V326_MIN_DJ_ORD) {
            const diff = v32_M - starEstimate;
            if (diff > 0) {
              const gap = Math.max(0, v32_M - bestS);
              const curveW = Math.max(0, Math.min(1, (gap - V326_GAP_LO) / (V326_GAP_HI - V326_GAP_LO)));
              djBoost = diff * V326_WEIGHT * curveW;
              djBoostInfo = { djLevel: M_djLevel, gap, curveW };
            }
          }
        }
      }
      starEstimate += djBoost;

      // 출력 범위 클램프
      starEstimate = Math.max(0.0, Math.min(15.0, starEstimate));

      console.log(`[step2] ★값 추정 (v3.2.10): ${starEstimate.toFixed(2)} (raw=${starRaw.toFixed(2)}, ridge 보정=${correction >= 0 ? '+' : ''}${correction.toFixed(3)}${ridgeMuted ? ' ★음소거' : ''}, post 보정=${postCorrection >= 0 ? '+' : ''}${postCorrection.toFixed(3)}, djBoost=${djBoost >= 0 ? '+' : ''}${djBoost.toFixed(3)}, 표본 ${fitData.length}, 사용 lamp: ${validStages.join('/')})`);
      console.log(`[step2]   base: ec(max=${fEc.max_clear.toFixed(2)}, p50=${fEc.p50_clear.toFixed(2)}), hc(max=${fHc.max_clear.toFixed(2)}, p50=${fHc.p50_clear.toFixed(2)}), exh(max=${fExh.max_clear.toFixed(2)})`);
      console.log(`[step2]   AC/FC: ac_frac=${ac_frac.toFixed(3)}, ac_max=${ac_max_d.toFixed(2)}, fc_frac=${fc_frac.toFixed(3)}, fc_max=${fc_max_d.toFixed(2)}, fc_to_exh=${fc_to_exh_ratio.toFixed(3)}`);
      console.log(`[step2]   v3.2: M=${v32_M.toFixed(2)}, top10_avg=${v32_M_top10_avg.toFixed(2)}, gap_top10=${v32_gap_top10.toFixed(2)}, n_cleared=${n_cleared_v32}${isUnderCutoff ? ' (CUTOFF 미달!)' : ''}, prob_sum=${v32_prob_sum.toFixed(3)}`);
      if (bestImplied) {
        const binStr = bestImplied.bins.map(b => `${b.start.toFixed(1)}(${b.cleared}/${b.total},${(b.rate*100).toFixed(0)}%→w${b.rateW.toFixed(2)})`).join(', ');
        console.log(`[step2]   v3.2.7 post-correction: ${bestImplied.stage} bins [${binStr}] → implied ${bestImplied.implied.toFixed(3)}`);
      } else {
        console.log(`[step2]   v3.2.7 post-correction: no eligible bin`);
      }
      if (djBoostInfo) {
        console.log(`[step2]   v3.2.6 djLevel boost: M lamp=EC, djLv=${djBoostInfo.djLevel}, gap=${djBoostInfo.gap.toFixed(2)}, curveW=${djBoostInfo.curveW.toFixed(2)}, boost=+${djBoost.toFixed(3)}`);
      } else {
        console.log(`[step2]   v3.2.6 djLevel boost: 적용 X (조건 불만족)`);
      }
    }
  } else {
    console.log(`[step2] ★값 추정: 표본 부족 (${fitData.length}개)`);
  }
  // -------- 5.6. status 페이지에서 프로필 정보 fetch --------
  // 쿠프로(クプロ) 이미지, DJ 이름, IIDX ID, SP/DP 단위(段位), 노트레이더 등
  let profile = null;
  updateProgress('프로필 정보 fetch 중...', 96);
  try {
    const statusUrl = 'https://p.eagate.573.jp/game/2dx/33/djdata/status.html';
    const res = await fetch(statusUrl, { credentials: 'include' });
    if (res.ok) {
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      profile = {};
      // 쿠프로 이미지 (절대 URL 로 변환)
      const qproImg = doc.querySelector('div.qpro-img img');
      if (qproImg) {
        let src = qproImg.getAttribute('src') || '';
        if (src.startsWith('/')) src = 'https://p.eagate.573.jp' + src;
        else if (!src.startsWith('http')) src = new URL(src, statusUrl).href;
        profile.qproImg = src;
      }
      // DJ 프로필 테이블
      const profileTable = doc.querySelector('div.dj-profile table');
      if (profileTable) {
        profileTable.querySelectorAll('tr').forEach(tr => {
          const tds = tr.querySelectorAll('td');
          if (tds.length === 2) {
            const key = tds[0].textContent.trim();
            const val = tds[1].textContent.trim();
            if (key === 'DJ NAME')        profile.djName = val;
            else if (key === '所属エリア')  profile.area = val;
            else if (key === 'IIDX ID')    profile.iidxId = val;
            else if (key === '所持LIME')   profile.lime = val;
            else if (key === 'プレー回数') profile.playCount = val;
          }
        });
      }
      // 段位 (단위) - dj-rank 영역들 중 cat-name 이 段位認定 인 것
      doc.querySelectorAll('div.dj-rank').forEach(dr => {
        const cn = dr.querySelector('div.cat-name');
        if (!cn) return;
        const catName = cn.textContent.trim();
        if (catName === '段位認定') {
          dr.querySelectorAll('div.rank-cat').forEach(rc => {
            const divs = rc.querySelectorAll('div');
            if (divs.length >= 2) {
              const style = divs[0].textContent.trim();  // 'SP' or 'DP'
              const rank = divs[1].textContent.trim();   // '中伝', '十段', '---' 등
              if (style === 'SP') profile.spRank = rank;
              if (style === 'DP') profile.dpRank = rank;
            }
          });
        }
      });
      console.log('[step2] 프로필 fetch 완료:', profile);
    } else {
      console.warn(`[step2] 프로필 fetch 실패 HTTP ${res.status}`);
    }
  } catch (e) {
    console.warn('[step2] 프로필 fetch 실패:', e);
  }

  // -------- 5.7. 추천곡 계산 (EC/HC/EXH 3종류) --------
  // 추천곡 기준 ★값: ereter (이레터 원본) / ohsorry (우리 모델 추정) 토글로 선택 가능
  const idNormForRec = profile && profile.iidxId ? profile.iidxId.replace(/-/g, '') : null;
  const eraterTrueStar = (idNormForRec && ereterPlayers) ? ereterPlayers[idNormForRec] : null;
  let recBaseMode = eraterTrueStar != null ? 'ereter' : 'ohsorry';
  let recBaseStar = recBaseMode === 'ereter' ? eraterTrueStar : starEstimate;
  console.log(`[step2] 추천곡 기준: ${recBaseMode} (★${recBaseStar != null ? recBaseStar.toFixed(2) : 'N/A'})`);

  const recsEC = [], recsHC = [], recsEXH = [];

  // Fisher-Yates shuffle
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  // 도전곡 범위 — recBaseStar 위로 얼마까지 추천할지.
  //   ★0.5 사용자: +1.2 까지 (저렙은 도전곡이 풍부하니 넓게)
  //   ★14.0 사용자: +0.3 까지 (고렙은 좁게)
  //   사이는 선형 보간, 범위 밖은 clamp.
  const challengeOffset = (baseStar) => {
    if (baseStar <= 0.5) return 1.2;
    if (baseStar >= 14.0) return 0.3;
    return 1.2 - ((baseStar - 0.5) * 0.9) / 13.5;
  };

  // 도전/정리 풀 분리 (recBaseStar 가 기준 — ereter / ohsorry 토글에 따라 변경됨)
  const buildPools = (threshold, getDiffField) => {
    const challenge = [];
    const cleanup = [];
    if (recBaseStar == null) return { challenge, cleanup };
    const offset = challengeOffset(recBaseStar);
    for (const c of allCharts) {
      if (c.lampNum >= threshold) continue;
      const e = ereterMap.get(norm(c.title) + '|' + c.diff);
      if (!e || e.level == null) continue;
      if (e.level < 11.6 || e.level > 12.7) continue;
      const dv = e[getDiffField];
      if (typeof dv !== 'number') continue;
      const item = {
        title: c.title, chart: c.diff, level: e.level,
        ec: e.ec, hc: e.hc, exh: e.exh,
        ec_n: e.ec_n, hc_n: e.hc_n, exh_n: e.exh_n,
        diffValue: dv, currentLamp: c.lamp,
        margin: recBaseStar - dv,
      };
      if (dv >= recBaseStar && dv <= recBaseStar + offset) {
        challenge.push(item);
      } else if (dv < recBaseStar) {
        cleanup.push(item);
      }
    }
    return { challenge, cleanup };
  };

  const buildRecs = (threshold, getDiffField) => {
    const { challenge, cleanup } = buildPools(threshold, getDiffField);

    // 풀에서 랜덤 10곡씩 (총 20곡 후보), picked = 도전 6 + 정리 4 비율 고정
    const challengeRand = shuffle(challenge).slice(0, 10);
    const cleanupRand = shuffle(cleanup).slice(0, 10);
    const keyOf = r => (r.title || '') + '|' + r.chart;

    const used = new Set();
    let chPick = challengeRand.slice(0, 6);
    chPick.forEach(r => used.add(keyOf(r)));
    let clPick = cleanupRand.filter(r => !used.has(keyOf(r))).slice(0, 4);
    clPick.forEach(r => used.add(keyOf(r)));

    // 부족하면 다른 쪽에서 채움 (총 최대 10곡)
    if (chPick.length + clPick.length < 10 && clPick.length < 4) {
      const extra = challengeRand
        .filter(r => !used.has(keyOf(r)))
        .slice(0, 10 - chPick.length - clPick.length);
      chPick = [...chPick, ...extra];
      extra.forEach(r => used.add(keyOf(r)));
    }
    if (chPick.length + clPick.length < 10) {
      const extra = cleanupRand
        .filter(r => !used.has(keyOf(r)))
        .slice(0, 10 - chPick.length - clPick.length);
      clPick = [...clPick, ...extra];
    }

    // 표시 순서: 도전(★ 높은→낮은) → 정리(★ 높은→낮은)
    chPick.sort((a, b) => b.diffValue - a.diffValue);
    clPick.sort((a, b) => b.diffValue - a.diffValue);
    return [...chPick, ...clPick];
  };

  if (recBaseStar != null) {
    recsEC.push(...buildRecs(3, 'ec'));
    recsHC.push(...buildRecs(5, 'hc'));
    recsEXH.push(...buildRecs(6, 'exh'));
    console.log(`[step2] 추천곡: EC ${recsEC.length}, HC ${recsHC.length}, EXH ${recsEXH.length}`);
  }

  const topEC  = recsEC;
  const topHC  = recsHC;
  const topEXH = recsEXH;

  // 다시 뽑기 버튼에서 사용할 수 있도록 buildRecs 노출
  // (panel 생성 후 클릭으로 재호출 → DOM 부분 업데이트)
  window.__dp_rerollRecs = (stage) => {
    let threshold, field;
    if (stage === 'ec')  { threshold = 3; field = 'ec';  }
    if (stage === 'hc')  { threshold = 5; field = 'hc';  }
    if (stage === 'exh') { threshold = 6; field = 'exh'; }
    return buildRecs(threshold, field);
  };

  // -------- 6. 화면에 표시 --------
  document.getElementById('__dp_score_panel')?.remove();
  const fmt = (n) => Math.round(n * 100) / 100;
  const escHtml = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const panel = document.createElement('div');
  panel.id = '__dp_score_panel';
  panel.innerHTML = `
    <style>
      #__dp_score_panel {
        position: fixed; top: 8px; right: 8px; left: 8px; z-index: 999999;
        max-width: 380px; max-height: 92vh; overflow: auto;
        margin-left: auto;
        background: #fff; color: #222;
        font-family: -apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif;
        font-size: 13px; line-height: 1.5;
        border: 1px solid #ccc; border-radius: 8px;
        box-shadow: 0 6px 24px rgba(0,0,0,.18);
        padding: 12px 14px;
        box-sizing: border-box;
      }
      @media (min-width: 768px) {
        /* 데스크톱: 우상단 고정, 너비 고정 (다시 뽑기 시 출렁임 방지) */
        #__dp_score_panel { left: auto; top: 16px; right: 16px; padding: 14px 16px; width: 380px; }
      }
      #__dp_score_panel h3 { margin: 0 0 6px; font-size: 15px; font-weight: 600; }
      #__dp_score_panel .meta { color: #666; font-size: 11px; margin-bottom: 10px; }
      #__dp_score_panel table { width: 100%; border-collapse: collapse; font-size: 12px; }
      #__dp_score_panel td { padding: 3px 6px; border-bottom: 1px solid #eee; text-align: left; color: #212529; }
      #__dp_score_panel th { padding: 3px 6px; text-align: left; background: #f6f6f6; font-weight: 600; color: #212529; border: none; }
      #__dp_score_panel th.num { text-align: right; }
      #__dp_score_panel th[colspan] { text-align: center; }
      #__dp_score_panel td.num { text-align: right; font-variant-numeric: tabular-nums; }
      #__dp_score_panel .close { float: right; cursor: pointer; color: #888; border: none; background: none; font-size: 18px; line-height: 1; padding: 0; }
      #__dp_score_panel details { margin-top: 10px; }
      #__dp_score_panel summary { cursor: pointer; font-weight: 500; padding: 4px 0; outline: none; }
      /* details.toggle - 끝에 작은 ∨ / ∧ 마커 */
      #__dp_score_panel details.toggle > summary { list-style: none; }
      #__dp_score_panel details.toggle > summary::-webkit-details-marker { display: none; }
      #__dp_score_panel details.toggle > summary::after { content: '∨'; font-size: 9px; color: #c0c0c0; margin-left: 6px; }
      #__dp_score_panel details.toggle[open] > summary::after { content: '∧'; }
      #__dp_score_panel summary:hover { color: #495057; }
      /* 추천곡 details 전용: summary 가 flex 레이아웃, 화살표는 span, 다시뽑기 버튼은 우측 끝 */
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
      #__dp_score_panel .profile { display: flex; gap: 12px; align-items: center; padding: 12px; background: #f8f9fb; border-radius: 6px; margin-bottom: 10px; }
      #__dp_score_panel .profile-img { flex-shrink: 0; width: 64px; height: 64px; background: #e9ecef; border-radius: 4px; overflow: hidden; }
      #__dp_score_panel .profile-img img { width: 100%; height: 100%; object-fit: cover; }
      #__dp_score_panel .profile-info { flex: 1; min-width: 0; }
      #__dp_score_panel .profile-name { font-size: 16px; font-weight: 600; line-height: 1.2; }
      #__dp_score_panel .profile-id { font-size: 11px; color: #666; margin-top: 2px; }
      #__dp_score_panel .profile-rank { display: flex; gap: 10px; margin-top: 6px; font-size: 13px; flex-wrap: wrap; }
      #__dp_score_panel .profile-rank span { white-space: nowrap; font-weight: 700; }
      #__dp_score_panel .profile-rank b { color: #6c757d; margin-right: 3px; font-weight: 600; }
      /* 중전 (은빛) / 개전 (금빛) 은은하게 반짝이는 그라데이션 */
      #__dp_score_panel .rank-chuden, #__dp_score_panel .rank-kaiden {
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        color: transparent;
        background-size: 200% 100%;
        animation: __dp_shimmer 6s linear infinite;
      }
      #__dp_score_panel .rank-chuden {
        /* 베이스: 차분한 회색 → 살짝 밝아졌다가 → 다시 회색 */
        background-image: linear-gradient(90deg, #8c95a0 0%, #8c95a0 40%, #c7ccd2 50%, #8c95a0 60%, #8c95a0 100%);
      }
      #__dp_score_panel .rank-kaiden {
        /* 베이스: 차분한 금 → 살짝 밝아졌다가 → 다시 금 */
        background-image: linear-gradient(90deg, #c8a347 0%, #c8a347 40%, #ead78a 50%, #c8a347 60%, #c8a347 100%);
      }
      /* b 태그 (SP/DP 라벨) 는 그라데이션 영향 안 받게 */
      #__dp_score_panel .rank-chuden b, #__dp_score_panel .rank-kaiden b {
        -webkit-text-fill-color: #6c757d;
        color: #6c757d;
      }
      @keyframes __dp_shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
      #__dp_score_panel .profile-star { flex-shrink: 0; text-align: center; padding: 4px 4px 4px 8px; min-width: 72px; }
      #__dp_score_panel .profile-star-value { font-size: 22px; font-weight: 700; color: #212529; line-height: 1.1; margin: 2px 0; }
      #__dp_score_panel .profile-star-note { font-size: 9px; color: #888; line-height: 1.1; }
      /* 추천곡 기준 토글 (ereter / OhSorry) — 두 줄, 글씨 클릭 전환 */
      #__dp_score_panel .rec-mode-toggle {
        margin-top: 10px;
        text-align: center;
      }
      #__dp_score_panel .rec-mode-label {
        font-size: 11px; color: #888;
        margin-bottom: 2px;
      }
      #__dp_score_panel .rec-mode-options {
        font-size: 12px;
      }
      #__dp_score_panel .rec-mode-opt {
        cursor: pointer;
        color: #aaa;
        transition: color 0.15s;
      }
      #__dp_score_panel .rec-mode-opt:hover {
        color: #555;
      }
      #__dp_score_panel .rec-mode-opt.active {
        color: #212529;
        font-weight: 700;
        cursor: default;
      }
      #__dp_score_panel .rec-mode-sep {
        color: #ccc;
        margin: 0 8px;
      }
      #__dp_score_panel .recs { margin-top: 12px; }
      #__dp_score_panel .rec-item { padding: 6px 8px; background: #f8f9fb; border-radius: 4px; margin-bottom: 4px; font-size: 12px; display: flex; justify-content: space-between; gap: 8px; }
      #__dp_score_panel .rec-item .rec-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #__dp_score_panel .rec-item .rec-info { flex-shrink: 0; color: #666; font-variant-numeric: tabular-nums; font-size: 11px; }
      #__dp_score_panel .rec-item .rec-diff { color: #343a40; font-weight: 600; }
    </style>
    <button class="close" onclick="document.getElementById('__dp_score_panel').remove()" title="닫기">×</button>

    ${profile ? `
      <div class="profile">
        ${profile.qproImg ? `<div class="profile-img"><img src="${escHtml(profile.qproImg)}" alt="qpro"></div>` : ''}
        <div class="profile-info">
          <div class="profile-name">${escHtml(profile.djName || 'DJ')}</div>
          <div class="profile-id">IIDX ID: ${escHtml(profile.iidxId || '-')}</div>
          ${(profile.spRank || profile.dpRank) ? (() => {
            // 단위별 스타일 매핑
            //   1~8段: 파란색 / 9~10段: 빨간색
            //   中伝: 은빛 반짝 / 皆伝: 금빛 반짝
            //   기타 (無段/級 등): 회색
            // 단위는 한자 숫자로 표기됨 (一段/二段/.../九段/十段)
            const KANJI_NUM = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
            const rankStyle = (rank) => {
              if (!rank) return { color: '#6c757d', cls: '' };
              if (rank.includes('皆伝')) return { color: null, cls: 'rank-kaiden' };
              if (rank.includes('中伝')) return { color: null, cls: 'rank-chuden' };
              // 段 매칭: 한자 (一~十) 또는 아라비아 숫자
              const mKanji = rank.match(/([一二三四五六七八九十]+)\s*段/);
              const mDigit = rank.match(/(\d+)\s*段/);
              let n = null;
              if (mKanji) {
                // 십 단위 한자 ("十" 단독은 10, "十一" 등은 거의 없음)
                const s = mKanji[1];
                if (s === '十') n = 10;
                else if (s.length === 1 && KANJI_NUM[s]) n = KANJI_NUM[s];
                else n = null;  // 복합 한자는 안 다룸
              } else if (mDigit) {
                n = parseInt(mDigit[1], 10);
              }
              if (n != null) {
                if (n >= 9) return { color: '#dc3545', cls: '' };  // 빨강
                return { color: '#1971c2', cls: '' };  // 파랑
              }
              return { color: '#6c757d', cls: '' };  // 기본
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
          // 위에서 이미 계산한 eraterTrueStar 변수 재사용
          if (eraterTrueStar != null) {
            const diff = starEstimate - eraterTrueStar;
            const diffStr = (diff >= 0 ? '+' : '') + diff.toFixed(2);
            const diffColor = Math.abs(diff) <= 0.1 ? '#52a447' : (Math.abs(diff) <= 0.3 ? '#dcaf45' : '#dc3545');
            return `
              <div class="profile-star">
                <div class="profile-star-value">★${fmt(starEstimate)}</div>
                <div class="profile-star-note">ereter: ★${eraterTrueStar.toFixed(2)} <span style="color:${diffColor};font-weight:600">(${diffStr})</span></div>
              </div>
            `;
          }
          return `
            <div class="profile-star">
              <div class="profile-star-value">★${fmt(starEstimate)}</div>
              <div class="profile-star-note">ereter.net 근사치 ±0.1</div>
            </div>
          `;
        })() : ''}
      </div>
    ` : '<div class="meta">프로필 정보를 가져올 수 없었어요</div>'}

    ${(() => {
      // 난이도 (HYPER/ANOTHER/LEGGENDARIA) 색상
      //   HYPER = 연한 금색
      //   ANOTHER = 연한 빨강
      //   LEGGENDARIA = 연한 마젠타
      const chartColor = (chart) => {
        if (!chart) return '#888';
        const c = chart.toUpperCase();
        if (c.startsWith('L') || c.includes('LEGG')) return '#d678c8';  // 연한 마젠타
        if (c.startsWith('A')) return '#e88080';  // 연한 빨강
        if (c.startsWith('H')) return '#dcaf45';  // 연한 금
        return '#888';
      };
      // 추천 항목들을 HTML 로 렌더링 (다시 뽑기에서도 재사용)
      const renderRecItems = (recs, color) => {
        if (recs.length === 0) {
          return `<div class="meta" style="padding:6px 8px;color:#888">★값 근처에 추천할 곡이 없어요.</div>`;
        }
        return recs.map(r => {
          const chartLetter = (r.chart || '?')[0];
          const cColor = chartColor(r.chart);
          return `
            <div class="rec-item">
              <div class="rec-title">${escHtml(r.title)}<span style="color:#aaa;font-weight:400;margin-left:4px;font-size:10.5px">${r.currentLamp || ''}</span></div>
              <div class="rec-info">
                <span class="rec-diff" style="color:${color}">★${fmt(r.diffValue)}</span>
                · ☆${r.level} <span style="color:${cColor};font-weight:600">${chartLetter}</span>
              </div>
            </div>
          `;
        }).join('');
      };
      // 다시 뽑기 함수 (window 에 노출 → 버튼 onclick 에서 호출)
      window.__dp_renderRecItems = renderRecItems;
      window.__dp_rerollAndRender = (stage, color) => {
        const newRecs = window.__dp_rerollRecs(stage);
        const container = document.getElementById(`__dp_recs_${stage}`);
        if (container) container.innerHTML = window.__dp_renderRecItems(newRecs, color);
        const counter = document.getElementById(`__dp_recs_count_${stage}`);
        if (counter) counter.textContent = newRecs.length;
      };

      const renderRec = (label, recs, color, stage) => {
        return `
          <details class="toggle-rec" style="margin-top:10px">
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
      // 추천곡 기준 ★ 토글 (ereter / OhSorry)
      //   ereter 데이터 없으면 토글 숨김 (OhSorry 단일 모드로 자동 동작)
      //   디자인: 두 줄 (라벨 / 옵션), 글씨 클릭으로 전환, 가운데 구분자 |
      const recModeToggle = (() => {
        if (eraterTrueStar == null) return '';
        const ereterActive = recBaseMode === 'ereter';
        const ohsorryActive = recBaseMode === 'ohsorry';
        const ereterStarTxt = `★${eraterTrueStar.toFixed(2)}`;
        const ohsorryStarTxt = starEstimate != null ? `★${fmt(starEstimate)}` : '없음';
        return `
          <div class="rec-mode-toggle">
            <div class="rec-mode-options">
              <span class="rec-mode-opt ${ereterActive ? 'active' : ''}" data-mode="ereter"
                onclick="window.__dp_setRecBase && window.__dp_setRecBase('ereter')"
                title="이레터넷 원본 ★값 기준">ereter ${ereterStarTxt}</span>
              <span class="rec-mode-sep">|</span>
              <span class="rec-mode-opt ${ohsorryActive ? 'active' : ''}" data-mode="ohsorry"
                onclick="window.__dp_setRecBase && window.__dp_setRecBase('ohsorry')"
                title="OhSorry (우리 모델) 추정 ★값 기준">OhSorry ${ohsorryStarTxt}</span>
            </div>
          </div>
        `;
      })();

      // 추천곡 모드 변경 핸들러
      const STAGE_COLORS = { ec: '#52a447', hc: '#dc3545', exh: '#d4a017' };
      window.__dp_setRecBase = (mode) => {
        if (mode === 'ereter' && eraterTrueStar == null) return;
        recBaseMode = mode;
        recBaseStar = mode === 'ereter' ? eraterTrueStar : starEstimate;
        for (const stage of ['ec', 'hc', 'exh']) {
          const newRecs = window.__dp_rerollRecs(stage);
          const container = document.getElementById(`__dp_recs_${stage}`);
          if (container) container.innerHTML = window.__dp_renderRecItems(newRecs, STAGE_COLORS[stage]);
          const counter = document.getElementById(`__dp_recs_count_${stage}`);
          if (counter) counter.textContent = newRecs.length;
        }
        document.querySelectorAll('.rec-mode-opt').forEach(b => {
          b.classList.toggle('active', b.dataset.mode === mode);
        });
      };

      return recModeToggle + [
        renderRec('EASY',    topEC,  '#52a447', 'ec'),    // 연두
        renderRec('HARD',    topHC,  '#dc3545', 'hc'),    // 빨강
        renderRec('EX-HARD', topEXH, '#d4a017', 'exh'),   // 금색
      ].join('');
    })()}

    <details open class="toggle" style="margin-top:10px">
      <summary style="font-weight:600;color:#212529">상세 통계 (LEVEL ${levelText} / ${style === '1' ? 'DP' : 'SP'})</summary>
      <div class="meta" style="margin:6px 0">${pageCount}페이지 · ${allCharts.length}곡 · 매칭 ${matched} · 미매칭 ${unmatched}</div>
      ${(() => {
        // CLEAR TYPE 매핑 (게임 내 명칭 + 색상)
        const lampOrder = [
          { key: 'FULL COMBO', label: 'F-COMBO',   color: '#00d4dd' },
          { key: 'EX HARD',    label: 'EXH-CLEAR', color: '#dcaf45' },
          { key: 'HARD',       label: 'H-CLEAR',   color: '#dc3545' },
          { key: 'CLEAR',      label: 'CLEAR',     color: '#212529' },
          { key: 'EASY',       label: 'E-CLEAR',   color: '#52a447' },
          { key: 'ASSIST',     label: 'A-CLEAR',   color: '#9966cc' },
          { key: 'FAILED',     label: 'FAILED',    color: '#dc3545' },
        ];
        // DJ LEVEL 매핑
        const djOrder = [
          { key: 'AAA', color: '#dcaf45' },
          { key: 'AA',  color: '#dcaf45' },
          { key: 'A',   color: '#52a447' },
          { key: 'B',   color: '#1971c2' },
          { key: 'C',   color: '#888' },
          { key: 'D',   color: '#888' },
          { key: 'E',   color: '#dc3545' },
          { key: 'F',   color: '#dc3545' },
        ];
        // CLEAR TYPE / DJ LEVEL: e-amusement 에서 fetch 한 모든 12렙 곡 기준 (공식 페이지와 일치)
        const clearTypeCount = { 'FULL COMBO': 0, 'EX HARD': 0, 'HARD': 0, 'CLEAR': 0, 'EASY': 0, 'ASSIST': 0, 'FAILED': 0, 'NO PLAY': 0 };
        const djCount = {};
        for (const c of allCharts) {
          if (clearTypeCount[c.lamp] !== undefined) {
            clearTypeCount[c.lamp]++;
          }
          if (c.djLevel) {
            djCount[c.djLevel] = (djCount[c.djLevel] || 0) + 1;
          }
        }
        const rows = Math.max(lampOrder.length, djOrder.length);
        let html = '<table style="margin-bottom:8px"><tr><th colspan="2">CLEAR TYPE</th><th colspan="2">DJ LEVEL</th></tr>';
        for (let i = 0; i < rows; i++) {
          const l = lampOrder[i];
          const d = djOrder[i];
          html += '<tr>';
          if (l) {
            html += `<td style="color:${l.color};font-weight:600">${l.label}</td><td class="num">${clearTypeCount[l.key] || 0} 곡</td>`;
          } else {
            html += '<td></td><td></td>';
          }
          if (d) {
            html += `<td style="color:${d.color};font-weight:600">${d.key}</td><td class="num">${djCount[d.key] || 0} 곡</td>`;
          } else {
            html += '<td></td><td></td>';
          }
          html += '</tr>';
        }
        html += '</table>';
        return html;
      })()}
      <details class="toggle" style="margin-top:8px">
        <summary style="font-weight:600;color:#212529">난이도 별 클리어 램프</summary>
        ${(() => {
        // ★ 단위별 진행 현황
        //   곡 수: ereter 전체 데이터 기준
        //   클리어 카운트: 사용자 실제 데이터 (lamp 단독, 누적 X)
        //   합계 = 곡 수 가 되도록 모든 lamp 단계 표시
        const levels = [11.6, 11.7, 11.8, 11.9, 12.0, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7];
        const stats = {};
        for (const lv of levels) {
          stats[lv.toFixed(1)] = { total: 0, fc: 0, exh: 0, hd: 0, cl: 0, ez: 0, as: 0, fa: 0, np: 0, played: 0 };
        }
        // 1. 곡 수: ereter 전체 데이터
        for (const e of ereterData) {
          if (e.level == null) continue;
          const k = e.level.toFixed(1);
          if (!stats[k]) continue;
          stats[k].total++;
        }
        // 2. lamp 단독 카운트
        for (const c of allCharts) {
          const e = ereterMap.get(norm(c.title) + '|' + c.diff);
          if (!e || e.level == null) continue;
          const k = e.level.toFixed(1);
          if (!stats[k]) continue;
          if (c.lampNum >= 1) stats[k].played++;
          if (c.lampNum === 7) stats[k].fc++;
          else if (c.lampNum === 6) stats[k].exh++;
          else if (c.lampNum === 5) stats[k].hd++;
          else if (c.lampNum === 4) stats[k].cl++;
          else if (c.lampNum === 3) stats[k].ez++;
          else if (c.lampNum === 2) stats[k].as++;
          else if (c.lampNum === 1) stats[k].fa++;
        }
        // 3. NP = 전체 곡 수 - 사용자가 시도한 곡 수
        for (const lv of levels) {
          const k = lv.toFixed(1);
          stats[k].np = Math.max(0, stats[k].total - stats[k].played);
        }
        // 0 일 경우 - 로 표기 + 연한 회색 (시각적 노이즈 줄이기)
        const cell = (n) => n === 0
          ? `<td class="num" style="color:#d0d0d0">-</td>`
          : `<td class="num">${n}</td>`;
        let html = `
          <table style="margin-bottom:8px;width:100%">
            <tr>
              <th>★</th>
              <th class="num">곡 수</th>
              <th class="num" style="color:#00aab2">FC</th>
              <th class="num" style="color:#dcaf45">EX</th>
              <th class="num" style="color:#dc3545">HC</th>
              <th class="num" style="color:#212529">CL</th>
              <th class="num" style="color:#52a447">EC</th>
              <th class="num" style="color:#9966cc">AC</th>
              <th class="num" style="color:#8b3a3a">FA</th>
              <th class="num" style="color:#888">NP</th>
            </tr>`;
        for (const lv of levels) {
          const s = stats[lv.toFixed(1)];
          if (s.total === 0) continue;
          html += `
            <tr>
              <td>★${lv.toFixed(1)}</td>
              <td class="num">${s.total}</td>
              ${cell(s.fc)}
              ${cell(s.exh)}
              ${cell(s.hd)}
              ${cell(s.cl)}
              ${cell(s.ez)}
              ${cell(s.as)}
              ${cell(s.fa)}
              ${cell(s.np)}
            </tr>`;
        }
        html += '</table>';
        return html;
      })()}
      </details>
      <details class="toggle" style="margin-top:6px">
        <summary style="font-weight:600;color:#212529">난이도 별 DJ LEVEL</summary>
        ${(() => {
        // ★ 단위별 DJ LEVEL 분포
        //   곡 수: ereter 전체 데이터 기준
        //   DJ LEVEL: 사용자 실제 데이터 (AAA, AA, A, B, C이하 그룹)
        const levels = [11.6, 11.7, 11.8, 11.9, 12.0, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7];
        const stats = {};
        for (const lv of levels) {
          stats[lv.toFixed(1)] = { total: 0, AAA: 0, AA: 0, A: 0, B: 0, lower: 0, none: 0 };
        }
        // 1. 곡 수: ereter 전체
        for (const e of ereterData) {
          if (e.level == null) continue;
          const k = e.level.toFixed(1);
          if (!stats[k]) continue;
          stats[k].total++;
        }
        // 2. DJ LEVEL: 사용자 데이터 (C/D/E/F 는 lower 로 합침)
        for (const c of allCharts) {
          const e = ereterMap.get(norm(c.title) + '|' + c.diff);
          if (!e || e.level == null) continue;
          const k = e.level.toFixed(1);
          if (!stats[k]) continue;
          if (!c.djLevel) continue;
          if (['AAA', 'AA', 'A', 'B'].includes(c.djLevel)) {
            stats[k][c.djLevel]++;
          } else if (['C', 'D', 'E', 'F'].includes(c.djLevel)) {
            stats[k].lower++;
          }
        }
        // 3. none = 점수 없는 곡 = 곡 수 - 점수 있는 곡 수
        for (const lv of levels) {
          const k = lv.toFixed(1);
          const s = stats[k];
          const scored = s.AAA + s.AA + s.A + s.B + s.lower;
          s.none = Math.max(0, s.total - scored);
        }
        const cell2 = (n) => n === 0
          ? `<td class="num" style="color:#d0d0d0">-</td>`
          : `<td class="num">${n}</td>`;
        let html = `
          <table style="margin-bottom:8px;width:100%">
            <tr>
              <th>★</th>
              <th class="num">곡 수</th>
              <th class="num" style="color:#dcaf45">AAA</th>
              <th class="num" style="color:#dcaf45">AA</th>
              <th class="num" style="color:#52a447">A</th>
              <th class="num" style="color:#1971c2">B</th>
              <th class="num" style="color:#888">C↓</th>
              <th class="num" style="color:#888">NP</th>
            </tr>`;
        for (const lv of levels) {
          const s = stats[lv.toFixed(1)];
          if (s.total === 0) continue;
          html += `
            <tr>
              <td>★${lv.toFixed(1)}</td>
              <td class="num">${s.total}</td>
              ${cell2(s.AAA)}
              ${cell2(s.AA)}
              ${cell2(s.A)}
              ${cell2(s.B)}
              ${cell2(s.lower)}
              ${cell2(s.none)}
            </tr>`;
        }
        html += '</table>';
        return html;
      })()}
      </details>
    </details>

    ${ereterExtractedAt ? (() => {
      // 날짜는 한국식 (yyyy.mm.dd), 시간은 영문 AM/PM. 패널 최하단에 표시.
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

  // DJ LEVEL / EX 점수 통계 (★11.6 ~ ★12.7, 즉 공식 ☆12 전체)
  const isTwelve = (c) => {
    const e = ereterMap.get(norm(c.title) + '|' + c.diff);
    return e && e.level != null && e.level >= 11.6 && e.level <= 12.7;
  };
  const playedTwelve = allCharts.filter(c => c.lampNum > 0 && isTwelve(c));
  const djLevelDist = {};
  for (const c of playedTwelve) {
    const lv = c.djLevel || '-';
    djLevelDist[lv] = (djLevelDist[lv] || 0) + 1;
  }
  const djLevelOrder = ['AAA', 'AA', 'A', 'B', 'C', 'D', 'E', 'F', '-'];
  const djLevelStr = djLevelOrder.filter(k => djLevelDist[k]).map(k => `${k}:${djLevelDist[k]}`).join(' ');
  console.log(`[step2] 12렙 DJ LEVEL 분포: ${djLevelStr}`);

  window.__dp_result = { total, matched, unmatched, details, perLevel, perLamp, allCharts, pageCount, ereterExtractedAt, starEstimate, starRaw, profile, recsEC, recsHC, recsEXH, djLevelDist };
  console.log('💾 결과 데이터: window.__dp_result');
  console.log('   - allCharts: 곡별 lamp + djLevel + exScore + pgreat + great');

  // -------- 7. Supabase user_profiles UPSERT --------
  //   user_profiles: iidx_id PK 로 UPSERT (매번 덮어쓰기 + charts_json 저장)
  //   DB trigger 가 자동 차단:
  //     - star_estimate 가 이전과 같음 → skip (저장 안 함)
  //     - 마지막 갱신 < 1일 → skip
  //     - 둘 다 통과 → user_changes 에 변화 자동 INSERT (요약 + 곡별 diff)
  //   실패해도 사용자 경험에 영향 없도록 fire-and-forget
  (async () => {
    const SUPABASE_URL = 'https://ryesiijulrlmstmhzpnv.supabase.co';
    // Legacy JWT anon key (publishable key 는 RLS 호환성 문제로 사용 X)
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5ZXNpaWp1bHJsbXN0bWh6cG52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNzAxNDAsImV4cCI6MjA5Mzc0NjE0MH0.KaKa241XpXbRkdM0C3euyUM3jOX673ijd319HFFFxwA';

    if (!profile || !profile.iidxId) {
      console.log('[step2] user_profiles 저장 skip: 프로필 없음');
      return;
    }
    const iidxIdNorm = profile.iidxId.replace(/-/g, '');

    // ☆12 lamp 통계
    let nPlayedLv12 = 0, fcCount = 0, exhCount = 0, hcCount = 0, nClearedLv12 = 0;
    for (const c of allCharts) {
      const e = ereterMap.get(norm(c.title) + '|' + c.diff);
      if (!e || e.level == null || e.level < 11.6 || e.level > 12.7) continue;
      if (c.lampNum > 0) nPlayedLv12++;
      if (c.lampNum >= 3) nClearedLv12++;
      if (c.lampNum >= 5) hcCount++;
      if (c.lampNum >= 6) exhCount++;
      if (c.lampNum === 7) fcCount++;
    }

    const payload = {
      iidx_id: iidxIdNorm,
      dj_name: profile.djName || null,
      star_estimate: starEstimate != null ? Number(starEstimate.toFixed(4)) : null,
      ereter_star: eraterTrueStar != null ? Number(eraterTrueStar) : null,
      raw_s: starRaw != null ? Number(starRaw.toFixed(4)) : null,
      version: 'v3.2.10',
      sp_rank: profile.spRank || null,
      dp_rank: profile.dpRank || null,
      n_cleared: nClearedLv12,
      n_played_lv12: nPlayedLv12,
      fc_count: fcCount,
      hc_count: hcCount,
      exh_count: exhCount,
      level_filter: 'lv12',
      series: SERIES,
      charts_json: allCharts,
    };

    try {
      // RPC: security definer function 호출 (RLS 우회)
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/upsert_user_profile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({ p: payload }),
      });
      if (res.ok) {
        console.log('[step2] user_profiles upsert 성공 (DB trigger 가 ★값 변화 + 1일 경과 체크)');
      } else {
        const errText = await res.text().catch(() => '');
        console.warn(`[step2] user_profiles 실패: HTTP ${res.status}`, errText);
      }
    } catch (e) {
      console.warn('[step2] user_profiles 실패:', e.message);
    }
  })();
})();
