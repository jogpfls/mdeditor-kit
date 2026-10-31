# mdeditor-kit 명세

이 파일이 명세의 유일한 원천이다. 명세가 바뀌면 이 파일을 먼저 고치고, 다른 문서(CONTRIBUTING.md, CLAUDE.md, 공개 문서)와 코드 주석은 이 파일을 따른다. 다른 문서와 이 파일이 다르면 그 문서를 고친다.
결정은 마지막 절의 결정 기록에 날짜와 함께 남긴다. 결정 기록과 본문이 다르면 본문을 고친다.

이 명세의 모든 요구사항은 계약이다. 요구사항끼리 충돌하거나, 지키면 구현이 불가능해 보이면 우회하지 말고 작업을 멈추고 충돌 내용과 선택지를 보고한다.

**현재 구현 범위는 core(`src/core`), view/render(`src/view/render`), 읽기 전용 뷰(`src/view/view.ts`), React MdViewer(`src/react`), 패키지 엔트리 두 개다.** 본문(2~8절)은 구현된 것만 서술한다. 아직 없는 층(editor, selection·input·composition·clipboard·guard, CSS)에 대해 이미 내린 결정은 9절에 모아 둔다. 그 층을 구현할 때 9절의 해당 항목을 본문으로 옮긴다.

---

## 1. 목표와 판단 우선순위

npm에 배포할 **실시간 마크다운 에디터 React 라이브러리**다. 사용자가 마크다운 문법을 입력하면 그 자리에서 서식으로 바뀐다(노션 방식: `# `를 입력하면 제목이 되고 `# `는 사라진다).

설계 판단이 충돌하면 아래 순서를 따른다.

1. **정확성**: 모델과 DOM이 항상 일치한다. 한글 IME 조합이 깨지지 않는다. 데이터가 유실되지 않는다.
2. **구조적인 렌더링 성능 문제의 회피**(레이아웃 스래싱 등): 렌더러 내부의 실행 단계 설계(쓰기를 모두 끝낸 뒤 읽기)로 해결한다. 이를 이유로 선언적 구조를 포기하거나 명령형 코드를 다른 계층으로 퍼뜨리지 않는다.
3. **관심사 분리, 선언성, 높은 응집도, 낮은 결합도, 확장 가능성**
4. **그 외의 최적화는 하지 않는다.** 측정되지 않은 성능 문제를 위한 코드(메모이제이션, 가상화, 워커, 캐시)를 넣지 않는다.

**우회**는 원인을 해결하지 않고 증상만 가리는 코드다: 커서를 맞추려는 `setTimeout`/`requestAnimationFrame`, `execCommand`, 모델을 거치지 않는 DOM 수정, 타입 단언. 이런 코드가 필요해 보이면 설계가 잘못된 신호이므로 보고한다.

---

## 2. 패키지와 공개 엔트리 (구현됨)

| 엔트리   | 내보내는 것                                                                                                                                                                                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `./core` | 화면 없이 문서를 다루는 코드용: 문서 타입(`Doc`, `Block`, `Inline`, `TextRun`, `InlineAtom`, `Mark`, `MarkType`, `HeadingLevel`), `parseMarkdown`, `serializeMarkdown`, `serializeHtml`, `toJSON`, `fromJSON`, `MdJSON`, `StoredBlock`, `SCHEMA_VERSION`, `SchemaError`, `listNumbers`, `HEADING_LEVELS`, `MARK_TYPES`, `MAX_INDENT` |
| `.`      | 지금은 `FORMATS`, `isFormat`, `Format`, `MdJSON`만. React 에디터가 들어올 자리다(9절).                                                                                                                                                                                                                                               |

- Step·트랜잭션·히스토리·명령·입력 규칙·`isSafeHref`는 `core/internal.ts`로만 제공한다(에디터 자신의 층 전용, 패키지 엔트리 아님).
- `test/public-api`가 엔트리별 export 이름(값과 타입)을 고정한다. 이름의 삭제·변경은 breaking change다.
- ESM 전용. `exports`는 `.`, `./core`, `./package.json`. `sideEffects`는 CSS 파일만(지금은 없음).
- 런타임 의존성은 `core/markdown`이 쓰는 파서·렌더러 패키지(mdast-util-from-markdown, micromark, GFM 확장)뿐이다. 지금은 peer 의존성이 없다(`react`는 React 층과 함께 돌아온다).
- engines(`>=22.12.0`: 유지보수 중인 가장 오래된 Node 계열에서 도구 체인이 요구하는 첫 버전)가 하한의 단일 원천이다. CI는 그 값을 `package.json`에서 읽어 하한 버전과 `lts/*`에서 테스트와 소비자 스모크 테스트(`check:package`)를 돌린다.
- 번들 크기: `npm run check:size`가 사용처 관점(ESM 번들, 압축, 쓰지 않는 export 제거, gzip)의 크기를 엔트리·용도별로 재고 예산을 넘으면 실패한다. 예산과 측정값은 [docs/performance.md](../performance.md).
- 성능 특성은 공개 문서 [docs/performance.md](../performance.md)가 측정값과 함께 정한다.

---

## 3. 지원 범위

**한 줄은 한 블록이다.** 블록 텍스트에는 줄바꿈이 없고, 블록 내부의 소프트 줄바꿈은 없다.

| 구분   | 서식                              | 입력 문법                                                                                                                   |
| ------ | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 블록   | 제목 1~4                          | `#`~`####` + 스페이스                                                                                                       |
| 블록   | 인용                              | `>` + 스페이스                                                                                                              |
| 블록   | 글머리 목록                       | `-`, `*`, `+` + 스페이스                                                                                                    |
| 블록   | 순서 목록                         | 숫자 + `.` 또는 `)` + 스페이스. 깊이 0은 1, 2, 3, 1은 a, b, c, 2는 i, ii, iii. 최대 깊이는 상수                             |
| 삽입   | 구분선                            | 줄 전체가 `---` (세 번째 `-`를 입력하는 즉시 변환)                                                                          |
| 인라인 | 굵게, 기울임, 취소선, 인라인 코드 | `**텍스트**`, `*텍스트*`, `~~텍스트~~`, `` `텍스트` ``                                                                      |
| 인라인 | 링크                              | **보존 수준(D1)**: 파싱, 모델, 직렬화, HTML 출력(편집 화면 렌더링과 붙여넣기는 view 층, 9절). 입력 규칙과 툴바 UI는 범위 밖 |

- 모델이 충실히 표현할 수 없는 구조는 버리거나 평탄화하지 않고 원문을 보존한다(D2): 블록은 원문 블록, 인라인은 원문 원자 노드(이미지, 인라인 HTML).
- 범위 밖: 표 편집, 코드 블록 편집, 이미지 편집, 중첩 컨테이너 편집, 협업, 가상 스크롤. 이것들은 원문으로 보존될 뿐 편집 대상이 아니다.
- 입력 문법 열은 core의 입력 규칙(5-5)이 구현한다. 키 입력을 받아 규칙을 실행하는 것은 view 층이다.

---

## 4. 아키텍처

### 4-1. 모듈 분할 기준

1. **무엇에 의존하는가.** `core`는 아무것에도 의존하지 않는다(DOM, React, 전역 객체 금지). `view`는 `core`와 DOM에 의존한다. `react`는 `editor`와 React에 의존한다. import 문만 보고 판정할 수 있다.
2. **무엇을 소유하는가.** 모듈은 데이터 하나와 그 불변식, 또는 경계 하나를 소유한다. 책임을 **"그리고" 없이** 한 문장으로 쓸 수 있어야 한다.

- 코드의 종류로 나누지 않는다(`types/`, `utils/`, `constants/`, `helpers/`, `hooks/` 금지). 타입은 그 불변식을 지키는 함수와 같은 모듈에 둔다.
- 모듈 내부의 파일 분할은 자유다. 다른 모듈은 해당 모듈의 `index.ts`만 import하고, 타입은 `import type`으로 가져온다.
- 예외: 도메인과 무관한 언어 보조 함수(`assertNever`, 정규식 이스케이프)는 `core/lang/`에 둔다.

### 4-2. 모듈 구조

```
src/
  index.ts              패키지 엔트리 `.`
  core/                 의존: 없음
    lang/               도메인과 무관한 언어 보조 함수를 제공한다
    model/              문서의 구조와 불변식을 정의한다
    transform/          문서를 바꾸는 원자적 변경 단위를 정의한다
    state/              에디터의 현재 상태를 표현한다
    history/            되돌리기 단위를 관리한다
    formats/            지원하는 서식을 선언한다
    queries/            상태에서 값을 계산한다
    commands/           사용자 의도를 트랜잭션으로 바꾼다
    input-rules/        입력된 텍스트 패턴을 트랜잭션으로 바꾼다
    markdown/           마크다운의 해석을 소유한다(문서와 마크다운의 변환, 원문 조각의 렌더링)
    html/               문서를 HTML 문자열로 출력한다
    json/               문서를 저장용 JSON으로 변환한다
    url-policy/         링크 주소를 출력해도 되는지 판정한다
    index.ts            공개 엔트리 `./core`
    internal.ts         에디터 자신의 층 전용 진입점(패키지 엔트리 아님)
  editor.ts             Viewer를 조립하고 인스턴스 id 카운터를 관리한다
  view/                 의존: core와 DOM
    render/             문서를 DOM 노드로 서술하고 적용한다
      describe.ts       상태 → DomNode 서술 (순수)
      patch.ts          Renderer: 서술을 실제 DOM에 적용한다
      sanitize.ts       원문 HTML을 허용 목록으로 재구성한다
    view.ts             ReadonlyView: mount·show·configure·destroy
  react/                의존: editor와 React
    viewer.tsx          MdViewer React 컴포넌트
  index.ts              패키지 엔트리 `.` ("use client")
```

- 쓰기(상태 → 트랜잭션)는 `commands`, 읽기(상태 → 값)는 `queries`가 맡는다.
- 아직 없는 층(editor.ts 풀버전, view/selection·input·composition·clipboard·guard, react/editor, styles)의 구조는 9절.

### 4-3. 경계 강제

- dependency-cruiser(`.dependency-cruiser.mjs`)가 CI에서 의존 방향을 검사한다. 테스트 코드도 같은 규칙을 따른다.
  - core 모듈별 허용 import 표(`CORE_MODULES`)가 의존 다이어그램이다. 새 모듈은 행을 추가한다.
  - 다른 모듈은 `index.ts`로만 import한다(테스트는 `*.test-support.ts`도 허용). 운영 코드는 테스트 보조 파일을 import하지 않는다.
  - core는 core 밖, Node 내장 모듈, 허용 목록 외 npm 패키지를 import하지 않는다. 파서 패키지는 `core/markdown`에서만 쓴다.
  - view는 core를 `core/index.ts`와 `core/internal.ts`로만 쓰고, React를 import하지 않는다. react는 view를 직접 import하지 않고 editor를 통한다.
  - 순환 import 금지.
- core 전용 tsconfig는 `lib`에서 DOM을 뺀다(`"lib": ["ES2022"]`, `"types": []`).
- 여러 모듈을 함께 검사하는 테스트는 `src/core/` 바로 아래에 둔다. 모델만 의존하는 공통 테스트 보조 함수는 `core/model/*.test-support.ts`에 둔다.

### 4-4. 수평 분할과 서식 추가

서식 하나를 추가하면 지금은 `model`, `formats`, `input-rules`, `markdown`, `html`을 고치고, view 층이 생기면 `view/render`, `view/clipboard`, CSS도 고친다. 각 경계가 그 서식의 표현을 알아야 하므로 이 범위는 본질적이다. 대신 모든 경계를 망라적 `switch`로 작성해, 처리하지 않은 경계가 컴파일 에러로 드러나게 한다. 서식별 수직 분할(Tiptap extension 방식)은 사용자 정의 서식을 지원할 때 검토한다. 그 전환이 가능하도록 서식 정의는 데이터로 유지한다.

---

## 5. core (구현됨)

### 5-1. model

```ts
type Mark =
  | { type: 'link'; href: string; title?: string }
  | { type: 'strike' }
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'code' };
type TextRun = { type: 'text'; text: string; marks: readonly Mark[] };
type InlineAtom = { type: 'raw'; source: string; marks: readonly Mark[] }; // 이미지, 인라인 HTML
type Inline = TextRun | InlineAtom;

type Block =
  | { id; type: 'paragraph'; content: readonly Inline[] }
  | { id; type: 'heading'; level: HeadingLevel; content }
  | { id; type: 'quote'; content }
  | { id; type: 'bullet'; indent: number; content }
  | { id; type: 'ordered'; indent: number; start?: number; content }
  | { id; type: 'divider' }
  | { id; type: 'raw'; source: string }; // 코드 블록, HTML 블록, 링크 정의 등

type Doc = { blocks: readonly Block[] };
type Fragment = readonly Block[];
type Pos = { blockId: string; offset: number };
```

- 마크다운 기호는 모델에 저장하지 않는다. 오프셋은 텍스트의 UTF-16 코드 유닛 수에 원자 노드마다 1을 더한 값이다.
- 제목 단계 수의 원천은 `HeadingLevel` 타입 하나다. `HEADING_LEVELS`, `FORMATS`의 제목 항목, 입력 규칙, 마크다운 문법이 모두 이 타입에서 파생한다.
- 마크는 고정 순서(link, strike, bold, italic, code)로 정렬한다. 링크가 가장 바깥이다. 두 마크는 모든 속성이 같을 때 같다. 한 구간에는 같은 종류의 마크가 하나만 온다(먼저 온 것이 남는다).
- 원자 노드는 오프셋 1칸을 차지하고, 안을 편집할 수 없으며, 입력 규칙의 대상이 아니다. `code`를 제외한 마크를 가질 수 있다(코드 스팬은 원자를 담을 수 없다).
- 원문 블록은 통째로만 삭제, 복사, 이동한다. 원문 문자열에는 줄바꿈이 올 수 있다.
- 순서 목록의 번호는 저장하지 않고 `listNumbers`로 파생한다. 같은 깊이의 순서 항목은 run을 이루고, run은 목록이 아닌 블록, 같은 깊이의 글머리, 더 얕은 항목에서 끝난다. 더 깊은 항목은 run을 끊지 않는다. `start`는 run의 첫 항목에만 있고 1이 아니다. 범위는 0~999,999,999(`MAX_ORDERED_START`)다.
- 블록 id를 만드는 core 함수는 id 생성 함수(`() => string`)를 인자로 받는다. core는 전역 난수에 의존하지 않는다(`randomUUID`를 쓰지 않는다). `parseMarkdown`과 `fromJSON`에서는 선택 인자이고, 기본값은 호출마다 새로 만드는 카운터(`idCounter()`: `b0`, `b1` …)다. id는 세션 안에서만 의미가 있으며 저장하지 않는다.

**불변식**

- 원문 블록을 제외한 모든 블록의 텍스트에는 줄바꿈 문자가 없다.
- 블록 id는 비어 있지 않고 문서 안에서 고유하다.
- 목록은 평평하게 저장한 트리다. 루트가 아닌 항목은 부모(바로 앞의 한 단계 얕은 목록 항목)가 있어야 한다. 따라서 항목은 바로 앞 목록 항목보다 최대 한 단계만 깊고, 목록이 아닌 블록 다음의 첫 항목은 루트다(근거는 마크다운 제약이 아니라 트리 구조다).
- run의 첫 항목만 `start`를 가진다.
- 문서는 블록을 하나 이상 가진다. 내용(run)은 정규화되어 있다: 빈 텍스트 run 없음, 마크 정렬, 마크가 같은 인접 텍스트 run 병합, 원자에 `code` 없음.
- **불변식은 명령이 진입점에서 지킨다**: 텍스트 입력의 줄바꿈은 블록 분할로, 조각 삽입은 정규화 후 항상 새 id 발급으로 처리한다. `normalizeDoc`은 외부 입력 경계(파싱, 붙여넣기, JSON 불러오기)의 안전망이다: 줄을 나누고, 중복·빈 id를 재발급하고(입력에 있는 모든 id를 피한다), 목록을 복구한다. 모든 명령의 결과에 대해 `normalizeDoc(result) === result`다.

### 5-2. formats

`FORMATS` 테이블이 서식 목록의 유일한 원천이다(bold, italic, strike, code는 `mark`, heading1~4·quote·bullet·ordered는 `block`, divider는 `insert`). 마크 서식은 토글할 마크 객체를 값으로 가진다(`mark: { type: 'bold' }`). 링크에는 서식이 없다. 제목 항목은 `HeadingLevel`로 타입 검사되어, 단계를 추가하면 해당 서식이 생길 때까지 컴파일되지 않는다. 단축키도 이 테이블의 데이터다. `isFormat`은 이 테이블의 키에서 파생한 타입 가드다.

### 5-3. transform, state, history

- `Step`은 판별 유니온이다. 적용은 순수 함수이고 바뀐 블록만 새 객체로 만든다(구조적 공유, 렌더러는 참조 비교로 변경을 감지한다). 모든 Step은 역 Step을 만들 수 있다.
- **변경 엔진**: Step은 `replaceText`(블록 하나의 텍스트), `replaceBlocks`(블록 범위 교체: 삽입·삭제·분할·병합), `addMark`/`removeMark`, `setBlockKind`(범위)다. 범위 Step(범위 교체, 범위 마크 추가·제거, 범위 블록 속성 변경)으로 범위 명령의 Step 수를 블록 수와 무관하게 한다. 트랜잭션 하나를 적용할 때 블록 배열은 한 번만 복사한다. 블록 위치는 선형 탐색으로 찾는다(Step 하나가 조회하는 블록은 한두 개이고, 2만 블록에서 id 색인 생성 1.7ms 대 탐색 0.1ms로 측정, 4단계). Step 적용 결과는 `{ doc, inverse }`이며, 트랜잭션은 만들어지는 동안 결과 문서와 역 Step을 축적한다. 상태 반영은 그 결과 문서를, 히스토리는 축적된 역 Step을 쓴다(Step 적용은 한 번). 목록 복구는 명령 종료 후 전체 순회가 아니라 Step 적용 시 변경 범위(바뀐 블록과 뒤따르는 같은 목록 run)의 국소 복구로 한다.
- 트랜잭션: `before`(만든 기준 문서), `doc`(결과), `steps`, `inverse`, `selection`, `storedMarks`, `origin`(`typing | input-rule | command | paste | cut | drop | composition | selection | undo | redo`), `time`(이벤트 시각, view가 `event.timeStamp`로 채운다. 없으면 `null`). `origin`은 망라적으로 처리한다. 다른 문서에 적용하면 `TransactionError`.
- **셀렉션**은 판별 유니온이다: `text`(`anchor`, `focus`, 두 위치 모두 텍스트 블록 안), `block`(텍스트가 없는 블록, 즉 구분선이나 원문 블록 자체), `gap`(`beforeBlockId`, 끝은 `null`. 텍스트 블록이 인접하지 않은 자리, 즉 텍스트 없는 블록 사이나 문서 양 끝의 텍스트 없는 블록 바깥에서만 유효). 상태에는 유효한 셀렉션만 있다. `normalizeSelection`이 바깥에서 온 셀렉션을 가장 가까운 유효한 것으로 바꾼다: 텍스트 없는 블록 위의 위치는 다른 끝 쪽의 가장 가까운 텍스트로, 그런 블록 위의 커서나 텍스트가 없는 범위는 블록 셀렉션으로, 텍스트 블록의 블록 셀렉션은 그 시작의 커서로, 텍스트 블록 옆의 gap은 그 블록의 커서로, 없는 블록을 가리키면 문서 시작으로. `selectionTransaction`이 이를 적용한다. 블록을 넣거나 지운 뒤의 셀렉션은 `selectionBetween`(앞 텍스트 블록의 끝, 아니면 뒤 텍스트 블록의 시작, 아니면 gap)으로 정하므로, 커서 자리를 만들려고 빈 문단을 추가하지 않는다. 문서 시작(`startSelection`)은 첫 블록의 커서, 첫 블록에 텍스트가 없으면 그 앞 gap.
- **history**: 브라우저 네이티브 undo는 쓰지 않는다. 문서를 바꾸는 트랜잭션을 역 Step으로 기록한다. `input-rule`은 항상 독립 단위다. 타이핑 묶음(typing, composition)은 다음에서 끊는다: 공백이나 문장 부호 다음에 단어 문자가 입력될 때, 직전 입력과의 간격이 기준(기본 500ms)을 넘을 때(시각은 view가 메타데이터로 넘기며 core는 시계를 읽지 않는다), 선택 영역이 있는 상태에서 입력할 때, 셀렉션이 실제로 이동할 때, 다른 출처의 트랜잭션이 끼어들 때. 묶음 합치기는 키 입력당 상수 시간이고(인접 텍스트 삽입 Step 병합), 깊이 상한은 기본 100(설정 가능)이다. 직전 트랜잭션의 출처를 조회할 수 있다.

### 5-4. queries, commands

- **서식 상태** `formatStates(state)`: 셀렉션 범위를 한 번 훑어 모든 서식의 `{ active, applicable }`을 조회하는 함수를 돌려준다. 공통 마크가 하나도 없고 블록 타입도 섞였으면 그 자리에서 멈춘다. `mark`는 선택 범위의 모든 글자(원자 포함)에 그 마크가 있으면 on(커서면 `storedMarks`, 없으면 `marksAt`), `block`은 선택에 걸친 모든 텍스트 블록이 그 타입(제목은 단계까지)이면 on(`indent`는 비교하지 않음, 텍스트 없는 블록은 건너뜀), `insert`는 항상 off. 블록 셀렉션과 gap에서는 마크·블록 서식이 off이고 적용할 수 없으며, 삽입 서식만 적용할 수 있다. `isActive`와 `activeMarks`는 이 요약을 쓴다.
- **셀렉션 종류별 명령**(모든 명령이 망라적으로 처리): `block`에서 텍스트 입력과 Enter는 그 블록 다음에 문단을 만들고, Backspace·Delete(`deleteSelectedBlock`)는 블록을 지운다(문서의 마지막 블록이면 빈 문단이 대신한다). `gap`에서 텍스트 입력과 Enter는 그 자리에 새 문단을, Backspace·Delete(`selectBlockBackward`, `selectBlockForward`)는 이웃 블록을 블록 셀렉션으로 선택한다. 두 종류 모두에서 마크·블록 서식 토글과 Tab은 `null`이고, 구분선 삽입과 붙여넣기는 그 블록 다음이나 gap 자리에 들어간다. 텍스트 블록의 시작에서 Backspace, 끝에서 Delete를 누를 때 이웃이 텍스트 없는 블록이면 지우지 않고 선택한다(한 번의 키로 표나 코드 블록이 보이지 않게 지워지지 않도록). 단, 커서가 있는 텍스트 블록이 비어 있으면 잃을 내용이 없으므로 그 빈 블록을 지우고 이웃을 선택한다(Backspace는 앞, Delete는 뒤).
- **방향키** `arrowSelection(state, 'backward' | 'forward')`: 텍스트 없는 블록을 넘는 가로 이동만 정하고, 나머지는 `null`(브라우저의 커서 이동). 텍스트 블록 가장자리의 커서에서 텍스트 없는 이웃으로는 그 블록 선택, 선택된 블록에서는 옆 텍스트 블록의 가까운 끝, 없으면 옆 gap, gap에서는 옆 블록 선택.
- 명령의 시그니처는 `(state, input, env) => Transaction | null`이다. `env`는 `createId`(와 history가 필요한 명령은 `history`)를 담는다. `null`은 "이 상황에 적용되지 않음"이다. **상태(문서, 셀렉션, `storedMarks`)를 바꾸지 않는 명령은 빈 트랜잭션이 아니라 `null`을 돌려준다.** 모든 명령은 `finish`에서 끝나고 `finish`가 `changesNothing`으로 판정한다. 아무것도 바꾸지 않는 Step은 기록하지 않는다.
- 서식 토글, `insertText`(줄바꿈이 있으면 블록 분할), `deleteTargetRange`(view가 `getTargetRanges()`로 넘긴 범위), 블록 구조 명령(`exitEmptyBlock`, `splitBlock`, `outdentListAtStart`, `resetBlockAtStart`, `joinBackward`, `joinForward`, `indentList`, `outdentList`), `insertFragment`(붙여넣기·드롭 공통, 하나의 트랜잭션)의 규칙은 각 함수의 TSDoc에 있다.
- 목록의 Tab(D5): 들여쓰기할 수 있으면 들여쓰고, 불가능하면 `null`이라 Tab을 소비하지 않는다(Shift-Tab도 같다). Esc 직후의 Tab은 항상 포커스를 이동시킨다(view 층, 9절).

### 5-5. input-rules

- 규칙은 데이터로 선언하고 적용기는 하나다. 블록 규칙(문단에서 블록 시작부터 커서까지 전체가 일치)과 인라인 규칙(커서 앞에서 끝나는 패턴, 처음 일치한 규칙만)은 모두 `MARKDOWN_SYNTAX` 테이블에서 파생한다.
- 인라인 규칙은 마크 서식마다 하나이며, 코드가 먼저, 그다음 긴 구분 기호 순이다. 다른 마크의 더 긴 구분 기호의 접두사인 구분 기호(`*`는 `**`의 접두사)는 같은 문자 직후에 발동하지 않는다. 일치 범위에 `code`가 섞이면 다른 인라인 규칙은 적용하지 않는다. 규칙은 원자 노드를 넘어가지 않는다.
- 인라인 규칙 적용 후 `storedMarks`는 "직전 글자의 마크에서 방금 적용한 마크만 뺀 것"이다(기울임 안에서 `**굵게**`를 쳐도 기울임이 유지되도록).
- 마크 정의(`model/types.ts`의 `MARK_SPECS`)가 경계 확장 여부(`inclusive`, code와 link는 false)를 데이터로 선언하고 앞 글자 마크 상속(`marksAt`)이 이를 따른다. inclusive가 아닌 마크는 그 끝에서 입력하면 상속하지 않고, 안쪽(뒤 글자도 그 마크)에서 입력하면 상속한다.
- 목록 마커는 문법 테이블의 `-`, `*`, `+`, `N.`, `N)`을 쓴다. 새 run을 시작하는 순서 목록 입력은 숫자를 `start`로 저장하고(1은 기본값이라 저장하지 않음), 기존 run에 이어지면 무시한다.
- `undoInputRule`: 직전 트랜잭션의 출처가 `input-rule`이고 셀렉션이 그대로일 때만 되돌린다.
- 충돌을 테스트로 고정한다: `**굵게*`에서 기울임 미발동, `- `와 `---` 무간섭, `--` 미발동, `* `와 기울임 무충돌.

### 5-6. markdown

공개 문서 [docs/markdown.md](../markdown.md)가 무엇이 보존되고 무엇이 바뀌는지의 전체 목록이다. 이 절은 그 근거와 구현 규칙이다.

- 파싱: `mdast-util-from-markdown` + GFM 취소선·표·작업 목록·각주. 표·작업 목록·각주는 소프트 줄바꿈 합치기가 GitHub에서 그 구조를 깨지 않도록 인식만 하고 원문 블록으로 보존한다. 외부 의존성은 이 모듈에만 허용한다.
- **문법 기호의 단일 원천**: `MARKDOWN_SYNTAX`(제목·인용 마커, 목록 마커, 구분선, 마크별 구분 기호와 대체 기호, 링크 괄호)와 `HTML_BLOCK_STARTS`(CommonMark HTML 블록 시작 조건 7종). 직렬화기, 이스케이프, 입력 규칙, 파서의 HTML 블록 닫기, canonical이 모두 여기서 파생한다.
- **파싱(D2)**: mdast 노드 타입에 대한 망라적 매핑 테이블(`FLOW`, `INLINE`)로 한다. 규칙이 `null`이면 그 최상위 노드는 원문 블록이 된다.
  - 소프트 줄바꿈은 공백 하나로 이어 한 블록. 강제 줄바꿈은 블록 분할(외부 경로 예외). 공백만 있는 줄은 빈 블록.
  - 링크와 참조 링크는 링크 마크(참조 링크는 정의의 주소, 첫 정의 우선). 텍스트 없는 링크, 이미지, 인라인 HTML, 각주 참조는 원자 노드.
  - 같은 마크가 중첩된 내용(`_*a*_`)은 그 블록 전체가 원문 블록(원자로 떼면 구분 기호 묶음이 잘려 해석이 바뀐다).
  - 문단만 담은 인용은 문단마다 인용 블록(D4). 목록은 모든 항목이 "한 줄(문단 또는 한 줄짜리 HTML 블록) + 중첩 목록"이고 깊이 `MAX_INDENT` 이하이며 작업 목록이 아닐 때만 목록 블록. 제목 1~4.
  - 그 밖의 최상위 노드는 원문 블록: 코드 블록(들여쓴 코드는 펜스로 바꿈), HTML 블록(주석 포함), 표, 정의, 각주 정의, 제목 5~~6, 표현할 수 없는 인용·목록. 원문은 첫 줄 맨 앞부터 잡고(펜스 들여쓰기 보존), 문서 끝에서 열린 채 남은 펜스와 HTML 블록(1~~5종)은 닫는다.
- **직렬화(D3, D4)**: HTML을 쓰지 않는다. 글머리 `-`, 강조 `*`/`**`, 구분선 `---`. 연속 목록 항목 사이는 줄바꿈 하나, 연속 인용 블록은 `>`만 있는 줄로 구분한 하나의 인용, 나머지 블록 사이는 빈 줄(1이 아닌 번호로 시작하는 run이 항목 텍스트 바로 뒤에 오면 빈 줄). 빈 블록은 `&nbsp;`(목록은 마커 뒤, 제목과 혼자인 인용은 빈 마커). 중첩 목록은 부모 마커 폭만큼 들여쓰고, 원문 목록과 붙는 목록 run은 다른 마커 문자(`*`, `+`, `)`)를 쓴다. 특수 문자·줄 맨 앞 블록 문법은 이스케이프하고, 블록 앞뒤 공백·탭은 문자 참조로 쓴다. 링크 주소는 필요하면 `<…>`, 제어 문자는 문자 참조, 링크 앞 `!`는 이스케이프. 원문 블록과 원자 노드는 그대로 쓴다.
- **마크의 중첩**: 같은 곳에서 시작하는 마크 중 더 오래 이어지는 것이 바깥이다(같으면 `MARK_TYPES` 순서). 겹치는 마크는 나뉜다.
- **flanking(D3)**: 코드 유닛 기준과 코드 포인트 기준(CommonMark 0.31) 둘 다에서 구분 기호가 읽혀야 한다. 읽히지 않으면 구분 기호 바깥에 붙은 글자를 숫자 문자 참조로 쓴다(`**"인용"**&#51008;`). 앞 span의 닫는 기호나 원자 원문의 가장자리와 같은 문자로 이어지면 대체 구분 기호(`_`, `__`)를 쓰고 `_`의 더 엄격한 규칙을 지킨다. 문자 참조가 앞서 정한 span의 판정을 바꿀 수 있으므로 변화가 없을 때까지 반복한다.
- **왕복 불변식**: 모든 문서에 대해 `parse(serialize(doc))`는 `canonical(doc)`과 같다(id 제외). 속성 테스트 4종으로 검증한다.
- **canonical 예외**:

  | 모델                                                            | 마크다운에 남는 것             |
  | --------------------------------------------------------------- | ------------------------------ |
  | 굵게·기울임·취소선이 직렬화되는 span의 가장자리 공백에 걸림     | 공백은 남고 마크만 빠짐        |
  | 공백(U+00A0 포함)만 있는 블록 텍스트                            | 빈 블록                        |
  | NUL (텍스트, 링크 주소·제목, 원자, 원문 블록)                   | U+FFFD                         |
  | 줄 맨 앞 링크 안 코드에 `]` 바로 뒤 `:`                         | 텍스트는 남고 code 마크만 빠짐 |
  | 문단·인용의 줄이 HTML 블록 시작 조건을 만족                     | 그 줄을 담은 원문 블록         |
  | 목록 항목의 줄이 HTML 블록 시작 조건을 만족                     | 그 줄 전체를 담은 원자 하나    |
  | 마크다운에서 하나로 읽히는 인접 원문 블록                       | 원문 블록 하나                 |
  | 줄을 넘어 이어지는 HTML 블록으로 시작하는 항목 아래의 하위 항목 | 목록 전체를 담은 원문 블록     |

- **외부 마크다운 계약** (f = serialize ∘ parse, `test/markdown-contract`): 멱등성 f(f(md)) = f(md), 의미 보존(render(md)와 render(f(md))가 정규화 후 같음). 렌더러는 micromark(HTML 허용, GFM)와 markdown-it 기본값(HTML 금지). 입력은 CommonMark 명세 예제 전체, 실제 README, 무작위 마크다운(CI는 고정 시드). 정규화로 허용하는 차이는 공개 문서의 외부 경로 예외(강제 줄바꿈 분할, 소프트 줄바꿈 합침, loose→tight, 인접한 같은 종류 목록·인용 합침, 같은 텍스트를 덮는 서식의 중첩 순서와 분할 위치, 같은 주소의 인접 링크 합침, 다른 표기법의 정규화)와 canonical 예외뿐이다. 사용자 HTML이 든 입력은 HTML 허용 렌더러로만, 두 렌더러가 원문을 다르게 읽는 입력은 멱등성만 검사한다.
- 남은 실패는 `core/markdown/known-gaps.test.ts`의 `test.fails`가 체크리스트다.

### 5-7. html

텍스트는 항상 이스케이프한다. 평평한 목록 블록은 중첩 `ul`/`ol`로, 깊이 1·2의 순서 목록은 `type="a"`·`type="i"`, `start`는 `start` 속성으로 쓴다. 링크는 `a`이고 `href`는 `url-policy`가 허용할 때만 쓴다. 원문 노드(원문 블록, 원자)는 `core/markdown`의 `rawRenderer`가 micromark 기본 설정(`allowDangerousHtml: false`, `allowDangerousProtocol: false`, GFM 표·작업 목록·취소선)으로 렌더링한다. 조각마다 문서의 링크 정의(원문 블록)를 앞에 붙여 렌더링해 참조 링크·이미지가 풀린다(정의는 아무것도 출력하지 않는다). 각주는 참조와 정의가 페이지 끝의 섹션 하나를 이루므로 조각 단위로 렌더링할 수 없어, 각주가 든 조각은 쓰인 그대로 이스케이프한 텍스트로 쓴다. `serializeHtml(blocks, { allowDangerousHtml: true })`는 문서의 HTML을 그대로 쓰며, 소독 책임이 사용처에 있음을 TSDoc과 공개 문서에 명시한다.

### 5-8. url-policy

링크 주소를 출력해도 되는지 판정한다(`isSafeHref`). 허용: http, https, mailto, 스킴 없는 상대 주소. 브라우저처럼 탭·줄바꿈을 지우고 앞쪽 제어 문자·공백을 건너뛴 뒤 스킴을 읽는다. 원래 주소는 모델에 그대로 남는다. `./core` 공개 목록에는 없고 `core/internal.ts`로만 제공한다.

### 5-9. json (저장 형식)

`{ schemaVersion: 1, doc: { blocks } }`. 블록 id는 저장하지 않고, 불러올 때 `createId`(기본값은 새 카운터)로 새로 발급한다(`id` 필드가 있으면 무시). 버전별 마이그레이션 함수 테이블(`MIGRATIONS[i]`는 버전 i+1 → i+2)을 거쳐 현재 버전으로 올린 뒤, 모든 필드를 검사하고(검사기는 모델 유니온을 키로 하는 테이블) `normalizeDoc`한다. 알 수 없거나 더 새로운 버전, 잘못된 필드는 경로가 담긴 `SchemaError`로 거부한다. `Doc`의 모양이 바뀌면 버전을 올리고 마이그레이션을 추가한다.

### 5-10. view/render와 읽기 전용 뷰 (구현됨)

**render 모듈** (`src/view/render/`)

- `describe(state, ctx)`: 상태와 렌더 컨텍스트(`classNames`, `placeholder`, `raw: RawRenderer`)를 받아 `Description { blocks: BlockDescription[], gap }`을 반환하는 순수 함수. `describeBlock`이 블록 하나를 `BlockDescription { blockId, node: DomNode, slots }`으로 서술한다. `DomNode`는 `element | text | html` 판별 유니온이다.
- 태그: `p`, `h1`–`h4`, `blockquote`, `div`(목록), `hr`, `div`(원문 블록). 속성: `data-block-id`, `data-type`, `data-level`, `data-indent`, `data-empty`, `data-selected`, `data-placeholder`, `style="--md-start: N"`. 링크 `href`는 `isSafeHref` 통과 시만. 편집 불가 노드에 `contenteditable="false"`. 빈 블록은 `<br>`. 원자는 `span[data-atom][contenteditable=false]`.
- **원문 노드 표시**: `describe`는 `rawRenderer`가 만든 HTML 문자열을 `DomNode { kind: 'html', html }` 안에 담는다. `patch`가 `DOMParser`로 그 문자열을 읽어, 허용 목록(`sanitize.ts`)에 있는 요소와 속성만 `createElement`로 다시 만든다. `innerHTML`은 쓰지 않는다. 이미지 `src`와 링크 `href`는 URL 정책(`isSafeHref`)을 통과할 때만 쓴다. 원문 노드는 계속 편집 불가능하다.
- `sanitize(html, document)`: `DOMParser`로 파싱하고 허용 목록(`ALLOWED`)에 없는 요소는 콘텐츠를 유지하며 제거, 없는 속성은 드롭, 스크립트 계열(`script`, `style`, `template`, `noscript`)은 콘텐츠째 제거한다. 새 엘리먼트만 `DocumentFragment`에 담아 반환.
- `Renderer`: `render(state, ctx)` — 블록 id 키 재조정. 블록 객체 참조, 장식, 슬롯의 클래스 이름이 모두 같으면 재사용, 태그가 바뀌면 새 엘리먼트. 갭 위젯(`div[data-gap][contenteditable=false]`)은 gap 셀렉션 위치에 삽입. `#arrange`로 최소 이동 재정렬.
- `RawSource`: 원문 블록이 바뀔 때만 `rawRenderer`를 새로 만든다. 바뀌지 않으면 동일 참조를 반환해 불필요한 재렌더를 막는다.
- `MdSlot`: 블록 타입(heading1–4 포함)과 마크 타입, `atom`. `MdClassNames { [slot]?: string }`.

**읽기 전용 뷰** (`src/view/view.ts`, `src/editor.ts`, `src/react/viewer.tsx`)

- `createReadonlyView(options?)`: `ReadonlyView { mount, show, configure, destroy }`. `mount`는 루트 엘리먼트를 소유하고 `Renderer`를 만든다. `show`는 상태를 받아 그린다. `configure`는 `classNames`, `placeholder`를 받아 다시 그린다. `destroy`는 루트를 비운다.
- `createViewer(options?)`: `editor.ts`에서 `ReadonlyView`를 싸고, 인스턴스별 id 카운터로 `parseMarkdown`·`fromJSON`을 호출하는 `Viewer { mount, show(DocumentSource), configure, destroy }`.
- `MdViewer`: React 함수 컴포넌트. `useState` 지연 초기화로 viewer 인스턴스를 하나 만든다. `useEffect`로 `mount`/`destroy`(의존성 `[viewer]`), `show`(의존성 `[viewer, markdown, json]`), `configure`(의존성 `[viewer, classNames]`)를 동기화한다. `json`, `markdown` 외의 `div` props를 컨테이너에 그대로 전달한다. SSR에서는 빈 `div`를 렌더링하고, mount 후에 내용을 채운다.
- **`"use client"` 보장**: 빌드 시 tsup `onSuccess`가 `dist/index.js` 맨 앞에 `'use client';`를 붙인다(rollup이 소스의 지시어를 제거하므로). `dist/core.js`에는 붙지 않는다.

---

## 6. 코드 작성 규칙

- TypeScript `strict`, `noUncheckedIndexedAccess`. `any`, 타입 단언(`as const` 제외), non-null 단언 금지(lint로 강제).
- 모든 분류는 망라적 `switch`와 `assertNever`로 쓴다(lint `switch-exhaustiveness-check`로 강제). 한 가지 경우를 묻는 비교(`type === 'paragraph'`)는 허용하고, 나머지 경우에 의미를 주는 분기는 분류로 보아 switch로 쓴다.
- 규칙(입력 규칙, 입력·키 바인딩, 붙여넣기 매핑, 서식, 마크다운 문법)은 데이터로 선언하고 해석 함수는 하나만 둔다.
- 금지: `execCommand`, `queryCommandState`, 사용자 콘텐츠에 대한 `innerHTML`/`outerHTML`/`insertAdjacentHTML`, 커서·DOM 상태용 `setTimeout`/`requestAnimationFrame`, `MutationObserver`를 주 입력 경로로 쓰는 것, 렌더링·이벤트 핸들러에서 레이아웃 강제 읽기(`offsetHeight`, `getBoundingClientRect`, `getComputedStyle`, `innerText`), 모듈 수준 가변 상태, 코드 종류별 폴더, 필요 없는 추상화와 제네릭.
- 명령형 DOM 코드는 `view/` 안에만 둔다.
- React(층이 생기면 적용): `useMemo`·`useCallback`·`React.memo`는 (1) 정확성 요구(안정적인 참조를 요구하는 외부 API, 의존성 배열 등) 또는 (2) 측정으로 확인된 성능 문제가 있을 때만 쓰고, 어느 경우든 근거(이유 또는 측정 수치)를 주석으로 남긴다. `useEffect`는 외부 시스템 동기화에만 쓰고, 파생 값은 상태로 저장하지 않는다.

## 7. 테스트

- **경계**: 의존 규칙(`check:deps`)과 core tsconfig를 CI에서 검사한다. 죽은 코드는 `check:unused`(knip).
- **core** (DOM 없음, `src/core/**/*.test.ts`): 정규화와 `slice`, 모든 Step과 역 Step, 모든 query·command와 명령 체인 순서, 입력 규칙(충돌 포함)과 `undoInputRule`, history 묶음 규칙, `insertFragment`, 마크다운 왕복 속성 테스트 4종, 직렬화 함정, HTML 출력, JSON, url-policy. 명령 불변식 속성 테스트(무작위 문서와 행동 시퀀스에서 `normalizeDoc(result) === result`, 셀렉션 유효, 줄바꿈 없음, id 고유, 역 Step 복원, 적용된 명령은 상태를 바꿈, 모든 Step은 문서를 바꿈). 생성기는 줄바꿈과 중복 id를 포함한 입력을 만든다. 실패가 예상되는 동작은 `test.fails`로 기록한다.
- **외부 마크다운 계약** (`test/markdown-contract`, 5-6), **공개 export 이름** (`test/public-api`).
- **패키지**: `check:exports`(publint, attw), `check:package`(tarball을 설치해 두 엔트리를 import하고 번들러로 빌드), `check:size`(2절).
- **DOM** (jsdom, `src/view/**/*.test.{ts,tsx}`, `src/react/**/*.test.tsx`): `describe` 블록 태그·속성·마크·href 정책·원자·원문·플레이스홀더·블록 셀렉션·갭·슬롯. `patch` 노드 유지·재정렬·삭제·태그 변경·슬롯 변경·원문 렌더러 교체. `sanitize` 스크립트·onclick·javascript: href·img src·알 수 없는 태그. `MdViewer` 렌더링·prop 변경·Strict Mode.
- **성능**: `npm run bench`(CI 게이트 아님).
- 브라우저(Playwright)·IME·예제 앱 테스트는 input 단계와 함께 생긴다(9절).

---

## 8. 작업 계획과 진행 상태

### 8-1. 평가 문제 해결 계획

| 단계 | 내용                                                                    | 문제               | 상태                        |
| ---- | ----------------------------------------------------------------------- | ------------------ | --------------------------- |
| 0    | 경계 강제, 단일 원천, 배제 분류 제거                                    | 20, 21, 23, 24, 26 | 완료                        |
| 1    | 모델: 마크 객체, 원자·원문 블록, `start`, 줄바꿈·id 불변식, JSON 스키마 | 4, 14, 15, 16, 22  | 완료 (3단계 일부 선행 승인) |
| 2    | 변경 엔진과 히스토리, 국소 목록 복구                                    | 8~13, 30           | 완료                        |
| 3    | 마크다운 경계 (5-6)                                                     | 1~7                | 완료 (열린 갭 1건)          |
| 4    | 편집 동작: `inclusive`, 목록 마커, `null` 원칙, Esc → Tab               | 17~19              | 완료 (Esc → Tab은 view 5)   |
| 5    | 공개 API 축소, engines·CI 일치, `getMarkdown` 캐시, 성능 문서           | 25, 27~30          | 완료 (캐시는 editor 단계)   |
| 이후 | getHTML 원문 렌더링 (5-7)                                               | —                  | 완료                        |

### 8-2. view 구현 순서

view·React 단계의 작업 지시(별도 프롬프트)가 계획이다. 순서: 1. core 변경(셀렉션 3종, `isFormatApplicable`, 모든 서식의 활성 상태를 한 번에 계산하는 조회, 방향키 규칙) 2. render와 읽기 전용 모드, `MdViewer` 3. selection과 `selectionchange`, editor 구독 4. input 기본 입력과 갱신 사이클 5. 키 바인딩, 툴바(컴파운드 컴포넌트와 훅), Esc → Tab 6. composition 7. clipboard와 드래그 앤 드롭 8. guard와 개발 모드 일치 검사 9. CSS, 접근성 마무리, 패키징, 예제 앱, README 사용법 절

### 8-3. 보고 형식

단계마다 다음 단계 전에 보고한다: 구현 내용과 공개 API 변경, 명세가 정하지 않아 직접 정한 사항과 근거, 새로 추가되거나 바뀐 canonical 예외, (2·5단계) 개선 전후 벤치마크, 브라우저별 차이(view), 모듈별 책임 한 문장, 지키지 못한 요구사항과 선택지(우회 금지).

### 8-4. 배포 전 점검 목록

첫 배포 전에 모두 해결하거나, 해결하지 않기로 했다면 그 근거를 canonical 예외나 공개 문서에 적는다.

- [ ] `3) a\n</b>\n\n` 멱등성: 목록 항목 뒤에 닫는 태그만 있는 줄이 오면 문서 끝 빈 줄 유무에 따라 파서가 다르게 읽는다(`known-gaps.test.ts`의 `test.fails`). 원인을 고치거나, canonical 예외로 정의하고 `docs/markdown.md`에 적는다.
- [ ] engines 하한(`22.12.0`)에서 CI 테스트와 소비자 스모크 테스트가 통과하는지 첫 CI 실행에서 확인(로컬 미검증).
- [ ] 패키지 이름 확정. 확정 전에는 문서와 명령에 이름을 쓰지 않는다.
- [x] 옛 `src/` 구현 제거.
- [ ] React 층과 함께 되돌릴 것: `react` peer 의존성과 React 개발 의존성, CI의 React 18·19 매트릭스, 브라우저(e2e) CI 작업과 `e2e/` 테스트.

---

## 9. 구현 전 결정 (view, editor, react, CSS)

아직 구현되지 않은 층에 대해 이미 내린 결정이다. 사용법이 아니라 구현이 지킬 계약이며, 그 층을 구현할 때 본문으로 옮긴다. 자세한 작업 지시는 view·React 단계 프롬프트에 있고, 그것과 이 절이 충돌하면 이 절이 우선한다.

**사용처 API**

- 컴파운드 컴포넌트: `MdEditor`, `MdEditor.Toolbar`, `MdEditor.Button`, `MdEditor.Input`, 그리고 `MdViewer`, 훅 `useMdEditor()`, `useFormatActive(format)`. `MdEditor`는 에디터 인스턴스 하나를 컨텍스트로 제공하고, 밖에서 하위 컴포넌트나 훅을 쓰면 명확한 에러를 던진다.
- **비제어 API**다. `value`를 받는 제어 방식은 제공하지 않는다(키 입력마다 외부 값으로 재동기화하는 구조가 되므로). `defaultValue`(마크다운)와 `defaultJSON`은 둘 중 하나만 받고, 타입에서 동시 지정을 막는다.
- `onChange`는 문자열이 아니라 핸들(`MdEditorHandle`)을 받는다. 직렬화 시점은 사용처가 정한다(자주 필요하면 사용처가 디바운스).
- `MdEditorHandle`: `toggle(format)`, `focus()`, `getMarkdown()`, `getJSON()`, `getHTML(options?)`(`serializeHtml`, `allowDangerousHtml`은 소독 책임을 공개 문서에 명시). 참조가 바뀌지 않는 객체 하나이고, `getMarkdown()`은 문서 참조가 같으면 이전 결과를 돌려준다. `getJSON()`의 형식은 5-9절.
- `Button`의 서식 prop 이름은 `format`이다(네이티브 `type`과의 충돌 회피). `format`을 제외한 `<button>` 속성을 전달하고 항상 `type="button"`을 쓴다. `data-active`를 노출한다.
- 명령(`useMdEditor`)과 상태 조회(`useFormatActive`)를 나눈다. 핸들은 다시 렌더링을 일으키지 않고, 조회는 필요한 값만 구독한다.
- `isFormat`으로 바깥 문자열을 단언 없이 `Format`으로 좁힌다.
- 공개 타입: `Format`, `MdEditorHandle`, `MdJSON`, `MdThemeVars`, `MdSlot`, `MdClassNames`. `MdViewer`는 `markdown` 또는 `json`을 받고 에디터와 같은 렌더러를 쓴다(`MdViewer`는 구현됨, 5-10).
- import만으로 `window`/`document`에 접근하지 않는다.
- 한 페이지의 여러 에디터는 서로 독립적이다(모듈 수준 가변 상태 금지).

**구조**

- 층: `view/`(render, selection, input, composition, clipboard, guard, view.ts; 의존: core와 DOM), `editor.ts`(상태와 히스토리를 소유하고 core와 view를 조립), `react/`(의존: editor와 React), `styles/`(토큰 테이블, base.css, theme.css). 의존 규칙은 `.dependency-cruiser.mjs`에 이미 있다.
- view는 `Editor` 클래스가 아니라 최소 인터페이스(`EditorHost = { getState, dispatch }`, `EditorView = { mount, update(prev, next), focus, destroy }`)에만 의존한다. 명령형 DOM 코드는 `view/` 안에만 있고, DOM 쓰기는 `render/patch`와 `selection`만 한다. HTML **해석**(붙여넣기)은 DOM API가 필요하므로 `view/clipboard`에, `core/html`은 출력만.
- 갱신 사이클(동기, 단방향): 이벤트 → input이 명령 선택 → `host.dispatch(tr)` → editor가 적용·기록 → `view.update(prev, next)`: ① 바뀐 블록만 patch ② DOM 셀렉션이 다를 때만 갱신 ③ guard 기록 비우기(`takeRecords`) ④ 필요하면 커서를 화면 안으로 스크롤(레이아웃 읽기는 여기서만) → 구독자 통지. 자기 이벤트를 플래그로 거르지 않고 `selectionchange`는 멱등으로 처리한다. DOM은 모델의 투영이며 유일한 예외는 IME 조합이다.

**core 선행 작업** (구현됨, 5-3과 5-4로 옮김). view는 서식 상태를 상태 하나당 한 번(`formatStates`) 계산해 모든 구독자가 공유하고, 버튼마다 범위를 훑지 않는다.

**render·ReadonlyView·MdViewer** (구현됨, 5-10으로 옮김).

**view 모듈 (미구현)**

- selection: 모델↔DOM 변환(원자 1칸, 빈 블록 `<br>` 0칸, 원자 앞뒤는 `(부모, 자식 인덱스)`), `setBaseAndExtent()`로 방향 보존, 같으면 쓰지 않음, `getTargetRanges()`도 같은 함수, 레이아웃을 읽지 않음.
- input: 입력·키 바인딩은 데이터 테이블(단축키는 `FORMATS`에서), 체인은 처음 `null`이 아닌 결과를 dispatch. `beforeinput`은 허용 목록. 키 체인이 모두 `null`이면 `preventDefault()`하지 않음. `time`에 `event.timeStamp`. `isComposing` 중 `keydown` 무시, Enter는 `insertParagraph`. **Esc 직후 Tab은 포커스 이동(D5)**, `aria-describedby`로 안내. 편집 불가능한 요소 클릭은 블록 셀렉션. 링크는 일반 클릭으로 이동하지 않고 Mod+클릭은 허용 주소만 새 탭(`noopener noreferrer`). `focus()`는 `preventScroll` 후 셀렉션 복원.
- composition: `idle → composing(시작 셀렉션) → 회수 → idle`. 조합 중 대상 블록을 patch하지 않고 표시만, 회수는 공통 앞뒤를 잘라 `composition` 출처로 dispatch 후 입력 규칙 검사와 다시 그리기, `compositionend`와 마지막 `input` 양쪽에서 멱등, 조합 중 `selectionchange` 무시.
- clipboard: 붙여넣기는 전용 JSON → `text/html`(DOMParser로 분석, 매핑 테이블, 링크 보존, 이미지는 원자, 태그와 인라인 style) → `text/plain`(core 파서) 중 하나를 `insertFragment`로. 복사·잘라내기는 마크다운, `core/html`, 전용 JSON. 내부 드래그 이동은 한 트랜잭션, 외부 드롭은 붙여넣기 경로, 드롭 위치를 변환할 수 없으면 취소.
- guard: `MutationObserver`는 감지기로만. 렌더러가 만들지 않은 변경은 해당 블록을 다시 그림. 개발 빌드에서 DOM·셀렉션 일치 검사.

**editor, react, CSS, 접근성**

- editor: `createEditor(options)`는 `defaultValue`/`defaultJSON`으로 상태를 만들고, 인스턴스별 id 카운터를 만들어 `parseMarkdown`·`fromJSON`과 모든 명령에 넘기고(기본 카운터는 호출마다 `b0`부터라 쓰지 않는다), 상태·히스토리를 소유하고, 구독 인터페이스를 제공한다. DOM 없이 생성할 수 있고 view는 `mount` 때만 만든다.
- react: 인스턴스는 `useState` 지연 초기화, 컨텍스트에는 인스턴스만. `Input`은 자식 없는 `contentEditable` 하나를 렌더링하고 effect에서 mount/destroy(Strict Mode 안전). `Button`은 공유된 서식 상태로 `data-active`·`disabled`, `aria-pressed`는 `mark`·`block`일 때만, `mousedown` 기본 동작 막기, `click`에서 `toggle` 후 `focus`, 개발 빌드에서 접근 가능한 이름이 없으면 경고. 훅 규칙은 6절.
- CSS: 토큰 테이블 하나에서 `theme.css` 기본값과 `MdThemeVars`를 생성. `MdSlot`은 모델에서 타입으로 파생. `base.css`(필수, `:where()`), `theme.css`(선택, `var(--md-*, 기본값)`, 우선순위 (0,1,0), 연속 인용은 한 상자(D4)), 번호는 `listNumbers`와 일치. 엔트리 `./base.css`, `./theme.css`.
- 접근성: `Input`은 `role="textbox"`, `aria-multiline="true"`. `Toolbar`는 `role="toolbar"`와 roving tabindex. 블록 셀렉션과 gap 커서는 시각적으로 구별.
- 고정할 이름: `.`의 export, data 속성, 슬롯, CSS 변수(스냅샷 테스트, 변경은 breaking change).
- 테스트: 브라우저(Playwright 3종: DOM·상태 일치, 노드 유지, 셀렉션 매핑, inputType 차단, 붙여넣기 픽스처, 드래그, guard, Esc → Tab, 툴바 키보드, 맨 아래 Enter 스크롤), React(Strict Mode, 인스턴스 독립, 구독 범위, SSR import), IME 수동 체크리스트(macOS 한글 입력기 Chrome·Safari, Windows MS IME Chrome·Edge, Android Gboard), 예제 앱.

---

## 10. 결정 기록

| 날짜    | 결정                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10 | ESM 전용 패키징. 엔트리 `.`, `./core`, CSS.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-10 | 빈 블록 표현 3분할(문단 `<br>`, 목록 `<!---->`, 제목·인용 빈 마커), 순서 번호 재시작(같은 깊이 글머리가 끊음), 중첩 평탄화, NUL → U+FFFD 승인. (3단계에서 빈 블록은 `&nbsp;`로, 평탄화는 원문 보존으로 대체)                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-10 | 목록 들여쓰기 불변식의 근거는 "목록은 트리"(마크다운 제약을 근거로 모델 규칙을 만들지 않는다).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-10 | flanking: 코드 유닛·코드 포인트 두 기준 모두 안전할 때만 구분 기호. 직렬화기가 쓰는 HTML과 파서가 읽는 HTML은 한 테이블.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-10 | 왕복 정의를 `parse(serialize(d)) == canonical(d)`로. 공백을 bold·italic·strike 밖으로(code 제외). 속성 테스트 4종. 모델과 편집 동작은 마크다운 제약 때문에 바꾸지 않는다.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-10 | 명령 시그니처 `(state, input, env)`(id 함수 주입과 시그니처의 충돌 해소), 트랜잭션 출처 `history`를 `undo`/`redo`로 분리, `commands → queries` 의존 허용, 인라인 규칙 후 `storedMarks` 정책(5-5).                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-10 | **D1** 링크는 보존 수준으로 지원(파싱, 모델, 렌더링, 직렬화, 붙여넣기). 입력 규칙과 툴바 UI는 범위 밖.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-10 | **D2** 모델이 충실히 표현할 수 없는 구조는 원문 보존(원문 블록, 원문 원자 노드). 판정 기준은 "모델로 변환 후 직렬화해도 렌더링 결과(HTML)가 같다". 중첩 컨테이너 평탄화 결정은 폐기.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-10 | **D3** 지원 서식은 HTML 없이 마크다운만으로 출력하고, HTML을 끈 렌더러에서도 같은 의미여야 한다. 사용자 문서의 HTML은 원문 그대로 출력.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-10 | **D4** 연속 인용 블록은 하나의 인용(문단은 `>`만 있는 줄로 구분)으로 직렬화, 문단이 여럿인 인용은 연속 인용 블록으로 파싱, CSS에서도 하나의 상자.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-10 | **D5** 목록 Tab은 들여쓰기 가능할 때만 소비. Esc 직후 Tab은 항상 포커스 이동. 문서에 명시.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-10 | 0단계 결정: 의존 규칙은 dependency-cruiser. 제목 단계 원천은 `HeadingLevel` 타입이고 FORMATS는 타입 검사로 연결. 문법 표는 `core/markdown`(`input-rules → markdown` 의존 허용).                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-10 | 1단계에서 3단계 일부(링크·원자·원문 블록·start의 파싱과 직렬화) 선행 승인. canonical 예외 "줄 맨 앞 링크 안 코드의 `]:`" 추가.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-10 | `isSafeHref`를 `core/url-policy`로 분리, `./core` 공개 목록에서 제외(`core/internal.ts`로 view에 제공).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-10 | 블록 id는 저장하지 않는다. `getJSON`에서 빼고 불러올 때 새로 발급. id 생성은 인스턴스별 카운터, `randomUUID` 의존 제거(스키마 v1 수정).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-10 | `isFormat` 타입 가드 공개, 사용 예시의 select는 이 가드를 쓴다.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-10 | `switch-exhaustiveness-check` lint 승인(typed linting).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-10 | 참조 링크는 정의의 주소로 링크 마크 변환, 링크 정의는 원문 블록 유지(D2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-10 | getHTML 원문 노드는 2단계 이후 별도 작업: micromark 기본 설정 렌더링, 사용자 HTML 그대로 내보내기 옵션은 소독 책임 문서화 조건.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-10 | 목록 복구는 Step 적용 시 국소 복구(2단계). `normalizeDoc(result) === result` 테스트 유지.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-10 | 2단계 결정: 구조 변경 Step의 역 Step은 영향 범위의 이전 블록 스냅샷(`replaceBlocks`, 블록은 참조 공유). 트랜잭션은 `before`·`doc`·`inverse`를 담고, 다른 문서에 적용하면 `TransactionError`. 국소 목록 복구 범위는 변경이 시작된 run의 앞부분부터 뒤따르는 run 끝까지. 명령 합성(입력 규칙의 문법 삭제 + 서식 적용)은 `followedBy`로 이어 붙인다.                                                                                                                                                                                                                                                                                            |
| 2026-10 | HTML 주석 삭제, `<b>`/`<strong>`의 마크 변환, `- <kbd>` 왕복은 `test.fails`로 기록해 3단계 체크리스트로 쓴다.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-10 | 3단계 결정: GFM 표·작업 목록·각주를 인식해 원문 블록으로 보존(소프트 줄바꿈 합치기가 GitHub에서 구조를 깨지 않도록). 같은 마크 중첩은 블록 전체를 원문으로. 텍스트 없는 링크는 원자. 들여쓴 코드는 펜스로, 열린 채 끝난 펜스·HTML 블록은 닫음. HTML 블록으로 시작하는 줄은 canonical에서 원문 블록(목록 항목은 원자 하나). 인접 원문 블록의 병합, 원문 목록과 붙는 목록 run의 마커 교체. 마크 중첩은 더 오래 이어지는 마크가 바깥. 계약 테스트는 렌더러끼리 원문을 다르게 읽으면 멱등성만 검사, 무작위 입력은 CI에서 고정 시드.                                                                                                              |
| 2026-10 | 4단계 결정: `inclusive`는 모델의 마크 정의(`MARK_SPECS`)에 둔다. inclusive가 아닌 마크도 안쪽 입력은 상속(뒤 글자도 그 마크일 때). `null` 판정은 `finish` 한 곳(`changesNothing`: Step 없음, 셀렉션·`storedMarks` 같음)이고, 바꾸는 것이 없는 Step은 Draft가 기록하지 않는다. Shift-Tab도 옮길 항목이 없으면 `null`. 순서 목록 입력 `1.`은 start를 저장하지 않는다(기본값). Esc → Tab은 view가 아직 없어 view 구현 5번(키 바인딩)에서 한다.                                                                                                                                                                                                  |
| 2026-10 | 5단계 중 발견한 canonical 예외: 줄을 넘어 이어지는 HTML 블록으로 시작하는 목록 항목 아래에 하위 항목이 있으면, 하위 항목이 그 HTML 블록에 들어가므로 목록 전체가 원문 블록(`swallowedLists`). 무작위 왕복 테스트가 찾은 반례.                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-10 | 5단계 결정: `./core`는 변환과 문서 타입만 공개(22개 이름, 스냅샷 테스트). engines `>=22.12.0`(Node 18·20 지원 종료), CI는 engines에서 하한을 읽는다. `getMarkdown` 캐시는 editor가 없어 editor 단계에서 구현(명세 editor 절에 이미 규칙 있음). 성능은 `docs/performance.md`, 벤치에 변환·활성 조회 추가. 파싱이 초선형(파서 라이브러리 자체, 두 배에 약 3배)임을 측정으로 확인.                                                                                                                                                                                                                                                              |
| 2026-10 | 5단계 후속: 파싱 비용은 수용(a). 초선형 원인은 "뒤에 블록이 이어지는 목록·인용이 많은 문서"(문단·제목·긴 목록 하나·긴 인용 하나는 선형), 형태별 측정은 `docs/performance.md`와 벤치. `parseMarkdown`·`fromJSON`의 id 함수는 선택 인자(기본값은 호출마다 새 `idCounter()`), `CreateId`는 `./core`에서 제외(`() => string`으로 충분). CI 상단은 `lts/*`. 배포 전 점검 목록(현재 8-4) 신설.                                                                                                                                                                                                                                                     |
| 2026-10 | getHTML 원문 렌더링: `rawRenderer`(core/markdown, micromark 런타임 의존성으로 이동), `html → markdown` 의존 허용. 문서의 링크 정의를 조각 앞에 붙여 참조를 푼다. 각주가 든 조각은 텍스트로. 원문 노드의 `data-md-raw` 감싸개 제거. 옵션 이름은 micromark와 같은 `allowDangerousHtml`.                                                                                                                                                                                                                                                                                                                                                        |
| 2026-10 | 옛 `src/` 구현 제거(사용자 백업 완료). 엔트리 `.`는 `FORMATS`·`isFormat`·`Format`·`MdJSON`만 내보낸다. React 개발 의존성·peer·CI React 매트릭스·e2e 작업은 React 층과 함께 되돌린다(8-4). 번들 크기 예산(`check:size`)을 CI에 추가. 명세를 "본문은 구현된 것만, 미구현 층의 결정은 9절"로 재구성.                                                                                                                                                                                                                                                                                                                                            |
| 2026-10 | 번들 크기: 지금 구조 유지(a). 에디터는 파서와 HTML 경로(복사)를 어차피 포함하므로 `getHTML`을 따로 떼지 않는다. 인라인 원자 클릭은 원자 1칸을 덮는 텍스트 셀렉션, `block` 셀렉션은 텍스트 없는 블록 전용. 기존 명령의 커서-온-원자블록 동작은 `block` 셀렉션 경로로 이전. editor는 `parseMarkdown`·`fromJSON`에 인스턴스 카운터를 넘긴다. 원문 노드는 편집 화면·`MdViewer`·`getHTML`이 같은 렌더링 모습(`rawRenderer` HTML을 `DOMParser`로 분석해 허용 목록만 `createElement`, `innerHTML` 금지, `src`·`href`는 URL 정책). 메모이제이션은 정확성 요구 또는 측정된 성능 문제일 때만, 근거를 주석으로. `test/`를 `tsconfig.tools.json`에 추가. |
| 2026-10 | view 1단계(core 셀렉션 확장): 셀렉션 3종, `normalizeSelection`과 `selectionBetween`, `formatStates`(한 번의 순회, 일찍 멈춤), `arrowSelection`, `deleteSelectedBlock`, `selectBlockBackward`, `selectBlockForward`. 텍스트 블록 가장자리의 Backspace와 Delete는 이웃의 텍스트 없는 블록을 지우지 않고 선택한다. 구분선 삽입(`---` 포함)과 블록 붙여넣기 뒤에 빈 문단을 만들지 않고 gap으로 간다.                                                                                                                                                                                                                                             |
| 2026-10 | 빈 텍스트 블록의 가장자리 키: 이웃이 텍스트 없는 블록이면 빈 블록을 지우고 이웃을 블록 셀렉션으로 선택한다(내용이 있으면 선택만). 무작위 불변식 테스트에 빈 블록과 텍스트 없는 블록으로만 된 문서 생성기를 추가.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-10 | view 2단계(render·ReadonlyView·MdViewer): `describe`는 순수 함수, `patch`는 블록 id 키 재조정, `sanitize`는 허용 목록 DOM 재구성. `RawSource`는 원문 블록이 바뀔 때만 `rawRenderer`를 교체한다(키스트로크마다 재파싱 방지). ReadonlyView 인터페이스는 EditorView와 분리. MdViewer는 SSR에서 빈 div, mount 후 내용 채움. `'use client'`는 tsup `onSuccess`로 `dist/index.js` 앞에 붙인다(rollup이 소스의 지시어를 삭제하므로). CI React 18·19 매트릭스 복원. 번들 크기 `.` 엔트리 예산 38 kB(MdViewer가 core 코드를 포함하므로 1 kB에서 상향). 인라인 원자 클릭의 선택 장식은 브라우저 하이라이트 확인 후 결정(다음 단계).                    |
| 미정    | 패키지 이름(`md-editor`는 npm에 이미 등록됨). 확정 전에는 문서와 명령에 이름을 쓰지 않는다.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
