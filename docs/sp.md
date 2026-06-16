# SP(싱글플레이) 모드 — ohSorry 본체

> **한 줄 요약**: 본체가 eagate 에서 **SP10~12 점수**를 크롤해 Supabase `scores` 에 `play_style:0` 으로 적재한다(웹 SP 표시용 데이터 생산). 모달 DP/SP 탭은 **own·rival 공통** — DP 누르면 DP만, SP 누르면 SP만. SP 는 ★추정을 건너뛴 **경량 업로드**. (2026-06-16, core 0.0.407 / dbConn 0.0.411)

이 문서는 본체의 **SP 분기**만 다룹니다. DP 별값 계산은 [algorithms.md](algorithms.md), 모듈 구조는 [modules.md](modules.md), 로딩 흐름은 [architecture.md](architecture.md) 를 보세요. (추천/약점은 core 에서 제거돼 오소리레이팅 담당.)

- 상위 조망(전체 그림): [../../docs/sp.md](../../docs/sp.md)
- repo 변경 이력(정본): [../CHANGELOG.md](../CHANGELOG.md)

> ⚠️ 본체는 **크롤러/데이터 생산자**다. SP 의 실제 표시·추천·분석은 전부 [오소리웹](../../docs/ohSorryWeb.md)(주 소비처)에서 한다. 본체 SP 의 산출물은 오직 **`scores` 테이블의 `play_style:0` 행**.

---

## 1. 진입 — 모달 DP/SP 탭 (own·rival 공통)

[../ohsorry.js](../ohsorry.js) (wrapper) 의 시작 모달에 DP/SP 탭(`__dp_ps_tabs`)이 붙는다. own·rival 구분 없이 **탭이 정한 한 가지만** 크롤·업로드한다.

| 탭 | 동작 |
|----|------|
| **DP** | series 크롤(style=1) → 별값(★) 추정 → 업로드 |
| **SP** | series 크롤(style=0) → ★ skip 경량 → SP10~12 업로드 |

선택은 `compute()` 의 `opts.playStyle`('DP'|'SP') 로 전달. 시리즈 범위(`opts.seriesList`)는 탭과 무관하게 체크박스로 별도 선택. (구버전의 `fetchMode:'level'`/`levels` 는 series 단일화로 폐기.)

---

## 2. SP — 경량 업로드 분기 (`calcOhsorryCore.js:556-606`)

[../modules/calcOhsorryCore.js](../modules/calcOhsorryCore.js) (CORE_VERSION `0.0.407`)

```js
const isSpMode = opts.playStyle === 'SP';   // 모달 SP 탭
const style = isSpMode ? '0' : '1';          // eagate 크롤 style: 0=SP, 1=DP
```

`isSpMode` 면 **★추정 스킵**(추천/약점은 DP·SP 무관하게 이미 core 에서 제거됨)하고 다음만 한다:
1. eagate SP(style=0) series 크롤 → textage 로 SP gameLevel 역추정(`fillGameLevel(charts, true)`).
2. 프로필(users + user_radars) upsert — ★는 새로 안 구하므로 `fetchUserStars` 로 기존 star/ereter_star 조회해 그대로 재전송(없으면 null), dj_name/단위/radar 만 갱신.
3. `gameLevel 10~12` & 플레이 흔적 있는 행을 `play_style:0` 으로 `upsertUserChartScores(spRows)` 업로드.
4. own·rival 모두 **완료 박스**(`__ohsorryShowDone(profile, 'SP')`) — DJ명·SP단위 + 오소리웹 **SP 리센트** 카드 버튼(`#user@{id}#ps@SP#tab@recent`). 여러 명이면 wrapper 가 리스트로(`suppressDone`).

> ★를 거치지 않는 이유: SP 별값 모델이 아직 없다(DP 전용). 본체는 SP **점수만 수집**하고, 표시는 웹이 gist 데이터(서열표/피처/CPI)로 처리한다.

---

## 3. dbConn — `play_style` PK 분리

[../modules/dbConn.js](../modules/dbConn.js) (v0.0.411, `upsertUserChartScores`)

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
| SP 적재 레벨 | gameLevel 10·11·12 (textage 역추정) |
| ★추정 | **SP 는 스킵**(경량, 기존 star 보존) |
| 완료 박스 | own·rival 공통 — DJ명·SP단위 + SP 리센트 카드 버튼 |
| 적재 | `scores` `play_style:0`, gameLevel 10~12 |
| dedup PK | `song_id\|iidx_id\|diff\|played_version\|play_style` |
| 핵심 파일 | `ohsorry.js`(탭/파싱), `calcOhsorryCore.js`(0.0.407), `dbConn.js`(0.0.411) |

> **상태: 구현됨 · 데이터 생산만** — 본체는 SP 점수 수집/적재까지. SP 의 서열표·추천·분석·배치 표시는 오소리웹 담당([../../docs/ohSorryWeb.md], [../../ohSorryWeb/docs/sp.md](../../ohSorryWeb/docs/sp.md)).
