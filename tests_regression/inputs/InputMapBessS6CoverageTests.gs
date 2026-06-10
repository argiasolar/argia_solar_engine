// =============================================================================
// ARGIA TESTS -- tests_regression/inputs/InputMapBessS6CoverageTests.gs
// -----------------------------------------------------------------------------
// [A2a] Locks _MAP_BESS_S6 coverage. INPUT_BESS §6 "DISTANCIAS Y UBICACIÓN
// FÍSICA" (rows 44-53) was read directly by readBessInstallContext (01a) with
// hardcoded getRange(row,3) calls. This test guards that every one of those 10
// physical-install inputs has a map key at the right coordinate (so A2b can
// migrate the reader onto readInput), points at INPUT_BESS, and carries a
// scalar shape. Coordinates must match 01a_ReadInputsBess.readBessInstallContext.
// =============================================================================

registerTest({
  id      : 'REG_INPUT_MAP_BESS_S6_COVERAGE',
  group   : 'regression',
  module  : 'inputs/map',
  scenarios: [],
  tags    : ['inputs', 'map', 'bess', 'a2'],
  source  : 'tests_regression/inputs/InputMapBessS6CoverageTests.gs',
  fn: function (t, ctx) {
    t.suite('REG inputs/map [A2a]: _MAP_BESS_S6 (INPUT_BESS §6 distancias)');

    // key -> exact A1 the direct reader (readBessInstallContext) uses.
    var EXPECTED = {
      bessDcBusV:                'INPUT_BESS!C44',
      bessAcV:                   'INPUT_BESS!C45',
      bessDcRunM:                'INPUT_BESS!C46',
      bessAcRunM:                'INPUT_BESS!C47',
      bessCablePath:             'INPUT_BESS!C48',
      bessS6BatteriesPerContainer: 'INPUT_BESS!C49',
      bessLocation:              'INPUT_BESS!C50',
      bessGroundingSystem:       'INPUT_BESS!C51',
      bessGecRunM:               'INPUT_BESS!C52',
      bessCommissioningMxn:      'INPUT_BESS!C53'
    };

    var missing = [], wrongLoc = [], badShape = [];
    Object.keys(EXPECTED).forEach(function (k) {
      if (!hasInput(k)) { missing.push(k); return; }
      var m = INPUT_MAP[k];
      if (m.sheet !== 'INPUT_BESS') wrongLoc.push(k);
      if (typeof m.row !== 'number' || typeof m.col !== 'number' || m.mode === 'range') badShape.push(k);
      if (inputLocation(k) !== EXPECTED[k]) wrongLoc.push(k + '(' + inputLocation(k) + ')');
    });

    t.assert('all 10 §6 keys present',                '', missing.join(','));
    t.assert('all map to INPUT_BESS at the reader coords', '', wrongLoc.join(','));
    t.assert('all are scalar (row+col, not range)',   '', badShape.join(','));

    // Spot-check dropdown definitions survived (cablePath / location / grounding).
    t.assertTrue('bessCablePath has 3-option dropdown',
      INPUT_MAP.bessCablePath && INPUT_MAP.bessCablePath.dropdown &&
      INPUT_MAP.bessCablePath.dropdown.length === 3);
    t.assertTrue('bessGroundingSystem dropdown includes VARILLA',
      INPUT_MAP.bessGroundingSystem && INPUT_MAP.bessGroundingSystem.dropdown &&
      INPUT_MAP.bessGroundingSystem.dropdown.indexOf('VARILLA') >= 0);
  }
});
