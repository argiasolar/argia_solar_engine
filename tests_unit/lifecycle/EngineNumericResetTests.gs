// =============================================================================
// tests_unit/lifecycle/EngineNumericResetTests.gs
// [4.54.0] Start New Project clean-slate: engine-consumed numeric inputs reset.
// =============================================================================

registerTest({
  id: 'UNIT_ENGINE_NUMERIC_RESET',
  group: 'unit', module: 'lifecycle/numeric_reset',
  scenarios: [], tags: ['lifecycle', 'reset', 'input_map'],
  source: 'tests_unit/lifecycle/EngineNumericResetTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT lifecycle/numeric_reset: reset-value resolution + key set');

    // _inputResetValue: seed > default > blank
    t.assert('seed wins',    2000000, _inputResetValue({ seed: 2000000, default: 0 }));
    t.assert('default next', 0,       _inputResetValue({ default: 0 }));
    t.assert('blank last',   '',      _inputResetValue({}));
    t.assert('seed 0 honored', 0,     _inputResetValue({ seed: 0, default: 5 }));

    // engineNumericResetKeys: non-empty, all in INPUT_MAP, all engine+numeric,
    // and includes the keys that actually leaked in the live capture.
    var keys = engineNumericResetKeys();
    t.assertTrue('reset set non-empty', keys.length > 0);
    keys.forEach(function (k) {
      var m = INPUT_MAP[k];
      t.assertTrue(k + ' is number/percent', m.type === 'number' || m.type === 'percent');
      t.assertTrue(k + ' engine-consumed', m.consumedBy.indexOf('engine') >= 0);
    });
    ['bessCapacityKwh', 'bessPowerKw', 'cfeKwhBase', 'cfeKwhIntermedia'].forEach(function (k) {
      t.assertTrue(k + ' in reset set', keys.indexOf(k) >= 0);
    });
    // Non-numeric / non-engine keys must NOT be in the set.
    t.assertFalse('businessType (dropdown) not in numeric reset', keys.indexOf('businessType') >= 0);
  }
});
