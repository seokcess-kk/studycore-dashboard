# 관리자 학생 리포트 검색·미리보기 — 설계

작성일: 2026-06-08

## 목적

원장(관리자)이 admin 화면에서 학생 이름을 검색해, 그 학생의 **학부모용 리포트를 새 탭에서 바로** 확인할 수 있게 한다. 학부모에게 실제로 보이는 화면(`index.html` + `app.js`)을 그대로 재사용해 100% 동일하게 보여준다.

## 배경 (현재 구조)

- 관리자는 Supabase Auth 로그인 후 `SCApi.loadAll()`로 **전체 학생의 월별 데이터·반평균·보정**을 메모리(`DATA`)에 이미 가지고 있다 (`web/admin.js`, `web/scapi.js`).
- 학부모 리포트는 `web/app.js`가 렌더링하며, `enterStudent(student)`에 학생 객체를 넘기면 그려진다. 서버 모드에서는 RPC 응답을 `applyReport(res, name, phone)`가 받아 `DATA`를 구성하고 진입한다.
- RPC 응답/`DATA`의 형태: `{ student, months, openDays, classAverages, corrections }`.
- 보정 조회기 `corrGetter(key, date)`는 원격 모드에서 `corrections[date]` 와 `corrections[key + "|" + date]` **둘 다** 조회한다.
- 학부모 자동로그인 세션은 `localStorage["studycore_session"]` 키를 사용한다 (`saveSession`/`loadSession`/`clearSession`).

## 핵심 결정

1. **표시 방식: 학부모 리포트 화면 그대로, 새 탭으로.** (`app.js` 재사용)
2. **검색 UI 위치: admin 페이지 맨 위 전용 섹션 신설.** (기존 "퇴실 미체크" 검색과 분리)
3. **데이터 전달: sessionStorage 핸드오프(방식 1).** admin이 이미 가진 데이터를 재사용하므로 DB 추가 조회·RLS 변경이 없다.

## 동작 흐름

```
[admin.html] 맨 위 "학생 리포트 보기" 섹션
   이름 입력 → 결과 목록(이름·반/좌석·데이터 월수) → "리포트 ↗" 클릭
        │  buildPreviewPayload(student, DATA, corrMap)
        ▼
   localStorage["studycore_admin_preview"] 에 1회용 버퍼 저장
        │  window.open("index.html", "_blank")
        ▼
[새 탭 / index.html + app.js] 부팅 시 버퍼 감지
   → sessionStorage["studycore_preview"] 로 이동
   → localStorage 버퍼 즉시 삭제
   → 로그인/세션복원 건너뛰고 그 학생 리포트 렌더 (saveSession 호출 안 함)
   → 상단 "관리자 미리보기" 배너, 로그인/로그아웃 UI 숨김
```

## 컴포넌트별 설계

### 1. 검색 UI — `web/admin.html`, `web/admin.css`

- admin 헤더 아래, "출결 엑셀 업로드" 섹션 **위**에 새 `<section class="report-search-card">` 추가.
- 구성: 제목("학생 리포트 보기") + 검색 `<input type="search">` + 결과 목록 컨테이너.
- 결과 목록의 각 행: `이름 · 학년 · N번 좌석` + 데이터가 있는 월 수(예: "5개월") + "리포트 ↗" 버튼. (데이터 모델에 "반" 필드는 없음 — `seat`/`profile.grade` 사용.)
- 데이터(`DATA`)가 아직 로드되지 않았으면 비활성/안내. 로컬 모드(비로그인)에서도 `DATA.students`가 있으면 동작.

### 2. 검색·핸드오프 로직 — `web/admin.js`

- **검색 필터**: `DATA.students` 중 `months` 키가 1개 이상인 학생만 대상. 이름 부분일치(소문자 정규화, 한글 그대로). 입력이 비면 결과 숨김(입력 시에만 표시).
- **동명이인**: 같은 이름이 여러 명이면 행에 좌석·학년을 함께 표기해 구분.
- **모듈 분리**: `buildPreviewPayload`·검색 필터·핸드오프 버퍼 헬퍼는 신규 파일 **`web/preview.js`**(`window.SCPreview` + `module.exports` 양쪽 export, 기존 `roster.js`/`aggregate.js` 패턴)에 두어 Node 단위 테스트가 가능하게 한다. `admin.html`·`index.html` 양쪽에서 로드.
- **핸드오프**:
  - 순수 함수 `SCPreview.buildPreviewPayload(student, DATA, corrMap)` → `{ student, months, openDays, classAverages, corrections }` 반환.
    - `months`: `DATA.months`
    - `openDays`: `DATA.openDays`
    - `classAverages`: `DATA.classAverages`
    - `corrections`: `corrMap` 중 해당 학생(`key`) 것만 추려 `key + "|" + date` 형태로 담는다.
  - 결과를 `JSON.stringify` 하여 `localStorage.setItem("studycore_admin_preview", ...)`.
  - `window.open("index.html", "_blank")`.

### 3. 미리보기 부팅 — `web/app.js`

- 부팅 시점(`init` 또는 그 이전, `restoreSession` 보다 먼저)에 미리보기 진입 여부 판정:
  1. `localStorage["studycore_admin_preview"]` 가 있으면 → 파싱하여 `sessionStorage["studycore_preview"]` 에 저장하고 **localStorage 버퍼 삭제**.
  2. localStorage 버퍼가 없고 `sessionStorage["studycore_preview"]` 가 있으면 → 그대로 사용(새로고침 케이스).
  3. 둘 다 없으면 → 기존 학부모 흐름(로그인/`restoreSession`).
- 미리보기 진입 시:
  - `applyReport`와 동일하게 `DATA`/`state.corrections`를 구성하되 **`saveSession()`는 호출하지 않는다.**
  - `enterStudent(payload.student)` 로 리포트 렌더.
  - 미리보기 플래그(`state.preview = true`)를 세운다.
- 미리보기 모드에서는 학부모 로그인 화면으로의 복귀/로그아웃 동선이 노출되지 않도록 관련 UI를 숨긴다.

### 4. 미리보기 배너 — `web/index.html`(또는 동적 생성), `web/styles.css`

- 미리보기 모드일 때 화면 상단에 고정 배너: **"관리자 미리보기 — OOO 학생 · 학부모에게 보이는 화면입니다."**
- 시각적으로 일반 학부모 화면과 구분되도록 강조색 사용.

### 5. 테스트 — `scripts/preview_smoke.js`(신규)

- `buildPreviewPayload`를 Node에서 직접 호출하는 단위 스모크 테스트.
- 검증 항목:
  - 반환 객체에 `student/months/openDays/classAverages/corrections` 가 모두 존재.
  - `corrections` 가 해당 학생의 보정만 포함하고 키가 `key|date` 형태.
  - 다른 학생의 보정은 포함되지 않음.
  - `months` 가 없는 학생은 검색 대상에서 제외되는지(필터 함수 분리 시 함께 검증).

## 에러 처리·엣지 케이스

- **새 탭 새로고침**: sessionStorage에 남아 있어 미리보기 유지. 탭을 닫으면 사라진다.
- **localStorage 버퍼 잔존**: 새 탭이 부팅 즉시 삭제하므로, 일반 학부모가 같은 브라우저에서 `index.html`을 직접 열어도 영향 없음. (만약 새 탭이 열리지 못한 경우를 대비해, admin은 매 클릭마다 버퍼를 덮어쓴다.)
- **데이터 없는 학생**: 검색 결과에 노출하지 않음.
- **로컬(비로그인) 모드**: `DATA.students`가 번들/`localStorage`에서 채워져 있으면 동일하게 동작. 서버 모드와 분기 불필요(둘 다 `DATA` 기반).
- **팝업 차단**: `window.open`이 막히면 사용자에게 알리거나 같은 탭 대체는 범위 외(추후 고려).

## 변경 파일 요약

| 파일 | 변경 |
| --- | --- |
| `web/admin.html` | 상단 "학생 리포트 보기" 섹션 마크업 |
| `web/admin.css` | 섹션·결과 목록 스타일 |
| `web/admin.js` | 검색 필터·결과 렌더·`buildPreviewPayload`·핸드오프 |
| `web/app.js` | 미리보기 버퍼 감지→진입, 배너 토글, 세션 미저장 |
| `web/styles.css` | 미리보기 배너 스타일 |
| `scripts/preview_smoke.js` | (신규) 빌드 함수 단위 테스트 |

## 범위 밖 (YAGNI)

- 관리자 전용 URL/북마크 진입(방식 2).
- 미리보기 화면에서의 보정 편집(미리보기는 읽기 전용; 보정은 기존 admin 모달 사용).
- 여러 학생 동시 비교.
