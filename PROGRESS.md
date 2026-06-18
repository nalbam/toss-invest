# PROGRESS — 토스증권 대시보드 (현재 상태만)

## 현재 위치
- **Phase**: 1 (읽기전용 대시보드) — 거의 완료, #9만 남음
- **마지막 이터레이션**: #8 완료 (나머지 GET 7종 + 라우트 + 계약 테스트 → **전 GET 17/17 완성**)
- **다음 pick (#9)**: **Playwright E2E** — `playwright install chromium` 후 `webServer`(dev) + route-mock으로 대시보드(요약·보유종목·주문내역·시세) 렌더 E2E 스펙 작성·실행. 통과 시 **Phase 1 종료조건 3 완전 충족 → Phase 1 종료 판정 후 Phase 2(수동 거래) 진입**. (E2E가 환경 불안정하면 §5.5 회로차단기 따라 보류·보고하고 Phase 2 진입은 보류.)

## 확정된 아키텍처 결정
- Next.js **15.5.19** App Router, TS **strict**, **pnpm**. Tailwind X, alias `@/*`.
- 테스트: **Vitest**(서버=node, UI=jsdom; 차트는 `vi.mock('lightweight-charts')` 스모크). Playwright는 `test:e2e` 스크립트(브라우저 #9에서 설치).
- **build 게이트**: `rm -rf .next && next build && node scripts/check-bundle-secrets.mjs`.
- 시크릿 격리: 서버 전용 `lib/server/**` + `server-only`, env zod(`getEnv()`).
- 서버 toss 계층: `auth`·`client`(Bearer·`X-Tossinvest-Account`·봉투·`TossApiError`·429)·`rate-limiter`(ACCOUNT1·ASSET5·MARKET_DATA10·MARKET_INFO3·ORDER_HISTORY5·MARKET_DATA_CHART5·**STOCK5·ORDER_INFO6**)·`schemas`(decimal=string, openEnum, nullable.optional)·`endpoints`(17 GET)·`container`.
- **API 프록시 라우트 17종**(`force-dynamic`, `{data}`/sanitized error): accounts·holdings·prices·exchange-rate·orders·orders/[orderId]·orderbook·trades·price-limits·candles·stocks·stocks/[symbol]/warnings·market-calendar/kr·market-calendar/us·buying-power·sellable-quantity·commissions.
- 클라이언트: `lib/client/{types,format,hooks}.ts`(서버 import 금지). 컴포넌트 `app/_components/{Dashboard,PortfolioSummary,HoldingsTable,FxRate,OrdersTable,MarketQuote,Orderbook,CandleChart}.tsx`. 차트 = lightweight-charts(`toChartSeries` 순수 분리).

## 게이트 (4개)
`pnpm run lint` · `pnpm run typecheck` · `pnpm run test` · `pnpm run build`(클린+번들 가드)

## Phase 1 종료 조건
- [x] mock 계약 테스트로 **모든** GET 엔드포인트 클라이언트 통과 — **17/17 ✅** (accounts·holdings·prices·exchange-rate·orders·orders/{id}·orderbook·trades·price-limits·candles·stocks·warnings·market-calendar KR·US·buying-power·sellable-quantity·commissions).
- [x] 시크릿이 클라이언트 번들에 없음 — build 게이트 가드(33파일 클린).
- [~] 대시보드 렌더(요약·보유종목·주문내역·시세) — **4섹션 컴포넌트 레벨 ✅ + jsdom 렌더 테스트**. 풀 브라우저 **Playwright E2E만 #9**.
- [x] lint·typecheck·test·build 전부 green.

### 완료
- [x] #1 스캐폴드 + 게이트 + 시크릿 격리 + OAuth 토큰
- [x] #2 베이스 클라이언트 + 코어 GET 4종(37)
- [x] #3 API 프록시 라우트 4종 + 시크릿 번들 가드(48)
- [x] #4 대시보드 UI(요약·보유종목·FX)(71)
- [x] #5 주문조회 GET + 주문내역(대기) 섹션(87)
- [x] #6 시세 GET 4종 + 라우트(110)
- [x] #7 시세 대시보드 섹션(현재가·상하한가·호가·캔들 차트)(123)
- [x] #8 나머지 GET 7종 + 라우트 + 계약 → 전 GET 17/17(157)

## 미해결/후속
- **#9 Playwright E2E** → Phase 1 종료 판정.
- 차트 페이지네이션(nextBefore)·useTrades·심볼 검증·테마 토큰 미연동. ORDER_INFO 3종(buying-power/sellable-quantity/commissions)은 데이터 계층만(Phase 2 사전검증 입력). 주문조회 CLOSED 미지원. 선제 스로틀·market-calendar 폴링 완화 미구현.
- **Phase 2 예고**: 주문 생성/정정/취소(POST) + §6 안전 게이트(DRY_RUN 기본 true·실주문 확인 게이트·하드 리밋·kill switch·멱등성·감사 로그). buying-power/sellable-quantity/commissions/price-limits로 사전검증.

## 운영
- build가 매번 `rm -rf .next`로 클린 빌드(증분 캐시 오탐 방지).
- 자가개선 루프: 매 이터 §5.3 절차(상태읽기→증분→게이트→자기채점→상태갱신) + 커밋/푸시. 누적 점수 추세 EVAL.md.
