// =============================================================================
// ARGIA TESTS -- tests_unit/inputs/RenderInputRowColCTests.gs
// -----------------------------------------------------------------------------
// [A2c] Locks the col-3 (col-C) branch added to _renderInputRow, which lets the
// generic _setupOneTab renderer build col-C tabs (INPUT_BESS) -- value in C,
// label in B, unit in D -- without a bespoke renderer.
//
// Two halves:
//   1. col-3 entry -> label@B, value(seed)@C, unit@D
//   2. col-4 entry -> UNCHANGED (label@B[:C], value@D, unit@E, nothing in C)
//      -- the regression guard proving Project/Install rendering is untouched.
//
// A tiny recording-sheet mock captures the (row,col) of every setValue so the
// assertions read back exactly where each piece landed. Design tokens load via
// the same null-ss path LayoutPrimitivesTests uses.
// =============================================================================

function _recordingInputSheet() {
  var cells = {};               // 'r,c' -> last setValue
  var rowHeights = {};
  function cellStub(r, c) {
    var key = r + ',' + c;
    var stub = {
      setValue:               function (v) { cells[key] = v; return stub; },
      getValue:               function ()  { return cells[key]; },
      setFontFamily:          function () { return stub; },
      setFontSize:            function () { return stub; },
      setFontColor:           function () { return stub; },
      setFontStyle:           function () { return stub; },
      setFontWeight:          function () { return stub; },
      setBackground:          function () { return stub; },
      setHorizontalAlignment: function () { return stub; },
      setVerticalAlignment:   function () { return stub; },
      setWrapStrategy:        function () { return stub; },
      setNumberFormat:        function () { return stub; },
      setDataValidation:      function () { return stub; },
      setBorder:              function () { return stub; },
      merge:                  function () { return stub; },
      breakApart:             function () { return stub; }
    };
    return stub;
  }
  return {
    _cells: cells,
    getRange:     function (r, c) { return cellStub(r, c); },  // multi-cell -> top-left
    setRowHeight: function (r, h) { rowHeights[r] = h; return this; },
    val:          function (r, c) { return cells[r + ',' + c]; }
  };
}

registerTest({
  id      : 'UNIT_INPUTS_RENDER_INPUT_ROW_COLC',
  group   : 'unit',
  module  : 'inputs/setup',
  scenarios: [],
  tags    : ['inputs', 'setup', 'bess', 'a2', 'render', 'col-c'],
  source  : 'tests_unit/inputs/RenderInputRowColCTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT inputs/setup [A2c]: _renderInputRow col-C branch');

    // Seed a minimal token map directly so this runs in the headless Node rig
    // (loadDesignTokens needs a live _DESIGN_TOKENS sheet). Restored in finally.
    resetDesignTokenCache_();
    _TOKEN_CACHE = {
      FONT_FAMILY: 'Arial', FONT_SIZE_BODY: 10, FONT_SIZE_SMALL: 8,
      TEXT_PRIMARY: '#1a1a1a', TEXT_SECONDARY: '#666666',
      BG_INPUT_CELL: '#ffffff', DIVIDER_LINE: '#cccccc', ROW_H_BODY: 21
    };
    // The rig's newDataValidation stub only implements requireValueInList;
    // _applyTypeValidation needs requireNumberBetween/setHelpText for numbers.
    // Swap in a permissive builder for the duration of the test.
    var _savedNewDV = SpreadsheetApp.newDataValidation;
    SpreadsheetApp.newDataValidation = function () {
      var rule = {
        requireNumberBetween: function () { return rule; },
        requireValueInList:   function () { return rule; },
        setAllowInvalid:      function () { return rule; },
        setHelpText:          function () { return rule; },
        build:                function () { return {}; }
      };
      return rule;
    };
    try {

    // -- col-3 entry: label@B, value(seed)@C, unit@D ------------------------
    var sh3 = _recordingInputSheet();
    _renderInputRow(sh3, {
      row: 30, col: 3, label: 'Voltaje bus DC', type: 'number',
      default: 0, seed: 864, unit: 'V'
    });
    t.assert('col-3 label -> B30',        'Voltaje bus DC', sh3.val(30, 2));
    t.assert('col-3 seed value -> C30',   864,              sh3.val(30, 3));
    t.assert('col-3 unit -> D30',         'V',              sh3.val(30, 4));

    // required flag appends ' *' to the label
    var sh3r = _recordingInputSheet();
    _renderInputRow(sh3r, {
      row: 31, col: 3, label: 'Carga crítica', type: 'number',
      default: 0, required: true, unit: 'kW'
    });
    t.assert('col-3 required label gets " *"', 'Carga crítica *', sh3r.val(31, 2));
    // default 0 is seeded (a real value, not blank)
    t.assert('col-3 default 0 seeded -> C31',  0,                sh3r.val(31, 3));

    // -- col-4 entry: UNCHANGED (regression guard) --------------------------
    var sh4 = _recordingInputSheet();
    _renderInputRow(sh4, {
      row: 40, col: 4, label: 'Panel count', type: 'number',
      default: 0, seed: 100, unit: 'pcs'
    });
    t.assert('col-4 label -> B40 (merge top-left)', 'Panel count', sh4.val(40, 2));
    t.assert('col-4 value -> D40',                  100,           sh4.val(40, 4));
    t.assert('col-4 unit -> E40',                   'pcs',         sh4.val(40, 5));
    t.assertTrue('col-4 writes nothing to C40 (value lives in D)',
                 sh4.val(40, 3) === undefined);

    } finally {
      resetDesignTokenCache_();
      SpreadsheetApp.newDataValidation = _savedNewDV;
    }
  }
});
