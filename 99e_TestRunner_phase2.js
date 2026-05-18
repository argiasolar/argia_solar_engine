// =============================================================================
// ARGIA ENGINE v2.2.0 -- File: 99e_TestRunner_Phase2.gs
// Phase 2 regression test suites — BESS impact (Strategy B only).
//
// SUITES:
//   1. BESS function availability — exports defined, strategy constants present
//   2. Strategy B math on SYNTH-001 — exact values vs Python lock targets
//      - FN-mode scenario (with export credit)
//      - SE-mode scenario (no export credit, more PV captured)
//      - NM-mode scenario (no exported energy → 0 BESS savings)
//   3. BESS-disabled paths — toggle=NO, null bess, zero-capacity battery
//   4. Validation errors — unsupported strategy, out-of-range SOC, etc.
//
// All pure JS unit tests. No spreadsheet I/O.
//
// USAGE FROM 99_TestRunner.gs:
//   try { addPhase2Tests(t, ss); }
//   catch (e) { t.error('Phase2 aborted', e); }
// =============================================================================

function addPhase2Tests(t, ss) {
  testPhase2Availability(t);
  testPhase2StrategyB(t);
  testPhase2DisabledPaths(t);
  testPhase2Validation(t);
}

// ---------------------------------------------------------------------------
// SUITE 1: AVAILABILITY
// ---------------------------------------------------------------------------
function testPhase2Availability(t) {
  t.suite('Phase2: BESS function availability');

  t.assert('calcBessImpact function defined',
           'function', typeof calcBessImpact);
  t.assert('calcBessImpactAnnual function defined',
           'function', typeof calcBessImpactAnnual);
  t.assert('BESS_STRATEGY constants defined',
           'object', typeof BESS_STRATEGY);
  t.assert('BESS_STRATEGY.SELF_CONSUMPTION_MAX value',
           'SELF_CONSUMPTION_MAX', BESS_STRATEGY.SELF_CONSUMPTION_MAX);
}

// ---------------------------------------------------------------------------
// SUITE 2: STRATEGY B MATH — three modes × multiple assertions
// ---------------------------------------------------------------------------
function testPhase2StrategyB(t) {
  t.suite('Phase2: Strategy B math vs Python locks');

  var snap = TESTPROJ_SYNTH_001.expected.snapshot;
  var inp  = _p2_buildSynth001JanInputObject();
  var bs = TESTPROJ_SYNTH_001.bessScenarios;
  var TOL = 0.10;

  // FN-mode scenario
  var fnExp = bs.BESS_FN_70.expected;
  var fnRes = calcBessImpact(inp, snap.frozenTariffs, bs.BESS_FN_70.pv, bs.BESS_FN_70.bess);
  t.assert('FN: bessUsableCapacityKwh',     fnExp.bessUsableCapacityKwh,     fnRes.bessUsableCapacityKwh, 0.01);
  t.assert('FN: bessMonthlyThroughputKwh',  fnExp.bessMonthlyThroughputKwh,  fnRes.bessMonthlyThroughputKwh, 0.01);
  t.assert('FN: pvExportedKwh',             fnExp.pvExportedKwh,             fnRes.pvExportedKwh, 0.01);
  t.assert('FN: pvCapturedByBessKwh',       fnExp.pvCapturedByBessKwh,       fnRes.pvCapturedByBessKwh, 0.01);
  t.assert('FN: blendedAvoidedTariff',      fnExp.blendedAvoidedTariffMxnPerKwh, fnRes.blendedAvoidedTariffMxnPerKwh, 0.0001);
  t.assert('FN: pvCaptureValueMxn',         fnExp.pvCaptureValueMxn,         fnRes.pvCaptureValueMxn, TOL);
  t.assert('FN: billAfterPv',               fnExp.billAfterPv,               fnRes.billAfterPv, TOL);
  t.assert('FN: billAfterPvAndBess',        fnExp.billAfterPvAndBess,        fnRes.billAfterPvAndBess, TOL);
  t.assert('FN: strategyUsed',              'SELF_CONSUMPTION_MAX',          fnRes.strategyUsed);
  t.assert('FN: bessEnabled true',          true,                            fnRes.bessEnabled);

  // SE-mode scenario
  var seExp = bs.BESS_SE.expected;
  var seRes = calcBessImpact(inp, snap.frozenTariffs, bs.BESS_SE.pv, bs.BESS_SE.bess);
  t.assert('SE: pvCapturedByBessKwh',       seExp.pvCapturedByBessKwh,       seRes.pvCapturedByBessKwh, 0.01);
  t.assert('SE: pvCaptureValueMxn',         seExp.pvCaptureValueMxn,         seRes.pvCaptureValueMxn, TOL);
  t.assert('SE: billAfterPvAndBess',        seExp.billAfterPvAndBess,        seRes.billAfterPvAndBess, TOL);
  t.assertTrue('SE savings > FN savings (no export credit subtracted)',
               seRes.pvCaptureValueMxn > fnRes.pvCaptureValueMxn);

  // NM-mode scenario (no exported energy)
  var nmExp = bs.BESS_NM.expected;
  var nmRes = calcBessImpact(inp, snap.frozenTariffs, bs.BESS_NM.pv, bs.BESS_NM.bess);
  t.assert('NM: pvExportedKwh = 0',         nmExp.pvExportedKwh,             nmRes.pvExportedKwh, 0.01);
  t.assert('NM: pvCapturedByBessKwh = 0',   nmExp.pvCapturedByBessKwh,       nmRes.pvCapturedByBessKwh, 0.01);
  t.assert('NM: pvCaptureValueMxn = 0',     nmExp.pvCaptureValueMxn,         nmRes.pvCaptureValueMxn, 0.01);
  t.assert('NM: billAfterPvAndBess = billAfterPv (no BESS effect)',
           nmExp.billAfterPvAndBess,        nmRes.billAfterPvAndBess, TOL);

  // Annual aggregation
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

// ---------------------------------------------------------------------------
// SUITE 3: DISABLED PATHS — null bess, zero capacity, etc.
// ---------------------------------------------------------------------------
function testPhase2DisabledPaths(t) {
  t.suite('Phase2: BESS disabled paths');

  var snap = TESTPROJ_SYNTH_001.expected.snapshot;
  var inp  = _p2_buildSynth001JanInputObject();
  var bs = TESTPROJ_SYNTH_001.bessScenarios;
  var TOL = 0.10;

  // Null bess
  var nullRes = calcBessImpact(inp, snap.frozenTariffs, bs.BESS_NULL.pv, bs.BESS_NULL.bess);
  t.assert('Null bess: bessEnabled false',  false, nullRes.bessEnabled);
  t.assert('Null bess: billAfterPvAndBess = billAfterPv',
           bs.BESS_NULL.expected.billAfterPv, nullRes.billAfterPvAndBess, TOL);
  t.assert('Null bess: pvCaptureValueMxn = 0',  0, nullRes.pvCaptureValueMxn, 0.01);

  // Zero capacity
  var zeroRes = calcBessImpact(inp, snap.frozenTariffs,
                                bs.BESS_ZERO_CAPACITY.pv, bs.BESS_ZERO_CAPACITY.bess);
  t.assert('Zero cap: bessEnabled false',  false, zeroRes.bessEnabled);
  t.assert('Zero cap: billAfterPvAndBess = billAfterPv',
           bs.BESS_ZERO_CAPACITY.expected.billAfterPvAndBess, zeroRes.billAfterPvAndBess, TOL);
}

// ---------------------------------------------------------------------------
// SUITE 4: VALIDATION — bad inputs throw
// ---------------------------------------------------------------------------
function testPhase2Validation(t) {
  t.suite('Phase2: BESS input validation');

  var snap = TESTPROJ_SYNTH_001.expected.snapshot;
  var inp  = _p2_buildSynth001JanInputObject();
  var pvFn = TESTPROJ_SYNTH_001.bessScenarios.BESS_FN_70.pv;
  var bessOk = TESTPROJ_SYNTH_001.bessScenarios.BESS_FN_70.bess;

  // Unsupported strategy throws
  var threw = false;
  try {
    calcBessImpact(inp, snap.frozenTariffs, pvFn,
                   Object.assign({}, bessOk, { strategy: 'PEAK_SHAVING' }));
  } catch (e) { threw = true; }
  t.assertTrue('Unsupported strategy (PEAK_SHAVING) throws', threw);

  // Out-of-range minSocPct throws
  threw = false;
  try {
    calcBessImpact(inp, snap.frozenTariffs, pvFn,
                   Object.assign({}, bessOk, { minSocPct: 1.5 }));
  } catch (e) { threw = true; }
  t.assertTrue('minSocPct > 1 throws', threw);

  // maxSoc <= minSoc throws
  threw = false;
  try {
    calcBessImpact(inp, snap.frozenTariffs, pvFn,
                   Object.assign({}, bessOk, { minSocPct: 0.9, maxSocPct: 0.1 }));
  } catch (e) { threw = true; }
  t.assertTrue('maxSocPct <= minSocPct throws', threw);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function _p2_buildSynth001JanInputObject() {
  var m = TESTPROJ_SYNTH_001.inputs.cfe.monthly;
  return {
    kWhBase:       m.kWhBase[0],
    kWhIntermedia: m.kWhIntermedia[0],
    kWhPunta:      m.kWhPunta[0],
    kWBase:        m.kWBase[0],
    kWIntermedia:  m.kWIntermedia[0],
    kWPunta:       m.kWPunta[0],
    kWMaxAnoMovil: m.kWMaxAnoMovil[0],
    kVArh:         m.kVArh[0],
    tarifa:          'GDMTH',
    dap:             0,
    bajaTension2pct: false,
  };
}