# KeyGuard XDR v0.5.0

로컬 교육용 SOC UI입니다. 실제 운영 XDR, 클라우드 수집기, 외부 차단 도구가 아닙니다.

## 실행

Node.js 20 이상에서 실행합니다. 별도 `npm install`은 필요하지 않습니다.

```powershell
cd C:\Users\user\Desktop\SKT\KeyGuard-XDR-v0.5
npm.cmd run check
npm.cmd test
$secret = Read-Host '운영자 비밀정보 (ASCII 32~256자)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
  $env:KEYGUARD_OPERATOR_SECRET = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  npm.cmd start
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  Remove-Variable secret -ErrorAction SilentlyContinue
}
```

`http://127.0.0.1:5173`을 엽니다. 비밀정보를 코드·문서·Git에 고정하지 마세요.

## 기능

- **Detect**: 실제 로컬 HTTP 이벤트와 KG-R001/R002 탐지 결과를 조회합니다.
- **Investigate**: 근거 이벤트·규칙·자산·분석 구간을 연결한 읽기 전용 로컬 탐지 분석입니다.
- **Respond**: 운영자 인증과 명시적 확인 뒤 테스트 키를 발급·폐기·재발급하고 실제 HTTP 200/401을 재검증합니다.
- 모의 사고·모의 대응·CSV 감사 내보내기와 실제 로컬 데이터는 분리됩니다. 모의 대응은 외부 조치를 실행하지 않습니다.
- 모의 실습은 브라우저의 합성 데이터만 변경합니다. 로컬 키 관리는 서버에서 키를 실제로 발급·폐기하고 HTTP 인증을 검증합니다.
- 발급 키 원문은 한 번의 응답으로만 메모리에 보관됩니다. 기본 마스킹, 명시적 보기/가리기, 키보드 접근성을 제공하며 localStorage/sessionStorage에 저장하지 않습니다.
- 발급·폐기·검증 감사 기록을 조회합니다. 응답 유실·시간 초과는 성공으로 추정하지 않고 **확인 불가**로 처리합니다.
- Pearl Lilac 라이트·다크 테마와 모바일 레이아웃을 지원합니다.

## API 계약

일반 이벤트 API는 GET 전용입니다: `GET /api/health`, `GET /api/test/resource`, `GET /api/events?limit=1..100`, `GET /api/detections?limit=1..100`. `/api/test/resource`는 공개 교육용 데모 토큰에 200, 누락 또는 불일치에 401을 반환하고 결과를 이벤트로 기록합니다.

키 수명주기 API는 별도 운영자 인증·명시적 확인이 필요한 POST 계약입니다: `POST /api/lab/keys/issue`, `POST /api/lab/keys/revoke`. 상태·감사는 `GET /api/lab/keys/status`, `GET /api/lab/audit?limit=100`으로, 실제 키 검증은 `GET /api/lab/resource`로 수행합니다.

서버는 `127.0.0.1`에만 바인딩합니다. 키 원문·Authorization 값·비밀번호·개인정보는 이벤트와 감사에 저장하지 않습니다.

## 한계와 검증

실제 Cloud·Endpoint 수집, 운영 키 폐기, 외부 서비스 차단, 자동 대응은 구현하지 않았습니다. KG-R003은 별도 합성 Cloud/Endpoint Fixture의 규칙 검증용이며 실제 JSONL과 일반 탐지 API에 혼합되지 않습니다. 규칙에 해당하지 않는 위험은 이 화면에 표시되지 않을 수 있으며, 결과만으로 PC 전체의 안전 여부를 판단할 수 없습니다.

```powershell
npm.cmd run check
npm.cmd test
git diff --check
git status -sb
```

v0.5.0 기준 자동 테스트는 93개입니다. [프로젝트 범위](docs/PROJECT_SCOPE.md), [UI 명세](docs/UI_SPEC.md), [로드맵](docs/ROADMAP.md), [변경 이력](CHANGELOG.md)을 참고하세요.

## 이벤트 저장소와 장애 정책

이벤트는 `data/events.jsonl`에 JSONL로 누적하며 각 행은 `eventId`, ISO 8601 `timestamp`, `source`, `eventType`, `method`, `path`, `statusCode`, `outcome`, `assetId`를 가집니다. UUID 중복, UTF-8/JSONL 형식, 필수 필드, 파일 크기를 검사합니다. 최대 크기는 5 MiB(5,242,880 bytes)이며, 파일 손상·I/O 오류·용량 초과는 503으로 실패하고 기존 바이트를 보존합니다. 저장 실패를 200/401 성공으로 처리하지 않습니다.

## 탐지와 근거

KG-R001은 같은 자산의 60초 내 실패 5건, KG-R002는 같은 자산의 120초 내 실패 3건 이상 뒤 엄격히 나중 시각의 성공을 MEDIUM 의심 신호로 만듭니다. 사용한 근거는 규칙 안에서 소비해 중복 경고를 억제합니다. 탐지 결과에는 `detectionId`, `ruleId`, `evidenceEventIds`, `analysisWindow`, `reason`, `observedSources`가 포함됩니다. R002는 `successEventId`도 연결합니다. 규칙은 UTC 이벤트 시각을 기준으로 결정적으로 판정하며 침해 확정이나 동일 인물 식별을 주장하지 않습니다.

KG-R003은 동일 자산의 합성 Cloud/Endpoint 이상 이벤트를 300초 내 연결하는 별도 Fixture 검증입니다. 실제 JSONL이나 `/api/detections` 응답에는 섞이지 않습니다.

## 보안 경계

서버는 localhost Host/Origin만 허용하고, 허용되지 않은 경로·메서드는 거부합니다. CORS 전체 허용은 하지 않으며 응답에는 `Cache-Control: no-store`와 same-origin CSP를 적용합니다. 클라이언트 로컬 조회는 GET, `credentials: omit`, `cache: no-store`, `mode: same-origin`, `redirect: error`만 사용합니다. API 오류는 빈 결과로 위장하지 않고, 원본 경로·스택·토큰은 UI와 응답에 노출하지 않습니다.

PowerShell 예시의 환경변수는 서버 종료 뒤 현재 세션에서 정리할 수 있습니다.

```powershell
Remove-Item Env:KEYGUARD_OPERATOR_SECRET -ErrorAction SilentlyContinue
```
