// =============================================================================
// ARGIA ENGINE -- Phase 5 test suite: readInputBess()
// Paste this function into 99_TestRunner.gs, and add the call
//   try { addPhase5Tests(t, ss); } catch (e) { t.error('Phase5 aborted', e); }
// right after the addPhase3Tests / addPhase4Tests block in runTests().
//
// SCOPE: readInputBess() input-layer contract. Spreadsheet-backed:
//   it snapshots INPUT_PROJECT!D64 + INPUT_BESS cells, writes known values,
//   asserts, and restores — never leaves the user's sheet modified.
// =============================================================================

function addPhase5Tests(t, ss) {
  t.suite('Phase5: readInputBess input reader');

  var shProj = ss.getSheetByName('INPUT_PROJECT');
  var shBess = ss.getSheetByName('INPUT_BESS');
  if (!shProj || !shBess) {
    t.error('Phase5 setup', new Error('INPUT_PROJECT or INPUT_BESS sheet missing'));
    return;
  }

  // -- Snapshot every cell readInputBess touches, so we can restore ---------
  var snap = {
    toggle:  shProj.getRange(64, 4).getValue(),   // D64
    c6:  shBess.getRange(6, 3).getValue(),
    c7:  shBess.getRange(7, 3).getValue(),
    c10: shBess.getRange(10, 3).getValue(),
    c11: shBess.getRange(11, 3).getValue(),
    c12: shBess.getRange(12, 3).getValue(),
    c13: shBess.getRange(13, 3).getValue(),
    c14: shBess.getRange(14, 3).getValue(),
    c15: shBess.getRange(15, 3).getValue(),
    c16: shBess.getRange(16, 3).getValue(),
    c17: shBess.getRange(17, 3).getValue(),
    c20: shBess.getRange(20, 3).getValue(),
  };

  function restore() {
    shProj.getRange(64, 4).setValue(snap.toggle);
    shBess.getRange(6, 3).setValue(snap.c6);
    shBess.getRange(7, 3).setValue(snap.c7);
    shBess.getRange(10, 3).setValue(snap.c10);
    shBess.getRange(11, 3).setValue(snap.c11);
    shBess.getRange(12, 3).setValue(snap.c12);
    shBess.getRange(13, 3).setValue(snap.c13);
    shBess.getRange(14, 3).setValue(snap.c14);
    shBess.getRange(15, 3).setValue(snap.c15);
    shBess.getRange(16, 3).setValue(snap.c16);
    shBess.getRange(17, 3).setValue(snap.c17);
    shBess.getRange(20, 3).setValue(snap.c20);
    SpreadsheetApp.flush();
  }

  try {
    // === TEST 1: function exists =========================================
    t.assert('readInputBess function defined',
             'function', typeof readInputBess);

    // === TEST 2: toggle = NO  -> null ====================================
    shProj.getRange(64, 4).setValue('NO');
    SpreadsheetApp.flush();
    t.assertTrue('Toggle NO -> readInputBess returns null',
                 readInputBess(ss) === null);

    // === TEST 3: toggle = YES, capacity 0 -> null ========================
    // Toggle on but designer has not entered specs: must still be null,
    // never a degenerate zero-capacity battery object.
    shProj.getRange(64, 4).setValue('YES');
    shBess.getRange(10, 3).setValue(0);          // capacity = 0
    SpreadsheetApp.flush();
    t.assertTrue('Toggle YES + capacity 0 -> readInputBess returns null',
                 readInputBess(ss) === null);

    // === TEST 4: toggle = YES, full valid specs -> typed object ==========
    // Write a known battery: 200 kWh / 100 kW, default SoC/RTE etc.
    shProj.getRange(64, 4).setValue('YES');
    shBess.getRange(6,  3).setValue('CUSTOM_MANUAL');
    shBess.getRange(7,  3).setValue('SELF_CONSUMPTION_MAX');
    shBess.getRange(10, 3).setValue(200);        // capacityKwh
    shBess.getRange(11, 3).setValue(100);        // powerKw
    shBess.getRange(12, 3).setValue(0.10);       // minSoc
    shBess.getRange(13, 3).setValue(0.90);       // maxSoc
    shBess.getRange(14, 3).setValue(0.90);       // rte
    shBess.getRange(15, 3).setValue(1.0);        // cycles/day
    shBess.getRange(16, 3).setValue(0.025);      // degradation
    shBess.getRange(17, 3).setValue(0.0);        // backup reserve
    shBess.getRange(20, 3).setValue(1500000);    // capex MXN
    SpreadsheetApp.flush();

    var bess = readInputBess(ss);
    t.assertTrue('Toggle YES + valid specs -> object (not null)',
                 bess !== null);

    if (bess) {
      t.assert('bess.capacityKwh',       200,                   bess.capacityKwh);
      t.assert('bess.powerKw',           100,                   bess.powerKw);
      t.assert('bess.strategy',          'SELF_CONSUMPTION_MAX', bess.strategy);
      t.assert('bess.batteryId',         'CUSTOM_MANUAL',        bess.batteryId);
      t.assert('bess.minSocPct',         0.10,                   bess.minSocPct);
      t.assert('bess.maxSocPct',         0.90,                   bess.maxSocPct);
      t.assert('bess.rtePct',            0.90,                   bess.rtePct);
      t.assert('bess.cyclesPerDay',      1.0,                    bess.cyclesPerDay);
      t.assert('bess.degradationPct',    0.025,                  bess.degradationPct);
      t.assert('bess.backupReservePct',  0.0,                    bess.backupReservePct);
      t.assert('bess.capexMxn',          1500000,                bess.capexMxn);

      // === TEST 5: object is directly consumable by calcBessImpact =======
      // The whole point of the typed shape: no field renaming needed.
      // calcBessImpact validates SoC/RTE bounds and throws on bad input;
      // a clean run here proves the contract holds.
      var consumable = true;
      try {
        // daysInMonth defaults inside calcBessImpact; pv block minimal.
        calcBessImpact(
          {},                                   // inp (unused for null-PV path)
          null,                                 // tar
          { monthlyKwh: 0, interconnectionMode: 'MEDICION_NETA' },  // pv
          bess
        );
      } catch (err) {
        // A throw about pv/tar is fine; a throw about a bess field is NOT.
        if (/minSocPct|maxSocPct|rtePct|degradationPct|backupReservePct|strategy/
              .test(err.message)) {
          consumable = false;
        }
      }
      t.assertTrue('bess object passes calcBessImpact field validation',
                   consumable);
    }

    // === TEST 6: blank optional cells fall back to INPUT_MAP defaults ====
    // Clear SoC/RTE; readInput should supply map defaults (0.10 / 0.90 / 0.90).
    shBess.getRange(12, 3).setValue('');
    shBess.getRange(13, 3).setValue('');
    shBess.getRange(14, 3).setValue('');
    SpreadsheetApp.flush();
    var bessDef = readInputBess(ss);
    t.assertTrue('Blank optional cells -> object still returned',
                 bessDef !== null);
    if (bessDef) {
      t.assert('Blank minSoc -> default 0.10', 0.10, bessDef.minSocPct);
      t.assert('Blank maxSoc -> default 0.90', 0.90, bessDef.maxSocPct);
      t.assert('Blank rte   -> default 0.90', 0.90, bessDef.rtePct);
    }

  } finally {
    // ALWAYS restore the user's real data, even if an assertion threw.
    restore();
    t.info('Phase5 cleanup', 'INPUT_PROJECT/INPUT_BESS restored to pre-test state');
  }
}