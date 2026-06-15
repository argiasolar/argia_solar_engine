// =============================================================================
// ARGIA -- tests_unit/calc/ValorDeCompraTests.gs
// -----------------------------------------------------------------------------
// Locks calcValorDeCompra (32_CalcValorDeCompra.js) against the worked CULLIGAN
// example and the structural invariants verified from the live BaaS workbooks
// (PPA "ANEXO 7 -- Valor Residual": straight-line, IVA 16%, term 16, clamped).
//
// Worked CULLIGAN numbers (systemCapexMxn = 37,051,893.49 pre-IVA):
//   capexConIva   = 42,980,196.45
//   annualDecline =  2,686,262.28
//   Año 0 = 42,980,196.45 ... Año 16 = 0.00 (declining by annualDecline/yr)
// =============================================================================

var _VDC_CULLIGAN_CAPEX = 37051893.49;   // BOM 36,303,902 + INSTALL 747,992, pre-IVA

registerTest({
  id      : 'UNIT_VDC_CULLIGAN_SCHEDULE',
  group   : 'unit',
  module  : 'calc/valor_de_compra',
  scenarios: [],
  tags    : ['baas', 'valor_de_compra', 'residual'],
  source  : 'tests_unit/calc/ValorDeCompraTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/valor_de_compra: CULLIGAN worked schedule');

    var r = calcValorDeCompra({ systemCapexMxn: _VDC_CULLIGAN_CAPEX });

    t.assert('capexConIva = capex x 1.16', 42980196.45, r.capexConIva, 0.01);
    t.assert('annualDecline = capexConIva / 16', 2686262.28, r.annualDeclineMxn, 0.01);
    t.assert('term defaults to 16', 16, r.term);
    t.assert('schedule has term+1 rows (years 0..16)', 17, r.schedule.length);
    t.assert('provenance', 'STRAIGHT_LINE_RESIDUAL', r.provenance);

    // Locked schedule values (every year, against the worked example).
    var expected = [
      42980196.45, 40293934.17, 37607671.89, 34921409.61, 32235147.34,
      29548885.06, 26862622.78, 24176360.50, 21490098.22, 18803835.95,
      16117573.67, 13431311.39, 10745049.11,  8058786.83,  5372524.56,
       2686262.28,        0.00
    ];
    for (var n = 0; n <= 16; n++) {
      t.assert('A' + String(n) + 'o ' + n + ' valor', expected[n], r.schedule[n].valorMxn, 0.02);
      t.assert('A' + String(n) + 'o ' + n + ' year index', n, r.schedule[n].year);
    }
  }
});


registerTest({
  id      : 'UNIT_VDC_INVARIANTS',
  group   : 'unit',
  module  : 'calc/valor_de_compra',
  scenarios: [],
  tags    : ['baas', 'valor_de_compra', 'residual'],
  source  : 'tests_unit/calc/ValorDeCompraTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/valor_de_compra: structural invariants');

    var r = calcValorDeCompra({ systemCapexMxn: 1000000 });  // clean round number

    // Year 0 = full capexConIva; year term = exactly 0.
    t.assert('year 0 = capexConIva', 1160000, r.schedule[0].valorMxn, 0.01);
    t.assert('year term = 0', 0, r.schedule[16].valorMxn, 1e-6);

    // Monotonic strictly-decreasing, equal steps of annualDecline.
    var ok = true, equalSteps = true;
    for (var n = 1; n <= 16; n++) {
      var step = r.schedule[n - 1].valorMxn - r.schedule[n].valorMxn;
      if (r.schedule[n].valorMxn > r.schedule[n - 1].valorMxn) ok = false;
      if (Math.abs(step - r.annualDeclineMxn) > 1e-6) equalSteps = false;
    }
    t.assertTrue('strictly non-increasing', ok);
    t.assertTrue('equal annual steps (straight-line)', equalSteps);

    // Never negative (clamp holds).
    var neverNeg = true;
    for (var k = 0; k < r.schedule.length; k++) if (r.schedule[k].valorMxn < 0) neverNeg = false;
    t.assertTrue('never negative (clamped to 0)', neverNeg);

    // Custom term + iva parametrization.
    var r2 = calcValorDeCompra({ systemCapexMxn: 1000000, ivaPct: 0, term: 10 });
    t.assert('iva=0 -> capexConIva = capex', 1000000, r2.capexConIva, 0.01);
    t.assert('term=10 -> 11 rows', 11, r2.schedule.length);
    t.assert('term=10 year10 = 0', 0, r2.schedule[10].valorMxn, 1e-6);
  }
});


registerTest({
  id      : 'UNIT_VDC_GUARDS',
  group   : 'unit',
  module  : 'calc/valor_de_compra',
  scenarios: [],
  tags    : ['baas', 'valor_de_compra', 'residual'],
  source  : 'tests_unit/calc/ValorDeCompraTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/valor_de_compra: input guards');

    t.assertThrows('zero capex throws', function () { calcValorDeCompra({ systemCapexMxn: 0 }); });
    t.assertThrows('negative capex throws', function () { calcValorDeCompra({ systemCapexMxn: -5 }); });
    t.assertThrows('missing capex throws', function () { calcValorDeCompra({}); });
    t.assertThrows('term 0 throws', function () { calcValorDeCompra({ systemCapexMxn: 1000, term: 0 }); });
    t.assertThrows('negative iva throws', function () { calcValorDeCompra({ systemCapexMxn: 1000, ivaPct: -0.1 }); });
  }
});
