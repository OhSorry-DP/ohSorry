# data-pipeline — 관리자 수집 스크립트·gist 배포·데이터 스키마

> 관리자 데이터 수집 스크립트(번호 파일), gist 배포 흐름, 런타임 데이터 파일 스키마를 정리합니다.
> 상위 조망: [`../../docs/ohSorry.md`](../../docs/ohSorry.md) · 인덱스: [README.md](README.md)

---

## 1. 관리자 수집 스크립트

> ⚠️ **이 수집 스크립트들은 레포에서 분리·아카이브됨**(`D:\work\dpdata\oldOhSorry`, 2026-06-16) — 더 이상 ohSorry 레포에 없습니다. 수집 정본은 **ohSorryRating**(모델 입력)·**ohSorryAdmin**(운영 자동화). 아래는 옛 구현 기록용. 모두 **브라우저 콘솔 IIFE**(서버 크롤러 아님).

### 1-fetch-ereter.js — ereter.net 추출 (아카이브: `dpdata/oldOhSorry/1-fetch-ereter.js`)
ereter.net 콘솔에서 실행. 도메인 가드 `endsWith('ereter.net')`(`:20`).
- **☆12 난이도 페이지** `/iidxsongs/analytics/perlevel/`(`:16,30-46`): `table.tablesorter`(없으면 첫 `th`가 `☆`인 table)의 행을 파싱. 셀 구조 `☆ | Title | EC diff | HC diff | EXH diff | EC count | HC count | EXH count`.
  - level=cells[0]에서 `☆` 제거 후 float, title/diff(차트종류)=cells[1] span, ec/hc/exh=cells[2..4] **`sort-value` 속성**(반올림 전 원본), ec_n/hc_n/exh_n=cells[5..7] 텍스트(클리어 인구수). push: `{title, diff, level, ec, hc, exh, ec_n, hc_n, exh_n}`(`:117`).
- **유저별 ★ 페이지** `/iidxplayers/`(`:134-182`): 행당 td 4개. `td[2]` href 의 `iidxid=(\d+)`, `td[3]` `sort-value`=그 유저의 ereter 산정 ★. `players[iidxId] = ★`(`:169`).
- **출력**(`:185-192`): `{extractedAt(ISO), source, count, playerCount, charts[], players{}}`. 클립보드 복사(`:196`) + `__ereter_download()` 옵션.

### 3-fetch-zasa.js — zasa 비공식 ☆표 (아카이브: `dpdata/oldOhSorry/3-fetch-zasa.js`)
zasa.sakura.ne.jp 콘솔. 가드 `zasa.sakura.ne.jp`(`:17`). 대상 `/dp/run.php` 의 `table.run`(`:28`).
- 행당 td 4개. tds[0..2]=HYPER/ANOTHER/LEGGENDARIA(span class H/A/L 매핑), tds[3]=곡명. span 텍스트 `☆(\d+) \(([0-9.]+)\)` 에서 gameLevel(정수)·level(decimal) 캡처. **필터 없이** 전부 push: `{title, diff, gameLevel, level}`(`:62`).
- 출력(`:79-86`): `{extractedAt, source, count, countByGameLevel{}, countByDiff{}, charts[]}`. ereter 와 달리 단계별 ★(ec/hc/exh)·players 없음 → 추천/★추정 미사용, **곡수 보강용**.

### 3-fetch-lv12-batch.js / 3-fetch-lv11-batch.js — 학습용 batch (아카이브: `dpdata/oldOhSorry/3-fetch-lv12-batch.js`)
유저별 lamp 분포 수집(모델 학습용). 두 파일은 fetch 경로(`/level/12/` vs `/level/11/`)와 출력 파일명만 다름.
- 하드코딩 IIDX ID 목록(lv12 는 104명), `DELAY_MS = 1500`(폴라이트, 변경 금지 주석).
- `/iidxplayerdata/{id}/level/12/` 순회 fetch, 정규식 SSR 파싱. `parseRow` → `{title, diff, level, rank, exScore, pgreat, great, scorePercent, scoreRank, lampNum, lampText}`.
- 출력: `{collectedAt, source, count, users:[{iidxId, djName, chartCount, charts[]}|{iidxId, error}]}`, **파일 자동 다운로드**(`lv12-batch.json`/`lv11-batch.json`).
- lv11 의 목적: zasa★ 11.6~12.1 인데 게임 LEVEL=11 로 분류된 어려운 차트의 모집단 lamp 분포 보강.

> 루트 `2-calc-score.js`(사용자 실행용 호환 redirect = ohsorry.js fetch+eval)도 레포에서 아카이브됨(`dpdata/oldOhSorry/2-calc-score.js`). **단 gist 의 같은 파일은 유지** — 기존 유저 북마크릿 URL(`.../raw/2-calc-score.js`)의 진입점이라 지우면 안 됨. 수집 스크립트 아님. 운영 자동화 대부분은 ohSorryAdmin 으로 이관.

---

## 2. gist 배포 흐름

- 본체 wrapper/core/dbConn 은 gist raw URL 을 사용합니다. 코드·일반 런타임 데이터의 core gist 는 OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e 에 flat 파일명으로 호스팅되며, service-status.json 은 별도 gist 30c3ba6f87df9847291c42ea216a8d2a 입니다. 현행 publishAsset 는 기본적으로 gist 와 R2 양쪽에 배포하도록 구성됩니다.
- 본체 wrapper/core 의 데이터 로더는 gist raw URL 에 ?t=Date.now() 를 붙입니다. dbConn 의 recomputeAndSaveStar용 lib 로더는 cache:default 로 별도 fetch 합니다. 모든 클라이언트·관리자 호출이 동일한 캐시 우회 규칙인 것은 아닙니다.
- **코드 모듈 배포**: npm run push:gist-modules → ../ohSorryAdmin/scripts/publishAsset.js modules/calcOhsorryCore.js modules/dbConn.js modules/normTitle.js modules/eagateFetch.js. 기본은 flat 파일명 gist PATCH + R2 lib/<파일명>. **북마클릿**: npm run push:bookmarklet → ohsorry.js(gist 전용). 이 문서는 구성 설명이며 배포 실행·라이브 일치를 보장하지 않습니다.
- **런타임 데이터 갱신**: 위 §1의 ereter/zasa 콘솔 수집→gist 웹 UI 절차는 아카이브된 수집 방식입니다. 현재 배포 유틸리티 publishAsset 는 로컬 JSON을 flat 파일명 gist PATCH + R2 data/<파일명> 으로 배포하도록 구성됩니다.
- 본체는 gist core 를 fetch+eval 합니다. 웹·INF 는 core-free 로 필요한 lib/렌더/데이터를 직접 로드하는 별도 소비처이므로, core 1회 갱신이 세 클라이언트의 동일 동작 갱신을 의미하지 않습니다.

> core 가 로드하는 JS lib 은 OSR13.5+.js / onlyOSR.js / onlyOSRtoEreter.js / userRateStar.js / cpiStar.js / spSkillCpi.js 입니다. oldOSR.js / osr.js / adopt.js 는 현재 core 로더 목록에 없습니다([architecture.md](architecture.md)).

---

## 3. 데이터 파일 스키마

### 3.1 런타임 데이터 (gist 정본; 로컬 사본은 아카이브)
> 런타임은 **gist 에서 fetch** 합니다(`.gitignore` 대상이라 레포에 추적 안 됨). 옛 로컬 사본은 `dpdata/oldOhSorry/` 로 이동 — 아래 스키마는 gist 파일 기준.

| 파일 | top-level | 엔트리 | core 용도 |
|------|-----------|--------|-----------|
> **현재 core 로드 목록**: ereter-data.json / textage-meta.json / ohSorryRating.json / cpi.json + JS lib 6종(OSR13.5+/onlyOSR/onlyOSRtoEreter/userRateStar/cpiStar/spSkillCpi). patterns-*·rate-reference·series-name·zasa-data 는 core 미사용. dbConn 은 DP feature-scores-slim.json / SP sp-feature-scores-slim.json 및 별도 gist service-status.json 을 사용합니다.

| 파일 | top-level | 엔트리 | 용도 |
|------|-----------|--------|-----------|
| `ereter-data.json` (gist) | `extractedAt, source, count, playerCount, charts[], players{}` | charts: `{title, diff, level, ec, hc, exh, ec_n, hc_n, exh_n}` / players: `{iidxId: ★}` | **(core)** 별값 추정·매칭·ereter_star 룩업의 정본 |
| `ohSorryRating.json` (gist) | `{ratings:[...]}` | `{title, diff, zasaLevel, gameLevel, estEc, estHc, estExh, nEcCleared...}` | **(core)** 별값 inferEreter 입력 + chartScoreRows.level/lv12 카운트 fallback |
| `textage-meta.json` (gist) | `{generatedAt, count, songs:{id:{...}}}` | `{title, notes:{DN,DH,DA,DX,DB}, levels:{...}, series_no}` | **(core)** series gameLevel 역추정. **(dbConn)** noteCount(피처 scoreRate) |
| `feature-scores-slim.json` (gist) | `{scores:{songId:{chartName:{feat:0~100}}}}` | 차트별 36 feature quantile | **(dbConn)** 36차 feature score upsert |
| `service-status.json` (gist 30c3ba6) | `{uploadEnabled, shelfEnabled, message, notInINF[]}` | — | **(dbConn)** 업로드 kill-switch |
| `zasa-data.json` (gist) | `extractedAt, source, count, …, charts[]` | `{title, diff, gameLevel, level}` | ereter 미등록 차트 곡수 보강 — **core 미사용**(웹/관리자용) |
| `patterns-dp-1112.json` (+0810/rest, gist) | `{songId:{t, c:{DP_NOR,…}}}` | 차트별 28차 패턴 pt | userVec/추천 매칭 — **오소리웹·레이팅 전용**(core 미사용) |
| `rate-reference-slim.json` (gist) | `{ec/hc/exh:{"bucket":{mean,n}}}` | stage×0.5 bucket 평균 EX rate | calcWeakness 잔차 reference — **레이팅 전용**(core 미사용) |
| `series-name.json` (gist 30c3ba6) | `{series_no: name}` | — | 추천 해시태그 시리즈명 — **core 미사용** |

매칭 키는 norm(title) + '|' + diff 입니다(window.OhsorryNorm.norm; calcOhsorryCore.js:483-496). r★ 호출에도 normFn 으로 전달합니다(:886-890).

### 3.2 키 매핑 메모
- diff(eagate) ↔ textage levels(gameLevel 역추정): SP `{NORMAL:'SN',HYPER:'SH',ANOTHER:'SA',LEGGENDARIA:'SX',BEGINNER:'SB'}` / DP `{…:'DN/DH/DA/DX/DB'}` (`calcOhsorryCore.js:594-595`).
- INF 수록 비트(dbConn `getSongsByNorm`): `ac`/`legen` 컬럼의 bit 2(INF), bit 1(AC). LEGGENDARIA 는 legen, 그 외 ac.

### 3.3 학습/내부 데이터 (배포 안 함 — 레포에서 아카이브, `dpdata/oldOhSorry/`)
> 원래 `.gitignore` 대상(미추적)이었고 2026-06-16 에 `D:\work\dpdata\oldOhSorry` 로 물리 이동. 모델 학습 정본은 ohSorryRating.
- `source/`·`source_lv12/` : 학습 데이터(유저별 JSON), `dataset.json`(약 18MB), `loocv-*.json`.
- `logic/` : 모델 코드 v3.0.2~v3.3.6 사본 + `v3-params.json`.
- `scripts/` : 모델 학습/평가/빌드 스크립트(build-v3xx / eval-* / train-loocv 등).
- `archive/` : 버전별 모듈 사본.

### 3.4 package.json
- `name: ohsorry`, `version: 1.0.0`, `main: ohsorry.js`, `type: commonjs`.
- dependencies: iconv-lite ^0.7.2. scripts 는 placeholder test 외에 push:gist-modules / push:bookmarklet 이 있고, 둘 다 ohSorryAdmin/scripts/publishAsset.js 를 호출합니다(모듈은 gist+R2, ohsorry.js 는 gist 전용).

---

## 확인 필요 / 주의

- 과거 README charts 수치와 과거 데이터 스냅샷 count 의 차이는 현행 README 문제로 취급하지 않습니다. 현재 README 에 해당 684/729 수치는 없으며, 라이브 gist 데이터 개수는 이번 읽기 전용 감사에서 검증하지 않았습니다.
- 현재 core 의 별값·SP 커널 소스는 ohSorryRating/modules/ 에 있으며 gist 로 로드합니다. 내부 계수/수식은 해당 정본을 확인하고, 라이브 gist 와의 일치는 별도 검증해야 합니다.
- 외부 노출(gist push / supabase 운영 데이터)을 바꾸는 작업은 이 문서 범위가 아니며, 실제 배포 명령은 README 와 ohSorryAdmin 을 정본으로 따르세요.
