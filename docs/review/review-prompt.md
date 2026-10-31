# 리뷰 평가 기준과 보고 형식

이 문서는 각 구현 단계의 리뷰어가 따르는 기준이다.
리뷰어는 구현자의 설명이나 의도를 받지 않는다. 명세, 이 문서, 변경 diff, 성능 측정 기록만 본다.

## 리뷰 범위

- 이번 단계에서 바뀐 파일 전체
- 바뀐 코드가 직접 호출하거나 import하는 기존 파일의 관련 부분
- 모듈 경계와 의존 방향은 매번 전체를 검토한다

## 평가 항목

### 정확성 결함 (CORRECTNESS)

코드가 틀렸거나 spec이 요구한 동작과 다른 것.
예: 잘못된 경계 조건, off-by-one, null 역참조, 이벤트 핸들러 순서 오류, DOM 쓰기 후 읽기로 레이아웃 스래싱.
→ **반드시 고쳐야 통과**

### 명세 위반 (SPEC)

`docs/spec/spec.md`가 요구하는 계약과 어긋나는 것.
예: 금지된 `setTimeout`, `innerHTML` 사용, module-level mutable state, 의존 방향 위반.
→ **반드시 고쳐야 통과**

### 설계 위험 (DESIGN)

지금 당장 틀리지는 않지만, 나중에 정확성이나 유지보수에 위험이 될 구조.
예: 두 곳이 같은 사실을 저장함(단일 원천 위반), 인터페이스 계약이 불분명해 오용하기 쉬움.
→ **고치거나, 고치지 않는 이유를 decisions.md에 남겨야 통과**

### 개선 제안 (SUGGESTION)

고치면 좋지만 통과를 막지는 않는 것.
예: 더 명확한 이름, 더 짧은 표현, 관련 테스트 추가.
→ **고치지 않아도 됨, decisions.md 미룬 항목에 남김**

## 판단 기준 (명세에서)

- 우회 금지: `setTimeout(fn, 0)`, `requestAnimationFrame`, `execCommand`, `innerHTML/outerHTML`로 사용자 콘텐츠 삽입, 타입 단언(`as`, `!`), 레이아웃 읽기(`offsetHeight`, `getBoundingClientRect`, `getComputedStyle`)를 렌더링 중이나 이벤트 핸들러에서 하는 것
- 모듈 수준 가변 상태 금지
- 의존 방향: `core` ← `view` ← `editor` ← `react`. view는 React를 import 하지 않음. react는 view를 import 하지 않음
- useMemo/useCallback/memo는 정확성 요건 또는 측정된 성능 문제에만, 근거 주석 필수
- 측정되지 않은 최적화 금지

## 보고 형식

```
## 리뷰: [단계 번호] [단계 이름]

### 정확성 결함
(없으면 "없음")
- FILE:LINE: 내용

### 명세 위반
(없으면 "없음")
- FILE:LINE: 내용

### 설계 위험
(없으면 "없음")
- FILE:LINE: 내용 / 근거: …

### 개선 제안
(없으면 "없음")
- FILE:LINE: 내용

### 문제 없음 (근거 포함)
검토했으나 문제 없다고 판단한 주요 영역과 그 근거.
```

리뷰어는 코드를 수정하지 않는다. 발견한 것만 보고한다.
