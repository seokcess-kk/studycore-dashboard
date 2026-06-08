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
