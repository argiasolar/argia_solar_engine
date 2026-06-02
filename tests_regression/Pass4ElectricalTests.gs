// =============================================================================
// ARGIA TESTS -- tests_regression/Pass4ElectricalTests.gs
// -----------------------------------------------------------------------------
// PASS 4 electrical-correctness regression guards.
//
//   4a. AC conductor ampacity must apply the continuous-load rule, sizing to
//       the GREATER of (1.25 x I) and (I / (Ft x Fag)). The prior code used
//       only the derate branch, undersizing feeders whose 1.25xI governed.
//       (requiredAmpacity in 05_CalcAC.gs)
//   4b. Cold-Voc and hot-Vmp use SEPARATE temperature coefficients, resolved
//       from dedicated DB columns / Voc override, falling back to the Pmax
//       proxy only when nothing better exists.
//       (resolveTempCoeffs in 04_CalcDC.gs)
//
// CLASSIFICATION
//   group=regression. Both exercise pure functions with synthetic inputs --
//   no sheet access, so they run in the Node rig and the ARGIA menu identically.
//
// DEPENDENCIES
//   - requiredAmpacity   (05_CalcAC.gs)
//   - resolveTempCoeffs  (04_CalcDC.gs)
// =============================================================================


// ----------------------------------------------------------------------------
// 4a) AC ampacity continuous-load rule
// ----------------------------------------------------------------------------
registerTest({
  id      : 'UNIT_PASS4_AC_AMPACITY_CONTINUOUS_FACTOR',
  group   : 'regression',
  module  : 'calc/ac',
  scenarios: [],
  tags    : ['regression', 'ac', 'ampacity', 'pass4'],
  source  : 'tests_regression/Pass4ElectricalTests.gs',
  fn      : function (t) {
    t.suite('REGRESSION calc/ac: requiredAmpacity = max(1.25xI, I/derate)');

    // No derating -> the 1.25 continuous branch governs.
    t.assert('1.25 governs (ft=fag=1)', 125, requiredAmpacity(100, 1, 1), 0.001);

    // Heavy derating -> the derate branch governs.
    t.assert('derate governs (0.7x0.7)', 100 / 0.49, requiredAmpacity(100, 0.7, 0.7), 0.01);

    // LIVE regression: SE100KUS I_AC=120.28 A, Ft=0.91, Fag=1.0.
    //   old code  = 120.28 / 0.91          = 132.18 A  (what the sheet showed)
    //   new rule  = max(150.35, 132.18)    = 150.35 A  (1.25 branch governs)
    var live = requiredAmpacity(120.28, 0.91, 1);
    t.assert('live SE100KUS ampReq', 150.35, live, 0.01);
    t.assertTrue('continuous rule raises the requirement above the old derate-only value',
      live > 120.28 / 0.91);

    // Continuous factor is tunable (UVIE sign-off): contFactor=1.0 disables it.
    t.assert('contFactor=1.0 -> derate only', 100, requiredAmpacity(100, 1, 1, 1.0), 0.001);
  }
});


// ----------------------------------------------------------------------------
// 4b) Separate Voc / Vmp temperature coefficients
// ----------------------------------------------------------------------------
registerTest({
  id      : 'UNIT_PASS4_TEMP_COEFFS_RESOLUTION',
  group   : 'regression',
  module  : 'calc/dc',
  scenarios: [],
  tags    : ['regression', 'dc', 'temp_coeff', 'pass4'],
  source  : 'tests_regression/Pass4ElectricalTests.gs',
  fn      : function (t) {
    t.suite('REGRESSION calc/dc: resolveTempCoeffs Voc/Vmp resolution order');

    // A) Only Pmax present -> both coeffs fall back to the Pmax proxy
    //    (unchanged behaviour for panels that only carry PANEL_TEMP_PMAX).
    var a = resolveTempCoeffs({ PANEL_TEMP_PMAX: -0.0029 }, {});
    t.assert('A voc=pmax', -0.0029, a.vocCoeff, 1e-9);
    t.assert('A vmp=pmax', -0.0029, a.vmpCoeff, 1e-9);
    t.assertTrue('A voc source PMAX_PROXY', a.vocSource === 'PMAX_PROXY');
    t.assertTrue('A vmp source PMAX_PROXY', a.vmpSource === 'PMAX_PROXY');

    // B) Voc override is now an actual override (was fallback-only). Vmp still
    //    uses the Pmax proxy (the override is Voc-specific).
    var b = resolveTempCoeffs({ PANEL_TEMP_PMAX: -0.0029 }, { tempCoeffOverride: -0.0025 });
    t.assert('B voc=override', -0.0025, b.vocCoeff, 1e-9);
    t.assert('B vmp=pmax',     -0.0029, b.vmpCoeff, 1e-9);
    t.assertTrue('B voc source OVERRIDE', b.vocSource === 'OVERRIDE');
    t.assertTrue('B vmp source PMAX_PROXY', b.vmpSource === 'PMAX_PROXY');

    // C) Dedicated DB columns win for both.
    var c = resolveTempCoeffs(
      { PANEL_TEMP_PMAX: -0.0029, PANEL_TEMP_VOC: -0.0026, PANEL_TEMP_VMP: -0.0040 }, {});
    t.assert('C voc=DB_VOC', -0.0026, c.vocCoeff, 1e-9);
    t.assert('C vmp=DB_VMP', -0.0040, c.vmpCoeff, 1e-9);
    t.assertTrue('C voc source DB_VOC', c.vocSource === 'DB_VOC');
    t.assertTrue('C vmp source DB_VMP', c.vmpSource === 'DB_VMP');

    // D) DB column beats the override for Voc.
    var d = resolveTempCoeffs({ PANEL_TEMP_VOC: -0.0026 }, { tempCoeffOverride: -0.0025 });
    t.assert('D voc=DB_VOC (beats override)', -0.0026, d.vocCoeff, 1e-9);
    t.assertTrue('D voc source DB_VOC', d.vocSource === 'DB_VOC');
  }
});
