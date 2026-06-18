// =============================================================================
// ARGIA TESTS -- tests_unit/calc/ProjectStatusTests.gs
// -----------------------------------------------------------------------------
// T4 (v4.39.0): PROJECT_STATUS engine (33_CalcProjectStatus.js).
//
// PURE tests for the DONE-WHEN core:
//   1. UNIT_PROJECT_STATUS_REDUCE   -- rules reduce to the worst level
//   2. UNIT_PROJECT_STATUS_GATE     -- the offer gate refuses on non-PASS
//   3. UNIT_PROJECT_STATUS_HAS_CAPEX -- the one shipped rule
// =============================================================================

registerTest({
  id: 'UNIT_PROJECT_STATUS_REDUCE', group: 'unit', module: 'calc/project_status',
  scenarios: [], tags: ['calc', 'project_status', 'gate', 't4'],
  source: 'tests_unit/calc/ProjectStatusTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/project_status: reduceProjectStatus (worst-level)');

    var P = PROJECT_STATUS;

    t.assert('empty -> PASS', P.PASS, reduceProjectStatus([]).status);
    t.assertTrue('empty -> emittable', reduceProjectStatus([]).emittable);

    t.assert('all PASS -> PASS', P.PASS,
      reduceProjectStatus([{ level: P.PASS }, { level: P.PASS }]).status);

    t.assert('one warning -> PASS_WITH_WARNINGS', P.PASS_WITH_WARNINGS,
      reduceProjectStatus([{ level: P.PASS }, { level: P.PASS_WITH_WARNINGS }]).status);

    t.assert('review beats warning', P.REVIEW_REQUIRED,
      reduceProjectStatus([{ level: P.PASS_WITH_WARNINGS }, { level: P.REVIEW_REQUIRED }]).status);

    var mixed = reduceProjectStatus([
      { level: P.PASS, code: 'A' },
      { level: P.REVIEW_REQUIRED, code: 'B' },
      { level: P.BLOCKED, code: 'C' },
      { level: P.PASS_WITH_WARNINGS, code: 'D' }
    ]);
    t.assert('mixed -> BLOCKED (worst wins)', P.BLOCKED, mixed.status);
    t.assertFalse('BLOCKED -> not emittable', mixed.emittable);
    t.assert('reasons sorted worst-first (BLOCKED top)', 'C', mixed.reasons[0].code);
    t.assert('counts BLOCKED', 1, mixed.counts.BLOCKED);
    t.assert('counts PASS', 1, mixed.counts.PASS);

    // Fail-closed: an unknown level must NOT silently pass.
    var bad = reduceProjectStatus([{ level: 'WAT', code: 'X' }]);
    t.assert('unknown level -> BLOCKED (fail-closed)', P.BLOCKED, bad.status);
  }
});


registerTest({
  id: 'UNIT_PROJECT_STATUS_GATE', group: 'unit', module: 'calc/project_status',
  scenarios: [], tags: ['calc', 'project_status', 'gate', 't4'],
  source: 'tests_unit/calc/ProjectStatusTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/project_status: isOfferEmittable (the gate)');

    var P = PROJECT_STATUS;

    t.assertTrue('PASS emits (no override)', isOfferEmittable(P.PASS, false));
    t.assertTrue('PASS emits (override irrelevant)', isOfferEmittable(P.PASS, true));

    t.assertFalse('PASS_WITH_WARNINGS blocked without override', isOfferEmittable(P.PASS_WITH_WARNINGS, false));
    t.assertTrue('PASS_WITH_WARNINGS emits with override', isOfferEmittable(P.PASS_WITH_WARNINGS, true));

    t.assertFalse('REVIEW_REQUIRED blocked without override', isOfferEmittable(P.REVIEW_REQUIRED, false));
    t.assertTrue('REVIEW_REQUIRED emits with override', isOfferEmittable(P.REVIEW_REQUIRED, true));

    t.assertFalse('BLOCKED never emits (no override)', isOfferEmittable(P.BLOCKED, false));
    t.assertFalse('BLOCKED never emits (HARD: override ignored)', isOfferEmittable(P.BLOCKED, true));
  }
});


registerTest({
  id: 'UNIT_PROJECT_STATUS_HAS_CAPEX', group: 'unit', module: 'calc/project_status',
  scenarios: [], tags: ['calc', 'project_status', 'rule', 't4'],
  source: 'tests_unit/calc/ProjectStatusTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/project_status: _psRuleHasCapex (shipped rule)');

    var ok = _psRuleHasCapex(37051893);
    t.assert('positive CAPEX -> PASS', PROJECT_STATUS.PASS, ok.level);
    t.assert('positive CAPEX -> code', 'CAPEX_PRESENT', ok.code);

    t.assert('zero CAPEX -> BLOCKED', PROJECT_STATUS.BLOCKED, _psRuleHasCapex(0).level);
    t.assert('zero CAPEX -> NO_CAPEX', 'NO_CAPEX', _psRuleHasCapex(0).code);
    t.assert('negative CAPEX -> BLOCKED', PROJECT_STATUS.BLOCKED, _psRuleHasCapex(-5).level);
    t.assert('NaN CAPEX -> BLOCKED', PROJECT_STATUS.BLOCKED, _psRuleHasCapex(NaN).level);

    // End-to-end through the reducer: a project with CAPEX is PASS + emittable.
    var r = reduceProjectStatus([_psRuleHasCapex(37051893)]);
    t.assert('has-CAPEX project reduces to PASS', PROJECT_STATUS.PASS, r.status);
    t.assertTrue('has-CAPEX project is emittable', r.emittable);
  }
});
