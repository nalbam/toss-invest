# PROGRESS — 토스증권 대시보드 (현재 상태만)

## 현재 위치
- **Phase**: 1 (읽기전용 대시보드)
- **마지막 이터레이션**: #6 완료 (시세 GET 4종 orderbook/trades/price-limits/candles + 라우트 + 계약 테스트, 데이터 계층)
- **다음 pick (#7)**: 시세 대시보드 섹션 UI — 심볼 선택 → 현재가/상하한가(price-limits)/호가(orderbook)/캔들 차트(candles). 차트 라이브러리 평가 후 선택(lightweight-charts 권장, §2). SWR 훅(useOrderbook/usePriceLimits/useCandles/useTrades) + 컴포넌트 + jsdom 렌더 테스트. 이후 #8 나머지 GET(stocks/warnings/market-calendar/buying-power/sellable-quantity/commissions) + **Playwright E2E**로 Phase 1 종료조건 1·3 완성.

## 확정된 아키텍처 결정
- Next.js **15.5.19** App Router, TS **strict**, **pnpm**. Tailwind X, alias `@/*`.
- 테스트: **Vitest**. 서버=node, UI=jsdom(`// @vitest-environment jsdom`, setup `test/setup-jest-dom.ts`). `vitest.config.ts` `.tsx` include + oxc.jsx automatic.
- **build 게이트**: `rm -rf .next && next build && node scripts/check-bundle-secrets.mjs`(클린 + 시크릿 번들 가드).
- 시크릿 격리: 서버 전용 `lib/server/**` + `server-only`. env zod(`lib/server/env.ts`, lazy `getEnv()`).
- 서버 toss 계층 `lib/server/toss/`: `auth`·`client`(Bearer·`X-Tossinvest-Account`·봉투·`TossApiError`·429)·`rate-limiter`(ACCOUNT1·ASSET5·MARKET_DATA10·MARKET_INFO3·ORDER_HISTORY5·**MARKET_DATA_CHART5**)·`schemas`(decimal=string, openEnum)·`endpoints`·`container`(facade). 시세는 계좌헤더 불필요.
- API 프록시 라우트(`dynamic='force-dynamic'`, 에러 sanitize via `lib/server/api/respond.ts`, 성공 `{data}`): `app/api/`의 accounts·holdings·prices·exchange-rate·orders·orders/[orderId]·**orderbook·trades·price-limits·candles**. (계좌형은 accountSeq 폴백, 시세형은 symbol required·candles는 interval `1m|1d` required.)
- 클라이언트: `lib/client/{types,format,hooks}.ts`(서버 import 금지). 훅 useAccounts/useHoldings/useExchangeRate/useOrders. 컴포넌트 `app/_components/{Dashboard,PortfolioSummary,HoldingsTable,FxRate,OrdersTable}.tsx`. SWR `revalidateOnFocus:false`.

## 게이트 (4개)
`pnpm run lint` · `pnpm run typecheck` · `pnpm run test` · `pnpm run build`(클린+번들 가드)

## Phase 1 종료 조건
- [ ] mock 계약 테스트로 **모든** GET 엔드포인트 클라이언트 통과 — **부분(10/16)**: accounts·holdings·prices·exchange-rate·orders(list)·orders/{id}·orderbook·trades·price-limits·candles ✅.
- [x] 시크릿이 클라이언트 번들에 없음 — build 게이트 가드(25파일 클린).
- [~] 대시보드 렌더(요약·보유종목·주문내역·시세) — **요약·보유종목·주문내역(대기) ✅**, 시세 섹션 미구현(#7), Playwright E2E 미작성(#8).
- [x] lint·typecheck·test·build 전부 green.

### 완료
- [x] #1 스캐폴드 + 게이트 + 시크릿 격리 + OAuth 토큰
- [x] #2 베이스 클라이언트 + 코어 GET 4종 + 계약(37)
- [x] #3 API 프록시 라우트 4종 + 시크릿 번들 가드(48)
- [x] #4 대시보드 UI(요약·보유종목·FX) + SWR + format(71)
- [x] #5 주문조회 GET + 라우트 + 주문내역(대기) 섹션(87)
- [x] #6 시세 GET 4종(orderbook/trades/price-limits/candles) + 라우트 + 계약(110)

## 남은 GET 엔드포인트
stocks · stocks/{symbol}/warnings · market-calendar/KR · market-calendar/US · buying-power · sellable-quantity · commissions

## 미해결/후속
- 시세 UI(#7) — 차트 라이브러리 미선택(lightweight-charts 권장).
- 주문조회 `status=CLOSED` 미지원(OPEN만). Playwright E2E(#8, 브라우저 미설치, `test:e2e` 스크립트 존재).
- 선제 스로틀·market-calendar 폴링 완화 미구현. 환율 USD/KRW 고정.
- **운영**: build가 매번 `rm -rf .next` 클린 빌드.
