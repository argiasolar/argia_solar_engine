// =============================================================================
// ARGIA TESTS -- tests_integration/consistency/ConsistencyLiveTests.gs
// -----------------------------------------------------------------------------
// Runs the cross-tab consistency guard against the LIVE workbook and asserts
// every shared figure agrees across tabs.
//
// EXPECTED STATE BY PHASE
//   - In scripts/full_selftest.js (Node): this is a WORKBOOK-DEPENDENT test.
//     It throws when it touches ctx.ss (which is null headless) and is counted
//     as an expected ERROR -- NOT a regression signal. The Node gate stays GREEN.
//   - In the REAL spreadsheet, BEFORE Phase 0.1: this is RED on purpose. It is
//     the detector catching the CFE base-bill / PV-savings fork. The alert /
//     LOGS will name the exact figures and deltas.
//   - In the REAL spreadsheet, AFTER Phase 0.1 (single CFE bill engine): GREEN.
//     It then stands as a permanent guard against the silent-split bug class.
//
// CLASSIFICATION: group=integration. Needs INPUT data + generated CFE/BESS/
// SLIDE tabs. Fails loudly (by design) while a fork exists.
// =============================================================================

registerTest({
  id     : 'INT_CONSISTENCY_LIVE',
  group  : 'integration',
  module : 'integration/consistency_live',
  scenarios: [],
  tags   : ['integration', 'consistency', 'guard', 'phase-0.3', 'live-cell'],
  source : 'tests_integration/consistency/ConsistencyLiveTests.gs',
  fn: function (t, ctx) {
    t.suite('INT integration/consistency_live: assertCrossTabConsistency');

    var ss = ctx && ctx.ss ? ctx.ss : SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) { t.info('skipped', 'no spreadsheet context'); return; }

    var required = ['CFE_SIMULATION', 'BESS_SIMULATION', 'SLIDE_DATA'];
    for (var i = 0; i < required.length; i++) {
      if (!ss.getSheetByName(required[i])) {
        t.info('skipped', 'missing sheet ' + required[i]
             + ' -- generate a project first');
        return;
      }
    }

    var result = assertCrossTabConsistency(ss, { throwOnFork: false });

    // Surface the report regardless of pass/fail so a red run is self-explaining.
    t.info('consistency report', result.report);

    // Hard assertion: no figure may fork across tabs.
    t.assertTrue('all shared figures agree across tabs (0 forks)', result.ok);
    t.assert('violation count is zero', 0, result.violations.length);
  }
});
