# API 레퍼런스

토스증권 Open API 요약. **`openapi.json`이 최종 진실** — 스키마를 다룰 땐 추측하지 말고 `https://openapi.tossinvest.com/openapi-docs/latest/openapi.json`의 실제 정의를 확인한다(요청/응답, 토큰 만료 필드, 목록 페이지네이션, 캔들 기간/개수 한계 포함).

## 기본

Base: `https://openapi.tossinvest.com` · **REST only** · 시장: 국내(KR) + 미국(US).

### 인증 — OAuth2 Client Credentials

- `POST /oauth2/token` (form-urlencoded: `grant_type=client_credentials`, `client_id`, `client_secret`). rate limit 5/s 준수, access token 캐싱 + 만료 전 갱신.
- 모든 호출 헤더: `Authorization: Bearer {access_token}`.
- 계좌·자산·주문 호출 추가 헤더: `X-Tossinvest-Account: {accountSeq}`.

## 엔드포인트 카탈로그 (그룹 · rate limit TPS)

| 그룹 | 엔드포인트 | 받는 데이터 | TPS |
|---|---|---|---|
| 계좌 ACCOUNT | `GET /api/v1/accounts` | 계좌 목록 | 1/s |
| 자산 ASSET | `GET /api/v1/holdings` | 보유종목·평가금액·손익·일간손익 | 5/s |
| 시세 MARKET_DATA | `GET /api/v1/orderbook` `/prices` `/trades` `/price-limits` | 호가·현재가·체결·상하한가 | 10/s |
| 시세(차트) MARKET_DATA_CHART | `GET /api/v1/candles` | 분봉·일봉 | 5/s |
| 종목 STOCK | `GET /api/v1/stocks` `/api/v1/stocks/{symbol}/warnings` | 종목 마스터·투자경고 | 5/s |
| 시장정보 MARKET_INFO | `GET /api/v1/exchange-rate` `/market-calendar/KR` `/market-calendar/US` | 환율·장 운영 캘린더 | 3/s |
| 주문 ORDER | `POST /api/v1/orders` `/orders/{id}/modify` `/orders/{id}/cancel` | 생성·정정·취소 (지정가/시장가, 금액/수량 기반) | 6/s (09:00–09:10 KST 3/s) |
| 주문조회 ORDER_HISTORY | `GET /api/v1/orders` `/orders/{orderId}` | 주문 목록·상세·체결 | 5/s |
| 주문정보 ORDER_INFO | `GET /api/v1/buying-power` `/sellable-quantity` `/commissions` | 매수가능금액·매도가능수량·수수료 | 6/s (피크 3/s) |

## 필수 동작 규칙

- **Rate limit**: 응답 헤더 `X-RateLimit-Limit/Remaining/Reset` 존중. 429 시 `Retry-After` + 지수 백오프(1→2→4s)+지터, `Remaining` 낮으면 선제 스로틀.
- **에러 모델**: 봉투에 `error.{requestId, code, message, data?}`. `requestId`=헤더 `X-Request-Id`(없으면 `cf-ray`). 코드별 분기 처리.
- **고액 주문**: 1억원 이상은 `confirmHighValueOrder=true` 필요(400 `confirm-high-value-required`).
- **장 운영**: `order-hours-closed`(422), 미국 금액주문은 정규장만(`amount-order-outside-regular-hours`).
- **⚠️ 모의투자(paper) 모드가 문서에 없음 → 모든 주문을 실거래로 간주**. 안전장치([trading-safety.md](trading-safety.md))는 타협 불가.

## 데이터 표현 규칙 (구현)

- decimal 금액/수량은 **문자열**로 보존(정밀도). 표시 시에만 포맷, 차트 입력 시에만 숫자 변환.
- enum은 **open**(미지 값 허용), nullable/optional은 스키마에 명시.
- 폴링 주기는 `market-calendar`로 장 운영을 반영해 **폐장·휴장 시 완화/중단**.

## LLM Provider API (계획 — 미구현)

> Phase 4(AI 어드바이저) 설계용 캐시 요약. **아직 구현되지 않았다.** 공식 문서가 최종 진실 — `response_format`/JSON schema 사용법·인증·rate limit·에러 봉투·모델명은 Context7·각 provider 공식 문서로 확인한다.

두 provider 모두 **OpenAI 호환 chat completions**라 어댑터는 엔드포인트·키·모델명·structured output 형식만 다르고 본문 구조는 거의 같다.

| Provider | Base URL(예) | 인증 헤더 | env 키 | 비고 |
|---|---|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `Authorization: Bearer $OPENAI_API_KEY` | `OPENAI_API_KEY` | `POST /chat/completions`, `response_format`로 structured output |
| xAI(Grok) | `https://api.x.ai/v1` | `Authorization: Bearer $XAI_API_KEY` | `XAI_API_KEY` | OpenAI 호환 `POST /chat/completions` |

- 공통 요청: `{ model, messages:[{role, content}], response_format?, temperature?, max_tokens? }`.
- 제안은 JSON schema 기반 structured output 우선. 모델명은 하드코딩하지 않고 `LLM_MODEL`(또는 provider별 기본)로 주입.
