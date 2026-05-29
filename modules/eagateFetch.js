// eagateFetch.js — eagate djdata 페이지 fetch 모듈 (v0.0.1)
//
// p.eagate.573.jp 의 본인 / 라이벌 점수 데이터를 두 모드로 수집.
//   - level   : difficulty.html 의 LEVEL 별 페이지 (offset=0,50,100,...) 순회
//   - series  : series.html 에 list=0..32 POST (시리즈 폴더 전곡)
//
// ohSorry 본체 wrapper 가 dbData 없을 때 (= 본인 분석 모드) 만 fetch. DB 모드 (ohSorryWeb
// 게스트 페이지 / INFOhSorry 등) 는 이 모듈을 로드하지 않음 — 다운로드량 절감.
//
// 사용:
//   const r = await window.OhsorryEagateFetch.collectCharts({
//     fetchMode: 'level' | 'series',
//     levels: [12, 11],                  // level 모드 — 게임레벨 배열 (없으면 [12,11])
//     series: '33',                      // 시즌 (기본 '33')
//     style: '1',                        // '0'=SP / '1'=DP (기본 '1')
//     disp: '1',                         // (기본 '1')
//     isRival: false,                    // 라이벌 페이지 여부 (boolean)
//     rivalToken: null,                  // 라이벌 토큰 (rival URL 파라미터)
//     updateProgress: (text, pct) => {}, // 진행도 콜백 (생략 가능)
//     alertFn: (msg) => alert(msg),      // 에러 alert 콜백 (생략 시 window.alert)
//   });
//   // r = { ok: boolean, charts: [...], pageCount: number, fetchMode: 'level'|'series' }
// ============================================================

(function () {
  'use strict';

  const VERSION = 'v0.0.1';

  // ---- 상수 -----------------------------------------------------------
  const STEP = 50;
  const MAX_PAGES = 30;  // 무한 루프 방어
  // 사람이 페이지 넘기는 속도와 비슷하게: 0.8~1.2초 사이 랜덤 대기 (평균 1초)
  const DELAY_MIN_MS = 800;
  const DELAY_MAX_MS = 1200;
  const randomDelay = () => DELAY_MIN_MS + Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS);

  const LAMP_NAMES = {
    0: 'NO PLAY', 1: 'FAILED',  2: 'ASSIST',    3: 'EASY',
    4: 'CLEAR',   5: 'HARD',    6: 'EX HARD',   7: 'FULL COMBO',
  };

  // ---- parseDoc — difficulty.html 한 페이지 파싱 (level 모드) ---------
  function parseDoc(doc) {
    const out = { charts: [], hasNext: false };
    // 곡 목록은 <div class="series-difficulty"> 안의 table
    const rows = doc.querySelectorAll('div.series-difficulty table tr');
    rows.forEach((row) => {
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
      // 미스 카운트 (BP/MISS) — score cell 또는 다른 td 어디에든
      let missCount = null;
      const allText = Array.from(tds).map((td) => td.textContent || '').join(' ');
      const missMatch = allText.match(/(?:BP|MISS|BAD)[:\s]*(\d+)/i);
      if (missMatch) missCount = parseInt(missMatch[1], 10);
      // 클리어 램프
      const lampImg = tds[4].querySelector('img');
      if (!lampImg) return;
      const m = (lampImg.getAttribute('src') || lampImg.src || '').match(/clflg(\d+)\.gif/);
      if (!m) return;
      const lampNum = parseInt(m[1], 10);
      out.charts.push({
        title,
        diff: chartType,         // 'BEGINNER' | 'NORMAL' | 'HYPER' | 'ANOTHER' | 'LEGGENDARIA'
        djLevel,
        exScore,
        pgreat,
        great,
        missCount,
        lampNum,
        lamp: LAMP_NAMES[lampNum] || null,
        gameLevel: null,         // fetchOneLevel 가 채움
      });
    });
    // 다음 페이지 존재 여부 — "次のページ" / 페이지네이션 a 가 있는지
    const next = doc.querySelector('a.next, a[rel="next"], .pager a:last-child');
    out.hasNext = !!(next && /next|次/i.test(next.textContent || next.className || ''));
    // 50개 다 찼으면 다음 페이지 가능성 — 보수적으로 true
    if (!out.hasNext && out.charts.length >= STEP) out.hasNext = true;
    return out;
  }

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
        const sm = celText.match(/(\d+)\((\d+)\/(\d+)\)/);
        let exScore = 0, pgreat = 0, great = 0;
        if (sm) {
          exScore = parseInt(sm[1], 10);
          pgreat = parseInt(sm[2], 10);
          great = parseInt(sm[3], 10);
        } else {
          const m2 = celText.match(/(\d+)/);
          if (m2) exScore = parseInt(m2[1], 10);
        }
        const missMatch = celText.match(/(?:BP|MISS|BAD)[:\s]*(\d+)/i);
        const missCount = missMatch ? parseInt(missMatch[1], 10) : null;
        out.charts.push({
          title,
          diff: DIFF_NAMES[idx],
          djLevel,
          exScore,
          pgreat,
          great,
          missCount,
          lampNum,
          lamp: LAMP_NAMES[lampNum] || null,
          gameLevel: null,  // 시리즈 페이지엔 레벨 정보 없음 — textage 로 역추정
          seriesNo: typeof seriesNo === 'number' ? seriesNo : null,  // 이 차트가 어느 시리즈 폴더에서 나왔는지 (dbConn 의 series_no 갱신용)
        });
      });
    });
    return out;
  }

  // ---- fetchOneLevel — 한 LEVEL 의 전 페이지 fetch ---------------------
  // state.charts 에 push, state.pageCount 증가. 실패 시 false 반환.
  async function fetchOneLevel(ictx, lvDifficult, lvLabel, basePctStart, basePctEnd, state) {
    let lvOffset = 0;
    let lvPageCount = 0;
    const lvSpan = basePctEnd - basePctStart;
    const pctOf = (frac) => Math.min(basePctEnd, basePctStart + lvSpan * Math.max(0, Math.min(1, frac)));

    // 첫 페이지 (offset=0)
    ictx.updateProgress(`LEVEL ${lvLabel} page 1 (offset=0) 요청 중...`, pctOf(0.02));
    let firstParse;
    try {
      const rivalQ = (ictx.isRival && ictx.rivalToken) ? `&rival=${encodeURIComponent(ictx.rivalToken)}` : '';
      const firstUrl = `${ictx.BASE_URL}?difficult=${lvDifficult}&style=${ictx.style}&disp=${ictx.disp}&offset=0${rivalQ}`;
      const res = await fetch(firstUrl, { credentials: 'include' });
      if (!res.ok) {
        console.error(`[eagateFetch] LEVEL ${lvLabel} 첫 페이지 fetch 실패: HTTP ${res.status}`);
        ictx.updateProgress(`LEVEL ${lvLabel} 첫 페이지 HTTP ${res.status} 에러`, pctOf(1));
        ictx.alertFn(`LEVEL ${lvLabel} 첫 페이지를 가져오지 못했어요 (HTTP ${res.status}).\n로그인 상태인지 확인해주세요.`);
        return false;
      }
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      firstParse = parseDoc(doc);
    } catch (e) {
      console.error(`[eagateFetch] LEVEL ${lvLabel} 첫 페이지 fetch 실패:`, e);
      ictx.updateProgress(`LEVEL ${lvLabel} 첫 페이지 fetch 실패: ${e.message}`, pctOf(1));
      ictx.alertFn(`LEVEL ${lvLabel} 첫 페이지 fetch 실패: ${e.message}`);
      return false;
    }
    firstParse.charts.forEach((c) => { c.gameLevel = lvLabel; });
    state.charts.push(...firstParse.charts);
    lvPageCount++;
    state.pageCount++;
    console.log(`[eagateFetch] LEVEL ${lvLabel} page ${lvPageCount} (offset=0): ${firstParse.charts.length}곡`);
    ictx.updateProgress(`LEVEL ${lvLabel} page ${lvPageCount} (offset=0): ${firstParse.charts.length}곡`, pctOf(0.08));
    if (firstParse.charts.length === 0) {
      // 첫 LEVEL (보통 12) 의 첫 페이지가 비면 로그인 / 페이지 구조 의심
      if (lvLabel === ictx.LEVELS_TO_FETCH[0].label) {
        ictx.alertFn('첫 페이지에서 곡을 못 찾았어요. 로그인 상태가 아니거나 페이지 구조가 변경됐을 수 있습니다.');
        return false;
      }
      console.log(`[eagateFetch] LEVEL ${lvLabel} 데이터 없음 — skip`);
      return true;
    }
    let hasNext = firstParse.hasNext;
    lvOffset = STEP;

    while (hasNext && lvPageCount < MAX_PAGES) {
      // 사람처럼 페이지 사이에 대기
      const wait = Math.round(randomDelay());
      const waitStartTs = Date.now();
      while (Date.now() - waitStartTs < wait) {
        const remain = Math.ceil((wait - (Date.now() - waitStartTs)) / 1000);
        ictx.updateProgress(
          `LEVEL ${lvLabel} page ${lvPageCount + 1} (offset=${lvOffset}) 다음 요청까지 ${remain}초...`,
          pctOf(lvPageCount / MAX_PAGES),
        );
        await new Promise((r) => setTimeout(r, 250));
      }

      const rivalQ2 = (ictx.isRival && ictx.rivalToken) ? `&rival=${encodeURIComponent(ictx.rivalToken)}` : '';
      const url = `${ictx.currentURL.origin}${ictx.currentURL.pathname}?difficult=${lvDifficult}&style=${ictx.style}&disp=${ictx.disp}&offset=${lvOffset}${rivalQ2}`;
      try {
        ictx.updateProgress(
          `LEVEL ${lvLabel} page ${lvPageCount + 1} (offset=${lvOffset}) 요청 중...`,
          pctOf((lvPageCount + 0.5) / MAX_PAGES),
        );
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) {
          console.warn(`[eagateFetch] LEVEL ${lvLabel} HTTP ${res.status} at offset=${lvOffset}, 중단`);
          ictx.updateProgress(`LEVEL ${lvLabel} HTTP ${res.status} 에러로 중단`, pctOf(1));
          break;
        }
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const parsed = parseDoc(doc);
        parsed.charts.forEach((c) => { c.gameLevel = lvLabel; });
        state.charts.push(...parsed.charts);
        lvPageCount++;
        state.pageCount++;
        console.log(`[eagateFetch] LEVEL ${lvLabel} page ${lvPageCount} (offset=${lvOffset}): ${parsed.charts.length}곡`);
        ictx.updateProgress(
          `LEVEL ${lvLabel} page ${lvPageCount} (offset=${lvOffset}): ${parsed.charts.length}곡 (총 ${state.charts.length}곡)`,
          pctOf((lvPageCount + 1) / MAX_PAGES),
        );
        if (parsed.charts.length === 0) break;
        hasNext = parsed.hasNext;
        lvOffset += STEP;
      } catch (e) {
        console.error(`[eagateFetch] LEVEL ${lvLabel} fetch 실패 at offset=${lvOffset}:`, e);
        ictx.updateProgress(`LEVEL ${lvLabel} fetch 실패: ${e.message}`, pctOf(1));
        break;
      }
    }
    console.log(`[eagateFetch] LEVEL ${lvLabel} 완료: ${lvPageCount}페이지`);
    return true;
  }

  // ---- collectByLevel — LEVELS_TO_FETCH 순차 fetch -------------------
  async function collectByLevel(ictx, state) {
    if (ictx.LEVELS_TO_FETCH.length === 0) {
      ictx.alertFn('가져올 레벨이 지정되지 않았습니다.');
      return false;
    }
    const SPAN = 95 / ictx.LEVELS_TO_FETCH.length;
    for (let i = 0; i < ictx.LEVELS_TO_FETCH.length; i++) {
      const { difficult: lvD, label: lvL } = ictx.LEVELS_TO_FETCH[i];
      const ok = await fetchOneLevel(ictx, lvD, lvL, i * SPAN, (i + 1) * SPAN, state);
      if (!ok) return false;  // 첫 LEVEL 실패하면 중단
    }
    console.log(`[eagateFetch] 전 LEVEL 합산: ${state.pageCount}페이지 / ${state.charts.length}곡 파싱 완료`);
    return true;
  }

  // ---- collectBySeries — series.html 에 list=0..32 POST ---------------
  async function collectBySeries(ictx, state) {
    const SERIES_COUNT = 33;
    const seenChartKey = new Set();
    for (let sn = 0; sn < SERIES_COUNT; sn++) {
      const sd = sn + 1;
      ictx.updateProgress(`시리즈 ${sd}/${SERIES_COUNT} 요청 중...`, (sn / SERIES_COUNT) * 95);
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
          if (sn === 0) {
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
        // eamuse list value (sn = 0~32) → 새 series_no 매핑 (sn + 1 = 1~33).
        //   ohSorryWeb 의 series-name.json 키와 일치 (1=1st&substream, 33=Sparkle Shower 등).
        parsed = parseSeriesDoc(doc, sn + 1);
      } catch (e) {
        if (sn === 0) {
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
      console.log(`[eagateFetch] 시리즈 ${sd}/${SERIES_COUNT}: ${parsed.charts.length}차트 / 신규 ${added} (누적 ${state.charts.length})`);
      ictx.updateProgress(
        `시리즈 ${sd}/${SERIES_COUNT}: 신규 ${added}차트 (누적 ${state.charts.length})`,
        ((sn + 1) / SERIES_COUNT) * 95,
      );
      if (sn === 0 && state.charts.length === 0) {
        ictx.alertFn('첫 시리즈에서 곡을 못 찾았어요. 로그인 상태가 아니거나 페이지 구조가 변경됐을 수 있습니다.');
        return false;
      }
      // 사람처럼 시리즈 사이에 대기 (마지막 시리즈 뒤 생략)
      if (sn < SERIES_COUNT - 1) {
        await new Promise((r) => setTimeout(r, Math.round(randomDelay())));
      }
    }
    console.log(`[eagateFetch] 전 시리즈 합산: ${state.pageCount}회 / ${state.charts.length}차트 파싱 완료`);
    return true;
  }

  // ---- 공개 API --------------------------------------------------------
  async function collectCharts(ctx) {
    const c = ctx || {};
    const SERIES = c.series || '33';
    const style = c.style || '1';
    const disp = c.disp || '1';
    const fetchMode = c.fetchMode === 'series' ? 'series' : 'level';
    const isRival = !!c.isRival;
    const rivalToken = c.rivalToken || null;
    const updateProgress = typeof c.updateProgress === 'function' ? c.updateProgress : function () {};
    const alertFn = typeof c.alertFn === 'function' ? c.alertFn : function (m) { window.alert(m); };

    const requestedLevels = (Array.isArray(c.levels) && c.levels.length > 0)
      ? Array.from(new Set(c.levels.map(Number).filter((n) => n >= 1 && n <= 12))).sort((a, b) => b - a)
      : [12, 11];
    const LEVELS_TO_FETCH = requestedLevels.map((lv) => ({ difficult: String(lv - 1), label: lv }));
    const BASE_URL = isRival
      ? `https://p.eagate.573.jp/game/2dx/${SERIES}/djdata/music/difficulty_rival.html`
      : `https://p.eagate.573.jp/game/2dx/${SERIES}/djdata/music/difficulty.html`;
    const SERIES_URL = `https://p.eagate.573.jp/game/2dx/${SERIES}/djdata/music/series.html`;
    const currentURL = new URL(BASE_URL);

    if (fetchMode === 'series') {
      console.log(`[eagateFetch] 시리즈 폴더 전곡 / ${style === '1' ? 'DP' : 'SP'} 시작`);
    } else {
      console.log(`[eagateFetch] LEVEL ${LEVELS_TO_FETCH.map((l) => l.label).join(' + ')} / ${style === '1' ? 'DP' : 'SP'} 시작`);
    }

    const ictx = { BASE_URL, SERIES_URL, currentURL, style, disp, isRival, rivalToken, updateProgress, alertFn, LEVELS_TO_FETCH };
    const state = { charts: [], pageCount: 0 };

    const ok = fetchMode === 'series'
      ? await collectBySeries(ictx, state)
      : await collectByLevel(ictx, state);

    return { ok, charts: state.charts, pageCount: state.pageCount, fetchMode, LEVELS_TO_FETCH };
  }

  window.OhsorryEagateFetch = { VERSION, collectCharts };
})();
