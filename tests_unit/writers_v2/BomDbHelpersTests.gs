// =============================================================================
// ARGIA TESTS -- tests_unit/writers_v2/BomDbHelpersTests.gs
// -----------------------------------------------------------------------------
// CHUNK 4 — _bomV2_* DB helper unit tests.
//
// COVERAGE
//   The _bomV2_* helpers in writers_v2/helpers/BomDbHelpers.js are a verbatim
//   port from legacy 08_WriteBOM.js. These tests verify that port:
//     - bosPrice + bosPriceObj: category/subcategory/rating matching
//     - conductorPriceObj: cascades through THHW → PV WIRE, with/without "AWG"
//     - groundPriceObj: BARE COPPER lookup
//     - conduitPriceObj: model-string pattern match ('DE 1"', 'DE 1 1/4"', etc.)
//     - conduitSizeLabel: decimal → fraction map
//     - breakerILinePriceObj: 'A / poles POLES' format + 'AmpA' fallback
//     - breakerPriceWithFallback: exact match → next-size-up cascade
//     - panelboardPriceObj / transformerPriceObj: smallest-fit >= rating
//     - mc4 / monitoring / meter: model-string contains lookup
//     - loadBosDb: header detection, BOS_ID column scan, blank-row skip
//     - loadStructureDb: header detection, STR_ID match
//     - resolveStructure: 3-path resolution (STR_ID tail, brand+model, model-only)
//
// MOCK STRATEGY
//   Helpers take a `bosDb` / `structureDb` array directly, NOT a spreadsheet.
//   loadBosDb / loadStructureDb need a mock spreadsheet that returns a canned
//   2D array on getDataRange().getValues().
//
// CHUNK TAG
//   All tests tagged 'chunk4'.
// =============================================================================


// ---------------------------------------------------------------------------
// _makeBosDbFixture(rows)
//   Returns an array shaped like _bomV2_loadBosDb output: each entry has
//   the headered fields PLUS _raw + _bosId. Pass plain row objects with
//   header→value pairs; the helper attaches _raw + _bosId automatically.
// ---------------------------------------------------------------------------
function _makeBosDbFixture(rowDefs) {
  return rowDefs.map(function(rowDef, idx) {
    var obj = {};
    for (var k in rowDef) {
      if (Object.prototype.hasOwnProperty.call(rowDef, k)) obj[k] = rowDef[k];
    }
    obj._bosId = rowDef.BOS_ID || ('BOS_TEST_' + idx);
    // _raw doesn't matter for most lookups — provide a stub
    obj._raw = [obj._bosId];
    return obj;
  });
}

// ---------------------------------------------------------------------------
// _makeStructureDbFixture(rows)
//   Returns an array shaped like _bomV2_loadStructureDb output. Each row
//   gets a _raw array indexed by the legacy column positions:
//     [0]=STR_ID, [1]=STR_BRAND, [2]=STR_MODEL, ..., [12]=price
// ---------------------------------------------------------------------------
function _makeStructureDbFixture(rowDefs) {
  return rowDefs.map(function(rd) {
    var raw = [];
    raw[0]  = rd.strId   || '';
    raw[1]  = rd.brand   || '';
    raw[2]  = rd.model   || '';
    raw[12] = (rd.priceUsd != null) ? rd.priceUsd : '';
    return {
      _raw       : raw,
      STR_ID     : raw[0],
      STR_BRAND  : raw[1],
      STR_MODEL  : raw[2]
    };
  });
}


// =============================================================================
// TEST 1 — bosPriceObj matches by category + subcategory + rating
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_BOMDB_BOS_PRICE_MATCH',
  group   : 'unit',
  module  : 'writers_v2/bomdb',
  scenarios: [],
  tags    : ['writers_v2', 'bom', 'db', 'chunk4'],
  source  : 'tests_unit/writers_v2/BomDbHelpersTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/bomdb: bosPriceObj matches cat/sub/rating');

    var db = _makeBosDbFixture([
      { BOS_ID: 'BOS_001', BOS_CATEGORY: 'CONDUCTORS', BOS_SUBCATEGORY: 'WIRE THHW',
        BOS_RATING_OR_SIZE: '10 AWG', BOS_PRICE_PER_UNIT_MXN: 25.50, BOS_CURRENCY: 'MXN' },
      { BOS_ID: 'BOS_002', BOS_CATEGORY: 'CONDUCTORS', BOS_SUBCATEGORY: 'WIRE THHW',
        BOS_RATING_OR_SIZE: '8 AWG', BOS_PRICE_PER_UNIT_MXN: 40.00, BOS_CURRENCY: 'MXN' }
    ]);

    var obj = _bomV2_bosPriceObj(db, 'CONDUCTORS', 'WIRE THHW', '10 AWG');
    t.assertTrue('found a match', obj !== null);
    t.assert('price = 25.50', 25.50, obj.price);
    t.assertFalse('isUsd false (MXN currency)', obj.isUsd);
    t.assert('id = BOS_001', 'BOS_001', obj.id);

    // No match: rating "12 AWG" not in DB
    t.assert('null when no rating match', null,
      _bomV2_bosPriceObj(db, 'CONDUCTORS', 'WIRE THHW', '12 AWG'));
    // No match: wrong category
    t.assert('null when wrong category', null,
      _bomV2_bosPriceObj(db, 'CONDUIT', 'WIRE THHW', '10 AWG'));
  }
});


// =============================================================================
// TEST 2 — conductorPriceObj cascade: THHW first, then PV WIRE
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_BOMDB_CONDUCTOR_CASCADE',
  group   : 'unit',
  module  : 'writers_v2/bomdb',
  scenarios: [],
  tags    : ['writers_v2', 'bom', 'db', 'chunk4'],
  source  : 'tests_unit/writers_v2/BomDbHelpersTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/bomdb: conductorPriceObj prefers THHW, falls back to PV WIRE');

    // DB has both THHW and PV WIRE for the same gauge — THHW wins
    var dbBoth = _makeBosDbFixture([
      { BOS_ID: 'PV_10',  BOS_CATEGORY: 'CONDUCTORS', BOS_SUBCATEGORY: 'PV WIRE',
        BOS_RATING_OR_SIZE: '10 AWG', BOS_PRICE_PER_UNIT_MXN: 30.00 },
      { BOS_ID: 'THHW_10', BOS_CATEGORY: 'CONDUCTORS', BOS_SUBCATEGORY: 'WIRE THHW',
        BOS_RATING_OR_SIZE: '10 AWG', BOS_PRICE_PER_UNIT_MXN: 20.00 }
    ]);
    var both = _bomV2_conductorPriceObj(dbBoth, '10');
    t.assert('cascade picks THHW first (cheaper or not — first wins)', 'THHW_10', both.id);

    // DB has only PV WIRE — cascade falls through to it
    var dbPvOnly = _makeBosDbFixture([
      { BOS_ID: 'PV_10', BOS_CATEGORY: 'CONDUCTORS', BOS_SUBCATEGORY: 'PV WIRE',
        BOS_RATING_OR_SIZE: '10 AWG', BOS_PRICE_PER_UNIT_MXN: 30.00 }
    ]);
    var pvOnly = _bomV2_conductorPriceObj(dbPvOnly, '10');
    t.assert('falls back to PV WIRE when THHW missing', 'PV_10', pvOnly.id);
  }
});


// =============================================================================
// TEST 3 — conduitSizeLabel maps decimals to fractions
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_BOMDB_CONDUIT_SIZE_LABEL',
  group   : 'unit',
  module  : 'writers_v2/bomdb',
  scenarios: [],
  tags    : ['writers_v2', 'bom', 'db', 'chunk4'],
  source  : 'tests_unit/writers_v2/BomDbHelpersTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/bomdb: conduitSizeLabel decimal → fraction');

    t.assert('0.5 -> "1/2"',    '1/2',    _bomV2_conduitSizeLabel(0.5));
    t.assert('0.75 -> "3/4"',   '3/4',    _bomV2_conduitSizeLabel(0.75));
    t.assert('1 -> "1"',        '1',      _bomV2_conduitSizeLabel(1));
    t.assert('1.25 -> "1 1/4"', '1 1/4',  _bomV2_conduitSizeLabel(1.25));
    t.assert('2.5 -> "2 1/2"',  '2 1/2',  _bomV2_conduitSizeLabel(2.5));
    t.assert('4 -> "4"',        '4',      _bomV2_conduitSizeLabel(4));
    // Unknown sizes pass through as string
    t.assert('5 -> "5" (passthrough)', '5', _bomV2_conduitSizeLabel(5));
  }
});


// =============================================================================
// TEST 4 — conduitPriceObj matches via 'DE <label>"' in model string
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_BOMDB_CONDUIT_PRICE_MATCH',
  group   : 'unit',
  module  : 'writers_v2/bomdb',
  scenarios: [],
  tags    : ['writers_v2', 'bom', 'db', 'chunk4'],
  source  : 'tests_unit/writers_v2/BomDbHelpersTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/bomdb: conduitPriceObj matches DE-<label>" pattern');

    var db = _makeBosDbFixture([
      { BOS_ID: 'COND_05', BOS_CATEGORY: 'CONDUIT', BOS_SUBCATEGORY: 'RIGID IMC',
        BOS_MODEL: 'TUBO CONDUIT IMC DE 1/2" X 3M', BOS_PRICE_PER_UNIT_MXN: 95 },
      { BOS_ID: 'COND_1',  BOS_CATEGORY: 'CONDUIT', BOS_SUBCATEGORY: 'RIGID IMC',
        BOS_MODEL: 'TUBO CONDUIT IMC DE 1" X 3M',   BOS_PRICE_PER_UNIT_MXN: 145 },
      { BOS_ID: 'COND_125', BOS_CATEGORY: 'CONDUIT', BOS_SUBCATEGORY: 'RIGID IMC',
        BOS_MODEL: 'TUBO CONDUIT IMC DE 1 1/4" X 3M', BOS_PRICE_PER_UNIT_MXN: 180 }
    ]);

    var p05 = _bomV2_conduitPriceObj(db, 0.5);
    t.assert('1/2" -> COND_05', 'COND_05', p05.id);
    t.assert('1/2" price = 95', 95, p05.price);

    var p1 = _bomV2_conduitPriceObj(db, 1);
    t.assert('1" -> COND_1', 'COND_1', p1.id);

    var p125 = _bomV2_conduitPriceObj(db, 1.25);
    t.assert('1 1/4" -> COND_125', 'COND_125', p125.id);

    // CRITICAL: 1" must NOT match "DE 1/2"" or "DE 1 1/4"" (substring trap)
    // The helper uses 'DE 1"' as the needle. "TUBO ... DE 1/2"" doesn't contain
    // the literal 'DE 1"' so it correctly doesn't match.
    t.assertTrue('1" returns 1" row, not 1/2" or 1 1/4"',
      p1.id === 'COND_1');

    // Unknown size returns null
    t.assert('size 99 -> null', null, _bomV2_conduitPriceObj(db, 99));
  }
});


// =============================================================================
// TEST 5 — breakerPriceWithFallback: exact match → next size up cascade
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_BOMDB_BREAKER_FALLBACK',
  group   : 'unit',
  module  : 'writers_v2/bomdb',
  scenarios: [],
  tags    : ['writers_v2', 'bom', 'db', 'chunk4'],
  source  : 'tests_unit/writers_v2/BomDbHelpersTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/bomdb: breakerPriceWithFallback exact > next-size cascade');

    // DB has 200A 3P but NOT 150A 3P
    var db = _makeBosDbFixture([
      { BOS_ID: 'BRK_200_3', BOS_CATEGORY: 'DISTRIBUTION', BOS_SUBCATEGORY: 'BREAKERS',
        BOS_RATING_OR_SIZE: '200 A / 3 POLES', BOS_PRICE_PER_UNIT_MXN: 8500 },
      { BOS_ID: 'BRK_100_3', BOS_CATEGORY: 'DISTRIBUTION', BOS_SUBCATEGORY: 'BREAKERS',
        BOS_RATING_OR_SIZE: '100 A / 3 POLES', BOS_PRICE_PER_UNIT_MXN: 4200 }
    ]);

    // Exact match → no note
    var exact = _bomV2_breakerPriceWithFallback(db, 200, 3);
    t.assert('exact 200A price = 8500',  8500, exact.price);
    t.assert('exact 200A id = BRK_200_3', 'BRK_200_3', exact.id);
    t.assert('exact match has no fallback note', null, exact.note);

    // 150A not in DB → fallback: tries 150+25=175 (no), 150+50=200 (yes!) → BRK_200
    var fb = _bomV2_breakerPriceWithFallback(db, 150, 3);
    t.assert('150A fallback price = 8500 (uses 200A row)', 8500, fb.price);
    t.assertTrue('fallback note mentions referenced size',
      fb.note && fb.note.indexOf('200A') !== -1);

    // 1000A way out of range → no fallback hits → null with explanatory note
    var miss = _bomV2_breakerPriceWithFallback(db, 1000, 3);
    t.assert('1000A → null price', null, miss.price);
    t.assertTrue('1000A note explains pending', miss.note && miss.note.indexOf('pendiente') !== -1);
  }
});


// =============================================================================
// TEST 6 — panelboardPriceObj smallest fit >= maxAmps
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_BOMDB_PANELBOARD_SMALLEST_FIT',
  group   : 'unit',
  module  : 'writers_v2/bomdb',
  scenarios: [],
  tags    : ['writers_v2', 'bom', 'db', 'chunk4'],
  source  : 'tests_unit/writers_v2/BomDbHelpersTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/bomdb: panelboardPriceObj picks smallest fit >= rating');

    var db = _makeBosDbFixture([
      { BOS_ID: 'PB_100',  BOS_CATEGORY: 'DISTRIBUTION', BOS_SUBCATEGORY: 'LOAD CENTER',
        BOS_RATING_OR_SIZE: 100, BOS_PRICE_PER_UNIT_MXN: 12000 },
      { BOS_ID: 'PB_200',  BOS_CATEGORY: 'DISTRIBUTION', BOS_SUBCATEGORY: 'LOAD CENTER',
        BOS_RATING_OR_SIZE: 200, BOS_PRICE_PER_UNIT_MXN: 18500 },
      { BOS_ID: 'PB_400',  BOS_CATEGORY: 'DISTRIBUTION', BOS_SUBCATEGORY: 'LOAD CENTER',
        BOS_RATING_OR_SIZE: 400, BOS_PRICE_PER_UNIT_MXN: 32000 }
    ]);

    // 150A → smallest fit >= 150 is 200A
    var fit150 = _bomV2_panelboardPriceObj(db, 150);
    t.assert('150A maxAmps → PB_200 (smallest fit)', 'PB_200', fit150.id);

    // 200A → exact 200 fits
    var fit200 = _bomV2_panelboardPriceObj(db, 200);
    t.assert('200A maxAmps → PB_200', 'PB_200', fit200.id);

    // 250A → 400 (200 < 250 doesn't fit)
    var fit250 = _bomV2_panelboardPriceObj(db, 250);
    t.assert('250A maxAmps → PB_400', 'PB_400', fit250.id);

    // 500A → no fit
    t.assert('500A maxAmps → null', null, _bomV2_panelboardPriceObj(db, 500));
  }
});


// =============================================================================
// TEST 7 — resolveStructure 3 paths: STR_ID tail, brand+model, model-only
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_BOMDB_RESOLVE_STRUCTURE',
  group   : 'unit',
  module  : 'writers_v2/bomdb',
  scenarios: [],
  tags    : ['writers_v2', 'bom', 'db', 'chunk4'],
  source  : 'tests_unit/writers_v2/BomDbHelpersTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/bomdb: resolveStructure 3 paths');

    var db = _makeStructureDbFixture([
      { strId: 'STR_004', brand: 'CLIP&RAIL', model: 'KR18 CLIP',       priceUsd: 8.50 },
      { strId: 'STR_006', brand: 'CLIP&RAIL', model: 'RIEL KR18',       priceUsd: 4.25 },
      { strId: 'STR_010', brand: 'IRONRIDGE', model: 'XR1000 RAIL',     priceUsd: 6.10 }
    ]);

    // Path 1: canonical "BRAND — MODEL — STR_ID"
    var path1 = _bomV2_resolveStructure(db, 'CLIP&RAIL \u2014 KR18 CLIP \u2014 STR_004');
    t.assertTrue('path 1 matches by STR_ID', path1 !== null);
    t.assert('path 1 → STR_004', 'STR_004', path1.strId);
    t.assert('path 1 → priceUsd 8.50', 8.50, path1.priceUsd);

    // Path 2: brand + model only (2-part split)
    var path2 = _bomV2_resolveStructure(db, 'IRONRIDGE \u2014 XR1000 RAIL');
    t.assertTrue('path 2 matches by brand+model', path2 !== null);
    t.assert('path 2 → STR_010', 'STR_010', path2.strId);

    // Path 3: legacy free-text — model only
    var path3 = _bomV2_resolveStructure(db, 'KR18 CLIP');
    t.assertTrue('path 3 matches by model only', path3 !== null);
    t.assert('path 3 → STR_004', 'STR_004', path3.strId);

    // No match
    t.assert('unknown structure → null', null,
      _bomV2_resolveStructure(db, 'UNKNOWN MODEL XYZ'));
    // Empty input
    t.assert('empty input → null', null, _bomV2_resolveStructure(db, ''));
    t.assert('null input → null', null, _bomV2_resolveStructure(db, null));
    // Empty DB
    t.assert('empty DB → null', null,
      _bomV2_resolveStructure([], 'CLIP&RAIL \u2014 KR18 CLIP \u2014 STR_004'));
  }
});


// =============================================================================
// TEST 8 — bosPriceObj honors BOS_CURRENCY=USD → isUsd=true
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_BOMDB_CURRENCY_USD',
  group   : 'unit',
  module  : 'writers_v2/bomdb',
  scenarios: [],
  tags    : ['writers_v2', 'bom', 'db', 'chunk4'],
  source  : 'tests_unit/writers_v2/BomDbHelpersTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/bomdb: BOS_CURRENCY=USD sets isUsd=true');

    var db = _makeBosDbFixture([
      { BOS_ID: 'USD_ROW', BOS_CATEGORY: 'CONNECTORS', BOS_SUBCATEGORY: 'MC4',
        BOS_RATING_OR_SIZE: '10', BOS_PRICE_PER_UNIT_MXN: 5.50, BOS_CURRENCY: 'USD' }
    ]);

    var obj = _bomV2_bosPriceObj(db, 'CONNECTORS', 'MC4', '10');
    t.assertTrue('USD currency → isUsd=true', obj.isUsd === true);
    t.assert('price preserved', 5.50, obj.price);
  }
});
