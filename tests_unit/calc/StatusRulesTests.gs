// =============================================================================
// ARGIA TESTS -- tests_unit/calc/StatusRulesTests.gs
// -----------------------------------------------------------------------------
// T10a (v4.44.0): status rules pack. Structure-cost-present rule (reads T7) and
// the BOM-completeness BLOCKED band (reads T9). PURE units in isolation +
// engine-reduction integration. CULLIGAN regression lives in
// tests_regression/v2/StatusRulesCulliganTests.gs.
// =============================================================================

registerTest({
  id: 'UNIT_PS_RULE_STRUCTURE_COST',
  group: 'unit', module: 'calc/status_rules',
  scenarios: [], tags: ['calc', 'project_status', 'structure', 't10'],
  source: 'tests_unit/calc/StatusRulesTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/status_rules: structure_cost == 0 -> BLOCKED');

    // priced -> PASS
    var ok = _psRuleStructureCost(24300);
    t.assert('structure > 0 -> PASS', 'PASS', ok.level);
    t.assert('code STRUCTURE_COST_PRESENT', 'STRUCTURE_COST_PRESENT', ok.code);

    // zero -> BLOCKED (hard stop, override cannot emit)
    var zero = _psRuleStructureCost(0);
    t.assert('structure == 0 -> BLOCKED', 'BLOCKED', zero.level);
    t.assert('code STRUCTURE_COST_ZERO', 'STRUCTURE_COST_ZERO', zero.code);
    var reduced = reduceProjectStatus([
      { level: 'PASS', code: 'CAPEX_PRESENT', message: '', evidence: {} }, zero ]);
    t.assert('reduce -> BLOCKED', 'BLOCKED', reduced.status);
    t.assertFalse('BLOCKED not emittable even with override', isOfferEmittable(reduced.status, true));

    // unknown -> NOT_EVALUATED (PASS-level, never a false block)
    [null, undefined, NaN, 'abc'].forEach(function (v) {
      var r = _psRuleStructureCost(v);
      t.assert('structure unknown (' + String(v) + ') -> PASS', 'PASS', r.level);
      t.assert('code STRUCTURE_NOT_EVALUATED', 'STRUCTURE_NOT_EVALUATED', r.code);
    });
  }
});

registerTest({
  id: 'UNIT_PS_RULE_BOM_BAND',
  group: 'unit', module: 'calc/status_rules',
  scenarios: [], tags: ['calc', 'project_status', 'bom', 't10'],
  source: 'tests_unit/calc/StatusRulesTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/status_rules: BOM completeness band (<' +
            BOM_COMPLETENESS_BLOCK_PCT + '% -> BLOCKED)');

    // Only 2 of 6 core present -> 33% < 60% -> BLOCKED.
    var low = evaluateBomCompleteness({
      PV_MODULES: { present: true,  sinCotizar: false },
      INVERTERS:  { present: true,  sinCotizar: false }
      // STRUCTURE / DC / AC / MONITORING absent
    });
    t.assertTrue('completeness < block threshold', low.completenessPct < BOM_COMPLETENESS_BLOCK_PCT);
    var lowRule = _psRuleBomCompleteness(low);
    t.assert('very incomplete BOM -> BLOCKED', 'BLOCKED', lowRule.level);
    t.assert('threshold surfaced in evidence', BOM_COMPLETENESS_BLOCK_PCT, lowRule.evidence.blockThresholdPct);

    // One family missing but >= 60% present -> REVIEW_REQUIRED (override-able).
    var mid = evaluateBomCompleteness({
      PV_MODULES: { present: true, sinCotizar: false },
      INVERTERS:  { present: true, sinCotizar: false },
      STRUCTURE:  { present: true, sinCotizar: false },
      DC_ELECTRICAL: { present: true, sinCotizar: false },
      AC_ELECTRICAL: { present: true, sinCotizar: false }
      // MONITORING_PERMITS absent -> 5/6 = 83.3%
    });
    t.assertTrue('completeness >= block threshold', mid.completenessPct >= BOM_COMPLETENESS_BLOCK_PCT);
    t.assert('partial BOM (>=60%) -> REVIEW_REQUIRED', 'REVIEW_REQUIRED', _psRuleBomCompleteness(mid).level);

    // SIN COTIZAR only (100% present) -> REVIEW_REQUIRED, not BLOCKED.
    var sincot = evaluateBomCompleteness({
      PV_MODULES: { present: true, sinCotizar: false },
      INVERTERS:  { present: true, sinCotizar: false },
      STRUCTURE:  { present: true, sinCotizar: true },
      DC_ELECTRICAL: { present: true, sinCotizar: false },
      AC_ELECTRICAL: { present: true, sinCotizar: false },
      MONITORING_PERMITS: { present: true, sinCotizar: false }
    });
    t.assertNear('SIN COTIZAR-only still 100% present', 100, sincot.completenessPct, 0.001);
    t.assert('SIN COTIZAR-only -> REVIEW_REQUIRED', 'REVIEW_REQUIRED', _psRuleBomCompleteness(sincot).level);
  }
});
