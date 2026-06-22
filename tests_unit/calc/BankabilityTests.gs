// =============================================================================
// ARGIA TESTS -- tests_unit/calc/BankabilityTests.gs
// -----------------------------------------------------------------------------
// AGS conformance track -- Task A4. Locks the FR-207 bankability math
// (31b_CalcBankability.js). PURE -- no workbook.
//
// The headline test reproduces the AGS-207 §6 worked example (417 kWp SLP):
//   P50 717 MWh, d 0.4%/yr, N 10 -> sigma 6.0%, P90(1) 662, guarantee 629,
//   P90(10) 671, P90 yr-10 639, class Good/bankable.
//
// COVERAGE (3 tests):
//   1. UNIT_BANKABILITY_HELPERS    -- RSS, Pxx, IAV/√N, degradation, class bands
//   2. UNIT_BANKABILITY_AGS207_EX  -- the §6 worked example, end to end
//   3. UNIT_BANKABILITY_GUARDS     -- no-P50 -> not evaluated; σ>8% classed REVIEW
// =============================================================================

registerTest({
  id      : 'UNIT_BANKABILITY_HELPERS',
  group   : 'unit',
  module  : 'calc/bankability',
  scenarios: [],
  tags    : ['calc', 'bankability', 'a4', '207'],
  source  : 'tests_unit/calc/BankabilityTests.gs',
  fn      : function (t) {
    t.suite('UNIT calc/bankability: FR-207 helpers');

    // RSS (FR-207-01): √(0.03² + 0.04²) = 0.05.
    t.assertNear('RSS of 3% & 4% = 5%', 0.05,
                 bankabilitySigmaRss({ a: 0.03, b: 0.04 }), 1e-9);

    // Pxx (FR-207-03).
    t.assertNear('P90 = P50(1 - 1.282σ)', 717 * (1 - 1.282 * 0.06),
                 bankabilityPxx(717, AGS_Z.P90, 0.06), 1e-6);

    // IAV / √N (FR-207-04).
    t.assertNear('σ_IAV(10) = 3.5%/√10 = 1.107%', 0.011068,
                 bankabilitySigmaIavN(0.035, 10), 1e-5);

    // Degradation (FR-207-05): 1-based, year 10 -> ^9.
    t.assertNear('100 degraded to yr10 @0.4% = 96.457', 96.45707,
                 bankabilityDegraded(100, 0.004, 10), 1e-3);
    t.assertNear('year 1 = no degradation', 100, bankabilityDegraded(100, 0.004, 1), 1e-9);

    // §5.6 class bands.
    t.assert('σ 3% -> EXCELLENT',  'EXCELLENT',  bankabilityClass(0.03).code);
    t.assert('σ 5% -> GOOD',       'GOOD',       bankabilityClass(0.05).code);
    t.assert('σ 6% -> GOOD (incl)','GOOD',       bankabilityClass(0.06).code);
    t.assert('σ 7% -> ACCEPTABLE', 'ACCEPTABLE', bankabilityClass(0.07).code);
    t.assert('σ 9% -> REVIEW',     'REVIEW',     bankabilityClass(0.09).code);
    t.assertFalse('σ 9% not bankable', bankabilityClass(0.09).bankable);
  }
});


registerTest({
  id      : 'UNIT_BANKABILITY_AGS207_EX',
  group   : 'unit',
  module  : 'calc/bankability',
  scenarios: [],
  tags    : ['calc', 'bankability', 'a4', '207', 'worked_example'],
  source  : 'tests_unit/calc/BankabilityTests.gs',
  fn      : function (t) {
    t.suite('UNIT calc/bankability: AGS-207 §6 worked example (417 kWp SLP)');

    // The §6 "dominant set" (6 components, no transposition/power-rating).
    var EX = { resource: 0.035, iav: 0.035, model: 0.030,
               soiling: 0.010, degradation: 0.005, availability: 0.010 };
    var b = computeBankability(717, { components: EX, degradation: 0.004, tenorYears: 10 });

    t.assertTrue('evaluated', b.evaluated === true);
    t.assertNear('σ_total(1yr) ≈ 6.0%', 0.05979, b.sigma1, 5e-4);
    t.assertNear('P75(1yr) ≈ 688',  688, b.p75,    1.5);
    t.assertNear('P90(1yr) ≈ 662',  662, b.p90_1yr, 1.0);
    t.assertNear('P99(1yr) ≈ 617',  617, b.p99,    1.5);
    t.assertNear('P50-P90 gap ≈ 7.7%', 7.7, b.p50_p90_gapPct, 0.2);
    t.assertNear('σ_total(10yr) ≈ 5.0%', 0.04972, b.sigmaN, 5e-4);
    t.assertNear('P90(10yr avg) ≈ 671', 671, b.p90_Nyr, 1.5);
    t.assertNear('P90 year-10 ≈ 639', 639, b.p90YearN, 1.5);
    t.assertNear('guarantee ≈ 629 (0.95×P90)', 629, b.guaranteeBaseline, 1.0);
    t.assert('class Good/bankable', 'GOOD', b.klass);
    t.assertTrue('bankable true', b.bankable === true);
  }
});


registerTest({
  id      : 'UNIT_BANKABILITY_GUARDS',
  group   : 'unit',
  module  : 'calc/bankability',
  scenarios: [],
  tags    : ['calc', 'bankability', 'a4', '207'],
  source  : 'tests_unit/calc/BankabilityTests.gs',
  fn      : function (t) {
    t.suite('UNIT calc/bankability: guards');

    // No / bad P50 -> not evaluated (never throws, never fabricates).
    [0, -10, null, undefined, NaN].forEach(function (v) {
      t.assertFalse('p50=' + String(v) + ' -> not evaluated', computeBankability(v, {}).evaluated);
    });

    // Default components (AGS §5.1, 8 sources) classify a typical C&I project.
    var def = computeBankability(1000, {});
    t.assertTrue('defaults evaluate', def.evaluated === true);
    t.assert('default sigmaSource cites AGS §5.1', 'AGS-207 §5.1 defaults', def.sigmaSource);

    // A high-uncertainty site -> REVIEW class, but still a value (not a throw).
    var hi = computeBankability(1000, { components: { a: 0.09 } });
    t.assert('σ 9% -> REVIEW', 'REVIEW', hi.klass);
    t.assertFalse('σ 9% not bankable', hi.bankable);
  }
});
