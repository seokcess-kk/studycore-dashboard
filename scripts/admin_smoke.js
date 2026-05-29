/* 원장용 보정 페이지(admin.js) 흐름 검증 — 목록→모달→계산→저장 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const WEB = path.join(__dirname, "..", "web");

function makeEl(tag) {
  return {
    tagName: tag, className: "", _html: "", value: "", hidden: false, open: false,
    textContent: "", style: {}, attrs: {}, children: [], _handlers: {},
    set innerHTML(v) { this._html = v; if (v === "") this.children = []; },
    get innerHTML() { return this._html; },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(ev, fn) { (this._handlers[ev] = this._handlers[ev] || []).push(fn); },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k] != null ? this.attrs[k] : null; },
    classList: { _s: {}, add(...c) { c.forEach(x => this._s[x] = true); }, remove(...c) { c.forEach(x => delete this._s[x]); }, contains(x) { return !!this._s[x]; } },
  };
}
const IDS = ["admin-stats", "hide-done", "filter-month", "flag-list",
  "corr-modal", "corr-target", "corr-input", "btn-calc", "btn-clear", "corr-result",
  "file-input", "upload-drop", "btn-pick", "upload-fname", "upload-msg", "upload-preview", "loaded-info"];
const registry = {};
IDS.forEach(id => { registry[id] = makeEl("div"); });

const document = {
  getElementById: id => registry[id] || (registry[id] = makeEl("div")),
  createElement: tag => makeEl(tag),
  querySelectorAll: () => [],
  addEventListener() {},
  body: makeEl("body"),
};
const windowObj = {};
const _ls = {};
const localStorage = { getItem: k => (k in _ls ? _ls[k] : null), setItem: (k, v) => { _ls[k] = String(v); }, removeItem: k => { delete _ls[k]; } };

// data.js는 빈 플레이스홀더 → inout_raw에서 직접 빌드해 주입
const X = require(path.join(WEB, "vendor", "xlsx.full.min.js"));
const I = require(path.join(WEB, "ingest.js"));
const _rows = X.utils.sheet_to_json(
  X.read(fs.readFileSync(path.join(__dirname, "..", "inout_raw.xlsx")), { type: "buffer" }).Sheets["Sheet1"],
  { header: 1, raw: true, defval: null });
const _built = I.buildFromRows(_rows);
I.assignPhones(_built.dataset.students);

const ctx = { window: windowObj, document, Date, Math, console, localStorage };
vm.createContext(ctx);
windowObj.STUDYCORE_DATA = _built.dataset;
vm.runInContext(fs.readFileSync(path.join(WEB, "dataset.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(WEB, "aggregate.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(WEB, "corrections.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(WEB, "admin.js"), "utf8"), ctx);

function fire(elm, ev, arg) { (elm._handlers[ev] || []).forEach(fn => fn(arg || { preventDefault() {}, target: {} })); }
function findButtons(node, out) {
  if (!node || typeof node !== "object") return out;
  if (node.tagName === "button" && node._handlers.click) out.push(node);
  (node.children || []).forEach(c => findButtons(c, out));
  return out;
}
function assert(c, m) { if (!c) { console.error("  ✗ FAIL: " + m); process.exitCode = 1; } else { console.log("  ✓ " + m); } }

const C = windowObj.SCCorr;

console.log("== 미체크 목록 ==");
assert(registry["flag-list"].children.length > 0, "플래그 목록 렌더 (" + registry["flag-list"].children.length + " 그룹)");
assert(registry["admin-stats"].children.length === 1, "통계 요약 카드 1개(남은 항목만)");
const _statV = registry["admin-stats"].children[0].children[0]._html;
assert(/^\d+$/.test(String(_statV)) && Number(_statV) > 0, "남은 항목 수 표시: " + _statV);

console.log("== 보정 모달 → 계산 → 저장 ==");
const rowBtns = findButtons(registry["flag-list"], []);
assert(rowBtns.length > 0, "보정 버튼 " + rowBtns.length + "개");
fire(rowBtns[0], "click");
assert(registry["corr-modal"].hidden === false, "모달 열림");
assert(registry["corr-target"]._html.length > 0, "대상 표시: " + registry["corr-target"]._html.replace(/<[^>]+>/g, ""));

registry["corr-input"].value = [
  "입장\t19:59:46", "외출\t20:20:47", "재입장\t20:26:30", "외출\t22:02:11",
  "재입장\t22:09:16", "외출\t22:49:27", "재입장\t22:55:14", "외출\t23:51:10", "강제퇴장\t0:55:05",
].join("\n");
fire(registry["btn-calc"], "click");
assert(!registry["corr-result"].className.includes("err"), "계산 결과 정상(오류 아님)");

const before = C.count();
const saveBtns = findButtons(registry["corr-result"], []);
assert(saveBtns.length === 1, "저장 버튼 노출");
fire(saveBtns[0], "click");
assert(C.count() === before + 1, "localStorage 보정 1건 저장됨");
assert(registry["corr-modal"].hidden === true, "저장 후 모달 닫힘");

const saved = Object.values(C.loadAll())[0];
assert(C.clock(saved.netSec) === "03:32:49", "저장된 순공부 03:32:49");

console.log("== 잘못된 입력 처리 ==");
fire(rowBtns[0], "click");
registry["corr-input"].value = "이상한 텍스트";
fire(registry["btn-calc"], "click");
assert(registry["corr-result"].className.includes("err"), "파싱 불가 입력 → 에러 표시");

console.log(process.exitCode ? "\n결과: 실패 있음" : "\n결과: 전체 통과 ✅");
