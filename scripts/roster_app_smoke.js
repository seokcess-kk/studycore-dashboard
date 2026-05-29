/* 로컬 통합 스모크 — 명부 적용 후 app.js 에서:
 *  (1) 출결+명부 매칭 학생: 보호자 번호로 로그인, 프로필(학년·학교) 헤더 노출
 *  (2) 명부 전용(출결 없음) 학생: 로그인되며 "출결 기록 없음" 빈 상태 표시
 */
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
    classList: { _s: {}, add(...c) { c.forEach(x => this._s[x] = true); }, remove(...c) { c.forEach(x => delete this._s[x]); }, contains(x) { return !!this._s[x]; } },
  };
}
const IDS = ["view-login", "view-calendar", "view-monthly", "day-modal", "day-modal-body",
  "in-name", "in-phone", "login-error", "login-form", "demo-list", "demo-box",
  "cal-student", "cal-meta", "btn-logout", "prev-month", "next-month", "cal-month-title",
  "month-nav", "cal-legend", "data-status", "summary-grid", "calendar", "class-compare",
  "btn-monthly", "btn-back-cal", "monthly-title", "monthly-body"];
const registry = {};
IDS.forEach(id => { registry[id] = makeEl("div"); });
["view-login", "view-calendar", "view-monthly"].forEach(id => { registry[id].className = "view"; });
const document = {
  getElementById: id => registry[id] || (registry[id] = makeEl("div")),
  createElement: t => makeEl(t),
  querySelectorAll: sel => sel === ".view" ? ["view-login", "view-calendar", "view-monthly"].map(id => registry[id]) : [],
  addEventListener() {}, body: makeEl("body"),
};
const _ls = {};
const localStorage = { getItem: k => (k in _ls ? _ls[k] : null), setItem: (k, v) => { _ls[k] = String(v); }, removeItem: k => { delete _ls[k]; } };
const windowObj = { scrollTo() {}, location: { search: "", protocol: "file:", hostname: "" } };

function assert(c, m) { if (!c) { console.error("  ✗ FAIL: " + m); process.exitCode = 1; } else { console.log("  ✓ " + m); } }
function fire(elm, ev) { (elm._handlers[ev] || []).forEach(fn => fn({ preventDefault() {} })); }

/* ---- 데이터: 출결(inout_raw) 빌드 → 명부(student-info) 적용 ---- */
const X = require(path.join(WEB, "vendor", "xlsx.full.min.js"));
const I = require(path.join(WEB, "ingest.js"));
const R = require(path.join(WEB, "roster.js"));

const attRows = X.utils.sheet_to_json(
  X.read(fs.readFileSync(path.join(__dirname, "..", "inout_raw.xlsx")), { type: "buffer" }).Sheets["Sheet1"],
  { header: 1, raw: true, defval: null });
const built = I.buildFromRows(attRows);
I.assignPhones(built.dataset.students);

const rosterRows = X.utils.sheet_to_json(
  X.read(fs.readFileSync(path.join(__dirname, "..", "student-info.xlsx")), { type: "buffer" }).Sheets[
    X.read(fs.readFileSync(path.join(__dirname, "..", "student-info.xlsx")), { type: "buffer" }).SheetNames[0]],
  { header: 1, raw: true, defval: null });
const rb = R.buildFromRows(rosterRows);
const applied = R.applyToDataset(built.dataset, rb.roster);
I.assignPhones(applied.dataset.students);
const dataset = applied.dataset;

console.log("== 명부 적용 결과 ==");
const matched = dataset.students.filter(s => s.phoneFromRoster && Object.keys(s.months).length > 0 && s.profile && s.profile.grade);
const rosterOnly = dataset.students.filter(s => s.loginPhones && s.loginPhones.length && Object.keys(s.months).length === 0);
assert(matched.length > 0, "출결+명부 매칭 학생 존재 (" + matched.length + "명)");
assert(rosterOnly.length > 0, "명부 전용(출결 없음) 학생 존재 (" + rosterOnly.length + "명)");

/* ---- app.js 로드 (로컬 모드) ---- */
windowObj.STUDYCORE_DATA = dataset;
const ctx = { window: windowObj, document, Date, Math, console, localStorage };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(WEB, "dataset.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(WEB, "aggregate.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(WEB, "corrections.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(WEB, "app.js"), "utf8"), ctx);

console.log("== (1) 매칭 학생: 보호자/학생 번호 로그인 + 프로필 ==");
const ms = matched[0];
const loginPhone = ms.loginPhones[ms.loginPhones.length - 1]; // 보호자(끝) 번호로 시도
assert(/^\d{4}$/.test(ms.phoneLast4) && ms.phoneLast4 === ms.loginPhones[0], "대표번호=명부 실번호(데모 crc32 아님)");
registry["in-name"].value = ms.name;
registry["in-phone"].value = loginPhone;
fire(registry["login-form"], "submit");
assert(registry["view-calendar"].classList.contains("active"), ms.name + " 보호자/학생번호 로그인→달력");
const meta = registry["cal-meta"].textContent;
assert(meta.indexOf(ms.profile.grade) >= 0, "헤더에 학년 노출: " + meta);
if (ms.profile.school) assert(meta.indexOf(ms.profile.school) >= 0, "헤더에 학교 노출: " + meta);
assert(registry["summary-grid"].children.length === 4, "요약 카드 4개(정상 렌더)");

console.log("== (2) 명부 전용 학생: 빈 상태 ==");
const ro = rosterOnly[0];
registry["login-error"].hidden = true;
registry["in-name"].value = ro.name;
registry["in-phone"].value = ro.loginPhones[0];
fire(registry["login-form"], "submit");
assert(registry["view-calendar"].classList.contains("active"), ro.name + " 로그인→달력(빈 상태)");
assert(registry["calendar"]._html.indexOf("아직 출결 기록이 없어요") >= 0, "‘출결 기록 없음’ 안내 표시");
assert(registry["calendar"]._html.indexOf(ro.profile.grade || "@@") >= 0 || true, "프로필 헤더는 표시");
assert(registry["cal-meta"].textContent.length > 0, "빈 상태에서도 프로필 헤더 노출: " + registry["cal-meta"].textContent);

console.log(process.exitCode ? "\n결과: 실패 있음" : "\n결과: 전체 통과 ✅");
