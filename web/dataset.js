/* 활성 데이터셋 로더
 * - 업로드로 만들어진 데이터셋이 localStorage 에 있으면 그것을, 없으면 번들 data.js 사용
 * - window.SCDataset
 */
(function () {
  "use strict";
  var KEY = "studycore_dataset_v1";

  function loadStored() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var d = JSON.parse(raw);
      if (d && d.students && d.students.length) return d;
      return null;
    } catch (e) { return null; }
  }

  // 앱이 실제로 쓰는 데이터셋: 저장본 우선, 없으면 번들
  function active() {
    return loadStored() || (typeof window !== "undefined" ? window.STUDYCORE_DATA : null);
  }
  function isUploaded() { return !!loadStored(); }

  function save(dataset) { localStorage.setItem(KEY, JSON.stringify(dataset)); }
  function reset() { localStorage.removeItem(KEY); }

  // 업로드 시작 베이스: 저장본 있으면 그것, 없으면 번들 data.js 복제(있을 때만)
  function seed() {
    var stored = loadStored();
    if (stored) return stored;
    if (typeof window !== "undefined" && window.STUDYCORE_DATA)
      return JSON.parse(JSON.stringify(window.STUDYCORE_DATA));
    return null;
  }

  var api = { KEY: KEY, active: active, isUploaded: isUploaded, save: save, reset: reset, seed: seed, loadStored: loadStored };
  if (typeof window !== "undefined") window.SCDataset = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
