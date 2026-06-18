# 토스증권 대시보드 — 자가 개선 개발 루프 마스터 프롬프트

> 이 문서는 **개발용 프롬프트**다. Claude Code의 `/loop` 에 이 파일을 전달하거나,
> 매 반복(iteration)마다 이 프롬프트를 컨텍스트로 주입해 "스스로 평가하고 개선하는 루프"로
> 토스증권 개인 대시보드 + 거래 + 자동거래를 단계적으로 구현하기 위한 것이다.
>
> 사용 예: `/loop docs/dev-loop-prompt.md` (또는 이 파일 내용을 kickoff 프롬프트로 붙여넣기)

---

## 0. 너의 역할과 루프 한 줄 요약

너는 이 저장소에서 **토스증권 Open API 기반 개인 투자 대시보드**를 만드는 자율 개발 에이전트다.
매 반복마다:

1. 상태 파일(`PROGRESS.md`, `EVAL.md`)을 읽고 **현재 위치**를 파악한다.
2. 현재 Phase의 종료 조건을 향한 **가장 작은 다음 증분**을 하나 고른다.
3. 그 증분을 **TDD**로 구현한다(실패 테스트 → 구현 → 통과).
4. **객관 게이트**(lint·typecheck·test·build)를 전부 통과시킨다 — 통과 못 하면 그 반복은 끝나지 않는다.
5. **자기비평 루브릭**으로 결과물을 채점하고 `EVAL.md`에 기록한다.
6. 채점에서 가장 점수가 낮은 축을 **다음 개선 항목**으로 도출한다.
7. `PROGRESS.md`를 갱신하고 반복을 종료한다.

**루프 종료 조건**: 현재 Phase의 모든 종료 조건 충족 **AND** 루브릭 전 축 ≥ 목표 점수 → 다음 Phase로.
모든 Phase 완료 시 루프 종료.

---

## 1. 미션과 산출물

토스증권의 **내 계좌·보유자산·시세·거래내역을 한눈에 보는 대시보드**를 만들고,
이후 **수동 거래**, 최종적으로 **제한적 자동거래**까지 단계적으로 확장한다.

- 사용자: 개발자 본인 1인 (개인용). 멀티테넌트·인증 서버 불필요.
- 데이터 출처: 토스증권 Open API (REST). 웹소켓 없음 → 폴링 기반.

---

## 2. 기술 스택과 아키텍처 제약 (고정)

- **프레임워크**: Next.js 15 (App Router) + TypeScript (strict).
- **시크릿 격리(필수)**: `client_id`/`client_secret`/access token·`X-Tossinvest-Account`는
  **서버(Route Handler / Server Action)에서만** 다룬다. 클라이언트 번들·브라우저·로그에 절대 노출 금지.
  브라우저는 자체 Next API 라우트(`/api/...`)만 호출하고, 그 라우트가 토스 API로 프록시한다.
- **상태/데이터 패칭**: 클라이언트는 SWR 또는 React Query로 폴링. rate limit을 존중하는 폴링 주기.
- **차트**: 가벼운 라이브러리(예: lightweight-charts 또는 recharts) — 후보 평가 후 선택, 선택 근거 기록.
- **테스트**: 단위/통합은 Vitest, E2E·UI 흐름은 Playwright. 토스 API는 **계약(contract) 기반 mock**으로 격리.
- **토큰 관리**: access token 캐싱 + 만료 전 갱신. `oauth2/token` 호출은 rate limit(5/s) 준수.
- **패키지/도구는 최신 문서를 Context7로 확인**하고 쓴다(훈련 데이터 맹신 금지).

> 디렉터리·네이밍은 첫 반복에서 정하고 `PROGRESS.md`에 적은 뒤, 이후 반복은 그 관례를 따른다.

---

## 3. 토스증권 Open API 요약 (캐시된 사실 — 단, `openapi.json`이 최종 진실)

Base: `https://openapi.tossinvest.com` · **REST only** · 시장: 국내(KR) + 미국(US).

**인증 — OAuth2 Client Credentials**
- `POST /oauth2/token` (form-urlencoded: `grant_type=client_credentials`, `client_id`, `client_secret`)
- 모든 호출 헤더: `Authorization: Bearer {access_token}`
- 계좌·자산·주문 호출 추가 헤더: `X-Tossinvest-Account: {accountSeq}`

**엔드포인트 카탈로그 (그룹 · rate limit TPS)**

| 그룹 | 엔드포인트 | 받는 데이터 | TPS |
|---|---|---|---|
| 계좌 ACCOUNT | `GET /api/v1/accounts` | 계좌 목록 | 1/s |
| 자산 ASSET | `GET /api/v1/holdings` | 보유종목·평가금액·손익·일간손익 | 5/s |
| 시세 MARKET_DATA | `GET /api/v1/orderbook` `/prices` `/trades` `/price-limits` | 호가·현재가·체결·상하한가 | 10/s |
| 시세(차트) | `GET /api/v1/candles` | 분봉·일봉 | 5/s |
| 종목 STOCK | `GET /api/v1/stocks` `/api/v1/stocks/{symbol}/warnings` | 종목 마스터·투자경고 | 5/s |
| 시장정보 MARKET_INFO | `GET /api/v1/exchange-rate` `/market-calendar/KR` `/market-calendar/US` | 환율·장 운영 캘린더 | 3/s |
| 주문 ORDER | `POST /api/v1/orders` `/orders/{id}/modify` `/orders/{id}/cancel` | 생성·정정·취소 (지정가/시장가, 금액/수량 기반) | 6/s (09:00–09:10 KST 3/s) |
| 주문조회 ORDER_HISTORY | `GET /api/v1/orders` `/orders/{orderId}` | 주문 목록·상세·체결 | 5/s |
| 주문정보 ORDER_INFO | `GET /api/v1/buying-power` `/sellable-quantity` `/commissions` | 매수가능금액·매도가능수량·수수료 | 6/s (피크 3/s) |

**필수 동작 규칙**
- **Rate limit**: 응답 헤더 `X-RateLimit-Limit/Remaining/Reset` 존중. 429 시 `Retry-After` + 지수 백오프(1→2→4s)+지터, `Remaining` 낮으면 선제 스로틀.
- **에러 모델**: 봉투에 `error.{requestId, code, message, data?}`. `requestId`=헤더 `X-Request-Id`(없으면 `cf-ray`). 코드별 분기 처리.
- **고액 주문**: 1억원 이상은 `confirmHighValueOrder=true` 필요(400 `confirm-high-value-required`).
- **장 운영**: `order-hours-closed`(422), 미국 금액주문은 정규장만(`amount-order-outside-regular-hours`).
- **⚠️ 모의투자(paper) 모드가 문서에 없음 → 모든 주문을 실거래로 간주**. 안전장치(§6)는 타협 불가.

> 매 반복에서 주문/계좌 관련 스키마를 다룰 때는 추측하지 말고
> `https://openapi.tossinvest.com/openapi-docs/latest/openapi.json` 의 실제 스키마를 확인해 검증한다.

---

## 4. 단계별 로드맵 + 종료 조건 (모두 자동 검증 가능)

### Phase 1 — 읽기전용 대시보드
계좌·보유자산·시세·주문내역을 한 화면에서 본다.
- 인증 토큰 발급/캐싱/갱신 모듈 (단위 테스트로 만료·갱신 검증).
- `accounts` → `holdings` → `prices`/`exchange-rate` 조합으로 포트폴리오 요약(총평가액·총손익·일간손익·종목별 비중).
- 주문내역(`orders`) 조회 뷰. 시세(현재가·호가·캔들 차트) 뷰.
- rate-limit 준수 폴링 + 429 백오프.
- **종료 조건**:
  - [ ] mock 계약 테스트로 모든 GET 엔드포인트 클라이언트 통과
  - [ ] 시크릿이 클라이언트 번들에 없음(빌드 산출물 grep으로 검증하는 테스트)
  - [ ] 대시보드가 포트폴리오 요약·보유종목·주문내역·시세를 렌더(Playwright)
  - [ ] lint·typecheck·test·build 전부 green

### Phase 2 — 수동 거래 (기본 dry-run)
주문 생성·정정·취소를 사람이 확인하고 실행.
- 주문 전 `buying-power`/`sellable-quantity`/`commissions`/`price-limits`로 사전 검증.
- **`DRY_RUN` 기본 true**: dry-run이면 실제 `POST`를 보내지 않고 "보낼 요청"을 그대로 보여주고 기록만 한다.
- 실주문은 §6 안전 게이트를 모두 통과해야만 전송.
- `confirmHighValueOrder`·`clientOrderId`(중복방지)·정정/취소 상태(`already-*`) 처리.
- **종료 조건**:
  - [ ] dry-run에서 주문 생성/정정/취소 요청 페이로드가 API 계약과 일치(테스트)
  - [ ] 실주문 경로는 확인 게이트 없이는 도달 불가능(테스트로 증명)
  - [ ] 사전검증 실패(잔고부족·틱사이즈·장마감) 케이스 처리 테스트
  - [ ] lint·typecheck·test·build green

### Phase 3 — 제한적 자동거래
규칙 기반 전략이 주문을 제안/실행하되, 하드 리밋·kill switch 뒤에서만.
- 전략 모듈은 시세·보유·주문정보를 입력받아 **주문 의도(intent)** 를 산출(순수 함수, 결정적, 테스트 용이).
- 실행기(executor)는 의도를 §6 한도 안에서만 주문으로 변환. 한도 초과·kill switch ON이면 거부+기록.
- 모든 자동 결정에 대한 감사 로그(audit log): 입력 스냅샷·의도·실행/거부 사유.
- **종료 조건**:
  - [ ] 백테스트/시뮬레이션 하네스로 전략을 과거·합성 데이터에 대해 결정적으로 검증
  - [ ] 한도 위반·kill switch 시 실행 거부됨을 증명하는 테스트
  - [ ] 모든 자동 주문 경로가 dry-run 기본 + 명시적 활성화 없이는 실주문 불가(테스트)
  - [ ] lint·typecheck·test·build green

---

## 5. self-evaluating loop 프로토콜 (객관 게이트 + 자기비평)

### 5.1 객관 게이트 (이게 1차 종료 신호 — 통과 못 하면 반복 미완료)
```
1) lint        — 통과
2) typecheck   — 통과 (TS strict, no any 남발)
3) test        — 신규/변경 동작에 대한 테스트 추가 후 전부 통과
4) build       — 프로덕션 빌드 성공
```
하나라도 실패하면 **근본 원인**을 고친다(테스트를 무력화하거나 skip하지 않는다).

### 5.2 자기비평 루브릭 (매 반복 끝에 1~5점 채점 → `EVAL.md` 기록)
| 축 | 무엇을 보는가 | 목표 |
|---|---|---|
| Functionality | 이번 증분이 Phase 종료 조건을 실제로 전진시켰나 | ≥4 |
| API 정합성 | 요청/응답이 `openapi.json` 계약과 일치하나 | ≥4 |
| Safety | 거래 안전장치(§6)가 우회 불가능하게 유지되나 | **5 (타협 불가)** |
| Security | 시크릿 격리·로그 비노출·입력 검증 | **5 (타협 불가)** |
| UX | 대시보드가 의도한 정보를 명확히 보여주나 | ≥3 |
| Code quality | 외과적 변경·작은 단위·중복 없음·읽기 쉬움 | ≥4 |

### 5.3 반복 절차 (의사코드)
```
read(PROGRESS.md, EVAL.md)                 # 현재 위치 + 직전 개선 항목
pick = smallest_increment_toward(current_phase_exit_criteria)
write_failing_test(pick); implement(pick); make_test_pass()
run_objective_gates()                      # 실패 시 근본원인 수정 후 재실행
scores = self_critique(rubric)             # §5.2
append(EVAL.md, {iteration, pick, scores, lowest_axis, next_action})
update(PROGRESS.md, {done, in_progress, next})
if all(current_phase_exit_criteria) and all(scores >= targets): advance_phase()
```

### 5.4 상태 파일 포맷
**`PROGRESS.md`** — 현재 Phase, 완료 항목 체크리스트, 진행 중 항목, 다음 항목, 확정된 아키텍처 결정.
**`EVAL.md`** — 반복별 한 줄 로그: `#N | phase | 한 일 | 점수(6축) | 최저축 | 다음 개선`.

> 두 파일은 루프의 메모리다. 매 반복 **반드시 먼저 읽고, 끝에 갱신**한다. 과거 시행착오는 누적하지 말고 현재 상태만 기록한다.

---

## 6. 거래 안전장치 (CRITICAL — 어떤 경우에도 약화 금지)

실거래 계좌 = 실제 돈. 모의투자 모드가 없으므로 코드 레벨에서 막는다.

1. **DRY_RUN 기본값 = true**. 환경변수로만 끌 수 있고, 끄려면 추가로 §6.2 확인 게이트를 통과해야 한다.
2. **실주문 확인 게이트**: 모든 실제 `POST /orders*` 는
   - (a) `DRY_RUN=false` **그리고**
   - (b) 명시적 확인 토큰(예: 사람이 입력한 확인값 / 명시 flag) **그리고**
   - (c) 한도 검사 통과
   세 가지가 모두 참일 때만 전송. 하나라도 거짓이면 dry-run으로 강등하고 기록.
3. **하드 리밋** (환경변수/설정): 1회 최대 주문금액, 일일 누적 주문/손실 한도, 종목당 최대 포지션 비중.
4. **Kill switch**: ON이면 모든 실주문 경로 즉시 차단(자동거래 포함). 테스트로 증명.
5. **고액 주문**: 1억원 이상은 명시적 `confirmHighValueOrder=true` 없이는 전송 금지.
6. **멱등성**: `clientOrderId`로 중복 주문 방지(`request-in-progress`/`already-*` 처리).
7. **감사 로그**: 모든 주문 시도(전송/강등/거부)를 입력·사유와 함께 남긴다. 단, 시크릿·PII 제외.

---

## 7. 보안

- 시크릿(`client_id`/`client_secret`/token/`accountSeq`)은 **환경변수/시크릿 매니저**. 코드·로그·커밋·테스트 픽스처에 하드코딩 금지.
- `.env`는 `.gitignore`, `.env.example`만 커밋. 누락 시 fast-fail.
- 클라이언트 번들·콘솔·네트워크 응답에 시크릿/토큰 노출 금지(빌드 산출물 검사 테스트로 회귀 방지).
- 외부 입력(주문 파라미터 등)은 서버 경계에서 스키마 검증(zod 등).
- 노출 사고 시 즉시 **rotate** (코드 수정만으론 부족).

---

## 8. 작업 규율 (가드레일)

- **외과적 변경**: 이번 증분과 무관한 인접 코드·스타일·import 순서를 건드리지 않는다. 한 반복 = 한 목적.
- **검증 후 완료 선언**: "동작 확인" 주장은 실제 게이트 출력 + 테스트 결과로만. UI는 가능하면 Playwright로 확인, 불가하면 "UI 검증 미완료" 명시.
- **근본 원인**: 실패는 try-catch 도배가 아니라 원인 수정. broad catch 금지.
- **git**: 커밋/푸시는 **사용자의 명시적 허가가 있을 때만**. 루프가 임의로 commit/push하지 않는다(원하면 변경 요약만 보고).
- **모호하면 멈추고 질문**: 요구가 갈리면 해석을 나열해 묻는다. 조용히 하나 고르지 않는다.

---

## 9. 첫 반복 시작점 (부트스트랩)

`PROGRESS.md`/`EVAL.md`가 없으면:
1. Next.js 15 + TS(strict) + Vitest + Playwright 스캐폴드, lint/typecheck/test/build 스크립트 확정.
2. `.env.example`(토스 API 키 자리) 작성, 시크릿 격리 구조(서버 전용 모듈) 세움.
3. `PROGRESS.md`(Phase 1 체크리스트)·`EVAL.md`(빈 로그) 생성.
4. 첫 증분으로 **OAuth 토큰 발급/캐싱 모듈 + 단위 테스트**(실패 테스트부터).
5. §5 절차대로 게이트 통과 → 자기채점 → 상태 갱신.
