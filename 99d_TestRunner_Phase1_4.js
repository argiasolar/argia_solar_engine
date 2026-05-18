// =============================================================================
// ARGIA ENGINE v2.1.4 -- File: 99d_TestRunner_Phase1_4.gs
// Phase 1.4 regression test suites — mode-aware cascade + default self_pct.
//
// Sits ALONGSIDE 99a_TestRunner_Phase0.gs, 99b_TestRunner_Phase1.gs, and
// 99c_TestRunner_Phase1_2.gs. Hooked into runTests() via addPhase14Tests().
//
// SUITES:
//   1. Mode self_pct defaults — ISBLANK-aware behavior per mode
//      - NM with blank selfPct → forced 100%
//      - SE with blank selfPct → defaults 100% (v2.1.4 NEW)
//      - SE with explicit 0.70 → uses 0.70 (compat)
//      - FN with blank selfPct → defaults 70% (industry standard)
//      - FN with explicit 0.70 → uses 0.70 (matches v2.1.4 explicit FN scenario)
//
//   2. Intermedia-only cascade verification — SE/FN bills should differ from
//      v2.1.0 proportional cascade. Test that v2.1.4 lock targets hit and that
//      delta from old proportional behavior is documented.
//
//   3. FP threshold propagation through PV path
//      - Test fpThreshold=0.95 produces higher bill in each mode (penalty)
//      - Test fpThreshold=0.90 vs 0.95 monotonic increase
//
// All pure JS unit tests. No spreadsheet I/O.
//
// USAGE FROM 99_TestRunner.gs:
//   try { addPhase14Tests(t, ss); }
//   catch (e) { t.error('Phase1.4 aborted', e); }
// =============================================================================

function addPhase14Tests(t, ss) {
  testPhase14ModeDefaults(t);
  testPhase14IntermediaOnly(t);
  testPhase14FpThresholdInPvPath(t);
}

// ---------------------------------------------------------------------------
// SUITE 1: MODE-AWARE SELF_PCT DEFAULTS
// Verifies the ISBLANK semantics per mode.
// ---------------------------------------------------------------------------
function testPhase14ModeDefaults(t) {
  t.suite('Phase1.4: mode-aware self_pct defaults');

  var snap = TESTPROJ_SYNTH_001.expected.snapshot;
  var inp  = _p14_buildSynth001JanInputObject();

  // NM: selfPct always 1.0 regardless of input
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

  // FN with blank and FN with explicit 0.70 produce identical results
  t.assert('FN blank == FN explicit(0.70) total',
           fnBlank.total, fnExplicit.total, 0.01);
}

// ---------------------------------------------------------------------------
// SUITE 2: INTERMEDIA-ONLY CASCADE FOR SE/FN
// Verifies the new v2.1.4 cascade semantics:
//   - Only kWhIntermedia is reduced by PV
//   - kWhBase and kWhPunta remain unchanged
// ---------------------------------------------------------------------------
function testPhase14IntermediaOnly(t) {
  t.suite('Phase1.4: intermedia-only cascade for SE/FN');

  var snap = TESTPROJ_SYNTH_001.expected.snapshot;
  var inp  = _p14_buildSynth001JanInputObject();
  var TOL  = 0.10;

  // Get lock targets from fixture
  var sce = TESTPROJ_SYNTH_001.scenarios;

  // FN at explicit 0.70 → matches v2.1.4 lock 82,377.81
  var fnResult = calcCfeBillWithPv(inp, snap.frozenTariffs, sce.FN.pv);
  t.assert('FN explicit Jan bill matches v2.1.4 lock',
           sce.FN.expected.janBill, fnResult.total, TOL);

  // SE at explicit 0.70 → matches v2.1.4 lock 88,377.81
  var seResult = calcCfeBillWithPv(inp, snap.frozenTariffs, sce.SE.pv);
  t.assert('SE explicit Jan bill matches v2.1.4 lock',
           sce.SE.expected.janBill, seResult.total, TOL);

  // SE default (100%) is LOWER than SE explicit (70%) — more displacement
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

  // FN exported kWh = monthlyKwh - selfConsumed (intermedia bound)
  t.assert('FN selfConsumed = MIN(kWhIntermedia, selfPct × monthlyKwh)',
           Math.min(inp.kWhIntermedia, 0.70 * 25000),
           fnResult.selfConsumedKwh, 0.01);
  t.assert('FN exported = monthlyKwh - selfConsumed',
           25000 - fnResult.selfConsumedKwh,
           fnResult.exportedKwh, 0.01);
}

// ---------------------------------------------------------------------------
// SUITE 3: FP THRESHOLD PROPAGATES THROUGH PV PATH
// Verifies that options.fpThreshold flows from calcCfeBillWithPv to
// the inner calcCfeBill, affecting Cargo FP in all three modes.
// ---------------------------------------------------------------------------
function testPhase14FpThresholdInPvPath(t) {
  t.suite('Phase1.4: FP threshold through PV path');

  var snap = TESTPROJ_SYNTH_001.expected.snapshot;
  var inp  = _p14_buildSynth001JanInputObject();
  var sce = TESTPROJ_SYNTH_001.scenarios;

  // For each mode, threshold=0.95 should produce HIGHER bill than 0.90
  // (penalty bites when PV reduces kWh enough to drop PF below 0.95)
  ['NM', 'FN', 'SE'].forEach(function(modeName) {
    var pv = sce[modeName].pv;
    var t090 = calcCfeBillWithPv(inp, snap.frozenTariffs, pv, { fpThreshold: 0.90 });
    var t095 = calcCfeBillWithPv(inp, snap.frozenTariffs, pv, { fpThreshold: 0.95 });
    t.assertTrue(modeName + ': T=0.95 total > T=0.90 total (penalty applied)',
                 t095.total > t090.total);
  });
}

// ---------------------------------------------------------------------------
// Helpers — phase 1.4 owns its own copy.
// ---------------------------------------------------------------------------
function _p14_buildSynth001JanInputObject() {
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