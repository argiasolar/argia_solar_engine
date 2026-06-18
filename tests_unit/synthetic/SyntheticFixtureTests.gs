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

    // SYNTH_500: BESS OFF -> installBattery NO + no strategy + structural.bessOff
    t.assert('SYNTH_500 installBattery NO', 'NO', SYNTHETIC_FIXTURES.SYNTH_500.inputs.installBattery);
    t.assertFalse('SYNTH_500 has no bessStrategy',
      SYNTHETIC_FIXTURES.SYNTH_500.inputs.hasOwnProperty('bessStrategy'));
    t.assertTrue('SYNTH_500 structural.bessOff', SYNTHETIC_FIXTURES.SYNTH_500.structural.bessOff === true);
    t.assertTrue('SYNTH_500 emittable', SYNTHETIC_FIXTURES.SYNTH_500.structural.offerEmittableExpected === true);

    // SYNTH_600: BESS ON (PEAK_SHAVING), not off
    t.assert('SYNTH_600 strategy', 'PEAK_SHAVING', SYNTHETIC_FIXTURES.SYNTH_600.inputs.bessStrategy);
    t.assertFalse('SYNTH_600 not bessOff', SYNTHETIC_FIXTURES.SYNTH_600.structural.bessOff);

    // SYNTH_650: T12-c -- omitting `structure` does NOT yield SIN COTIZAR (the
    // capture proved RT37 prices the structure), so 650 is a third EMITTABLE
    // fixture. The structure_cost==0 -> BLOCKED rule stays covered in isolation
    // by StructureCostTests / StatusRulesTests / ProjectStatusTests.
    t.assert('SYNTH_650 strategy', 'LOAD_SHIFTING', SYNTHETIC_FIXTURES.SYNTH_650.inputs.bessStrategy);
    t.assertTrue('SYNTH_650 structurePresent', SYNTHETIC_FIXTURES.SYNTH_650.structural.structurePresent === true);
    t.assertTrue('SYNTH_650 emittable',
      SYNTHETIC_FIXTURES.SYNTH_650.structural.offerEmittableExpected === true);
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

registerTest({
  id: 'UNIT_SYNTHETIC_GOLDENS_WELLFORMED',
  group: 'unit', module: 'synthetic/goldens',
  scenarios: [], tags: ['synthetic', 't12', 'goldens'],
  source: 'tests_unit/synthetic/SyntheticFixtureTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT synthetic/goldens: locked goldens registry is well-formed');
    ['SYNTH_500', 'SYNTH_600', 'SYNTH_650'].forEach(function (id) {
      var g = SYNTHETIC_FIXTURES[id].goldens;
      t.assertTrue(id + ' has goldens', !!g);
      t.assertTrue(id + ' goldens.exact present', g && g.exact && Object.keys(g.exact).length >= 6);
      t.assertTrue(id + ' goldens.positive present', g && g.positive && g.positive.length >= 1);
      // identity + size goldens must exist (the lockable structural facts)
      ['api.system_kwp_dc', 'api.system_kwac', 'api.module_qty', 'api.inverter_qty',
       'api.project_name', 'api.interconnection_mode'].forEach(function (k) {
        t.assertTrue(id + ' golden has ' + k, g.exact[k] !== undefined);
      });
      // project_name golden must equal the fixture id
      t.assert(id + ' golden project_name', id, g.exact['api.project_name']);
    });
    // BESS-off fixture locks BESS subtotal exactly 0; BESS-on fixtures do NOT
    // lock it (deferred economic gap).
    t.assert('SYNTH_500 locks bess subtotal 0', 0, SYNTHETIC_FIXTURES.SYNTH_500.goldens.exact['bom.bess_subtotal_F92']);
    t.assertTrue('SYNTH_600 does not lock bess subtotal',
      SYNTHETIC_FIXTURES.SYNTH_600.goldens.exact['bom.bess_subtotal_F92'] === undefined);
  }
});

registerTest({
  id: 'UNIT_SYNTHETIC_GOLDENS_COMPARE',
  group: 'unit', module: 'synthetic/goldens',
  scenarios: [], tags: ['synthetic', 't12', 'goldens'],
  source: 'tests_unit/synthetic/SyntheticFixtureTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT synthetic/goldens: compareSyntheticGoldens logic');
    var fx = SYNTHETIC_FIXTURES.SYNTH_500;

    // PASS: feed the goldens back as the capture + valid positive totals
    var ok = {};
    Object.keys(fx.goldens.exact).forEach(function (k) { ok[k] = fx.goldens.exact[k]; });
    ok['bom.grand_total_G94'] = 3782633; ok['bom.structure_subtotal_F25'] = 14040;
    t.assert('matching capture -> 0 notes', 0, compareSyntheticGoldens(fx, ok).length);

    // FAIL exact (number): wrong system size
    var bad = {}; Object.keys(ok).forEach(function (k) { bad[k] = ok[k]; });
    bad['api.system_kwp_dc'] = 864;
    t.assertTrue('wrong kWp -> >=1 note', compareSyntheticGoldens(fx, bad).length >= 1);

    // FAIL exact (string): wrong interconnection enum (case-insensitive trim still mismatches)
    var bad2 = {}; Object.keys(ok).forEach(function (k) { bad2[k] = ok[k]; });
    bad2['api.interconnection_mode'] = 'NET_BILLING';
    t.assertTrue('wrong interconnection -> >=1 note', compareSyntheticGoldens(fx, bad2).length >= 1);

    // string compare is trim/case-insensitive: lowercase + spaces still PASS
    var ok2 = {}; Object.keys(ok).forEach(function (k) { ok2[k] = ok[k]; });
    ok2['api.interconnection_mode'] = '  zero_export  ';
    ok2['api.project_name'] = 'synth_500';
    t.assert('case/space-insensitive string match -> 0 notes', 0, compareSyntheticGoldens(fx, ok2).length);

    // FAIL positive: DB-priced total <= 0
    var bad3 = {}; Object.keys(ok).forEach(function (k) { bad3[k] = ok[k]; });
    bad3['bom.structure_subtotal_F25'] = 0;
    t.assertTrue('zero structure subtotal -> >=1 note', compareSyntheticGoldens(fx, bad3).length >= 1);

    // monotonic: scaling 500<600<650 passes; a regression (650 < 600) fails
    var capById = {
      SYNTH_500: { 'api.system_kwp_dc': 499.2, 'bom.grand_total_G94': 3782633, 'bom.structure_subtotal_F25': 14040 },
      SYNTH_600: { 'api.system_kwp_dc': 600.32, 'bom.grand_total_G94': 4546973, 'bom.structure_subtotal_F25': 16884 },
      SYNTH_650: { 'api.system_kwp_dc': 650.24, 'bom.grand_total_G94': 5475491, 'bom.structure_subtotal_F25': 19507.2 }
    };
    t.assert('monotonic scaling -> 0 notes', 0, compareSyntheticGoldensMonotonic(capById).length);
    capById.SYNTH_650['bom.grand_total_G94'] = 100;   // smaller than 600 -> break
    t.assertTrue('non-monotonic -> >=1 note', compareSyntheticGoldensMonotonic(capById).length >= 1);

    // monotonic only fires when all three present (partial run = no false fail)
    t.assert('partial captures -> 0 notes', 0,
      compareSyntheticGoldensMonotonic({ SYNTH_500: capById.SYNTH_500 }).length);
  }
});
