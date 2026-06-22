# 아키텍처 (설계)

토스증권 Open API 기반 **1인용 개인 투자 대시보드**의 설계 문서. 거래 안전은 [trading-safety.md](trading-safety.md), API 계약은 [api-reference.md](api-reference.md), 개발 워크플로우는 [development.md](development.md), 진행/이력은 [roadmap.md](roadmap.md) 참고.

## 미션과 산출물

토스증권의 **내 계좌·보유자산·시세·거래내역을 한눈에 보는 대시보드** + **수동 거래** + **제한적 자동거래**.

- 사용자: 개발자 본인 1인(개인용). 멀티테넌트·인증 서버 불필요.
- 데이터 출처: 토스증권 Open API (REST). 웹소켓 없음 → **폴링 기반**.

## 기술 스택 (고정)

- **프레임워크**: Next.js 15 (App Router) + React 19 + TypeScript(strict), **pnpm**.
- **데이터 페칭**: 클라이언트 SWR 폴링(rate limit 존중 주기). 검증 **zod**.
- **차트**: `lightweight-charts`(시계열) + 분포형(도넛·뎁스·손익)은 인라인 SVG(추가 의존성 없음).
- **테스트**: 단위/통합 **Vitest**(서버=node, UI=jsdom), E2E·UI 흐름 **Playwright**. 토스 API는 계약(contract) 기반 mock으로 격리.
- **Tailwind 미사용**, 경로 alias `@/*`.

## 레이어링

```
app/
  api/**/route.ts      # API 프록시 라우트 (GET 17 + POST 3: orders create/modify/cancel)
  _components/*         # 대시보드 UI 섹션 + 주문 폼
  page.tsx             # 대시보드 페이지
lib/
  server/**            # server-only: 시크릿·토스 API·거래 게이트 격리
    env.ts             # zod 환경 변수 검증 (getEnv, fail-fast)
    toss/              # auth · client · rate-limiter · schemas · endpoints · container
    trading/           # safety(§6 게이트) · strategy · backtest · executor · auto-*
  client/**            # types · format · hooks · quote · candles · polling (서버 import 금지)
```

### 시크릿 격리 (필수)

`client_id`/`client_secret`/access token/`X-Tossinvest-Account`는 **서버(Route Handler / Server Action)에서만** 다룬다. 브라우저는 자체 `/api/*` 라우트만 호출하고, 그 라우트가 토스 API로 프록시한다. 모든 서버 코드는 `lib/server/**` + `server-only`. `build` 시 `scripts/check-bundle-secrets.mjs`가 클라이언트 번들에 시크릿·거래 심볼 누출이 없는지 검사한다(회귀 가드).

### Rate limit 강제 (서버)

서버 프록시에 **엔드포인트 그룹별 전역 토큰버킷**(`lib/server/toss/rate-limiter.ts`)을 둬, 여러 뷰가 동시에 폴링해도 그룹 합산 TPS 한도를 넘지 않게 강제한다. 그룹: `ACCOUNT 1`·`ASSET 5`·`MARKET_DATA 10`·`MARKET_INFO 3`·`ORDER 6`·`ORDER_HISTORY 5`·`MARKET_DATA_CHART 5`·`STOCK 5`·`ORDER_INFO 6`. 자세한 엔드포인트·TPS는 [api-reference.md](api-reference.md).

### 서버 toss 계층

`auth`(토큰 발급/캐싱/만료 전 갱신, DI fetch/clock) · `client`(인증·rate limit·에러·429 백오프) · `rate-limiter` · `schemas`(decimal=string, openEnum) · `endpoints`(GET 17 typed) · `container`(getServerTossClient).

### API 프록시 라우트

GET 17 + POST 3(create/modify/cancel). 모두 `force-dynamic`, 성공은 `{ data }`, 실패는 sanitized `{ error }` 봉투. 쿼리/바디는 zod 검증. `TossApiError`→upstream status 매핑.

## 컴포넌트 맵

`Dashboard` 루트의 3-컬럼 레이아웃:

- **시세(좌)**: `MarketQuote`(현재가·상하한가) → `CandleChart`(캔들·거래량·이동평균·상하한가 기준선·주문 체결 마커) · `Orderbook`(호가 표) · `OrderbookDepth`(누적 뎁스 SVG) · `TradesChart`(체결 추이 라인).
- **주문(중앙)**: `OrderForm`(빠른주문/일반주문, dry-run 미리보기·confirm).
- **사이드바(우)**: `AccountCash`(현금·환율) · `PortfolioSummary` · `HoldingsTable` · `PortfolioComposition`(구성 도넛 SVG) · `HoldingsPnL`(종목별 손익 막대 SVG) · `OrdersTable` + `ModifyOrderForm`.
- **공용**: `CollapsibleCard` · `Money`.

클라이언트 계층 `lib/client/{types,format,hooks,quote,candles,polling}.ts`(서버 import 금지). 차트 데이터 변환은 순수 함수로 분리(`toChartSeries`·`toVolumeSeries`·`movingAverage`·`toOrderMarkers`·`toDepth`·`toComposition`·`toPnlBars`·`toTradeSeries`)해 캔버스 없이 단위 테스트.

## AI 어드바이저 (계획 — 미구현)

> 아래는 [roadmap.md](roadmap.md)의 Phase 4 설계안이며 **아직 구현되지 않았다**. `lib/server/llm`·`lib/server/advisor`·`app/api/advisor` 등은 존재하지 않는다.

LLM(OpenAI·xAI) 기반 **포트폴리오 분석·조언·주문 제안**. LLM은 "제안자"일 뿐 "집행자"가 아니며, 제안은 사람이 검토·confirm해 기존 §6 게이트를 통과할 때만 실주문이 된다. 계획된 레이어링(접근법 A):

```
lib/server/llm/       # provider 추상화 (server-only): types · openai · xai · container(LLM_PROVIDER 선택)
lib/server/advisor/   # snapshot(마스킹) · prompt · schema(zod) · validate(실재·수량·side) · advisor(오케스트레이션)
app/api/advisor/route.ts   # POST: 데이터수집→LLM→검증된 제안 {data}
lib/client/advisor.ts      # 온디맨드 fetcher (자동폴링 X)
app/_components/AiAdvisor.tsx  # 버튼·조언·제안목록·"폼에 담기"·disclaimer
```

원칙: HTTP는 `fetch` 직접(SDK 미도입), LLM 키는 `lib/server/llm/`에서만(번들 가드에 키 패턴 추가), 응답은 신뢰 경계 밖으로 취급해 zod 재검증, 호출은 온디맨드(버튼)만(자동 폴링 금지), 기존 거래 코드는 무수정(연결점만 외과적 추가). 어드바이저 고유 안전 불변식은 [trading-safety.md](trading-safety.md) §6.A.
