// =============================================================================
// ARGIA ENGINE -- File: 99f_TestRunner_Phase3.gs
// Phase 3 (v2.3.0) regression suite: PEAK_SHAVING strategy.
//
// Covers:
//   SUITE 1 — availability: calcPeakShavingImpact + PEAK_SHAVING enum exist
//   SUITE 2 — strategy math vs Python/JS locks (TESTPROJ_PEAK_001)
//   SUITE 3 — ratchet: Year-1 vs steady-state demandaFacturable behavior
//   SUITE 4 — provenance + disclaimers: measured vs synthesized last-resort
//   SUITE 5 — disabled / validation paths
//
// All numeric locks verified by Python recompute (partB_recompute) AND by
// running the deployed calcPeakShavingImpact() in Node before commit.
// See PHASE_3_DESIGN.md and CHANGELOG v2.3.0.
//
// Entry point: addPhase3Tests(t, ss) — wired into runTests() in 99_TestRunner.
// =============================================================================

function addPhase3Tests(t, ss) {
  testPhase3Availability(t);
  testPhase3PeakShavingMath(t);
  testPhase3Ratchet(t);
  testPhase3Provenance(t);
  testPhase3DisabledAndValidation(t);
}

// ---------------------------------------------------------------------------
// SUITE 1: AVAILABILITY
// ---------------------------------------------------------------------------
function testPhase3Availability(t) {
  t.suite('Phase3: PEAK_SHAVING availability');

  t.assert('calcPeakShavingImpact defined',
           'function', typeof calcPeakShavingImpact);
  t.assert('_bessUsableKwh helper defined',
           'function', typeof _bessUsableKwh);
  t.assert('BESS_STRATEGY.PEAK_SHAVING enabled',
           'PEAK_SHAVING', BESS_STRATEGY.PEAK_SHAVING);
  // HYBRID must remain undefined — deferred to v2.4.0.
  t.assert('BESS_STRATEGY.HYBRID NOT enabled (deferred v2.4.0)',
           'undefined', typeof BESS_STRATEGY.HYBRID);
}

// ---------------------------------------------------------------------------
// SUITE 2: PEAK_SHAVING MATH — normal run, three savings tiers
// ---------------------------------------------------------------------------
function testPhase3PeakShavingMath(t) {
  t.suite('Phase3: PEAK_SHAVING math vs locks (TESTPROJ_PEAK_001)');

  var fx  = TESTPROJ_PEAK_001;
  var exp = fx.expected;
  var res = calcPeakShavingImpact(fx.janInput, fx.frozenTariffs, fx.bess);
  var TOL = 0.10;

  t.assert('strategyUsed = PEAK_SHAVING',
           'PEAK_SHAVING', res.strategyUsed);
  t.assert('bessEnabled true', true, res.bessEnabled);
  t.assert('usableKwh',          exp.usableKwh,        res.usableKwh,        0.01);
  t.assert('shaveKw',            exp.shaveKw,          res.shaveKw,          0.01);
  t.assert('dmaxPuntaUsed',      exp.dmaxPuntaUsed,    res.dmaxPuntaUsed,    0.01);
  t.assert('postBessPuntaKw',    exp.postBessPuntaKw,  res.postBessPuntaKw,  0.01);

  // Tier 1 — verifiable
  t.assert('Capacidad saving Year-1',
           exp.capacidadSavingYear1,    res.capacidadSavingYear1,    TOL);
  t.assert('Distribucion saving Year-1 (0 — intermedia is monthly max)',
           exp.distribucionSavingYear1, res.distribucionSavingYear1, TOL);
  t.assert('Verifiable saving Year-1',
           exp.verifiableSavingYear1,   res.verifiableSavingYear1,   TOL);

  // Tier 2 — estimated
  t.assert('Energy shifted kWh',
           exp.energyShiftedKwh,        res.energyShiftedKwh,        TOL);
  t.assert('Variable saving (estimated)',
           exp.variableSavingEstimated, res.variableSavingEstimated, TOL);

  t.assert('Total saving Year-1 (verifiable + variable)',
           exp.totalSavingYear1,        res.totalSavingYear1,        TOL);
  t.assert('baselineBill',
           exp.baselineBill,            res.baselineBill,            TOL);
  t.assert('billAfterPeakShavingYear1 = baseline - totalYear1',
           exp.baselineBill - exp.totalSavingYear1,
           res.billAfterPeakShavingYear1, TOL);
}

// ---------------------------------------------------------------------------
// SUITE 3: RATCHET — Year-1 vs steady-state
// ---------------------------------------------------------------------------
function testPhase3Ratchet(t) {
  t.suite('Phase3: ratchet (Year-1 vs steady-state)');

  var fx  = TESTPROJ_PEAK_001;
  var exp = fx.expected;
  var res = calcPeakShavingImpact(fx.janInput, fx.frozenTariffs, fx.bess);
  var TOL = 0.10;

  t.assert('Capacidad saving steady-state',
           exp.capacidadSavingSteady,  res.capacidadSavingSteady,  TOL);
  t.assert('Verifiable saving steady-state',
           exp.verifiableSavingSteady, res.verifiableSavingSteady, TOL);
  t.assert('Ratchet delta (steady - year1)',
           exp.ratchetDelta,
           res.verifiableSavingSteady - res.verifiableSavingYear1, TOL);

  // The ratchet MUST bite in this fixture — steady strictly exceeds Year-1.
  // If this fails, the fixture no longer exercises the ratchet (regression).
  t.assertTrue('Ratchet bites: steady saving > Year-1 saving',
               res.verifiableSavingSteady > res.verifiableSavingYear1);
  // Year-1 is the conservative headline — never larger than steady.
  t.assertTrue('Year-1 headline <= steady-state (conservative)',
               res.verifiableSavingYear1 <= res.verifiableSavingSteady);
}

// ---------------------------------------------------------------------------
// SUITE 4: PROVENANCE + DISCLAIMERS
// ---------------------------------------------------------------------------
function testPhase3Provenance(t) {
  t.suite('Phase3: demand provenance + disclaimers');

  var fx = TESTPROJ_PEAK_001;

  // Normal run — kWPunta present → measured, no loud disclaimer.
  var measured = calcPeakShavingImpact(fx.janInput, fx.frozenTariffs, fx.bess);
  t.assert('Measured provenance (kWPunta in INPUT_CFE)',
           'measured(INPUT_CFE)', measured.demandProvenance);
  t.assertFalse('No synthesized-demand disclaimer on measured path',
                measured.synthesizedDemandDisclaimer);

  // Tier 2 disclaimer is ALWAYS true — Variable is structurally estimated.
  t.assertTrue('Estimated-tier disclaimer always present',
               measured.estimatedTierDisclaimer);

  // Synthesis last-resort — kWPunta removed → loud disclaimer fires.
  var noDemand = Object.assign({}, fx.janInput, { kWPunta: 0 });
  var synth = calcPeakShavingImpact(noDemand, fx.frozenTariffs, fx.bess);
  t.assert('Synthesized provenance when no demand data',
           'synthesized(no demand data)', synth.demandProvenance);
  t.assertTrue('Loud synthesized-demand disclaimer fires',
               synth.synthesizedDemandDisclaimer);

  // Override path — explicit dmaxPuntaOverride wins over INPUT_CFE kWPunta.
  var ovBess = Object.assign({}, fx.bess, { dmaxPuntaOverride: 366 });
  var ov = calcPeakShavingImpact(fx.janInput, fx.frozenTariffs, ovBess);
  t.assert('Override provenance',
           'measured(override)', ov.demandProvenance);
  t.assert('Override dmaxPuntaUsed honored',
           366, ov.dmaxPuntaUsed, 0.01);

  // Option-1 guard: synthesized estimate must NEVER silently replace a
  // metered kWPunta. With kWPunta present, provenance must be measured.
  t.assertFalse('Synthesis does NOT run when metered kWPunta exists',
                measured.synthesizedDemandDisclaimer);
}

// ---------------------------------------------------------------------------
// SUITE 5: DISABLED + VALIDATION PATHS
// ---------------------------------------------------------------------------
function testPhase3DisabledAndValidation(t) {
  t.suite('Phase3: disabled + validation paths');

  var fx = TESTPROJ_PEAK_001;
  var TOL = 0.10;

  // Null bess → no-op, returns baseline.
  var nullRes = calcPeakShavingImpact(fx.janInput, fx.frozenTariffs, null);
  t.assertFalse('Null bess: bessEnabled false', nullRes.bessEnabled);
  t.assert('Null bess: billAfter = baseline',
           nullRes.baselineBill, nullRes.billAfterPeakShavingYear1, TOL);
  t.assert('Null bess: verifiable saving 0',
           0, nullRes.verifiableSavingYear1, 0.01);

  // Zero capacity → no-op.
  var zeroBess = Object.assign({}, fx.bess, { capacityKwh: 0 });
  var zeroRes = calcPeakShavingImpact(fx.janInput, fx.frozenTariffs, zeroBess);
  t.assertFalse('Zero capacity: bessEnabled false', zeroRes.bessEnabled);
  t.assert('Zero capacity: total saving 0',
           0, zeroRes.totalSavingYear1, 0.01);

  // Invalid SoC window throws.
  var threw = false;
  try {
    calcPeakShavingImpact(fx.janInput, fx.frozenTariffs,
      Object.assign({}, fx.bess, { minSocPct: 0.9, maxSocPct: 0.1 }));
  } catch (e) { threw = true; }
  t.assertTrue('maxSocPct <= minSocPct throws', threw);

  // Out-of-range rtePct throws.
  threw = false;
  try {
    calcPeakShavingImpact(fx.janInput, fx.frozenTariffs,
      Object.assign({}, fx.bess, { rtePct: 1.5 }));
  } catch (e) { threw = true; }
  t.assertTrue('rtePct > 1 throws', threw);

  // Missing puntaWindowHours throws.
  threw = false;
  try {
    calcPeakShavingImpact(fx.janInput, fx.frozenTariffs,
      Object.assign({}, fx.bess, { puntaWindowHours: 0 }));
  } catch (e) { threw = true; }
  t.assertTrue('puntaWindowHours <= 0 throws', threw);
}