# EVAL — self-evaluating loop 이력 (append-only)

형식: `#N | phase | 한 일 | 점수+근거(6축) | 최저축 | 다음 개선`
점수 1~5. 근거 없는 점수는 무효(0점). Safety/Security는 5 타협 불가.

---

## #1 | phase1 | 부트스트랩: Next.js 15 스캐폴드 + env(zod)·OAuth 토큰 모듈(TDD)

**객관 게이트(메인 에이전트 직접 재실행 — 근거):**
- lint: `pnpm run lint` → eslint 출력 없음(위반 0), exit 0
- typecheck: `pnpm run typecheck` → tsc --noEmit 출력 없음(에러 0), exit 0
- test: `pnpm run test` → vitest **Test Files 2 passed, Tests 14 passed**
- build: `pnpm run build` → **✓ Compiled successfully**, static pages 5/5

**루브릭 점수 + 근거:**
- Functionality **4** — Phase1 첫 의존성(토큰 provider) 완성. 근거: auth.test 발급/캐시/만료갱신/skew/동시성 통과(14 tests). 대시보드 데이터 클라이언트는 미착수.
- API 정합성 **3** — 토큰 요청 `grant_type=client_credentials`+form-urlencoded는 테스트로 검증. 근거: auth.test의 form body 단언. 한계: `expires_in` 등 응답 스키마를 openapi.json으로 미검증(파서 1곳 집중으로 교체 용이).
- Safety **5** — 주문/거래 코드 경로 자체가 아직 없어 우회 대상 없음 + `.env.example` `DRY_RUN=true` 기본. 근거: lib에 order 경로 부재, .env.example 기본값.
- Security **5** — server-only 격리 + zod fast-fail, `.env` 부재, `.gitignore`에 `.env`/`.env.*`, 하드코딩 시크릿 없음. 근거: `ls .env`=없음, `.gitignore:54-55`, grep secret 클린.
- UX **2** — 대시보드 UI 없음(스캐폴드 기본 page). 근거: app/page.tsx 기본값.
- Code quality **4** — DI(fetch/clock) + 단일 inFlight + parseTokenResponse 격리, 외과적 범위 유지. 근거: auth.ts 설계, README/프롬프트 문서 무변경.

**최저축**: UX(2) — 단, 이 단계에선 정상(UI는 데이터 클라이언트 이후). 추세 감시용 기록.
**다음 개선(next pick)**: 의존성 순서상 Toss API 클라이언트 + GET 계약 테스트(accounts→holdings→prices/exchange-rate). 이때 openapi.json으로 토큰·응답 스키마 검증해 API 정합성 3→4↑.

---

## #2 | phase1 | Toss API 클라이언트(인증·rate limit·에러·429) + 코어 GET 4종 + 계약 테스트

**객관 게이트(메인 에이전트 직접 재실행 — 근거, 전부 exit 0):**
- lint: `pnpm run lint` exit 0 (eslint 위반 0)
- typecheck: `pnpm run typecheck` exit 0 (tsc 에러 0)
- test: `pnpm run test` exit 0 → vitest **Test Files 5 passed, Tests 37 passed**
- build: `pnpm run build` exit 0 → ✓ Compiled successfully

**루브릭 점수 + 근거:**
- Functionality **5** — 베이스 클라이언트 + rate limiter + 코어 GET 4종(accounts/holdings/prices/exchange-rate) 완성. 근거: 37 contract/unit tests 통과.
- API 정합성 **5** — 스키마를 `/tmp/toss-openapi.json` ground truth에서 추출(추측 0). decimal=string, enum unknown 허용, 봉투 {result}, X-Tossinvest-Account 헤더, expires_in(초) 확인. 근거: schemas.ts가 openapi와 일치 + 계약테스트가 헤더/쿼리/언래핑/decimal 보존 단언. (#1의 3 → 5)
- Safety **5** — 주문/거래 코드 경로 여전히 없음(우회 대상 없음). 근거: GET 전용, POST/order 부재.
- Security **5** — 신규 코드 전부 `lib/server/**` server-only, 시크릿 없음, build 성공(server-only 클라이언트 번들 미누출). 근거: build exit 0, 기존 파일 0개 수정. 한계: 전용 번들 grep 회귀 테스트는 #3 예정(회귀 없음).
- UX **2** — UI 없음(스캐폴드 기본 page). 근거: app/page.tsx 기본값. (#1과 동일, 의도적 후순위)
- Code quality **5** — rate-limiter/schemas/client/endpoints 분리, 전면 DI, 기존 파일 무수정(외과적). 근거: builder 수정 파일 0.

**최저축**: UX(2) — 데이터 계층 이후 단계라 정상. active pick은 아님(회로차단기 대상 아님).
**다음 개선(next pick #3)**: Next API 프록시 라우트 4종 + SWR 훅 + 시크릿 번들 grep 회귀 테스트(종료조건 2).
