// =============================================================================
// ARGIA TESTS -- tests_unit/calc/CfeBaselineSavingsTests.gs
// -----------------------------------------------------------------------------
// T1 (v4.34.0) -- lock the canonical CFE "sin PV" base + savings identity.
//
// PURE unit tests (no workbook). They bake the CULLIGAN PV=0 monthly inputs and
// the 12 GDMTH GOLFO NORTE tariff months (extracted from the live workbook on
// 2026-06-17) and exercise the exact functions 20b uses at runtime:
//   - calcCfeBill (04a)                  -- the no-PV base bill
//   - computeAuthoritativeCfeSavings (20b)
//   - surfaceCfeBaseline_ (20b)          -- the D12/D13/D14 cell-write spec
//
// GOLDEN: the CULLIGAN no-PV annual base = 12,838,765.45 MXN, reproduced from
// first principles (independent of any sheet) at the canonical power-factor
// threshold fpThreshold = 0.90. This is the same figure locked by the live
// regression suite (ClientFinancialsCulliganTests, CulliganBaselineV2Tests) and
// it is UNCHANGED by T1 (CULLIGAN is MEDICION_NETA, so the legacy export credit
// O40 = 0 and the old D12 reconstruction already equalled the engine base).
//
// COVERAGE (4 tests):
//   1. UNIT_CFE_BASELINE_FIRST_PRINCIPLES   -- engine base == 12,838,765.45
//   2. UNIT_CFE_SAVINGS_IDENTITY            -- savings[m] = base[m] - conPv[m];
//                                              base = conPv + savings (annual)
//   3. UNIT_CFE_SURFACE_BASELINE_SPEC       -- surfaceCfeBaseline_ emits d12 ===
//                                              base, derived D13/D14 formulas
//   4. UNIT_CFE_BASELINE_EXPORT_SAFETY      -- surfaced d12 is the engine base,
//                                              NOT the legacy O39+O41+O40 add-back
//                                              (the +O40 double-count is gone)
// =============================================================================


// CULLIGAN PV=0 monthly inputs (calcCfeBill shape). selfConsumption is N/A here
// -- PV=0 means kWh/kW are the gross consumption (the no-PV base).
function _cfeBaseInputsCulligan_() {
  return [
    { tarifa: 'GDMTH', kWhBase: 82421, kWhIntermedia: 181165, kWhPunta: 43956, kWBase: 575, kWIntermedia: 691, kWPunta: 662, kWMaxAnoMovil: 691, kVArh: 160175, bajaTension2pct: false, dap: 0 },
    { tarifa: 'GDMTH', kWhBase: 88036, kWhIntermedia: 187441, kWhPunta: 45183, kWBase: 636, kWIntermedia: 804, kWPunta: 785, kWMaxAnoMovil: 804, kVArh: 164516, bajaTension2pct: false, dap: 0 },
    { tarifa: 'GDMTH', kWhBase: 112992, kWhIntermedia: 222654, kWhPunta: 54473, kWBase: 781, kWIntermedia: 856, kWPunta: 824, kWMaxAnoMovil: 856, kVArh: 211262, bajaTension2pct: false, dap: 0 },
    { tarifa: 'GDMTH', kWhBase: 108353, kWhIntermedia: 263546, kWhPunta: 30896, kWBase: 764, kWIntermedia: 909, kWPunta: 792, kWMaxAnoMovil: 909, kVArh: 224473, bajaTension2pct: false, dap: 0 },
    { tarifa: 'GDMTH', kWhBase: 103743, kWhIntermedia: 244770, kWhPunta: 23283, kWBase: 708, kWIntermedia: 790, kWPunta: 687, kWMaxAnoMovil: 790, kVArh: 178138, bajaTension2pct: false, dap: 0 },
    { tarifa: 'GDMTH', kWhBase: 106055, kWhIntermedia: 254972, kWhPunta: 25815, kWBase: 692, kWIntermedia: 803, kWPunta: 715, kWMaxAnoMovil: 803, kVArh: 185376, bajaTension2pct: false, dap: 0 },
    { tarifa: 'GDMTH', kWhBase: 116676, kWhIntermedia: 285348, kWhPunta: 29270, kWBase: 708, kWIntermedia: 823, kWPunta: 709, kWMaxAnoMovil: 823, kVArh: 211056, bajaTension2pct: false, dap: 0 },
    { tarifa: 'GDMTH', kWhBase: 115306, kWhIntermedia: 259932, kWhPunta: 25327, kWBase: 673, kWIntermedia: 800, kWPunta: 690, kWMaxAnoMovil: 800, kVArh: 205040, bajaTension2pct: false, dap: 0 },
    { tarifa: 'GDMTH', kWhBase: 100156, kWhIntermedia: 237587, kWhPunta: 24040, kWBase: 673, kWIntermedia: 813, kWPunta: 691, kWMaxAnoMovil: 813, kVArh: 176262, bajaTension2pct: false, dap: 0 },
    { tarifa: 'GDMTH', kWhBase: 115671, kWhIntermedia: 286174, kWhPunta: 35036, kWBase: 687, kWIntermedia: 866, kWPunta: 827, kWMaxAnoMovil: 866, kVArh: 219870, bajaTension2pct: false, dap: 0 },
    { tarifa: 'GDMTH', kWhBase: 126167, kWhIntermedia: 229271, kWhPunta: 53453, kWBase: 711, kWIntermedia: 865, kWPunta: 807, kWMaxAnoMovil: 865, kVArh: 203174, bajaTension2pct: false, dap: 0 },
    { tarifa: 'GDMTH', kWhBase: 72225, kWhIntermedia: 149080, kWhPunta: 34970, kWBase: 549, kWIntermedia: 687, kWPunta: 644, kWMaxAnoMovil: 687, kVArh: 129863, bajaTension2pct: false, dap: 0 }
  ];
}

// 12 GDMTH GOLFO NORTE tariff months (calcCfeBill tar shape).
function _cfeBaseTariffsGdmthGolfoNorte_() {
  return [
    { energiaBase: 0.8276, energiaInter: 1.3921, energiaPunta: 1.5273, transmision: 0.1801, cenace: 0.0076, scnmem: 0.0069, capacidad: 401.78, distribucion: 57.74, suministro: 502.03 },
    { energiaBase: 0.828, energiaInter: 1.3929, energiaPunta: 1.5282, transmision: 0.1801, cenace: 0.0076, scnmem: 0.0069, capacidad: 402.01, distribucion: 57.74, suministro: 502.03 },
    { energiaBase: 0.8285, energiaInter: 1.3937, energiaPunta: 1.5292, transmision: 0.1801, cenace: 0.0076, scnmem: 0.0069, capacidad: 402.26, distribucion: 57.74, suministro: 502.03 },
    { energiaBase: 0.8285, energiaInter: 1.3937, energiaPunta: 1.5291, transmision: 0.1801, cenace: 0.0076, scnmem: 0.0069, capacidad: 402.24, distribucion: 57.74, suministro: 502.03 },
    { energiaBase: 0.8202, energiaInter: 1.3798, energiaPunta: 1.5138, transmision: 0.1801, cenace: 0.0076, scnmem: 0.0069, capacidad: 398.22, distribucion: 57.74, suministro: 502.03 },
    { energiaBase: 0.8121, energiaInter: 1.366, energiaPunta: 1.4988, transmision: 0.1801, cenace: 0.0076, scnmem: 0.0069, capacidad: 394.26, distribucion: 57.74, suministro: 502.03 },
    { energiaBase: 0.9259, energiaInter: 1.5576, energiaPunta: 1.7089, transmision: 0.1809, cenace: 0.0065, scnmem: 0.0062, capacidad: 449.54, distribucion: 60.03, suministro: 551.77 },
    { energiaBase: 0.9272, energiaInter: 1.5597, energiaPunta: 1.7113, transmision: 0.1809, cenace: 0.0065, scnmem: 0.0062, capacidad: 450.17, distribucion: 60.03, suministro: 551.77 },
    { energiaBase: 0.9187, energiaInter: 1.5455, energiaPunta: 1.6956, transmision: 0.1809, cenace: 0.0065, scnmem: 0.0062, capacidad: 446.05, distribucion: 60.03, suministro: 551.77 },
    { energiaBase: 0.9187, energiaInter: 1.5455, energiaPunta: 1.6957, transmision: 0.1809, cenace: 0.0065, scnmem: 0.0062, capacidad: 446.06, distribucion: 60.03, suministro: 551.77 },
    { energiaBase: 0.8912, energiaInter: 1.4991, energiaPunta: 1.6447, transmision: 0.1809, cenace: 0.0065, scnmem: 0.0062, capacidad: 432.66, distribucion: 60.03, suministro: 551.77 },
    { energiaBase: 0.8466, energiaInter: 1.4241, energiaPunta: 1.5625, transmision: 0.1809, cenace: 0.0065, scnmem: 0.0062, capacidad: 411.03, distribucion: 60.03, suministro: 551.77 }
  ];
}

var _CFE_CULLIGAN_BASE_GOLDEN = 12838765.45;


registerTest({
  id      : 'UNIT_CFE_BASELINE_FIRST_PRINCIPLES',
  group   : 'unit',
  module  : 'calc/cfe_baseline',
  scenarios: [],
  tags    : ['calc', 'cfe', 'baseline', 't1'],
  source  : 'tests_unit/calc/CfeBaselineSavingsTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/cfe_baseline: CULLIGAN no-PV base from first principles');

    var inp = _cfeBaseInputsCulligan_();
    var tar = _cfeBaseTariffsGdmthGolfoNorte_();

    var annual = 0;
    for (var m = 0; m < 12; m++) {
      annual += calcCfeBill(inp[m], tar[m]).total;   // default fpThreshold 0.90
    }

    // Reproduces the locked CULLIGAN golden to the cent.
    t.assertNear('CULLIGAN no-PV annual base (fpThreshold 0.90)',
                 _CFE_CULLIGAN_BASE_GOLDEN, annual, 0.5);
    t.info('base', annual.toFixed(2) + ' MXN (golden ' + _CFE_CULLIGAN_BASE_GOLDEN + ')');
  }
});


registerTest({
  id      : 'UNIT_CFE_SAVINGS_IDENTITY',
  group   : 'unit',
  module  : 'calc/cfe_baseline',
  scenarios: [],
  tags    : ['calc', 'cfe', 'savings', 't1'],
  source  : 'tests_unit/calc/CfeBaselineSavingsTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/cfe_baseline: savings = base - conPv identity');

    var inp = _cfeBaseInputsCulligan_();
    var tar = _cfeBaseTariffsGdmthGolfoNorte_();

    // Synthetic sheet con-PV (row 39): take 78% of each month's base. The exact
    // figure is irrelevant -- this test locks the IDENTITY, not a value.
    var base = [], conPv = [];
    for (var m = 0; m < 12; m++) {
      var b = calcCfeBill(inp[m], tar[m]).total;
      base.push(b); conPv.push(b * 0.78);
    }

    var res = computeAuthoritativeCfeSavings(inp, tar, conPv);

    var sumBase = 0, sumConPv = 0, sumSav = 0;
    for (var i = 0; i < 12; i++) {
      t.assertNear('month ' + (i + 1) + ': savings = base - conPv',
                   base[i] - conPv[i], res.savings[i], 0.001);
      sumBase += res.base[i]; sumConPv += res.conPv[i]; sumSav += res.savings[i];
    }
    // Annual reconciliation: base == conPv + savings.
    t.assertNear('annual base == conPv + savings', sumBase, sumConPv + sumSav, 0.01);
    t.assertTrue('no spurious warnings on clean inputs', res.warnings.length === 0);
  }
});


registerTest({
  id      : 'UNIT_CFE_SURFACE_BASELINE_SPEC',
  group   : 'unit',
  module  : 'calc/cfe_baseline',
  scenarios: [],
  tags    : ['calc', 'cfe', 'baseline', 'surface', 't1'],
  source  : 'tests_unit/calc/CfeBaselineSavingsTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/cfe_baseline: surfaceCfeBaseline_ cell spec');

    var spec = surfaceCfeBaseline_(_CFE_CULLIGAN_BASE_GOLDEN);

    // D12 IS the engine base, verbatim -- no transform, no add-back.
    t.assert('D12 === annualBase (exact)', _CFE_CULLIGAN_BASE_GOLDEN, spec.d12);
    // D14 = audited con-PV cascade; D13 = derived -ahorro so the column reconciles.
    t.assert('D14 formula = con-PV cascade', '=CFE_SIMULATION!O39', spec.d14Formula);
    t.assert('D13 formula = derived -ahorro', '=D14-D12', spec.d13Formula);
    // Guard the contract: non-finite base must throw, never silently surface NaN.
    var threw = false;
    try { surfaceCfeBaseline_(NaN); } catch (e) { threw = true; }
    t.assertTrue('non-finite base throws', threw);
  }
});


registerTest({
  id      : 'UNIT_CFE_BASELINE_EXPORT_SAFETY',
  group   : 'unit',
  module  : 'calc/cfe_baseline',
  scenarios: [],
  tags    : ['calc', 'cfe', 'baseline', 'export', 'regression-guard', 't1'],
  source  : 'tests_unit/calc/CfeBaselineSavingsTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/cfe_baseline: D12 ignores the export credit (O40)');

    // The bug T1 fixes: legacy D12 = O39 + O41 + O40. For a FACTURACION_NETA
    // project O40 > 0, so the legacy D12 OVERSTATED the base by the export
    // credit. Model that here and prove the surfaced D12 equals the engine base,
    // NOT the add-back.
    var engineBase = 0;
    var inp = _cfeBaseInputsCulligan_(), tar = _cfeBaseTariffsGdmthGolfoNorte_();
    for (var m = 0; m < 12; m++) engineBase += calcCfeBill(inp[m], tar[m]).total;

    var O39 = engineBase * 0.78;            // synthetic con-PV
    var O41 = engineBase - O39;             // engine savings (row 41)
    var O40 = 250000;                       // synthetic export credit (net billing)
    var legacyReconstruction = O39 + O41 + O40;   // = engineBase + 250000 (the bug)

    var spec = surfaceCfeBaseline_(engineBase);

    t.assertNear('surfaced D12 == engine base', engineBase, spec.d12, 0.001);
    t.assertTrue('surfaced D12 != legacy O39+O41+O40 add-back',
                 Math.abs(spec.d12 - legacyReconstruction) > 1);
    t.assertNear('the add-back overstated base by exactly O40',
                 O40, legacyReconstruction - spec.d12, 0.001);
  }
});
