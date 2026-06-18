# PROGRESS — 토스증권 대시보드 (현재 상태만)

## 현재 위치
- **Phase**: 1 (읽기전용 대시보드)
- **마지막 이터레이션**: #1 부트스트랩 완료
- **다음 pick**: 타입드 Toss API 클라이언트 계층(token provider 기반) + GET 엔드포인트 mock 계약 테스트 — `accounts` → `holdings` → `prices`/`exchange-rate` 순. 이때 `openapi.json`으로 토큰 `expires_in` 및 각 응답 스키마(페이지네이션 포함) 검증.

## 확정된 아키텍처 결정
- Next.js **15.5.19** (App Router), TypeScript **strict**.
- 패키지 매니저 **pnpm**. Tailwind X, src dir X, import alias `@/*`, build는 Turbopack X(안정성).
- 테스트: **Vitest**(node env, `server-only` 스텁 `test/stubs/server-only.ts`). Playwright는 config·script만(브라우저 미설치, E2E는 후속).
- 시크릿 격리: 서버 전용 `lib/server/**` + `import 'server-only'`. 환경변수는 **zod** 검증(`lib/server/env.ts`), 런타임 fast-fail(lazy `getEnv()`).
- 토큰: `lib/server/toss/auth.ts` `createTokenProvider({ fetchFn, now })` — 메모리 캐시 `{accessToken, expiresAtMs}`, skew(기본 60s) 내 만료 시 재발급, 동시 발급은 단일 `inFlight` Promise로 합침. 응답 파싱은 `parseTokenResponse` 한 곳에 집중(스키마 교체 용이).
- `pnpm-workspace.yaml`의 `allowBuilds`로 sharp/unrs-resolver 빌드 승인(게이트 안정).

## 게이트 스크립트 (4개)
`pnpm run lint` · `pnpm run typecheck`(tsc --noEmit) · `pnpm run test`(vitest run) · `pnpm run build`(next build)

## Phase 1 종료 조건
- [ ] mock 계약 테스트로 모든 GET 엔드포인트 클라이언트 통과(다중 페이지 케이스 포함)
- [ ] 시크릿이 클라이언트 번들에 없음(빌드 산출물 grep 검증 테스트)
- [ ] 대시보드가 포트폴리오 요약·보유종목·주문내역·시세를 렌더(Playwright)
- [ ] lint·typecheck·test·build 전부 green

### 완료
- [x] 프로젝트 스캐폴드 + 4개 게이트 동작 (lint/typecheck/test/build green)
- [x] 시크릿 격리 구조(server-only + zod env, .env gitignore, .env.example만 커밋)
- [x] OAuth 토큰 발급/캐싱/만료 전 갱신 모듈 + 단위 테스트(발급·캐시·만료갱신·skew·동시성·form 검증)

## 미해결/후속
- 토큰 `expires_in` 및 GET 응답 스키마를 `openapi.json`으로 미검증 → 다음 pick에서 처리.
- 클라이언트 번들 시크릿 비노출 grep 회귀 테스트 미작성(Phase 1 종료조건).
- Playwright 브라우저 미설치(첫 E2E 시 `playwright install`).
- 대시보드 UI 없음(스캐폴드 기본 페이지).
