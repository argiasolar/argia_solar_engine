// =============================================================================
// ARGIA ENGINE v2 -- File: tests_unit/templates/InstallationTemplateTests.gs
// -----------------------------------------------------------------------------
// CHUNK 5 — Unit tests for templates/setupInstallationTemplate.gs
//
// Per Chunk 5 user choice (match legacy 1:1), the template is beefy: it seeds
// banner, panel headers, driver-key labels, NOTES helper text, dropdowns, and
// palette formatting. The writer only populates values.
//
// COVERAGE
//   T1  — Sheet created on first call; cleared on second (idempotency)
//   T2  — opts.sheetName override
//   T3  — Banner rows 1-3: title at C2, subtitle at C3
//   T4  — Panel headers row 4: 'DRIVER / INPUT' / 'VALUE' / 'NOTES' in A4-C4
//   T5  — Panel headers row 4: 'SUMMARY' in F4, =G9 formula in G4
//   T6  — Driver-key labels in col A rows 5-34 (30 entries, in correct order)
//   T7  — NOTES helper text in col C rows 5-34 (matching legacy strings)
//   T8  — Data validation dropdowns on rows 24-31 col B
//   T9  — Dropdown default values applied (INSTALLATION_TYPE=ROOF, etc)
//   T10 — Percent rows (33,34) have number format '0.00%' and default values
//   T11 — Frozen rows = 3
//   T12 — setHiddenGridlines called
// =============================================================================


// -----------------------------------------------------------------------------
// Mock spreadsheet with setDataValidation tracking
// -----------------------------------------------------------------------------
function _makeInstallTplMockSpreadsheet() {
  var sheetInserted = false;
  var clearCount = 0;
  var hiddenGridlinesCalls = 0;
  var insertedName = null;
  var queriedNames = [];
  var frozenRows = 0;

  // Per-cell store of writes, formats, validations
  var writes = [];

  function makeRange(row, col, numRows, numCols) {
    numRows = numRows || 1;
    numCols = numCols || 1;
    var proxy = {
      _row: row, _col: col, _nRows: numRows, _nCols: numCols,
      setValue: function(v) {
        writes.push({ type: 'value', row: row, col: col, value: v });
        return proxy;
      },
      setValues: function(vs) {
        if (vs && vs.length && vs[0] && vs[0].length) {
          for (var ri = 0; ri < vs.length; ri++) {
            for (var ci = 0; ci < vs[ri].length; ci++) {
              writes.push({ type: 'value', row: row + ri, col: col + ci,
                            value: vs[ri][ci] });
            }
          }
        }
        return proxy;
      },
      setFormula: function(f) {
        writes.push({ type: 'formula', row: row, col: col, value: f });
        return proxy;
      },
      setBackground: function(v) {
        writes.push({ type: 'bg', row: row, col: col, value: v });
        return proxy;
      },
      setFontColor:  function(v) { writes.push({ type: 'fc',  row: row, col: col, value: v }); return proxy; },
      setFontFamily: function()  { return proxy; },
      setFontSize:   function(v) { writes.push({ type: 'fs',  row: row, col: col, value: v }); return proxy; },
      setFontWeight: function(v) { writes.push({ type: 'fw',  row: row, col: col, value: v }); return proxy; },
      setFontStyle:  function(v) { writes.push({ type: 'fst', row: row, col: col, value: v }); return proxy; },
      setHorizontalAlignment: function(v) {
        writes.push({ type: 'halign', row: row, col: col, value: v }); return proxy;
      },
      setVerticalAlignment: function() { return proxy; },
      setNumberFormat: function(v) {
        writes.push({ type: 'numfmt', row: row, col: col, value: v });
        return proxy;
      },
      setBorder: function() { return proxy; },
      setDataValidation: function(rule) {
        writes.push({ type: 'validation', row: row, col: col, value: rule });
        return proxy;
      },
      clearContent: function() { return proxy; },
      clearFormat:  function() { return proxy; },
      merge: function() { return proxy; },
      breakApart: function() { return proxy; },
      setWrap: function() { return proxy; }
    };
    return proxy;
  }

  var sheet = {
    _writes: writes,
    _clearCount: function() { return clearCount; },
    _hiddenGridlinesCalls: function() { return hiddenGridlinesCalls; },
    _frozenRows: function() { return frozenRows; },
    setHiddenGridlines: function() { hiddenGridlinesCalls++; },
    setFrozenRows: function(n) { frozenRows = n; },
    setRowHeight: function() {},
    clear: function() { clearCount++; },
    clearConditionalFormatRules: function() {},
    getRange: function(row, col, nRows, nCols) {
      return makeRange(row, col, nRows, nCols);
    }
  };

  return {
    _sheet: sheet,
    _sheetInserted: function() { return sheetInserted; },
    _insertedName: function() { return insertedName; },
    _queriedNames: function() { return queriedNames.slice(); },
    getSheetByName: function(name) {
      queriedNames.push(name);
      return sheetInserted ? sheet : null;
    },
    insertSheet: function(name) {
      sheetInserted = true;
      insertedName = name;
      return sheet;
    }
  };
}


// Helper: find latest write at (row,col) of a given type
function _instTplWriteAt(sheet, row, col, type) {
  type = type || 'value';
  for (var i = sheet._writes.length - 1; i >= 0; i--) {
    var w = sheet._writes[i];
    if (w.type === type && w.row === row && w.col === col) return w.value;
  }
  return null;
}


// =============================================================================
// TESTS
// =============================================================================

// T1
registerTest({
  id: 'UNIT_TEMPLATES_INST_CREATES_SHEET',
  group: 'unit', module: 'templates/installation', scenarios: [],
  tags: ['templates', 'installation', 'v2', 'chunk5'],
  source: 'tests_unit/templates/InstallationTemplateTests.gs',
  fn: function (t, ctx) {
    t.suite('templates/installation: creates sheet on first call, clears on second');
    var ss = _makeInstallTplMockSpreadsheet();
    t.assertFalse('sheet does not exist before setup', ss._sheetInserted());
    setupInstallationTemplate(ss);
    t.assertTrue('sheet inserted after first setup', ss._sheetInserted());
    t.assert('inserted with V2_SHEETS.INSTALLATION name',
      V2_SHEETS.INSTALLATION, ss._insertedName());
    t.assert('clear() did NOT fire on first run', 0, ss._sheet._clearCount());
    setupInstallationTemplate(ss);
    t.assert('clear() fired once on second run', 1, ss._sheet._clearCount());
  }
});

// T2
registerTest({
  id: 'UNIT_TEMPLATES_INST_CUSTOM_SHEET_NAME',
  group: 'unit', module: 'templates/installation', scenarios: [],
  tags: ['templates', 'installation', 'v2', 'chunk5'],
  source: 'tests_unit/templates/InstallationTemplateTests.gs',
  fn: function (t, ctx) {
    t.suite('templates/installation: opts.sheetName redirects insertSheet');
    var customName = '_INSTALL_v2_TEST_xyz';
    var ss = _makeInstallTplMockSpreadsheet();
    setupInstallationTemplate(ss, { sheetName: customName });
    var queried = ss._queriedNames();
    t.assertTrue('custom name queried', queried.indexOf(customName) !== -1);
    t.assertFalse('default name NOT queried',
      queried.indexOf(V2_SHEETS.INSTALLATION) !== -1);
    t.assert('sheet inserted under custom name', customName, ss._insertedName());
  }
});

// T3
registerTest({
  id: 'UNIT_TEMPLATES_INST_BANNER',
  group: 'unit', module: 'templates/installation', scenarios: [],
  tags: ['templates', 'installation', 'v2', 'chunk5'],
  source: 'tests_unit/templates/InstallationTemplateTests.gs',
  fn: function (t, ctx) {
    t.suite('templates/installation: banner rows 1-3 (title + subtitle)');
    var ss = _makeInstallTplMockSpreadsheet();
    setupInstallationTemplate(ss);
    var sheet = ss._sheet;
    t.assert('C2 = "INSTALACIÓN · MXN" title', 'INSTALACI\u00d3N \u00b7 MXN',
      _instTplWriteAt(sheet, 2, 3));
    var c3 = _instTplWriteAt(sheet, 3, 3);
    t.assertTrue('C3 subtitle contains "Mano de obra"',
      c3 && String(c3).indexOf('Mano de obra') !== -1);
    t.assertTrue('C3 subtitle contains "celdas azules"',
      c3 && String(c3).indexOf('celdas azules') !== -1);
  }
});

// T4
registerTest({
  id: 'UNIT_TEMPLATES_INST_PANEL_HDR_LEFT',
  group: 'unit', module: 'templates/installation', scenarios: [],
  tags: ['templates', 'installation', 'v2', 'chunk5'],
  source: 'tests_unit/templates/InstallationTemplateTests.gs',
  fn: function (t, ctx) {
    t.suite('templates/installation: A4-C4 panel headers');
    var ss = _makeInstallTplMockSpreadsheet();
    setupInstallationTemplate(ss);
    var sheet = ss._sheet;
    t.assert('A4 = "DRIVER / INPUT"', 'DRIVER / INPUT', _instTplWriteAt(sheet, 4, 1));
    t.assert('B4 = "VALUE"',           'VALUE',          _instTplWriteAt(sheet, 4, 2));
    t.assert('C4 = "NOTES"',           'NOTES',          _instTplWriteAt(sheet, 4, 3));
  }
});

// T5
registerTest({
  id: 'UNIT_TEMPLATES_INST_PANEL_HDR_RIGHT',
  group: 'unit', module: 'templates/installation', scenarios: [],
  tags: ['templates', 'installation', 'v2', 'chunk5'],
  source: 'tests_unit/templates/InstallationTemplateTests.gs',
  fn: function (t, ctx) {
    t.suite('templates/installation: F4-G4 SUMMARY + grand-total mirror formula');
    var ss = _makeInstallTplMockSpreadsheet();
    setupInstallationTemplate(ss);
    var sheet = ss._sheet;
    t.assert('F4 = "SUMMARY"', 'SUMMARY', _instTplWriteAt(sheet, 4, 6));
    t.assert('G4 formula = =G9 (grand-total mirror)', '=G9',
      _instTplWriteAt(sheet, 4, 7, 'formula'));
    var numfmt = _instTplWriteAt(sheet, 4, 7, 'numfmt');
    t.assertTrue('G4 has currency number format',
      numfmt && String(numfmt).indexOf('$') !== -1);
  }
});

// T6
registerTest({
  id: 'UNIT_TEMPLATES_INST_DRIVER_KEY_LABELS',
  group: 'unit', module: 'templates/installation', scenarios: [],
  tags: ['templates', 'installation', 'v2', 'chunk5'],
  source: 'tests_unit/templates/InstallationTemplateTests.gs',
  fn: function (t, ctx) {
    t.suite('templates/installation: 30 driver-key labels in col A rows 5-34');
    var ss = _makeInstallTplMockSpreadsheet();
    setupInstallationTemplate(ss);
    var sheet = ss._sheet;

    // Spot-check key labels at known rows
    t.assert('A5  = PROJECT_DC_WP',          'PROJECT_DC_WP',          _instTplWriteAt(sheet, 5, 1));
    t.assert('A6  = PROJECT_DC_KWP',         'PROJECT_DC_KWP',         _instTplWriteAt(sheet, 6, 1));
    t.assert('A8  = MODULE_COUNT',           'MODULE_COUNT',           _instTplWriteAt(sheet, 8, 1));
    t.assert('A19 = INTERCONNECTION_POINTS', 'INTERCONNECTION_POINTS', _instTplWriteAt(sheet,19, 1));
    t.assert('A21 = CREW_SIZE',              'CREW_SIZE',              _instTplWriteAt(sheet,21, 1));
    t.assert('A24 = INSTALLATION_TYPE',      'INSTALLATION_TYPE',      _instTplWriteAt(sheet,24, 1));
    t.assert('A31 = WEATHER_PROFILE',        'WEATHER_PROFILE',        _instTplWriteAt(sheet,31, 1));
    t.assert('A32 = BLENDED_LABOR_RATE_MXN_MH', 'BLENDED_LABOR_RATE_MXN_MH', _instTplWriteAt(sheet,32, 1));
    t.assert('A33 = CONTINGENCY_PCT',        'CONTINGENCY_PCT',        _instTplWriteAt(sheet,33, 1));
    t.assert('A34 = INSURANCE_PCT_ON_LABOR_EQUIP',
      'INSURANCE_PCT_ON_LABOR_EQUIP',        _instTplWriteAt(sheet,34, 1));
  }
});

// T7
registerTest({
  id: 'UNIT_TEMPLATES_INST_NOTES_COL',
  group: 'unit', module: 'templates/installation', scenarios: [],
  tags: ['templates', 'installation', 'v2', 'chunk5'],
  source: 'tests_unit/templates/InstallationTemplateTests.gs',
  fn: function (t, ctx) {
    t.suite('templates/installation: NOTES helper text in col C rows 5-34');
    var ss = _makeInstallTplMockSpreadsheet();
    setupInstallationTemplate(ss);
    var sheet = ss._sheet;
    t.assert('C5  = Link from engine',        'Link from engine',        _instTplWriteAt(sheet, 5, 3));
    t.assert('C6  = Auto',                    'Auto',                    _instTplWriteAt(sheet, 6, 3));
    t.assert('C11 = Link from layout/helper', 'Link from layout/helper', _instTplWriteAt(sheet,11, 3));
    t.assert('C13 = Input/helper',            'Input/helper',            _instTplWriteAt(sheet,13, 3));
    t.assert('C14 = Link from BOM/helper',    'Link from BOM/helper',    _instTplWriteAt(sheet,14, 3));
    t.assert('C21 = Estimator input',         'Estimator input',         _instTplWriteAt(sheet,21, 3));
    t.assert('C24 = Dropdown',                'Dropdown',                _instTplWriteAt(sheet,24, 3));
    t.assert('C32 = Reference only',          'Reference only',          _instTplWriteAt(sheet,32, 3));
    t.assert('C33 = Override allowed',        'Override allowed',        _instTplWriteAt(sheet,33, 3));
  }
});

// T8
registerTest({
  id: 'UNIT_TEMPLATES_INST_DROPDOWNS',
  group: 'unit', module: 'templates/installation', scenarios: [],
  tags: ['templates', 'installation', 'v2', 'chunk5'],
  source: 'tests_unit/templates/InstallationTemplateTests.gs',
  fn: function (t, ctx) {
    t.suite('templates/installation: dropdowns on rows 24-31 col B');
    var ss = _makeInstallTplMockSpreadsheet();
    setupInstallationTemplate(ss);
    var sheet = ss._sheet;
    // Each row should have a validation set
    var dropdownRows = [24, 25, 26, 27, 28, 29, 30, 31];
    dropdownRows.forEach(function(r) {
      var v = _instTplWriteAt(sheet, r, 2, 'validation');
      t.assertTrue('row ' + r + ' col B has data validation', v !== null);
    });
    // Check the allowed-values list on a couple rows
    var v24 = _instTplWriteAt(sheet, 24, 2, 'validation');
    if (v24) {
      var opts24 = v24.getCriteriaValues()[0];
      t.assert('row 24 INSTALLATION_TYPE options include ROOF',
        true, opts24.indexOf('ROOF') !== -1);
      t.assert('row 24 INSTALLATION_TYPE options include GROUND',
        true, opts24.indexOf('GROUND') !== -1);
    }
    var v25 = _instTplWriteAt(sheet, 25, 2, 'validation');
    if (v25) {
      var opts25 = v25.getCriteriaValues()[0];
      t.assert('row 25 ACCESS_DIFFICULTY options include VERY_HARD',
        true, opts25.indexOf('VERY_HARD') !== -1);
    }
  }
});

// T9
registerTest({
  id: 'UNIT_TEMPLATES_INST_DROPDOWN_DEFAULTS',
  group: 'unit', module: 'templates/installation', scenarios: [],
  tags: ['templates', 'installation', 'v2', 'chunk5'],
  source: 'tests_unit/templates/InstallationTemplateTests.gs',
  fn: function (t, ctx) {
    t.suite('templates/installation: dropdown default values pre-populated');
    var ss = _makeInstallTplMockSpreadsheet();
    setupInstallationTemplate(ss);
    var sheet = ss._sheet;
    t.assert('B24 default = ROOF',     'ROOF',     _instTplWriteAt(sheet, 24, 2));
    t.assert('B25 default = MEDIUM',   'MEDIUM',   _instTplWriteAt(sheet, 25, 2));
    t.assert('B26 default = STANDARD', 'STANDARD', _instTplWriteAt(sheet, 26, 2));
    t.assert('B27 default = NO',       'NO',       _instTplWriteAt(sheet, 27, 2));
    t.assert('B28 default = LOCAL',    'LOCAL',    _instTplWriteAt(sheet, 28, 2));
    t.assert('B30 default = MEDIUM',   'MEDIUM',   _instTplWriteAt(sheet, 30, 2));
    t.assert('B31 default = DRY',      'DRY',      _instTplWriteAt(sheet, 31, 2));
  }
});

// T10
registerTest({
  id: 'UNIT_TEMPLATES_INST_PERCENT_ROWS',
  group: 'unit', module: 'templates/installation', scenarios: [],
  tags: ['templates', 'installation', 'v2', 'chunk5'],
  source: 'tests_unit/templates/InstallationTemplateTests.gs',
  fn: function (t, ctx) {
    t.suite('templates/installation: percent rows 33,34 format + defaults');
    var ss = _makeInstallTplMockSpreadsheet();
    setupInstallationTemplate(ss);
    var sheet = ss._sheet;
    t.assert('B33 number format = "0.00%"', '0.00%', _instTplWriteAt(sheet, 33, 2, 'numfmt'));
    t.assert('B34 number format = "0.00%"', '0.00%', _instTplWriteAt(sheet, 34, 2, 'numfmt'));
    t.assert('B33 default = 0.05',          0.05,    _instTplWriteAt(sheet, 33, 2));
    t.assert('B34 default = 0.03',          0.03,    _instTplWriteAt(sheet, 34, 2));
  }
});

// T11
registerTest({
  id: 'UNIT_TEMPLATES_INST_FROZEN_ROWS',
  group: 'unit', module: 'templates/installation', scenarios: [],
  tags: ['templates', 'installation', 'v2', 'chunk5'],
  source: 'tests_unit/templates/InstallationTemplateTests.gs',
  fn: function (t, ctx) {
    t.suite('templates/installation: frozen rows = 3 (banner visible on scroll)');
    var ss = _makeInstallTplMockSpreadsheet();
    setupInstallationTemplate(ss);
    t.assert('setFrozenRows(3) called', 3, ss._sheet._frozenRows());
  }
});

// T12
registerTest({
  id: 'UNIT_TEMPLATES_INST_HIDDEN_GRIDLINES',
  group: 'unit', module: 'templates/installation', scenarios: [],
  tags: ['templates', 'installation', 'v2', 'chunk5'],
  source: 'tests_unit/templates/InstallationTemplateTests.gs',
  fn: function (t, ctx) {
    t.suite('templates/installation: setHiddenGridlines called');
    var ss = _makeInstallTplMockSpreadsheet();
    setupInstallationTemplate(ss);
    t.assertTrue('setHiddenGridlines called', ss._sheet._hiddenGridlinesCalls() >= 1);
  }
});
