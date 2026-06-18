# PROGRESS — 토스증권 대시보드 (현재 상태만)

## 현재 위치
- **Phase**: 1 (읽기전용 대시보드)
- **마지막 이터레이션**: #3 완료 (Next API 프록시 라우트 4종 + 시크릿 번들 회귀 가드)
- **다음 pick (#4)**: 포트폴리오 요약 **대시보드 UI** + **SWR 데이터 훅**(`/api/*` 호출) + **Playwright 렌더 테스트**(종료조건 3). 의도적으로 미뤄온 **UX 축(3회째 2점)을 직접 끌어올리는 이터레이션** — #4 후에도 UX가 안 오르면 그때 회로차단기 대상. 이후 #5+ 나머지 GET 클라이언트로 종료조건 1 완성.

## 확정된 아키텍처 결정
- Next.js **15.5.19** App Router, TS **strict**, **pnpm**. Tailwind X, src dir X, alias `@/*`, build Turbopack X.
- 테스트: **Vitest**(node env, `test/stubs/server-only.ts`). Playwright config·script만(브라우저 미설치).
- 시크릿 격리: 서버 전용 `lib/server/**` + `import 'server-only'`. env zod 검증(`lib/server/env.ts`, lazy `getEnv()`).
- 토큰: `lib/server/toss/auth.ts` `createTokenProvider({fetchFn, now})`. 응답 `{access_token, token_type:"Bearer", expires_in(초)}`.
- API 클라이언트: `lib/server/toss/client.ts` `createTossClient({tokenProvider, fetchFn, now, sleep, rateLimiter, baseUrl, random})` — Bearer·`X-Tossinvest-Account`·봉투 언래핑·zod 검증·`TossApiError`·429 Retry-After+백오프(MAX_RETRIES=3).
- Rate limiter: `lib/server/toss/rate-limiter.ts` 그룹별 토큰버킷(주입 클록). TPS ACCOUNT 1·ASSET 5·MARKET_DATA 10·MARKET_INFO 3.
- 스키마: `lib/server/toss/schemas.ts` zod. **decimal=z.string()**, **enum=literal union+string fallback**. 봉투 `apiResponse(result)`/`errorResponse`.
- 엔드포인트(서버): `lib/server/toss/endpoints.ts` — getAccounts/getHoldings/getPrices/getExchangeRate.
- **컨테이너**: `lib/server/toss/container.ts` `getServerTossClient()` — env로 실제 의존성 조립 싱글톤(서버 전용).
- **API 프록시 라우트**(App Router, `dynamic='force-dynamic'`): `app/api/{accounts,holdings,prices,exchange-rate}/route.ts`. 쿼리 zod 검증, 성공 `200 {data}`, 에러 `{error:{code,message,requestId?}}`(시크릿/스택 미노출, unknown→500 generic). holdings: `accountSeq` 미제공 시 첫 계좌 사용. 공통 헬퍼 `lib/server/api/respond.ts`.
- **시크릿 번들 가드**: `scripts/check-bundle-secrets.mjs` — `.next/static/**/*.js` 스캔, 금지(`TOSS_CLIENT_SECRET`/`TOSS_CLIENT_ID`/`TOSS_ACCOUNT_SEQ`/`client_secret`/`process.env.TOSS_`) 발견 시 exit 1. **`build` 스크립트에 결합**(`next build && node scripts/check-bundle-secrets.mjs`).
- openapi.json 캐시: `/tmp/toss-openapi.json`(영구 아님).

## 게이트 (4개)
`pnpm run lint` · `pnpm run typecheck` · `pnpm run test` · `pnpm run build`(번들 가드 포함)

## Phase 1 종료 조건
- [ ] mock 계약 테스트로 **모든** GET 엔드포인트 클라이언트 통과 — **부분(4/16)**: accounts·holdings·prices·exchange-rate ✅. 남은 GET ↓.
- [x] 시크릿이 클라이언트 번들에 없음(빌드 산출물 grep 검증) — **build 게이트 가드로 달성**(19개 번들 스캔 클린).
- [ ] 대시보드가 포트폴리오 요약·보유종목·주문내역·시세 렌더(Playwright) — 미작성(#4)
- [x] lint·typecheck·test·build 전부 green — ✅ 유지중

### 완료
- [x] #1 스캐폴드 + 게이트 + 시크릿 격리 + OAuth 토큰 모듈
- [x] #2 베이스 클라이언트(인증·rate limit·에러·429) + 코어 GET 4종 + 계약 테스트(37)
- [x] #3 API 프록시 라우트 4종 + 컨테이너 + 시크릿 번들 가드 + 라우트 테스트(누적 48)

## 남은 GET 엔드포인트 (#5+ 계약 테스트/라우트 대상)
orderbook · trades · price-limits · candles · stocks · stocks/{symbol}/warnings · market-calendar/KR · market-calendar/US · orders(조회) · orders/{orderId} · buying-power · sellable-quantity · commissions

## 미해결/후속
- 대시보드 UI·SWR 훅 없음(#4) — 종료조건 3 + UX 축.
- 선제 스로틀(`X-RateLimit-Remaining` 사전 대기) 미구현(헤더 스냅샷만).
- 폴링 주기 `market-calendar` 연동(폐장 완화) 미구현.
- Playwright 브라우저 미설치(첫 E2E 시 `playwright install`).
