# 관리자 ↔ 리포트 같은 탭 왕복 내비게이션 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자와 학부모용 리포트 화면 사이를 같은 탭에서 왕복할 수 있게 한다 — 관리자→리포트는 같은 탭 전환, 리포트→관리자는 관리자 컨텍스트 바의 버튼.

**Architecture:** (A) admin의 "리포트 보기"를 새 탭(`window.open`)에서 같은 탭 이동(`location.href`)으로 변경하되 localStorage 버퍼 핸드오프는 유지. (B) 기존 미리보기 배너 `#preview-banner`를 관리자 컨텍스트 바 `#admin-bar`로 일반화해 `[관리자 화면으로]` 버튼을 달고, 부팅 시 `SCApi.currentUser()`로 관리자 세션을 감지하면 일반 리포트 화면에서도 바를 노출한다.

**Tech Stack:** Vanilla JS (빌드 없음), Supabase(기존), Node `vm` 기반 remote_smoke 테스트.

---

## File Structure

| 파일 | 변경 | 책임 |
| --- | --- | --- |
| `web/admin.js` | 수정 | `openReport` 같은 탭 이동·alert 정리, 버튼 라벨 |
| `web/index.html` | 수정 | `#preview-banner` → `#admin-bar` |
| `web/styles.css` | 수정 | `.preview-banner` → `.admin-bar`, 전환 버튼 스타일 |
| `web/app.js` | 수정 | `showPreviewBanner`→`renderAdminBar(opts)`, `checkAdminSession()` |
| `scripts/remote_smoke.js` | 수정 | 관리자 세션 감지 시 바 노출 / 학부모 시 미노출 검증 |

---

## Task 1: 관리자 → 리포트 같은 탭 전환 (admin.js)

**Files:**
- Modify: `web/admin.js` (`openReport`, 검색 결과 버튼 라벨)

- [ ] **Step 1: `openReport`를 같은 탭 이동으로 변경**

`web/admin.js`에서 현재 `openReport` 함수는 다음과 같다:
```js
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
```
마지막 두 줄(`var win = window.open(...)` 와 `if (!win) ...`)을 다음 한 줄로 **교체**:
```js
    window.location.href = "index.html"; // 같은 탭에서 리포트로 전환
```
결과 함수:
```js
  function openReport(student) {
    var corrSource = REMOTE
      ? corrMap
      : (window.SCCorr && window.SCCorr.loadAll ? window.SCCorr.loadAll() : {});
    var payload = window.SCPreview.buildPreviewPayload(student, DATA, corrSource);
    var ok = window.SCPreview.writeBuffer(payload);
    if (!ok) { window.alert("미리보기 데이터를 준비하지 못했습니다."); return; }
    window.location.href = "index.html"; // 같은 탭에서 리포트로 전환
  }
```

- [ ] **Step 2: 검색 결과 버튼 라벨 변경**

같은 파일 `renderReportResults` 안에서 현재:
```js
      var btn = el("button", "rs-open", "리포트 ↗");
```
를 다음으로 **교체**(새 탭을 의미하던 ↗ 제거):
```js
      var btn = el("button", "rs-open", "리포트 보기");
```

- [ ] **Step 3: 문법 검증**

Run: `node --check web/admin.js`
Expected: 출력 없이 종료 코드 0 (문법 정상).

- [ ] **Step 4: 커밋**

```bash
git add web/admin.js
git commit -m "feat: admin 학생 리포트를 같은 탭에서 열기(새 탭 폐지)"
```

---

## Task 2: 관리자 컨텍스트 바 + 세션 감지 (index.html / styles.css / app.js / remote_smoke)

`#preview-banner`를 `#admin-bar`로 일반화한다. 개명은 여러 파일에 걸쳐 원자적으로 한 커밋에 처리한다.

**Files:**
- Modify: `web/index.html` (배너 요소 id/class)
- Modify: `web/styles.css` (선택자 개명 + 버튼 스타일)
- Modify: `web/app.js` (`renderAdminBar`, `enterPreview` 호출, `checkAdminSession`, `init` 분기)
- Modify: `scripts/remote_smoke.js` (검증 추가)

- [ ] **Step 1: `web/index.html` — 배너 요소 개명**

현재(가) `<body>` 다음 줄):
```html
  <div id="preview-banner" class="preview-banner" hidden></div>
```
를 다음으로 **교체**:
```html
  <div id="admin-bar" class="admin-bar" hidden></div>
```

- [ ] **Step 2: `web/styles.css` — 선택자 개명 + 버튼 스타일**

현재 파일 끝(374–382줄)은 다음과 같다:
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
이 블록 전체를 다음으로 **교체**(`.preview-banner`→`.admin-bar`, 버튼 스타일 추가, `preview-mode` 규칙 유지):
```css
/* 관리자 컨텍스트 바 (미리보기 / 일반 관리자 세션 공용) */
.admin-bar { display:flex; align-items:center; gap:8px; flex-wrap:wrap;
  background:#fef3c7; border-bottom:2px solid #f59e0b; color:#7c2d12;
  padding:8px 14px; font-size:13px; position:sticky; top:0; z-index:50; }
.admin-bar .pv-tag { background:#b45309; color:#fff; border-radius:4px;
  padding:2px 8px; font-weight:700; font-size:12px; }
.admin-bar .pv-txt { font-weight:500; }
.admin-bar .pv-admin-btn { margin-left:auto; flex-shrink:0;
  background:#7c2d12; color:#fff; border:0; border-radius:6px;
  padding:6px 12px; font-size:13px; font-weight:600; cursor:pointer; }
.admin-bar .pv-admin-btn:hover { background:#601f0c; }
body.preview-mode #btn-logout { display:none; }
```

- [ ] **Step 3: `web/app.js` — `showPreviewBanner`를 `renderAdminBar`로 일반화**

현재(765–775줄):
```js
  /* ---------- 관리자 미리보기 모드 ---------- */
  function showPreviewBanner(student) {
    var b = $("preview-banner");
    if (!b) return;
    b.innerHTML = "";
    b.appendChild(el("span", "pv-tag", "관리자 미리보기"));
    var tx = el("span", "pv-txt");
    tx.textContent = (student.name || "") + " 학생 · 학부모에게 보이는 화면입니다.";
    b.appendChild(tx);
    b.hidden = false;
  }
```
를 다음으로 **교체**:
```js
  /* ---------- 관리자 컨텍스트 바 ---------- */
  // opts.preview: 미리보기 모드(학생 리포트) / 그 외: 일반 리포트 + 관리자 세션
  function renderAdminBar(opts) {
    opts = opts || {};
    var b = $("admin-bar");
    if (!b) return;
    b.innerHTML = "";
    if (opts.preview) {
      b.appendChild(el("span", "pv-tag", "관리자 미리보기"));
      var tx = el("span", "pv-txt");
      tx.textContent = ((opts.student && opts.student.name) || "") + " 학생 · 학부모에게 보이는 화면입니다.";
      b.appendChild(tx);
    } else {
      b.appendChild(el("span", "pv-tag", "관리자"));
      b.appendChild(el("span", "pv-txt", "관리자로 로그인된 상태입니다."));
    }
    var btn = el("button", "pv-admin-btn", "관리자 화면으로");
    btn.type = "button";
    btn.addEventListener("click", function () { window.location.href = "admin.html"; });
    b.appendChild(btn);
    b.hidden = false;
  }
```

- [ ] **Step 4: `web/app.js` — `enterPreview`에서 호출 변경**

현재 `enterPreview` 안의:
```js
    showPreviewBanner(p.student);
```
를 다음으로 **교체**:
```js
    renderAdminBar({ preview: true, student: p.student });
```

- [ ] **Step 5: `web/app.js` — `checkAdminSession` 추가**

`renderAdminBar` 함수 정의 **바로 아래**(`enterPreview` 위)에 추가:
```js
  // 일반 리포트 화면에서 관리자 Supabase 세션이 감지되면 관리자 바를 노출한다.
  function checkAdminSession() {
    if (!REMOTE || !window.SCApi || typeof window.SCApi.currentUser !== "function") return;
    window.SCApi.currentUser().then(function (u) {
      if (u) renderAdminBar({ preview: false });
    }).catch(function () {});
  }
```

- [ ] **Step 6: `web/app.js` — `init` 부팅 분기에서 호출**

현재 `init()` 끝의 분기:
```js
    } else {
      showView("view-login");
      restoreSession(); // 저장된 로그인 있으면 자동 복원(새로고침 유지)
    }
```
를 다음으로 **교체**(else 경로에 `checkAdminSession()` 추가):
```js
    } else {
      showView("view-login");
      restoreSession(); // 저장된 로그인 있으면 자동 복원(새로고침 유지)
      checkAdminSession(); // 관리자 세션이면 관리자 바 노출
    }
```

- [ ] **Step 7: `scripts/remote_smoke.js` — 학부모 흐름에 `currentUser` 모킹 + 검증 추가**

`parentTest`(또는 학부모 테스트 함수) 안에서 `windowObj` 정의 직전에 플래그 변수를 추가한다. 현재:
```js
  const windowObj = {
    scrollTo() {}, location: { search: "", protocol: "https:", hostname: "report.studycore.kr" },
    SCApi: {
      enabled: () => true,
      getReport: (name, phone) => { getReportArgs = { name, phone }; return Promise.resolve(name === "정훈" && phone === "9402" ? REPORT : null); },
    },
  };
```
를 다음으로 **교체**(플래그 + `currentUser` 모킹 추가):
```js
  let parentAdminSignedIn = false;
  const windowObj = {
    scrollTo() {}, location: { search: "", protocol: "https:", hostname: "report.studycore.kr" },
    SCApi: {
      enabled: () => true,
      getReport: (name, phone) => { getReportArgs = { name, phone }; return Promise.resolve(name === "정훈" && phone === "9402" ? REPORT : null); },
      currentUser: () => Promise.resolve(parentAdminSignedIn ? { email: "admin@studycore.kr" } : null),
    },
  };
```

- [ ] **Step 8: `scripts/remote_smoke.js` — 미노출/노출 검증 추가**

학부모 로그인 성공 검증 직후(현재 `assert(reg["view-calendar"].classList.contains("active"), "달력 화면 활성화");` 줄 다음)에 다음을 추가:
```js
  await tick(); // checkAdminSession(비동기) 완료 대기
  assert(reg["admin-bar"].hidden !== false, "학부모(관리자 세션 없음) → 관리자 바 미노출");
```

그리고 같은 함수의 "새로고침 자동 복원" 검증 블록(`reg2`/`ctx2`를 만드는 부분) **다음**, 함수가 끝나기 전에 관리자 세션 양성 케이스를 추가한다. 다음 블록을 그대로 삽입(새 `mkDoc`로 `doc3`/`reg3`를 따로 만들고, 빈 localStorage라 자동복원 없이 `checkAdminSession`만 동작):
```js
  // 관리자 세션이 있는 채로 리포트 페이지를 부팅하면 관리자 바가 노출된다
  parentAdminSignedIn = true;
  const emptyLS = { getItem: () => null, setItem() {}, removeItem() {} };
  const { reg: reg3, doc: doc3 } = mkDoc(PIDS, ["view-login", "view-calendar", "view-monthly"]);
  const ctx3 = { window: { scrollTo() {}, location: windowObj.location, SCApi: windowObj.SCApi }, document: doc3, Date, Math, console, setImmediate, localStorage: emptyLS };
  vm.createContext(ctx3);
  ["aggregate.js", "corrections.js", "app.js"].forEach(f => vm.runInContext(fs.readFileSync(path.join(WEB, f), "utf8"), ctx3));
  await tick();
  assert(reg3["admin-bar"].hidden === false, "관리자 세션 감지 → 관리자 바 노출");
  parentAdminSignedIn = false;
```
(이 케이스는 `localStorage`가 비어 있어 학부모 자동복원이 일어나지 않으므로 `view-login` 상태에서 `checkAdminSession`만 동작한다.)

- [ ] **Step 9: 테스트 실행 → 통과 확인**

Run: `node scripts/remote_smoke.js`
Expected: 전체 통과(`결과: 전체 통과 ✅`), 종료 코드 0. 새 assert 2개("학부모 … 미노출", "관리자 세션 감지 → 관리자 바 노출") 포함.

- [ ] **Step 10: 문법 검증**

Run: `node --check web/app.js`
Expected: 출력 없이 종료 코드 0.

- [ ] **Step 11: 커밋**

```bash
git add web/index.html web/styles.css web/app.js scripts/remote_smoke.js
git commit -m "feat: 리포트 화면 관리자 컨텍스트 바 + 세션 감지(관리자 화면 전환)"
```

---

## Task 3: 최종 회귀 검증

**Files:** (없음 — 검증만)

- [ ] **Step 1: 데이터 비의존 테스트 + 문법 전수 검증**

Run:
```
node scripts/preview_smoke.js
node scripts/remote_smoke.js
node --check web/admin.js
node --check web/app.js
```
Expected: 두 스모크 모두 `전체 통과`/종료 0, 두 `--check` 모두 종료 0.

- [ ] **Step 2: 잔존 참조 확인**

Run: `grep -rn "preview-banner\|showPreviewBanner" web/`
Expected: 결과 없음(개명 누락 없음). 만약 결과가 있으면 그 파일을 고치고 Task 2 검증을 다시 실행.

- [ ] **Step 3: 최종 커밋(필요 시)**

검증만 했고 코드 변경이 없으면 커밋 생략.

---

## Self-Review 결과

- **Spec coverage:**
  - A. 관리자→리포트 같은 탭 전환 + alert 제거 + 라벨 → Task 1.
  - B. `#preview-banner`→`#admin-bar` 개명 → Task 2 Step 1–2.
  - B. `renderAdminBar(opts)` 일반화(미리보기/일반 두 문구 + 버튼) → Task 2 Step 3–4.
  - B. `checkAdminSession()` 부팅 호출(REMOTE만) → Task 2 Step 5–6.
  - 로그아웃 구분(미리보기 숨김 / 일반 유지) → `body.preview-mode`는 `enterPreview`에서만 추가, `checkAdminSession`은 추가하지 않음(기존 코드 유지) + CSS 규칙 유지(Task 2 Step 2).
  - 노출 매트릭스(학부모/로컬 미노출) → `checkAdminSession`의 REMOTE·currentUser 가드 + remote_smoke 검증(Task 2 Step 7–9).
- **Placeholder scan:** 모든 코드 단계에 실제 코드 포함. Step 8은 정확한 최종 블록을 명시(애매한 1차 스니펫은 폐기하고 "정확한 블록"을 사용하도록 지시).
- **Type consistency:** `renderAdminBar`(opts.preview/opts.student), `checkAdminSession`, `#admin-bar`, `.admin-bar`, `.pv-admin-btn`, `parentAdminSignedIn` — 정의와 사용처 일치 확인. `el(tag, cls, html)`의 html 인자는 정적 문자열에만 사용(동적 `student.name`은 textContent 유지).
