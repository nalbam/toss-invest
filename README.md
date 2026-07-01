# toss-invest

토스증권 Open API 기반 **개인 투자 대시보드**. 내 계좌·보유자산·시세·거래내역을 한눈에 보고,
**수동 거래**와 **제한적 자동거래**까지 안전 게이트 안에서 수행한다. 1인 개인용(멀티테넌트 아님, Google OAuth
로그인 게이트로 접근 제한), 웹소켓 없이 폴링 기반이다.

- API 레퍼런스: https://developers.tossinvest.com/llms.txt

## 기능

- **읽기 대시보드** — 포트폴리오 요약·구성(도넛)·종목별 손익, 보유종목, 환율(FX), 주문내역,
  시세(현재가·상하한가·호가·호가 뎁스·체결 추이·캔들 차트[분봉 1~240분 선택(1·3·5·10·30·60·120·240)+일/주/월/년·과거 데이터 자동 로드(스크롤)·거래량·이동평균·상하한가 기준선·주문 체결 마커]).
- **수동 거래** — 주문 생성/정정/취소. 기본은 dry-run 미리보기, 주문 단위 사용자 확인(confirm) 시에만 전송.
- **제한적 자동거래** — SELL-only 전략 intent 순수 계층 + 결정적 백테스트 + 게이트된 auto-executor.
  `AUTO_TRADE_ENABLED` 기본 false.
- **AI 어드바이저** (선택 — LLM 설정 시) — ① **포트폴리오 어드바이저**: 마스킹된 포트폴리오 스냅샷 → LLM →
  조언 + 주문 제안(보유·매도가능수량·심볼 실재 검증 후 "폼에 담기"로 주문 폼 prefill). ② **차트 어드바이저**:
  선택 종목 캔들 + 기술지표(이동평균·RSI·거래량/변동성)·상위 시간대 추세 → LLM → 다중 시간대 조언 + 참고 판단(buy/sell/hold/wait) + 차트 지지/저항선·마커(조언 히스토리는 SQLite 영속).
  둘 다 온디맨드 실행이며, 자동분석은 서버 백그라운드 워커(watchlist)가 주기적으로 실행한다.
  **LLM은 제안자이지 집행자가 아니다** — 제안은 자동 전송 없이 confirm·§6 게이트를 거친다.
- **종목 검색·즐겨찾기** — 종목명/코드로 검색(로컬 디렉터리, `pnpm seed:stocks`로 KRX·Nasdaq 상장목록 적재),
  시세 헤더 별(★) 아이콘으로 즐겨찾기 저장/해제. 둘 다 SQLite에 영속.
- **테마** — 시스템/라이트/다크. 테마를 비롯한 모든 UI 상태(카드 접힘·차트 설정·선택 계좌/종목·주문 폼 설정·어드바이저 캐시 등)는 SQLite(`app_settings`)에 영속한다.

## 기술 스택

- Next.js **15.5.19** (App Router), React **19**, TypeScript **strict**, **pnpm**
- 데이터 페칭: **SWR**, 검증: **zod**, 차트: **lightweight-charts**
- 테스트: **Vitest** (server=node, UI=jsdom), E2E: **Playwright**
- Tailwind 미사용, 경로 alias `@/*`

## 시작하기

```bash
pnpm install
cp .env.example .env.local   # 자격증명·안전 설정 입력
pnpm run dev                 # http://localhost:3000
```

## 스크립트

| 명령 | 설명 |
| --- | --- |
| `pnpm run dev` | 개발 서버 |
| `pnpm run build` | `.next` 클린 + `next build` + 번들 시크릿 가드 |
| `pnpm run start` | 프로덕션 서버 |
| `pnpm run lint` | ESLint |
| `pnpm run typecheck` | `tsc --noEmit` |
| `pnpm run test` | Vitest (1회 실행) |
| `pnpm run test:watch` | Vitest watch |
| `pnpm run test:e2e` | Playwright E2E |
| `pnpm run advisor:run` | 백그라운드 어드바이저 잡 1회 트리거(외부 스케줄러용, `ADVISOR_JOBS_TOKEN` 필요) |
| `pnpm run seed:stocks` | 종목 검색 디렉터리 시드 (`--krx` / `--nasdaq` / `--all` / `<file.json>`) |

게이트(4종): `lint` · `typecheck` · `test` · `build`. E2E 는 별도(`test:e2e`).

## 환경 변수

`.env.example` 참고. TOSS·거래·LLM 변수는 `lib/server/env.ts` 의 zod 스키마로 fail-fast 검증되고,
DB·워커 변수(`ADVISOR_*`)는 기본값 폴백으로 `process.env`에서 직접 읽힌다. 인증 변수(`BETTER_AUTH_*`·
`GOOGLE_*`·`AUTH_*`)는 `lib/auth.ts` 가 `process.env`에서 직접 읽는다.

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | (필수) | better-auth 서명 시크릿 (`npx @better-auth/cli secret`로 생성) |
| `BETTER_AUTH_URL` | `http://localhost:3000` | 배포 시 연결한 HTTPS 도메인 |
| `GOOGLE_CLIENT_ID` | (필수) | Google OAuth 2.0 클라이언트 id |
| `GOOGLE_CLIENT_SECRET` | (필수) | Google OAuth 2.0 클라이언트 secret |
| `AUTH_ALLOWED_DOMAINS` | `nalbam.com` | 로그인 허용 이메일 도메인(콤마 구분) |
| `AUTH_DB_PATH` | `data/auth.db` | better-auth SQLite 경로(user/session/account/verification) |
| `TOSS_CLIENT_ID` | (필수) | Toss Open API client id |
| `TOSS_CLIENT_SECRET` | (필수) | Toss Open API client secret |
| `TOSS_ACCOUNT_SEQ` | (필수) | 계좌 시퀀스 |
| `TOSS_API_BASE` | `https://openapi.tossinvest.com` | API base URL |
| `DRY_RUN` | `true` | true면 실주문 POST 미전송 |
| `KILL_SWITCH` | `false` | true면 모든 실주문 차단 |
| `AUTO_TRADE_ENABLED` | `false` | 자동 executor 실주문 활성화(사람 사전 승인) |
| `MAX_ORDER_AMOUNT` | (미설정) | 1회 최대 주문금액(KRW). 미설정 시 실주문 차단(fail-safe) |
| `DAILY_LOSS_LIMIT` | (미설정) | 일일 손실 한도(KRW) |
| `LLM_PROVIDER` | (미설정) | AI 어드바이저 provider: `openai` \| `xai`. 미설정 시 어드바이저 경로만 "not configured" |
| `OPENAI_API_KEY` | (미설정) | `LLM_PROVIDER=openai` 용 키 (server-only) |
| `XAI_API_KEY` | (미설정) | `LLM_PROVIDER=xai` 용 키 (server-only) |
| `LLM_MODEL` | (미설정) | 사용할 LLM 모델명 |
| `TAVILY_API_KEY` | (미설정) | 설정 시 차트 어드바이저가 종목 최신 뉴스를 검색해 프롬프트에 주입(종목당 10분 캐시). 미설정 시 차트만으로 분석(fail-open) |
| `ADVISOR_DB_PATH` | `data/advisor.db` | SQLite 파일 경로(조언 로그·watchlist·즐겨찾기·종목 디렉터리). 디렉터리는 자동 생성 |
| `ADVISOR_JOBS_TOKEN` | (미설정) | 설정 시 `POST /api/advisor-jobs/run` 활성화(Bearer). 미설정 시 비활성(fail-closed) |
| `ADVISOR_WORKER_ENABLED` | (미설정) | `true`면 인-프로세스 백그라운드 어드바이저 워커 시작(`pnpm dev`가 자동 설정) |
| `ADVISOR_WORKER_TICK_MS` | `60000` | 워커가 watchlist due 항목을 점검하는 주기(ms) |
| `ADVISOR_BASE_URL` | `http://localhost:3000` | `advisor:run`이 `POST /api/advisor-jobs/run`을 호출할 서버 주소(원격 트리거 시) |

> `NEXT_PUBLIC_APP_VERSION`은 빌드 시 `next.config.ts`가 `package.json` 버전에서 자동 주입한다(사이드바 버전 표시용, 사용자 설정 불필요).

## 배포 (Docker / EC2)

`git tag` → GitHub Action 이미지 빌드 → `../GameServer` CLI 로 EC2 기동·배포·도메인 연결.

1. **이미지 빌드** — `vX.Y.Z` 태그 push 시 [`.github/workflows/release.yml`](.github/workflows/release.yml)이
   멀티아치(amd64·arm64) 이미지를 빌드해 `ghcr.io/nalbam/toss-invest` 에 push 한다(`Dockerfile`은
   Next.js standalone 출력 + better-sqlite3 네이티브 빌드).

```bash
git tag v0.1.0 && git push origin v0.1.0
```

2. **런타임 env 등록** — 컨테이너는 SSM `/env/prod/toss-invest`(SecureString)를 `--env-file` 로 읽는다.
   [환경 변수](#환경-변수)에 더해 배포 전용 값을 채운다(`PORT=3000` 고정, 백그라운드 분석은 `ADVISOR_WORKER_ENABLED=true`).

```bash
aws ssm put-parameter --name /env/prod/toss-invest --type SecureString --value "PORT=3000
BETTER_AUTH_SECRET=...
BETTER_AUTH_URL=https://<도메인>
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
AUTH_ALLOWED_DOMAINS=nalbam.com
TOSS_CLIENT_ID=...
TOSS_CLIENT_SECRET=...
TOSS_ACCOUNT_SEQ=1
ADVISOR_WORKER_ENABLED=true"
```

3. **EC2 기동·배포·도메인** — `../GameServer/gameserver.py` 를 실행한다. 형제 repo(`Dockerfile`+`EXPOSE`)에서
   `toss-invest`(이미지 `ghcr.io/nalbam/toss-invest`, 포트 3000)를 자동 발견 → EC2+EIP 생성 → 버전 선택 배포
   → Route53 A 레코드 + Nginx/Let's Encrypt HTTPS 연결까지 처리한다.
   SQLite(`advisor.db`·`auth.db`)는 도커 named volume `toss-invest-data:/app/data` 에 영속되어 재배포에도 유지된다.

> **OAuth 주의**: `BETTER_AUTH_URL` 은 연결한 HTTPS 도메인이어야 하며, Google OAuth 콘솔의 Authorized redirect URI 에
> `https://<도메인>/api/auth/callback/google` 를 등록해야 로그인이 동작한다.

로컬에서 이미지를 직접 빌드·확인하려면:

```bash
docker build -t toss-invest:local .
docker run --rm -p 3000:3000 --env-file .env.local -v toss-invest-data:/app/data toss-invest:local
```

## 아키텍처

```
app/
  api/**/route.ts      # GET 23 · POST 8 · PATCH 1 · PUT 1 · DELETE 2 — Toss 프록시 + 로컬 SQLite 라우트(favorites · stocks/search · advisor-watchlist · advisor-jobs/run · market-advisor · settings)
  _components/*         # 대시보드 UI 섹션 + 주문 폼 + AI 어드바이저 + 종목 검색 모달 + 테마
  page.tsx             # 대시보드 페이지
instrumentation.ts     # 부팅 시 인-프로세스 어드바이저 워커 시작(ADVISOR_WORKER_ENABLED)
lib/
  server/**            # server-only: 시크릿·토스 API·거래 게이트·LLM·DB 격리
    env.ts             # zod 환경 변수 검증
    toss/              # auth · client · rate-limiter · schemas · endpoints · container
    trading/           # safety(§6 게이트) · strategy · backtest · executor · auto-*
    advisor/           # 포트폴리오 어드바이저: 스냅샷 마스킹 · 프롬프트 · 검증 · 히스토리
    market-advisor/    # 차트 어드바이저 + watchlist · jobs · worker(백그라운드)
    news/              # Tavily 심볼 뉴스 검색(ETF 구성종목 인지 · 10분 캐시, 차트 어드바이저와 공유)
    llm/               # provider 추상화 (openai · xai · chat-completions · container)
    db/                # SQLite(better-sqlite3) sqlite.ts: market_advice · portfolio_advice · advisor_watchlist · favorites · stock_directory · candle_cache · app_settings
    candles/           # 캔들 캐시: 확정 캔들 SQLite 저장/조회 + 캐시 백드 페치(미확정은 Toss)
    favorites/         # 즐겨찾기 스토어
    stocks/            # 종목 이름검색 디렉터리
    settings/          # app_settings KV 스토어 (/api/settings 백엔드)
    api/               # respond 헬퍼 ({data}/sanitized error)
  client/**            # types · format · hooks · quote · candles · indicators · polling · advisor · market-advisor · favorites · watchlist · envelope (서버 import 금지)
```

- **시크릿 격리**: 모든 서버 코드는 `lib/server/**` + `server-only`. `build` 시
  `scripts/check-bundle-secrets.mjs` 가 클라이언트 번들에 시크릿/거래 심볼/LLM 키 누출이 없는지 검사한다.
- **rate limit**: 엔드포인트 그룹별 TPS 토큰버킷(`lib/server/toss/rate-limiter.ts`).
- **거래 안전(§6)**: `DRY_RUN` 기본 true, kill switch, 하드 리밋, 고액(≥1억) confirm, 통화-인지 notional,
  멱등성 clientOrderId. 상세 불변식은 [`docs/trading-safety.md`](docs/trading-safety.md) §6 참고.

## 문서

설계·개발 문서는 [`docs/`](docs/README.md)에 통합되어 있다.

- [`docs/architecture.md`](docs/architecture.md) — 설계(스택·레이어링·시크릿 격리·rate limit·컴포넌트 맵).
- [`docs/api-reference.md`](docs/api-reference.md) — 토스 Open API 엔드포인트·동작 규칙.
- [`docs/trading-safety.md`](docs/trading-safety.md) — 거래 안전장치(§6)·보안.
- [`docs/development.md`](docs/development.md) — 개발 워크플로우(게이트·self-eval 루프·규율).
- [`docs/roadmap.md`](docs/roadmap.md) — 로드맵·현재 상태·이터레이션 이력.
