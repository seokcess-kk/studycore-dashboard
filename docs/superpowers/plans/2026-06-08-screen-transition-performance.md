# 화면 전환 속도 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자 ↔ 리포트 화면 전환의 체감 로딩을 줄인다 — 세션 확인 네트워크 왕복 제거(getSession), loadAll 병렬화, 관리자 데이터 stale-while-revalidate 캐싱.

**Architecture:** (1) `scapi.js`의 `currentUser`를 `getUser`(서버 왕복)→`getSession`(로컬 즉시)으로, `loadAll`의 3쿼리를 순차→`Promise.all`로. (2) 신규 `datacache.js`(`window.SCCache`)가 loadAll 결과를 sessionStorage에 캐시. (3) `admin.js`는 캐시가 있으면 즉시 렌더 후 백그라운드로 loadAll 갱신하고, 저장 시 캐시를 무효화. 재렌더는 setup(이벤트 바인딩, 1회)과 데이터 렌더(반복)로 분리해 리스너 중복을 막는다.

**Tech Stack:** Vanilla JS (빌드 없음), Supabase, Node 기반 스모크 테스트.

---

## File Structure

| 파일 | 변경 | 책임 |
| --- | --- | --- |
| `web/datacache.js` | 신규 | sessionStorage 캐시 get/set/clear (`window.SCCache` + module.exports) |
| `scripts/datacache_smoke.js` | 신규 | datacache 단위 테스트 |
| `web/scapi.js` | 수정 | `currentUser`→getSession, `loadAll` 병렬화 |
| `web/admin.html` | 수정 | `datacache.js` script 로드 |
| `web/admin.js` | 수정 | 재렌더 분리, 캐시 우선 렌더 + 백그라운드 갱신, 저장 시 무효화 |

---

## Task 1: 캐시 모듈 `datacache.js` + 단위 테스트

**Files:**
- Create: `web/datacache.js`
- Test: `scripts/datacache_smoke.js`

- [ ] **Step 1: 실패하는 테스트 작성** — Create `scripts/datacache_smoke.js`:

```js
/* datacache.js 검증 — sessionStorage 캐시 get/set/clear + 안전 폴백 */
const path = require("path");
const C = require(path.join(__dirname, "..", "web", "datacache.js"));

function assert(c, m) { if (!c) { console.error("  ✗ FAIL: " + m); process.exitCode = 1; } else { console.log("  ✓ " + m); } }
function mkStore() {
  var m = {};
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
    setItem: function (k, v) { m[k] = String(v); },
    removeItem: function (k) { delete m[k]; },
  };
}

console.log("== get/set/clear ==");
global.window = { sessionStorage: mkStore() };
assert(C.get() === null, "초기 캐시 없음 → null");
const data = { dataset: { months: ["2026-04"], students: [{ key: "a" }] }, corrections: { "a|2026-04-01": { events: [] } } };
assert(C.set(data) === true, "set 성공 → true");
const got = C.get();
assert(got && got.dataset.months[0] === "2026-04", "get 라운드트립");
assert(got.corrections["a|2026-04-01"], "corrections 보존");
C.clear();
assert(C.get() === null, "clear 후 null");

console.log("== set 실패 안전 폴백 ==");
global.window = { sessionStorage: { getItem: function () { return null; }, setItem: function () { throw new Error("QuotaExceeded"); }, removeItem: function () {} } };
assert(C.set(data) === false, "용량 초과 시 set → false");
assert(C.get() === null, "저장 실패라 get → null");

console.log("== 손상된 캐시 안전 처리 ==");
global.window = { sessionStorage: { getItem: function () { return "{not json"; }, setItem: function () {}, removeItem: function () {} } };
assert(C.get() === null, "JSON 파싱 실패 → null");

delete global.window;
console.log("\n완료");
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `node scripts/datacache_smoke.js`
Expected: FAIL — `Cannot find module '.../web/datacache.js'`

- [ ] **Step 3: `web/datacache.js` 구현** — Create:

```js
/* 관리자 데이터셋 캐시(stale-while-revalidate) — window.SCCache
 * loadAll 결과({ dataset, corrections })를 sessionStorage에 저장해 재방문 시 즉시 렌더.
 * 저장 실패(용량 초과 등)·손상 캐시는 안전하게 null/false로 폴백한다.
 */
(function () {
  "use strict";
  var KEY = "studycore_admin_dataset";

  function get() {
    try {
      var raw = window.sessionStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function set(data) {
    try { window.sessionStorage.setItem(KEY, JSON.stringify(data)); return true; }
    catch (e) { return false; }
  }
  function clear() {
    try { window.sessionStorage.removeItem(KEY); } catch (e) {}
  }

  var api = { KEY: KEY, get: get, set: set, clear: clear };
  if (typeof window !== "undefined") window.SCCache = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `node scripts/datacache_smoke.js`
Expected: PASS — 모든 `✓`, 마지막 "완료", 종료 코드 0.

- [ ] **Step 5: 커밋**

```bash
git add web/datacache.js scripts/datacache_smoke.js
git commit -m "feat: 관리자 데이터셋 캐시 모듈(datacache.js) + 단위 테스트"
```

---

## Task 2: `scapi.js` — getSession 전환 + loadAll 병렬화

**Files:**
- Modify: `web/scapi.js` (`currentUser`, `loadAll`)

- [ ] **Step 1: `currentUser`를 getSession으로**

`web/scapi.js`의 현재:
```js
  async function currentUser() {
    var r = await client().auth.getUser();
    return (r.data && r.data.user) || null;
  }
```
를 다음으로 **교체**:
```js
  // UI 게이트 결정용 — getSession은 로컬 토큰을 즉시 반환(네트워크 왕복 없음).
  // 실제 데이터 접근은 RLS가 보호하고, 만료 토큰은 autoRefreshToken으로 갱신된다.
  async function currentUser() {
    var r = await client().auth.getSession();
    return (r.data && r.data.session && r.data.session.user) || null;
  }
```

- [ ] **Step 2: `loadAll`의 3쿼리를 병렬화**

현재:
```js
  async function loadAll() {
    var metaR = await client().from("rpt_meta").select("*").eq("id", 1).maybeSingle();
    if (metaR.error) throw metaR.error;
    var stuR = await client().from("rpt_students").select("*");
    if (stuR.error) throw stuR.error;
    var corrR = await client().from("rpt_corrections").select("*");
    if (corrR.error) throw corrR.error;
```
이 첫 7줄(함수 선언 다음부터 `if (corrR.error) throw corrR.error;`까지)을 다음으로 **교체**(이후 매핑 코드는 그대로 둔다):
```js
  async function loadAll() {
    var results = await Promise.all([
      client().from("rpt_meta").select("*").eq("id", 1).maybeSingle(),
      client().from("rpt_students").select("*"),
      client().from("rpt_corrections").select("*"),
    ]);
    var metaR = results[0], stuR = results[1], corrR = results[2];
    if (metaR.error) throw metaR.error;
    if (stuR.error) throw stuR.error;
    if (corrR.error) throw corrR.error;
```

- [ ] **Step 3: 문법 검증**

Run: `node --check web/scapi.js`
Expected: 종료 코드 0, 출력 없음.

- [ ] **Step 4: 회귀 — 학부모/원장 서버 흐름 무결**

Run: `node scripts/remote_smoke.js`
Expected: `결과: 전체 통과 ✅`, 종료 0. (remote_smoke는 `SCApi`를 모킹하므로 이 변경은 직접 안 잡히지만, 모듈 문법/로드가 깨지지 않았는지 확인.)

- [ ] **Step 5: 커밋**

```bash
git add web/scapi.js
git commit -m "perf: currentUser를 getSession으로(네트워크 왕복 제거) + loadAll 병렬화"
```

---

## Task 3: `admin.js` 재렌더 분리 + 캐시 우선 렌더/백그라운드 갱신 + 무효화

캐시 우선 렌더를 안전하게 하려면 "setup(이벤트 바인딩, 1회)"과 "데이터 렌더(반복)"를 분리해야 한다. 현재 `initMonthFilter`는 옵션 채우기와 `change` 리스너 바인딩을 함께 하므로 재호출 시 리스너가 중복된다. 먼저 이를 분리한다.

**Files:**
- Modify: `web/admin.html` (datacache.js 로드)
- Modify: `web/admin.js` (분리·캐싱·무효화)

- [ ] **Step 1: `web/admin.html` — datacache.js 로드**

`<script src="preview.js"></script>` 줄 바로 아래에 추가:
```html
  <script src="datacache.js"></script>
```
(결과: `preview.js` → `datacache.js` → `corrections.js` → `admin.js`)

- [ ] **Step 2: `web/admin.js` — `initMonthFilter`를 `fillMonthFilter`(옵션만)로 분리**

현재:
```js
  function initMonthFilter() {
    var sel = $("filter-month");
    sel.innerHTML = "<option value='all'>전체 월</option>";
    DATA.months.forEach(function (m) {
      var o = document.createElement("option"); o.value = m;
      o.textContent = (+m.slice(0, 4)) + "년 " + (+m.slice(5, 7)) + "월";
      sel.appendChild(o);
    });
    sel.addEventListener("change", function () { monthFilter = sel.value; renderList(); });
  }
```
를 다음으로 **교체**(리스너 바인딩 제거 — 옵션 채우기만, 멱등):
```js
  // 월 필터 옵션만 채운다(멱등). change 리스너는 startApp에서 1회 바인딩.
  function fillMonthFilter() {
    var sel = $("filter-month");
    sel.innerHTML = "<option value='all'>전체 월</option>";
    DATA.months.forEach(function (m) {
      var o = document.createElement("option"); o.value = m;
      o.textContent = (+m.slice(0, 4)) + "년 " + (+m.slice(5, 7)) + "월";
      sel.appendChild(o);
    });
  }
```

- [ ] **Step 3: `web/admin.js` — `setupUpload` 끝의 `renderLoadedInfo()` 제거**

`setupUpload` 함수 끝부분에 있는 단독 호출 라인:
```js
    renderLoadedInfo();
```
을 **삭제**한다(데이터 렌더는 아래 `renderData`로 이관 — setup은 이벤트 바인딩만).

- [ ] **Step 4: `web/admin.js` — `renderData` 추가 + `startApp` 재구성**

현재:
```js
  // 데이터 준비된 뒤 화면 구성
  function startApp() {
    setupUpload();
    setupRoster();
    initMonthFilter();
    renderList();
    renderReportResults();
  }
```
를 다음으로 **교체**:
```js
  // 데이터 의존 렌더만(이벤트 바인딩 없음 — 백그라운드 갱신 때 재호출해도 안전)
  function renderData() {
    fillMonthFilter();
    renderList();
    renderReportResults();
    renderLoadedInfo();
  }
  // 최초 1회: 이벤트 바인딩(setup) + 첫 렌더. 재호출 금지(리스너 중복).
  function startApp() {
    setupUpload();
    setupRoster();
    $("filter-month").addEventListener("change", function () { monthFilter = $("filter-month").value; renderList(); });
    renderData();
  }
```

- [ ] **Step 5: `web/admin.js` — `revealMain` 추출 + `afterLogin` 캐싱 흐름**

현재:
```js
  function afterLogin() {
    return window.SCApi.loadAll().then(function (r) {
      DATA = r.dataset; corrMap = r.corrections || {};
      var chk = $("admin-checking"); if (chk) chk.hidden = true;
      $("admin-auth").hidden = true; $("admin-main").hidden = false;
      startApp();
    }).catch(function (ex) {
      var err = $("auth-error");
      err.textContent = "데이터를 불러오지 못했습니다: " + (ex.message || ex); err.hidden = false;
      showLoginGate();
      var b = $("auth-btn"); if (b) { b.disabled = false; b.classList.remove("is-busy"); }
      if (window.console) console.error(ex);
    });
  }
```
를 다음으로 **교체**:
```js
  function revealMain() {
    var chk = $("admin-checking"); if (chk) chk.hidden = true;
    $("admin-auth").hidden = true; $("admin-main").hidden = false;
  }

  function afterLogin() {
    // 캐시가 있으면 즉시 렌더(체감 0 지연) 후 백그라운드로 최신 데이터 갱신.
    var cached = window.SCCache ? window.SCCache.get() : null;
    if (cached && cached.dataset) {
      DATA = cached.dataset; corrMap = cached.corrections || {};
      revealMain();
      startApp();
      window.SCApi.loadAll().then(function (r) {
        DATA = r.dataset; corrMap = r.corrections || {};
        if (window.SCCache) window.SCCache.set(r);
        renderData(); // 리스너 재바인딩 없이 목록만 갱신
      }).catch(function () { /* 백그라운드 실패는 캐시 화면 유지 */ });
      return Promise.resolve();
    }
    return window.SCApi.loadAll().then(function (r) {
      DATA = r.dataset; corrMap = r.corrections || {};
      if (window.SCCache) window.SCCache.set(r);
      revealMain();
      startApp();
    }).catch(function (ex) {
      var err = $("auth-error");
      err.textContent = "데이터를 불러오지 못했습니다: " + (ex.message || ex); err.hidden = false;
      showLoginGate();
      var b = $("auth-btn"); if (b) { b.disabled = false; b.classList.remove("is-busy"); }
      if (window.console) console.error(ex);
    });
  }
```

- [ ] **Step 6: `web/admin.js` — 저장/로그아웃 시 캐시 무효화**

저장 성공 시 캐시를 비워 다음 진입이 최신을 받게 한다. 다음 4곳에 `if (window.SCCache) window.SCCache.clear();`를 추가한다.

(a) **보정 저장** — 현재:
```js
        window.SCApi.saveCorrection(key, date, payload).then(function () {
          corrMap[key + "|" + date] = payload; closeModal(); renderList();
```
를:
```js
        window.SCApi.saveCorrection(key, date, payload).then(function () {
          if (window.SCCache) window.SCCache.clear();
          corrMap[key + "|" + date] = payload; closeModal(); renderList();
```

(b) **보정 삭제**(`wireHandlers`의 `btn-clear`) — 현재:
```js
        window.SCApi.removeCorrection(key, date).then(function () {
          delete corrMap[key + "|" + date]; closeModal(); renderList();
```
를:
```js
        window.SCApi.removeCorrection(key, date).then(function () {
          if (window.SCCache) window.SCCache.clear();
          delete corrMap[key + "|" + date]; closeModal(); renderList();
```

(c) **로그아웃**(`renderLoadedInfo` 안) — 현재:
```js
      out.addEventListener("click", function () { window.SCApi.adminSignOut().then(function () { window.location.reload(); }); });
```
를:
```js
      out.addEventListener("click", function () { if (window.SCCache) window.SCCache.clear(); window.SCApi.adminSignOut().then(function () { window.location.reload(); }); });
```

(d) **엑셀 업로드 반영** — `saveDataset` 성공 콜백. 현재:
```js
        window.SCApi.saveDataset(merged).then(function () {
          uMsg("반영했습니다. 화면을 새로고침합니다.", "ok");
          window.setTimeout(function () { window.location.reload(); }, 700);
```
를:
```js
        window.SCApi.saveDataset(merged).then(function () {
          if (window.SCCache) window.SCCache.clear();
          uMsg("반영했습니다. 화면을 새로고침합니다.", "ok");
          window.setTimeout(function () { window.location.reload(); }, 700);
```

(e) **명부 반영** — `applyRoster`의 `saveDataset` 성공 콜백. 현재:
```js
      window.SCApi.saveDataset(res.dataset).then(function () {
        rMsg("명부를 반영했습니다. 화면을 새로고침합니다.", "ok");
        window.setTimeout(function () { window.location.reload(); }, 700);
```
를:
```js
      window.SCApi.saveDataset(res.dataset).then(function () {
        if (window.SCCache) window.SCCache.clear();
        rMsg("명부를 반영했습니다. 화면을 새로고침합니다.", "ok");
        window.setTimeout(function () { window.location.reload(); }, 700);
```

- [ ] **Step 7: 문법 검증**

Run: `node --check web/admin.js`
Expected: 종료 코드 0.

- [ ] **Step 8: 회귀 — 원장 서버 흐름 무결**

Run: `node scripts/remote_smoke.js`
Expected: `결과: 전체 통과 ✅`, 종료 0.

`remote_smoke`의 admin 테스트 컨텍스트에는 `SCCache`(datacache.js)가 로드돼 있지 않다. `admin.js`는 `window.SCCache ? ... : null` / `if (window.SCCache)` 가드로 감싸므로, 캐시 없음 경로(기존 동작: `loadAll` 1회 → `revealMain` → `startApp`)로 떨어져 기존 assert를 그대로 통과해야 한다. 만약 깨지면 가드 누락이므로 수정한다.

- [ ] **Step 9: 커밋**

```bash
git add web/admin.html web/admin.js
git commit -m "perf: admin 데이터 캐시 우선 렌더 + 백그라운드 갱신, 재렌더 분리·무효화"
```

---

## Task 4: 최종 회귀 검증

**Files:** (없음 — 검증만)

- [ ] **Step 1: 전체 스모크 + 문법**

Run:
```
node scripts/datacache_smoke.js
node scripts/preview_smoke.js
node scripts/remote_smoke.js
node --check web/scapi.js
node --check web/admin.js
node --check web/datacache.js
```
Expected: 세 스모크 모두 통과/종료 0, 세 `--check` 모두 종료 0.

- [ ] **Step 2: 캐시 가드 일관성 확인**

Run: `grep -n "SCCache" web/admin.js`
Expected: 모든 사용처가 `window.SCCache` 존재 가드로 감싸져 있음(`if (window.SCCache)` 또는 `window.SCCache ? ... : null`). 맨몸 `SCCache.` 호출이 없어야 함.

- [ ] **Step 3: 최종 커밋(필요 시)** — 검증만 했고 변경 없으면 생략.

---

## Self-Review 결과

- **Spec coverage:**
  - 1. getSession 전환 → Task 2 Step 1.
  - 2. loadAll 병렬화 → Task 2 Step 2.
  - 3. 캐시 모듈(SCCache get/set/clear, 안전 폴백) → Task 1.
  - 3. 캐시 우선 렌더 + 백그라운드 갱신 → Task 3 Step 5.
  - 3. 재렌더 분리(startApp 1회 + renderData 반복, fillMonthFilter 멱등화) → Task 3 Step 2·4 (+ setupUpload의 renderLoadedInfo 이관 Step 3).
  - 3. 무효화(보정 저장/삭제·업로드·명부·로그아웃) → Task 3 Step 6.
  - 4. 폰트/스크립트 제외 → 작업 없음(의도).
- **Placeholder scan:** 모든 코드 단계에 실제 코드 포함. 없음.
- **Type consistency:** `SCCache.get/set/clear`, `fillMonthFilter`, `renderData`, `revealMain` — 정의(Task 1·3)와 사용처 일치. `afterLogin`이 `renderData`/`startApp`/`revealMain`을 올바른 순서로 호출. `loadAll` 반환 형태(`{dataset, corrections}`)는 캐시 set/get과 admin 소비에서 일관.
- **무효화 누락 점검:** `saveClassAverages`는 admin.js에서 호출되지 않으므로(grep 확인) 무효화 대상 아님. 로컬 모드 `reset`(264)은 REMOTE 캐시와 무관해 제외.
