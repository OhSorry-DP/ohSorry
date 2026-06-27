# service-status.json 스키마 (cross-repo 계약)

원격 service status 는 운영 중 코드/빌드 변경 없이 업로드·표시를 즉시 제어하기 위한 **단일 gist JSON** 이다.
3개 repo(ohSorry 본체 / ohSorryWeb / INFOhSorry)가 각자 fetch 해서 해석하므로, **필드명·타입·기본값·fail behavior** 를
한 곳에서 못 박아 drift 를 막는 것이 이 문서의 목적이다.

> ⚠️ 이 문서는 **schema alignment(정의 통일)** 용이다. 각 repo 의 fetch 구현(캐시·CORS 우회 등)은 의도적으로 분리돼 있고,
> 합치지 않는다. (본체=`ohSorry/modules/dbConn.js`, 웹=`ohSorryWeb/services/api.js`, INF=`INFOhSorry/src/main/serviceStatus.ts`)

## 소스

- gist(secret): `https://gist.githubusercontent.com/OhSorry-DP/30c3ba6f87df9847291c42ea216a8d2a/raw/service-status.json`
- 운영 방식: **gist 직접 편집**(코드 배포 없이 즉시 반영). 캐시 정책은 repo 별 상이(본체/웹 5분 메모리, INF 무캐시).

## 필드 정의

| 필드 | 타입 | 누락 시 기본값 | 의미 | 소비 repo |
|------|------|----------------|------|-----------|
| `uploadEnabled` | `boolean` | `false`(falsy→차단) | supabase 업로드 허용 토글. false 면 모든 upload skip. | 본체, 웹, INF |
| `shelfEnabled` | `boolean` | `false`(falsy→skip) | 게스트 페이지 grid(서열표) 탭 활성. | 본체, 웹, INF(필드만) |
| `message` | `string?` | (없음) | 차단/점검 시 사용자에게 보일 안내 문구. | 본체, 웹, INF |
| `updatedAt` | `string?` | (없음) | 갱신 시각(운영 메모용, 로직 비사용). | INF(인터페이스), 웹/본체 무시 |
| `notInAC` | `Chart[]?` | `[]` | **AC** 미수록 채보 — 웹 서열표(universe/charts/SP)에서 제외. `diff` 는 콤마 다중 허용(`"DPA,SPA"`). | 웹 |
| `notInINF` | `Chart[]?` | `[]` | **INFINITAS** 미수록 채보 — 추천/서열표에서 제외. `diff` 단일(INF 앱 호환). 웹은 `notInAC` 와 합집합으로 제외. | 웹, INF |
| `showEstimatedBadge` | `boolean?` | `false` | Grid 서열표의 推定(SP fallback 추정곡) 배지 표시 토글. | 웹(grid) |
| `estimatedBadgeText` | `string?` | `"推定"` | 推定 배지 문구. 빈 문자열이면 Grid 에서 배지 숨김. Docs 페이지는 `showEstimatedBadge` 무관하게 항상 표시(문구만 이 값 기준). | 웹(grid+docs) |

### `Chart` (notInAC / notInINF 원소)

```jsonc
{ "title": "GAMBOL", "diff": "DPA" }   // diff = slot 표기
```

- `title`: `string` — 곡명(소비처에서 norm(title) 으로 매칭).
- `diff`: `string` — **slot** 표기(`DPN`/`DPH`/`DPA`/`DPL`/`SPN`/`SPH`/`SPA`/`SPL`).
  - `notInAC`: 콤마 다중 허용 — `"DPA,SPA"`(한 곡의 여러 채보를 한 줄로).
  - `notInINF`: 단일 slot(INF 앱이 콤마 분해 미지원 — 미릴리즈). 웹은 양쪽 다 콤마 분해.

> 참고: 코드 어디에도 `hiddenCharts` 라는 필드는 **없다**. "미수록 채보 제외" 는 위 `notInAC`/`notInINF` 두 필드로 표현된다.

## fail behavior (fail-closed)

세 repo 모두 fetch 실패(네트워크/HTTP 오류) 시 **동일** 객체로 fallback 한다 — 가장 보수적인(차단) 상태:

```js
{
  uploadEnabled: false,
  shelfEnabled: false,
  message: '서비스 상태 확인 실패 — 잠시 후 다시 시도해주세요.',
}
```

- `uploadEnabled=false` → 업로드 전부 차단.
- `shelfEnabled=false` → 서열표 탭 skip.
- 옵셔널 표시 필드(`notInAC`/`notInINF`/`showEstimatedBadge`/`estimatedBadgeText`)는 fallback 객체에 없음
  → 소비처가 각각 기본값(빈 배열 / `false` / `"推定"`)으로 처리(아래 "소비처 가드").

## 소비처 가드(누락 안전 처리)

- 배열 필드: `Array.isArray(status.notInAC) ? status.notInAC : []` 형태로 항상 `[]` fallback.
- 배지 문구: `status.estimatedBadgeText != null ? String(status.estimatedBadgeText) : '推定'`.
- 토글: `!status.uploadEnabled` / `status.shelfEnabled` / `status.showEstimatedBadge` 모두 `undefined` 를 falsy 로 안전 처리.

## 타입 정의 위치

- TS 정본: `INFOhSorry/src/shared/types.ts` 의 `ServiceStatus` / `NotInInfChart`(INF 가 소비하는 부분집합).
- JS JSDoc: `ohSorry/modules/dbConn.js`, `ohSorryWeb/services/api.js` 의 `@typedef {Object} ServiceStatus`(이 문서 참조).
- **필드 추가/변경 시 이 문서를 먼저 갱신**하고, 위 3곳 타입 정의를 맞춘다.
