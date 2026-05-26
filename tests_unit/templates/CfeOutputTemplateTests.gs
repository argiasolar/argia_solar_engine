// =============================================================================
// ARGIA TESTS -- tests_unit/templates/CfeOutputTemplateTests.gs
// -----------------------------------------------------------------------------
// CHUNK 7 \u2014 Unit tests for setupCfeOutputTemplate.
//
// COVERAGE
//   - First call inserts the CFE_OUTPUT_v2 sheet
//   - Second call refreshes (clear + clearNotes + image cleanup)
//   - Sheet is positioned BEFORE MDC_v2 when MDC_v2 exists
//   - Sheet is appended when MDC_v2 missing
//   - 16 column widths set
//   - Title at (2, 3) merged
//   - Subtitle at (3, 3) merged
//   - Header strip labels written: col B (rows 5-8) and col H (rows 5-8)
//   - Section 1 header at row 12, month header at row 13
//   - Section 1 static labels at rows 14-20 in col B
//   - Section 2 header at row 22, static labels at rows 24-31
//   - Footer header at row 33, footer labels at row 34 (merged blocks)
//   - Frozen rows = 10
//   - Idempotency: second call increments clear count
//   - Image cleanup attempted on refresh
//
// CHUNK TAG: 'chunk7'
// =============================================================================


function _makeCfeTplMockSs(opts) {
  opts = opts || {};
  var mdcPresent = !!opts.mdcPresent;
  var mdcIndex = opts.mdcIndex || 5;  // 1-based

  var writes = [];
  var rowHeights = {};
  var colWidths = {};
  var bgByCell = {};
  var clearCount = 0;
  var imagesRemovedCount = 0;
  var cfeInserted = false;
  var insertedAtIndex = null;

  function makeRange(row, col, numRows, numCols) {
    var nR = numRows || 1, nC = numCols || 1;
    var proxy = {
      _row: row, _col: col, _numRows: nR, _numCols: nC,
      setValue: function (v) {
        writes.push({ type: 'value', row: row, col: col, value: v });
        return proxy;
      },
      setValues: function (vs) {
        if (vs && vs.length) {
          for (var ri = 0; ri < vs.length; ri++) {
            for (var ci = 0; ci < (vs[ri] || []).length; ci++) {
              writes.push({
                type: 'value', row: row + ri, col: col + ci,
                value: vs[ri][ci]
              });
            }
          }
        }
        return proxy;
      },
      setBackground: function (bg) {
        bgByCell['R' + row + 'C' + col] = bg;
        return proxy;
      },
      setBorder:              function () { return proxy; },
      setFontFamily:          function () { return proxy; },
      setFontSize:            function () { return proxy; },
      setFontWeight:          function () { return proxy; },
      setFontColor:           function () { return proxy; },
      setFontStyle:           function () { return proxy; },
      setHorizontalAlignment: function () { return proxy; },
      setVerticalAlignment:   function () { return proxy; },
      setNumberFormat:        function () { return proxy; },
      setNote:                function () { return proxy; },
      merge:                  function () { return proxy; },
      breakApart:             function () { return proxy; },
      setWrap:                function () { return proxy; },
      setFormula:             function () { return proxy; },
      setRichTextValue:       function () { return proxy; }
    };
    return proxy;
  }

  // CFE sheet mock
  var cfeSheet = {
    _writes: writes,
    _rowHeights: rowHeights,
    _colWidths: colWidths,
    _bgByCell: bgByCell,
    _clearCount: function () { return clearCount; },
    _imagesRemovedCount: function () { return imagesRemovedCount; },
    _name: 'CFE_OUTPUT_v2',
    getName: function () { return 'CFE_OUTPUT_v2'; },
    getRange: function (r, c, nR, nC) { return makeRange(r, c, nR, nC); },
    setRowHeight:               function (r, h) { rowHeights[r] = h; },
    setColumnWidth:             function (c, w) { colWidths[c] = w; },
    setFrozenRows:              function (r) { cfeSheet._frozenRows = r; },
    setFrozenColumns:           function () {},
    setHiddenGridlines:         function () { cfeSheet._gridlinesHidden = true; },
    clear:                      function () { clearCount++; },
    clearNotes:                 function () {},
    clearConditionalFormatRules:function () {},
    setConditionalFormatRules:  function () {},
    getConditionalFormatRules:  function () { return []; },
    getImages:                  function () {
      return [
        { remove: function () { imagesRemovedCount++; } },
        { remove: function () { imagesRemovedCount++; } }
      ];
    },
    getLastRow:                 function () { return 0; }
  };

  // MDC sheet mock — exists only if opts.mdcPresent
  var mdcSheet = mdcPresent ? {
    getIndex: function () { return mdcIndex; }
  } : null;

  // Benign _DESIGN_TOKENS stub. loadDesignTokens calls getRange(2,1,...)
  // when lastRow >= 2; we keep lastRow = 1 so it short-circuits and returns
  // an empty token map. Tokens used by the template fall back to defaults
  // via the global `token`/`tokenNum` stubs.
  function _benignSheetStub(name) {
    return {
      _name: name,
      getName: function () { return name; },
      getLastRow: function () { return 1; },
      getRange: function () {
        return {
          getValue:           function () { return ''; },
          getValues:          function () { return [[]]; },
          setValue:           function () { return this; },
          setValues:          function () { return this; },
          setBackground:      function () { return this; },
          setBorder:          function () { return this; },
          setFontFamily:      function () { return this; },
          setFontSize:        function () { return this; },
          setFontWeight:      function () { return this; },
          setFontColor:       function () { return this; },
          setFontStyle:       function () { return this; },
          setHorizontalAlignment: function () { return this; },
          setVerticalAlignment:   function () { return this; },
          setNumberFormat:    function () { return this; },
          setNote:            function () { return this; },
          merge:              function () { return this; },
          breakApart:         function () { return this; },
          setWrap:            function () { return this; },
          setFormula:         function () { return this; },
          setRichTextValue:   function () { return this; }
        };
      },
      setRowHeight:               function () {},
      setColumnWidth:             function () {},
      setFrozenRows:              function () {},
      setFrozenColumns:           function () {},
      setHiddenGridlines:         function () {},
      clear:                      function () {},
      clearNotes:                 function () {},
      clearConditionalFormatRules:function () {},
      getImages:                  function () { return []; }
    };
  }
  var designTokensSheet = _benignSheetStub('_DESIGN_TOKENS');

  return {
    _cfeSheet: cfeSheet,
    _sheetInserted: function () { return cfeInserted; },
    _insertedAtIndex: function () { return insertedAtIndex; },
    _mdcPresent: mdcPresent,
    getSheetByName: function (name) {
      if (name === 'MDC_v2') return mdcSheet;
      if (name === '_DESIGN_TOKENS') return designTokensSheet;
      if (name === 'CFE_OUTPUT_v2') return cfeInserted ? cfeSheet : null;
      return null;
    },
    insertSheet: function (name, index) {
      // ONLY toggle CFE state for CFE_OUTPUT_v2. _DESIGN_TOKENS or any other
      // ancillary sheets get a benign stub. Without this discrimination, a
      // call to insertSheet('_DESIGN_TOKENS') from inside loadDesignTokens
      // would falsely flip cfeInserted=true and corrupt clear/image counts.
      if (name === 'CFE_OUTPUT_v2') {
        cfeInserted = true;
        if (typeof index === 'number') insertedAtIndex = index;
        return cfeSheet;
      }
      return _benignSheetStub(name);
    }
  };
}


function _writeAtCfe(writes, row, col) {
  for (var i = writes.length - 1; i >= 0; i--) {
    var w = writes[i];
    if (w.type === 'value' && w.row === row && w.col === col) return w.value;
  }
  return null;
}


// =============================================================================
// TEST 1 \u2014 First call inserts the sheet; second call clears
// =============================================================================
registerTest({
  id      : 'UNIT_CFE_TPL_INSERTS_AND_REFRESHES',
  group   : 'unit',
  module  : 'templates/cfeOutput',
  scenarios: [],
  tags    : ['templates', 'cfe', 'v2', 'chunk7'],
  source  : 'tests_unit/templates/CfeOutputTemplateTests.gs',
  fn: function (t) {
    t.suite('setupCfeOutputTemplate: inserts then clears');

    var ss = _makeCfeTplMockSs();
    t.assertFalse('sheet not present initially', ss._sheetInserted());

    setupCfeOutputTemplate(ss);
    t.assertTrue ('sheet inserted on first call', ss._sheetInserted());
    t.assert     ('no clear on first call', 0, ss._cfeSheet._clearCount());

    setupCfeOutputTemplate(ss);
    t.assert     ('clear count 1 after refresh', 1, ss._cfeSheet._clearCount());
  }
});


// =============================================================================
// TEST 2 \u2014 Positioned BEFORE MDC_v2 when MDC_v2 exists
// =============================================================================
registerTest({
  id      : 'UNIT_CFE_TPL_POSITION_BEFORE_MDC',
  group   : 'unit',
  module  : 'templates/cfeOutput',
  scenarios: [],
  tags    : ['templates', 'cfe', 'v2', 'chunk7'],
  source  : 'tests_unit/templates/CfeOutputTemplateTests.gs',
  fn: function (t) {
    t.suite('setupCfeOutputTemplate: positions before MDC_v2');

    // MDC_v2 sits at index 5. Inserting BEFORE means insertSheet(name, 4).
    var ss = _makeCfeTplMockSs({ mdcPresent: true, mdcIndex: 5 });
    setupCfeOutputTemplate(ss);
    t.assert('inserted at MDC_v2 index - 1', 4, ss._insertedAtIndex());
  }
});


// =============================================================================
// TEST 3 \u2014 Appended at end when MDC_v2 missing
// =============================================================================
registerTest({
  id      : 'UNIT_CFE_TPL_APPEND_WHEN_NO_MDC',
  group   : 'unit',
  module  : 'templates/cfeOutput',
  scenarios: [],
  tags    : ['templates', 'cfe', 'v2', 'chunk7'],
  source  : 'tests_unit/templates/CfeOutputTemplateTests.gs',
  fn: function (t) {
    t.suite('setupCfeOutputTemplate: appends when no MDC_v2');

    var ss = _makeCfeTplMockSs({ mdcPresent: false });
    setupCfeOutputTemplate(ss);
    t.assertTrue('sheet was inserted', ss._sheetInserted());
    t.assertTrue('no positional index passed', ss._insertedAtIndex() === null);
  }
});


// =============================================================================
// TEST 4 \u2014 16 column widths set
// =============================================================================
registerTest({
  id      : 'UNIT_CFE_TPL_COLUMN_WIDTHS',
  group   : 'unit',
  module  : 'templates/cfeOutput',
  scenarios: [],
  tags    : ['templates', 'cfe', 'v2', 'chunk7'],
  source  : 'tests_unit/templates/CfeOutputTemplateTests.gs',
  fn: function (t) {
    t.suite('setupCfeOutputTemplate: 16 column widths set');

    var ss = _makeCfeTplMockSs();
    setupCfeOutputTemplate(ss);
    var widths = ss._cfeSheet._colWidths;
    for (var c = 1; c <= 16; c++) {
      t.assertTrue('col ' + c + ' has width set',
                   typeof widths[c] === 'number' && widths[c] > 0);
    }
    t.assert('col 1 margin = 25',   25,  widths[1]);
    t.assert('col 2 label = 260',   260, widths[2]);
    t.assert('col 3 month = 113',   113, widths[3]);
    t.assert('col 15 total = 135',  135, widths[15]);
    t.assert('col 16 margin = 25',  25,  widths[16]);
  }
});


// =============================================================================
// TEST 5 \u2014 Title at (row 2, col 3) and subtitle at (row 3, col 3)
// =============================================================================
registerTest({
  id      : 'UNIT_CFE_TPL_TITLE_SUBTITLE',
  group   : 'unit',
  module  : 'templates/cfeOutput',
  scenarios: [],
  tags    : ['templates', 'cfe', 'v2', 'chunk7'],
  source  : 'tests_unit/templates/CfeOutputTemplateTests.gs',
  fn: function (t) {
    t.suite('setupCfeOutputTemplate: title + subtitle in banner');

    var ss = _makeCfeTplMockSs();
    setupCfeOutputTemplate(ss);
    var title = _writeAtCfe(ss._cfeSheet._writes, 2, 3);
    var subtitle = _writeAtCfe(ss._cfeSheet._writes, 3, 3);
    t.assertContains('title contains CFE OUTPUT', title, 'CFE OUTPUT');
    t.assertContains('subtitle present', subtitle, 'Sin PV');
  }
});


// =============================================================================
// TEST 6 \u2014 Header strip labels (col B rows 5-8, col H rows 5-8)
// =============================================================================
registerTest({
  id      : 'UNIT_CFE_TPL_HEADER_STRIP_LABELS',
  group   : 'unit',
  module  : 'templates/cfeOutput',
  scenarios: [],
  tags    : ['templates', 'cfe', 'v2', 'chunk7'],
  source  : 'tests_unit/templates/CfeOutputTemplateTests.gs',
  fn: function (t) {
    t.suite('setupCfeOutputTemplate: header strip labels written');

    var ss = _makeCfeTplMockSs();
    setupCfeOutputTemplate(ss);
    var w = ss._cfeSheet._writes;
    // Col B (left labels)
    t.assert('row 5 col 2 = TARIFF CODE',      'TARIFF CODE',      _writeAtCfe(w, 5, 2));
    t.assert('row 6 col 2 = SERVICE NUMBER',   'SERVICE NUMBER',   _writeAtCfe(w, 6, 2));
    t.assert('row 7 col 2 = INTERCONEXION',    'INTERCONEXION',    _writeAtCfe(w, 7, 2));
    t.assert('row 8 col 2 = ESTRATEGIA BESS',  'ESTRATEGIA BESS',  _writeAtCfe(w, 8, 2));
    // Col H (right labels)
    t.assert('row 5 col 8 = SERVICE NAME',     'SERVICE NAME',     _writeAtCfe(w, 5, 8));
    t.assert('row 6 col 8 = CONTRACTED kW',    'CONTRACTED kW',    _writeAtCfe(w, 6, 8));
    t.assert('row 7 col 8 = AUTOCONSUMO %',    'AUTOCONSUMO %',    _writeAtCfe(w, 7, 8));
    t.assert('row 8 col 8 = BATERIA kWh / kW', 'BATERIA kWh / kW', _writeAtCfe(w, 8, 8));
  }
});


// =============================================================================
// TEST 7 \u2014 Section headers + Section 1 static labels (rows 14-20)
// =============================================================================
registerTest({
  id      : 'UNIT_CFE_TPL_SECTION_HEADERS_AND_LABELS',
  group   : 'unit',
  module  : 'templates/cfeOutput',
  scenarios: [],
  tags    : ['templates', 'cfe', 'v2', 'chunk7'],
  source  : 'tests_unit/templates/CfeOutputTemplateTests.gs',
  fn: function (t) {
    t.suite('setupCfeOutputTemplate: section headers + static labels');

    var ss = _makeCfeTplMockSs();
    setupCfeOutputTemplate(ss);
    var w = ss._cfeSheet._writes;

    // Section 1 header (row 12)
    t.assertContains('row 12 col 2 has section 1 header',
                     _writeAtCfe(w, 12, 2), 'RECIBO CON PV');

    // Section 1 static labels (rows 14-20)
    t.assertContains('row 14 col 2 has consumo neto',
                     _writeAtCfe(w, 14, 2), 'Consumo neto');
    t.assertContains('row 15 col 2 has kWh solares',
                     _writeAtCfe(w, 15, 2), 'solares');
    t.assertContains('row 18 col 2 has Facturacion',
                     _writeAtCfe(w, 18, 2), 'Facturacion');
    t.assertContains('row 20 col 2 has Ahorro vs Sin PV',
                     _writeAtCfe(w, 20, 2), 'Ahorro');

    // Section 2 header (row 22)
    t.assertContains('row 22 col 2 has section 2 header',
                     _writeAtCfe(w, 22, 2), 'PV + BESS');

    // Section 2 static labels (rows 24-31)
    t.assertContains('row 24 col 2 has Dmax sin BESS',
                     _writeAtCfe(w, 24, 2), 'Dmax punta sin BESS');
    t.assertContains('row 31 col 2 has Recibo final',
                     _writeAtCfe(w, 31, 2), 'Recibo final');

    // Footer header (row 33)
    t.assertContains('row 33 col 2 has cascade header',
                     _writeAtCfe(w, 33, 2), 'RESUMEN ANUAL');
  }
});


// =============================================================================
// TEST 8 \u2014 Month-header rows (13 and 23) get Mes + Ene..Dic
// =============================================================================
registerTest({
  id      : 'UNIT_CFE_TPL_MONTH_HEADERS',
  group   : 'unit',
  module  : 'templates/cfeOutput',
  scenarios: [],
  tags    : ['templates', 'cfe', 'v2', 'chunk7'],
  source  : 'tests_unit/templates/CfeOutputTemplateTests.gs',
  fn: function (t) {
    t.suite('setupCfeOutputTemplate: month header rows');

    var ss = _makeCfeTplMockSs();
    setupCfeOutputTemplate(ss);
    var w = ss._cfeSheet._writes;

    // Row 13: month header for section 1
    t.assert('row 13 col 2 = Mes',  'Mes', _writeAtCfe(w, 13, 2));
    t.assert('row 13 col 3 = Ene',  'Ene', _writeAtCfe(w, 13, 3));
    t.assert('row 13 col 14 = Dic', 'Dic', _writeAtCfe(w, 13, 14));

    // Row 23: month header for section 2
    t.assert('row 23 col 2 = Mes',  'Mes', _writeAtCfe(w, 23, 2));
    t.assert('row 23 col 14 = Dic', 'Dic', _writeAtCfe(w, 23, 14));
  }
});


// =============================================================================
// TEST 9 \u2014 Footer label row 34 has the 5 cascade labels
// =============================================================================
registerTest({
  id      : 'UNIT_CFE_TPL_FOOTER_LABELS',
  group   : 'unit',
  module  : 'templates/cfeOutput',
  scenarios: [],
  tags    : ['templates', 'cfe', 'v2', 'chunk7'],
  source  : 'tests_unit/templates/CfeOutputTemplateTests.gs',
  fn: function (t) {
    t.suite('setupCfeOutputTemplate: footer cascade labels');

    var ss = _makeCfeTplMockSs();
    setupCfeOutputTemplate(ss);
    var w = ss._cfeSheet._writes;

    // 5 blocks at cols 3,5,7,9,11
    t.assert('row 34 col 3 = Sin PV',      'Sin PV',                 _writeAtCfe(w, 34, 3));
    t.assert('row 34 col 5 = Ahorro PV',   'Ahorro PV',              _writeAtCfe(w, 34, 5));
    t.assert('row 34 col 7 = Despues PV',  'Despues de PV',          _writeAtCfe(w, 34, 7));
    t.assert('row 34 col 9 = Ahorro BESS', 'Ahorro BESS',            _writeAtCfe(w, 34, 9));
    t.assert('row 34 col 11 = Recibo',     'Recibo final con BESS',  _writeAtCfe(w, 34, 11));
  }
});


// =============================================================================
// TEST 10 \u2014 Frozen rows = 10
// =============================================================================
registerTest({
  id      : 'UNIT_CFE_TPL_FROZEN_ROWS',
  group   : 'unit',
  module  : 'templates/cfeOutput',
  scenarios: [],
  tags    : ['templates', 'cfe', 'v2', 'chunk7'],
  source  : 'tests_unit/templates/CfeOutputTemplateTests.gs',
  fn: function (t) {
    t.suite('setupCfeOutputTemplate: frozen rows through KPI strip');

    var ss = _makeCfeTplMockSs();
    setupCfeOutputTemplate(ss);
    t.assert('frozen rows = 10', 10, ss._cfeSheet._frozenRows);
  }
});


// =============================================================================
// TEST 11 \u2014 Image cleanup on refresh (chunk-6 stacked-logo fix)
// =============================================================================
registerTest({
  id      : 'UNIT_CFE_TPL_IMAGE_CLEANUP_ON_REFRESH',
  group   : 'unit',
  module  : 'templates/cfeOutput',
  scenarios: [],
  tags    : ['templates', 'cfe', 'v2', 'chunk7'],
  source  : 'tests_unit/templates/CfeOutputTemplateTests.gs',
  fn: function (t) {
    t.suite('setupCfeOutputTemplate: removes images on refresh');

    var ss = _makeCfeTplMockSs();
    setupCfeOutputTemplate(ss);  // first call: insert, no images
    t.assert('no images removed on first call', 0,
             ss._cfeSheet._imagesRemovedCount());

    setupCfeOutputTemplate(ss);  // second call: refresh, mock returns 2 images
    t.assert('2 images removed on refresh', 2,
             ss._cfeSheet._imagesRemovedCount());
  }
});


// =============================================================================
// TEST 12 \u2014 Hidden gridlines
// =============================================================================
registerTest({
  id      : 'UNIT_CFE_TPL_HIDDEN_GRIDLINES',
  group   : 'unit',
  module  : 'templates/cfeOutput',
  scenarios: [],
  tags    : ['templates', 'cfe', 'v2', 'chunk7'],
  source  : 'tests_unit/templates/CfeOutputTemplateTests.gs',
  fn: function (t) {
    t.suite('setupCfeOutputTemplate: gridlines hidden');

    var ss = _makeCfeTplMockSs();
    setupCfeOutputTemplate(ss);
    t.assertTrue('gridlines hidden', !!ss._cfeSheet._gridlinesHidden);
  }
});
