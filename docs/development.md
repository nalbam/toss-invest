# 개발 워크플로우

이 프로젝트는 **자가 평가 루프(self-evaluating loop)** 로 개발되었다 — 매 반복마다 가장 작은 다음 증분을 TDD로 구현하고, 객관 게이트를 통과시킨 뒤, 루브릭으로 자기채점해 다음 개선 항목을 도출한다. Phase 1·2·3은 완료되었고([roadmap.md](roadmap.md)), 이 문서는 그 워크플로우와 가드레일을 기록한다.

## 객관 게이트 (4종 + E2E)

```
1) lint        — pnpm run lint        (eslint, 위반 0)
2) typecheck   — pnpm run typecheck   (tsc --noEmit, TS strict, no any 남발)
3) test        — pnpm run test        (Vitest, 신규/변경 동작 테스트 후 전부 통과)
4) build       — pnpm run build       (.next 클린 + next build + 번들 시크릿 가드)
```

별도: `pnpm run test:e2e`(Playwright). 하나라도 실패하면 **근본 원인**을 고친다(테스트 무력화·skip 금지). 전체 스크립트는 [../README.md](../README.md).

### 테스트 구성

- **Vitest**: 서버=node, UI=jsdom. 차트는 `vi.mock('lightweight-charts')` 스모크. 순수 변환 함수는 단위 테스트로 100% 커버.
- **Playwright E2E**: `e2e/dashboard.spec.ts` route-mock 렌더 스모크. `webServer: next dev -p 3100`(더미 env). vitest는 `e2e/**` exclude.
- **build 게이트**: `rm -rf .next && next build && node scripts/check-bundle-secrets.mjs`(stale 캐시 오탐 방지 위해 매번 클린).

## self-evaluating loop 프로토콜

### 자기비평 루브릭 (1~5점, 근거 필수)

| 축 | 무엇을 보는가 | 목표 |
|---|---|---|
| Functionality | 이번 증분이 Phase 종료 조건을 실제로 전진시켰나 | ≥4 |
| API 정합성 | 요청/응답이 `openapi.json` 계약과 일치하나 | ≥4 |
| Safety | 거래 안전장치(§6)가 우회 불가능하게 유지되나 | **5 (타협 불가)** |
| Security | 시크릿 격리·로그 비노출·입력 검증 | **5 (타협 불가)** |
| UX | 대시보드가 의도한 정보를 명확히 보여주나 | ≥3 |
| Code quality | 외과적 변경·작은 단위·중복 없음·읽기 쉬움 | ≥4 |

각 점수는 근거(게이트 출력·테스트 ID·grep·Playwright 결과)와 함께 기록한다. 근거 없는 점수는 무효. (어드바이저 루프는 LLM 정합성·Determinism/Testability·Privacy 축을 더한 7축 — [roadmap.md](roadmap.md) Phase 4.)

### 반복 절차 (의사코드)

```
reload(state)                              # 현재 위치 파악
pick = next_unfinished_exit_criterion(current_phase, order=dependency_topological)
write_failing_test(pick); implement(pick); make_test_pass()   # 비결정 호출은 stub/mock
run_objective_gates()                      # 실패 시 근본원인 수정 후 재실행 (회로차단기 적용)
scores = self_critique(rubric)             # 각 점수에 근거 필수
record(iteration, pick, scores+evidence, lowest_axis, next_action)
if scores.Safety < 5 or scores.Security < 5:
    advance 금지; 해당 결함을 즉시 다음 pick으로 강제
elif all(current_phase_exit_criteria) and all(scores >= targets):
    advance_phase()
```

종료: 현재 Phase의 모든 종료 조건 충족 **AND** 루브릭 전 축 ≥ 목표 → 다음 Phase. 모든 Phase 완료 시 루프 종료.

### 회로차단기 (무한루프/오실레이션 방지)

- 동일 pick에서 객관 게이트 **3회 연속 실패** → 중단·보고.
- 최저축 점수가 **3회 연속 정체/하락** → 접근이 틀렸다고 보고 중단.
- 한 Phase 누적 반복이 비정상적으로 많음(종료조건 수 × 5 초과) → 중단·보고.
- (어드바이저) provider 비결정성으로 테스트가 flaky → 결정성 결함으로 보고, stub/mock 경계를 고친다(재시도로 덮지 않는다).
- 중단 시 사유를 남기고 멈춘다. **막혔는데 같은 시도를 반복하지 않는다.**

## 작업 규율 (가드레일)

- **외과적 변경**: 이번 증분과 무관한 인접 코드·스타일·import 순서를 건드리지 않는다. 한 반복 = 한 목적.
- **검증 후 완료 선언**: "동작 확인" 주장은 실제 게이트 출력 + 테스트 결과로만. UI는 가능하면 Playwright로 확인, 불가하면 "UI 검증 미완료" 명시.
- **근본 원인**: 실패는 try-catch 도배나 테스트 재시도가 아니라 원인 수정. broad catch 금지.
- **최신 문서**: 라이브러리·SDK·provider API는 Context7·공식 문서로 확인(훈련 데이터 맹신 금지).
- **git**: 커밋/푸시는 **사용자의 명시적 허가가 있을 때만**. 임의 commit/push 금지.
- **모호하면 멈추고 질문**: 요구가 갈리면 해석을 나열해 묻는다. 조용히 하나 고르지 않는다.

## 부트스트랩 (최초 스캐폴드)

새 환경에서 처음부터 세울 경우:

1. Next.js 15 + TS(strict) + Vitest + Playwright 스캐폴드, lint/typecheck/test/build 스크립트 확정.
2. `.env.example`(토스 API 키 자리) 작성, 시크릿 격리 구조(서버 전용 모듈) 세움.
3. 첫 증분으로 **OAuth 토큰 발급/캐싱 모듈 + 단위 테스트**(실패 테스트부터).
4. 객관 게이트 통과 → 자기채점 → 다음 pick.

## AI 어드바이저 루프 (계획 — 미구현)

Phase 4(AI 어드바이저)는 위 dev-loop의 **형제 루프**로 설계되었으나 아직 구현되지 않았다. 동일한 게이트·루브릭(7축)·회로차단기·규율을 따르며, 거래 안전 §6과 어드바이저 고유 불변식 §6.A를 불변 상속한다. 비결정 LLM 호출은 단일 provider 경계로 격리하고 나머지는 결정적 단위 테스트로 덮는다. 로드맵(A1·A2·A3)은 [roadmap.md](roadmap.md), 안전 불변식은 [trading-safety.md](trading-safety.md) §6.A.
