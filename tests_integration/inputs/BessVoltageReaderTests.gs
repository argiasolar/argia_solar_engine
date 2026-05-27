// =============================================================================
// ARGIA TESTS -- tests_integration/inputs/BessVoltageReaderTests.gs
// -----------------------------------------------------------------------------
// PASS 7 MIGRATION (integration half): Battery voltage reader live round-trip.
//
// SOURCE: Integration half of addPhase14BessTests in
//         99r_Phase14_BessVoltage.gs (PART C "integration" in the source).
//         Pure half migrated separately in Pass 6 as
//         UNIT_INPUTS_BESS_VOLTAGE_RESOLVER and ..._MAP_SHAPE.
//
// COVERAGE
//   readInputBess populates dcBusVoltageV / acVoltageV correctly:
//     CASE 1: CUSTOM_MANUAL battery + manual C18/C19 cells -> manual wins
//     CASE 2: CUSTOM_MANUAL + blank C18/C19 -> 0 (pendiente)
//     CASE 3: Catalog battery (HW_LUNA_200KWH) -> DB voltage wins
//             KNOWN-FRAGILE: INPUT_BESS!C6 has a data-validation dropdown
//             whose allowlist is out of sync with the live product DB.
//             Test detects and reports the mismatch as INFO; does not fail.
//
// CLASSIFICATION
//   group=integration. Writes 7 cells across INPUT_PROJECT (D64) and
//   INPUT_BESS (C6, C7, C10, C11, C18, C19).
//
// DEPENDENCIES
//   - readInputBess (01a_ReadInputsBess.gs)
//   - lookupBattery (02_LoadDB.gs or 16_BatteryDb.gs depending on engine
//     version -- engine grep at migration confirmed)
//   - setInputValue / backupInputCells / restoreInputCells (test/TestData.gs)
//
// SAFETY
//   - All 7 cells snapshotted via backupInputCells before any write
//   - Restored in finally block -- runs even on assertion or throw
//   - Uses InputMap field keys, not raw getRange/setValue calls
//
// CO-EXISTENCE
//   99r_Phase14_BessVoltage.gs unchanged. After Pass 7, the live cell
//   asserts (6 in cases 1+2, conditionally 1 in case 3) run twice.
// =============================================================================


registerTest({
  id      : 'INT_INPUTS_BESS_VOLTAGE_LIVE_CELL',
  group   : 'integration',
  module  : 'inputs/bess_voltage',
  scenarios: [],
  tags    : ['inputs', 'bess', 'voltage', 'live-cell', 'read-input-bess'],
  source  : 'tests_integration/inputs/BessVoltageReaderTests.gs',
  fn: function (t, ctx) {
    t.suite('INT inputs/bess_voltage: live INPUT_BESS round-trip');

    // Snapshot every cell we touch
    var fieldsToBackup = [
      'installBattery',     // INPUT_PROJECT!D64 toggle
      'bessBatteryId',      // INPUT_BESS!C6
      'bessStrategy',       // INPUT_BESS!C7
      'bessCapacityKwh',    // INPUT_BESS!C10
      'bessPowerKw',        // INPUT_BESS!C11
      'bessDcBusVoltageV',  // INPUT_BESS!C18
      'bessAcVoltageV'      // INPUT_BESS!C19
    ];
    var snap = backupInputCells(fieldsToBackup, ctx.ss);

    try {
      // ===================================================================
      // CASE 1: CUSTOM_MANUAL battery + manual voltage cells
      // CUSTOM_MANUAL has DB voltage 0, so C18/C19 manual cells must win.
      // ===================================================================
      setInputValue('installBattery',    'YES',                  ctx.ss);
      setInputValue('bessBatteryId',     'CUSTOM_MANUAL',        ctx.ss);
      setInputValue('bessStrategy',      'SELF_CONSUMPTION_MAX', ctx.ss);
      setInputValue('bessCapacityKwh',   200,                    ctx.ss);
      setInputValue('bessPowerKw',       100,                    ctx.ss);
      setInputValue('bessDcBusVoltageV', 800,                    ctx.ss);
      setInputValue('bessAcVoltageV',    480,                    ctx.ss);
      SpreadsheetApp.flush();

      var b1 = readInputBess(ctx.ss);
      t.assertTrue('CASE1: readInputBess returns an object', b1 !== null);
      t.assert('CASE1: CUSTOM_MANUAL -> dcBusVoltageV from manual cell',
               800, b1.dcBusVoltageV);
      t.assert('CASE1: CUSTOM_MANUAL -> acVoltageV from manual cell',
               480, b1.acVoltageV);

      // ===================================================================
      // CASE 2: CUSTOM_MANUAL + blank voltage cells -> 0 (pendiente)
      // ===================================================================
      setInputValue('bessDcBusVoltageV', '', ctx.ss);
      setInputValue('bessAcVoltageV',    '', ctx.ss);
      SpreadsheetApp.flush();
      var b2 = readInputBess(ctx.ss);
      t.assert('CASE2: blank C18 -> dcBusVoltageV 0 (pendiente)',
               0, b2.dcBusVoltageV);
      t.assert('CASE2: blank C19 -> acVoltageV 0',
               0, b2.acVoltageV);

      // ===================================================================
      // CASE 3: catalog battery + manual cell -> manual cell wins (BDF-7.1)
      //
      // Before BDF-7.1 (2026): DB voltage overrode the manual cell. The
      // rationale was "catalog products carry an authoritative voltage,
      // prefer it." BDF-7.1 inverted this so INPUT_* always overrides
      // MASTER_DB, matching the rest of the engine. See
      // 01a_ReadInputsBess.js lines 51-61 for the full rationale, and
      // UNIT_INPUTS_BESS_VOLTAGE_RESOLVER for the pure-unit coverage.
      //
      // This case still runs in the live sheet because it covers the
      // round-trip through readInputBess (cell-read + lookupBatteryVoltage
      // + resolveBessVoltage + object build) -- the unit test only covers
      // resolveBessVoltage in isolation.
      // ===================================================================
      var hw = lookupBattery(ctx.ss, 'HW_LUNA_200KWH');
      if (hw) {
        var c6CanTakeRealId = true;
        try {
          setInputValue('bessBatteryId', 'HW_LUNA_200KWH', ctx.ss);
          SpreadsheetApp.flush();
        } catch (e) {
          c6CanTakeRealId = false;
          t.info('CASE3 SKIPPED',
                 'INPUT_BESS!C6 data-validation dropdown rejected '
                 + '"HW_LUNA_200KWH" -- the dropdown allowlist is out of '
                 + 'sync with 16M_PRODUCTS_BESS. Manual-wins logic is '
                 + 'covered by UNIT_INPUTS_BESS_VOLTAGE_RESOLVER. Fix: '
                 + 'resync C6 dropdown values with Battery_IDs from the '
                 + 'product DB.');
        }
        if (c6CanTakeRealId) {
          setInputValue('bessDcBusVoltageV', 600, ctx.ss);
          SpreadsheetApp.flush();
          var b3 = readInputBess(ctx.ss);
          t.assert('CASE3: catalog battery + manual=600 -> dcBusVoltageV=600 '
                   + '(manual cell wins per BDF-7.1, even though catalog has 1200)',
                   600, b3.dcBusVoltageV);
        }
      } else {
        t.info('CASE3 NOTE',
               'HW_LUNA_200KWH not in live DB -- catalog-with-manual case skipped.');
      }

    } finally {
      // ALWAYS restore all 7 cells
      restoreInputCells(snap, ctx.ss);
      t.info('cleanup',
             'INPUT_PROJECT/INPUT_BESS restored to pre-test state');
    }
  }
});
