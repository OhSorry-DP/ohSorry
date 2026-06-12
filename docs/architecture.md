# architecture — 로딩 구조와 compute 실행 흐름

> wrapper → core → render 의 모듈 로딩 순서, 모듈 간 의존 관계, `OhsorryCore.compute()` 의 단계별 실행 흐름, own/rival/DB 모드 분기를 정리합니다.
> 상위 조망: [`../../docs/ohSorry.md`](../../docs/ohSorry.md) · 인덱스: [README.md](README.md)

---

## 1. 진입점과 로딩 체인

```
사용자가 p.eagate.573.jp 콘솔/북마크렛에서 실행
  → gist:2-calc-score.js  (호환 redirect, 9줄)
      ohsorry.js:6  gist:ohsorry.js fetch + eval
  → ohsorry.js  (wrapper, v3.3.9)
      모듈을 gist 에서 순서대로 fetch+eval (window 전역 등록):
        ohsorry.js:159  OhsorryNorm   (normTitle.js)
        ohsorry.js:161  OhsorryDb     (dbConn.js)
        ohsorry.js:163  OhsorryRender (ohsorryRender.js)
        ohsorry.js:165  OhsorryCore   (calcOhsorryCore.js)
        ohsorry.js:170  OhsorryEagateFetch (eagateFetch.js) ← dbData 없을 때만
      → OhsorryCore.compute({ mode, rivalToken, dbData, wrapperVersion, fetchMode, levels, statsOnly, noRender })
```

- 루트 [`2-calc-score.js`](../2-calc-score.js) 는 legacy gist URL 호환용 redirect 뿐입니다(`2-calc-score.js:6`).
- [`ohsorry.js`](../ohsorry.js) 가 실제 wrapper. `loadModule(url, globalName)` 가 `window[globalName]` 캐시 후 fetch+eval (`ohsorry.js:31-40`).
- **DB 모드**(dbData 있음 = ohSorryWeb 게스트 / INFOhSorry)면 `eagateFetch` 를 받지 않습니다(`ohsorry.js:168`) — supabase `charts_json` 으로 채우므로 eagate 페이지 fetch 가 불필요. 다운로드 절감.
- wrapper 가 `window.__dp_render(dbData, renderOpts)` 를 노출(`ohsorry.js:140`). eagate 도메인이면 `__dp_render(null)` 자동 실행(`ohsorry.js:194`), 그 외 도메인은 외부에서 `__dp_render(dbData)` 로 호출.

### eagate fetch 범위 모달
eagate 도메인 + dbData 없을 때만 `askFetchOptions(isRival)` 모달로 수집 범위를 먼저 묻습니다(`ohsorry.js:74-138`).
- **레벨별**: 선택 레벨 폴더만 `difficulty.html` (기본 11·12 체크).
- **전곡**: 시리즈 폴더 전체 `series.html` (약 1분).
- 결과는 `compute()` 의 `opts.fetchMode`(`'level'`|`'series'`) / `opts.levels` 로 전달.

---

## 2. 모듈 의존 관계

`window.Ohsorry*` 전역으로 느슨하게 결합. core 가 다른 모듈을 직접 import 하지 않고, **런타임에 gist 에서 추가 lib 을 더 fetch** 합니다.

| 전역 | 파일 | 누가 로드 | core 가 호출 |
|------|------|-----------|--------------|
| `OhsorryNorm` | normTitle.js | wrapper | dbConn 의 normTitle (간접). core 는 자체 inline `norm` 사용 |
| `OhsorryDb` | dbConn.js | wrapper | `getSongsByNorm()` (INF 필터/ALL 분모), render 가 `uploadResult()` |
| `OhsorryRender` | ohsorryRender.js | wrapper | `compute()` 끝에서 `show(result, {statsOnly})` |
| `OhsorryCore` | calcOhsorryCore.js | wrapper | 본체 |
| `OhsorryEagateFetch` | eagateFetch.js | wrapper(비-DB) | `collectCharts(ctx)` |
| `OhsorryWeakness` | calcWeakness.js | **core 가 gist fetch** (`calcOhsorryCore.js:452-460`) | `calcUserWeakness()`, 8배치 매치 |
| `OhsorryRecommend` | recommend.js | **core 가 gist fetch** (`calcOhsorryCore.js:462-470`) | `createContext(deps)` → `buildRecs`/`buildWeaknessRecs` |
| `OhSorryShelf` | ohsorryShelf.js | core 가 gist fetch (`:419-430`) | 추천곡 곡명 클릭 토스트 `renderChartRow` |
| `oldOSR`/`ohSorryRating`/`OSR135`/`adopt`/`onlyOSR`/`onlyOSRtoEreter` | gist `.js` lib | core 가 gist fetch (`:362-415`, **비-DB 모드만**) | ★ 추정 (→ [algorithms.md](algorithms.md)) |

`rivalOhsorry.js`([`modules/rivalOhsorry.js`](../modules/rivalOhsorry.js))는 라이벌 페이지 전용 wrapper(별도 진입점). own wrapper 와 동일하게 모듈 fetch 후 `compute({mode:'rival'})` 를 호출하는 구조입니다.

### 외부 데이터/lib fetch + 캐시 (`loadWithCache`)
core 의 `loadWithCache(url, cacheKey, isJson)`(`calcOhsorryCore.js:312-339`) 가 **memory cache → network fetch → localStorage** 순으로 fallback.
- `window.__ohsorryLibCache` : 페이지 lifetime memory cache. batch(라이벌 다수) 처리 시 2번째 호출부터 fetch skip.
- localStorage : fetch 실패 시 최후 fallback (캐시도 없으면 에러).
- ereter-data.json 은 별도 캐시(`CACHE_KEY='ereter_dp_diff_v4'`, TTL 24h, `calcOhsorryCore.js:99-100`) + `window.__ohsorryEreterCache` memory cache.

---

## 3. compute() 실행 흐름

`OhsorryCore.compute(opts)` (`calcOhsorryCore.js:61-1630`) 의 단계(주석상 step 번호):

| 단계 | 코드 | 내용 |
|------|------|------|
| 0 | `:82-201` | ereter-data.json fetch + 정규화(`normalizePayload`) + 24h 캐시. `{charts, extractedAt, players}` |
| 0.5 | `:207-227` | zasa-data.json 보충 fetch (선택, 실패 무시) |
| 0.55 | `:229-250` | textage-meta.json fetch (채보별 노트수 → noteCount 보강) |
| 0.56 | `:252-271` | series-name.json fetch (series_no → 시리즈명, 해시태그용) |
| 0.6 | `:273-478` | ohSorryRating.json + ★추정 lib + shelf + patterns + calcWeakness + recommend + rate-reference fetch. **비-DB 모드만** ★추정 lib 4종 로드 |
| 1 | `:480-594` | 곡명 정규화(`norm`) + ereterMap/zasaMap/ratingMap 인덱싱(`norm(title)+'|'+diff` 키) |
| 2 | `:596-635` | 수집 모드 결정(`fetchMode`/`requestedLevels`) + 도메인 체크 |
| 3·4 | `:637-714` | eagate 수집은 `OhsorryEagateFetch.collectCharts()` 위임. DB 모드는 `dbData.charts_json` 을 deep copy 로 `allCharts` 에 직접 |
| 4.5 | `:716-763` | textage notes 로 noteCount + gameLevel 보강(norm 충돌 시 levels 일치 엔트리 우선) |
| 4.6 | `:765-782` | series 모드 — 유령 차트 제거(gameLevel/lamp/exScore/ereter/rating 중 하나라도 있어야 유지) |
| 5 | `:784-851` | 매칭 + 점수(`lampToScore`). lv12 플레이 ≥30 이면 lv12-only 통계 모드(`useOnlyLv12`) |
| 5.5 | `:853-1141` | **★값 추정** (→ [algorithms.md](algorithms.md#1-별값-추정)). DB 모드는 `dbData.star_estimate`/`native_star` 그대로 |
| 5.6 | `:1143-1254` | status.html fetch 로 프로필(DJ명/IIDX ID/단위/노트레이더/쿠프로). DB 모드는 row 에서 구성 |
| 5.7 | `:1256-1515` | **추천곡 계산** (→ [algorithms.md](algorithms.md#2-추천곡-파이프라인)). userVec 계산 → `recommendCtx` → buildRecs/buildWeaknessRecs |
| 6 | `:1517-1628` | result 객체 build + dbPayload/chartScoreRows + `OhsorryRender.show(result)` 호출 후 result 반환 |

### lampToScore (5단계 점수식, `calcOhsorryCore.js:793-799`)
ereter "combined" 방식과 동일하게 클리어한 모든 하위 단계 diff 합산:
- 램프 ≥6 (EX HARD/FULL COMBO) → `ec + hc + exh`
- 램프 =5 (HARD) → `ec + hc`
- 램프 ≥3 (EASY/CLEAR) → `ec`
- FAILED/ASSIST/NO PLAY → 0

---

## 4. mode 분기

`opts.mode` (`'own'`|`'rival'`) + `opts.dbData` + `opts.statsOnly` + `opts.noRender` 조합:

| 모드 | 트리거 | 동작 |
|------|--------|------|
| **own** | eagate 도메인 자동 / `?rival=` 없음 | eagate fetch → ★추정 lib 전부 로드 → 추천 → render → supabase 업로드 |
| **rival** | URL `?rival=<토큰>` 있음 (`ohsorry.js:143`) | `rival_status.html`/`difficulty_rival.html`/`series.html(rival)` fetch. own 과 동일 계산, 라벨만 다름 |
| **DB** | `dbData` 전달 (게스트 페이지/INF) | eagate fetch + ★추정 lib 4종 skip. `charts_json` 사용, ★ 은 row 값 그대로. 비싼 모델 재실행 없음 |
| **statsOnly** | `__dp_render(dbData,{statsOnly:true})` | userVec/recommend/layoutMap 무거운 계산 + supabase 업로드 skip. 통계+노트레이더만 즉시 렌더(`calcOhsorryCore.js:71`, render `:116`) |
| **noRender** | `{noRender:true}` | `show()` 건너뛰고 result 만 반환. 2차 백그라운드 full compute(패턴분석 userVec 만 필요) 시 패널 깜빡임 방지(`:73-74`) |

- INF DB 판별(`calcOhsorryCore.js:947`): `dbData.series==='INF'` 또는 `version` 이 `'INF'` 로 시작. 로그 라벨 + INF 수록 필터 분기에 사용.
- DB 모드는 `dbPayload=null` → render 의 `uploadResult` 가 `opts.dbData` 보면 재업로드 skip(타 유저 열람이므로).

### runFromDb (경량 진입점)
`OhsorryCore.runFromDb(row, opts)` (`calcOhsorryCore.js:1637-1696`) — supabase row 만으로 외부 lib 없이 가벼운 렌더. 게스트 리드미용. 추천곡/상세통계/★비교 섹션은 빈 상태로 graceful 렌더, supabase 재업로드 X.

---

## 5. supabase 업로드 트리거 위치

업로드 판정은 `dbConn.uploadResult(result, opts)` 로 일원화되어 있고, render 는 한 줄 위임만 합니다:
- `ohsorryRender.js:1255-1260` : `show()` 맨 끝에서 `!statsOnly` 이고 `OhsorryDb.uploadResult` 있으면 `await uploadResult(result, {dbData})`.
- 내부에서 ① `opts.dbData` 있으면(타 유저 DB 모드) skip ② `dbPayload` 없으면 skip ③ `upsertUserProfile` ④ `upsertUserChartScores` ⑤ 패턴 점수 계산/upsert. kill-switch(`service-status.json` 의 `uploadEnabled`)는 업로드 2종 진입부에서 fail-closed 체크.

자세한 RPC/페이로드는 [modules.md](modules.md#dbconnjs) 참고.
