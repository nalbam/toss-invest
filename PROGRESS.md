# PROGRESS — 토스증권 대시보드 (현재 상태만)

## 현재 위치
- **Phase**: dev-loop **1·2·3 완료**. **Phase 4 (AI 어드바이저) A1·A2·A3 전체 완료** — advisor-loop-prompt.md #19~#33, §0 따라 루프 종료.
- **마지막 이터레이션**: #33 완료 (A3: Playwright 어드바이저 스모크 → **Phase 4 완료, 루프 종료**). `e2e/dashboard.spec.ts`에 route-mock 어드바이저 카드 렌더·"조언 받기"→제안 표시 스모크(통과). `lib/server/trading/**` **무수정**. #33 시점 444 vitest + e2e 스모크.
- **현 상태**: **482 vitest tests(41 파일), lint·typecheck·test·build 전부 green** (번들 가드 55파일). #33 advisor-loop 종료 후 사람 주도 추가 작업이 이어짐(↓ "루프 종료 후").
- **⚠️ 기존 e2e 결함(어드바이저 무관)**: `renders … market quote` e2e가 심볼 미자동선택으로 실패(원본 커밋에서도 동일). 후속 분리(테스트가 보유 종목 선택하도록 갱신 or 대시보드 기본 선택 — 사람 결정).
- **다음 작업**: advisor-loop 종료. 추가 개선(아래 후속)은 사람 명시 요청 시 새 루프/이터로.

## 루프 종료 후 (사람 주도 추가)
advisor-loop(#19~#33) 종료 뒤 이터레이션 번호 없는 직접 작업으로 추가됨:
- **차트 어드바이저** (`MarketAiAdvisor` + `/api/market-advisor` POST·`/history` GET) — 캔들 → LLM 조언 + 참고 판단(buy/sell/hold/wait) + 차트 지지/저항선·마커. 조언 히스토리 Redis 캐시.
- **Redis/Valkey best-effort 캐시** (`lib/server/cache/{redis,market-history}.ts`) — 시세·캔들·조언 히스토리. `CACHE_REDIS_URL`/`CACHE_KEY_PREFIX`(env.ts zod 밖, 기본값 폴백).
- **테마 선택** (`ThemeSelector`, 시스템/라이트/다크, localStorage) — 기존 "테마 토큰" 후속 해소.
- **어드바이저 자동 재실행** (`useAdvisorAutoRerun`·`AdvisorAutoControls`) — 포트폴리오·차트 공용 주기 재실행.
- **시장 캘린더 프록시** (`/api/market-calendar/{kr,us}`) — 백엔드 전용(현재 UI 미연결).
- **CandleChart** — 평균단가선·조언 annotation·visible-range 구독 재그리기. (Toss candles `count`/`before`/`nextBefore` 페이지네이션은 API/route만 준비, 클라이언트+무한스크롤 UI 미구현.)
- **포트폴리오 advisor structured output 배선** — `/api/advisor`가 `response_format` json_schema 전달, zod 재검증은 안전망 유지.
- **BUY 신규 심볼 실재 검증** (§6.A-4 완화, 사용자 승인) — 미보유 BUY 제안 심볼을 Toss `getStocks`로 실재 확인해 valid 허용. 미주입·검증 실패·예외는 fail-closed 유지(`runAdvisor.verifySymbol`); SELL은 보유 검사로 여전히 차단. advisor는 order-exec 미참조(§6.A-1).
- **회귀 복구** — MarketQuote·Dashboard 테스트의 stale lightweight-charts 목(visible-range 구독 메서드 누락)과 ThemeSelector 접근성 이름("테마") 수정 → 스위트 green 복귀(482).

## Phase 4 — AI 어드바이저 (진행 중)
LLM(OpenAI·xAI) 기반 온디맨드 조언 카드 + 구조화된 주문 제안. **LLM은 제안자, 집행자 아님** — 제안→사람 confirm→기존 §6 게이트. 상세: [`docs/advisor-loop-prompt.md`](docs/advisor-loop-prompt.md).

### 확정된 결정 (A1)
- **env(선택값)**: `LLM_PROVIDER`(openai|xai)·`OPENAI_API_KEY`·`XAI_API_KEY`·`LLM_MODEL`. 미설정이어도 앱 정상 부팅, 어드바이저 경로만 "not configured"(예정). blank→undefined(.env.example 트랩).
- **시크릿 격리**: LLM 키는 server-only, 번들 가드(`check-bundle-secrets.mjs`)에 LLM 패턴 추가 — client 번들 미노출 회귀 방지.
- **디렉터리**: `lib/server/llm/`(provider 추상화 — `types.ts`·`chat-completions.ts`·`openai.ts`·`xai.ts`·`container.ts` **완료**)·`lib/server/advisor/`(`snapshot.ts`·`schema.ts`·`validate.ts`·`prompt.ts`·`advisor.ts` **완료**)·`app/api/advisor/route.ts`·`lib/client/advisor.ts`·`app/_components/AiAdvisor.tsx`(예정).

### A1 종료조건 (UI 없음, provider 호출 전 결정적 코어)
- [x] `LlmProvider` 인터페이스 + OpenAI·xAI 어댑터(mocked fetch 계약 테스트) — #20 인터페이스+OpenAI, #21 xAI+공유 코어(14 계약 테스트)
- [x] `container.ts` `getServerLlmProvider`/`resolveLlmProvider` — #22(LLM_PROVIDER 선택 + LlmNotConfiguredError, 7 테스트)
- [x] `snapshot` 마스킹(식별자/PII 제거 + 화이트리스트 단위 테스트) — #23(`buildAdvisorSnapshot`, 6 테스트·PII 미직렬화 단언)
- [x] `schema`(zod) parse + `validate`(보유·매도가능수량·심볼 실재·정수·side) 단위 테스트 — #24 schema(9), #25 validate(8, 환각/무효 탈락)
- [x] `prompt.ts`(순수) 마스킹 스냅샷 → system+user 프롬프트 빌드 + 단위 테스트 — #26(6 테스트, 가드레일·결정성)
- [x] LLM 키 클라이언트 번들 미노출(번들 가드 확장 + build 클린) — #19 패턴 추가
- [~] env 미설정 시 부팅 정상(#19 env 선택값) + 어드바이저 경로만 "not configured"(#22 `LlmNotConfiguredError`; 라우트 매핑은 A2 #28)
- [x] lint·typecheck·test·build green

**→ A1 결정적 코어 완료(#26). A2 진행 중.**

### A2 (완료)
- [x] advisor 오케스트레이션(snapshot→prompt→provider→zod→validate) — #27 `runAdvisor`(stub 5 테스트). **§6.A-1: order-exec 미참조(grep)**.
- [x] `app/api/advisor/route.ts` POST(`force-dynamic`, `{data}` 봉투, 에러 매핑, not-configured) + 라우트 테스트 — #28(6 테스트).
- [x] 외부 전송 페이로드 PII 미포함 단언(#28 route 테스트), lint·typecheck·test·build green.

### A3 (진행 중)
- [x] `lib/client/advisor.ts`(온디맨드 fetcher, 자동폴링 X) — #29(`fetchAdvisor`, node-env 5 테스트).
- [x] (인프라) jsdom `localStorage` 폴리필 — #30(`test/setup-jest-dom.ts`, 16건 환경 실패 해소 → 스위트 전부 green).
- [x] `AiAdvisor.tsx`(CollapsibleCard: 버튼·로딩·조언·제안·disclaimer·미설정/에러) — #31(5 테스트, 무효=prefill 불가).
- [x] "폼에 담기" prefill → 기존 OrderForm(자동 전송 X, confirm·§6 유지) + Dashboard 배선 — #32(OrderForm prefill prop, §6.A-2 미전송 테스트).
- [x] Playwright 스모크(route-mock) 카드 렌더·제안 표시 — #33(통과).

**→ A3 완료 → Phase 4(A1·A2·A3) 전체 완료 → advisor-loop 종료(§0).**

### A2·A3 후속(사람 요청 시)
- structured output `response_format`(zod→strict JSON schema 변환) 배선 — 현재 zod 재검증으로 대체(안전), provider 신뢰도 향상용.
- BUY 제안 신규 심볼 Toss 실재 검증 라운드(현재 fail-closed 차단, §6.A-4).

### Phase 3 종료 조건 (dev-loop §4) — ✅ 전부 충족
- [x] 백테스트/시뮬레이션 하네스 결정적 검증(#17 runBacktest).
- [x] 한도 위반·kill switch 시 실행 거부 증명(#18, §6 게이트 경유 — kill/한도/notional-unknown BLOCK + createOrderRaw 미호출 테스트).
- [x] 모든 자동 주문 경로 dry-run 기본 + 명시 활성화 없이 실주문 불가(#18, AUTO_TRADE_ENABLED 기본 false → 전부 dry-run, raw 미호출 테스트).
- [x] lint·typecheck·test·build green.

### Phase 3 로드맵
- [x] #16 전략 intent 순수 계층 + 테스트(280).
- [x] #17 백테스트/시뮬레이션 하네스(합성/과거 캔들, 결정적)(292).
- [x] #18 게이트된 자동 executor(intent→§6 `placeOrder`, AUTO_TRADE_ENABLED 기본 false·한도·kill 뒤, dry-run 기본·실주문 도달불가 증명) + facade(상시 루프 없음)(306). → **Phase 3 종료 → 로드맵 전체 완료.**

## ✅ Phase 2 (수동 거래) 종료조건 — 전부 충족
- [x] dry-run 페이로드 = API 계약 일치(게이트/라우트/폼 테스트). [x] 실주문 확인게이트 없이 도달불가(confirm 바디전용·자동 true 없음·게이트 테스트). [x] 사전검증 실패(insufficient-buying-power/price-out-of-range/order-hours-closed) 422 매핑 테스트. [x] gates green.

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
- 서버 toss 계층: `auth`·`client`·`rate-limiter`(ACCOUNT1·ASSET5·MARKET_DATA10·MARKET_INFO3·ORDER6·ORDER_HISTORY5·MARKET_DATA_CHART5·STOCK5·ORDER_INFO6)·`schemas`(decimal=string, openEnum)·`endpoints`(GET 17)·`container`.
- **API 라우트(GET 18: Toss 프록시 17 + market-advisor/history 캐시 / POST 5: orders create·modify·cancel + advisor + market-advisor)**(`force-dynamic`, `{data}`/sanitized error). 클라이언트 `lib/client/{types,format,hooks,quote,candles,polling}.ts`(서버 import 금지) + `app/_components/*`(`Dashboard` 루트의 3-컬럼 레이아웃: 시세 `MarketQuote`/`Orderbook`/`CandleChart` · 주문 `OrderForm` · 사이드바 `AccountCash`(현금·환율)/`PortfolioSummary`/`HoldingsTable`/`OrdersTable`+`ModifyOrderForm`; 공용 `CollapsibleCard`·`Money`). 차트 lightweight-charts.

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
- [x] #15 정정/취소 UI(2단계 인라인 확인) + 사전검증/422 에러 테스트 → **Phase 2 종료**(266).

### Phase 2 종료 조건 (dev-loop §4) — 현황
- [x] dry-run에서 주문 생성/정정/취소 요청 페이로드가 API 계약과 일치(게이트/라우트 테스트 — dry-run wouldSend=요청).
- [x] 실주문 경로는 확인 게이트 없이 도달 불가(게이트 테스트 + 라우트 confirm 바디전용·grep 검증).
- [~] 사전검증 실패(잔고부족·틱사이즈·장마감) 처리 — buying-power/sellable preview 플래그 + TossApiError(422 insufficient/price-out-of-range/order-hours-closed) 매핑. 명시 케이스 테스트 보강 여지(#14/#15).
- [x] lint·typecheck·test·build green.
- 이후 Phase 3(제한적 자동거래): 전략 intent(순수)→executor(한도·kill switch 내)→감사로그, 백테스트.

## 미해결/후속
- 차트 페이지네이션(Toss API/route 준비됨, 클라이언트+무한스크롤 UI 미구현 — 사람 결정으로 보류)·useTrades(UI 소비자 없음)·선제 스로틀·market-calendar UI 연결, 주문조회 CLOSED 미지원(Toss 400 `closed-not-supported`), dev `allowedDevOrigins` 경고(무해). (테마 토큰은 `ThemeSelector`로, BUY 신규 심볼 검증은 위 "루프 종료 후"로 해소.)
- 운영: build 매번 `rm -rf .next` 클린.
