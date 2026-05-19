// =============================================================================
// ARGIA ENGINE -- Phase 9 test suite: calcBessCircuit (Increment 4b-1)
// Paste this function into 99_TestRunner.gs, and add the call
//   try { addPhase9Tests(t, ss); } catch (e) { t.error('Phase9 aborted', e); }
// right after the addPhase8Tests block in runTests().
//
// SCOPE: calcBessCircuit() -- the battery circuit sizing calculator. PURE
// unit tests: a small synthetic elec-table fixture is used so the test does
// not depend on 15M_ELEC_TABLES contents. All expected values hand-derived.
//
// HAND-DERIVED REFERENCE (battery powerKw 100, nom.bess.dcCurrentFactor 1.25):
//   DC run  (dcBusVoltageV 600):  I = 100000/600          = 166.6667 A
//                                 design = I * 1.25       = 208.3333 A
//   AC run  (acVoltageV 480, 3ph): I = 100000/(sqrt3*480) = 120.2813 A
//                                 design = I * 1.25       = 150.3516 A
//   Breaker ladder [...150,175,200,225,250...]:
//     DC design 208.33 -> nextBreaker -> 225
//     AC design 150.35 -> nextBreaker -> 175
//   Conductor ladder by ampacity (synthetic): first >= designA.
// =============================================================================

function addPhase9Tests(t, ss) {
  t.suite('Phase9: calcBessCircuit sizing');

  // -- synthetic elec tables (self-contained; not from 15M_ELEC_TABLES) ----
  // conductors: size + 90C ampacity. breakers: standard ladder.
  // groundTable: ocpdMaxA -> egcSize.
  var TBLS = {
    conductors: [
      { size: '8',   ampacity: 55,  cuAreaMm2: 8.37,  insAreaMm2: 23 },
      { size: '6',   ampacity: 75,  cuAreaMm2: 13.3,  insAreaMm2: 32 },
      { size: '4',   ampacity: 95,  cuAreaMm2: 21.2,  insAreaMm2: 46 },
      { size: '2',   ampacity: 130, cuAreaMm2: 33.6,  insAreaMm2: 67 },
      { size: '1',   ampacity: 145, cuAreaMm2: 42.4,  insAreaMm2: 80 },
      { size: '1/0', ampacity: 170, cuAreaMm2: 53.5,  insAreaMm2: 98 },
      { size: '2/0', ampacity: 195, cuAreaMm2: 67.4,  insAreaMm2: 117 },
      { size: '3/0', ampacity: 225, cuAreaMm2: 85.0,  insAreaMm2: 140 },
      { size: '4/0', ampacity: 260, cuAreaMm2: 107.2, insAreaMm2: 168 },
    ],
    breakers: [100, 110, 125, 150, 175, 200, 225, 250, 300, 350, 400],
    groundTable: [
      { ocpdMaxA: 100, egcSize: '8',   cuAreaMm2: 8.37 },
      { ocpdMaxA: 200, egcSize: '6',   cuAreaMm2: 13.3 },
      { ocpdMaxA: 300, egcSize: '4',   cuAreaMm2: 21.2 },
      { ocpdMaxA: 400, egcSize: '2',   cuAreaMm2: 33.6 },
    ],
  };
  // synthetic nom.bess (matches Increment 4a values)
  var NOM = { bess: { dcCurrentFactor: 1.25, rteFloor: 0.90 } };

  var BESS = { powerKw: 100, rtePct: 0.91 };

  // === TEST 1: function + constants exist ================================
  t.assert('calcBessCircuit function defined',
           'function', typeof calcBessCircuit);
  t.assert('BESS_COUPLING.DC_COUPLED', 'DC_COUPLED', BESS_COUPLING.DC_COUPLED);
  t.assert('BESS_COUPLING.AC_COUPLED', 'AC_COUPLED', BESS_COUPLING.AC_COUPLED);

  // === TEST 2: invalid coupling throws ===================================
  var threw = false;
  try {
    calcBessCircuit({ coupling: 'BOGUS', bess: BESS, tbls: TBLS, nom: NOM,
                      dcBusVoltageV: 600 });
  } catch (e) { threw = true; }
  t.assertTrue('Invalid coupling -> throws', threw);

  // === TEST 3: DC_COUPLED sizes exactly ONE run ==========================
  var dc = calcBessCircuit({
    coupling: BESS_COUPLING.DC_COUPLED,
    bess: BESS, tbls: TBLS, nom: NOM,
    dcBusVoltageV: 600,
  });
  t.assertTrue('DC_COUPLED -> sizeable true', dc.sizeable);
  t.assert('DC_COUPLED -> exactly 1 run', 1, dc.runs.length);
  t.assert('DC_COUPLED run side = DC', 'DC', dc.runs[0].side);

  // === TEST 4: DC run sizing math ========================================
  // I = 100000/600 = 166.6667 ; design = *1.25 = 208.3333
  var dcRun = dc.runs[0];
  t.assert('DC run: circuitCurrentA', 166.6667, dcRun.circuitCurrentA, 0.001);
  t.assert('DC run: designCurrentA',  208.3333, dcRun.designCurrentA,  0.001);
  // designA 208.33 -> conductor first ampacity >= 208.33 -> 3/0 (225)
  t.assert('DC run: conductorSize = 3/0', '3/0', dcRun.conductorSize);
  t.assert('DC run: conductorAmpacity = 225', 225, dcRun.conductorAmpacity);
  // nextBreaker(208.33) -> 225
  t.assert('DC run: ocpdA = 225', 225, dcRun.ocpdA);
  // getEgcSize(225) -> first ocpdMaxA >= 225 -> 300 row -> '4'
  t.assert('DC run: egcSize = 4', '4', dcRun.egcSize);

  // === TEST 5: AC_COUPLED sizes TWO runs (DC + AC) =======================
  var ac = calcBessCircuit({
    coupling: BESS_COUPLING.AC_COUPLED,
    bess: BESS, tbls: TBLS, nom: NOM,
    dcBusVoltageV: 600, acVoltageV: 480, acPhases: 3,
  });
  t.assertTrue('AC_COUPLED -> sizeable true', ac.sizeable);
  t.assert('AC_COUPLED -> exactly 2 runs', 2, ac.runs.length);
  t.assert('AC_COUPLED run[0] side = DC', 'DC', ac.runs[0].side);
  t.assert('AC_COUPLED run[1] side = AC', 'AC', ac.runs[1].side);

  // === TEST 6: AC run sizing math ========================================
  // 3-phase: I = 100000/(sqrt3*480) = 120.2813 ; design = *1.25 = 150.3516
  var acRun = ac.runs[1];
  t.assert('AC run: circuitCurrentA', 120.2813, acRun.circuitCurrentA, 0.001);
  t.assert('AC run: designCurrentA',  150.3516, acRun.designCurrentA,  0.001);
  // designA 150.35 -> conductor first ampacity >= 150.35 -> 1/0 (170)
  t.assert('AC run: conductorSize = 1/0', '1/0', acRun.conductorSize);
  // nextBreaker(150.35) -> 175
  t.assert('AC run: ocpdA = 175', 175, acRun.ocpdA);
  // getEgcSize(175) -> first ocpdMaxA >= 175 -> 200 row -> '6'
  t.assert('AC run: egcSize = 6', '6', acRun.egcSize);

  // === TEST 7: AC_COUPLED DC run identical to DC_COUPLED DC run ===========
  // The battery<->PCS DC run must size the same as the shared-bus DC run
  // at the same voltage -- only the run NAME differs.
  t.assert('AC_COUPLED DC run designA == DC_COUPLED DC run designA',
           dcRun.designCurrentA, ac.runs[0].designCurrentA, 0.0001);

  // === TEST 8: missing DC voltage -> honest not-sizeable =================
  var noDcV = calcBessCircuit({
    coupling: BESS_COUPLING.DC_COUPLED,
    bess: BESS, tbls: TBLS, nom: NOM,
    // dcBusVoltageV omitted
  });
  t.assertFalse('Missing dcBusVoltageV -> sizeable false', noDcV.sizeable);
  t.assertTrue('Missing dcBusVoltageV -> gives a reason',
               typeof noDcV.reason === 'string' && noDcV.reason.length > 0);
  t.assert('Missing dcBusVoltageV -> no runs', 0, noDcV.runs.length);

  // === TEST 9: AC_COUPLED missing AC voltage -> not-sizeable =============
  var noAcV = calcBessCircuit({
    coupling: BESS_COUPLING.AC_COUPLED,
    bess: BESS, tbls: TBLS, nom: NOM,
    dcBusVoltageV: 600,   // acVoltageV omitted
  });
  t.assertFalse('AC_COUPLED missing acVoltageV -> sizeable false',
                noAcV.sizeable);

  // === TEST 10: validation -- zero power throws ==========================
  var threwPower = false;
  try {
    calcBessCircuit({ coupling: BESS_COUPLING.DC_COUPLED,
                      bess: { powerKw: 0 }, tbls: TBLS, nom: NOM,
                      dcBusVoltageV: 600 });
  } catch (e) { threwPower = true; }
  t.assertTrue('bess.powerKw = 0 -> throws', threwPower);

  // === TEST 11: low-RTE advisory warning =================================
  var lowRte = calcBessCircuit({
    coupling: BESS_COUPLING.DC_COUPLED,
    bess: { powerKw: 100, rtePct: 0.80 },   // below 0.90 floor
    tbls: TBLS, nom: NOM, dcBusVoltageV: 600,
  });
  t.assertTrue('Low RTE -> warning raised', lowRte.warnings.length >= 1);

  // === TEST 12: single-phase AC run ======================================
  // 1-phase: I = 100000/480 = 208.333 ; design = *1.25 = 260.4167
  var ac1ph = calcBessCircuit({
    coupling: BESS_COUPLING.AC_COUPLED,
    bess: BESS, tbls: TBLS, nom: NOM,
    dcBusVoltageV: 600, acVoltageV: 480, acPhases: 1,
  });
  t.assert('1-phase AC run: designCurrentA',
           260.4167, ac1ph.runs[1].designCurrentA, 0.001);
}