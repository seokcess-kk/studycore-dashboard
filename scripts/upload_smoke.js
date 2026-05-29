/* 업로드 흐름 통합 검증: 2개월 데이터셋을 localStorage에 반영 후
 * 학부모 앱이 그 데이터로 동작하고 '전월 대비'가 켜지는지 확인 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const WEB = path.join(__dirname, "..", "web");
const X = require(path.join(WEB, "vendor", "xlsx.full.min.js"));

/* --- 부모 앱 DOM 목 --- */
function makeEl(tag) {
  return {
    tagName: tag, className: "", _html: "", value: "", hidden: false, disabled: false,
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
  "in-name", "in-phone", "login-error", "login-form", "demo-list",
  "cal-student", "cal-meta", "btn-logout", "prev-month", "next-month", "cal-month-title",
  "summary-grid", "calendar", "class-compare", "btn-monthly", "btn-back-cal", "monthly-title", "monthly-body"];
const registry = {};
IDS.forEach(id => { registry[id] = makeEl("div"); });
["view-login", "view-calendar", "view-monthly"].forEach(id => { registry[id].className = "view"; });
const document = {
  getElementById: id => registry[id] || (registry[id] = makeEl("div")),
  createElement: t => makeEl(t),
  querySelectorAll: s => s === ".view" ? ["view-login", "view-calendar", "view-monthly"].map(i => registry[i]) : [],
  addEventListener() {}, body: makeEl("body"),
};
const windowObj = { scrollTo() {} };
const _ls = {};
const localStorage = { getItem: k => (k in _ls ? _ls[k] : null), setItem: (k, v) => { _ls[k] = String(v); }, removeItem: k => { delete _ls[k]; } };

const ctx = { window: windowObj, document, Date, Math, console, localStorage, TextEncoder };
vm.createContext(ctx);
function run(f) { vm.runInContext(fs.readFileSync(path.join(WEB, f), "utf8"), ctx); }

function assert(c, m) { if (!c) { console.error("  ✗ FAIL: " + m); process.exitCode = 1; } else { console.log("  ✓ " + m); } }
function fire(elm, ev, arg) { (elm._handlers[ev] || []).forEach(fn => fn(arg || { preventDefault() {} })); }
function gatherHtml(node, acc) { acc = acc || []; if (!node) return acc; if (node._html) acc.push(node._html); (node.children || []).forEach(c => gatherHtml(c, acc)); return acc; }

// 1) 모듈 로드 (앱 제외)
run("data.js"); run("dataset.js"); run("aggregate.js"); run("ingest.js"); run("corrections.js");

// 2) 4월 + 위조 3월 빌드·병합·저장 (앱 로드 전에 localStorage 세팅)
const buf = fs.readFileSync(path.join(__dirname, "..", "inout_raw.xlsx"));
const rows = X.utils.sheet_to_json(X.read(buf, { type: "buffer" }).Sheets["Sheet1"], { header: 1, raw: true, defval: null });
const april = ctx.window.SCIngest.buildFromRows(rows);
const marchRows = rows.map((r, i) => { if (i === 0) return r.slice(); const c = r.slice(); c[3] = String(c[3]).replace("2026-04", "2026-03"); return c; });
const march = ctx.window.SCIngest.buildFromRows(marchRows);
const merged = ctx.window.SCIngest.merge(april.dataset, march.dataset);
ctx.window.SCDataset.save(merged);
assert(ctx.window.SCDataset.isUploaded(), "업로드 데이터셋 저장됨");
assert(JSON.stringify(ctx.window.SCDataset.active().months) === JSON.stringify(["2026-03", "2026-04"]), "active = 2개월");

// 3) 앱 로드 → 업로드 데이터로 동작
run("app.js");
const D = ctx.window.SCDataset.active();
const stu = D.students.find(s => s.name === "정훈");
registry["in-name"].value = stu.name; registry["in-phone"].value = stu.phoneLast4;
fire(registry["login-form"], "submit");

assert(registry["view-calendar"].classList.contains("active"), "로그인→달력 (업로드 데이터)");
assert(registry["cal-month-title"].textContent === "2026년 4월", "최신월 4월 표시: " + registry["cal-month-title"].textContent);
assert(registry["prev-month"].disabled === false, "이전달(3월) 버튼 활성 → 전월 대비 가능");

const txt = gatherHtml(registry["summary-grid"]).join(" ");
assert(txt.indexOf("지난달 데이터 없음") === -1, "‘지난달 데이터 없음’ 사라짐");
assert(/[▲▼]\s*\d+%|·\s*\d*%|delta/.test(txt) || txt.indexOf("지난달 대비") !== -1, "전월 대비 영역 렌더");

// 4) 3월로 이동 가능
fire(registry["prev-month"], "click");
assert(registry["cal-month-title"].textContent === "2026년 3월", "3월로 이동: " + registry["cal-month-title"].textContent);

console.log(process.exitCode ? "\n결과: 실패 있음" : "\n결과: 전체 통과 ✅");
