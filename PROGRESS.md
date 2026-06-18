# PROGRESS — 토스증권 대시보드 (현재 상태만)

## 현재 위치
- **Phase**: 1 (읽기전용 대시보드)
- **마지막 이터레이션**: #2 완료 (Toss API 클라이언트 + 코어 GET 4종 + 계약 테스트)
- **다음 pick (#3)**: Next API 프록시 라우트(서버) — accounts/holdings/prices/exchange-rate 4종 + 클라이언트 데이터 훅(SWR) + **시크릿 클라이언트 번들 비노출 grep 회귀 테스트**(Phase 1 종료조건 2). 그 다음(#4) 포트폴리오 요약 대시보드 UI + Playwright 렌더 테스트(종료조건 3), 이후(#5+) 나머지 GET 클라이언트로 종료조건 1 완성.

## 확정된 아키텍처 결정
- Next.js **15.5.19** (App Router), TypeScript **strict**, 패키지 매니저 **pnpm**. Tailwind X, src dir X, alias `@/*`, build Turbopack X.
- 테스트: **Vitest**(node env, `test/stubs/server-only.ts`). Playwright config·script만(브라우저 미설치).
- 시크릿 격리: 서버 전용 `lib/server/**` + `import 'server-only'`. 환경변수 zod 검증(`lib/server/env.ts`, lazy `getEnv()` fast-fail).
- 토큰: `lib/server/toss/auth.ts` `createTokenProvider({fetchFn, now})` — 캐시/skew 갱신/단일 inFlight. 응답 `{access_token, token_type:"Bearer", expires_in(초)}`(비봉투) — openapi.json 검증 완료.
- **API 클라이언트**: `lib/server/toss/client.ts` `createTossClient({tokenProvider, fetchFn, now, sleep, rateLimiter, baseUrl, random})` — Bearer 자동, `X-Tossinvest-Account` 헤더, 봉투 `{result}` 언래핑+zod 검증, 비2xx→`TossApiError(status,code,message,requestId,data)`, 429 Retry-After+지수백오프(1→2→4s)+지터, MAX_RETRIES=3.
- **Rate limiter**: `lib/server/toss/rate-limiter.ts` 그룹별 토큰버킷(주입 클록), per-group promise 체인 직렬화. TPS: ACCOUNT 1·ASSET 5·MARKET_DATA 10·MARKET_INFO 3.
- **스키마**: `lib/server/toss/schemas.ts` zod. **decimal=z.string()**(정밀도 보존), **enum=known literal union + z.string() fallback**(unknown 허용). 봉투 `apiResponse(result)` / `errorResponse`.
- **엔드포인트**: `lib/server/toss/endpoints.ts` — getAccounts / getHoldings({accountSeq,symbol?}) / getPrices({symbols[]}) / getExchangeRate({base,quote,dateTime?}).
- openapi.json 캐시: `/tmp/toss-openapi.json` (재사용 시 그룹·스키마 추출용; 영구 아님).

## 게이트 (4개)
`pnpm run lint` · `pnpm run typecheck` · `pnpm run test` · `pnpm run build`

## Phase 1 종료 조건
- [ ] mock 계약 테스트로 **모든** GET 엔드포인트 클라이언트 통과 — **부분(4/16)**: accounts·holdings·prices·exchange-rate ✅. 남은 GET ↓.
- [ ] 시크릿이 클라이언트 번들에 없음(빌드 산출물 grep 검증 테스트) — 미작성(#3)
- [ ] 대시보드가 포트폴리오 요약·보유종목·주문내역·시세 렌더(Playwright) — 미작성(#4)
- [ ] lint·typecheck·test·build 전부 green — ✅ 유지중

### 완료
- [x] #1 스캐폴드 + 게이트 + 시크릿 격리 구조 + OAuth 토큰 모듈
- [x] #2 베이스 클라이언트(인증·rate limit·에러·429) + 코어 GET 4종 + 계약 테스트(37 tests)

## 남은 GET 엔드포인트 (#5+ 계약 테스트 대상)
orderbook · trades · price-limits · candles · stocks · stocks/{symbol}/warnings · market-calendar/KR · market-calendar/US · orders(조회) · orders/{orderId} · buying-power · sellable-quantity · commissions

## 미해결/후속
- 선제 스로틀(`X-RateLimit-Remaining` 낮을 때 사전 대기) 미구현 — 현재 헤더 스냅샷만 노출.
- 폴링 주기 `market-calendar` 연동(폐장 완화) 미구현.
- Playwright 브라우저 미설치(첫 E2E 시 `playwright install`).
- 대시보드 UI·Next 프록시 라우트·SWR 폴링 없음(#3~#4).
