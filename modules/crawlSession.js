(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OhsorryCrawlSession = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SERIES_CONCURRENCY = 2;
  const NEW_LIMIT_PER_OLD_SERIES = 10;
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
    const series = sorted.map((seriesNo) => ({ seriesNo, ...state.get(seriesNo), completed: state.get(seriesNo).status === 'ok' }));
    return { series, charts: series.flatMap((item) => item.charts), completed: series.every((item) => item.completed) };
  }

  function defaultSleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  function resolveObservation(row, songs, commonKey, exceptions) {
    const observation = { ...row, rawKey: [row.seriesNo, row.title, row.diff, row.playStyle] };
    if (!Array.isArray(songs)) return { status: 'error', observation, songId: null, error: 'songs-unavailable' };
    if (typeof commonKey !== 'function') throw new TypeError('commonKey must be a function');

    let candidates = songs.filter((song) => song && song.series_no === row.seriesNo && commonKey(song.title) === commonKey(row.title));
    if (candidates.length === 1) return { status: 'matched', observation, songId: candidates[0].song_id };
    if (candidates.length > 1) {
      const acCandidates = candidates.filter((song) => (Number(song.ac) & 1) !== 0);
      candidates = acCandidates;
      if (candidates.length === 1) return { status: 'matched', observation, songId: candidates[0].song_id };
      if (candidates.length > 1 && row.diff === 'LEGGENDARIA') {
        const legenCandidates = candidates.filter((song) => (Number(song.legen) & 1) !== 0);
        if (legenCandidates.length === 1) return { status: 'matched', observation, songId: legenCandidates[0].song_id };
        candidates = legenCandidates;
      }
    }
    if (candidates.length > 1 && Array.isArray(exceptions)) {
      const matches = exceptions.filter((entry) => entry && entry.seriesNo === row.seriesNo && entry.sourceTitle === row.title &&
        candidates.some((song) => song.song_id === entry.songId));
      if (matches.length === 1) return { status: 'matched', observation, songId: matches[0].songId };
    }
    return candidates.length > 1
      ? { status: 'unresolved', observation, songId: null, reason: 'ambiguous-existing-candidates' }
      : { status: 'unmatched', observation, songId: null };
  }

  function finalizeIdentity(observations, coverage, commonKey, aliasTitle) {
    if (typeof commonKey !== 'function') throw new TypeError('commonKey must be a function');
    if (typeof aliasTitle !== 'function') throw new TypeError('aliasTitle must be a function');
    const required = coverage && (coverage.requiredSeries || coverage.requiredSeriesNos);
    const succeeded = coverage && (coverage.succeededSeries || coverage.successfulSeries || coverage.succeededSeriesNos);
    if (!Array.isArray(required) || !Array.isArray(succeeded)) throw new TypeError('coverage must include requiredSeries and succeededSeries');
    const successSet = new Set(succeeded);
    const complete = required.every((n) => successSet.has(n));
    const rows = (Array.isArray(observations) ? observations : []).map((item) => ({ ...item }));
    const confirmed = new Map();
    for (const item of rows) {
      if (item.status !== 'matched' || item.songId == null) continue;
      const key = commonKey(aliasTitle(item.observation ? item.observation.title : item.title));
      if (!confirmed.has(key)) confirmed.set(key, []);
      confirmed.get(key).push({ songId: item.songId, seriesNo: (item.observation || item).seriesNo });
    }
    const newBySeries = new Map();
    for (const item of rows) {
      if (item.status !== 'unmatched') continue;
      const row = item.observation || item;
      const key = commonKey(aliasTitle(row.title));
      const ids = new Set((confirmed.get(key) || []).filter((entry) => entry.seriesNo !== row.seriesNo).map((entry) => entry.songId));
      if (ids && ids.size === 1) {
        item.status = 'matched'; item.songId = [...ids][0]; item.identityResolution = 'cross-series';
      } else if (ids && ids.size > 1) {
        item.status = 'unresolved'; item.songId = null; item.reason = 'multiple-confirmed-song-ids';
      } else if (!complete) {
        item.status = 'deferred'; item.songId = null; item.reason = 'incomplete-series-coverage';
      } else {
        item.status = 'new'; item.songId = null;
        item.aliasTitle = aliasTitle(row.title);
        const version = row.playedVersion ?? row.gameVersion;
        const keySeries = `${String(version)}:${String(row.seriesNo)}`;
        if (!newBySeries.has(keySeries)) newBySeries.set(keySeries, []);
        newBySeries.get(keySeries).push({ item, row, version });
      }
    }
    for (const entries of newBySeries.values()) {
      const { version } = entries[0];
      const seriesNo = entries[0].row.seriesNo;
      if (Number(seriesNo) === Number(version)) continue;
      const titles = new Set(entries.map(({ item }) => item.aliasTitle));
      if (titles.size > NEW_LIMIT_PER_OLD_SERIES) {
        for (const { item } of entries) {
          item.status = 'deferred'; item.reason = 'old-series-new-limit-exceeded';
          item.limit = { seriesNo, count: titles.size, maximum: NEW_LIMIT_PER_OLD_SERIES };
        }
      }
    }
    return { observations: rows, coverage: { requiredSeries: [...required], succeededSeries: [...succeeded], failedSeries: required.filter((n) => !successSet.has(n)), complete } };
  }

  return Object.freeze({
    SERIES_CONCURRENCY,
    NEW_LIMIT_PER_OLD_SERIES,
    EMPTY_PAUSE_MS: Object.freeze(EMPTY_PAUSE_MS),
    runQueue(options) { return runQueueInternal(options, SERIES_CONCURRENCY); },
    _runQueueForTest(options, slots) { return runQueueInternal(options, slots); },
    resolveObservation,
    finalizeIdentity,
  });
});
