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
