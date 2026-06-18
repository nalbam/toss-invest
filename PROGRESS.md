# PROGRESS — 토스증권 대시보드 (현재 상태만)

## 현재 위치
- **Phase**: 1 (읽기전용 대시보드)
- **마지막 이터레이션**: #7 완료 (시세 대시보드 섹션 — 현재가/상하한가/호가/캔들 차트)
- **다음 pick (#8)**: 나머지 GET 클라이언트 + 라우트 + 계약 테스트로 **종료조건 1(16/16) 완성** — stocks, stocks/{symbol}/warnings(STOCK 5/s), market-calendar/KR·US(MARKET_INFO 3/s), buying-power·sellable-quantity·commissions(ORDER_INFO 6/s, 계좌헤더; Phase 2 거래에 활용). 이후 #9 **Playwright E2E**(브라우저 설치 + route-mock 렌더 스펙)로 종료조건 3 완전 충족 + **Phase 1 종료** 판정.

## 확정된 아키텍처 결정
- Next.js **15.5.19** App Router, TS **strict**, **pnpm**. Tailwind X, alias `@/*`.
- 테스트: **Vitest**. 서버=node, UI=jsdom(`// @vitest-environment jsdom`, setup `test/setup-jest-dom.ts`). canvas 의존 차트는 `vi.mock('lightweight-charts')`로 스모크.
- **build 게이트**: `rm -rf .next && next build && node scripts/check-bundle-secrets.mjs`.
- 시크릿 격리: 서버 전용 `lib/server/**` + `server-only`. env zod(`getEnv()`).
- 서버 toss 계층: `auth`·`client`·`rate-limiter`(ACCOUNT1·ASSET5·MARKET_DATA10·MARKET_INFO3·ORDER_HISTORY5·MARKET_DATA_CHART5)·`schemas`(decimal=string, openEnum)·`endpoints`·`container`.
- API 프록시 라우트(`force-dynamic`, `{data}`/sanitized error): accounts·holdings·prices·exchange-rate·orders·orders/[orderId]·orderbook·trades·price-limits·candles.
- 클라이언트: `lib/client/{types,format,hooks}.ts`(서버 import 금지). 훅 useAccounts/useHoldings/useExchangeRate/useOrders/usePrices/usePriceLimits/useOrderbook/useCandles. 컴포넌트 `app/_components/{Dashboard,PortfolioSummary,HoldingsTable,FxRate,OrdersTable,MarketQuote,Orderbook,CandleChart}.tsx`. 차트 = **lightweight-charts 5.2.0**(캔들 특화), `toChartSeries` 순수 변환 분리.

## 게이트 (4개)
`pnpm run lint` · `pnpm run typecheck` · `pnpm run test` · `pnpm run build`(클린+번들 가드)

## Phase 1 종료 조건
- [ ] mock 계약 테스트로 **모든** GET 엔드포인트 클라이언트 통과 — **부분(10/16)**: accounts·holdings·prices·exchange-rate·orders·orders/{id}·orderbook·trades·price-limits·candles ✅. 남은 6 ↓(#8).
- [x] 시크릿이 클라이언트 번들에 없음 — build 게이트 가드(26파일 클린).
- [~] 대시보드 렌더(요약·보유종목·주문내역·시세) — **4개 섹션 모두 컴포넌트 레벨 완성 + jsdom 렌더 테스트 ✅**. 풀 브라우저 Playwright E2E만 미작성(#9).
- [x] lint·typecheck·test·build 전부 green.

### 완료
- [x] #1 스캐폴드 + 게이트 + 시크릿 격리 + OAuth 토큰
- [x] #2 베이스 클라이언트 + 코어 GET 4종 + 계약(37)
- [x] #3 API 프록시 라우트 4종 + 시크릿 번들 가드(48)
- [x] #4 대시보드 UI(요약·보유종목·FX)(71)
- [x] #5 주문조회 GET + 주문내역(대기) 섹션(87)
- [x] #6 시세 GET 4종 + 라우트(110)
- [x] #7 시세 대시보드 섹션(현재가·상하한가·호가·캔들 차트)(123)

## 남은 GET 엔드포인트 (#8)
stocks · stocks/{symbol}/warnings · market-calendar/KR · market-calendar/US · buying-power · sellable-quantity · commissions

## 미해결/후속
- Playwright E2E(#9, 브라우저 미설치, `test:e2e` 스크립트 존재) — 종료조건 3 완전 충족 + Phase 1 종료 판정.
- 차트: lightweight-charts 정적 import로 First Load JS 증가(필요 시 next/dynamic 분할), 테마 토큰 미연동, candles 페이지네이션(nextBefore)·useTrades·심볼 검증 미구현.
- 주문조회 CLOSED 미지원(OPEN만). 선제 스로틀·market-calendar 폴링 완화 미구현. 환율 USD/KRW 고정.
- **Phase 2 예고**: 주문 생성/정정/취소(POST) + §6 안전 게이트(DRY_RUN 기본·확인 게이트·한도·kill switch). buying-power/sellable-quantity/commissions가 사전검증 입력.
