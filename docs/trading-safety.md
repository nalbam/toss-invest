# 거래 안전 & 보안 (§6)

실거래 계좌 = 실제 돈. 모의투자 모드가 없으므로 **코드 레벨에서 막는다.** 이 문서가 거래 안전 불변식의 **단일 진실**이다.

> **불변식(메타 가드)**: 이 §6의 안전 상수(DRY_RUN 기본값·한도·kill switch)와 관련 테스트는 **임의로 변경·완화·skip할 수 없다.** 변경하려면 사람의 명시적 승인이 필요하고, 안전 관련 파일(`lib/server/trading/**`) 변경이 감지되면 작업을 중단하고 보고한다. **종료 압박을 이유로 안전장치를 낮춰 게이트를 통과시키는 것은 금지**된다.

## §6 거래 안전장치 (CRITICAL — 약화 금지)

1. **DRY_RUN 기본값 = true**. 환경변수로만 끌 수 있고, 끄려면 추가로 §6.2 확인 게이트를 통과해야 한다.
2. **실주문 확인 게이트**: 모든 실제 `POST /orders*`는 (a) `DRY_RUN=false` **그리고** (b) 승인 **그리고** (c) 한도 검사 통과일 때만 전송. 하나라도 거짓이면 dry-run으로 강등하고 기록.
   - **수동거래(Phase 2)**: (b)는 *주문 단위로 사람이 입력하는* 확인값.
   - **자동거래(Phase 3)**: (b)는 사람이 사전에 out-of-band로 부여한 활성화 승인(`AUTO_TRADE_ENABLED`) + §6.3 한도 + §6.4 kill switch로 갈음한다(주문 단위 사람 확인 생략). 단, **에이전트가 자기 자신에게 확인 토큰/승인을 발급하는 것은 절대 금지.**
3. **하드 리밋**(환경변수): 1회 최대 주문금액(`MAX_ORDER_AMOUNT`, 미설정 시 실주문 차단=fail-safe), 일일 누적 주문/손실 한도(`DAILY_LOSS_LIMIT`), 종목당 최대 포지션 비중.
4. **Kill switch**(`KILL_SWITCH`): ON이면 모든 실주문 경로 즉시 차단(자동거래·취소 포함). 테스트로 증명.
5. **고액 주문**: 1억원 이상은 명시적 `confirmHighValueOrder=true` 없이는 전송 금지.
6. **멱등성**: `clientOrderId`로 중복 주문 방지(`request-in-progress`/`already-*` 처리). **dry-run으로 강등된 시도는 `clientOrderId`를 발급·소비하지 않는다**(이후 실주문 재시도 시 오판 방지).
7. **감사 로그**: 모든 주문 시도(전송/강등/거부)를 입력·사유와 함께 남긴다. 단, 시크릿·PII 제외.

### 통화-인지 notional

notional 한도 검사는 통화를 추론한다 — KRX 심볼(`^\d{6}$`)=KRW, 그 외=USD. USD 주문은 `fxRate`로 KRW 환산하며, **USD인데 fxRate가 없으면 BLOCK(fail-safe)**. (notional 계산 불가 시에도 BLOCK.)

### 구현 위치

`lib/server/trading/safety.ts` — `getTradingConfig`/`evaluateOrderGate`(순수 게이트, fail-safe 평가 순서: 차단 우선) + `placeOrder`(DI 실행기). `createOrderRaw`/`modifyOrderRaw`/`cancelOrderRaw`는 **ungated 저수준, 직접 노출 금지**. 라우트/실행기는 게이트를 호출만 하고 무수정한다.

## §6.A 어드바이저 고유 불변식 (계획 — 미구현)

> Phase 4(AI 어드바이저) 설계용. 어드바이저는 아직 구현되지 않았으나, 구현 시 §6에 **더해** 아래를 지킨다.

1. **LLM 출력은 제안일 뿐 명령이 아니다.** `lib/server/advisor/**`·`app/api/advisor/**`는 `placeOrder`/`createOrderRaw`를 import·호출하지 않는다(grep + 의존성 테스트로 증명). 제안 → 사람이 "폼에 담기" → dry-run → **사람 confirm** → 기존 §6 게이트. LLM은 §6보다 철저히 **상류**에 위치한다.
2. **에이전트/LLM 자가 확인 금지.** LLM이 confirm 토큰·승인을 발급하거나 `AUTO_TRADE_ENABLED`·`DRY_RUN`을 건드릴 수 없다. prefill은 입력 필드만 채울 뿐 confirm 체크박스를 자동 체크하지 않는다.
3. **제안은 prefill 전 결정적 검증 필수.** `validate.ts`가 심볼 실재(Toss로 확인)·정수 수량·SELL은 매도가능수량 이내·side 유효를 검사한다. **환각/무효 제안은 표시만 되고 폼에 담을 수 없다**(자동 보정 없이 탈락).
4. **BUY 제안의 후보 검증.** 신규 매수 후보는 **Toss로 실재·거래가능 확인 후에만** prefill 가능. 미확인 심볼은 차단.
5. **기존 §6 게이트는 호출만, 무수정.** 어드바이저가 만든 어떤 주문도 결국 §6(한도·kill switch·고액·dry-run)을 그대로 통과해야 한다. 우회·약화·재구현 금지.

## 보안 & 프라이버시

- 시크릿(`TOSS_CLIENT_ID`/`TOSS_CLIENT_SECRET`/token/`TOSS_ACCOUNT_SEQ`, 계획된 `OPENAI_API_KEY`/`XAI_API_KEY`)은 **환경변수/시크릿 매니저**. 코드·로그·커밋·테스트 픽스처에 하드코딩 금지.
- `.env`는 `.gitignore`, `.env.example`만 커밋. 누락 시 fast-fail(`lib/server/env.ts` zod).
- 클라이언트 번들·콘솔·네트워크 응답에 시크릿/토큰 노출 금지 — `scripts/check-bundle-secrets.mjs`가 build에서 회귀 방지.
- 외부 입력(주문 파라미터 등)은 서버 경계에서 zod 검증.
- (어드바이저, 계획) LLM에 보내는 스냅샷은 **포함 필드 화이트리스트**(보유 심볼·수량·평단·현재가·손익·비중·현금·매수여력·환율 + 선택 시장 데이터). 계좌 시퀀스·계좌명 등 식별자/PII는 전송하지 않는다. provider 응답은 zod 검증 전 어떤 필드도 사용하지 않는다.
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
