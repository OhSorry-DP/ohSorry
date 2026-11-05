// eagateFetch.js — eagate djdata 시리즈 페이지 fetch 모듈 (v0.0.6)
//
// p.eagate.573.jp 의 본인 / 라이벌 점수 데이터를 series.html 시리즈 폴더 단위로 수집.
//   [2026-06-16] level(difficulty.html) 모드 폐기 — series 단일. 시리즈 폴더가 seriesNo 를 주므로
//   dbConn 의 song_id / textage_song_id / series_no 매칭이 정확.
//   [2026-09-19] 200 응답인데 0차트인 시리즈를 모아 전체 1차 패스 뒤 재시도 사이클(3·6·12·24초,
//   이후 30초 상한, 최대 10회)로 수집한다. 소진 시 부분 수집분으로 진행하지 않고 중단한다.
//
// 사용:
//   const r = await window.OhsorryEagateFetch.collectCharts({
//     seriesList: [32, 31, ...],         // 수집할 eamuse list 값(0~32) 배열. 생략 시 전체 33개 (series_no = list+1)
//     series: '33',                      // 시즌 (기본 '33')
//     style: '1',                        // '0'=SP / '1'=DP (기본 '1')
//     isRival: false,                    // 라이벌 페이지 여부 (boolean)
//     rivalToken: null,                  // 라이벌 토큰 (rival URL 파라미터)
//     updateProgress: (text, pct) => {}, // 진행도 콜백 (생략 가능)
//     alertFn: (msg) => alert(msg),      // 에러 alert 콜백 (생략 시 window.alert)
//   });
//   // r = { ok: boolean, charts: [...], pageCount: number, fetchMode: 'series' }
// ============================================================

(function () {
  'use strict';

  const VERSION = 'v0.0.9';

  // ---- 상수 -----------------------------------------------------------
  // 시리즈 페이지 간 0.8~1.5초 사이 랜덤 대기 (평균 1.15초)
  const DELAY_MIN_MS = 800;
  const DELAY_MAX_MS = 1500;
  const randomDelay = () => DELAY_MIN_MS + Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS);
  // clflg 램프는 NO PLAY에도 붙으므로, 200 응답인데 0차트면 사실상 장애 신호다.
  // 0차트 재시도 사이클 대기는 2→4→8초로 늘리고, 4사이클부터는 8초로 유지한다.
  const EMPTY_CHART_RETRY_CYCLE_DELAYS_MS = [2000, 4000, 8000];
  const EMPTY_CHART_RETRY_CYCLE_DELAY_MAX_MS = 8000;
  const EMPTY_CHART_RETRY_MAX_CYCLES = 10;

  const LAMP_NAMES = {
    0: 'NO PLAY', 1: 'FAILED',  2: 'ASSIST',    3: 'EASY',
    4: 'CLEAR',   5: 'HARD',    6: 'EX HARD',   7: 'FULL COMBO',
  };

  // ---- parseSeriesDoc — series.html 한 페이지 파싱 (series 모드) ------
  // series.html 응답의 <div class="series-all"> table 구조:
  //   곡 row 하나 = <td> 안에 <a class="music_info"> 곡명 + <div class="series-info">.
  //   series-info 안에 5개 <div class="score-cel"> (BEGINNER/NORMAL/HYPER/ANOTHER/LEGGENDARIA).
  // 곡 하나당 차트 5개를 만들되 — 시리즈 페이지엔 게임레벨(★) 정보가 없으므로 gameLevel=null.
  // seriesNo (선택) — 그 시리즈의 새 매핑 번호 (eamuse list value + 1, 1~33). chart entry 에 channel 채움.
  //   dbConn 이 score upsert 후 시리즈별 song_id 모아 bump_song_series RPC 로 songs.series_no 갱신.
  function parseSeriesDoc(doc, seriesNo) {
    const out = { charts: [] };
    const DIFF_NAMES = ['BEGINNER', 'NORMAL', 'HYPER', 'ANOTHER', 'LEGGENDARIA'];
    const rows = doc.querySelectorAll('div.series-all table tr');
    rows.forEach((row) => {
      const titleEl = row.querySelector('a.music_info');
      if (!titleEl) return;  // 시리즈명 <th> / "ALL" 행 등은 a.music_info 없음 → skip
      const title = titleEl.textContent.trim();
      const cels = row.querySelectorAll('div.series-info div.score-cel');
      cels.forEach((cel, idx) => {
        const lampImg = cel.querySelector('img[src*="clflg"]');
        if (!lampImg) return;
        const lampMatch = (lampImg.getAttribute('src') || lampImg.src || '').match(/clflg(\d+)\.gif/);
        if (!lampMatch) return;
        const lampNum = parseInt(lampMatch[1], 10);
        // 점수 / DJ LEVEL — cel 안에 텍스트 / img.
        const djLevelImg = cel.querySelector('img[src*=".gif"]:not([src*="clflg"])');
        let djLevel = null;
        if (djLevelImg) {
          const dm = (djLevelImg.getAttribute('src') || djLevelImg.src || '').match(/\/([A-F]+)\.gif/);
          if (dm) djLevel = dm[1];
        }
        const celText = cel.textContent || '';
        // EX 점수만 사용 — "1234(986/420)" 또는 단순 숫자. pgreat/great/missCount 는 업로드에 안 써서 미추출.
        const sm = celText.match(/(\d+)\((\d+)\/(\d+)\)/) || celText.match(/(\d+)/);
        const exScore = sm ? parseInt(sm[1], 10) : 0;
        out.charts.push({
          title,
          diff: DIFF_NAMES[idx],
          djLevel,
          exScore,
          lampNum,
          lamp: LAMP_NAMES[lampNum] || null,
          gameLevel: null,  // 시리즈 페이지엔 레벨 정보 없음 — textage 로 역추정
          seriesNo: typeof seriesNo === 'number' ? seriesNo : null,  // 이 차트가 어느 시리즈 폴더에서 나왔는지 (dbConn 의 series_no 갱신용)
        });
      });
    });
    return out;
  }

  // 한 시리즈를 요청해 파싱한다. 실패 처리는 호출부가 결정하도록 사유를 그대로 돌려준다.
  //   { parsed }              — 성공(0차트일 수도 있다)
  //   { parsed: null, reason: 'http',  status } — HTTP 비정상
  //   { parsed: null, reason: 'error', error }  — fetch/파싱 예외
  async function fetchSeriesOnce(ictx, sn) {
    try {
      const body = new URLSearchParams({
        list: String(sn),
        play_style: ictx.style,
        s: '1',
        rival: (ictx.isRival && ictx.rivalToken) ? ictx.rivalToken : '',
      });
      const res = await fetch(ictx.SERIES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        credentials: 'include',
      });
      if (!res.ok) return { parsed: null, reason: 'http', status: res.status };
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      // eamuse list value (sn = 0~32) → series_no (sn + 1 = 1~33). ohSorryWeb series-name.json 키와 일치.
      return { parsed: parseSeriesDoc(doc, sn + 1) };
    } catch (error) {
      return { parsed: null, reason: 'error', error };
    }
  }

  async function collectBySeries(ictx, state) {
    const session = window.OhsorryCrawlSession;
    const seriesNos = ictx.seriesList.map((list) => list + 1);
    const result = await session.runQueue({
      seriesNos,
      retryPolicy: { maxCycles: EMPTY_CHART_RETRY_MAX_CYCLES, delaysMs: EMPTY_CHART_RETRY_CYCLE_DELAYS_MS, capMs: EMPTY_CHART_RETRY_CYCLE_DELAY_MAX_MS },
      betweenRequestsMs: () => Math.round(randomDelay()),
      fetchSeries: async (seriesNo) => {
        const index = seriesNos.indexOf(seriesNo);
        const list = seriesNo - 1;
        ictx.updateProgress(`시리즈 ${seriesNo} 요청 중... (${index + 1}/${seriesNos.length})`, (index / seriesNos.length) * 95);
        const fetched = await fetchSeriesOnce(ictx, list);
        if (!fetched.parsed) return { status: 'error', error: fetched.reason === 'http' ? new Error(`HTTP ${fetched.status}`) : fetched.error };
        if (fetched.parsed.charts.length > 0) state.pageCount++;
        const observedAt = new Date().toISOString();
        const charts = fetched.parsed.charts.map((chart) => ({ ...chart, playStyle: ictx.style === '0' ? 0 : 1,
          playedVersion: ictx.playedVersion, observedAt }));
        return { status: 'ok', charts };
      },
    });
    state.series = result.series;
    state.charts = result.charts;
    state.observations = result.charts;
    const firstSeries = result.series[0];
    const firstFailure = firstSeries && firstSeries.status === 'error';
    const failedSeriesNos = result.series.filter((item) => !item.completed).map((item) => item.seriesNo);
    const ok = !firstFailure && state.charts.length > 0;
    if (firstFailure) {
      const message = firstSeries.error && firstSeries.error.message || String(firstSeries.error);
      ictx.updateProgress(`시리즈 페이지 fetch 실패: ${message}`, 95);
      ictx.alertFn(message.startsWith('HTTP ') ? `시리즈 페이지를 가져오지 못했어요 (${message}).\n로그인 상태인지 확인해주세요.` : `시리즈 페이지 fetch 실패: ${message}`);
    } else if (!state.charts.length) {
      ictx.alertFn('모든 시리즈에서 곡을 못 찾았어요. 로그인 상태가 아니거나 페이지 구조가 변경됐을 수 있습니다.');
    } else if (failedSeriesNos.length) {
      ictx.alertFn(`다음 시리즈는 이번에 못 읽었어요: ${failedSeriesNos.join(', ')}. 나머지는 저장해요.`);
    }
    console.log(`[eagateFetch] 시리즈 ${seriesNos.length}개 합산: ${state.pageCount}회 / ${state.charts.length}차트 파싱 완료`);
    return { ok, result };
  }

  // ---- 공개 API --------------------------------------------------------
  // series 모드 전용 (level 모드 폐기, 2026-06-16). series.html 에 list POST 로 시리즈 폴더 전곡 수집.
  //   c.seriesList: 수집할 eamuse list 값(0~32) 배열. 생략 시 전체 33개. (series_no = list+1)
  async function collectCharts(ctx) {
    const c = ctx || {};
    const SERIES = c.series || '33';
    const style = c.style || '1';
    const isRival = !!c.isRival;
    const rivalToken = c.rivalToken || null;
    const updateProgress = typeof c.updateProgress === 'function' ? c.updateProgress : function () {};
    const alertFn = typeof c.alertFn === 'function' ? c.alertFn : function (m) { window.alert(m); };

    // 수집할 시리즈 list 값(0~32). 유효값만 + 정렬(오름차순). 생략/빈값이면 전체.
    const seriesList = (Array.isArray(c.seriesList) && c.seriesList.length > 0)
      ? Array.from(new Set(c.seriesList.map(Number).filter((n) => n >= 0 && n <= Number(SERIES) - 1))).sort((a, b) => a - b)
      : Array.from({ length: Number(SERIES) }, (_, i) => i);

    const SERIES_URL = `https://p.eagate.573.jp/game/2dx/${SERIES}/djdata/music/series.html`;
    console.log(`[eagateFetch] 시리즈 ${seriesList.length}개 / ${style === '1' ? 'DP' : 'SP'}${isRival ? ' (라이벌)' : ''} 시작`);

    const ictx = { SERIES_URL, style, isRival, rivalToken, updateProgress, alertFn, seriesList, playedVersion: Number(SERIES) };
    const state = { charts: [], pageCount: 0 };
    const { ok, result } = await collectBySeries(ictx, state);
    return { ok, charts: state.charts, observations: state.observations, series: state.series,
      completed: result.completed, pageCount: state.pageCount, fetchMode: 'series' };
  }

  window.OhsorryEagateFetch = { VERSION, collectCharts };
})();
