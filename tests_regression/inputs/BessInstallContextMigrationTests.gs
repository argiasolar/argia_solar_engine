// =============================================================================
// ARGIA TESTS -- tests_regression/inputs/BessInstallContextMigrationTests.gs
// -----------------------------------------------------------------------------
// [A2b] Locks the readBessInstallContext migration from hardcoded
// getRange(row, 3) reads onto readInput()/INPUT_MAP (_MAP_BESS_S6).
//
// The migration must be BEHAVIOR-PRESERVING. This test drives the reader with a
// mock spreadsheet (so it runs without a live workbook) and asserts the exact
// values the old reader produced for the three cases that matter:
//   1. populated cells           -> values pass through, dropdowns uppercased
//   2. empty cells               -> numbers 0, strings '' (map defaults)
//   3. INPUT_BESS sheet missing  -> graceful _bessInstallContextEmpty, EMPTY_*
//
// If a future edit changes a coordinate, default, or coercion, this test fails
// before the change can reach the live CULLIGAN E2E.
// =============================================================================

// Minimal mock: readInput() only needs ss.getSheetByName(name).getRange(r,c).getValue().
function _mockBessS6Ss(rowVals) {
  return {
    getSheetByName: function (name) {
      if (name !== 'INPUT_BESS') return null;
      return {
        getRange: function (row, col) {
          return {
            getValue: function () {
              return (col === 3 && rowVals.hasOwnProperty(row)) ? rowVals[row] : '';
            }
          };
        }
      };
    }
  };
}

registerTest({
  id      : 'REG_MIGRATE_BESS_INSTALL_CONTEXT',
  group   : 'regression',
  module  : 'inputs/migration',
  scenarios: [],
  tags    : ['inputs', 'map', 'bess', 'a2', 'migration'],
  source  : 'tests_regression/inputs/BessInstallContextMigrationTests.gs',
  fn: function (t, ctx) {
    t.suite('REG inputs/migration [A2b]: readBessInstallContext via readInput');

    // -- Case 1: fully populated (mirrors PROLOGIS/CULLIGAN-style values) ------
    // Dropdowns intentionally lower/mixed case to prove the .toUpperCase() path.
    var ssFull = _mockBessS6Ss({
      44: 800, 45: 480, 46: 25, 47: 50,
      48: 'intemperie', 49: 1, 50: 'Exterior', 51: 'varilla',
      52: 15, 53: 250000
    });
    var c = readBessInstallContext(ssFull);
    t.assert('dcBusV (C44)',                800,    c.dcBusV);
    t.assert('acV (C45)',                   480,    c.acV);
    t.assert('dcRunM (C46)',                25,     c.dcRunM);
    t.assert('acRunM (C47)',                50,     c.acRunM);
    t.assert('cablePath uppercased',        'INTEMPERIE', c.cablePath);
    t.assert('batteriesPerContainer (C49)', 1,      c.batteriesPerContainer);
    t.assert('location uppercased',         'EXTERIOR',   c.location);
    t.assert('groundingSystem uppercased',  'VARILLA',    c.groundingSystem);
    t.assert('gecRunM (C52)',               15,     c.gecRunM);
    t.assert('commissioningMxn (C53)',      250000, c.commissioningMxn);
    t.assert('provenance',                  'INPUT_BESS_S6', c.provenance);

    // -- Case 1b: whitespace around a dropdown is trimmed (old valStr did .trim)
    var ssTrim = _mockBessS6Ss({ 48: '  CONDUIT_ENTERRADO  ' });
    t.assert('cablePath trimmed + uppercased',
      'CONDUIT_ENTERRADO', readBessInstallContext(ssTrim).cablePath);

    // -- Case 2: all cells empty -> map defaults (numbers 0, dropdowns '') ------
    var cEmpty = readBessInstallContext(_mockBessS6Ss({}));
    t.assert('empty dcBusV -> 0',           0,  cEmpty.dcBusV);
    t.assert('empty acRunM -> 0',           0,  cEmpty.acRunM);
    t.assert('empty commissioningMxn -> 0', 0,  cEmpty.commissioningMxn);
    t.assert('empty cablePath -> ""',       '', cEmpty.cablePath);
    t.assert('empty location -> ""',        '', cEmpty.location);
    t.assert('empty groundingSystem -> ""', '', cEmpty.groundingSystem);
    t.assert('empty still tagged S6',       'INPUT_BESS_S6', cEmpty.provenance);

    // -- Case 3: INPUT_BESS missing -> graceful empty context, EMPTY_ provenance
    var ssNoSheet = { getSheetByName: function () { return null; } };
    var cMissing = readBessInstallContext(ssNoSheet);
    t.assertTrue('missing sheet -> EMPTY_ provenance',
      String(cMissing.provenance).indexOf('EMPTY_') === 0);
    t.assert('missing sheet -> dcBusV 0',   0,  cMissing.dcBusV);
    t.assert('missing sheet -> cablePath ""', '', cMissing.cablePath);
  }
});
