// =============================================================================
// ARGIA TESTS -- tests_unit/calc/CalcCfeBillTests.gs
// -----------------------------------------------------------------------------
// PASS 4 MIGRATION: CFE bill simulation suite.
//
// SOURCE: Originally lived as nine functions in 99_TestRunner.gs:
//   Phase 1   (interconnection modes -- v2.1.0):
//     testCalcCfeBillWithPvAvailable    (lines 1842-1856)
//     testCalcCfeBillBaselineUnchanged  (lines 1863-1885)
//     testCalcCfeBillScenarios          (lines 1889-1981)
//   Phase 1.2 (FP threshold -- v2.1.2):    [RESURRECTED -- see note below]
//     testFpThresholdBackwardCompat     (lines 2033-2057)
//     testFpThresholdSweep              (lines 2066-2125)
//     testFpThresholdPvIntegration      (lines 2127-2199)
//   Phase 1.4 (mode-aware defaults -- v2.1.4):
//     testPhase14ModeDefaults           (lines 2211-2261)
//     testPhase14IntermediaOnly         (lines 2266-2310)
//     testPhase14FpThresholdInPvPath    (lines 2315-2330)
//
// === RESURRECTION NOTE: Phase 1.2 FP THRESHOLD SUITE ===
// In the legacy 99_TestRunner.gs, `addPhase12Tests` is defined twice:
//   - 99_TestRunner.gs line 2023  (this Phase 1.2 FP threshold suite)
//   - 99p_Phase12_MCDBessWriter.gs line 22  (the MDC §7 BESS suite)
// Apps Script's flat global namespace + alphabetical load order means 99p_
// wins; the FP threshold suite has been SILENTLY DEAD (defined but never
// called from runTests). Migrating it here brings it back to life.
//
// If the resurrected tests FAIL, that's a real regression that existed
// undetected for an unknown period. If they pass, we have free coverage.
// Either outcome is informative.
// =============================================================================
// CLASSIFICATION
//   group=unit. All sub-suites are pure-function calls. No sheet I/O.
//
// DEPENDENCIES
//   - TESTPROJ_SYNTH_001 fixture (test/TestProjects.gs)
//   - calcCfeBill, calcCfeBillAnnual, calcCfeBillWithPv,
//     calcCfeBillWithPvAnnual (04a_CalcCFEBill.gs)
//   - CFE_MODE constants (04a_CalcCFEBill.gs)
//
// CO-EXISTENCE
//   Legacy testCalcCfeBill* and testPhase14* functions remain in
//   99_TestRunner.gs and continue to run from runTests(). The legacy
//   addPhase12Tests function remains dead (still shadowed by 99p_).
//   After Pass 4, Phase 1 and Phase 1.4 run twice per full check:
//   once via legacy runTests, once via runUnitTests. Phase 1.2 runs
//   only via runUnitTests (legacy still dead). Intentional during
//   transition; legacy gets deleted in Pass 7.
// =============================================================================


// ---------------------------------------------------------------------------
// SHARED HELPERS
//
// The legacy code carried _p1_, _p12_, _p14_ helpers as three identical
// copies, defensively prefixed because Apps Script files share a global
// namespace. In the new framework everything is in one file so we get one
// canonical helper. Prefixed _cfeBillTests_ to keep it out of the way of
// any other future tests that might want their own.
// ---------------------------------------------------------------------------

function _cfeBillTests_buildJanInput() {
  var m = TESTPROJ_SYNTH_001.inputs.cfe.monthly;
  return {
    kWhBase:        m.kWhBase[0],
    kWhIntermedia:  m.kWhIntermedia[0],
    kWhPunta:       m.kWhPunta[0],
    kWBase:         m.kWBase[0],
    kWIntermedia:   m.kWIntermedia[0],
    kWPunta:        m.kWPunta[0],
    kWMaxAnoMovil:  m.kWMaxAnoMovil[0],
    kVArh:          m.kVArh[0],
    tarifa:         'GDMTH',
    dap:            0,
    bajaTension2pct: false
  };
}

function _cfeBillTests_buildAllMonthsInput() {
  var m = TESTPROJ_SYNTH_001.inputs.cfe.monthly;
  var arr = [];
  for (var i = 0; i < 12; i++) {
    arr.push({
      kWhBase:        m.kWhBase[i],
      kWhIntermedia:  m.kWhIntermedia[i],
      kWhPunta:       m.kWhPunta[i],
      kWBase:         m.kWBase[i],
      kWIntermedia:   m.kWIntermedia[i],
      kWPunta:        m.kWPunta[i],
      kWMaxAnoMovil:  m.kWMaxAnoMovil[i],
      kVArh:          m.kVArh[i],
      tarifa:         'GDMTH',
      dap:            0,
      bajaTension2pct: false
    });
  }
  return arr;
}


// ===========================================================================
// PHASE 1: calcCfeBillWithPv (v2.1.0 interconnection modes)
// ===========================================================================

registerTest({
  id      : 'UNIT_CALC_CFE_BILL_API_AVAILABILITY',
  group   : 'unit',
  module  : 'calc/cfe_bill',
  scenarios: [],
  tags    : ['calc', 'cfe', 'availability', 'phase1'],
  source  : 'tests_unit/calc/CalcCfeBillTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/cfe_bill: API availability');

    t.assertTrue('calcCfeBillWithPv function defined',
                 typeof calcCfeBillWithPv === 'function');
    t.assertTrue('calcCfeBillWithPvAnnual function defined',
                 typeof calcCfeBillWithPvAnnual === 'function');
    t.assertTrue('CFE_MODE constants defined',
                 typeof CFE_MODE === 'object' && CFE_MODE !== null);

    if (typeof CFE_MODE === 'object' && CFE_MODE !== null) {
      t.assert('CFE_MODE.MEDICION_NETA',    'MEDICION_NETA',    CFE_MODE.MEDICION_NETA);
      t.assert('CFE_MODE.FACTURACION_NETA', 'FACTURACION_NETA', CFE_MODE.FACTURACION_NETA);
      t.assert('CFE_MODE.SIN_EXPORTACION',  'SIN_EXPORTACION',  CFE_MODE.SIN_EXPORTACION);
    }
  }
});


registerTest({
  id      : 'UNIT_CALC_CFE_BILL_NO_PV_BASELINE',
  group   : 'unit',
  module  : 'calc/cfe_bill',
  scenarios: [],
  tags    : ['calc', 'cfe', 'baseline', 'phase1'],
  source  : 'tests_unit/calc/CalcCfeBillTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/cfe_bill: baseline unchanged from v2.0.4');

    var snap = TESTPROJ_SYNTH_001.expected.snapshot;
    var inp  = _cfeBillTests_buildJanInput();

    // Direct v2.0.4 path
    var direct = calcCfeBill(inp, snap.frozenTariffs);
    t.assert('calcCfeBill(no PV) Jan still matches v2.0.4 lock',
             snap.janBillFrozen, direct.total, snap.janBillFrozenTol);

    // Wrapper with no PV must equal direct
    var noPv = calcCfeBillWithPv(inp, snap.frozenTariffs, undefined);
    t.assert('calcCfeBillWithPv(inp, tar, undefined) == calcCfeBill(inp, tar)',
             direct.total, noPv.total, 0.0001);

    // Wrapper with monthlyKwh=0 must also equal direct
    var zeroPv = calcCfeBillWithPv(inp, snap.frozenTariffs, { monthlyKwh: 0 });
    t.assert('calcCfeBillWithPv with monthlyKwh=0 == no-PV path',
             direct.total, zeroPv.total, 0.0001);
  }
});


registerTest({
  id      : 'UNIT_CALC_CFE_BILL_INTERCONNECTION_MODES',
  group   : 'unit',
  module  : 'calc/cfe_bill',
  scenarios: [],
  tags    : ['calc', 'cfe', 'interconnection-modes', 'phase1'],
  source  : 'tests_unit/calc/CalcCfeBillTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/cfe_bill: interconnection-mode scenarios');

    var snap      = TESTPROJ_SYNTH_001.expected.snapshot;
    var scenarios = TESTPROJ_SYNTH_001.scenarios;
    var inp       = _cfeBillTests_buildJanInput();
    var tol       = snap.pvScenarioTol;

    if (!scenarios) {
      t.fail('scenarios block exists', 'TESTPROJ_SYNTH_001.scenarios is missing');
      return;
    }

    ['NM', 'FN', 'SE'].forEach(function (key) {
      var scn = scenarios[key];
      if (!scn) {
        t.fail('scenario ' + key + ' exists', 'missing from fixture');
        return;
      }

      var result;
      try {
        result = calcCfeBillWithPv(inp, snap.frozenTariffs, scn.pv);
      } catch (e) {
        t.fail('scenario ' + key + ' runs without error', String(e));
        return;
      }

      t.assert(key + ': Jan bill (' + scn.label.slice(0, 40) + ')',
               scn.expected.janBill, result.total, tol);

      if (scn.expected.janSelfKwh != null) {
        t.assert(key + ': selfConsumedKwh',
                 scn.expected.janSelfKwh, result.selfConsumedKwh, 0.01);
      }
      if (scn.expected.janExportKwh != null) {
        t.assert(key + ': exportedKwh',
                 scn.expected.janExportKwh, result.exportedKwh, 0.01);
      }
      if (scn.expected.janCredit != null) {
        t.assert(key + ': exportCredit',
                 scn.expected.janCredit, result.exportCredit, 0.01);
      }

      // Annual = 12 × Jan (synthetic identity)
      var monthlyInputs = _cfeBillTests_buildAllMonthsInput();
      var annual = calcCfeBillWithPvAnnual(monthlyInputs, snap.frozenTariffs, scn.pv);
      t.assert(key + ': annual = 12 × Jan',
               scn.expected.annualBill, annual, tol * 12);
    });

    // Algebraic sanity: FN.total + FN.credit ≈ SE.total
    try {
      var fn = calcCfeBillWithPv(inp, snap.frozenTariffs, scenarios.FN.pv);
      var se = calcCfeBillWithPv(inp, snap.frozenTariffs, scenarios.SE.pv);
      t.assert('algebraic: FN.total + FN.credit == SE.total',
               se.total, fn.total + fn.exportCredit, 0.01);
    } catch (e) {
      t.fail('algebraic sanity', String(e));
    }

    // Edge case: unknown mode must throw
    t.assertThrows('unknown mode throws', function () {
      calcCfeBillWithPv(inp, snap.frozenTariffs, {
        monthlyKwh: 25000, interconnectionMode: 'NOT_A_MODE'
      });
    });

    // Edge case: out-of-range selfConsumptionPct must throw
    t.assertThrows('out-of-range selfConsumptionPct throws', function () {
      calcCfeBillWithPv(inp, snap.frozenTariffs, {
        monthlyKwh: 25000,
        interconnectionMode: CFE_MODE.FACTURACION_NETA,
        selfConsumptionPct: 1.5
      });
    });
  }
});


// ===========================================================================
// PHASE 1.2: FP THRESHOLD (v2.1.2) -- RESURRECTED
//
// These three tests have been DEAD in the legacy runner due to the
// addPhase12Tests name collision (see header comment). This is their first
// run in some unknown amount of time. If they fail, it indicates real
// regression that went undetected. If they pass, free coverage.
// ===========================================================================

registerTest({
  id      : 'UNIT_CALC_CFE_BILL_FP_THRESHOLD_BACKWARD_COMPAT',
  group   : 'unit',
  module  : 'calc/cfe_bill',
  scenarios: [],
  tags    : ['calc', 'cfe', 'fp-threshold', 'phase1.2', 'resurrected'],
  source  : 'tests_unit/calc/CalcCfeBillTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/cfe_bill: FP threshold backward compatibility');

    var snap = TESTPROJ_SYNTH_001.expected.snapshot;
    var inp  = _cfeBillTests_buildJanInput();

    // Default behavior (no options) must match v2.0.4 lock
    var rDefault = calcCfeBill(inp, snap.frozenTariffs);
    t.assert('calcCfeBill(inp, tar) with no options matches v2.0.4 lock',
             snap.janBillFrozen, rDefault.total, snap.janBillFrozenTol);

    // Explicit fpThreshold=0.90 must equal default
    var r090 = calcCfeBill(inp, snap.frozenTariffs, { fpThreshold: 0.90 });
    t.assert('calcCfeBill(inp, tar, {fpThreshold:0.90}) equals default',
             rDefault.total, r090.total, 0.0001);

    // Empty options object must equal default
    var rEmpty = calcCfeBill(inp, snap.frozenTariffs, {});
    t.assert('calcCfeBill(inp, tar, {}) equals default',
             rDefault.total, rEmpty.total, 0.0001);

    // Annual wrapper with no options
    var monthlyInputs = _cfeBillTests_buildAllMonthsInput();
    var annualDefault = calcCfeBillAnnual(monthlyInputs, snap.frozenTariffs);
    t.assert('calcCfeBillAnnual(no options) matches v2.0.4 lock',
             snap.annualBillFrozen, annualDefault, snap.annualBillFrozenTol);
  }
});


registerTest({
  id      : 'UNIT_CALC_CFE_BILL_FP_THRESHOLD_SWEEP',
  group   : 'unit',
  module  : 'calc/cfe_bill',
  scenarios: [],
  tags    : ['calc', 'cfe', 'fp-threshold', 'phase1.2', 'resurrected'],
  source  : 'tests_unit/calc/CalcCfeBillTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/cfe_bill: FP threshold parameter sweep');

    var snap      = TESTPROJ_SYNTH_001.expected.snapshot;
    var scenarios = TESTPROJ_SYNTH_001.fpThresholdScenarios;
    var inp       = _cfeBillTests_buildJanInput();

    if (!scenarios) {
      t.fail('fpThresholdScenarios exists',
             'TESTPROJ_SYNTH_001.fpThresholdScenarios is missing');
      return;
    }

    var TOL = 0.10;
    var ANNUAL_TOL = 1.2;

    ['T_090', 'T_095', 'T_097'].forEach(function (key) {
      var scn = scenarios[key];
      if (!scn) {
        t.fail('scenario ' + key + ' exists', 'missing from fixture');
        return;
      }

      var result;
      try {
        result = calcCfeBill(inp, snap.frozenTariffs, { fpThreshold: scn.fpThreshold });
      } catch (e) {
        t.fail('scenario ' + key + ' runs without error', String(e));
        return;
      }

      var labelShort = key + ' (T=' + scn.fpThreshold + ')';
      t.assert(labelShort + ': Jan bill total',
               scn.expected.janBill, result.total, TOL);
      t.assert(labelShort + ': Cargo FP',
               scn.expected.cargoFp, result.cargoFp, TOL);

      var monthlyInputs = _cfeBillTests_buildAllMonthsInput();
      var annual = calcCfeBillAnnual(monthlyInputs, snap.frozenTariffs,
                                     { fpThreshold: scn.fpThreshold });
      t.assert(labelShort + ': annual = 12 × Jan',
               scn.expected.annual, annual, ANNUAL_TOL);
    });

    // Sanity: monotonic in threshold
    var r090 = calcCfeBill(inp, snap.frozenTariffs, { fpThreshold: 0.90 });
    var r095 = calcCfeBill(inp, snap.frozenTariffs, { fpThreshold: 0.95 });
    var r097 = calcCfeBill(inp, snap.frozenTariffs, { fpThreshold: 0.97 });
    t.assertTrue('monotonic: T=0.95 bill > T=0.90 bill',
                 r095.total > r090.total);
    t.assertTrue('monotonic: T=0.97 bill > T=0.95 bill',
                 r097.total > r095.total);
  }
});


registerTest({
  id      : 'UNIT_CALC_CFE_BILL_FP_THRESHOLD_PV_PATH',
  group   : 'unit',
  module  : 'calc/cfe_bill',
  scenarios: [],
  tags    : ['calc', 'cfe', 'fp-threshold', 'phase1.2', 'resurrected'],
  source  : 'tests_unit/calc/CalcCfeBillTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/cfe_bill: FP threshold through PV path');

    var snap = TESTPROJ_SYNTH_001.expected.snapshot;
    var scn  = TESTPROJ_SYNTH_001.scenarios && TESTPROJ_SYNTH_001.scenarios.FN;
    if (!scn) {
      t.fail('scenarios.FN exists', 'FN scenario missing from fixture');
      return;
    }

    var inp = _cfeBillTests_buildJanInput();

    // Default (no fpThreshold option) -- baseline result
    var rDefault = calcCfeBillWithPv(inp, snap.frozenTariffs, scn.pv);

    // Explicit fpThreshold=0.90 must equal default
    var r090 = calcCfeBillWithPv(inp, snap.frozenTariffs, scn.pv, { fpThreshold: 0.90 });
    t.assert('PV path: fpThreshold=0.90 equals default',
             rDefault.total, r090.total, 0.0001);

    // fpThreshold=0.95 should produce higher bill (penalty kicks in)
    var r095 = calcCfeBillWithPv(inp, snap.frozenTariffs, scn.pv, { fpThreshold: 0.95 });
    t.assertTrue('PV path: T=0.95 total > T=0.90 total (penalty applied)',
                 r095.total > r090.total);

    // Same for T=0.97
    var r097 = calcCfeBillWithPv(inp, snap.frozenTariffs, scn.pv, { fpThreshold: 0.97 });
    t.assertTrue('PV path: T=0.97 total > T=0.95 total (penalty applied)',
                 r097.total > r095.total);
  }
});


// ===========================================================================
// PHASE 1.4: mode-aware self_pct defaults + intermedia cascade (v2.1.4)
// ===========================================================================

registerTest({
  id      : 'UNIT_CALC_CFE_BILL_MODE_AWARE_DEFAULTS',
  group   : 'unit',
  module  : 'calc/cfe_bill',
  scenarios: [],
  tags    : ['calc', 'cfe', 'mode-defaults', 'phase1.4'],
  source  : 'tests_unit/calc/CalcCfeBillTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/cfe_bill: mode-aware self_pct defaults');

    var snap = TESTPROJ_SYNTH_001.expected.snapshot;
    var inp  = _cfeBillTests_buildJanInput();

    // NM with blank: forced 100%
    var nmBlank = calcCfeBillWithPv(inp, snap.frozenTariffs, {
      monthlyKwh: 25000, interconnectionMode: 'MEDICION_NETA'
    });
    t.assert('NM with blank selfPct → forced 100%',
             1.0, nmBlank.selfConsumptionPctUsed, 0.0001);

    // SE with blank: defaults 100%
    var seBlank = calcCfeBillWithPv(inp, snap.frozenTariffs, {
      monthlyKwh: 25000, interconnectionMode: 'SIN_EXPORTACION'
    });
    t.assert('SE with blank selfPct → defaults 100% (v2.1.4 NEW)',
             1.0, seBlank.selfConsumptionPctUsed, 0.0001);

    // SE with explicit 0.70
    var seExplicit = calcCfeBillWithPv(inp, snap.frozenTariffs, {
      monthlyKwh: 25000, interconnectionMode: 'SIN_EXPORTACION',
      selfConsumptionPct: 0.70
    });
    t.assert('SE with explicit selfPct=0.70 → uses 0.70',
             0.70, seExplicit.selfConsumptionPctUsed, 0.0001);

    // FN with blank: defaults 70%
    var fnBlank = calcCfeBillWithPv(inp, snap.frozenTariffs, {
      monthlyKwh: 25000, interconnectionMode: 'FACTURACION_NETA',
      exportPriceMxnPerKwh: 0.80
    });
    t.assert('FN with blank selfPct → defaults 70% (industry standard)',
             0.70, fnBlank.selfConsumptionPctUsed, 0.0001);

    // FN with explicit 0.70
    var fnExplicit = calcCfeBillWithPv(inp, snap.frozenTariffs, {
      monthlyKwh: 25000, interconnectionMode: 'FACTURACION_NETA',
      exportPriceMxnPerKwh: 0.80, selfConsumptionPct: 0.70
    });
    t.assert('FN with explicit selfPct=0.70 → uses 0.70',
             0.70, fnExplicit.selfConsumptionPctUsed, 0.0001);

    // FN blank and FN explicit(0.70) produce identical results
    t.assert('FN blank == FN explicit(0.70) total',
             fnBlank.total, fnExplicit.total, 0.01);
  }
});


registerTest({
  id      : 'UNIT_CALC_CFE_BILL_INTERMEDIA_ONLY_CASCADE',
  group   : 'unit',
  module  : 'calc/cfe_bill',
  scenarios: [],
  tags    : ['calc', 'cfe', 'intermedia-cascade', 'phase1.4'],
  source  : 'tests_unit/calc/CalcCfeBillTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/cfe_bill: intermedia-only cascade for SE/FN');

    var snap = TESTPROJ_SYNTH_001.expected.snapshot;
    var inp  = _cfeBillTests_buildJanInput();
    var TOL  = 0.10;
    var sce  = TESTPROJ_SYNTH_001.scenarios;

    // FN at explicit 0.70 → matches v2.1.4 lock
    var fnResult = calcCfeBillWithPv(inp, snap.frozenTariffs, sce.FN.pv);
    t.assert('FN explicit Jan bill matches v2.1.4 lock',
             sce.FN.expected.janBill, fnResult.total, TOL);

    // SE at explicit 0.70 → matches v2.1.4 lock
    var seResult = calcCfeBillWithPv(inp, snap.frozenTariffs, sce.SE.pv);
    t.assert('SE explicit Jan bill matches v2.1.4 lock',
             sce.SE.expected.janBill, seResult.total, TOL);

    // SE default (100%) is LOWER than SE explicit (70%) -- more displacement
    var seDefaultResult = calcCfeBillWithPv(inp, snap.frozenTariffs, sce.SE_default.pv);
    t.assert('SE_default Jan bill matches v2.1.4 lock',
             sce.SE_default.expected.janBill, seDefaultResult.total, TOL);
    t.assertTrue('SE_default < SE_explicit (more PV at 100% vs 70%)',
                 seDefaultResult.total < seResult.total);

    // FN bill (with credit) < SE bill (no credit) at same self_pct
    t.assertTrue('FN total < SE total at same self_pct (export credit)',
                 fnResult.total < seResult.total);

    // SE pre-export equals SE total (no credit applied)
    t.assert('SE billPreExport == SE total',
             seResult.billPreExport, seResult.total, 0.01);

    // FN selfConsumed = MIN(kWhIntermedia, selfPct × monthlyKwh)
    t.assert('FN selfConsumed = MIN(kWhIntermedia, selfPct × monthlyKwh)',
             Math.min(inp.kWhIntermedia, 0.70 * 25000),
             fnResult.selfConsumedKwh, 0.01);
    t.assert('FN exported = monthlyKwh - selfConsumed',
             25000 - fnResult.selfConsumedKwh,
             fnResult.exportedKwh, 0.01);
  }
});


registerTest({
  id      : 'UNIT_CALC_CFE_BILL_FP_THRESHOLD_VIA_PV_WRAPPER',
  group   : 'unit',
  module  : 'calc/cfe_bill',
  scenarios: [],
  tags    : ['calc', 'cfe', 'fp-threshold', 'phase1.4'],
  source  : 'tests_unit/calc/CalcCfeBillTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/cfe_bill: FP threshold through PV wrapper (per-mode)');

    var snap = TESTPROJ_SYNTH_001.expected.snapshot;
    var inp  = _cfeBillTests_buildJanInput();
    var sce  = TESTPROJ_SYNTH_001.scenarios;

    // For each mode, T=0.95 should produce HIGHER bill than T=0.90
    ['NM', 'FN', 'SE'].forEach(function (modeName) {
      var pv = sce[modeName].pv;
      var t090 = calcCfeBillWithPv(inp, snap.frozenTariffs, pv, { fpThreshold: 0.90 });
      var t095 = calcCfeBillWithPv(inp, snap.frozenTariffs, pv, { fpThreshold: 0.95 });
      t.assertTrue(modeName + ': T=0.95 total > T=0.90 total (penalty applied)',
                   t095.total > t090.total);
    });
  }
});
