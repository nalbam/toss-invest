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
  api/**/route.ts      # GET 21 · POST 8 · PATCH 1 · DELETE 2 — Toss 프록시 + 로컬 SQLite 라우트
  _components/*         # 대시보드 UI 섹션 + 주문 폼 + AI 어드바이저 + 종목 검색 모달
  page.tsx             # 대시보드 페이지
instrumentation.ts     # register(): 부팅 시 인-프로세스 어드바이저 워커 시작(ADVISOR_WORKER_ENABLED)
lib/
  server/**            # server-only: 시크릿·토스 API·거래 게이트·LLM·DB 격리
    env.ts             # zod 환경 변수 검증 (getEnv, fail-fast)
    toss/              # auth · client · rate-limiter · schemas · endpoints · container
    trading/           # safety(§6 게이트) · strategy · backtest · executor · auto-*
    advisor/           # 포트폴리오 어드바이저: snapshot(마스킹) · prompt · validate · history
    market-advisor/    # 차트 어드바이저 + watchlist · jobs · worker(백그라운드 tick)
    llm/               # provider 추상화 (openai · xai · chat-completions · container)
    db/                # SQLite(better-sqlite3): sqlite.ts(globalThis 싱글톤·WAL·migrate)
    favorites/         # 즐겨찾기 스토어
    stocks/            # 종목 이름검색 디렉터리
  client/**            # types · format · hooks · quote · candles · polling · advisor · market-advisor · favorites · watchlist (서버 import 금지)
```

### 시크릿 격리 (필수)

`client_id`/`client_secret`/access token/`X-Tossinvest-Account`는 **서버(Route Handler / Server Action)에서만** 다룬다. 브라우저는 자체 `/api/*` 라우트만 호출하고, 그 라우트가 토스 API로 프록시한다. 모든 서버 코드는 `lib/server/**` + `server-only`. `build` 시 `scripts/check-bundle-secrets.mjs`가 클라이언트 번들에 시크릿·거래 심볼 누출이 없는지 검사한다(회귀 가드).

### Rate limit 강제 (서버)

서버 프록시에 **엔드포인트 그룹별 전역 토큰버킷**(`lib/server/toss/rate-limiter.ts`)을 둬, 여러 뷰가 동시에 폴링해도 그룹 합산 TPS 한도를 넘지 않게 강제한다. 그룹: `ACCOUNT 1`·`ASSET 5`·`MARKET_DATA 10`·`MARKET_INFO 3`·`ORDER 6`·`ORDER_HISTORY 5`·`MARKET_DATA_CHART 5`·`STOCK 5`·`ORDER_INFO 6`. 자세한 엔드포인트·TPS는 [api-reference.md](api-reference.md).

### 서버 toss 계층

`auth`(토큰 발급/캐싱/만료 전 갱신, DI fetch/clock) · `client`(인증·rate limit·에러·429 백오프) · `rate-limiter` · `schemas`(decimal=string, openEnum) · `endpoints`(GET 17 typed) · `container`(getServerTossClient).

### API 라우트

**GET 21 · POST 8 · PATCH 1 · DELETE 2.** 두 종류: (1) Toss 프록시 — 시세·계좌·주문 등. (2) 로컬 SQLite 라우트 — `favorites`(GET/POST/DELETE) · `stocks/search`(GET) · `advisor-watchlist`(GET/POST/PATCH/DELETE) · `advisor-jobs/run`(POST, Bearer) · `advisor`·`market-advisor`(POST) · `market-advisor/history`(GET). 모두 `force-dynamic`, 성공은 `{ data }`, 실패는 sanitized `{ error }` 봉투. 쿼리/바디는 zod 검증. `TossApiError`→upstream status 매핑(번들 간 클래스 식별 깨짐 방지 위해 `name` 마커 폴백). SQLite·워커를 쓰는 라우트는 `runtime = "nodejs"`(better-sqlite3 네이티브).

## 컴포넌트 맵

`Dashboard` 루트의 3-컬럼 레이아웃:

- **시세(좌)**: `MarketQuote`(현재가·상하한가, 헤더 별★ 즐겨찾기 토글) → `CandleChart`(캔들·거래량·이동평균·상하한가 기준선·주문 체결 마커·어드바이저 결정 점) · `MarketAiAdvisor`(차트 어드바이저 + 자동분석 watchlist 컨트롤) · `Orderbook` · `OrderbookDepth` · `TradesChart`.
- **주문(중앙)**: `OrderForm`(빠른주문/일반주문, dry-run 미리보기·confirm, 종목별 최근 수량·금액 복원).
- **사이드바(우)**: `AccountCash` · `PortfolioSummary` · `HoldingsTable` · `PortfolioComposition` · `HoldingsPnL` · `OrdersTable` + `ModifyOrderForm` · `AiAdvisor`(포트폴리오) · `WatchlistControls`(자동분석 종목).
- **헤더/검색**: `StockSearchModal`(종목명·코드 검색 + 즐겨찾기 목록, `Dashboard` 헤더 "종목 검색"으로 열림).
- **공용**: `CollapsibleCard` · `Money`.

클라이언트 계층 `lib/client/{types,format,hooks,quote,candles,polling,advisor,market-advisor,favorites,watchlist}.ts`(서버 import 금지). 차트 데이터 변환은 순수 함수로 분리(`toChartSeries`·`toVolumeSeries`·`movingAverage`·`toOrderMarkers`·`toDepth`·`toComposition`·`toPnlBars`·`toTradeSeries`)해 캔버스 없이 단위 테스트.

## AI 어드바이저 (구현 완료)

LLM(OpenAI·xAI) 기반 **포트폴리오 분석·조언·주문 제안** + **차트(시세) 어드바이저**. LLM은 "제안자"일 뿐 "집행자"가 아니며, 제안은 사람이 검토·confirm해 기존 §6 게이트를 통과할 때만 실주문이 된다. 레이어링:

```
lib/server/llm/             # provider 추상화 (server-only): types · openai · xai · chat-completions · container(LLM_PROVIDER 선택)
lib/server/advisor/         # 포트폴리오: snapshot(마스킹) · prompt · schema(zod) · validate(실재·수량·side) · history
lib/server/market-advisor/  # 차트: prompt · schema · market-advisor · history · watchlist · jobs · worker
app/api/advisor/route.ts          # POST: 포트폴리오 스냅샷→LLM→검증된 제안 {data}
app/api/market-advisor/route.ts   # POST: 캔들→LLM→조언+판단+주석, SQLite 기록
app/api/market-advisor/history    # GET: 종목/인터벌별 조언 히스토리(차트 오버레이용)
lib/client/{advisor,market-advisor}.ts   # fetcher
app/_components/{AiAdvisor,MarketAiAdvisor}.tsx  # 버튼·조언·제안목록·"폼에 담기"·disclaimer
```

원칙: HTTP는 `fetch` 직접(SDK 미도입), LLM 키는 `lib/server/llm/`에서만(번들 가드에 키 패턴 포함), 응답은 신뢰 경계 밖으로 취급해 zod 재검증, 기존 거래 코드는 무수정(연결점만 외과적 추가). 어드바이저 고유 안전 불변식은 [trading-safety.md](trading-safety.md) §6.A.

## 영속 계층 (SQLite)

`lib/server/db/sqlite.ts` — `better-sqlite3`(동기) 단일 연결. **`globalThis` 싱글톤**(라우트 번들과 instrumentation 워커 번들이 한 연결을 공유 → WAL 라이터 이중화 방지), `journal_mode=WAL`, `busy_timeout=5000`, 멱등 스키마 + PRAGMA 기반 가산 마이그레이션. 테이블:

- `market_advice` / `portfolio_advice` — 조언 로그(무한 적재, 차트 히스토리 소스).
- `advisor_watchlist` — 자동분석 종목 `{symbol, interval, run_every_minutes, last_run_at, last_chart_timestamp}`.
- `favorites` — 즐겨찾기 `{symbol, name, currency}`.
- `stock_directory` — 이름검색 디렉터리 `{symbol, name, market, currency}`(신뢰 소스로만 적재: Toss 조회·즐겨찾기·`scripts/seed-stocks.mjs` 일괄 임포트). 코드는 절대 임의 생성하지 않는다.

## 백그라운드 어드바이저 워커

`instrumentation.ts`의 `register()`가 `NEXT_RUNTIME==="nodejs" && ADVISOR_WORKER_ENABLED==="true"`일 때 `lib/server/market-advisor/worker.ts`를 시작(인-프로세스 tick, `ADVISOR_WORKER_TICK_MS` 기본 60s). 매 tick `runAdvisorJobsOnce`(jobs.ts)가 watchlist의 **due 항목**(`run_every_minutes` 경과)만 분석하고, **직전과 같은 캔들**(`last_chart_timestamp`)이면 LLM 호출을 건너뛴다. 외부 스케줄러는 `POST /api/advisor-jobs/run`(Bearer `ADVISOR_JOBS_TOKEN`)으로 동일 패스를 트리거할 수 있다(단일 패스 원칙: 루프는 워커/cron이, 잡 함수는 1회 실행).
