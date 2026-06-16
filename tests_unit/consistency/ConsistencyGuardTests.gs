// =============================================================================
// ARGIA TESTS -- tests_unit/consistency/ConsistencyGuardTests.gs
// -----------------------------------------------------------------------------
// Unit tests for the PURE core of the cross-tab consistency guard
// (09d_ConsistencyGuard.js -> checkConsistency / formatConsistencyReport).
//
// These run fully headless in scripts/full_selftest.js (no workbook needed),
// so they are GREEN immediately. They prove the DETECTOR works -- including on
// the real fork numbers measured in ARGIA_ENGINE__71_ (the CFE base-bill and
// PV-savings split). The LIVE guard against a real workbook is exercised by
// tests_integration/consistency/ConsistencyLiveTests.gs.
//
// CLASSIFICATION: group=unit. No ss access. Must always pass.
// =============================================================================

registerTest({
  id     : 'UNIT_CONSISTENCY_GUARD_CORE',
  group  : 'unit',
  module : 'unit/consistency_guard',
  scenarios: [],
  tags   : ['unit', 'consistency', 'guard', 'phase-0.3', 'silent-split'],
  source : 'tests_unit/consistency/ConsistencyGuardTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT unit/consistency_guard: checkConsistency pure core');

    // -- 1. All sources agree -> ok, no violations --------------------------
    var agree = checkConsistency([
      { key: 'capex', label: 'CAPEX', tolRel: 0.001, sources: [
        { name: 'BOM',   value: 6007609 },
        { name: 'API',   value: 6007609 },
        { name: 'CLIENT', value: 6007609 }
      ] }
    ]);
    t.assertTrue('agreeing figure is ok', agree.ok);
    t.assert('agreeing: 0 violations', 0, agree.violations.length);
    t.assert('agreeing: 1 checked', 1, agree.checked);

    // -- 2. REAL CFE base-bill fork (13,030,647 vs 12,838,765) -> violation --
    var baseFork = checkConsistency([
      { key: 'cfe_base_sin_pv', label: 'CFE bill — sin PV (annual)', tolRel: 0.005,
        sources: [
          { name: 'BESS_SIMULATION!D12',           value: 13030647.02 },
          { name: 'SLIDE_DATA[annual_energy_cost]', value: 12838765.45 }
        ] }
    ]);
    t.assertFalse('CFE base fork is NOT ok', baseFork.ok);
    t.assert('CFE base fork: 1 violation', 1, baseFork.violations.length);
    t.assert('CFE base fork key', 'cfe_base_sin_pv', baseFork.violations[0].key);
    // delta ~ 191,882 ; relative ~1.47%
    t.assertNear('CFE base fork deltaAbs ~191,882', 191881.57,
                 baseFork.violations[0].deltaAbs, 1.0);
    t.assertNear('CFE base fork deltaRel ~1.47%', 0.01472,
                 baseFork.violations[0].deltaRel, 0.0005);

    // -- 3. REAL PV-savings fork (1,858,895 direct vs 1,667,013 bill-diff) ---
    var savFork = checkConsistency([
      { key: 'pv_savings_annual', label: 'PV energy savings (annual)', tolRel: 0.005,
        sources: [
          { name: 'CFE_SIMULATION!O41 (direct)', value: 1858894.892 },
          { name: 'bill-diff',                   value: 1667013.00 },
          { name: 'SLIDE_DATA[annual_savings]',  value: 1858894.892 }
        ] }
    ]);
    t.assertFalse('PV savings fork is NOT ok', savFork.ok);
    t.assert('PV savings fork: 1 violation', 1, savFork.violations.length);
    // min must be the bill-diff (1,667,013), max the direct (1,858,895)
    t.assertNear('PV savings min = bill-diff', 1667013.00,
                 savFork.violations[0].minVal, 1.0);
    t.assertNear('PV savings max = direct',    1858894.892,
                 savFork.violations[0].maxVal, 1.0);

    // -- 4. Just-inside tolerance -> ok ; just-outside -> violation ----------
    var inside = checkConsistency([
      { key: 'x', label: 'x', tolRel: 0.005, sources: [
        { name: 'a', value: 1000000 }, { name: 'b', value: 1004000 } // 0.40%
      ] }
    ]);
    t.assertTrue('0.40% delta within 0.5% tol is ok', inside.ok);

    var outside = checkConsistency([
      { key: 'x', label: 'x', tolRel: 0.005, sources: [
        { name: 'a', value: 1000000 }, { name: 'b', value: 1006000 } // 0.60%
      ] }
    ]);
    t.assertFalse('0.60% delta outside 0.5% tol is a fork', outside.ok);

    // -- 5. Absolute-tolerance escape hatch ---------------------------------
    var absTol = checkConsistency([
      { key: 'x', label: 'x', tolRel: 0.0, tolAbs: 10, sources: [
        { name: 'a', value: 100 }, { name: 'b', value: 105 } // Δ5 <= 10 abs
      ] }
    ]);
    t.assertTrue('Δ within absolute tolerance is ok', absTol.ok);

    // -- 6. Fewer than 2 readable sources -> skipped, never a violation -----
    var oneSrc = checkConsistency([
      { key: 'x', label: 'x', sources: [ { name: 'a', value: 5 } ] }
    ]);
    t.assertTrue('single-source figure is ok (skipped)', oneSrc.ok);
    t.assert('single-source figure is skipped', 1, oneSrc.skipped);
    t.assert('single-source figure: 0 checked', 0, oneSrc.checked);

    // -- 7. Unreadable (NaN/blank) sources are dropped, not errored ----------
    var withNaN = checkConsistency([
      { key: 'x', label: 'x', tolRel: 0.005, sources: [
        { name: 'a', value: 1000 },
        { name: 'b', value: NaN },         // dropped
        { name: 'c', value: undefined },   // dropped
        { name: 'd', value: 1002 }         // 0.2% vs a -> ok
      ] }
    ]);
    t.assertTrue('NaN/undefined sources dropped, comparison still ok', withNaN.ok);
    t.assert('NaN case still counts as checked', 1, withNaN.checked);

    // -- 8. Report formatting -----------------------------------------------
    t.assertContains('OK report mentions OK',
      formatConsistencyReport(agree), 'CONSISTENCY OK');
    t.assertContains('Fork report names the figure',
      formatConsistencyReport(baseFork), 'CFE bill');
  }
});
