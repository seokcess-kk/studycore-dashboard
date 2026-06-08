/* 원장용 퇴실 미체크 보정 페이지 */
(function () {
  "use strict";
  var REMOTE = !!(window.SCApi && window.SCApi.enabled());
  var DATA = REMOTE
    ? { months: [], openDays: {}, classAverages: {}, students: [] }
    : ((window.SCDataset && window.SCDataset.active()) || window.STUDYCORE_DATA);
  var C = window.SCCorr;
  var corrMap = {}; // 원격 모드 보정 캐시
  function getCorr(key, date) { return REMOTE ? (corrMap[key + "|" + date] || null) : (C ? C.get(key, date) : null); }
  var DOW = ["일", "월", "화", "수", "목", "금", "토"];
  var AUTO = { "자동퇴장": 1, "미복귀": 1 };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function dowOf(d) { return new Date(d + "T00:00:00").getDay(); }
  function mmdd(d) { return (+d.slice(5, 7)) + "월 " + (+d.slice(8)) + "일"; }
  function dur(sec) { var m = Math.round(sec / 60); if (m >= 60) return Math.floor(m / 60) + "시간 " + (m % 60) + "분"; return m + "분"; }

  var monthFilter = "all";
  var current = null; // {name, date}
  var pendingBuilt = null; // 출결 업로드 파싱 결과 대기
  var pendingRoster = null; // 명부 업로드 파싱 결과 대기

  /* 미체크 플래그 수집 */
  function collectFlags() {
    var flags = [];
    DATA.students.forEach(function (s) {
      Object.keys(s.months).forEach(function (ym) {
        if (monthFilter !== "all" && ym !== monthFilter) return;
        var days = s.months[ym].days;
        Object.keys(days).forEach(function (date) {
          var d = days[date];
          var autoSess = d.sessions.filter(function (x) { return AUTO[x.reason]; });
          if (autoSess.length) {
            var key = s.key || s.name;
            flags.push({
              key: key, name: s.name, seat: s.seat, date: date, ym: ym,
              inTime: autoSess[0].in, outTime: autoSess[0].out,
              reason: autoSess[0].reason,
              provSec: autoSess[0].netSec || 0,
              corrected: !!getCorr(key, date),
            });
          }
        });
      });
    });
    return flags;
  }

  function renderStats(flags) {
    var done = flags.filter(function (f) { return f.corrected; }).length;
    var remain = flags.length - done;
    var box = $("admin-stats");
    box.innerHTML = "";
    // 목록은 완료 건을 빼고 보여주므로, 통계도 "남은 항목"만 표기(혼란 방지).
    var c = el("div", "astat solo " + (remain ? "todo" : "done"));
    c.appendChild(el("div", "v", remain));
    c.appendChild(el("div", "l", remain ? "확인 필요 (남은 항목)" : "확인할 항목 없음 🎉"));
    if (done) c.appendChild(el("div", "l-sub", "지금까지 확인 완료 " + done + "건"));
    box.appendChild(c);
  }

  function renderList() {
    var flags = collectFlags();
    renderStats(flags);

    var term = ($("admin-search").value || "").trim().toLowerCase();
    var sortBy = $("admin-sort").value || "name";

    var byKey = {};
    flags.forEach(function (f) {
      if (f.corrected) return; // 완료(확인 완료)된 건은 목록에서 항상 제외
      if (term && f.name.toLowerCase().indexOf(term) === -1) return;
      (byKey[f.key] = byKey[f.key] || []).push(f);
    });

    var wrap = $("flag-list");
    wrap.innerHTML = "";
    var keys = Object.keys(byKey);
    if (!keys.length) { wrap.appendChild(el("p", "empty-note", "확인할 항목이 없습니다.")); return; }

    // 그룹별 집계(정렬 기준): 임시시간 합·미보정 수·최근 날짜
    var aggOf = {};
    keys.forEach(function (k) {
      var prov = 0, todo = 0, latest = "";
      byKey[k].forEach(function (i) {
        prov += i.provSec || 0;
        if (!i.corrected) todo++;
        if (i.date > latest) latest = i.date;
      });
      aggOf[k] = { prov: prov, todo: todo, latest: latest };
    });
    keys.sort(function (a, b) {
      if (sortBy === "prov") return aggOf[b].prov - aggOf[a].prov;
      if (sortBy === "todo") return (aggOf[b].todo - aggOf[a].todo) || (byKey[b].length - byKey[a].length);
      if (sortBy === "recent") return aggOf[a].latest < aggOf[b].latest ? 1 : aggOf[a].latest > aggOf[b].latest ? -1 : 0;
      return byKey[a][0].name.localeCompare(byKey[b][0].name, "ko");
    });

    keys.forEach(function (key) {
      var items = byKey[key].slice().sort(function (a, b) {
        if (sortBy === "prov") return (b.provSec || 0) - (a.provSec || 0);
        if (sortBy === "recent") return a.date < b.date ? 1 : -1;
        return a.date < b.date ? -1 : 1;
      });
      var label = items[0].name + (key.indexOf("#") >= 0
        ? " <small style='color:#9aa1ad'>(좌석 " + items[0].seat + ")</small>" : "");
      var g = el("details", "flag-group");
      g.open = true;
      var sum = el("summary", null,
        "<span>" + label + "</span><span class='gcount'>" + items.length + "건</span>");
      g.appendChild(sum);
      items.forEach(function (f) {
        var row = el("div", "flag-row");
        var corr = getCorr(f.key, f.date);
        row.appendChild(el("div", "fr-date", mmdd(f.date) + " <small style='color:#9aa1ad'>(" + DOW[dowOf(f.date)] + ")</small>"));
        row.appendChild(el("div", "fr-mid", "입장 " + (f.inTime || "-") + " → " + f.reason + " " + (f.outTime || "-")));
        var st = el("div", "fr-status " + (f.corrected ? "done" : "todo"),
          f.corrected ? ("완료 " + C.fmtHM(corr.netSec)) : ("확인 필요 " + C.fmtHM(f.provSec)));
        row.appendChild(st);
        var btn = el("button", f.corrected ? "done" : "", f.corrected ? "수정" : "확인");
        btn.addEventListener("click", function () { openModal(f); });
        row.appendChild(btn);
        g.appendChild(row);
      });
      wrap.appendChild(g);
    });
  }

  /* ---- 보정 모달 ---- */
  function openModal(f) {
    current = f;
    $("corr-target").innerHTML = f.name + (f.key.indexOf("#") >= 0 ? " (좌석 " + f.seat + ")" : "") +
      " · " + mmdd(f.date) +
      " <small>(입장 " + (f.inTime || "-") + " → 자동 퇴실 " + (f.outTime || "-") + ")</small>";
    $("corr-input").value = "";
    $("corr-result").hidden = true;
    $("corr-result").className = "corr-result";
    var existing = getCorr(f.key, f.date);
    $("btn-clear").hidden = !existing;
    if (existing && existing.events) {
      // 기존 보정 내용을 텍스트로 복원해 편집 가능하게
      $("corr-input").value = existing.events.map(function (e) {
        var label = e.type === "entry" ? "입장" : e.type === "reentry" ? "재입장" : e.type === "out" ? "외출" : "강제퇴장";
        return label + "\t" + e.clock;
      }).join("\n");
      showResult(C.parseEventLog($("corr-input").value));
    }
    $("corr-modal").hidden = false;
  }
  function closeModal() { $("corr-modal").hidden = true; current = null; }

  function showResult(r) {
    var box = $("corr-result");
    box.hidden = false;
    if (!r.ok) { box.className = "corr-result err"; box.textContent = "⚠️ " + r.error; return; }
    box.className = "corr-result";
    box.innerHTML = "";

    var hero = el("div", "cr-hero");
    hero.innerHTML =
      "<div class='c net'><div class='l'>순공부</div><div class='v'>" + C.fmtHM(r.netSec) + "</div></div>" +
      "<div class='c'><div class='l'>총 체류</div><div class='v'>" + C.fmtHM(r.totalSec) + "</div></div>" +
      "<div class='c'><div class='l'>외출(제외)</div><div class='v'>" + C.fmtHM(r.excludedSec) + "</div></div>";
    box.appendChild(hero);

    // 구간 분해
    var steps = el("div", "cr-steps");
    for (var i = 0; i < r.events.length - 1; i++) {
      var a = r.events[i], b = r.events[i + 1];
      var study = (a.type === "entry" || a.type === "reentry");
      var step = el("div", "cr-step " + (study ? "study" : "away"));
      step.innerHTML = "<span><span class='tag2'>" + (study ? "공부" : "외출") + "</span> " +
        a.clock + " → " + b.clock + "</span><span>" + dur(b.sec - a.sec) + "</span>";
      steps.appendChild(step);
    }
    box.appendChild(steps);

    var save = el("div", "cr-save");
    var btn = el("button", "btn-primary", "저장");
    btn.addEventListener("click", function () {
      var key = current.key, date = current.date;
      var payload = {
        netSec: r.netSec, totalSec: r.totalSec, excludedSec: r.excludedSec,
        outings: r.outings, firstIn: r.firstIn, lastOut: r.lastOut, events: r.events,
      };
      if (REMOTE) {
        btn.disabled = true;
        window.SCApi.saveCorrection(key, date, payload).then(function () {
          corrMap[key + "|" + date] = payload; closeModal(); renderList();
        }).catch(function (ex) { btn.disabled = false; window.alert("저장하지 못했습니다: " + (ex.message || ex)); });
      } else {
        C.save(key, date, payload); closeModal(); renderList();
      }
    });
    save.appendChild(btn);
    box.appendChild(save);
  }

  function initMonthFilter() {
    var sel = $("filter-month");
    sel.innerHTML = "<option value='all'>전체 월</option>";
    DATA.months.forEach(function (m) {
      var o = document.createElement("option"); o.value = m;
      o.textContent = (+m.slice(0, 4)) + "년 " + (+m.slice(5, 7)) + "월";
      sel.appendChild(o);
    });
    sel.addEventListener("change", function () { monthFilter = sel.value; renderList(); });
  }

  /* ---------- 엑셀 업로드 ---------- */
  function ymLabel(m) { return (+m.slice(0, 4)) + "년 " + (+m.slice(5, 7)) + "월"; }
  function uMsg(text, cls) {
    var box = $("upload-msg");
    if (!text) { box.hidden = true; return; }
    box.hidden = false; box.className = "upload-msg " + (cls || ""); box.textContent = text;
  }
  function rosterCount(students) {
    return (students || []).filter(function (s) { return s.loginPhones && s.loginPhones.length; }).length;
  }
  function renderLoadedInfo() {
    var box = $("loaded-info");
    if (REMOTE) {
      box.innerHTML = "";
      var months = (DATA.months || []).map(ymLabel).join(", ") || "없음";
      var rc = rosterCount(DATA.students);
      box.appendChild(el("div", null, "반영된 월: <b>" + months + "</b> <span class='badge-src'>Supabase</span>" +
        (rc ? " · 연락처 <b>" + rc + "명</b>" : " · <span style='color:#c0392b'>명부 없음</span>")));
      var right = el("div", null, "");
      var out = el("button", null, "로그아웃");
      out.addEventListener("click", function () { window.SCApi.adminSignOut().then(function () { window.location.reload(); }); });
      right.appendChild(out);
      box.appendChild(right);
      return;
    }
    var active = window.SCDataset.active();
    var uploaded = window.SCDataset.isUploaded();
    var months = (active && active.months || []).map(ymLabel).join(", ") || "없음";
    box.innerHTML = "";
    var rcL = rosterCount(active && active.students);
    var left = el("div", null, "반영된 월: <b>" + months + "</b> " +
      "<span class='badge-src" + (uploaded ? "" : " bundled") + "'>" + (uploaded ? "업로드본" : "기본 샘플") + "</span>" +
      (rcL ? " · 연락처 <b>" + rcL + "명</b>" : " · 명부 없음"));
    box.appendChild(left);
    var right = el("div", null, "");
    var exportBtn = el("button", null, "데이터 내보내기");
    exportBtn.addEventListener("click", function () {
      var data = window.SCDataset.active() || {};
      data._exportedMonths = data.months;
      data._corrections = window.SCCorr ? window.SCCorr.loadAll() : {};
      var blob = new Blob([JSON.stringify(data)], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = "studycore-dataset.json";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
    right.appendChild(exportBtn);
    if (uploaded) {
      var btn = el("button", null, "초기화");
      btn.addEventListener("click", function () {
        if (window.confirm("업로드한 데이터를 지우고 기본 샘플로 되돌릴까요? 확인 완료 기록은 유지됩니다.")) {
          window.SCDataset.reset(); window.location.reload();
        }
      });
      right.appendChild(btn);
    }
    box.appendChild(right);
  }
  function showPreview(built) {
    var s = built.summary;
    var box = $("upload-preview");
    box.hidden = false;
    box.innerHTML = "";
    var grid = el("div", "up-grid");
    function cell(v, l, warn) {
      var c = el("div"); c.appendChild(el("div", "v" + (warn ? " warn" : ""), v)); c.appendChild(el("div", "l", l)); return c;
    }
    grid.appendChild(cell(s.months.map(ymLabel).join(", "), "월"));
    grid.appendChild(cell(s.studentCount, "학생 수"));
    grid.appendChild(cell(s.rowCount, "기록 수"));
    grid.appendChild(cell(s.autoCount, "확인 대상", s.autoCount > 0));
    box.appendChild(grid);

    // 현재 반영된 데이터와 비교: 신규 월 vs 덮어쓰기 월
    var active = REMOTE ? DATA : (window.SCDataset.active() || { months: [] });
    var existing = {};
    (active.months || []).forEach(function (m) { existing[m] = 1; });
    var newMonths = s.months.filter(function (m) { return !existing[m]; });
    var overMonths = s.months.filter(function (m) { return existing[m]; });

    if (newMonths.length) {
      box.appendChild(el("div", "up-note ok",
        "<b>새로 추가</b> · " + newMonths.map(ymLabel).join(", ")));
    }
    if (overMonths.length) {
      box.appendChild(el("div", "up-note warn",
        "<b>다시 반영</b> · " + overMonths.map(ymLabel).join(", ") +
        " — 기존 월 데이터가 이 파일로 바뀝니다. 확인 완료 기록은 유지됩니다."));
    }

    var apply = el("div", "up-apply");
    var btn = el("button", "btn-primary", overMonths.length ? "다시 반영" : "반영");
    btn.addEventListener("click", function () {
      if (overMonths.length &&
        !window.confirm(overMonths.map(ymLabel).join(", ") + " 데이터를 다시 반영할까요?\n확인 완료 기록은 유지됩니다.")) return;
      if (REMOTE) {
        var base = { months: DATA.months, openDays: DATA.openDays, classAverages: DATA.classAverages, students: DATA.students.slice() };
        var merged = window.SCIngest.merge(base, built.dataset);
        merged.classAverages = window.SCAgg.computeClassAverages(merged, getCorr);
        btn.disabled = true; uMsg("저장 중입니다.", "");
        window.SCApi.saveDataset(merged).then(function () {
          uMsg("반영했습니다. 화면을 새로고침합니다.", "ok");
          window.setTimeout(function () { window.location.reload(); }, 700);
        }).catch(function (ex) { btn.disabled = false; uMsg("저장하지 못했습니다: " + (ex.message || ex), "err"); });
      } else {
        var mergedL = window.SCIngest.merge(window.SCDataset.seed(), built.dataset);
        window.SCDataset.save(mergedL);
        uMsg("반영했습니다. 화면을 새로고침합니다.", "ok");
        window.setTimeout(function () { window.location.reload(); }, 600);
      }
    });
    apply.appendChild(btn);
    box.appendChild(apply);
  }
  function handleFile(file) {
    if (!file) return;
    if (!window.XLSX) { uMsg("엑셀 파일을 읽을 준비가 되지 않았습니다.", "err"); return; }
    $("upload-fname").textContent = "📄 " + file.name;
    uMsg("", null); $("upload-preview").hidden = true; pendingBuilt = null;
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var wb = window.XLSX.read(new Uint8Array(e.target.result), { type: "array" });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
        var built = window.SCIngest.buildFromRows(rows);
        if (!built.ok) { uMsg("⚠️ " + built.error, "err"); return; }
        pendingBuilt = built;
        showPreview(built);
      } catch (err) { uMsg("엑셀 파일을 읽지 못했습니다: " + err.message, "err"); }
    };
    reader.onerror = function () { uMsg("파일을 읽지 못했습니다.", "err"); };
    reader.readAsArrayBuffer(file);
  }
  function setupUpload() {
    var input = $("file-input"), drop = $("upload-drop");
    $("btn-pick").addEventListener("click", function () { input.click(); });
    input.addEventListener("change", function (e) { handleFile(e.target.files && e.target.files[0]); });
    ["dragenter", "dragover"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("drag"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("drag"); });
    });
    drop.addEventListener("drop", function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      handleFile(f);
    });
    renderLoadedInfo();
  }

  /* ---------- 학생 명부 업로드 ---------- */
  function rMsg(text, cls) {
    var box = $("roster-msg");
    if (!text) { box.hidden = true; return; }
    box.hidden = false; box.className = "upload-msg " + (cls || ""); box.textContent = text;
  }
  function showRosterPreview(built) {
    var s = built.summary;
    var box = $("roster-preview");
    box.hidden = false; box.innerHTML = "";

    var grid = el("div", "up-grid");
    function cell(v, l, warn) {
      var c = el("div"); c.appendChild(el("div", "v" + (warn ? " warn" : ""), v)); c.appendChild(el("div", "l", l)); return c;
    }
    grid.appendChild(cell(s.count, "학생 수"));
    grid.appendChild(cell(s.withGuardian, "보호자 번호"));
    grid.appendChild(cell(s.withStudent, "학생 번호"));
    grid.appendChild(cell(s.noPhone, "연락처 없음", s.noPhone > 0));
    box.appendChild(grid);

    // 상태 분포
    var stKeys = Object.keys(s.statusCount).sort(function (a, b) { return s.statusCount[b] - s.statusCount[a]; });
    if (stKeys.length) {
      box.appendChild(el("div", "up-note ok", "상태 · " +
        stKeys.map(function (k) { return k + " " + s.statusCount[k]; }).join(" / ")));
    }

    // 현재 데이터와 매칭 추정
    var active = REMOTE ? DATA : (window.SCDataset.active() || { students: [] });
    var names = {};
    (active.students || []).forEach(function (st) { names[st.name] = 1; });
    var matched = 0, rosterOnly = 0;
    built.roster.forEach(function (rec) { if (names[rec.name]) matched++; else rosterOnly++; });
    box.appendChild(el("div", "up-note ok",
      "출결 매칭 <b>" + matched + "명</b> · 신규 <b>" + rosterOnly + "명</b>"));
    box.appendChild(el("div", "up-note warn",
      "로그인 번호와 학생 정보가 이 명부 기준으로 업데이트됩니다."));

    var apply = el("div", "up-apply");
    var btn = el("button", "btn-primary", "반영");
    btn.addEventListener("click", function () { applyRoster(built, btn); });
    apply.appendChild(btn);
    box.appendChild(apply);
  }
  function applyRoster(built, btn) {
    if (REMOTE) {
      var base = { months: DATA.months, openDays: DATA.openDays, classAverages: DATA.classAverages, students: DATA.students.slice() };
      var res = window.SCRoster.applyToDataset(base, built.roster);
      window.SCIngest.assignPhones(res.dataset.students); // 연락처 없는 학생엔 데모번호 보충
      btn.disabled = true; rMsg("저장 중입니다.", "");
      window.SCApi.saveDataset(res.dataset).then(function () {
        rMsg("명부를 반영했습니다. 화면을 새로고침합니다.", "ok");
        window.setTimeout(function () { window.location.reload(); }, 700);
      }).catch(function (ex) { btn.disabled = false; rMsg("저장하지 못했습니다: " + (ex.message || ex), "err"); });
    } else {
      var baseL = window.SCDataset.seed() || { months: [], openDays: {}, classAverages: {}, students: [] };
      var resL = window.SCRoster.applyToDataset(baseL, built.roster);
      window.SCIngest.assignPhones(resL.dataset.students);
      window.SCDataset.save(resL.dataset);
      rMsg("명부를 반영했습니다. 화면을 새로고침합니다.", "ok");
      window.setTimeout(function () { window.location.reload(); }, 600);
    }
  }
  function handleRosterFile(file) {
    if (!file) return;
    if (!window.XLSX) { rMsg("엑셀 파일을 읽을 준비가 되지 않았습니다.", "err"); return; }
    if (!window.SCRoster) { rMsg("명부 파일을 처리할 준비가 되지 않았습니다.", "err"); return; }
    $("roster-fname").textContent = "📄 " + file.name;
    rMsg("", null); $("roster-preview").hidden = true; pendingRoster = null;
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var wb = window.XLSX.read(new Uint8Array(e.target.result), { type: "array" });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
        var built = window.SCRoster.buildFromRows(rows);
        if (!built.ok) { rMsg("⚠️ " + built.error, "err"); return; }
        pendingRoster = built;
        showRosterPreview(built);
      } catch (err) { rMsg("엑셀 파일을 읽지 못했습니다: " + err.message, "err"); }
    };
    reader.onerror = function () { rMsg("파일을 읽지 못했습니다.", "err"); };
    reader.readAsArrayBuffer(file);
  }
  function setupRoster() {
    var input = $("roster-input"), drop = $("roster-drop");
    $("roster-pick").addEventListener("click", function () { input.click(); });
    input.addEventListener("change", function (e) { handleRosterFile(e.target.files && e.target.files[0]); });
    ["dragenter", "dragover"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("drag"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("drag"); });
    });
    drop.addEventListener("drop", function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      handleRosterFile(f);
    });
  }

  /* ---------- 학생 리포트 검색·미리보기 ---------- */
  function openReport(student) {
    var corrSource = REMOTE
      ? corrMap
      : (window.SCCorr && window.SCCorr.loadAll ? window.SCCorr.loadAll() : {});
    var payload = window.SCPreview.buildPreviewPayload(student, DATA, corrSource);
    var ok = window.SCPreview.writeBuffer(payload);
    if (!ok) { window.alert("미리보기 데이터를 준비하지 못했습니다."); return; }
    window.location.href = "index.html"; // 같은 탭에서 리포트로 전환
  }

  function renderReportResults() {
    var box = $("report-results");
    if (!box) return;
    var term = ($("report-search").value || "").trim();
    box.innerHTML = "";
    if (!term) return; // 입력 시에만 표시

    var matches = window.SCPreview.filterReportStudents(DATA.students, term)
      .sort(function (a, b) { return (a.name || "").localeCompare(b.name || "", "ko"); });

    if (!matches.length) {
      box.appendChild(el("div", "rs-empty", "검색 결과가 없습니다."));
      return;
    }

    matches.forEach(function (s) {
      var row = el("div", "rs-row");
      var info = el("div", "rs-info");
      info.appendChild(el("div", "rs-name", s.name));
      var metaBits = [];
      var meta = window.SCPreview.studentRowMeta(s);
      if (meta) metaBits.push(meta);
      metaBits.push(Object.keys(s.months).length + "개월 데이터");
      info.appendChild(el("div", "rs-meta", metaBits.join(" · ")));
      row.appendChild(info);

      var btn = el("button", "rs-open", "리포트 보기");
      btn.type = "button";
      btn.addEventListener("click", function () { openReport(s); });
      row.appendChild(btn);
      box.appendChild(row);
    });
  }

  // 데이터 준비된 뒤 화면 구성
  function startApp() {
    setupUpload();
    setupRoster();
    initMonthFilter();
    renderList();
    renderReportResults();
  }

  function wireHandlers() {
    var rs = $("report-search");
    if (rs) rs.addEventListener("input", function () { renderReportResults(); });
    $("admin-search").addEventListener("input", function () { renderList(); });
    $("admin-sort").addEventListener("change", function () { renderList(); });
    $("btn-calc").addEventListener("click", function () { showResult(C.parseEventLog($("corr-input").value)); });
    $("btn-clear").addEventListener("click", function () {
      if (!current) return;
      var key = current.key, date = current.date;
      if (REMOTE) {
        window.SCApi.removeCorrection(key, date).then(function () {
          delete corrMap[key + "|" + date]; closeModal(); renderList();
        }).catch(function (ex) { window.alert("삭제하지 못했습니다: " + (ex.message || ex)); });
      } else { C.remove(key, date); closeModal(); renderList(); }
    });
    $("corr-modal").addEventListener("click", function (e) { if (e.target.getAttribute("data-close")) closeModal(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });
  }

  // 로그인 폼 노출(세션 없음/확인 실패 시)
  function showLoginGate() {
    var chk = $("admin-checking"); if (chk) chk.hidden = true;
    $("admin-main").hidden = true;
    $("admin-auth").hidden = false;
  }

  function afterLogin() {
    return window.SCApi.loadAll().then(function (r) {
      DATA = r.dataset; corrMap = r.corrections || {};
      var chk = $("admin-checking"); if (chk) chk.hidden = true;
      $("admin-auth").hidden = true; $("admin-main").hidden = false;
      startApp();
    }).catch(function (ex) {
      var err = $("auth-error");
      err.textContent = "데이터를 불러오지 못했습니다: " + (ex.message || ex); err.hidden = false;
      showLoginGate();
      var b = $("auth-btn"); if (b) { b.disabled = false; b.classList.remove("is-busy"); }
      if (window.console) console.error(ex);
    });
  }

  function init() {
    wireHandlers();
    if (!REMOTE) { startApp(); return; }

    // 서버 모드: 세션 확인 동안에는 "로그인 확인 중…"만 보이고,
    // 세션이 없을 때만 로그인 폼을 띄운다(폼 깜빡임 방지).
    $("admin-main").hidden = true;
    $("admin-auth").hidden = true;
    var chk = $("admin-checking"); if (chk) chk.hidden = false;

    $("auth-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var email = $("auth-email").value.trim(), pw = $("auth-pw").value;
      var err = $("auth-error"); err.hidden = true;
      var b = $("auth-btn"); b.disabled = true; b.classList.add("is-busy");
      window.SCApi.adminSignIn(email, pw).then(function () { return afterLogin(); })
        .catch(function (ex) {
          b.disabled = false; b.classList.remove("is-busy");
          err.textContent = "이메일 또는 비밀번호를 다시 확인해 주세요.";
          err.hidden = false; if (window.console) console.error(ex);
        });
    });
    // 이미 로그인 세션이 있으면 바로 진입, 없으면 로그인 폼 노출
    window.SCApi.currentUser()
      .then(function (u) { if (u) { afterLogin(); } else { showLoginGate(); } })
      .catch(function () { showLoginGate(); });
  }

  if (!C) {
    document.body.innerHTML = "<p style='padding:40px;text-align:center'>모듈 로드 실패</p>";
  } else { init(); }
})();
