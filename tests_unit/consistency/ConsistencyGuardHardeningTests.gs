// =============================================================================
// ARGIA TESTS -- tests_unit/consistency/ConsistencyGuardHardeningTests.gs
// -----------------------------------------------------------------------------
// Unit tests for the hardened guard: ERROR-cell detection + INVARIANT (sanity)
// checks. Uses the REAL broken state observed in ARGIA_ENGINE__71_ (2026-06-16):
// SLIDE_DATA[annual_energy_cost]=#VALUE!, savings=-10,999,098, base 1.84M < con-PV
// 12.84M -- which v1 of the guard FALSELY reported as PASS. These prove the
// hardened guard turns that into a hard FAIL.
//
// CLASSIFICATION: group=unit. No ss access. Always green.
// =============================================================================

registerTest({
  id     : 'UNIT_CONSISTENCY_GUARD_HARDENING',
  group  : 'unit',
  module : 'unit/consistency_guard',
  scenarios: [],
  tags   : ['unit', 'consistency', 'guard', 'hardening', 'error-cell', 'invariant'],
  source : 'tests_unit/consistency/ConsistencyGuardHardeningTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT unit/consistency_guard: error-cell + invariant hardening');

    // -- 1. consClassifyCell: number vs error vs blank -----------------------
    t.assert('classify number',  12838765.45, consClassifyCell(12838765.45).value);
    t.assertTrue('classify #VALUE! -> error', !!consClassifyCell('#VALUE!').error);
    t.assertTrue('classify #REF! -> error',   !!consClassifyCell('#REF!').error);
    t.assertTrue('classify #N/A -> error',    !!consClassifyCell('#N/A').error);
    t.assertTrue('classify blank -> no error', consClassifyCell('').error === null);
    t.assertTrue('classify blank -> NaN value', isNaN(consClassifyCell('').value));

    // -- 2. ERROR cell is a hard violation, never silently dropped -----------
    //    (v1 bug: #VALUE! source dropped -> figure skipped -> false PASS.)
    var errRes = checkConsistency([
      { key: 'cfe_base_sin_pv', label: 'CFE bill — sin PV', tolRel: 0.005, sources: [
        { name: 'BESS_SIMULATION!D12', value: 1839667.59 },
        { name: 'SLIDE_DATA[annual_energy_cost]', value: NaN, error: '#VALUE!' }
      ] }
    ]);
    t.assertFalse('error cell makes it NOT ok', errRes.ok);
    t.assert('error cell -> 1 violation', 1, errRes.violations.length);
    t.assert('error violation type', 'error', errRes.violations[0].type);
    t.assertContains('error report names #VALUE!',
      formatConsistencyReport(errRes), '#VALUE!');

    // -- 3. evalInvariants on a HEALTHY bill -> all hold ---------------------
    var good = evalInvariants({ base: 12838765, conPv: 11171752, savings: 1667013 });
    var goodFails = good.filter(function (x) { return !x.ok; });
    t.assert('healthy bill: 0 invariant failures', 0, goodFails.length);
    t.assertTrue('healthy bill: >=3 invariants evaluated', good.length >= 3);

    // -- 4. evalInvariants on the REAL broken bill -> impossible flagged -----
    var bad = evalInvariants({ base: 1839667.59, conPv: 12838765.45, savings: -10999097.86 });
    var badFails = bad.filter(function (x) { return !x.ok; });
    t.assertTrue('broken bill: >=2 invariant failures', badFails.length >= 2);
    function failed(key) { return bad.some(function (x) { return x.key === key && !x.ok; }); }
    t.assertTrue('base < conPv flagged',       failed('INV_BASE_GE_CONPV'));
    t.assertTrue('negative savings flagged',   failed('INV_SAVINGS_NONNEG'));

    // -- 5. invariant skips when an input is missing (NaN) -------------------
    var partial = evalInvariants({ base: NaN, conPv: 11171752, savings: NaN });
    t.assertTrue('only conPv-only invariant evaluated',
      partial.length >= 1 && partial.every(function (x) { return x.key === 'INV_CONPV_NONNEG'; }));

    // -- 6. buildConsistencyReadings propagates error flags ------------------
    var readings = buildConsistencyReadings({
      base:      { name: 'D12',  value: 1839667.59, error: null },
      conPv:     { name: 'O39',  value: 12838765.45, error: null },
      savDirect: { name: 'O41',  value: -10999097.86, error: null },
      slideCost: { name: 'cost', value: NaN, error: '#VALUE!' },
      slideSav:  { name: 'sav',  value: -10999097.86, error: null }
    });
    var baseFig = readings.filter(function (r) { return r.key === 'cfe_base_sin_pv'; })[0];
    var costSrc = baseFig.sources.filter(function (s) { return s.name.indexOf('energy_cost') !== -1; })[0];
    t.assert('error flag propagated to reading source', '#VALUE!', costSrc.error);

    // -- 7. FULL broken-workbook path -> checkConsistency + invariants = FAIL -
    var fullRes = checkConsistency(readings);
    // merge invariants the way the orchestrator does:
    var inv = evalInvariants({ base: 1839667.59, conPv: 12838765.45, savings: -10999097.86 });
    inv.forEach(function (x) { if (!x.ok) fullRes.violations.push({ type: 'invariant', key: x.key, label: x.label, detail: x.detail }); });
    fullRes.ok = fullRes.violations.length === 0;
    t.assertFalse('real broken workbook is NOT ok (was false-PASS in v1)', fullRes.ok);
    t.assertTrue('real broken workbook: error + invariant violations present',
      fullRes.violations.some(function (v) { return v.type === 'error'; }) &&
      fullRes.violations.some(function (v) { return v.type === 'invariant'; }));
  }
});
