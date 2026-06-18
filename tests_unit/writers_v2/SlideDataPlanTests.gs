// =============================================================================
// ARGIA TESTS -- SLIDE_DATA rebuild (chunk 1: API_OUTPUT projection)
//   tests_unit/writers_v2/SlideDataPlanTests.gs (pure)
//   + REG_SLIDE_DATA_CULLIGAN (live, workbook-dependent)
// =============================================================================

registerTest({
  id: 'UNIT_SLIDE_DATA_PLAN',
  group: 'unit', module: 'writers_v2/slide_data',
  scenarios: [], tags: ['writers', 'slide_data', 'rebuild'],
  source: 'tests_unit/writers_v2/SlideDataPlanTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/slide_data: projection plan');

    var plan = buildSlideDataPlan();
    t.assert('43 contract keys', 43, plan.rows.length);
    t.assert('api + config + derived = total', 43,
             plan.apiCount + plan.configCount + plan.derivedCount);

    // the four ConsistencyGuard keys must be 'api' on their exact T2 mappings
    var byKey = {};
    plan.rows.forEach(function (r) { byKey[r.key] = r; });
    t.assert('annual_energy_cost -> cfe_bill_sin_pv_mxn', 'cfe_bill_sin_pv_mxn', byKey['annual_energy_cost'].apiKey);
    t.assert('annual_savings -> pv_only_savings_year1_mxn', 'pv_only_savings_year1_mxn', byKey['annual_savings'].apiKey);
    t.assert('capex_total -> offer_price_mxn', 'offer_price_mxn', byKey['capex_total'].apiKey);
    t.assert('system_kwp -> system_kwp_dc', 'system_kwp_dc', byKey['system_kwp'].apiKey);
    ['annual_energy_cost', 'annual_savings', 'capex_total', 'system_kwp'].forEach(function (k) {
      t.assertTrue(k + ' flagged guard', plan.guardKeys.indexOf(k) >= 0);
    });
    t.assert('exactly 4 guard keys', 4, plan.guardKeys.length);

    // every api row has an apiKey; no config/derived row does
    plan.rows.forEach(function (r) {
      if (r.type === 'api') t.assertTrue(r.key + ' api has apiKey', !!r.apiKey);
      else t.assertFalse(r.key + ' non-api has no apiKey', !!r.apiKey);
    });

    // robust label-anchored formula
    var f = _slideApiFormula('foo_bar');
    t.assertContains('formula uses INDEX', f, 'INDEX(');
    t.assertContains('formula uses MATCH', f, 'MATCH(');
    t.assertContains('formula targets API_OUTPUT', f, 'API_OUTPUT');
    t.assertContains('formula carries the key', f, 'foo_bar');
  }
});
