// =============================================================================
// ARGIA TESTS -- tests_unit/writers_v2/ApiOutputV2Tests.gs
// -----------------------------------------------------------------------------
// T2 (v4.35.0): lock the API_OUTPUT field spec and the pure builder.
//
// PURE unit tests (no workbook). They exercise API_OUTPUT_FIELDS and
// buildApiOutputRows (writers_v2/WriteApiOutputV2.js).
//
// COVERAGE (4 tests):
//   1. UNIT_API_OUTPUT_KEYSET        -- exact canonical key set, no dupes, every
//                                       field carries units + source provenance
//   2. UNIT_API_OUTPUT_BUILDER       -- builder maps every source -> row value;
//                                       missing source -> null (full key set kept)
//   3. UNIT_API_OUTPUT_BOTH_BASES    -- cost vs sell CAPEX, and PV-only vs full-
//                                       system savings, are DISTINCT keys (anti-fork)
//   4. UNIT_API_OUTPUT_OFFER_FIELDS  -- every T2-enumerated offer field is present
// =============================================================================


// Expected canonical key set (the offer contract). Changing this is a
// deliberate interface change -- update the test WITH the field spec.
var _API_EXPECTED_KEYS = [
  'project_name', 'client_name',
  'system_kwp_dc', 'system_kwac', 'module_model', 'module_qty',
  'modules_per_string', 'inverter_qty',
  'annual_generation_mwh', 'interconnection_mode',
  'cfe_bill_sin_pv_mxn', 'cfe_bill_con_pv_mxn', 'cfe_bill_con_bess_mxn',
  'pv_only_savings_year1_mxn', 'full_system_savings_year1_mxn', 'savings_term_mxn',
  'capex_cost_mxn', 'offer_price_mxn',
  'payback_years', 'npv_mxn', 'irr', 'roi_pct_term', 'lcoe_mxn_per_kwh',
  'co2_tons_year1', 'co2_tons_term',
  'project_status'
];


registerTest({
  id      : 'UNIT_API_OUTPUT_KEYSET',
  group   : 'unit',
  module  : 'writers_v2/api_output',
  scenarios: [],
  tags    : ['writers_v2', 'api_output', 't2'],
  source  : 'tests_unit/writers_v2/ApiOutputV2Tests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT writers_v2/api_output: canonical key set');

    var keys = API_OUTPUT_FIELDS.map(function (f) { return f.key; });

    t.assert('field count matches expected', _API_EXPECTED_KEYS.length, keys.length);

    // Exact set match (order-independent), and no duplicates.
    var seen = {};
    keys.forEach(function (k) { seen[k] = (seen[k] || 0) + 1; });
    var dupes = keys.filter(function (k) { return seen[k] > 1; });
    t.assert('no duplicate keys', 0, dupes.length);

    _API_EXPECTED_KEYS.forEach(function (k) {
      t.assertTrue('expected key present: ' + k, keys.indexOf(k) !== -1);
    });

    // Every field has provenance: a `from` binding and a non-empty source ref.
    API_OUTPUT_FIELDS.forEach(function (f) {
      t.assertTrue(f.key + ': has source ref', typeof f.src === 'string' && f.src.length > 0);
      t.assertTrue(f.key + ': has source binding', typeof f.from === 'string' && f.from.length > 0);
    });
  }
});


registerTest({
  id      : 'UNIT_API_OUTPUT_BUILDER',
  group   : 'unit',
  module  : 'writers_v2/api_output',
  scenarios: [],
  tags    : ['writers_v2', 'api_output', 't2'],
  source  : 'tests_unit/writers_v2/ApiOutputV2Tests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT writers_v2/api_output: pure builder');

    // Fully-populated mock sources (one value per field `from`).
    var sources = {};
    API_OUTPUT_FIELDS.forEach(function (f, i) { sources[f.from] = 'V' + i; });
    // Override a few with realistic types.
    sources.systemKwpDc = 864;
    sources.cfeBillSinPvMxn = 12838765.45;
    sources.capexCostMxn = 37051893;
    sources.offerPriceMxn = 43590463;

    var rows = buildApiOutputRows(sources);
    t.assert('one row per field', API_OUTPUT_FIELDS.length, rows.length);

    // Row order matches field order; values come from sources.
    for (var i = 0; i < API_OUTPUT_FIELDS.length; i++) {
      t.assert('row ' + i + ' key', API_OUTPUT_FIELDS[i].key, rows[i].key);
      t.assert('row ' + i + ' value from source',
               sources[API_OUTPUT_FIELDS[i].from], rows[i].value);
      t.assert('row ' + i + ' units', API_OUTPUT_FIELDS[i].units, rows[i].units);
    }

    // Missing source -> null, full key set preserved (partial run safety).
    var partial = buildApiOutputRows({ cfeBillSinPvMxn: 12838765.45 });
    t.assert('partial: still full key set', API_OUTPUT_FIELDS.length, partial.length);
    var sinPvRow = partial.filter(function (r) { return r.key === 'cfe_bill_sin_pv_mxn'; })[0];
    var npvRow   = partial.filter(function (r) { return r.key === 'npv_mxn'; })[0];
    t.assertNear('partial: present value kept', 12838765.45, sinPvRow.value, 0.001);
    t.assert('partial: missing value -> null', null, npvRow.value);

    // Empty sources -> all null, no throw.
    var empty = buildApiOutputRows({});
    t.assert('empty: full key set', API_OUTPUT_FIELDS.length, empty.length);
    t.assert('empty: first value null', null, empty[0].value);
  }
});


registerTest({
  id      : 'UNIT_API_OUTPUT_BOTH_BASES',
  group   : 'unit',
  module  : 'writers_v2/api_output',
  scenarios: [],
  tags    : ['writers_v2', 'api_output', 'anti-fork', 't2'],
  source  : 'tests_unit/writers_v2/ApiOutputV2Tests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT writers_v2/api_output: dual bases are distinct (anti-fork)');

    var keys = API_OUTPUT_FIELDS.map(function (f) { return f.key; });

    // CAPEX cost vs offer (sell) price are separate keys -- never one ambiguous
    // "capex". Savings PV-only vs full-system likewise.
    t.assertTrue('capex_cost_mxn present',  keys.indexOf('capex_cost_mxn') !== -1);
    t.assertTrue('offer_price_mxn present', keys.indexOf('offer_price_mxn') !== -1);
    t.assertTrue('pv_only savings present',     keys.indexOf('pv_only_savings_year1_mxn') !== -1);
    t.assertTrue('full_system savings present', keys.indexOf('full_system_savings_year1_mxn') !== -1);

    // The builder keeps them independent: distinct cost vs sell values survive.
    var rows = buildApiOutputRows({ capexCostMxn: 37051893, offerPriceMxn: 43590463 });
    var cost = rows.filter(function (r) { return r.key === 'capex_cost_mxn'; })[0].value;
    var sell = rows.filter(function (r) { return r.key === 'offer_price_mxn'; })[0].value;
    t.assert('cost basis preserved', 37051893, cost);
    t.assert('sell basis preserved', 43590463, sell);
    t.assertTrue('cost != sell (margin)', cost !== sell);
  }
});


registerTest({
  id      : 'UNIT_API_OUTPUT_OFFER_FIELDS',
  group   : 'unit',
  module  : 'writers_v2/api_output',
  scenarios: [],
  tags    : ['writers_v2', 'api_output', 't2'],
  source  : 'tests_unit/writers_v2/ApiOutputV2Tests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT writers_v2/api_output: every T2 offer field has a key');

    // The T2 spec enumeration, mapped to API_OUTPUT keys. This is the
    // "every offer-consumed field has an API_OUTPUT key" assertion.
    var offerNeeds = {
      'project name':         'project_name',
      'system size kWp':      'system_kwp_dc',
      'system size kWac':     'system_kwac',
      'modules':              'module_qty',
      'strings':              'modules_per_string',
      'annual generation':    'annual_generation_mwh',
      'CAPEX':                'capex_cost_mxn',
      'CFE bill sin PV':      'cfe_bill_sin_pv_mxn',
      'CFE bill con PV':      'cfe_bill_con_pv_mxn',
      'savings':              'full_system_savings_year1_mxn',
      'payback':              'payback_years',
      'NPV':                  'npv_mxn',
      'IRR':                  'irr',
      'LCOE':                 'lcoe_mxn_per_kwh',
      'CO2':                  'co2_tons_year1',
      'interconnection mode': 'interconnection_mode',
      'PROJECT_STATUS':       'project_status'
    };
    var keys = API_OUTPUT_FIELDS.map(function (f) { return f.key; });
    Object.keys(offerNeeds).forEach(function (need) {
      t.assertTrue('offer field "' + need + '" -> key ' + offerNeeds[need],
                   keys.indexOf(offerNeeds[need]) !== -1);
    });
  }
});
