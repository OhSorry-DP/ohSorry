# SP(싱글플레이) 모드 — ohSorry 본체

> **한 줄 요약**: 본체가 eagate 에서 **SP1~12 점수(BEGINNER 제외)**를 크롤해 Supabase `scores` 에 `play_style:0` 으로 적재한다(웹 SP 표시용 데이터 생산). 모달 DP/SP 탭은 **own·rival 공통** — DP 누르면 DP만, SP 누르면 SP만. SP 분기는 DP 별값을 새로 저장하지 않고 기존값을 보존하지만(**경량 업로드**), SP12 클리어 × `cpi.json` 로 **SP 대표 실력값 `sp_cpi`/`sp_star`** 를 산출해 `users` 에 함께 올린다. (2026-06-16 도입 / SP 대표 실력값 2026-06-27, core 0.0.409 / dbConn 0.0.413)

이 문서는 본체의 **SP 분기**만 다룹니다. DP 별값 계산은 [algorithms.md](algorithms.md), 모듈 구조는 [modules.md](modules.md), 로딩 흐름은 [architecture.md](architecture.md) 를 보세요. (추천/약점은 core 에서 제거돼 오소리레이팅 담당.)

- 상위 조망(전체 그림): [../../docs/sp.md](../../docs/sp.md)
- repo 변경 이력(정본): [../CHANGELOG.md](../CHANGELOG.md)

> 본체는 **크롤러/데이터 생산자**입니다. SP 표시·추천·분석은 [오소리웹](../../docs/ohSorryWeb.md)에서 합니다. 본체 산출물은 scores 의 play_style:0 행, users 의 프로필·sp_cpi/sp_star, user_radars, user_ohsorry_radars 의 SP 피쳐 점수입니다.

---

## 1. 진입 — 모달 DP/SP 탭 (own·rival 공통)

[../ohsorry.js](../ohsorry.js) (wrapper) 의 시작 모달에 DP/SP 탭(`__dp_ps_tabs`)이 붙는다. own·rival 구분 없이 **탭이 정한 한 가지만** 크롤·업로드한다.

| 탭 | 동작 |
|----|------|
| **DP** | series 크롤(style=1) → 별값(★) 추정 → 업로드 |
| **SP** | series 크롤(style=0) → 기존 DP 별값 보존 → SP1~12(BEGINNER 제외) 업로드 |

선택은 `compute()` 의 `opts.playStyle`('DP'|'SP') 로 전달. 시리즈 범위(`opts.seriesList`)는 탭과 무관하게 체크박스로 별도 선택. (구버전의 `fetchMode:'level'`/`levels` 는 series 단일화로 폐기.)

---

## 2. SP — 경량 업로드 분기 (`calcOhsorryCore.js:690-834`)

[../modules/calcOhsorryCore.js](../modules/calcOhsorryCore.js) (CORE_VERSION `0.0.414`)

```js
const isSpMode = opts.playStyle === 'SP';   // 모달 SP 탭
const style = isSpMode ? '0' : '1';          // eagate 크롤 style: 0=SP, 1=DP
```

`isSpMode` 면 SP 업로드 분기로 들어가 DP 별값을 새로 저장하지 않습니다. 다만 분기 전에 공통 fullCrawl 별값 호출(:657-672)이 실행될 수 있으며, 그 결과는 SP 프로필 저장에 사용하지 않습니다. 추천/약점은 이미 core 에서 제거됐습니다. 실제 SP 저장 순서는 다음과 같습니다:
1. eagate SP(style=0) series 크롤 → textage 로 SP gameLevel 역추정(`fillGameLevel(charts, true)`).
2. 초기 프로필(users + user_radars) upsert 는 기존 star/ereter_star 조회 성공 시에만 수행합니다. 조회 실패 시 프로필은 건너뛰고 scores 저장은 계속 시도합니다. 초기 sp_cpi/sp_star 는 null 로 보내 기존값을 보존합니다.
3. gameLevel 1~12 & BEGINNER 제외 & 플레이 흔적 있는 행을 play_style:0 으로 전달합니다. dbConn 은 유한한 ex_score > 0 행만 1000행씩 upsert_scores 합니다.
4. scores 저장 시도 뒤 fetchSpChartsForStar(spIidx) 로 DB 전체 SP 기록을 읽고 cpi.json 과 computeSpStarGuarded(없으면 computeUserSpCpi unified fallback)를 사용합니다. 유효 결과만 users.sp_cpi/sp_star 로 2차 upsert 합니다. 기존 DP 별값 조회 실패 시 이 프로필 저장도 건너뜁니다. CPI 입력은 SP12 매칭 차트입니다. 이어서 upsertSpPatternScore 로 SP 36차 피쳐 점수를 계산·저장합니다. 기존 문서의 수식 계약: `sp_cpi` = unified85 원좌표(클리어율 85% 교차 CPI), `sp_star` = `max(unified85★, guardedGaugeAvg50)`(게이지 편향 보정). 표본부족(SP12 클리어 5곡 미만)이면 null.
5. scores 업로드 실패/empty 는 단일 처리에서 완료 박스 대신 alert 합니다. 정상 처리 시 DJ명·SP단위와 SP 리센트 링크(`#user@{id}#ps@SP#tab@recent`)를 표시합니다. suppressDone 시 개별 박스/alert 를 생략하고 wrapper 가 리스트를 표시합니다.

> DP **별값(★) 모델을 SP 에 쓰지 않는 이유**: DP 전용 모델이라 SP 에 직접 적용 못 한다. 대신 SP 는 CPI(클리어율 실력선) 기반의 별도 대표 실력값 `sp_cpi`/`sp_star` 를 쓴다(정본 커널 = ohSorryRating `spSkillCpi.js`). 서열표/피처 등 나머지 표시는 웹이 gist 데이터로 처리한다.

---

## 3. dbConn — `play_style` PK 분리

[../modules/dbConn.js](../modules/dbConn.js) (v0.0.420, `upsertUserChartScores`)

SP/DP 가 **같은 곡·같은 채보·같은 버전**이어도 공존하도록, `play_style` 을 upsert row 와 dedup PK 에 포함했다.

```js
const playStyle = (r.play_style === 0 || r.play_style === '0') ? 0 : 1;  // 기본 1(DP)
const newRow = { song_id, iidx_id, diff, lamp, ex_score, played_version, play_style, date };
const pk = `${songId}|${r.iidx_id}|${diffInt}|${playedVersion}|${playStyle}`;  // 끝에 play_style 추가
// → callRpc('upsert_scores', { p_rows: scoreRows })
```

- `play_style` 없으면 **1(DP)** 취급 → 기존 DP 단독 적재 동작 불변(하위호환).
- SP 행은 calcOhsorryCore 가 `play_style:0` 으로 명시 전달.
- 효과: 오소리웹 RPC 가 `play_style=1`(DP) / `play_style=0`(SP) 로 분리 조회.

---

## 4. 라이벌 — own 과 동일하게 토글대로

[2026-06-16] 라이벌도 own 과 똑같이 **모달 토글대로** 동작한다 — DP 누르면 DP만, SP 누르면 SP만 크롤·업로드.
- 라이벌을 SP 로 보고 싶으면 IIDX input 에 그 사람 ID + SP 탭 → SP series 크롤 → 대상의 `play_style:0` 점수 갱신 + 완료 박스(대상 SP 리센트 카드).
- 구버전의 "DP 분석 후 SP 자동 보강" 블록은 제거됨(이제 토글이 정한 한 가지만).

> 라이벌의 SP·DP 를 둘 다 채우려면 SP 한 번, DP 한 번 따로 실행하면 된다.

---

## 요약표

| 항목 | 값 |
|------|-----|
| 진입 | 모달 DP/SP 탭 (own·rival 공통) |
| SP 크롤 style | `0` (DP=`1`) |
| SP 적재 레벨 | gameLevel 1~12, BEGINNER 제외 (textage 역추정) |
| ★추정(DP 별값) | SP 저장에서는 기존 star/ereter_star 보존. 분기 전 공통 추정 호출은 실행될 수 있으나 그 산출값은 미사용 |
| SP 대표 실력값 | scores 저장 시도 뒤 DB 전체 SP 기록 × cpi.json → sp_cpi/sp_star 유효 결과만 users 에 2차 저장. 조회실패·표본부족 시 기존값 보존 |
| 완료 박스 | own·rival 공통 — DJ명·SP단위 + SP 리센트 카드 버튼 |
| 적재 | scores play_style:0(gameLevel 1~12, BEGINNER 제외), users 프로필·실력값, user_radars, user_ohsorry_radars SP 36차 피쳐 |
| dedup PK | `song_id\|iidx_id\|diff\|played_version\|play_style` |
| 핵심 파일 | ohsorry.js(탭/파싱), calcOhsorryCore.js(0.0.414), dbConn.js(0.0.420) |

> **상태: 구현됨 · 데이터 생산** — SP 점수·프로필·CPI 실력값·36차 피쳐 점수까지 저장합니다. 서열표·추천·분석·배치 표시는 오소리웹 담당([../../ohSorryWeb/docs/sp.md](../../ohSorryWeb/docs/sp.md)).
