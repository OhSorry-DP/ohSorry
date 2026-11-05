(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OhsorryCrawlSession = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SERIES_CONCURRENCY = 2;
  const EMPTY_PAUSE_MS = [2000, 4000, 8000];

  async function runQueueInternal(options, slots) {
    const { seriesNos, fetchSeries, retryPolicy = {}, clock = Date.now, sleep = defaultSleep, betweenRequestsMs } = options;
    if (typeof betweenRequestsMs !== 'function') throw new TypeError('betweenRequestsMs must be a function');
    const sorted = [...new Set(seriesNos)].sort((a, b) => a - b);
    const state = new Map(sorted.map((n) => [n, { status: 'pending', charts: [], error: null }]));
    let pauseUntil = 0;
    let zeroStreak = 0;
    const waitForChange = async (deadline) => {
      const remaining = Math.max(0, deadline - clock());
      if (!remaining) return;
      await sleep(remaining);
    };
    const processResult = (n, result, isRetry) => {
      if (result && result.status === 'ok') {
        const charts = Array.isArray(result.charts) ? result.charts : [];
        if (charts.length) {
          state.set(n, { status: 'ok', charts, error: null });
          zeroStreak = 0;
        } else {
          state.set(n, { status: 'pending', charts: [], error: null });
          const delay = EMPTY_PAUSE_MS[Math.min(zeroStreak, EMPTY_PAUSE_MS.length - 1)];
          zeroStreak += 1;
          pauseUntil = Math.max(pauseUntil, clock() + delay);
        }
      } else {
        const error = result && result.error;
        const previous = state.get(n);
        state.set(n, { status: isRetry ? 'pending' : 'error', charts: [], error: error || (isRetry ? previous.error : null) });
      }
    };
    const runPass = async (series, isRetry) => {
      let nextIndex = 0;
      const workers = Array.from({ length: Math.min(slots, series.length) }, async () => {
        while (nextIndex < series.length) {
          while (clock() < pauseUntil) await waitForChange(pauseUntil);
          if (nextIndex >= series.length) break;
          const n = series[nextIndex++];
          let result;
          try { result = await fetchSeries(n); }
          catch (error) { result = { status: 'error', error }; }
          processResult(n, result, isRetry);
          if (nextIndex < series.length) {
            const delay = Number(betweenRequestsMs());
            if (Number.isFinite(delay) && delay > 0) await sleep(delay);
          }
        }
      });
      await Promise.all(workers);
    };
    await runPass(sorted, false);

    const maxCycles = Math.max(0, Number(retryPolicy.maxCycles) || 0);
    const delays = Array.isArray(retryPolicy.delaysMs) ? retryPolicy.delaysMs : [];
    const cap = Number.isFinite(retryPolicy.capMs) ? retryPolicy.capMs : Infinity;
    for (let cycle = 0; cycle < maxCycles; cycle += 1) {
      const pending = sorted.filter((n) => state.get(n).status === 'pending');
      if (!pending.length) break;
      const delay = Math.min(cap, Math.max(0, Number(delays[Math.min(cycle, delays.length - 1)]) || 0));
      const cycleDeadline = clock() + delay;
      await waitForChange(Math.max(cycleDeadline, pauseUntil));
      while (clock() < pauseUntil) await waitForChange(pauseUntil);
      await runPass(pending, true);
    }
    const series = sorted.map((seriesNo) => ({ seriesNo, ...state.get(seriesNo), completed: state.get(seriesNo).status !== 'pending' }));
    return { series, charts: series.flatMap((item) => item.charts), completed: series.every((item) => item.completed) };
  }

  function defaultSleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  return Object.freeze({
    SERIES_CONCURRENCY,
    EMPTY_PAUSE_MS: Object.freeze(EMPTY_PAUSE_MS),
    runQueue(options) { return runQueueInternal(options, SERIES_CONCURRENCY); },
    _runQueueForTest(options, slots) { return runQueueInternal(options, slots); },
  });
});
