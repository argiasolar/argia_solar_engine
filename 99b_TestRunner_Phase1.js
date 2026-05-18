// =============================================================================
// ARGIA ENGINE v2.1.0 -- File: 99b_TestRunner_Phase1.gs
// Phase 1 regression test suites — CFE export rule + interconnection modes.
//
// Sits ALONGSIDE 99a_TestRunner_Phase0.gs. Adds three test suites hooked into
// runTests() via the addPhase1Tests(t, ss) entry point.
//
// SUITES:
//   1. testCalcCfeBillWithPvAvailable — sanity: function exists, signature OK
//   2. testCalcCfeBillScenarios — three scenarios (NM/FN/SE) vs locked targets
//   3. testCalcCfeBillBaselineUnchanged — no-PV path identical to v2.0.4
//
// All three suites are PURE UNIT TESTS — no spreadsheet I/O. They test the
// JS reference implementation directly. The live engine continues to compute
// using its existing formulas in CFE_SIMULATION; v2.1.0 does not modify those.
// (Live engine integration with the new modes lands in v2.1.1 or later.)
//
// USAGE FROM 99_TestRunner.gs:
//   Inside runTests(), after the existing addPhase0Tests call, add:
//     try { addPhase1Tests(t, ss); }
//     catch (e) { t.error('Phase1 aborted', e); }
// =============================================================================

// ---------------------------------------------------------------------------
// PUBLIC ENTRY POINT
// ---------------------------------------------------------------------------
function addPhase1Tests(t, ss) {
  testCalcCfeBillWithPvAvailable(t);
  testCalcCfeBillBaselineUnchanged(t);
  testCalcCfeBillScenarios(t);
}

// ---------------------------------------------------------------------------
// SUITE 1: AVAILABILITY
// Confirms the new functions and constants exist. Cheap fail-fast — if this
// fails, suite 2 and 3 would crash with cryptic errors.
// ---------------------------------------------------------------------------
function testCalcCfeBillWithPvAvailable(t) {
  t.suite('Phase1: calcCfeBillWithPv availability');

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

// ---------------------------------------------------------------------------
// SUITE 2: BASELINE UNCHANGED
// v2.1.0 adds capability but must NOT change existing v2.0.4 behavior.
// This suite proves the no-PV path is byte-identical to v2.0.4.
// ---------------------------------------------------------------------------
function testCalcCfeBillBaselineUnchanged(t) {
  t.suite('Phase1: baseline unchanged from v2.0.4');

  var snap = TESTPROJ_SYNTH_001.expected.snapshot;
  var inp  = _p1_buildSynth001JanInputObject();

  // Direct call to v2.0.4 calcCfeBill — must still match v2.0.4 lock
  var direct = calcCfeBill(inp, snap.frozenTariffs);
  t.assert('calcCfeBill(no PV) Jan still matches v2.0.4 lock',
           snap.janBillFrozen, direct.total, snap.janBillFrozenTol);

  // Wrapper with no PV (undefined) must equal direct call exactly
  var noPv = calcCfeBillWithPv(inp, snap.frozenTariffs, undefined);
  t.assert('calcCfeBillWithPv(inp, tar, undefined) == calcCfeBill(inp, tar)',
           direct.total, noPv.total, 0.0001);

  // Wrapper with monthlyKwh=0 must also equal direct
  var zeroPv = calcCfeBillWithPv(inp, snap.frozenTariffs, { monthlyKwh: 0 });
  t.assert('calcCfeBillWithPv with monthlyKwh=0 == no-PV path',
           direct.total, zeroPv.total, 0.0001);
}

// ---------------------------------------------------------------------------
// SUITE 3: SCENARIOS
// Three interconnection modes against locked targets.
// ---------------------------------------------------------------------------
function testCalcCfeBillScenarios(t) {
  t.suite('Phase1: interconnection-mode scenarios');

  var snap      = TESTPROJ_SYNTH_001.expected.snapshot;
  var scenarios = TESTPROJ_SYNTH_001.scenarios;
  var inp       = _p1_buildSynth001JanInputObject();
  var tol       = snap.pvScenarioTol;

  if (!scenarios) {
    t.fail('scenarios block exists', 'TESTPROJ_SYNTH_001.scenarios is missing');
    return;
  }

  // Loop through all three scenarios
  ['NM', 'FN', 'SE'].forEach(function(key) {
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

    // Jan bill assertion
    t.assert(key + ': Jan bill (' + scn.label.slice(0, 40) + ')',
             scn.expected.janBill, result.total, tol);

    // Per-scenario extras
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
    var monthlyInputs = _p1_buildSynth001AllMonthsInputArray();
    var annual = calcCfeBillWithPvAnnual(monthlyInputs, snap.frozenTariffs, scn.pv);
    t.assert(key + ': annual = 12 × Jan',
             scn.expected.annualBill, annual, tol * 12);
  });

  // Algebraic sanity: FN.total + FN.credit ≈ SE.total
  // (same self-consumption, same load, only differ by whether export pays back)
  try {
    var fn = calcCfeBillWithPv(inp, snap.frozenTariffs, scenarios.FN.pv);
    var se = calcCfeBillWithPv(inp, snap.frozenTariffs, scenarios.SE.pv);
    t.assert('algebraic: FN.total + FN.credit == SE.total',
             se.total, fn.total + fn.exportCredit, 0.01);
  } catch (e) {
    t.fail('algebraic sanity', String(e));
  }

  // Edge case: unknown mode must throw
  var threw = false;
  try {
    calcCfeBillWithPv(inp, snap.frozenTariffs, {
      monthlyKwh: 25000, interconnectionMode: 'NOT_A_MODE',
    });
  } catch (e) { threw = true; }
  t.assertTrue('unknown mode throws', threw);

  // Edge case: out-of-range self-consumption must throw
  var threwPct = false;
  try {
    calcCfeBillWithPv(inp, snap.frozenTariffs, {
      monthlyKwh: 25000,
      interconnectionMode: CFE_MODE.FACTURACION_NETA,
      selfConsumptionPct: 1.5,
    });
  } catch (e) { threwPct = true; }
  t.assertTrue('out-of-range selfConsumptionPct throws', threwPct);
}

// ---------------------------------------------------------------------------
// Helpers (Phase 1 owns its own copy of these to keep phases decoupled).
// Function names prefixed _p1_ to avoid collision with Phase 0's identically-
// purposed helpers — Apps Script files share a global namespace, so two
// functions with the same name in different files create an unpredictable
// last-loaded-wins situation.
// ---------------------------------------------------------------------------
function _p1_buildSynth001JanInputObject() {
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

function _p1_buildSynth001AllMonthsInputArray() {
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