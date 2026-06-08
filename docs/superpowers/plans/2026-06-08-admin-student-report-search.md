# 관리자 학생 리포트 검색·미리보기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 원장이 admin 화면에서 학생 이름을 검색해, 그 학생의 학부모용 리포트(`index.html`)를 새 탭에서 바로 미리볼 수 있게 한다.

**Architecture:** admin은 이미 `loadAll()`로 전체 학생 데이터를 메모리에 들고 있다. 고른 학생을 학부모 RPC 응답과 동일한 형태로 빌드해 `localStorage` 1회용 버퍼에 넣고 `index.html`을 새 탭으로 연다. `app.js`는 부팅 시 그 버퍼를 자기 `sessionStorage`로 옮긴 뒤 버퍼를 삭제하고, 로그인을 건너뛰고 그 학생 리포트를 렌더한다(학부모 세션 불간섭, 읽기 전용 미리보기 배너 표시). 빌드·필터·버퍼 로직은 신규 모듈 `web/preview.js`로 분리해 Node에서 단위 테스트한다.

**Tech Stack:** Vanilla JS (빌드 없음), Supabase(기존), Node 스크립트 기반 스모크 테스트.

---

## File Structure

| 파일 | 책임 | 변경 |
| --- | --- | --- |
| `web/preview.js` | 미리보기 payload 빌드 · 검색 필터 · 버퍼 read/write 헬퍼 (`window.SCPreview` + `module.exports`) | 신규 |
| `scripts/preview_smoke.js` | `preview.js` 순수 함수 단위 테스트 | 신규 |
| `web/admin.html` | 상단 "학생 리포트 보기" 섹션 + `preview.js` script 태그 | 수정 |
| `web/admin.css` | 검색 섹션·결과 목록 스타일 | 수정 |
| `web/admin.js` | 검색 렌더 + 클릭 핸드오프 | 수정 |
| `web/index.html` | 미리보기 배너 요소 + `preview.js` script 태그 | 수정 |
| `web/app.js` | 부팅 시 미리보기 버퍼 감지 → 미리보기 모드 진입 + 배너 | 수정 |
| `web/styles.css` | 미리보기 배너 스타일 + 미리보기 모드에서 로그아웃 숨김 | 수정 |

---

## Task 1: `web/preview.js` 모듈 — 순수 함수(빌드·필터) + 버퍼 헬퍼

순수 함수(`buildPreviewPayload`, `filterReportStudents`, `studentRowMeta`)는 Node 테스트 대상이고, 버퍼 헬퍼(`writeBuffer`, `takePreview`)는 브라우저 storage를 쓰므로 호출 시점에만 접근한다.

**Files:**
- Create: `web/preview.js`
- Test: `scripts/preview_smoke.js`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `scripts/preview_smoke.js`:

```js
/* preview.js 순수 함수 검증 — payload 빌드 · 검색 필터 */
const path = require("path");
const P = require(path.join(__dirname, "..", "web", "preview.js"));

function assert(c, m) { if (!c) { console.error("  ✗ FAIL: " + m); process.exitCode = 1; } else { console.log("  ✓ " + m); } }

// 가짜 데이터셋: 동명이인(김민준) + 데이터 없는 학생(이서연)
const DATA = {
  months: ["2026-03", "2026-04"],
  openDays: { "2026-04": ["2026-04-01"] },
  classAverages: { "2026-04": { studentCount: 3, dailyAvgSec: 100 } },
  students: [
    { key: "김민준", name: "김민준", seat: 12, profile: { grade: "고2" }, months: { "2026-04": { days: {} } } },
    { key: "김민준#7", name: "김민준", seat: 7, profile: { grade: "고1" }, months: { "2026-04": { days: {} } } },
    { key: "이서연", name: "이서연", seat: 3, profile: { grade: "고3" }, months: {} },
  ],
};
const corrMap = {
  "김민준|2026-04-02": { events: [] },
  "김민준#7|2026-04-02": { events: [] },
  "이서연|2026-04-02": { events: [] },
};

console.log("== buildPreviewPayload ==");
const stu = DATA.students[0];
const payload = P.buildPreviewPayload(stu, DATA, corrMap);
assert(payload.student === stu, "student 그대로 포함");
assert(JSON.stringify(payload.months) === JSON.stringify(DATA.months), "months 복사");
assert(payload.openDays === DATA.openDays, "openDays 포함");
assert(payload.classAverages === DATA.classAverages, "classAverages 포함");
assert(Object.keys(payload.corrections).length === 1, "그 학생 보정만 1건");
assert(payload.corrections["김민준|2026-04-02"], "보정 키는 key|date 형태");
assert(!payload.corrections["김민준#7|2026-04-02"], "동명이인(다른 key) 보정은 제외");

console.log("== filterReportStudents ==");
const all = P.filterReportStudents(DATA.students, "");
assert(all.length === 2, "빈 검색어 → 데이터 있는 학생만(2명), 이서연 제외");
const hit = P.filterReportStudents(DATA.students, "민준");
assert(hit.length === 2, "'민준' 부분일치 2명");
const none = P.filterReportStudents(DATA.students, "이서연");
assert(none.length === 0, "데이터 없는 이서연은 검색돼도 제외");

console.log("== studentRowMeta ==");
const meta = P.studentRowMeta(DATA.students[0]);
assert(meta.indexOf("고2") >= 0 && meta.indexOf("12번 좌석") >= 0, "메타에 학년·좌석: " + meta);

console.log("\n완료");
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `node scripts/preview_smoke.js`
Expected: FAIL — `Cannot find module '.../web/preview.js'`

- [ ] **Step 3: `web/preview.js` 구현**

Create `web/preview.js`:

```js
/* 관리자 → 학부모 리포트 미리보기 공용 모듈 — window.SCPreview
 * - buildPreviewPayload: admin이 가진 학생 1명을 학부모 RPC 응답과 동일 형태로 빌드
 * - filterReportStudents / studentRowMeta: 검색 결과 목록용
 * - writeBuffer / takePreview: localStorage(1회용 핸드오프) ↔ sessionStorage(탭 내 지속)
 *   sessionStorage는 탭마다 격리되므로 탭→탭 전달은 localStorage 버퍼를 쓰고,
 *   새 탭은 부팅 시 sessionStorage로 옮긴 뒤 버퍼를 즉시 삭제한다.
 */
(function () {
  "use strict";

  var BUFFER_KEY = "studycore_admin_preview"; // localStorage: 탭→탭 1회용
  var SESSION_KEY = "studycore_preview";      // sessionStorage: 새 탭 내 지속

  function hasMonths(s) {
    return !!(s && s.months && Object.keys(s.months).length > 0);
  }

  // 학습 데이터(months)가 있는 학생만, 이름 부분일치(소문자 정규화)
  function filterReportStudents(students, term) {
    term = (term || "").trim().toLowerCase();
    var withData = (students || []).filter(hasMonths);
    if (!term) return withData;
    return withData.filter(function (s) {
      return (s.name || "").toLowerCase().indexOf(term) >= 0;
    });
  }

  // 결과 행의 구분용 메타: "학년 · N번 좌석" (동명이인 식별)
  function studentRowMeta(s) {
    var bits = [];
    var prof = s.profile || {};
    if (prof.grade) bits.push(prof.grade);
    if (s.seat) bits.push(s.seat + "번 좌석");
    return bits.join(" · ");
  }

  // 학생 1명 → { student, months, openDays, classAverages, corrections }
  // corrMap: { "key|date": payload, ... } (admin의 corrMap 또는 SCCorr.loadAll())
  function buildPreviewPayload(student, data, corrMap) {
    data = data || {};
    var key = student.key || student.name;
    var prefix = key + "|";
    var corrections = {};
    Object.keys(corrMap || {}).forEach(function (k) {
      if (k.indexOf(prefix) === 0) corrections[k] = corrMap[k];
    });
    return {
      student: student,
      months: (data.months || []).slice(),
      openDays: data.openDays || {},
      classAverages: data.classAverages || {},
      corrections: corrections,
    };
  }

  /* ---------- 브라우저 전용: 버퍼 핸드오프 ---------- */
  function writeBuffer(payload) {
    try { window.localStorage.setItem(BUFFER_KEY, JSON.stringify(payload)); return true; }
    catch (e) { return false; }
  }

  // localStorage 버퍼가 있으면 sessionStorage로 옮기고 버퍼 삭제.
  // 없으면 sessionStorage(새로고침 케이스)에서 읽는다. 없으면 null.
  function takePreview() {
    var raw = null;
    try { raw = window.localStorage.getItem(BUFFER_KEY); } catch (e) {}
    if (raw != null) {
      try { window.localStorage.removeItem(BUFFER_KEY); } catch (e) {}
      try { window.sessionStorage.setItem(SESSION_KEY, raw); } catch (e) {}
    } else {
      try { raw = window.sessionStorage.getItem(SESSION_KEY); } catch (e) {}
    }
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  var api = {
    BUFFER_KEY: BUFFER_KEY, SESSION_KEY: SESSION_KEY,
    filterReportStudents: filterReportStudents,
    studentRowMeta: studentRowMeta,
    buildPreviewPayload: buildPreviewPayload,
    writeBuffer: writeBuffer,
    takePreview: takePreview,
  };
  if (typeof window !== "undefined") window.SCPreview = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `node scripts/preview_smoke.js`
Expected: PASS — 모든 `✓` 출력, 마지막 "완료". 종료 코드 0.

- [ ] **Step 5: 커밋**

```bash
git add web/preview.js scripts/preview_smoke.js
git commit -m "feat: 미리보기 공용 모듈(preview.js) + 단위 테스트"
```

---

## Task 2: admin 검색 UI 마크업 + 스타일

**Files:**
- Modify: `web/admin.html` (script 태그, 상단 섹션)
- Modify: `web/admin.css` (섹션·목록 스타일)

- [ ] **Step 1: `web/admin.html` — `preview.js` 로드 추가**

`web/admin.html`에서 `<script src="roster.js"></script>` 줄 바로 아래에 추가:

```html
  <script src="preview.js"></script>
```

(결과: `roster.js` → `preview.js` → `corrections.js` → `admin.js` 순서)

- [ ] **Step 2: `web/admin.html` — 상단 검색 섹션 추가**

`<div id="admin-main">` 바로 다음 줄(현재 `<!-- 엑셀 업로드 -->` 위)에 새 섹션 삽입:

```html
    <!-- 학생 리포트 검색·미리보기 -->
    <section class="report-search-card">
      <h2>학생 리포트 보기</h2>
      <p class="rs-sub">이름을 검색해 학부모에게 보이는 리포트를 새 탭에서 확인합니다.</p>
      <input type="search" id="report-search" class="report-search-input"
             placeholder="학생 이름 검색" autocomplete="off" />
      <div id="report-results" class="report-results"></div>
    </section>
```

- [ ] **Step 3: `web/admin.css` — 스타일 추가 (파일 끝에 append)**

```css
/* 학생 리포트 검색·미리보기 */
.report-search-card { background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:18px 18px 14px; margin-bottom:18px; }
.report-search-card h2 { margin:0 0 4px; }
.report-search-card .rs-sub { margin:0 0 12px; color:#64748b; font-size:13px; }
.report-search-input { width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:15px; }
.report-search-input:focus { outline:none; border-color:#103050; box-shadow:0 0 0 3px rgba(16,48,80,.12); }
.report-results { margin-top:10px; display:flex; flex-direction:column; gap:6px; }
.report-results:empty { margin-top:0; }
.rs-row { display:flex; align-items:center; justify-content:space-between; gap:10px;
  padding:10px 12px; border:1px solid #eef1f4; border-radius:8px; }
.rs-row .rs-info { min-width:0; }
.rs-row .rs-name { font-weight:700; color:#103050; }
.rs-row .rs-meta { font-size:12px; color:#64748b; margin-top:2px; }
.rs-row .rs-open { display:inline-block; padding:6px 12px; border-radius:6px;
  background:#103050; color:#fff; font-size:13px; font-weight:600; border:0; cursor:pointer; white-space:nowrap; }
.rs-row .rs-open:hover { background:#0b2238; }
.rs-empty { color:#94a3b8; font-size:13px; padding:8px 2px; }
```

- [ ] **Step 4: 수동 확인**

Run: `cd web && python -m http.server 8787` 후 브라우저에서 `http://localhost:8787/admin.html` 열기.
Expected: 상단에 "학생 리포트 보기" 카드와 검색 입력이 보인다(아직 검색 동작은 없음 — Task 3에서 연결).

- [ ] **Step 5: 커밋**

```bash
git add web/admin.html web/admin.css
git commit -m "feat: admin 상단 학생 리포트 검색 섹션 UI"
```

---

## Task 3: admin 검색 렌더 + 클릭 핸드오프

`startApp()`에서 호출되는 검색 렌더 함수를 추가하고, `wireHandlers()`에서 입력 이벤트를 연결한다. 클릭 시 `SCPreview`로 payload를 빌드해 버퍼에 쓰고 새 탭을 연다.

비REMOTE(로컬) 모드에서는 `corrMap`이 비어 있으므로 `window.SCCorr.loadAll()`을 보정 소스로 사용한다.

**Files:**
- Modify: `web/admin.js` (`renderReportResults` 추가, `wireHandlers`/`startApp` 연결)

- [ ] **Step 1: `web/admin.js` — `renderReportResults` 함수 추가**

`function startApp() {` 정의 **바로 위**에 추가:

```js
  /* ---------- 학생 리포트 검색·미리보기 ---------- */
  function openReport(student) {
    var corrSource = REMOTE
      ? corrMap
      : (window.SCCorr && window.SCCorr.loadAll ? window.SCCorr.loadAll() : {});
    var payload = window.SCPreview.buildPreviewPayload(student, DATA, corrSource);
    var ok = window.SCPreview.writeBuffer(payload);
    if (!ok) { window.alert("미리보기 데이터를 준비하지 못했습니다."); return; }
    var win = window.open("index.html", "_blank");
    if (!win) window.alert("팝업이 차단되었습니다. 이 사이트의 새 탭 열기를 허용해 주세요.");
  }

  function renderReportResults() {
    var box = $("report-results");
    if (!box) return;
    var term = ($("report-search").value || "").trim();
    box.innerHTML = "";
    if (!term) return; // 입력 시에만 표시

    var matches = window.SCPreview.filterReportStudents(DATA.students, term)
      .sort(function (a, b) { return (a.name || "").localeCompare(b.name || "", "ko"); });

    if (!matches.length) {
      box.appendChild(el("div", "rs-empty", "검색 결과가 없습니다."));
      return;
    }

    matches.forEach(function (s) {
      var row = el("div", "rs-row");
      var info = el("div", "rs-info");
      info.appendChild(el("div", "rs-name", s.name));
      var metaBits = [];
      var meta = window.SCPreview.studentRowMeta(s);
      if (meta) metaBits.push(meta);
      metaBits.push(Object.keys(s.months).length + "개월 데이터");
      info.appendChild(el("div", "rs-meta", metaBits.join(" · ")));
      row.appendChild(info);

      var btn = el("button", "rs-open", "리포트 ↗");
      btn.type = "button";
      btn.addEventListener("click", function () { openReport(s); });
      row.appendChild(btn);
      box.appendChild(row);
    });
  }
```

- [ ] **Step 2: `web/admin.js` — `startApp`에서 초기 렌더 호출**

`function startApp() {` 본문의 `renderList();` 다음 줄에 추가:

```js
    renderReportResults();
```

(결과: `setupUpload(); setupRoster(); initMonthFilter(); renderList(); renderReportResults();`)

- [ ] **Step 3: `web/admin.js` — `wireHandlers`에서 입력 이벤트 연결**

`function wireHandlers() {` 본문 첫 줄(`$("admin-search")...` 위)에 추가:

```js
    var rs = $("report-search");
    if (rs) rs.addEventListener("input", function () { renderReportResults(); });
```

- [ ] **Step 4: 회귀 스모크 — 기존 admin 동작 깨지지 않았는지**

Run: `node scripts/admin_smoke.js`
Expected: 기존과 동일하게 PASS (이 변경은 admin_smoke가 검증하는 보정 로직을 건드리지 않음).

- [ ] **Step 5: 수동 확인**

`http://localhost:8787/admin.html`(로컬 모드는 시드 데이터 필요 — 서버 모드면 로그인) 에서 검색창에 이름 일부를 입력.
Expected: 데이터 있는 학생만 행으로 뜨고, "리포트 ↗" 클릭 시 새 탭이 열린다(새 탭 렌더는 Task 4 이후 정상).

- [ ] **Step 6: 커밋**

```bash
git add web/admin.js
git commit -m "feat: admin 학생 리포트 검색 렌더 + 새 탭 핸드오프"
```

---

## Task 4: app.js 미리보기 부팅 + 배너

새 탭의 `app.js`가 부팅 시 버퍼를 감지하면 로그인을 건너뛰고 그 학생 리포트를 렌더하고, 미리보기 배너를 띄운다.

**Files:**
- Modify: `web/index.html` (배너 요소 + `preview.js` script)
- Modify: `web/app.js` (`enterPreview`/`showPreviewBanner` + `init` 분기)
- Modify: `web/styles.css` (배너 스타일 + 로그아웃 숨김)

- [ ] **Step 1: `web/index.html` — `preview.js` 로드 추가**

`<script src="corrections.js"></script>` 줄 바로 아래(=`app.js` 위)에 추가:

```html
  <script src="preview.js"></script>
```

- [ ] **Step 2: `web/index.html` — 배너 요소 추가**

`<body>` 바로 다음 줄(첫 `<section id="view-login">` 위)에 추가:

```html
  <div id="preview-banner" class="preview-banner" hidden></div>
```

- [ ] **Step 3: `web/styles.css` — 배너 스타일 추가 (파일 끝에 append)**

```css
/* 관리자 미리보기 배너 */
.preview-banner { display:flex; align-items:center; gap:8px; flex-wrap:wrap;
  background:#fef3c7; border-bottom:2px solid #f59e0b; color:#7c2d12;
  padding:8px 14px; font-size:13px; position:sticky; top:0; z-index:50; }
.preview-banner .pv-tag { background:#b45309; color:#fff; border-radius:4px;
  padding:2px 8px; font-weight:700; font-size:12px; }
.preview-banner .pv-txt { font-weight:500; }
body.preview-mode #btn-logout { display:none; }
```

- [ ] **Step 4: `web/app.js` — `enterPreview`/`showPreviewBanner` 추가**

`function init() {` 정의 **바로 위**에 추가:

```js
  /* ---------- 관리자 미리보기 모드 ---------- */
  function showPreviewBanner(student) {
    var b = $("preview-banner");
    if (!b) return;
    b.innerHTML = '<span class="pv-tag">관리자 미리보기</span>' +
      '<span class="pv-txt">' + (student.name || "") +
      ' 학생 · 학부모에게 보이는 화면입니다.</span>';
    b.hidden = false;
  }

  // 버퍼에서 받은 payload로 진입. 학부모 세션(saveSession)은 건드리지 않음(읽기 전용).
  function enterPreview(p) {
    DATA = {
      months: p.months || [], openDays: p.openDays || {},
      classAverages: p.classAverages || {}, students: [p.student], _remote: true,
    };
    state.corrections = p.corrections || {};
    state.preview = true;
    document.body.classList.add("preview-mode");
    showPreviewBanner(p.student);
    enterStudent(p.student);
  }
```

- [ ] **Step 5: `web/app.js` — `init` 끝의 부팅 분기 교체**

`init()` 본문 마지막 두 줄을 찾는다:

```js
    showView("view-login");
    restoreSession(); // 저장된 로그인 있으면 자동 복원(새로고침 유지)
```

다음으로 **교체**:

```js
    var preview = (window.SCPreview && window.SCPreview.takePreview)
      ? window.SCPreview.takePreview() : null;
    if (preview && preview.student) {
      enterPreview(preview);
    } else {
      showView("view-login");
      restoreSession(); // 저장된 로그인 있으면 자동 복원(새로고침 유지)
    }
```

- [ ] **Step 6: 회귀 스모크 — 학부모 렌더 깨지지 않았는지**

Run: `node scripts/smoke_test.js`
Expected: 기존과 동일하게 PASS (버퍼 없으면 분기는 기존 로그인 흐름 그대로).

- [ ] **Step 7: 수동 확인 (엔드투엔드)**

`admin.html`에서 학생 검색 → "리포트 ↗" 클릭 → 새 탭.
Expected:
- 새 탭이 로그인 화면 없이 바로 그 학생 리포트를 보여준다.
- 상단에 노란 "관리자 미리보기 — OOO 학생" 배너가 보인다.
- 로그아웃 버튼이 보이지 않는다.
- 새 탭에서 **새로고침**해도 미리보기가 유지된다(sessionStorage).
- 같은 브라우저에서 `index.html`을 **직접** 새로 열면(다른 탭) 평소 학부모 로그인 화면이 뜬다(버퍼는 이미 소비됨).

- [ ] **Step 8: 커밋**

```bash
git add web/index.html web/app.js web/styles.css
git commit -m "feat: 리포트 화면 관리자 미리보기 모드 + 배너"
```

---

## Task 5: 최종 회귀 검증

**Files:** (없음 — 검증만)

- [ ] **Step 1: 전체 테스트 스위트 실행**

Run (각각):
```
node scripts/ingest_test.js
node scripts/smoke_test.js
node scripts/upload_smoke.js
node scripts/admin_smoke.js
node scripts/remote_smoke.js
node scripts/preview_smoke.js
```
Expected: 모두 PASS(종료 코드 0). 일부 스크립트가 `inout_raw.xlsx`(gitignore된 실데이터)를 요구하면, 해당 파일이 없을 때의 동작은 기존과 동일하다 — 새로 추가된 변경과 무관하므로 기존 결과를 기준으로 비교한다.

- [ ] **Step 2: 최종 커밋(필요 시)**

테스트만 했고 코드 변경이 없으면 커밋 생략.

---

## Self-Review 결과

- **Spec coverage:**
  - 검색 UI 전용 섹션 → Task 2. 검색 필터(데이터 있는 학생만)·동명이인 좌석·학년 → Task 1(`filterReportStudents`/`studentRowMeta`) + Task 3.
  - localStorage→sessionStorage 핸드오프 → Task 1(`writeBuffer`/`takePreview`) + Task 3 + Task 4.
  - 학부모 세션 불간섭(`saveSession` 미호출) → Task 4 `enterPreview`.
  - 미리보기 배너 + 로그아웃 숨김 → Task 4.
  - `preview.js` 모듈 분리 + 단위 테스트 → Task 1.
  - 읽기 전용(보정 편집 없음) → 미리보기 모드는 `app.js` 렌더만 사용, 보정 UI는 admin에만 존재(범위 밖 유지).
- **Placeholder scan:** 모든 코드 단계에 실제 코드 포함. placeholder 없음.
- **Type consistency:** `BUFFER_KEY`/`SESSION_KEY`/`buildPreviewPayload`/`filterReportStudents`/`studentRowMeta`/`writeBuffer`/`takePreview`/`enterPreview`/`showPreviewBanner`/`openReport`/`renderReportResults` — Task 1 정의와 Task 3·4 사용처의 이름·시그니처 일치 확인.
