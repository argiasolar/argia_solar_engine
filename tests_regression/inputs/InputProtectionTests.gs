// =============================================================================
// ARGIA TESTS -- tests_regression/inputs/InputProtectionTests.gs   (A1)
// -----------------------------------------------------------------------------
// Locks the input-protection contract added in 00d_InputSnapshot.gs:
//   1. A snapshot covers every present INPUT_* tab (no tab silently skipped).
//   2. restoreInputSheets round-trips a literal value.
//   3. Restore preserves FORMULAS (formula precedence), not just values.
//
// SELF-PROTECTING: the one cell this test touches (INPUT_DESIGN!C9) is captured
// up-front and rewritten in a finally, independent of the code under test --
// so a bug in snapshot/restore cannot leave the workbook dirty. (And the
// runner now wraps the whole run in protection as a second safety net.)
// =============================================================================

registerTest({
  id: 'REG_INPUT_PROTECTION',
  group: 'regression',
  module: 'regression/inputs/protection',
  source: 'tests_regression/inputs/InputProtectionTests.gs',
  fn: function (t, ctx) {
    t.suite('REG regression/inputs/protection: snapshot+restore contract');

    var ss = (ctx && ctx.ss) || SpreadsheetApp.getActiveSpreadsheet();
    var ds = ss.getSheetByName('INPUT_DESIGN');
    if (!ds) { t.fail('required sheet missing', 'INPUT_DESIGN'); return; }

    // INPUT_DESIGN!C9 = "Temperatura mínima sitio" (numeric user input).
    var cell        = ds.getRange('C9');
    var origFormula = cell.getFormula();   // '' if literal
    var origValue   = cell.getValue();

    try {
      // --- 1. Coverage: every present INPUT_* tab is in the snapshot --------
      var snap = snapshotInputSheets(ss);
      var expectTabs = ['INPUT_PROJECT', 'INPUT_DESIGN', 'INPUT_INSTALL',
                        'INPUT_CFE', 'INPUT_BESS', 'INPUT_BAAS'];
      var missing = [];
      for (var i = 0; i < expectTabs.length; i++) {
        if (ss.getSheetByName(expectTabs[i]) && !snap[expectTabs[i]]) {
          missing.push(expectTabs[i]);
        }
      }
      t.assertTrue('snapshot covers every present INPUT_* tab (missing: ['
                   + missing.join(',') + '])', missing.length === 0);

      // --- 2. Value round-trip ---------------------------------------------
      var snapA = snapshotInputSheets(ss);
      cell.setValue(-999);
      SpreadsheetApp.flush();
      restoreInputSheets(ss, snapA);
      SpreadsheetApp.flush();
      t.assertTrue('value round-trips: C9 restored to original',
                   ds.getRange('C9').getValue() === origValue);

      // --- 3. Formula precedence -------------------------------------------
      cell.setFormula('=40+2');            // place a formula in C9
      SpreadsheetApp.flush();
      var snapB = snapshotInputSheets(ss);
      cell.setValue(7);                    // clobber it with a literal
      SpreadsheetApp.flush();
      restoreInputSheets(ss, snapB);
      SpreadsheetApp.flush();
      t.assertTrue('formula precedence: C9 restored as formula "=40+2"',
                   ds.getRange('C9').getFormula() === '=40+2');
      t.assertTrue('restored formula evaluates to 42',
                   ds.getRange('C9').getValue() === 42);

    } catch (e) {
      t.error('input-protection test aborted', e);
    } finally {
      // Belt-and-suspenders: restore C9 exactly, regardless of SUT behaviour.
      try {
        if (origFormula) ds.getRange('C9').setFormula(origFormula);
        else             ds.getRange('C9').setValue(origValue);
        SpreadsheetApp.flush();
        t.info('cleanup', 'INPUT_DESIGN!C9 restored to original');
      } catch (ce) {
        t.fail('CLEANUP FAILED', 'INPUT_DESIGN!C9 not restored: ' + ce.message);
      }
    }
  }
});
