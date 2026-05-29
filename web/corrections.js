/* 퇴실 미체크(자동퇴장) 보정 공용 모듈
 * - 원장이 붙여넣은 입·외출·재입장·강제퇴장 이벤트 로그를 파싱
 * - 순공부 = (입장/재입장 → 외출/퇴장) 구간 합, 제외 = (외출 → 재입장/강제퇴장) 구간 합
 * - 보정값을 localStorage에 저장/조회 (프로토타입; 실제는 서버 저장)
 */
(function () {
  "use strict";
  var KEY = "studycore_corrections_v1";

  function clock(sec) {
    sec = ((sec % 86400) + 86400) % 86400;
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h < 10 ? "0" + h : h) + ":" + (m < 10 ? "0" + m : m) + ":" + (s < 10 ? "0" + s : s);
  }
  function fmtHM(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    if (m === 60) { h += 1; m = 0; }
    if (h > 0 && m > 0) return h + "시간 " + m + "분";
    if (h > 0) return h + "시간";
    return m + "분";
  }

  function classify(label) {
    if (/재입장/.test(label)) return "reentry";
    if (/입장/.test(label)) return "entry";
    if (/퇴장/.test(label)) return "exit";   // 강제퇴장 포함
    if (/외출/.test(label)) return "out";
    return "unknown";
  }

  /* 붙여넣은 텍스트 → 계산 결과 */
  function parseEventLog(text) {
    if (!text || !text.trim()) return { ok: false, error: "내용이 비어 있습니다." };
    var re = /(\d{1,2}):(\d{2}):(\d{2})/g, m, matches = [];
    while ((m = re.exec(text)) !== null) {
      matches.push({
        sec: (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]),
        start: m.index, end: re.lastIndex, raw: m[0],
      });
    }
    if (matches.length < 2) return { ok: false, error: "시각(HH:MM:SS)이 2개 이상 필요합니다." };

    var raw = [];
    for (var i = 0; i < matches.length; i++) {
      var labelStart = i === 0 ? 0 : matches[i - 1].end;
      var label = text.slice(labelStart, matches[i].start);
      var type = classify(label);
      if (type === "unknown") {
        return { ok: false, error: "구분을 알 수 없는 항목: \"" + label.trim().slice(0, 20) + " " + matches[i].raw + "\"" };
      }
      raw.push({ type: type, sec: matches[i].sec, label: label.trim() });
    }

    // 자정 넘김 보정
    var prev = -1;
    raw.forEach(function (e) { while (e.sec < prev) e.sec += 86400; prev = e.sec; });

    var first = raw[0], last = raw[raw.length - 1];
    if (first.type !== "entry" && first.type !== "reentry")
      return { ok: false, error: "첫 항목은 '입장'이어야 합니다." };
    if (last.type !== "exit")
      return { ok: false, error: "마지막 항목은 '퇴장(강제퇴장)'이어야 합니다." };

    var net = 0, outings = 0, studying = false, start = null;
    var entrySec = null, exitSec = null;
    var events = [];
    raw.forEach(function (e) {
      events.push({ type: e.type, clock: clock(e.sec), sec: e.sec });
      if (e.type === "entry" || e.type === "reentry") {
        if (e.type === "entry" && entrySec === null) entrySec = e.sec;
        start = e.sec; studying = true;
      } else if (e.type === "out") {
        if (studying && start != null) net += e.sec - start;
        studying = false; outings++;
      } else if (e.type === "exit") {
        if (studying && start != null) net += e.sec - start;
        studying = false; exitSec = e.sec;
      }
    });
    if (entrySec == null || exitSec == null)
      return { ok: false, error: "입장/퇴장 시각을 찾지 못했습니다." };

    var total = exitSec - entrySec;
    var excluded = total - net;
    if (net < 0 || excluded < 0 || total <= 0)
      return { ok: false, error: "시각 순서가 올바르지 않습니다 (구간 계산 음수)." };

    return {
      ok: true,
      netSec: net, totalSec: total, excludedSec: excluded, outings: outings,
      firstIn: clock(entrySec), lastOut: clock(exitSec),
      events: events,
    };
  }

  /* ---- 저장소 ---- */
  function keyOf(name, date) { return name + "|" + date; }
  function loadAll() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}"); }
    catch (e) { return {}; }
  }
  function get(name, date) { return loadAll()[keyOf(name, date)] || null; }
  function save(name, date, obj) {
    var all = loadAll();
    all[keyOf(name, date)] = obj;
    localStorage.setItem(KEY, JSON.stringify(all));
  }
  function remove(name, date) {
    var all = loadAll();
    delete all[keyOf(name, date)];
    localStorage.setItem(KEY, JSON.stringify(all));
  }
  function count() { return Object.keys(loadAll()).length; }

  var api = {
    parseEventLog: parseEventLog,
    clock: clock, fmtHM: fmtHM,
    get: get, save: save, remove: remove, loadAll: loadAll, count: count, keyOf: keyOf,
  };
  if (typeof window !== "undefined") window.SCCorr = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
