# 구현 진행 기록

각 단계의 완료 내용, 리뷰 반복 횟수, 성능 측정 결과를 남긴다.
작업이 끊겨도 이 파일과 decisions.md만 읽으면 재개할 수 있어야 한다.

---

## 1단계 보완: 빈 텍스트 블록 가장자리 키 (완료)

**완료 내용**

- `selectPast` 함수(blocks.ts): 빈 텍스트 블록에서 Backspace/Delete 시 이웃 비텍스트 블록 선택 + 빈 블록 삭제
- 테스트: `commands.test.ts` 212~~217(Backspace), 241~~247(Delete) 라인에 명시적 케이스
- 무작위 불변식 테스트 `sparseDocs` 생성기: 빈 텍스트 블록 + 구분선/원문 블록 조합

**리뷰 반복**: 0 (이전 세션에서 구현됨, 이번 세션에서 확인)

**성능 측정**: 해당 없음 (core 명령, 브라우저 불필요)

---

## 3단계: selection, selectionchange, editor 구독

**완료 내용**

- `src/core/internal.ts`: `changesNothing`, `isCollapsed`, `sameSelection`, `selectionRange` 추가 익스포트
- `src/view/selection.ts`: `readSelection`, `syncSelection`, `selectionFromDOM` 구현
  - DOM 위치 ↔ 모델 Pos 변환 (text node, atom span, BR empty block 처리)
  - `setBaseAndExtent` 전 동등성 확인(idempotent), gap/block 선택 시 `removeAllRanges`
- `src/view/view.ts`: `EditorHost`, `EditorView`, `createEditorView` 추가
  - `selectionchange` 이벤트 → `selectionFromDOM` → `host.dispatch`
  - `draw`: render → `syncSelection` (항상 호출, idempotent 보장)
- `src/view/index.ts`: 새 타입·함수 재익스포트
- `src/editor.ts`: `createEditor` (상태·히스토리·구독자·EditorView 소유), `createViewer` 유지
  - `subscribe(listener): () => void` — Set 기반, 순서 보장
- 테스트: `src/view/selection.test.ts` 10개, `src/editor.test.ts` 11개
- 전체: lint ✓ typecheck ✓ 1026 tests ✓ deps ✓ unused ✓ build ✓ size ✓ package ✓

**리뷰 반복**: 0

**성능 측정**: 해당 없음 (DOM selection은 Playwright 세팅 후 4단계에서 측정)

---

## 4단계: input 기본 입력과 갱신 사이클

**상태**: 대기

---

## 5단계: 키 바인딩, 툴바, Esc → Tab

**상태**: 대기

---

## 6단계: composition

**상태**: 대기

---

## 7단계: clipboard와 드래그 앤 드롭

**상태**: 대기

---

## 8단계: guard와 개발 모드 일치 검사

**상태**: 대기

---

## 9단계: CSS, 접근성, 패키징, 예제 앱, README

**상태**: 대기

---

## 성능 측정 요약

| 항목                            | 3단계 | 4단계 | 5단계 | 6단계 | 7단계 | 8단계 | 9단계 |
| ------------------------------- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| 첫 렌더링 1k 블록 (Chromium)    | —     | —     | —     | —     | —     | —     | —     |
| 첫 렌더링 10k 블록 (Chromium)   | —     | —     | —     | —     | —     | —     | —     |
| 첫 렌더링 1k 블록 (WebKit)      | —     | —     | —     | —     | —     | —     | —     |
| 첫 렌더링 10k 블록 (WebKit)     | —     | —     | —     | —     | —     | —     | —     |
| 원문 노드 많은 문서 첫 렌더링   | —     | —     | —     | —     | —     | —     | —     |
| 키 입력→화면 1k 블록 (Chromium) | —     | —     | —     | —     | —     | —     | —     |
| 키 입력→화면 1k 블록 (WebKit)   | —     | —     | —     | —     | —     | —     | —     |
| 번호 목록 중간 삽입 스타일 비용 | —     | —     | —     | —     | —     | —     | —     |
| 드래그 선택 프레임 유지         | —     | —     | —     | —     | —     | —     | —     |
