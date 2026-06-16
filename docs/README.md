# ohSorry 내부 개발 문서

> 오소리 본체(`d:/work/ohSorry`) — IIDX DP ★12 실력 추정 + 추천곡 계산 코어의 **내부 동작** 상세 문서.
> 프로젝트가 무엇이고 다른 프로젝트와 어떻게 엮이는지는 상위 조망 문서 [`../../docs/ohSorry.md`](../../docs/ohSorry.md) 를 먼저 보세요.

이 폴더는 "이 repo 내부가 함수/모듈/데이터구조/알고리즘 단위로 어떻게 동작하는가" 만 다룹니다.
변경 이력(changelog)은 repo 루트 [`../CHANGELOG.md`](../CHANGELOG.md) 가 정본입니다.

---

## 문서 인덱스

| 문서 | 다루는 범위 |
|------|------------|
| [architecture.md](architecture.md) | wrapper→core→render 로딩 구조, 모듈 의존 관계, `compute()` 실행 흐름, own/rival/DB(statsOnly/noRender) mode 분기 |
| [modules.md](modules.md) | 각 모듈의 주요 export 함수/객체·책임·입출력 데이터 구조 (calcOhsorryCore / recommend / calcWeakness / dbConn / render / eagateFetch / normTitle / shelf) |
| [algorithms.md](algorithms.md) | 별값(★) 추정(onlyOSR/onlyOSRtoEreter, adopt fallback), 추천곡 파이프라인(buildPools→8 component 가중합→sample15→8배치), 28차 피쳐 점수, 약점 분석(calcWeakness)의 단계·가중치·임계값 |
| [data-pipeline.md](data-pipeline.md) | 관리자 수집 스크립트(1/3 번호 파일), gist 배포 흐름, 데이터 파일 스키마(ereter-data / zasa-data / 외부 lib·patterns·feature-scores) |
| [sp.md](sp.md) | **SP(싱글) 모드** — 모달 DP/SP 탭, 본인 경량 SP 크롤(★/추천 스킵), 라이벌 DP+SP 자동 업로드, `dbConn` `play_style` PK 분리(`scores` SP/DP 공존). 본체는 데이터 생산만, 표시는 웹 |

---

## 빠른 좌표

- **마스터 계산 모듈**: [`modules/calcOhsorryCore.js`](../modules/calcOhsorryCore.js) (`window.OhsorryCore`, VERSION `0.0.395`)
- **wrapper(진입점)**: [`ohsorry.js`](../ohsorry.js) (`v3.4.0`) — gist `2-calc-score.js`(아카이브됐지만 gist 는 유지) 가 이 파일로 redirect
- **gist 호스팅**: `OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e` (계산 모듈 + 런타임 데이터 flat 호스팅)
- **Supabase**: `cvxpeecxiawddmrzbdvn` ([`modules/dbConn.js`](../modules/dbConn.js), VERSION `0.0.410`)

> 주의: 모듈 헤더 주석의 버전과 실제 export 객체 `VERSION` 값이 어긋나는 경우가 있습니다(예: ohsorryRender 헤더 `v0.0.378` vs 객체 `0.0.363`). **런타임 정본은 객체의 `VERSION`/`version` 값** 입니다.
