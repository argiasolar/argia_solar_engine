// =============================================================================
// ARGIA TESTS -- tests_unit/calc/BomCompletenessTests.gs  (+ CULLIGAN REG)
// -----------------------------------------------------------------------------
// T9 (v4.43.0): BOM required-family completeness + SIN COTIZAR propagation to
// PROJECT_STATUS (INCOMPLETE not PASS) and the offer gate. PURE units + one
// workbook-dependent CULLIGAN regression.
// =============================================================================

// ---- helper: full family status with every CORE family present & priced ----
function _bomCompAllPresent(overrides) {
  var st = {
    PV_MODULES:         { present: true,  sinCotizar: false },
    INVERTERS:          { present: true,  sinCotizar: false },
    STRUCTURE:          { present: true,  sinCotizar: false },
    DC_ELECTRICAL:      { present: true,  sinCotizar: false },
    AC_ELECTRICAL:      { present: true,  sinCotizar: false },
    MONITORING_PERMITS: { present: true,  sinCotizar: false }
  };
  overrides = overrides || {};
  Object.keys(overrides).forEach(function (k) { st[k] = overrides[k]; });
  return st;
}

registerTest({
  id: 'UNIT_BOM_COMPLETENESS',
  group: 'unit', module: 'calc/bom_completeness',
  scenarios: [], tags: ['calc', 'bom', 'completeness', 't9'],
  source: 'tests_unit/calc/BomCompletenessTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/bom: required families, completeness %, SIN COTIZAR');

    // -- all 6 core present & priced (no optional) -> 100% complete -----------
    var ok = evaluateBomCompleteness(_bomCompAllPresent());
    t.assertTrue('all core present -> complete', ok.complete);
    t.assertNear('completeness = 100%', 100, ok.completenessPct, 0.001);
    t.assert('no missing', 0, ok.missingFamilies.length);
    t.assert('no SIN COTIZAR', 0, ok.sinCotizarFamilies.length);

    // -- a CORE family missing (zero-line / silently omitted) -> incomplete ---
    var missAc = evaluateBomCompleteness(_bomCompAllPresent({ AC_ELECTRICAL: { present: false, sinCotizar: false } }));
    t.assertFalse('missing AC core -> incomplete', missAc.complete);
    t.assertContains('AC_ELECTRICAL listed as missing', missAc.missingFamilies.join(','), 'AC_ELECTRICAL');
    t.assertTrue('completeness drops below 100', missAc.completenessPct < 100);

    // -- SIN COTIZAR transformer (present but unpriced) -> incomplete ---------
    var xfmr = evaluateBomCompleteness(_bomCompAllPresent({ TRANSFORMER: { present: true, sinCotizar: true } }));
    t.assertFalse('SIN COTIZAR transformer -> incomplete', xfmr.complete);
    t.assertContains('TRANSFORMER flagged SIN COTIZAR', xfmr.sinCotizarFamilies.join(','), 'TRANSFORMER');
    t.assertContains('TRANSFORMER counted as required (present)', xfmr.requiredFamilies.join(','), 'TRANSFORMER');
    // SIN COTIZAR is present, so completeness % can still be 100 -- `complete` is the gate.
    t.assertNear('present-but-unpriced still counts present (100%)', 100, xfmr.completenessPct, 0.001);

    // -- optional family absent -> not required (no penalty) ------------------
    var noBess = evaluateBomCompleteness(_bomCompAllPresent());  // BESS/TRANSFORMER absent
    t.assertFalse('BESS not in required when absent', noBess.requiredFamilies.indexOf('BESS') >= 0);
    t.assertTrue('absent optional -> still complete', noBess.complete);
  }
});

registerTest({
  id: 'UNIT_PS_RULE_BOM_COMPLETENESS',
  group: 'unit', module: 'calc/bom_completeness',
  scenarios: [], tags: ['calc', 'project_status', 'bom', 't9'],
  source: 'tests_unit/calc/BomCompletenessTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/project_status: BOM rule -> INCOMPLETE blocks offer');

    // complete -> PASS
    var pass = _psRuleBomCompleteness(evaluateBomCompleteness(_bomCompAllPresent()));
    t.assert('complete -> PASS', 'PASS', pass.level);
    t.assert('code BOM_COMPLETE', 'BOM_COMPLETE', pass.code);

    // null (no BOM) -> NOT_EVALUATED, PASS (never a false block)
    var none = _psRuleBomCompleteness(null);
    t.assert('no BOM -> PASS', 'PASS', none.level);
    t.assert('code BOM_NOT_EVALUATED', 'BOM_NOT_EVALUATED', none.code);

    // incomplete (SIN COTIZAR transformer) -> REVIEW_REQUIRED, code BOM_INCOMPLETE
    var inc = _psRuleBomCompleteness(
      evaluateBomCompleteness(_bomCompAllPresent({ TRANSFORMER: { present: true, sinCotizar: true } })));
    t.assert('incomplete -> REVIEW_REQUIRED', 'REVIEW_REQUIRED', inc.level);
    t.assert('code BOM_INCOMPLETE', 'BOM_INCOMPLETE', inc.code);

    // integration: reduce [capex PASS, BOM incomplete] -> offer NOT emittable
    var reduced = reduceProjectStatus([
      { level: 'PASS', code: 'CAPEX_PRESENT', message: '', evidence: {} },
      inc
    ]);
    t.assert('worst status = REVIEW_REQUIRED', 'REVIEW_REQUIRED', reduced.status);
    t.assertFalse('SIN COTIZAR line blocks the offer (not emittable)', reduced.emittable);
    t.assertFalse('isOfferEmittable false without override', isOfferEmittable(reduced.status, false));
    t.assertTrue('emittable only with explicit override', isOfferEmittable(reduced.status, true));

    // financials guard note fires on incomplete BOM (and only then)
    var notes = argiaFinancialGuardNotes({ omCostMxnPerYear: 1, replacementReserveMxnPerYear: 1,
      bessMaterialsMxn: 0, bomIncomplete: true, bomMissingFamilies: ['TRANSFORMER'] });
    t.assertTrue('BOM_INCOMPLETE note fires', notes.map(function (n) { return n.code; }).indexOf('BOM_INCOMPLETE') >= 0);
    var notes2 = argiaFinancialGuardNotes({ omCostMxnPerYear: 1, replacementReserveMxnPerYear: 1, bessMaterialsMxn: 0 });
    t.assertFalse('no BOM_INCOMPLETE note when flag absent',
      notes2.map(function (n) { return n.code; }).indexOf('BOM_INCOMPLETE') >= 0);
  }
});
