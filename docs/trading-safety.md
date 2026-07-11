# 거래 안전 & 보안 (§6)

실거래 계좌 = 실제 돈. 모의투자 모드가 없으므로 **코드 레벨에서 막는다.** 이 문서가 거래 안전 불변식의 **단일 진실**이다.

> **불변식(메타 가드)**: 이 §6의 안전 상수(DRY_RUN 기본값·한도·kill switch)와 관련 테스트는 **임의로 변경·완화·skip할 수 없다.** 변경하려면 사람의 명시적 승인이 필요하고, 안전 관련 파일(`lib/server/trading/**`) 변경이 감지되면 작업을 중단하고 보고한다. **종료 압박을 이유로 안전장치를 낮춰 게이트를 통과시키는 것은 금지**된다.

## §6 거래 안전장치 (CRITICAL — 약화 금지)

1. **DRY_RUN 기본값 = true**. 환경변수로만 끌 수 있고, 끄려면 추가로 §6.2 확인 게이트를 통과해야 한다.
2. **실주문 확인 게이트**: 모든 실제 `POST /orders*`는 (a) `DRY_RUN=false` **그리고** (b) 승인 **그리고** (c) 한도 검사 통과일 때만 전송. 하나라도 거짓이면 dry-run으로 강등하고 기록.
   - **수동거래(Phase 2)**: (b)는 *주문 단위로 사람이 입력하는* 확인값.
   - **자동거래(Phase 3)**: (b)는 사람이 사전에 out-of-band로 부여한 활성화 승인(`AUTO_TRADE_ENABLED`) + §6.3 한도 + §6.4 kill switch로 갈음한다(주문 단위 사람 확인 생략). 단, **에이전트가 자기 자신에게 확인 토큰/승인을 발급하는 것은 절대 금지.**
3. **하드 리밋**(환경변수): 1회 최대 주문금액(`MAX_ORDER_AMOUNT`, 미설정 시 실주문 차단=fail-safe)을 `evaluateOrderGate`가 집행한다. *후속(아직 게이트 미집행)*: 일일 손실 한도(`DAILY_LOSS_LIMIT`는 config에 로드되나 `safety.ts`에서 미집행), 종목당 최대 포지션 비중(현재 SELL 전략 생성기에만 존재하며 §6 게이트가 아님).
4. **Kill switch**(`KILL_SWITCH`): ON이면 모든 실주문 경로 즉시 차단(자동거래·취소 포함). 테스트로 증명.
5. **고액 주문**: 1억원 이상은 명시적 `confirmHighValueOrder=true` 없이는 전송 금지.
6. **멱등성**: `clientOrderId`는 재시도 시 그대로 보존해 전달하고, 중복 주문 판정 자체는 Toss가 `request-in-progress`/`already-*` 응답으로 수행한다(로컬에 별도 dedup 저장소는 없음). **dry-run으로 강등된 시도는 `clientOrderId`를 발급·소비하지 않는다**(이후 실주문 재시도 시 오판 방지).
7. **감사 로그**: 모든 주문 시도(전송/강등/거부)를 입력·사유와 함께 콘솔 + `trading_audit` SQLite 테이블에 secret-free 요약으로 영속한다(`lib/server/trading/audit-store.ts`). 단, 시크릿·PII 제외.

### 주문 결과 판정

`POST /orders*`가 로컬 게이트에서 `SENT`가 되거나 Toss가 200을 반환해도 이는 **실제 POST 전송/주문 생성 완료**다. 체결 성공은 별도 판정한다.

- 생성 응답의 `orderId`를 저장하고 `GET /orders/{orderId}`로 상세를 조회한다.
- `FILLED`만 전량 체결 완료로 본다.
- `PARTIAL_FILLED`와 취소·거부·정정 계열 상태는 `execution.filledQuantity`를 확인해 부분 체결 여부를 판단한다.
- 응답 유실/타임아웃 후 재시도는 같은 `clientOrderId`로만 수행한다. 새 id로 재시도하면 중복 주문 위험이 있다.

### 통화-인지 notional

notional 한도 검사는 통화를 추론한다 — KRX 심볼(`^\d[0-9A-Z]{5}$`, 즉 숫자로 시작하는 6자리: 신형 영문 내장 코드 `0167A0` 등 포함)=KRW, 그 외=USD. USD 주문은 `fxRate`로 KRW 환산하며, **USD인데 fxRate가 없으면 BLOCK(fail-safe)**. (notional 계산 불가 시에도 BLOCK.)

### 구현 위치

`lib/server/trading/safety.ts` — `getTradingConfig`/`evaluateOrderGate`(순수 게이트, fail-safe 평가 순서: 차단 우선) + `placeOrder`(DI 실행기). `createOrderRaw`/`modifyOrderRaw`/`cancelOrderRaw`는 **ungated 저수준, 직접 노출 금지**. 라우트/실행기는 게이트를 호출만 하고 무수정한다.

## §6.A 어드바이저 고유 불변식 (구현)

> 어드바이저(Phase 4)는 §6에 **더해** 아래를 지킨다.

1. **LLM 출력은 제안일 뿐 명령이 아니다.** `lib/server/advisor/**`·`app/api/advisor/**`는 `placeOrder`/`createOrderRaw`를 import·호출하지 않는다(grep + 의존성 테스트로 증명). 제안 → 사람이 "폼에 담기" → dry-run → **사람 confirm** → 기존 §6 게이트. LLM은 §6보다 철저히 **상류**에 위치한다.
2. **에이전트/LLM 자가 확인 금지.** LLM이 confirm 토큰·승인을 발급하거나 `AUTO_TRADE_ENABLED`·`DRY_RUN`을 건드릴 수 없다. prefill은 입력 필드만 채울 뿐 confirm 체크박스를 자동 체크하지 않는다.
3. **제안은 prefill 전 결정적 검증 필수.** `validate.ts`가 심볼 실재(Toss로 확인)·정수 수량·SELL은 매도가능수량 이내·side 유효를 검사한다. **환각/무효 제안은 표시만 되고 폼에 담을 수 없다**(자동 보정 없이 탈락).
4. **BUY 제안의 후보 검증.** 신규 매수 후보는 **Toss로 실재·거래가능 확인 후에만** prefill 가능. 미확인 심볼은 차단.
5. **기존 §6 게이트는 호출만, 무수정.** 어드바이저가 만든 어떤 주문도 결국 §6(한도·kill switch·고액·dry-run)을 그대로 통과해야 한다. 우회·약화·재구현 금지.

## 보안 & 프라이버시

- 시크릿(`TOSS_CLIENT_ID`/`TOSS_CLIENT_SECRET`/token/`TOSS_ACCOUNT_SEQ`, `OPENAI_API_KEY`/`XAI_API_KEY`/`TAVILY_API_KEY`)은 **환경변수/시크릿 매니저**. 코드·로그·커밋·테스트 픽스처에 하드코딩 금지.
- `.env`는 `.gitignore`, `.env.example`만 커밋. 누락 시 fast-fail(`lib/server/env.ts` zod).
- 클라이언트 번들·콘솔·네트워크 응답에 시크릿/토큰 노출 금지 — `scripts/check-bundle-secrets.mjs`가 build에서 회귀 방지.
- 외부 입력(주문 파라미터 등)은 서버 경계에서 zod 검증.
- (어드바이저) LLM에 보내는 스냅샷은 **포함 필드 화이트리스트**(보유 심볼·수량·평단·현재가·손익·비중·현금·매수여력·환율 + 선택 시장 데이터). 계좌 시퀀스·계좌명 등 식별자/PII는 전송하지 않는다. provider 응답은 zod 검증 전 어떤 필드도 사용하지 않는다.
- 노출 사고 시 즉시 **rotate**(코드 수정만으론 부족).

## 환경 변수 (안전 관련)

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `DRY_RUN` | `true` | true면 실주문 POST 미전송 |
| `KILL_SWITCH` | `false` | true면 모든 실주문 차단 |
| `AUTO_TRADE_ENABLED` | `false` | 자동 executor 실주문 활성화(사람 사전 승인) |
| `MAX_ORDER_AMOUNT` | (미설정) | 1회 최대 주문금액(KRW). 미설정 시 실주문 차단(fail-safe) |
| `DAILY_LOSS_LIMIT` | (미설정) | 일일 손실 한도(KRW) |

전체 환경 변수는 [../README.md](../README.md) 참고.
