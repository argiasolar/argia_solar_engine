// =============================================================================
// ARGIA ENGINE -- File: 99g_TestRunner_Phase4.gs
// Phase 4 (v2.3.2) regression suite: BESS_SIMULATION sheet formulas.
//
// WHY THIS SUITE EXISTS
//   The Phase 3 suite verifies calcPeakShavingImpact() — the JavaScript.
//   But BESS_SIMULATION (rebuilt in v2.3.1) is a FORMULA sheet: its numbers
//   come from spreadsheet cells, not from that JS. A wrong cell reference,
//   a sign error, or formula/JS drift would NOT be caught by Phase 3.
//   Phase 4 closes that gap: it writes a known fixture into the real input
//   sheets, forces recalculation, reads BESS_SIMULATION back, and checks it.
//
// DESIGN — why it cannot false-fail on a tariff update
//   The live tariff table 20M_CFE_TARIFFS is per-month and changes over time
//   (e.g. Jan Capacidad 392.20, Mar 130.04). A test that locked exact pesos
//   would break every time CFE updates tariffs — a false failure.
//   So this suite asserts TARIFF-INDEPENDENT properties:
//     (1) battery-physics invariants (shaveKw, usableKwh) — no tariffs at all
//     (2) RECONCILIATIONS — the BESS_SIMULATION cell equals the same formula
//         recomputed from CFE_SIMULATION's own cells; if tariffs move, both
//         sides move together and the test still passes
//     (3) JS-ORACLE cross-check — calcPeakShavingImpact() is run with the
//         SAME tariffs the sheet actually used (read live), so sheet and JS
//         must agree regardless of what those tariffs are
//     (4) structural — selection-aware behaviour, no error cells, waterfall
//         adds up
//   This catches a broken formula while never false-failing on a price change.
//
// SAFETY
//   The suite OVERWRITES INPUT_CFE / INPUT_BESS / INPUT_PROJECT with the
//   fixture. It snapshots those sheets first and restores them in a `finally`
//   block, so the user's real project data is always put back — even if an
//   assertion throws.
//
// Entry point: addPhase4Tests(t, ss) — wired into runTests() as Tier 10.
// Fixture: TESTPROJ_PEAK_001 (98a_TestDat_SYNTH001) — frozen, shared w/ Phase 3.
// =============================================================================

function addPhase4Tests(t, ss) {
  t.suite('Phase4: BESS_SIMULATION sheet formulas');

  if (!ss) {
    t.info('Phase4 skipped', 'no spreadsheet context');
    return;
  }
  var required = ['INPUT_CFE', 'INPUT_BESS', 'INPUT_PROJECT', 'INPUT_DESIGN',
                  'CFE_SIMULATION', 'BESS_SIMULATION'];
  for (var i = 0; i < required.length; i++) {
    if (!ss.getSheetByName(required[i])) {
      t.fail('Phase4: required sheet missing — ' + required[i]);
      return;
    }
  }

  var snap = null;
  try {
    snap = _p4_snapshotInputs(ss);
    _p4_writeFixture(ss);
    SpreadsheetApp.flush();                 // force CFE_SIM + BESS_SIM recalc

    _p4_testNoErrorCells(t, ss);
    _p4_testBatteryInvariants(t, ss);
    _p4_testReconciliations(t, ss);
    _p4_testWaterfallAddsUp(t, ss);
    _p4_testSelectionAware(t, ss);
    _p4_testJsOracleCrossCheck(t, ss);

  } catch (e) {
    t.error('Phase4 aborted', e);
  } finally {
    if (snap) {
      try {
        _p4_restoreInputs(ss, snap);
        SpreadsheetApp.flush();
        t.info('Phase4 cleanup', 'input sheets restored to pre-test state');
      } catch (e2) {
        t.fail('Phase4 CLEANUP FAILED — restore your inputs manually: ' + e2.message);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// SNAPSHOT / RESTORE — protect the user's real project data.
// We snapshot the full used range of each input sheet (values + formulas).
// ---------------------------------------------------------------------------
function _p4_snapshotInputs(ss) {
  var names = ['INPUT_CFE', 'INPUT_BESS', 'INPUT_PROJECT', 'INPUT_DESIGN'];
  var snap = {};
  for (var i = 0; i < names.length; i++) {
    var sh = ss.getSheetByName(names[i]);
    var r = Math.max(sh.getLastRow(), 1);
    var c = Math.max(sh.getLastColumn(), 1);
    snap[names[i]] = {
      rows: r, cols: c,
      formulas: sh.getRange(1, 1, r, c).getFormulas(),
      values:   sh.getRange(1, 1, r, c).getValues(),
    };
  }
  return snap;
}

function _p4_restoreInputs(ss, snap) {
  var names = ['INPUT_CFE', 'INPUT_BESS', 'INPUT_PROJECT', 'INPUT_DESIGN'];
  for (var i = 0; i < names.length; i++) {
    var sh = ss.getSheetByName(names[i]);
    var s = snap[names[i]];
    var rng = sh.getRange(1, 1, s.rows, s.cols);
    // Restore formulas where present, else values (mirrors writeTestInputs
    // discipline — a formula cell must get its formula back, not its value).
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

// ---------------------------------------------------------------------------
// WRITE FIXTURE — put TESTPROJ_PEAK_001 into the real input sheets.
//   INPUT_CFE   : 12 months of identical demand/energy = the fixture's Jan
//   INPUT_BESS  : battery specs + PEAK_SHAVING strategy + section-4 fields
//   INPUT_PROJECT: battery toggle D64 = YES
// The fixture is the SAME TESTPROJ_PEAK_001 used by Phase 3, so the two
// suites are checking the identical scenario from two angles (JS / sheet).
// ---------------------------------------------------------------------------
function _p4_writeFixture(ss) {
  var fx  = TESTPROJ_PEAK_001;
  var jan = fx.janInput;
  var b   = fx.bess;

  // ---- INPUT_PROJECT: battery ON ----
  ss.getSheetByName('INPUT_PROJECT').getRange('D64').setValue('YES');

  // ---- INPUT_CFE: 12 identical months in C..N ----
  // Rows (per the live sheet): 10 kWh base, 11 kWh inter, 12 kWh punta,
  // 13 kW base, 14 kW inter, 15 kW punta, 17 kVArh.
  var cfe = ss.getSheetByName('INPUT_CFE');
  var rowMap = [
    { row: 10, val: jan.kWhBase },
    { row: 11, val: jan.kWhIntermedia },
    { row: 12, val: jan.kWhPunta },
    { row: 13, val: jan.kWBase },
    { row: 14, val: jan.kWIntermedia },
    { row: 15, val: jan.kWPunta },
    { row: 17, val: jan.kVArh },
  ];
  for (var i = 0; i < rowMap.length; i++) {
    var twelve = [];
    for (var m = 0; m < 12; m++) twelve.push(rowMap[i].val);
    cfe.getRange(rowMap[i].row, 3, 1, 12).setValues([twelve]);
  }

  // ---- INPUT_BESS: battery specs + PEAK_SHAVING ----
  var ib = ss.getSheetByName('INPUT_BESS');
  ib.getRange('C6').setValue('CUSTOM_MANUAL');   // manual battery
  ib.getRange('C7').setValue('PEAK_SHAVING');    // strategy
  ib.getRange('C10').setValue(b.capacityKwh);    // capacidad nominal kWh
  ib.getRange('C11').setValue(b.powerKw);        // potencia kW
  ib.getRange('C12').setValue(b.minSocPct);      // min SoC
  ib.getRange('C13').setValue(b.maxSocPct);      // max SoC
  ib.getRange('C14').setValue(b.rtePct);         // RTE
  ib.getRange('C15').setValue(b.cyclesPerDay);   // ciclos/dia
  ib.getRange('C16').setValue(b.degradationPct); // degradacion
  // Section 4 (v2.3.0): F.C. + punta hours.
  ib.getRange('C23').setValue(b.loadFactorFC);   // F.C.
  ib.getRange('C24').setValue(2);                // horas punta verano
  ib.getRange('C25').setValue(b.puntaWindowHours); // horas punta invierno

  // ---- INPUT_DESIGN: fixed solar profile, all 12 months ----
  // CFE_SIMULATION subtracts Helioscope solar (INPUT_DESIGN col G, the
  // "GRID kWh" column, rows 34-45) before computing kWMaxAnoMovil (C18).
  // Real Helioscope data varies by month -> C18 varies -> the test would
  // run against uncontrolled input and the JS-oracle cross-check could not
  // be apples-to-apples (this was the v2.3.2-v2.3.4 Phase 4 failure).
  //
  // Fix: write a FIXED solar value for all 12 months -> C18 depends only on
  // days-in-month + the constant load factor = fully deterministic.
  //
  // The value 120000 is deliberate, NOT zero: zero solar pushes C18 so high
  // that 0.7*C18 (the ratchet floor) exceeds the punta demand, so shaving
  // produces 0 Capacidad saving every month — a degenerate test that passes
  // while verifying nothing. 120000 kWh/month keeps C18 ~230, so the ratchet
  // floor sits below the punta and peak-shaving produces a real, non-zero
  // saving the test actually exercises.
  //
  // snapshot/restore covers INPUT_DESIGN, so the user's real Helioscope data
  // is put back afterward.
  var ds = ss.getSheetByName('INPUT_DESIGN');
  var solarFixed = [];
  for (var z = 0; z < 12; z++) solarFixed.push([120000]); // rows 34-45, col G
  ds.getRange(34, 7, 12, 1).setValues(solarFixed);        // col G = "GRID kWh"
}

// ---------------------------------------------------------------------------
// TEST 1 — no error cells. After recalc, BESS_SIMULATION must contain no
// #DIV/0! / #REF! / #VALUE! / #ERROR! / #N/A in the data region.
// ---------------------------------------------------------------------------
function _p4_testNoErrorCells(t, ss) {
  var sh = ss.getSheetByName('BESS_SIMULATION');
  var data = sh.getRange(5, 2, 40, 14).getValues();   // rows 5-44, cols B-O
  var errs = ['#DIV/0!', '#REF!', '#VALUE!', '#ERROR!', '#N/A', '#NAME?', '#NUM!'];
  var found = [];
  for (var r = 0; r < data.length; r++) {
    for (var c = 0; c < data[r].length; c++) {
      var v = data[r][c];
      if (typeof v === 'string' && errs.indexOf(v) >= 0) {
        found.push('row ' + (r + 5) + ' col ' + (c + 2) + ' = ' + v);
      }
    }
  }
  t.assertTrue('BESS_SIMULATION has no error cells' +
               (found.length ? ' — FOUND: ' + found.join('; ') : ''),
               found.length === 0);
}

// ---------------------------------------------------------------------------
// TEST 2 — battery-physics invariants. These involve NO tariffs, so they
// are locked to exact fixture values. If these drift, the battery math in
// the sheet formulas (rows 26-27, 36-38) is wrong.
// ---------------------------------------------------------------------------
function _p4_testBatteryInvariants(t, ss) {
  var fx = TESTPROJ_PEAK_001, exp = fx.expected;
  var sh = ss.getSheetByName('BESS_SIMULATION');

  // Calc-detail row 36 — usable kWh.
  var usable = _p4_num(sh.getRange(36, 4).getValue());
  t.assert('Sheet usableKwh (row 36) = fixture lock',
           exp.usableKwh, _p4_round(usable, 3), 0.02);

  // Month row 26 — shave kW. Fixture is winter (puntaWindowHours = 4); the
  // sheet's Jan column (C) is a winter month -> uses C25.
  var shaveJan = _p4_num(sh.getRange(26, 3).getValue());
  t.assert('Sheet shaveKw (C26, winter) = fixture lock',
           exp.shaveKw, _p4_round(shaveJan, 2), 0.05);

  // Month row 27 — Dmax punta con BESS.
  var postJan = _p4_num(sh.getRange(27, 3).getValue());
  t.assert('Sheet postBessPuntaKw (C27) = fixture lock',
           exp.postBessPuntaKw, _p4_round(postJan, 2), 0.05);
}

// ---------------------------------------------------------------------------
// TEST 3 — RECONCILIATIONS. The BESS_SIMULATION saving cell must equal the
// same formula recomputed from CFE_SIMULATION's OWN cells. Tariff-independent:
// if a tariff changes, CFE_SIMULATION changes and both sides move together.
// This catches a wrong formula, not a price change.
// ---------------------------------------------------------------------------
function _p4_testReconciliations(t, ss) {
  var bs = ss.getSheetByName('BESS_SIMULATION');
  var cf = ss.getSheetByName('CFE_SIMULATION');

  // ---- Capacidad reconciliation, January (col C) ----
  // expected = MAX(0, (CFE!C21 - MAX(C27, 0.7*CFE!C18)) * (CFE!C23/CFE!C18))
  var cf_C21 = _p4_num(cf.getRange('C21').getValue());  // Demanda Facturable
  var cf_C18 = _p4_num(cf.getRange('C18').getValue());  // kWMaxAnoMovil
  var cf_C23 = _p4_num(cf.getRange('C23').getValue());  // Capacidad charge
  var bs_C27 = _p4_num(bs.getRange('C27').getValue());  // post-BESS punta
  var capRate = cf_C18 !== 0 ? cf_C23 / cf_C18 : 0;
  var dfAfter = Math.max(bs_C27, 0.7 * cf_C18);
  var expCap  = Math.max(0, (cf_C21 - dfAfter) * capRate);
  var sheetCap = _p4_num(bs.getRange('C30').getValue());
  t.assert('Capacidad C30 reconciles with CFE_SIMULATION cells',
           _p4_round(expCap, 2), _p4_round(sheetCap, 2), 0.5);

  // ---- Distribución reconciliation, January ----
  var cf_C15 = _p4_num(cf.getRange('C15').getValue());
  var cf_C16 = _p4_num(cf.getRange('C16').getValue());
  var cf_C17 = _p4_num(cf.getRange('C17').getValue());
  var cf_C24 = _p4_num(cf.getRange('C24').getValue());
  var maxBefore = Math.max(cf_C15, cf_C16, cf_C17);
  var maxAfter  = Math.max(cf_C15, cf_C16, bs_C27);
  var distDenom = Math.min(maxBefore, cf_C18);
  var distRate  = distDenom !== 0 ? cf_C24 / distDenom : 0;
  var expDist = Math.max(0,
    (Math.min(maxBefore, cf_C18) - Math.min(maxAfter, cf_C18)) * distRate);
  var sheetDist = _p4_num(bs.getRange('C31').getValue());
  t.assert('Distribución C31 reconciles with CFE_SIMULATION cells',
           _p4_round(expDist, 2), _p4_round(sheetDist, 2), 0.5);

  // ---- annual totals (column O) reconcile with the 12 month cells ----
  var capMonths = bs.getRange(30, 3, 1, 12).getValues()[0];
  var capSum = 0;
  for (var i = 0; i < 12; i++) capSum += _p4_num(capMonths[i]);
  var capAnnual = _p4_num(bs.getRange(30, 15).getValue());   // O30
  t.assert('Capacidad annual O30 = sum of 12 months',
           _p4_round(capSum, 2), _p4_round(capAnnual, 2), 0.5);
}

// ---------------------------------------------------------------------------
// TEST 4 — the waterfall arithmetic. D18 (final) must equal D14+D15+D16+D17.
// Pure arithmetic, no tariffs.
// ---------------------------------------------------------------------------
function _p4_testWaterfallAddsUp(t, ss) {
  var bs = ss.getSheetByName('BESS_SIMULATION');
  var d14 = _p4_num(bs.getRange('D14').getValue());
  var d15 = _p4_num(bs.getRange('D15').getValue());
  var d16 = _p4_num(bs.getRange('D16').getValue());
  var d17 = _p4_num(bs.getRange('D17').getValue());
  var d18 = _p4_num(bs.getRange('D18').getValue());
  t.assert('Waterfall final D18 = D14+D15+D16+D17',
           _p4_round(d14 + d15 + d16 + d17, 2), _p4_round(d18, 2), 0.5);

  // Base (D12) must be the largest bar; final (D18) must not exceed base.
  var d12 = _p4_num(bs.getRange('D12').getValue());
  t.assertTrue('Waterfall: final bill D18 <= base bill D12', d18 <= d12 + 0.5);
}

// ---------------------------------------------------------------------------
// TEST 5 — selection-aware behaviour. Toggle NO -> BESS rows 0. Toggle YES
// -> BESS rows non-zero. Restores toggle to YES at the end (fixture state).
// ---------------------------------------------------------------------------
function _p4_testSelectionAware(t, ss) {
  var ip = ss.getSheetByName('INPUT_PROJECT');
  var bs = ss.getSheetByName('BESS_SIMULATION');

  // toggle OFF
  ip.getRange('D64').setValue('NO');
  SpreadsheetApp.flush();
  var capOff = _p4_num(bs.getRange('D15').getValue());
  var modeOff = String(bs.getRange('D6').getValue());
  t.assert('Toggle NO -> BESS Capacidad step D15 = 0', 0, _p4_round(capOff, 2), 0.01);
  t.assertTrue('Toggle NO -> mode banner says Solo PV',
               modeOff.indexOf('Solo PV') >= 0);

  // toggle ON
  ip.getRange('D64').setValue('YES');
  SpreadsheetApp.flush();
  var capOn = _p4_num(bs.getRange('D15').getValue());
  t.assertTrue('Toggle YES -> BESS Capacidad step D15 non-zero', Math.abs(capOn) > 0);
}

// ---------------------------------------------------------------------------
// TEST 6 — JS-ORACLE cross-check (corrected, v2.3.3).
//
// CFE_SIMULATION recomputes kWMaxAñoMovil (C18) by formula from the 12 months
// of energy — it is NOT the fixture's fixed kWMaxAnoMovil. So the JS oracle
// must be fed the SHEET'S recomputed C18 (and the sheet's effective kW punta),
// not the raw fixture value, or the two answer different questions.
//
// This version also DUMPS the real CFE_SIMULATION / BESS_SIMULATION cells as
// INFO rows, so every run shows the actual numbers — making any future
// discrepancy diagnosable from the results sheet alone.
// ---------------------------------------------------------------------------
function _p4_testJsOracleCrossCheck(t, ss) {
  var fx = TESTPROJ_PEAK_001;
  var bs = ss.getSheetByName('BESS_SIMULATION');
  var cf = ss.getSheetByName('CFE_SIMULATION');

  // ---- DIAGNOSTIC DUMP — ALL 12 MONTHS of the cells the Capacidad math
  // depends on. One INFO row per month: the CFE_SIMULATION inputs and the
  // BESS_SIMULATION outputs side by side, so any month's discrepancy is
  // fully visible in the results sheet without reverse-engineering.
  var monthLbl = ['Ene','Feb','Mar','Abr','May','Jun',
                  'Jul','Ago','Sep','Oct','Nov','Dic'];
  for (var dm = 0; dm < 12; dm++) {
    var dc = String.fromCharCode(67 + dm);          // C..N
    var line =
      monthLbl[dm] + ' (' + dc + '): ' +
      'C17punta=' + cf.getRange(dc + '17').getValue() + ' ' +
      'C18kWMax=' + cf.getRange(dc + '18').getValue() + ' ' +
      'C20dias=' + cf.getRange(dc + '20').getValue() + ' ' +
      'C21DemF=' + cf.getRange(dc + '21').getValue() + ' ' +
      'C23Cap=' + cf.getRange(dc + '23').getValue() + ' | ' +
      'C26shave=' + bs.getRange(dc + '26').getValue() + ' ' +
      'C27post=' + bs.getRange(dc + '27').getValue() + ' ' +
      'C30capSav=' + bs.getRange(dc + '30').getValue();
    t.info('Phase4 dump 12mo', line);
  }
  t.info('Phase4 dump 12mo', 'BESS O30 capAnnual = ' + bs.getRange(30, 15).getValue());

  // ---- Cross-check: run the JS oracle per month on the SHEET'S OWN values.
  // For each month, read CFE_SIMULATION's recomputed kWMaxAñoMovil and kW
  // punta, build the JS input from those, and assert the sheet's Capacidad
  // saving for that month equals the JS oracle's. Same kWMaxAñoMovil on both
  // sides -> a true apples-to-apples check.
  var jsCapAnnual = 0, sheetCapAnnual = 0, mismatch = [];
  for (var m = 0; m < 12; m++) {
    var col = String.fromCharCode(67 + m);                 // C..N

    var sheetC17 = _p4_num(cf.getRange(col + '17').getValue());  // kW punta
    var sheetC18 = _p4_num(cf.getRange(col + '18').getValue());  // kWMaxAñoMovil
    var sheetC23 = _p4_num(cf.getRange(col + '23').getValue());  // Capacidad chg
    var capRate  = sheetC18 !== 0 ? sheetC23 / sheetC18 : 0;

    // JS input = fixture, but kWMaxAnoMovil and kWPunta from the SHEET.
    var jin = {};
    for (var k in fx.janInput) jin[k] = fx.janInput[k];
    jin.kWMaxAnoMovil = sheetC18;
    jin.kWPunta       = sheetC17;
    var tar = {};
    for (var k2 in fx.frozenTariffs) tar[k2] = fx.frozenTariffs[k2];
    tar.capacidad = capRate;                               // sheet's eff. rate

    // The BESS_SIMULATION row-26 formula picks the punta window per month:
    // winter (INPUT_BESS C25) for cols C,D,M,N (COLUMN()<=4 or >=13),
    // summer (INPUT_BESS C24) for the rest. The JS oracle must use the SAME
    // window for that month or it computes a different shave (this was the
    // v2.3.2-v2.3.4 summer mismatch). Mirror the sheet rule exactly.
    var colNum = 3 + m;                                    // C=3 .. N=14
    var isWinterCol = (colNum <= 4 || colNum >= 13);
    var bess = {};
    for (var k3 in fx.bess) bess[k3] = fx.bess[k3];
    bess.puntaWindowHours = isWinterCol ? 4 : 2;            // C25 / C24

    var r = calcPeakShavingImpact(jin, tar, bess);
    var jsCap    = r.capacidadSavingYear1;
    var sheetCap = _p4_num(bs.getRange(30, 3 + m).getValue());

    jsCapAnnual    += jsCap;
    sheetCapAnnual += sheetCap;

    // per-month tolerance: 1 peso or 2%, whichever larger
    var tolM = Math.max(1, Math.abs(jsCap) * 0.02);
    if (Math.abs(jsCap - sheetCap) > tolM) {
      mismatch.push(col + ': JS=' + jsCap.toFixed(2) +
                    ' sheet=' + sheetCap.toFixed(2));
    }
  }

  t.info('Phase4 cross-check',
         'JS annual=' + jsCapAnnual.toFixed(2) +
         '  sheet annual=' + sheetCapAnnual.toFixed(2));

  // Per-month agreement is the real assertion — it localises any drift.
  t.assertTrue('JS oracle vs sheet: every month Capacidad agrees' +
               (mismatch.length ? ' — MISMATCH: ' + mismatch.join(' | ') : ''),
               mismatch.length === 0);

  // Annual agreement (redundant but gives a clean headline number).
  var tolA = Math.max(1, Math.abs(jsCapAnnual) * 0.02);
  t.assert('JS oracle vs sheet: annual Capacidad agrees',
           _p4_round(jsCapAnnual, 0), _p4_round(sheetCapAnnual, 0), tolA);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function _p4_num(v) {
  if (typeof v === 'number') return v;
  if (v === '' || v == null) return 0;
  var n = parseFloat(String(v).replace(/[$,]/g, ''));
  return isNaN(n) ? 0 : n;
}
function _p4_round(n, d) {
  var f = Math.pow(10, d || 0);
  return Math.round(n * f) / f;
}