// =============================================================================
// ARGIA ENGINE v2.1.2 -- File: 99c_TestRunner_Phase1_2.gs
// Phase 1.2 regression test suites — PF threshold parameter sweep.
//
// Sits ALONGSIDE 99a_TestRunner_Phase0.gs and 99b_TestRunner_Phase1.gs.
// Hooked into runTests() via addPhase12Tests(t, ss).
//
// SUITES:
//   1. testFpThresholdSweep — three scenarios (T=0.90, 0.95, 0.97)
//   2. testFpThresholdBackwardCompat — calcCfeBill() with no options must
//      match v2.0.4 / v2.1.0 lock byte-identical
//   3. testFpThresholdPvIntegration — PV path forwards options correctly
//
// All pure JS unit tests. No spreadsheet I/O.
//
// USAGE FROM 99_TestRunner.gs:
//   try { addPhase12Tests(t, ss); }
//   catch (e) { t.error('Phase1.2 aborted', e); }
// =============================================================================

function addPhase12Tests(t, ss) {
  testFpThresholdBackwardCompat(t);
  testFpThresholdSweep(t);
  testFpThresholdPvIntegration(t);
}

// ---------------------------------------------------------------------------
// SUITE 1: BACKWARD COMPATIBILITY
// v2.1.2 must NOT change any existing v2.0.4 / v2.1.0 baseline behavior.
// ---------------------------------------------------------------------------
function testFpThresholdBackwardCompat(t) {
  t.suite('Phase1.2: PF threshold backward compatibility');

  var snap = TESTPROJ_SYNTH_001.expected.snapshot;
  var inp  = _p12_buildSynth001JanInputObject();

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
  var monthlyInputs = _p12_buildSynth001AllMonthsInputArray();
  var annualDefault = calcCfeBillAnnual(monthlyInputs, snap.frozenTariffs);
  t.assert('calcCfeBillAnnual(no options) matches v2.0.4 lock',
           snap.annualBillFrozen, annualDefault, snap.annualBillFrozenTol);
}

// ---------------------------------------------------------------------------
// SUITE 2: PF THRESHOLD PARAMETER SWEEP
// Three scenarios (T=0.90, 0.95, 0.97) all with SYNTH-001 base inputs.
// Tests the configurable threshold against Python-derived lock targets.
// ---------------------------------------------------------------------------
function testFpThresholdSweep(t) {
  t.suite('Phase1.2: PF threshold parameter sweep');

  var snap      = TESTPROJ_SYNTH_001.expected.snapshot;
  var scenarios = TESTPROJ_SYNTH_001.fpThresholdScenarios;
  var inp       = _p12_buildSynth001JanInputObject();

  if (!scenarios) {
    t.fail('fpThresholdScenarios exists',
           'TESTPROJ_SYNTH_001.fpThresholdScenarios is missing');
    return;
  }

  // Tolerance for FP-related assertions
  var TOL = 0.10;
  var ANNUAL_TOL = 1.2;

  ['T_090', 'T_095', 'T_097'].forEach(function(key) {
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

    // Annual = 12 × Jan (synthetic identity)
    var monthlyInputs = _p12_buildSynth001AllMonthsInputArray();
    var annual = calcCfeBillAnnual(monthlyInputs, snap.frozenTariffs,
                                    { fpThreshold: scn.fpThreshold });
    t.assert(labelShort + ': annual = 12 × Jan',
             scn.expected.annual, annual, ANNUAL_TOL);
  });

  // Sanity: T=0.95 bill > T=0.90 bill (penalty kicks in)
  var r090 = calcCfeBill(inp, snap.frozenTariffs, { fpThreshold: 0.90 });
  var r095 = calcCfeBill(inp, snap.frozenTariffs, { fpThreshold: 0.95 });
  var r097 = calcCfeBill(inp, snap.frozenTariffs, { fpThreshold: 0.97 });
  t.assertTrue('monotonic: T=0.95 bill > T=0.90 bill',
               r095.total > r090.total);
  t.assertTrue('monotonic: T=0.97 bill > T=0.95 bill',
               r097.total > r095.total);
}

// ---------------------------------------------------------------------------
// SUITE 3: PV PATH FORWARDS OPTIONS
// calcCfeBillWithPv should forward options.fpThreshold to its internal
// calcCfeBill call. Verify by comparing FN scenario at T=0.90 vs T=0.95.
// ---------------------------------------------------------------------------
function testFpThresholdPvIntegration(t) {
  t.suite('Phase1.2: PV path forwards fpThreshold');

  var snap = TESTPROJ_SYNTH_001.expected.snapshot;
  var scn  = TESTPROJ_SYNTH_001.scenarios && TESTPROJ_SYNTH_001.scenarios.FN;
  if (!scn) {
    t.fail('scenarios.FN exists', 'missing from fixture');
    return;
  }
  var inp = _p12_buildSynth001JanInputObject();

  // Default (no options) — must match Phase 1 FN lock
  var fnDefault = calcCfeBillWithPv(inp, snap.frozenTariffs, scn.pv);
  t.assert('FN with no options matches Phase 1 lock',
           snap.janBillFNFrozen, fnDefault.total, snap.pvScenarioTol);

  // T=0.95 — bill should be HIGHER (PF penalty kicks in)
  var fn095 = calcCfeBillWithPv(inp, snap.frozenTariffs, scn.pv,
                                 { fpThreshold: 0.95 });
  t.assertTrue('FN at T=0.95 bill > FN at T=0.90 (penalty applied)',
               fn095.total > fnDefault.total);

  // T=0.97 — even higher
  var fn097 = calcCfeBillWithPv(inp, snap.frozenTariffs, scn.pv,
                                 { fpThreshold: 0.97 });
  t.assertTrue('FN at T=0.97 bill > FN at T=0.95',
               fn097.total > fn095.total);
}

// ---------------------------------------------------------------------------
// Helpers — Phase 1.2 owns its own copies to keep phases decoupled.
// Function names prefixed _p12_ to avoid collision with Phase 0/1 helpers.
// ---------------------------------------------------------------------------
function _p12_buildSynth001JanInputObject() {
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

function _p12_buildSynth001AllMonthsInputArray() {
  var m = TESTPROJ_SYNTH_001.inputs.cfe.monthly;
  var arr = [];
  for (var i = 0; i < 12; i++) {
    arr.push({
      kWhBase:       m.kWhBase[i],
      kWhIntermedia: m.kWhIntermedia[i],
      kWhPunta:      m.kWhPunta[i],
      kWBase:        m.kWBase[i],
      kWIntermedia:  m.kWIntermedia[i],
      kWPunta:       m.kWPunta[i],
      kWMaxAnoMovil: m.kWMaxAnoMovil[i],
      kVArh:         m.kVArh[i],
      tarifa:          'GDMTH',
      dap:             0,
      bajaTension2pct: false,
    });
  }
  return arr;
}