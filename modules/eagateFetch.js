// eagateFetch.js — eagate djdata 시리즈 페이지 fetch 모듈 (v0.0.3)
//
// p.eagate.573.jp 의 본인 / 라이벌 점수 데이터를 series.html 시리즈 폴더 단위로 수집.
//   [2026-06-16] level(difficulty.html) 모드 폐기 — series 단일. 시리즈 폴더가 seriesNo 를 주므로
//   dbConn 의 song_id / textage_song_id / series_no 매칭이 정확.
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

  const VERSION = 'v0.0.3';

  // ---- 상수 -----------------------------------------------------------
  // 사람이 페이지 넘기는 속도와 비슷하게: 0.8~1.2초 사이 랜덤 대기 (평균 1초)
  const DELAY_MIN_MS = 800;
  const DELAY_MAX_MS = 1200;
  const randomDelay = () => DELAY_MIN_MS + Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS);

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

  async function collectBySeries(ictx, state) {
    const list = ictx.seriesList;     // 수집할 list 값(0~32) 배열 (collectCharts 에서 정렬·검증)
    const total = list.length;
    const seenChartKey = new Set();
    for (let i = 0; i < total; i++) {
      const sn = list[i];             // eamuse list value (0~32)
      const sd = sn + 1;              // series_no (1~33)
      ictx.updateProgress(`시리즈 ${sd} 요청 중... (${i + 1}/${total})`, (i / total) * 95);
      let parsed;
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
        if (!res.ok) {
          if (i === 0) {
            console.error(`[eagateFetch] 첫 시리즈 fetch 실패: HTTP ${res.status}`);
            ictx.updateProgress(`시리즈 페이지 HTTP ${res.status} 에러`, 95);
            ictx.alertFn(`시리즈 페이지를 가져오지 못했어요 (HTTP ${res.status}).\n로그인 상태인지 확인해주세요.`);
            return false;
          }
          console.warn(`[eagateFetch] 시리즈 ${sd} HTTP ${res.status} — skip`);
          continue;
        }
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        // eamuse list value (sn = 0~32) → series_no (sn + 1 = 1~33). ohSorryWeb series-name.json 키와 일치.
        parsed = parseSeriesDoc(doc, sn + 1);
      } catch (e) {
        if (i === 0) {
          console.error('[eagateFetch] 첫 시리즈 fetch 실패:', e);
          ictx.updateProgress(`시리즈 페이지 fetch 실패: ${e.message}`, 95);
          ictx.alertFn(`시리즈 페이지 fetch 실패: ${e.message}`);
          return false;
        }
        console.warn(`[eagateFetch] 시리즈 ${sd} fetch 실패: ${e.message} — skip`);
        continue;
      }
      let added = 0;
      for (const ch of parsed.charts) {
        const k = ch.title + '|' + ch.diff;
        if (seenChartKey.has(k)) continue;
        seenChartKey.add(k);
        state.charts.push(ch);
        added++;
      }
      state.pageCount++;
      console.log(`[eagateFetch] 시리즈 ${sd} (${i + 1}/${total}): ${parsed.charts.length}차트 / 신규 ${added} (누적 ${state.charts.length})`);
      ictx.updateProgress(
        `시리즈 ${sd}: 신규 ${added}차트 (누적 ${state.charts.length})`,
        ((i + 1) / total) * 95,
      );
      if (i === 0 && state.charts.length === 0) {
        ictx.alertFn('첫 시리즈에서 곡을 못 찾았어요. 로그인 상태가 아니거나 페이지 구조가 변경됐을 수 있습니다.');
        return false;
      }
      // 사람처럼 시리즈 사이에 대기 (마지막 시리즈 뒤 생략)
      if (i < total - 1) {
        await new Promise((r) => setTimeout(r, Math.round(randomDelay())));
      }
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
      ? Array.from(new Set(c.seriesList.map(Number).filter((n) => n >= 0 && n <= 32))).sort((a, b) => a - b)
      : Array.from({ length: 33 }, (_, i) => i);

    const SERIES_URL = `https://p.eagate.573.jp/game/2dx/${SERIES}/djdata/music/series.html`;
    console.log(`[eagateFetch] 시리즈 ${seriesList.length}개 / ${style === '1' ? 'DP' : 'SP'}${isRival ? ' (라이벌)' : ''} 시작`);

    const ictx = { SERIES_URL, style, isRival, rivalToken, updateProgress, alertFn, seriesList };
    const state = { charts: [], pageCount: 0 };
    const ok = await collectBySeries(ictx, state);
    return { ok, charts: state.charts, pageCount: state.pageCount, fetchMode: 'series' };
  }

  window.OhsorryEagateFetch = { VERSION, collectCharts };
})();
