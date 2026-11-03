# KeyGuard XDR v0.5.0 UI 작업 인수인계 — 2026-11-04

## 현재 상태

- 브랜치: `feat/key-lifecycle-v0.5.0`
- 기준 커밋: `c102b80` (`WIP: Implement key lifecycle v0.5.0`)
- 커밋·Push·PR·main 병합·배포는 수행하지 않았습니다.
- 기존 v0.5.0 문서/버전 정리 변경도 작업 트리에 남아 있으므로, 다음 PC에서 초기화·재작성하지 말고 현재 작업 트리를 기준으로 이어서 작업합니다.

## 오늘 완료한 Pearl Lilac 1차 변경

- `styles.css`의 라이트/다크 CSS 토큰을 Pearl Lilac 체계로 교체했습니다.
  - Light: 배경 `#F7F8FD`, 기본 텍스트 `#282B3A`, 라일락 포인트 `#7868E8`, 연한 블루그레이 테두리
  - Dark: 부드러운 차콜·보랏빛 회색 배경 `#20202B`, 카드 `#303043`, 라일락 포인트 `#A496FF`
- 주요 버튼의 기존 Emerald 하드코딩을 토큰 기반 Lilac primary 버튼으로 덮어썼습니다.
- 성공/안전은 초록, 주의는 주황, 위험/오류는 빨강으로 유지했습니다.
- 기존 Moon/Sun 아이콘 전용 테마 버튼, 키보드 접근성, `localStorage['keyguard-xdr-theme-v0.1']` 저장을 유지했습니다.
- UI 정보 구조, 키 관리 흐름, API·저장소, 모의 기능, 문구 대규모 변경은 하지 않았습니다.

## 오늘 수정한 파일

- `styles.css` — Pearl Lilac 토큰과 primary 버튼 색상
- `README.md` — 디자인 시스템 명칭·색상 요약
- `docs/UI_SPEC.md` — 현재 디자인 토큰과 v0.5.0 설명
- `tests/smoke.test.mjs` — Pearl Lilac 토큰 및 기존 테마 아이콘/저장 검증 보강
- 기존 미커밋 v0.5.0 정리 파일: `package.json`, `CHANGELOG.md`, `docs/PROJECT_SCOPE.md`, `docs/ROADMAP.md`

## 실행한 검증

2026-11-04에 다음 검증을 실행했습니다.

```powershell
npm.cmd run check
npm.cmd test
git diff --check
git status -sb
```

- `npm.cmd run check`: pass
- `npm.cmd test`: 73 passed, 0 failed
- `git diff --check`: pass
- `git status -sb`: completed; see final worktree state below.

테스트는 기존 73개를 유지해야 합니다. 색상 변경 뒤에도 테마 저장·다음 동작 aria-label·Moon/Sun 아이콘 CSS 계약을 스모크 테스트가 확인합니다.

## 오늘 확인하지 못한 항목

- 실제 Chrome 데스크톱·모바일 화면의 Pearl Lilac 대비와 레이아웃은 아직 수동 검증이 필요합니다.
- 이 환경에서는 이전 Chrome 헤드리스 GPU 초기화 실패가 있었으므로, 자동 테스트 통과와 실제 시각 검증을 같은 것으로 보고하지 않습니다.
- 모바일 감사 기록의 카드형 전환은 아직 하지 않았습니다.

## 내일 UI/UX 개선 우선순위

1. 초보자 중심으로 Detect / Investigate / Respond의 정보 구조와 안내 순서를 재검토합니다.
2. 중복 버튼과 반복 조작을 줄이되, 키 발급·폐기 확인 단계와 오류 재조회 절차는 유지합니다.
3. 사용자 대상 문구를 한국어 존댓말 또는 명사형으로 일관되게 정리합니다.
4. 테스트 키 원문은 기본 마스킹 UX를 설계·구현합니다. 원문 비저장·일회성 응답 계약은 바꾸지 않습니다.
5. 모바일 감사 기록 가독성을 개선하고 실제 Chrome/Edge에서 라이트·다크·반응형을 확인합니다.
6. 변경마다 기존 73개 이상 회귀 테스트와 사용성 테스트를 유지·보강합니다.

## 반드시 유지할 기능·보안 계약

- Detect / Investigate / Respond의 3개 메뉴, 기존 모의 사고 5건/감사 4건, 시나리오 3종, CSV, 기존 해시 URL 호환
- 로컬 테스트 키의 발급·폐기·재발급, 구 키 401/신 키 200, 중복 폐기 차단, 별도 키 감사
- 키 원문은 서버에 저장하지 않고 발급 응답에서 한 번만 제공. 운영자 비밀정보와 키 원문을 소스·Git·localStorage·sessionStorage에 넣지 않음
- `key-store.mjs`의 단일 스냅샷·직렬/원자 저장·손상 시 fail-closed·응답 유실 시 재조회 계약
- localhost 전용 Host/Origin 제한, 외부 CDN/라이브러리 미사용, 실제 운영 API·키·클라우드 미연결
- 기존 사용자 데이터와 `data/` 런타임 파일을 삭제·초기화하지 않음

## 다른 PC에서 재개하는 방법

1. 현재 작업 폴더 전체(특히 미커밋 변경과 `docs/HANDOFF_v0.5.0.md`, 이 문서)를 복사합니다. 런타임 `data/`와 운영자 비밀정보는 별도로 안전하게 관리하고 Git에 넣지 않습니다.
2. `feat/key-lifecycle-v0.5.0` 및 `c102b80`을 확인한 뒤 `git status -sb`로 전달된 변경 파일을 확인합니다.
3. `npm.cmd run check`, `npm.cmd test`, `git diff --check`를 먼저 실행합니다.
4. 로컬 키 관리 수동 검증 시에만 새 PowerShell 세션에서 32~256자 ASCII 운영자 비밀정보를 `KEYGUARD_OPERATOR_SECRET`으로 설정합니다. 값은 문서·코드·커밋에 기록하지 않습니다.
5. 변경 전후에 테스트 수를 줄이거나 기존 테스트를 약화하지 않습니다. 사용자의 별도 지시 없이 커밋·Push·PR·병합·배포하지 않습니다.
