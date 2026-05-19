// =============================================================================
// ARGIA ENGINE -- Phase 13 test suite: battery product DB reader (4b-2.5a)
// Paste into 99_TestRunner.gs, and add the call
//   try { addPhase13Tests(t, ss); } catch (e) { t.error('Phase13 aborted', e); }
// right after the addPhase12Tests block in runTests().
//
// SCOPE: Increment 4b-2.5a added the FIRST code that reads the battery
// product DB -- getAllBatteryProducts / lookupBattery / lookupBatteryVoltage
// in 02_LoadDB.gs, against the 16M_PRODUCTS_BESS mirror tab.
//
// This suite is READ-ONLY: it reads the live 16M_PRODUCTS_BESS tab and
// asserts. It writes nothing, so there is no snapshot/restore.
//
// IMPORTRANGE note: 16M_PRODUCTS_BESS is an IMPORTRANGE mirror of Master_DB.
// If the import has not resolved at test time, getAllBatteryProducts returns
// [] and the data assertions are SKIPPED with a loud info line rather than
// failing -- a not-yet-loaded import is an environment state, not a code bug.
// The reader's own loading/junk-cell handling is covered by the Node logic
// test in the increment and by the _bessCellOk unit checks below.
// =============================================================================

function addPhase13Tests(t, ss) {
  t.suite('Phase13: battery DB reader');

  // -- function availability ------------------------------------------------
  t.assert('getAllBatteryProducts defined',
           'function', typeof getAllBatteryProducts);
  t.assert('lookupBattery defined',
           'function', typeof lookupBattery);
  t.assert('lookupBatteryVoltage defined',
           'function', typeof lookupBatteryVoltage);
  t.assert('_bessCellOk defined',
           'function', typeof _bessCellOk);

  // -- _bessCellOk unit checks (pure, no sheet) -----------------------------
  t.assertTrue('_bessCellOk: real value OK',        _bessCellOk('HW_LUNA_200KWH'));
  t.assertTrue('_bessCellOk: number OK',            _bessCellOk(1200));
  t.assertFalse('_bessCellOk: blank rejected',      _bessCellOk(''));
  t.assertFalse('_bessCellOk: null rejected',       _bessCellOk(null));
  t.assertFalse('_bessCellOk: "Loading..." rejected', _bessCellOk('Loading...'));
  t.assertFalse('_bessCellOk: "#REF!" rejected',    _bessCellOk('#REF!'));
  t.assertFalse('_bessCellOk: "#N/A" rejected',     _bessCellOk('#N/A'));

  // -- lookup of an id that cannot exist ------------------------------------
  t.assertTrue('lookupBattery(unknown) -> null',
               lookupBattery(ss, 'NO_SUCH_BATTERY_XYZ') === null);
  t.assertTrue('lookupBattery(blank) -> null',
               lookupBattery(ss, '') === null);
  t.assert('lookupBatteryVoltage(unknown) -> 0',
           0, lookupBatteryVoltage(ss, 'NO_SUCH_BATTERY_XYZ'));

  // -- live DB read ---------------------------------------------------------
  var products = getAllBatteryProducts(ss);

  if (!products || products.length === 0) {
    // IMPORTRANGE not resolved (or tab absent). Not a code failure -- the
    // reader correctly returned []. Skip the data-dependent assertions.
    t.info('Phase13 NOTE',
           '16M_PRODUCTS_BESS returned 0 rows -- IMPORTRANGE may still be '
           + 'loading. Data assertions skipped this run. Re-run after the '
           + 'import resolves to exercise them.');
    return;
  }

  t.info('Phase13 DB', products.length + ' battery products loaded from '
         + '16M_PRODUCTS_BESS');
  t.assertTrue('DB has at least 2 products (CUSTOM_MANUAL + >=1 real)',
               products.length >= 2);

  // header-keyed access: every row must carry the key columns the engine uses
  var first = products[0];
  t.assertTrue('rows are header-keyed (Battery_ID present)',
               first.hasOwnProperty('Battery_ID'));
  t.assertTrue('rows carry Nominal_Voltage_V column',
               first.hasOwnProperty('Nominal_Voltage_V'));

  // CUSTOM_MANUAL must exist and resolve to voltage 0 (the fallback signal)
  var custom = lookupBattery(ss, 'CUSTOM_MANUAL');
  t.assertTrue('CUSTOM_MANUAL present in DB', custom !== null);
  t.assert('CUSTOM_MANUAL voltage = 0 (fallback signal)',
           0, lookupBatteryVoltage(ss, 'CUSTOM_MANUAL'));

  // Spot-check a real Huawei product if present. HW_LUNA_200KWH is the
  // 1200 V cabinet in the user-supplied CSV. If the live DB ever drops or
  // renames it the check is skipped (info), not failed -- the DB is owned
  // outside this repo.
  var hw200 = lookupBattery(ss, 'HW_LUNA_200KWH');
  if (hw200) {
    t.assert('HW_LUNA_200KWH nominal voltage = 1200 V',
             1200, lookupBatteryVoltage(ss, 'HW_LUNA_200KWH'));
    t.assertTrue('HW_LUNA_200KWH case-insensitive lookup works',
                 lookupBattery(ss, '  hw_luna_200kwh ') !== null);
  } else {
    t.info('Phase13 NOTE',
           'HW_LUNA_200KWH not in live DB -- voltage spot-check skipped.');
  }

  // Every real (non-CUSTOM) product that carries a voltage must be positive;
  // a real product with voltage 0 would mean the DB lost its voltage data.
  var realWithVolt = 0, realZeroVolt = 0;
  products.forEach(function(p) {
    var id = String(p['Battery_ID'] || '').trim().toUpperCase();
    if (id === 'CUSTOM_MANUAL' || id === '') return;
    var v = lookupBatteryVoltage(ss, p['Battery_ID']);
    if (v > 0) realWithVolt++;
    else       realZeroVolt++;
  });
  t.info('Phase13 voltage coverage',
         realWithVolt + ' real products with voltage, '
         + realZeroVolt + ' without');
  t.assertTrue('at least one real product carries a usable voltage',
               realWithVolt >= 1);
}