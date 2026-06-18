// =============================================================================
// ARGIA TESTS -- tests_regression/v2/StatusRulesCulliganTests.gs
// T10a (v4.44.0): CULLIGAN has a priced structure (KR18, ~$24,300) -> structure
// rule PASS, project still emittable. WORKBOOK-DEPENDENT (Node error = green).
// =============================================================================

registerTest({
  id: 'REG_STATUS_RULES_CULLIGAN',
  group: 'regression', module: 'regression/v2/culligan',
  scenarios: [], tags: ['regression', 'culligan', 'v2', 'project_status', 'structure', 't10'],
  source: 'tests_regression/v2/StatusRulesCulliganTests.gs',
  fn: function (t, ctx) {
    t.suite('REG v2/culligan [T10]: structure priced -> PASS, offer emittable');

    var ss  = SpreadsheetApp.getActiveSpreadsheet();
    var mdc = ss.getSheetByName('MDC_v2');
    var projName = mdc ? String(mdc.getRange(7, 3).getValue() || '') : '';
    if (projName.toUpperCase().indexOf('CULLIGAN') < 0) {
      t.info('skipped', 'Requires CULLIGAN E2E context. MDC_v2 project: "' + (projName || '(none)') + '".');
      return;
    }

    var usd = _psReadStructureCostUsd(ss);
    t.assertTrue('CULLIGAN structure cost read', usd !== null);
    t.assertTrue('CULLIGAN structure cost > 0', Number(usd) > 0);

    var rule = runStructureCostRule(ss);
    t.assert('structure rule PASS', 'PASS', rule.level);
    t.assert('code STRUCTURE_COST_PRESENT', 'STRUCTURE_COST_PRESENT', rule.code);

    // Whole pack still lets CULLIGAN through.
    t.assertTrue('offer emittable on complete CULLIGAN', assertOfferEmittable(ss, {}).emittable);
  }
});
