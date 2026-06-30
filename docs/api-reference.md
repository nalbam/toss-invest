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
| 시세(차트) MARKET_DATA_CHART | `GET /api/v1/candles` | 분봉·일봉 (시간 역순 페이지네이션: `count`·`before` 커서 → 응답 `nextBefore`) | 5/s |
| 종목 STOCK | `GET /api/v1/stocks` `/api/v1/stocks/{symbol}/warnings` | 종목 마스터·투자경고 | 5/s |
| 시장정보 MARKET_INFO | `GET /api/v1/exchange-rate` `/market-calendar/KR` `/market-calendar/US` | 환율·장 운영 캘린더 | 3/s |
| 주문 ORDER | `POST /api/v1/orders` `/orders/{id}/modify` `/orders/{id}/cancel` | 생성·정정·취소 (지정가/시장가, 금액/수량 기반) | 6/s (09:00–09:10 KST 3/s) |
| 주문조회 ORDER_HISTORY | `GET /api/v1/orders`(필수 `status` OPEN/CLOSED) `/orders/{orderId}` | 주문 목록(대기/종료)·상세·체결 | 5/s |
| 주문정보 ORDER_INFO | `GET /api/v1/buying-power` `/sellable-quantity` `/commissions` | 매수가능금액·매도가능수량·수수료 | 6/s (피크 3/s) |

## 필수 동작 규칙

- **Rate limit**: 응답 헤더 `X-RateLimit-Limit/Remaining/Reset` 존중. 429 시 `Retry-After` + 지수 백오프(1→2→4s)+지터, `Remaining` 낮으면 선제 스로틀.
- **에러 모델**: 봉투에 `error.{requestId, code, message, data?}`. `requestId`=헤더 `X-Request-Id`(없으면 `cf-ray`). 코드별 분기 처리.
- **주문 생성 성공의 의미**: Toss `POST /api/v1/orders` 200은 `result.orderId`(+ optional `clientOrderId`)만 반환한다. 이는 **주문 접수/생성 성공**이지 체결 완료가 아니다. 체결 성공 여부는 `GET /api/v1/orders/{orderId}` 상세 조회의 `status`와 `execution`으로 확인한다.
  - 완료: `status=FILLED`.
  - 진행 중/부분 체결: `PENDING`·`PENDING_CANCEL`·`PENDING_REPLACE`·`PARTIAL_FILLED`. `PARTIAL_FILLED`는 `execution.filledQuantity`로 체결분을 표시한다.
  - 종료/실패/전환: `CANCELED`·`REJECTED`·`REPLACED`·`CANCEL_REJECTED`·`REPLACE_REJECTED`. 이 경우에도 부분 체결이 있을 수 있으므로 `execution.filledQuantity`를 확인한다.
- **주문 목록과 상세 조회**: `GET /api/v1/orders?status=OPEN|CLOSED`는 라이프사이클 그룹 필터이고, 응답 `orders[].status`는 실제 주문 상태 enum이다. 주문 직후 확정 확인은 목록보다 `GET /api/v1/orders/{orderId}`를 우선한다.
- **공식 문서 충돌 주의**: `openapi.json` 1.1.5 기준 경로 설명과 예제는 `status=CLOSED` 조회를 설명하지만, `PaginatedOrderResponse.description`에는 `CLOSED`가 `400 closed-not-supported`라는 오래된 문구가 남아 있다. 현재 구현은 경로 스펙에 맞춰 `CLOSED`를 통과시키며, 실제 운영 연동에서는 upstream 응답을 그대로 확인한다.
- **멱등성**: `clientOrderId`는 주문 생성 멱등성 키다. 네트워크 타임아웃 후 같은 주문을 재시도해야 하면 새 요청을 만들지 말고 같은 `clientOrderId`로 재요청한다. dry-run/blocked 시도는 로컬 §6 게이트에서 새 `clientOrderId`를 발급·소비하지 않는다.
- **고액 주문**: 1억원 이상은 `confirmHighValueOrder=true` 필요(400 `confirm-high-value-required`).
- **장 운영**: `order-hours-closed`(422), 미국 금액주문은 정규장만(`amount-order-outside-regular-hours`).
- **⚠️ 모의투자(paper) 모드가 문서에 없음 → 모든 주문을 실거래로 간주**. 안전장치([trading-safety.md](trading-safety.md))는 타협 불가.

## 로컬 주문 API 의미

브라우저는 Toss 원 API가 아니라 로컬 `/api/orders*`를 호출한다. 성공 응답은 `{data}` 봉투이며, `POST /api/orders`의 `data.status`는 로컬 §6 게이트 결과다.

| 로컬 상태 | 의미 |
|---|---|
| `DRY_RUN` | 실 POST 미전송. `wouldSend`는 전송될 본문 미리보기. |
| `BLOCKED` | 안전 게이트 차단. `reasons`에 차단 사유. |
| `SENT` | Toss에 실제 POST 전송 완료. `response.orderId`는 Toss 서버 주문 id이며, 체결 완료를 뜻하지 않는다. |

`SENT` 이후 체결 확인은 `GET /api/orders/{orderId}`(내부적으로 Toss `GET /api/v1/orders/{orderId}`)를 폴링해 `status`/`execution`을 판정한다.

## 로컬 라우트 (SQLite 기반, Toss 프록시 아님)

브라우저가 호출하는 `/api/*` 중 일부는 Toss 프록시가 아니라 로컬 SQLite(`lib/server/db/sqlite.ts`)를 읽고 쓴다. 모두 `runtime = "nodejs"`, `{data}`/`{error}` 봉투.

| 라우트 | 메서드 | 동작 |
|---|---|---|
| `/api/favorites` | GET·POST·DELETE(`?symbol=`) | 즐겨찾기 목록·추가(upsert)·삭제 |
| `/api/settings` | GET·PUT(`{upserts, deletes}`) | UI 상태 KV(`app_settings`) 전체 조회·배치 upsert/삭제. 과거 브라우저 localStorage 상태를 전역 1벌로 영속 |
| `/api/stocks` | GET(`?symbols=`) | Toss 종목 마스터 조회(코드 다중) + 결과를 이름검색 디렉터리에 적재 |
| `/api/stocks/search` | GET(`?q=&limit=`) | 이름/코드 부분검색(로컬 `stock_directory`) |
| `/api/advisor-watchlist` | GET·POST·PATCH·DELETE(`?id=`) | 자동분석 watchlist CRUD(종목·인터벌·분석주기) |
| `/api/advisor-jobs/run` | POST(Bearer `ADVISOR_JOBS_TOKEN`) | 백그라운드 어드바이저 잡 1회 실행(due 항목만) |
| `/api/advisor` | POST | 포트폴리오 어드바이저(스냅샷→LLM→검증 제안) |
| `/api/market-advisor` | POST | 차트 어드바이저(캔들→LLM→조언, SQLite 기록) |
| `/api/market-advisor/history` | GET(`?symbol=&interval=`) | 조언 히스토리(차트 오버레이용) |

## 데이터 표현 규칙 (구현)

- decimal 금액/수량은 **문자열**로 보존(정밀도). 표시 시에만 포맷, 차트 입력 시에만 숫자 변환.
- enum은 **open**(미지 값 허용), nullable/optional은 스키마에 명시.
- 폴링 주기는 `market-calendar`로 장 운영을 반영해 **폐장·휴장 시 완화/중단**.

## LLM Provider API (구현)

> 어댑터는 `lib/server/llm/`(openai · xai · chat-completions · container)에 구현돼 있다. 공식 문서가 최종 진실 — `response_format`/JSON schema 사용법·인증·rate limit·에러 봉투·모델명은 Context7·각 provider 공식 문서로 확인한다.

두 provider 모두 **OpenAI 호환 chat completions**라 어댑터는 엔드포인트·키·모델명·structured output 형식만 다르고 본문 구조는 거의 같다.

| Provider | Base URL(예) | 인증 헤더 | env 키 | 비고 |
|---|---|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `Authorization: Bearer $OPENAI_API_KEY` | `OPENAI_API_KEY` | `POST /chat/completions`, `response_format`로 structured output |
| xAI(Grok) | `https://api.x.ai/v1` | `Authorization: Bearer $XAI_API_KEY` | `XAI_API_KEY` | OpenAI 호환 `POST /chat/completions` |

- 공통 요청: `{ model, messages:[{role, content}], response_format?, temperature?, max_tokens? }`.
- 제안은 JSON schema 기반 structured output 우선. 모델명은 하드코딩하지 않고 `LLM_MODEL`(또는 provider별 기본)로 주입.
- (차트 어드바이저, 선택) `TAVILY_API_KEY` 설정 시 분석 직전 종목 뉴스를 **Tavily Search**(`POST https://api.tavily.com/search`, `Authorization: Bearer $TAVILY_API_KEY`, `topic:"news"`)로 검색해 프롬프트에 싣는다. 종목당 10분 캐시, 미설정·실패 시 차트만으로 분석(fail-open). 어댑터는 `lib/server/news/`.
