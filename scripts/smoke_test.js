/* 경량 DOM 목으로 app.js 렌더링 경로를 끝까지 실행 검증 (브라우저 없이) */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WEB = path.join(__dirname, "..", "web");

/* ---------- 미니 DOM ---------- */
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

const IDS = ["view-login", "view-calendar", "view-monthly", "day-modal", "day-modal-body",
  "in-name", "in-phone", "login-error", "login-form", "demo-list",
  "cal-student", "cal-meta", "btn-logout", "prev-month", "next-month", "cal-month-title",
  "summary-grid", "calendar", "class-compare", "btn-monthly",
  "btn-back-cal", "monthly-title", "monthly-body"];

const registry = {};
IDS.forEach(id => { registry[id] = makeEl("div"); });
["view-login", "view-calendar", "view-monthly"].forEach(id => { registry[id].className = "view"; });

const docHandlers = {};
const document = {
  getElementById: id => registry[id] || (registry[id] = makeEl("div")),
  createElement: tag => makeEl(tag),
  querySelectorAll: sel => sel === ".view"
    ? ["view-login", "view-calendar", "view-monthly"].map(id => registry[id]) : [],
  addEventListener: (ev, fn) => { (docHandlers[ev] = docHandlers[ev] || []).push(fn); },
  body: makeEl("body"),
};
const windowObj = { scrollTo() {} };
const _ls = {};
const localStorage = {
  getItem: k => (k in _ls ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: k => { delete _ls[k]; },
};

/* ---------- 데이터 빌드 (data.js는 빈 플레이스홀더 → inout_raw에서 직접) ---------- */
const X = require(path.join(WEB, "vendor", "xlsx.full.min.js"));
const I = require(path.join(WEB, "ingest.js"));
const _rows = X.utils.sheet_to_json(
  X.read(fs.readFileSync(path.join(__dirname, "..", "inout_raw.xlsx")), { type: "buffer" }).Sheets["Sheet1"],
  { header: 1, raw: true, defval: null });
const _built = I.buildFromRows(_rows);
I.assignPhones(_built.dataset.students);

/* ---------- 컨텍스트 구성 & 코드 로드 ---------- */
const ctx = { window: windowObj, document, Date, Math, console, localStorage };
vm.createContext(ctx);
windowObj.STUDYCORE_DATA = _built.dataset; // 번들 data.js 대신 주입
vm.runInContext(fs.readFileSync(path.join(WEB, "dataset.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(WEB, "aggregate.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(WEB, "corrections.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(WEB, "app.js"), "utf8"), ctx);

/* ---------- 헬퍼 ---------- */
function fire(elm, ev, arg) {
  (elm._handlers[ev] || []).forEach(fn => fn(arg || { preventDefault() {}, target: { getAttribute: () => "1" } }));
}
function collectClickables(node, out) {
  if (!node || typeof node !== "object") return;
  if (node._handlers && node._handlers.click) out.push(node);
  (node.children || []).forEach(c => collectClickables(c, out));
}
function countByHtml(node, html, acc) {
  acc = acc || { n: 0 };
  if (!node || typeof node !== "object") return acc.n;
  if (node._html === html) acc.n++;
  (node.children || []).forEach(c => countByHtml(c, html, acc));
  return acc.n;
}
function login(student) {
  registry["in-name"].value = student.name;
  registry["in-phone"].value = student.phoneLast4;
  fire(registry["login-form"], "submit");
}
function assert(cond, msg) { if (!cond) { console.error("  ✗ FAIL: " + msg); process.exitCode = 1; } else { console.log("  ✓ " + msg); } }

const D = windowObj.STUDYCORE_DATA;
console.log("== 데이터 ==");
assert(D && D.students.length === 47, "학생 47명 로드");
const demo = D.students.find(s => s.name === "정훈");

console.log("== 로그인 (오류 케이스) ==");
registry["in-name"].value = "정훈"; registry["in-phone"].value = "0000";
fire(registry["login-form"], "submit");
assert(registry["login-error"].hidden === false, "잘못된 뒷4자리 → 에러 표시");

console.log("== 로그인 (정상) → 달력 ==");
registry["in-name"].value = demo.name; registry["in-phone"].value = demo.phoneLast4;
fire(registry["login-form"], "submit");
assert(registry["view-calendar"].classList.contains("active"), "달력 화면 활성화");
assert(registry["cal-student"].textContent.includes("정훈"), "학생 이름 표시: " + registry["cal-student"].textContent);
assert(registry["summary-grid"].children.length === 4, "요약 카드 4개");
assert(registry["cal-month-title"].textContent === "2026년 4월", "월 타이틀: " + registry["cal-month-title"].textContent);
assert(registry["prev-month"].hidden !== undefined, "이전달 버튼 존재");
const clickables = [];
collectClickables(registry["calendar"], clickables);
assert(clickables.length > 0, "클릭 가능한 날짜 셀 " + clickables.length + "개");
assert(registry["class-compare"].children.length >= 2, "반 평균 비교 렌더");

console.log("== 일자 상세 모달 ==");
fire(clickables[clickables.length - 1], "click");  // 마지막(=빠른 날짜) 셀
assert(registry["day-modal"].hidden === false, "모달 열림");
assert(registry["day-modal-body"].children.length > 0, "모달 본문 렌더 (" + registry["day-modal-body"].children.length + " 블록)");

console.log("== 월간 상세 ==");
fire(registry["btn-monthly"], "click");
assert(registry["view-monthly"].classList.contains("active"), "월간 화면 활성화");
assert(registry["monthly-body"].children.length === 6, "월간 섹션 6개 (" + registry["monthly-body"].children.length + ")");
assert(registry["monthly-title"].textContent.includes("정훈"), "월간 타이틀: " + registry["monthly-title"].textContent);

console.log("== 잠정 집계 + 보정 반영 ==");
const baekmin = D.students.find(s => s.name === "백민우");
login(baekmin);
const before = countByHtml(registry["calendar"], "⚠️");
assert(before === 4, "백민우 잠정(⚠️) 셀 " + before + "개 (자동퇴장 4일)");
// 잠정일: 체류(입장~최종퇴장)=4:55:19를 잠정 순공부로
const c427 = baekmin.months["2026-04"].days["2026-04-27"];
assert(c427.netSec === 4 * 3600 + 55 * 60 + 19 && c427.goodNetSec === 0, "4/27 체류=잠정순공부 4:55:19 (net " + c427.netSec + ")");
// 4/27 보정 저장 (정확 순공부 = 3:32:49, 외출 차감)
const C = windowObj.SCCorr;
const r = C.parseEventLog([
  "입장\t19:59:46", "외출\t20:20:47", "재입장\t20:26:30", "외출\t22:02:11",
  "재입장\t22:09:16", "외출\t22:49:27", "재입장\t22:55:14", "외출\t23:51:10", "강제퇴장\t0:55:05",
].join("\n"));
assert(r.ok && C.clock(r.netSec) === "03:32:49", "파서 계산 03:32:49");
C.save("백민우", "2026-04-27", { netSec: r.netSec, totalSec: r.totalSec, excludedSec: r.excludedSec, outings: r.outings, firstIn: r.firstIn, lastOut: r.lastOut, events: r.events });
login(baekmin); // 재조회 → 보정 반영
const afterWarn = countByHtml(registry["calendar"], "⚠️");
const checks = countByHtml(registry["calendar"], "✓");
assert(afterWarn === before - 1, "보정 후 잠정(⚠️) 1개 감소 (" + before + "→" + afterWarn + ")");
assert(checks >= 1, "보정 ✓ 배지 표시 (" + checks + "개)");
// 보정 삭제 후 원복 확인
C.remove("백민우", "2026-04-27");
login(baekmin);
assert(countByHtml(registry["calendar"], "⚠️") === before, "보정 삭제 시 잠정 원복");

console.log("== 전 학생 렌더 (런타임 오류 스캔) ==");
let okAll = true;
for (const s of D.students) {
  try {
    registry["in-name"].value = s.name; registry["in-phone"].value = s.phoneLast4;
    fire(registry["login-form"], "submit");
    fire(registry["btn-monthly"], "click");
    const cc = []; collectClickables(registry["calendar"], cc);
    cc.forEach(c => fire(c, "click"));
  } catch (e) { okAll = false; console.error("  ✗ " + s.name + ": " + e.message); }
}
assert(okAll, "47명 전원 달력+모달+월간 렌더 무오류");

console.log(process.exitCode ? "\n결과: 실패 있음" : "\n결과: 전체 통과 ✅");
