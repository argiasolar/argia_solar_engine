// =============================================================================
// ARGIA TESTS -- tests_regression/sheet_formulas/BessSimulationFormulasTests.gs
// -----------------------------------------------------------------------------
// PASS 17 MIGRATION: BESS_SIMULATION sheet formulas regression (Phase 4).
//
// SOURCE: addPhase4Tests + 11 _p4_ helpers in 99_TestRunner.gs (lines
//         2705-3120). Migrated 2026-05-21 as part of Pass 17.
//
// FIRST REGISTERED TEST IN THE 'regression' GROUP.
//   Before this pass, runRegressionTests() returned 0 passed / 0 failed
//   because the group was empty. This test exercises the framework's
//   third group for the first time.
//
// SCOPE
//   Writes TESTPROJ_PEAK_001 fixture to INPUT_CFE / INPUT_BESS /
//   INPUT_PROJECT / INPUT_DESIGN, forces a recalc, and runs 6 sub-tests
//   against the resulting BESS_SIMULATION + CFE_SIMULATION sheet
//   formulas:
//
//    1. No error cells in BESS_SIMULATION rows 5-44 cols B-O
//     2. Battery-physics invariants (usableKwh, shaveKw, postBessPuntaKw)
//     3. Reconciliations (Capacidad/Distribucion month vs sheet, annual
//        sum vs O30)
//     4. Waterfall arithmetic (D18 = D14+D15+D16+D17; D18 <= D12)
//     5. Selection-aware behavior (toggle NO -> BESS rows 0, toggle YES
//        -> BESS rows non-zero)
//     6. JS-oracle cross-check (every month: sheet Capacidad agrees with
//        calcPeakShavingImpact() recomputed from sheet's own CFE_SIM
//        values)
//
// CLASSIFICATION
//    group=regression (NOT integration). These tests guard against drift
//   in the sheet's formula layer (BESS_SIMULATION rows that compute
//   savings from CFE_SIMULATION cells). The engine layer is verified by
//   Phase 3 (calcPeakShavingImpact unit + integration tests in Pass 9).
//   Phase 4 verifies the SHEET implements the same math correctly.
//
// DEPENDENCIES
//   Engine: calcPeakShavingImpact (04a_CalcCFEBill.gs)
//   Fixture: TESTPROJ_PEAK_001 (test/TestProjects.gs)
//   Sheets: INPUT_CFE, INPUT_BESS, INPUT_PROJECT, INPUT_DESIGN,
//           CFE_SIMULATION, BESS_SIMULATION (all required, fails loudly
//           if any missing)
//
// SAFETY MODEL -- NOT the Pass 15 helpers
//   Phase 4's backup uses getFormulas + getValues snapshot of the full
//   used range of each input sheet, restored via setValues with formula
//    precedence. This DIFFERS from Pass 15's backupAllInputSheets
//   (which uses Sheet.copyTo) for two reasons:
//     (1) Phase 4 needs INPUT_CFE backup. Pass 15 explicitly EXCLUDES
//         INPUT_CFE because its array formulas in rows 21-29 don't
//         survive clearContents + copyTo cleanly.
//     (2) Phase 4 also backs up INPUT_DESIGN, INPUT_BESS, INPUT_PROJECT
//        with the formula-aware snapshot strategy.
//   Result: Phase 4 must keep its own backup helpers, scoped to this
//   test. Renamed _p4r_ from legacy _p4_ to coexist without collision.
//
// SHEET RECALC NOTE
//   After _p4r_writeFixture, SpreadsheetApp.flush() forces CFE_SIM +
//   BESS_SIM array formulas to recompute. WITHOUT the flush, the
//   sub-tests would read stale values from before the fixture write.
//    This is the entire reason regression tests exist as a distinct
//   group -- they verify sheet behavior, not engine behavior, and
//   require explicit recalc triggers.
//
// FILE-SCOPE HELPERS (11)
//   _p4r_snapshotInputs, _p4r_restoreInputs (sheet backup)
//   _p4r_writeFixture (TESTPROJ_PEAK_001 -> input sheets)
//   _p4r_testNoErrorCells (Test 1)
//   _p4r_testBatteryInvariants (Test 2)
//   _p4r_testReconciliations (Test 3)
//   _p4r_testWaterfallAddsUp (Test 4)
//   _p4r_testSelectionAware (Test 5)
//   _p4r_testJsOracleCrossCheck (Test 6)
//   _p4r_num, _p4r_round (helpers)
//
//   All names use _p4r_ prefix (r = regression, distinguishes from
//   legacy _p4_). Following the same file-scope-helper pattern as
//   Pass 16's _layer1/2/3_.
//
// CO-EXISTENCE
//   Legacy addPhase4Tests in 99_TestRunner.gs unchanged. Both run the
//   same ~14 asserts until the legacy deletion pass.
// =============================================================================


registerTest({
  id      : 'REG_BESS_SIM_FORMULAS',
  group   : 'regression',
  module  : 'regression/bess_sim_formulas',
  scenarios: [],
  tags    : ['regression', 'bess-sim', 'sheet-formulas', 'peak-shaving',
             'live-cell', 'recalc'],
  source  : 'tests_regression/sheet_formulas/BessSimulationFormulasTests.gs',
  fn: function (t, ctx) {
    t.suite('REG regression/bess_sim_formulas: BESS_SIMULATION sheet formulas');

    var ss = ctx.ss;

    if (!ss) {
      t.info('skipped', 'no spreadsheet context');
      return;
    }

    var required = ['INPUT_CFE', 'INPUT_BESS', 'INPUT_PROJECT',
                    'INPUT_DESIGN', 'CFE_SIMULATION', 'BESS_SIMULATION'];
    for (var i = 0; i < required.length; i++) {
      if (!ss.getSheetByName(required[i])) {
        t.fail('required sheet missing', required[i]);
        return;
      }
    }

    var snap = null;
    try {
      snap = _p4r_snapshotInputs(ss);
      _p4r_writeFixture(ss);
      SpreadsheetApp.flush();   // force CFE_SIM + BESS_SIM recalc

      _p4r_testNoErrorCells(t, ss);
      _p4r_testBatteryInvariants(t, ss);
      _p4r_testReconciliations(t, ss);
      _p4r_testWaterfallAddsUp(t, ss);
      _p4r_testSelectionAware(t, ss);
      _p4r_testJsOracleCrossCheck(t, ss);

    } catch (e) {
      t.error('regression test aborted', e);
    } finally {
      if (snap) {
        try {
          _p4r_restoreInputs(ss, snap);
          SpreadsheetApp.flush();
          t.info('cleanup', 'input sheets restored to pre-test state');
        } catch (e2) {
          t.fail('CLEANUP FAILED',
                 'restore your inputs manually: ' + e2.message);
        }
      }
    }
  }
});


// ===========================================================================
// SNAPSHOT / RESTORE -- protect the user's real project data.
// Snapshots full used range of each input sheet (formulas + values).
// Restore writes back with formula precedence (formula wins; if empty,
// use value). This differs from Pass 15's copyTo strategy -- needed for
// INPUT_CFE's array formulas which don't survive copyTo cleanly.
// ===========================================================================

function _p4r_snapshotInputs(ss) {
  var names = ['INPUT_CFE', 'INPUT_BESS', 'INPUT_PROJECT', 'INPUT_DESIGN'];
  var snap = {};
  for (var i = 0; i < names.length; i++) {
    var sh = ss.getSheetByName(names[i]);
    var r = Math.max(sh.getLastRow(), 1);
    var c = Math.max(sh.getLastColumn(), 1);
    snap[names[i]] = {
      rows: r, cols: c,
      formulas: sh.getRange(1, 1, r, c).getFormulas(),
      values:   sh.getRange(1, 1, r, c).getValues()
    };
  }
  return snap;
}


function _p4r_restoreInputs(ss, snap) {
  var names = ['INPUT_CFE', 'INPUT_BESS', 'INPUT_PROJECT', 'INPUT_DESIGN'];
  for (var i = 0; i < names.length; i++) {
    var sh = ss.getSheetByName(names[i]);
    var s = snap[names[i]];
    var rng = sh.getRange(1, 1, s.rows, s.cols);
    var out = [];
    for (var r = 0; r < s.rows; r++) {
      var row = [];
      for (var c = 0; c < s.cols; c++) {
        var f = s.formulas[r][c];
        row.push(f !== '' ? f : s.values[r][c]);
      }
      out.push(row);
    }
    rng.setValues(out);
  }
}


// ===========================================================================
// WRITE FIXTURE -- put TESTPROJ_PEAK_001 into the real input sheets.
//   INPUT_CFE    : 12 identical months of demand/energy
//   INPUT_BESS   : battery specs + PEAK_SHAVING strategy + section-4 fields
//   INPUT_PROJECT: battery toggle D64 = YES
//   INPUT_DESIGN : fixed solar profile (120000 kWh/month, NOT zero -- see
//                  legacy comment about ratchet-floor degenerate test)
// ===========================================================================

function _p4r_writeFixture(ss) {
  var fx  = TESTPROJ_PEAK_001;
  var jan = fx.janInput;
  var b   = fx.bess;

  // INPUT_PROJECT: battery ON
  ss.getSheetByName('INPUT_PROJECT').getRange('D64').setValue('YES');

  // INPUT_CFE: 12 identical months in C..N
  var cfe = ss.getSheetByName('INPUT_CFE');
  var rowMap = [
    { row: 10, val: jan.kWhBase },
    { row: 11, val: jan.kWhIntermedia },
    { row: 12, val: jan.kWhPunta },
    { row: 13, val: jan.kWBase },
    { row: 14, val: jan.kWIntermedia },
    { row: 15, val: jan.kWPunta },
    { row: 17, val: jan.kVArh }
  ];
  for (var i = 0; i < rowMap.length; i++) {
    var twelve = [];
    for (var m = 0; m < 12; m++) twelve.push(rowMap[i].val);
    cfe.getRange(rowMap[i].row, 3, 1, 12).setValues([twelve]);
  }

  // INPUT_BESS: battery specs + PEAK_SHAVING
  var ib = ss.getSheetByName('INPUT_BESS');
  ib.getRange('C6').setValue('CUSTOM_MANUAL');
  ib.getRange('C7').setValue('PEAK_SHAVING');
  ib.getRange('C10').setValue(b.capacityKwh);
  ib.getRange('C11').setValue(b.powerKw);
  ib.getRange('C12').setValue(b.minSocPct);
  ib.getRange('C13').setValue(b.maxSocPct);
  ib.getRange('C14').setValue(b.rtePct);
  ib.getRange('C15').setValue(b.cyclesPerDay);
  ib.getRange('C16').setValue(b.degradationPct);
  // Section 4 (v2.3.0): F.C. + punta hours
  ib.getRange('C23').setValue(b.loadFactorFC);
  ib.getRange('C24').setValue(2);                  // horas punta verano
  ib.getRange('C25').setValue(b.puntaWindowHours); // horas punta invierno

  // INPUT_DESIGN: fixed solar profile, all 12 months.
  // 120000 (not zero) keeps C18 ~230 so the ratchet floor sits below the
  // punta and peak-shaving produces a real saving. See legacy comment.
  var ds = ss.getSheetByName('INPUT_DESIGN');
  var solarFixed = [];
  for (var z = 0; z < 12; z++) solarFixed.push([120000]);
  ds.getRange(34, 7, 12, 1).setValues(solarFixed);  // col G = "GRID kWh"
}


// ===========================================================================
// TEST 1 -- no error cells. After recalc, BESS_SIMULATION must contain
// no #DIV/0! / #REF! / #VALUE! / #ERROR! / #N/A in the data region.
// ===========================================================================

function _p4r_testNoErrorCells(t, ss) {
  var sh = ss.getSheetByName('BESS_SIMULATION');
  var data = sh.getRange(5, 2, 40, 14).getValues();   // rows 5-44, cols B-O
  var errs = ['#DIV/0!', '#REF!', '#VALUE!', '#ERROR!', '#N/A',
              '#NAME?', '#NUM!'];
  var found = [];
  for (var r = 0; r < data.length; r++) {
    for (var c = 0; c < data[r].length; c++) {
      var v = data[r][c];
      if (typeof v === 'string' && errs.indexOf(v) >= 0) {
        found.push('row ' + (r + 5) + ' col ' + (c + 2) + ' = ' + v);
      }
    }
  }
  t.assertTrue('BESS_SIMULATION has no error cells'
               + (found.length ? ' -- FOUND: ' + found.join('; ') : ''),
               found.length === 0);
}


// ===========================================================================
// TEST 2 -- battery-physics invariants. NO tariffs involved; locked to
// exact fixture values. Drift here = battery math in sheet formulas wrong.
// ===========================================================================

function _p4r_testBatteryInvariants(t, ss) {
  var fx = TESTPROJ_PEAK_001, exp = fx.expected;
  var sh = ss.getSheetByName('BESS_SIMULATION');

  // Row 36 -- usable kWh
  var usable = _p4r_num(sh.getRange(36, 4).getValue());
  t.assert('Sheet usableKwh (row 36) = fixture lock',
           exp.usableKwh, _p4r_round(usable, 3), 0.02);

  // Row 26 -- shave kW (winter window, col C is January)
  var shaveJan = _p4r_num(sh.getRange(26, 3).getValue());
  t.assert('Sheet shaveKw (C26, winter) = fixture lock',
           exp.shaveKw, _p4r_round(shaveJan, 2), 0.05);

  // Row 27 -- Dmax punta con BESS
  var postJan = _p4r_num(sh.getRange(27, 3).getValue());
  t.assert('Sheet postBessPuntaKw (C27) = fixture lock',
           exp.postBessPuntaKw, _p4r_round(postJan, 2), 0.05);
}


// ===========================================================================
// TEST 3 -- RECONCILIATIONS. BESS_SIMULATION saving cells must equal the
// same formula recomputed from CFE_SIMULATION's own cells. Tariff-
// independent: a tariff change moves both sides together. This catches a
// wrong formula, not a price change.
// ===========================================================================

function _p4r_testReconciliations(t, ss) {
  var bs = ss.getSheetByName('BESS_SIMULATION');
  var cf = ss.getSheetByName('CFE_SIMULATION');

  // Capacidad reconciliation, January (col C)
  var cf_C21 = _p4r_num(cf.getRange('C21').getValue());  // Demanda Facturable
  var cf_C18 = _p4r_num(cf.getRange('C18').getValue());  // kWMaxAnoMovil
  var cf_C23 = _p4r_num(cf.getRange('C23').getValue());  // Capacidad charge
  var bs_C27 = _p4r_num(bs.getRange('C27').getValue());  // post-BESS punta
  var capRate = cf_C18 !== 0 ? cf_C23 / cf_C18 : 0;
  var dfAfter = Math.max(bs_C27, 0.7 * cf_C18);
  var expCap  = Math.max(0, (cf_C21 - dfAfter) * capRate);
  var sheetCap = _p4r_num(bs.getRange('C30').getValue());
  t.assert('Capacidad C30 reconciles with CFE_SIMULATION cells',
           _p4r_round(expCap, 2), _p4r_round(sheetCap, 2), 0.5);

  // Distribucion reconciliation, January
  var cf_C15 = _p4r_num(cf.getRange('C15').getValue());
  var cf_C16 = _p4r_num(cf.getRange('C16').getValue());
  var cf_C17 = _p4r_num(cf.getRange('C17').getValue());
  var cf_C24 = _p4r_num(cf.getRange('C24').getValue());
  var maxBefore = Math.max(cf_C15, cf_C16, cf_C17);
  var maxAfter  = Math.max(cf_C15, cf_C16, bs_C27);
  var distDenom = Math.min(maxBefore, cf_C18);
  var distRate  = distDenom !== 0 ? cf_C24 / distDenom : 0;
  var expDist = Math.max(0,
    (Math.min(maxBefore, cf_C18) - Math.min(maxAfter, cf_C18)) * distRate);
  var sheetDist = _p4r_num(bs.getRange('C31').getValue());
  t.assert('Distribucion C31 reconciles with CFE_SIMULATION cells',
           _p4r_round(expDist, 2), _p4r_round(sheetDist, 2), 0.5);

  // Annual totals (col O) reconcile with 12 month cells
  var capMonths = bs.getRange(30, 3, 1, 12).getValues()[0];
  var capSum = 0;
  for (var i = 0; i < 12; i++) capSum += _p4r_num(capMonths[i]);
  var capAnnual = _p4r_num(bs.getRange(30, 15).getValue());  // O30
  t.assert('Capacidad annual O30 = sum of 12 months',
           _p4r_round(capSum, 2), _p4r_round(capAnnual, 2), 0.5);
}


// ===========================================================================
// TEST 4 -- waterfall arithmetic. D18 (final) must equal D14+D15+D16+D17.
// Pure arithmetic, no tariffs.
// ===========================================================================

function _p4r_testWaterfallAddsUp(t, ss) {
  var bs = ss.getSheetByName('BESS_SIMULATION');
  var d14 = _p4r_num(bs.getRange('D14').getValue());
  var d15 = _p4r_num(bs.getRange('D15').getValue());
  var d16 = _p4r_num(bs.getRange('D16').getValue());
  var d17 = _p4r_num(bs.getRange('D17').getValue());
  var d18 = _p4r_num(bs.getRange('D18').getValue());
  t.assert('Waterfall final D18 = D14+D15+D16+D17',
           _p4r_round(d14 + d15 + d16 + d17, 2),
           _p4r_round(d18, 2), 0.5);

  var d12 = _p4r_num(bs.getRange('D12').getValue());
  t.assertTrue('Waterfall: final bill D18 <= base bill D12',
               d18 <= d12 + 0.5);
}


// ===========================================================================
// TEST 5 -- selection-aware. Toggle NO -> BESS rows 0. Toggle YES -> BESS
// rows non-zero (when BDF-11 ratchet floor doesn't dominate). Restores toggle
// to YES at the end (fixture state for TEST 6).
//
// BDF-11 NOTE: D15 (Capacidad step savings) = 0 is the *correct* CFE outcome
// when the 0.7 × kWMaxAñoMovil ratchet floor exceeds the post-BESS punta peak.
// This happens when the rolling-window max carries pre-BESS history that the
// post-BESS peak can't undercut in Year 1. The fixture writes kWMaxAnoMovil
// but CFE_SIMULATION!C18 recomputes it from rolling max history -- so the
// fixture's value gets overwritten by whatever the workbook's CFE_SIM
// reconstructs from real load history. With CULLIGAN-class data loaded, C18
// can land at ~900+ and the floor dominates -> D15 correctly = 0.
//
// Therefore the assertion is conditional:
//   - if (0.7 × C18) > C27: Year-1 Capacidad savings SHOULD be 0 (floor dominates)
//   - else:                 Year-1 Capacidad savings SHOULD be > 0
// Both branches are CFE-correct. This test must accept either.
// ===========================================================================

function _p4r_testSelectionAware(t, ss) {
  var ip = ss.getSheetByName('INPUT_PROJECT');
  var bs = ss.getSheetByName('BESS_SIMULATION');
  var cf = ss.getSheetByName('CFE_SIMULATION');

  ip.getRange('D64').setValue('NO');
  SpreadsheetApp.flush();
  var capOff = _p4r_num(bs.getRange('D15').getValue());
  var modeOff = String(bs.getRange('D6').getValue());
  t.assert('Toggle NO -> BESS Capacidad step D15 = 0',
           0, _p4r_round(capOff, 2), 0.01);
  t.assertTrue('Toggle NO -> mode banner says Solo PV',
               modeOff.indexOf('Solo PV') >= 0);

  ip.getRange('D64').setValue('YES');
  SpreadsheetApp.flush();
  var capOn = _p4r_num(bs.getRange('D15').getValue());

  // BDF-11 conditional: read the sheet's recomputed kWMaxAñoMovil and the
  // post-BESS punta peak; the ratchet floor outcome determines what D15
  // should be. Use Jan (column C) for the check -- consistent with the
  // other fixture-lock assertions in this file.
  var cf_C18 = _p4r_num(cf.getRange('C18').getValue());  // kWMaxAñoMovil (sheet-recomputed)
  var bs_C27 = _p4r_num(bs.getRange('C27').getValue());  // post-BESS punta peak
  var floorDominates = (0.7 * cf_C18) > bs_C27;

  if (floorDominates) {
    // Ratchet floor dominates -> Year-1 Capacidad savings is correctly 0.
    // This is the CULLIGAN-class case post-BDF-11. Engine is right.
    t.assert(
      'Toggle YES + floor dominates (0.7 x C18=' + (0.7 * cf_C18).toFixed(0) +
      ' > C27=' + bs_C27.toFixed(0) + ') -> D15 correctly = 0 (Year-1 ratchet)',
      0, _p4r_round(capOn, 2), 0.01);
  } else {
    // Ratchet floor doesn't dominate -> Year-1 Capacidad savings should be > 0.
    // This is the TESTPROJ_PEAK_001-as-designed case (when no CULLIGAN data
    // leaks into the rolling max via CFE_SIM's C18 formula).
    t.assertTrue(
      'Toggle YES + floor does NOT dominate (0.7 x C18=' + (0.7 * cf_C18).toFixed(0) +
      ' <= C27=' + bs_C27.toFixed(0) + ') -> D15 should be non-zero (actual=' +
      capOn.toFixed(2) + ')',
      Math.abs(capOn) > 0);
  }
}


// ===========================================================================
// TEST 6 -- JS-ORACLE cross-check. CFE_SIMULATION recomputes kWMaxAñoMovil
// (C18) by formula. JS oracle must be fed the SHEET'S recomputed C18 (not
// the raw fixture), or the two compute different questions.
// Also dumps 12-month diagnostic INFO rows for any future discrepancy.
// ===========================================================================

function _p4r_testJsOracleCrossCheck(t, ss) {
  var fx = TESTPROJ_PEAK_001;
  var bs = ss.getSheetByName('BESS_SIMULATION');
  var cf = ss.getSheetByName('CFE_SIMULATION');

  // Diagnostic dump -- 12-month side-by-side of CFE_SIM inputs + BESS_SIM
  // outputs. Each row is fully visible in the results sheet for diagnosis.
  var monthLbl = ['Ene','Feb','Mar','Abr','May','Jun',
                  'Jul','Ago','Sep','Oct','Nov','Dic'];
  for (var dm = 0; dm < 12; dm++) {
    var dc = String.fromCharCode(67 + dm);   // C..N
    var line =
      monthLbl[dm] + ' (' + dc + '): '
      + 'C17punta=' + cf.getRange(dc + '17').getValue() + ' '
      + 'C18kWMax=' + cf.getRange(dc + '18').getValue() + ' '
      + 'C20dias=' + cf.getRange(dc + '20').getValue() + ' '
      + 'C21DemF=' + cf.getRange(dc + '21').getValue() + ' '
      + 'C23Cap=' + cf.getRange(dc + '23').getValue() + ' | '
      + 'C26shave=' + bs.getRange(dc + '26').getValue() + ' '
      + 'C27post=' + bs.getRange(dc + '27').getValue() + ' '
      + 'C30capSav=' + bs.getRange(dc + '30').getValue();
    t.info('dump 12mo', line);
  }
  t.info('dump 12mo',
         'BESS O30 capAnnual = ' + bs.getRange(30, 15).getValue());

  // Cross-check: run JS oracle per month on the SHEET'S OWN values.
  // BDF-11: rate derivation changed from C23/C18 to C23/C21 because the
  // sheet formula was fixed: row 23 Capacidad now = C21 × rate (not C18 ×
  // rate). The pre-BDF-11 test divided by C18 because that's what the
  // buggy formula multiplied by — a structural tautology that hid the bug.
  // After BDF-11 the rate must be back-derived from C21 (demanda
  // facturable), which IS what CFE charges against. This brings the test
  // into alignment with the corrected math and the published CFE rates.
  var jsCapAnnual = 0, sheetCapAnnual = 0, mismatch = [];
  for (var m = 0; m < 12; m++) {
    var col = String.fromCharCode(67 + m);   // C..N

    var sheetC17 = _p4r_num(cf.getRange(col + '17').getValue());
    var sheetC18 = _p4r_num(cf.getRange(col + '18').getValue());
    var sheetC21 = _p4r_num(cf.getRange(col + '21').getValue());
    var sheetC23 = _p4r_num(cf.getRange(col + '23').getValue());
    var capRate  = sheetC21 !== 0 ? sheetC23 / sheetC21 : 0;   // BDF-11: was /sheetC18

    // JS input = fixture, but kWMaxAnoMovil and kWPunta from the SHEET
    var jin = {};
    for (var k in fx.janInput) jin[k] = fx.janInput[k];
    jin.kWMaxAnoMovil = sheetC18;
    jin.kWPunta       = sheetC17;
    var tar = {};
    for (var k2 in fx.frozenTariffs) tar[k2] = fx.frozenTariffs[k2];
    tar.capacidad = capRate;

    // Mirror BESS row-26's per-month punta-window pick:
    // winter (C27, 4h) for cols C,D,M,N; summer (C26, 2h) for the rest
    var colNum = 3 + m;
    var isWinterCol = (colNum <= 4 || colNum >= 13);
    var bess = {};
    for (var k3 in fx.bess) bess[k3] = fx.bess[k3];
    bess.puntaWindowHours = isWinterCol ? 4 : 2;

    var r = calcPeakShavingImpact(jin, tar, bess);
    var jsCap    = r.capacidadSavingYear1;
    var sheetCap = _p4r_num(bs.getRange(30, 3 + m).getValue());

    jsCapAnnual    += jsCap;
    sheetCapAnnual += sheetCap;

    // per-month tolerance: 1 peso or 2%, whichever larger
    var tolM = Math.max(1, Math.abs(jsCap) * 0.02);
    if (Math.abs(jsCap - sheetCap) > tolM) {
      mismatch.push(col + ': JS=' + jsCap.toFixed(2)
                    + ' sheet=' + sheetCap.toFixed(2));
    }
  }

  t.info('cross-check',
         'JS annual=' + jsCapAnnual.toFixed(2)
         + '  sheet annual=' + sheetCapAnnual.toFixed(2));

  t.assertTrue('JS oracle vs sheet: every month Capacidad agrees'
               + (mismatch.length ? ' -- MISMATCH: ' + mismatch.join(' | ') : ''),
               mismatch.length === 0);

  var tolA = Math.max(1, Math.abs(jsCapAnnual) * 0.02);
  t.assert('JS oracle vs sheet: annual Capacidad agrees',
           _p4r_round(jsCapAnnual, 0), _p4r_round(sheetCapAnnual, 0), tolA);
}


// ===========================================================================
// HELPERS
// ===========================================================================

function _p4r_num(v) {
  if (typeof v === 'number') return v;
  if (v === '' || v == null) return 0;
  var n = parseFloat(String(v).replace(/[$,]/g, ''));
  return isNaN(n) ? 0 : n;
}

function _p4r_round(n, d) {
  var f = Math.pow(10, d || 0);
  return Math.round(n * f) / f;
}
