// =============================================================================
// ARGIA TESTS -- tests_regression/baseline/CulliganBessInstallGuardTests.gs
// -----------------------------------------------------------------------------
// CULLIGAN regression guard for chunk bess_install.
//
// WHAT THIS PROTECTS
//   CULLIGAN is a PV-only project (no battery). After adding the BESS
//   library rows + the BESS driver block, any leak that causes BESS install
//   lines to fire on a PV-only project would inflate the install total
//   and break the existing CULLIGAN baseline lock (INSTALL.G9 = 516,805.26).
//
//   That existing lock is the primary safety net. This test is the
//   secondary, structural safety net: it walks every row in the
//   INSTALLATION sheet, finds every line whose COST_ITEM_ID starts with
//   "BESS-I-", and asserts the TOTAL_MXN for each is exactly 0.
//
//   If any BESS install line has a nonzero total on CULLIGAN, this test
//   fails BEFORE the baseline grand-total assertion -- giving a clearer
//   error message ("BESS-I-03 leaked 15,000 MXN") instead of just
//   ("grand total 531,805.26 != 516,805.26").
//
// SCOPE (read-only)
//   Same Option A pattern as CulliganBaselineTests.gs: this test does NOT
//   write fixture inputs and does NOT run the engine. It asserts on
//   whatever is currently sitting in INSTALLATION. The caller must run
//   runArgiaEngine() against CULLIGAN inputs IMMEDIATELY BEFORE invoking
//   this test.
//
// CLASSIFICATION
//   group=regression. Tagged 'bess_install' so it runs as part of the
//   current chunk check; tagged 'regression' + 'baseline' so it joins
//   the full regression suite afterward.
// =============================================================================


registerTest({
  id      : 'REG_CULLIGAN_BESS_INSTALL_GUARD',
  group   : 'regression',
  module  : 'regression/baseline/culligan_bess_install',
  scenarios: [],
  tags    : ['regression', 'baseline', 'culligan', 'real-project', 'read-only',
             'bess', 'bess_install'],
  source  : 'tests_regression/baseline/CulliganBessInstallGuardTests.gs',
  fn: function (t, ctx) {
    t.suite('REG: CULLIGAN (PV-only) emits zero BESS install cost');

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var inst = ss.getSheetByName('INSTALLATION');
    if (!inst) {
      t.fail('INSTALLATION sheet missing', 'Run runArgiaEngine() first.');
      return;
    }

    // Find the line-item header row. Per 13_CalcInstallCost.js:
    //   IC_LINE_HEADER_ROW = 40
    //   IC_LINE_START_ROW  = 41
    // We'll be robust to header drift by scanning for "ID" in col C.
    var headerRow = 40;
    var idHdr = String(inst.getRange(headerRow, 3).getValue() || '').trim().toUpperCase();
    if (idHdr !== 'ID') {
      // Fallback scan: look at rows 30-50 for "ID" in col C
      for (var hr = 30; hr <= 50; hr++) {
        var v = String(inst.getRange(hr, 3).getValue() || '').trim().toUpperCase();
        if (v === 'ID') { headerRow = hr; break; }
      }
    }
    var startRow = headerRow + 1;

    // Walk the line-item block. We stop at the first row with empty col C
    // (no ID) -- the legacy writer leaves a blank row after the last item.
    // Conservatively scan up to row 250 to avoid an infinite loop.
    var bessLines      = [];
    var nonzeroLeaks   = [];
    var bessLineCount  = 0;
    for (var r = startRow; r <= 250; r++) {
      var id = inst.getRange(r, 3).getValue();
      if (id === '' || id === null || id === undefined) {
        // Skip blank rows but don't terminate -- subsection separators may
        // leave a blank C. Stop only when we hit a section summary row
        // (col F = section name; col C is empty for many rows after item
        // block). Practical guard: stop if THREE consecutive blanks.
        var nextId  = inst.getRange(r + 1, 3).getValue();
        var nextId2 = inst.getRange(r + 2, 3).getValue();
        if ((nextId === '' || nextId === null) &&
            (nextId2 === '' || nextId2 === null)) {
          break;
        }
        continue;
      }
      var idStr = String(id).trim();
      if (idStr.indexOf('BESS-I-') === 0) {
        bessLineCount++;
        // TOTAL_MXN is col Y (column 25) per IC_LINE_COLS.TOTAL_MXN
        var totalMxn = Number(inst.getRange(r, 25).getValue()) || 0;
        bessLines.push({ row: r, id: idStr, totalMxn: totalMxn });
        if (Math.abs(totalMxn) > 0.5) {  // 0.5 MXN tolerance for float drift
          nonzeroLeaks.push(idStr + ' (row ' + r + '): ' + totalMxn.toFixed(2) + ' MXN');
        }
      }
    }

    // Sanity check: we expect to find roughly 20 BESS lines (matches the
    // 20 BESS-I-* rows we added to INSTALL_DB). If we find zero, the lib
    // mirror IMPORTRANGE may not have synced -- which is information the
    // tester needs.
    if (bessLineCount === 0) {
      t.info('no BESS lib rows found',
             'INSTALLATION has no BESS-I-* lines. Possible causes: (1) ' +
             'INSTALL_DB mirror not synced yet (IMPORTRANGE refresh '   +
             'pending), (2) all 20 BESS rows ACTIVE=NO in DB. Skipping ' +
             'leak check.');
      return;
    }

    t.assertTrue('found at least one BESS-I-* line in INSTALLATION',
                 bessLineCount > 0);
    t.info('BESS install line count',
           'Found ' + bessLineCount + ' BESS-I-* rows in INSTALLATION.');

    // The hard assertion: no leak.
    if (nonzeroLeaks.length > 0) {
      t.fail('BESS install cost leaked on CULLIGAN (PV-only project)',
             nonzeroLeaks.join('; '));
    } else {
      t.assertTrue('all BESS-I-* lines on CULLIGAN have TOTAL_MXN <= 0.5 MXN', true);
    }
  }
});
