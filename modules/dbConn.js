// dbConn.js — 오소리 DB 통신 모듈 (v0.0.335)
//
// supabase user_profiles 테이블 RPC 호출만 담당. 계산 / UI 와 분리.
// 본체 / 라이벌 wrapper 가 fetch + eval 해서 사용 (window.OhsorryDb 로 노출).
//
// 인터페이스:
//   window.OhsorryDb = {
//     VERSION: '0.0.335',
//     upsertUserProfile(payload):   user_profiles upsert (supabase RPC)
//     fetchUserProfile(iidxId):     user_profiles 한 row 조회 (PK 가 (iidx_id, series) composite,
//                                   같은 iidx_id 의 여러 시즌 row 중 last_updated_at 최신 1건 반환)
//   }
// ============================================================

window.OhsorryDb = (function () {
  const SUPABASE_URL = 'https://ryesiijulrlmstmhzpnv.supabase.co';
  // Legacy JWT anon key (publishable key 는 RLS 호환성 문제로 사용 X) — 본체와 동일
  const SUPABASE_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5ZXNpaWp1bHJsbXN0bWh6cG52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNzAxNDAsImV4cCI6MjA5Mzc0NjE0MH0.KaKa241XpXbRkdM0C3euyUM3jOX673ijd319HFFFxwA';
  const HEADERS = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: 'Bearer ' + SUPABASE_KEY,
  };

  // user_profiles upsert — RPC upsert_user_profile(p jsonb)
  //   payload: { iidx_id, dj_name, star_estimate, ereter_star, raw_s, version,
  //              sp_rank, dp_rank, n_cleared, n_played_lv12, fc_count, hc_count, exh_count,
  //              level_filter, series, charts_json, notes_radar, ... }
  //   리턴: { ok: boolean, error?: string }
  async function upsertUserProfile(payload) {
    if (!payload || !payload.iidx_id) {
      return { ok: false, error: 'iidx_id 가 없습니다' };
    }
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
    VERSION: '0.0.335',
    upsertUserProfile: upsertUserProfile,
    fetchUserProfile: fetchUserProfile,
  };
})();
