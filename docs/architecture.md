# architecture — 로딩 구조와 compute 실행 흐름

> wrapper → core 모듈 로딩(모달·프로필·prefetch), 모듈 간 의존 관계, `OhsorryCore.compute()` 의 단계별 실행 흐름, own/rival/여러명 분기를 정리합니다.
> 상위 조망: [`../../docs/ohSorry.md`](../../docs/ohSorry.md) · 인덱스: [README.md](README.md)

> **[구조개편 2C, 2026-06-16]** core 는 "series 크롤 → 별값 → supabase 업로드" 전용. 결과 렌더·추천·약점·DB(게스트뷰) 모드는 제거됨. 웹·INF 는 코어를 안 쓰고 별값 lib·렌더 모듈을 직접 fetch(코어-free).

---

## 1. 진입점과 로딩 체인

```
사용자가 p.eagate.573.jp 콘솔/북마크렛에서 실행
  → gist:ohsorry.js  (wrapper, v3.5.2)
      ① 시리즈 선택 모달 즉시 표시 (시리즈 체크박스 + DP/SP 탭 + IIDX input)
      ② 모듈을 gist 에서 순서대로 fetch+eval (window 전역 등록):
           ohsorry.js:211  OhsorryNorm        (normTitle.js)
           ohsorry.js:212  OhsorryDb          (dbConn.js)
           ohsorry.js:213  OhsorryCore        (calcOhsorryCore.js)
           ohsorry.js:214  OhsorryEagateFetch (eagateFetch.js)
      ③ Core.fetchProfile({isRival:false}) → 모달 상단에 DJ명/SP·DP단위/IIDX ID 채움
      ④ Core.prefetch() 백그라운드 호출 (모달 보는 동안 별값 lib/ereter/textage 미리 fetch)
      ⑤ 시작 → IIDX input 파싱(여러 ID) → 각 대상 own/rival 판정 →
           Core.compute({ mode, rivalToken, seriesList, playStyle, profile, suppressDone })
      ⑥ 완료 박스(1명) 또는 완료 리스트(여러 명, Core.showDoneList)
```

- [`ohsorry.js`](../ohsorry.js) 가 실제 wrapper. `loadModule(url, globalName)` 가 **매 실행 재 fetch+eval**(`ohsorry.js:22-32`) — 버전 갱신 시 stale 전역 방지(core 는 최상위 `var` 라 재eval 안전).
- legacy gist URL `2-calc-score.js` / `rivalOhsorry.js` 는 둘 다 내부에서 `ohsorry.js` 를 fetch+eval 하는 **호환 redirect**(옛 북마크릿 진입점 유지). 라이벌은 별도 진입점이 아니라 모달 IIDX input 으로 통합됨.
- code 모듈은 **항상 4개 전부** 받음 — 옛 DB(게스트 뷰) 모드가 제거돼 `eagateFetch` 조건부 로딩·`dbData` 분기가 사라짐.

### 시리즈 선택 모달 (`ohsorry.js:84-200`)
실행 즉시 표시되고 프로필은 나중에 `fillProfile(profile)` 로 채움.
- **시리즈 체크박스 33개**: 기본 전체 선택. 10시리즈 단위 그룹 토글(역순 30~최신/29~20/19~10/9~1) + 전체 토글. 좌→우 가로 스크롤, PC 는 화면폭 비례, 모바일은 풀스크린.
- **DP/SP 탭**: own·rival 공통 — DP 누르면 DP만, SP 누르면 SP만 크롤·업로드.
- **IIDX input**: 기본=본인 ID(프로필 fetch 후 채움). 다른 ID 입력 시 라이벌, 여러 ID(공백·쉼표)면 순차 처리.
- 결과는 `compute()` 의 `opts.seriesList`(eamuse list 값 0~32 배열) / `opts.playStyle`('DP'|'SP') 로 전달.

---

## 2. 모듈 의존 관계

`window.Ohsorry*` 전역으로 느슨하게 결합. core 가 다른 code 모듈을 직접 import 하지 않고, **런타임에 gist 에서 별값 lib 을 더 fetch** 합니다.

| 전역 | 파일 | 누가 로드 | core 가 호출 |
|------|------|-----------|--------------|
| `OhsorryNorm` | normTitle.js | wrapper | `norm(title)` (매칭 키. dbConn 도 동일 모듈) |
| `OhsorryDb` | dbConn.js | wrapper | `uploadResult()`, `fetchUserStars()`, `upsertUserChartScores()`(SP), `getSongsByNorm()` |
| `OhsorryCore` | calcOhsorryCore.js | wrapper | 본체 |
| `OhsorryEagateFetch` | eagateFetch.js | wrapper | `collectCharts(ctx)` (series 크롤) |
| `OSR135`/`onlyOSR`/`onlyOSRtoEreter` | gist `.js` lib | **core 가 gist fetch** (`__loadStarLibs`, `calcOhsorryCore.js:223-235`) | ★ 추정 (→ [algorithms.md](algorithms.md)) |

> 구버전 `OhsorryRender`/`OhsorryRecommend`/`OhsorryWeakness`/`OhSorryShelf` + oldOSR/osr/adopt lib 는 core 가 더 이상 로드하지 않음(이관·제거). 추천/렌더는 **오소리웹**이 별값 lib·렌더 모듈을 직접 fetch 해 처리.

### 외부 데이터/lib fetch + 캐시 (`__loadWithCache`)
core 의 `__loadWithCache(url, cacheKey, isJson)`(`calcOhsorryCore.js:102-126`) 가 **memory cache → network fetch → localStorage** 순 fallback.
- `window.__ohsorryLibCache` : 페이지 lifetime memory cache. 두 번째(여러 명 처리 시 2번째 대상부터) 호출은 fetch skip.
- ereter-data.json 은 별도 캐시(`__ERETER_CACHE_KEY='ereter_dp_diff_v4'`, TTL 24h) + `window.__ohsorryEreterCache` memory cache.
- `Core.prefetch`(=`__loadCoreData`) 와 `compute` 가 같은 캐시를 공유 — 모달에서 미리 prefetch 했으면 compute 가 캐시 hit 으로 즉시 진행.

---

## 3. compute() 실행 흐름

`OhsorryCore.compute(opts)` (`calcOhsorryCore.js:295-718`) 의 단계(주석상 step 번호):

| 단계 | 코드 | 내용 |
|------|------|------|
| 0 | `:355-363` | `__loadCoreData()` — ereter/textage/ohSorryRating JSON + 별값 lib 3종 fetch(캐시 공유). `{ereterData, ereterPlayers, textageSongs, ratingData, ohSorryRatings, onlyOSR2eLib}` |
| 1 | `:365-383` | 곡명 정규화(`window.OhsorryNorm.norm`) + ereterMap/ratingMap 인덱싱(`norm(title)+'|'+diff` 키) |
| 2 | `:384-401` | 수집 범위 결정 — `opts.seriesList`(생략 시 전체 33), `isSpMode = opts.playStyle==='SP'`, `style`(0=SP/1=DP), `fullCrawl = seriesList.length>=33` |
| 3·4 | `:403-459` | eagate 수집을 `OhsorryEagateFetch.collectCharts({seriesList, series, style, isRival, rivalToken})` 위임 → `allCharts` |
| 4.5 | `:461-494` | textage levels 로 **gameLevel 역추정**(series 페이지엔 레벨 없음). style 별 키: SP=SN/SH/SA/SX/SB, DP=DN/DH/DA/DX/DB |
| 4.6 | `:496-513` | series 유령 차트 제거(gameLevel/lamp/exScore/ereter/rating 중 하나라도 있어야 유지) |
| 5 | `:515-519` | lv12-only 판정(lv12 플레이 ≥30 → 업로드 카운트 lv12 only) |
| 5.5 | `:521-540` | **★값 추정** — `fullCrawl` 일 때만 `onlyOSRtoEreter.inferEreter()` 호출(→ [algorithms.md](algorithms.md#1-별값-추정)). 일부 시리즈만 크롤하면 skip(기존 supabase 값 보존) |
| 5.6 | `:542-554` | 프로필 — own 은 wrapper 가 모달용으로 미리 fetch 한 `opts.profile` 재사용, rival 은 `__fetchProfile({isRival, rivalToken})` |
| SP | `:556-606` | **SP 경량 분기** — ★/추천 skip, SP10~12 점수 `play_style:0` 업로드 + 완료 박스(→ [sp.md](sp.md)) |
| 5.7 | `:608-611` | ereter★ 룩업(`ereterPlayers[iidxId]` → `ereter_star`) |
| 6 | `:613-694` | dbPayload(users 프로필 + 별값 + lv12 카운트) + chartScoreRows build |
| 7 | `:696-716` | `dbConn.uploadResult()` 호출 → 완료 박스/리스트(`suppressDone` 면 wrapper 가 리스트로) |

### lampToScore 와 점수 매칭
eagate 차트의 `lampNum`(0~7) → lamp 문자열. dbPayload 의 lv12 카운트(`n_cleared`/`hc_count`/`exh_count`/`fc_count`)는 ereter/rating 의 `zasaLevel` 11.6~12.7 범위 차트에서 램프별 집계. chartScoreRows 는 점수·램프가 있는 차트만(NO PLAY 제외).

---

## 4. mode·playStyle 분기

`opts.mode`('own'|'rival') + `opts.playStyle`('DP'|'SP') 조합. (구 dbData/statsOnly/noRender/headless 모드는 제거됨.)

| 모드 | 트리거 | 동작 |
|------|--------|------|
| **own DP** | IIDX input = 본인 ID + DP 탭 | series 크롤 → 별값 → dbPayload 업로드 → 완료 박스 |
| **own SP** | 본인 ID + SP 탭 | SP(style=0) 크롤 → ★ skip → SP10~12 `play_style:0` 업로드 → 완료 박스 |
| **rival DP/SP** | 다른 ID 입력 | `Core.fetchRivalToken(id)` → rival_status/rival series fetch. own 과 동일 계산, 대상 IIDX ID 데이터 갱신 + 완료 박스(대상 카드) |
| **여러 명** | input 에 ID 여러 개(공백·쉼표) | 각 ID 순차 처리(`suppressDone:true`), 끝에 `Core.showDoneList` 로 한 줄 리스트 |

- own 은 wrapper 가 모달에서 받은 `opts.profile` 재사용(status.html 이중 fetch 안 함). rival 은 core 가 rival_status.html 로 프로필 fetch.
- 일부 시리즈만 크롤하면(`!fullCrawl`) 별값 계산 skip — `fetchUserStars` 로 기존 star 조회해 그대로 재전송(upsert_user 의 star EXCLUDED 덮어쓰기로 인한 null wipe 방지). native_star 는 COALESCE 라 null 전송 시 보존.

---

## 5. supabase 업로드 트리거 위치

업로드 판정은 `dbConn.uploadResult(result)` 로 일원화. core 의 step 7 에서 호출:
- `calcOhsorryCore.js:696-716` : DP 경로 끝에서 `OhsorryDb.uploadResult({dbPayload, chartScoreRows})`.
- 내부에서 ① `dbPayload` 없으면 skip ② `upsertUserProfile` ③ `upsertUserChartScores` ④ 패턴 점수 `computePatternScoreVec(iidxId)` → `upsert_user_feature_score`. kill-switch(`service-status.json` 의 `uploadEnabled`)는 업로드 진입부에서 fail-closed 체크.
- SP 경로(`:556-606`)는 `upsertUserProfile`/`upsertUserChartScores` 를 직접 호출(별값 미계산이라 기존값 보존).

자세한 RPC/페이로드는 [modules.md](modules.md#dbconnjs--supabase-통신) 참고.
