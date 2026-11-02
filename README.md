# KeyGuard XDR v0.1.1 — Minimal SOC UI

> **Cloud Threat Detection & Response · Stone + Emerald Edition**  
> 독립적인 XDR 콘셉트 웹 UI, 교육용 시뮬레이션 전용

## 프로젝트 목표

클라우드 인증정보 악용과 API 보안 사고를 주제로, 보안 분석가가 이벤트를 확인하고 사고를 분류·조사·대응하는 과정을 재현한다. ALEPH 방어전에서 다룬 XDR 개념을 확장하되 **기존 케셰브 UI·운영 연결과 분리된 별도 프로젝트**다.

이 버전은 **UI/UX와 상태 전환을 검증하는 v0.1.1 프론트엔드 시제품**이다. 실제 탐지 엔진, API 키 폐기, Windows 로그 수집, 보안 정책 적용, 클라우드 접속은 구현되지 않았다.

## 실행

### 가장 간단한 방법
1. 이 폴더의 `index.html`을 Chrome에서 연다.
2. 좌측에서 메뉴를 바꾸거나 우측 상단에서 **다크 모드**를 클릭한다.

### 권장: Windows PowerShell + Node.js

```powershell
cd .\KeyGuard-XDR-v0.1
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

1. **Overview**의 대기 사고 건수를 확인한다.
2. **Response Lab**에서 `Credential misuse`를 선택하고 **모의 이벤트 생성 및 분석 실행**을 누른다.
3. **Incidents**에서 `KG-0215` 사건과 탐지 근거를 확인한다.
4. **Response Lab**에서 **모의 조치 및 결과 확인**을 실행한다.
5. **Audit Log**에서 Simulation / Detection / Response 기록을 확인한다.
6. **Assets**에서 새 `demo-payment-api` 자산이 추가되었는지 확인한다.
7. **다크 모드** 버튼으로 화면을 바꾸고 새로고침한 뒤 테마 유지 여부를 확인한다.
8. 상단 **데모 초기화**를 눌러 사건·기록을 초기 상태로 되돌린다.

## 디자인 시스템

- 기본 **Stone + Emerald Light**: `#F6F5F0` 배경, `#FFFFFF` 카드, `#087C57` 에메랄드 강조.
- **Deep Charcoal + Emerald Dark**: `#171C19` 배경, `#222B25` 카드, `#57D3A0` 에메랄드 강조.
- 심각도는 테마와 구분: High는 적색, Medium은 황갈색, Low는 보조색.
- 화면은 데스크톱 정보 밀도 우선이며 모바일에서는 메뉴 가로 스크롤과 표 가로 스크롤을 지원한다.
- 저장된 테마 키: `localStorage['keyguard-xdr-theme-v0.1']`. 모의 사고 기록은 새로고침하면 초기화된다.

## 파일

```text
KeyGuard-XDR-v0.1/
├── index.html             # 페이지/컴포넌트 마크업
├── styles.css             # 라이트·다크 디자인 토큰 및 반응형 스타일
├── app.js                 # 시뮬레이션 상태·렌더·상호작용
├── server.mjs             # localhost 전용 정적 미리보기 서버
├── package.json           # v0.1.0 / 실행·검사 스크립트
├── tests/smoke.test.mjs   # Node 내장 테스트
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
- 앱은 외부 네트워크를 호출하지 않는다. `server.mjs`도 `127.0.0.1`에서 정적 파일만 제공한다.
- `DEMO`, `모의`, `합성`, `미연결`은 실제 XDR 탐지·조치 성공을 의미하지 않는다.
- `Contained` 상태는 **브라우저의 모의 사고 상태만 변경**하며 실제 키 폐기나 접근 차단 효과를 뜻하지 않는다.
- 정확도·오탐률·미탐률은 측정하지 않았다. 실제 XDR 연동 이후 별도로 측정해야 한다.

## 향후 구현 순서

[docs/ROADMAP.md](docs/ROADMAP.md) 참고. 다음 실개발 단계는 **테스트 API 서버에서 이벤트를 생성해 저장하고, 프론트엔드의 합성 사건 대신 실제 테스트 로그를 조회**하는 것이다.

## 버전

**v0.1.1** — 2026-11-02: Minimal SOC UI, 3개 업무 흐름, 브라우저 시뮬레이션, 테스트/문서 제공.
