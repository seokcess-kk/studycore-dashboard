/* 학생 명부(student-info.xlsx) 파서 + 데이터셋 적용 — window.SCRoster
 * 명부 컬럼(앞 13열):
 *   이름·연락처·보호자 연락처·상태·좌석·성별·생년월일·학년·학교·주소1·주소2·등록일·퇴원일
 * - 로그인 전화 뒷4자리: 학생/보호자 두 번호를 모두 허용(loginPhones 배열)
 * - 학년·학교·상태 등 프로필을 학생 객체에 부착
 * - 출결 데이터와는 이름(동명이인은 좌석)으로 매칭, 출결 없는 명부 학생은 신규 추가(months:{})
 */
(function () {
  "use strict";

  var HEADERS = ["이름", "연락처", "보호자 연락처", "상태", "좌석", "성별",
    "생년월일", "학년", "학교", "주소1", "주소2", "등록일", "퇴원일"];

  function norm(s) { return (s == null ? "" : String(s)).replace(/\s+/g, ""); }
  function clean(v) {
    if (v === null || v === undefined) return "";
    var s = String(v).trim();
    return (s === "-" || s === "") ? "" : s;
  }
  function toSeat(v) {
    if (v === null || v === undefined || v === "-" || v === "") return null;
    var n = parseInt(v, 10);
    return isNaN(n) ? null : n;
  }
  // 전화번호 문자열에서 끝 4자리(숫자만 추출). 4자리 미만이면 null
  function last4(phone) {
    if (phone == null) return null;
    var digits = String(phone).replace(/\D/g, "");
    if (digits.length < 4) return null;
    return digits.slice(-4);
  }

  /* 헤더 검증: 최소 앞 3열(이름·연락처·보호자 연락처)이 명부 양식과 일치해야 함 */
  function validateHeader(rows) {
    if (!rows || rows.length < 2) return { ok: false, error: "데이터 행이 없습니다." };
    var h = rows[0] || [];
    for (var i = 0; i < 3; i++) {
      if (norm(h[i]) !== norm(HEADERS[i])) {
        return { ok: false, error: "컬럼이 명부 양식과 다릅니다. " + (i + 1) + "번째 열이 \"" +
          HEADERS[i] + "\" 여야 하는데 \"" + (h[i] || "") + "\" 입니다." };
      }
    }
    return { ok: true };
  }

  /* 행 배열(헤더 포함) → 명부 레코드 목록 */
  function buildFromRows(rows) {
    var v = validateHeader(rows);
    if (!v.ok) return v;

    var roster = rows.slice(1)
      .filter(function (r) { return r && clean(r[0]) !== ""; })
      .map(function (r) {
        var name = String(r[0]).trim();
        var phoneStudent = clean(r[1]) || null;
        var phoneGuardian = clean(r[2]) || null;
        var l4s = [];
        [phoneStudent, phoneGuardian].forEach(function (p) {
          var l = last4(p);
          if (l && l4s.indexOf(l) === -1) l4s.push(l);
        });
        return {
          name: name,
          seat: toSeat(r[4]),
          phoneStudent: phoneStudent,
          phoneGuardian: phoneGuardian,
          loginPhones: l4s,
          profile: {
            status: clean(r[3]) || null,
            gender: clean(r[5]) || null,
            birth: clean(r[6]) || null,
            grade: clean(r[7]) || null,
            school: clean(r[8]) || null,
            addr1: clean(r[9]) || null,
            addr2: clean(r[10]) || null,
            enrolledAt: clean(r[11]) || null,
            leftAt: clean(r[12]) || null,
            // 원장 참고용 연락처(로컬 저장본·서버 admin 전용). 학부모 RPC 응답에는 노출하지 않음.
            phoneStudent: phoneStudent,
            phoneGuardian: phoneGuardian,
          },
        };
      });

    if (!roster.length) return { ok: false, error: "유효한 학생 행이 없습니다." };

    var statusCount = {}, withStudent = 0, withGuardian = 0, noPhone = 0;
    roster.forEach(function (s) {
      var st = s.profile.status || "(미지정)";
      statusCount[st] = (statusCount[st] || 0) + 1;
      if (s.phoneStudent) withStudent++;
      if (s.phoneGuardian) withGuardian++;
      if (!s.loginPhones.length) noPhone++;
    });

    return {
      ok: true,
      roster: roster,
      summary: {
        count: roster.length, withStudent: withStudent,
        withGuardian: withGuardian, noPhone: noPhone, statusCount: statusCount,
      },
    };
  }

  /* 한 학생 객체에 명부 레코드를 부착 (전화/프로필) */
  function applyRecord(student, rec) {
    // 좌석: 출결 기준 좌석을 우선 보존(월별 변동 가능), 없으면 명부 좌석 사용. 명부 좌석은 별도 보관.
    if (student.seat == null && rec.seat != null) student.seat = rec.seat;
    student.rosterSeat = rec.seat;
    student.loginPhones = rec.loginPhones.slice();
    if (rec.loginPhones.length) {
      student.phoneLast4 = rec.loginPhones[0]; // 대표(표시/데모칩용). 매칭은 loginPhones 전체.
      student.phoneFromRoster = true;          // assignPhones가 덮어쓰지 않도록
    }
    student.profile = rec.profile;
  }

  /* 데이터셋(STUDYCORE_DATA 구조)에 명부 적용.
   * 매칭: 이름 유일 → 그 학생 / 동명이인(여럿) → 좌석 일치 / 미존재 → 명부전용 학생 추가(months:{})
   * 반환: { dataset, report:{matched, rosterOnly, total, unmatchedAttendance} }
   */
  function applyToDataset(dataset, roster) {
    dataset = dataset || { months: [], openDays: {}, classAverages: {}, students: [] };
    dataset.students = dataset.students || [];

    var byName = {};
    dataset.students.forEach(function (s) { (byName[s.name] = byName[s.name] || []).push(s); });

    var matched = 0, rosterOnly = 0, touched = {};
    roster.forEach(function (rec) {
      var cands = byName[rec.name] || [];
      var target = null;
      if (cands.length === 1) target = cands[0];
      else if (cands.length > 1) {
        target = cands.filter(function (s) {
          return s.seat != null && rec.seat != null && +s.seat === +rec.seat;
        })[0] || null;
      }

      if (target) {
        applyRecord(target, rec);
        touched[target.key || target.name] = 1;
        matched++;
      } else {
        var key = (cands.length ? rec.name + "#" + (rec.seat == null ? "?" : rec.seat) : rec.name);
        var ns = { key: key, name: rec.name, seat: rec.seat, months: {} };
        applyRecord(ns, rec);
        dataset.students.push(ns);
        (byName[rec.name] = byName[rec.name] || []).push(ns);
        rosterOnly++;
      }
    });

    var unmatched = dataset.students.filter(function (s) {
      return !touched[s.key || s.name] && !s.phoneFromRoster &&
        s.months && Object.keys(s.months).length > 0;
    }).length;

    return { dataset: dataset, report: { matched: matched, rosterOnly: rosterOnly, total: roster.length, unmatchedAttendance: unmatched } };
  }

  var api = {
    buildFromRows: buildFromRows, applyToDataset: applyToDataset, applyRecord: applyRecord,
    validateHeader: validateHeader, last4: last4, HEADERS: HEADERS,
  };
  if (typeof window !== "undefined") window.SCRoster = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
