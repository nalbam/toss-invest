# PROGRESS — 토스증권 대시보드 (현재 상태만)

## 현재 위치
- **Phase**: 1 (읽기전용 대시보드)
- **마지막 이터레이션**: #5 완료 (주문조회 GET list/detail + 라우트 + 주문내역(대기) 섹션)
- **다음 pick (#6)**: 시세 GET 클라이언트(`orderbook`, `trades`, `price-limits`, `candles`) + 프록시 라우트 + 계약 테스트. (rate limiter에 `MARKET_DATA_CHART:5` 그룹 추가 — candles용). 이후 #7 시세 대시보드 섹션(현재가/호가/캔들 차트) UI, #8 나머지 GET(stocks/warnings/market-calendar/buying-power/sellable-quantity/commissions) + **Playwright E2E**로 Phase 1 종료조건 1·3 완성.

## 확정된 아키텍처 결정
- Next.js **15.5.19** App Router, TS **strict**, **pnpm**. Tailwind X, alias `@/*`.
- 테스트: **Vitest**. 서버=node, UI=jsdom(`// @vitest-environment jsdom`, setup `test/setup-jest-dom.ts`). `vitest.config.ts` `.tsx` include + oxc.jsx automatic.
- **build 게이트**: `rm -rf .next && next build && node scripts/check-bundle-secrets.mjs`(클린 빌드 + 시크릿 번들 가드).
- 시크릿 격리: 서버 전용 `lib/server/**` + `server-only`. env zod(`lib/server/env.ts`, lazy `getEnv()`).
- 서버 toss 계층 `lib/server/toss/`: `auth`(토큰), `client`(Bearer·`X-Tossinvest-Account`·봉투·`TossApiError`·429 백오프), `rate-limiter`(그룹 토큰버킷: ACCOUNT1·ASSET5·MARKET_DATA10·MARKET_INFO3·**ORDER_HISTORY5**), `schemas`(decimal=string, enum=literal+string fallback), `endpoints`, `container`(`getServerTossClient` facade). decimal 문자열·enum unknown 허용 일관.
- API 프록시 라우트(`dynamic='force-dynamic'`, 에러 sanitize via `lib/server/api/respond.ts`): `app/api/{accounts,holdings,prices,exchange-rate,orders,orders/[orderId]}/route.ts`. 성공 `{data}`, accountSeq 미제공 시 첫 계좌 폴백.
- 클라이언트: `lib/client/{types,format,hooks}.ts`(서버 import 금지). 훅 useAccounts/useHoldings/useExchangeRate/**useOrders**. 컴포넌트 `app/_components/{Dashboard,PortfolioSummary,HoldingsTable,FxRate,OrdersTable}.tsx`. SWR `revalidateOnFocus:false`.

## 게이트 (4개)
`pnpm run lint` · `pnpm run typecheck` · `pnpm run test` · `pnpm run build`(클린+번들 가드)

## Phase 1 종료 조건
- [ ] mock 계약 테스트로 **모든** GET 엔드포인트 클라이언트 통과 — **부분(6/16)**: accounts·holdings·prices·exchange-rate·orders(list)·orders/{orderId} ✅.
- [x] 시크릿이 클라이언트 번들에 없음 — build 게이트 가드(21파일 클린).
- [~] 대시보드가 포트폴리오 요약·보유종목·주문내역·시세 렌더 — **요약·보유종목·주문내역(대기) ✅**(jsdom 렌더 테스트), 시세 섹션 미구현(#6~#7), Playwright E2E 미작성(#8).
- [x] lint·typecheck·test·build 전부 green.

### 완료
- [x] #1 스캐폴드 + 게이트 + 시크릿 격리 + OAuth 토큰 모듈
- [x] #2 베이스 클라이언트 + 코어 GET 4종 + 계약 테스트(37)
- [x] #3 API 프록시 라우트 4종 + 시크릿 번들 가드 + 라우트 테스트(48)
- [x] #4 대시보드 UI(요약·보유종목·FX) + SWR 훅 + format + jsdom 렌더(71)
- [x] #5 주문조회 GET(list/detail) + 라우트 + 주문내역(대기) 섹션 + 계약/렌더 테스트(87)

## 남은 GET 엔드포인트
orderbook · trades · price-limits · candles · stocks · stocks/{symbol}/warnings · market-calendar/KR · market-calendar/US · buying-power · sellable-quantity · commissions

## 미해결/후속
- 주문조회 `status=CLOSED` 업스트림 미지원(400 closed-not-supported) → UI는 OPEN(대기)만 표시. 향후 지원 시 확장.
- 페이지네이션은 스키마/엔드포인트까지만(orders는 OPEN이라 단일 페이지). 다중 페이지 UI는 필요 시.
- Playwright E2E(브라우저 미설치) — #8에서 `playwright install chromium` 후 route-mock 렌더 스펙(`test:e2e` 스크립트 존재).
- 선제 스로틀·market-calendar 기반 폴링 완화 미구현. 환율 USD/KRW 고정.
- **운영**: build가 매번 `rm -rf .next`로 클린 빌드(증분 캐시 오탐 방지).
