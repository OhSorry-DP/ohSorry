(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OhsorryCrawlSession = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SERIES_CONCURRENCY = 2;
  const NEW_LIMIT_PER_OLD_SERIES = 10;
  const EMPTY_PAUSE_MS = [2000, 4000, 8000];
  const songIndexes = new WeakMap();
  const DIFF_MAP = Object.freeze({ BEGINNER: 0, NORMAL: 1, HYPER: 2, ANOTHER: 3, LEGGENDARIA: 4 });
  const LAMP_MAP = Object.freeze({ NP: 0, F: 1, AC: 2, EC: 3, NC: 4, HC: 5, EX: 6, FC: 7, PFC: 7,
    'NO PLAY': 0, FAILED: 1, ASSIST: 2, EASY: 3, CLEAR: 4, HARD: 5, 'EX HARD': 6, 'FULL COMBO': 7 });

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

  function getSongIndex(songs, commonKey) {
    let indexesByKeyFunction = songIndexes.get(songs);
    if (!indexesByKeyFunction) {
      indexesByKeyFunction = new WeakMap();
      songIndexes.set(songs, indexesByKeyFunction);
    }
    let index = indexesByKeyFunction.get(commonKey);
    if (!index) {
      index = new Map();
      for (const song of songs) {
        if (!song) continue;
        let byTitleKey = index.get(song.series_no);
        if (!byTitleKey) {
          byTitleKey = new Map();
          index.set(song.series_no, byTitleKey);
        }
        const titleKey = commonKey(song.title);
        if (!byTitleKey.has(titleKey)) byTitleKey.set(titleKey, []);
        byTitleKey.get(titleKey).push({ song, titleKey });
      }
      indexesByKeyFunction.set(commonKey, index);
    }
    return index;
  }

  function resolveObservation(row, songs, commonKey, exceptions) {
    const observation = { ...row, rawKey: [row.seriesNo, row.title, row.diff, row.playStyle] };
    if (!Array.isArray(songs)) return { status: 'error', observation, songId: null, error: 'songs-unavailable' };
    if (typeof commonKey !== 'function') throw new TypeError('commonKey must be a function');

    const titleKey = commonKey(row.title);
    const indexed = getSongIndex(songs, commonKey).get(row.seriesNo);
    let candidates = indexed && indexed.has(titleKey)
      ? indexed.get(titleKey).filter((entry) => entry.song.series_no === row.seriesNo && entry.titleKey === titleKey).map((entry) => entry.song)
      : [];
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

  function finalizeIdentity(observations, coverage, aliasTitle) {
    if (typeof aliasTitle !== 'function') throw new TypeError('aliasTitle must be a function');
    const required = coverage && (coverage.requiredSeries || coverage.requiredSeriesNos);
    const succeeded = coverage && (coverage.succeededSeries || coverage.successfulSeries || coverage.succeededSeriesNos);
    if (!Array.isArray(required) || !Array.isArray(succeeded)) throw new TypeError('coverage must include requiredSeries and succeededSeries');
    const successSet = new Set(succeeded);
    const complete = required.every((n) => successSet.has(n));
    const rows = (Array.isArray(observations) ? observations : []).map((item) => ({ ...item }));
    const newBySeries = new Map();
    for (const item of rows) {
      if (item.status !== 'unmatched') continue;
      const row = item.observation || item;
      if (!complete) {
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

  function buildPlan({ observations = [], songs = [], hist = {}, chartNotes, compareHistory, iidxId } = {}) {
    if (typeof chartNotes !== 'function') throw new TypeError('chartNotes must be a function');
    if (typeof compareHistory !== 'function') throw new TypeError('compareHistory must be a function');
    if (songs && !Array.isArray(songs) && songs.status === 'error') throw new Error('songs-read-failed');
    const failedSeries = Array.isArray(observations.failedSeries) ? [...observations.failedSeries].sort((a, b) => a - b) :
      (observations.coverage && Array.isArray(observations.coverage.failedSeries) ? [...observations.coverage.failedSeries].sort((a, b) => a - b) : []);
    const items = Array.isArray(observations) ? observations : (observations.observations || []);
    const rejected = [];
    const valid = [];
    const ordered = [...items].sort((a, b) => {
      const x = a.observation || a, y = b.observation || b;
      return Number(x.seriesNo) - Number(y.seriesNo) || String(x.title).localeCompare(String(y.title)) ||
        String(x.diff).localeCompare(String(y.diff)) || String(x.observedAt || '').localeCompare(String(y.observedAt || ''));
    });
    for (const item of ordered) {
      const source = item.observation || item;
      const confirmed = item.status === 'matched' && item.songId != null;
      const count = confirmed ? chartNotes(source) : null;
      const ex = Number(source.ex_score ?? source.exScore ?? source.ex);
      const diff = Number.isInteger(source.diff) ? source.diff : DIFF_MAP[source.diff];
      const rawLamp = source.lampNum ?? source.lamp;
      const lamp = Number.isInteger(rawLamp) ? rawLamp : LAMP_MAP[rawLamp];
      const rawStyle = source.playStyle ?? source.play_style;
      const style = rawStyle === 0 || rawStyle === 1 ? rawStyle : null;
      const invalid = [];
      if (!Number.isInteger(diff)) invalid.push('invalid-diff');
      if (!Number.isInteger(lamp)) invalid.push('invalid-lamp');
      if (style === null) invalid.push('invalid-play-style');
      if (!Number.isFinite(ex) || !Number.isInteger(ex)) invalid.push('invalid-ex-score');
      if (invalid.length) {
        rejected.push({ row: source, reason: invalid.join(','), reasons: invalid });
        continue;
      }
      if (count !== null && Number.isFinite(ex) && ex > count * 2) {
        rejected.push({ row: source, reason: 'exceeds-chart-maximum', ex, notes: count, maximum: count * 2 });
        continue;
      }
      valid.push({ item, source, confirmed, notes: count, ex, diff, lamp, style });
    }
    const grouped = new Map();
    for (const entry of valid) {
      const { item, source, confirmed, ex, diff, lamp, style } = entry;
      if (item.status === 'deferred') continue;
      if (!confirmed && item.status !== 'new') continue;
      const version = source.playedVersion ?? source.gameVersion;
      if (!Number.isInteger(Number(version))) {
        rejected.push({ row: source, reason: 'invalid-played-version' });
        continue;
      }
      const date = source.date ?? source.observedAt ?? null;
      const dateKst = date && Number.isFinite(Date.parse(date))
        ? new Date(Date.parse(date) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10) : null;
      const base = {
        iidx_id: source.iidxId ?? iidxId,
        song_id: confirmed ? item.songId : null,
        diff, play_style: style, played_version: version,
        date, date_kst: dateKst,
        ex_score: ex,
        lamp, bp: source.bp ?? source.missCount ?? null,
        note_count: source.note_count ?? source.noteCount ?? (entry.notes ?? null),
      };
      const key = JSON.stringify([base.iidx_id, base.song_id, style, diff, version]);
      const rows = grouped.get(key) || []; rows.push({ ...entry, base }); grouped.set(key, rows);
    }
    const rows = [], newRequests = [];
    const history = hist.status === '404' || hist.status === 404 ? [] : hist.rows ?? hist.data ?? (Array.isArray(hist) ? hist : []);
    for (const entries of grouped.values()) {
      entries.sort((a, b) => String(a.source.observedAt || '').localeCompare(String(b.source.observedAt || '')) ||
        String(a.source.title).localeCompare(String(b.source.title)));
      const exemplar = entries[0];
      const maxEx = Math.max(...entries.map((x) => Number(x.base.ex_score ?? -1)));
      const maxLamp = Math.max(...entries.map((x) => Number(x.base.lamp ?? 0)));
      const chosenEx = entries.find((x) => Number(x.base.ex_score ?? -1) === maxEx);
      const chosenLamp = entries.find((x) => Number(x.base.lamp ?? 0) === maxLamp);
      const bpEntry = entries.find((x) => Number(x.base.ex_score ?? -1) === maxEx && x.base.bp != null) || chosenEx;
      const row = { ...exemplar.base, ex_score: maxEx < 0 ? null : maxEx, lamp: maxLamp,
        date: chosenEx.base.date, bp: bpEntry.base.bp,
        note_count: entries.find((x) => x.base.note_count != null)?.base.note_count ?? null };
      if (exemplar.confirmed) {
        if (maxEx <= 0) continue;
        const histForUser = history.filter((h) => Array.isArray(h) ? h[0] === row.song_id && h[7] === row.play_style :
          h.song_id === row.song_id && h.iidx_id === row.iidx_id && h.play_style === row.play_style);
        const tuple = [row.song_id, row.diff, row.lamp, row.ex_score, row.played_version, row.date,
          row.date_kst, row.play_style, row.bp, row.note_count];
        const comparisonRows = histForUser.map((h) => Array.isArray(h) ? h : [h.song_id, h.diff, h.lamp, h.ex_score, h.played_version, h.date, h.date_kst, h.play_style, h.bp ?? null, h.note_count ?? null]);
        if (hist.status === 'error' || compareHistory(comparisonRows, [tuple]).length) rows.push(row);
      } else {
        const source = exemplar.source;
        const newStyle = row.play_style;
        const newDiff = row.diff;
        const tempKey = `@crawl:new:${encodeURIComponent(String(exemplar.item.aliasTitle ?? source.title))}:${String(source.seriesNo)}:${newStyle}:${String(newDiff)}`;
        const request = { ...row, song_id: tempKey, title: exemplar.item.aliasTitle ?? source.title,
          p_textage_song_id: '@crawl:new-only', p_ac: newDiff === DIFF_MAP.LEGGENDARIA ? null : 1,
          p_legen: newDiff === DIFF_MAP.LEGGENDARIA ? 1 : null };
        if (maxEx <= 0) {
          delete request.date; delete request.date_kst; delete request.ex_score; delete request.lamp;
          delete request.bp; delete request.note_count; request.scoreless = true;
        }
        newRequests.push(request);
      }
    }
    rows.sort((a, b) => Number(a.played_version) - Number(b.played_version) || String(a.song_id).localeCompare(String(b.song_id)) ||
      a.play_style - b.play_style || String(a.diff).localeCompare(String(b.diff)));
    newRequests.sort((a, b) => String(a.song_id).localeCompare(String(b.song_id)));
    return { rows, newRequests, deferred: ordered.filter((x) => x.status === 'deferred'), failedSeries, rejected };
  }

  return Object.freeze({
    SERIES_CONCURRENCY,
    NEW_LIMIT_PER_OLD_SERIES,
    EMPTY_PAUSE_MS: Object.freeze(EMPTY_PAUSE_MS),
    runQueue(options) { return runQueueInternal(options, SERIES_CONCURRENCY); },
    _runQueueForTest(options, slots) { return runQueueInternal(options, slots); },
    resolveObservation,
    finalizeIdentity,
    buildPlan,
  });
});
