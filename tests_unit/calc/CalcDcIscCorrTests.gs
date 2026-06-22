// =============================================================================
// ARGIA TESTS -- tests_unit/calc/CalcDcIscCorrTests.gs
// -----------------------------------------------------------------------------
// AGS conformance track -- Task A2b. Locks the FR-205-03 Isc temperature
// correction. PURE (no workbook): exercises resolveTempCoeffs directly and the
// Isc,corr arithmetic, and cross-checks the TESTPROJ_001 DC goldens so the
// design-current values can never drift from the formula.
//
// Why pure here: calcDC needs nom/tbls from the sheet (workbook-dependent), but
// the *coefficient resolution* and the *temperature-correction formula* are pure
// arithmetic and must hold identically in Node and Apps Script.
//
// COVERAGE (2 tests):
//   1. UNIT_CALC_DC_ISC_TEMPCO_RESOLUTION -- DB_ISC > OVERRIDE > DEFAULT, default = +0.05%/C
//   2. UNIT_CALC_DC_ISC_CORR_MATH         -- Isc,corr formula + TESTPROJ_001 golden cross-check
// =============================================================================

function _iscCorr(isc, iscCoeff, ambientDC) {
  return isc * (1 + iscCoeff * (ambientDC - 25));   // FR-205-03
}

registerTest({
  id      : 'UNIT_CALC_DC_ISC_TEMPCO_RESOLUTION',
  group   : 'unit',
  module  : 'calc/dc',
  scenarios: [],
  tags    : ['calc', 'dc', 'isc', 'a2b'],
  source  : 'tests_unit/calc/CalcDcIscCorrTests.gs',
  fn      : function (t) {
    t.suite('UNIT calc/dc: Isc temperature-coefficient resolution (FR-205-03)');

    // Default when no datasheet value and no override: +0.05%/C.
    var d = resolveTempCoeffs({}, {});
    t.assertNear('default iscCoeff = 0.0005', 0.0005, d.iscCoeff, 1e-9);
    t.assert('default iscSource = DEFAULT', 'DEFAULT', d.iscSource);

    // Datasheet value wins.
    var db = resolveTempCoeffs({ 'PANEL_TEMP_ISC': 0.00042 }, {});
    t.assertNear('DB iscCoeff used', 0.00042, db.iscCoeff, 1e-9);
    t.assert('iscSource = DB_ISC', 'DB_ISC', db.iscSource);

    // Override beats default (but not datasheet).
    var ov = resolveTempCoeffs({}, { iscCoeffOverride: 0.0006 });
    t.assertNear('override iscCoeff used', 0.0006, ov.iscCoeff, 1e-9);
    t.assert('iscSource = OVERRIDE', 'OVERRIDE', ov.iscSource);

    var both = resolveTempCoeffs({ 'PANEL_TEMP_ISC': 0.00042 }, { iscCoeffOverride: 0.0006 });
    t.assert('datasheet beats override', 'DB_ISC', both.iscSource);

    // Isc coeff never inherits the (negative) Pmax proxy.
    var pm = resolveTempCoeffs({ 'PANEL_TEMP_PMAX': -0.0029 }, {});
    t.assertNear('iscCoeff stays positive default under Pmax-only panel', 0.0005, pm.iscCoeff, 1e-9);
    t.assertTrue('iscCoeff is positive', pm.iscCoeff > 0);
  }
});


registerTest({
  id      : 'UNIT_CALC_DC_ISC_CORR_MATH',
  group   : 'unit',
  module  : 'calc/dc',
  scenarios: [],
  tags    : ['calc', 'dc', 'isc', 'a2b'],
  source  : 'tests_unit/calc/CalcDcIscCorrTests.gs',
  fn      : function (t) {
    t.suite('UNIT calc/dc: Isc,corr formula + TESTPROJ_001 golden cross-check');

    // No correction at STC (25 C): Isc,corr == Isc.
    t.assertNear('Isc,corr at 25C equals STC Isc', 14.27, _iscCorr(14.27, 0.0005, 25), 1e-9);

    // Correction raises the current at the design max temperature.
    var iscCorr = _iscCorr(14.27, 0.0005, 60);   // ambientDC = 60 C
    t.assertNear('Isc,corr @ 60C = 14.5197', 14.519725, iscCorr, 1e-4);
    t.assertTrue('Isc,corr > STC Isc', iscCorr > 14.27);

    // The design currents are the factors applied to Isc,corr (not STC Isc).
    var isc125 = iscCorr * 1.25;        // NOM 690.8(a)
    var iDesign = iscCorr * 1.5625;     // NOM 690.8(b)
    t.assertNear('isc125 = 18.1497', 18.1497, isc125, 1e-3);
    t.assertNear('iDesign = 22.6871', 22.6871, iDesign, 1e-3);

    // Cross-check against the locked TESTPROJ_001 DC goldens so the goldens and
    // the formula can never drift apart (the goldens themselves run in-sheet).
    if (typeof TESTPROJ_001 !== 'undefined' && TESTPROJ_001.expected && TESTPROJ_001.expected.dc) {
      var g = TESTPROJ_001.expected.dc;
      t.assertNear('golden isc125 matches Isc,corr x 1.25', isc125, g.isc125, 1e-3);
      t.assertNear('golden iDesign matches Isc,corr x 1.5625', iDesign, g.iDesign, 1e-3);
    }
  }
});
