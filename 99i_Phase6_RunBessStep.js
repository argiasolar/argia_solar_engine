// =============================================================================
// ARGIA ENGINE -- Phase 6 test suite: runBessStep()
// Paste this function into 99_TestRunner.gs, and add the call
//   try { addPhase6Tests(t, ss); } catch (e) { t.error('Phase6 aborted', e); }
// right after the addPhase5Tests block in runTests().
//
// SCOPE: runBessStep() — the engine's BESS step.
//   Spreadsheet-backed: snapshots INPUT_PROJECT!D64 + INPUT_BESS cells,
//   writes known values, asserts, and restores in a finally block.
// =============================================================================

function addPhase6Tests(t, ss) {
  t.suite('Phase6: runBessStep engine step');

  var shProj = ss.getSheetByName('INPUT_PROJECT');
  var shBess = ss.getSheetByName('INPUT_BESS');
  if (!shProj || !shBess) {
    t.error('Phase6 setup', new Error('INPUT_PROJECT or INPUT_BESS sheet missing'));
    return;
  }

  // -- Snapshot every cell runBessStep (via readInputBess) touches ---------
  var rows = [6, 7, 10, 11, 12, 13, 14, 15, 16, 17, 20];
  var snap = { toggle: shProj.getRange(64, 4).getValue(), bess: {} };
  rows.forEach(function(r) { snap.bess[r] = shBess.getRange(r, 3).getValue(); });

  function restore() {
    shProj.getRange(64, 4).setValue(snap.toggle);
    rows.forEach(function(r) { shBess.getRange(r, 3).setValue(snap.bess[r]); });
    SpreadsheetApp.flush();
  }

  // Helper: write a full, valid 200 kWh / 100 kW battery.
  function writeValidBattery() {
    shProj.getRange(64, 4).setValue('YES');
    shBess.getRange(6,  3).setValue('CUSTOM_MANUAL');
    shBess.getRange(7,  3).setValue('SELF_CONSUMPTION_MAX');
    shBess.getRange(10, 3).setValue(200);
    shBess.getRange(11, 3).setValue(100);
    shBess.getRange(12, 3).setValue(0.10);
    shBess.getRange(13, 3).setValue(0.90);
    shBess.getRange(14, 3).setValue(0.90);
    shBess.getRange(15, 3).setValue(1.0);
    shBess.getRange(16, 3).setValue(0.025);
    shBess.getRange(17, 3).setValue(0.0);
    shBess.getRange(20, 3).setValue(1500000);
    SpreadsheetApp.flush();
  }

  try {
    // === TEST 1: function exists =========================================
    t.assert('runBessStep function defined',
             'function', typeof runBessStep);

    // === TEST 2: toggle NO -> clean disabled result ======================
    shProj.getRange(64, 4).setValue('NO');
    SpreadsheetApp.flush();
    var off = runBessStep(ss);
    t.assertFalse('Toggle NO -> bessEnabled false', off.bessEnabled);
    t.assert('Toggle NO -> bess is null',          null, off.bess);
    t.assert('Toggle NO -> usableCapacityKwh 0',   0,    off.usableCapacityKwh);
    t.assert('Toggle NO -> monthlyThroughputKwh 0',0,    off.monthlyThroughputKwh);
    t.assert('Toggle NO -> 0 warnings',            0,    off.warnings.length);

    // === TEST 3: valid battery -> correct derived quantities =============
    writeValidBattery();
    var on = runBessStep(ss);
    t.assertTrue('Valid battery -> bessEnabled true', on.bessEnabled);

    // usable = 200 x (0.90-0.10) x (1-0.025) x (1-0.0)
    //        = 200 x 0.80 x 0.975 x 1.0 = 156.00 kWh
    t.assert('usableCapacityKwh = 156.00', 156.00, on.usableCapacityKwh, 0.001);

    // throughput = 156.00 x 1.0 cycle/day x 30.42 days x 0.90 RTE
    //            = 156.00 x 27.378 = 4270.968 kWh
    t.assert('monthlyThroughputKwh = 4270.968',
             4270.968, on.monthlyThroughputKwh, 0.01);

    // Cross-check: usable here must equal _bessUsableKwh() from 04a
    // (same formula, single source of truth for the deration chain).
    t.assert('usableCapacityKwh matches _bessUsableKwh helper',
             _bessUsableKwh(on.bess), on.usableCapacityKwh, 0.001);

    // Clean valid battery -> no warnings.
    t.assert('Valid battery -> 0 warnings', 0, on.warnings.length);

    // === TEST 4: invalid spec -> throws ==================================
    // maxSoc <= minSoc must be a hard error, not a silent bad number.
    writeValidBattery();
    shBess.getRange(12, 3).setValue(0.90);   // minSoc
    shBess.getRange(13, 3).setValue(0.10);   // maxSoc  (inverted)
    SpreadsheetApp.flush();
    var threw = false;
    try { runBessStep(ss); } catch (e) { threw = true; }
    t.assertTrue('maxSoc <= minSoc -> runBessStep throws', threw);

    // === TEST 5: soft warnings fire (valid but flagged) ==================
    // Low RTE (0.70) + zero CAPEX -> warnings, but NOT an error.
    writeValidBattery();
    shBess.getRange(14, 3).setValue(0.70);   // low RTE
    shBess.getRange(20, 3).setValue(0);      // zero CAPEX
    SpreadsheetApp.flush();
    var warned = runBessStep(ss);
    t.assertTrue('Low RTE + zero CAPEX -> still enabled (no throw)',
                 warned.bessEnabled);
    t.assertTrue('Low RTE + zero CAPEX -> warnings raised',
                 warned.warnings.length >= 2);

    // === TEST 6: toggle YES but capacity 0 -> disabled, no throw =========
    writeValidBattery();
    shBess.getRange(10, 3).setValue(0);      // capacity 0
    SpreadsheetApp.flush();
    var zeroCap = runBessStep(ss);
    t.assertFalse('Toggle YES + capacity 0 -> bessEnabled false',
                  zeroCap.bessEnabled);

    // === TEST 7: summary lines are produced ==============================
    writeValidBattery();
    var summed = runBessStep(ss);
    t.assertTrue('Valid battery -> summary has >= 1 line',
                 summed.summary.length >= 1);

  } finally {
    restore();
    t.info('Phase6 cleanup', 'INPUT_PROJECT/INPUT_BESS restored to pre-test state');
  }
}