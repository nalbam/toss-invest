# PROGRESS — 토스증권 대시보드 (현재 상태만)

## 현재 위치
- **Phase**: **2 (수동 거래, dry-run 기본)** — Phase 1 완료 후 진입.
- **마지막 이터레이션**: #14 완료 (주문 생성 폼 UI). `app/_components/OrderForm.tsx`('use client', 심볼·side·유형·수량/가격·금액토글·**confirm 체크박스**), `lib/client/hooks.submitOrder`, Dashboard 섹션. 응답 status별 표시 — DRY_RUN "🔍 미리보기(전송 안 됨)"+wouldSend+prevalidation / BLOCKED "⛔"+reasons / SENT "✅"+orderId / 에러 code·message. confirm 체크 상태 그대로 전송(클라이언트 자동 true 없음), 최종 판정은 서버 §6 게이트. 243 tests.
- **다음 pick (#15)**: 정정/취소 UI(OrdersTable의 대기 주문에 취소 버튼 + 정정 폼, confirm 게이트 동일) + **사전검증 실패 케이스 명시 테스트 보강**(insufficient-buying-power/price-out-of-range/order-hours-closed 매핑) → **Phase 2 종료조건 점검 + Phase 3(제한적 자동거래) 진입 판정**.

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
- [x] #12 주문 정정/취소(POST modify/cancel) + §6 게이트 적용(220). `already-*`/422는 TossApiError로 전파(라우트에서 매핑은 #13).
- [x] #13 게이트된 주문 API 라우트(create/modify/cancel, DRY_RUN 기본·confirm 바디전용) + 사전검증 preview + 에러 매핑(237).
- [x] #14 주문 생성 폼 UI(dry-run 미리보기·confirm 체크박스·BLOCKED/SENT/에러 표시)(243).
- [ ] #15 정정/취소 UI + 사전검증 실패 케이스 테스트 보강 → Phase 2 종료 점검 + Phase 3 진입.

### Phase 2 종료 조건 (dev-loop §4) — 현황
- [x] dry-run에서 주문 생성/정정/취소 요청 페이로드가 API 계약과 일치(게이트/라우트 테스트 — dry-run wouldSend=요청).
- [x] 실주문 경로는 확인 게이트 없이 도달 불가(게이트 테스트 + 라우트 confirm 바디전용·grep 검증).
- [~] 사전검증 실패(잔고부족·틱사이즈·장마감) 처리 — buying-power/sellable preview 플래그 + TossApiError(422 insufficient/price-out-of-range/order-hours-closed) 매핑. 명시 케이스 테스트 보강 여지(#14/#15).
- [x] lint·typecheck·test·build green.
- 이후 Phase 3(제한적 자동거래): 전략 intent(순수)→executor(한도·kill switch 내)→감사로그, 백테스트.

## 미해결/후속
- 차트 페이지네이션·useTrades·심볼 검증·테마 토큰, 선제 스로틀·market-calendar 폴링 완화, 주문조회 CLOSED 미지원, dev `allowedDevOrigins` 경고(무해).
- 운영: build 매번 `rm -rf .next` 클린.
