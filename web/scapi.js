/* Supabase 데이터 액세스 래퍼 — window.SCApi
 * - 설정(config.js)이 있고 supabase-js가 로드됐을 때만 enabled
 * - 학부모: rpt_get_report RPC (본인 데이터만)
 * - 원장: Supabase Auth 로그인 + rpt_* 테이블 upsert/select
 */
(function () {
  "use strict";
  var cfg = (typeof window !== "undefined" && window.SC_SUPABASE) || null;
  var _client = null;

  function enabled() {
    return !!(cfg && cfg.url && cfg.anonKey && typeof window !== "undefined" && window.supabase);
  }
  function client() {
    if (!_client && enabled()) {
      _client = window.supabase.createClient(cfg.url, cfg.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      });
    }
    return _client;
  }

  /* ---------- 학부모: 본인 리포트 ---------- */
  async function getReport(name, phone4) {
    var r = await client().rpc("rpt_get_report", { p_name: name, p_phone4: phone4 });
    if (r.error) throw r.error;
    return r.data; // null 또는 { student, months, openDays, classAverages, corrections }
  }

  /* ---------- 원장 인증 ---------- */
  async function adminSignIn(email, password) {
    var r = await client().auth.signInWithPassword({ email: email, password: password });
    if (r.error) throw r.error;
    return r.data;
  }
  async function adminSignOut() { try { await client().auth.signOut(); } catch (e) {} }
  async function currentUser() {
    var r = await client().auth.getUser();
    return (r.data && r.data.user) || null;
  }

  /* ---------- 원장: 전체 데이터 로드(보정 목록·업로드 병합용) ---------- */
  async function loadAll() {
    var metaR = await client().from("rpt_meta").select("*").eq("id", 1).maybeSingle();
    if (metaR.error) throw metaR.error;
    var stuR = await client().from("rpt_students").select("*");
    if (stuR.error) throw stuR.error;
    var corrR = await client().from("rpt_corrections").select("*");
    if (corrR.error) throw corrR.error;

    var meta = metaR.data || { months: [], open_days: {}, class_averages: {} };
    var students = (stuR.data || []).map(function (row) {
      var phones = row.phones || [];
      return {
        key: row.key, name: row.name, phoneLast4: row.phone4, seat: row.seat,
        loginPhones: phones, phoneFromRoster: phones.length > 0,
        profile: row.profile || null,
        months: (row.data && row.data.months) || {},
      };
    });
    var corrections = {};
    (corrR.data || []).forEach(function (row) { corrections[row.student_key + "|" + row.date] = row.payload; });

    return {
      dataset: {
        months: meta.months || [], openDays: meta.open_days || {},
        classAverages: meta.class_averages || {}, students: students,
      },
      corrections: corrections,
    };
  }

  /* ---------- 원장: 업로드 데이터셋 저장 ---------- */
  async function saveDataset(ds) {
    var m = await client().from("rpt_meta").upsert({
      id: 1, months: ds.months, open_days: ds.openDays,
      class_averages: ds.classAverages || {}, updated_at: new Date().toISOString(),
    });
    if (m.error) throw m.error;
    var rows = ds.students.map(function (s) {
      return {
        key: s.key || s.name, name: s.name, phone4: s.phoneLast4, seat: s.seat == null ? null : s.seat,
        phones: s.loginPhones || [], profile: s.profile || {},
        data: { months: s.months }, updated_at: new Date().toISOString(),
      };
    });
    // 배치 upsert (대량이면 분할)
    for (var i = 0; i < rows.length; i += 200) {
      var r = await client().from("rpt_students").upsert(rows.slice(i, i + 200));
      if (r.error) throw r.error;
    }
  }

  /* ---------- 원장: 보정 저장/삭제 ---------- */
  async function saveCorrection(key, date, payload) {
    var r = await client().from("rpt_corrections").upsert({
      student_key: key, date: date, payload: payload, updated_at: new Date().toISOString(),
    });
    if (r.error) throw r.error;
  }
  async function removeCorrection(key, date) {
    var r = await client().from("rpt_corrections").delete().eq("student_key", key).eq("date", date);
    if (r.error) throw r.error;
  }
  async function saveClassAverages(classAverages) {
    var r = await client().from("rpt_meta").update({ class_averages: classAverages, updated_at: new Date().toISOString() }).eq("id", 1);
    if (r.error) throw r.error;
  }

  window.SCApi = {
    enabled: enabled, getReport: getReport,
    adminSignIn: adminSignIn, adminSignOut: adminSignOut, currentUser: currentUser,
    loadAll: loadAll, saveDataset: saveDataset,
    saveCorrection: saveCorrection, removeCorrection: removeCorrection, saveClassAverages: saveClassAverages,
  };
})();
