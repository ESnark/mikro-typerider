# mikro-mapped-types

MikroORM v7용 OverrideType 유틸리티 라이브러리. 자동 생성된 entity의 특정 프로퍼티 타입을 커스텀 타입으로 오버라이드한다.

## 기술 스택

- TypeScript 5.x (ES decorators)
- MikroORM v7 (peerDependency)
- ESM (type: "module")
- Node.js >= 20
- vitest (테스트)

## 핵심 참조

- `CONTEXT.md` — 전체 설계 문서 (목적, MikroORM 메타데이터 구조, 구현 설계, 생성된 Entity 예시)

## 하네스: mikro-mapped-types 개발

**목표:** OverrideType 라이브러리를 초기화 → 구현 → 테스트 파이프라인으로 개발

**에이전트 팀:**
| 에이전트 | 역할 |
|---------|------|
| scaffolder | 프로젝트 초기화 (package.json, tsconfig, vitest 설정) |
| implementer | OverrideType 핵심 코드 구현 (타입 + 메타데이터) |
| tester | 테스트 작성 및 실행 (타입/메타데이터/통합) |

**스킬:**
| 스킬 | 용도 | 사용 에이전트 |
|------|------|-------------|
| scaffold-npm-lib | npm 라이브러리 프로젝트 초기 구조 생성 | scaffolder |
| implement-override-type | OverrideType 핵심 코드 구현 | implementer |
| test-override-type | 테스트 작성 및 실행 | tester |
| dev-mikro-mapped-types | 오케스트레이터 — 파이프라인 전체 조율 | (오케스트레이터) |

**실행 규칙:**
- 라이브러리 개발/구현/테스트 관련 작업 요청 시 `dev-mikro-mapped-types` 스킬을 통해 서브 에이전트로 처리하라
- 단순 질문/확인은 에이전트 없이 직접 응답해도 무방
- 모든 에이전트는 `model: "opus"` 사용

**디렉토리 구조:**
```
.claude/
├── agents/
│   ├── scaffolder.md
│   ├── implementer.md
│   └── tester.md
└── skills/
    ├── scaffold-npm-lib/
    │   └── SKILL.md
    ├── implement-override-type/
    │   └── SKILL.md
    ├── test-override-type/
    │   └── SKILL.md
    └── dev-mikro-mapped-types/
        └── SKILL.md
```

**변경 이력:**
| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-04-07 | 초기 구성 | 전체 | 하네스 신규 구축 |
