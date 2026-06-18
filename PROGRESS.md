# PROGRESS — 토스증권 대시보드 (현재 상태만)

## 현재 위치
- **Phase**: **2 (수동 거래, dry-run 기본)** — Phase 1 완료 후 진입.
- **마지막 이터레이션**: #11 완료 (주문 게이트 notional **통화-인지** 수정 → **Safety 5 복귀**). `isKrwSymbol`(`^\d{6}$`→KRW, 그 외→USD)+`nativeToKrw`(USD는 fxRate 환산, 없으면 BLOCK fail-safe). 회귀 테스트(US LIMIT 대형 주문 한도초과 BLOCK)·기존 안전 테스트 무회귀(189 tests).
- **다음 pick (#12)**: 주문 정정/취소(POST modify/cancel) — `OrderModifyRequest` 스키마(jq 확인) + `modifyOrderRaw`/`cancelOrderRaw`(ungated, ORDER 그룹·계좌헤더) + **§6 게이트를 정정/취소에도 적용**(정정은 notional 재평가, 취소는 kill switch/감사만; dry-run 기본·확인 게이트). 상태(`already-filled/canceled/modified/rejected`, `request-in-progress`) 처리. 라우트/UI는 #13.

## ⚠️ Phase 2 안전 불변식 (§6 — 약화 금지, 메타 가드)
- **DRY_RUN 기본 true** — 환경변수로만 끄고, 끄려면 확인 게이트 추가 통과.
- **실주문 확인 게이트**: 실제 `POST /orders*`는 (a)`DRY_RUN=false` + (b)확인(수동=주문단위 사람 입력) + (c)한도 통과일 때만. 하나라도 거짓이면 dry-run 강등+기록. **에이전트 자가 확인 토큰 발급 금지.**
- **하드 리밋**(env): 1회 최대 주문금액·일일 손실/누적·종목당 비중. **Kill switch** ON이면 전 실주문 차단.
- **고액(≥1억)**: `confirmHighValueOrder=true` 없이는 전송 금지. **멱등성** clientOrderId(dry-run 강등 시 미소비). **감사 로그**(시크릿/PII 제외).
- 안전 상수·테스트는 루프가 임의 변경 불가(사람 승인 필요). 종료 압박으로 안전 낮춰 게이트 통과 금지.

## 확정된 아키텍처 결정
- Next.js **15.5.19** App Router, TS **strict**, **pnpm**. Tailwind X, alias `@/*`.
- 테스트: **Vitest**(서버=node, UI=jsdom; 차트=`vi.mock('lightweight-charts')`). **Playwright E2E**(`test:e2e`, chromium 설치됨, `e2e/dashboard.spec.ts` route-mock 렌더 스모크, `webServer: next dev -p 3100` 더미 env, vitest는 `e2e/**` exclude).
- **build 게이트**: `rm -rf .next && next build && node scripts/check-bundle-secrets.mjs`.
- 시크릿 격리: 서버 전용 `lib/server/**` + `server-only`, env zod(`getEnv()`).
- 서버 toss 계층: `auth`·`client`·`rate-limiter`(ACCOUNT1·ASSET5·MARKET_DATA10·MARKET_INFO3·ORDER_HISTORY5·MARKET_DATA_CHART5·STOCK5·ORDER_INFO6)·`schemas`(decimal=string, openEnum)·`endpoints`(GET 17)·`container`.
- **API 프록시 라우트 17종**(`force-dynamic`, `{data}`/sanitized error). 클라이언트 `lib/client/{types,format,hooks}.ts`(서버 import 금지) + `app/_components/*`(대시보드 4섹션: PortfolioSummary·HoldingsTable·FxRate·OrdersTable·MarketQuote/Orderbook/CandleChart). 차트 lightweight-charts.

## 게이트 (4개) + E2E
`pnpm run lint` · `pnpm run typecheck` · `pnpm run test` · `pnpm run build`(클린+번들 가드). 별도: `pnpm run test:e2e`(Playwright).

## Phase 1 종료 조건 — ✅ 전부 완료
- [x] 모든 GET 엔드포인트 클라이언트 계약 테스트 — **17/17**.
- [x] 시크릿 클라이언트 번들 미노출 — build 가드(33파일 클린).
- [x] 대시보드(요약·보유종목·주문내역·시세) 렌더 — jsdom 컴포넌트 테스트 + **Playwright E2E 통과**.
- [x] lint·typecheck·test·build green.

### 완료 이터레이션
- #1 스캐폴드+게이트+시크릿격리+토큰(누적 test) · #2 베이스 클라이언트+코어 GET4(37) · #3 프록시 라우트4+번들가드(48) · #4 대시보드 UI 요약·보유(71) · #5 주문조회+주문내역섹션(87) · #6 시세 GET4(110) · #7 시세 섹션+차트(123) · #8 나머지 GET7→17/17(157) · #9 Playwright E2E → **Phase 1 종료**.

## Phase 2 진행/로드맵
- [x] #10 주문 생성 §6 안전 계층 + dry-run 실행기 + 안전 테스트(186). `lib/server/trading/safety.ts`(`getTradingConfig`/`evaluateOrderGate` 순수/`placeOrder` 실행기), `createOrderRaw`(ungated 저수준, 직접노출 금지), ORDER:6 그룹, `orderCreateRequestSchema`(union+refine). **단 USD LIMIT notional 갭(↑#11)**.
- [x] #11 안전 갭 수정(통화 추론+fxRate 환산, USD&fxRate없으면 BLOCK) → **Safety 5 복귀**(189).
- [ ] #12 주문 정정/취소(POST modify/cancel) + §6 게이트 적용 + 상태(`already-*`) 처리.
- [ ] #13 사전검증 연동(buying-power/sellable-quantity/commissions/price-limits) + 게이트된 API 라우트 + 주문 폼 UI(dry-run 미리보기, 실주문은 사람 확인).
- 이후 Phase 3(제한적 자동거래): 전략 intent(순수)→executor(한도·kill switch 내)→감사로그, 백테스트.

## 미해결/후속
- 차트 페이지네이션·useTrades·심볼 검증·테마 토큰, 선제 스로틀·market-calendar 폴링 완화, 주문조회 CLOSED 미지원, dev `allowedDevOrigins` 경고(무해).
- 운영: build 매번 `rm -rf .next` 클린.
