# PROGRESS — 토스증권 대시보드 (현재 상태만)

## 현재 위치
- **Phase**: 1 (읽기전용 대시보드)
- **마지막 이터레이션**: #4 완료 (포트폴리오 요약 + 보유종목 대시보드 UI + SWR 훅 + jsdom 렌더 테스트)
- **다음 pick (#5)**: 주문조회 GET(`/orders` list, `/orders/{orderId}` detail) 클라이언트 + 프록시 라우트 + **주문내역 대시보드 섹션** + 계약 테스트. (종료조건 1·3의 "주문내역" 전진). 이후 #6 시세(orderbook/trades/candles/price-limits) + "시세" 섹션, #7 나머지 GET(stocks/market-calendar/buying-power/sellable-quantity/commissions) + **Playwright E2E**로 종료조건 1·3 완성.

## 확정된 아키텍처 결정
- Next.js **15.5.19** App Router, TS **strict**, **pnpm**. Tailwind X, src dir X, alias `@/*`.
- 테스트: **Vitest**. 서버 모듈=node 환경, UI 컴포넌트=jsdom(파일 상단 `// @vitest-environment jsdom`, setup `test/setup-jest-dom.ts`). `vitest.config.ts`에 `.tsx` include + oxc.jsx automatic.
- **build 게이트**: `rm -rf .next && next build && node scripts/check-bundle-secrets.mjs` — 클린 빌드(증분 캐시 오탐 방지) + 시크릿 번들 가드.
- 시크릿 격리: 서버 전용 `lib/server/**` + `server-only`. env zod(`lib/server/env.ts`, lazy `getEnv()`).
- 토큰/클라이언트/rate limiter/스키마/엔드포인트: `lib/server/toss/{auth,client,rate-limiter,schemas,endpoints,container}.ts`. decimal=문자열, enum=literal+string fallback, 봉투 `{result}`/`{error}`, `TossApiError`, 429 백오프.
- API 프록시 라우트(`dynamic='force-dynamic'`): `app/api/{accounts,holdings,prices,exchange-rate}/route.ts`. 성공 `{data}`, 에러 `{error:{code,message,requestId?}}` sanitize. 공통 `lib/server/api/respond.ts`.
- **클라이언트**: `lib/client/types.ts`(서버 import 금지), `lib/client/format.ts`(문자열 decimal→통화/% 포맷), `lib/client/hooks.ts`('use client' SWR: useAccounts/useHoldings/useExchangeRate, `ApiClientError`). 컴포넌트 `app/_components/{Dashboard,PortfolioSummary,HoldingsTable,FxRate}.tsx` + `dashboard.module.css`. 대시보드는 `app/page.tsx`(Dashboard 조립). SWR `revalidateOnFocus:false, shouldRetryOnError:false`.

## 게이트 (4개)
`pnpm run lint` · `pnpm run typecheck` · `pnpm run test` · `pnpm run build`(클린+번들 가드)

## Phase 1 종료 조건
- [ ] mock 계약 테스트로 **모든** GET 엔드포인트 클라이언트 통과 — **부분(4/16)**: accounts·holdings·prices·exchange-rate ✅.
- [x] 시크릿이 클라이언트 번들에 없음 — build 게이트 가드(19파일 클린).
- [~] 대시보드가 포트폴리오 요약·보유종목·**주문내역·시세** 렌더 — **요약·보유종목 ✅**(jsdom 렌더 테스트), 주문내역·시세 섹션 미구현(#5~#6), Playwright E2E 미작성(#7).
- [x] lint·typecheck·test·build 전부 green.

### 완료
- [x] #1 스캐폴드 + 게이트 + 시크릿 격리 + OAuth 토큰 모듈
- [x] #2 베이스 클라이언트 + 코어 GET 4종 + 계약 테스트(37)
- [x] #3 API 프록시 라우트 4종 + 시크릿 번들 가드 + 라우트 테스트(48)
- [x] #4 대시보드 UI(요약·보유종목·FX) + SWR 훅 + format + jsdom 렌더 테스트(71)

## 남은 GET 엔드포인트
orderbook · trades · price-limits · candles · stocks · stocks/{symbol}/warnings · market-calendar/KR · market-calendar/US · orders(조회) · orders/{orderId} · buying-power · sellable-quantity · commissions

## 미해결/후속
- Playwright E2E(브라우저 미설치) — #7에서 `playwright install chromium` 후 route-mock 렌더 스펙. (`test:e2e` 스크립트는 존재)
- 종목별 비중·시세·주문내역 뷰(#5~#6).
- 선제 스로틀·market-calendar 기반 폴링 완화 미구현. 환율은 USD/KRW 고정.
- **운영 노트**: 증분 `.next` 캐시가 깨지면 빌드 오탐 가능 → build 스크립트가 매번 `rm -rf .next`로 클린 빌드.
