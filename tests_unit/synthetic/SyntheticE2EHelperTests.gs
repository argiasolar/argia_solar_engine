// =============================================================================
// tests_unit/synthetic/SyntheticE2EHelperTests.gs
// T12 (chunk b) — pure helpers of the live runner (tripwire + structural compare).
// The runner itself is live-only (SpreadsheetApp); these cover its decision logic.
// =============================================================================

registerTest({
  id: 'UNIT_SYNTHETIC_E2E_HELPERS',
  group: 'unit', module: 'synthetic/e2e',
  scenarios: [], tags: ['synthetic', 't12', 'e2e', 'tripwire'],
  source: 'tests_unit/synthetic/SyntheticE2EHelperTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT synthetic/e2e: flatten + blank/default + structural compare');

    // _synthFlatten
    t.assert('flatten 2D', '1,2,3', _synthFlatten([[1, 2], [3]]).join(','));
    t.assert('flatten scalar', '5', _synthFlatten(5).join(','));

    // _synthIsBlankOrDefault (the prefill tripwire's leak test)
    t.assertTrue('blank is clean',          _synthIsBlankOrDefault('', 0));
    t.assertTrue('null is clean',           _synthIsBlankOrDefault(null, undefined));
    t.assertTrue('equals default is clean', _synthIsBlankOrDefault(0, 0));
    t.assertTrue('640==640 clean',          _synthIsBlankOrDefault(640, 640));
    t.assertFalse('864 over default 0 LEAK', _synthIsBlankOrDefault(864, 0));
    t.assertFalse('value w/ blank default LEAK', _synthIsBlankOrDefault(5, undefined) === true);

    // _synthCompareStructural — SYNTH_650 (blank structure -> BLOCKED) matches
    var ok650 = _synthCompareStructural(SYNTHETIC_FIXTURES.SYNTH_650, {
      'api.project_status': 'BLOCKED', 'bom.structure_subtotal_F25': 0, 'bom.bess_subtotal_F92': 50000
    });
    t.assert('SYNTH_650 matching -> no notes', 0, ok650.length);

    // SYNTH_650 violated: emittable + structure priced -> two notes
    var bad650 = _synthCompareStructural(SYNTHETIC_FIXTURES.SYNTH_650, {
      'api.project_status': 'PASS', 'bom.structure_subtotal_F25': 5000
    });
    t.assertTrue('SYNTH_650 violated -> notes', bad650.length >= 2);

    // SYNTH_500 (BESS OFF, emittable) matches when BESS subtotal 0 + not blocked
    var ok500 = _synthCompareStructural(SYNTHETIC_FIXTURES.SYNTH_500, {
      'api.project_status': 'PASS', 'bom.bess_subtotal_F92': 0
    });
    t.assert('SYNTH_500 matching -> no notes', 0, ok500.length);

    // SYNTH_500 violated: BESS priced though expected off
    var bad500 = _synthCompareStructural(SYNTHETIC_FIXTURES.SYNTH_500, {
      'api.project_status': 'PASS', 'bom.bess_subtotal_F92': 120000
    });
    t.assertTrue('SYNTH_500 BESS-on -> note', bad500.length >= 1);
  }
});
