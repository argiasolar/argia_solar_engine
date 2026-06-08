// =============================================================================
// ARGIA TESTS -- tests_unit/calc/CalcConductorVdropTests.gs
// -----------------------------------------------------------------------------
// selectConductorForVdrop (03_ElecTables.gs): conductors are sized for the
// GREATER of the ampacity floor and the voltage-drop cross-section floor, so a
// long run upsizes even when ampacity is satisfied. Worst-case-ready by design;
// can be reviewed down later.
//
// PROLOGIS MXC02304 AC per-inverter: 120.28 A, ~259 m, 480 V, 2% limit. 1/0 is
// ampacity-fine (170 A) but vdrop needs ~97 mm2 -> 4/0 (107.2 mm2) => 1.80% PASS.
// Pure-logic tests: no spreadsheet I/O.
// =============================================================================

registerTest({
  id: 'UNIT_CALC_CONDUCTOR_VDROP_SIZING',
  group: 'unit',
  module: 'calc/elec',
  scenarios: [],
  tags: ['calc', 'ac', 'dc', 'conductor', 'vdrop', 'ampacity'],
  source: 'tests_unit/calc/CalcConductorVdropTests.gs',
  fn: function (t) {
    t.suite('selectConductorForVdrop -- size for ampacity AND vdrop');
    var S3 = Math.sqrt(3), rho = 0.0172;
    var tbls = { conductors: [
      { size: '10',   ampacity: 40,  cuAreaMm2: 5.26,  insAreaMm2: 15.7 },
      { size: '1/0',  ampacity: 170, cuAreaMm2: 53.49, insAreaMm2: 143 },
      { size: '2/0',  ampacity: 195, cuAreaMm2: 67.43, insAreaMm2: 169 },
      { size: '3/0',  ampacity: 225, cuAreaMm2: 85.01, insAreaMm2: 201 },
      { size: '4/0',  ampacity: 260, cuAreaMm2: 107.2, insAreaMm2: 240 },
      { size: '500',  ampacity: 430, cuAreaMm2: 253,   insAreaMm2: 510 },
      { size: '1000', ampacity: 615, cuAreaMm2: 507,   insAreaMm2: 954 }
    ]};

    // PROLOGIS AC per-inverter: ampacity wants 1/0; vdrop forces 4/0.
    var ac = selectConductorForVdrop(150.35,
      { k: S3, lengthM: 259, rho: rho, iA: 120.28, voltageV: 480, limitFrac: 0.02 }, tbls);
    t.assert('AC per-inverter upsized to 4/0', '4/0', ac.size);
    t.assert('AC per-inverter governed by VDROP', 'VDROP', ac.governedBy);
    t.assertTrue('AC per-inverter vdrop <= 2%', ac.vdrop <= 0.02);

    // Short run: vdrop not binding -> stays at the ampacity pick (1/0), no oversize.
    var sh = selectConductorForVdrop(150.35,
      { k: S3, lengthM: 10, rho: rho, iA: 120.28, voltageV: 480, limitFrac: 0.02 }, tbls);
    t.assert('short run stays 1/0', '1/0', sh.size);
    t.assert('short run governed by AMPACITY', 'AMPACITY', sh.governedBy);

    // DC string: 10 AWG holds (Helioscope-avg length -> 1.17%).
    var dc = selectConductorForVdrop(37.18,
      { k: 1, lengthM: 187.7, rho: rho, iA: 26.4, voltageV: 1379.2, limitFrac: 0.015 }, tbls);
    t.assert('DC string stays 10 AWG', '10', dc.size);
    t.assertTrue('DC string vdrop <= 1.5%', dc.vdrop <= 0.015);

    // Main feeder: ampacity drives 500 kcmil (vdrop tiny at 100 m).
    var mf = selectConductorForVdrop(413,
      { k: S3, lengthM: 100, rho: rho, iA: 300.7, voltageV: 480, limitFrac: 0.02 }, tbls);
    t.assert('feeder is 500 kcmil', '500', mf.size);
    t.assert('feeder governed by AMPACITY', 'AMPACITY', mf.governedBy);

    // Beyond-table requirement is flagged, never silently undersized.
    var huge = selectConductorForVdrop(9999,
      { k: S3, lengthM: 100, rho: rho, iA: 9999, voltageV: 480, limitFrac: 0.02 }, tbls);
    t.assertTrue('beyond table flagged insufficient', huge.insufficient === true);
  }
});
