# EVAL — self-evaluating loop 이력 (append-only)

형식: `#N | phase | 한 일 | 점수+근거(6축) | 최저축 | 다음 개선`
점수 1~5. 근거 없는 점수는 무효(0점). Safety/Security는 5 타협 불가.

---

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
**★ Phase 1 종료 판정**: 4 종료조건 전부 충족 + 루브릭 전 축 ≥목표(Safety/Security=5) → **§5.3 advance_phase() → Phase 2(수동 거래) 진입**.
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

**최저축**: **Safety(4)**. §5.3 적용: Safety<5 → advance·확장 금지, **갭 수정을 즉시 다음 pick으로 강제**.
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
**★ Phase 2 종료 판정**: 종료조건 4개 전부 충족(dry-run 일치·실주문 게이트 없이 도달불가·사전검증 실패 처리·gates) + 루브릭 전 축 ≥목표(Safety/Security=5) → **§5.3 advance_phase() → Phase 3(제한적 자동거래)**.
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
**★ Phase 3 종료 판정**: 종료조건 4개 충족 + 루브릭 전 축 ≥목표(Safety/Security=5) → §5.3 advance. **3개 Phase(읽기 대시보드/수동 거래/제한적 자동거래) 로드맵 전체 완료 → dev-loop §0 따라 루프 종료.**

---

## 🏁 로드맵 완료 요약 (#1~#18)
- Phase 1: 읽기전용 대시보드(전 GET 17/17 + 4섹션 UI + Playwright E2E).
- Phase 2: 수동 거래(§6 게이트 + create/modify/cancel 라우트·UI, dry-run 기본·confirm 게이트).
- Phase 3: 제한적 자동거래(SELL-only 전략 순수 계층 + 결정적 백테스트 + 게이트된 auto-executor, AUTO_TRADE_ENABLED 기본 false).
- 누적 **306 tests**, 4게이트+E2E green. 안전: DRY_RUN/AUTO_TRADE_ENABLED 기본 false·kill switch·한도·고액 confirm·통화-인지 notional·번들 시크릿 가드. 루프가 자체 안전 갭(#10 USD notional)을 발견·수정(#11)한 사례 포함.

**남은 후속(사람 요청 시)**: DAILY_LOSS_LIMIT 강제, ORDER 피크 3/s, 자동 트리거 배선(라우트/cron, 사람 결정), modify/cancel·시세 E2E, 차트 페이지네이션·테마, 주문조회 CLOSED.

---

# Phase 4 — AI 어드바이저 (advisor-loop-prompt.md, #19~)

## #19 | phase4 | A1 첫 증분: LLM env 설정(선택값) + 번들 시크릿 가드 LLM 패턴

**한 일**: `env.ts`에 AI 어드바이저 env(`LLM_PROVIDER`(enum openai|xai)·`OPENAI_API_KEY`·`XAI_API_KEY`·`LLM_MODEL`)를 **전부 선택값**으로 추가(blank→undefined, .env.example 트랩 처리 재사용). 미설정이어도 앱 부팅 정상 — LLM은 어드바이저 경로에서만 필요. `check-bundle-secrets.mjs`에 LLM 키 패턴(`OPENAI_API_KEY`·`XAI_API_KEY`·`process.env.OPENAI`·`process.env.XAI`) 추가. `.env.example`에 주석 블록. TDD: env.test.ts 신규 4건(미설정 부팅·설정 파싱·빈문자열=미설정·unknown provider 거부).

**객관 게이트(직접 재실행 — 근거):**
- lint exit 0 / typecheck exit 0
- build exit 0 — **번들 가드 35파일 스캔, LLM 패턴 포함 forbidden 0건**(`check-bundle-secrets: no forbidden strings found`)
- test — 신규 env 4건 포함 **356 passed (372)**. 실패 16건은 trading/advisor와 무관한 **기존 환경 아티팩트**(Node v26.3.0 + jsdom 29.1.1 `localStorage` 미동작 → CollapsibleCard/MarketQuote/Dashboard). 지원 Node(20/22)에선 green. 근본수정(jsdom 업글/폴리필)은 후속 분리 — **테스트 무력화·skip 안 함.**

**루브릭 점수 + 근거:**
- Functionality **4** — A1 설정 토대(env 선택값 부팅 + 가드 패턴) 전진. 근거: env 16/16, build 가드 클린. (LLM 로직은 #20부터.)
- LLM 정합성 **N/A** — 이번 증분은 provider 호출/계약 없음(어댑터 #20). 근거 없는 점수는 무효(§5.2)이므로 미채점.
- Safety **5** — `lib/server/trading/**` **무수정**(git status 확인), env 추가는 전부 선택값으로 어떤 §6 게이트도 약화 안 함. 어드바이저는 §6 상류. 근거: git status(변경 4파일 전부 advisor 설정).
- Security & Privacy **5** — LLM 키 선택값·server-only env·번들 가드에 LLM 패턴 추가 + build가 client 번들 클린 증명(35파일). 근거: build 가드 출력.
- Determinism/Testability **5** — 순수 zod 파싱, 결정적 단위 테스트 4건. 근거: env.test.ts.
- UX **N/A** — UI 없음(A1은 UI 없음, §4).
- Code quality **5** — 외과적(4파일), 기존 blank→undefined 패턴 재사용, 무관 변경 없음. 근거: diff 범위.

**최저축**: LLM 정합성(미착수) → **다음 개선(#20)**: §9-3 `LlmProvider` 인터페이스 + 첫 어댑터(OpenAI) 요청 형태 — 주입된 `fetch`로 헤더·바디·structured output(`response_format`) 단언하는 실패 테스트부터. **provider 계약은 Context7·공식 문서로 확인 후 작성**(§3).
**Phase 전진 판정**: A1 종료조건 다수 미충족(어댑터·snapshot·schema·validate 남음) → advance 없음, A1 계속.

---

## #20 | phase4 | A1: `LlmProvider` 인터페이스 + OpenAI 어댑터(주입 fetch, structured output)

**한 일**: `lib/server/llm/types.ts`(`LlmProvider`·`ChatRequest`/`ChatResponse`·`ChatMessage`·`JsonSchemaSpec`·`LlmFetchFn`) + `openai.ts`(`createOpenAiProvider`, auth.ts DI 패턴: `fetchFn` 주입·sanitized 에러·`AbortController` 타임아웃 비용가드). 요청은 `POST {base}/chat/completions` + `Authorization: Bearer` + `response_format:{type:"json_schema",json_schema:{name,strict:true,schema}}`(jsonSchema 있을 때만), 응답은 `choices[0].message.content`+`model` 파싱(미존재 시 throw — 신뢰경계 밖). **provider 계약 Context7 검증**(developers.openai.com): response_format json_schema strict·bearer·choices[].message.content. TDD: openai.test.ts 9건.

**객관 게이트(직접 재실행 — 근거):**
- lint exit 0 / typecheck exit 0 (초기 TS2493 튜플 인덱스 → 테스트 mock에 `Mock<(url,init)=>Promise<Response>>` 타입 지정으로 근본수정, 구현 무관)
- build exit 0 — **번들 가드 35파일, forbidden 0건**(llm은 server-only → client 번들 미포함)
- test — 신규 9건 포함 **365 passed (381, 27 files)**. 실패 16건은 동일 **환경 아티팩트**(Node v26 jsdom localStorage). 무력화·skip 없음.

**루브릭 점수 + 근거:**
- Functionality **4** — A1 "provider 추상화" 첫 어댑터 완료(인터페이스+OpenAI). 근거: openai 9/9. (xAI·container #21.)
- LLM 정합성 **5** — 요청/응답이 OpenAI 문서 계약과 일치(Context7 확인): response_format json_schema strict·bearer·max_tokens·choices[0].message.content. 응답은 신뢰경계 밖 취급(파싱 실패 throw). 근거: 계약 테스트 9건(헤더/바디/structured/파싱/에러).
- Safety **5** — `lib/server/trading/**` **무수정**(git status), llm이 `placeOrder`/`createOrderRaw` **미참조**(grep none). 어드바이저는 §6 상류. 근거: git status + grep.
- Security & Privacy **5** — 어댑터 server-only, 키는 헤더에만(에러·로그 미노출, "status N"만 throw — 테스트로 키 미누출 단언), 번들 가드 35파일 클린. 근거: build + 키누출 테스트.
- Determinism/Testability **5** — 비결정 LLM 호출을 주입 fetch 뒤로 격리, 9건 전부 결정적(mock fetch·고정 payload). 타임아웃도 signal instanceof로 결정 검증. 근거: openai.test.ts.
- UX **N/A** — UI 없음.
- Code quality **5** — 외과적(신규 3파일, 기존 무수정), auth.ts DI 관례 일치, parse 단일함수 격리. 근거: git status(?? llm/만).

**최저축**: Functionality(어댑터 1/2·container 미완) → **다음 개선(#21)**: xAI 어댑터(OpenAI 호환, base `https://api.x.ai/v1`) + `container.ts`(`LLM_PROVIDER` env로 `getServerLlmProvider` 선택, 미설정 시 "not configured"). xAI 계약도 Context7 확인.
**Phase 전진 판정**: A1 종료조건(snapshot·schema·validate·2어댑터) 미충족 → advance 없음, A1 계속.

---

## #21 | phase4 | A1: xAI 어댑터 + 공유 코어 추출(중복 제거) → "2 어댑터" 종료조건 충족

**한 일**: `chat-completions.ts`(`createChatCompletionsProvider` — OpenAI 호환 코어: body 빌드·`response_format` json_schema·bearer·타임아웃·파싱) 추출. `openai.ts`/`xai.ts`는 name+기본 baseUrl만 다른 **얇은 위임**으로 슬림화. xAI 계약 **Context7 검증**(docs.x.ai): `POST https://api.x.ai/v1/chat/completions`·bearer·**OpenAI REST 완전 호환**(response_format 동일). TDD: xai.test.ts 5건(name·엔드포인트·structured·파싱·키누출). **openai.test.ts 9건 무수정 green → 리팩토링 동작 보존 증명.**

**객관 게이트(직접 재실행 — 근거):**
- lint exit 0 / typecheck exit 0
- build exit 0 — **번들 가드 35파일 클린**(llm server-only)
- test — 신규 xai 5건 포함 **370 passed (386, 28 files)**. openai 9건 변경 없이 통과(회귀 가드). 실패 16건 동일 **환경 아티팩트**. 무력화·skip 없음.

**루브릭 점수 + 근거:**
- Functionality **5** — A1 "provider 추상화" 핵심(2 어댑터+공유 코어) 완료. 근거: llm 14/14.
- LLM 정합성 **5** — xAI 계약 Context7 일치(OpenAI 호환, response_format json_schema), 응답 신뢰경계 밖 파싱. 근거: 계약 테스트 5건.
- Safety **5** — `lib/server/trading/**` **무수정**(git status), llm `placeOrder`/`createOrderRaw` **미참조**(grep none). 근거: git status + grep.
- Security & Privacy **5** — 코어 server-only, 키 헤더 전용·에러 "status N"만(키누출 테스트 단언), 번들 35파일 클린. 근거: build + 테스트.
- Determinism/Testability **5** — 비결정 호출 주입 fetch 뒤 격리, 14건 결정적. 근거: 테스트.
- UX **N/A** — UI 없음.
- Code quality **5** — **중복 제거 리팩토링**(공유 코어, 어댑터 ~15줄씩), openai.test 무수정으로 동작 보존 증명. 외과적(trading/기존 무수정). 근거: git status(openai.ts만 M, 나머지 신규).

**최저축**: 없음(핵심 축 전부 5; UX는 A1 비해당) → **다음 개선(#22)**: `container.ts` `getServerLlmProvider(env)` — `LLM_PROVIDER`로 어댑터 선택, provider/key/model 미설정 시 `LlmNotConfiguredError`(어드바이저 경로만 "not configured"). 주입 fetch.
**Phase 전진 판정**: A1 남은 종료조건(snapshot 마스킹·schema/validate·container) 미충족 → advance 없음, A1 계속.

---

## #22 | phase4 | A1: LLM `container.ts`(getServerLlmProvider + not-configured)

**한 일**: `container.ts` — **순수 선택부 `resolveLlmProvider(env·fetch 주입)`** + **`getServerLlmProvider()`(실 env+global fetch 배선·캐시)** 분리(trading 순수/facade 동형). `LLM_PROVIDER`로 openai/xai 어댑터 선택, provider/model/매칭 key 미설정 시 `LlmNotConfiguredError` throw(어드바이저 경로만 "not configured", 대시보드/거래 무영향). **선택은 `LLM_PROVIDER` 기준만**(key 존재로 추론 안 함 — 오설정 조용히 흡수 금지). 에러는 캐시 안 함(env 설정 시 복구). TDD: container.test.ts 7건(provider/model/key 미설정 throw·openai·xai 빌드·선택 정확성).

**객관 게이트(직접 재실행 — 근거):**
- lint exit 0 / typecheck exit 0(exhaustive switch — "openai"|"xai" 두 분기 return, default 불필요)
- build exit 0 — **번들 가드 35파일 클린**(container server-only)
- test — 신규 7건 포함 **377 passed (393, 29 files)**. 실패 16건 동일 **환경 아티팩트**. 무력화·skip 없음.

**루브릭 점수 + 근거:**
- Functionality **4** — A1 "provider 추상화" 완료(인터페이스+2어댑터+container). 근거: llm 21건(openai9+xai5+container7). (snapshot·schema·validate 남음.)
- LLM 정합성 **5** — 어댑터 계약은 #20/#21에서 Context7 검증; container는 그 위 결정적 선택부. 근거: 선택 테스트 7건.
- Safety **5** — `lib/server/trading/**` **무수정**(git status), llm `placeOrder`/`createOrderRaw` **미참조**(grep none). 미설정 시 throw로 어드바이저 경로만 차단(거래 무영향). 근거: git status + grep.
- Security & Privacy **5** — container server-only, 키는 어댑터 헤더로만 전달(선택부는 존재만 확인), 번들 35파일 클린. 근거: build.
- Determinism/Testability **5** — `resolveLlmProvider` 순수(env·fetch 주입), 7건 결정적·오프라인(fetch stub 미호출). 실 배선은 `getServerLlmProvider`로 격리. 근거: container.test.ts.
- UX **N/A** — UI 없음.
- Code quality **5** — 순수/facade 분리(toss container 관례), 외과적(신규 2파일·기존 무수정). 근거: git status(?? container만).

**최저축**: Functionality(snapshot·schema·validate 미착수) → **다음 개선(#23)**: `lib/server/advisor/snapshot.ts` — 순수 변환부(원시 포트폴리오/시장데이터 → **마스킹 스냅샷**, 화이트리스트 필드만·식별자/PII 제거) + 단위 테스트(PII 미포함 단언).
**Phase 전진 판정**: A1 "provider 추상화"·"키 번들 미노출"·"env 미설정 부팅" 충족, 남은 snapshot·schema/validate 미충족 → advance 없음, A1 계속.

---

## #23 | phase4 | A1: `advisor/snapshot.ts` 마스킹 순수 변환부

**한 일**: `buildAdvisorSnapshot(inputs)` 순수 변환 — 원시 `HoldingsOverview`/`BuyingPowerResponse`/`ExchangeRateResponse` → **마스킹 스냅샷**. **입력 타입에 account(accountNo/Seq/Type) 미포함 + 출력은 화이트리스트 필드만 객체 리터럴 재구성**(raw spread 안 함) → PII가 구조적으로 도달 불가(§7). 화이트리스트: 보유 symbol·name·market·currency·quantity·현재가·평단·시가평가액·손익·손익률·**비중(weightPercent, 결정적 계산)** + 현금/매수여력 + 환율(rate·통화). 비중은 item marketValue 합으로 계산(별도 total 미신뢰), 합 0이면 0(div-by-zero 방지). TDD: snapshot.test.ts 6건(화이트리스트 키 정확·비중·0총액·현금/환율·환율 null·**PII/raw 필드 미직렬화 단언**).

**객관 게이트(직접 재실행 — 근거):**
- lint exit 0 / typecheck exit 0(초기 fixture overview 타입 불일치 `{krw,usd}` → 실제 스키마로 수정, 구현 무관)
- build exit 0 — **번들 가드 35파일 클린**(advisor server-only)
- test — 신규 6건 포함 **383 passed (399, 30 files)**. 실패 16건 동일 **환경 아티팩트**. 무력화·skip 없음.

**루브릭 점수 + 근거:**
- Functionality **4** — A1 snapshot 마스킹 종료조건 충족. 근거: snapshot 6/6. (schema·validate 남음.)
- LLM 정합성 **N/A** — 이 증분은 LLM 호출/계약 무관(외부 전송 페이로드 형태 준비).
- Safety **5** — `lib/server/trading/**` **무수정**(git status), advisor `placeOrder`/`createOrderRaw` **미참조**(grep none). 근거: git status + grep.
- Security & Privacy **5** — **외부 전송 마스킹 핵심**: account 식별자/PII가 입력 타입·출력 직렬화 양쪽에서 배제(테스트로 accountSeq/No/Type + raw-only 필드 미포함 단언). server-only. 근거: 미포함 테스트 6건 중 1건.
- Determinism/Testability **5** — 순수 변환(clock/network 없음), 비중 계산 결정적, 6건 전부 결정적. 근거: snapshot.test.ts.
- UX **N/A** — UI 없음.
- Code quality **5** — 객체 리터럴 재구성(안전한 마스킹), 외과적(신규 2파일·기존 무수정). 근거: git status(?? advisor만).

**최저축**: Functionality(schema·validate 미착수) → **다음 개선(#24)**: `advisor/schema.ts`(zod) — LLM 구조화 출력 스키마(`proposals[]`(side·symbol·quantity·reason 등) + `advice` 서술) parse 성공/실패 단위 테스트. 이후 `validate.ts`(보유·매도가능수량·심볼 실재·정수·side).
**Phase 전진 판정**: A1 남은 종료조건(schema·validate) 미충족 → advance 없음, A1 계속.

---

## #24 | phase4 | A1: `advisor/schema.ts`(zod) LLM 구조화 출력 스키마

**한 일**: `advisorResultSchema` = `{ advice: string(min1), proposals: AdvisorProposal[] }`. `advisorProposalSchema` = `{ kind: enum(buy|trim|exit|rebalance), symbol: min1, side: enum(BUY|SELL), quantity: int().positive(), rationale: min1 }`. **provider 응답은 신뢰경계 밖** → 사용 전 이 zod로 재파싱(추가/환각 필드 strip). 결정: hold는 주문 아님 → `advice` 서술로(proposals는 prefill 가능한 액션만). 교차검증(보유·심볼 실재)은 #25 validate. TDD: schema.test.ts 9건(유효·빈 proposals·extra strip·비정수/비양수 quantity·unknown side/kind·blank symbol·missing advice).

**객관 게이트(직접 재실행 — 근거):**
- lint exit 0 / typecheck exit 0
- build exit 0 — **번들 가드 35파일 클린**(schema server-only)
- test — 신규 9건 포함 **392 passed (408, 31 files)**. 실패 16건 동일 **환경 아티팩트**. 무력화·skip 없음.

**루브릭 점수 + 근거:**
- Functionality **4** — A1 schema 종료조건 충족. 근거: schema 9/9. (validate 남음.)
- LLM 정합성 **5** — 구조화 출력 재검증 계약(zod) 정의, extra/환각 필드 strip·잘못된 side/kind/quantity 거부. 근거: parse 성공/실패 9건.
- Safety **5** — `lib/server/trading/**` **무수정**(git status), advisor `placeOrder`/`createOrderRaw` **미참조**(grep none). proposals는 데이터일 뿐(집행 아님). 근거: git status + grep.
- Security & Privacy **5** — schema server-only, 번들 35파일 클린. 근거: build.
- Determinism/Testability **5** — 순수 zod, 9건 결정적. 근거: schema.test.ts.
- UX **N/A** — UI 없음.
- Code quality **5** — 단일 zod 모듈, 외과적(신규 2파일·기존 무수정). 근거: git status(?? schema만).

**최저축**: Functionality(validate 미착수) → **다음 개선(#25)**: `advisor/validate.ts`(순수) — 제안을 실제와 대조: SELL은 보유·매도가능수량 이내, BUY/심볼은 실재(스냅샷/심볼셋 대조), quantity 정수>0, side 유효. **환각/무효는 자동보정 없이 탈락·플래그**(§6.A-3). 단위 테스트.
**Phase 전진 판정**: A1 남은 종료조건(validate) 미충족 → advance 없음, A1 계속.

---

## #25 | phase4 | A1: `advisor/validate.ts`(순수) 제안 실제 대조 검증

**한 일**: `validateProposals(proposals, context)` 순수 — LLM 제안을 주입된 reality 컨텍스트(`holdings`{symbol,sellableQuantity}·`knownSymbols`)와 대조. 규칙: quantity 정수>0(방어적), kind↔side 정합(buy→BUY, trim/exit→SELL, rebalance 자유), 심볼 실재(`knownSymbols`), SELL은 보유 + 매도가능수량 이내. **환각/무효는 자동보정·클램프 없이 `valid:false`+reasons로 탈락**(§6.A-3·4, UI는 표시만·prefill 차단). 입력 순서대로 1:1 결과. TDD: validate.test.ts 8건(SELL 유효·BUY 유효·매도초과·미보유·미지심볼·kind/side 불일치·비정수/비양수·혼합 배치 독립 플래그).

**객관 게이트(직접 재실행 — 근거):**
- lint exit 0 / typecheck exit 0(kindSideConflict exhaustive switch)
- build exit 0 — **번들 가드 35파일 클린**(validate server-only)
- test — 신규 8건 포함 **400 passed (416, 32 files)**. 실패 16건 동일 **환경 아티팩트**. 무력화·skip 없음.

**루브릭 점수 + 근거:**
- Functionality **5** — A1 schema/validate 종료조건 충족(결정적 검증 게이트 완성). 근거: validate 8/8.
- LLM 정합성 **5** — 환각(미지 심볼·매도초과·incoherent kind/side) 탈락 증명. 근거: 8건.
- Safety **5(타협 불가 충족)** — **§6.A-3 핵심**: 무효 제안 자동보정 없이 탈락(prefill 전 결정적 게이트). `lib/server/trading/**` **무수정**, advisor `placeOrder`/`createOrderRaw` **미참조**(grep). 근거: 탈락 테스트 + git status + grep.
- Security & Privacy **5** — validate server-only, 번들 35파일 클린. 근거: build.
- Determinism/Testability **5** — 순수(컨텍스트 주입, Toss 미호출), 8건 결정적. 근거: validate.test.ts.
- UX **N/A** — UI 없음.
- Code quality **5** — 순수·작은 단위, kind/side 정합 exhaustive, 외과적(신규 2파일). 근거: git status.

**최저축**: 없음(핵심 축 5; UX 비해당) → **다음 개선(#26)**: `advisor/prompt.ts`(순수) — 마스킹 스냅샷 → system+user 프롬프트 빌드(§4 A1 결정적 코어, 체크리스트 누락분). 단위 테스트(스냅샷 반영·instruction 포함). → A1 결정적 코어 마무리.
**Phase 전진 판정**: A1 결정적 코어 중 `prompt.ts` 미완 → advance 없음, A1 계속. (※ "어드바이저 경로 not configured"는 라우트 생기는 A2에서 종단 검증.)

---

## #26 | phase4 | A1: `advisor/prompt.ts`(순수) 프롬프트 빌더 → A1 결정적 코어 완료

**한 일**: `buildAdvisorPrompt(snapshot)` 순수 — 마스킹 스냅샷 → `[system, user]` `ChatMessage[]`. system: "제안자, 집행자 아님" 가드레일 + advice/proposals(kind/symbol/side/quantity/rationale) 출력 규칙 + SELL≤보유 규칙 + hold는 advice. user: 마스킹 스냅샷 JSON 임베드. 결정적(clock/random 없음). structured output JSON schema 강제는 advisor.ts(response_format)에서 별도. TDD: prompt.test.ts 6건(system→user 순서·가드레일·필드 기술·스냅샷 임베드·결정성·account 식별자 미누출).

**객관 게이트(직접 재실행 — 근거):**
- lint exit 0 / typecheck exit 0
- build exit 0 — **번들 가드 35파일 클린**(prompt server-only)
- test — 신규 6건 포함 **406 passed (422, 33 files)**. 실패 16건 동일 **환경 아티팩트**. 무력화·skip 없음.

**루브릭 점수 + 근거:**
- Functionality **5** — A1 결정적 코어(provider 추상화·snapshot·prompt·schema·validate) **전부 완료**. 근거: advisor 4모듈 29 테스트 + llm 21.
- LLM 정합성 **4** — 프롬프트가 schema 필드/규칙과 일관(structured output 강제는 advisor.ts에서). 근거: 필드 기술 테스트.
- Safety **5** — system이 "제안자, 집행자 아님" 명시, `lib/server/trading/**` **무수정**, advisor `placeOrder`/`createOrderRaw` **미참조**(grep). 근거: 가드레일 테스트 + git status + grep.
- Security & Privacy **5** — 프롬프트는 마스킹 스냅샷만 임베드(account 식별자 미누출 테스트), server-only, 번들 35파일 클린. 근거: 미누출 테스트 + build.
- Determinism/Testability **5** — 순수·결정적(두 호출 deepEqual). 근거: prompt.test.ts.
- UX **N/A** — UI 없음.
- Code quality **5** — 순수·외과적(신규 2파일). 근거: git status.

**최저축**: LLM 정합성(structured output 강제 미배선) → **다음 개선(#27, A2 시작)**: `advisor/advisor.ts` — `snapshot→prompt→provider(주입)→zod parse→validate→result` 오케스트레이션. **stub provider로 정상·파싱실패·검증탈락 결정적 테스트.**
**★ A1 결정적 코어 완료 → A2 전진**: A1 종료조건(provider 추상화·snapshot·schema/validate·prompt·키 번들 미노출·env 미설정 부팅) 충족, Safety/Security=5. 남은 "어드바이저 경로 not configured"는 라우트(A2)에서 종단 검증. §5.3 advance → **Phase A2**.

---

## #27 | phase4 | A2: `advisor/advisor.ts` 오케스트레이션 (provider stub)

**한 일**: `runAdvisor({provider, snapshot, validation, jsonSchema})` — `prompt(snapshot)→provider.chat(주입)→JSON.parse→advisorResultSchema.safeParse→validateProposals→result{advice,proposals(플래그),model}`. provider 응답은 **신뢰경계 밖**: JSON 파싱/zod 실패는 `AdvisorResponseError`(typed)로 강등(크래시 아님), 무효 제안은 **탈락 아닌 플래그**(valid:false, drop 안 함). 비결정 provider는 stub으로 격리. TDD: advisor.test.ts 5건(정상·환각 제안 플래그·비JSON 파싱실패·스키마불일치·프롬프트/jsonSchema 전달).

**객관 게이트(직접 재실행 — 근거):**
- lint exit 0 / typecheck exit 0
- build exit 0 — **번들 가드 35파일 클린**(advisor server-only)
- test — 신규 5건 포함 **411 passed (427, 34 files)**. 실패 16건 동일 **환경 아티팩트**. 무력화·skip 없음.

**루브릭 점수 + 근거:**
- Functionality **5** — A2 오케스트레이션 코어 완성(snapshot→...→validate). 근거: advisor 5/5.
- LLM 정합성 **5** — 응답 zod 재검증(파싱/스키마 실패 typed 에러), structured output schema provider 전달 확인. 근거: 파싱실패·jsonSchema 전달 테스트.
- Safety **5(타협 불가 충족)** — **§6.A-1 코드 증명**: advisor가 `placeOrder`/`createOrderRaw`/`getServerTradingExecutor`/`getServerAutoTrader` **미참조**(grep none). 무효 제안 자동집행 없이 플래그만. `lib/server/trading/**` **무수정**. 근거: grep + git status + 플래그 테스트.
- Security & Privacy **5** — advisor server-only, 번들 35파일 클린. 근거: build.
- Determinism/Testability **5** — 비결정 provider stub 격리, 5건 결정적(정상/실패/탈락). 근거: advisor.test.ts.
- UX **N/A** — UI 없음(라우트는 #28).
- Code quality **5** — 단일 오케스트레이션 함수, typed 에러, 외과적(신규 2파일). 근거: git status.

**최저축**: 없음(핵심 축 5; UX 비해당) → **다음 개선(#28)**: `app/api/advisor/route.ts` POST(`force-dynamic`) — 데이터 수집(snapshot/validation: toss client)→`runAdvisor`→`{data:{advice,proposals,model,generatedAt}}` 봉투, 에러 매핑(`AdvisorResponseError`→sanitize, `LlmNotConfiguredError`→명확한 not-configured 코드). 라우트 테스트(advisor/container stub).
**Phase 전진 판정**: A2 종료조건(라우트·§6.A-1 grep·PII 미전송 단언) 미충족 → advance 없음, A2 계속.
