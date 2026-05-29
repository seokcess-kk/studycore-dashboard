/* ingest.js 병합 검증 — 4월 + (가짜)3월 → 2개월 누적, 전화뒷4 유일성 */
const fs = require("fs");
const path = require("path");
const X = require(path.join(__dirname, "..", "web", "vendor", "xlsx.full.min.js"));
const I = require(path.join(__dirname, "..", "web", "ingest.js"));

function assert(c, m) { if (!c) { console.error("  ✗ FAIL: " + m); process.exitCode = 1; } else { console.log("  ✓ " + m); } }

const buf = fs.readFileSync(path.join(__dirname, "..", "inout_raw.xlsx"));
const wb = X.read(buf, { type: "buffer" });
const rows = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });

const april = I.buildFromRows(rows);
assert(april.ok, "4월 빌드 성공");

// 3월 위조: 날짜 prefix 교체
const marchRows = rows.map((r, i) => {
  if (i === 0) return r.slice();
  const c = r.slice();
  c[3] = String(c[3]).replace("2026-04", "2026-03");
  return c;
});
const march = I.buildFromRows(marchRows);
assert(march.ok && march.summary.months[0] === "2026-03", "3월(위조) 빌드");

console.log("== 병합 ==");
const merged = I.merge(april.dataset, march.dataset);
assert(JSON.stringify(merged.months) === JSON.stringify(["2026-03", "2026-04"]), "months = [3월,4월]: " + merged.months);
assert(merged.openDays["2026-03"] && merged.openDays["2026-04"], "openDays 양쪽 존재");

const sample = merged.students.find(s => s.name === "정훈");
assert(sample.months["2026-03"] && sample.months["2026-04"], "정훈 2개월 보유");

// 전화뒷4 유일성 + 할당
const phones = merged.students.map(s => s.phoneLast4);
assert(phones.every(p => /^\d{4}$/.test(p)), "전 학생 전화뒷4 4자리");
assert(new Set(phones).size === phones.length, "전화뒷4 중복 없음 (" + phones.length + "명)");

// 같은 달 재병합 → 멱등 (월 수 불변)
const merged2 = I.merge(merged, march.dataset);
assert(JSON.stringify(merged2.months) === JSON.stringify(["2026-03", "2026-04"]), "동월 재업로드 시 월 수 불변");
assert(Object.keys(merged2.students.find(s => s.name === "정훈").months).length === 2, "재병합 후에도 정훈 2개월");

console.log("== 잠정(체류=입장~최종퇴장) / good 필드 ==");
const STAY427 = 4 * 3600 + 55 * 60 + 19; // 19:59:46~00:55:05
const bday = april.dataset.students.find(s => s.name === "백민우").months["2026-04"].days["2026-04-27"];
assert(bday.netSec === STAY427 && bday.totalSec === STAY427 && bday.goodNetSec === 0,
  "자동퇴장일: 체류=잠정순공부 4:55:19 (net " + bday.netSec + ")");
assert(bday.sessions[0].provisional === true && bday.sessions[0].netSec === STAY427, "자동퇴장 세션 provisional·net=체류");
const gday = april.dataset.students.find(s => s.name === "정훈").months["2026-04"].days["2026-04-30"];
assert(gday.goodNetSec === gday.netSec && gday.netSec > 0, "정상일 good===net");

console.log("== 강제퇴장 분할 병합 (최종 퇴장 기준) ==");
const sy = april.dataset.students.find(s => s.name === "신윤호").months["2026-04"].days["2026-04-26"];
assert(sy.sessions.length === 1, "신윤호 4/26 세션 병합 → 1개 (got " + sy.sessions.length + ")");
assert(sy.sessions[0].out === "01:12:07", "최종 퇴장 01:12:07 기준 (got " + sy.sessions[0].out + ")");
assert(sy.netSec === 13 * 3600 + 11 * 60 + 49, "체류 13:11:49 (got " + sy.netSec + ")");

console.log("== 손상 행(순공부>체류) 클램프 ==");
const clampRows = [I.HEADERS,
  ["손상학생", 5, "2026년 1월 정규", "2026-01-05", "09:59:10", "10:12:54", "00:13:44", "20:54:00", "-", "00:00:00", "학습시간 인정 완료"],
];
const cd = I.buildFromRows(clampRows).dataset.students[0].months["2026-01"].days["2026-01-05"];
assert(cd.netSec === cd.totalSec && cd.netSec === 13 * 60 + 44, "net>total → net=total=13:44 (net " + cd.netSec + ")");

console.log("== 동월 동명이인(이름+좌석) 분리 ==");
const collRows = [I.HEADERS,
  ["테스트동명", 10, "2026년 5월 정규", "2026-05-01", "10:00:00", "12:00:00", "02:00:00", "02:00:00", "-", "00:00:00", "학습시간 인정 완료"],
  ["테스트동명", 20, "2026년 5월 정규", "2026-05-01", "13:00:00", "15:00:00", "02:00:00", "02:00:00", "-", "00:00:00", "학습시간 인정 완료"],
  ["홍길동", 30, "2026년 5월 정규", "2026-05-02", "10:00:00", "11:00:00", "01:00:00", "01:00:00", "-", "00:00:00", "학습시간 인정 완료"],
];
const coll = I.buildFromRows(collRows);
const keys2 = coll.dataset.students.map(s => s.key).sort();
assert(coll.dataset.students.length === 3, "동명이인 분리: 3명 got [" + keys2.join(", ") + "]");
assert(keys2.indexOf("테스트동명#10") >= 0 && keys2.indexOf("테스트동명#20") >= 0, "이름#좌석 키 생성");
assert(keys2.indexOf("홍길동") >= 0, "비충돌은 이름 키");
I.assignPhones(coll.dataset.students);
assert(new Set(coll.dataset.students.map(s => s.phoneLast4)).size === 3, "동명이인도 전화뒷4 구분");

// 잘못된 헤더 거부
const bad = I.buildFromRows([["엉뚱", "헤더"], ["a", "b"]]);
assert(!bad.ok, "헤더 불일치 → 거부: " + bad.error);

console.log(process.exitCode ? "\n결과: 실패 있음" : "\n결과: 전체 통과 ✅");
