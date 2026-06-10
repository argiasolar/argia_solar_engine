// =============================================================================
// ARGIA TESTS -- tests_regression/inputs/BessVoltageUnifyTests.gs
// -----------------------------------------------------------------------------
// [A2c] Locks the BESS DC/AC voltage unification (2026-06-10).
//
// BEFORE: 01a read the DC/AC voltage from bessDcBusVoltageV (C18) /
// bessAcVoltageV (C19). The live sheet never populated C18/C19 -- the real
// voltage lives at the §6 cells C44/C45 (bessDcBusV / bessAcV). So 01a's
// circuit voltage always fell back to the battery DB nominal, while the
// voltage-drop (23) and BOS-quantity (22) calcs read C44/C45. Same physical
// voltage, two different values -- a silent split.
//
// AFTER: 01a reads bessDcBusV (C44) / bessAcV (C45) -- the same cells the
// voltage-drop / BOS calcs already use. All three calcs now agree.
//
// This test guards:
//   1. the dead C18/C19 map entries are gone
//   2. bessDcBusV / bessAcV are the live §6 voltage cells (C44 / C45)
//   3. readInput() lands the engine read on C44 / C45 (the unification)
//   4. resolveBessVoltage() priority is locked (manual > DB > 0)
//
// _mockBessS6Ss() is defined in BessInstallContextMigrationTests.gs (loaded in
// the same rig); it serves col-3 INPUT_BESS rows.
// =============================================================================

registerTest({
  id      : 'REG_BESS_VOLTAGE_UNIFY_C44',
  group   : 'regression',
  module  : 'inputs/migration',
  scenarios: [],
  tags    : ['inputs', 'map', 'bess', 'a2', 'voltage'],
  source  : 'tests_regression/inputs/BessVoltageUnifyTests.gs',
  fn: function (t, ctx) {
    t.suite('REG inputs/migration [A2c]: BESS voltage unified onto §6 C44/C45');

    // -- 1. dead C18/C19 entries removed -------------------------------------
    t.assertTrue('bessDcBusVoltageV (C18) removed from INPUT_MAP',
                 !INPUT_MAP.hasOwnProperty('bessDcBusVoltageV'));
    t.assertTrue('bessAcVoltageV (C19) removed from INPUT_MAP',
                 !INPUT_MAP.hasOwnProperty('bessAcVoltageV'));

    // -- 2. live §6 voltage cells are the survivors --------------------------
    t.assertTrue('bessDcBusV present', INPUT_MAP.hasOwnProperty('bessDcBusV'));
    t.assertTrue('bessAcV present',    INPUT_MAP.hasOwnProperty('bessAcV'));
    t.assert('bessDcBusV is C44 (row 44, col 3)', '44:3',
             INPUT_MAP.bessDcBusV.row + ':' + (INPUT_MAP.bessDcBusV.col || 4));
    t.assert('bessAcV is C45 (row 45, col 3)', '45:3',
             INPUT_MAP.bessAcV.row + ':' + (INPUT_MAP.bessAcV.col || 4));

    // -- 3. the unification: engine read + install-context read hit the SAME
    //       cells (C44 / C45). With C44=864 / C45=480 both sides see 864 / 480.
    var ss = _mockBessS6Ss({ 44: 864, 45: 480 });
    t.assert('readInput bessDcBusV -> C44',  864, Number(readInput(ss, 'bessDcBusV')));
    t.assert('readInput bessAcV -> C45',     480, Number(readInput(ss, 'bessAcV')));
    var ic = readBessInstallContext(_mockBessS6Ss({ 44: 864, 45: 480 }));
    t.assert('install-context dcBusV reads same C44', 864, ic.dcBusV);
    t.assert('install-context acV reads same C45',    480, ic.acV);

    // -- 4. resolveBessVoltage priority locked (manual > DB > 0) --------------
    // CULLIGAN case: DB nominal 864, manual 864 -> 864 (circuit OCPD unchanged).
    t.assert('manual 864 over DB 864 -> 864', 864, resolveBessVoltage(864, 864));
    // blank manual -> DB nominal wins (the pre-fix circuit behaviour).
    t.assert('blank manual -> DB 864',        864, resolveBessVoltage(864, 0));
    // AC side has no DB figure: resolves from the manual cell only.
    t.assert('no DB, manual 480 -> 480',      480, resolveBessVoltage(0, 480));
    // override hook: a manual value below the DB nominal still wins.
    t.assert('manual 800 overrides DB 864',   800, resolveBessVoltage(864, 800));
  }
});
