// =============================================================================
// ARGIA TESTS -- tests_integration/db/BatteryDbReaderTests.gs
// -----------------------------------------------------------------------------
// PASS 11 MIGRATION: battery product DB reader.
//
// SOURCE: addPhase13Tests in 99q_Phase13_BatteryDbReader.gs.
//         Migrated 2026-05-21 as part of Pass 11.
//
// COVERAGE
//   READ-ONLY integration test. Writes nothing -- only reads from the
//   16M_PRODUCTS_BESS IMPORTRANGE mirror. Verifies:
//     - getAllBatteryProducts, lookupBattery, lookupBatteryVoltage,
//       _bessCellOk all exist
//     - _bessCellOk pure unit checks (real value / number / blank / null /
//       Loading.../#REF!/#N/A handling)
//     - lookup of unknown ids returns null / voltage 0
//     - Live DB has CUSTOM_MANUAL with voltage 0 (fallback signal)
//     - Live DB has at least one real product with voltage > 0
//     - Spot-check HW_LUNA_200KWH = 1200 V if present
//
// CLASSIFICATION
//   group=integration. Reads live 16M_PRODUCTS_BESS tab. No cells written,
//   no try/finally needed -- nothing to restore.
//
// DEPENDENCIES
//   - getAllBatteryProducts, lookupBattery, lookupBatteryVoltage,
//     _bessCellOk (02_LoadDB.gs)
//
// IMPORTRANGE SAFETY
//   16M_PRODUCTS_BESS is an IMPORTRANGE mirror of Master_DB. If the import
//   has not resolved at test time, getAllBatteryProducts returns [] and
//   data assertions are SKIPPED with an info line -- a not-yet-loaded
//   import is environmental state, not a code bug. The reader's own
//   loading/junk-cell handling is fully covered by the _bessCellOk checks
//   which run regardless.
//
// NEW MODULE PATH: tests_integration/db/
//   First test under db/. DB-reader concerns don't fit cleanly under
//   inputs/ (these aren't user input cells) or writers/ (read-only).
//   New top-level module dir.
//
// CO-EXISTENCE
//   99q_Phase13_BatteryDbReader.gs is unchanged. Both run the same
//   assertions until the legacy deletion pass.
// =============================================================================


registerTest({
  id      : 'INT_DB_BATTERY_READER',
  group   : 'integration',
  module  : 'db/battery',
  scenarios: [],
  tags    : ['db', 'battery', 'reader', 'live-data', 'read-only'],
  source  : 'tests_integration/db/BatteryDbReaderTests.gs',
  fn: function (t, ctx) {
    t.suite('INT db/battery: product DB reader');

    // === Function availability =========================================
    t.assert('getAllBatteryProducts defined',
             'function', typeof getAllBatteryProducts);
    t.assert('lookupBattery defined',
             'function', typeof lookupBattery);
    t.assert('lookupBatteryVoltage defined',
             'function', typeof lookupBatteryVoltage);
    t.assert('_bessCellOk defined',
             'function', typeof _bessCellOk);

    // === _bessCellOk unit checks (pure, no sheet) ======================
    t.assertTrue('_bessCellOk: real value OK',
                 _bessCellOk('HW_LUNA_200KWH'));
    t.assertTrue('_bessCellOk: number OK',
                 _bessCellOk(1200));
    t.assertFalse('_bessCellOk: blank rejected',
                  _bessCellOk(''));
    t.assertFalse('_bessCellOk: null rejected',
                  _bessCellOk(null));
    t.assertFalse('_bessCellOk: "Loading..." rejected',
                  _bessCellOk('Loading...'));
    t.assertFalse('_bessCellOk: "#REF!" rejected',
                  _bessCellOk('#REF!'));
    t.assertFalse('_bessCellOk: "#N/A" rejected',
                  _bessCellOk('#N/A'));

    // === Lookup of an id that cannot exist =============================
    t.assertTrue('lookupBattery(unknown) -> null',
                 lookupBattery(ctx.ss, 'NO_SUCH_BATTERY_XYZ') === null);
    t.assertTrue('lookupBattery(blank) -> null',
                 lookupBattery(ctx.ss, '') === null);
    t.assert('lookupBatteryVoltage(unknown) -> 0',
             0, lookupBatteryVoltage(ctx.ss, 'NO_SUCH_BATTERY_XYZ'));

    // === Live DB read ==================================================
    var products = getAllBatteryProducts(ctx.ss);

    if (!products || products.length === 0) {
      // IMPORTRANGE not resolved (or tab absent). Not a code failure --
      // the reader correctly returned []. Skip data-dependent assertions.
      t.info('NOTE',
             '16M_PRODUCTS_BESS returned 0 rows -- IMPORTRANGE may still '
             + 'be loading. Data assertions skipped this run. Re-run after '
             + 'the import resolves to exercise them.');
      return;
    }

    t.info('DB load',
           products.length + ' battery products loaded from 16M_PRODUCTS_BESS');
    t.assertTrue('DB has at least 2 products (CUSTOM_MANUAL + >=1 real)',
                 products.length >= 2);

    // header-keyed access: every row must carry the key columns the engine uses
    var first = products[0];
    t.assertTrue('rows are header-keyed (Battery_ID present)',
                 first.hasOwnProperty('Battery_ID'));
    t.assertTrue('rows carry Nominal_Voltage_V column',
                 first.hasOwnProperty('Nominal_Voltage_V'));

    // CUSTOM_MANUAL must exist and resolve to voltage 0 (fallback signal)
    var custom = lookupBattery(ctx.ss, 'CUSTOM_MANUAL');
    t.assertTrue('CUSTOM_MANUAL present in DB', custom !== null);
    t.assert('CUSTOM_MANUAL voltage = 0 (fallback signal)',
             0, lookupBatteryVoltage(ctx.ss, 'CUSTOM_MANUAL'));

    // Spot-check HW_LUNA_200KWH if present. If the live DB ever drops or
    // renames it the check is skipped (info), not failed -- the DB is
    // owned outside this repo.
    var hw200 = lookupBattery(ctx.ss, 'HW_LUNA_200KWH');
    if (hw200) {
      t.assert('HW_LUNA_200KWH nominal voltage = 1200 V',
               1200, lookupBatteryVoltage(ctx.ss, 'HW_LUNA_200KWH'));
      t.assertTrue('HW_LUNA_200KWH case-insensitive lookup works',
                   lookupBattery(ctx.ss, '  hw_luna_200kwh ') !== null);
    } else {
      t.info('NOTE',
             'HW_LUNA_200KWH not in live DB -- voltage spot-check skipped.');
    }

    // Every real (non-CUSTOM) product that carries a voltage must be
    // positive; a real product with voltage 0 would mean the DB lost its
    // voltage data.
    var realWithVolt = 0, realZeroVolt = 0;
    products.forEach(function (p) {
      var id = String(p['Battery_ID'] || '').trim().toUpperCase();
      if (id === 'CUSTOM_MANUAL' || id === '') return;
      var v = lookupBatteryVoltage(ctx.ss, p['Battery_ID']);
      if (v > 0) realWithVolt++;
      else       realZeroVolt++;
    });
    t.info('voltage coverage',
           realWithVolt + ' real products with voltage, '
           + realZeroVolt + ' without');
    t.assertTrue('at least one real product carries a usable voltage',
                 realWithVolt >= 1);
  }
});
