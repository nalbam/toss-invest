# toss-invest

토스증권 Open API 기반 **개인 투자 대시보드**. 내 계좌·보유자산·시세·거래내역을 한눈에 보고,
**수동 거래**와 **제한적 자동거래**까지 안전 게이트 안에서 수행한다. 1인 개인용(멀티테넌트·인증 서버 없음),
웹소켓 없이 폴링 기반이다.

- API 레퍼런스: https://developers.tossinvest.com/llms.txt

## 기능

- **읽기 대시보드** — 포트폴리오 요약, 보유종목, 환율(FX), 주문내역, 시세(현재가·상하한가·호가·캔들 차트).
- **수동 거래** — 주문 생성/정정/취소. 기본은 dry-run 미리보기, 주문 단위 사용자 확인(confirm) 시에만 전송.
- **제한적 자동거래** — SELL-only 전략 intent 순수 계층 + 결정적 백테스트 + 게이트된 auto-executor.
  `AUTO_TRADE_ENABLED` 기본 false.

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

게이트(4종): `lint` · `typecheck` · `test` · `build`. E2E 는 별도(`test:e2e`).

## 환경 변수

`.env.example` 참고. `lib/server/env.ts` 의 zod 스키마로 fail-fast 검증된다.

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `TOSS_CLIENT_ID` | (필수) | Toss Open API client id |
| `TOSS_CLIENT_SECRET` | (필수) | Toss Open API client secret |
| `TOSS_ACCOUNT_SEQ` | (필수) | 계좌 시퀀스 |
| `TOSS_API_BASE` | `https://openapi.tossinvest.com` | API base URL |
| `DRY_RUN` | `true` | true면 실주문 POST 미전송 |
| `KILL_SWITCH` | `false` | true면 모든 실주문 차단 |
| `AUTO_TRADE_ENABLED` | `false` | 자동 executor 실주문 활성화(사람 사전 승인) |
| `MAX_ORDER_AMOUNT` | (미설정) | 1회 최대 주문금액(KRW). 미설정 시 실주문 차단(fail-safe) |
| `DAILY_LOSS_LIMIT` | (미설정) | 일일 손실 한도(KRW) |

## 아키텍처

```
app/
  api/**/route.ts      # API 프록시 라우트 (GET 17 + POST 3: orders create/modify/cancel)
  _components/*         # 대시보드 UI 섹션 + 주문 폼
  page.tsx             # 대시보드 페이지
lib/
  server/**            # server-only: 시크릿·토스 API·거래 게이트 격리
    env.ts             # zod 환경 변수 검증
    toss/              # auth · client · rate-limiter · schemas · endpoints · container
    trading/           # safety(§6 게이트) · strategy · backtest · executor · auto-*
  client/**            # types · format · hooks · quote · candles · polling (서버 import 금지)
```

- **시크릿 격리**: 모든 서버 코드는 `lib/server/**` + `server-only`. `build` 시
  `scripts/check-bundle-secrets.mjs` 가 클라이언트 번들에 시크릿/거래 심볼 누출이 없는지 검사한다.
- **rate limit**: 엔드포인트 그룹별 TPS 토큰버킷(`lib/server/toss/rate-limiter.ts`).
- **거래 안전(§6)**: `DRY_RUN` 기본 true, kill switch, 하드 리밋, 고액(≥1억) confirm, 통화-인지 notional,
  멱등성 clientOrderId. 상세 불변식은 [`docs/dev-loop-prompt.md`](docs/dev-loop-prompt.md) §6 참고.

## 문서

- [`docs/dev-loop-prompt.md`](docs/dev-loop-prompt.md) — 개발 루프 마스터 프롬프트 + 안전 규약(§6).
- [`docs/advisor-loop-prompt.md`](docs/advisor-loop-prompt.md) — AI 어드바이저(LLM 기반 포트폴리오 분석·조언·주문 제안) 자가 개선 루프 프롬프트. dev-loop 의 형제이며 §6 안전을 불변 상속.
- [`PROGRESS.md`](PROGRESS.md) — 현재 구현 상태.
- [`EVAL.md`](EVAL.md) — 이터레이션 평가 이력(append-only).
