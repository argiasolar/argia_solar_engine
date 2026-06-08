// =============================================================================
// ARGIA TESTS -- tests_unit/calc/CalcDcVdropBasisTests.gs
// -----------------------------------------------------------------------------
// DC voltage-drop conductor-length BASIS selection (dcVdropConductorLength,
// 04_CalcDC.gs) and the selectConductor never-silently-undersize guard
// (03_ElecTables.gs).
//
// PROLOGIS MXC02304: 31 strings, Helioscope total DC wire 5,820 m. The old vdrop
// used 2 x estimateDcRunM (~292 m one-way -> 584 m round trip => 3.66%, false
// FAIL). The Helioscope average is 5820/31 = 187.7 m round trip => ~1.18% PASS.
// Pure-logic tests: no spreadsheet I/O.
// =============================================================================

registerTest({
  id: 'UNIT_CALC_DC_VDROP_BASIS',
  group: 'unit',
  module: 'calc/dc',
  scenarios: [],
  tags: ['calc', 'dc', 'vdrop', 'helioscope'],
  source: 'tests_unit/calc/CalcDcVdropBasisTests.gs',
  fn: function (t) {
    t.suite('dcVdropConductorLength -- basis priority');

    // 1) longest-run override wins (one-way x2)
    var a = dcVdropConductorLength(
      { longestStringRunM: 110, dcStringWireM: 5820, stringsTotal: 31 }, 292);
    t.assert('override basis', 'OVERRIDE-LONGEST', a.basis);
    t.assert('override len = 2 x 110', 220, a.lenM);

    // 2) Helioscope average when no override (already round trip)
    var b = dcVdropConductorLength(
      { longestStringRunM: 0, dcStringWireM: 5820, stringsTotal: 31 }, 292);
    t.assert('helioscope basis', 'HELIOSCOPE-AVG', b.basis);
    t.assertTrue('helioscope len ~187.7 m', Math.abs(b.lenM - 5820 / 31) < 0.01);
    t.assertTrue('helioscope len << old 584 m round trip', b.lenM < 200);

    // 3) geometry estimate when neither present (x2 round trip)
    var c = dcVdropConductorLength(
      { longestStringRunM: 0, dcStringWireM: 0, stringsTotal: 31 }, 292);
    t.assert('estimate basis', 'ESTIMATE', c.basis);
    t.assert('estimate len = 2 x 292', 584, c.lenM);

    // 4) the PROLOGIS vdrop now PASSES on the Helioscope average
    var RperM = 0.0172 / 5.26;        // 10 AWG Cu
    var vString = 44.5 * 31;          // Vmp x mods
    var vdrop = (b.lenM * RperM * 26.4) / vString;
    t.assertTrue('PROLOGIS vdrop <= 1.5% target', vdrop <= 0.015);
  }
});

registerTest({
  id: 'UNIT_CALC_SELECT_CONDUCTOR_GUARD',
  group: 'unit',
  module: 'calc/elec',
  scenarios: [],
  tags: ['calc', 'ac', 'conductor', 'ampacity'],
  source: 'tests_unit/calc/CalcDcVdropBasisTests.gs',
  fn: function (t) {
    t.suite('selectConductor -- never silently undersize');
    var tbls = { conductors: [
      { size: '400',  ampacity: 380, cuAreaMm2: 203 },
      { size: '500',  ampacity: 430, cuAreaMm2: 253 },
      { size: '1000', ampacity: 615, cuAreaMm2: 507 }
    ]};
    // 413 A requirement: must pick 500 (430 A), NOT 400 (380 A), and not flag.
    var ok = selectConductor(413, tbls);
    t.assert('picks smallest qualifying (500)', '500', ok.size);
    t.assertTrue('not flagged insufficient', !ok.insufficient);

    // Requirement above the whole table: returns largest, FLAGGED insufficient.
    var bad = selectConductor(999, tbls);
    t.assert('returns largest when none qualify', '1000', bad.size);
    t.assertTrue('flagged insufficient', bad.insufficient === true);
    t.assert('carries requiredA', 999, bad.requiredA);
  }
});
