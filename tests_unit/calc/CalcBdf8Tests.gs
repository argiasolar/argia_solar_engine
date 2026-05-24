// =============================================================================
// ARGIA TESTS -- tests_unit/calc/CalcBdf8Tests.gs   (BDF-8)
// Tests for the unified formatting pass:
//   - BoS line `description` is short; full breakdown is in `detail`
//   - description length stays under threshold for clean BOM rendering
//   - detail field contains the engineering breakdown
// Tagged 'bdf8'.
// =============================================================================


registerTest({
  id      : 'UNIT_BDF8_BOS_DESCRIPTIONS_SHORT',
  group   : 'unit',
  module  : 'calc/bess_bos_format',
  scenarios: [],
  tags    : ['unit', 'calc', 'bess', 'bdf8'],
  source  : 'tests_unit/calc/CalcBdf8Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/bess_bos_format: short description + detail field');

    // ==== TEST 1: descriptions stay reasonably short ====================
    // The visible description in BOM column B should not balloon into the
    // multi-line ugly format BDF-7 R1 produced. 50 chars is a soft cap.
    var bess = {
      batteryId: 'HW_LUNA_2MWH', baseBatteryId: 'HW_LUNA_2MWH',
      stackQty: 5, capacityKwh: 10000, powerKw: 5000,
    };
    var circuit = {
      sizeable: true, coupling: 'AC_COUPLED',
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
    var installCtx = {
      coupling: 'AC_COUPLED', dcBusV: 800, acV: 480,
      dcRunM: 25, acRunM: 50, gecRunM: 15,
      cablePath: 'INTEMPERIE', commissioningMxn: 250000,
    };
    var nom = {
      cuResistivity: 0.0172,
      dcVdropTarget: 0.03, dcVdropHard: 0.05,
      acVdropTarget: 0.03, acVdropHard: 0.05,
    };
    var bos = calcBessBosQuantities({
      bess: bess, circuit: circuit,
      installContext: installCtx, nom: nom,
    });
    t.assertFalse('BoS not blocked', bos.blocked);
    t.assertTrue('At least 9 lines emitted (full AC_COUPLED)',
                 bos.lines.length >= 9);

    // Soft limit: each description should be <= 60 chars. BDF-7 R1 had
    // lines like "Cable DC AWG 2/0 batería ↔ PCS (1 par × 25 m × 2 conductores)"
    // which is 65+ chars and wraps awkwardly. BDF-8 splits visible vs detail.
    bos.lines.forEach(function(line) {
      t.assertTrue('Description short (≤60 chars) for ' + line.code +
                   ' [actual: ' + line.description.length + ', text: "' +
                   line.description + '"]',
                   line.description.length <= 60);
    });

    // ==== TEST 2: detail field present where it adds value ===============
    // Cable / EGC / conduit / OCPD / battery / commissioning all carry
    // engineering breakdowns. GEC line carries a detail too. Every line
    // should have either a useful detail or '' (never undefined).
    bos.lines.forEach(function(line) {
      // detail is optional but, when present, should be a string
      if (line.detail !== undefined && line.detail !== null) {
        t.assertTrue('detail is a string for ' + line.code,
                     typeof line.detail === 'string');
      }
    });

    // ==== TEST 3: specific detail content for verification ===============
    var dcCableLine = bos.lines.find(function(l) { return l.code === 'BESS-02'; });
    t.assertTrue('BESS-02 (DC cable) has a detail field with parallels',
                 dcCableLine.detail && dcCableLine.detail.indexOf('par') >= 0);
    t.assertTrue('BESS-02 detail mentions meters',
                 dcCableLine.detail.indexOf('m') >= 0);

    var batteryLine = bos.lines.find(function(l) { return l.code === 'BESS-01'; });
    t.assertTrue('BESS-01 detail mentions capacity (kWh)',
                 batteryLine.detail && batteryLine.detail.indexOf('kWh') >= 0);
    t.assertTrue('BESS-01 detail mentions power (kW)',
                 batteryLine.detail && batteryLine.detail.indexOf('kW') >= 0);

    var discLine = bos.lines.find(function(l) { return l.code === 'BESS-10'; });
    t.assertTrue('BESS-10 detail mentions NOM citation',
                 discLine.detail && discLine.detail.indexOf('NOM') >= 0);
  }
});


registerTest({
  id      : 'UNIT_BDF8_BATTERY_DESCRIPTION_SHAPE',
  group   : 'unit',
  module  : 'calc/bess_bos_format',
  scenarios: [],
  tags    : ['unit', 'calc', 'bess', 'bdf8'],
  source  : 'tests_unit/calc/CalcBdf8Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/bess_bos_format: battery line description format');

    var dcCircuit = {
      sizeable: true, coupling: 'DC_COUPLED',
      runs: [{
        name: 'DC', side: 'DC',
        designCurrentA: 1000, cuAreaMm2: 67.43,
        conductorLabel: 'AWG 2/0', egcLabel: 'AWG 6',
        ocpdAmps: 1200, ocpdLabel: '1200A', parallels: 1,
      }],
    };
    var ctxBase = {
      coupling: 'DC_COUPLED', dcBusV: 800, dcRunM: 25, gecRunM: 15,
      cablePath: 'INTEMPERIE', commissioningMxn: 100000,
    };
    var nom = { cuResistivity: 0.0172, dcVdropTarget: 0.03, dcVdropHard: 0.05 };

    // ==== TEST 1: stack of 5 -> "5 × HW_LUNA_2MWH" =====================
    var stackBess = {
      batteryId: '5 \u00d7 HW_LUNA_2MWH', baseBatteryId: 'HW_LUNA_2MWH',
      stackQty: 5, capacityKwh: 10000, powerKw: 5000,
    };
    var bosStack = calcBessBosQuantities({
      bess: stackBess, circuit: dcCircuit,
      installContext: ctxBase, nom: nom,
    });
    var stackLine = bosStack.lines.find(function(l) { return l.code === 'BESS-01'; });
    t.assert('Stack description = "5 × HW_LUNA_2MWH"',
             '5 \u00d7 HW_LUNA_2MWH', stackLine.description);
    t.assertTrue('Stack description short (<=60 chars)',
                 stackLine.description.length <= 60);
    // Detail carries the per-unit + total
    t.assertTrue('Stack detail mentions per-unit',
                 stackLine.detail.indexOf('unidad') >= 0
              || stackLine.detail.indexOf('Por unidad') >= 0);
    t.assertTrue('Stack detail mentions total stack',
                 stackLine.detail.indexOf('Total') >= 0
              || stackLine.detail.indexOf('total') >= 0);

    // ==== TEST 2: single unit -> "Sistema BESS HW_LUNA_2MWH" ===========
    var singleBess = {
      batteryId: 'HW_LUNA_2MWH', baseBatteryId: 'HW_LUNA_2MWH',
      stackQty: 1, capacityKwh: 2000, powerKw: 1000,
    };
    var bosSingle = calcBessBosQuantities({
      bess: singleBess, circuit: dcCircuit,
      installContext: ctxBase, nom: nom,
    });
    var singleLine = bosSingle.lines.find(function(l) { return l.code === 'BESS-01'; });
    t.assertTrue('Single description starts with "Sistema BESS"',
                 singleLine.description.indexOf('Sistema BESS') === 0);
    t.assertTrue('Single description short (<=60 chars)',
                 singleLine.description.length <= 60);
    // Detail carries capacity + power
    t.assertTrue('Single detail has capacity kWh',
                 singleLine.detail.indexOf('2000') >= 0
              || singleLine.detail.indexOf('2,000') >= 0);
    t.assertTrue('Single detail has power kW',
                 singleLine.detail.indexOf('1000') >= 0
              || singleLine.detail.indexOf('1,000') >= 0);
  }
});


registerTest({
  id      : 'UNIT_BDF8_BACKWARD_COMPAT',
  group   : 'unit',
  module  : 'calc/bess_bos_format',
  scenarios: [],
  tags    : ['unit', 'calc', 'bess', 'bdf8'],
  source  : 'tests_unit/calc/CalcBdf8Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/bess_bos_format: backward compat with consumers');

    // Verify that the existing BDF-7 contract still holds:
    //   - lines is an array
    //   - each line has code/description/qty/unit/productCategory/productSpec/nomCite
    //   - quantities are the same as BDF-7 (formatting didn't change math)
    var bess = {
      batteryId: 'HW_LUNA_2MWH', baseBatteryId: 'HW_LUNA_2MWH',
      stackQty: 2, capacityKwh: 4064, powerKw: 2032,
    };
    var circuit = {
      sizeable: true, coupling: 'DC_COUPLED',
      runs: [{
        name: 'DC', side: 'DC',
        designCurrentA: 1625, cuAreaMm2: 107.20,
        conductorLabel: 'AWG 4/0', egcLabel: 'AWG 4',
        ocpdAmps: 2000, ocpdLabel: '2000A', parallels: 1,
      }],
    };
    var bos = calcBessBosQuantities({
      bess: bess, circuit: circuit,
      installContext: {
        coupling: 'DC_COUPLED', dcBusV: 1250, dcRunM: 30, gecRunM: 20,
        cablePath: 'INTEMPERIE', commissioningMxn: 350000,
      },
      nom: { cuResistivity: 0.0172, dcVdropTarget: 0.03, dcVdropHard: 0.05 },
    });

    // Math unchanged: DC cable = 2 conductors × 1 parallel × 30 m = 60 m
    var dcCable = bos.lines.find(function(l) { return l.code === 'BESS-02'; });
    t.assert('BDF-8 doesn\'t change qty: DC cable = 60 m', 60, dcCable.qty);

    // GEC qty unchanged
    var gec = bos.lines.find(function(l) { return l.code === 'BESS-11'; });
    t.assert('BDF-8 doesn\'t change qty: GEC = 20 m', 20, gec.qty);

    // Battery qty = stackQty unchanged
    var bat = bos.lines.find(function(l) { return l.code === 'BESS-01'; });
    t.assert('BDF-8 doesn\'t change qty: battery = 2 units', 2, bat.qty);

    // productSpec still carries baseBatteryId
    t.assert('Battery productSpec.batteryId still = baseBatteryId',
             'HW_LUNA_2MWH', bat.productSpec.batteryId);

    // nomCite preserved on all NOM-cited lines
    t.assertTrue('DC cable nomCite preserved',
                 dcCable.nomCite && dcCable.nomCite.indexOf('NOM') >= 0);
    t.assertTrue('GEC nomCite preserved',
                 gec.nomCite && gec.nomCite.indexOf('NOM') >= 0);
  }
});
