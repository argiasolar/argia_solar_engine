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

registerTest({
  id: 'REG_CFE_DATA_QUALITY_CULLIGAN',
  group: 'regression', module: 'regression/v2/culligan',
  scenarios: [], tags: ['regression', 'culligan', 'v2', 'cfe', 't10'],
  source: 'tests_regression/v2/StatusRulesCulliganTests.gs',
  fn: function (t, ctx) {
    t.suite('REG v2/culligan [T10]: CFE data complete -> PASS');

    var ss  = SpreadsheetApp.getActiveSpreadsheet();
    var mdc = ss.getSheetByName('MDC_v2');
    var projName = mdc ? String(mdc.getRange(7, 3).getValue() || '') : '';
    if (projName.toUpperCase().indexOf('CULLIGAN') < 0) {
      t.info('skipped', 'Requires CULLIGAN E2E context. MDC_v2 project: "' + (projName || '(none)') + '".');
      return;
    }

    var snap  = collectCfeDataQuality(ss);
    t.assertTrue('CULLIGAN CFE snapshot read', !!snap);
    t.assertTrue('tariff present', snap.tariffPresent);
    t.assert('12 months kWh', 12, snap.kwhMonths);
    t.assert('12 months kW', 12, snap.kwMonths);
    t.assert('12 months PF', 12, snap.pfMonths);
    t.assert('12 months billing days', 12, snap.billingMonths);

    var rule = runCfeDataQualityRule(ss);
    t.assert('CFE data-quality PASS', 'PASS', rule.level);
    t.assertTrue('offer still emittable', assertOfferEmittable(ss, {}).emittable);
  }
});

registerTest({
  id: 'REG_BESS_DECISION_CULLIGAN',
  group: 'regression', module: 'regression/v2/culligan',
  scenarios: [], tags: ['regression', 'culligan', 'v2', 'bess', 't10'],
  source: 'tests_regression/v2/StatusRulesCulliganTests.gs',
  fn: function (t, ctx) {
    t.suite('REG v2/culligan [T10]: BESS recommended AND included -> PASS');

    var ss  = SpreadsheetApp.getActiveSpreadsheet();
    var mdc = ss.getSheetByName('MDC_v2');
    var projName = mdc ? String(mdc.getRange(7, 3).getValue() || '') : '';
    if (projName.toUpperCase().indexOf('CULLIGAN') < 0) {
      t.info('skipped', 'Requires CULLIGAN E2E context. MDC_v2 project: "' + (projName || '(none)') + '".');
      return;
    }

    var d = collectBessDecision(ss);
    t.assertTrue('CULLIGAN BESS decision read', !!d);
    t.assertTrue('BESS included in CULLIGAN (BOM subtotal > 0)', d.included);

    var rule = runBessDecisionRule(ss);
    // CULLIGAN includes BESS, so whether or not a battery is "recommended",
    // the rule must be PASS (never PASS_WITH_WARNINGS) and the offer emittable.
    t.assert('BESS decision PASS for included project', 'PASS', rule.level);
    t.assertTrue('offer still emittable', assertOfferEmittable(ss, {}).emittable);
  }
});
