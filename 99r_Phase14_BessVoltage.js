// =============================================================================
// ARGIA ENGINE -- Phase 14 test suite: battery voltage resolution (4b-2.5b)
// Paste into 99_TestRunner.gs, and add the call
//   try { addPhase14BessTests(t, ss); } catch (e) { t.error('Phase14 BESS aborted', e); }
// right after the existing addPhase14Tests block (the v2.1.4 CFE intermedia
// tests, which keep the addPhase14Tests name) in runTests().
//
// SCOPE: Increment 4b-2.5b wired battery voltage into readInputBess. It added
// the resolveBessVoltage helper (01a_ReadInputsBess.gs), the INPUT_BESS C18
// (DC bus) / C19 (AC system) map entries, and the bess.dcBusVoltageV /
// bess.acVoltageV fields. The reader prefers the catalog product's DB voltage
// (lookupBatteryVoltage), falls back to the C18/C19 manual cells, else 0.
//
// This suite covers:
//   - resolveBessVoltage as a pure unit (DB-wins / manual-fallback / junk->0)
//   - the C18/C19 + moved-cell map entries point at the right rows
//   - integration: readInputBess populates dcBusVoltageV/acVoltageV from a
//     CUSTOM_MANUAL battery + manual cells, and from a catalog battery whose
//     DB voltage should override.
//
// SAFETY: snapshots INPUT_PROJECT!D64 and every INPUT_BESS cell it writes
// (C6,C7,C10,C11,C18,C19), and ALWAYS restores in a finally block.
// =============================================================================

function addPhase14BessTests(t, ss) {
  t.suite('Phase14: battery voltage resolution');

  // -- function availability ------------------------------------------------
  t.assert('resolveBessVoltage defined',
           'function', typeof resolveBessVoltage);

  // -- resolveBessVoltage unit checks (pure, no sheet) ---------------------
  t.assert('DB 1200 + blank manual -> 1200',
           1200, resolveBessVoltage(1200, ''));
  t.assert('DB 1200 + manual 600 -> 1200 (DB wins)',
           1200, resolveBessVoltage(1200, 600));
  t.assert('DB 0 + manual 600 -> 600 (manual fallback)',
           600,  resolveBessVoltage(0, 600));
  t.assert('DB 0 + blank manual -> 0 (not supplied)',
           0,    resolveBessVoltage(0, ''));
  t.assert('DB junk + manual 480 -> 480',
           480,  resolveBessVoltage('Loading...', 480));
  t.assert('DB negative + manual 600 -> 600',
           600,  resolveBessVoltage(-5, 600));
  t.assert('both junk -> 0',
           0,    resolveBessVoltage('x', 'y'));

  // -- map entries point at the right INPUT_BESS rows ----------------------
  t.assertTrue('INPUT_MAP.bessDcBusVoltageV exists',
               !!INPUT_MAP.bessDcBusVoltageV);
  t.assertTrue('INPUT_MAP.bessAcVoltageV exists',
               !!INPUT_MAP.bessAcVoltageV);
  t.assert('bessDcBusVoltageV -> INPUT_BESS row 18',
           18, INPUT_MAP.bessDcBusVoltageV.row);
  t.assert('bessAcVoltageV -> INPUT_BESS row 19',
           19, INPUT_MAP.bessAcVoltageV.row);
  t.assert('bessDcBusVoltageV col 3 (C)',
           3,  INPUT_MAP.bessDcBusVoltageV.col);
  // moved cells: capex + the three peak-shaving rows shifted +2
  t.assert('bessCapexMxn -> row 22 (was 20)',
           22, INPUT_MAP.bessCapexMxn.row);
  t.assert('bessLoadFactorFC -> row 25 (was 23)',
           25, INPUT_MAP.bessLoadFactorFC.row);
  t.assert('bessPuntaWindowSummerH -> row 26 (was 24)',
           26, INPUT_MAP.bessPuntaWindowSummerH.row);
  t.assert('bessPuntaWindowWinterH -> row 27 (was 25)',
           27, INPUT_MAP.bessPuntaWindowWinterH.row);

  // -- integration: readInputBess populates the voltage fields -------------
  var shProj = ss.getSheetByName('INPUT_PROJECT');
  var shBess = ss.getSheetByName('INPUT_BESS');
  if (!shProj || !shBess) {
    t.error('Phase14 setup',
            new Error('INPUT_PROJECT or INPUT_BESS sheet missing'));
    return;
  }

  var snap = {
    toggle: shProj.getRange(64, 4).getValue(),
    c6:  shBess.getRange(6,  3).getValue(),
    c7:  shBess.getRange(7,  3).getValue(),
    c10: shBess.getRange(10, 3).getValue(),
    c11: shBess.getRange(11, 3).getValue(),
    c18: shBess.getRange(18, 3).getValue(),
    c19: shBess.getRange(19, 3).getValue(),
  };
  function restore() {
    shProj.getRange(64, 4).setValue(snap.toggle);
    shBess.getRange(6,  3).setValue(snap.c6);
    shBess.getRange(7,  3).setValue(snap.c7);
    shBess.getRange(10, 3).setValue(snap.c10);
    shBess.getRange(11, 3).setValue(snap.c11);
    shBess.getRange(18, 3).setValue(snap.c18);
    shBess.getRange(19, 3).setValue(snap.c19);
    SpreadsheetApp.flush();
  }

  try {
    // CASE 1: CUSTOM_MANUAL battery + manual voltage cells -----------------
    // CUSTOM_MANUAL has DB voltage 0, so the C18/C19 manual cells must win.
    shProj.getRange(64, 4).setValue('YES');
    shBess.getRange(6,  3).setValue('CUSTOM_MANUAL');
    shBess.getRange(7,  3).setValue('SELF_CONSUMPTION_MAX');
    shBess.getRange(10, 3).setValue(200);    // capacity
    shBess.getRange(11, 3).setValue(100);    // power
    shBess.getRange(18, 3).setValue(800);    // manual DC bus V
    shBess.getRange(19, 3).setValue(480);    // manual AC system V
    SpreadsheetApp.flush();

    var b1 = readInputBess(ss);
    t.assertTrue('CASE1: readInputBess returns an object', b1 !== null);
    t.assert('CASE1: CUSTOM_MANUAL -> dcBusVoltageV from manual cell',
             800, b1.dcBusVoltageV);
    t.assert('CASE1: CUSTOM_MANUAL -> acVoltageV from manual cell',
             480, b1.acVoltageV);

    // CASE 2: CUSTOM_MANUAL + blank voltage cells -> 0 (pendiente) ---------
    shBess.getRange(18, 3).setValue('');
    shBess.getRange(19, 3).setValue('');
    SpreadsheetApp.flush();
    var b2 = readInputBess(ss);
    t.assert('CASE2: blank C18 -> dcBusVoltageV 0 (pendiente)',
             0, b2.dcBusVoltageV);
    t.assert('CASE2: blank C19 -> acVoltageV 0',
             0, b2.acVoltageV);

    // CASE 3: catalog battery -> DB voltage overrides manual cell ----------
    // Tries to select a real catalog product so readInputBess uses its DB
    // voltage instead of the manual cell. The manual cell is deliberately
    // set WRONG (600) to prove the DB value (1200) wins.
    //
    // KNOWN ISSUE: INPUT_BESS!C6 has a data-validation dropdown whose
    // allowlist (e.g. CATL_3MWH, BYD_2MWH, HUAWEI_2MWH) does NOT match the
    // actual product IDs in the live 16M_PRODUCTS_BESS DB
    // (HW_LUNA_200KWH, HW_LUNA_2MWH, ...). The dropdown was authored before
    // the Huawei DB landed and never resynced. Until that data-validation
    // list is updated (separate increment), no real DB product can be
    // selected via C6, so CASE 3 cannot exercise the DB-wins path in the
    // live spreadsheet. The DB-wins logic itself IS exercised:
    //   - by the resolveBessVoltage unit checks above
    //     ("DB 1200 + manual 600 -> 1200")
    //   - by the Node integration verification in the increment
    // CASE 3 here is integration belt-and-suspenders, not the proof.
    //
    // Behavior: try to set C6 to a real DB product. If the dropdown allows
    // it, run the override assertion. If it throws (dropdown rejects), log
    // the mismatch loudly and skip -- the test reports the real-world
    // constraint instead of going green on a fake pass.
    var hw = lookupBattery(ss, 'HW_LUNA_200KWH');
    if (hw) {
      var c6CanTakeRealId = true;
      try {
        shBess.getRange(6,  3).setValue('HW_LUNA_200KWH');
        SpreadsheetApp.flush();
      } catch (e) {
        c6CanTakeRealId = false;
        t.info('Phase14 CASE3 SKIPPED',
               'INPUT_BESS!C6 data-validation dropdown rejected '
               + '"HW_LUNA_200KWH" -- the dropdown allowlist is out of sync '
               + 'with 16M_PRODUCTS_BESS. CASE 3 (DB-overrides-manual) was '
               + 'not exercised in the live sheet, but the same logic is '
               + 'covered by resolveBessVoltage unit checks. Fix: resync '
               + 'C6 dropdown values with Battery_IDs from the product DB.');
      }
      if (c6CanTakeRealId) {
        shBess.getRange(18, 3).setValue(600);   // WRONG on purpose
        SpreadsheetApp.flush();
        var b3 = readInputBess(ss);
        t.assert('CASE3: catalog battery -> dcBusVoltageV from DB (1200), '
                 + 'not the wrong manual 600',
                 1200, b3.dcBusVoltageV);
      }
    } else {
      t.info('Phase14 NOTE',
             'HW_LUNA_200KWH not in live DB -- catalog-override case skipped.');
    }

  } finally {
    restore();
    t.info('Phase14 cleanup',
           'INPUT_PROJECT/INPUT_BESS restored to pre-test state');
  }
}