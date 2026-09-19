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

  const VERSION = 'v0.0.6';

  // ---- 상수 -----------------------------------------------------------
  // 사람이 페이지 넘기는 속도와 비슷하게: 0.8~1.2초 사이 랜덤 대기 (평균 1초)
  const DELAY_MIN_MS = 800;
  const DELAY_MAX_MS = 1200;
  const randomDelay = () => DELAY_MIN_MS + Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS);
  // clflg 램프는 NO PLAY에도 붙으므로, 200 응답인데 0차트면 사실상 장애 신호다.
  const EMPTY_CHART_RETRY_CYCLE_DELAYS_MS = [3000, 6000, 12000, 24000];
  const EMPTY_CHART_RETRY_CYCLE_DELAY_MAX_MS = 30000;
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

  // 파싱된 차트를 state 에 누적한다. 같은 차트가 여러 시리즈에 반복되므로 EX 우선, 동점이면 램프를 보존한다.
  function mergeParsedCharts(state, chartIndexByKey, parsed) {
    let added = 0;
    for (const ch of parsed.charts) {
      const k = ch.title + '|' + ch.diff;
      const previousIndex = chartIndexByKey.get(k);
      if (previousIndex == null) {
        chartIndexByKey.set(k, state.charts.length);
        state.charts.push(ch);
        added++;
        continue;
      }
      const previous = state.charts[previousIndex];
      const newEx = ch.exScore || 0;
      const previousEx = previous.exScore || 0;
      const newLamp = ch.lampNum || 0;
      const previousLamp = previous.lampNum || 0;
      // 전체 시리즈에 같은 차트가 반복될 수 있다. EX 우선, 동점이면 더 높은 램프를 보존한다.
      if (newEx > previousEx || (newEx === previousEx && newLamp > previousLamp)) {
        state.charts[previousIndex] = ch;
      }
    }
    return added;
  }

  async function collectBySeries(ictx, state) {
    const list = ictx.seriesList;     // 수집할 list 값(0~32) 배열 (collectCharts 에서 정렬·검증)
    const total = list.length;
    const chartIndexByKey = new Map();
    const pending = [];
    for (let i = 0; i < total; i++) {
      const sn = list[i];             // eamuse list value (0~32)
      const sd = sn + 1;              // series_no (1~33)
      ictx.updateProgress(`시리즈 ${sd} 요청 중... (${i + 1}/${total})`, (i / total) * 95);
      const result = await fetchSeriesOnce(ictx, sn);
      let parsed = result.parsed;
      if (!parsed) {
        if (result.reason === 'http') {
          if (i === 0) {
            console.error(`[eagateFetch] 첫 시리즈 fetch 실패: HTTP ${result.status}`);
            ictx.updateProgress(`시리즈 페이지 HTTP ${result.status} 에러`, 95);
            ictx.alertFn(`시리즈 페이지를 가져오지 못했어요 (HTTP ${result.status}).\n로그인 상태인지 확인해주세요.`);
            return false;
          }
          console.warn(`[eagateFetch] 시리즈 ${sd} HTTP ${result.status} — skip`);
        } else {
          if (i === 0) {
            console.error('[eagateFetch] 첫 시리즈 fetch 실패:', result.error);
            ictx.updateProgress(`시리즈 페이지 fetch 실패: ${result.error.message}`, 95);
            ictx.alertFn(`시리즈 페이지 fetch 실패: ${result.error.message}`);
            return false;
          }
          console.warn(`[eagateFetch] 시리즈 ${sd} fetch 실패: ${result.error.message} — skip`);
        }
      }
      if (!parsed) continue;
      if (parsed.charts.length === 0) {
        console.warn(`[eagateFetch] 시리즈 ${sd} 0차트 — 재시도 pending에 추가`);
        pending.push({ sn });
      } else {
        const added = mergeParsedCharts(state, chartIndexByKey, parsed);
        state.pageCount++;
        console.log(`[eagateFetch] 시리즈 ${sd} (${i + 1}/${total}): ${parsed.charts.length}차트 / 신규 ${added} (누적 ${state.charts.length})`);
        ictx.updateProgress(
          `시리즈 ${sd}: 신규 ${added}차트 (누적 ${state.charts.length})`,
          ((i + 1) / total) * 95,
        );
      }
      // 사람처럼 시리즈 사이에 대기 (마지막 시리즈 뒤 생략)
      if (i < total - 1) {
        await new Promise((r) => setTimeout(r, Math.round(randomDelay())));
      }
    }
    if (state.charts.length === 0) {
      ictx.alertFn('모든 시리즈에서 곡을 못 찾았어요. 로그인 상태가 아니거나 페이지 구조가 변경됐을 수 있습니다.');
      return false;
    }
    for (let cycle = 1; pending.length > 0 && cycle <= EMPTY_CHART_RETRY_MAX_CYCLES; cycle++) {
      const waitMs = EMPTY_CHART_RETRY_CYCLE_DELAYS_MS[cycle - 1] || EMPTY_CHART_RETRY_CYCLE_DELAY_MAX_MS;
      console.warn(`[eagateFetch] 0차트 재시도 사이클 ${cycle}/${EMPTY_CHART_RETRY_MAX_CYCLES} 시작 전: pending ${pending.length}개 / ${waitMs / 1000}초 대기`);
      ictx.updateProgress(`0차트 재시도 사이클 ${cycle}/${EMPTY_CHART_RETRY_MAX_CYCLES} 시작: pending ${pending.length}개 (${waitMs / 1000}초 대기)`, 95);
      await new Promise((r) => setTimeout(r, waitMs));
      for (let p = pending.length - 1; p >= 0; p--) {
        const { sn } = pending[p];
        const sd = sn + 1;
        console.warn(`[eagateFetch] 0차트 재시도 사이클 ${cycle}/${EMPTY_CHART_RETRY_MAX_CYCLES} 진행: 시리즈 ${sd}, pending ${pending.length}개`);
        ictx.updateProgress(`0차트 재시도 사이클 ${cycle}/${EMPTY_CHART_RETRY_MAX_CYCLES}: 시리즈 ${sd} 요청 중... (pending ${pending.length}개)`, 95);
        const result = await fetchSeriesOnce(ictx, sn);
        const parsed = result.parsed;
        if (!parsed) {
          // 재시도 사이클은 1차 패스가 이미 성공한 뒤다(누적 차트 > 0) — 로그인 문제일 수 없다.
          //   여기서 전체를 중단하지 않고 다음 사이클에서 다시 시도한다.
          if (result.reason === 'http') {
            console.warn(`[eagateFetch] 시리즈 ${sd} HTTP ${result.status} — 이번 사이클만 skip`);
          } else {
            console.warn(`[eagateFetch] 시리즈 ${sd} fetch 실패: ${result.error.message} — 이번 사이클만 skip`);
          }
        }
        if (parsed && parsed.charts.length > 0) {
          const added = mergeParsedCharts(state, chartIndexByKey, parsed);
          state.pageCount++;
          pending.splice(p, 1);
          console.log(`[eagateFetch] 시리즈 ${sd} (재시도 사이클 ${cycle}/${EMPTY_CHART_RETRY_MAX_CYCLES}): ${parsed.charts.length}차트 / 신규 ${added} (누적 ${state.charts.length})`);
          ictx.updateProgress(`0차트 재시도 사이클 ${cycle}/${EMPTY_CHART_RETRY_MAX_CYCLES}: 시리즈 ${sd} 성공 (pending ${pending.length}개)`, 95);
        }
        if (p > 0) {
          await new Promise((r) => setTimeout(r, Math.round(randomDelay())));
        }
      }
    }
    if (pending.length > 0) {
      const failedSeriesNos = pending.map(({ sn }) => sn + 1).sort((a, b) => a - b);
      console.warn(`[eagateFetch] 0차트 재시도 ${EMPTY_CHART_RETRY_MAX_CYCLES}사이클 소진: 시리즈 ${failedSeriesNos.join(', ')}`);
      ictx.alertFn(`다음 시리즈에서 차트를 가져오지 못했어요 (0차트): ${failedSeriesNos.join(', ')}.\n잠시 후 다시 시도해 주세요.`);
      return false;
    }
    console.log(`[eagateFetch] 시리즈 ${total}개 합산: ${state.pageCount}회 / ${state.charts.length}차트 파싱 완료`);
    return true;
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

    const ictx = { SERIES_URL, style, isRival, rivalToken, updateProgress, alertFn, seriesList };
    const state = { charts: [], pageCount: 0 };
    const ok = await collectBySeries(ictx, state);
    return { ok, charts: state.charts, pageCount: state.pageCount, fetchMode: 'series' };
  }

  window.OhsorryEagateFetch = { VERSION, collectCharts };
})();
