// =============================================================================
// ARGIA TESTS -- tests_unit/calc/CalcBdf9Tests.gs   (BDF-9)
// Tests for the BoS price resolution wiring on §8 BESS lines.
// Tagged 'bdf9'.
// =============================================================================


registerTest({
  id      : 'UNIT_BDF9_BOS_PRODUCTSPEC_ENRICHED',
  group   : 'unit',
  module  : 'calc/bess_bos_format',
  scenarios: [],
  tags    : ['unit', 'calc', 'bess', 'bdf9'],
  source  : 'tests_unit/calc/CalcBdf9Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/bess_bos_format: productSpec carries price-resolver fields');

    var bess = {
      batteryId: '2 \u00d7 HW_LUNA_2MWH', baseBatteryId: 'HW_LUNA_2MWH',
      stackQty: 2, capacityKwh: 4064, powerKw: 2032,
    };
    var acCircuit = {
      sizeable: true, coupling: 'AC_COUPLED',
      runs: [
        {
          name: 'DC', side: 'DC',
          designCurrentA: 2032000/1250*1.25,
          cuAreaMm2: 107.20, insAreaMm2: 153.94,
          conductorLabel: 'AWG 4/0', egcLabel: 'AWG 4',
          egcCuAreaMm2: 21.15,
          ocpdAmps: 2500, ocpdLabel: '2500A', parallels: 1,
        },
        {
          name: 'AC', side: 'AC',
          designCurrentA: 2444,
          cuAreaMm2: 177.30, insAreaMm2: 245.21,
          conductorLabel: 'AWG 350 kcmil', egcLabel: 'AWG 2',
          egcCuAreaMm2: 33.62,
          ocpdAmps: 3000, ocpdLabel: '3000A', parallels: 1,
        },
      ],
    };
    var bos = calcBessBosQuantities({
      bess: bess, circuit: acCircuit,
      installContext: {
        coupling: 'AC_COUPLED', dcBusV: 1250, acV: 480,
        dcRunM: 25, acRunM: 50, gecRunM: 15,
        cablePath: 'INTEMPERIE', commissioningMxn: 250000,
      },
      nom: {
        cuResistivity: 0.0172,
        dcVdropTarget: 0.03, dcVdropHard: 0.05,
        acVdropTarget: 0.03, acVdropHard: 0.05,
      },
    });

    // ==== TEST 1: DC cable productSpec has cuAreaMm2, insAreaMm2, parallels =
    var dcCable = bos.lines.find(function(l) { return l.code === 'BESS-02'; });
    t.assertTrue('BESS-02 has cuAreaMm2',
                 dcCable.productSpec.cuAreaMm2 > 0);
    t.assert('BESS-02 cuAreaMm2 = 107.20', 107.20, dcCable.productSpec.cuAreaMm2);
    t.assertTrue('BESS-02 has insAreaMm2',
                 dcCable.productSpec.insAreaMm2 > 0);
    t.assert('BESS-02 parallels = 1', 1, dcCable.productSpec.parallels);

    // ==== TEST 2: DC EGC productSpec has cuAreaMm2 ======================
    var dcEgc = bos.lines.find(function(l) { return l.code === 'BESS-03'; });
    t.assertTrue('BESS-03 has cuAreaMm2',
                 dcEgc.productSpec.cuAreaMm2 > 0);

    // ==== TEST 3: AC cable productSpec has phases =======================
    var acCable = bos.lines.find(function(l) { return l.code === 'BESS-04'; });
    t.assert('BESS-04 phases = 3', 3, acCable.productSpec.phases);

    // ==== TEST 4: DC conduit productSpec has condCount + fill data ======
    var dcConduit = bos.lines.find(function(l) { return l.code === 'BESS-06'; });
    t.assertTrue('BESS-06 has condCount',
                 dcConduit.productSpec.condCount > 0);
    // DC: 2 conductors × 1 parallel + 1 EGC = 3
    t.assert('BESS-06 condCount = 3 (2 cond + EGC, single conduit)',
             3, dcConduit.productSpec.condCount);
    t.assertTrue('BESS-06 has condInsAreaMm2',
                 dcConduit.productSpec.condInsAreaMm2 > 0);

    // ==== TEST 5: AC conduit productSpec has condCount = 3F + EGC ======
    var acConduit = bos.lines.find(function(l) { return l.code === 'BESS-07'; });
    t.assert('BESS-07 condCount = 4 (3F + EGC)',
             4, acConduit.productSpec.condCount);

    // ==== TEST 6: DC OCPD productSpec has poles=1 ======================
    var dcOcpd = bos.lines.find(function(l) { return l.code === 'BESS-08'; });
    t.assert('BESS-08 poles = 1', 1, dcOcpd.productSpec.poles);

    // ==== TEST 7: AC OCPD productSpec has poles=3 ======================
    var acOcpd = bos.lines.find(function(l) { return l.code === 'BESS-09'; });
    t.assert('BESS-09 poles = 3', 3, acOcpd.productSpec.poles);

    // ==== TEST 8: AC disconnect productSpec has poles=3 ================
    var disc = bos.lines.find(function(l) { return l.code === 'BESS-10'; });
    t.assert('BESS-10 poles = 3', 3, disc.productSpec.poles);
  }
});


registerTest({
  id      : 'UNIT_BDF9_BACKWARD_COMPAT_BDF7',
  group   : 'unit',
  module  : 'calc/bess_bos_format',
  scenarios: [],
  tags    : ['unit', 'calc', 'bess', 'bdf9'],
  source  : 'tests_unit/calc/CalcBdf9Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/bess_bos_format: BDF-7 contract still holds');

    var bess = {
      batteryId: 'HW_LUNA_2MWH', baseBatteryId: 'HW_LUNA_2MWH',
      stackQty: 1, capacityKwh: 2032, powerKw: 1016,
    };
    var circuit = {
      sizeable: true, coupling: 'DC_COUPLED',
      runs: [{
        name: 'DC', side: 'DC',
        designCurrentA: 1016000/1250*1.25,
        cuAreaMm2: 67.43, insAreaMm2: 99.92,
        conductorLabel: 'AWG 2/0', egcLabel: 'AWG 6',
        egcCuAreaMm2: 13.30,
        ocpdAmps: 1250, ocpdLabel: '1250A', parallels: 1,
      }],
    };
    var bos = calcBessBosQuantities({
      bess: bess, circuit: circuit,
      installContext: {
        coupling: 'DC_COUPLED', dcBusV: 1250,
        dcRunM: 25, gecRunM: 15,
        cablePath: 'INTEMPERIE', commissioningMxn: 100000,
      },
      nom: { cuResistivity: 0.0172, dcVdropTarget: 0.03, dcVdropHard: 0.05 },
    });

    // Math unchanged: DC cable = 2 × 25 × 1 = 50 m
    var dcCable = bos.lines.find(function(l) { return l.code === 'BESS-02'; });
    t.assert('Math unchanged: DC cable qty = 50 m', 50, dcCable.qty);

    // productSpec.awg still present (BDF-7 contract)
    t.assert('productSpec.awg preserved',
             'AWG 2/0', dcCable.productSpec.awg);
    // productSpec.side still present (BDF-7 contract)
    t.assert('productSpec.side preserved',
             'DC', dcCable.productSpec.side);

    // Quantities for all lines unchanged
    var dcEgc = bos.lines.find(function(l) { return l.code === 'BESS-03'; });
    t.assert('DC EGC qty = 25 m', 25, dcEgc.qty);
    var dcConduit = bos.lines.find(function(l) { return l.code === 'BESS-06'; });
    t.assert('DC conduit qty = 25 m', 25, dcConduit.qty);
    var dcOcpd = bos.lines.find(function(l) { return l.code === 'BESS-08'; });
    t.assert('DC OCPD qty = 1 pc', 1, dcOcpd.qty);
    var gec = bos.lines.find(function(l) { return l.code === 'BESS-11'; });
    t.assert('GEC qty = 15 m', 15, gec.qty);
    var comm = bos.lines.find(function(l) { return l.code === 'BESS-12'; });
    t.assert('Commissioning qty = 1 lote', 1, comm.qty);

    // DC_COUPLED produces NO AC lines (BDF-6+BDF-7 contract)
    var hasAcLines = bos.lines.some(function(l) {
      return ['BESS-04', 'BESS-05', 'BESS-07', 'BESS-09', 'BESS-10']
             .indexOf(l.code) >= 0;
    });
    t.assertFalse('DC_COUPLED has NO AC lines', hasAcLines);
  }
});
