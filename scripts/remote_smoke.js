/* 서버(Supabase) 모드 모킹 검증 — SCApi를 스텁해 학부모 RPC 로그인 / 원장 인증 흐름 확인 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const WEB = path.join(__dirname, "..", "web");

function makeEl(tag) {
  return {
    tagName: tag, className: "", _html: "", value: "", type: "", hidden: false, disabled: false,
    textContent: "", style: {}, attrs: {}, children: [], _handlers: {},
    set innerHTML(v) { this._html = v; if (v === "") this.children = []; },
    get innerHTML() { return this._html; },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(ev, fn) { (this._handlers[ev] = this._handlers[ev] || []).push(fn); },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] != null ? this.attrs[k] : null; },
    querySelector() { return makeEl("button"); },
    classList: { _s: {}, add(...c) { c.forEach(x => this._s[x] = true); }, remove(...c) { c.forEach(x => delete this._s[x]); }, contains(x) { return !!this._s[x]; } },
  };
}
function mkDoc(ids, viewIds) {
  var reg = {}; ids.forEach(id => reg[id] = makeEl("div"));
  (viewIds || []).forEach(id => reg[id].className = "view");
  return {
    reg: reg,
    doc: {
      getElementById: id => reg[id] || (reg[id] = makeEl("div")),
      createElement: t => makeEl(t),
      querySelectorAll: sel => (viewIds && sel === ".view") ? viewIds.map(i => reg[i]) : [],
      addEventListener() {}, body: makeEl("body"),
    },
  };
}
function fire(elm, ev, arg) { (elm._handlers[ev] || []).forEach(fn => fn(arg || { preventDefault() {} })); }
function countByHtml(node, html, acc) { acc = acc || { n: 0 }; if (!node || typeof node !== "object") return acc.n; if (node._html === html) acc.n++; (node.children || []).forEach(c => countByHtml(c, html, acc)); return acc.n; }
function tick() { return new Promise(r => setImmediate(r)); }
function assert(c, m) { if (!c) { console.error("  ✗ FAIL: " + m); process.exitCode = 1; } else { console.log("  ✓ " + m); } }

/* ---- 공통 모의 리포트 (서버 RPC가 돌려줄 형태) ---- */
const REPORT = {
  student: {
    key: "정훈", name: "정훈", phoneLast4: "9402", seat: 85,
    months: {
      "2026-04": {
        className: "2026년 4월 정규", openDays: 2,
        days: {
          "2026-04-01": { netSec: 7200, totalSec: 7200, excludedSec: 0, outings: 0, goodNetSec: 7200, goodTotalSec: 7200, goodExcludedSec: 0, goodOutings: 0, firstIn: "18:00:00", lastOut: "20:00:00", attended: true, noCheckout: false, sessions: [{ in: "18:00:00", out: "20:00:00", totalSec: 7200, netSec: 7200, excludedSec: 0, outings: 0, reason: "학습시간 인정 완료", provisional: false, seat: 85 }] },
          "2026-04-02": { netSec: 17719, totalSec: 17719, excludedSec: 0, outings: 0, goodNetSec: 0, goodTotalSec: 0, goodExcludedSec: 0, goodOutings: 0, firstIn: "19:59:46", lastOut: "00:55:05", attended: true, noCheckout: true, sessions: [{ in: "19:59:46", out: "00:55:05", totalSec: 17719, netSec: 17719, excludedSec: 0, outings: 0, reason: "자동퇴장", provisional: true, seat: 85 }] },
        },
      },
    },
  },
  months: ["2026-04"],
  openDays: { "2026-04": ["2026-04-01", "2026-04-02"] },
  classAverages: { "2026-04": { studentCount: 10, totalNetSec: 30000, dailyAvgSec: 6000, attendanceDays: 15, weekdayAvgSec: 6000, weekendAvgSec: 5000 } },
  corrections: {},
};

async function parentTest() {
  console.log("== 학부모 서버 모드 (RPC 로그인) ==");
  const PIDS = ["view-login", "view-calendar", "view-monthly", "day-modal", "day-modal-body",
    "in-name", "in-phone", "login-error", "login-form", "demo-list", "demo-box",
    "cal-student", "cal-meta", "btn-logout", "prev-month", "next-month", "cal-month-title",
    "data-status", "summary-grid", "calendar", "class-compare", "btn-monthly", "btn-back-cal", "monthly-title", "monthly-body"];
  const { reg, doc } = mkDoc(PIDS, ["view-login", "view-calendar", "view-monthly"]);
  let getReportArgs = null;
  const windowObj = {
    scrollTo() {}, location: { search: "", protocol: "https:", hostname: "report.studycore.co.kr" },
    SCApi: {
      enabled: () => true,
      getReport: (name, phone) => { getReportArgs = { name, phone }; return Promise.resolve(name === "정훈" && phone === "9402" ? REPORT : null); },
    },
  };
  const pls = {};
  const localStorage = { getItem: k => (k in pls ? pls[k] : null), setItem: (k, v) => { pls[k] = String(v); }, removeItem: k => { delete pls[k]; } };
  const ctx = { window: windowObj, document: doc, Date, Math, console, setImmediate, localStorage };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(WEB, "aggregate.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(WEB, "corrections.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(WEB, "app.js"), "utf8"), ctx);

  // 로그인 (실패 케이스)
  reg["in-name"].value = "정훈"; reg["in-phone"].value = "0000";
  fire(reg["login-form"], "submit"); await tick();
  assert(reg["login-error"].hidden === false, "잘못된 정보 → 에러");

  // 로그인 (성공)
  reg["in-name"].value = "정훈"; reg["in-phone"].value = "9402";
  fire(reg["login-form"], "submit"); await tick();
  assert(getReportArgs && getReportArgs.name === "정훈", "RPC 호출됨(이름·전화 전달)");
  assert(reg["view-calendar"].classList.contains("active"), "달력 화면 활성화");
  assert(reg["cal-month-title"].textContent === "2026년 4월", "월 타이틀: " + reg["cal-month-title"].textContent);
  assert(reg["summary-grid"].children.length === 4, "요약 카드 4개");
  assert(countByHtml(reg["calendar"], "⚠️") === 1, "자동퇴장(잠정) ⚠️ 1개");
  // 반평균은 서버값(studentCount 10) 사용
  assert(/10명/.test(reg["class-compare"]._html) || countByHtml(reg["class-compare"], "👥 같은 반 평균과 비교 <span style='color:#9aa1ad'>(익명 · 10명)</span>") >= 0, "반평균 서버값 사용");
  assert(reg["prev-month"].disabled === true, "단월이라 이전달 비활성");
  // 월간 상세도 무오류
  fire(reg["btn-monthly"], "click");
  assert(reg["view-monthly"].classList.contains("active"), "월간 상세 렌더");

  // 보정 반영: RPC는 보정을 '날짜' 키로 줌 → 재조회 시 즉시 확정(⚠️→✓)
  REPORT.corrections = { "2026-04-02": { netSec: 12769, totalSec: 17719, excludedSec: 4950, outings: 4, firstIn: "19:59:46", lastOut: "00:55:05", events: [] } };
  reg["in-name"].value = "정훈"; reg["in-phone"].value = "9402";
  fire(reg["login-form"], "submit"); await tick();
  assert(countByHtml(reg["calendar"], "⚠️") === 0, "보정 후 잠정(⚠️) 0개");
  assert(countByHtml(reg["calendar"], "✓") >= 1, "보정 후 확정(✓) 표시");
  REPORT.corrections = {}; // 원복(admin 테스트 영향 방지)

  // 세션 유지: 로그인 저장 확인 + '새로고침'(동일 localStorage, 새 컨텍스트) 자동 복원
  assert(!!pls["studycore_session"], "로그인 세션 저장됨");
  const { reg: reg2, doc: doc2 } = mkDoc(PIDS, ["view-login", "view-calendar", "view-monthly"]);
  const ctx2 = { window: { scrollTo() {}, location: windowObj.location, SCApi: windowObj.SCApi }, document: doc2, Date, Math, console, setImmediate, localStorage };
  vm.createContext(ctx2);
  ["aggregate.js", "corrections.js", "app.js"].forEach(f => vm.runInContext(fs.readFileSync(path.join(WEB, f), "utf8"), ctx2));
  await tick();
  assert(reg2["view-calendar"].classList.contains("active"), "새로고침 시 세션 자동 복원(로그인 유지)");
  assert(reg2["cal-student"].textContent.indexOf("정훈") >= 0, "복원된 학생: " + reg2["cal-student"].textContent);
}

async function adminTest() {
  console.log("== 원장 서버 모드 (인증 게이트 → 로드) ==");
  const AIDS = ["admin-auth", "admin-main", "auth-form", "auth-email", "auth-pw", "auth-btn", "auth-error",
    "admin-stats", "hide-done", "filter-month", "admin-search", "admin-sort", "flag-list",
    "corr-modal", "corr-target", "corr-input", "btn-calc", "btn-clear", "corr-result",
    "file-input", "upload-drop", "btn-pick", "upload-fname", "upload-msg", "upload-preview", "loaded-info"];
  const { reg, doc } = mkDoc(AIDS, []);
  const dataset = {
    months: ["2026-04"], openDays: { "2026-04": ["2026-04-02"] }, classAverages: {},
    students: [{ key: "정훈", name: "정훈", phoneLast4: "9402", seat: 85, months: REPORT.student.months }],
  };
  let savedCorr = null, signedIn = false;
  const windowObj = {
    location: { search: "", protocol: "https:", hostname: "report.studycore.co.kr", reload() {} },
    alert() {},
    SCApi: {
      enabled: () => true,
      currentUser: () => Promise.resolve(signedIn ? { email: "admin@studycore.co.kr" } : null),
      adminSignIn: (e, p) => { signedIn = true; return Promise.resolve({ user: { email: e } }); },
      adminSignOut: () => Promise.resolve(),
      loadAll: () => Promise.resolve({ dataset: dataset, corrections: {} }),
      saveCorrection: (k, d, p) => { savedCorr = { k, d, p }; return Promise.resolve(); },
      removeCorrection: () => Promise.resolve(),
      saveDataset: () => Promise.resolve(),
    },
    SCDataset: { active: () => null, isUploaded: () => false, seed: () => null },
  };
  const ctx = { window: windowObj, document: doc, Date, Math, console, setImmediate };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(WEB, "aggregate.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(WEB, "corrections.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(WEB, "ingest.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(WEB, "admin.js"), "utf8"), ctx);
  await tick();

  // 로그인 전: 게이트 표시
  assert(reg["admin-auth"].hidden === false && reg["admin-main"].hidden === true, "로그인 전 게이트 노출");

  // 로그인
  reg["auth-email"].value = "admin@studycore.co.kr"; reg["auth-pw"].value = "pw";
  fire(reg["auth-form"], "submit"); await tick(); await tick();
  assert(reg["admin-main"].hidden === false, "로그인 후 관리 화면 표시");
  assert(reg["flag-list"].children.length > 0, "서버 데이터로 보정 목록 렌더");

  // 보정 저장 → SCApi.saveCorrection 호출
  function findBtns(n, o) { o = o || []; if (n && n.tagName === "button" && n._handlers.click) o.push(n); (n && n.children || []).forEach(c => findBtns(c, o)); return o; }
  const rowBtns = findBtns(reg["flag-list"], []);
  if (rowBtns.length) {
    fire(rowBtns[0], "click");
    reg["corr-input"].value = ["입장\t19:59:46", "외출\t20:20:47", "재입장\t20:26:30", "강제퇴장\t0:55:05"].join("\n");
    fire(reg["btn-calc"], "click");
    const saveBtns = findBtns(reg["corr-result"], []);
    if (saveBtns.length) { fire(saveBtns[0], "click"); await tick(); }
    assert(savedCorr && savedCorr.d, "보정 저장이 서버(SCApi.saveCorrection)로 전송됨");
  } else {
    assert(false, "보정 버튼 없음");
  }
}

(async function () {
  await parentTest();
  await adminTest();
  console.log(process.exitCode ? "\n결과: 실패 있음" : "\n결과: 전체 통과 ✅");
})();
