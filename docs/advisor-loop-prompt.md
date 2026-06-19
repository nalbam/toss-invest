# 토스증권 대시보드 — AI 어드바이저 자가 개선 개발 루프 마스터 프롬프트

> 이 문서는 **개발용 프롬프트**다. "스스로 평가하고 개선하는 루프"로
> LLM(OpenAI·xAI) 기반 **포트폴리오 분석·조언·주문 제안** 기능을 단계적으로 구현하기 위한 것이다.
> 기존 [`docs/dev-loop-prompt.md`](dev-loop-prompt.md)(Phase 1·2·3)의 **형제 프롬프트**이며,
> 그 §6 거래 안전장치를 **불변으로 상속**한다.
>
> 실행 방법: kickoff 프롬프트로 다음을 준다 —
> *"`docs/advisor-loop-prompt.md` 와 `PROGRESS.md`·`EVAL.md` 를 읽고, §5.3 절차로 한 반복을 수행하라."*
> `/loop` 으로 자동 반복하려면 같은 문장을 prompt 로 넘긴다. **파일 경로 문자열만으로는 내용이
> 자동 주입되지 않으므로, 매 반복 이 파일을 Read 로 재로드해야 한다**(§5.3 1단계).

---

## 0. 너의 역할과 루프 한 줄 요약

너는 이 저장소에서 **LLM 기반 AI 투자 어드바이저**를 만드는 자율 개발 에이전트다.
이 기능은 내 계좌·보유종목·시세를 분석해 **조언(서술)** 과 **구조화된 주문 제안**을 생성한다.
**LLM은 "제안자"일 뿐 "집행자"가 아니다** — 제안은 사람이 검토·confirm해 기존 §6 게이트를 통과할 때만 실주문이 된다.

매 반복마다:

1. 상태 파일(`PROGRESS.md`, `EVAL.md`)을 읽고 **현재 위치**를 파악한다.
2. 현재 Phase의 종료 조건을 향한 **가장 작은 다음 증분**을 하나 고른다.
3. 그 증분을 **TDD**로 구현한다(실패 테스트 → 구현 → 통과). 비결정 LLM 호출은 stub/mock으로 격리한다.
4. **객관 게이트**(lint·typecheck·test·build)를 전부 통과시킨다 — 통과 못 하면 그 반복은 끝나지 않는다.
5. **자기비평 루브릭**으로 결과물을 채점하고 `EVAL.md`에 기록한다.
6. 채점에서 가장 점수가 낮은 축을 **다음 개선 항목**으로 도출한다.
7. `PROGRESS.md`를 갱신하고 반복을 종료한다.

**루프 종료 조건**: 현재 Phase의 모든 종료 조건 충족 **AND** 루브릭 전 축 ≥ 목표 점수 → 다음 Phase로.
모든 Phase(A1·A2·A3) 완료 시 루프 종료.

---

## 1. 미션과 산출물

토스증권 대시보드에 **온디맨드 AI 조언 카드**를 추가한다. 버튼을 누르면 서버가 포트폴리오·시장
데이터를 모아 LLM에 보내고, **서술 조언 + 구조화된 주문 제안 목록**을 받아 보여준다. 사용자는 제안을
클릭해 기존 주문 폼에 채운 뒤(prefill), 평소처럼 dry-run·confirm·§6 게이트를 거쳐 직접 주문한다.

- 사용자: 개발자 본인 1인(개인용). 멀티테넌트·인증 서버 불필요.
- 제안 범위: **보유 종목 관리**(hold / trim / exit / 비중 리밸런싱) **+ 신규 매수(BUY) 제안** + **서술 조언**.
- LLM 출처: OpenAI · xAI(Grok). 둘 다 OpenAI 호환 chat completions API → 어댑터 추상화 뒤에 둔다.
- **비목표(YAGNI)**: 자동 집행, 상시 루프, 멀티유저, 제안 영속화/히스토리 DB, 백테스트 연동(이 루프 범위 밖).

---

## 2. 기술 스택과 아키텍처 제약 (고정)

기존 스택을 그대로 재사용한다(새 런타임 의존성 최소화).

- **프레임워크**: Next.js 15 (App Router) + TypeScript(strict). 테스트 Vitest(서버=node, UI=jsdom) + Playwright E2E.
- **레이어링(접근법 A — 확정)**: 기존 `lib/server/{toss,trading}` 관례를 따라 두 서버 레이어를 새로 둔다.
  ```
  lib/server/llm/                  # provider 추상화 (server-only, 시크릿 격리)
    types.ts        # LlmProvider 인터페이스, ChatRequest/ChatResponse 타입
    openai.ts       # OpenAI 어댑터 (chat completions + structured output)
    xai.ts          # xAI(Grok) 어댑터 — OpenAI 호환이라 거의 동일
    container.ts    # LLM_PROVIDER env로 어댑터 선택 (getServerLlmProvider)
  lib/server/advisor/              # 조언 도메인 (provider 외 전부 결정적)
    snapshot.ts     # toss client로 포트폴리오+시장데이터 수집 → 마스킹된 스냅샷 (순수 변환부 분리)
    prompt.ts       # 스냅샷 → system+user 프롬프트 빌드 (순수)
    schema.ts       # zod: LLM 구조화 출력(proposals[] + advice) 스키마
    validate.ts     # 제안을 실제와 대조 검증 (보유·매도가능수량·심볼 실재·정수·side) (순수)
    advisor.ts      # 오케스트레이션: snapshot→prompt→provider→zod parse→validate
  app/api/advisor/route.ts         # POST: 데이터수집→LLM→검증된 제안 반환 {data}
  lib/client/advisor.ts            # 클라이언트 타입 + 온디맨드 fetcher (자동폴링 X)
  app/_components/AiAdvisor.tsx    # CollapsibleCard: 버튼·로딩·조언·제안목록·"폼에 담기"·disclaimer
  ```
- **HTTP는 `fetch` 직접**(SDK 미도입). 기존 `auth.ts`의 DI(fetch/clock) 패턴을 따라 `fetch`·타임아웃을 주입해
  결정적으로 테스트한다. (SDK가 명확히 이득이 크면 그때 사람에게 제안하고 추가한다 — 임의 도입 금지.)
- **시크릿 격리(필수)**: LLM API 키는 **`lib/server/llm/`에서만** 다룬다. `server-only` import, `env.ts` zod 검증,
  클라이언트 번들·브라우저·로그에 절대 노출 금지. 번들 시크릿 가드(`scripts/check-bundle-secrets.mjs`)에 LLM 키 패턴 추가.
- **구조화 출력 + 재검증**: 가능하면 provider의 structured output(JSON schema / `response_format`)을 쓰고,
  받은 응답은 **신뢰 경계 밖**으로 취급해 `schema.ts`(zod)로 다시 파싱·검증한 뒤에만 사용한다.
- **비용 가드**: 호출은 **온디맨드(버튼)만**. 자동 폴링 금지. 호출 타임아웃·최대 출력 토큰 상한을 둔다.
- **패키지/도구는 최신 문서를 Context7로 확인**하고 쓴다(훈련 데이터 맹신 금지) — 특히 §3.
- **기존 코드 무수정 원칙**: 거래(`lib/server/trading/**`)·기존 라우트·기존 컴포넌트는 이 기능을 위해
  **약화·변형하지 않는다**. 필요한 연결점(OrderForm prefill prop, Dashboard 상태 lift)만 외과적으로 추가한다.

> 디렉터리·네이밍·env 키는 첫 반복(A1)에서 확정하고 `PROGRESS.md`에 적은 뒤, 이후 반복은 그 관례를 따른다.

---

## 3. LLM Provider API 요약 (캐시된 사실 — 단, 공식 문서가 최종 진실)

두 provider 모두 **OpenAI 호환 chat completions**를 제공하므로 어댑터는 엔드포인트·키·모델명·structured
output 형식만 다르고 본문 구조는 거의 같다.

| Provider | Base URL(예) | 인증 헤더 | env 키 | 비고 |
|---|---|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `Authorization: Bearer $OPENAI_API_KEY` | `OPENAI_API_KEY` | `POST /chat/completions`, `response_format`로 structured output |
| xAI(Grok) | `https://api.x.ai/v1` | `Authorization: Bearer $XAI_API_KEY` | `XAI_API_KEY` | OpenAI 호환 `POST /chat/completions` |

- 공통 요청: `{ model, messages:[{role, content}], response_format?, temperature?, max_tokens? }`.
- **structured output**: 제안을 안정적으로 받기 위해 JSON schema 기반 출력을 우선한다. 형식·필드명은 provider마다
  세부가 다를 수 있으니 **추측하지 말고** 현재 문서를 확인한다.
- **모델명은 하드코딩하지 않는다**: `LLM_MODEL`(또는 provider별 기본)로 주입하고, 기본값/지원 모델은 §아래 규칙대로 확인.

> 스키마·엔드포인트·structured output·모델명을 다룰 때는 **Context7와 각 provider 공식 문서**로 현재 정의를
> 검증한다(요청/응답 형태, `response_format`/JSON schema 사용법, 인증, rate limit, 에러 봉투). 캐시된 표는
> 출발점일 뿐 최종 진실이 아니다. 확인한 사실은 어댑터 주석이나 `PROGRESS.md`에 근거와 함께 적는다.

---

## 4. 단계별 로드맵 + 종료 조건 (모두 자동 검증 가능)

### Phase A1 — Provider 추상화 + 결정적 코어 (UI 없음)
LLM을 부르기 전, **결정적으로 테스트 가능한 모든 것**을 먼저 만든다.
- `LlmProvider` 인터페이스 + OpenAI·xAI 어댑터(주입된 `fetch`로 요청 형태·응답 파싱 테스트) + `container`(env 선택).
- `snapshot.ts`: toss client로 포트폴리오 스냅샷 + 시장 데이터 수집. **순수 변환부**(원시 데이터 → 마스킹 스냅샷)를 분리해 단위 테스트. 계좌 시퀀스·계좌명 등 식별자/PII는 **화이트리스트 밖이면 제거**.
- `prompt.ts`(스냅샷→프롬프트), `schema.ts`(zod 출력 스키마), `validate.ts`(제안 검증) — 전부 순수.
- env 추가(`LLM_PROVIDER`·`OPENAI_API_KEY`·`XAI_API_KEY`·`LLM_MODEL`)는 **선택값**: 미설정이어도 앱은 정상 부팅하고, 어드바이저 경로만 명확한 "not configured"로 실패한다(거래/대시보드는 영향 없음).
- 번들 시크릿 가드에 LLM 키 패턴 추가.
- **종료 조건**:
  - [ ] `LlmProvider` 인터페이스 + 2 어댑터: mocked fetch로 요청(헤더·바디·structured output 지정)·응답 파싱 계약 테스트
  - [ ] `snapshot` 마스킹: 식별자/PII가 스냅샷에 없음 + 포함 필드 화이트리스트 단위 테스트
  - [ ] `schema`(zod) parse 성공/실패 + `validate`(보유·매도가능수량·심볼 실재·정수·side) 단위 테스트
  - [ ] LLM 키가 클라이언트 번들에 없음(번들 가드 확장 + build 클린)
  - [ ] env 미설정 시 부팅 정상 + 어드바이저 경로만 "not configured" 에러
  - [ ] lint·typecheck·test·build green

### Phase A2 — 어드바이저 오케스트레이션 + API 라우트 (provider는 stub)
- `advisor.ts`: `snapshot → prompt → provider(주입) → zod parse → validate → result`. 테스트는 stub provider로 정상/파싱실패/검증탈락을 결정적으로 검증.
- `app/api/advisor/route.ts`: **POST**(외부 유료 호출 트리거), `force-dynamic`, `{ data:{ advice, proposals, model, generatedAt } }` 봉투, 에러 매핑(provider 에러 → sanitize, not-configured → 명확한 코드), 응답 zod.
- **LLM은 §6 상류**임을 코드로 증명: 어드바이저 레이어는 `placeOrder`/`createOrderRaw`를 import·호출하지 않는다.
- **종료 조건**:
  - [ ] `advisor.ts`가 stub provider로 전체 파이프라인 결정적 테스트(정상·파싱실패·검증탈락)
  - [ ] 라우트가 advisor stub으로 `{data}` 봉투·에러 매핑·`force-dynamic`·미설정 처리 테스트
  - [ ] **어드바이저 경로가 `placeOrder`/`createOrderRaw`를 호출하지 않음**(grep + 의존성 테스트로 증명)
  - [ ] 환각/무효 제안(없는 심볼·보유초과 매도 등)이 `validate`에서 탈락·플래그됨(테스트)
  - [ ] 외부 전송 페이로드에 시크릿·PII 없음(테스트로 단언)
  - [ ] lint·typecheck·test·build green

### Phase A3 — UI 카드 + prefill → §6 연결
- `lib/client/advisor.ts`(타입 + 온디맨드 fetcher, 자동폴링 X), `AiAdvisor.tsx`(CollapsibleCard: 버튼·로딩·조언·제안목록·"폼에 담기"·**disclaimer**·미설정/에러 상태).
- Dashboard에 `prefill` 상태를 lift, 기존 `OrderForm`이 prefill prop을 수용. **주문은 여전히 사람이 confirm + §6** — prefill은 입력만 채울 뿐 전송하지 않는다.
- **종료 조건**:
  - [ ] 카드가 버튼·로딩·조언·제안·에러·미설정 상태를 렌더(jsdom 테스트)
  - [ ] "폼에 담기"가 `OrderForm`을 prefill하되 **자동 전송하지 않음** + confirm/§6 게이트 유지(테스트)
  - [ ] 검증 탈락 제안은 표시만 되고 "폼에 담기" 불가(테스트)
  - [ ] 자동 폴링 없음(온디맨드만) — 비용 가드(코드/테스트)
  - [ ] Playwright 스모크(route-mock)로 카드 렌더·제안 표시
  - [ ] lint·typecheck·test·build green

---

## 5. self-evaluating loop 프로토콜 (객관 게이트 + 자기비평)

### 5.1 객관 게이트 (이게 1차 종료 신호 — 통과 못 하면 반복 미완료)
```
1) lint        — 통과
2) typecheck   — 통과 (TS strict, no any 남발)
3) test        — 신규/변경 동작에 대한 테스트 추가 후 전부 통과
4) build       — 프로덕션 빌드 성공 + 번들 시크릿 가드(LLM 키 포함) 클린
```
하나라도 실패하면 **근본 원인**을 고친다(테스트를 무력화하거나 skip하지 않는다).

### 5.2 자기비평 루브릭 (매 반복 끝에 1~5점 채점 → `EVAL.md` 기록)
| 축 | 무엇을 보는가 | 목표 |
|---|---|---|
| Functionality | 이번 증분이 Phase 종료 조건을 실제로 전진시켰나 | ≥4 |
| LLM 정합성 | 요청/응답이 provider 문서·structured output 계약과 일치하고 zod로 재검증되나 | ≥4 |
| Safety | §6(거래 안전 + 어드바이저 불변식)이 우회 불가능하게 유지되나 | **5 (타협 불가)** |
| Security & Privacy | LLM 키 격리·번들 미노출·외부 전송 PII 마스킹·로그 비노출 | **5 (타협 불가)** |
| Determinism/Testability | 비결정성이 provider 한 곳에 격리되고, 나머지가 결정적 단위 테스트로 덮이나 | ≥4 |
| UX | 카드·조언·제안·prefill 흐름이 명확하고 disclaimer가 있나 | ≥3 |
| Code quality | 외과적 변경·작은 단위·중복 없음·읽기 쉬움 | ≥4 |

> **근거 필수(grade inflation 방지)**: 각 축 점수는 `EVAL.md`에 근거(게이트 출력·테스트 ID·grep 결과·Playwright 결과)를 함께 적는다. 근거 없는 점수는 **무효(0점 처리)**이며 그 반복은 완료로 보지 않는다.

### 5.3 반복 절차 (의사코드)
```
reload(this_prompt_file, PROGRESS.md, EVAL.md)   # 1단계: 이 파일·상태파일을 매 반복 Read로 재로드
pick = next_unfinished_exit_criterion(current_phase, order=dependency_topological)
write_failing_test(pick); implement(pick); make_test_pass()   # LLM 호출은 stub/mock으로 격리
run_objective_gates()                      # 실패 시 근본원인 수정 후 재실행 (§5.5 회로차단기 적용)
scores = self_critique(rubric)             # §5.2 — 각 점수에 근거(게이트 출력/테스트 ID/grep) 필수
append(EVAL.md, {iteration, pick, scores+evidence, lowest_axis, next_action})  # append-only, #19부터 이어서
update(PROGRESS.md, {done, in_progress, next})   # 현재 상태만 (Phase 4/AI 어드바이저 섹션)
if scores.Safety < 5 or scores["Security & Privacy"] < 5:
    advance 금지; 해당 결함을 즉시 다음 pick으로 강제
elif all(current_phase_exit_criteria) and all(scores >= targets):
    advance_phase()
```

### 5.4 상태 파일 포맷 (단일 소스 — 기존 파일 재사용)
이 루프는 별도 파일을 만들지 않고 **기존 루프 메모리를 잇는다**:
- **`PROGRESS.md`** (현재 상태만): "Phase 4 — AI 어드바이저" 섹션을 추가/갱신. 완료·진행 중·다음 항목, 확정된 아키텍처 결정(env 키·디렉터리·provider 기본값). 과거 시행착오는 누적하지 않는다.
- **`EVAL.md`** (append-only 이력): **`#19`부터 이어서** 반복별 한 줄 로그: `#N | phase4 | 한 일 | 점수+근거(7축) | 최저축 | 다음 개선`. 회로차단기가 정체·반복 실패를 감지하려면 이력이 필요하므로 **덮어쓰지 않고 누적**한다.

> 두 파일은 루프의 메모리다. 매 반복 **반드시 먼저 읽고, 끝에 갱신**한다.

### 5.5 회로차단기 (루프가 막혔을 때 — 무한루프/오실레이션 방지)
- **동일 pick에서 객관 게이트 3회 연속 실패** → 중단하고 사람에게 원인·시도 내역 보고.
- **최저축 점수가 3회 연속 정체/하락** → 접근이 틀렸다고 보고 중단·보고.
- **한 Phase의 누적 반복이 비정상적으로 많음**(예: 종료조건 항목 수 × 5 초과) → 중단·보고.
- **provider 비결정성으로 테스트가 흔들림(flaky)** → 결정성 결함으로 보고 stub/mock 경계를 고친다(테스트를 재시도로 덮지 않는다).
- 중단 시 `EVAL.md`에 사유를 남기고 루프를 멈춘다. **막혔는데 같은 시도를 반복하지 않는다.**

---

## 6. 안전장치 (CRITICAL — 어떤 경우에도 약화 금지)

실거래 계좌 = 실제 돈. LLM은 **비결정적·신뢰 불가** 입력원이다. 안전은 코드 레벨에서 막는다.

> **불변식(메타 가드)**: 기존 거래 안전(`docs/dev-loop-prompt.md` §6: DRY_RUN 기본값·하드 리밋·kill switch·고액·멱등성·감사로그)과 그 테스트는 이 루프가 **임의로 변경·완화·skip할 수 없다.** `lib/server/trading/**`·관련 테스트의 변경이 감지되면 반복을 중단하고 보고한다. **종료 압박을 이유로 안전장치를 낮춰 게이트를 통과시키는 것은 금지**된다.

### 6.A 어드바이저 고유 불변식 (위에 더해 추가)
1. **LLM 출력은 제안일 뿐 명령이 아니다.** `lib/server/advisor/**`·`app/api/advisor/**`는 `placeOrder`/`createOrderRaw`를 **import·호출하지 않는다**(grep + 의존성 테스트로 증명). 제안 → 사람이 "폼에 담기" → dry-run → **사람 confirm** → 기존 §6 게이트. LLM은 §6보다 철저히 **상류**에 위치한다.
2. **에이전트/LLM 자가 확인 금지.** LLM이 confirm 토큰·승인을 발급하거나 `AUTO_TRADE_ENABLED`·`DRY_RUN`을 건드릴 수 없다(기존 §6.2 그대로). prefill은 입력 필드를 채울 뿐, confirm 체크박스를 자동 체크하지 않는다.
3. **제안은 prefill 전 결정적 검증 필수.** `validate.ts`가 심볼 실재(Toss로 확인)·정수 수량·SELL은 매도가능수량 이내·side 유효를 검사한다. **환각/무효 제안은 표시만 되고 폼에 담을 수 없다.** 검증은 자동 보정하지 않고 탈락시킨다.
4. **BUY 제안의 후보 검증.** 신규 매수 후보는 LLM 지식에서 나오되 **Toss로 실재·거래가능 확인 후에만** prefill 가능하다. 미확인 심볼은 차단.
5. **기존 §6 게이트는 호출만, 무수정.** 어드바이저가 만든 어떤 주문도 결국 §6(한도·kill switch·고액·dry-run)을 그대로 통과해야 한다. 어드바이저는 그 게이트를 우회·약화·재구현하지 않는다.

---

## 7. 보안 & 프라이버시

- LLM 키(`OPENAI_API_KEY`/`XAI_API_KEY`)와 토스 시크릿은 **환경변수/시크릿 매니저**. 코드·로그·커밋·테스트 픽스처에 하드코딩 금지. `.env`는 `.gitignore`, `.env.example`만 갱신.
- LLM 키가 클라이언트 번들·콘솔·네트워크 응답에 노출되지 않음을 **번들 가드(LLM 키 패턴 포함)로 회귀 방지**.
- **외부 전송 최소화·마스킹**: LLM에 보내는 스냅샷은 **포함 필드 화이트리스트**(보유 심볼·수량·평단·현재가·손익·비중·현금·매수여력·환율 + 선택한 시장 데이터). 계좌 시퀀스·계좌명 등 식별자/PII는 전송하지 않는다.
- **provider 응답은 신뢰 경계 밖**: zod 검증 전에는 어떤 필드도 사용하지 않는다. 검증 실패는 깔끔한 에러로 강등(크래시 금지).
- 비용 노출: 온디맨드 호출 only, 타임아웃·최대 토큰 상한. 노출 사고 시 즉시 **rotate**.

---

## 8. 작업 규율 (가드레일)

- **외과적 변경**: 이번 증분과 무관한 인접 코드·스타일·import 순서를 건드리지 않는다. 한 반복 = 한 목적. 기존 거래/라우트/컴포넌트는 연결점만 최소 추가.
- **검증 후 완료 선언**: "동작 확인" 주장은 실제 게이트 출력 + 테스트 결과로만. UI는 가능하면 Playwright로 확인, 불가하면 "UI 검증 미완료" 명시.
- **근본 원인**: 실패는 try-catch 도배나 테스트 재시도가 아니라 원인 수정. broad catch 금지.
- **최신 문서**: provider API는 §3대로 Context7·공식 문서로 확인하고 쓴다(훈련 데이터 맹신 금지).
- **git**: 커밋/푸시는 **사용자의 명시적 허가가 있을 때만**. 루프가 임의로 commit/push하지 않는다(원하면 변경 요약만 보고).
- **모호하면 멈추고 질문**: 요구가 갈리면 해석을 나열해 묻는다. 조용히 하나 고르지 않는다.

---

## 9. 첫 반복 시작점 (부트스트랩)

Phase A1의 첫 증분부터 시작한다:
1. `PROGRESS.md`에 "Phase 4 — AI 어드바이저" 섹션(A1·A2·A3 체크리스트)을 추가하고, `EVAL.md`는 `#19`부터 이어 쓸 준비를 한다.
2. env 키(`LLM_PROVIDER`·`OPENAI_API_KEY`·`XAI_API_KEY`·`LLM_MODEL`)를 `env.ts`(선택값)·`.env.example`에 추가. 미설정 부팅 정상 + 어드바이저만 "not configured".
3. 첫 증분으로 **`LlmProvider` 인터페이스 + 한 어댑터의 요청 형태**를 잡는다(주입된 `fetch`로 헤더·바디·structured output 지정을 단언하는 **실패 테스트부터**).
4. §5 절차대로 객관 게이트 통과 → 7축 자기채점(근거 필수) → 상태 갱신.
5. 이후 §4 종료조건을 의존성 순서로 하나씩 소거하며 A1 → A2 → A3로 전진한다.
