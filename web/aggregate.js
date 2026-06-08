/* 집계 공용 모듈 — window.SCAgg
 * 보정(getCorr) 반영해 학생-월 집계 + 반평균(익명) 계산.
 * app.js(학부모)·admin.js(반평균 저장) 공용. 순수 함수(DOM/localStorage 무관).
 */
(function () {
  "use strict";
  function dowOf(d) { return new Date(d + "T00:00:00").getDay(); }
  function isWeekend(d) { var w = dowOf(d); return w === 0 || w === 6; }
  function mean(a) { return a.length ? Math.round(a.reduce(function (x, y) { return x + y; }, 0) / a.length) : 0; }
  // 상위 frac 비율 학생들만의 평균(내림차순 정렬 후 상위 N명, 최소 1명)
  function topMean(a, frac) {
    if (!a.length) return 0;
    var sorted = a.slice().sort(function (x, y) { return y - x; });
    return mean(sorted.slice(0, Math.max(1, Math.ceil(sorted.length * frac))));
  }

  // student: { key,name,seat,months:{ym:{className,openDays,days}} }
  // getCorr(studentKey, date) -> 보정 payload 또는 null
  function computeMonth(student, ym, dataset, getCorr) {
    var raw = student.months[ym];
    if (!raw) return null;
    var days = {}, dates = Object.keys(raw.days).sort();
    var totalNet = 0, attendance = 0, recognized = 0, prov = 0, provNet = 0, corrected = 0;
    var wd = [], we = [], maxDay = { date: null, netSec: -1 };
    var skey = student.key || student.name;

    dates.forEach(function (date) {
      var base = raw.days[date];
      var corr = getCorr ? getCorr(skey, date) : null;
      var day;
      if (corr) {
        var gNet = base.goodNetSec != null ? base.goodNetSec : base.netSec;
        var gTot = base.goodTotalSec != null ? base.goodTotalSec : base.totalSec;
        var gExc = base.goodExcludedSec != null ? base.goodExcludedSec : base.excludedSec;
        var gOut = base.goodOutings != null ? base.goodOutings : base.outings;
        day = {
          netSec: gNet + corr.netSec, totalSec: gTot + corr.totalSec,
          excludedSec: gExc + corr.excludedSec, outings: gOut + corr.outings,
          firstIn: base.firstIn || corr.firstIn, lastOut: corr.lastOut || base.lastOut,
          attended: true, noCheckout: false, corrected: true, provisional: false,
          correction: corr, sessions: base.sessions,
        };
        corrected++;
      } else {
        day = {
          netSec: base.netSec, totalSec: base.totalSec, excludedSec: base.excludedSec,
          outings: base.outings, firstIn: base.firstIn, lastOut: base.lastOut,
          attended: true, noCheckout: base.noCheckout, corrected: false,
          provisional: !!base.noCheckout, sessions: base.sessions,
        };
        if (day.provisional) { prov++; provNet += (day.netSec - (base.goodNetSec || 0)); }
      }
      days[date] = day;
      attendance++;
      totalNet += day.netSec;
      if (day.netSec > 0) {
        recognized++;
        (isWeekend(date) ? we : wd).push(day.netSec);
        if (day.netSec > maxDay.netSec) maxDay = { date: date, netSec: day.netSec };
      }
    });

    return {
      totalNetSec: totalNet, attendanceDays: attendance, recognizedDays: recognized,
      provisionalDays: prov, provisionalNetSec: provNet, correctedDays: corrected,
      openDays: ((dataset.openDays || {})[ym] || []).length || raw.openDays,
      dailyAvgSec: recognized ? Math.round(totalNet / recognized) : 0,
      weekdayAvgSec: mean(wd), weekendAvgSec: mean(we),
      maxDay: maxDay.date ? maxDay : null,
      className: raw.className, days: days,
    };
  }

  function computeClassAverages(dataset, getCorr) {
    var byMonth = {};
    dataset.students.forEach(function (s) {
      Object.keys(s.months).forEach(function (ym) {
        var m = computeMonth(s, ym, dataset, getCorr);
        if (m && m.recognizedDays > 0) {
          var b = byMonth[ym] = byMonth[ym] || { tot: [], att: [], daily: [], wd: [], we: [] };
          b.tot.push(m.totalNetSec); b.att.push(m.attendanceDays); b.daily.push(m.dailyAvgSec);
          if (m.weekdayAvgSec) b.wd.push(m.weekdayAvgSec);
          if (m.weekendAvgSec) b.we.push(m.weekendAvgSec);
        }
      });
    });
    var out = {};
    Object.keys(byMonth).forEach(function (ym) {
      var b = byMonth[ym];
      out[ym] = {
        studentCount: b.tot.length, totalNetSec: mean(b.tot),
        attendanceDays: b.att.length ? Math.round(b.att.reduce(function (x, y) { return x + y; }, 0) / b.att.length * 10) / 10 : 0,
        dailyAvgSec: mean(b.daily), weekdayAvgSec: mean(b.wd), weekendAvgSec: mean(b.we),
        top20Count: Math.max(1, Math.ceil(b.tot.length * 0.2)),
        top20TotalNetSec: topMean(b.tot, 0.2), top20DailyAvgSec: topMean(b.daily, 0.2),
      };
    });
    return out;
  }

  var api = { computeMonth: computeMonth, computeClassAverages: computeClassAverages };
  if (typeof window !== "undefined") window.SCAgg = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
