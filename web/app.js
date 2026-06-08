/* 스터디코어1.0 학습 리포트 — 프로토타입 (vanilla JS, 빌드 불필요) */
(function () {
  "use strict";

  var REMOTE = !!(window.SCApi && window.SCApi.enabled());
  var DATA = REMOTE
    ? { months: [], openDays: {}, classAverages: {}, students: [], _remote: true }
    : ((window.SCDataset && window.SCDataset.active()) || window.STUDYCORE_DATA);
  var DOW = ["일", "월", "화", "수", "목", "금", "토"];

  var state = { student: null, monthIdx: 0, corrections: {} };

  /* ---------- 유틸 ---------- */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  // 초 -> "5시간 11분" / "11분" / "0분"
  function fmtHM(sec) {
    sec = sec || 0;
    var h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    if (m === 60) { h += 1; m = 0; }
    if (h > 0 && m > 0) return h + "시간 " + m + "분";
    if (h > 0) return h + "시간";
    return m + "분";
  }
  // 컴팩트 (달력 셀)
  function fmtShort(sec) {
    sec = sec || 0;
    var h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    if (m === 60) { h += 1; m = 0; }
    if (h > 0 && m > 0) return h + "h " + m + "m";
    if (h > 0) return h + "h";
    return m + "m";
  }
  // 차트 막대 라벨용 — 시간 소수1 ("8.5"·"0.7"), 정각은 정수("8"), 0은 빈 문자
  function fmtBarH(sec) {
    if (!sec) return "";
    return (Math.round(sec / 360) / 10).toString();
  }
  function ymd(y, m, d) { return y + "-" + pad(m) + "-" + pad(d); }
  function parseYM(ym) { return { y: +ym.slice(0, 4), m: +ym.slice(5, 7) }; }
  function ymLabel(ym) { var p = parseYM(ym); return p.y + "년 " + p.m + "월"; }
  function prevYM(ym) {
    var p = parseYM(ym), m = p.m - 1, y = p.y;
    if (m < 1) { m = 12; y -= 1; }
    return y + "-" + pad(m);
  }
  function daysInMonth(ym) { var p = parseYM(ym); return new Date(p.y, p.m, 0).getDate(); }
  function dowOf(dateStr) { return new Date(dateStr + "T00:00:00").getDay(); }
  function isWeekendStr(dateStr) { var d = dowOf(dateStr); return d === 0 || d === 6; }

  // 시각 "HH:MM:SS" -> 06:00 기준 분 (새벽<5시는 +24h)
  function minsFrom6(t) {
    if (!t) return null;
    var p = t.split(":"), h = +p[0], m = +p[1];
    if (h < 5) h += 24;
    return (h * 60 + m) - 6 * 60;
  }

  function showView(id) {
    var views = document.querySelectorAll(".view");
    for (var i = 0; i < views.length; i++) views[i].classList.remove("active");
    $(id).classList.add("active");
    window.scrollTo(0, 0);
  }

  /* ---------- 로그인 ---------- */
  // 데모 계정·원장 링크는 개발 환경(file://·localhost·?demo=1)에서만 노출.
  // 운영 도메인(https 호스팅)에서는 숨겨 학부모에게 내부 도구가 보이지 않게 함.
  function isDevMode() {
    try {
      var loc = window.location;
      if (!loc) return false;
      if ((loc.search || "").indexOf("demo=1") >= 0) return true;
      if (loc.protocol === "file:") return true;
      var h = loc.hostname || "";
      return (h === "" || h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0");
    } catch (e) { return false; }
  }

  function renderDemoList() {
    var box = $("demo-list");
    box.innerHTML = "";
    DATA.students.slice().sort(function (a, b) {
      return a.name.localeCompare(b.name, "ko");
    }).forEach(function (s) {
      var chip = el("button", "demo-chip", s.name + " <b>" + s.phoneLast4 + "</b>");
      chip.type = "button";
      chip.addEventListener("click", function () {
        $("in-name").value = s.name;
        $("in-phone").value = s.phoneLast4;
      });
      box.appendChild(chip);
    });
  }

  /* 로그인 세션 유지 — 새로고침/재방문 시 자동 복원 */
  var SESS_KEY = "studycore_session";
  function saveSession(name, phone) { try { localStorage.setItem(SESS_KEY, JSON.stringify({ name: name, phone: phone })); } catch (e) {} }
  function loadSession() { try { return JSON.parse(localStorage.getItem(SESS_KEY) || "null"); } catch (e) { return null; } }
  function clearSession() { try { localStorage.removeItem(SESS_KEY); } catch (e) {} }

  function enterStudent(student) {
    state.student = student;
    _caCache = null;
    var idx = DATA.months.length - 1;
    while (idx > 0 && !student.months[DATA.months[idx]]) idx--;
    state.monthIdx = idx;
    renderCalendar();
    showView("view-calendar");
  }

  // 서버 리포트 응답 → DATA 구성 + 진입 (+세션 저장)
  function applyReport(res, name, phone) {
    DATA = {
      months: res.months || [], openDays: res.openDays || {},
      classAverages: res.classAverages || {}, students: [res.student], _remote: true,
    };
    state.corrections = res.corrections || {};
    saveSession(name, phone);
    enterStudent(res.student);
  }

  // 로컬 모드: 이름+전화로 학생 찾기
  function findLocalStudent(name, phone) {
    return DATA.students.filter(function (s) { return s.name === name; })
      .filter(function (s) { return (s.loginPhones && s.loginPhones.indexOf(phone) >= 0) || s.phoneLast4 === phone; })[0];
  }

  function handleLogin(e) {
    e.preventDefault();
    var name = $("in-name").value.trim();
    var phone = $("in-phone").value.trim();
    var err = $("login-error");
    err.hidden = true;

    if (REMOTE) {
      var submit = $("login-form").querySelector("button[type=submit]");
      if (submit) { submit.disabled = true; submit.classList.add("is-busy"); }
      window.SCApi.getReport(name, phone).then(function (res) {
        if (submit) { submit.disabled = false; submit.classList.remove("is-busy"); }
        if (!res || !res.student) {
          err.textContent = "학생 이름이나 휴대폰 번호 뒷자리를 다시 확인해 주세요.";
          err.hidden = false;
          return;
        }
        applyReport(res, name, phone);
      }).catch(function (ex) {
        if (submit) { submit.disabled = false; submit.classList.remove("is-busy"); }
        err.textContent = "리포트를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
        err.hidden = false;
        if (window.console) console.error(ex);
      });
      return;
    }

    // 로컬 모드(localStorage/번들)
    var matches = DATA.students.filter(function (s) { return s.name === name; });
    var student = findLocalStudent(name, phone);
    if (!student) {
      err.textContent = matches.length
        ? "휴대폰 번호 뒷자리를 다시 확인해 주세요."
        : "학생 이름을 다시 확인해 주세요.";
      err.hidden = false;
      return;
    }
    saveSession(name, phone);
    enterStudent(student);
  }

  // 저장된 세션으로 자동 복원 (서버 모드는 최신 데이터 재조회)
  function restoreSession() {
    var s = loadSession();
    if (!s || !s.name || !s.phone) return;
    $("in-name").value = s.name; $("in-phone").value = s.phone;
    if (REMOTE) {
      window.SCApi.getReport(s.name, s.phone).then(function (res) {
        if (res && res.student) applyReport(res, s.name, s.phone);
        else clearSession();
      }).catch(function () { /* 네트워크 오류 시 로그인 화면 유지 */ });
    } else {
      var st = findLocalStudent(s.name, s.phone);
      if (st) enterStudent(st); else clearSession();
    }
  }

  /* ---------- 집계 (보정 반영) — 공용 모듈 SCAgg 사용 ---------- */
  var _caCache = null;
  // 보정 조회기: 원격 모드는 서버가 준 맵, 로컬 모드는 SCCorr(localStorage)
  function corrGetter(key, date) {
    if (DATA._remote) {
      // 서버(RPC)는 본인 학생 한정이라 보정을 '날짜' 키로 줌. 안전하게 둘 다 조회.
      var c = state.corrections || {};
      return c[date] || c[key + "|" + date] || null;
    }
    return window.SCCorr ? window.SCCorr.get(key, date) : null;
  }
  function computeMonth(student, ym) {
    return window.SCAgg.computeMonth(student, ym, DATA, corrGetter);
  }
  function computeClassAverages(ym) {
    if (DATA._remote) return DATA.classAverages[ym] || { studentCount: 0, totalNetSec: 0, dailyAvgSec: 0 };
    if (!_caCache) _caCache = window.SCAgg.computeClassAverages(DATA, corrGetter);
    return _caCache[ym] || { studentCount: 0, totalNetSec: 0, dailyAvgSec: 0 };
  }

  /* ---------- 월 달력 ---------- */
  function currentMonthKey() { return DATA.months[state.monthIdx]; }
  function currentMonth() { return computeMonth(state.student, currentMonthKey()); }

  function deltaHtml(cur, prev, fmt) {
    if (prev == null) return '<span class="delta flat">지난달 데이터 없음</span>';
    if (prev === 0) return '<span class="delta flat">—</span>';
    var diff = cur - prev;
    var pct = Math.round((diff / prev) * 100);
    var cls = diff > 0 ? "up" : (diff < 0 ? "down" : "flat");
    var arrow = diff > 0 ? "▲" : (diff < 0 ? "▼" : "·");
    return '<span class="delta ' + cls + '">' + arrow + " " + Math.abs(pct) + "%</span>";
  }

  // 요약 카드 위 데이터 상태 배너 (확정/임시/보정 현황)
  function renderDataStatus(m) {
    var box = $("data-status");
    if (!box) return;
    box.innerHTML = "";
    box.className = "data-status";
    if (m.provisionalDays > 0) {
      box.classList.add("warn");
      var parts = ["<b>확인 필요한 기록 " + m.provisionalDays + "일</b>"];
      if (m.correctedDays > 0) parts.push("확인 완료 " + m.correctedDays + "일");
      box.innerHTML = '<span class="ds-ic">⚠️</span><span class="ds-tx">' + parts.join(" · ") +
        " — 퇴실 기록이 없어 현재 시간은 임시로 계산되었습니다. 확인 후 더 정확한 시간으로 반영됩니다.</span>";
    } else {
      box.classList.add("ok");
      var t = m.correctedDays > 0 ? ("확정된 기록 · 확인 완료 " + m.correctedDays + "일") : "확정된 기록";
      box.innerHTML = '<span class="ds-ic">✓</span><span class="ds-tx"><b>' + t +
        "</b> — 바로 확인할 수 있는 학습 기록입니다.</span>";
    }
    box.hidden = false;
  }

  function renderSummary() {
    var ym = currentMonthKey();
    var m = currentMonth();
    var prev = computeMonth(state.student, prevYM(ym)); // 보정 반영해 전월 재계산
    var grid = $("summary-grid");
    grid.innerHTML = "";

    function card(label, valueHtml, subHtml, accent) {
      var c = el("div", "scard" + (accent ? " accent" : ""));
      c.appendChild(el("div", "label", label));
      c.appendChild(el("div", "value", valueHtml));
      if (subHtml) c.appendChild(el("div", "sub", subHtml));
      return c;
    }

    var headSub = "전월 비교 " + deltaHtml(m.totalNetSec, prev ? prev.totalNetSec : null);
    if (m.provisionalNetSec > 0) {
      headSub += '<div class="prov-split">⚠️ 확정 ' + fmtHM(m.totalNetSec - m.provisionalNetSec) +
        " · 확인 필요 " + fmtHM(m.provisionalNetSec) + " 포함</div>";
    }
    grid.appendChild(card(
      "이번 달 순공부시간",
      fmtHM(m.totalNetSec),
      headSub,
      true
    ));
    grid.appendChild(card(
      "출석",
      m.attendanceDays + '<small> / ' + m.openDays + '일</small>',
      m.provisionalDays > 0 ? ("확인 필요한 기록 " + m.provisionalDays + "일") : "미출석 " + (m.openDays - m.attendanceDays) + "일"
    ));
    grid.appendChild(card(
      "학습일 하루 평균",
      fmtHM(m.dailyAvgSec),
      "전월 비교 " + deltaHtml(m.dailyAvgSec, prev ? prev.dailyAvgSec : null)
    ));
    grid.appendChild(card(
      "평일 / 주말 평균",
      '<span style="font-size:18px">' + fmtShort(m.weekdayAvgSec) + " / " + fmtShort(m.weekendAvgSec) + "</span>",
      "학습한 날 기준"
    ));
  }

  function renderCalendarGrid() {
    var ym = currentMonthKey();
    var m = currentMonth();
    var openSet = {};
    (DATA.openDays[ym] || []).forEach(function (d) { openSet[d] = true; });
    var p = parseYM(ym);
    var totalDays = daysInMonth(ym);
    var firstDow = dowOf(ymd(p.y, p.m, 1));
    var todayStr = (function () {
      var t = new Date();
      return ymd(t.getFullYear(), t.getMonth() + 1, t.getDate());
    })();

    var wrap = $("calendar");
    wrap.innerHTML = "";
    var grid = el("div", "cal-grid");

    // 요일 헤더
    DOW.forEach(function (d, i) {
      var h = el("div", "cal-dow" + (i === 0 ? " sun" : i === 6 ? " sat" : ""), d);
      grid.appendChild(h);
    });
    // 앞 빈칸
    for (var b = 0; b < firstDow; b++) grid.appendChild(el("div", "cal-cell empty"));

    for (var day = 1; day <= totalDays; day++) {
      var dateStr = ymd(p.y, p.m, day);
      var info = m.days[dateStr];
      var weekend = isWeekendStr(dateStr);
      var cls = "cal-cell" + (weekend ? " weekend" : "");
      if (dateStr === todayStr) cls += " today";

      var cell = el("div", cls);
      cell.appendChild(el("div", "daynum", String(day)));

      if (info) {
        cell.classList.add("clickable");
        if (info.provisional) {
          cell.classList.add("nocheck");
          cell.appendChild(el("div", "time", fmtShort(info.netSec)));
          cell.appendChild(el("div", "badge", "⚠️"));
        } else {
          cell.classList.add("studied");
          cell.appendChild(el("div", "time", fmtShort(info.netSec)));
          if (info.corrected) cell.appendChild(el("div", "badge", "✓"));
        }
        (function (ds) {
          cell.addEventListener("click", function () { openDayModal(ds); });
        })(dateStr);
      } else if (openSet[dateStr]) {
        // 운영일인데 결석
        var d = el("div", "dot dot-absent");
        d.style.marginTop = "auto"; d.style.marginBottom = "6px";
        cell.appendChild(d);
      }
      grid.appendChild(cell);
    }
    wrap.appendChild(grid);
  }

  // 듀얼 바의 한 줄(나 / 반평균) — 같은 max로 스케일해 길이 비교
  function ccBarRow(kind, name, val, max, fmt) {
    var r = el("div", "cc-duo-row " + kind);
    r.appendChild(el("div", "cc-duo-name", name));
    var track = el("div", "cc-duo-track");
    var b = el("div", "cc-duo-bar");
    b.style.width = (val / max * 100) + "%";
    track.appendChild(b);
    r.appendChild(track);
    r.appendChild(el("div", "cc-duo-val", fmt(val)));
    return r;
  }

  function bar(label, mine, avg, top, fmt) {
    var max = Math.max(mine, avg, top || 0, 1);
    var diff = mine - avg;
    var near = Math.abs(diff) < 60;
    var state = near ? "near" : (diff > 0 ? "over" : "under");

    var row = el("div", "cc-row cc-" + state);
    row.appendChild(el("div", "cc-label", '<span class="cc-name">' + label + "</span>"));

    // 내 막대 + 반평균 + 상위 20% 막대를 위아래로 나란히
    var duo = el("div", "cc-duo");
    duo.appendChild(ccBarRow("me", "나", mine, max, fmt));
    duo.appendChild(ccBarRow("avg", "반평균", avg, max, fmt));
    if (top) duo.appendChild(ccBarRow("top", "상위 20%", top, max, fmt));
    row.appendChild(duo);

    // 차이 배지
    var foot = el("div", "cc-foot");
    foot.appendChild(el("span", "cc-badge", near
      ? "반 평균과 비슷해요"
      : '<span class="cc-ico">' + (diff > 0 ? "▲" : "▼") + "</span>"
        + fmt(Math.abs(diff)) + (diff > 0 ? " 많아요" : " 적어요")));
    row.appendChild(foot);
    return row;
  }

  function renderClassCompare() {
    var ym = currentMonthKey();
    var m = currentMonth();
    var ca = computeClassAverages(ym);
    var box = $("class-compare");
    box.innerHTML = "";
    if (!ca) return;
    box.appendChild(el("div", "cc-title",
      "같은 반과 비교 <span style='color:#9aa1ad'>(익명 · " + ca.studentCount + "명)</span>"));
    box.appendChild(bar("이번 달 순공부시간", m.totalNetSec, ca.totalNetSec, ca.top20TotalNetSec, fmtHM));
    box.appendChild(bar("학습일 하루 평균", m.dailyAvgSec, ca.dailyAvgSec, ca.top20DailyAvgSec, fmtHM));
  }

  // 헤더 메타: 학년 · 학교 · 좌석 · 반
  function metaLine(m) {
    var prof = state.student.profile || {};
    var bits = [];
    if (prof.grade) bits.push(prof.grade);
    if (prof.school) bits.push(prof.school);
    if (state.student.seat) bits.push(state.student.seat + "번 좌석");
    if (m && m.className) bits.push(m.className);
    return bits.join(" · ");
  }

  function setDisplay(id, val) { var e = $(id); if (e) e.style.display = val; }

  // 출결 기록이 아직 없는(명부 전용) 학생 안내
  function renderNoData() {
    var grid = $("summary-grid"); if (grid) grid.innerHTML = "";
    var cmp = $("class-compare"); if (cmp) cmp.innerHTML = "";
    var ds = $("data-status"); if (ds) ds.hidden = true;
    setDisplay("month-nav", "none");
    setDisplay("cal-legend", "none");
    setDisplay("btn-monthly", "none");
    var cal = $("calendar");
    if (cal) cal.innerHTML = "<div class='empty-data'>아직 학습 기록이 없습니다." +
      "<br><small>출결 기록이 쌓이면 이곳에서 월간 리포트를 확인할 수 있습니다.</small></div>";
  }

  function renderCalendar() {
    var m = currentMonth();
    $("cal-student").textContent = state.student.name + " 학생";
    $("cal-meta").textContent = metaLine(m);

    if (!m) { $("cal-month-title").textContent = ""; renderNoData(); return; }

    // 데이터가 있는 학생: 숨겨졌을 수 있는 영역 복원
    setDisplay("month-nav", "");
    setDisplay("cal-legend", "");
    setDisplay("btn-monthly", "");

    var ym = currentMonthKey();
    $("cal-month-title").textContent = ymLabel(ym);
    $("prev-month").disabled = !state.student.months[DATA.months[state.monthIdx - 1]];
    $("next-month").disabled = !state.student.months[DATA.months[state.monthIdx + 1]];
    renderDataStatus(m);
    renderSummary();
    renderCalendarGrid();
    renderClassCompare();
  }

  /* ---------- 일자 상세 모달 ---------- */
  function openDayModal(dateStr) {
    var info = currentMonth().days[dateStr];
    if (!info) return;
    var p = dateStr.split("-");
    var body = $("day-modal-body");
    body.innerHTML = "";

    body.appendChild(el("div", null,
      '<span class="dm-date">' + (+p[1]) + "월 " + (+p[2]) + "일</span>" +
      '<span class="dm-dow">(' + DOW[dowOf(dateStr)] + "요일)</span>"));

    if (info.corrected) {
      body.appendChild(el("div", "dm-badge ok",
        "✓ 확인 완료 — 입·외출 기록을 반영한 시간입니다."));
    } else if (info.provisional) {
      body.appendChild(el("div", "dm-badge",
        "⚠️ 확인 필요 — 퇴실 기록이 없어 현재 시간은 임시로 계산되었습니다. 확인 후 더 정확해집니다."));
    }

    var hero = el("div", "dm-hero");
    hero.innerHTML =
      '<div class="h net"><div class="hl">순공부</div><div class="hv">' + fmtHM(info.netSec) + "</div></div>" +
      '<div class="h"><div class="hl">총 체류</div><div class="hv">' + fmtHM(info.totalSec) + "</div></div>" +
      '<div class="h"><div class="hl">외출(제외)</div><div class="hv">' + fmtHM(info.excludedSec) + "</div></div>";
    body.appendChild(hero);

    body.appendChild(el("div", "kv",
      '<span class="k">첫 입장 / 마지막 퇴장</span><span class="v">' +
      (info.firstIn || "-") + " ~ " + (info.lastOut || "-") + "</span>"));
    body.appendChild(el("div", "kv",
      '<span class="k">외출 횟수</span><span class="v">' + info.outings + "회</span>"));
    body.appendChild(el("div", "kv",
      '<span class="k">입퇴장 기록</span><span class="v">' + info.sessions.length + "건</span>"));

    // 보정된 날: 입·외출 구간 분해로 표시
    if (info.corrected && info.correction && info.correction.events) {
      var ev = info.correction.events;
      var steps = el("div", "session");
      steps.appendChild(el("div", "s-head", '<span class="s-time">시간 계산 내역</span>'));
      for (var k = 0; k < ev.length - 1; k++) {
        var a = ev[k], b = ev[k + 1];
        var study = (a.type === "entry" || a.type === "reentry");
        var row = el("div", "kv");
        row.innerHTML = '<span class="k">' + (study ? "📖 공부" : "🚶 외출") + " " + a.clock + " → " + b.clock +
          '</span><span class="v">' + fmtHM(b.sec - a.sec) + "</span>";
        if (study) row.style.color = "var(--primary)";
        steps.appendChild(row);
      }
      body.appendChild(steps);
      $("day-modal").hidden = false;
      return;
    }

    // 세션 카드 + 타임라인
    info.sessions.forEach(function (s, i) {
      var warn = (s.reason === "자동퇴장" || s.reason === "미복귀");
      var card = el("div", "session" + (warn ? " warn" : ""));
      card.appendChild(el("div", "s-head",
        '<span class="s-time">' + (s.in || "-") + " → " + (s.out || "-") + "</span>" +
        '<span class="s-net">' + (s.provisional
          ? "임시 " + fmtHM(s.totalSec)
          : "순 " + fmtHM(s.netSec)) + "</span>"));
      var meta = [];
      if (s.totalSec != null) meta.push("체류 " + fmtHM(s.totalSec));
      if (s.outings) meta.push("외출 " + s.outings + "회");
      if (s.seat) meta.push(s.seat + "번 좌석");
      card.appendChild(el("div", "s-meta", meta.join(" · ")));
      card.appendChild(el("div", "s-reason",
        (warn ? "⚠️ " : "✅ ") + (s.reason || "")));

      // 타임라인 (06:00~익일 01:00, 19시간=1140분)
      var inM = minsFrom6(s.in), outM = minsFrom6(s.out);
      if (inM != null && outM != null && outM > inM) {
        var span = 1140;
        var tl = el("div", "timeline");
        var seg = el("div", "seg");
        seg.style.left = Math.max(0, inM / span * 100) + "%";
        seg.style.width = Math.min(100, (outM - inM) / span * 100) + "%";
        tl.appendChild(seg);
        card.appendChild(tl);
        card.appendChild(el("div", "tl-axis",
          "<span>06시</span><span>12시</span><span>18시</span><span>24시</span>"));
      }
      body.appendChild(card);
    });

    $("day-modal").hidden = false;
  }
  function closeModal() { $("day-modal").hidden = true; }

  /* ---------- 월간 상세 ---------- */
  function svgBarsDaily() {
    var ym = currentMonthKey();
    var m = currentMonth();
    var openDaysArr = DATA.openDays[ym] || Object.keys(m.days).sort();
    var maxNet = 1, peakDay = null, peakNet = -1;
    openDaysArr.forEach(function (d) {
      var info = m.days[d];
      var net = info ? info.netSec : 0;
      if (net > maxNet) maxNet = net;
      if (net > peakNet) { peakNet = net; peakDay = d; }
    });

    var bars = el("div", "bars");
    var xaxis = el("div", "bar-x");
    openDaysArr.forEach(function (d) {
      var info = m.days[d];
      var net = info ? info.netSec : 0;
      var weekend = isWeekendStr(d);
      var wrap = el("div", "bar-wrap");
      var cls = "bar" + (net === 0 ? " zero" : weekend ? " weekend" : "");
      if (info && info.noCheckout && net === 0) cls = "bar nocheck";
      if (d === peakDay && net > 0) cls += " peak";   // 최고 학습일 강조
      var b = el("div", cls);
      b.style.height = (net / maxNet * 85) + "%";   // 상단 15%는 수치 라벨 공간
      // 모든 막대에 수치 상시 표시(세로). 결석일은 라벨 없음.
      if (net > 0) b.appendChild(el("span", "bar-val", fmtBarH(net)));
      wrap.appendChild(b);
      wrap.title = (+d.slice(8)) + "일 · " + (info ? fmtHM(net) : "결석");
      bars.appendChild(wrap);
      var lbl = (+d.slice(8));
      xaxis.appendChild(el("div", "bx", (lbl % 5 === 0 || lbl === 1) ? String(lbl) : ""));
    });

    // 학습일 하루 평균을 가로 점선으로 (막대와 동일한 85% 스케일)
    if (m.dailyAvgSec > 0) {
      var avgLine = el("div", "bar-avg");
      avgLine.style.bottom = (m.dailyAvgSec / maxNet * 85) + "%";
      avgLine.appendChild(el("span", "bar-avg-tag", "평균 " + fmtShort(m.dailyAvgSec)));
      bars.appendChild(avgLine);
    }

    var sec = el("section");
    sec.appendChild(el("h3", null, "일별 학습 흐름 <span class='mb-sub'>(단위: 시간)</span>"));
    sec.appendChild(bars);
    sec.appendChild(xaxis);
    sec.appendChild(el("div", "cc-avg-label",
      '<span class="dot dot-study"></span> 평일 &nbsp; <span class="dot" style="background:var(--weekend)"></span> 주말 &nbsp; <span class="dot dot-nocheck"></span> 확인 필요 &nbsp; <span class="dot dot-absent"></span> 결석'));
    return sec;
  }

  function svgDowPattern() {
    var m = currentMonth();
    var sum = [0, 0, 0, 0, 0, 0, 0], cnt = [0, 0, 0, 0, 0, 0, 0];
    Object.keys(m.days).forEach(function (d) {
      var info = m.days[d];
      if (info.netSec > 0) {
        var w = dowOf(d);
        sum[w] += info.netSec; cnt[w] += 1;
      }
    });
    var avg = sum.map(function (s, i) { return cnt[i] ? s / cnt[i] : 0; });
    var maxA = Math.max.apply(null, avg.concat([1]));

    var grid = el("div", "dow-grid");
    for (var i = 0; i < 7; i++) {
      var cell = el("div", "dow-cell" + (i === 0 || i === 6 ? " we" : ""));
      cell.appendChild(el("div", "dn", DOW[i]));
      var db = el("div", "db");
      var f = el("div", "dbf");
      f.style.height = (avg[i] / maxA * 100) + "%";
      db.appendChild(f);
      cell.appendChild(db);
      cell.appendChild(el("div", "dv", avg[i] ? fmtShort(avg[i]) : "-"));
      grid.appendChild(cell);
    }
    var sec = el("section");
    sec.appendChild(el("h3", null, "요일별 평균 <span class='mb-sub'>(학습한 날 기준)</span>"));
    sec.appendChild(grid);
    return sec;
  }

  function weekdayWeekendBlock() {
    var m = currentMonth();
    var sec = el("section");
    sec.appendChild(el("h3", null, "평일 vs 주말"));
    var ww = el("div", "ww");
    ww.innerHTML =
      '<div class="ww-item weekday"><div class="wl">평일 하루 평균</div><div class="wv">' + fmtHM(m.weekdayAvgSec) + "</div></div>" +
      '<div class="ww-item weekend"><div class="wl">주말 하루 평균</div><div class="wv">' + fmtHM(m.weekendAvgSec) + "</div></div>";
    sec.appendChild(ww);
    return sec;
  }

  function entryHourBlock() {
    var m = currentMonth();
    var hours = new Array(24).fill(0);
    Object.keys(m.days).forEach(function (d) {
      var fi = m.days[d].firstIn;
      if (fi) hours[+fi.split(":")[0]] += 1;
    });
    // 표시 범위 06~24
    var start = 6, end = 23;
    var maxH = Math.max.apply(null, hours.concat([1]));
    var peak = hours.indexOf(maxH);

    var bars = el("div", "hours");
    var xaxis = el("div", "hours-x");
    for (var h = start; h <= end; h++) {
      var b = el("div", "hb" + (h === peak ? " peak" : ""));
      b.style.height = (hours[h] / maxH * 82) + "%";   // 상단 18%는 횟수 라벨 공간
      if (hours[h] > 0) b.appendChild(el("span", "hb-val", hours[h] + "회"));
      b.title = h + "시 입실 " + hours[h] + "일";
      bars.appendChild(b);
      xaxis.appendChild(el("div", "hx", (h % 3 === 0) ? h : ""));
    }
    var sec = el("section");
    sec.appendChild(el("h3", null, "주로 입실한 시간대 <span class='mb-sub'>(첫 입실 · 일수)</span>"));
    sec.appendChild(bars);
    sec.appendChild(xaxis);
    if (peak >= 0 && maxH > 0) sec.appendChild(el("div", "cc-avg-label",
      "가장 자주 입실한 시간: " + peak + "시 무렵 (" + maxH + "일)"));
    return sec;
  }

  // "이번 달 한눈에 보기" — 이미 계산된 지표로 문장형 인사이트 생성
  function monthlyInsightsBlock() {
    var ym = currentMonthKey();
    var m = currentMonth();
    var prev = computeMonth(state.student, prevYM(ym));
    var items = [];

    // 1) 총합 + 전월 대비
    var s1 = "이번 달 순공부시간은 <b>" + fmtHM(m.totalNetSec) + "</b>입니다";
    if (prev && prev.totalNetSec > 0) {
      var diff = m.totalNetSec - prev.totalNetSec;
      var pct = Math.round(Math.abs(diff) / prev.totalNetSec * 100);
      if (pct >= 3) s1 += diff > 0 ? (" — 지난달보다 <b>" + pct + "% 늘었습니다</b>")
                                   : (" — 지난달보다 <b>" + pct + "% 줄었습니다</b>");
      else s1 += " — 지난달과 비슷합니다";
    }
    items.push({ ic: "⏱️", tx: s1 });

    // 2) 가장 꾸준했던 요일
    var sum = [0, 0, 0, 0, 0, 0, 0], cnt = [0, 0, 0, 0, 0, 0, 0];
    Object.keys(m.days).forEach(function (d) {
      var info = m.days[d];
      if (info.netSec > 0) { var w = dowOf(d); sum[w] += info.netSec; cnt[w] += 1; }
    });
    var bestDow = -1, bestAvg = -1;
    for (var i = 0; i < 7; i++) { if (cnt[i]) { var a = sum[i] / cnt[i]; if (a > bestAvg) { bestAvg = a; bestDow = i; } } }
    if (bestDow >= 0) items.push({ ic: "📅", tx: "가장 학습 시간이 긴 요일은 <b>" + DOW[bestDow] + "요일</b>이며, 평균 <b>" + fmtHM(bestAvg) + "</b>입니다" });

    // 3) 평일 vs 주말 집중도
    if (m.weekdayAvgSec && m.weekendAvgSec) {
      if (m.weekdayAvgSec >= m.weekendAvgSec)
        items.push({ ic: "⚖️", tx: "평일 하루 평균(<b>" + fmtHM(m.weekdayAvgSec) + "</b>)이 주말(<b>" + fmtHM(m.weekendAvgSec) + "</b>)보다 깁니다" });
      else
        items.push({ ic: "⚖️", tx: "주말 하루 평균(<b>" + fmtHM(m.weekendAvgSec) + "</b>)이 평일(<b>" + fmtHM(m.weekdayAvgSec) + "</b>)보다 깁니다" });
    }

    // 4) 출석/결석
    var absent = Math.max(0, m.openDays - m.attendanceDays);
    if (absent > 0) items.push({ ic: "🗓️", tx: "운영일 <b>" + m.openDays + "일</b> 중 <b>" + m.attendanceDays + "일</b> 출석했고, <b>" + absent + "일</b>은 기록이 없습니다" });
    else items.push({ ic: "🎉", tx: "운영일 <b>" + m.openDays + "일</b> 모두 출석했습니다" });

    // 5) 짧게 머문 날 (1시간 미만, 임시 제외)
    var shortN = 0;
    Object.keys(m.days).forEach(function (d) {
      var info = m.days[d];
      if (info.netSec > 0 && info.netSec < 3600 && !info.provisional) shortN++;
    });
    if (shortN > 0) items.push({ ic: "⚡", tx: "학습한 날 중 <b>" + shortN + "일</b>은 체류 시간이 1시간 미만입니다" });

    // 6) 최장일
    if (m.maxDay) items.push({ ic: "🔥", tx: "가장 오래 공부한 날은 <b>" + (+m.maxDay.date.slice(5, 7)) + "/" + (+m.maxDay.date.slice(8)) + "</b>, <b>" + fmtHM(m.maxDay.netSec) + "</b>입니다" });

    // 7) 임시 집계 안내
    if (m.provisionalDays > 0) items.push({ ic: "⚠️", tx: "<b>" + m.provisionalDays + "일</b>은 퇴실 기록 확인이 필요합니다. 확인 후 시간이 더 정확해집니다" });

    var sec = el("section", "insights");
    sec.appendChild(el("h3", null, "이번 달 한눈에 보기"));
    var list = el("div", "insight-list");
    items.forEach(function (it) {
      var row = el("div", "insight");
      row.innerHTML = '<span class="i-ic">' + it.ic + '</span><span class="i-tx">' + it.tx + "</span>";
      list.appendChild(row);
    });
    sec.appendChild(list);
    return sec;
  }

  function keyMetricsBlock() {
    var ym = currentMonthKey();
    var m = currentMonth();
    var prev = computeMonth(state.student, prevYM(ym));
    var sec = el("section");
    sec.appendChild(el("h3", null, "핵심 지표"));
    function kv(k, v) { sec.appendChild(el("div", "kv", '<span class="k">' + k + '</span><span class="v">' + v + "</span>")); }
    kv("순공부시간", fmtHM(m.totalNetSec) + " " + deltaHtml(m.totalNetSec, prev ? prev.totalNetSec : null));
    kv("출석일수", m.attendanceDays + " / " + m.openDays + "일");
    kv("학습일", m.recognizedDays + "일");
    kv("확인 필요", m.provisionalDays + "일");
    kv("학습일 하루 평균", fmtHM(m.dailyAvgSec));
    if (m.maxDay) {
      var md = m.maxDay.date;
      kv("가장 오래 공부한 날", (+md.slice(5, 7)) + "/" + (+md.slice(8)) + " (" + fmtHM(m.maxDay.netSec) + ")");
    }
    return sec;
  }

  function renderMonthly() {
    $("monthly-title").textContent = state.student.name + " · " + ymLabel(currentMonthKey());
    var body = $("monthly-body");
    body.innerHTML = "";
    body.appendChild(monthlyInsightsBlock());
    body.appendChild(svgBarsDaily());
    body.appendChild(weekdayWeekendBlock());
    body.appendChild(svgDowPattern());
    body.appendChild(entryHourBlock());
    body.appendChild(keyMetricsBlock());
  }

  /* ---------- 이벤트 ---------- */
  function init() {
    if (isDevMode()) {
      var db = $("demo-box");
      if (db) db.hidden = false;
      renderDemoList();
    }
    $("login-form").addEventListener("submit", handleLogin);
    $("btn-logout").addEventListener("click", function () {
      state.student = null;
      clearSession();
      $("in-name").value = ""; $("in-phone").value = "";
      showView("view-login");
    });
    $("prev-month").addEventListener("click", function () {
      if (state.student.months[DATA.months[state.monthIdx - 1]]) { state.monthIdx--; renderCalendar(); }
    });
    $("next-month").addEventListener("click", function () {
      if (state.student.months[DATA.months[state.monthIdx + 1]]) { state.monthIdx++; renderCalendar(); }
    });
    $("btn-monthly").addEventListener("click", function () { renderMonthly(); showView("view-monthly"); });
    $("btn-back-cal").addEventListener("click", function () { showView("view-calendar"); });
    $("day-modal").addEventListener("click", function (e) {
      if (e.target.getAttribute("data-close")) closeModal();
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });

    showView("view-login");
    restoreSession(); // 저장된 로그인 있으면 자동 복원(새로고침 유지)
  }

  if (!DATA || !DATA.students) {
    document.body.innerHTML = '<p style="padding:40px;text-align:center">데이터를 불러오지 못했습니다. scripts/preprocess.py를 먼저 실행하세요.</p>';
  } else {
    init();
  }
})();
