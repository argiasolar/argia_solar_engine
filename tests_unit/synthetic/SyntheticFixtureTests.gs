// =============================================================================
// tests_unit/synthetic/SyntheticFixtureTests.gs
// T12 (chunk a) — pure, Node-checkable validation of the synthetic fixtures.
// Numeric goldens + the live runner are chunk b/c (captured from a real run).
// =============================================================================

registerTest({
  id: 'UNIT_SYNTHETIC_FIXTURES_WELLFORMED',
  group: 'unit', module: 'synthetic/fixtures',
  scenarios: [], tags: ['synthetic', 't12', 'fixtures'],
  source: 'tests_unit/synthetic/SyntheticFixtureTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT synthetic/fixtures: registry is well-formed');

    var ids = Object.keys(SYNTHETIC_FIXTURES);
    t.assert('three fixtures', 3, ids.length);
    ['SYNTH_500', 'SYNTH_600', 'SYNTH_650'].forEach(function (id) {
      t.assertTrue(id + ' present', ids.indexOf(id) >= 0);
      var fx = SYNTHETIC_FIXTURES[id];
      t.assert(id + ' id matches key', id, fx.id);
      t.assertTrue(id + ' has inputs', fx.inputs && Object.keys(fx.inputs).length > 10);
      t.assertTrue(id + ' has structural spec', !!fx.structural);
      // every 12-month range key carries exactly 12 values
      ['cfeKwhBase', 'cfeKwhIntermedia', 'cfeKwhPunta', 'cfeKwBase', 'cfeFpPct', 'cfeDias'].forEach(function (rk) {
        if (fx.inputs[rk] !== undefined) {
          t.assert(id + '.' + rk + ' is 12 months', 12, fx.inputs[rk].length);
        }
      });
    });

    // SYNTH_500: BESS OFF -> strategy NONE + structural.bessOff
    t.assert('SYNTH_500 bessStrategy NONE', 'NONE', SYNTHETIC_FIXTURES.SYNTH_500.inputs.bessStrategy);
    t.assertTrue('SYNTH_500 structural.bessOff', SYNTHETIC_FIXTURES.SYNTH_500.structural.bessOff === true);
    t.assertTrue('SYNTH_500 emittable', SYNTHETIC_FIXTURES.SYNTH_500.structural.offerEmittableExpected === true);

    // SYNTH_600: BESS ON (PEAK_SHAVING), not off
    t.assert('SYNTH_600 strategy', 'PEAK_SHAVING', SYNTHETIC_FIXTURES.SYNTH_600.inputs.bessStrategy);
    t.assertFalse('SYNTH_600 not bessOff', SYNTHETIC_FIXTURES.SYNTH_600.structural.bessOff);

    // SYNTH_650: structure intentionally OMITTED -> SIN COTIZAR -> NOT emittable
    t.assertFalse('SYNTH_650 omits structure key',
      SYNTHETIC_FIXTURES.SYNTH_650.inputs.hasOwnProperty('structure'));
    t.assert('SYNTH_650 strategy', 'LOAD_SHIFTING', SYNTHETIC_FIXTURES.SYNTH_650.inputs.bessStrategy);
    t.assertTrue('SYNTH_650 sinCotizar expected',
      SYNTHETIC_FIXTURES.SYNTH_650.structural.sinCotizarStructureExpected === true);
    t.assertFalse('SYNTH_650 NOT emittable (BLOCKED)',
      SYNTHETIC_FIXTURES.SYNTH_650.structural.offerEmittableExpected);
  }
});

registerTest({
  id: 'UNIT_SYNTHETIC_INPUT_MAP_COMPLETENESS',
  group: 'unit', module: 'synthetic/fixtures',
  scenarios: [], tags: ['synthetic', 't12', 'input_map'],
  source: 'tests_unit/synthetic/SyntheticFixtureTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT synthetic/fixtures: every input routes through INPUT_MAP');
    // This is the plan\'s completeness test: any fixture input with no INPUT_MAP
    // key (i.e. could not be written via writeInput) surfaces here as a FAIL.
    var res = validateSyntheticFixtureKeys();
    if (!res.ok) {
      Object.keys(res.byFixture).forEach(function (fid) {
        if (res.byFixture[fid].length) {
          t.info(fid + ' unmapped keys', res.byFixture[fid].join(', '));
        }
      });
    }
    t.assert('total unmapped fixture keys', 0, res.totalMissing);
    t.assertTrue('all fixture inputs routable via writeInput', res.ok);
  }
});

registerTest({
  id: 'UNIT_SYNTHETIC_PREFILL_KEYS',
  group: 'unit', module: 'synthetic/fixtures',
  scenarios: [], tags: ['synthetic', 't12', 'prefill'],
  source: 'tests_unit/synthetic/SyntheticFixtureTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT synthetic/fixtures: prefill tripwire key set');
    var keys = syntheticPrefillKeys();
    t.assertTrue('prefill key set is non-empty', keys.length > 0);
    var bad = keys.filter(function (k) {
      return !(typeof inputMapHas === 'function' ? inputMapHas(k) : INPUT_MAP.hasOwnProperty(k));
    });
    t.assert('every prefill key is in INPUT_MAP', 0, bad.length);
  }
});
