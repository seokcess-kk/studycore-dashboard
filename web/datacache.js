/* 관리자 데이터셋 캐시(stale-while-revalidate) — window.SCCache
 * loadAll 결과({ dataset, corrections })를 sessionStorage에 저장해 재방문 시 즉시 렌더.
 * 저장 실패(용량 초과 등)·손상 캐시는 안전하게 null/false로 폴백한다.
 */
(function () {
  "use strict";
  var KEY = "studycore_admin_dataset";

  function get() {
    try {
      var raw = window.sessionStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function set(data) {
    try { window.sessionStorage.setItem(KEY, JSON.stringify(data)); return true; }
    catch (e) { return false; }
  }
  function clear() {
    try { window.sessionStorage.removeItem(KEY); } catch (e) {}
  }

  var api = { KEY: KEY, get: get, set: set, clear: clear };
  if (typeof window !== "undefined") window.SCCache = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
