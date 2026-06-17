// =============================================================================
// ARGIA TESTS -- tests_regression/v2/CrossTabConsistencyTests.gs
// -----------------------------------------------------------------------------
// T3 (v4.37.0): REG_CROSS_TAB_CONSISTENCY -- the registry guard is green on the
// loaded CULLIGAN fixture and actually checks the shared figures (not just
// skipping everything).
//
// Module 'regression/v2/culligan'; runs in the CULLIGAN E2E pass.
// WORKBOOK-DEPENDENT: errors in the headless Node rig (expected/green).
//
// LOCKS:
//   assertCrossTabConsistency(ss).ok == true  (no enforced fork/error/invariant)
//   checked >= 8 shared figures (registry actually resolved consumers)
//   the core figures resolve >=2 numeric sources each (real cross-checks)
// =============================================================================

registerTest({
  id: 'REG_CROSS_TAB_CONSISTENCY',
  group: 'regression',
  module: 'regression/v2/culligan',
  scenarios: [],
  tags: ['regression', 'baseline', 'culligan', 'v2', 'consistency', 't3'],
  source: 'tests_regression/v2/CrossTabConsistencyTests.gs',
  fn: function (t, ctx) {
    t.suite('REG v2/culligan [T3]: registry cross-tab guard green + broad');

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    var mdc = ss.getSheetByName('MDC_v2');
    var projName = mdc ? String(mdc.getRange(7, 3).getValue() || '') : '';
    if (projName.toUpperCase().indexOf('CULLIGAN') < 0) {
      t.info('skipped',
             'Requires CULLIGAN E2E context (fixture + engine + client financials). '
           + 'Current MDC_v2 project: "' + (projName || '(none)') + '".');
      return;
    }

    // Ensure API_OUTPUT / CLIENT_FIN consumers exist (runClientFinancials writes
    // API_OUTPUT). Harmless if already current.
    try { if (typeof runClientFinancials === 'function') runClientFinancials(ss); } catch (e) {}

    var result = assertCrossTabConsistency(ss, { throwOnFork: false });

    // GREEN: no enforced fork / error / invariant violation.
    t.assertTrue('guard ok (no enforced violations)', result.ok);
    if (!result.ok) t.info('report', result.report);

    // BROAD: the registry resolved and actually compared figures.
    t.assertTrue('checked >= 8 figures (real cross-checks, not all skipped)',
                 result.checked >= 8);
    t.info('coverage', 'checked=' + result.checked + ' skipped=' + result.skipped
         + ' knownForks=' + ((result.knownForks || []).length));

    // Each core figure must have >= 2 numeric sources (i.e. a genuine cross-check,
    // not a lone owner). Re-resolve to inspect source counts.
    var readings = resolveRegistryReadings(ss, SHARED_FIGURE_REGISTRY);
    var core = ['cfe_bill_sin_pv', 'cfe_bill_con_pv', 'pv_energy_savings',
                'capex_cost', 'offer_price', 'system_size_kwp'];
    readings.forEach(function (r) {
      if (core.indexOf(r.key) < 0) return;
      var numeric = (r.sources || []).filter(function (s) {
        return typeof s.value === 'number' && isFinite(s.value);
      }).length;
      t.assertTrue(r.key + ': >=2 numeric sources cross-checked', numeric >= 2);
    });
  }
});