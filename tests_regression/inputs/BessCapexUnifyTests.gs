// =============================================================================
// ARGIA TESTS -- tests_regression/inputs/BessCapexUnifyTests.gs
// -----------------------------------------------------------------------------
// [A2c] Locks the BESS CAPEX cell unification (2026-06-10).
//
// THE SPLIT: the battery picker wrote CAPEX to C20 (its original target),
// while the engine reader has always consumed the INPUT_MAP cell bessCapexMxn
// at C22. On the catalog path the in-memory picked.capexMxn masked it; on the
// CUSTOM_MANUAL path a C20-only sheet silently read CAPEX = 0 -- the same
// class of bug as the C44/C45 voltage drift.
//
// Guards:
//   1. map: bessCapexMxn is C22 (the single capex cell)
//   2. picker write table targets row 22, never row 20
//   3. _migrateLegacyCapexC20: C20-only sheet self-heals (value moves to C22,
//      C20 + its col-Q marker cleared); idempotent; never clobbers a real C22
//
// Reuses _mockBessTabSs (BessS6SetupMapDrivenTests.gs).
// =============================================================================

registerTest({
  id      : 'REG_BESS_CAPEX_UNIFY_C22',
  group   : 'regression',
  module  : 'inputs/migration',
  scenarios: [],
  tags    : ['inputs', 'map', 'bess', 'a2', 'capex', 'picker'],
  source  : 'tests_regression/inputs/BessCapexUnifyTests.gs',
  fn: function (t, ctx) {
    t.suite('REG inputs/migration [A2c]: BESS CAPEX unified onto C22');

    // -- 1. the map cell ------------------------------------------------------
    t.assert('bessCapexMxn is C22 (row 22, col 3)', '22:3',
             INPUT_MAP.bessCapexMxn.row + ':' + INPUT_MAP.bessCapexMxn.col);

    // -- 2. picker writes the mapped cell -------------------------------------
    // Drive applyBessPickerForCell with a catalog hit and record cell writes.
    var ss = _mockBessTabSs({});
    var sh = ss._sheet;
    var savedCat = (typeof getAllBatteryProducts !== 'undefined') ? getAllBatteryProducts : undefined;
    var savedGetActive = SpreadsheetApp.getActiveSpreadsheet;
    try {
      getAllBatteryProducts = function () {
        return [{ batteryId: 'TEST_BAT', capacityKwh: 1000, powerKw: 500,
                  minSocPct: 0.1, maxSocPct: 0.9, rtePct: 0.9,
                  installedCapexMxn: 7777777 }];
      };
      SpreadsheetApp.getActiveSpreadsheet = function () { return ss; };
      var ret = applyBessPickerForCell(ss, 'TEST_BAT');
      t.assertTrue('picker resolved the catalog battery', !!ret && ret.found !== false);
      t.assert('picker capex lands at C22', 7777777, sh.val(22, 3));
      t.assertTrue('picker writes NOTHING to C20',
                   sh.val(20, 3) === undefined || sh.val(20, 3) === '');
      t.assertTrue('cellsWritten reports C22',
                   (ret.cellsWritten || []).indexOf('C22') >= 0);
      t.assertTrue('cellsWritten does NOT report C20',
                   (ret.cellsWritten || []).indexOf('C20') < 0);

      // -- 3a. legacy migration: C20-only sheet self-heals --------------------
      var ssL = _mockBessTabSs({ '20,3': 28800000, '20,17': 28800000 });
      t.assert('migration returns true on legacy sheet', true,
               _migrateLegacyCapexC20(ssL._sheet));
      t.assert('legacy value moved to C22', 28800000, ssL._sheet.val(22, 3));
      t.assertTrue('legacy C20 cleared',
                   ssL._sheet.val(20, 3) === undefined);
      t.assertTrue('legacy Q20 marker cleared',
                   ssL._sheet.val(20, 17) === undefined);

      // -- 3b. idempotent: second run is a no-op ------------------------------
      t.assert('second migration run is a no-op', false,
               _migrateLegacyCapexC20(ssL._sheet));

      // -- 3c. never clobbers a real C22 ---------------------------------------
      var ssB = _mockBessTabSs({ '20,3': 11111111, '22,3': 22222222 });
      t.assert('C22 populated -> migration declines', false,
               _migrateLegacyCapexC20(ssB._sheet));
      t.assert('authoritative C22 untouched', 22222222, ssB._sheet.val(22, 3));
      t.assert('designer C20 left alone',     11111111, ssB._sheet.val(20, 3));

    } finally {
      if (savedCat !== undefined) getAllBatteryProducts = savedCat;
      SpreadsheetApp.getActiveSpreadsheet = savedGetActive;
    }
  }
});
