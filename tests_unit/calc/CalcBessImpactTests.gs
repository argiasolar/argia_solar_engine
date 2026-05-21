// =============================================================================
// ARGIA TESTS -- tests_unit/calc/CalcBessImpactTests.gs
// -----------------------------------------------------------------------------
// PASS 9 MIGRATION: calcBessImpact (Strategy B = SELF_CONSUMPTION_MAX) engine.
//
// SOURCE: Originally addPhase2Tests in 99_TestRunner.gs (lines ~2356-2519).
//         Migrated 2026-05-21 as part of Pass 9.
//
// COVERAGE
//   Four sub-suites split into four registered tests for failure isolation:
//     UNIT_CALC_BESS_IMPACT_AVAILABILITY  -- function + constant existence
//     UNIT_CALC_BESS_IMPACT_STRATEGY_B    -- math vs Python locks, 3 modes
//     UNIT_CALC_BESS_IMPACT_DISABLED      -- null bess + zero capacity paths
//     UNIT_CALC_BESS_IMPACT_VALIDATION    -- bad inputs throw
//
// CLASSIFICATION
//   group=unit. All sub-suites are pure-function calls. No sheet I/O.
//
// DEPENDENCIES
//   - calcBessImpact, calcBessImpactAnnual, BESS_STRATEGY (04a_CalcCFEBill.gs)
//   - TESTPROJ_SYNTH_001 fixture, including .bessScenarios block
//     (5 scenarios: BESS_FN_70, BESS_SE, BESS_NM, BESS_NULL, BESS_ZERO_CAPACITY)
//
// CO-EXISTENCE
//   Legacy addPhase2Tests in 99_TestRunner.gs is unchanged. After Pass 9
//   the 27 asserts run twice: once via legacy runTests, once via runUnitTests.
//   Deleted in the deletion pass alongside the rest of 99_TestRunner.gs.
//
// BEHAVIOR PRESERVATION NOTE
//   Manual try/catch + threw-flag idiom from legacy converted to
//   t.assertThrows(). Semantics identical.
// =============================================================================


// ---------------------------------------------------------------------------
// SHARED HELPER (file-scope, mirrors the _p2_ helper from legacy)
// Defined once at module load. Same shape as the _p1_/_p12_/_p14_ helpers
// in CalcCfeBillTests.gs (they all build the same shape from the same
// fixture); kept separate here for module cohesion so a future engine
// change to the input shape needed only by BESS impact tests can be made
// independently of the CFE bill tests.
// ---------------------------------------------------------------------------

function _bessImpactTests_buildJanInput() {
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


// ===========================================================================
// SUITE 1: AVAILABILITY (4 asserts)
// ===========================================================================

registerTest({
  id      : 'UNIT_CALC_BESS_IMPACT_AVAILABILITY',
  group   : 'unit',
  module  : 'calc/bess_impact',
  scenarios: [],
  tags    : ['calc', 'bess', 'impact', 'availability'],
  source  : 'tests_unit/calc/CalcBessImpactTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/bess_impact: API availability');

    t.assert('calcBessImpact function defined',
             'function', typeof calcBessImpact);
    t.assert('calcBessImpactAnnual function defined',
             'function', typeof calcBessImpactAnnual);
    t.assert('BESS_STRATEGY constants defined',
             'object', typeof BESS_STRATEGY);
    t.assert('BESS_STRATEGY.SELF_CONSUMPTION_MAX value',
             'SELF_CONSUMPTION_MAX', BESS_STRATEGY.SELF_CONSUMPTION_MAX);
  }
});


// ===========================================================================
// SUITE 2: STRATEGY B MATH (18 asserts across 3 interconnection modes
//                            + annual aggregation)
// ===========================================================================

registerTest({
  id      : 'UNIT_CALC_BESS_IMPACT_STRATEGY_B',
  group   : 'unit',
  module  : 'calc/bess_impact',
  scenarios: [],
  tags    : ['calc', 'bess', 'impact', 'strategy-b', 'self-consumption'],
  source  : 'tests_unit/calc/CalcBessImpactTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/bess_impact: Strategy B math vs Python locks');

    var snap = TESTPROJ_SYNTH_001.expected.snapshot;
    var inp  = _bessImpactTests_buildJanInput();
    var bs   = TESTPROJ_SYNTH_001.bessScenarios;
    var TOL  = 0.10;

    // -- FN-mode scenario ------------------------------------------------
    var fnExp = bs.BESS_FN_70.expected;
    var fnRes = calcBessImpact(inp, snap.frozenTariffs,
                                bs.BESS_FN_70.pv, bs.BESS_FN_70.bess);
    t.assert('FN: bessUsableCapacityKwh',
             fnExp.bessUsableCapacityKwh, fnRes.bessUsableCapacityKwh, 0.01);
    t.assert('FN: bessMonthlyThroughputKwh',
             fnExp.bessMonthlyThroughputKwh, fnRes.bessMonthlyThroughputKwh, 0.01);
    t.assert('FN: pvExportedKwh',
             fnExp.pvExportedKwh, fnRes.pvExportedKwh, 0.01);
    t.assert('FN: pvCapturedByBessKwh',
             fnExp.pvCapturedByBessKwh, fnRes.pvCapturedByBessKwh, 0.01);
    t.assert('FN: blendedAvoidedTariff',
             fnExp.blendedAvoidedTariffMxnPerKwh,
             fnRes.blendedAvoidedTariffMxnPerKwh, 0.0001);
    t.assert('FN: pvCaptureValueMxn',
             fnExp.pvCaptureValueMxn, fnRes.pvCaptureValueMxn, TOL);
    t.assert('FN: billAfterPv',
             fnExp.billAfterPv, fnRes.billAfterPv, TOL);
    t.assert('FN: billAfterPvAndBess',
             fnExp.billAfterPvAndBess, fnRes.billAfterPvAndBess, TOL);
    t.assert('FN: strategyUsed',
             'SELF_CONSUMPTION_MAX', fnRes.strategyUsed);
    t.assert('FN: bessEnabled true',
             true, fnRes.bessEnabled);

    // -- SE-mode scenario ------------------------------------------------
    var seExp = bs.BESS_SE.expected;
    var seRes = calcBessImpact(inp, snap.frozenTariffs,
                                bs.BESS_SE.pv, bs.BESS_SE.bess);
    t.assert('SE: pvCapturedByBessKwh',
             seExp.pvCapturedByBessKwh, seRes.pvCapturedByBessKwh, 0.01);
    t.assert('SE: pvCaptureValueMxn',
             seExp.pvCaptureValueMxn, seRes.pvCaptureValueMxn, TOL);
    t.assert('SE: billAfterPvAndBess',
             seExp.billAfterPvAndBess, seRes.billAfterPvAndBess, TOL);
    t.assertTrue('SE savings > FN savings (no export credit subtracted)',
                 seRes.pvCaptureValueMxn > fnRes.pvCaptureValueMxn);

    // -- NM-mode scenario (no exported energy) ---------------------------
    var nmExp = bs.BESS_NM.expected;
    var nmRes = calcBessImpact(inp, snap.frozenTariffs,
                                bs.BESS_NM.pv, bs.BESS_NM.bess);
    t.assert('NM: pvExportedKwh = 0',
             nmExp.pvExportedKwh, nmRes.pvExportedKwh, 0.01);
    t.assert('NM: pvCapturedByBessKwh = 0',
             nmExp.pvCapturedByBessKwh, nmRes.pvCapturedByBessKwh, 0.01);
    t.assert('NM: pvCaptureValueMxn = 0',
             nmExp.pvCaptureValueMxn, nmRes.pvCaptureValueMxn, 0.01);
    t.assert('NM: billAfterPvAndBess = billAfterPv (no BESS effect)',
             nmExp.billAfterPvAndBess, nmRes.billAfterPvAndBess, TOL);

    // -- Annual aggregation (varying days per month) ---------------------
    var monthlyInputs = [];
    var DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for (var i = 0; i < 12; i++) {
      monthlyInputs.push(Object.assign({}, inp, { daysInMonth: DAYS[i] }));
    }
    var annual = calcBessImpactAnnual(monthlyInputs, snap.frozenTariffs,
                                       bs.BESS_FN_70.pv, bs.BESS_FN_70.bess);
    t.assert('FN: annualBillAfterPvAndBess (varying days)',
             fnExp.annualBillAfterPvAndBess, annual, TOL * 12);
  }
});


// ===========================================================================
// SUITE 3: DISABLED PATHS (5 asserts)
// ===========================================================================

registerTest({
  id      : 'UNIT_CALC_BESS_IMPACT_DISABLED',
  group   : 'unit',
  module  : 'calc/bess_impact',
  scenarios: [],
  tags    : ['calc', 'bess', 'impact', 'disabled'],
  source  : 'tests_unit/calc/CalcBessImpactTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/bess_impact: disabled paths');

    var snap = TESTPROJ_SYNTH_001.expected.snapshot;
    var inp  = _bessImpactTests_buildJanInput();
    var bs   = TESTPROJ_SYNTH_001.bessScenarios;
    var TOL  = 0.10;

    // -- Null bess -------------------------------------------------------
    var nullRes = calcBessImpact(inp, snap.frozenTariffs,
                                  bs.BESS_NULL.pv, bs.BESS_NULL.bess);
    t.assert('Null bess: bessEnabled false',
             false, nullRes.bessEnabled);
    t.assert('Null bess: billAfterPvAndBess = billAfterPv',
             bs.BESS_NULL.expected.billAfterPv, nullRes.billAfterPvAndBess, TOL);
    t.assert('Null bess: pvCaptureValueMxn = 0',
             0, nullRes.pvCaptureValueMxn, 0.01);

    // -- Zero capacity ---------------------------------------------------
    var zeroRes = calcBessImpact(inp, snap.frozenTariffs,
                                  bs.BESS_ZERO_CAPACITY.pv,
                                  bs.BESS_ZERO_CAPACITY.bess);
    t.assert('Zero cap: bessEnabled false',
             false, zeroRes.bessEnabled);
    t.assert('Zero cap: billAfterPvAndBess = billAfterPv',
             bs.BESS_ZERO_CAPACITY.expected.billAfterPvAndBess,
             zeroRes.billAfterPvAndBess, TOL);
  }
});


// ===========================================================================
// SUITE 4: VALIDATION (3 asserts)
// ===========================================================================

registerTest({
  id      : 'UNIT_CALC_BESS_IMPACT_VALIDATION',
  group   : 'unit',
  module  : 'calc/bess_impact',
  scenarios: [],
  tags    : ['calc', 'bess', 'impact', 'validation'],
  source  : 'tests_unit/calc/CalcBessImpactTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/bess_impact: input validation');

    var snap   = TESTPROJ_SYNTH_001.expected.snapshot;
    var inp    = _bessImpactTests_buildJanInput();
    var pvFn   = TESTPROJ_SYNTH_001.bessScenarios.BESS_FN_70.pv;
    var bessOk = TESTPROJ_SYNTH_001.bessScenarios.BESS_FN_70.bess;

    // Unsupported strategy throws
    t.assertThrows('Unsupported strategy (PEAK_SHAVING) throws', function () {
      calcBessImpact(inp, snap.frozenTariffs, pvFn,
                     Object.assign({}, bessOk, { strategy: 'PEAK_SHAVING' }));
    });

    // Out-of-range minSocPct throws
    t.assertThrows('minSocPct > 1 throws', function () {
      calcBessImpact(inp, snap.frozenTariffs, pvFn,
                     Object.assign({}, bessOk, { minSocPct: 1.5 }));
    });

    // maxSoc <= minSoc throws
    t.assertThrows('maxSocPct <= minSocPct throws', function () {
      calcBessImpact(inp, snap.frozenTariffs, pvFn,
                     Object.assign({}, bessOk,
                                       { minSocPct: 0.9, maxSocPct: 0.1 }));
    });
  }
});
