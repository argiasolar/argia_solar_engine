// =============================================================================
// ARGIA TESTS -- tests_unit/calc/CalcBessBosTests.gs   (BDF-7)
// Unit tests for BoS quantities + voltage drop + NOM checks.
// Tagged 'bdf7'.
// =============================================================================


registerTest({
  id      : 'UNIT_BESS_BOS_QUANTITIES_BDF7',
  group   : 'unit',
  module  : 'calc/bess_bos',
  scenarios: [],
  tags    : ['unit', 'calc', 'bess', 'bdf7'],
  source  : 'tests_unit/calc/CalcBessBosTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/bess_bos: BoS quantity calculation');

    // Synthetic circuit result mimicking calcBessCircuit output
    var dcCircuit = {
      sizeable: true,
      coupling: 'DC_COUPLED',
      runs: [{
        name: 'Battery <-> shared DC bus',
        side: 'DC',
        designCurrentA: 1250,
        cuAreaMm2: 67.43,
        conductorLabel: 'AWG 2/0',
        egcLabel: 'AWG 6',
        ocpdAmps: 1600, ocpdLabel: '1600A',
        parallels: 1,
      }],
    };
    var acCircuit = {
      sizeable: true,
      coupling: 'AC_COUPLED',
      runs: [
        {
          name: 'Battery <-> PCS (DC)', side: 'DC',
          designCurrentA: 1250, cuAreaMm2: 67.43,
          conductorLabel: 'AWG 2/0', egcLabel: 'AWG 6',
          ocpdAmps: 1600, ocpdLabel: '1600A', parallels: 1,
        },
        {
          name: 'PCS <-> panelboard (AC)', side: 'AC',
          designCurrentA: 1804, cuAreaMm2: 107.20,
          conductorLabel: 'AWG 4/0', egcLabel: 'AWG 4',
          ocpdAmps: 2000, ocpdLabel: '2000A', parallels: 1,
        },
      ],
    };
    var bess = {
      batteryId: 'BYD_2MWH_x5', baseBatteryId: 'BYD_2MWH',
      stackQty: 5, capacityKwh: 10000, powerKw: 5000,
    };
    var ctxDcCoupled = {
      coupling: 'DC_COUPLED', dcBusV: 800, acV: 0,
      dcRunM: 25, acRunM: 0, gecRunM: 15,
      cablePath: 'INTEMPERIE', commissioningMxn: 250000,
    };
    var ctxAcCoupled = {
      coupling: 'AC_COUPLED', dcBusV: 800, acV: 480,
      dcRunM: 10, acRunM: 50, gecRunM: 15,
      cablePath: 'CONDUIT_ENTERRADO', commissioningMxn: 250000,
    };

    // ==== TEST 1: blocked when circuit not sizeable =====================
    var blocked = calcBessBosQuantities({
      bess: bess,
      circuit: { sizeable: false, reason: 'Missing DC bus voltage; cannot size DC circuit', runs: [] },
      installContext: ctxDcCoupled,
    });
    t.assert('Blocked when circuit not sizeable', true, blocked.blocked);
    t.assert('Empty lines when blocked', 0, blocked.lines.length);
    // Reason text propagates from circuit.reason (or falls back to internal message)
    t.assertTrue('Reason text present', String(blocked.reason || '').length > 0);
    t.assertTrue('Reason mentions DC bus or sizeable',
                 blocked.reason.indexOf('DC') >= 0 ||
                 blocked.reason.indexOf('sizeable') >= 0);

    // ==== TEST 2: DC_COUPLED produces expected lines ====================
    var rDc = calcBessBosQuantities({
      bess: bess, circuit: dcCircuit, installContext: ctxDcCoupled,
    });
    t.assertFalse('DC_COUPLED not blocked', rDc.blocked);
    // Expected lines: battery (1), DC cable (2), DC EGC (3),
    //                 DC conduit (6), DC OCPD (8), GEC (11), commissioning (12)
    // NO AC cable/EGC/conduit/breaker/disconnect for DC_COUPLED
    var codes = rDc.lines.map(function(l) { return l.code; });
    t.assertTrue('DC_COUPLED has BESS-01 (battery)',     codes.indexOf('BESS-01') >= 0);
    t.assertTrue('DC_COUPLED has BESS-02 (DC cable)',    codes.indexOf('BESS-02') >= 0);
    t.assertTrue('DC_COUPLED has BESS-03 (DC EGC)',      codes.indexOf('BESS-03') >= 0);
    t.assertTrue('DC_COUPLED has NO BESS-04 (AC cable)', codes.indexOf('BESS-04') < 0);
    t.assertTrue('DC_COUPLED has NO BESS-05 (AC EGC)',   codes.indexOf('BESS-05') < 0);
    t.assertTrue('DC_COUPLED has BESS-06 (DC conduit)',  codes.indexOf('BESS-06') >= 0);
    t.assertTrue('DC_COUPLED has NO BESS-07 (AC conduit)', codes.indexOf('BESS-07') < 0);
    t.assertTrue('DC_COUPLED has BESS-08 (DC OCPD)',     codes.indexOf('BESS-08') >= 0);
    t.assertTrue('DC_COUPLED has NO BESS-09 (AC OCPD)',  codes.indexOf('BESS-09') < 0);
    t.assertTrue('DC_COUPLED has NO BESS-10 (disconnect)', codes.indexOf('BESS-10') < 0);
    t.assertTrue('DC_COUPLED has BESS-11 (GEC)',         codes.indexOf('BESS-11') >= 0);
    t.assertTrue('DC_COUPLED has BESS-12 (commissioning)', codes.indexOf('BESS-12') >= 0);

    // ==== TEST 3: AC_COUPLED produces ALL lines =========================
    var rAc = calcBessBosQuantities({
      bess: bess, circuit: acCircuit, installContext: ctxAcCoupled,
    });
    var codesAc = rAc.lines.map(function(l) { return l.code; });
    var expectedAcCodes = ['BESS-01','BESS-02','BESS-03','BESS-04','BESS-05',
                           'BESS-06','BESS-07','BESS-08','BESS-09','BESS-10',
                           'BESS-11','BESS-12'];
    for (var i = 0; i < expectedAcCodes.length; i++) {
      t.assertTrue('AC_COUPLED has ' + expectedAcCodes[i],
                   codesAc.indexOf(expectedAcCodes[i]) >= 0);
    }

    // ==== TEST 4: DC cable meters = 2 * parallels * length ==============
    var line2 = rDc.lines.find(function(l) { return l.code === 'BESS-02'; });
    t.assert('DC cable meters = 2 conductors × 1 parallel × 25 m = 50 m',
             50, line2.qty);
    t.assert('DC cable unit = m', 'm', line2.unit);

    // ==== TEST 5: DC EGC meters = 1 * parallels * length ================
    var line3 = rDc.lines.find(function(l) { return l.code === 'BESS-03'; });
    t.assert('DC EGC meters = 1 conductor × 1 parallel × 25 m = 25 m',
             25, line3.qty);

    // ==== TEST 6: AC cable meters = 3 * parallels * length ==============
    var line4 = rAc.lines.find(function(l) { return l.code === 'BESS-04'; });
    t.assert('AC cable meters = 3 phases × 1 parallel × 50 m = 150 m',
             150, line4.qty);

    // ==== TEST 7: Battery line uses stackQty for qty ====================
    var line1 = rAc.lines.find(function(l) { return l.code === 'BESS-01'; });
    t.assert('Battery line qty = stackQty (5)', 5, line1.qty);
    t.assert('Battery line unit = u', 'u', line1.unit);
    t.assert('Battery line category', 'BESS_BATTERY', line1.productCategory);
    t.assert('Battery productSpec carries baseBatteryId',
             'BYD_2MWH', line1.productSpec.batteryId);
    // Description shows "5 ×" format
    t.assertTrue('Battery description includes "5 ×"',
                 line1.description.indexOf('5 \u00d7') >= 0 ||
                 line1.description.indexOf('5 x') >= 0);

    // ==== TEST 8: Single-unit battery has different description =========
    var solo = calcBessBosQuantities({
      bess: { batteryId: 'BYD_2MWH', baseBatteryId: 'BYD_2MWH',
              stackQty: 1, capacityKwh: 2000, powerKw: 1000 },
      circuit: dcCircuit, installContext: ctxDcCoupled,
    });
    var soloLine = solo.lines.find(function(l) { return l.code === 'BESS-01'; });
    t.assert('Single-unit battery qty = 1', 1, soloLine.qty);
    // BDF-8: description is now "Sistema BESS <id>" (no colon, short form).
    // Full capacity/power breakdown moved to soloLine.detail (rendered as
    // cell note in BOM, not in the visible description column).
    t.assertTrue('Single-unit description starts with "Sistema BESS"',
                 soloLine.description.indexOf('Sistema BESS') === 0);

    // ==== TEST 9: NOM citations present on cable lines ==================
    t.assertTrue('DC cable line has NOM 690 citation',
                 line2.nomCite.indexOf('690') >= 0);
    t.assertTrue('DC EGC line has NOM 250 citation',
                 line3.nomCite.indexOf('250') >= 0);

    // ==== TEST 10: Conduit type from cablePath ==========================
    var conduitDc = rDc.lines.find(function(l) { return l.code === 'BESS-06'; });
    t.assertTrue('INTEMPERIE -> outdoor conduit',
                 conduitDc.description.indexOf('intemperie') >= 0 ||
                 conduitDc.description.indexOf('RGS') >= 0);
    var conduitDcBuried = rAc.lines.find(function(l) { return l.code === 'BESS-06'; });
    t.assertTrue('CONDUIT_ENTERRADO -> buried PVC',
                 conduitDcBuried.description.indexOf('enterrado') >= 0 ||
                 conduitDcBuried.description.indexOf('schedule 80') >= 0);

    // ==== TEST 11: Commissioning line skipped when fee = 0 ==============
    var noComm = calcBessBosQuantities({
      bess: bess, circuit: dcCircuit,
      installContext: Object.assign({}, ctxDcCoupled, { commissioningMxn: 0 }),
    });
    var hasComm = noComm.lines.some(function(l) { return l.code === 'BESS-12'; });
    t.assertFalse('No BESS-12 line when commissioning fee = 0', hasComm);

    // ==== TEST 12: GEC line skipped when gecRunM = 0 ====================
    var noGec = calcBessBosQuantities({
      bess: bess, circuit: dcCircuit,
      installContext: Object.assign({}, ctxDcCoupled, { gecRunM: 0 }),
    });
    var hasGec = noGec.lines.some(function(l) { return l.code === 'BESS-11'; });
    t.assertFalse('No BESS-11 line when gecRunM = 0', hasGec);
  }
});


registerTest({
  id      : 'UNIT_BESS_VOLTAGE_DROP_BDF7',
  group   : 'unit',
  module  : 'calc/bess_voltage_drop',
  scenarios: [],
  tags    : ['unit', 'calc', 'bess', 'bdf7'],
  source  : 'tests_unit/calc/CalcBessBosTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/bess_voltage_drop: %VD calculation');

    var nom = {
      cuResistivity: 0.0172,
      dcVdropTarget: 0.03, dcVdropHard: 0.05,
      acVdropTarget: 0.03, acVdropHard: 0.05,
    };

    // ==== TEST 1: blocked when circuit not sizeable =====================
    var blocked = calcBessVoltageDrop({
      circuit: { sizeable: false, reason: 'no voltage' },
      installContext: { dcRunM: 25, dcBusV: 800 },
      nom: nom,
    });
    t.assert('Blocked when circuit not sizeable', true, blocked.blocked);

    // ==== TEST 2: DC voltage drop passes ================================
    // Vdrop% = (2 × 25 × 0.0172 / 67.43 × 1250) / 800
    //       = (50 × 0.000255 × 1250) / 800
    //       = 15.95 / 800 = 0.01993 = 1.99% -> PASS (target 3%)
    var dcCheck = calcBessVoltageDrop({
      circuit: {
        sizeable: true, coupling: 'DC_COUPLED',
        runs: [{
          name: 'DC run', side: 'DC',
          designCurrentA: 1250, cuAreaMm2: 67.43,
        }],
      },
      installContext: { dcRunM: 25, dcBusV: 800 },
      nom: nom,
    });
    t.assert('1 DC check produced', 1, dcCheck.checks.length);
    t.assert('DC check status = PASS', 'PASS', dcCheck.checks[0].status);
    t.assertNear('DC vdropPct \u2248 0.0199',
                 0.0199, dcCheck.checks[0].vdropPct, 0.001);

    // ==== TEST 3: DC voltage drop REVIEW (target<X<hard) ================
    // Make length 60m -> vdrop ~4.8% -> REVIEW
    var dcReview = calcBessVoltageDrop({
      circuit: {
        sizeable: true, coupling: 'DC_COUPLED',
        runs: [{ side: 'DC', designCurrentA: 1250, cuAreaMm2: 67.43, name: 'DC' }],
      },
      installContext: { dcRunM: 60, dcBusV: 800 },
      nom: nom,
    });
    t.assert('DC vdrop 4.8% -> REVIEW',
             'REVIEW', dcReview.checks[0].status);

    // ==== TEST 4: DC voltage drop FAIL ==================================
    // 100m run -> vdrop ~8% -> FAIL
    var dcFail = calcBessVoltageDrop({
      circuit: {
        sizeable: true, coupling: 'DC_COUPLED',
        runs: [{ side: 'DC', designCurrentA: 1250, cuAreaMm2: 67.43, name: 'DC' }],
      },
      installContext: { dcRunM: 100, dcBusV: 800 },
      nom: nom,
    });
    t.assert('DC vdrop 8% -> FAIL', 'FAIL', dcFail.checks[0].status);

    // ==== TEST 5: AC voltage drop sqrt(3) factor ========================
    // Vdrop% = (1.732 × 50 × 0.0172 / 107.20 × 1804) / 480
    //       = (1.732 × 50 × 0.000160 × 1804) / 480
    //       = 25.04 / 480 = 0.0522 = 5.22% -> FAIL (just above 5%)
    var acCheck = calcBessVoltageDrop({
      circuit: {
        sizeable: true, coupling: 'AC_COUPLED',
        runs: [{ side: 'AC', designCurrentA: 1804, cuAreaMm2: 107.20, name: 'AC' }],
      },
      installContext: { acRunM: 50, acV: 480 },
      nom: nom,
    });
    t.assert('AC check produced', 1, acCheck.checks.length);
    t.assertTrue('AC vdrop 5.2% -> REVIEW or FAIL',
                 acCheck.checks[0].status === 'REVIEW' ||
                 acCheck.checks[0].status === 'FAIL');

    // ==== TEST 6: Run blocked when length/voltage missing ===============
    var noLen = calcBessVoltageDrop({
      circuit: {
        sizeable: true, coupling: 'DC_COUPLED',
        runs: [{ side: 'DC', designCurrentA: 1000, cuAreaMm2: 67.43, name: 'DC' }],
      },
      installContext: { dcRunM: 0, dcBusV: 800 },
      nom: nom,
    });
    t.assert('Run blocked when dcRunM=0',
             'BLOCKED', noLen.checks[0].status);

    // ==== TEST 7: Formula text present in output ========================
    t.assertTrue('Formula text included',
                 dcCheck.checks[0].formula.indexOf('Vdrop') >= 0);
  }
});


registerTest({
  id      : 'UNIT_BESS_NOM_CHECKS_BDF7',
  group   : 'unit',
  module  : 'calc/bess_nom_checks',
  scenarios: [],
  tags    : ['unit', 'calc', 'bess', 'bdf7'],
  source  : 'tests_unit/calc/CalcBessBosTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/bess_nom_checks: disconnect + GEC sizing');

    var dcCircuit = {
      sizeable: true, coupling: 'DC_COUPLED',
      runs: [{
        side: 'DC', designCurrentA: 1250, cuAreaMm2: 67.43,
        conductorLabel: 'AWG 2/0', name: 'DC',
      }],
    };
    var acCircuit = {
      sizeable: true, coupling: 'AC_COUPLED',
      runs: [
        { side: 'DC', designCurrentA: 1250, cuAreaMm2: 67.43, name: 'DC' },
        { side: 'AC', designCurrentA: 1804, cuAreaMm2: 107.20, name: 'AC' },
      ],
    };

    // ==== TEST 1: AC_COUPLED with disconnect line in BoS = PASS =========
    var withDisc = calcBessNomChecks({
      circuit: acCircuit,
      bos: { lines: [
        { code: 'BESS-10', productSpec: { side: 'DISCONNECT_AC' } },
        { code: 'BESS-11', productSpec: { side: 'GEC' }, qty: 15 },
      ]},
      installContext: { coupling: 'AC_COUPLED', gecRunM: 15 },
    });
    var discCheck = withDisc.checks.find(function(c) { return c.id === 'BESS_DISCONNECT_AC'; });
    t.assert('AC disconnect present -> PASS', 'PASS', discCheck.status);
    t.assertTrue('Disconnect cite mentions 690-13',
                 discCheck.nomCite.indexOf('690-13') >= 0);

    // ==== TEST 2: AC_COUPLED WITHOUT disconnect = FAIL ==================
    var noDisc = calcBessNomChecks({
      circuit: acCircuit,
      bos: { lines: [{ code: 'BESS-11', productSpec: { side: 'GEC' }, qty: 15 }] },
      installContext: { coupling: 'AC_COUPLED', gecRunM: 15 },
    });
    var noDiscCheck = noDisc.checks.find(function(c) { return c.id === 'BESS_DISCONNECT_AC'; });
    t.assert('Missing AC disconnect -> FAIL', 'FAIL', noDiscCheck.status);

    // ==== TEST 3: DC_COUPLED reports DC disconnect info row =============
    var dcOnly = calcBessNomChecks({
      circuit: dcCircuit,
      bos: { lines: [{ code: 'BESS-11', productSpec: { side: 'GEC' }, qty: 15 }] },
      installContext: { coupling: 'DC_COUPLED', gecRunM: 15 },
    });
    var dcDisc = dcOnly.checks.find(function(c) { return c.id === 'BESS_DISCONNECT_DC'; });
    t.assert('DC_COUPLED disconnect = PASS (info)', 'PASS', dcDisc.status);

    // ==== TEST 4: GEC required size per largest conductor ==============
    // Largest = 107.20 mm² (4/0 AWG). Per NOM 250-66 (NEC equivalent):
    //   "up to 4/0 AWG (107.20 mm²)" bin -> GEC = #4 AWG (21.15 mm²)
    // The table lookup uses `<=`, so 107.20 hits the third row "upTo: 107.20".
    var gecCheck = withDisc.checks.find(function(c) { return c.id === 'BESS_GEC_SIZING'; });
    t.assert('GEC required size = 21.15 mm² for 107.20 mm² ungrounded (NOM 250-66 bin: up to 4/0 AWG)',
             21.15, gecCheck.requiredGecMm2);
    t.assert('GEC status = PASS (line present, length > 0)',
             'PASS', gecCheck.status);

    // ==== TEST 5: GEC missing from BoS = FAIL ==========================
    var noGec = calcBessNomChecks({
      circuit: dcCircuit,
      bos: { lines: [] },
      installContext: { coupling: 'DC_COUPLED', gecRunM: 15 },
    });
    var noGecCheck = noGec.checks.find(function(c) { return c.id === 'BESS_GEC_SIZING'; });
    t.assert('Missing GEC line -> FAIL', 'FAIL', noGecCheck.status);

    // ==== TEST 6: GEC line present but gecRunM = 0 = REVIEW =============
    var zeroLen = calcBessNomChecks({
      circuit: dcCircuit,
      bos: { lines: [{ code: 'BESS-11', productSpec: { side: 'GEC' }, qty: 0 }] },
      installContext: { coupling: 'DC_COUPLED', gecRunM: 0 },
    });
    var zeroLenCheck = zeroLen.checks.find(function(c) { return c.id === 'BESS_GEC_SIZING'; });
    t.assert('GEC line present but length=0 -> REVIEW',
             'REVIEW', zeroLenCheck.status);

    // ==== TEST 7: Largest conductor smaller -> smaller GEC ==============
    var small = calcBessNomChecks({
      circuit: {
        sizeable: true, coupling: 'DC_COUPLED',
        runs: [{ side: 'DC', cuAreaMm2: 21.15, name: 'DC' }],  // #4 AWG
      },
      bos: { lines: [{ code: 'BESS-11', productSpec: { side: 'GEC' }, qty: 10 }] },
      installContext: { coupling: 'DC_COUPLED', gecRunM: 10 },
    });
    var smallGec = small.checks.find(function(c) { return c.id === 'BESS_GEC_SIZING'; });
    // 21.15 mm² fits in "up to 33.62" bin → required = 8.37 mm² (#8 AWG)
    t.assert('GEC required = 8.37 mm² for 21.15 mm² ungrounded',
             8.37, smallGec.requiredGecMm2);
  }
});
