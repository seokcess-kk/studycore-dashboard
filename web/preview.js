/* 관리자 → 학부모 리포트 미리보기 공용 모듈 — window.SCPreview
 * - buildPreviewPayload: admin이 가진 학생 1명을 학부모 RPC 응답과 동일 형태로 빌드
 * - filterReportStudents / studentRowMeta: 검색 결과 목록용
 * - writeBuffer / takePreview: localStorage(1회용 핸드오프) ↔ sessionStorage(탭 내 지속)
 *   sessionStorage는 탭마다 격리되므로 탭→탭 전달은 localStorage 버퍼를 쓰고,
 *   새 탭은 부팅 시 sessionStorage로 옮긴 뒤 버퍼를 즉시 삭제한다.
 */
(function () {
  "use strict";

  var BUFFER_KEY = "studycore_admin_preview"; // localStorage: 탭→탭 1회용
  var SESSION_KEY = "studycore_preview";      // sessionStorage: 새 탭 내 지속

  function hasMonths(s) {
    return !!(s && s.months && Object.keys(s.months).length > 0);
  }

  // 학습 데이터(months)가 있는 학생만, 이름 부분일치(소문자 정규화)
  function filterReportStudents(students, term) {
    term = (term || "").trim().toLowerCase();
    var withData = (students || []).filter(hasMonths);
    if (!term) return withData;
    return withData.filter(function (s) {
      return (s.name || "").toLowerCase().indexOf(term) >= 0;
    });
  }

  // 결과 행의 구분용 메타: "학년 · N번 좌석" (동명이인 식별)
  function studentRowMeta(s) {
    var bits = [];
    var prof = s.profile || {};
    if (prof.grade) bits.push(prof.grade);
    if (s.seat) bits.push(s.seat + "번 좌석"); // 좌석은 1번부터 — 0/누락은 표기 생략
    return bits.join(" · ");
  }

  // 학생 1명 → { student, months, openDays, classAverages, corrections }
  // corrMap: { "key|date": payload, ... } (admin의 corrMap 또는 SCCorr.loadAll())
  function buildPreviewPayload(student, data, corrMap) {
    data = data || {};
    var key = student.key || student.name;
    var prefix = key + "|";
    var corrections = {};
    Object.keys(corrMap || {}).forEach(function (k) {
      if (k.indexOf(prefix) === 0) corrections[k] = corrMap[k];
    });
    return {
      student: student,
      months: (data.months || []).slice(),
      openDays: data.openDays || {},
      classAverages: data.classAverages || {},
      corrections: corrections,
    };
  }

  /* ---------- 브라우저 전용: 버퍼 핸드오프 ---------- */
  function writeBuffer(payload) {
    try { window.localStorage.setItem(BUFFER_KEY, JSON.stringify(payload)); return true; }
    catch (e) { return false; }
  }

  // localStorage 버퍼가 있으면 sessionStorage로 옮기고 버퍼 삭제.
  // 없으면 sessionStorage(새로고침 케이스)에서 읽는다. 없으면 null.
  function takePreview() {
    var raw = null;
    try { raw = window.localStorage.getItem(BUFFER_KEY); } catch (e) {}
    if (raw != null) {
      try { window.localStorage.removeItem(BUFFER_KEY); } catch (e) {}
      try { window.sessionStorage.setItem(SESSION_KEY, raw); } catch (e) {}
    } else {
      try { raw = window.sessionStorage.getItem(SESSION_KEY); } catch (e) {}
    }
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  // 미리보기 컨텍스트 종료 — 버퍼/세션 잔재 제거(관리자 화면 복귀 시 호출)
  function clearPreview() {
    try { window.localStorage.removeItem(BUFFER_KEY); } catch (e) {}
    try { window.sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  var api = {
    BUFFER_KEY: BUFFER_KEY, SESSION_KEY: SESSION_KEY,
    filterReportStudents: filterReportStudents,
    studentRowMeta: studentRowMeta,
    buildPreviewPayload: buildPreviewPayload,
    writeBuffer: writeBuffer,
    takePreview: takePreview,
    clearPreview: clearPreview,
  };
  if (typeof window !== "undefined") window.SCPreview = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
