// =============================================================================
// ARGIA TESTS -- tests_unit/templates/RfqRegistryTests.gs
// -----------------------------------------------------------------------------
// CHUNK 6 \u2014 Unit tests for RFQ_REGISTRY structural invariants.
//
// COVERAGE
//   - 6 entries (matches the plan: PANELES, INVERSORES, ESTRUCTURA,
//     ELECTRICO, MONITOREO, BESS)
//   - All entries have the required fields
//   - All sheetKey values resolve through V2_SHEETS to an _v2 name
//   - All codes are unique (drives RFQ Number generation, can't collide)
//   - getRfqByKey works for valid + invalid inputs
//   - listRfqV2Sheets returns exactly the 6 RFQ sheet names
//   - BOM range integrity: BESS battery row (80) goes to BESS RFQ, not
//     ELECTRICO. BESS electrical rows (81-90) go to ELECTRICO, not BESS.
//     This is the chunk-6 architectural split.
//
// CHUNK TAG: 'chunk6'
// =============================================================================


// =============================================================================
// TEST 1 \u2014 Six entries, all with required fields
// =============================================================================
registerTest({
  id      : 'UNIT_RFQ_REGISTRY_SHAPE',
  group   : 'unit',
  module  : 'templates/rfqRegistry',
  scenarios: [],
  tags    : ['templates', 'rfq', 'registry', 'v2', 'chunk6'],
  source  : 'tests_unit/templates/RfqRegistryTests.gs',
  fn: function (t) {
    t.suite('RFQ_REGISTRY: 6 entries, all fields present');

    t.assert('exactly 6 entries', 6, RFQ_REGISTRY.length);

    var requiredFields = ['key', 'sheetKey', 'title', 'code',
                          'bomRanges', 'defaultCcy', 'certReqs', 'techNotes'];
    for (var i = 0; i < RFQ_REGISTRY.length; i++) {
      var e = RFQ_REGISTRY[i];
      for (var f = 0; f < requiredFields.length; f++) {
        var field = requiredFields[f];
        t.assertTrue(
          'entry ' + i + ' (' + e.key + ') has field "' + field + '"',
          (field in e) && e[field] !== null && e[field] !== undefined
        );
      }
    }
  }
});


// =============================================================================
// TEST 2 \u2014 Plan compliance: all 6 expected keys present
// =============================================================================
registerTest({
  id      : 'UNIT_RFQ_REGISTRY_KEYS',
  group   : 'unit',
  module  : 'templates/rfqRegistry',
  scenarios: [],
  tags    : ['templates', 'rfq', 'registry', 'v2', 'chunk6'],
  source  : 'tests_unit/templates/RfqRegistryTests.gs',
  fn: function (t) {
    t.suite('RFQ_REGISTRY: contains the 6 expected category keys');

    var expectedKeys = ['PANELES', 'INVERSORES', 'ESTRUCTURA',
                        'ELECTRICO', 'MONITOREO', 'BESS'];
    for (var i = 0; i < expectedKeys.length; i++) {
      var found = false;
      for (var j = 0; j < RFQ_REGISTRY.length; j++) {
        if (RFQ_REGISTRY[j].key === expectedKeys[i]) { found = true; break; }
      }
      t.assertTrue('registry includes key ' + expectedKeys[i], found);
    }
  }
});


// =============================================================================
// TEST 3 \u2014 RFQ codes are unique (no two RFQs share a code)
// =============================================================================
registerTest({
  id      : 'UNIT_RFQ_REGISTRY_CODES_UNIQUE',
  group   : 'unit',
  module  : 'templates/rfqRegistry',
  scenarios: [],
  tags    : ['templates', 'rfq', 'registry', 'v2', 'chunk6'],
  source  : 'tests_unit/templates/RfqRegistryTests.gs',
  fn: function (t) {
    t.suite('RFQ_REGISTRY: all codes are unique');

    var seen = {};
    for (var i = 0; i < RFQ_REGISTRY.length; i++) {
      var code = RFQ_REGISTRY[i].code;
      t.assertFalse('code "' + code + '" not duplicated', !!seen[code]);
      seen[code] = true;
    }
  }
});


// =============================================================================
// TEST 4 \u2014 All sheetKey values resolve via V2_SHEETS to a string ending _v2
// =============================================================================
registerTest({
  id      : 'UNIT_RFQ_REGISTRY_SHEETKEY_RESOLUTION',
  group   : 'unit',
  module  : 'templates/rfqRegistry',
  scenarios: [],
  tags    : ['templates', 'rfq', 'registry', 'v2', 'chunk6'],
  source  : 'tests_unit/templates/RfqRegistryTests.gs',
  fn: function (t) {
    t.suite('RFQ_REGISTRY: every sheetKey is registered in V2_SHEETS');

    for (var i = 0; i < RFQ_REGISTRY.length; i++) {
      var e = RFQ_REGISTRY[i];
      var resolved = V2_SHEETS[e.sheetKey];
      t.assertTrue(
        'sheetKey ' + e.sheetKey + ' is present in V2_SHEETS',
        typeof resolved === 'string' && resolved.length > 0
      );
      t.assertContains(
        'V2_SHEETS[' + e.sheetKey + '] ends with _v2',
        resolved,
        '_v2'
      );
    }
  }
});


// =============================================================================
// TEST 5 \u2014 BESS split: battery row (80) and commissioning (91) in BESS RFQ,
//              NOT in ELECTRICO. Electrical BOS rows (81-90) in ELECTRICO,
//              NOT in BESS. This is the chunk-6 architectural decision.
// =============================================================================
registerTest({
  id      : 'UNIT_RFQ_REGISTRY_BESS_SPLIT',
  group   : 'unit',
  module  : 'templates/rfqRegistry',
  scenarios: [],
  tags    : ['templates', 'rfq', 'registry', 'v2', 'chunk6'],
  source  : 'tests_unit/templates/RfqRegistryTests.gs',
  fn: function (t) {
    t.suite('RFQ_REGISTRY: BESS row split between BESS and ELECTRICO RFQs');

    function rangeContainsRow(ranges, row) {
      for (var i = 0; i < ranges.length; i++) {
        if (row >= ranges[i].from && row <= ranges[i].to) return true;
      }
      return false;
    }

    var bess = getRfqByKey('BESS');
    var elec = getRfqByKey('ELECTRICO');

    t.assertTrue('BESS entry exists',      bess !== null);
    t.assertTrue('ELECTRICO entry exists', elec !== null);

    // Battery line (row 80) -> BESS, NOT ELECTRICO
    t.assertTrue ('row 80 (battery) in BESS',
                  rangeContainsRow(bess.bomRanges, 80));
    t.assertFalse('row 80 (battery) NOT in ELECTRICO',
                  rangeContainsRow(elec.bomRanges, 80));

    // Commissioning (row 91) -> BESS, NOT ELECTRICO
    t.assertTrue ('row 91 (commissioning) in BESS',
                  rangeContainsRow(bess.bomRanges, 91));
    t.assertFalse('row 91 (commissioning) NOT in ELECTRICO',
                  rangeContainsRow(elec.bomRanges, 91));

    // BESS electrical BOS rows (81-90) -> ELECTRICO, NOT BESS
    var bosRowsInElec = 0;
    var bosRowsInBess = 0;
    for (var r = 81; r <= 90; r++) {
      if (rangeContainsRow(elec.bomRanges, r)) bosRowsInElec++;
      if (rangeContainsRow(bess.bomRanges, r)) bosRowsInBess++;
    }
    t.assert('all 10 BESS-BOS rows in ELECTRICO', 10, bosRowsInElec);
    t.assert('zero BESS-BOS rows in BESS',         0, bosRowsInBess);
  }
});


// =============================================================================
// TEST 6 \u2014 getRfqByKey: hit, miss, null safety
// =============================================================================
registerTest({
  id      : 'UNIT_RFQ_REGISTRY_GET_BY_KEY',
  group   : 'unit',
  module  : 'templates/rfqRegistry',
  scenarios: [],
  tags    : ['templates', 'rfq', 'registry', 'v2', 'chunk6'],
  source  : 'tests_unit/templates/RfqRegistryTests.gs',
  fn: function (t) {
    t.suite('getRfqByKey: lookup behavior');

    var pan = getRfqByKey('PANELES');
    t.assertTrue('PANELES found', pan !== null);
    t.assert    ('PANELES code',  'PAN', pan.code);

    t.assertTrue('NONEXISTENT returns null',  getRfqByKey('NONEXISTENT') === null);
    t.assertTrue('null key returns null',      getRfqByKey(null) === null);
    t.assertTrue('undefined key returns null', getRfqByKey(undefined) === null);
    t.assertTrue('empty string returns null',  getRfqByKey('') === null);
  }
});


// =============================================================================
// TEST 7 \u2014 listRfqV2Sheets returns all 6 sheet names, _v2-suffixed
// =============================================================================
registerTest({
  id      : 'UNIT_RFQ_REGISTRY_LIST_SHEETS',
  group   : 'unit',
  module  : 'templates/rfqRegistry',
  scenarios: [],
  tags    : ['templates', 'rfq', 'registry', 'v2', 'chunk6'],
  source  : 'tests_unit/templates/RfqRegistryTests.gs',
  fn: function (t) {
    t.suite('listRfqV2Sheets: all 6 sheet names, _v2 suffix');

    var sheets = listRfqV2Sheets();
    t.assert('6 sheet names returned', 6, sheets.length);

    for (var i = 0; i < sheets.length; i++) {
      t.assertContains('sheet ' + i + ' has _v2 suffix', sheets[i], '_v2');
      t.assertContains('sheet ' + i + ' starts with RFQ_', sheets[i], 'RFQ_');
    }
  }
});


// =============================================================================
// TEST 8 \u2014 All bomRanges are well-formed (from <= to, both positive ints)
// =============================================================================
registerTest({
  id      : 'UNIT_RFQ_REGISTRY_RANGES_WELL_FORMED',
  group   : 'unit',
  module  : 'templates/rfqRegistry',
  scenarios: [],
  tags    : ['templates', 'rfq', 'registry', 'v2', 'chunk6'],
  source  : 'tests_unit/templates/RfqRegistryTests.gs',
  fn: function (t) {
    t.suite('RFQ_REGISTRY: bomRanges are well-formed');

    for (var i = 0; i < RFQ_REGISTRY.length; i++) {
      var e = RFQ_REGISTRY[i];
      t.assertTrue(e.key + ': bomRanges is array', Array.isArray(e.bomRanges));
      t.assertTrue(e.key + ': bomRanges non-empty', e.bomRanges.length > 0);

      for (var r = 0; r < e.bomRanges.length; r++) {
        var rng = e.bomRanges[r];
        t.assertTrue(e.key + ' rng ' + r + ': from is positive int',
                     Number.isInteger(rng.from) && rng.from > 0);
        t.assertTrue(e.key + ' rng ' + r + ': to is positive int',
                     Number.isInteger(rng.to) && rng.to > 0);
        t.assertTrue(e.key + ' rng ' + r + ': from <= to',
                     rng.from <= rng.to);
      }
    }
  }
});
