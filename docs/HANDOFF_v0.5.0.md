# v0.5.0 중간 저장점 — 작업 미완료

저장일: 2026-11-03 (Asia/Seoul)

- 브랜치: `feat/key-lifecycle-v0.5.0`
- 기준 커밋: `9611fb85282cb51b62ed861982fab4c0af802c00`
- 사용자가 다른 PC에서 이어가기 위해 작업 중단을 요청함. 현재 파일은 디스크에 저장됨.
- 커밋·Push·PR·main 병합·배포를 수행하지 않음. 아래 변경은 로컬 작업 트리에만 있음.
- **v0.5.0 완료 선언 아님.** 문서·버전 정리, 실제 브라우저 검증 및 추가 검토가 남음.

## 저장된 구현

### 서버와 저장소

- `key-store.mjs`: 32바이트 CSPRNG 키(`kg-lab-` 접두사), SHA-256 저장, timingSafeEqual 비교.
- ACTIVE/REVOKED 상태, 활성 키 최대 한 개, 폐기 재활성화 금지, 과거 키 보존.
- `data/lab-state.json`에 키 해시·상태와 감사 기록을 하나의 스냅샷으로 저장. 원문은 발급 응답에서 한 번만 제공.
- 작업 직렬화, 동일 디렉터리 임시 파일·fsync·rename 교체. POSIX에서는 디렉터리 sync도 시도.
- 스키마·중복 ID·감사 이력 재생과 상태 일치 검사. 손상·I/O 장애는 안전하게 실패하고 자동 초기화하지 않음.
- 별도 5 MiB 상한. 감사 저장을 포함한 검증 트랜잭션이 실패하면 인증 200을 반환하지 않음.
- `lab-routes.mjs`: 다음 API를 기존 이벤트 API와 분리.
  - `POST /api/lab/keys/issue`: 최초/재발급, 성공 201
  - `POST /api/lab/keys/revoke`: 성공 200, 반복 폐기 409, 감사 중복 없음
  - `GET /api/lab/keys/status`: 해시·원문 없는 메타데이터
  - `GET /api/lab/resource`: 실제 키 판정 200/401과 별도 VERIFY 감사
  - `GET /api/lab/audit`: 기본 50·최대 100건
- 운영자 헤더: `X-KeyGuard-Operator`. 유효한 `KEYGUARD_OPERATOR_SECRET` 환경변수가 없으면 CLI 서버에서 실습 API 비활성화.
- 운영자 설정은 공백 없는 ASCII 32~256자이며 기존 공개 DEMO_TOKEN을 재사용하지 않음.
- status/audit/issue/revoke 모두 운영자 인증 필요. resource는 관리형 키의 Bearer 인증을 사용.
- Origin이 있으면 이미 검증한 Host의 HTTP Origin과 정확히 같아야 함. Origin 없는 CLI도 관리 API 운영자 인증 필요.
- POST는 JSON·1024바이트·5초 본문 제한과 `confirm:true` 필요. revoke에는 UUID `keyId`도 필요.
- 기존 공개 DEMO_TOKEN, 이벤트 JSONL 9필드·5 MiB, 규칙 엔진과 `local-api.js`는 그대로 유지.

### UI

- `lab-api.js`: 별도 동일 출처 클라이언트. 기존 읽기 전용 LocalApi는 변경하지 않음.
- `lab-ui.js`: Respond 화면의 별도 로컬 키 관리 영역. 운영자 수동 입력, 발급·폐기 확인, 실제 HTTP 검증, 별도 감사 조회.
- 비밀정보를 localStorage/sessionStorage에 저장하지 않음. 페이지 이탈·pagehide·연결 해제에서 메모리/DOM 참조 정리.
- 중복 실행 방지, AbortController, generation, timeout. 응답 유실은 확인 불가로 처리하고 자동 재시도하지 않음.
- 상태·감사 재조회 후에만 다음 작업 가능. 발급 응답이 유실된 원문은 재조회할 수 없으며 명시적 폐기 후 새 발급이 필요할 수 있음.
- 기존 브라우저 모의 사고·감사·CSV는 독립 유지. file://·GitHub Pages에서는 키 관리 비활성화.
- 새 정적 파일 `lab-api.js`, `lab-ui.js`만 허용 목록에 추가.

## 수정/신규 파일

수정:

- `.gitignore`
- `app.js`
- `index.html`
- `server.mjs`
- `styles.css`

신규(미추적 파일이므로 반드시 다음 PC에 함께 복사):

- `key-store.mjs`
- `lab-routes.mjs`
- `lab-api.js`
- `lab-ui.js`
- `tests/key-lifecycle.test.mjs`
- `tests/lab-ui.test.mjs`
- `docs/HANDOFF_v0.5.0.md`

## 현재 검증 결과

중단 시점에 다음 검증을 실행:

- `npm.cmd run check`: 통과. 단, 기존 package 스크립트라 신규 파일은 아직 포함하지 않음.
- 신규 4개 모듈과 신규 2개 테스트를 각각 `node --check`로 별도 실행: 모두 통과.
- `npm.cmd test`: **총 73개 / 통과 73 / 실패 0 / skip 0**.
  - 기존 테스트 56개 유지.
  - 신규 키 수명주기 HTTP 테스트 10개.
  - 신규 클라이언트/UI 테스트 7개(VM DOM + 실제 localhost HTTP 포함).
- `git diff --check`: 통과.
- 테스트는 독립 임시 저장소를 사용하고 종료 시 서버·자식 프로세스·임시 파일을 정리함. 사용자의 기존 데이터는 초기화하지 않음.
- 신규 v0.5.0 흐름의 **실제 브라우저 클릭·레이아웃 검증은 아직 수행하지 않음**. VM 테스트 통과와 구분해야 함.
- Linux 실행, 전원 차단, 실제 OS 크래시 복구는 검증하지 않음.

확인한 HTTP 시나리오:

- 발급 키 200 → 폐기한 키 401 → 재발급 키 200 → 이전 키 계속 401.
- 미등록 키 401, 운영자 인증 실패 시 변경 없음, 동시 발급/폐기 직렬화, 중복 폐기 감사 방지.
- 별도 서버 프로세스 재시작 후 폐기 상태·감사 보존.
- 원문 미저장, 손상된 키/감사 파일 보존, 부분 쓰기·sync·rename 장애, 응답 유실 후 실제 상태 재조회.
- UI 확인 절차, 원문 재조회 불가, timeout 확인 불가, 오래된 응답 배제, 모의/실제 감사 분리.

## 남은 작업 — 다음 PC의 진행 순서

1. 로컬 변경과 신규 파일을 복사한 뒤 브랜치·기준 커밋·파일 누락 여부 확인. Git pull만으로 이 변경을 받을 수 없음.
2. `package.json` 버전을 0.5.0으로 변경하고 오래된 v0.3.0 description 수정. 신규 6개 파일을 check 스크립트에 포함.
   - 현재 package는 **0.4.0**, description은 여전히 v0.3.0이다.
   - server 응답·시작 문구와 index 표시만 0.5.0으로 변경되어 있어 버전 정합성 정리가 필요하다.
3. README·CHANGELOG·ROADMAP·PROJECT_SCOPE·필요 시 UI_SPEC을 실제 구현에 맞춰 갱신. 운영자 환경변수 설정, CLI/UI 절차, 공개 토큰과 관리형 키 차이, 복구 제한, 실패 구간, GitHub Pages 제한 명시.
4. 원자 저장·권한·본문 처리와 UI 비밀정보 수명에 대한 최종 코드 검토. 필요하면 실패한 revoke 후 상태 보존, 추가 초기화 오류 및 감사 저장 실패 경계를 보강.
5. 실제 Chrome/Edge에서 운영자 입력 → 확인 후 발급 → 200 → 확인 후 폐기 → 구 키 401 → 재발급 → 신 키 200 → 구 키 401 → 감사 조회를 검증. 테마·모바일·기존 모의 기능도 확인.
6. 독립 임시 저장소에서 실제 HTTP/브라우저 검증을 재실행. 기존 `data/events.jsonl`·사용자 키 상태를 지우지 말 것.
7. 최종 명령 실행: `npm.cmd run check`, `npm.cmd test`, `git diff --check`, `git status --short`, `git diff --stat`.
8. 요구사항별 완료/미완료를 다시 대조하고 결과만 보고. 사용자 지시 없이 커밋·Push·PR·병합·배포 금지.

## 설계상 제한과 주의할 실패 구간

- 단일 프로세스 파일 소유 전제. 다중 서버 공유나 외부 파일 편집은 지원하지 않음.
- Windows에서는 디렉터리 fsync를 하지 않음. 파일 sync와 rename만으로 전원 차단 시 디렉터리 내구성을 완전 보장한다고 주장하면 안 됨.
- rename 단계 실패는 `LAB_COMMIT_UNCERTAIN`으로 보수적으로 처리. 파일이 바뀌었더라도 성공으로 응답하지 않고 재조회·재시작을 요구.
- 키와 감사는 같은 파일이므로 공통 쓰기 오류는 `LAB_TRANSACTION_FAILED`. 키 파일 손상과 감사 이력 손상은 `KEY_STATE_CORRUPT`/`LAB_AUDIT_CORRUPT`로 구분하지만 물리 쓰기 장애를 두 파일의 독립 오류처럼 표현하지 않음.
- 서버 저장과 HTTP 응답 전달은 원자적이지 않음. 발급 응답 유실 시 키가 ACTIVE일 수 있으며 원문은 복구 불가. 자동 발급 반복 금지.
- 동일 저장소 장애 자체의 감사 영속화는 보장하지 않음. 손상 파일 자동 복구·이전 파일 자동 복원·로그 회전은 없음.
- 감사는 스키마·이력 일치 검증이며 암호학적 변조 방지 로그가 아님. local-operator는 실제 사람의 신원을 확인한 사용자명이 아니라 로컬 실습 역할.
- JavaScript 참조 제거는 메모리의 보안 삭제 보장이 아님. TLS·실제 사용자 인증·운영 환경 권한 통제를 제공한다고 주장하지 말 것.
- 공개 서버 시작 경로는 환경변수를 읽지만, 테스트용 `createLocalServer()` 팩터리는 기본 비활성화. 테스트/임시 서버에는 `keyStore`와 `operatorSecret`을 명시하여 실제 데이터 접근을 피함.

## 다른 PC로 전달

이 문서와 수정/신규 소스 파일을 직접 복사해야 한다. 원격 저장소에는 이번 변경을 올리지 않았다. 운영자 비밀정보나 런타임 data 폴더를 소스 인수인계 자료에 자동 포함하지 않는다. 첨부 요청 원문은 현재 PC의 Codex attachment 경로에 있으므로 필요하면 사용자 요청 원문도 별도로 전달한다.
