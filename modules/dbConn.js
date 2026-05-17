// dbConn.js — 오소리 DB 통신 모듈 (v0.0.337)
//
// supabase user_profiles 테이블 RPC 호출만 담당. 계산 / UI 와 분리.
// 본체 / 라이벌 wrapper 가 fetch + eval 해서 사용 (window.OhsorryDb 로 노출).
//
// 인터페이스:
//   window.OhsorryDb = {
//     VERSION: '0.0.337',
//     upsertUserProfile(payload):   user_profiles upsert (supabase RPC)
//     upsertUserChartScores(rows):  user_chart_scores bulk upsert (supabase RPC)
//     fetchUserProfile(iidxId):     user_profiles 한 row 조회 (PK 가 (iidx_id, series) composite,
//                                   같은 iidx_id 의 여러 시즌 row 중 last_updated_at 최신 1건 반환)
//   }
// ============================================================

window.OhsorryDb = (function () {
  const SUPABASE_URL = 'https://cvxpeecxiawddmrzbdvn.supabase.co';
  // Legacy JWT anon key (publishable key 는 RLS 호환성 문제로 사용 X) — 본체와 동일
  const SUPABASE_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2eHBlZWN4aWF3ZGRtcnpiZHZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5ODMxMzQsImV4cCI6MjA5NDU1OTEzNH0.lWnnSsSIFFLs7NsJq5yI6fe9HPiT9yQ3Pj-8sgfGuxI';
  const HEADERS = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: 'Bearer ' + SUPABASE_KEY,
  };

  // 원격 service status — gist 의 service-status.json 으로 uploadEnabled toggle.
  // fail-closed: fetch 실패 시 disabled 로 취급 (모든 upload 차단).
  // 캐시: 5분 메모리.
  const SERVICE_STATUS_URL =
    'https://gist.githubusercontent.com/OhSorry-DP/30c3ba6f87df9847291c42ea216a8d2a/raw/service-status.json';
  const SERVICE_STATUS_CACHE_MS = 5 * 60 * 1000;
  let statusCache = null;
  let statusCachedAt = 0;
  async function fetchServiceStatus() {
    const now = Date.now();
    if (statusCache && now - statusCachedAt < SERVICE_STATUS_CACHE_MS) {
      return statusCache;
    }
    try {
      const res = await fetch(SERVICE_STATUS_URL + '?t=' + now, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      statusCache = data;
      statusCachedAt = now;
      return data;
    } catch (e) {
      console.warn('[OhsorryDb] service status fetch 실패, fail-closed:', e.message);
      return {
        uploadEnabled: false,
        shelfEnabled: false,
        message: '서비스 상태 확인 실패 — 잠시 후 다시 시도해주세요.',
      };
    }
  }
  // upload 차단 체크 — return null 이면 통과, error object 면 차단.
  async function checkUploadEnabled() {
    const status = await fetchServiceStatus();
    if (!status.uploadEnabled) {
      return { ok: false, error: status.message || 'upload disabled by remote service status' };
    }
    return null;
  }

  // user_profiles upsert — RPC upsert_user_profile(p jsonb)
  //   payload: { iidx_id, dj_name, star_estimate, ereter_star, raw_s, version,
  //              sp_rank, dp_rank, n_cleared, n_played_lv12, fc_count, hc_count, exh_count,
  //              level_filter, series, charts_json, notes_radar, ... }
  //   리턴: { ok: boolean, error?: string }
  async function upsertUserProfile(payload) {
    if (!payload || !payload.iidx_id) {
      return { ok: false, error: 'iidx_id 가 없습니다' };
    }
    const statusErr = await checkUploadEnabled();
    if (statusErr) return statusErr;
    try {
      const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/upsert_user_profile', {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ p: payload }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return { ok: false, error: `HTTP ${res.status} ${errText}` };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // user_chart_scores bulk upsert — RPC upsert_user_chart_scores(p_rows jsonb)
  //   rows: [{ played_version, level, title, iidx_id, dj_name, diff, game_level, dj_level, ex_score, date }, ...]
  //   리턴: { ok: boolean, error?: string }
  async function upsertUserChartScores(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: true };
    }
    const statusErr = await checkUploadEnabled();
    if (statusErr) return statusErr;
    try {
      const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/upsert_user_chart_scores', {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ p_rows: rows }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return { ok: false, error: `HTTP ${res.status} ${errText}` };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // user_profiles 조회 — RPC get_user_profile_full(p_iidx_id text)
  //   같은 iidx_id 의 다중 시즌 row 중 last_updated_at 최신 1건 반환 (RPC 가 이미 그렇게 정렬)
  //   리턴: row (jsonb) 또는 throw
  async function fetchUserProfile(iidxId) {
    const id = String(iidxId || '').trim().replace(/-/g, '');
    if (!id) throw new Error('iidx_id 가 없습니다');
    const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/get_user_profile_full', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ p_iidx_id: id }),
    });
    if (!res.ok) throw new Error(`조회 실패 (HTTP ${res.status})`);
    const data = await res.json();
    if (!data || !data.iidx_id) throw new Error('해당 IIDX ID 의 데이터가 없습니다');
    return data;
  }

  return {
    VERSION: '0.0.337',
    upsertUserProfile: upsertUserProfile,
    upsertUserChartScores: upsertUserChartScores,
    fetchUserProfile: fetchUserProfile,
    fetchServiceStatus: fetchServiceStatus,
  };
})();
