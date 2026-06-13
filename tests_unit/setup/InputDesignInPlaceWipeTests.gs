// =============================================================================
// ARGIA -- tests_unit/setup/InputDesignInPlaceWipeTests.gs
// -----------------------------------------------------------------------------
// [4.15.1] Locks the fix for the INPUT_DESIGN rebuild failure.
//
// THE INCIDENT (caught by 4.15.0's loud logging, repaired here):
//   repairInputLayouts / Start New Project logged
//     "rebuildInputsToDefault step 0 (anon) failed: You must select all cells
//      in a merged range to merge or unmerge them."
//   step 0 == setupInputDesign(true). _setupDesignTab was the ONLY input
//   setup still doing deleteSheet()+insertSheet() -- the exact pattern the
//   4.14.3 CHANGELOG forbade (permanent #REF! of every cross-sheet formula
//   referencing INPUT_DESIGN), and the stale/merged-range state it left was
//   what raised the merge error. The fix converts it to the same in-place
//   wipe the shared _setupOneTab uses.
//
// THIS TEST drives the REAL _setupDesignTab against a recording mock and
// asserts the structural invariant directly:
//   - deleteSheet() is NEVER called on the existing INPUT_DESIGN tab
//   - insertSheet() is NOT called when the tab already exists (reuse)
//   - the in-place clean sequence runs (unfreeze -> breakApart -> clear)
// The heavy render helpers are stubbed (this test is about the wipe contract,
// not pixel layout -- layout is covered by the live workbook run), and every
// global override is restored in finally so the workbook is left untouched.
// =============================================================================

registerTest({
  id      : 'UNIT_INPUT_DESIGN_WIPES_IN_PLACE_NEVER_DELETES',
  group   : 'unit',
  module  : 'setup/input_design',
  scenarios: [],
  tags    : ['setup', 'inputs', 'regression'],
  source  : 'tests_unit/setup/InputDesignInPlaceWipeTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT setup/input_design [4.15.1]: in-place wipe, never deleteSheet');

    // ---- Recording mock sheet --------------------------------------------
    function mkRangeRecorder(rec) {
      var self = {
        breakApart:            function () { rec.breakApart = true; return self; },
        merge:                 function () { return self; },
        clearConditionalFormatRules: function () { return self; },
        clearDataValidations:  function () { rec.clearedValidations = true; return self; },
        clearNotes:            function () { return self; },
        setValue:              function () { return self; },
        setValues:             function () { return self; },
        setFormula:            function () { return self; },
        setFontFamily:         function () { return self; },
        setFontSize:           function () { return self; },
        setFontWeight:         function () { return self; },
        setFontColor:          function () { return self; },
        setBackground:         function () { return self; },
        setBorder:             function () { return self; },
        setVerticalAlignment:  function () { return self; },
        setHorizontalAlignment:function () { return self; },
        setNumberFormat:       function () { return self; },
        setWrap:               function () { return self; },
        setFontStyle:          function () { return self; },
        setNote:               function () { return self; },
        getFormula:            function () { return ''; }
      };
      return self;
    }
    function mkDesignSheet(name, rec) {
      return {
        __name: name,
        getName: function () { return name; },
        getMaxRows:    function () { return 100; },
        getMaxColumns: function () { return 12; },
        getLastRow:    function () { return 70; },
        getLastColumn: function () { return 12; },
        setFrozenRows: function (n) { if (n === 0) rec.unfrozeRows = true;
                                      else rec.frozeRows = n; return this; },
        setFrozenColumns: function () { return this; },
        clear:         function () { rec.cleared = true; return this; },
        clearContents: function () { return this; },
        setHiddenGridlines: function () { return this; },
        setColumnWidth: function () { return this; },
        setRowHeight:   function () { return this; },
        getRange:       function () { return mkRangeRecorder(rec); },
        hideSheet:      function () { return this; },
        getParent:      function () { return null; }
      };
    }

    var rec = {};
    var existing = mkDesignSheet('INPUT_DESIGN', rec);
    var deleteCalls = [];
    var insertCalls = [];
    var mockSs = {
      getSheetByName: function (n) {
        return (n === 'INPUT_DESIGN') ? existing : null;
      },
      deleteSheet: function (sh) { deleteCalls.push(sh && sh.__name); },
      insertSheet: function (n) { insertCalls.push(n);
                                  return mkDesignSheet(n, rec); }
    };

    // ---- Save + override globals (ALL restored in finally) ---------------
    var saved = {};
    function override(name, fn) {
      saved[name] = (typeof this[name] !== 'undefined') ? eval(name) : undefined;
      eval(name + ' = fn');
    }
    var G = (function () { return this; })();

    var keys = ['SpreadsheetApp', 'resetDesignTokenCache_', 'loadDesignTokens',
      '_ensureDropdownsTab', '_detectUserData', '_applyDesignCanvas',
      '_insertArgiaLogo', '_writeTitleShifted', '_renderDesignDashboard',
      '_renderDesignTopSection', '_renderDesignHelioscopeBlock',
      '_renderDesignPanelBlock', '_renderDesignInverterBlock',
      '_renderDesignStringConfigBlock', '_lockOptimizersCellReadOnly'];
    var prior = {};
    keys.forEach(function (k) { prior[k] = G[k]; });

    try {
      G.SpreadsheetApp = {
        getActive: function () { return mockSs; },
        getActiveSpreadsheet: function () { return mockSs; },
        flush: function () {},
        BorderStyle: { SOLID: 'SOLID' },
        newCellImage: function () { return { setSourceUrl: function () { return this; },
          setAltTextTitle: function () { return this; }, build: function () { return {}; } }; }
      };
      G.resetDesignTokenCache_ = function () {};
      G.loadDesignTokens       = function () {};
      G._ensureDropdownsTab    = function () {};
      G._detectUserData        = function () { return false; };
      G._applyDesignCanvas     = function () {};
      G._insertArgiaLogo       = function () { rec.logoInserted = true; };
      G._writeTitleShifted     = function () {};
      G._renderDesignDashboard = function () {};
      G._renderDesignTopSection= function () {};
      G._renderDesignHelioscopeBlock   = function () {};
      G._renderDesignPanelBlock        = function () {};
      G._renderDesignInverterBlock     = function () {};
      G._renderDesignStringConfigBlock = function () {};
      G._lockOptimizersCellReadOnly    = function () {};

      // ---- Drive the REAL setup with force=true --------------------------
      setupInputDesign(true);

      // ---- Assertions: the structural invariant --------------------------
      t.assertTrue('deleteSheet NEVER called on the existing INPUT_DESIGN tab',
                   deleteCalls.length === 0);
      t.assertTrue('insertSheet NOT called when the tab already exists (reuse)',
                   insertCalls.length === 0);
      t.assertTrue('in-place wipe unfroze rows before unmerge', rec.unfrozeRows === true);
      t.assertTrue('in-place wipe broke apart merged ranges', rec.breakApart === true);
      t.assertTrue('in-place wipe cleared contents+formats', rec.cleared === true);
      t.assertTrue('logo re-inserted after the wipe', rec.logoInserted === true);
      t.assertTrue('banner/dashboard frozen at row 7', rec.frozeRows === 7);

    } finally {
      keys.forEach(function (k) { G[k] = prior[k]; });
    }
  }
});
