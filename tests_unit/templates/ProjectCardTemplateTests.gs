// =============================================================================
// ARGIA TESTS -- tests_unit/templates/ProjectCardTemplateTests.gs
// -----------------------------------------------------------------------------
// CHUNK 3 — setupProjectCardTemplate unit tests.
//
// COVERAGE
//   - Calling setupProjectCardTemplate creates the PROJECT_CARD_v2 sheet
//   - All 9 cost-row labels land at the rows defined by PC_ROW (including
//     the new "Almacenamiento (BESS)" row)
//   - Section header bands land at the rows defined by PC_ROW
//   - Right-pane Additional Info labels (incl new "Storage" row) appear
//     at fixed PC_ROW addresses
//   - Idempotency: running the template twice produces the same final
//     content (no duplicated labels, no shifted rows)
//
// MOCK SHEET
//   Same write-capture pattern as WriteMdcV2Tests and WriteProjectCardV2Tests.
//   The mock tracks setValue calls indexed by (row, col) so assertions can
//   look up "what label landed at row X col Y" after running the template.
//
// CHUNK TAG
//   All tests tagged 'chunk3'.
// =============================================================================


function _makeTplMockSpreadsheet() {
  var writes = [];
  var sheetInserted = false;
  var clearCount = 0;

  function makeRange(row, col, numRows, numCols) {
    var isMulti = (numRows > 1) || (numCols > 1);
    var key = 'R' + row + 'C' + col +
              (isMulti ? ':R' + (row + numRows - 1) + 'C' + (col + numCols - 1) : '');
    var proxy = {
      _row: row, _col: col, _key: key,
      setValue: function(v) {
        writes.push({ type:'value', row:row, col:col, range:key, value:v });
        return proxy;
      },
      setFormula: function(v) {
        writes.push({ type:'formula', row:row, col:col, range:key, value:v });
        return proxy;
      },
      setNote: function(v) {
        writes.push({ type:'note', row:row, col:col, range:key, value:v });
        return proxy;
      },
      setBackground: function() { return proxy; },
      setFontFamily: function() { return proxy; },
      setFontSize:   function() { return proxy; },
      setFontWeight: function() { return proxy; },
      setFontColor:  function() { return proxy; },
      setFontStyle:  function() { return proxy; },
      setHorizontalAlignment: function() { return proxy; },
      setVerticalAlignment:   function() { return proxy; },
      setNumberFormat: function() { return proxy; },
      setBorder: function() { return proxy; },
      merge: function() { return proxy; },
      breakApart: function() { return proxy; },
      setWrap: function() { return proxy; }
    };
    return proxy;
  }

  var sheet = {
    _writes: writes,
    _clearCount: function() { return clearCount; },
    getRange: function(row, col, numRows, numCols) {
      return makeRange(row, col, numRows || 1, numCols || 1);
    },
    setRowHeight: function() {},
    setColumnWidth: function() {},
    setHiddenGridlines: function() {},
    setFrozenRows: function() {},
    setFrozenColumns: function() {},
    clear: function() { clearCount++; },
    clearConditionalFormatRules: function() {},
    setConditionalFormatRules: function() {},
    getConditionalFormatRules: function() { return []; },
    getLastRow: function() { return 100; }
  };

  return {
    _sheet: sheet,
    _sheetInserted: function() { return sheetInserted; },
    getSheetByName: function(name) {
      // Pretend sheet exists if it has been "inserted" already
      return sheetInserted ? sheet : null;
    },
    insertSheet: function(name) {
      sheetInserted = true;
      return sheet;
    }
  };
}


function _findWriteWithValue(writes, value) {
  for (var i = 0; i < writes.length; i++) {
    if (writes[i].type === 'value' && writes[i].value === value) {
      return writes[i];
    }
  }
  return null;
}


function _writeAtTpl(writes, row, col) {
  for (var i = writes.length - 1; i >= 0; i--) {
    var w = writes[i];
    if (w.type === 'value' && w.row === row && w.col === col) return w.value;
  }
  return null;
}


// =============================================================================
// TEST T1 — Template creates the sheet on first call
// =============================================================================
registerTest({
  id      : 'UNIT_TEMPLATES_PC_CREATES_SHEET',
  group   : 'unit',
  module  : 'templates/pc',
  scenarios: [],
  tags    : ['templates', 'pc', 'v2', 'chunk3'],
  source  : 'tests_unit/templates/ProjectCardTemplateTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT templates/pc: creates PROJECT_CARD_v2 sheet on first call');

    var ss = _makeTplMockSpreadsheet();
    t.assertFalse('sheet does not exist before setup', ss._sheetInserted());

    setupProjectCardTemplate(ss);

    t.assertTrue('sheet inserted after setup', ss._sheetInserted());
    t.assertTrue('at least one write happened (template populated cells)',
      ss._sheet._writes.length > 0);
  }
});


// =============================================================================
// TEST T2 — All 9 cost-row labels appear at the rows defined by PC_ROW
//           (including the NEW Almacenamiento (BESS) row)
// =============================================================================
registerTest({
  id      : 'UNIT_TEMPLATES_PC_9_COST_LABELS',
  group   : 'unit',
  module  : 'templates/pc',
  scenarios: [],
  tags    : ['templates', 'pc', 'v2', 'chunk3'],
  source  : 'tests_unit/templates/ProjectCardTemplateTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT templates/pc: 9 cost-row labels at expected rows');

    var ss = _makeTplMockSpreadsheet();
    setupProjectCardTemplate(ss);
    var w = ss._sheet._writes;

    var expected = [
      [PC_ROW.COST_PANELS,     'Solar panels'],
      [PC_ROW.COST_INVERTERS,  'Inverters'],
      [PC_ROW.COST_STRUCTURE,  'Structure'],
      [PC_ROW.COST_ELEC_DC,    'Electric DC'],
      [PC_ROW.COST_ELEC_AC,    'Electric AC'],
      [PC_ROW.COST_MONITORING, 'Monitoring'],
      [PC_ROW.COST_PERMITS,    'Permits & others'],
      [PC_ROW.COST_INSTALL,    'Installation'],
      [PC_ROW.COST_BESS,       'Almacenamiento (BESS)']    // Chunk 3 addition
    ];

    expected.forEach(function(pair) {
      var actual = _writeAtTpl(w, pair[0], PC_COL.LABEL_L);
      t.assert('row ' + pair[0] + ' col B = "' + pair[1] + '"', pair[1], actual);
    });

    // Also verify the TOTAL row has the right label below the BESS row
    t.assert('row ' + PC_ROW.COST_TOTAL + ' col B = "TOTAL"', 'TOTAL',
      _writeAtTpl(w, PC_ROW.COST_TOTAL, PC_COL.LABEL_L));
  }
});


// =============================================================================
// TEST T3 — All 6 Additional Info labels appear (including new "Storage")
// =============================================================================
registerTest({
  id      : 'UNIT_TEMPLATES_PC_INFO_LABELS',
  group   : 'unit',
  module  : 'templates/pc',
  scenarios: [],
  tags    : ['templates', 'pc', 'v2', 'chunk3'],
  source  : 'tests_unit/templates/ProjectCardTemplateTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT templates/pc: Additional Info labels incl new Storage row');

    var ss = _makeTplMockSpreadsheet();
    setupProjectCardTemplate(ss);
    var w = ss._sheet._writes;

    var expected = [
      [PC_ROW.INFO_POWER_PEAK,     'Power peak'],
      [PC_ROW.INFO_COVERAGE,       'System coverage'],
      [PC_ROW.INFO_INSTALL_TYPE,   'Installation type'],
      [PC_ROW.INFO_SELLING_PRICE,  'Selling price'],
      [PC_ROW.INFO_COST,           'Cost'],
      [PC_ROW.INFO_STORAGE,        'Storage']                // Chunk 3 addition
    ];

    expected.forEach(function(pair) {
      t.assert('row ' + pair[0] + ' col G = "' + pair[1] + '"',
        pair[1], _writeAtTpl(w, pair[0], PC_COL.LABEL_R));
    });
  }
});


// =============================================================================
// TEST T4 — Section header bands land at the rows defined by PC_ROW
// =============================================================================
registerTest({
  id      : 'UNIT_TEMPLATES_PC_SECTION_HEADERS',
  group   : 'unit',
  module  : 'templates/pc',
  scenarios: [],
  tags    : ['templates', 'pc', 'v2', 'chunk3'],
  source  : 'tests_unit/templates/ProjectCardTemplateTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT templates/pc: section header bands at fixed rows');

    var ss = _makeTplMockSpreadsheet();
    setupProjectCardTemplate(ss);
    var w = ss._sheet._writes;

    t.assert('TITLE row col B = "PROJECT CARD"', 'PROJECT CARD',
      _writeAtTpl(w, PC_ROW.TITLE, PC_COL.LABEL_L));
    t.assert('BUSINESS CASE header at correct row', 'BUSINESS CASE',
      _writeAtTpl(w, PC_ROW.SEC_BUSINESS_HEADER, PC_COL.LABEL_L));
    t.assert('PROJECT TEAM header at correct row', 'PROJECT TEAM',
      _writeAtTpl(w, PC_ROW.SEC_TEAM_HEADER, PC_COL.LABEL_L));
    t.assert('SCOPE OF WORK header at correct row', 'SCOPE OF WORK',
      _writeAtTpl(w, PC_ROW.SEC_SCOPE_HEADER, PC_COL.LABEL_L));
    t.assert('ADDITIONAL INFORMATION header (right pane)', 'ADDITIONAL INFORMATION',
      _writeAtTpl(w, PC_ROW.SEC_SCOPE_HEADER, PC_COL.LABEL_R));
    t.assert('SCHEDULE header at correct row', 'SCHEDULE',
      _writeAtTpl(w, PC_ROW.SEC_SCHEDULE_HEADER, PC_COL.LABEL_L));
    t.assert('COST COMPARISON header at correct row', 'COST COMPARISON',
      _writeAtTpl(w, PC_ROW.SEC_COST_HEADER, PC_COL.LABEL_L));
    t.assert('MANDATORY DOCUMENTATION header at correct row', 'MANDATORY DOCUMENTATION',
      _writeAtTpl(w, PC_ROW.SEC_DOCS_HEADER, PC_COL.LABEL_L));
    t.assert('RISKS MANAGEMENT header at correct row', 'RISKS MANAGEMENT:',
      _writeAtTpl(w, PC_ROW.SEC_RISKS_HEADER, PC_COL.LABEL_L));
    t.assert('COMMENTS header at correct row', 'COMMENTS:',
      _writeAtTpl(w, PC_ROW.SEC_COMMENTS_HEADER, PC_COL.LABEL_L));
  }
});


// =============================================================================
// TEST T5 — Idempotency: second call clears the existing sheet and re-renders
//           (clear() fires only when sheet already exists; first call inserts)
// =============================================================================
registerTest({
  id      : 'UNIT_TEMPLATES_PC_IDEMPOTENT',
  group   : 'unit',
  module  : 'templates/pc',
  scenarios: [],
  tags    : ['templates', 'pc', 'v2', 'chunk3'],
  source  : 'tests_unit/templates/ProjectCardTemplateTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT templates/pc: idempotent — second call clears + re-renders');

    var ss = _makeTplMockSpreadsheet();
    setupProjectCardTemplate(ss);
    var writesFirstRun = ss._sheet._writes.length;
    var clearsAfter1   = ss._sheet._clearCount();

    setupProjectCardTemplate(ss);
    var writesSecondRun = ss._sheet._writes.length;
    var clearsAfter2    = ss._sheet._clearCount();

    // First call: sheet didn't exist, template took insertSheet path,
    // so clear() should NOT have fired. Second call: sheet exists,
    // template takes the clear()+re-render path.
    t.assert('clear() did NOT fire on first run (sheet was inserted)', 0, clearsAfter1);
    t.assert('clear() fired exactly once on second run', 1, clearsAfter2);

    // After both runs, label content at the BESS / Storage rows still
    // matches expectations.
    t.assertTrue('second run produced additional writes',
      writesSecondRun > writesFirstRun);
    t.assert('BESS row label still correct after re-render',
      'Almacenamiento (BESS)',
      _writeAtTpl(ss._sheet._writes, PC_ROW.COST_BESS, PC_COL.LABEL_L));
    t.assert('Storage info row label still correct after re-render',
      'Storage',
      _writeAtTpl(ss._sheet._writes, PC_ROW.INFO_STORAGE, PC_COL.LABEL_R));
  }
});


// =============================================================================
// TEST T6 — Custom sheet name via opts.sheetName works (for integration tests)
// =============================================================================
registerTest({
  id      : 'UNIT_TEMPLATES_PC_CUSTOM_SHEET_NAME',
  group   : 'unit',
  module  : 'templates/pc',
  scenarios: [],
  tags    : ['templates', 'pc', 'v2', 'chunk3'],
  source  : 'tests_unit/templates/ProjectCardTemplateTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT templates/pc: opts.sheetName redirects to scratch sheet');

    var customName = '_PC_v2_TEST_xyz';
    var captured = { passedName: null };
    var ss = {
      getSheetByName: function(name) {
        captured.passedName = name;
        return null;
      },
      insertSheet: function(name) {
        captured.passedName = name;
        // Return a minimal mock sheet so the template setup completes
        var noop = {
          getRange: function() {
            var p = {
              setValue: function() { return p; },
              setFormula: function() { return p; },
              setBackground: function() { return p; },
              setFontFamily: function() { return p; },
              setFontSize:   function() { return p; },
              setFontWeight: function() { return p; },
              setFontColor:  function() { return p; },
              setFontStyle:  function() { return p; },
              setHorizontalAlignment: function() { return p; },
              setVerticalAlignment:   function() { return p; },
              setNumberFormat: function() { return p; },
              setBorder: function() { return p; },
              merge: function() { return p; },
              breakApart: function() { return p; },
              setWrap: function() { return p; },
              setNote: function() { return p; }
            };
            return p;
          },
          setRowHeight: function() {},
          setColumnWidth: function() {},
          setHiddenGridlines: function() {},
          setFrozenRows: function() {},
          setFrozenColumns: function() {},
          clear: function() {},
          clearConditionalFormatRules: function() {},
          setConditionalFormatRules: function() {},
          getConditionalFormatRules: function() { return []; }
        };
        return noop;
      }
    };
    setupProjectCardTemplate(ss, { sheetName: customName });
    t.assert('insertSheet received the custom name', customName, captured.passedName);
  }
});
