/* 엑셀(행 배열) → STUDYCORE_DATA 구조 빌드 + 월 병합
 * preprocess.py 의 build() 를 브라우저용으로 옮긴 것. window.SCIngest
 */
(function () {
  "use strict";

  var HEADERS = ["이름", "좌석번호", "수업", "날짜", "입장", "퇴장",
    "총 학습 시간", "순 학습 시간", "외출횟수", "제외 시간", "사유"];
  var AUTO = { "자동퇴장": 1, "미복귀": 1 };

  // ── 이벤트 로그(inout_log.xlsx) 형식 ───────────────────────────────
  var EVENT_HEADERS = ["이름", "휴대폰번호", "입퇴실 가능 시간", "상태", "시간", "입출입 사진"];
  var IN_EVENTS = { "입장": 1, "재입장": 1 };
  var BREAK_EVENTS = { "외출": 1, "이동": 1 };        // 자리 비움 = 제외('이동'도 제외)
  var CLOSE_EVENTS = { "퇴장": 1, "퇴장(강제퇴장)": 1 };

  function toSec(t) {
    if (t === null || t === undefined || t === "-" || t === "") return null;
    var p = String(t).split(":");
    if (p.length !== 3) return null;
    var h = +p[0], m = +p[1], s = +p[2];
    if (isNaN(h) || isNaN(m) || isNaN(s)) return null;
    return h * 3600 + m * 60 + s;
  }
  function toInt(v) {
    if (v === null || v === undefined || v === "-" || v === "") return 0;
    var n = parseInt(v, 10);
    return isNaN(n) ? 0 : n;
  }
  function timeSortKey(hms) {
    var sec = toSec(hms);
    if (sec === null) return 1e9;
    if (sec < 5 * 3600) sec += 24 * 3600;
    return sec;
  }
  function monthOf(d) { return String(d).slice(0, 7); }

  // 퇴장 - 입장 (초). 새벽 퇴장은 자정 넘김 보정. 못 구하면 null
  function secDiff(inT, outT) {
    var a = toSec(inT), b = toSec(outT);
    if (a === null || b === null) return null;
    if (b < a) b += 24 * 3600;
    return b - a;
  }

  function crc32(str) {
    var bytes = new TextEncoder().encode(str), crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      crc ^= bytes[i];
      for (var k = 0; k < 8; k++) crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function digitsOnly(v) { return v == null ? "" : String(v).replace(/\D/g, ""); }

  /* 이벤트 '시간' 파싱: "YYYY-MM-DD HH:MM:SS" 문자열 / Date / Excel serial(raw:true) */
  function parseTS(v) {
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    if (typeof v === "number") {                 // Excel serial → 로컬 Date 보정
      var base = new Date(Math.round((v - 25569) * 86400 * 1000));
      return new Date(base.getTime() + base.getTimezoneOffset() * 60000);
    }
    var m = String(v).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2}):(\d{1,2})/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
  }
  /* 새벽 5시 이전 이벤트는 전날 영업일로 귀속(자정 넘긴 공부) */
  function bizdayOf(dt) {
    var d = new Date(dt.getTime());
    if (dt.getHours() < 5) d.setDate(d.getDate() - 1);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function hmsOf(dt) {
    return dt ? pad2(dt.getHours()) + ":" + pad2(dt.getMinutes()) + ":" + pad2(dt.getSeconds()) : null;
  }
  function classNameOf(m) { return (+m.slice(0, 4)) + "년 " + (+m.slice(5, 7)) + "월 정규"; }

  /* 헤더로 이벤트 로그 형식인지 판별 (2열=휴대폰번호 또는 4열=상태) */
  function isEventLog(rows) {
    var h = (rows && rows[0]) || [];
    function norm(x) { return (x == null ? "" : String(x)).replace(/\s+/g, ""); }
    return norm(h[1]) === "휴대폰번호" || norm(h[3]) === "상태";
  }

  /* 헤더 검증: 첫 행이 기대 컬럼인지 (앞 11열) */
  function validateHeader(rows) {
    if (!rows || rows.length < 2) return { ok: false, error: "데이터 행이 없습니다." };
    if (isEventLog(rows)) return { ok: true };   // 이벤트 로그는 buildFromEvents에서 처리
    var h = rows[0] || [];
    for (var i = 0; i < HEADERS.length; i++) {
      var got = (h[i] == null ? "" : String(h[i])).replace(/\s+/g, "");
      var want = HEADERS[i].replace(/\s+/g, "");
      if (got !== want) {
        return { ok: false, error: "컬럼이 예상과 다릅니다. " + (i + 1) + "번째 열이 \"" + HEADERS[i] + "\" 여야 하는데 \"" + (h[i] || "") + "\" 입니다." };
      }
    }
    return { ok: true };
  }

  /* 행 배열(헤더 포함) → 데이터셋(전화번호 미할당)
   * 이벤트 로그(inout_log)면 buildFromEvents로, 아니면 세션집계(inout_raw) 경로. */
  function buildFromRows(rows) {
    if (isEventLog(rows)) return buildFromEvents(rows);
    var v = validateHeader(rows);
    if (!v.ok) return v;

    var data = rows.slice(1).filter(function (r) { return r && r[0] != null && r[0] !== ""; })
      .map(function (r) {
        return {
          name: String(r[0]).trim(), seat: r[1], cls: r[2], date: String(r[3]),
          in: r[4], out: r[5], total: toSec(r[6]), net: toSec(r[7]),
          outings: toInt(r[8]), excluded: toSec(r[9]), reason: r[10],
        };
      });
    if (!data.length) return { ok: false, error: "유효한 데이터 행이 없습니다." };

    // 월별 개원일
    var openDays = {};
    data.forEach(function (r) {
      var m = monthOf(r.date);
      (openDays[m] = openDays[m] || {})[r.date] = 1;
    });

    // 동월 동명이인 판별: (월,이름) 별 좌석이 2개 이상이면 이름+좌석으로 분리
    var seatsPerNM = {};
    data.forEach(function (r) {
      if (r.seat === "-" || r.seat == null) return;
      var nm = monthOf(r.date) + "|" + r.name;
      (seatsPerNM[nm] = seatsPerNM[nm] || {})[r.seat] = 1;
    });
    function isAmbiguous(date, name) {
      var s = seatsPerNM[monthOf(date) + "|" + name];
      return s && Object.keys(s).length > 1;
    }
    function keyOf(r) {
      return isAmbiguous(r.date, r.name)
        ? r.name + "#" + (r.seat === "-" || r.seat == null ? "?" : r.seat)
        : r.name;
    }

    // (key→월→날짜→세션)
    var tree = {}, nameOf = {}, seatOf = {}, clsOf = {};
    data.forEach(function (r) {
      var m = monthOf(r.date), key = keyOf(r);
      ((tree[key] = tree[key] || {})[m] = tree[key][m] || {})[r.date] =
        tree[key][m][r.date] || [];
      tree[key][m][r.date].push(r);
      nameOf[key] = r.name;
      if (r.seat !== "-" && r.seat != null) seatOf[key] = r.seat;
      var ck = key + "|" + m;
      if (!(ck in clsOf)) clsOf[ck] = r.cls;
    });

    var students = [];
    Object.keys(tree).sort(function (a, b) { return a.localeCompare(b, "ko"); }).forEach(function (key) {
      var monthsOut = {};
      Object.keys(tree[key]).forEach(function (m) {
        var daysIn = tree[key][m], dayOut = {};
        Object.keys(daysIn).sort().forEach(function (date) {
          var sessRows = daysIn[date].slice().sort(function (a, b) {
            return timeSortKey(a.in) - timeSortKey(b.in);
          });
          // 1) 원시 세션 (정상은 클램프, 자동퇴장은 잠정으로 표시)
          var base = sessRows.map(function (sr) {
            var provisional = (sr.net === null); // 자동퇴장 등 시간 미산출
            var netv, totv, excv, outv;
            if (provisional) { netv = 0; totv = 0; excv = 0; outv = 0; } // 병합 후 체류로 산정
            else {
              netv = sr.net || 0; totv = sr.total || 0; excv = sr.excluded || 0; outv = sr.outings;
              if (netv > totv) { netv = totv; excv = 0; } // 손상 행(순공부>체류) 클램프
            }
            return {
              in: (sr.in === "-" || sr.in == null) ? null : sr.in,
              out: (sr.out === "-" || sr.out == null) ? null : sr.out,
              totalSec: totv, netSec: netv, excludedSec: excv, outings: outv,
              reason: sr.reason, provisional: provisional,
              seat: (sr.seat === "-" || sr.seat == null) ? null : sr.seat,
            };
          });

          // 2) 강제퇴장(00:55) 분할 병합: 첫 자동퇴장 입장 ~ 그날 최종 퇴장을 한 체류로
          var fi = -1;
          for (var bi = 0; bi < base.length; bi++) if (base[bi].provisional) { fi = bi; break; }
          var sessions;
          if (fi >= 0) {
            var inT = base[fi].in, lastOut = null, lastKey = -1;
            for (var t = fi; t < base.length; t++) {
              if (base[t].out) { var k = timeSortKey(base[t].out); if (k > lastKey) { lastKey = k; lastOut = base[t].out; } }
            }
            var span = secDiff(inT, lastOut) || 0; // 체류 = 입장~최종퇴장
            var merged = {
              in: inT, out: lastOut, totalSec: span, netSec: span, excludedSec: 0, outings: 0,
              reason: base[fi].reason, provisional: true, seat: base[fi].seat,
            };
            sessions = base.slice(0, fi).concat([merged]);
          } else {
            sessions = base;
          }

          // 3) 일자 집계
          var dayNet = 0, dayTot = 0, dayExc = 0, dayOut2 = 0;
          var goodNet = 0, goodTot = 0, goodExc = 0, goodOut = 0, noCheckout = false;
          sessions.forEach(function (s) {
            dayNet += s.netSec; dayTot += s.totalSec; dayExc += s.excludedSec; dayOut2 += s.outings;
            if (s.provisional) noCheckout = true;
            else { goodNet += s.netSec; goodTot += s.totalSec; goodExc += s.excludedSec; goodOut += s.outings; }
          });
          var firstIn = null, lastOut2 = null;
          for (var i = 0; i < sessions.length; i++) if (sessions[i].in) { firstIn = sessions[i].in; break; }
          for (var j = sessions.length - 1; j >= 0; j--) if (sessions[j].out) { lastOut2 = sessions[j].out; break; }
          dayOut[date] = {
            netSec: dayNet, totalSec: dayTot, excludedSec: dayExc, outings: dayOut2,
            goodNetSec: goodNet, goodTotalSec: goodTot, goodExcludedSec: goodExc, goodOutings: goodOut,
            firstIn: firstIn, lastOut: lastOut2, attended: true, noCheckout: noCheckout,
            sessions: sessions,
          };
        });
        monthsOut[m] = {
          className: clsOf[key + "|" + m] || "",
          openDays: Object.keys(openDays[m]).length,
          days: dayOut,
        };
      });
      students.push({ key: key, name: nameOf[key], seat: seatOf[key] != null ? seatOf[key] : null, months: monthsOut });
    });

    var openDaysArr = {};
    Object.keys(openDays).forEach(function (m) { openDaysArr[m] = Object.keys(openDays[m]).sort(); });

    return {
      ok: true,
      dataset: {
        months: Object.keys(openDays).sort(),
        openDays: openDaysArr,
        classAverages: {},
        students: students,
      },
      summary: {
        months: Object.keys(openDays).sort(),
        rowCount: data.length,
        studentCount: students.length,
        autoCount: data.filter(function (r) { return AUTO[r.reason]; }).length,
      },
    };
  }

  /* ── 이벤트 로그 → 데이터셋 ────────────────────────────────────────
   * 영업일(새벽5시 경계)로 학생별 이벤트를 묶어 구간을 직접 계산.
   * 입장/재입장→공부 시작, 외출/이동→제외 시작+공부 종료, 퇴장/강제퇴장→종료.
   * 강제퇴장은 시각이 raw로 남아 그대로 정상 계산(자동퇴장 수동보정 불필요).
   * day/세션 스키마는 세션집계 경로(buildFromRows)와 동일. */
  function buildDayFromEvents(evs) {
    var sessions = [], cur = null, openStudy = null, openBreak = null;
    function newS(t) {
      return { in: t, out: null, netSec: 0, excludedSec: 0, outings: 0, forced: false, provisional: false };
    }
    evs.forEach(function (e) {
      var t = e.t, st = e.st;
      if (IN_EVENTS[st]) {
        if (cur && openBreak) cur.excludedSec += (t - openBreak) / 1000;
        openBreak = null;
        if (!cur) cur = newS(t);
        openStudy = t;
      } else if (BREAK_EVENTS[st]) {
        if (!cur) cur = newS(t);
        if (openStudy) { cur.netSec += (t - openStudy) / 1000; openStudy = null; }
        openBreak = t; cur.outings++;
      } else if (CLOSE_EVENTS[st]) {
        if (!cur) cur = newS(t);
        if (openStudy) { cur.netSec += (t - openStudy) / 1000; openStudy = null; }
        if (openBreak) { cur.excludedSec += (t - openBreak) / 1000; openBreak = null; }
        cur.out = t;
        if (st === "퇴장(강제퇴장)") cur.forced = true;
        sessions.push(cur); cur = null;
      }
    });
    if (cur) { cur.provisional = true; sessions.push(cur); }  // 닫는 퇴장 없음(미완결: 주로 추출 시점 잘림)

    var outS = [], dNet = 0, dTot = 0, dExc = 0, dOut = 0;
    var gNet = 0, gTot = 0, gExc = 0, gOut = 0, noCheckout = false;
    sessions.forEach(function (s) {
      var net = Math.round(s.netSec), exc = Math.round(s.excludedSec), tot = net + exc, prov = s.provisional;
      outS.push({
        in: hmsOf(s.in), out: hmsOf(s.out), totalSec: tot, netSec: net, excludedSec: exc,
        outings: s.outings, reason: s.forced ? "강제퇴장" : (prov ? "미복귀" : "학습시간 인정 완료"),
        provisional: prov, seat: null,
      });
      dNet += net; dTot += tot; dExc += exc; dOut += s.outings;
      if (prov) noCheckout = true;
      else { gNet += net; gTot += tot; gExc += exc; gOut += s.outings; }
    });
    var firstIn = null, lastOut = null;
    for (var i = 0; i < outS.length; i++) if (outS[i].in) { firstIn = outS[i].in; break; }
    for (var j = outS.length - 1; j >= 0; j--) if (outS[j].out) { lastOut = outS[j].out; break; }
    return {
      netSec: dNet, totalSec: dTot, excludedSec: dExc, outings: dOut,
      goodNetSec: gNet, goodTotalSec: gTot, goodExcludedSec: gExc, goodOutings: gOut,
      firstIn: firstIn, lastOut: lastOut, attended: true, noCheckout: noCheckout, sessions: outS,
    };
  }

  function buildFromEvents(rows) {
    var evs = rows.slice(1)
      .filter(function (r) { return r && r[0] != null && r[0] !== ""; })
      .map(function (r) { return { name: String(r[0]).trim(), phone: digitsOnly(r[1]), st: r[3], t: parseTS(r[4]) }; })
      .filter(function (e) { return e.t !== null; });
    if (!evs.length) return { ok: false, error: "유효한 이벤트 행이 없습니다. ('시간' 열 형식을 확인하세요)" };

    var blocks = {}, openDays = {}, phoneOf = {};
    evs.forEach(function (e) {
      var bd = bizdayOf(e.t), m = bd.slice(0, 7), k = e.name + "	" + bd;
      (blocks[k] = blocks[k] || []).push(e);
      (openDays[m] = openDays[m] || {})[bd] = 1;
      if (!(e.name in phoneOf)) phoneOf[e.name] = e.phone;
    });

    var tree = {}, provDays = 0;  // name -> month -> {date: day}
    Object.keys(blocks).forEach(function (k) {
      var arr = blocks[k].slice().sort(function (a, b) { return a.t - b.t; });
      var sep = k.indexOf("	"), name = k.slice(0, sep), bd = k.slice(sep + 1), m = bd.slice(0, 7);
      var day = buildDayFromEvents(arr);
      if (day.noCheckout) provDays++;
      ((tree[name] = tree[name] || {})[m] = tree[name][m] || {})[bd] = day;
    });

    var students = [];
    Object.keys(tree).sort(function (a, b) { return a.localeCompare(b, "ko"); }).forEach(function (name) {
      var monthsOut = {};
      Object.keys(tree[name]).forEach(function (m) {
        monthsOut[m] = { className: classNameOf(m), openDays: Object.keys(openDays[m]).length, days: tree[name][m] };
      });
      var ph = phoneOf[name] || "", l4 = ph.length >= 4 ? ph.slice(-4) : null;
      var s = { key: name, name: name, seat: null, months: monthsOut };
      if (l4) { s.phoneLast4 = l4; s.loginPhones = [l4]; }  // 로그의 실제 번호 → crc32 데모로 덮어쓰지 않음
      students.push(s);
    });

    var openDaysArr = {};
    Object.keys(openDays).forEach(function (m) { openDaysArr[m] = Object.keys(openDays[m]).sort(); });
    var months = Object.keys(openDays).sort();
    return {
      ok: true,
      dataset: { months: months, openDays: openDaysArr, classAverages: {}, students: students },
      summary: { months: months, rowCount: evs.length, studentCount: students.length, autoCount: provDays },
    };
  }

  /* 명부 전화(loginPhones)가 부여된 학생인지 — 그러면 crc32 데모번호로 덮어쓰지 않음 */
  function hasRosterPhone(s) {
    return !!((s.phoneFromRoster && s.phoneLast4) || (s.loginPhones && s.loginPhones.length));
  }

  /* key(이름 또는 이름#좌석) 기준 결정적 전화 뒷4 할당 (preprocess.py 와 동일 알고리즘)
   * 단, 명부에서 실제 전화를 받은 학생은 그대로 고정(데모번호로 덮어쓰지 않음). */
  function assignPhones(students) {
    var used = {};
    // 1차: 명부 전화 보유 학생은 고정하고 사용중으로 표시
    students.forEach(function (s) {
      if (!hasRosterPhone(s)) return;
      if (!s.phoneLast4 && s.loginPhones && s.loginPhones.length) s.phoneLast4 = s.loginPhones[0];
      if (s.phoneLast4) used[s.phoneLast4] = 1;
    });
    // 2차: 나머지에 crc32 결정적 할당(충돌 시 +1)
    students.slice().sort(function (a, b) { return (a.key || a.name).localeCompare(b.key || b.name, "ko"); })
      .forEach(function (s) {
        if (hasRosterPhone(s)) return;
        var base = crc32(s.key || s.name) % 10000, n = base, cand;
        for (var i = 0; i < 10000; i++) {
          cand = ("0000" + n).slice(-4);
          if (!used[cand]) { used[cand] = 1; break; }
          n = (n + 1) % 10000;
        }
        s.phoneLast4 = cand;
      });
  }

  /* 기존 데이터셋 + 새 데이터셋 병합 (월 단위, key 기준) */
  function merge(base, incoming) {
    base = base || { months: [], openDays: {}, classAverages: {}, students: [] };
    var byKey = {};
    base.students.forEach(function (s) { byKey[s.key || s.name] = s; });
    incoming.students.forEach(function (ns) {
      var k = ns.key || ns.name;
      var es = byKey[k];
      if (!es) { es = { key: k, name: ns.name, seat: ns.seat, months: {} }; base.students.push(es); byKey[k] = es; }
      if (ns.seat != null) es.seat = ns.seat;
      if (!es.key) es.key = k;
      Object.keys(ns.months).forEach(function (m) { es.months[m] = ns.months[m]; });
    });
    var monthsSet = {};
    base.students.forEach(function (s) { Object.keys(s.months).forEach(function (m) { monthsSet[m] = 1; }); });
    base.months = Object.keys(monthsSet).sort();
    base.openDays = base.openDays || {};
    Object.keys(incoming.openDays).forEach(function (m) { base.openDays[m] = incoming.openDays[m]; });
    assignPhones(base.students);
    return base;
  }

  var api = { buildFromRows: buildFromRows, merge: merge, assignPhones: assignPhones, crc32: crc32, validateHeader: validateHeader, HEADERS: HEADERS };
  if (typeof window !== "undefined") window.SCIngest = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
