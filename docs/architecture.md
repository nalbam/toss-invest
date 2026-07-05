# 아키텍처 (설계)

토스증권 Open API 기반 **1인용 개인 투자 대시보드**의 설계 문서. 거래 안전은 [trading-safety.md](trading-safety.md), API 계약은 [api-reference.md](api-reference.md), 개발 워크플로우는 [development.md](development.md), 진행/이력은 [roadmap.md](roadmap.md) 참고.

## 미션과 산출물

토스증권의 **내 계좌·보유자산·시세·거래내역을 한눈에 보는 대시보드** + **수동 거래** + **제한적 자동거래**.

- 사용자: 개발자 본인 1인(개인용). 멀티테넌트 아님. Google OAuth 로그인 게이트(허용 도메인 제한, better-auth)로 접근 제어.
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
  api/**/route.ts      # GET 24 · POST 8 · PATCH 1 · PUT 1 · DELETE 2 — Toss 프록시 + 로컬 SQLite 라우트
  _components/*         # 대시보드 UI 섹션 + 주문 폼 + AI 어드바이저 + 종목 검색 모달
  page.tsx             # 대시보드 페이지
instrumentation.ts     # register(): 부팅 시 인-프로세스 어드바이저 워커 시작(ADVISOR_WORKER_ENABLED)
lib/
  server/**            # server-only: 시크릿·토스 API·거래 게이트·LLM·DB 격리
    env.ts             # zod 환경 변수 검증 (getEnv, fail-fast)
    auth/              # withAuth(세션 재검증 가드, /api/* 래퍼)
    toss/              # auth · client · rate-limiter · schemas · endpoints · account · container
    trading/           # safety(§6 게이트) · strategy · backtest · executor · audit-store · auto-*
    advisor/           # 포트폴리오 어드바이저: snapshot(마스킹) · prompt · validate · history
    market-advisor/    # 차트 어드바이저 + watchlist · jobs · worker(백그라운드 tick)
    news/              # 뉴스 검색: tavily(Tavily Search) · cache(종목당 10분 TTL) · etf-aware · container
    llm/               # provider 추상화 (openai · xai · chat-completions · container)
    db/                # SQLite(better-sqlite3): sqlite.ts(globalThis 싱글톤·WAL·migrate)
    candles/           # 캔들 캐시: cache(확정 캔들 SQLite 저장/조회 + coverage 추적) · service(coverage-게이트 캐시 백드 페치)
    favorites/         # 즐겨찾기 스토어
    stocks/            # 종목 이름검색 디렉터리
    settings/          # app_settings KV 스토어 (/api/settings 백엔드, settingsStore 영속)
    api/               # respond 헬퍼 ({data}/sanitized error) · advisor-error(어드바이저/LLM 에러→503/502 매핑)
  client/**            # types · format · hooks · quote · candles · indicators · polling · advisor · market-advisor · favorites · watchlist · envelope (서버 import 금지)
```

### 시크릿 격리 (필수)

`client_id`/`client_secret`/access token/`X-Tossinvest-Account`는 **서버(Route Handler / Server Action)에서만** 다룬다. 브라우저는 자체 `/api/*` 라우트만 호출하고, 그 라우트가 토스 API로 프록시한다. 모든 서버 코드는 `lib/server/**` + `server-only`. `build` 시 `scripts/check-bundle-secrets.mjs`가 클라이언트 번들에 시크릿·거래 심볼 누출이 없는지 검사한다(회귀 가드).

### Rate limit 강제 (서버)

서버 프록시에 **엔드포인트 그룹별 전역 토큰버킷**(`lib/server/toss/rate-limiter.ts`)을 둬, 여러 뷰가 동시에 폴링해도 그룹 합산 TPS 한도를 넘지 않게 강제한다. 그룹: `ACCOUNT 1`·`ASSET 5`·`MARKET_DATA 10`·`MARKET_INFO 3`·`ORDER 6`·`ORDER_HISTORY 5`·`MARKET_DATA_CHART 5`·`STOCK 5`·`ORDER_INFO 6`. 자세한 엔드포인트·TPS는 [api-reference.md](api-reference.md).

### 서버 toss 계층

`auth`(토큰 발급/캐싱/만료 전 갱신, DI fetch/clock) · `client`(인증·rate limit·에러·429 백오프) · `rate-limiter` · `schemas`(decimal=string, openEnum) · `endpoints`(Toss GET 조회 + 주문 raw POST typed wrapper) · `account`(resolveAccountSeq: 미지정 시 첫 계좌 폴백) · `container`(getServerTossClient/getServerTradingExecutor).

### API 라우트

**GET 24 · POST 8 · PATCH 1 · PUT 1 · DELETE 2.** 두 종류: (1) Toss 프록시 — 시세·계좌·주문 등. (2) 로컬 SQLite 라우트 — `favorites`(GET/POST/DELETE) · `stocks/search`(GET) · `advisor-watchlist`(GET/POST/PATCH/DELETE) · `advisor-jobs/run`(POST, Bearer) · `advisor`·`market-advisor`(POST) · `advisor/history`·`market-advisor/history`(GET) · `settings`(GET/PUT). 인증은 2계층: 엣지 `middleware.ts`는 **페이지만** 게이트(세션 쿠키 존재 검사)하고, 모든 `/api/*` 핸들러는 `lib/server/auth/with-auth.ts`의 `withAuth`로 요청마다 세션을 서버 재검증한다(미인증 401 JSON). 예외는 `api/auth/[...all]`(better-auth 자체 핸들러)과 머신용 `api/advisor-jobs/run`(Bearer 토큰 전용)뿐이다. 모두 `force-dynamic`, 성공은 `{ data }`, 실패는 sanitized `{ error }` 봉투. 쿼리/바디는 zod 검증. `TossApiError`→upstream status 매핑(번들 간 클래스 식별 깨짐 방지 위해 `name` 마커 폴백). SQLite·워커를 쓰는 라우트는 `runtime = "nodejs"`(better-sqlite3 네이티브).

## 컴포넌트 맵

`Dashboard` 루트의 3-컬럼 레이아웃:

- **시세(좌)**: `MarketQuote`(현재가·상하한가, 헤더 별★ 즐겨찾기 토글, 캔들 인터벌: 분봉 단위 select(1~240분) + 일/주/월/년 버튼, 차트 좌측 스크롤 시 과거 캔들 자동 로드, 종목·인터벌을 바꿔도 보이는 봉 수(줌) 유지) → `CandleChart`(캔들·거래량·이동평균·상하한가 기준선·주문 체결 마커·어드바이저 결정 점) · `ChartOverlayControls`(지지/저항 라벨·선·AI 조언 세로선 토글) · `MarketAiAdvisor`(차트 어드바이저 + `AdvisorAutoControls` 자동분석 주기) · `Orderbook` · `OrderbookDepth` · `TradesChart` · `WatchlistControls`(자동분석 종목).
- **주문(중앙)**: `OrderForm`(빠른주문/일반주문, dry-run 미리보기·confirm, 종목별 최근 수량·금액 복원) · `OrdersTable` + `ModifyOrderForm`(주문내역·정정) · `NewsCard`(선택 종목 뉴스).
- **사이드바(우)**: `AccountCash` · `PortfolioSummary` · `HoldingsTable` · `PortfolioComposition` · `HoldingsPnL` · `AiAdvisor`(포트폴리오).
- **헤더/검색**: `StockSearchModal`(종목명·코드 검색 + 즐겨찾기 목록, `Dashboard` 헤더 "종목 검색"으로 열림) · `ThemeSelector`(시스템/라이트/다크 테마) · `LogoutButton`(Google OAuth 로그아웃).
- **공용**: `CollapsibleCard` · `Money`.

클라이언트 계층 `lib/client/{types,format,hooks,quote,candles,indicators,polling,advisor,market-advisor,favorites,watchlist,envelope}.ts`(서버 import 금지). 차트 데이터 변환·지표는 순수 함수로 분리(`toChartSeries`·`toVolumeSeries`·`movingAverage`·`toOrderMarkers`·`toDepth`·`toComposition`·`toPnlBars`·`toTradeSeries`·`aggregateCandles`·`computeIndicators`·`summarizeTrend`)해 캔버스 없이 단위 테스트.

## AI 어드바이저 (구현 완료)

LLM(OpenAI·xAI) 기반 **포트폴리오 분석·조언·주문 제안** + **차트(시세) 어드바이저**. LLM은 "제안자"일 뿐 "집행자"가 아니며, 제안은 사람이 검토·confirm해 기존 §6 게이트를 통과할 때만 실주문이 된다. 레이어링:

```
lib/server/llm/             # provider 추상화 (server-only): types · openai · xai · chat-completions · container(LLM_PROVIDER 선택)
lib/server/news/            # 뉴스 검색 (server-only): types · tavily(Tavily Search) · cache(종목당 10분 TTL) · container(TAVILY_API_KEY 미설정 시 null)
lib/server/advisor/         # 포트폴리오: snapshot(마스킹) · prompt · schema(zod) · validate(실재·수량·side) · history
lib/server/market-advisor/  # 차트: prompt · schema · market-advisor · history · watchlist · jobs · worker
app/api/advisor/route.ts          # POST: 포트폴리오 스냅샷→LLM→검증된 제안 {data}, SQLite 기록
app/api/advisor/history           # GET: 계좌별 포트폴리오 조언 히스토리(카드 세션 캐시 복원용)
app/api/market-advisor/route.ts   # POST: 캔들→LLM→조언+판단+주석, SQLite 기록
app/api/market-advisor/history    # GET: 종목/인터벌별 조언 히스토리(차트 오버레이용)
lib/client/{advisor,market-advisor}.ts   # fetcher
app/_components/{AiAdvisor,MarketAiAdvisor}.tsx  # 버튼·조언·제안목록·"폼에 담기"·disclaimer
```

차트 어드바이저는 캔들에서 기술지표(`computeIndicators`: 이동평균·RSI14·최근 고저·거래량 추세·변동성/ATR)와, 하위(분봉 등) 차트일 땐 **상위 시간대 추세**(`summarizeTrend` → 일봉 등)를 결정적으로 계산해 프롬프트에 실어 LLM이 다중 시간대로 판단하게 한다(지표·추세는 순수 함수, LLM은 해석만). `TAVILY_API_KEY`가 설정되면 분석 직전 종목 최신 뉴스를 **Tavily**로 검색(종목당 10분 캐시)해 프롬프트에 시장 심리·이벤트 맥락으로 함께 싣는다 — best-effort라 미설정·검색 실패 시 차트만으로 분석한다(fail-open). 수동 조언과 백그라운드 워커가 같은 캐시를 공유한다.

원칙: HTTP는 `fetch` 직접(SDK 미도입), LLM 키는 `lib/server/llm/`에서만(번들 가드에 키 패턴 포함), 응답은 신뢰 경계 밖으로 취급해 zod 재검증, 기존 거래 코드는 무수정(연결점만 외과적 추가). 어드바이저 고유 안전 불변식은 [trading-safety.md](trading-safety.md) §6.A.

## 영속 계층 (SQLite)

`lib/server/db/sqlite.ts` — `better-sqlite3`(동기) 단일 연결. **`globalThis` 싱글톤**(라우트 번들과 instrumentation 워커 번들이 한 연결을 공유 → WAL 라이터 이중화 방지), `journal_mode=WAL`, `busy_timeout=5000`, 멱등 스키마 + PRAGMA 기반 가산 마이그레이션. 테이블:

- `market_advice` / `portfolio_advice` — 조언 로그(무한 적재, 차트 히스토리 소스).
- `advisor_watchlist` — 자동분석 종목 `{symbol, interval, run_every_minutes, last_run_at, last_chart_timestamp}`.
- `favorites` — 즐겨찾기 `{symbol, name, currency}`.
- `app_settings` — UI 상태 KV `{key, value, updated_at}`, PK `key`. 테마·카드 접힘·차트 인터벌/오버레이·선택 계좌·계좌별 마지막 종목·주문 폼 설정·어드바이저 자동 설정 등 과거 브라우저 localStorage에 있던 상태를 전역(사용자 구분 없음) 1벌로 보관. 클라이언트 `app/_components/settingsStore.ts`가 부팅 시 `GET /api/settings`로 한 번 적재해 동기 캐시로 읽고, 변경은 디바운스 batch `PUT /api/settings`(`{upserts, deletes}`)로 영속한다(총 1000키 상한, 초과 배치는 400으로 롤백 거부). 단, **심볼별 주문 수량/금액 드래프트**와 **어드바이저 결과 캐시**는 서버에 동기하지 않고 클라이언트 전용 `sessionStorage`(per-tab)에만 보관한다.
- `trading_audit` — §6 감사 로그 `{at, kind, decision, reasons, account_seq, symbol, order_id, notional_krw, high_value, entry, created_at}`. 모든 주문 시도(SEND/DRY_RUN/BLOCK)를 secret-free 요약으로 영속(`lib/server/trading/audit-store.ts`).
- `stock_directory` — 이름검색 디렉터리 `{symbol, name, market, currency}`(신뢰 소스로만 적재: Toss 조회·즐겨찾기·`scripts/seed-stocks.mjs` 일괄 임포트). 코드는 절대 임의 생성하지 않는다.
- `candle_coverage` — 심볼/인터벌별 **실제 Toss 페치가 증명한 연속 구간들(disjoint ranges)** `{symbol, interval, covered_from_epoch, covered_to_epoch, updated_at}`, PK `(symbol, interval, covered_from_epoch)`. `candle_cache`만으로는 진짜 데이터 구멍과 장중 휴장 갭을 구분할 수 없어, 요청 윈도우가 **하나의 검증 구간 안에 완전히 들어올 때만** 캐시를 신뢰하고 벗어나면 라이브 페치로 폴백한다. `recordCoverageFetch`는 페치 윈도우와 겹치거나 1 인터벌 이내로 인접한 구간들을 하나로 병합하고, 떨어진 구간은 독립 island로 보존한다(앱을 꺼둔 사이 거래된 세션이 island 사이 seam으로 남아 라이브 페치로 채워짐 — 중간 캔들 유실 방지). `putConfirmedCandles`에서는 절대 갱신하지 않는다. 구 단일 구간 스키마(PK `(symbol, interval)`)는 `initSchema`가 테이블 재구축으로 마이그레이션.
- `candle_cache` — **확정(마감) 캔들** 캐시 `{symbol, interval(1m/1d), timestamp, OHLCV, currency}`, PK `(symbol, interval, timestamp)`. 캔들 period가 끝났을 때만(`start+intervalMs ≤ now`) 저장 — **형성 중인 최신 캔들은 캐시하지 않고 항상 Toss에서** 가져온다. `lib/server/candles/service.getCandlesCached`는 요청 구간이 `candle_coverage`의 검증 범위 안에 완전히 들어올 때만 캐시 페이지를 신뢰하고, 벗어나면(캐시 구멍·검증 범위 밖) Toss로 라이브 페치해 확정분을 캐시 적재하며 coverage를 갱신한다. `/api/candles`(차트 좌측 스크롤 시 과거 페이지 자동 로드)와 백그라운드 어드바이저 워커(`jobs.ts`)가 공유한다. **차트 AI 어드바이저**에 보내는 캔들은 선택 인터벌에 맞춰 충분히 모은다 — `aggregateForAdvisor`/`advisorSourceCandleCount`가 인터벌별 소스 봉 수를 산정해 캐시 백드로 페이지네이션 수집(10m이면 ~2000개 1m 소스; 소스 상한 `ADVISOR_MAX_SOURCE_CANDLES`=24×200=4800봉) 후 집계해 최근 `ADVISOR_TARGET_BARS`(200) 봉을 전달한다(온디맨드=`loadAdvisorCandles`, 워커=`collectAdvisorCandles`). 1m~10m는 200봉을 채우고, 상한 때문에 30분봉 이상은 200봉 미만(30m≈160·60m≈80·120m≈40·240m≈20봉)으로 분석된다. 실제 분석 봉 수(`candle_count`)와 분석 구간 시작(`chart_from`)을 `market_advice`에 기록 → 어드바이저 카드에 "분석 N봉" 표시, 차트엔 분석 구간 밴드로 시각화(`market_advice`는 가산 마이그레이션으로 두 컬럼 추가).

## 백그라운드 어드바이저 워커

`instrumentation.ts`의 `register()`가 `NEXT_RUNTIME==="nodejs" && ADVISOR_WORKER_ENABLED==="true"`일 때 `lib/server/market-advisor/worker.ts`를 시작(인-프로세스 tick, `ADVISOR_WORKER_TICK_MS` 기본 60s). 매 tick `runAdvisorJobsOnce`(jobs.ts)가 watchlist의 **due 항목**(`run_every_minutes` 경과)만 분석하고, **직전과 같은 캔들**(`last_chart_timestamp`)이면 LLM 호출을 건너뛴다. 외부 스케줄러는 `POST /api/advisor-jobs/run`(Bearer `ADVISOR_JOBS_TOKEN`)으로 동일 패스를 트리거할 수 있다(단일 패스 원칙: 루프는 워커/cron이, 잡 함수는 1회 실행).
