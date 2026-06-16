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

- 단일 secret gist `OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e` 에 모든 파일이 **flat**(경로 없이 파일명만)으로 호스팅.
- 클라이언트/관리자 모두 `gist.githubusercontent.com/.../raw/<파일명>?t=Date.now()` 로 fetch(캐시 우회).
- **코드 모듈 배포**: 로컬 `modules/*.js` → `gh gist edit ... --filename calcOhsorryCore.js modules/calcOhsorryCore.js` 처럼 `--filename` 으로 로컬 path 를 flat 파일명에 매핑. 배포 master 는 `modules/` 아래 파일.
- **런타임 데이터 갱신**: 수집 스크립트로 ereter/zasa 콘솔 실행 → 클립보드 JSON 을 gist 웹 UI 에서 `ereter-data.json`/`zasa-data.json` 편집·붙여넣기·Save(README 는 웹 UI 편집 위주로 문서화).
- 세 클라이언트(본체·웹·INF)가 같은 gist 코어를 fetch+eval 하므로 gist 1회 갱신으로 동시 업데이트.

> 외부 ★추정 lib(oldOSR.js / osr.js / OSR13.5+.js / adopt.js / onlyOSR.js / onlyOSRtoEreter.js)도 같은 gist 에 `.js` 로 올라가며, core 가 `loadWithCache` 로 fetch+eval 합니다([architecture.md](architecture.md#외부-데이터lib-fetch--캐시-loadwithcache)).

---

## 3. 데이터 파일 스키마

### 3.1 런타임 데이터 (gist 정본; 로컬 사본은 아카이브)
> 런타임은 **gist 에서 fetch** 합니다(`.gitignore` 대상이라 레포에 추적 안 됨). 옛 로컬 사본은 `dpdata/oldOhSorry/` 로 이동 — 아래 스키마는 gist 파일 기준.

| 파일 | top-level | 엔트리 | core 용도 |
|------|-----------|--------|-----------|
| `ereter-data.json` (gist) | `extractedAt, source, count, playerCount, charts[], players{}` | charts: `{title, diff, level, ec, hc, exh, ec_n, hc_n, exh_n}` / players: `{iidxId: ★}` | ★추정·추천 baseStar·매칭 점수의 정본 |
| `zasa-data.json` (gist) | `extractedAt, source, count, countByGameLevel{}, countByDiff{}, charts[]` | `{title, diff, gameLevel, level}` | ereter 미등록 차트 곡수 보강(추천/★추정 미사용) |
| `ohSorryRating.json` (gist) | `{ratings:[...]}` | `{title, diff, zasaLevel, gameLevel, estEc, estHc, estExh, nEcCleared...}` | lv11/12 미등록 차트 추정 fallback + EC/HC 추천 풀 |
| `textage-meta.json` (gist) | `{generatedAt, count, songs:{id:{...}}}` | `{title, notes:{DN,DH,DA,DX,DB}, levels:{...}, series_no}` | noteCount/gameLevel 보강 + ALL 통계 분모 |
| `patterns-dp-1112.json` (+0810/rest, gist) | `{songId:{t, c:{DP_NOR,DP_HYP,DP_ANO,DP_LEG}}}` | 차트별 28차 패턴 pt(DP 1P/2P 분리) | userVec 계산 + 추천 매칭 |
| `feature-scores-slim.json` (gist) | `{scores:{songId:{chartName:{feat:0~100}}}}` | 차트별 28 feature quantile | 연습곡 패턴 점수 + 28차 feature score upsert |
| `rate-reference-slim.json` (gist) | `{ec/hc/exh:{"bucket":{mean,n}}}` | stage×0.5 bucket 평균 EX rate(3550명) | calcWeakness absolute 잔차 reference |
| `series-name.json` (gist 30c3ba6) | `{series_no: name}` | — | 추천 해시태그 시리즈명 |
| `service-status.json` (gist 30c3ba6) | `{uploadEnabled, shelfEnabled, message, notInINF[]}` | — | 업로드 kill-switch + INF 미수록 수동 제외 |

매칭 키는 모두 `norm(title) + '|' + diff` (core `norm`, `calcOhsorryCore.js:481-523`).

### 3.2 키 매핑 메모
- diff(eagate) ↔ textage notes: `{NORMAL:'DN', HYPER:'DH', ANOTHER:'DA', LEGGENDARIA:'DX', BEGINNER:'DB'}` (`calcOhsorryCore.js:738`).
- chartName ↔ slot(notInINF): `{DP_NOR:'DPN', DP_HYP:'DPH', DP_ANO:'DPA', DP_LEG:'DPL', SP_*}` (`:1337`).
- INF 수록 비트: `ac`/`legen` 컬럼의 bit 2(INF), bit 1(AC). LEGGENDARIA 는 legen, 그 외 ac.

### 3.3 학습/내부 데이터 (배포 안 함 — 레포에서 아카이브, `dpdata/oldOhSorry/`)
> 원래 `.gitignore` 대상(미추적)이었고 2026-06-16 에 `D:\work\dpdata\oldOhSorry` 로 물리 이동. 모델 학습 정본은 ohSorryRating.
- `source/`·`source_lv12/` : 학습 데이터(유저별 JSON), `dataset.json`(약 18MB), `loocv-*.json`.
- `logic/` : 모델 코드 v3.0.2~v3.3.6 사본 + `v3-params.json`.
- `scripts/` : 모델 학습/평가/빌드 스크립트(build-v3xx / eval-* / train-loocv 등).
- `archive/` : 버전별 모듈 사본.

### 3.4 package.json
- `name: ohsorry`, `version: 1.0.0`, `main: ohsorry.js`, `type: commonjs`.
- dependencies: `iconv-lite ^0.7.2` 하나(eagate EUC-JP 디코딩 추정 — 확인 필요). scripts 는 placeholder `test` 뿐(빌드/배포 스크립트 없음, 배포는 `gh gist edit` 수동).

---

## 확인 필요 / 주의

- README.md 본문의 charts 수치(예 684/729)는 실제 파일(ereter count=731, zasa count=2045)과 어긋남 — README 미갱신.
- ★추정 lib(oldOSR/osr/OSR135/adopt/onlyOSR/onlyOSRtoEreter) 소스는 이 repo 에 없고 gist 전용 → 내부 계수/수식은 lib 측 확인 필요.
- 외부 노출(gist push / supabase 운영 데이터)을 바꾸는 작업은 이 문서 범위가 아니며, 실제 배포 명령은 README 와 ohSorryAdmin 을 정본으로 따르세요.
