// =============================================================================
// ARGIA TESTS -- tests_unit/engine/OutputValidateTests.gs
// -----------------------------------------------------------------------------
// CHUNK 2 (v3.7.8) — Unit tests for validateOutputConsistency.
//
// CONTEXT
//   09b_OutputValidate.js is the engine's safety net against the bug class
//   where MDC_v2 holds output from one project while BOM_v2 / INSTALLATION_v2
//   / PROJECT_CARD_v2 still hold output from a previous test run. Documented
//   historical trigger: ARGIA_ENGINE__29_ workbook, May 2026, would have
//   produced a ~$170k under-quote if the mismatch had reached a customer.
//
//   The validator has been in production since v2.4.0 but had zero unit
//   tests. This file closes that gap.
//
// SCOPE
//   Pure-function tests using a mock spreadsheet. We control every value
//   the validator reads and assert on its critical/info/ok output.
//
// COVERAGE
//   - All sheets match -> passed=true
//   - Project name mismatch (MDC vs BOM, MDC vs PC) -> critical
//   - Module count mismatch (MDC vs INSTALLATION, MDC vs PC) -> critical
//   - Inverter count mismatch (MDC vs INSTALLATION) -> critical
//   - Empty MDC -> all checks skipped (info, not critical)
//   - Missing sheets -> partial skip (info on that sheet)
//   - _ov_str / _ov_num helpers handle blank, null, formula values
// =============================================================================


// ---------------------------------------------------------------------------
// Mock spreadsheet helper
// ---------------------------------------------------------------------------
//   ss = _ovMakeSs({ MDC_v2: { 'C7': 'CULLIGAN', 'C11': 1350, ... },
//                    BOM_v2: { 'A4': 'BOM -- CULLIGAN | ...' },
//                    ...   })
//   Pass an empty object {} to make a sheet exist with no values.
//   Pass null / omit the key to make the sheet not exist.
// ---------------------------------------------------------------------------
function _ovMakeSs(sheets) {
  function makeSheet(cellMap) {
    return {
      getRange: function(a1) {
        var v = (cellMap && Object.prototype.hasOwnProperty.call(cellMap, a1))
                ? cellMap[a1] : '';
        return { getValue: function() { return v; } };
      }
    };
  }
  return {
    getSheetByName: function(name) {
      if (sheets && Object.prototype.hasOwnProperty.call(sheets, name) && sheets[name] !== null) {
        return makeSheet(sheets[name]);
      }
      return null;
    }
  };
}


// ---------------------------------------------------------------------------
// CASE 1: All sheets agree -> passed=true, no criticals
// ---------------------------------------------------------------------------

registerTest({
  id      : 'UNIT_OUTPUT_VALIDATE_ALL_MATCH',
  group   : 'unit',
  module  : 'engine/output_validate',
  scenarios: [],
  tags    : ['engine', 'output_validate', 'happy_path'],
  source  : 'tests_unit/engine/OutputValidateTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT engine/output_validate: all sheets agree');

    var ss = _ovMakeSs({
      MDC_v2:           { 'C7': 'CULLIGAN', 'C8': 'CULLIGAN TEST', 'C11': 1350, 'C12': 5 },
      BOM_v2:           { 'A4': 'BOM -- CULLIGAN | CULLIGAN TEST | 1350 mod x 640W = 864 kWp' },
      INSTALLATION_v2:  { 'B8': 1350, 'B9': 5 },
      PROJECT_CARD_v2:  { 'C5': 'CULLIGAN',
                          // SCOPE OF WORK row matches: panel label w/ wattage, "1350 pcs"
                          'B14': '640W Mono LR7-72HVHF', 'D14': '1350 pcs' }
    });

    var result = validateOutputConsistency(ss);

    t.assertTrue('result.passed = true', result.passed);
    t.assert('zero criticals', 0, result.critical.length);
    t.assertContains('message says PASS', result.message, 'OUTPUT CONSISTENCY: PASS');
    t.assertTrue('at least one ok was recorded', result.ok.length > 0);
  }
});


// ---------------------------------------------------------------------------
// CASE 2: Project-name mismatch — MDC says CULLIGAN, BOM says TESTPROJ-001
// (this is the historical bug class)
// ---------------------------------------------------------------------------

registerTest({
  id      : 'UNIT_OUTPUT_VALIDATE_PROJECT_NAME_MISMATCH_BOM',
  group   : 'unit',
  module  : 'engine/output_validate',
  scenarios: [],
  tags    : ['engine', 'output_validate', 'mismatch', 'bug_class'],
  source  : 'tests_unit/engine/OutputValidateTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT engine/output_validate: project name MDC vs BOM mismatch');

    var ss = _ovMakeSs({
      MDC_v2:           { 'C7': 'CULLIGAN', 'C8': 'X', 'C11': 1350, 'C12': 5 },
      BOM_v2:           { 'A4': 'BOM -- TESTPROJ-001 | Some Other Client | 720 mod' },
      INSTALLATION_v2:  { 'B8': 1350, 'B9': 5 },
      PROJECT_CARD_v2:  { 'C5': 'CULLIGAN' }
    });

    var result = validateOutputConsistency(ss);

    t.assertFalse('result.passed = false', result.passed);
    t.assertTrue('at least one critical recorded', result.critical.length > 0);
    var msgs = result.critical.join(' | ');
    t.assertContains('critical mentions PROJECT MISMATCH', msgs, 'PROJECT MISMATCH');
    t.assertContains('critical mentions CULLIGAN', msgs, 'CULLIGAN');
    t.assertContains('summary says CRITICAL', result.message, 'CRITICAL MISMATCH');
  }
});


// ---------------------------------------------------------------------------
// CASE 3: Project-name mismatch — MDC vs PROJECT_CARD
// ---------------------------------------------------------------------------

registerTest({
  id      : 'UNIT_OUTPUT_VALIDATE_PROJECT_NAME_MISMATCH_PC',
  group   : 'unit',
  module  : 'engine/output_validate',
  scenarios: [],
  tags    : ['engine', 'output_validate', 'mismatch'],
  source  : 'tests_unit/engine/OutputValidateTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT engine/output_validate: project name MDC vs PROJECT_CARD mismatch');

    var ss = _ovMakeSs({
      MDC_v2:           { 'C7': 'CULLIGAN', 'C11': 1350, 'C12': 5 },
      BOM_v2:           { 'A4': 'BOM -- CULLIGAN | client | rest' },
      INSTALLATION_v2:  { 'B8': 1350, 'B9': 5 },
      PROJECT_CARD_v2:  { 'C5': 'WRONG_PROJ' }
    });

    var result = validateOutputConsistency(ss);

    t.assertFalse('result.passed = false', result.passed);
    var msgs = result.critical.join(' | ');
    t.assertContains('critical mentions PROJECT_CARD', msgs, 'PROJECT_CARD');
    t.assertContains('critical mentions CULLIGAN', msgs, 'CULLIGAN');
    t.assertContains('critical mentions WRONG_PROJ', msgs, 'WRONG_PROJ');
  }
});


// ---------------------------------------------------------------------------
// CASE 4: Module count mismatch — MDC says 1350, INSTALLATION says 720
// ---------------------------------------------------------------------------

registerTest({
  id      : 'UNIT_OUTPUT_VALIDATE_MODULE_COUNT_MISMATCH',
  group   : 'unit',
  module  : 'engine/output_validate',
  scenarios: [],
  tags    : ['engine', 'output_validate', 'mismatch', 'scale'],
  source  : 'tests_unit/engine/OutputValidateTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT engine/output_validate: module count MDC vs INSTALLATION');

    var ss = _ovMakeSs({
      MDC_v2:           { 'C7': 'CULLIGAN', 'C11': 1350, 'C12': 5 },
      BOM_v2:           { 'A4': 'BOM -- CULLIGAN | ...' },
      INSTALLATION_v2:  { 'B8': 720, 'B9': 5 },   // <-- mismatch here
      PROJECT_CARD_v2:  { 'C5': 'CULLIGAN' }
    });

    var result = validateOutputConsistency(ss);

    t.assertFalse('result.passed = false', result.passed);
    var msgs = result.critical.join(' | ');
    t.assertContains('critical mentions MODULE COUNT', msgs, 'MODULE COUNT MISMATCH');
    t.assertContains('mentions 1350', msgs, '1350');
    t.assertContains('mentions 720', msgs, '720');
  }
});


// ---------------------------------------------------------------------------
// CASE 5: Inverter count mismatch — MDC says 5, INSTALLATION says 3
// ---------------------------------------------------------------------------

registerTest({
  id      : 'UNIT_OUTPUT_VALIDATE_INVERTER_COUNT_MISMATCH',
  group   : 'unit',
  module  : 'engine/output_validate',
  scenarios: [],
  tags    : ['engine', 'output_validate', 'mismatch', 'scale'],
  source  : 'tests_unit/engine/OutputValidateTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT engine/output_validate: inverter count MDC vs INSTALLATION');

    var ss = _ovMakeSs({
      MDC_v2:           { 'C7': 'CULLIGAN', 'C11': 1350, 'C12': 5 },
      BOM_v2:           { 'A4': 'BOM -- CULLIGAN | ...' },
      INSTALLATION_v2:  { 'B8': 1350, 'B9': 3 },   // <-- inverter mismatch
      PROJECT_CARD_v2:  { 'C5': 'CULLIGAN' }
    });

    var result = validateOutputConsistency(ss);

    t.assertFalse('result.passed = false', result.passed);
    var msgs = result.critical.join(' | ');
    t.assertContains('critical mentions INVERTER COUNT', msgs, 'INVERTER COUNT MISMATCH');
  }
});


// ---------------------------------------------------------------------------
// CASE 6: MDC empty -> entire check skipped (info, not critical)
// ---------------------------------------------------------------------------

registerTest({
  id      : 'UNIT_OUTPUT_VALIDATE_MDC_NOT_WRITTEN_SKIPS_CHECKS',
  group   : 'unit',
  module  : 'engine/output_validate',
  scenarios: [],
  tags    : ['engine', 'output_validate', 'empty_sheet'],
  source  : 'tests_unit/engine/OutputValidateTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT engine/output_validate: MDC.C7 empty short-circuits');

    var ss = _ovMakeSs({
      MDC_v2:           { 'C7': '', 'C11': '', 'C12': '' },  // not yet written
      BOM_v2:           { 'A4': 'BOM -- SOMETHING' },
      INSTALLATION_v2:  { 'B8': 1350, 'B9': 5 },
      PROJECT_CARD_v2:  { 'C5': 'OTHER' }
    });

    var result = validateOutputConsistency(ss);

    t.assertTrue('result.passed = true (no comparisons run)', result.passed);
    t.assert('zero criticals', 0, result.critical.length);
    t.assertContains('message says skipped', result.message, 'skipped');
  }
});


// ---------------------------------------------------------------------------
// CASE 7: MDC sheet entirely missing -> skip with info, not crash
// ---------------------------------------------------------------------------

registerTest({
  id      : 'UNIT_OUTPUT_VALIDATE_MDC_MISSING_GRACEFUL',
  group   : 'unit',
  module  : 'engine/output_validate',
  scenarios: [],
  tags    : ['engine', 'output_validate', 'missing_sheet'],
  source  : 'tests_unit/engine/OutputValidateTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT engine/output_validate: MDC_v2 sheet absent');

    var ss = _ovMakeSs({
      // MDC_v2 deliberately absent
      BOM_v2:           { 'A4': 'BOM -- CULLIGAN' },
      INSTALLATION_v2:  { 'B8': 1350, 'B9': 5 }
    });

    var result = validateOutputConsistency(ss);

    t.assertTrue('result.passed = true (cannot compare without MDC)', result.passed);
    t.assert('zero criticals', 0, result.critical.length);
    var info = result.info.join(' | ');
    t.assertContains('info mentions MDC_v2 not present', info, 'MDC_v2');
  }
});


// ---------------------------------------------------------------------------
// CASE 8: BOM_v2 missing but MDC present -> only BOM check skipped
// ---------------------------------------------------------------------------

registerTest({
  id      : 'UNIT_OUTPUT_VALIDATE_BOM_MISSING_OTHERS_RUN',
  group   : 'unit',
  module  : 'engine/output_validate',
  scenarios: [],
  tags    : ['engine', 'output_validate', 'missing_sheet'],
  source  : 'tests_unit/engine/OutputValidateTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT engine/output_validate: BOM_v2 absent, others still checked');

    var ss = _ovMakeSs({
      MDC_v2:           { 'C7': 'CULLIGAN', 'C11': 1350, 'C12': 5 },
      // BOM_v2 deliberately absent
      INSTALLATION_v2:  { 'B8': 1350, 'B9': 5 },
      PROJECT_CARD_v2:  { 'C5': 'CULLIGAN' }
    });

    var result = validateOutputConsistency(ss);

    t.assertTrue('result.passed = true (BOM check skipped, others agree)', result.passed);
    var info = result.info.join(' | ');
    t.assertContains('info mentions BOM_v2 not present', info, 'BOM_v2');
    // The MDC <-> PC project-name check should still have run
    var ok = result.ok.join(' | ');
    t.assertContains('PC name check still ran', ok, 'PROJECT_CARD_v2');
  }
});


// ---------------------------------------------------------------------------
// CASE 9: _ov_str / _ov_num helpers — defensive value coercion
// ---------------------------------------------------------------------------

registerTest({
  id      : 'UNIT_OUTPUT_VALIDATE_HELPERS_OV_STR',
  group   : 'unit',
  module  : 'engine/output_validate',
  scenarios: [],
  tags    : ['engine', 'output_validate', 'helpers'],
  source  : 'tests_unit/engine/OutputValidateTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT engine/output_validate: _ov_str helper');

    function mockSh(map) {
      return { getRange: function(a1) {
        return { getValue: function() { return map[a1]; } };
      } };
    }

    t.assert('non-empty string trimmed',    'CULLIGAN', _ov_str(mockSh({A1:'  CULLIGAN  '}), 'A1'));
    t.assert('null -> empty string',         '',        _ov_str(mockSh({A1: null}),           'A1'));
    t.assert('undefined -> empty string',    '',        _ov_str(mockSh({A1: undefined}),      'A1'));
    t.assert('number coerced to string',     '1350',    _ov_str(mockSh({A1: 1350}),           'A1'));
    t.assert('blank string preserved',       '',        _ov_str(mockSh({A1: '   '}),          'A1'));
  }
});


registerTest({
  id      : 'UNIT_OUTPUT_VALIDATE_HELPERS_OV_NUM',
  group   : 'unit',
  module  : 'engine/output_validate',
  scenarios: [],
  tags    : ['engine', 'output_validate', 'helpers'],
  source  : 'tests_unit/engine/OutputValidateTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT engine/output_validate: _ov_num helper');

    function mockSh(map) {
      return { getRange: function(a1) {
        return { getValue: function() { return map[a1]; } };
      } };
    }

    t.assert('integer passes through',  1350,  _ov_num(mockSh({A1:1350}), 'A1'));
    t.assert('float passes through',    3.14,  _ov_num(mockSh({A1:3.14}), 'A1'));
    t.assert('numeric string parsed',   720,   _ov_num(mockSh({A1:'720'}), 'A1'));
    t.assert('blank -> null',           null,  _ov_num(mockSh({A1:''}), 'A1'));
    t.assert('null -> null',            null,  _ov_num(mockSh({A1:null}), 'A1'));
    t.assert('non-numeric -> null',     null,  _ov_num(mockSh({A1:'hello'}), 'A1'));
  }
});
