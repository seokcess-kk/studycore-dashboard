/* 연도별 월 그래프(달력 상단) 검증 — 여러 달 / 지표 토글 / 막대 클릭 이동 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WEB = path.join(__dirname, "..", "web");

/* ---------- 미니 DOM (smoke_test.js와 동일 패턴) ---------- */
function makeEl(tag) {
  return {
    tagName: tag, className: "", _html: "", value: "", type: "",
    hidden: false, textContent: "", style: {}, attrs: {},
    children: [], _handlers: {},
    set innerHTML(v) { this._html = v; if (v === "") this.children = []; },
    get innerHTML() { return this._html; },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(ev, fn) { (this._handlers[ev] = this._handlers[ev] || []).push(fn); },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k] != null ? this.attrs[k] : null; },
    classList: {
      _s: {},
      add(...c) { c.forEach(x => this._s[x] = true); },
      remove(...c) { c.forEach(x => delete this._s[x]); },
      contains(x) { return !!this._s[x]; },
    },
  };
}
const registry = {};
const document = {
  getElementById: id => registry[id] || (registry[id] = makeEl("div")),
  createElement: tag => makeEl(tag),
  querySelectorAll: sel => sel === ".view"
    ? ["view-login", "view-calendar", "view-monthly"].map(id => document.getElementById(id)) : [],
  addEventListener: () => {},
  body: makeEl("body"),
};
["view-login", "view-calendar", "view-monthly"].forEach(id => { document.getElementById(id).className = "view"; });
const windowObj = { scrollTo() {} };
const _ls = {};
const localStorage = { getItem: k => (k in _ls ? _ls[k] : null), setItem: (k, v) => { _ls[k] = String(v); }, removeItem: k => { delete _ls[k]; } };

/* ---------- 데이터: inout_raw(4월) → 가상 3월 복제로 2개월 구성 ---------- */
const X = require(path.join(WEB, "vendor", "xlsx.full.min.js"));
const I = require(path.join(WEB, "ingest.js"));
const _rows = X.utils.sheet_to_json(
  X.read(fs.readFileSync(path.join(__dirname, "..", "inout_raw.xlsx")), { type: "buffer" }).Sheets["Sheet1"],
  { header: 1, raw: true, defval: null });
const built = I.buildFromRows(_rows);
I.assignPhones(built.dataset.students);
const D = built.dataset;

// 테스트 학생(정훈)에 가상 3월 추가 — 4월을 80%로 축소 복제(막대 높이 차이)
const stu = D.students.find(s => s.name === "정훈");
const apr = stu.months["2026-04"];
const mar = JSON.parse(JSON.stringify(apr));
Object.keys(mar.days).forEach(d => {
  const day = mar.days[d];
  ["netSec", "totalSec", "goodNetSec", "goodTotalSec"].forEach(k => { if (day[k] != null) day[k] = Math.round(day[k] * 0.8); });
});
stu.months["2026-03"] = mar;
D.months = ["2026-03", "2026-04"];
D.openDays["2026-03"] = (D.openDays["2026-04"] || []).slice();

/* ---------- 컨텍스트 구성 & 로드 ---------- */
const ctx = { window: windowObj, document, Date, Math, console, localStorage };
vm.createContext(ctx);
windowObj.STUDYCORE_DATA = D;
["dataset.js", "aggregate.js", "corrections.js", "app.js"].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(WEB, f), "utf8"), ctx));

/* ---------- 헬퍼 ---------- */
function fire(elm, ev) { (elm._handlers[ev] || []).forEach(fn => fn({ preventDefault() {}, target: { getAttribute: () => "1" } })); }
function walk(node, pred, out) { if (!node || typeof node !== "object") return out; if (pred(node)) out.push(node); (node.children || []).forEach(c => walk(c, pred, out)); return out; }
function byClass(root, cls) { return walk(root, n => typeof n.className === "string" && (" " + n.className + " ").indexOf(" " + cls + " ") >= 0, []); }
function assert(cond, msg) { if (!cond) { console.error("  ✗ FAIL: " + msg); process.exitCode = 1; } else { console.log("  ✓ " + msg); } }

/* ---------- 시나리오 ---------- */
const g = id => document.getElementById(id);
g("in-name").value = stu.name;
g("in-phone").value = stu.phoneLast4;
fire(g("login-form"), "submit");

console.log("== 연도 그래프 렌더 (2개월: 3·4월) ==");
const yc = g("year-chart");
const cells = byClass(yc, "yc-cell");
assert(cells.length === 12, "막대 12개(1~12월) 렌더 (" + cells.length + ")");
const hasCells = cells.filter(c => c.className.indexOf("has") >= 0);
assert(hasCells.length === 2, "데이터 있는 달 2개 활성(클릭 가능) (" + hasCells.length + ")");
const curCells = byClass(yc, "yc-cell").filter(c => c.className.indexOf("current") >= 0);
assert(curCells.length === 1, "현재 달 강조 1개");
assert(g("cal-month-title").textContent === "2026년 4월", "기본 진입 = 최신월(4월): " + g("cal-month-title").textContent);
const labels = byClass(yc, "yc-val");
assert(labels.length === 2 && /h$/.test(labels[0]._html), "막대 수치 라벨(시간) 표시: " + labels.map(l => l._html).join(", "));

console.log("== 지표 토글: 월 합계 → 하루 평균 ==");
let title = byClass(yc, "yc-title")[0];
assert(title._html.indexOf("월 합계") >= 0, "초기 지표 = 월 합계");
const dailyBtn = byClass(yc, "yc-toggle")[0].children.find(b => b._html === "하루 평균");
fire(dailyBtn, "click");
title = byClass(g("year-chart"), "yc-title")[0];
assert(title._html.indexOf("학습일 하루 평균") >= 0, "토글 후 지표 = 학습일 하루 평균");
const onBtn = byClass(g("year-chart"), "yc-toggle")[0].children.find(b => b.className === "on");
assert(onBtn && onBtn._html === "하루 평균", "활성 토글 버튼 = 하루 평균");

console.log("== 막대 클릭 → 그 달 달력으로 이동 ==");
// 4월이 현재이므로, 현재가 아닌 'has' 셀(=3월) 클릭
const marCell = byClass(g("year-chart"), "yc-cell").find(c => c.className.indexOf("has") >= 0 && c.className.indexOf("current") < 0);
fire(marCell, "click");
assert(g("cal-month-title").textContent === "2026년 3월", "3월 막대 클릭 → 달력 3월로 이동: " + g("cal-month-title").textContent);
const curAfter = byClass(g("year-chart"), "yc-cell").filter(c => c.className.indexOf("current") >= 0);
assert(curAfter.length === 1, "이동 후에도 현재 달 강조 1개(3월로 이동)");

console.log("\n결과: " + (process.exitCode ? "실패 ❌" : "전체 통과 ✅"));
