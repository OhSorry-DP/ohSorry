# SP(싱글플레이) 모드 — ohSorry 본체

> **한 줄 요약**: 본체가 eagate 에서 **SP10~12 점수**를 크롤해 Supabase `scores` 에 `play_style:0` 으로 적재한다(웹 SP 표시용 데이터 생산). 모달에 DP/SP 탭이 생겼고, 본인 SP 는 ★추정·추천을 건너뛴 **경량 업로드**, 라이벌은 DP 분석 후 SP 까지 자동 크롤한다. (2026-06-14, core 0.0.393 / render 0.0.365 / dbConn 0.0.408)

이 문서는 본체의 **SP 분기**만 다룹니다. DP 별값/추천/약점 등 메인 로직은 [algorithms.md](algorithms.md), 모듈 구조는 [modules.md](modules.md), 로딩 흐름은 [architecture.md](architecture.md) 를 보세요.

- 상위 조망(전체 그림): [../../docs/sp.md](../../docs/sp.md)
- repo 변경 이력(정본): [../CHANGELOG.md](../CHANGELOG.md)

> ⚠️ 본체는 **크롤러/데이터 생산자**다. SP 의 실제 표시·추천·분석은 전부 [오소리웹](../../docs/ohSorryWeb.md)(주 소비처)에서 한다. 본체 SP 의 산출물은 오직 **`scores` 테이블의 `play_style:0` 행**.

---

## 1. 진입 — 모달 DP/SP 탭

[../ohsorry.js](../ohsorry.js) (wrapper) 의 시작 모달에 **본인 모드에서만** DP/SP 탭(`__dp_ps_tabs`)이 붙는다.

| 탭 | 동작 |
|----|------|
| **DP** | 기존 모드 — 레벨/전곡 선택 가능, ★추정·추천·약점 전 과정 |
| **SP** | 고정 10·11·12 자동(선택 UI 없음). 선택 시 `resolve({ fetchMode:'level', levels:[12,11,10], playStyle:'SP' })` |

`playStyle:'SP'` 가 `calcOhsorryCore.compute()` 로 전달되어 아래 경량 분기를 탄다. (라이벌은 탭 없이 DP+SP 둘 다 자동 — §4)

---

## 2. 본인 SP — 경량 업로드 분기

[../modules/calcOhsorryCore.js](../modules/calcOhsorryCore.js) (CORE_VERSION `0.0.393`)

```js
const isSpMode = opts.playStyle === 'SP';   // 모달 SP 탭
const style = isSpMode ? '0' : '1';          // eagate 크롤 style: 0=SP, 1=DP
const requestedLevels = isSpMode ? [12, 11, 10] : (…);
```

`isSpMode` 면 **★추정·추천·약점·배치 전부 스킵**하고 다음만 한다:
1. eagate SP(style=0) 페이지에서 10~12 점수 크롤.
2. `gameLevel 10~12` 행을 `play_style:0` 으로 매핑해 `window.OhsorryDb.upsertUserChartScores(spRows)` 자동 업로드.
3. `spMode` 결과 반환 → 렌더는 **경량 패널**(DJ명·SP단위·"오소리웹에서 보기" 이동 버튼)만. ([../modules/ohsorryRender.js](../modules/ohsorryRender.js) VERSION `0.0.365`)

> ★/추천을 거치지 않는 이유: SP 별값 모델·추천 로직이 아직 없다(DP 전용). 본체는 SP **점수만 수집**하고, 표시는 웹이 gist 데이터(서열표/피처/CPI)로 처리한다.

> 과거 `window.OhsorryUploadSP`(결과 패널 'SP 업로드' 버튼, core 0.0.392) 은 SP 모드가 크롤 시점에 업로드를 통합하면서 **제거**됨. 별도 버튼 없이 SP 탭 선택 한 번으로 크롤+업로드.

---

## 3. dbConn — `play_style` PK 분리

[../modules/dbConn.js](../modules/dbConn.js) (v0.0.408, `upsertUserChartScores`)

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

## 4. 라이벌 — DP+SP 자동 크롤

[../modules/calcOhsorryCore.js](../modules/calcOhsorryCore.js) 라이벌 분기:
- 라이벌(`#rival@`)은 **모달 탭 없이** DP 분석/업로드를 마친 뒤, **SP10~12 도 자동 크롤·업로드**(토글 없음, `play_style:0`).
- 표시는 기존 DP 패널 그대로 — SP 별도 패널 없음. SP 행은 오직 웹 SP 표시용 데이터로 쌓는다.

> 목적: 게스트가 오소리웹에서 라이벌의 SP 기록도 볼 수 있게, 본체가 DP 갱신하는 김에 SP 도 같이 채운다.

---

## 요약표

| 항목 | 값 |
|------|-----|
| 진입 | 모달 DP/SP 탭(본인) / 라이벌 자동 |
| SP 크롤 style | `0` (DP=`1`) |
| SP 레벨 | 10·11·12 고정 |
| ★/추천/약점 | **전부 스킵**(경량) |
| 본인 패널 | DJ명·SP단위·웹 이동 버튼만 |
| 적재 | `scores` `play_style:0`, gameLevel 10~12 |
| dedup PK | `song_id\|iidx_id\|diff\|played_version\|play_style` |
| 핵심 파일 | `ohsorry.js`(탭), `calcOhsorryCore.js`(0.0.393), `ohsorryRender.js`(0.0.365), `dbConn.js`(0.0.408) |

> **상태: 구현됨 · 데이터 생산만** — 본체는 SP 점수 수집/적재까지. SP 의 서열표·추천·분석·배치 표시는 오소리웹 담당([../../docs/ohSorryWeb.md], [../../ohSorryWeb/docs/sp.md](../../ohSorryWeb/docs/sp.md)).
