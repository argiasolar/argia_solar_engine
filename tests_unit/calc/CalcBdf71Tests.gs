// =============================================================================
// ARGIA TESTS -- tests_unit/calc/CalcBdf71Tests.gs   (BDF-7.1)
// Tests for the cross-reader consistency fixes:
//   1. resolveBessVoltage manual-first ordering
//   2. Coupling injection contract for BoS/VD/NOM
//   3. Stacked-label batteryId resolution shape
// Tagged 'bdf7_1'.
// =============================================================================


registerTest({
  id      : 'UNIT_BDF71_VOLTAGE_MANUAL_FIRST',
  group   : 'unit',
  module  : 'reader/voltage_order',
  scenarios: [],
  tags    : ['unit', 'reader', 'bess', 'bdf7_1'],
  source  : 'tests_unit/calc/CalcBdf71Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT reader/voltage_order: manual cell beats DB');

    // ==== TEST 1: manual present, DB also present -> manual wins ========
    t.assert('Manual 1200 V wins over DB 800 V',
             1200, resolveBessVoltage(800, 1200));

    // ==== TEST 2: manual blank, DB present -> DB ========================
    t.assert('Manual blank, DB 800 V used',
             800, resolveBessVoltage(800, ''));
    t.assert('Manual 0, DB 800 V used',
             800, resolveBessVoltage(800, 0));
    t.assert('Manual null, DB 800 V used',
             800, resolveBessVoltage(800, null));

    // ==== TEST 3: both blank -> 0 ======================================
    t.assert('Both blank returns 0',
             0, resolveBessVoltage(0, 0));
    t.assert('Both null returns 0',
             0, resolveBessVoltage(null, null));

    // ==== TEST 4: manual NaN/text -> falls through to DB ================
    t.assert('Manual "abc" treated as absent, DB 800 used',
             800, resolveBessVoltage(800, 'abc'));

    // ==== TEST 5: manual negative -> treated as absent ===================
    t.assert('Manual -100 treated as absent, DB 800 used',
             800, resolveBessVoltage(800, -100));
  }
});


registerTest({
  id      : 'UNIT_BDF71_COUPLING_INJECTION_CONTRACT',
  group   : 'unit',
  module  : 'calc/coupling_contract',
  scenarios: [],
  tags    : ['unit', 'calc', 'bess', 'bdf7_1'],
  source  : 'tests_unit/calc/CalcBdf71Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/coupling_contract: calc functions read injected coupling');

    // Test that BoS, VD, and NOM calcs all see the SAME coupling value
    // when the orchestrator injects it. This is the cross-reader
    // consistency check that would have caught the BDF-7 R1 bug where
    // INPUT_BESS!C43 (stale AC_COUPLED) disagreed with INPUT_DESIGN!C17
    // (DC_COUPLED).

    var circuit = {
      sizeable: true, coupling: 'DC_COUPLED',
      runs: [{
        name: 'DC', side: 'DC',
        designCurrentA: 1000, cuAreaMm2: 67.43,
        conductorLabel: 'AWG 2/0', egcLabel: 'AWG 6',
        ocpdAmps: 1200, ocpdLabel: '1200A', parallels: 1,
      }],
    };
    var bess = {
      batteryId: 'TEST_BAT', baseBatteryId: 'TEST_BAT',
      stackQty: 1, capacityKwh: 2000, powerKw: 1000,
    };
    // Inject coupling matching circuit (BDF-7.1 orchestrator behavior)
    var ctxOk = {
      coupling: 'DC_COUPLED',
      dcBusV: 800, acV: 480, dcRunM: 25, acRunM: 0, gecRunM: 15,
      cablePath: 'INTEMPERIE', commissioningMxn: 250000,
    };
    var nom = {
      cuResistivity: 0.0172,
      dcVdropTarget: 0.03, dcVdropHard: 0.05,
      acVdropTarget: 0.03, acVdropHard: 0.05,
    };

    // ==== TEST 1: BoS reads injected coupling correctly ================
    var bos = calcBessBosQuantities({
      bess: bess, circuit: circuit, installContext: ctxOk, nom: nom,
    });
    var hasAcLines = bos.lines.some(function(l) {
      return l.code === 'BESS-04' || l.code === 'BESS-05'
          || l.code === 'BESS-10';
    });
    t.assertFalse('DC_COUPLED produces NO AC lines (BoS read coupling correctly)',
                  hasAcLines);

    // ==== TEST 2: NOM checks report DC disconnect, not AC ==============
    var nc = calcBessNomChecks({
      circuit: circuit, bos: bos, installContext: ctxOk,
    });
    var discId = nc.checks.find(function(c) {
      return c.id === 'BESS_DISCONNECT_DC' || c.id === 'BESS_DISCONNECT_AC';
    });
    t.assert('DC_COUPLED triggers DC disconnect check, NOT AC',
             'BESS_DISCONNECT_DC', discId.id);
    t.assert('DC disconnect check is PASS (info row)',
             'PASS', discId.status);

    // ==== TEST 3: Defensive — circuit.coupling alone (orchestrator
    // path bypassed) still works
    var ctxNoCoupling = {
      // No coupling key, just like readBessInstallContext returns now
      dcBusV: 800, acV: 480, dcRunM: 25, acRunM: 0, gecRunM: 15,
      cablePath: 'INTEMPERIE', commissioningMxn: 250000,
    };
    var bosDefensive = calcBessBosQuantities({
      bess: bess, circuit: circuit, installContext: ctxNoCoupling, nom: nom,
    });
    var hasAcLinesDef = bosDefensive.lines.some(function(l) {
      return l.code === 'BESS-04' || l.code === 'BESS-10';
    });
    t.assertFalse('Without ctx.coupling, falls back to circuit.coupling (DC_COUPLED) — still NO AC lines',
                  hasAcLinesDef);

    // ==== TEST 4: Confirm AC_COUPLED works same way (sanity) ===========
    var acCircuit = {
      sizeable: true, coupling: 'AC_COUPLED',
      runs: [
        { name: 'DC', side: 'DC', designCurrentA: 1000, cuAreaMm2: 67.43,
          conductorLabel: 'AWG 2/0', egcLabel: 'AWG 6',
          ocpdAmps: 1200, ocpdLabel: '1200A', parallels: 1 },
        { name: 'AC', side: 'AC', designCurrentA: 1500, cuAreaMm2: 107.20,
          conductorLabel: 'AWG 4/0', egcLabel: 'AWG 4',
          ocpdAmps: 1600, ocpdLabel: '1600A', parallels: 1 },
      ],
    };
    var ctxAc = {
      coupling: 'AC_COUPLED',
      dcBusV: 800, acV: 480, dcRunM: 25, acRunM: 50, gecRunM: 15,
      cablePath: 'INTEMPERIE', commissioningMxn: 250000,
    };
    var bosAc = calcBessBosQuantities({
      bess: bess, circuit: acCircuit, installContext: ctxAc, nom: nom,
    });
    var hasAcLinesAc = bosAc.lines.some(function(l) { return l.code === 'BESS-10'; });
    t.assertTrue('AC_COUPLED produces AC disconnect line (BESS-10)',
                 hasAcLinesAc);
  }
});


registerTest({
  id      : 'UNIT_BDF71_BESS_OBJECT_SHAPE',
  group   : 'unit',
  module  : 'reader/bess_shape',
  scenarios: [],
  tags    : ['unit', 'reader', 'bess', 'bdf7_1'],
  source  : 'tests_unit/calc/CalcBdf71Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT reader/bess_shape: new fields baseBatteryId, stackQty, pickerSource');

    // We can't call readInputBess directly here (it touches the live
    // spreadsheet via SpreadsheetApp.getActive). But we CAN verify that
    // downstream consumers handle the new fields correctly.

    // ==== TEST 1: BoS lines use baseBatteryId for productSpec ==========
    var bess = {
      batteryId: '2 \u00d7 HW_LUNA_2MWH (4064 kWh, 2032 kW)',  // stacked label
      baseBatteryId: 'HW_LUNA_2MWH',                            // catalog ID
      stackQty: 2,
      pickerSource: 'RECOMMENDATION',
      capacityKwh: 4064, powerKw: 2032,
    };
    var circuit = {
      sizeable: true, coupling: 'DC_COUPLED',
      runs: [{
        name: 'DC', side: 'DC', designCurrentA: 1000, cuAreaMm2: 67.43,
        conductorLabel: 'AWG 2/0', egcLabel: 'AWG 6',
        ocpdAmps: 1200, ocpdLabel: '1200A', parallels: 1,
      }],
    };
    var bos = calcBessBosQuantities({
      bess: bess, circuit: circuit,
      installContext: {
        coupling: 'DC_COUPLED', dcBusV: 1250, dcRunM: 25, gecRunM: 15,
        cablePath: 'INTEMPERIE', commissioningMxn: 100000,
      },
      nom: { cuResistivity: 0.0172, dcVdropTarget: 0.03, dcVdropHard: 0.05 },
    });
    var batteryLine = bos.lines.find(function(l) { return l.code === 'BESS-01'; });
    t.assertTrue('BESS-01 line present', !!batteryLine);
    t.assert('Battery line qty = stackQty (2)', 2, batteryLine.qty);
    t.assert('Battery productSpec.batteryId = baseBatteryId (catalog ID for DB lookup)',
             'HW_LUNA_2MWH', batteryLine.productSpec.batteryId);
    // Description should show the user-facing format
    t.assertTrue('Description shows "2 × HW_LUNA_2MWH" stack format',
                 batteryLine.description.indexOf('2 \u00d7 HW_LUNA_2MWH') >= 0);

    // ==== TEST 2: Single-unit selection -> stackQty = 1, baseBatteryId
    // equals batteryId, description starts with "Sistema BESS" (BDF-8
    // removed the colon and moved kWh/kW breakdown to detail field).
    var bessSingle = {
      batteryId: 'HW_LUNA_2MWH', baseBatteryId: 'HW_LUNA_2MWH',
      stackQty: 1, pickerSource: 'CATALOG',
      capacityKwh: 2032, powerKw: 1016,
    };
    var bosSingle = calcBessBosQuantities({
      bess: bessSingle, circuit: circuit,
      installContext: {
        coupling: 'DC_COUPLED', dcBusV: 1250, dcRunM: 25, gecRunM: 15,
        cablePath: 'INTEMPERIE', commissioningMxn: 100000,
      },
      nom: { cuResistivity: 0.0172, dcVdropTarget: 0.03, dcVdropHard: 0.05 },
    });
    var singleLine = bosSingle.lines.find(function(l) { return l.code === 'BESS-01'; });
    t.assert('Single-unit qty = 1', 1, singleLine.qty);
    t.assert('Single-unit productSpec.batteryId',
             'HW_LUNA_2MWH', singleLine.productSpec.batteryId);
    t.assertTrue('Single-unit description starts with "Sistema BESS"',
                 singleLine.description.indexOf('Sistema BESS') === 0);

    // ==== TEST 3: CUSTOM_MANUAL path (picker returned found=false) ====
    // bess.baseBatteryId === '' in this case; productSpec.batteryId
    // falls through to bess.batteryId which is 'CUSTOM_MANUAL'.
    // DB lookup with that ID returns 0 (well-defined absent value).
    var bessCustom = {
      batteryId: 'CUSTOM_MANUAL', baseBatteryId: '',
      stackQty: 1, pickerSource: 'CUSTOM_MANUAL',
      capacityKwh: 5000, powerKw: 2500,
    };
    var bosCustom = calcBessBosQuantities({
      bess: bessCustom, circuit: circuit,
      installContext: {
        coupling: 'DC_COUPLED', dcBusV: 800, dcRunM: 25, gecRunM: 15,
        cablePath: 'INTEMPERIE', commissioningMxn: 100000,
      },
      nom: { cuResistivity: 0.0172, dcVdropTarget: 0.03, dcVdropHard: 0.05 },
    });
    var customLine = bosCustom.lines.find(function(l) { return l.code === 'BESS-01'; });
    t.assert('CUSTOM_MANUAL productSpec.batteryId falls back to bess.batteryId',
             'CUSTOM_MANUAL', customLine.productSpec.batteryId);
  }
});
