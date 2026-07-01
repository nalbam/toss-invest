# 로드맵 & 이력

## 현재 상태

- **Phase 1·2·3 전체 완료** → 자가 개선 루프 종료([development.md](development.md)).
- 루프(#18) 이후 사람 주도 UI 개선(시세 그래프 확장·포트폴리오 구성 도넛·종목별 손익 막대·즐겨찾기·종목 검색 등)과 Phase 4 AI 어드바이저 통합. 검증 기준은 [development.md](development.md)의 lint·typecheck·test·build 게이트.
- **Phase 4(AI 어드바이저) 완료** — Provider 추상화·오케스트레이션·UI 카드·시장 어드바이저·prefill→§6 게이트.
- 루프 종료 후 **Google OAuth 로그인 게이트**(better-auth, 허용 도메인 제한) 도입 — 페이지는 서버 세션 검증, 모든 `/api/*` 라우트는 `withAuth`로 세션 재검증.

## Phase 로드맵 + 종료 조건

### Phase 1 — 읽기전용 대시보드 ✅
계좌·보유자산·시세·주문내역을 한 화면에서 본다.
- [x] mock 계약 테스트로 모든 GET 엔드포인트 통과 — **17/17**(다중 페이지 포함).
- [x] 시크릿이 클라이언트 번들에 없음(build 가드).
- [x] 대시보드가 포트폴리오 요약·보유종목·주문내역·시세를 렌더 — jsdom + **Playwright E2E 통과**.
- [x] lint·typecheck·test·build green.

### Phase 2 — 수동 거래 (기본 dry-run) ✅
주문 생성·정정·취소를 사람이 확인하고 실행. 사전검증(`buying-power`/`sellable-quantity`/`commissions`/`price-limits`).
- [x] dry-run 페이로드가 API 계약과 일치(게이트/라우트/폼 테스트).
- [x] 실주문 경로는 확인 게이트 없이 도달 불가(confirm 바디 전용·자동 true 없음·grep+테스트).
- [x] 사전검증 실패(insufficient-buying-power/price-out-of-range/order-hours-closed) 422 매핑 테스트.
- [x] lint·typecheck·test·build green.

### Phase 3 — 제한적 자동거래 ✅
규칙 기반 전략이 주문을 제안/실행하되 하드 리밋·kill switch 뒤에서만.
- [x] 백테스트/시뮬레이션 하네스로 전략을 과거·합성 데이터에 결정적 검증(`runBacktest`).
- [x] 한도 위반·kill switch 시 실행 거부 증명(§6 게이트 경유, `createOrderRaw` 미호출 테스트).
- [x] 모든 자동 주문 경로 dry-run 기본 + `AUTO_TRADE_ENABLED` 없이 실주문 불가(기본 false → 전부 dry-run).
- [x] lint·typecheck·test·build green.

거래 안전 불변식(§6)은 [trading-safety.md](trading-safety.md).

## 미해결 / 후속 (사람 요청 시)

- `DAILY_LOSS_LIMIT` 강제, ORDER 피크 3/s 선제 스로틀, 자동 트리거 배선(라우트/cron, 사람 결정).
- modify/cancel E2E, market-calendar 폴링 완화.
- dev `allowedDevOrigins` 경고(무해), build 매번 `rm -rf .next` 클린.

## Phase 4 — AI 어드바이저 ✅

LLM(OpenAI·xAI) 기반 포트폴리오 분석·조언·주문 제안. 설계·안전은 [architecture.md](architecture.md)·[trading-safety.md](trading-safety.md) §6.A 참고. 완료된 작업:

- **A1 — Provider 추상화 + 결정적 코어(UI 없음)** ✅: `LlmProvider` 인터페이스 + OpenAI·xAI 어댑터 + `snapshot`(마스킹)·`prompt`·`schema`(zod)·`validate`(전부 순수). env(`LLM_PROVIDER`·`OPENAI_API_KEY`·`XAI_API_KEY`·`LLM_MODEL`)는 선택값(미설정 부팅 정상, 어드바이저만 "not configured"). 번들 가드에 LLM 키 패턴 추가.
- **A2 — 오케스트레이션 + API 라우트** ✅: `advisor.ts`(snapshot→prompt→provider→zod→validate) + `POST /api/advisor`(`{data}`·에러 매핑·`force-dynamic`). 어드바이저가 `placeOrder`/`createOrderRaw`를 호출하지 않음을 grep+의존성 테스트로 증명. 환각/무효 제안은 `validate`에서 탈락.
- **A3 — UI 카드 + prefill → §6 연결** ✅: `AiAdvisor.tsx`(버튼·조언·제안·disclaimer) + Dashboard `prefill` lift + `OrderForm` prefill prop. **주문은 여전히 사람 confirm + §6** — prefill은 입력만 채우고 전송하지 않는다.
- **시장 어드바이저** ✅: `MarketAiAdvisor.tsx` + `POST /api/market-advisor`(+ `GET /history`) — 차트 기준 지지/저항·마커·결정 이력을 캔들 차트에 오버레이(SQLite 영속). 분/일/주/월/년 인터벌·기술지표(MA·RSI·거래량/변동성)·상위 시간대 추세로 다중 시간대 판단.

---

# 이터레이션 이력 (append-only)

> 자가 개선 루프의 반복별 기록(#1~#18). **감사 목적의 원문 보존** — 회로차단기가 정체·반복 실패를 감지하려면 이력이 필요했고, 점수 인플레 방지를 위해 각 점수에 근거를 함께 남겼다. 변경 이력의 source는 git/PR이며, 아래는 루프 당시 기록 그대로다.
>
> 형식: `#N | phase | 한 일 | 점수+근거(6축) | 최저축 | 다음 개선`. 점수 1~5, 근거 없는 점수는 무효(0점). Safety/Security는 5 타협 불가.

## #1 | phase1 | 부트스트랩: Next.js 15 스캐폴드 + env(zod)·OAuth 토큰 모듈(TDD)

**객관 게이트(메인 에이전트 직접 재실행 — 근거):**
- lint: `pnpm run lint` → eslint 출력 없음(위반 0), exit 0
- typecheck: `pnpm run typecheck` → tsc --noEmit 출력 없음(에러 0), exit 0
- test: `pnpm run test` → vitest **Test Files 2 passed, Tests 14 passed**
- build: `pnpm run build` → **✓ Compiled successfully**, static pages 5/5

**루브릭 점수 + 근거:**
- Functionality **4** — Phase1 첫 의존성(토큰 provider) 완성. 근거: auth.test 발급/캐시/만료갱신/skew/동시성 통과(14 tests). 대시보드 데이터 클라이언트는 미착수.
- API 정합성 **3** — 토큰 요청 `grant_type=client_credentials`+form-urlencoded는 테스트로 검증. 근거: auth.test의 form body 단언. 한계: `expires_in` 등 응답 스키마를 openapi.json으로 미검증(파서 1곳 집중으로 교체 용이).
- Safety **5** — 주문/거래 코드 경로 자체가 아직 없어 우회 대상 없음 + `.env.example` `DRY_RUN=true` 기본. 근거: lib에 order 경로 부재, .env.example 기본값.
- Security **5** — server-only 격리 + zod fast-fail, `.env` 부재, `.gitignore`에 `.env`/`.env.*`, 하드코딩 시크릿 없음. 근거: `ls .env`=없음, `.gitignore:54-55`, grep secret 클린.
- UX **2** — 대시보드 UI 없음(스캐폴드 기본 page). 근거: app/page.tsx 기본값.
- Code quality **4** — DI(fetch/clock) + 단일 inFlight + parseTokenResponse 격리, 외과적 범위 유지. 근거: auth.ts 설계, README/프롬프트 문서 무변경.

**최저축**: UX(2) — 단, 이 단계에선 정상(UI는 데이터 클라이언트 이후). 추세 감시용 기록.
**다음 개선(next pick)**: 의존성 순서상 Toss API 클라이언트 + GET 계약 테스트(accounts→holdings→prices/exchange-rate). 이때 openapi.json으로 토큰·응답 스키마 검증해 API 정합성 3→4↑.

---

## #2 | phase1 | Toss API 클라이언트(인증·rate limit·에러·429) + 코어 GET 4종 + 계약 테스트

**객관 게이트(메인 에이전트 직접 재실행 — 근거, 전부 exit 0):**
- lint: `pnpm run lint` exit 0 (eslint 위반 0)
- typecheck: `pnpm run typecheck` exit 0 (tsc 에러 0)
- test: `pnpm run test` exit 0 → vitest **Test Files 5 passed, Tests 37 passed**
- build: `pnpm run build` exit 0 → ✓ Compiled successfully

**루브릭 점수 + 근거:**
- Functionality **5** — 베이스 클라이언트 + rate limiter + 코어 GET 4종(accounts/holdings/prices/exchange-rate) 완성. 근거: 37 contract/unit tests 통과.
- API 정합성 **5** — 스키마를 `/tmp/toss-openapi.json` ground truth에서 추출(추측 0). decimal=string, enum unknown 허용, 봉투 {result}, X-Tossinvest-Account 헤더, expires_in(초) 확인. 근거: schemas.ts가 openapi와 일치 + 계약테스트가 헤더/쿼리/언래핑/decimal 보존 단언. (#1의 3 → 5)
- Safety **5** — 주문/거래 코드 경로 여전히 없음(우회 대상 없음). 근거: GET 전용, POST/order 부재.
- Security **5** — 신규 코드 전부 `lib/server/**` server-only, 시크릿 없음, build 성공(server-only 클라이언트 번들 미누출). 근거: build exit 0, 기존 파일 0개 수정. 한계: 전용 번들 grep 회귀 테스트는 #3 예정(회귀 없음).
- UX **2** — UI 없음(스캐폴드 기본 page). 근거: app/page.tsx 기본값. (#1과 동일, 의도적 후순위)
- Code quality **5** — rate-limiter/schemas/client/endpoints 분리, 전면 DI, 기존 파일 무수정(외과적). 근거: builder 수정 파일 0.

**최저축**: UX(2) — 데이터 계층 이후 단계라 정상. active pick은 아님(회로차단기 대상 아님).
**다음 개선(next pick #3)**: Next API 프록시 라우트 4종 + SWR 훅 + 시크릿 번들 grep 회귀 테스트(종료조건 2).

---

## #3 | phase1 | Next API 프록시 라우트 4종 + 컨테이너 + 시크릿 번들 회귀 가드 + 라우트 테스트

**객관 게이트(메인 에이전트 직접 재실행 — 근거, 전부 exit 0):**
- lint exit 0 / typecheck exit 0
- test exit 0 → vitest **Test Files 6 passed, Tests 48 passed**(신규 11: accounts3·holdings4·prices2·exrate2)
- build exit 0 → ✓ Compiled successfully + `check-bundle-secrets: scanned 19 client bundle file(s), no forbidden strings found.`

**루브릭 점수 + 근거:**
- Functionality **5** — 프록시 라우트 4종 + 컨테이너 + 번들 가드. 근거: 48 tests, 라우트 4개 모두 Dynamic, 가드 19파일 스캔.
- API 정합성 **5** — 기존 타입드 엔드포인트 재사용, `TossApiError`→upstream status 매핑, 쿼리 zod 검증. 근거: 라우트 테스트가 status 매핑·필수쿼리 400·인자 전달 단언.
- Safety **5** — 주문 코드 여전히 없음. 근거: GET 전용 라우트.
- Security **5** — **종료조건 2 달성**(번들 가드 build 결합, 클린). 에러 본문 sanitize(unknown→500 generic, 스택/시크릿 미노출), 컨테이너 server-only. 근거: 가드 "no forbidden strings" + handleError 강등 + 주입 self-test로 가드 exit1 확인.
- UX **2** — UI 없음(스캐폴드 기본 page). 근거: app/page.tsx 기본값. **3회 연속 2점이나 의도적 후순위**(데이터/경계 먼저). #4가 직접 UX 대상 — #4 후에도 미상승 시 회로차단기 발동.
- Code quality **5** — respond.ts 헬퍼 분리, 기존 파일은 package.json build 한 줄만 수정(외과적). 근거: builder 수정 1줄.

**최저축**: UX(2). **추세 경고: #1~#3 UX=2 정체** → 단, 다음 pick(#4)이 정확히 이 축을 해소하는 UI 이터레이션이므로 계획된 시퀀싱. #4 종료 후 UX 미상승 시 회로차단기(접근 재검토).
**다음 개선(next pick #4)**: 포트폴리오 요약 대시보드 UI + SWR 훅 + Playwright 렌더 테스트(종료조건 3, UX↑).

---

## #4 | phase1 | 포트폴리오 요약+보유종목 대시보드 UI + SWR 훅 + jsdom 렌더 테스트 + build 클린 보강

**비고**: 첫 시도가 외부 API Overload로 중단(deps+types.ts만 생성) → 범위를 핵심 UI로 좁히고 Playwright는 #7로 분리해 재실행. 일시적 외부 오류라 회로차단기 비대상.

**객관 게이트(메인 에이전트 직접 재실행, `.next` 클린 후 — 근거, 전부 exit 0):**
- lint exit 0 / typecheck exit 0
- test exit 0 → vitest **Test Files 9 passed, Tests 71 passed**(신규 22: format/PortfolioSummary/HoldingsTable, node+jsdom 공존)
- build exit 0 → ✓ Compiled successfully + `check-bundle-secrets: scanned 19 ... no forbidden strings`

**루브릭 점수 + 근거:**
- Functionality **5** — SWR 훅(accounts/holdings/exchange-rate) + 요약·보유종목·FX 컴포넌트 + format + 대시보드 페이지. 근거: 71 tests, app/page.tsx 대시보드 교체, 빌드 OK.
- API 정합성 **5** — 클라이언트 타입이 API 응답 형태와 일치, decimal 문자열 유지, /api/* 호출. 근거: hooks/format 테스트, 라우트 응답 형태 준수.
- Safety **5** — 주문 코드 없음(읽기전용). 근거: GET/표시 전용.
- Security **5** — 클라이언트 코드 추가에도 번들 가드 클린(시크릿/`process.env.TOSS_` 미노출), 클라이언트가 lib/server 미import. 근거: 가드 19파일 클린.
- UX **4** — 계좌 선택·요약(손익 부호색·% 표기)·보유 테이블·FX·로딩/에러·빈상태 렌더(jsdom 테스트로 검증). 5 아님: 풀 브라우저 E2E·디자인 폴리시·시세/주문 섹션 미완. 근거: 렌더 테스트가 요약/테이블/15.16%/빈상태 단언. **(UX 2→4, 정체 해소)**
- Code quality **5** — 순수 표시 컴포넌트 + 훅 분리, 데모 자산 surgical 정리, 서버 파일 무수정. 근거: 의도 파일만 변경.

**최저축**: UX(4) — 목표(≥3) 충족, 정체 해소. 회로차단기 비대상.
**검증 한계(정직)**: 렌더는 jsdom 컴포넌트 테스트로 검증(게이트 내). **풀 브라우저 E2E(Playwright)는 #7 보류** — 따라서 "브라우저 실제 동작"은 미검증.
**운영**: stale `.next` 증분 캐시 빌드 오탐 관측 → build 스크립트에 `rm -rf .next` 추가(클린 빌드 강제).
**다음 개선(next pick #5)**: 주문조회 GET(list/detail) 클라이언트+라우트+주문내역 섹션+계약 테스트.

---

## #5 | phase1 | 주문조회 GET(list/detail) + 라우트 + 주문내역(대기) 섹션 + 계약/렌더 테스트

**객관 게이트(메인 에이전트 직접 재실행 — 근거, 전부 exit 0):**
- lint exit 0 / typecheck exit 0
- test exit 0 → vitest **Test Files 10 passed, Tests 87 passed**(신규 16)
- build exit 0 → ✓ Compiled + `/api/orders`·`/api/orders/[orderId]` Dynamic + `scanned 21 ... no forbidden strings`

**루브릭 점수 + 근거:**
- Functionality **5** — getOrders/getOrder + 라우트 2종 + OrdersTable 섹션 + ORDER_HISTORY 그룹. 근거: 87 tests, /api/orders 빌드.
- API 정합성 **5** — Order/execution/pagination/enum을 openapi ground truth로, closed-not-supported passthrough, X-Tossinvest-Account 헤더. 근거: 계약 테스트(status/헤더/페이지네이션 필드·400 매핑·unknown enum).
- Safety **5** — 주문 생성(POST) 없음, 읽기전용. 근거: GET only.
- Security **5** — 번들 가드 21파일 클린, 클라이언트 lib/server 미import. 근거: 가드 클린.
- UX **4** — 주문내역(대기) 섹션 추가(정직한 "대기 중" 레이블). 5 아님: 시세 섹션·풀 E2E 미완. 근거: OrdersTable 렌더 테스트(2주문+빈상태).
- Code quality **5** — 기존 패턴 재사용·외과적 추가(스키마/엔드포인트/라우트/훅/컴포넌트), 무관 리팩토링 없음. 근거: 기존 파일 확장만.

**최저축**: UX(4) — 목표 충족. 회로차단기 비대상.
**정직한 한계**: CLOSED 미지원으로 체결완료 주문 조회 불가(OPEN만). 렌더는 jsdom 컴포넌트 테스트, 풀 브라우저 E2E는 #8 보류.
**다음 개선(next pick #6)**: 시세 GET(orderbook/trades/price-limits/candles) 클라이언트 + 라우트 + 계약 테스트(`MARKET_DATA_CHART:5` 그룹 추가).

---

## #6 | phase1 | 시세 GET 4종(orderbook/trades/price-limits/candles) + 라우트 + 계약 테스트 (데이터 계층)

**객관 게이트(메인 에이전트 직접 재실행 — 근거, 전부 exit 0):**
- lint exit 0 / typecheck exit 0
- test exit 0 → vitest **Test Files 10 passed, Tests 110 passed**(신규 23)
- build exit 0 → ✓ Compiled + `/api/{orderbook,trades,price-limits,candles}` Dynamic + `scanned 25 ... no forbidden strings`

**루브릭 점수 + 근거:**
- Functionality **5** — 시세 4종 클라이언트+라우트, MARKET_DATA_CHART 그룹. GET 계약 10/16. 근거: 110 tests, 라우트 빌드.
- API 정합성 **5** — openapi ground truth(symbol required, candle interval 1m/1d, before/nextBefore 페이지, price-limits null 상하한가), decimal 문자열·openEnum. 근거: 계약 테스트.
- Safety **5** — 주문 POST 없음. 근거: GET only.
- Security **5** — 번들 가드 25파일 클린. 근거: 가드 클린.
- UX **4** — 이번엔 UI 미추가(데이터 계층 전용), 4 유지. 근거: 컴포넌트 변경 없음. (#7 시세 UI에서 상승 예정)
- Code quality **5** — 외과적 추가(rate-limiter union/스키마/엔드포인트/라우트), groupHarness 테스트 헬퍼. 근거: 기존 파일 확장만.

**최저축**: UX(4) — 목표 충족. UX 4→4(데이터 계층 이터라 의도적 정체, #7이 UI). 회로차단기 비대상.
**다음 개선(next pick #7)**: 시세 대시보드 섹션(심볼 선택 → 현재가/상하한가/호가/캔들 차트) + SWR 훅 + 차트 컴포넌트 + 렌더 테스트.

---

## #7 | phase1 | 시세 대시보드 섹션(현재가·상하한가·호가·캔들 차트) + SWR 훅 + 차트

**객관 게이트(메인 에이전트 직접 재실행 — 근거, 전부 exit 0):**
- lint exit 0 / typecheck exit 0
- test exit 0 → vitest **Test Files 13 passed, Tests 123 passed**(신규 13)
- build exit 0 → ✓ Compiled + `scanned 26 ... no forbidden strings`

**루브릭 점수 + 근거:**
- Functionality **5** — MarketQuote(현재가/상하한가/호가/캔들 차트) + usePrices/usePriceLimits/useOrderbook/useCandles + lightweight-charts. 근거: 123 tests, 대시보드 4섹션.
- API 정합성 **5** — 클라이언트 타입이 응답 형태와 일치, decimal 문자열 유지(차트 입력 시만 숫자 변환), candle interval 1m/1d. 근거: toChartSeries 단위 테스트 + 훅.
- Safety **5** — 주문 POST 없음. 근거: 읽기전용.
- Security **5** — lightweight-charts 클라이언트 deps 추가에도 번들 가드 26파일 클린(시크릿 미노출). 근거: 가드 클린.
- UX **5** — 대시보드 4개 섹션(요약·보유종목·주문내역·시세 with 호가/캔들 차트/interval 토글) 모두 렌더, jsdom 테스트 검증. **(UX 4→5)**
- Code quality **5** — toChartSeries 순수 분리, 외과적 추가, 서버 파일 무수정. 근거: 의도 파일만.

**최저축**: 없음(전 축 5). **UX 정체 완전 해소(2→4→5)**.
**정직한 한계**: 렌더는 jsdom 컴포넌트 테스트(차트는 lib mock 스모크). **풀 브라우저 E2E(Playwright)는 #9 보류** → "브라우저 실제 동작"은 아직 미검증.
**다음 개선(next pick #8)**: 나머지 GET 6종(stocks/warnings/market-calendar KR·US/buying-power/sellable-quantity/commissions) + 라우트 + 계약 테스트 → 종료조건 1(16/16) 완성.

---

## #8 | phase1 | 나머지 GET 7종(stocks/warnings/calendar KR·US/buying-power/sellable-quantity/commissions) + 라우트 + 계약 → 전 GET 17/17

**객관 게이트(메인 에이전트 직접 재실행 — 근거, 전부 exit 0):**
- lint exit 0 / typecheck exit 0
- test exit 0 → vitest **Test Files 13 passed, Tests 157 passed**(신규 34)
- build exit 0 → ✓ Compiled + **API 라우트 17개** + `scanned 33 ... no forbidden strings`

**루브릭 점수 + 근거:**
- Functionality **5** — 7 엔드포인트+라우트+34 테스트 → **종료조건 1(전 GET 17/17) 완성**. 근거: 157 tests, 17 API 라우트 빌드.
- API 정합성 **5** — 중첩(KrMarketDetail/KR·US calendar) 포함 openapi ground truth, nullable.optional, openEnum, STOCK/ORDER_INFO 그룹·계좌헤더. 근거: 계약 테스트.
- Safety **5** — 주문 POST 없음(ORDER_INFO도 조회). 근거: GET only.
- Security **5** — 번들 가드 33파일 클린. 근거: 가드 클린.
- UX **5** — UI 미변경(데이터 계층), #7 대시보드 4섹션 유지(무회귀). 근거: 컴포넌트 무변경.
- Code quality **5** — 외과적 추가(그룹/스키마/엔드포인트/라우트), 무관 리팩토링 없음. 근거: 기존 파일 확장만.

**최저축**: 없음(전 축 5).
**Phase 1 상태**: 종료조건 4개 중 3 완료(GET 17/17 ✅·시크릿 번들 ✅·gates ✅), 대시보드 렌더는 컴포넌트 레벨 ✅·**Playwright E2E(#9)만 남음**.
**다음 개선(next pick #9)**: Playwright E2E(브라우저 설치 + route-mock 대시보드 렌더 스펙) → Phase 1 종료 판정 → Phase 2(수동 거래) 진입.

---

## #9 | phase1 | Playwright E2E(대시보드 4섹션 렌더) → **Phase 1 종료 판정**

**객관 게이트 + E2E(메인 에이전트 직접 재실행 — 근거, 전부 exit 0):**
- lint exit 0 / typecheck exit 0
- test exit 0 → vitest **157 passed (13 files)**
- build exit 0 → ✓ Compiled + 번들 가드 33파일 클린
- **e2e exit 0 → `1 passed`** (chromium, `e2e/dashboard.spec.ts` — 포트폴리오 요약 ₩2,020,000·보유 "삼성전자"/"Apple"·주문내역(대기)·시세 현재가 ₩72,000 region 단언)

**루브릭 점수 + 근거:**
- Functionality **5** — Playwright config(webServer dev+더미env) + route-mock E2E. 종료조건 3 완성. 근거: e2e 1 passed.
- API 정합성 **5** — e2e mock이 `/api/*` `{data}` 형태 일치. 근거: 실 토스 호출 없이 통과.
- Safety **5** — 주문 코드 없음(읽기전용). 근거: read-only.
- Security **5** — 번들 가드 클린, e2e env는 더미(실 시크릿 아님). 근거: 가드 클린.
- UX **5** — 실 브라우저에서 4섹션 렌더 확인(aria region 단언). 근거: e2e.
- Code quality **5** — testid 없이 기존 aria region 활용, 외과적. 근거: 컴포넌트 무변경.

**최저축**: 없음(전 축 5).
**★ Phase 1 종료 판정**: 4 종료조건 전부 충족 + 루브릭 전 축 ≥목표(Safety/Security=5) → **advance_phase() → Phase 2(수동 거래) 진입**.
**다음 개선(next pick #10)**: Phase 2 — 주문 생성(POST) §6 안전 계층 + dry-run 실행기(DRY_RUN 기본·kill switch·한도·확인 게이트·confirmHighValue·멱등성·감사 로그) + **실 POST 경로 게이트 미통과 시 도달불가 증명 테스트**. ⚠️ 실거래 코드 시작 — Safety 축 최우선.

---

## #10 | phase2 | 주문 생성 §6 안전 계층 + dry-run 실행기 (라우트/UI 미노출)

**객관 게이트(메인 에이전트 직접 재실행 — 근거, 전부 exit 0):**
- lint exit 0 / typecheck exit 0
- test exit 0 → vitest **186 passed (14 files)**(신규 29 safety/schema)
- build exit 0 → 번들 가드 33파일 클린(+`.next/static`에 placeOrder/createOrderRaw/evaluateOrderGate/MAX_ORDER_AMOUNT 누출 없음 확인)

**루브릭 점수 + 근거:**
- Functionality **5** — `evaluateOrderGate`(순수)·`placeOrder`(DI 실행기)·`createOrderRaw`(ungated)·ORDER:6·orderCreateRequest union/refine. 근거: 186 tests.
- API 정합성 **5** — openapi 기반 union/refine(LIMIT price 필수·MARKET price 금지·quantity 정수), 200=`{orderId, clientOrderId|null}`. 근거: 스키마 테스트.
- Safety **4 (목표 5 미달 — 갭 발견)** — 강점: 평가순서 fail-safe(차단 우선), KILL_SWITCH·DRY_RUN 기본 true·notional 계산불가 시 BLOCK·MAX_ORDER_AMOUNT 미설정 시 BLOCK·실 send는 (DRY_RUN=false+confirm+한도+killoff+고액confirm) 전부일 때만 — **`createOrderRaw` 미호출/clientOrderId 미소비 테스트로 증명**. **갭(fail-unsafe)**: `computeNotionalKrw`(safety.ts:110-114) LIMIT quantity-based price를 **무조건 KRW로 간주** → US 티커(USD) LIMIT 주문 notional ~1380배 과소계산 → MAX_ORDER_AMOUNT 한도 우회 가능. 근거: safety.ts:114 + 코드 직접 확인. 완화: 라우트/UI 미노출·DRY_RUN 기본이라 현 실노출 0, 그러나 게이트 로직 자체 결함.
- Security **5** — trading server-only, 번들 가드 클린(trading 심볼 미노출). 근거: 가드+grep.
- UX **5** — UI 무변경(백엔드 안전), 회귀 없음.
- Code quality **5** — 순수 게이트/DI 실행기/fail-safe 순서/ungated 명시. 근거: 구조.

**최저축**: **Safety(4)**. Safety<5 → advance·확장 금지, **갭 수정을 즉시 다음 pick으로 강제**.
**다음 개선(next pick #11)**: notional 통화-인지 수정 — 심볼로 통화 추론(KRX `^\d{6}$`→KRW, 그 외→USD), USD는 fxRate로 KRW 환산, **USD인데 fxRate 없으면 BLOCK(fail-safe)**. US LIMIT 대형 주문 한도초과 BLOCK 회귀 테스트. → Safety 5 복귀 후에야 정정/취소·라우트·UI로 확장.

---

## #11 | phase2 | 주문 게이트 notional 통화-인지 수정 (Safety 4→5 복귀)

**객관 게이트(메인 에이전트 직접 재실행 — 근거, 전부 exit 0):**
- lint exit 0 / typecheck exit 0 / build exit 0(번들 가드 33파일 클린)
- test exit 0 → vitest **189 passed (14 files)**(신규 3 US LIMIT; safety 32)
- **참고**: 1차 시도 시 typecheck exit 2(US LIMIT 픽스처 `timeInForce` 누락) — vitest는 통과했으나 tsc가 포착 → 픽스처 수정 후 통과. **다중 객관 게이트가 단일 테스트러너가 놓친 결함을 잡은 사례.**

**루브릭 점수 + 근거:**
- Functionality **5** — `isKrwSymbol`+`nativeToKrw` 도입, `computeNotionalKrw` 통화-인지로 교체. 근거: 189 tests.
- API 정합성 **5** — 심볼 통화 규칙이 API 규약(KRX 6자리=KRW, US 티커=USD)과 일치. 근거: US LIMIT 테스트.
- Safety **5 (복귀)** — fail-unsafe(USD price를 KRW로 과소계산) 제거: USD 주문은 fxRate 환산, fxRate 없으면 BLOCK(fail-safe). 회귀 테스트: AAPL LIMIT 100@$200×1380=27.6M > 5M 한도 → BLOCK(이전엔 20,000으로 오평가돼 통과했을 것). 기존 게이트 보장(kill/dry-run 기본/실 send 도달조건) 무회귀(32 safety tests). 근거: 게이트 테스트.
- Security **5** — 번들 가드 클린. UX **5** — UI 무변경. Code quality **5** — 외과적 헬퍼 2개 + 기존 분기 통화-인지로 교체, 주석 갱신, 스코프 크리프 없음.

**최저축**: 없음(전 축 5). **Safety 5 복귀 → 확장 차단 해제.**
**다음 개선(next pick #12)**: 주문 정정/취소(POST modify/cancel) + §6 게이트 적용(정정 notional 재평가·dry-run 기본) + 상태(`already-*`/`request-in-progress`) 처리. 라우트/UI는 #13.

---

## #12 | phase2 | 주문 정정/취소(POST) + §6 게이트 적용

**객관 게이트(메인 에이전트 직접 재실행 — 근거, 전부 exit 0):**
- lint exit 0 / typecheck exit 0 / build exit 0(번들 가드 33파일 클린, trading 심볼 미노출)
- test exit 0 → vitest **220 passed (14 files)**(safety.test.ts 63)

**루브릭 점수 + 근거:**
- Functionality **5** — `evaluateModifyGate`/`evaluateCancelGate` + `modifyOrder`/`cancelOrder` 실행기 + `modifyOrderRaw`/`cancelOrderRaw`(ungated) + orderModify/operation 스키마. 근거: 220 tests.
- API 정합성 **5** — OrderModifyRequest refine(LIMIT price 필수·MARKET price 금지·정수 quantity), OrderOperationResponse{orderId}, modify/cancel POST(계좌헤더·orderId path). 근거: 스키마/게이트 테스트.
- Safety **5** — modify는 원주문 symbol로 **통화-인지 notional 재평가**(create와 동일 규칙); cancel은 kill/dry-run/confirm만(리스크감소, notional 없음) + **kill은 cancel도 차단**(§6 보수적, 임의 예외 금지 주석); SEND일 때만 raw 호출 — dry-run/BLOCK은 raw 미호출(테스트 증명). 기존 create 게이트·메타가드 무회귀. 근거: modify/cancel 게이트 테스트 + 번들 클린.
- Security **5** — trading server-only, 번들 클린. UX **5** — UI 무변경. Code quality **5** — 추가 위주(기존 함수/불변식 미수정), isKrwSymbol/nativeToKrw 재사용.

**최저축**: 없음(전 축 5).
**다음 개선(next pick #13)**: 게이트된 주문 API 라우트(create/modify/cancel, DRY_RUN 기본·confirm 필수, 게이트에 accountSeq/fxRate/referencePrice 주입, confirm 없으면 dry-run 미리보기) + 사전검증 연동 + 에러 매핑. ⚠️ 처음으로 주문이 HTTP로 도달 가능 — 라우트 레벨에서도 confirm 게이트·에러 sanitize 유지.

---

## #13 | phase2 | 게이트된 주문 API 라우트(POST create/modify/cancel) + 컨텍스트 조립 + 사전검증

**객관 게이트(메인 에이전트 직접 재실행 — 근거, 전부 exit 0):**
- lint exit 0 / typecheck exit 0 / build exit 0(번들 가드 35파일 클린, POST 라우트 3종 서버 ƒ)
- test exit 0 → vitest **237 passed (14 files)**(신규 17 라우트/컨텍스트)
- **확인**: 라우트 소스(`app/api/orders/*`)에 `confirm: true` 리터럴/승격 없음(grep) — confirm은 `z.boolean().default(false)` 바디 전용.

**루브릭 점수 + 근거:**
- Functionality **5** — POST 라우트 3종 + `executor.ts`(facade)·`context.ts`(게이트 컨텍스트 조립) + 사전검증 preview. 근거: 237 tests.
- API 정합성 **5** — 바디 zod, 컨텍스트 조립(USD→getExchangeRate fxRate, MARKET→getPrices referencePrice, modify→getOrder symbol/originalQuantity), TossApiError 매핑. 근거: 라우트 테스트.
- Safety **5** — confirm **바디 전용**(자동 confirm 없음: grep+테스트), DRY_RUN 기본, 게이트/메타가드 무수정(호출만), 컨텍스트 조회 실패는 undefined→fail-safe BLOCK(임의 대체 안 함), 사전검증은 플래그만(게이트 대체 아님), 에러 sanitize, trading 심볼 번들 미노출. 근거: route 소스 grep + 테스트 + 번들 클린.
- Security **5** — trading/raw-order 심볼 클라이언트 번들 미노출(35파일). UX **5** — UI 무변경(라우트만). Code quality **5** — executor/context 분리, 게이트 untouched, 추가 위주.

**최저축**: 없음(전 축 5).
**다음 개선(next pick #14)**: 주문 폼 UI(`/api/orders*` POST, confirm 체크박스, dry-run 미리보기·BLOCKED 사유 표시) + jsdom 렌더 테스트. → Phase 2 종료조건 점검(사전검증 실패 케이스 테스트 보강) 후 Phase 3 진입 판정.

---

## #14 | phase2 | 주문 생성 폼 UI (dry-run 미리보기 + confirm 체크박스)

**객관 게이트(메인 에이전트 직접 재실행 — 근거, 전부 exit 0):**
- lint exit 0 / typecheck exit 0 / build exit 0(번들 가드 35파일 클린)
- test exit 0 → vitest **243 passed (15 files)**(신규 6 OrderForm)

**루브릭 점수 + 근거:**
- Functionality **5** — OrderForm + submitOrder + Dashboard 섹션. 근거: 243 tests(confirm 미체크→DRY_RUN, 체크→SENT, BLOCKED reasons, 에러 렌더).
- API 정합성 **5** — 폼 바디가 POST 계약과 일치, status별(DRY_RUN/SENT/BLOCKED)·에러 응답 처리. 근거: 폼 테스트.
- Safety **5** — confirm 체크박스 상태 **그대로 전송**(클라이언트 자동 true 없음), 미체크=dry-run 안내, 최종 판정 서버 게이트, 클라이언트 시크릿 미노출. 근거: 폼 테스트 + 번들 클린.
- Security **5** — OrderForm 등 클라이언트 코드 시크릿/`process.env.TOSS_` 미노출(35파일). UX **5** — dry-run/blocked/sent 명확 표시 + confirm 안전 어포던스. Code quality **5** — 클라이언트 미러 타입·submitOrder 헬퍼·외과적.

**최저축**: 없음(전 축 5). Phase 2 수동 거래 사용자 플로우 작동.
**다음 개선(next pick #15)**: 정정/취소 UI(OrdersTable 취소 버튼+정정 폼, confirm 게이트 동일) + 사전검증 실패(insufficient-buying-power/price-out-of-range/order-hours-closed) 명시 테스트 → Phase 2 종료조건 충족 점검 → Phase 3 진입 판정.

---

## #15 | phase2 | 정정/취소 UI + 사전검증/422 에러 테스트 → **Phase 2 종료 판정**

**객관 게이트(메인 에이전트 직접 재실행 — 근거, 전부 exit 0):**
- lint exit 0 / typecheck exit 0 / build exit 0(번들 가드 35파일 클린)
- test exit 0 → vitest **266 passed (16 files)**(신규 23)
- **확인**: `app/_components`에 `window.confirm/alert/prompt` 없음(grep) — 2단계 인라인 확인.

**루브릭 점수 + 근거:**
- Functionality **5** — OrdersTable 정정/취소 액션 + ModifyOrderForm + hooks.modifyOrder/cancelOrder + 422 테스트. 근거: 266 tests.
- API 정합성 **5** — modify/cancel 바디·응답, 422(insufficient-buying-power/price-out-of-range/order-hours-closed) 매핑·sanitize. 근거: 라우트 테스트.
- Safety **5** — confirm 사용자 입력 그대로(자동 true 없음), **취소 2단계 인라인 확인**(브라우저 dialog 미사용), safety.ts/route 핸들러 무수정(테스트만 추가), 사전검증 실패 422 처리 잠금. 근거: 테스트 + grep.
- Security **5** — 클라이언트 시크릿 미노출(35파일). UX **5** — 정정/취소 인라인 + 결과 표시. Code quality **5** — OrderForm 패턴 재사용·postOrderJson 추출·외과적.

**최저축**: 없음(전 축 5).
**★ Phase 2 종료 판정**: 종료조건 4개 전부 충족(dry-run 일치·실주문 게이트 없이 도달불가·사전검증 실패 처리·gates) + 루브릭 전 축 ≥목표(Safety/Security=5) → **advance_phase() → Phase 3(제한적 자동거래)**.
**다음 개선(next pick #16)**: 전략 intent 순수 계층(스냅샷→intent[], 결정적, I/O 없음) + 단위 테스트. 실행 배선 없음(executor는 #18, §6 게이트+사전 활성화 뒤). ⚠️ 자동거래 승인은 사람 사전 부여, 에이전트 자가 발급 금지.

---

## #16 | phase3 | 전략 intent 순수 계층 (실행 배선 없음)

**객관 게이트(메인 에이전트 직접 재실행 — 근거, 전부 exit 0):**
- lint exit 0 / typecheck exit 0 / build exit 0(번들 가드 35파일 클린)
- test exit 0 → vitest **280 passed (17 files)**(신규 14)
- **확인**: strategy/에 `Date.now`/`Math.random`/`new Date` 없음(grep) — 결정적.

**루브릭 점수 + 근거:**
- Functionality **5** — strategy types + `thresholdExitStrategy` 순수 함수. 근거: 280 tests(손절/익절/밴드내/트림/정렬/정수/빈입력/우선순위).
- API 정합성 **5** — OrderIntent가 OrderCreateRequest로 변환 가능한 형태(side/orderType/quantity 정수). 변환·전송은 #18.
- Safety **5** — **순수 모듈·I/O 없음·실행 배선 없음**(실주문 경로 부재), **SELL-only 보수 기본**(자동 매수 미생성 — 리스크 감소만). 근거: 코드 순수성 + 실행기 부재.
- Security **5** — 번들 클린. UX **5** — UI 무변경. Code quality **5** — 결정적(정렬·floor 정수화·부수효과 없음), 신규 디렉터리만 추가.

**최저축**: 없음(전 축 5).
**다음 개선(next pick #17)**: 백테스트/시뮬레이션 하네스 — 합성/과거 캔들 시퀀스로 포지션 스냅샷 구성 → thresholdExitStrategy 결정적 실행·집계(intent·가상 PnL) + 결정적 테스트(실주문 없음).

---

## #17 | phase3 | 백테스트/시뮬레이션 하네스 (순수·결정적, 실주문 없음)

**객관 게이트(메인 에이전트 직접 재실행 — 근거, 전부 exit 0):**
- lint exit 0 / typecheck exit 0 / build exit 0(번들 가드 35파일 클린)
- test exit 0 → vitest **292 passed (18 files)**(신규 13)
- **확인**: backtest/에 Date.now/Math.random/new Date 없음(grep) — 결정적.

**루브릭 점수 + 근거:**
- Functionality **5** — `runBacktest` 순수 시뮬레이터(스텝별 스냅샷→전략→가상 SELL 적용·realizedPnlKrw 집계). 근거: 292 tests(손절/익절/횡보/멀티+트림/결정성 deep-equal/fxRate없는 USD/길이불일치).
- API 정합성 **5** — strategy 타입 재사용. Safety **5** — 순수·I/O 없음·실주문/네트워크 경로 부재. 근거: 결정성 grep + 실행기 부재.
- Security **5** — 번들 클린. UX **5** — UI 무변경. Code quality **5** — 결정적·부수효과 없음·신규 디렉터리만.

**최저축**: 없음(전 축 5). **Phase 3 종료조건 1(백테스트) 충족.**
**다음 개선(next pick #18)**: 게이트된 자동 executor — intent→§6 `placeOrder`(confirm=AUTO_TRADE_ENABLED 사람 사전 env 승인), AUTO_TRADE_ENABLED 기본 false→전부 dry-run·createOrderRaw 미호출 증명, kill/한도 거부 증명, 감사로그. 상시 루프 없음. → Phase 3 종료조건 2·3 충족 판정.

---

## #18 | phase3 | 게이트된 자동 executor → **Phase 3 종료 → 로드맵 전체 완료**

**객관 게이트(메인 에이전트 직접 재실행 — 근거, 전부 exit 0):**
- lint exit 0 / typecheck exit 0 / build exit 0(번들 가드 35파일 클린)
- test exit 0 → vitest **306 passed (19 files)**(신규 14: auto-executor 12 + env 2)
- **안전 검증(직접)**: `git status` safety.ts **무수정**(게이트/메타가드 보존), auto-* 에 setInterval/cron 없음(주석만, 상시 루프 없음), `confirm: deps.autoTradeEnabled`(env값, 리터럴 true 아님).

**루브릭 점수 + 근거:**
- Functionality **5** — `intentToOrderRequest`(순수)+`runAutoTrade`(§6 placeOrder 경유)+`auto-trader` facade+env. 근거: 306 tests.
- API 정합성 **5** — intent→OrderCreateRequest(SELL/MARKET/quantity) 변환. 근거: 변환 테스트.
- Safety **5** — confirm=AUTO_TRADE_ENABLED(사람 env, 자가 발급 없음), **기본 false→전부 dry-run, createOrderRaw 미호출**(테스트 summary {sent:0}), kill/한도/notional-unknown BLOCK+미호출 증명, safety.ts 게이트/메타가드 **무수정**(git status), 상시 루프 없음. 근거: 테스트 + git status + grep.
- Security **5** — auto-* server-only, 번들 클린. UX **5** — 백엔드(영향 없음). Code quality **5** — 순수 변환·DI·facade, safety.ts untouched.

**최저축**: 없음(전 축 5).
**★ Phase 3 종료 판정**: 종료조건 4개 충족 + 루브릭 전 축 ≥목표(Safety/Security=5) → advance. **3개 Phase(읽기 대시보드/수동 거래/제한적 자동거래) 로드맵 전체 완료 → 루프 종료.**

---

## 🏁 로드맵 완료 요약 (#1~#18)
- Phase 1: 읽기전용 대시보드(전 GET 17/17 + 4섹션 UI + Playwright E2E).
- Phase 2: 수동 거래(§6 게이트 + create/modify/cancel 라우트·UI, dry-run 기본·confirm 게이트).
- Phase 3: 제한적 자동거래(SELL-only 전략 순수 계층 + 결정적 백테스트 + 게이트된 auto-executor, AUTO_TRADE_ENABLED 기본 false).
- 누적 **306 tests**, 4게이트+E2E green. 안전: DRY_RUN/AUTO_TRADE_ENABLED 기본 false·kill switch·한도·고액 confirm·통화-인지 notional·번들 시크릿 가드. 루프가 자체 안전 갭(#10 USD notional)을 발견·수정(#11)한 사례 포함.

> 루프 종료 이후 사람 주도 UI 개선(시세 그래프 확장·포트폴리오 구성/손익 차트 등)이 이어졌다. 세부는 git/PR 이력 참고.
