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
           ohsorry.js:278  OhsorryNorm        (normTitle.js)
           ohsorry.js:279  OhsorryDb          (dbConn.js)
           ohsorry.js:280  OhsorryCore        (calcOhsorryCore.js)
           ohsorry.js:281  OhsorryEagateFetch (eagateFetch.js)
      ③ Core.fetchProfile({isRival:false}) → 모달 상단에 DJ명/SP·DP단위/IIDX ID 채움
      ④ Core.prefetch() 백그라운드 호출 (모달 보는 동안 별값 lib/ereter/textage 미리 fetch)
      ⑤ 시작 → IIDX input 파싱(여러 ID) → 각 대상 own/rival 판정 →
           Core.compute({ mode, rivalToken, seriesList, gameVersion, playStyle, profile, suppressDone })
      ⑥ 완료 박스(1명) 또는 완료 리스트(여러 명, Core.showDoneList)
```

- [`ohsorry.js`](../ohsorry.js) 가 실제 wrapper. `loadModule(url, globalName)` 가 **매 실행 재 fetch+eval**(`ohsorry.js:24-35`) — 버전 갱신 시 stale 전역 방지(core 는 최상위 `var` 라 재eval 안전).
- legacy gist URL `2-calc-score.js` / `rivalOhsorry.js` 는 둘 다 내부에서 `ohsorry.js` 를 fetch+eval 하는 **호환 redirect**(옛 북마크릿 진입점 유지). 라이벌은 별도 진입점이 아니라 모달 IIDX input 으로 통합됨.
- code 모듈은 **항상 4개 전부** 받음 — 옛 DB(게스트 뷰) 모드가 제거돼 `eagateFetch` 조건부 로딩·`dbData` 분기가 사라짐.

### 시리즈 선택 모달 (`ohsorry.js:91-267`)
실행 즉시 표시되고 프로필은 나중에 `fillProfile(profile)` 로 채움.
- **시즌 탭 + 시리즈 체크박스 34개**: 시즌 33 Sparkle Shower / 34 ZINRAI(기본 34). 시즌 33 선택 시 34 체크박스 비활성화·해제. 기본 전체 선택, 10시리즈 단위 그룹 토글(역순 30~34/29~20/19~10/9~1) + 전체 토글.
- **DP/SP 탭**: own·rival 공통 — DP 누르면 DP만, SP 누르면 SP만 크롤·업로드.
- **IIDX input**: 기본=본인 ID(프로필 fetch 후 채움). 다른 ID 입력 시 라이벌, 여러 ID(공백·쉼표)면 순차 처리.
- 결과는 `compute()` 의 `opts.seriesList`(eamuse list 값 0~33; 시즌 33은 0~32), `opts.gameVersion`('33'|'34'), `opts.playStyle`('DP'|'SP') 로 전달. core 직접 호출에서 `gameVersion` 생략 시 33.

---

## 2. 모듈 의존 관계

`window.Ohsorry*` 전역으로 느슨하게 결합. core 가 다른 code 모듈을 직접 import 하지 않고, **런타임에 gist 에서 별값 lib 을 더 fetch** 합니다.

| 전역 | 파일 | 누가 로드 | core 가 호출 |
|------|------|-----------|--------------|
| `OhsorryNorm` | normTitle.js | wrapper | `norm(title)` (매칭 키. dbConn 도 동일 모듈) |
| `OhsorryDb` | dbConn.js | wrapper | `uploadResult()`, `fetchUserStars()`, `upsertUserChartScores()`(SP), `getSongsByNorm()` |
| `OhsorryCore` | calcOhsorryCore.js | wrapper | 본체 |
| `OhsorryEagateFetch` | eagateFetch.js | wrapper | `collectCharts(ctx)` (series 크롤) |
| `OSR135`/`onlyOSR`/`onlyOSRtoEreter` + `userRateStar` + `cpiStar`/`spSkillCpi` | gist `.js` lib | **core 가 gist fetch** (`__loadStarLibs`, `__loadUserRateStar`, `__loadSpStarLibs`) | DP ★·r★ / SP CPI 실력값 추정 (→ [algorithms.md](algorithms.md), [sp.md](sp.md)) |

> 구버전 `OhsorryRender`/`OhsorryRecommend`/`OhsorryWeakness`/`OhSorryShelf` + oldOSR/osr/adopt lib 는 core 가 더 이상 로드하지 않음(이관·제거). 추천/렌더는 **오소리웹**이 별값 lib·렌더 모듈을 직접 fetch 해 처리.

### 외부 데이터/lib fetch + 캐시 (`__loadWithCache`)
core 의 `__loadWithCache(url, cacheKey, isJson)`(`calcOhsorryCore.js:206-229`) 가 **memory cache → network fetch → localStorage** 순 fallback.
- `window.__ohsorryLibCache` : 페이지 lifetime memory cache. 두 번째(여러 명 처리 시 2번째 대상부터) 호출은 fetch skip.
- ereter-data.json 은 별도 캐시(`__ERETER_CACHE_KEY='ereter_dp_diff_v4'`, TTL 24h) + `window.__ohsorryEreterCache` memory cache.
- `Core.prefetch`(=`__loadCoreData`) 와 `compute` 가 같은 캐시를 공유 — 모달에서 미리 prefetch 했으면 compute 가 캐시 hit 으로 즉시 진행.

---

## 3. compute() 실행 흐름

`OhsorryCore.compute(opts)` (`calcOhsorryCore.js:460-1016`) 의 단계(주석상 step 번호):

| 단계 | 코드 | 내용 |
|------|------|------|
| 0 | `:472-478` | `__loadCoreData()` — ereter/textage/rating/CPI JSON, DP 별값 lib 3종 + userRateStar + cpiStar/spSkillCpi 로드(캐시 공유) |
| 1 | `:483-496` | 곡명 정규화 + ereterMap/ratingMap 인덱싱(`norm(title)+'|'+diff`) |
| 2 | `:503-510` | `SERIES=String(opts.gameVersion || '33')`, seriesList 생략 시 선택 시즌 전체, style=0(SP)/1(DP), `fullCrawl=seriesList.length>=Number(SERIES)` |
| 3·4 | `:556-577` | eagate collectCharts 위임 → allCharts. 시즌 34의 미플레이 신곡은 유령 차트 제거 전에 `ensureUnplayedSongs` 로 songs 등록·시리즈 갱신 |
| 4.5 | `:589-626` | textage 로 SP·DP gameLevel 보강 및 DP noteCount 보강. style 별 키 SP=SN/SH/SA/SX/SB, DP=DN/DH/DA/DX/DB |
| 4.6 | `:628-644` | series 유령 차트 제거(gameLevel/lamp/exScore/ereter/rating 중 하나라도 있으면 유지) |
| 5 | `:647-650` | lv12 플레이 ≥30이면 dbPayload 카운트를 lv12만 집계(점수 업로드 범위 제한 아님) |
| 5.5 | `:653-672` | fullCrawl 일 때 onlyOSRtoEreter.inferEreter 호출, 부분 크롤 skip. 이 블록에는 SP 가드가 없으나 SP 분기는 산출한 DP 별값을 저장하지 않고 기존값을 보존합니다. r★는 DP payload 단계에서 별도 계산 |
| 5.6 | `:672-678` | own 은 opts.profile 재사용, rival 은 fetchProfile 호출 |
| SP | `:690-834` | SP1~12(BEGINNER 제외) scores 저장 → DB 전체 SP 기록으로 CPI 실력값 산출 → SP 피쳐 저장 → 성공/실패 안내 (→ [sp.md](sp.md)) |
| 5.7 | `:836-839` | ereterPlayers[iidxId] → ereter_star |
| 6 | `:841-972` | 이전 별값 조회·보존, fullCrawl DP r★ 계산, dbPayload(users 프로필·별값·카운트) + chartScoreRows build |
| 7 | `:974-1013` | uploadResult 호출. 프로필·scores 결과를 확인해 완료 박스 또는 실패 alert(suppressDone 이면 개별 표시 생략) |

### lampToScore 와 점수 매칭
eagate 의 lampNum(0~7)을 lamp 문자열로 변환합니다. dbPayload 카운트는 useOnlyLv12 조건과 ereter/rating의 zasaLevel 11.6~12.7 범위로 집계합니다. core 는 EX점수 또는 램프가 있는 chartScoreRows 를 만들지만, dbConn 은 최종적으로 유한한 ex_score > 0 행만 1000행씩 업로드합니다.

---

## 4. mode·playStyle 분기

`opts.mode`('own'|'rival') + `opts.playStyle`('DP'|'SP') 조합. (구 dbData/statsOnly/noRender/headless 모드는 제거됨.)

| 모드 | 트리거 | 동작 |
|------|--------|------|
| **own DP** | IIDX input = 본인 ID + DP 탭 | series 크롤 → 별값 → dbPayload 업로드 → 완료 박스 |
| **own SP** | 본인 ID + SP 탭 | SP(style=0) 크롤 → ★ skip → SP1~12(BEGINNER 제외) `play_style:0` 업로드 → 완료 박스 |
| **rival DP/SP** | 다른 ID 입력 | `Core.fetchRivalToken(id)` → rival_status/rival series fetch. own 과 동일 계산, 대상 IIDX ID 데이터 갱신 + 완료 박스(대상 카드) |
| **여러 명** | input 에 ID 여러 개(공백·쉼표) | 각 ID 순차 처리(`suppressDone:true`), 끝에 `Core.showDoneList` 로 한 줄 리스트 |

- own 은 wrapper 가 모달에서 받은 `opts.profile` 재사용(status.html 이중 fetch 안 함). rival 은 core 가 rival_status.html 로 프로필 fetch.
- 부분 크롤/별값 미산출 시 fetchUserStars 로 기존 star/ereter_star/r_star 를 조회해 보존합니다. 조회 실패로 star/ereter_star 를 안전하게 보존할 수 없으면 star_estimate 를 제거해 프로필 저장을 차단합니다. DP uploadResult 는 이 프로필 실패 시 scores 도 건너뜁니다.

---

## 5. supabase 업로드 트리거 위치

업로드 판정은 `dbConn.uploadResult(result)` 로 일원화. core 의 step 7 에서 호출:
- `calcOhsorryCore.js:974-1013` : DP 경로 끝에서 `OhsorryDb.uploadResult({dbPayload, chartScoreRows})`.
- 내부에서 payload 확인 → upsertUserProfile → 프로필 성공 시 upsertUserChartScores → DP·SP 패턴 점수 계산·upsert_user_feature_score. uploadEnabled 는 프로필·scores 진입부에서 fail-closed 체크합니다. 피쳐 RPC의 차단 범위는 [service-status-schema.md](service-status-schema.md) 계약과 대조해 판단이 필요합니다.
- SP 경로(`:690-834`)는 upsertUserProfile/upsertUserChartScores 를 직접 호출하고, scores 저장 뒤 fetchSpChartsForStar 로 DB 전체 SP 기록을 읽어 실력값 2차 프로필 저장 및 upsertSpPatternScore 를 수행합니다.

자세한 RPC/페이로드는 [modules.md](modules.md#dbconnjs--supabase-통신) 참고.
