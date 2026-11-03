# Changelog

## v0.2.0 — 2026-11-03

### Added
- localhost 전용 health·인증 테스트 resource·이벤트 조회 API
- 공개 교육용 토큰에 따른 실제 200/401 결과와 일치하는 UUID·UTC 이벤트
- JSONL 영속 저장, 직렬 쓰기와 동기화, 재시작 후 조회 및 고유 ID 검사
- 5 MiB 파일 상한, 무결성·I/O 장애 503, 기존 파일 보존 및 수동 복구 정책
- Host/Origin·메서드·경로 제한, no-store, 조회 기본 50·최대 100건
- 별도 실제 HTTP 통합 테스트: 동시 요청, 프로세스 재시작, 장애 주입, 손상·상한·비밀정보 제외 검증

### Changed
- package 버전 0.2.0, 신규 모듈·테스트 문법 검사 포함
- README의 시연 절차를 현재 3개 화면 기준으로 수정하고 API·저장소 정책 문서화
- 이벤트 파일 Git 추적 제외

### Preserved / Not implemented
- app.js·index.html·styles.css·기존 스모크 테스트 7개 유지, 프론트엔드 API 연결 없음
- 자동 탐지·상관분석, 키 폐기·재발급, 외부 클라우드 연결은 미구현

## v0.1.1 — 2026-11-02

### Changed
- 6개 메뉴를 Detect(보안 현황) / Investigate(사고 분석) / Respond & Verify(대응 및 검증)로 통합
- 탐지 규칙·자산 정보를 사고 상세에 통합하고, 감사 이력을 대응 화면에 통합
- KPI를 조사 대기·고위험·대응 완료의 공통 사고 상태 계산으로 단순화
- 기존 URL `#rules`, `#assets`, `#audit`의 안전한 새 업무 화면 연결 추가
- 기존 3개 합성 시나리오, 상태 변경, 중복 대응 방지, CSV, 테마를 유지

### Fixed
- UI 통합 과정에서 의도치 않게 줄어든 초기 합성 사고(5건)와 감사 기록(4건)을 복구
- VM 기반 실행형 회귀 테스트를 복구해 시나리오·필터·상태 전환·감사 기록·테마·URL 호환을 검증

## v0.1.0 — 2026-11-01

### Added
- Stone + Emerald 라이트 기본 테마
- 차콜 + Emerald 다크 모드와 테마 선택 저장(지원 브라우저)
- Overview / Incidents / Detection Rules / Assets / Response Lab / Audit Log
- 합성 사고 시나리오 3개 및 감사 로그 기록
- 사고 검색·필터·상태 전환·감사 CSV 내보내기
- Node.js 기본 정적 프리뷰 서버 (127.0.0.1 전용)
- 자동 스모크 테스트 및 설계·제출 범위 문서

### Known limitations
- 실제 XDR 탐지 엔진, 실시간 데이터 수집 및 키 폐기는 미구현
- 브라우저 새로고침 시 합성 사고 상태 초기화
- 외부 API/DB 연결 없음
