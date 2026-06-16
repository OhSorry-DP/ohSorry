# modules — 모듈별 export·책임·데이터 구조

> 각 모듈의 주요 export 함수/객체, 책임, 입출력 데이터 구조를 정리합니다. 알고리즘 내부(가중치/임계값)는 [algorithms.md](algorithms.md) 로 분리했습니다.
> 상위 조망: [`../../docs/ohSorry.md`](../../docs/ohSorry.md) · 인덱스: [README.md](README.md)

모든 모듈은 `window.Ohsorry*` 전역으로 등록되는 UMD/IIFE. 마스터는 `modules/` 아래이고 gist 로 배포됩니다.

---

## calcOhsorryCore.js — 계산 마스터

- 등록: `window.OhsorryCore`, `VERSION: '0.0.368'` (`calcOhsorryCore.js:59-60`)
- export 메서드: `compute(opts)` (`:61`), `runFromDb(row, opts)` (`:1637`)
- 책임: ereter/zasa/textage/rating/lib 데이터 fetch+캐시, eagate 페이지 순회 위임, 매칭·점수, ★값 추정, 추천 오케스트레이션, 프로필 fetch, result build. **DOM 직접 조작은 render 에 위임**(작은 floating spinner 제외).

### compute() 의 result 객체 (render/외부로 반환)
`calcOhsorryCore.js:1593-1617`. 주요 키:
- 프로필: `profile`(djName/iidxId/spRank/dpRank/spRadar/dpRadar/qproImg/area...), `profileHasRadar`
- ★: `starEstimate`(표시용), `starEstimateNew`(=OSR/native, 추천 baseStar), `starEstimateOld`, `eraterTrueStar`(ereter 실측), `starRaw`, `ohsorryRecBase`
- 차트: `allCharts`, `ereterMap`/`zasaMap`/`ratingMap`(`norm(title)+'|'+diff` 키 Map), `ereterExtractedAt`, `gameLevelTotals`, `isInfUser`
- 추천: `topEC`/`topHC`/`topEXH`/`topWeakness`(= `recsEC` 등), `recBaseMode`(`'ereter'`|`'ohsorry'`), `recBaseStar`, `recLevelModeDefault`, `recDjModeDefault`, `practiceZasaDefault`
- 통계: `matched`/`unmatched`/`total`/`details`/`perLevel`/`perLamp`/`useOnlyLv12`/`pageCount`
- 분석: `userVec`(calcWeakness 결과), `weaknessLib`
- 업로드: `dbPayload`(users upsert payload), `chartScoreRows`(scores rows)
- 기타: `norm`(정규화 함수), `SERIES`(`'33'`), `shelfLib`, `layoutMap`(ohSorryWeb PlayData 탭용 `norm(title)|diff → bestLabel`)

### window 콜백 (render UI 가 호출)
- `__dp_rerollRecs(stage, baseStarOverride, recLevelMode, djMode, layoutMode)` (`:1502`)
- `__dp_rerollWeakness(opts)` (`:1485`)
- `__dp_ensurePatternsLevel(band)` (`:1447`) — patterns 하위 레벨 구간(0810/rest) lazy 병합

---

## recommend.js — (이관됨 → ohSorryRating)

> 구조개편(ROADMAP §0) Phase 1A, 2026-06-15: 추천 알고리즘은 **도메인 로직**이라 ohSorryRating 가 정본으로 흡수(`ohSorryRating/modules/recommend.js`). 본체 `calcOhsorryCore` 는 여전히 gist 에서 fetch 해 추천을 계산하지만(동작 불변), 본체의 추천 계산 자체 제거는 Phase 2. gist(`c3da608…/recommend.js`) URL·내용 불변. 알고리즘 상세는 [ohSorryRating/docs/](../../ohSorryRating/docs/).

---

## calcWeakness.js — (이관됨 → ohSorryRating)

> 구조개편(ROADMAP §0) Phase 1A, 2026-06-15: 약점/강점 분석(`calcUserWeakness`·`chartStrengthMatch8Way`·`computePatternScoreVec` 등)은 **도메인 로직**이라 ohSorryRating 가 정본으로 흡수(`ohSorryRating/modules/calcWeakness.js`, 설계메모 동소 `calcWeakness.md`). 본체는 여전히 gist fetch 로 계산에 사용(동작 불변). 본체 `dbConn` 의 업로드용 `computePatternScoreVec` 와의 단일화는 Phase 3(0-3 ①). gist URL·내용 불변. 상세는 [ohSorryRating/docs/](../../ohSorryRating/docs/).

---

## dbConn.js — Supabase 통신

- 등록: `window.OhsorryDb`, `VERSION: '0.0.410'` (`dbConn.js:670`)
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

- `uploadResult` (`:458-514`): `result.dbPayload` 기반. dbData 모드/payload 없음 시 skip → `upsertUserProfile` → `upsertUserChartScores` → 패턴 점수 `computePatternScoreVec(iidxId)` → `upsert_user_feature_score`.
- **28차 손별 feature score 는 dbConn 이 직접 계산**(`computePatternScoreVec`, `:558-636`) — calcWeakness 호출 아님. feature-scores-slim.json + textage notes 로 `scoreRate=ex_score/(noteCount×2)`, feature별 top 30 가중합.
- `getSongsByNorm()` (`:136-174`): songs 를 `Map<normKey, [{song_id,title,ac,legen}]>` 로. ac/legen 비트맵(INF=2, AC=1) + Ø/ø alias 추가 등록.
- kill-switch: `fetchServiceStatus()` (`:70-90`) gist service-status.json 5분 캐시 **fail-closed**. `checkUploadEnabled()` 가 업로드 2종 진입부에서 차단.

자세한 흐름은 [architecture.md](architecture.md#5-supabase-업로드-트리거-위치).

---

## ohsorryRender.js — (이관됨 → ohSorryWeb)

> 구조개편(ROADMAP §0) Phase 1, 2026-06-15: 결과 렌더는 **표시 책임**이라 ohSorryWeb 가 정본으로 흡수(`ohSorryWeb/gist-modules/ohsorryRender.js`). **이후 2C(2026-06-16)에서 본체는 render 를 아예 안 받고 크롤→별값→업로드 전용으로 축소** — 완료 박스만 코어 내장. (라이벌은 IIDX input 으로 `ohsorry.js` 에 통합, `rivalOhsorry.js` 제거.)

---

## analysisRender.js — (이관됨 → ohSorryWeb)

> 구조개편(ROADMAP §0) Phase 1, 2026-06-15: 분석탭 렌더는 **표시 책임**이라 ohSorryWeb 가 정본으로 흡수(`ohSorryWeb/gist-modules/analysisRender.js`). 본체는 이 모듈을 런타임에서 쓰지 않으므로 제거. gist(`c3da608…/analysisRender.js`) URL·내용 불변(웹이 향후 `push:gist-modules` 로 갱신).

---

## eagateFetch.js — p.eagate.573.jp 차트 fetch

- 등록: `window.OhsorryEagateFetch`, `VERSION: 'v0.0.1'` (`eagateFetch.js:28`)
- export: `VERSION`, `collectCharts(ctx)` (`:357`)
- `ctx` 키: `fetchMode`(`'level'`|`'series'`), `levels`(없으면 `[12,11]`), `series`(`'33'`), `style`(`'1'`=DP), `disp`(`'1'`), `isRival`, `rivalToken`, `updateProgress`, `alertFn`
- 반환: `{ok, charts, pageCount, fetchMode, LEVELS_TO_FETCH}`
- **level 모드** `parseDoc`(`:44`): `difficulty.html` `div.series-difficulty table`, td 5개 행. `difficult` 파라미터 = **게임레벨 − 1**(`:371`).
- **series 모드** `parseSeriesDoc`(`:113`): `series.html` `div.series-all`, 곡당 5 score-cel(BEGINNER~LEGGENDARIA). `gameLevel=null`(textage 로 역추정), `seriesNo` 채움.
- 차트 객체 필드: `title, diff, djLevel, exScore, pgreat, great, missCount(보통 null), lampNum(0~7), lamp, gameLevel`(+series 면 `seriesNo`). **`noteCount` 는 없음** — eagate 페이지가 노트수를 안 주므로 core 4.5 단계에서 textage 로 보강.
- 상수: `STEP=50`, `MAX_PAGES=30`, 딜레이 `DELAY_MIN_MS=800`~`DELAY_MAX_MS=1200` 랜덤(`:31-36`). 모든 fetch `credentials:'include'`.

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
