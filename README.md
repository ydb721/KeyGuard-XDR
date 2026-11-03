# KeyGuard XDR v0.3.0 — Rule-Based Threat Detection

> **Cloud Threat Detection & Response · Stone + Emerald Edition**  
> 독립적인 XDR 콘셉트 웹 UI와 localhost 전용 교육용 HTTP 백엔드

## 프로젝트 목표

클라우드 인증정보 악용과 API 보안 사고를 주제로, 보안 분석가가 이벤트를 확인하고 사고를 분류·조사·대응하는 과정을 재현한다. ALEPH 방어전에서 다룬 XDR 개념을 확장하되 **기존 케셰브 UI·운영 연결과 분리된 별도 프로젝트**다.

이 버전은 **실제 로컬 HTTP 인증 결과를 JSONL에 저장하고, 이벤트 시각 기반 규칙으로 의심 신호를 분석하는 교육용 백엔드**다. v0.1.1 프론트엔드는 그대로 유지하며 API와 연결하지 않았다. 탐지는 침해 확정이 아니며, 키 폐기·재발급, Windows 로그 수집, 실제 Cloud·Endpoint 수집과 외부 클라우드 연결은 미구현이다.

## 실행

### 가장 간단한 방법
1. 이 폴더의 `index.html`을 Chrome에서 연다.
2. 좌측에서 메뉴를 바꾸거나 우측 상단에서 **다크 모드**를 클릭한다.

### 권장: Windows PowerShell + Node.js

```powershell
cd .\KeyGuard-XDR
npm.cmd run check
npm.cmd test
npm.cmd start
```

브라우저에서 `http://127.0.0.1:5173`을 열면 된다. **Node.js 20 이상**이 필요하며 `npm install`은 필요 없다. 종료는 해당 PowerShell 창에서 `Ctrl+C`.

포트를 바꿔야 하는 경우: `$env:PORT=5174; npm.cmd start`.

> `npm.cmd`는 Windows PowerShell에서 스크립트 실행 정책으로 `npm.ps1`이 막히는 상황을 피하기 위한 실행 방식이다.

## 화면 구성

| 화면 | 현재 구현 범위 |
|---|---|
| **보안 현황 (Detect)** | 공통 사고 데이터로 계산한 조사 대기, HIGH 위험도, 대응 완료 KPI와 최근 사고 |
| **사고 분석 (Investigate)** | 사고 검색·심각도/상태 필터, 규칙·증거·MITRE·영향 자산, 조사·모의 대응 상태 전환 |
| **대응 및 검증 (Respond & Verify)** | 3개 모의 시나리오, 대응 결과, 조치 이력과 CSV 저장 |

### 동작 확인 순서

1. **보안 현황 (Detect)**에서 초기 사고 5건과 조사 대기 3건을 확인한다.
2. **대응 및 검증 (Respond & Verify)**에서 `Credential Misuse`를 선택하고 **모의 이벤트 생성**을 누른다.
3. **사고 분석 (Investigate)**에서 `KG-0215`의 근거·자산을 확인하고 검색·상태·심각도 필터를 사용한다.
4. 사고 상세에서 **조사 시작** 후 **모의 대응**을 실행한다.
5. **대응 및 검증**에서 대응 결과와 하단 감사 기록을 확인하고 CSV로 내보낸다. 완료한 사고는 중복 대응할 수 없다.
6. 테마를 전환하고 새로고침 후 테마 유지 여부를 확인한다. 모의 사고 상태는 새로고침 시 초기화된다.
7. **데모 초기화**로 사고 5건·감사 기록 4건을 복원한다. 서버 JSONL 기록은 변경되지 않는다.

## 디자인 시스템

- 기본 **Stone + Emerald Light**: `#F6F5F0` 배경, `#FFFFFF` 카드, `#087C57` 에메랄드 강조.
- **Deep Charcoal + Emerald Dark**: `#171C19` 배경, `#222B25` 카드, `#57D3A0` 에메랄드 강조.
- 심각도는 테마와 구분: High는 적색, Medium은 황갈색, Low는 보조색.
- 화면은 데스크톱 정보 밀도 우선이며 모바일에서는 메뉴 가로 스크롤과 표 가로 스크롤을 지원한다.
- 저장된 테마 키: `localStorage['keyguard-xdr-theme-v0.1']`. 모의 사고 기록은 새로고침하면 초기화된다.

## 파일

```text
KeyGuard-XDR/
├── index.html             # 페이지/컴포넌트 마크업
├── styles.css             # 라이트·다크 디자인 토큰 및 반응형 스타일
├── app.js                 # 시뮬레이션 상태·렌더·상호작용
├── server.mjs             # localhost 전용 정적 서버 + 로컬 API
├── event-store.mjs        # JSONL 검증·직렬 저장·제한 조회
├── rule-engine.mjs        # 순수 함수 기반 이벤트 시각 규칙 분석
├── package.json           # v0.3.0 / 실행·검사 스크립트
├── tests/smoke.test.mjs   # 기존 프론트엔드 회귀 테스트 7개
├── tests/http.test.mjs    # 실제 HTTP 통합 테스트
├── tests/rule-engine.test.mjs # 정상·의심 시나리오 규칙 검증
├── tests/fixtures/cross-source.mjs # 저장소와 분리된 교육용 합성 자료
├── data/events.jsonl     # 런타임 생성, Git 추적 제외
├── previews/              # 브라우저 검토용 화면 이미지
├── docs/PROJECT_SCOPE.md  # 목표 및 구현 범위
├── docs/UI_SPEC.md        # 메뉴 구성·컬러 시스템·상호작용
├── docs/ROADMAP.md        # 이후 실제 보안 기능 개발 순서
├── CHANGELOG.md
├── plan.md                 # ALEPH 계획서 v3
└── README.md
```

## 안전 및 검증 경계

- 입력된 계정·키는 실제 인증정보가 아닌 `sim-...` 식별자다. 비밀번호·비밀키 원문은 저장하지 않는다.
- 앱은 외부 네트워크를 호출하지 않는다. `server.mjs`는 `127.0.0.1`에서 정적 파일과 교육용 API만 제공한다.
- `DEMO`, `모의`, `합성`, `미연결`은 실제 XDR 탐지·조치 성공을 의미하지 않는다.
- `Contained` 상태는 **브라우저의 모의 사고 상태만 변경**하며 실제 키 폐기나 접근 차단 효과를 뜻하지 않는다.
- 정확도·오탐률·미탐률은 측정하지 않았다. 실제 XDR 연동 이후 별도로 측정해야 한다.

## 향후 구현 순서

[docs/ROADMAP.md](docs/ROADMAP.md) 참고. 다음 단계는 v0.4.0 프론트엔드 API 연결이다. 실제 Cloud·Endpoint 수집과 운영 연동은 현재 제공하지 않는다.

## 버전

**v0.3.0** — 2026-11-03: 인증 의심 패턴 탐지 API와 분리된 합성 다중 출처 상관분석. v0.2.0 수집·저장 계약과 v0.1.1 UI를 유지한다.

## 로컬 API 사용

`npm.cmd start` 실행 후 별도 PowerShell에서 호출한다. 공개 데모 토큰은 `sim-keyguard-public-demo-v0.2`이며 실제 서비스 인증 보안을 제공하지 않는다.

```powershell
curl.exe -i http://127.0.0.1:5173/api/health
curl.exe -i -H "Authorization: Bearer sim-keyguard-public-demo-v0.2" http://127.0.0.1:5173/api/test/resource
curl.exe -i http://127.0.0.1:5173/api/test/resource
curl.exe -i -H "Authorization: Bearer sim-wrong" http://127.0.0.1:5173/api/test/resource
curl.exe -i "http://127.0.0.1:5173/api/events?limit=10"
curl.exe -i "http://127.0.0.1:5173/api/detections?limit=10"
```

순서대로 health 200, 인증 성공 200, 인증 실패 401 두 건, 이벤트·탐지 조회 200을 반환한다. 이 예시만으로는 실패 수가 부족해 탐지 결과가 없을 수 있다. health와 조회는 이벤트를 만들지 않는다. `resource` 응답의 `eventId`로 조회 결과와 대응시킬 수 있다.

`GET /api/events`와 `GET /api/detections`는 **localhost 전용 교육용 인터페이스**로 별도 인증 없이 사용한다. 외부 공개·프록시·터널 연결은 지원하지 않는다. 서버는 `127.0.0.1`에만 바인딩하고, Host는 현재 포트의 `127.0.0.1` 또는 `localhost`만 허용한다. Origin 없는 CLI 요청은 허용하고, Origin이 있으면 해당 로컬 HTTP 주소만 허용한다. 외부·`null` Origin은 403이며 CORS 전체 허용은 없다. 모든 앱 응답에 `Cache-Control: no-store`를 적용한다.

- API는 GET만 허용한다(그 외 405). 정적 파일 GET/HEAD와 기존 해시 URL은 유지한다.
- 미등록 경로는 404, 잘못된 URL은 400, Host/Origin 거부는 403이다.
- 조회는 `{ events, count, limit }`이며 최신 **저장 순서**부터 반환한다. 기본 50, 범위 1~100. 잘못된 값·중복 limit·미지원 쿼리는 400이다.
- 이벤트 필드는 `eventId`, `timestamp`, `source`, `eventType`, `method`, `path`, `statusCode`, `outcome`, `assetId`다. UUID v4와 UTC ISO 시각을 서버에서 생성한다.
- 토큰·Authorization 헤더·요청 본문·쿼리 원문·IP·개인정보는 저장하지 않는다. 응답과 콘솔에도 인증정보를 출력하지 않는다.

## 저장소 및 장애 정책

저장 파일은 실행 위치와 무관하게 프로젝트의 `data/events.jsonl`이다. 외부 DB나 클라우드는 사용하지 않는다. 기록은 재시작 후 유지되고 Git 추적과 정적 파일 제공에서 제외된다.

- 파일 크기 상한은 **5 MiB (5,242,880바이트)**다. 다음 이벤트가 상한을 넘기면 파일을 변경하지 않고 `503 EVENT_STORE_FULL`을 반환한다. 자동 삭제·순환·덮어쓰기는 없다. 상한 이내의 기존 이벤트 조회는 계속 가능하다. 이미 상한을 초과한 파일은 health·조회·기록 모두 503이다.
- 시작 시 없는 파일만 배타적으로 새로 생성한다. 기존 파일의 UTF-8, JSONL 줄 구분, 필수 필드·타입·값, 중복 ID를 검사한다. 추가 필드나 미완성 마지막 줄도 손상으로 처리한다.
- 초기화 실패 시 프로세스는 로컬 진단과 기존 UI를 위해 실행하되 API는 503을 반환한다. 손상은 `EVENT_STORE_CORRUPT`, 일반 I/O 장애는 `EVENT_STORE_UNAVAILABLE`로 보고하며 파일 경로·원본 예외는 노출하지 않는다.
- 요청별 이벤트 기록은 읽기·검증·크기 확인·쓰기·디스크 동기화까지 직렬화한다. 저장 완료 후 동일 결과의 200/401을 반환한다. 유효 토큰이어도 저장 실패 시 503이다.
- 손상·I/O 장애를 감지한 저장소는 이후 작업을 중단한다. 기존 바이트를 지우거나 자동 복구하지 않는다. 부분 쓰기가 발생하면 불완전한 마지막 줄이 남을 수 있다. 서버를 종료하고 원본을 별도 백업한 뒤 수동 복구하고 재시작해야 한다.
- 단일 서버 프로세스가 파일을 독점 관리한다. 여러 프로세스 공유와 실행 중 외부 파일 수정은 지원하지 않는다. 파일 저장과 HTTP 전달은 원자적이지 않아 저장 후 연결 종료 시 수신 완료를 보장하지 않는다. 저장 장애 자체의 이벤트 영속화도 보장하지 않는다.

검증은 `npm.cmd run check`, `npm.cmd test`, `git diff --check`로 수행한다. HTTP 테스트는 임시 저장소와 루프백 임시 포트를 사용하며 정상·실패, 동시성, 재시작, 무결성, 저장 장애, 크기 제한, 요청 제한을 검사한다. 기존 UI 회귀 테스트 7개는 변경하지 않았다.

## 규칙 기반 탐지와 중복 정책

`rule-engine.mjs`의 `detectThreats(events)`는 입력을 변경하지 않는 순수 함수다. 서버 현재 시간이 아닌 이벤트의 UTC 타임스탬프로 자산별 분석한다. 시각 오름차순, 동일 시각은 이벤트 ID의 코드 포인트 순서로 처리한다. 분석 구간 경계는 포함하며 구간은 트리거 시각에서 60/120/300초를 뺀 시각부터 시작한다. `detectedAt`은 조회 시각이 아니라 트리거 이벤트 시각이다.

| 규칙 | 조건과 결과 | 근거·중복 방지 |
|---|---|---|
| KG-R001 Authentication Failure Burst | 동일 자산의 실패 5건이 60초 이내: `authentication_failure_burst`, MEDIUM | 오래된 실패를 제외하고 다섯 번째 실패에서 탐지. 그 5건을 소비하여 다음 경고에 재사용하지 않는다. 모두 60초 안의 실패라면 4건은 경고 0건, 5~9건은 1건, 10건은 2건이다. 고정 UTC 분 경계에서 나누지 않는다. |
| KG-R002 Failure Followed by Success | 동일 자산의 120초 이내 실패 3건 이상 후 성공: `suspicious_authentication_sequence`, MEDIUM | 성공보다 시각이 엄격히 앞선 실패만 포함한다. 탐지 시 해당 실패 전체를 소비하므로 후속 성공에 경고를 반복하지 않는다. 조건 미달 성공은 실패를 소비하지 않으며 같은 시각 실패는 미래 성공의 후보로 남긴다. |
| KG-R003 Cross-Source Correlation | 같은 자산의 서로 다른 합성 Cloud·Endpoint 이상 이벤트가 300초 이내: `cross_source_suspicious_activity`, MEDIUM | 시간순으로 가장 가까운 미사용 반대 출처 이상 이벤트와 짝짓고 양쪽을 소비한다. 동일 시각도 허용하며 ID 순서로 결정한다. 정상 이벤트·동일 출처·다른 자산은 짝짓지 않는다. |

R001과 R002의 근거 소비는 각 규칙 내부에서 독립적이므로 동일 실패가 서로 다른 두 규칙의 근거가 될 수 있다. 탐지 ID는 규칙·자산·트리거 시각·정렬된 근거 순서의 SHA-256으로 생성한다. 동일 스냅샷을 반복 분석하거나 입력 배열 순서를 바꿔도 결과와 ID가 같다. 결과는 `detectedAt` 내림차순, 동률이면 ruleId와 detectionId 오름차순이다. 과거 이벤트 추가·수정으로 스냅샷이 바뀌면 근거 묶음과 ID가 달라질 수 있다.

이 규칙은 **의심 신호**다. R002에는 사용자·공격자 식별자가 없으므로 동일 인물의 로그인이라고 단정할 수 없다. 정확도·오탐률·미탐률을 실측하지 않았다.

## 탐지 API와 v0.4.0 연결 계약

`GET /api/detections?limit=10`은 검증된 JSONL **전체**를 내부 `readAll()`로 읽어 분석한 뒤 응답 건수만 제한한다. `/api/events`의 최대 100건 조회 제한이 탐지 근거를 잘라내지 않는다. 기존 9개 필드·5 MiB 상한·직렬화·503 장애 정책은 동일하다. 탐지는 요청 시 재계산하며 결과를 별도 저장하거나 원본에 추가하지 않는다.

```json
{
  "detections": [],
  "count": 0,
  "limit": 10
}
```

각 탐지는 다음 필드를 제공한다.

- `detectionId`, `ruleId`, `ruleName`, `detectionType`, `severity`, `detectedAt`, `assetId`
- `eventCount`, `evidenceEventIds`, `analysisWindow: { start, end, durationSeconds }`
- `reason`, `observedSources`, `synthetic`
- R001/R002의 `failureCount`, R002의 `successEventId`
- R003의 `correlation: { timeDifferenceMs, eventSources: [{ eventId, source }], basis }`

기본 limit은 50, 허용 범위는 1~100이며 `count`는 반환 건수다(전체 탐지 수가 아님). 잘못된 값·중복 limit·알 수 없는 쿼리는 400, 저장소 장애는 503이다. 토큰·헤더 원문·파일 경로·내부 예외는 응답에 포함하지 않는다. v0.4.0은 이 응답과 `/api/events`를 연결할 수 있지만 현재 UI의 사고·감사 기록과 자동 매핑하지 않는다. 오래된 근거의 ID는 제공되지만 개별 이벤트 ID 조회나 페이지네이션은 아직 없다.

재현 예시: 빈 테스트 저장소에서 아래처럼 실패 5회 후 성공을 호출하면 R001과 R002를 확인할 수 있다. 기존 저장소가 있으면 전체 기록에 따라 결과 수가 달라진다.

```powershell
1..5 | ForEach-Object { curl.exe -s http://127.0.0.1:5173/api/test/resource }
curl.exe -s -H "Authorization: Bearer sim-keyguard-public-demo-v0.2" http://127.0.0.1:5173/api/test/resource
curl.exe -s "http://127.0.0.1:5173/api/detections?limit=10"
curl.exe -i "http://127.0.0.1:5173/api/detections?limit=0"
```

## 합성 Cloud·Endpoint 검증의 한계

`tests/fixtures/cross-source.mjs`는 `source: cloud/endpoint`, `eventType: cloud_anomaly/endpoint_anomaly`, `synthetic: true`를 명시한 별도 교육용 자료다. 실제 수집 이벤트가 아니며 v0.2.0 JSONL 9필드 스키마의 확장이 아니다. 실제 저장소는 계속 local-http 인증 이벤트만 허용하고 합성 Fixture를 넣으면 손상으로 거부한다. 일반 `/api/detections`는 Fixture를 로드하지 않으므로 R003을 실제 침해 기록처럼 반환하지 않는다.

아래 명령으로 저장소나 외부 연결 없이 재현할 수 있다.

```powershell
node --input-type=module -e "import {detectThreats} from './rule-engine.mjs'; import {crossSourceFixture} from './tests/fixtures/cross-source.mjs'; console.log(JSON.stringify(detectThreats(crossSourceFixture),null,2))"
```

정상·의심 판정과 60/120/300초 경계, 동일 시각·자산 분리·중복·결정성, 전체 스냅샷 분석, 조회 보안·손상·용량을 자동 테스트한다. 기존 19개 테스트를 유지하고 신규 22개를 추가하여 총 41개다. Linux와 실제 클라우드 환경에서의 동작·성능, 탐지 정확도는 이 로컬 검증으로 보장하지 않는다.
