# modules — 모듈별 export·책임·데이터 구조

> 각 모듈의 주요 export 함수/객체, 책임, 입출력 데이터 구조를 정리합니다. 알고리즘 내부(가중치/임계값)는 [algorithms.md](algorithms.md) 로 분리했습니다.
> 상위 조망: [`../../docs/ohSorry.md`](../../docs/ohSorry.md) · 인덱스: [README.md](README.md)

모든 모듈은 `window.Ohsorry*` 전역으로 등록되는 UMD/IIFE. 마스터는 `modules/` 아래이고 gist 로 배포됩니다.

---

## calcOhsorryCore.js — 수집/업로더 마스터

- 등록: `window.OhsorryCore`, `VERSION: '0.0.407'` (`calcOhsorryCore.js:290-291`)
- export: `prefetch`(=`__loadCoreData`), `fetchProfile`, `fetchRivalToken`, `showDoneList`, `compute(opts)` (`:290-295`)
- 책임: ereter/textage/rating JSON + 별값 lib 3종 fetch+캐시, eagate series 크롤 위임, 곡 매칭, **별값(★) 추정**, 프로필 fetch, dbPayload/chartScoreRows build, `dbConn.uploadResult` 호출, 완료 박스/리스트. **결과 렌더·추천·약점분석은 안 함**(이관·제거, 작은 floating spinner + 완료 박스만 DOM 조작).

### 모듈 함수 (wrapper 가 모달 단계에서 호출)
- `__loadCoreData()` (`:237-254`) = `Core.prefetch` — 데이터 6종 묶음 로드(캐시 공유). compute 도 같은 함수 호출.
- `__fetchProfile({isRival, rivalToken})` (`:255~`) = `Core.fetchProfile` — status.html/rival_status.html 파싱 → `{djName, iidxId, spRank, dpRank, spRadar, dpRadar}`.
- `__fetchRivalToken(iidxId)` = `Core.fetchRivalToken` — rival_search.html POST → 라이벌 토큰 or null.
- `__ohsorryShowDoneList(entries)` (`:84-123`) = `Core.showDoneList` — 여러 명 완료 시 한 줄(DJ명·ID·단위·이동) 리스트 박스(1명이면 단일 박스 `__ohsorryShowDone` 위임).

### compute() 반환 객체
업로드 전용 — `{ dbPayload, chartScoreRows, profile, style }`(SP 경로는 `spResult`). `dbPayload`=users upsert payload, `chartScoreRows`=scores rows. `profile`/`style` 은 wrapper 의 여러-명 완료 리스트용. `opts.suppressDone` 면 단일 완료 박스 생략(wrapper 가 리스트로).

> 구버전 result 의 추천(`topEC/topHC/…`)·통계(`details/perLamp/…`)·분석(`userVec`)·`layoutMap`·`runFromDb`·`__dp_reroll*` 콜백은 2C 에서 전부 제거(추천/렌더가 이관돼 소비처 없음).

---

## recommend.js — (이관됨 → ohSorryRating)

> 구조개편(ROADMAP §0) Phase 1A, 2026-06-15: 추천 알고리즘은 **도메인 로직**이라 ohSorryRating 가 정본으로 흡수(`ohSorryRating/modules/recommend.js`). 본체 `calcOhsorryCore` 는 여전히 gist 에서 fetch 해 추천을 계산하지만(동작 불변), 본체의 추천 계산 자체 제거는 Phase 2. gist(`c3da608…/recommend.js`) URL·내용 불변. 알고리즘 상세는 [ohSorryRating/docs/](../../ohSorryRating/docs/).

---

## calcWeakness.js — (이관됨 → ohSorryRating)

> 구조개편(ROADMAP §0) Phase 1A, 2026-06-15: 약점/강점 분석(`calcUserWeakness`·`chartStrengthMatch8Way`·`computePatternScoreVec` 등)은 **도메인 로직**이라 ohSorryRating 가 정본으로 흡수(`ohSorryRating/modules/calcWeakness.js`, 설계메모 동소 `calcWeakness.md`). 본체는 여전히 gist fetch 로 계산에 사용(동작 불변). 본체 `dbConn` 의 업로드용 `computePatternScoreVec` 와의 단일화는 Phase 3(0-3 ①). gist URL·내용 불변. 상세는 [ohSorryRating/docs/](../../ohSorryRating/docs/).

---

## dbConn.js — Supabase 통신

- 등록: `window.OhsorryDb`, `VERSION: '0.0.411'` (`dbConn.js:698`; 헤더 주석 `0.0.401` 과 불일치 — 객체값 정본)
- export(`:669-677`): `upsertUserProfile`, `upsertUserChartScores`, `uploadResult`, `fetchUserProfile`, `fetchServiceStatus`, `getSongsByNorm`(=`getSongsCache`)
- 연결: `SUPABASE_URL='https://cvxpeecxiawddmrzbdvn.supabase.co'` (`:52`), legacy JWT anon key `SUPABASE_KEY` (`:54`). RPC wrapper `callRpc(name, body)` → `POST /rest/v1/rpc/{name}` (`:213-226`).

### 호출 RPC / 테이블
| RPC | 코드 | 페이로드 |
|-----|------|----------|
| `upsert_user` | `:259-267` | `p_iidx_id, p_dj_name, p_star, p_ereter_star, p_sp_rank, p_dp_rank, p_native_star` |
| `upsert_user_radar` | `:234-243` | `p_iidx_id, p_play_style(0=SP/1=DP), p_notes/peak/charge/chord/scratch/soft` |
| `upsert_scores` | `:404` | `p_rows:[{song_id, iidx_id, diff, lamp, ex_score, played_version, date}]` |
| `ensure_song` | `:337-342` | `p_title, p_textage_song_id, p_ac, p_legen` → song_id 반환 |
| `bump_song_series` | `:411-414` | `p_song_ids[], p_series_no` |
| `upsert_user_feature_score` | `:643-666` | `p_iidx_id` + 28 numeric(`p_os_notes...p_os_k7_r`) |
| `get_user_profile_full` | `:436-439` | `p_iidx_id` (직접 fetch) |
| `make_grid_data` | `:574-580` | `p_iidx_id` + `?limit&offset` 페이지네이션 (직접 fetch) |
| `GET /rest/v1/songs` | `:143-144` | `select=song_id,title,ac,legen` 1000개씩 페이징 |

- `uploadResult(result)`: `result.dbPayload` 기반. payload 없음 시 skip → `upsertUserProfile` → `upsertUserChartScores` → 패턴 점수 `computePatternScoreVec(iidxId)` → `upsert_user_feature_score`. (구 `opts.dbData`(타유저 DB뷰) skip 분기는 core 가 DB 모드를 안 보내므로 사실상 미사용.)
- **28차 손별 feature score 는 dbConn 이 직접 계산**(`computePatternScoreVec`, `:558-636`) — calcWeakness 호출 아님. feature-scores-slim.json + textage notes 로 `scoreRate=ex_score/(noteCount×2)`, feature별 top 30 가중합.
- `getSongsByNorm()` (`:136-174`): songs 를 `Map<normKey, [{song_id,title,ac,legen}]>` 로. ac/legen 비트맵(INF=2, AC=1) + Ø/ø alias 추가 등록.
- kill-switch: `fetchServiceStatus()` (`:70-90`) gist service-status.json 5분 캐시 **fail-closed**. `checkUploadEnabled()` 가 업로드 2종 진입부에서 차단.

자세한 흐름은 [architecture.md](architecture.md#5-supabase-업로드-트리거-위치).

---

## ohsorryRender.js — (이관됨 → ohSorryWeb)

> 구조개편(ROADMAP §0) Phase 1, 2026-06-15: 결과 렌더는 **표시 책임**이라 ohSorryWeb 가 정본으로 흡수(`ohSorryWeb/gist-modules/ohsorryRender.js`). **이후 2C(2026-06-16)에서 본체는 render 를 아예 안 받고 크롤→별값→업로드 전용으로 축소** — 완료 박스만 코어 내장. (라이벌은 IIDX input 으로 `ohsorry.js` 에 통합, 구 `rivalOhsorry.js` gist 는 `ohsorry.js` fetch+eval **redirect** 로 전환 — 삭제 아님, 옛 북마크릿 호환.)

---

## analysisRender.js — (이관됨 → ohSorryWeb)

> 구조개편(ROADMAP §0) Phase 1, 2026-06-15: 분석탭 렌더는 **표시 책임**이라 ohSorryWeb 가 정본으로 흡수(`ohSorryWeb/gist-modules/analysisRender.js`). 본체는 이 모듈을 런타임에서 쓰지 않으므로 제거. gist(`c3da608…/analysisRender.js`) URL·내용 불변(웹이 향후 `push:gist-modules` 로 갱신).

---

## eagateFetch.js — p.eagate.573.jp series 크롤

- 등록: `window.OhsorryEagateFetch`, `VERSION: 'v0.0.3'` (`eagateFetch.js:23`, export `:183`)
- export: `VERSION`, `collectCharts(ctx)`
- `ctx` 키: `seriesList`(eamuse list 값 0~32 배열), `series`(`'33'`), `style`(`'1'`=DP/`'0'`=SP), `isRival`, `rivalToken`, `updateProgress`
- 반환: `{ok, charts, pageCount}`
- **[2026-06-16] series 단일 모드** — level(difficulty.html) 크롤은 폐기. `parseSeriesDoc`: `series.html` 시리즈 폴더(곡당 5 score-cel: BEGINNER~LEGGENDARIA). `gameLevel=null`(textage 로 역추정), `seriesNo` 채움. 시리즈가 `seriesNo` 를 주므로 dbConn 의 song_id/textage_song_id/series_no 매칭 정확.
- 차트 객체 필드: `title, diff, djLevel, exScore, lampNum(0~7), lamp, gameLevel(=null), seriesNo`. **`noteCount`·`pgreat/great/missCount` 없음** — series 페이지가 안 주므로 core 4.5 단계에서 textage 로 gameLevel 보강(noteCount 는 업로드에 안 써 미보강).
- 라이벌: `isRival` 시 `rival_status.html`·series rival fetch(`rivalToken`). 모든 fetch `credentials:'include'` + 랜덤 딜레이.

---

## normTitle.js — 곡명 정규화 (정본=ohSorryRating, 본체는 동기 사본)

> 구조개편(ROADMAP §0) Phase 1B, 2026-06-16: **마스터가 ohSorryRating 으로 이전**(레이팅=공용 도메인 로직). 본체는 크롤 매칭에 normTitle 이 필요하므로 **동기 사본을 유지**(삭제 안 함) — 본체에서 직접 수정 금지, 레이팅 마스터 수정 후 `ohSorryAdmin/scripts/syncNormTitle.js`(방향 반전됨) 로 전파받는다. 본체 런타임은 gist fetch(`window.OhsorryNorm`).

- 등록: `window.OhsorryNorm`, `VERSION: '0.0.6'` (`normTitle.js:166`; 헤더 주석 v0.0.5 와 불일치)
- export: `VERSION`, `norm(s)`, `denorm(k)`
- `norm` 단계(`:140`): `TITLE_ALIASES` raw 치환 → `NORM_OVERRIDES` 강제키 → `basicNorm`(lowercase + NFD diacritic 제거 + 공백/기호 통일 + homoglyph→ASCII + NFKC).
- `TITLE_ALIASES`(`:42-51`): eagate raw → textage raw (예: `火影→焱影`, `VOID→VØID`, `Xlo→Xlø`).
- `NORM_OVERRIDES`(`:56-61`): norm 충돌 동명이곡 강제 분리(신곡 '2' suffix, 예 `ZEИITH→zenith2`).
- ohSorry/ohSorryAdmin/ohSorryRating 3곳 동일 사본, 이 파일이 마스터.

---

## ohsorryShelf.js — (이관됨 → ohSorryWeb)

> 구조개편(ROADMAP §0) Phase 1, 2026-06-15: 서열표 격자 렌더는 **표시 책임**이라 ohSorryWeb 가 정본으로 흡수(`ohSorryWeb/gist-modules/ohsorryShelf.js`). 본체 `calcOhsorryCore` 는 여전히 gist 에서 fetch 해 추천곡 토스트(`renderChartRow`)에만 사용(동작 불변). 정본 편집·push 는 웹. gist(`c3da608…/ohsorryShelf.js`) URL·내용 불변.
