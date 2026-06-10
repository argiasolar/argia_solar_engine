// =============================================================================
// ARGIA TESTS -- tests_regression/inputs/BessS6SetupMapDrivenTests.gs
// -----------------------------------------------------------------------------
// [A2c] Locks the setupInputBessInstallRows refactor: rows 44-53 are now
// rendered from _MAP_BESS_S6 via INPUT_MAP instead of ten hand-maintained
// hardcoded blocks (which had already drifted from the map -- the hardcoded
// C44 seed was the stray 800 placeholder behind the voltage-drift bug).
//
// Guards:
//   1. labels at B44-B53 come from INPUT_MAP (label + ':')
//   2. SEED-IF-EMPTY semantics preserved:
//        - empty value cell  -> map seed written
//        - populated cell    -> NOT overwritten (non-destructive overlay)
//   3. dropdown validations built from the map's dropdown lists
//   4. unit hints at col E come from the map
//   5. row 43 BDF-7.1 coupling note + row 55 notes block still written
//
// The function resolves design tokens via its own try/catch (mock ss makes
// loadDesignTokens throw -> styled with fallback constants), so this runs in
// the headless Node rig with no token seeding.
// =============================================================================

function _mockBessTabSs(initialCells) {
  // initialCells: { 'r,c': value } pre-populated cells (user data)
  var cells = Object.assign({}, initialCells || {});
  var validations = {};   // 'r,c' -> rule object
  var sheet = {
    _cells: cells,
    _validations: validations,
    getRange: function (r, c) {
      var key = r + ',' + c;
      var stub = {
        getValue:               function ()  { return cells.hasOwnProperty(key) ? cells[key] : ''; },
        setValue:               function (v) { cells[key] = v; return stub; },
        setDataValidation:      function (rule) { validations[key] = rule; return stub; },
        clearContent:           function () { delete cells[key]; return stub; },
        clearDataValidations:   function () { delete validations[key]; return stub; },
        setNote:                function () { return stub; },
        setFontFamily:          function () { return stub; },
        setFontSize:            function () { return stub; },
        setFontColor:           function () { return stub; },
        setFontStyle:           function () { return stub; },
        setFontWeight:          function () { return stub; },
        setBackground:          function () { return stub; },
        setHorizontalAlignment: function () { return stub; },
        setVerticalAlignment:   function () { return stub; },
        setNumberFormat:        function () { return stub; },
        setWrap:                function () { return stub; },
        setWrapStrategy:        function () { return stub; },
        setBorder:              function () { return stub; },
        merge:                  function () { return stub; },
        breakApart:             function () { return stub; }
      };
      return stub;
    },
    setRowHeight: function () { return sheet; },
    val: function (r, c) { var k = r + ',' + c; return cells.hasOwnProperty(k) ? cells[k] : undefined; },
    dv:  function (r, c) { return validations[r + ',' + c]; }
  };
  return {
    getSheetByName: function (name) { return name === 'INPUT_BESS' ? sheet : null; },
    _sheet: sheet
  };
}

registerTest({
  id      : 'REG_BESS_S6_SETUP_MAP_DRIVEN',
  group   : 'regression',
  module  : 'inputs/setup',
  scenarios: [],
  tags    : ['inputs', 'setup', 'bess', 'a2', 'map', 's6'],
  source  : 'tests_regression/inputs/BessS6SetupMapDrivenTests.gs',
  fn: function (t, ctx) {
    t.suite('REG inputs/setup [A2c]: setupInputBessInstallRows is map-driven');

    var S6 = [
      'bessDcBusV', 'bessAcV', 'bessDcRunM', 'bessAcRunM', 'bessCablePath',
      'bessS6BatteriesPerContainer', 'bessLocation', 'bessGroundingSystem',
      'bessGecRunM', 'bessCommissioningMxn'
    ];

    // The function reads getActiveSpreadsheet; inject the mock for the call.
    var savedGetActive = SpreadsheetApp.getActiveSpreadsheet;
    try {

      // -- CASE 1: fresh tab (all §6 cells empty) -> map seeds written ------
      var ss1 = _mockBessTabSs({});
      SpreadsheetApp.getActiveSpreadsheet = function () { return ss1; };
      setupInputBessInstallRows();
      var sh1 = ss1._sheet;

      S6.forEach(function (key) {
        var m = INPUT_MAP[key];
        t.assert('label B' + m.row + ' from map', m.label + ':', sh1.val(m.row, 2));
        var seed = _seedValueFor(m);
        if (seed !== '') {
          t.assert('empty C' + m.row + ' seeded from map (' + key + ')',
                   seed, sh1.val(m.row, 3));
        }
        if (m.unit) {
          t.assert('unit E' + m.row + ' from map', m.unit, sh1.val(m.row, 5));
        }
      });

      // dropdown validations carry the map's lists
      ['bessCablePath', 'bessLocation', 'bessGroundingSystem'].forEach(function (key) {
        var m = INPUT_MAP[key];
        var rule = sh1.dv(m.row, 3);
        t.assertTrue('dropdown rule set at C' + m.row, !!rule);
        if (rule && rule.getCriteriaValues) {
          t.assert('dropdown list C' + m.row + ' from map',
                   m.dropdown.join('|'), rule.getCriteriaValues()[0].join('|'));
        }
      });

      // row 43 BDF-7.1 note + row 55 notes block still written
      t.assertTrue('row 43 coupling note written',
                   String(sh1.val(43, 2) || '').indexOf('INPUT_DESIGN!C17') >= 0);
      t.assertTrue('row 55 "Notas:" written', sh1.val(55, 2) === 'Notas:');
      t.assertTrue('row 55 notes body written',
                   String(sh1.val(55, 3) || '').indexOf('Distancias = trayectoria') >= 0);

      // -- CASE 2: populated cells -> NOT overwritten (CULLIGAN-style) ------
      var userVals = { '44,3': 864, '45,3': 480, '46,3': 25, '47,3': 50,
                       '48,3': 'INTEMPERIE', '53,3': 300000 };
      var ss2 = _mockBessTabSs(userVals);
      SpreadsheetApp.getActiveSpreadsheet = function () { return ss2; };
      setupInputBessInstallRows();
      var sh2 = ss2._sheet;
      t.assert('user C44=864 preserved (not re-seeded)', 864,          sh2.val(44, 3));
      t.assert('user C48=INTEMPERIE preserved',          'INTEMPERIE', sh2.val(48, 3));
      t.assert('user C53=300000 preserved',              300000,       sh2.val(53, 3));
      // and the still-empty rows in CASE 2 got their map seeds
      t.assert('empty C49 seeded in CASE 2',
               _seedValueFor(INPUT_MAP.bessS6BatteriesPerContainer), sh2.val(49, 3));

    } finally {
      SpreadsheetApp.getActiveSpreadsheet = savedGetActive;
    }
  }
});
