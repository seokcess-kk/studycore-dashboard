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
