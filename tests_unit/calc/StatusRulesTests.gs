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

registerTest({
  id: 'UNIT_PS_RULE_BESS_DECISION',
  group: 'unit', module: 'calc/status_rules',
  scenarios: [], tags: ['calc', 'project_status', 'bess', 't10'],
  source: 'tests_unit/calc/StatusRulesTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/status_rules: BESS-decision transparency');

    // recommended & included -> PASS
    var incl = _psRuleBessDecision({ recommended: true, included: true });
    t.assert('recommended+included -> PASS', 'PASS', incl.level);
    t.assert('code BESS_RECOMMENDED_INCLUDED', 'BESS_RECOMMENDED_INCLUDED', incl.code);

    // recommended & excluded -> PASS_WITH_WARNINGS + omitted savings disclosed
    var excl = _psRuleBessDecision({ recommended: true, included: false,
      recommendedLabel: '2 x HW_LUNA_2MWH', omittedSavingsAnnualMxn: 5124120, omittedSavingsPct: 39.9 });
    t.assert('recommended+excluded -> PASS_WITH_WARNINGS', 'PASS_WITH_WARNINGS', excl.level);
    t.assert('code BESS_RECOMMENDED_EXCLUDED', 'BESS_RECOMMENDED_EXCLUDED', excl.code);
    t.assert('omitted savings in evidence', 5124120, excl.evidence.omittedSavingsAnnualMxn);
    t.assert('omitted % in evidence', 39.9, excl.evidence.omittedSavingsPct);
    t.assertContains('label disclosed in message', excl.message, 'HW_LUNA_2MWH');

    // soft gate: surfaces (not emittable without override) but override-able (disclosure, not hard block)
    var reduced = reduceProjectStatus([
      { level: 'PASS', code: 'CAPEX_PRESENT', message: '', evidence: {} }, excl ]);
    t.assert('worst = PASS_WITH_WARNINGS', 'PASS_WITH_WARNINGS', reduced.status);
    t.assertFalse('excluded BESS not emittable without override', isOfferEmittable(reduced.status, false));
    t.assertTrue('override emits (conscious disclosure)', isOfferEmittable(reduced.status, true));

    // not recommended -> PASS
    t.assert('not recommended -> PASS', 'PASS', _psRuleBessDecision({ recommended: false }).level);
    t.assert('code BESS_NOT_RECOMMENDED', 'BESS_NOT_RECOMMENDED', _psRuleBessDecision({ recommended: false }).code);

    // no data -> NOT_EVALUATED
    var none = _psRuleBessDecision(null);
    t.assert('no recommendations sheet -> PASS', 'PASS', none.level);
    t.assert('code BESS_DECISION_NOT_EVALUATED', 'BESS_DECISION_NOT_EVALUATED', none.code);
  }
});


// A3a -- AGS-802 §5.3 human/field gates surfaced as NOT_EVALUATED (PASS-level).
registerTest({
  id: 'UNIT_PS_RULE_HUMAN_GATES',
  group: 'unit', module: 'calc/status_rules',
  scenarios: [], tags: ['calc', 'project_status', 'human_gates', 'a3a', '802'],
  source: 'tests_unit/calc/StatusRulesTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/status_rules: human gates -> NOT_EVALUATED, never block');

    var gates = agsHumanGates();   // the five §5.3 human/field gates

    // No sign-offs recorded -> all pending, PASS-level advisory, NOT a block.
    var none = _psRuleHumanGates(gates, {});
    t.assert('no evidence -> PASS level', 'PASS', none.level);
    t.assert('code HUMAN_GATES_NOT_EVALUATED', 'HUMAN_GATES_NOT_EVALUATED', none.code);
    t.assert('all 5 gates pending', 5, none.evidence.pending);
    t.assertContains('message names DRO (AGS-206)', none.message, 'AGS-206');
    t.assertContains('message names UVIE (AGS-602)', none.message, 'AGS-602');

    // Crucially: adding this rule must NOT change a PASS verdict or emittability.
    var reduced = reduceProjectStatus([
      { level: 'PASS', code: 'CAPEX_PRESENT', message: '', evidence: {} }, none ]);
    t.assert('reduce stays PASS', 'PASS', reduced.status);
    t.assertTrue('still emittable (human gates never block the proposal)',
                 isOfferEmittable(reduced.status, false));

    // All recorded -> PASS, code flips to RECORDED, zero pending.
    var ev = {}; gates.forEach(function (g) { ev[g.ref] = true; });
    var all = _psRuleHumanGates(gates, ev);
    t.assert('all recorded -> PASS', 'PASS', all.level);
    t.assert('code HUMAN_GATES_RECORDED', 'HUMAN_GATES_RECORDED', all.code);
    t.assert('zero pending', 0, all.evidence.pending);

    // Partial -> still PASS-level, only the unrecorded ones pending.
    var partial = _psRuleHumanGates(gates, { 'AGS-206': true });
    t.assert('partial -> PASS level', 'PASS', partial.level);
    t.assert('4 still pending', 4, partial.evidence.pending);

    // Empty gate list is handled (defensive).
    var empty = _psRuleHumanGates([], {});
    t.assert('no gates -> PASS', 'PASS', empty.level);
    t.assert('code HUMAN_GATES_NONE', 'HUMAN_GATES_NONE', empty.code);
  }
});
