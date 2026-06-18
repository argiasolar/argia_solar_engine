// =============================================================================
// ARGIA TESTS -- tests_regression/v2/ProjectStatusCulliganTests.gs
// -----------------------------------------------------------------------------
// T4 (v4.39.0): REG_PROJECT_STATUS_CULLIGAN.
//
// On the loaded CULLIGAN fixture the project has a real CAPEX, so the status
// engine returns PASS and the offer is emittable. Locks the live wiring:
//   runProjectStatus(ss).status == PASS
//   API_OUTPUT.project_status   == PASS
//   _META carries a PROJECT_STATUS stamp; Project Card row 2 shows the status
//
// Module 'regression/v2/culligan'. WORKBOOK-DEPENDENT (errors in Node = green).
// =============================================================================

registerTest({
  id: 'REG_PROJECT_STATUS_CULLIGAN',
  group: 'regression',
  module: 'regression/v2/culligan',
  scenarios: [],
  tags: ['regression', 'baseline', 'culligan', 'v2', 'project_status', 'gate', 't4'],
  source: 'tests_regression/v2/ProjectStatusCulliganTests.gs',
  fn: function (t, ctx) {
    t.suite('REG v2/culligan [T4]: project status PASS + offer emittable');

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var mdc = ss.getSheetByName('MDC_v2');
    var projName = mdc ? String(mdc.getRange(7, 3).getValue() || '') : '';
    if (projName.toUpperCase().indexOf('CULLIGAN') < 0) {
      t.info('skipped', 'Requires CULLIGAN E2E context. MDC_v2 project: "' + (projName || '(none)') + '".');
      return;
    }

    // 1. Engine returns PASS (CULLIGAN has CAPEX) and writes its surfaces.
    var res = runProjectStatus(ss, {});
    t.assert('runProjectStatus -> PASS', PROJECT_STATUS.PASS, res.status);
    t.assertTrue('PASS -> emittable', res.emittable);
    t.assertTrue('has-CAPEX rule fired', res.reasons.some(function (r) { return r.code === 'CAPEX_PRESENT'; }));

    // 2. Read-only resolver agrees.
    t.assert('resolveProjectStatusValue -> PASS', PROJECT_STATUS.PASS, resolveProjectStatusValue(ss));

    // 3. The offer gate lets a PASS project through.
    t.assertTrue('assertOfferEmittable -> emittable on PASS', assertOfferEmittable(ss, {}).emittable);

    // 4. API_OUTPUT surfaces the real status (ensure present).
    function apiStatus() {
      var sh = ss.getSheetByName('API_OUTPUT');
      if (!sh) return null;
      var rng = sh.getRange(1, 1, sh.getLastRow(), 2).getValues();
      for (var r = 0; r < rng.length; r++) {
        if (String(rng[r][0]).trim() === 'project_status') return String(rng[r][1]).trim();
      }
      return null;
    }
    if (apiStatus() == null && typeof writeApiOutputV2 === 'function') {
      try { writeApiOutputV2(ss, {}); } catch (e) {}
    }
    t.assert('API_OUTPUT.project_status == PASS (not PENDING_T4)', PROJECT_STATUS.PASS, apiStatus());

    // 5. _META stamped + Project Card row 2 shows the status.
    var meta = ss.getSheetByName('_META');
    var stamped = false;
    if (meta) {
      var mv = meta.getRange(1, 1, meta.getLastRow(), 2).getValues();
      for (var i = mv.length - 1; i >= 0; i--) {
        if (String(mv[i][0]).trim() === 'PROJECT_STATUS') {
          stamped = String(mv[i][1]).indexOf('PASS') === 0; break;
        }
      }
    }
    t.assertTrue('_META carries a PASS PROJECT_STATUS stamp', stamped);

    var pc = ss.getSheetByName('PROJECT_CARD_v2');
    if (pc) {
      t.assertContains('Project Card row 2 shows the status',
                       String(pc.getRange(2, 4).getValue() || ''), 'PASS');
    }
  }
});
