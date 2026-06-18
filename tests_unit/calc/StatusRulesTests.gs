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

registerTest({
  id: 'UNIT_PS_RULE_CFE_DATA_QUALITY',
  group: 'unit', module: 'calc/status_rules',
  scenarios: [], tags: ['calc', 'project_status', 'cfe', 't10'],
  source: 'tests_unit/calc/StatusRulesTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/status_rules: CFE data-quality score + bands');

    function snap(o) {
      return Object.assign({ tariffPresent: true, kwhMonths: 12, kwMonths: 12,
        pfMonths: 12, billingMonths: 12, monthsExpected: 12 }, o || {});
    }

    // full data -> 100% -> PASS
    var full = scoreCfeDataQuality(snap());
    t.assertNear('full data = 100%', 100, full.scorePct, 0.001);
    t.assert('full -> PASS', 'PASS', _psRuleCfeDataQuality(full).level);
    t.assert('code CFE_DATA_OK', 'CFE_DATA_OK', _psRuleCfeDataQuality(full).code);

    // one dimension half-present -> still PASS (95%)
    var mild = scoreCfeDataQuality(snap({ kwhMonths: 6 }));
    t.assertNear('one dim 6/12 -> 90%', 90, mild.scorePct, 0.001);
    t.assert('90% -> PASS', 'PASS', _psRuleCfeDataQuality(mild).level);

    // 70% -> REVIEW_REQUIRED  (tariff + kWh full, kW/pf/billing half: (1+1+.5+.5+.5)/5)
    var low = scoreCfeDataQuality(snap({ kwMonths: 6, pfMonths: 6, billingMonths: 6 }));
    t.assertNear('mixed -> 70%', 70, low.scorePct, 0.001);
    t.assert('70% -> REVIEW_REQUIRED', 'REVIEW_REQUIRED', _psRuleCfeDataQuality(low).level);
    t.assert('code CFE_DATA_LOW', 'CFE_DATA_LOW', _psRuleCfeDataQuality(low).code);

    // < 60% -> BLOCKED, and not emittable even with override
    var crit = scoreCfeDataQuality(snap({ tariffPresent: false, kwhMonths: 6, kwMonths: 6,
      pfMonths: 0, billingMonths: 6 }));   // (0 + .5 + .5 + 0 + .5)/5 = 30%
    t.assertNear('critical -> 30%', 30, crit.scorePct, 0.001);
    var critRule = _psRuleCfeDataQuality(crit);
    t.assert('30% -> BLOCKED', 'BLOCKED', critRule.level);
    var reduced = reduceProjectStatus([
      { level: 'PASS', code: 'CAPEX_PRESENT', message: '', evidence: {} }, critRule ]);
    t.assertFalse('CFE critical blocks offer (override ignored)', isOfferEmittable(reduced.status, true));

    // boundary: exactly 80% -> PASS; exactly 60% -> REVIEW
    var at80 = _psRuleCfeDataQuality({ scorePct: 80, dimensions: {} });
    t.assert('80% -> PASS (>= review threshold)', 'PASS', at80.level);
    var at60 = _psRuleCfeDataQuality({ scorePct: 60, dimensions: {} });
    t.assert('60% -> REVIEW (>= block, < review)', 'REVIEW_REQUIRED', at60.level);

    // no data -> NOT_EVALUATED (never a false block)
    var none = _psRuleCfeDataQuality(scoreCfeDataQuality(null));
    t.assert('no INPUT_CFE -> PASS', 'PASS', none.level);
    t.assert('code CFE_DQ_NOT_EVALUATED', 'CFE_DQ_NOT_EVALUATED', none.code);
  }
});
