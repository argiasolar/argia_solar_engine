// =============================================================================
// ARGIA TESTS -- tests_unit/writers_v2/CfeStrategyExplainerTests.gs
// -----------------------------------------------------------------------------
// CHUNK 4 (v3.7.9) — CFE_OUTPUT_v2 "why this strategy" explainer.
//
// _cfeOutV2_strategyExplainer maps a BESS_STRATEGY value to a one-line
// plain-Spanish customer-facing sentence. Pure function.
//
// COVERAGE
//   - Each of the 3 strategies returns a distinct, non-empty explainer
//   - Case/whitespace-insensitive
//   - Unknown/blank returns '' (row gets skipped, no crash)
//   - PEAK_SHAVING mentions punta/demanda; LOAD_SHIFTING mentions arbitraje
//   - SELF_CONSUMPTION explainer honestly notes the PS convergence
// =============================================================================

registerTest({
  id      : 'UNIT_CFE_STRATEGY_EXPLAINER',
  group   : 'unit',
  module  : 'writers_v2/cfe_explainer',
  scenarios: [],
  tags    : ['writers_v2', 'cfe', 'explainer', 'chunk4'],
  source  : 'tests_unit/writers_v2/CfeStrategyExplainerTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT writers_v2/cfe_explainer: strategy explainer text');

    var ps = _cfeOutV2_strategyExplainer('PEAK_SHAVING');
    var sc = _cfeOutV2_strategyExplainer('SELF_CONSUMPTION_MAX');
    var ls = _cfeOutV2_strategyExplainer('LOAD_SHIFTING');

    // Non-empty + distinct
    t.assertTrue('PEAK_SHAVING explainer non-empty', ps.length > 0);
    t.assertTrue('SELF_CONSUMPTION explainer non-empty', sc.length > 0);
    t.assertTrue('LOAD_SHIFTING explainer non-empty', ls.length > 0);
    t.assertTrue('PS and SC explainers differ', ps !== sc);
    t.assertTrue('SC and LS explainers differ', sc !== ls);
    t.assertTrue('PS and LS explainers differ', ps !== ls);

    // Content anchors
    t.assertContains('PEAK_SHAVING mentions recorte de demanda', ps, 'Recorte de demanda');
    t.assertContains('PEAK_SHAVING mentions PUNTA', ps, 'PUNTA');
    t.assertContains('LOAD_SHIFTING mentions arbitraje', ls, 'Arbitraje');
    t.assertContains('LOAD_SHIFTING mentions NET_BILLING', ls, 'NET_BILLING');
    // SC explainer must be honest about the PS convergence
    t.assertContains('SELF_CONSUMPTION notes convergence with peak shaving',
                     sc, 'similar al de recorte de demanda');

    // Case / whitespace insensitivity
    t.assert('lowercase + spaces resolves same as canonical',
             ps, _cfeOutV2_strategyExplainer('  peak_shaving  '));

    // Unknown / blank -> '' (caller skips the row)
    t.assert('unknown returns empty', '', _cfeOutV2_strategyExplainer('FOO'));
    t.assert('blank returns empty', '', _cfeOutV2_strategyExplainer(''));
    t.assert('null returns empty', '', _cfeOutV2_strategyExplainer(null));
  }
});


// =============================================================================
// 4.0.0 — interconnection label + LOAD_SHIFTING warning helpers
// =============================================================================

registerTest({
  id      : 'UNIT_CFE_INTERCONN_LABEL',
  group   : 'unit',
  module  : 'writers_v2/cfe_explainer',
  scenarios: [],
  tags    : ['writers_v2', 'cfe', 'interconnection', 'chunk4'],
  source  : 'tests_unit/writers_v2/CfeStrategyExplainerTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT writers_v2/cfe_explainer: interconnection label never blank');

    t.assertContains('FACTURACION_NETA friendly',
                     _cfeOutV2_interconnLabel('FACTURACION_NETA'), 'FACTURACI');
    t.assertContains('FACTURACION_NETA shows NET_BILLING',
                     _cfeOutV2_interconnLabel('FACTURACION_NETA'), 'NET_BILLING');
    t.assertContains('MEDICION_NETA friendly',
                     _cfeOutV2_interconnLabel('MEDICION_NETA'), 'MEDICI');
    t.assertContains('SIN_EXPORTACION friendly',
                     _cfeOutV2_interconnLabel('SIN_EXPORTACION'), 'ZERO_EXPORT');
    // Never blank
    t.assert('blank -> (no definido)', '(no definido)', _cfeOutV2_interconnLabel(''));
    t.assert('null -> (no definido)',  '(no definido)', _cfeOutV2_interconnLabel(null));
    // Unknown value passes through unmodified (don't hide real data)
    t.assert('unknown passes through', 'WEIRD_VALUE', _cfeOutV2_interconnLabel('WEIRD_VALUE'));
    // Case-insensitive
    t.assertContains('lowercase resolves',
                     _cfeOutV2_interconnLabel('facturacion_neta'), 'FACTURACI');
  }
});


registerTest({
  id      : 'UNIT_CFE_LOAD_SHIFT_WARNING',
  group   : 'unit',
  module  : 'writers_v2/cfe_explainer',
  scenarios: [],
  tags    : ['writers_v2', 'cfe', 'load_shifting', 'warning', 'chunk4'],
  source  : 'tests_unit/writers_v2/CfeStrategyExplainerTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT writers_v2/cfe_explainer: LOAD_SHIFTING interconnection warning');

    // LOAD_SHIFTING + FACTURACION_NETA -> no warning (arbitrage active)
    t.assert('LS + FACTURACION_NETA: no warning', '',
             _cfeOutV2_loadShiftWarning('LOAD_SHIFTING', 'FACTURACION_NETA'));

    // LOAD_SHIFTING + MEDICION_NETA -> loud warning (silent collapse case)
    var w1 = _cfeOutV2_loadShiftWarning('LOAD_SHIFTING', 'MEDICION_NETA');
    t.assertTrue('LS + MEDICION_NETA: warning fires', w1.length > 0);
    t.assertContains('warning mentions FACTURACION_NETA requirement', w1, 'FACTURACI');
    t.assertContains('warning mentions identical to PEAK_SHAVING', w1, 'PEAK_SHAVING');
    t.assertContains('warning points at INPUT_CFE!C41', w1, 'C41');

    // LOAD_SHIFTING + blank interconnection -> warning (this was the bug)
    var w2 = _cfeOutV2_loadShiftWarning('LOAD_SHIFTING', '');
    t.assertTrue('LS + blank: warning fires', w2.length > 0);

    // Other strategies never warn regardless of interconnection
    t.assert('PEAK_SHAVING never warns', '',
             _cfeOutV2_loadShiftWarning('PEAK_SHAVING', 'MEDICION_NETA'));
    t.assert('SELF_CONSUMPTION never warns', '',
             _cfeOutV2_loadShiftWarning('SELF_CONSUMPTION_MAX', ''));

    // Case-insensitive on both args
    t.assert('lowercase LS + facturacion: no warning', '',
             _cfeOutV2_loadShiftWarning('load_shifting', 'facturacion_neta'));
  }
});
