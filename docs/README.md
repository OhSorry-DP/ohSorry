# ohSorry 내부 개발 문서

> 오소리 본체(`d:/work/ohSorry`) — IIDX DP ★12 실력 추정 **수집/업로더**(크롤→별값→업로드)의 **내부 동작** 상세 문서.
> 프로젝트가 무엇이고 다른 프로젝트와 어떻게 엮이는지는 상위 조망 문서 [`../../docs/ohSorry.md`](../../docs/ohSorry.md) 를 먼저 보세요.

> **[구조개편 2C, 2026-06-16]** core 는 "크롤→별값→업로드" 전용으로 축소. 렌더·추천·약점분석은 오소리웹·오소리레이팅으로 이관(아래 일부 문서의 추천/렌더 섹션은 "이관됨" 표기).

이 폴더는 "이 repo 내부가 함수/모듈/데이터구조/알고리즘 단위로 어떻게 동작하는가" 만 다룹니다.
변경 이력(changelog)은 repo 루트 [`../CHANGELOG.md`](../CHANGELOG.md) 가 정본입니다.

---

## 문서 인덱스

| 문서 | 다루는 범위 |
|------|------------|
| [architecture.md](architecture.md) | wrapper→core 로딩 구조(모달·프로필·prefetch), 모듈 의존 관계, `compute()` 실행 흐름, own/rival/여러명 분기 |
| [modules.md](modules.md) | core 가 런타임에 쓰는 모듈의 주요 export·책임·입출력 (calcOhsorryCore / eagateFetch / dbConn / normTitle). 이관된 render/recommend/calcWeakness/shelf 는 "이관됨" 표기 |
| [algorithms.md](algorithms.md) | core 가 실제 하는 별값(★) 추정 호출(onlyOSRtoEreter.inferEreter) + dbConn 28차 피쳐 점수. 추천/약점/★-모델 상세는 오소리레이팅 docs 로 위임 |
| [data-pipeline.md](data-pipeline.md) | (아카이브된) 관리자 수집 스크립트, gist 배포 흐름, 데이터 파일 스키마(ereter-data / 외부 lib·patterns·feature-scores) |
| [sp.md](sp.md) | **SP(싱글) 모드** — 모달 DP/SP 탭, SP 는 ★추정 skip 경량 업로드, own·rival 공통 토글(DP만/SP만), `dbConn` `play_style` PK 분리(`scores` SP/DP 공존). 본체는 데이터 생산만, 표시는 웹 |

---

## 빠른 좌표

- **수집/업로더 마스터**: [`modules/calcOhsorryCore.js`](../modules/calcOhsorryCore.js) (`window.OhsorryCore`, VERSION `0.0.407`)
- **wrapper(진입점)**: [`ohsorry.js`](../ohsorry.js) (`v3.5.2`) — gist `2-calc-score.js`·`rivalOhsorry.js`(둘 다 redirect) 가 이 파일로 redirect
- **series 크롤**: [`modules/eagateFetch.js`](../modules/eagateFetch.js) (`v0.0.3`)
- **gist 호스팅**: `OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e` (code 모듈 + 별값 lib + 런타임 데이터 flat 호스팅)
- **Supabase**: `cvxpeecxiawddmrzbdvn` ([`modules/dbConn.js`](../modules/dbConn.js), VERSION `0.0.411`)

> 주의: 모듈 헤더 주석의 버전과 실제 export 객체 `VERSION` 값이 어긋나는 경우가 있습니다(예: dbConn 헤더 주석 `0.0.401` vs 객체 `0.0.411`). **런타임 정본은 객체의 `VERSION`/`version` 값** 입니다.
