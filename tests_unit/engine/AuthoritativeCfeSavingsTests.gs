// =============================================================================
// ARGIA TESTS -- tests_unit/engine/AuthoritativeCfeSavingsTests.gs
// -----------------------------------------------------------------------------
// PHASE 0.1a golden. Locks the single-source savings math:
//   savings[m] = calcCfeBill(inp[m], tar[m]).total  -  sheet con-PV[m]
// Pure (no ss). Verifies the calcCfeBill integration (incl. IVA), the
// base-minus-conPv identity, the negative-savings guard, DAP propagation, and
// the INPUT_CFE/tariff field mapping that feeds the validated engine.
// =============================================================================

registerTest({
  id     : 'UNIT_AUTHORITATIVE_CFE_SAVINGS',
  group  : 'unit',
  module : 'unit/cfe_savings',
  scenarios: [],
  tags   : ['unit', 'cfe', 'savings', 'phase0.1a', 'silent-split'],
  source : 'tests_unit/engine/AuthoritativeCfeSavingsTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT unit/cfe_savings: authoritative savings = base - sheet con-PV');

    // Energy-only case: every non-energy charge is 0, so subtotal = energy.
    //   energia = 1000*1 + 500*2 + 200*3 = 2600 ; CFE power-factor BONUS at pf=1
    //   (kVArh=0) credits ~2.5% => cargoFp = -65 ; subtotal = 2535 ; IVA 16% = 405.6
    //   ; total = 2940.6. (calcCfeBill models the PF bonus -- the golden locks it.)
    var inp = { tarifa: 'GDMTH', kWhBase: 1000, kWhIntermedia: 500, kWhPunta: 200,
                kWBase: 0, kWIntermedia: 0, kWPunta: 0, kWMaxAnoMovil: 0,
                kVArh: 0, bajaTension2pct: false, dap: 0 };
    var tar = { energiaBase: 1.0, energiaInter: 2.0, energiaPunta: 3.0,
                transmision: 0, cenace: 0, scnmem: 0,
                capacidad: 0, distribucion: 0, suministro: 0 };

    // -- 1. GOLDEN: calcCfeBill total incl. IVA -------------------------------
    t.assertNear('GOLDEN calcCfeBill.total = 2940.6 (energy 2600 - PF bonus 65, +16% IVA)',
                 2940.6, calcCfeBill(inp, tar).total, 0.5);

    // -- 2. savings = base - conPv identity, base = calcCfeBill().total -------
    var inputs = [], tars = [], conpv = [];
    for (var m = 0; m < 12; m++) { inputs.push(inp); tars.push(tar); conpv.push(2000); }
    var r = computeAuthoritativeCfeSavings(inputs, tars, conpv);
    t.assert('returns 12 monthly savings', 12, r.savings.length);
    t.assertNear('base[0] = 2940.6', 2940.6, r.base[0], 0.5);
    t.assertNear('savings[0] = base - conPv = 940.6', 940.6, r.savings[0], 0.5);
    t.assertTrue('identity savings == base - conPv',
                 Math.abs(r.savings[0] - (r.base[0] - r.conPv[0])) < 1e-6);
    t.assert('no warnings on healthy case', 0, r.warnings.length);

    // -- 3. negative savings (con-PV > base) -> warning, never silent ---------
    var badConpv = [9999, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000];
    var bad = computeAuthoritativeCfeSavings(inputs, tars, badConpv);
    t.assertTrue('negative savings raises a warning', bad.warnings.length >= 1);

    // -- 4. wrong array length throws (contract guard) ------------------------
    t.assertThrows('11 inputs throws', function () {
      computeAuthoritativeCfeSavings(inputs.slice(0, 11), tars, conpv);
    });

    // -- 5. DAP propagation: inp.dap = INPUT_CFE!C6 rate (5% -> total 3146) ----
    var mb = { kwhBase: [1000], kwhIntermedia: [500], kwhPunta: [200],
               kwBase: [0], kwIntermedia: [0], kwPunta: [0] };
    var made = _authMakeCfeInp(mb, 'GDMTH', { kWMaxAnoMovilKw: [0], bajaTensionToggle: false }, 0, 0.05);
    t.assertNear('mapper sets inp.dap from rate', 0.05, made.dap, 1e-9);
    t.assertNear('calcCfeBill with DAP 5% = 3067.35 (2940.6 + 5% of subtotal 2535)',
                 3067.35, calcCfeBill(made, tar).total, 0.5);
    t.assert('mapper carries kWhBase', 1000, made.kWhBase);

    // -- 6. tariff field mapping (loadCfeTariffRates -> calcCfeBill tar) -------
    var tm = _authMakeCfeTar({ energiaBase: 1, energiaIntermedia: 2, energiaPunta: 3,
                               serviciosConexos: 0.1, capacidadMxnPerKw: 100,
                               distribucionMxnPerKw: 50, suministroBasicoMxnFlat: 400,
                               transmision: 0.2, cenace: 0.01 });
    t.assert('tar.energiaInter <- energiaIntermedia', 2, tm.energiaInter);
    t.assert('tar.scnmem <- serviciosConexos', 0.1, tm.scnmem);
    t.assert('tar.capacidad <- capacidadMxnPerKw', 100, tm.capacidad);
    t.assert('tar.distribucion <- distribucionMxnPerKw', 50, tm.distribucion);
    t.assert('tar.suministro <- suministroBasicoMxnFlat', 400, tm.suministro);
  }
});
