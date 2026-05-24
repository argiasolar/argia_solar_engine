// =============================================================================
// ARGIA TESTS -- tests_unit/calc/CalcBdf10Tests.gs   (BDF-10)
// Tests for BDF-10 micro-fixes:
//   - GEC AWG resolver maps largest-cuArea -> required GEC AWG label
//   - GEC BoS line carries awg + cuAreaMm2 in productSpec
// Tagged 'bdf10'.
// =============================================================================


registerTest({
  id      : 'UNIT_BDF10_GEC_AWG_RESOLVER',
  group   : 'unit',
  module  : 'calc/bess_bos_format',
  scenarios: [],
  tags    : ['unit', 'calc', 'bess', 'bdf10'],
  source  : 'tests_unit/calc/CalcBdf10Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT bess_bos: GEC AWG mapped from largest conductor cuAreaMm2');

    // ==== TEST 1: 4/0 AWG conductor (107.20 mm²) -> #4 AWG GEC =========
    var bess = {
      batteryId: 'HW_LUNA_2MWH', baseBatteryId: 'HW_LUNA_2MWH',
      stackQty: 1, capacityKwh: 2032, powerKw: 1016,
    };
    var circuit40 = {
      sizeable: true, coupling: 'DC_COUPLED',
      runs: [{
        name: 'DC', side: 'DC',
        designCurrentA: 1016,
        cuAreaMm2: 107.20, insAreaMm2: 153.94,
        conductorLabel: 'AWG 4/0', egcLabel: 'AWG 4',
        egcCuAreaMm2: 21.15,
        ocpdAmps: 1250, ocpdLabel: '1250A', parallels: 1,
      }],
    };
    var bos40 = calcBessBosQuantities({
      bess: bess, circuit: circuit40,
      installContext: { coupling: 'DC_COUPLED', dcBusV: 1250,
                        dcRunM: 25, gecRunM: 15,
                        cablePath: 'INTEMPERIE', commissioningMxn: 100000 },
      nom: { cuResistivity: 0.0172, dcVdropTarget: 0.03, dcVdropHard: 0.05 },
    });
    var gec40 = bos40.lines.find(function(l) { return l.code === 'BESS-11'; });
    t.assertTrue('GEC line present', !!gec40);
    t.assert('4/0 AWG -> #4 AWG GEC', 'AWG 4', gec40.productSpec.awg);
    t.assert('4/0 AWG -> GEC mm² = 21.15', 21.15, gec40.productSpec.cuAreaMm2);
    t.assertTrue('GEC description includes AWG label',
                 gec40.description.indexOf('AWG 4') >= 0);

    // ==== TEST 2: 350 kcmil (177.30 mm²) -> #2 AWG GEC =================
    var circuit350 = {
      sizeable: true, coupling: 'AC_COUPLED',
      runs: [
        { side: 'DC', cuAreaMm2: 107.20, insAreaMm2: 153.94,
          conductorLabel: 'AWG 4/0', egcLabel: 'AWG 4',
          ocpdAmps: 1250, parallels: 1 },
        { side: 'AC', cuAreaMm2: 177.30, insAreaMm2: 245.21,
          conductorLabel: 'AWG 350 kcmil', egcLabel: 'AWG 2',
          ocpdAmps: 2000, parallels: 1 },
      ],
    };
    var bos350 = calcBessBosQuantities({
      bess: bess, circuit: circuit350,
      installContext: { coupling: 'AC_COUPLED', dcBusV: 1250, acV: 480,
                        dcRunM: 25, acRunM: 50, gecRunM: 15,
                        cablePath: 'INTEMPERIE', commissioningMxn: 100000 },
      nom: { cuResistivity: 0.0172, dcVdropTarget: 0.03, dcVdropHard: 0.05,
             acVdropTarget: 0.03, acVdropHard: 0.05 },
    });
    var gec350 = bos350.lines.find(function(l) { return l.code === 'BESS-11'; });
    t.assert('350 kcmil largest -> #2 AWG GEC', 'AWG 2', gec350.productSpec.awg);
    t.assert('350 kcmil -> GEC mm² = 33.62', 33.62, gec350.productSpec.cuAreaMm2);

    // ==== TEST 3: small conductor 13 mm² (#6 AWG) -> #8 AWG GEC ========
    var circuitSmall = {
      sizeable: true, coupling: 'DC_COUPLED',
      runs: [{
        side: 'DC', cuAreaMm2: 13.30, insAreaMm2: 28.0,
        conductorLabel: 'AWG 6', egcLabel: 'AWG 10',
        ocpdAmps: 80, parallels: 1,
      }],
    };
    var bosSmall = calcBessBosQuantities({
      bess: bess, circuit: circuitSmall,
      installContext: { coupling: 'DC_COUPLED', dcBusV: 800,
                        dcRunM: 15, gecRunM: 10,
                        cablePath: 'INTEMPERIE', commissioningMxn: 50000 },
      nom: { cuResistivity: 0.0172, dcVdropTarget: 0.03, dcVdropHard: 0.05 },
    });
    var gecSmall = bosSmall.lines.find(function(l) { return l.code === 'BESS-11'; });
    t.assert('13.30 mm² -> #8 AWG GEC', 'AWG 8', gecSmall.productSpec.awg);

    // ==== TEST 4: derivation string mentions NOM 250-66 and source =====
    t.assertTrue('Derivation cites NOM 250-66',
                 gec40.detail.indexOf('NOM 250-66') >= 0);
    t.assertTrue('Derivation mentions conductor mayor source',
                 gec40.detail.indexOf('conductor mayor') >= 0);

    // ==== TEST 5: empty/zero conductor area -> graceful empty awg =====
    var circuitEmpty = {
      sizeable: false, coupling: 'DC_COUPLED',
      runs: [],   // no runs at all
    };
    var bosEmpty = calcBessBosQuantities({
      bess: bess, circuit: circuitEmpty,
      installContext: { coupling: 'DC_COUPLED', dcBusV: 800,
                        dcRunM: 0, gecRunM: 10,
                        cablePath: 'INTEMPERIE', commissioningMxn: 0 },
      nom: { cuResistivity: 0.0172, dcVdropTarget: 0.03, dcVdropHard: 0.05 },
    });
    var gecEmpty = bosEmpty.lines.find(function(l) { return l.code === 'BESS-11'; });
    if (gecEmpty) {
      t.assert('No conductor data -> empty awg', '', gecEmpty.productSpec.awg);
      t.assertTrue('Pendiente derivation when no conductor data',
                   gecEmpty.detail.indexOf('pendiente') >= 0
                || gecEmpty.detail.indexOf('Sin datos') >= 0);
    }
  }
});


registerTest({
  id      : 'UNIT_BDF10_BACKWARD_COMPAT_BDF9',
  group   : 'unit',
  module  : 'calc/bess_bos_format',
  scenarios: [],
  tags    : ['unit', 'calc', 'bess', 'bdf10'],
  source  : 'tests_unit/calc/CalcBdf10Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT bess_bos: BDF-9 productSpec fields preserved');

    var bess = {
      batteryId: 'HW_LUNA_2MWH', baseBatteryId: 'HW_LUNA_2MWH',
      stackQty: 1, capacityKwh: 2032, powerKw: 1016,
    };
    var circuit = {
      sizeable: true, coupling: 'AC_COUPLED',
      runs: [
        { side: 'DC', cuAreaMm2: 107.20, insAreaMm2: 153.94,
          conductorLabel: 'AWG 4/0', egcLabel: 'AWG 4',
          egcCuAreaMm2: 21.15,
          ocpdAmps: 1250, parallels: 1 },
        { side: 'AC', cuAreaMm2: 67.43, insAreaMm2: 99.92,
          conductorLabel: 'AWG 2/0', egcLabel: 'AWG 4',
          egcCuAreaMm2: 21.15,
          ocpdAmps: 800, parallels: 1 },
      ],
    };
    var bos = calcBessBosQuantities({
      bess: bess, circuit: circuit,
      installContext: { coupling: 'AC_COUPLED', dcBusV: 800, acV: 480,
                        dcRunM: 25, acRunM: 50, gecRunM: 15,
                        cablePath: 'INTEMPERIE', commissioningMxn: 100000 },
      nom: { cuResistivity: 0.0172, dcVdropTarget: 0.03, dcVdropHard: 0.05,
             acVdropTarget: 0.03, acVdropHard: 0.05 },
    });

    // Verify all BDF-9 productSpec fields still present + populated.
    var dcCable = bos.lines.find(function(l) { return l.code === 'BESS-02'; });
    t.assert('BDF-9 DC cable cuAreaMm2 preserved', 107.20, dcCable.productSpec.cuAreaMm2);
    t.assert('BDF-9 DC cable parallels preserved', 1, dcCable.productSpec.parallels);

    var acCable = bos.lines.find(function(l) { return l.code === 'BESS-04'; });
    t.assert('BDF-9 AC cable phases preserved', 3, acCable.productSpec.phases);

    var dcConduit = bos.lines.find(function(l) { return l.code === 'BESS-06'; });
    t.assert('BDF-9 DC conduit condCount preserved', 3, dcConduit.productSpec.condCount);

    var acConduit = bos.lines.find(function(l) { return l.code === 'BESS-07'; });
    t.assert('BDF-9 AC conduit condCount preserved', 4, acConduit.productSpec.condCount);

    var dcOcpd = bos.lines.find(function(l) { return l.code === 'BESS-08'; });
    t.assert('BDF-9 DC OCPD poles preserved', 1, dcOcpd.productSpec.poles);

    var acOcpd = bos.lines.find(function(l) { return l.code === 'BESS-09'; });
    t.assert('BDF-9 AC OCPD poles preserved', 3, acOcpd.productSpec.poles);

    var disc = bos.lines.find(function(l) { return l.code === 'BESS-10'; });
    t.assert('BDF-9 disconnect poles preserved', 3, disc.productSpec.poles);

    // Quantities unchanged (BDF-7 contract)
    t.assert('DC cable qty 50 m unchanged', 50, dcCable.qty);
    t.assert('AC cable qty 150 m unchanged', 150, acCable.qty);
    var gec = bos.lines.find(function(l) { return l.code === 'BESS-11'; });
    t.assert('GEC qty 15 m unchanged', 15, gec.qty);
  }
});
