// =============================================================================
// ARGIA TESTS -- tests_regression/inputs/BessStylingMapDrivenTests.gs
// -----------------------------------------------------------------------------
// [A2c] Locks the setupInputBessStyling header-row fix: section header rows
// derive from INPUT_MAP (header = section minRow - 1) instead of the stale
// hardcoded list [5, 9, 19, 22].
//
// THE BUG THIS LOCKS OUT: the old list put §3 at r19 and §4 at r22, while
// the map layout has §3 fields from r22 and §4 from r25. The function's own
// BDF-10 block clears B18:B19, then the stale list wrote the §3 header BACK
// into r19 -- manufacturing the duplicate "3. INFORMACIÓN COMERCIAL" cruft
// (r19 + r21) seen on live sheets. After the fix: §3 header r21, §4 header
// r24, and r19 stays clear.
//
// Reuses _mockBessTabSs from BessS6SetupMapDrivenTests.gs.
// =============================================================================

registerTest({
  id      : 'REG_BESS_STYLING_MAP_DRIVEN',
  group   : 'regression',
  module  : 'inputs/setup',
  scenarios: [],
  tags    : ['inputs', 'setup', 'bess', 'a2', 'map', 'styling'],
  source  : 'tests_regression/inputs/BessStylingMapDrivenTests.gs',
  fn: function (t, ctx) {
    t.suite('REG inputs/setup [A2c]: setupInputBessStyling headers map-derived');

    // -- Derived rows must match the live layout (minRow - 1) ----------------
    function minRow(section) {
      var min = null;
      Object.keys(INPUT_MAP).forEach(function (k) {
        var m = INPUT_MAP[k];
        if (m.sheet !== 'INPUT_BESS' || m.section !== section) return;
        if (min === null || m.row < min) min = m.row;
      });
      return min;
    }
    t.assert('§1 header row = 5',  5,  minRow('BESS 1 SELECCION') - 1);
    t.assert('§2 header row = 9',  9,  minRow('BESS 2 ESPECIFICACIONES') - 1);
    t.assert('§3 header row = 21', 21, minRow('BESS 3 COMERCIAL') - 1);
    t.assert('§4 header row = 24', 24, minRow('BESS 4 PEAK SHAVING') - 1);

    var savedGetActive = SpreadsheetApp.getActiveSpreadsheet;
    try {
      // Live-sheet-like state AFTER the function's own BDF-10 clear: r19
      // empty, real §3 header at r21, §4 header + note at r24, §1/§2 present.
      var ss = _mockBessTabSs({
        '5,2': '1. SELECCIÓN DE BATERÍA',
        '9,2': '2. ESPECIFICACIONES TÉCNICAS',
        '21,2': '3. INFORMACIÓN COMERCIAL',
        '24,2': '4. PEAK SHAVING (v2.3.0)',
        '24,3': 'Solo aplica si BESS_STRATEGY = PEAK_SHAVING',
        '22,2': 'CAPEX MXN:', '22,3': 0
      });
      SpreadsheetApp.getActiveSpreadsheet = function () { return ss; };
      setupInputBessStyling();
      var sh = ss._sheet;

      // 1. THE FIX: r19 must NOT be rewritten with the §3 header
      t.assertTrue('r19 stays clear (duplicate-header self-fight gone)',
                   sh.val(19, 2) === undefined || sh.val(19, 2) === '');

      // 2. existing headers at the map-derived rows are preserved (guard:
      //    matching content -> styled, not rewritten)
      t.assert('§3 header intact at r21', '3. INFORMACIÓN COMERCIAL', sh.val(21, 2));
      t.assert('§4 header intact at r24 (live variant text preserved)',
               '4. PEAK SHAVING (v2.3.0)', sh.val(24, 2));

      // 3. r22 (CAPEX row) untouched by the header pass
      t.assert('r22 label untouched', 'CAPEX MXN:', sh.val(22, 2));
      t.assert('r22 value untouched', 0, sh.val(22, 3));

      // 4. §4 note at C24 survives (styled in place, never overwritten)
      t.assert('§4 note text intact at C24',
               'Solo aplica si BESS_STRATEGY = PEAK_SHAVING', sh.val(24, 3));

      // -- Fresh-sheet case: headers WRITTEN at the derived rows --------------
      var ss2 = _mockBessTabSs({});
      SpreadsheetApp.getActiveSpreadsheet = function () { return ss2; };
      setupInputBessStyling();
      t.assert('fresh: §3 written at r21', '3. INFORMACIÓN COMERCIAL', ss2._sheet.val(21, 2));
      t.assert('fresh: §4 written at r24', '4. PEAK SHAVING',          ss2._sheet.val(24, 2));
      t.assertTrue('fresh: nothing at r19',
                   ss2._sheet.val(19, 2) === undefined);

    } finally {
      SpreadsheetApp.getActiveSpreadsheet = savedGetActive;
    }
  }
});
