// =============================================================================
// ARGIA TESTS -- tests_regression/inputs/BessS5SetupMapDrivenTests.gs
// -----------------------------------------------------------------------------
// [A2c] Locks the setupInputBessEconomicsRows refactor: rows 37-39 rendered
// from _MAP_BESS §5 via INPUT_MAP instead of hardcoded copies.
//
// THE CRITICAL GUARD here is the seed gate: only entries with an EXPLICIT
// `seed` property are prefilled. The tariff overrides (r38/r39) have
// default:0 but NO seed -- they must stay BLANK (blank = "auto-derive from
// INPUT_CFE"); a naive _seedValueFor loop would write their reader default
// (0) into the cells and visually suggest a zero tariff.
//
// Reuses _mockBessTabSs from BessS6SetupMapDrivenTests.gs (same rig load).
// =============================================================================

registerTest({
  id      : 'REG_BESS_S5_SETUP_MAP_DRIVEN',
  group   : 'regression',
  module  : 'inputs/setup',
  scenarios: [],
  tags    : ['inputs', 'setup', 'bess', 'a2', 'map', 's5'],
  source  : 'tests_regression/inputs/BessS5SetupMapDrivenTests.gs',
  fn: function (t, ctx) {
    t.suite('REG inputs/setup [A2c]: setupInputBessEconomicsRows is map-driven');

    var savedGetActive = SpreadsheetApp.getActiveSpreadsheet;
    try {

      // -- CASE 1: fresh rows -> threshold seeded, overrides stay BLANK ------
      var ss1 = _mockBessTabSs({});
      SpreadsheetApp.getActiveSpreadsheet = function () { return ss1; };
      setupInputBessEconomicsRows();
      var sh1 = ss1._sheet;

      t.assert('header at B36', '5. ECONOMICS GUARDRAILS', sh1.val(36, 2));
      t.assert('threshold label from map',
               INPUT_MAP.bessMinAnnualSavingMxn.label + ':', sh1.val(37, 2));
      t.assert('punta override label from map',
               INPUT_MAP.bessPuntaRateOverride.label + ':', sh1.val(38, 2));
      t.assert('base override label from map',
               INPUT_MAP.bessBaseRateOverride.label + ':', sh1.val(39, 2));

      t.assert('threshold seeded from map seed', 2000000, sh1.val(37, 3));
      t.assertTrue('punta override stays BLANK (no seed; blank-by-design)',
                   sh1.val(38, 3) === undefined);
      t.assertTrue('base override stays BLANK (no seed; blank-by-design)',
                   sh1.val(39, 3) === undefined);

      t.assert('notes label', 'Notas:', sh1.val(40, 2));
      t.assertTrue('notes body mentions auto-derive',
                   String(sh1.val(40, 3) || '').indexOf('auto-deriva') >= 0);

      // -- CASE 2: designer values preserved ----------------------------------
      var ss2 = _mockBessTabSs({ '37,3': 5000000, '38,3': 4.5 });
      SpreadsheetApp.getActiveSpreadsheet = function () { return ss2; };
      setupInputBessEconomicsRows();
      t.assert('designer threshold 5M preserved', 5000000, ss2._sheet.val(37, 3));
      t.assert('designer punta override preserved', 4.5,   ss2._sheet.val(38, 3));

      // -- CASE 3: layout-conflict guard still throws --------------------------
      var ss3 = _mockBessTabSs({ '36,2': 'ALGO PERSONALIZADO' });
      SpreadsheetApp.getActiveSpreadsheet = function () { return ss3; };
      var threw = false;
      try { setupInputBessEconomicsRows(); } catch (e) { threw = true; }
      t.assertTrue('conflicting row-36 content -> throws (guard intact)', threw);

    } finally {
      SpreadsheetApp.getActiveSpreadsheet = savedGetActive;
    }
  }
});
