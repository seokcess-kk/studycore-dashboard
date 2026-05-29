/* roster.js 검증 — 명부 파싱 / 출결 매칭 / 명부 전화 고정 / 동명이인 좌석 매칭 */
const fs = require("fs");
const path = require("path");
const X = require(path.join(__dirname, "..", "web", "vendor", "xlsx.full.min.js"));
const R = require(path.join(__dirname, "..", "web", "roster.js"));
const I = require(path.join(__dirname, "..", "web", "ingest.js"));

function assert(c, m) { if (!c) { console.error("  ✗ FAIL: " + m); process.exitCode = 1; } else { console.log("  ✓ " + m); } }

console.log("== 명부 파싱(student-info.xlsx) ==");
const buf = fs.readFileSync(path.join(__dirname, "..", "student-info.xlsx"));
const wb = X.read(buf, { type: "buffer" });
const rows = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
const built = R.buildFromRows(rows);
assert(built.ok, "명부 빌드 성공");
assert(built.summary.count === 138, "학생 수 138 (실제: " + built.summary.count + ")");

const kjm = built.roster.find(s => s.name === "강정민");
assert(!!kjm, "강정민 존재");
assert(JSON.stringify(kjm.loginPhones) === JSON.stringify(["2703", "9801"]),
  "강정민 loginPhones=[학생2703,보호자9801] (실제: " + JSON.stringify(kjm.loginPhones) + ")");
assert(kjm.profile.grade === "고1" && kjm.profile.school === "빛고을고" && kjm.profile.status === "재원",
  "강정민 프로필 학년/학교/상태");

console.log("== 출결 데이터에 명부 적용 ==");
const base = {
  months: ["2026-04"], openDays: { "2026-04": ["2026-04-01"] }, classAverages: {},
  students: [
    { key: "강정민", name: "강정민", seat: 29, phoneLast4: "0000", months: { "2026-04": { className: "정규", openDays: 1, days: {} } } },
    { key: "테스트무명", name: "테스트무명", seat: 7, phoneLast4: "1111", months: { "2026-04": { className: "정규", openDays: 1, days: {} } } },
  ],
};
const res = R.applyToDataset(base, built.roster);
assert(res.report.matched === 1, "출결 매칭 1명(강정민) (실제: " + res.report.matched + ")");
assert(res.report.rosterOnly === 137, "명부전용 신규 137명 (실제: " + res.report.rosterOnly + ")");

const kjm2 = res.dataset.students.find(s => s.key === "강정민");
assert(kjm2.phoneFromRoster === true && kjm2.phoneLast4 === "2703", "강정민 전화 명부값 2703으로 교체");
assert(kjm2.profile && kjm2.profile.school === "빛고을고", "강정민 프로필 부착");
assert(Object.keys(kjm2.months).length === 1, "강정민 출결(4월) 보존");

const newbie = res.dataset.students.find(s => s.name === "강혜진");
assert(newbie && Object.keys(newbie.months).length === 0, "강혜진 명부전용(출결 없음)");
// 강혜진은 학생/보호자 번호 끝4자리가 동일(2812) → 중복 제거되어 1개
assert(newbie.loginPhones.length === 1 && newbie.loginPhones[0] === "2812", "강혜진 끝4자리 동일 → 중복 제거(2812)");
// 고유민은 끝4자리가 달라(7009/7069) 2개
const gym = res.dataset.students.find(s => s.name === "고유민");
assert(gym && JSON.stringify(gym.loginPhones) === JSON.stringify(["7009", "7069"]), "고유민 loginPhones 2개(7009,7069)");

console.log("== assignPhones: 명부 전화 고정, 무명은 crc32 ==");
I.assignPhones(res.dataset.students);
assert(kjm2.phoneLast4 === "2703", "assignPhones 후에도 강정민=2703 고정");
const nameless = res.dataset.students.find(s => s.name === "테스트무명");
assert(/^\d{4}$/.test(nameless.phoneLast4) && nameless.phoneLast4 !== "0000", "무명 학생은 crc32 데모번호로 채워짐");
assert(res.dataset.students.every(s => /^\d{4}$/.test(s.phoneLast4)), "전 학생 phoneLast4 4자리 보유");

console.log("== 로그인 매칭(둘 중 아무거나) ==");
function loginMatch(student, phone) {
  return (student.loginPhones && student.loginPhones.indexOf(phone) >= 0) || student.phoneLast4 === phone;
}
assert(loginMatch(kjm2, "2703"), "강정민 학생번호 2703 로그인");
assert(loginMatch(kjm2, "9801"), "강정민 보호자번호 9801 로그인");
assert(!loginMatch(kjm2, "0000"), "옛 데모번호 0000은 더 이상 매칭 안 됨");

console.log("== 동명이인: 좌석으로 매칭 ==");
const base2 = {
  months: ["2026-04"], openDays: {}, classAverages: {},
  students: [
    { key: "쌍둥이#10", name: "쌍둥이", seat: 10, phoneLast4: "aaaa", months: { "2026-04": { days: {} } } },
    { key: "쌍둥이#20", name: "쌍둥이", seat: 20, phoneLast4: "bbbb", months: { "2026-04": { days: {} } } },
  ],
};
const twinRoster = [
  { name: "쌍둥이", seat: 20, phoneStudent: "010-0000-7777", phoneGuardian: null, loginPhones: ["7777"],
    profile: { grade: "고2", school: "테스트고", status: "재원" } },
];
const res2 = R.applyToDataset(base2, twinRoster);
assert(res2.report.matched === 1 && res2.report.rosterOnly === 0, "동명이인 1명 매칭, 신규 0");
const seat20 = base2.students.find(s => s.key === "쌍둥이#20");
const seat10 = base2.students.find(s => s.key === "쌍둥이#10");
assert(seat20.phoneLast4 === "7777" && seat20.phoneFromRoster, "좌석20 쌍둥이에 명부 적용");
assert(seat10.phoneLast4 === "aaaa" && !seat10.phoneFromRoster, "좌석10 쌍둥이는 그대로");

console.log("\n명부 테스트 완료.");
