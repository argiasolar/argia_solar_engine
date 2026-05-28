// =============================================================================
// ARGIA TESTS -- tests_unit/engine/RefreshBessStrategyDropdownTests.gs
// -----------------------------------------------------------------------------
// CHUNK 4 follow-up (v4.0.0) — refreshBessStrategyDropdown.
//
// CONTEXT
//   Adding LOAD_SHIFTING to INPUT_MAP.bessStrategy.dropdown does not update a
//   data-validation rule already baked into INPUT_BESS!C7. refreshBessStrategy
//   Dropdown re-applies the rule from the current map. This test proves that
//   the function (a) targets C7, (b) clears the stale rule first, and (c)
//   applies a rule whose option list matches INPUT_MAP exactly (all 3 items).
//
// APPROACH
//   Pure mock of the SpreadsheetApp validation builder + a mock INPUT_BESS
//   sheet, so we capture exactly what rule gets applied to C7 without a live
//   workbook. We assert against INPUT_MAP.bessStrategy.dropdown so the test
//   self-updates if the canonical list changes.
// =============================================================================

registerTest({
  id      : 'UNIT_REFRESH_BESS_STRATEGY_DROPDOWN',
  group   : 'unit',
  module  : 'engine/input_setup',
  scenarios: [],
  tags    : ['engine', 'input_setup', 'dropdown', 'chunk4', 'load_shifting'],
  source  : 'tests_unit/engine/RefreshBessStrategyDropdownTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT engine/input_setup: refreshBessStrategyDropdown applies full map list to C7');

    // --- capture state -----------------------------------------------------
    var captured = {
      clearedAt: null,        // [row,col] where clearDataValidations was called
      appliedAt: null,        // [row,col] where setDataValidation was called
      appliedList: null,      // option list inside the applied rule
      flushed: false,
    };

    // --- mock the validation builder (mirrors the real chained API) --------
    var realNewDataValidation = SpreadsheetApp.newDataValidation;
    var realFlush = SpreadsheetApp.flush;
    SpreadsheetApp.newDataValidation = function () {
      var rule = {
        _list: null,
        requireValueInList: function (list) { rule._list = list; return rule; },
        requireNumberBetween: function () { return rule; },
        requireDate: function () { return rule; },
        requireValueInRange: function () { return rule; },
        setAllowInvalid: function () { return rule; },
        setHelpText: function () { return rule; },
        build: function () { return { _list: rule._list }; }
      };
      return rule;
    };
    SpreadsheetApp.flush = function () { captured.flushed = true; };

    // --- mock cell + sheet + spreadsheet -----------------------------------
    function mockCell(row, col) {
      return {
        _row: row, _col: col,
        clearDataValidations: function () { captured.clearedAt = [row, col]; return this; },
        setDataValidation: function (rule) {
          captured.appliedAt = [row, col];
          captured.appliedList = rule && rule._list;
          return this;
        },
        setNumberFormat: function () { return this; },
        getSheet: function () { return { getParent: function () { return mockSs; } }; }
      };
    }
    var mockBess = {
      getRange: function (row, col) { return mockCell(row, col); }
    };
    var mockSs = {
      getSheetByName: function (name) { return (name === SH.INPUT_BESS) ? mockBess : null; }
    };

    var realGetActive = SpreadsheetApp.getActiveSpreadsheet;
    SpreadsheetApp.getActiveSpreadsheet = function () { return mockSs; };

    // --- run ---------------------------------------------------------------
    var threw = null, ret = null;
    try {
      ret = refreshBessStrategyDropdown();
    } catch (e) {
      threw = e;
    } finally {
      // restore globals no matter what
      SpreadsheetApp.newDataValidation = realNewDataValidation;
      SpreadsheetApp.flush = realFlush;
      SpreadsheetApp.getActiveSpreadsheet = realGetActive;
    }

    if (threw) { t.error('refreshBessStrategyDropdown threw', threw); return; }

    // --- assertions --------------------------------------------------------
    var m = INPUT_MAP.bessStrategy;

    t.assertTrue('cleared validations on a cell', captured.clearedAt !== null);
    t.assert('cleared at C7 row', m.row, captured.clearedAt ? captured.clearedAt[0] : -1);
    t.assert('cleared at C7 col', m.col, captured.clearedAt ? captured.clearedAt[1] : -1);

    t.assertTrue('applied validation on a cell', captured.appliedAt !== null);
    t.assert('applied at C7 row', m.row, captured.appliedAt ? captured.appliedAt[0] : -1);
    t.assert('applied at C7 col', m.col, captured.appliedAt ? captured.appliedAt[1] : -1);

    // The applied list must equal the canonical INPUT_MAP list (all options).
    t.assertTrue('applied an option list', !!captured.appliedList);
    var applied = captured.appliedList || [];
    t.assert('option count matches INPUT_MAP', m.dropdown.length, applied.length);
    for (var i = 0; i < m.dropdown.length; i++) {
      t.assert('option ' + i + ' matches map', m.dropdown[i], applied[i]);
    }

    // LOAD_SHIFTING specifically must be present (the whole point of 4.0.0).
    t.assertTrue('LOAD_SHIFTING is selectable',
                 applied.indexOf('LOAD_SHIFTING') !== -1);

    t.assertTrue('flush was called', captured.flushed);
  }
});
