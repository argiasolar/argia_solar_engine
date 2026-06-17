// =============================================================================
// ARGIA TESTS -- tests_regression/v2/InterconnModeConsistentTests.gs
// -----------------------------------------------------------------------------
// T5 (v4.38.0): REG_INTERCONN_MODE_CONSISTENT.
//
// One interconnection input drives the simulation AND every output. Locks:
//   resolver mode (what the sim ran)  ==  API_OUTPUT[interconnection_mode]
//                                     ==  CFE_OUTPUT displayed mode (token)
//
// Before T5, CFE_OUTPUT and API_OUTPUT re-read raw INPUT_CFE!C41 independently,
// so the displayed mode could disagree with what the sim ran. Now all three
// come from readBessInterconnectionFromInputCfe -- the single resolver.
//
// Module 'regression/v2/culligan'. WORKBOOK-DEPENDENT (errors in Node = green).
// =============================================================================

registerTest({
  id: 'REG_INTERCONN_MODE_CONSISTENT',
  group: 'regression',
  module: 'regression/v2/culligan',
  scenarios: [],
  tags: ['regression', 'baseline', 'culligan', 'v2', 'interconnection', 'mode', 't5'],
  source: 'tests_regression/v2/InterconnModeConsistentTests.gs',
  fn: function (t, ctx) {
    t.suite('REG v2/culligan [T5]: sim mode == output mode (single source)');

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var mdc = ss.getSheetByName('MDC_v2');
    var projName = mdc ? String(mdc.getRange(7, 3).getValue() || '') : '';
    if (projName.toUpperCase().indexOf('CULLIGAN') < 0) {
      t.info('skipped', 'Requires CULLIGAN E2E context. MDC_v2 project: "' + (projName || '(none)') + '".');
      return;
    }

    var CANON = { NET_METERING: 1, NET_BILLING: 1, ZERO_EXPORT: 1, UNKNOWN: 1 };

    // 1. The single resolver = the mode the simulation ran on.
    var resolved = readBessInterconnectionFromInputCfe(ss).mode;
    t.assertTrue('resolver mode is canonical (' + resolved + ')', !!CANON[resolved]);
    t.assert('CULLIGAN resolves NET_METERING', 'NET_METERING', resolved);

    // 2. API_OUTPUT mode == resolver mode (ensure API present).
    function apiMode() {
      var sh = ss.getSheetByName('API_OUTPUT');
      if (!sh) return null;
      var rng = sh.getRange(1, 1, sh.getLastRow(), 2).getValues();
      for (var r = 0; r < rng.length; r++) {
        if (String(rng[r][0]).trim() === 'interconnection_mode') return String(rng[r][1]).trim();
      }
      return null;
    }
    if (apiMode() == null && typeof writeApiOutputV2 === 'function') {
      try { writeApiOutputV2(ss, {}); } catch (e) {}
    }
    t.assert('API_OUTPUT mode == resolver mode (canonical, not raw Spanish)',
             resolved, apiMode());

    // 3. CFE_OUTPUT displayed mode reflects the resolver (not an independent read).
    var co = ss.getSheetByName('CFE_OUTPUT_v2');
    var row = (typeof CFE_OUT_ROW_V2 !== 'undefined' && CFE_OUT_ROW_V2.INTERCONN_ROW)
            ? CFE_OUT_ROW_V2.INTERCONN_ROW : 7;
    var displayed = co ? String(co.getRange(row, 3).getValue() || '') : '';
    if (resolved === 'UNKNOWN') {
      t.assert('UNKNOWN -> "(no definido)"', '(no definido)', displayed);
    } else {
      t.assertContains('CFE_OUTPUT display contains the resolved canonical token',
                       displayed.toUpperCase(), resolved);
    }
    t.info('modes', 'resolver=' + resolved + '  api=' + apiMode() + '  display="' + displayed + '"');
  }
});
