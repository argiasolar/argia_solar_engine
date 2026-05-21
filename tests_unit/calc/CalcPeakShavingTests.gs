// =============================================================================
// ARGIA TESTS -- tests_unit/calc/CalcPeakShavingTests.gs
// -----------------------------------------------------------------------------
// PASS 9 MIGRATION: calcPeakShavingImpact (Strategy = PEAK_SHAVING).
//
// SOURCE: Originally addPhase3Tests in 99_TestRunner.gs (lines ~2519-2700).
//         Migrated 2026-05-21 as part of Pass 9.
//
// COVERAGE
//   Five sub-suites split into five registered tests:
//     UNIT_CALC_PEAK_SHAVING_AVAILABILITY        -- function + constant existence
//     UNIT_CALC_PEAK_SHAVING_MATH                -- main math vs Python locks
//     UNIT_CALC_PEAK_SHAVING_RATCHET             -- Year-1 vs steady-state
//     UNIT_CALC_PEAK_SHAVING_PROVENANCE          -- demand provenance + disclaimers
//     UNIT_CALC_PEAK_SHAVING_DISABLED_AND_VALID  -- null/zero/throws
//
// CLASSIFICATION
//   group=unit. All sub-suites are pure-function calls. No sheet I/O.
//
// DEPENDENCIES
//   - calcPeakShavingImpact (04a_CalcCFEBill.gs)
//   - _bessUsableKwh (04a_CalcCFEBill.gs)
//   - BESS_STRATEGY constants (04a_CalcCFEBill.gs)
//   - TESTPROJ_PEAK_001 fixture (test/TestProjects.gs)
//
// CO-EXISTENCE
//   Legacy addPhase3Tests in 99_TestRunner.gs is unchanged. After Pass 9
//   the 35 asserts run twice until the legacy deletion pass.
//
// HYBRID NOTE
//   BESS_STRATEGY.HYBRID must remain undefined -- deferred to v2.4.0.
//   Availability test verifies this so a premature enablement is caught.
// =============================================================================


// ===========================================================================
// SUITE 1: AVAILABILITY (4 asserts)
// ===========================================================================

registerTest({
  id      : 'UNIT_CALC_PEAK_SHAVING_AVAILABILITY',
  group   : 'unit',
  module  : 'calc/peak_shaving',
  scenarios: [],
  tags    : ['calc', 'bess', 'peak-shaving', 'availability'],
  source  : 'tests_unit/calc/CalcPeakShavingTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/peak_shaving: API availability');

    t.assert('calcPeakShavingImpact defined',
             'function', typeof calcPeakShavingImpact);
    t.assert('_bessUsableKwh helper defined',
             'function', typeof _bessUsableKwh);
    t.assert('BESS_STRATEGY.PEAK_SHAVING enabled',
             'PEAK_SHAVING', BESS_STRATEGY.PEAK_SHAVING);
    // HYBRID must remain undefined -- deferred to v2.4.0
    t.assert('BESS_STRATEGY.HYBRID NOT enabled (deferred v2.4.0)',
             'undefined', typeof BESS_STRATEGY.HYBRID);
  }
});


// ===========================================================================
// SUITE 2: PEAK_SHAVING MATH (15 asserts)
// ===========================================================================

registerTest({
  id      : 'UNIT_CALC_PEAK_SHAVING_MATH',
  group   : 'unit',
  module  : 'calc/peak_shaving',
  scenarios: [],
  tags    : ['calc', 'bess', 'peak-shaving', 'math', 'tier1', 'tier2'],
  source  : 'tests_unit/calc/CalcPeakShavingTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/peak_shaving: math vs locks (TESTPROJ_PEAK_001)');

    var fx  = TESTPROJ_PEAK_001;
    var exp = fx.expected;
    var res = calcPeakShavingImpact(fx.janInput, fx.frozenTariffs, fx.bess);
    var TOL = 0.10;

    t.assert('strategyUsed = PEAK_SHAVING',
             'PEAK_SHAVING', res.strategyUsed);
    t.assert('bessEnabled true', true, res.bessEnabled);
    t.assert('usableKwh',
             exp.usableKwh, res.usableKwh, 0.01);
    t.assert('shaveKw',
             exp.shaveKw, res.shaveKw, 0.01);
    t.assert('dmaxPuntaUsed',
             exp.dmaxPuntaUsed, res.dmaxPuntaUsed, 0.01);
    t.assert('postBessPuntaKw',
             exp.postBessPuntaKw, res.postBessPuntaKw, 0.01);

    // Tier 1 -- verifiable
    t.assert('Capacidad saving Year-1',
             exp.capacidadSavingYear1, res.capacidadSavingYear1, TOL);
    t.assert('Distribucion saving Year-1 (0 - intermedia is monthly max)',
             exp.distribucionSavingYear1, res.distribucionSavingYear1, TOL);
    t.assert('Verifiable saving Year-1',
             exp.verifiableSavingYear1, res.verifiableSavingYear1, TOL);

    // Tier 2 -- estimated
    t.assert('Energy shifted kWh',
             exp.energyShiftedKwh, res.energyShiftedKwh, TOL);
    t.assert('Variable saving (estimated)',
             exp.variableSavingEstimated, res.variableSavingEstimated, TOL);

    t.assert('Total saving Year-1 (verifiable + variable)',
             exp.totalSavingYear1, res.totalSavingYear1, TOL);
    t.assert('baselineBill',
             exp.baselineBill, res.baselineBill, TOL);
    t.assert('billAfterPeakShavingYear1 = baseline - totalYear1',
             exp.baselineBill - exp.totalSavingYear1,
             res.billAfterPeakShavingYear1, TOL);
  }
});


// ===========================================================================
// SUITE 3: RATCHET (5 asserts)
// ===========================================================================

registerTest({
  id      : 'UNIT_CALC_PEAK_SHAVING_RATCHET',
  group   : 'unit',
  module  : 'calc/peak_shaving',
  scenarios: [],
  tags    : ['calc', 'bess', 'peak-shaving', 'ratchet'],
  source  : 'tests_unit/calc/CalcPeakShavingTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/peak_shaving: ratchet (Year-1 vs steady-state)');

    var fx  = TESTPROJ_PEAK_001;
    var exp = fx.expected;
    var res = calcPeakShavingImpact(fx.janInput, fx.frozenTariffs, fx.bess);
    var TOL = 0.10;

    t.assert('Capacidad saving steady-state',
             exp.capacidadSavingSteady, res.capacidadSavingSteady, TOL);
    t.assert('Verifiable saving steady-state',
             exp.verifiableSavingSteady, res.verifiableSavingSteady, TOL);
    t.assert('Ratchet delta (steady - year1)',
             exp.ratchetDelta,
             res.verifiableSavingSteady - res.verifiableSavingYear1, TOL);

    // The ratchet MUST bite in this fixture -- steady strictly exceeds Year-1.
    // If this fails, the fixture no longer exercises the ratchet (regression).
    t.assertTrue('Ratchet bites: steady saving > Year-1 saving',
                 res.verifiableSavingSteady > res.verifiableSavingYear1);
    // Year-1 is the conservative headline -- never larger than steady.
    t.assertTrue('Year-1 headline <= steady-state (conservative)',
                 res.verifiableSavingYear1 <= res.verifiableSavingSteady);
  }
});


// ===========================================================================
// SUITE 4: PROVENANCE + DISCLAIMERS (8 asserts)
// ===========================================================================

registerTest({
  id      : 'UNIT_CALC_PEAK_SHAVING_PROVENANCE',
  group   : 'unit',
  module  : 'calc/peak_shaving',
  scenarios: [],
  tags    : ['calc', 'bess', 'peak-shaving', 'provenance', 'disclaimers'],
  source  : 'tests_unit/calc/CalcPeakShavingTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/peak_shaving: demand provenance + disclaimers');

    var fx = TESTPROJ_PEAK_001;

    // -- Normal run -- kWPunta present -> measured, no loud disclaimer ---
    var measured = calcPeakShavingImpact(fx.janInput, fx.frozenTariffs, fx.bess);
    t.assert('Measured provenance (kWPunta in INPUT_CFE)',
             'measured(INPUT_CFE)', measured.demandProvenance);
    t.assertFalse('No synthesized-demand disclaimer on measured path',
                  measured.synthesizedDemandDisclaimer);

    // Tier 2 disclaimer is ALWAYS true -- Variable is structurally estimated
    t.assertTrue('Estimated-tier disclaimer always present',
                 measured.estimatedTierDisclaimer);

    // -- Synthesis last-resort -- kWPunta removed -> loud disclaimer fires
    var noDemand = Object.assign({}, fx.janInput, { kWPunta: 0 });
    var synth = calcPeakShavingImpact(noDemand, fx.frozenTariffs, fx.bess);
    t.assert('Synthesized provenance when no demand data',
             'synthesized(no demand data)', synth.demandProvenance);
    t.assertTrue('Loud synthesized-demand disclaimer fires',
                 synth.synthesizedDemandDisclaimer);

    // -- Override path -- explicit dmaxPuntaOverride wins over kWPunta ---
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
});


// ===========================================================================
// SUITE 5: DISABLED + VALIDATION PATHS (8 asserts)
// ===========================================================================

registerTest({
  id      : 'UNIT_CALC_PEAK_SHAVING_DISABLED_AND_VALID',
  group   : 'unit',
  module  : 'calc/peak_shaving',
  scenarios: [],
  tags    : ['calc', 'bess', 'peak-shaving', 'disabled', 'validation'],
  source  : 'tests_unit/calc/CalcPeakShavingTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/peak_shaving: disabled + validation paths');

    var fx  = TESTPROJ_PEAK_001;
    var TOL = 0.10;

    // -- Null bess -> no-op, returns baseline ----------------------------
    var nullRes = calcPeakShavingImpact(fx.janInput, fx.frozenTariffs, null);
    t.assertFalse('Null bess: bessEnabled false', nullRes.bessEnabled);
    t.assert('Null bess: billAfter = baseline',
             nullRes.baselineBill, nullRes.billAfterPeakShavingYear1, TOL);
    t.assert('Null bess: verifiable saving 0',
             0, nullRes.verifiableSavingYear1, 0.01);

    // -- Zero capacity -> no-op ------------------------------------------
    var zeroBess = Object.assign({}, fx.bess, { capacityKwh: 0 });
    var zeroRes = calcPeakShavingImpact(fx.janInput, fx.frozenTariffs, zeroBess);
    t.assertFalse('Zero capacity: bessEnabled false', zeroRes.bessEnabled);
    t.assert('Zero capacity: total saving 0',
             0, zeroRes.totalSavingYear1, 0.01);

    // -- Invalid SoC window throws ---------------------------------------
    t.assertThrows('maxSocPct <= minSocPct throws', function () {
      calcPeakShavingImpact(fx.janInput, fx.frozenTariffs,
        Object.assign({}, fx.bess, { minSocPct: 0.9, maxSocPct: 0.1 }));
    });

    // -- Out-of-range rtePct throws --------------------------------------
    t.assertThrows('rtePct > 1 throws', function () {
      calcPeakShavingImpact(fx.janInput, fx.frozenTariffs,
        Object.assign({}, fx.bess, { rtePct: 1.5 }));
    });

    // -- Missing puntaWindowHours throws ---------------------------------
    t.assertThrows('puntaWindowHours <= 0 throws', function () {
      calcPeakShavingImpact(fx.janInput, fx.frozenTariffs,
        Object.assign({}, fx.bess, { puntaWindowHours: 0 }));
    });
  }
});
