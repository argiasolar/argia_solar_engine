// =============================================================================
// ARGIA TESTS -- tests_unit/templates/LayoutPrimitivesTests.gs
// -----------------------------------------------------------------------------
// CHUNK 0 — Layout primitive unit tests.
//
// COVERAGE
//   Focused on the two NEW primitives added in Chunk 0:
//     - primSubtotalRow (label + value + cream background + top border)
//     - primTotalRow    (label + value + cream background + thick top rule)
//
//   The 3 pre-existing primitives (primDocTitle, primSectionHeader,
//   primBodyRow) are NOT covered here — they were shipped in earlier work
//   and unit-testing them retroactively isn't a Chunk 0 deliverable. They
//   get exercised end-to-end starting in Chunk 1 (MDC_v2).
//
// APPROACH
//   These are pure unit tests. They use a fake-sheet mock that records every
//   Sheet API call into a flat log. The test then asserts:
//     - the right cell ranges were targeted
//     - the value/formula/format set on each cell is correct
//     - tokens were resolved (e.g. BG_SUBTOTAL, FONT_WEIGHT_EMPHASIS)
//     - calling the primitive twice produces the same call log (idempotent)
//
//   Mock approach over a real spreadsheet because:
//     - faster (no sheet creation / cleanup)
//     - deterministic (no carry-over state between test runs)
//     - exact (we can assert on specific API calls, not just on outcomes)
//
// DEPENDENCIES
//   - primSubtotalRow, primTotalRow (02b_LayoutPrimitives.js)
//   - loadDesignTokens, resetDesignTokenCache_ (02a_DesignTokens.js)
//   - createTestContext is provided by the framework
// =============================================================================


// ---------------------------------------------------------------------------
// _makeMockSheet
// ---------------------------------------------------------------------------
//   Returns a mock that satisfies the subset of the Sheet/Range API used by
//   primSubtotalRow and primTotalRow. Every call is recorded into mock._log
//   as an object the test can introspect.
//
//   Range methods are chainable; they all return the same range proxy so
//   the primitive's fluent calls work unchanged.
// ---------------------------------------------------------------------------
function _makeMockSheet() {
  var log = [];

  function makeRange(row, col, numRows, numCols) {
    // Range key: 'R25C6' for a single cell, 'R25C2:R25C7' for a multi-cell range.
    var isMultiCell = (numRows > 1) || (numCols > 1);
    var rangeKey = 'R' + row + 'C' + col;
    if (isMultiCell) {
      rangeKey += ':R' + (row + numRows - 1) + 'C' + (col + numCols - 1);
    }
    var rangeProxy = {
      _rangeKey: rangeKey,
      setValue:           function(v) { log.push({fn:'setValue',           range:rangeKey, args:[v]}); return rangeProxy; },
      setFormula:         function(v) { log.push({fn:'setFormula',         range:rangeKey, args:[v]}); return rangeProxy; },
      setBackground:      function(v) { log.push({fn:'setBackground',      range:rangeKey, args:[v]}); return rangeProxy; },
      setFontFamily:      function(v) { log.push({fn:'setFontFamily',      range:rangeKey, args:[v]}); return rangeProxy; },
      setFontSize:        function(v) { log.push({fn:'setFontSize',        range:rangeKey, args:[v]}); return rangeProxy; },
      setFontWeight:      function(v) { log.push({fn:'setFontWeight',      range:rangeKey, args:[v]}); return rangeProxy; },
      setFontColor:       function(v) { log.push({fn:'setFontColor',       range:rangeKey, args:[v]}); return rangeProxy; },
      setFontStyle:       function(v) { log.push({fn:'setFontStyle',       range:rangeKey, args:[v]}); return rangeProxy; },
      setHorizontalAlignment: function(v) { log.push({fn:'setHorizontalAlignment', range:rangeKey, args:[v]}); return rangeProxy; },
      setVerticalAlignment:   function(v) { log.push({fn:'setVerticalAlignment',   range:rangeKey, args:[v]}); return rangeProxy; },
      setNumberFormat:    function(v) { log.push({fn:'setNumberFormat',    range:rangeKey, args:[v]}); return rangeProxy; },
      setBorder:          function() {
        var argsCopy = Array.prototype.slice.call(arguments);
        log.push({fn:'setBorder', range:rangeKey, args:argsCopy});
        return rangeProxy;
      },
      merge:              function() { log.push({fn:'merge',     range:rangeKey, args:[]}); return rangeProxy; },
      breakApart:         function() { log.push({fn:'breakApart',range:rangeKey, args:[]}); return rangeProxy; }
    };
    return rangeProxy;
  }

  return {
    _log: log,
    getRange: function(row, col, numRows, numCols) {
      return makeRange(row, col, numRows || 1, numCols || 1);
    },
    setRowHeight:        function(r, h) { log.push({fn:'setRowHeight',        args:[r, h]}); },
    setColumnWidth:      function(c, w) { log.push({fn:'setColumnWidth',      args:[c, w]}); },
    setHiddenGridlines:  function(b)    { log.push({fn:'setHiddenGridlines',  args:[b]}); }
  };
}


// Helper: find all log entries with the given fn name.
function _findCalls(log, fnName) {
  return log.filter(function(e) { return e.fn === fnName; });
}


// Helper: find the first log entry matching fn name AND range key.
function _findCall(log, fnName, rangeKey) {
  for (var i = 0; i < log.length; i++) {
    if (log[i].fn === fnName && log[i].range === rangeKey) return log[i];
  }
  return null;
}


// Helper: produce a comparable signature of the call log so two runs can be
// compared for idempotency.
function _signatureOf(log) {
  return JSON.stringify(log);
}


// =============================================================================
// primSubtotalRow tests
// =============================================================================
registerTest({
  id      : 'UNIT_TEMPLATES_PRIM_SUBTOTAL_ROW_BASIC',
  group   : 'unit',
  module  : 'templates/primitives',
  scenarios: [],
  tags    : ['templates', 'primitives', 'subtotal', 'chunk0'],
  source  : 'tests_unit/templates/LayoutPrimitivesTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT templates/primitives: primSubtotalRow basic call shape');

    resetDesignTokenCache_();
    loadDesignTokens(SpreadsheetApp.getActive());

    var sh = _makeMockSheet();
    primSubtotalRow(sh, 25, 'SUBTOTAL PANELES', 142500);

    var log = sh._log;
    t.assertTrue('mock recorded calls', log.length > 0);

    // The label is written to the merged B-E cell (row 25, cols 2..5).
    var labelCall = _findCall(log, 'setValue', 'R25C2:R25C5');
    t.assertTrue('label was set on B-E merged cell', labelCall !== null);
    if (labelCall) {
      t.assert('label text matches', 'SUBTOTAL PANELES', labelCall.args[0]);
    }

    // The value is written to col F (col 6, single cell).
    var valueCall = _findCall(log, 'setValue', 'R25C6');
    t.assertTrue('numeric value was set on col F', valueCall !== null);
    if (valueCall) {
      t.assert('value matches', 142500, valueCall.args[0]);
    }

    // Default number format
    var fmtCall = _findCall(log, 'setNumberFormat', 'R25C6');
    t.assertTrue('number format applied to value cell', fmtCall !== null);
    if (fmtCall) {
      t.assert('default format is #,##0.00', '#,##0.00', fmtCall.args[0]);
    }

    // Background should resolve to the BG_SUBTOTAL token
    var bgCall = _findCall(log, 'setBackground', 'R25C2:R25C7');
    t.assertTrue('background applied to whole row band B-G', bgCall !== null);
    if (bgCall) {
      t.assert('background color resolves to BG_SUBTOTAL token',
        token('BG_SUBTOTAL'), bgCall.args[0]);
    }

    // Font weight should be the emphasis token
    var fwCall = _findCall(log, 'setFontWeight', 'R25C2:R25C7');
    t.assertTrue('font weight applied', fwCall !== null);
    if (fwCall) {
      t.assert('weight resolves to FONT_WEIGHT_EMPHASIS',
        token('FONT_WEIGHT_EMPHASIS'), fwCall.args[0]);
    }

    // Row height set to body row height
    var rhCalls = _findCalls(log, 'setRowHeight');
    t.assertTrue('row height was set', rhCalls.length === 1);
    if (rhCalls.length === 1) {
      t.assert('row arg matches', 25, rhCalls[0].args[0]);
      t.assert('height resolves to ROW_H_BODY',
        tokenNum('ROW_H_BODY'), rhCalls[0].args[1]);
    }

    // Top border applied for visual separation from item rows above
    var borderCall = _findCall(log, 'setBorder', 'R25C2:R25C7');
    t.assertTrue('top border was applied', borderCall !== null);
    if (borderCall) {
      // Signature: (top, left, bottom, right, vert, horiz, color, style)
      // Only top should be true.
      t.assertTrue('top border arg is true', borderCall.args[0] === true);
      t.assertTrue('left border arg is null', borderCall.args[1] === null);
      t.assert('border color resolves to DIVIDER_LINE',
        token('DIVIDER_LINE'), borderCall.args[6]);
    }
  }
});


registerTest({
  id      : 'UNIT_TEMPLATES_PRIM_SUBTOTAL_ROW_FORMULA',
  group   : 'unit',
  module  : 'templates/primitives',
  scenarios: [],
  tags    : ['templates', 'primitives', 'subtotal', 'chunk0'],
  source  : 'tests_unit/templates/LayoutPrimitivesTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT templates/primitives: primSubtotalRow with formula and custom format');

    resetDesignTokenCache_();
    loadDesignTokens(SpreadsheetApp.getActive());

    var sh = _makeMockSheet();
    primSubtotalRow(sh, 17, 'SUBTOTAL INVERSORES', '=SUM(F12:F16)', '#,##0');

    var log = sh._log;

    // Should setFormula, not setValue, when value starts with '='.
    var formulaCall = _findCall(log, 'setFormula', 'R17C6');
    t.assertTrue('setFormula was called on col F', formulaCall !== null);
    if (formulaCall) {
      t.assert('formula text matches', '=SUM(F12:F16)', formulaCall.args[0]);
    }

    var valueCallOnF = _findCall(log, 'setValue', 'R17C6');
    t.assertTrue('setValue was NOT called on col F (formula path)',
      valueCallOnF === null);

    // Custom number format
    var fmtCall = _findCall(log, 'setNumberFormat', 'R17C6');
    t.assertTrue('number format was set', fmtCall !== null);
    if (fmtCall) {
      t.assert('custom format passed through', '#,##0', fmtCall.args[0]);
    }
  }
});


// =============================================================================
// primTotalRow tests
// =============================================================================
registerTest({
  id      : 'UNIT_TEMPLATES_PRIM_TOTAL_ROW_BASIC',
  group   : 'unit',
  module  : 'templates/primitives',
  scenarios: [],
  tags    : ['templates', 'primitives', 'total', 'chunk0'],
  source  : 'tests_unit/templates/LayoutPrimitivesTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT templates/primitives: primTotalRow basic call shape');

    resetDesignTokenCache_();
    loadDesignTokens(SpreadsheetApp.getActive());

    var sh = _makeMockSheet();
    primTotalRow(sh, 61, 'TOTAL', 287450.75);

    var log = sh._log;

    // Label on merged B-E
    var labelCall = _findCall(log, 'setValue', 'R61C2:R61C5');
    t.assertTrue('label set on B-E', labelCall !== null);
    if (labelCall) t.assert('label text', 'TOTAL', labelCall.args[0]);

    // Value on col F
    var valueCall = _findCall(log, 'setValue', 'R61C6');
    t.assertTrue('value set on col F', valueCall !== null);
    if (valueCall) t.assert('value matches', 287450.75, valueCall.args[0]);

    // Font size is larger than body (body + 2)
    var fsCall = _findCall(log, 'setFontSize', 'R61C2:R61C7');
    t.assertTrue('font size applied', fsCall !== null);
    if (fsCall) {
      t.assert('total font size = body + 2',
        tokenNum('FONT_SIZE_BODY') + 2, fsCall.args[0]);
    }

    // Row height = ROW_H_SECTION (taller than body)
    var rhCalls = _findCalls(log, 'setRowHeight');
    if (rhCalls.length === 1) {
      t.assert('row height for total is ROW_H_SECTION (taller than body)',
        tokenNum('ROW_H_SECTION'), rhCalls[0].args[1]);
    }

    // Strong top border (DIVIDER_STRONG + SOLID_THICK)
    var borderCall = _findCall(log, 'setBorder', 'R61C2:R61C7');
    t.assertTrue('strong top border applied', borderCall !== null);
    if (borderCall) {
      t.assertTrue('top arg is true', borderCall.args[0] === true);
      t.assert('color resolves to DIVIDER_STRONG',
        token('DIVIDER_STRONG'), borderCall.args[6]);
      // The 8th arg (index 7) is the BorderStyle. We only check it's truthy
      // because BorderStyle.SOLID_THICK is an opaque enum.
      t.assertTrue('border style was provided',
        borderCall.args[7] !== null && borderCall.args[7] !== undefined);
    }
  }
});


registerTest({
  id      : 'UNIT_TEMPLATES_PRIM_TOTAL_ROW_FORMULA',
  group   : 'unit',
  module  : 'templates/primitives',
  scenarios: [],
  tags    : ['templates', 'primitives', 'total', 'chunk0'],
  source  : 'tests_unit/templates/LayoutPrimitivesTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT templates/primitives: primTotalRow with formula');

    resetDesignTokenCache_();
    loadDesignTokens(SpreadsheetApp.getActive());

    var sh = _makeMockSheet();
    primTotalRow(sh, 61, 'GRAN TOTAL', '=F10+F17+F22+F32+F46+F50+F59');

    var log = sh._log;

    var formulaCall = _findCall(log, 'setFormula', 'R61C6');
    t.assertTrue('setFormula was called on col F', formulaCall !== null);
    if (formulaCall) {
      t.assert('formula text matches',
        '=F10+F17+F22+F32+F46+F50+F59', formulaCall.args[0]);
    }

    var valueOnF = _findCall(log, 'setValue', 'R61C6');
    t.assertTrue('setValue NOT called on col F when formula given',
      valueOnF === null);
  }
});


// =============================================================================
// Idempotency: calling the primitive twice produces the same call log.
// This is the architecturally important property — Reset Outputs (Chunk 12)
// depends on calling setupX(ss) repeatedly and getting the same result.
// =============================================================================
registerTest({
  id      : 'UNIT_TEMPLATES_PRIM_SUBTOTAL_ROW_IDEMPOTENT',
  group   : 'unit',
  module  : 'templates/primitives',
  scenarios: [],
  tags    : ['templates', 'primitives', 'subtotal', 'idempotent', 'chunk0'],
  source  : 'tests_unit/templates/LayoutPrimitivesTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT templates/primitives: primSubtotalRow is idempotent');

    resetDesignTokenCache_();
    loadDesignTokens(SpreadsheetApp.getActive());

    var sh1 = _makeMockSheet();
    primSubtotalRow(sh1, 25, 'SUBTOTAL PANELES', 142500);

    var sh2 = _makeMockSheet();
    primSubtotalRow(sh2, 25, 'SUBTOTAL PANELES', 142500);

    t.assert('two calls with same args produce identical call logs',
      _signatureOf(sh1._log), _signatureOf(sh2._log));
  }
});


registerTest({
  id      : 'UNIT_TEMPLATES_PRIM_TOTAL_ROW_IDEMPOTENT',
  group   : 'unit',
  module  : 'templates/primitives',
  scenarios: [],
  tags    : ['templates', 'primitives', 'total', 'idempotent', 'chunk0'],
  source  : 'tests_unit/templates/LayoutPrimitivesTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT templates/primitives: primTotalRow is idempotent');

    resetDesignTokenCache_();
    loadDesignTokens(SpreadsheetApp.getActive());

    var sh1 = _makeMockSheet();
    primTotalRow(sh1, 61, 'TOTAL', 287450.75);

    var sh2 = _makeMockSheet();
    primTotalRow(sh2, 61, 'TOTAL', 287450.75);

    t.assert('two calls with same args produce identical call logs',
      _signatureOf(sh1._log), _signatureOf(sh2._log));
  }
});
