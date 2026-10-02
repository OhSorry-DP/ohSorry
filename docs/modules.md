# modules — 모듈별 export·책임·데이터 구조

> 각 모듈의 주요 export 함수/객체, 책임, 입출력 데이터 구조를 정리합니다. 알고리즘 내부(가중치/임계값)는 [algorithms.md](algorithms.md) 로 분리했습니다.
> 상위 조망: [`../../docs/ohSorry.md`](../../docs/ohSorry.md) · 인덱스: [README.md](README.md)

모든 모듈은 `window.Ohsorry*` 전역으로 등록되는 UMD/IIFE. 마스터는 `modules/` 아래이고 gist 로 배포됩니다.

---

## calcOhsorryCore.js — 수집/업로더 마스터

- 등록: `window.OhsorryCore`, `VERSION: '0.0.414'` (`calcOhsorryCore.js:450-467`, `CORE_VERSION_SHORT`)
- export(`:450-460`): prefetch, fetchProfile, fetchRivalToken, showDoneList, loginBtnHtml, bindLoginBtns, compute(opts)
- 책임: ereter/textage/rating/CPI JSON + DP 별값 lib 3종·userRateStar·cpiStar/spSkillCpi 로드, series 크롤·곡 매칭, DP star/native_star/r_star 산출, SP scores 저장 뒤 DB 전체 기록으로 CPI 실력값·SP 피쳐 산출, 프로필·점수 업로드, 미플레이 신곡 songs 등록, 로그인 버튼·완료 박스/리스트. 결과 렌더·추천·약점분석은 이관됨.

### 모듈 함수 (wrapper 가 모달 단계에서 호출)
- __loadCoreData() (`:327-345`) = Core.prefetch — JSON 4종(ereter/textage/rating/CPI) + JS lib 6종(OSR13.5+/onlyOSR/onlyOSRtoEreter/userRateStar/cpiStar/spSkillCpi) 로드 시도, 캐시 공유. compute 도 같은 함수 호출.
- `__fetchProfile({isRival, rivalToken})` (`:352-435`) = `Core.fetchProfile` — status.html/rival_status.html 파싱 → `{djName, iidxId, spRank, dpRank, spRadar, dpRadar}`.
- `__fetchRivalToken(iidxId)` = `Core.fetchRivalToken` — rival_search.html POST → 라이벌 토큰 or null.
- `__ohsorryShowDoneList(entries)` (`:134-173`) = `Core.showDoneList` — 여러 명 완료 시 한 줄(DJ명·ID·단위·이동) 리스트 박스(1명이면 단일 박스 `__ohsorryShowDone` 위임).

### compute() 반환 객체
업로드 전용 — `{ dbPayload, chartScoreRows, profile, style }`(SP 경로는 `spResult`). `dbPayload`=users upsert payload, `chartScoreRows`=scores rows. `profile`/`style` 은 wrapper 의 여러-명 완료 리스트용. `opts.suppressDone` 면 단일 완료 박스 생략(wrapper 가 리스트로).

> 구버전 result 의 추천(`topEC/topHC/…`)·통계(`details/perLamp/…`)·분석(`userVec`)·`layoutMap`·`runFromDb`·`__dp_reroll*` 콜백은 2C 에서 전부 제거(추천/렌더가 이관돼 소비처 없음).

---

## recommend.js — (이관됨 → ohSorryRating)

> 구조개편(ROADMAP §0) Phase 1A, 2026-06-15: 추천 알고리즘은 **도메인 로직**이라 ohSorryRating 가 정본으로 흡수(`ohSorryRating/modules/recommend.js`). 이 설명은 Phase 1A 당시 기록입니다. 현재 본체 `calcOhsorryCore` 는 recommend.js 를 로드하거나 추천을 계산하지 않습니다(2C 이후). gist(`c3da608…/recommend.js`) URL·내용 불변. 알고리즘 상세는 [ohSorryRating/docs/](../../ohSorryRating/docs/).

---

## calcWeakness.js — (이관됨 → ohSorryRating)

> 구조개편(ROADMAP §0) Phase 1A, 2026-06-15: 약점/강점 분석(`calcUserWeakness`·`chartStrengthMatch8Way`·`computePatternScoreVec` 등)은 **도메인 로직**이라 ohSorryRating 가 정본으로 흡수(`ohSorryRating/modules/calcWeakness.js`, 설계메모 동소 `calcWeakness.md`). 이 설명은 Phase 1A 당시 기록입니다. 현재 본체는 calcWeakness.js 를 로드하지 않습니다. dbConn 의 업로드용 피쳐 산식은 patternScoreKernel 정본의 inline 동기 사본입니다. gist URL·내용 불변. 상세는 [ohSorryRating/docs/](../../ohSorryRating/docs/).

---

## dbConn.js — Supabase 통신

- 등록: `window.OhsorryDb`, `VERSION: '0.0.420'` (`dbConn.js:1102`). 헤더 주석은 v0.0.418, 주석 처리된 옛 VERSION 도 남아 있으므로 export 객체값을 정본으로 봅니다.
- export(`:1101-1124`): upsertUserProfile, upsertUserChartScores, uploadResult, recomputeAndSaveStar, upsertSpPatternScore, fetchSpChartsForStar, fetchUserProfile, fetchUserStars, fetchServiceStatus, getSongsByNorm(=getSongsCache), ensureUnplayedSongs
- 연결: SUPABASE_URL='https://cvxpeecxiawddmrzbdvn.supabase.co', legacy JWT anon key SUPABASE_KEY. RPC wrapper callRpc(name, body) → POST /rest/v1/rpc/{name} (`:316-328`). 키 값은 문서에 복제하지 않습니다.

### 호출 RPC / 테이블
| RPC | 코드 | 페이로드 |
|-----|------|----------|
| `upsert_user` | `:365-376` | p_iidx_id, p_dj_name, p_star, p_ereter_star, p_sp_rank, p_dp_rank, p_native_star, p_sp_cpi, p_sp_star, p_r_star (10-arg; 별값별 null 보존 정책은 DB SQL 정본 참조) |
| `upsert_user_radar` | `:331-349` | p_iidx_id, p_play_style(0=SP/1=DP), p_notes/peak/charge/chord/scratch/soft |
| `upsert_scores` | `:511-539` | p_rows:[{song_id,iidx_id,diff,lamp,ex_score,played_version,play_style,date}]. 최종 ex_score > 0 행만 1000행씩 전송. (play_style 기본 1) |
| `ensure_song` | `:450-459,596-600` | p_title, p_textage_song_id, p_ac, p_legen → song_id |
| `bump_song_series` | `:546-555,609-613` | p_song_ids[], p_series_no |
| `upsert_user_feature_score` | `:1040-1081` | p_iidx_id + 36 numeric(p_os_notes...p_os_k7_r + DOUBLE_STAIR/KEIMA/HSTAIR 8개). SP 는 p_play_style=0 추가 |
| `get_user_profile_full` | `:625-636` | p_iidx_id (직접 fetch) |
| `make_grid_data` | `:911-929` | p_iidx_id + SP 는 p_play_style=0; limit/offset 페이지네이션 |
| `GET /rest/v1/songs` | `:174-211` | select=song_id,textage_song_id,title,series_no,ac,legen; song_id 순 1000개씩 페이징 |

- uploadResult(result, ctx): ctx.dbData 또는 payload 없음 시 skip → 프로필 저장 → 프로필 성공 시 scores 저장 → DP·SP 패턴 점수 계산·저장. 피쳐 계산은 프로필/scores 실패 여부와 독립된 try 블록입니다. core 는 ctx.dbData 를 전달하지 않습니다.
- DP·SP 36차 피쳐는 dbConn 이 직접 계산합니다(DP computePatternScoreVec `:939-979`, SP computeSpPatternScoreVec `:991-1031`, 공용 kernel `:876-905`). DP feature-scores-slim.json / SP sp-feature-scores-slim.json + textage notes 로 scoreRate=ex_score/(noteCount×2), feature별 top 30 가중합. calcWeakness 호출 아님.
- getSongsByNorm(=getSongsCache) (`:174-211`): Map<normKey,[{song_id,textage_song_id,title,series_no,ac,legen}]>. ac/legen 비트맵(INF=2,AC=1) 및 Ø/ø alias 등록.
- kill-switch: `fetchServiceStatus()` (`:108-128`) gist service-status.json 5분 캐시 **fail-closed**. `checkUploadEnabled()` 가 업로드 2종 진입부에서 차단.

자세한 흐름은 [architecture.md](architecture.md#5-supabase-업로드-트리거-위치).

---

## ohsorryRender.js — (이관됨 → ohSorryWeb)

> 구조개편(ROADMAP §0) Phase 1, 2026-06-15: 결과 렌더는 **표시 책임**이라 ohSorryWeb 가 정본으로 흡수(`ohSorryWeb/gist-modules/ohsorryRender.js`). **이후 2C(2026-06-16)에서 본체는 render 를 아예 안 받고 크롤→별값→업로드 전용으로 축소** — 완료 박스만 코어 내장. (라이벌은 IIDX input 으로 `ohsorry.js` 에 통합, 구 `rivalOhsorry.js` gist 는 `ohsorry.js` fetch+eval **redirect** 로 전환 — 삭제 아님, 옛 북마크릿 호환.)

---

## analysisRender.js — (이관됨 → ohSorryWeb)

> 구조개편(ROADMAP §0) Phase 1, 2026-06-15: 분석탭 렌더는 **표시 책임**이라 ohSorryWeb 가 정본으로 흡수(`ohSorryWeb/gist-modules/analysisRender.js`). 본체는 이 모듈을 런타임에서 쓰지 않으므로 제거. gist(`c3da608…/analysisRender.js`) URL·내용 불변(웹이 향후 `push:gist-modules` 로 갱신).

---

## eagateFetch.js — p.eagate.573.jp series 크롤

- 등록: `window.OhsorryEagateFetch`, `VERSION: 'v0.0.8'` (`eagateFetch.js:25`, export `:265`)
- export: `VERSION`, `collectCharts(ctx)`
- ctx 키: seriesList(시즌 33=0~32, 시즌 34=0~33), series('33'|'34', 직접 호출 기본 '33'), style('1'=DP/'0'=SP), isRival, rivalToken, updateProgress, alertFn
- 반환: `{ok, charts, pageCount}`
- **[2026-06-16] series 단일 모드** — level(difficulty.html) 크롤은 폐기. `parseSeriesDoc`: `series.html` 시리즈 폴더(곡당 5 score-cel: BEGINNER~LEGGENDARIA). `gameLevel=null`(textage 로 역추정), `seriesNo` 채움. 시리즈가 `seriesNo` 를 주므로 dbConn 의 song_id/textage_song_id/series_no 매칭 정확.
- 차트 필드: title,diff,djLevel,exScore,lampNum(0~7),lamp,gameLevel(=null),seriesNo. series 파서에는 noteCount/pgreat/great/missCount 가 없지만 core 4.5 단계에서 textage 로 SP·DP gameLevel 및 DP noteCount 를 보강합니다.
- 전체 시리즈 수집에서 같은 `title|diff`가 반복되면 **EX 우선, EX 동점이면 높은 `lampNum` 우선**으로 하나만 유지한다. 따라서 앞 시리즈의 낮은 램프가 뒤 시리즈의 HC/EXH/FC를 가리지 않는다.
- 라이벌: `isRival` 시 `rival_status.html`·series rival fetch(`rivalToken`). 모든 fetch `credentials:'include'` + 랜덤 딜레이.

---

## normTitle.js — 곡명 정규화 (정본=ohSorryRating, 본체는 동기 사본)

> 구조개편(ROADMAP §0) Phase 1B, 2026-06-16: **마스터가 ohSorryRating 으로 이전**(레이팅=공용 도메인 로직). 본체는 크롤 매칭에 normTitle 이 필요하므로 **동기 사본을 유지**(삭제 안 함) — 본체에서 직접 수정 금지, 레이팅 마스터 수정 후 `ohSorryAdmin/scripts/syncNormTitle.js`(방향 반전됨) 로 전파받는다. 본체 런타임은 gist fetch(`window.OhsorryNorm`).

- 등록: `window.OhsorryNorm`, `VERSION: '0.0.7'` (`normTitle.js:175`; 헤더 주석 v0.0.6 과 불일치)
- export: `VERSION`, `norm(s)`, `denorm(k)`
- `norm` 단계(`:150-160`): `TITLE_ALIASES` raw 치환 → `NORM_OVERRIDES` 강제키 → `basicNorm`(lowercase + NFD diacritic 제거 + 공백/기호 통일 + homoglyph→ASCII + NFKC).
- `TITLE_ALIASES`(`:44-59`): eagate raw → textage raw (예: `火影→焱影`, `VOID→VØID`, `Xlo→Xlø`).
- `NORM_OVERRIDES`(`:63-68`): norm 충돌 동명이곡 강제 분리(신곡 '2' suffix, 예 `ZEИITH→zenith2`).
- 정본은 ohSorryRating/modules/normTitle.js. syncNormTitle.js 는 본체·Admin·INFOhSorry·ohSorryWeb Functions vendor 로 전파하며, 웹 shared/helpers.js ESM 사본은 수동 동기화 대상입니다.

---

## ohsorryShelf.js — (이관됨 → ohSorryWeb)

> 구조개편(ROADMAP §0) Phase 1, 2026-06-15: 서열표 격자 렌더는 **표시 책임**이라 ohSorryWeb 가 정본으로 흡수(`ohSorryWeb/gist-modules/ohsorryShelf.js`). 이 설명은 Phase 1 당시 기록입니다. 현재 본체 `calcOhsorryCore` 는 ohsorryShelf.js 를 로드하거나 renderChartRow 를 호출하지 않습니다(2C 이후). 정본 편집·push 는 웹. gist(`c3da608…/ohsorryShelf.js`) URL·내용 불변.
