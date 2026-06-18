// =============================================================================
// ARGIA TESTS -- tests_regression/v2/BomCompletenessCulliganTests.gs
// T9 (v4.43.0): CULLIGAN is a complete, fully-priced project -> BOM completeness
// PASS, offer emittable. WORKBOOK-DEPENDENT (Node error = green).
// =============================================================================

// ---- CULLIGAN regression: a complete project stays PASS / emittable ----------
registerTest({
  id: 'REG_BOM_COMPLETENESS_CULLIGAN',
  group: 'regression', module: 'regression/v2/culligan',
  scenarios: [], tags: ['regression', 'culligan', 'v2', 'bom', 'completeness', 't9'],
  source: 'tests_regression/v2/BomCompletenessCulliganTests.gs',
  fn: function (t, ctx) {
    t.suite('REG v2/culligan [T9]: complete BOM -> PASS, offer emittable');

    var ss  = SpreadsheetApp.getActiveSpreadsheet();
    var mdc = ss.getSheetByName('MDC_v2');
    var projName = mdc ? String(mdc.getRange(7, 3).getValue() || '') : '';
    if (projName.toUpperCase().indexOf('CULLIGAN') < 0) {
      t.info('skipped', 'Requires CULLIGAN E2E context. MDC_v2 project: "' + (projName || '(none)') + '".');
      return;
    }

    var c = runBomCompleteness(ss);
    t.assertTrue('CULLIGAN completeness evaluated', !!c);
    t.assertTrue('CULLIGAN BOM complete (all families present & priced)', c.complete);
    t.assert('no missing families', 0, c.missingFamilies.length);
    t.assert('no SIN COTIZAR families', 0, c.sinCotizarFamilies.length);
    // core families all present
    ['PV_MODULES','INVERTERS','STRUCTURE','DC_ELECTRICAL','AC_ELECTRICAL','MONITORING_PERMITS'].forEach(function (k) {
      t.assertTrue(k + ' present', c.presentFamilies.indexOf(k) >= 0);
    });

    // the BOM rule passes and the offer stays emittable
    var rule = _psRuleBomCompleteness(c);
    t.assert('CULLIGAN BOM rule PASS', 'PASS', rule.level);
    t.assertTrue('offer emittable on complete CULLIGAN', assertOfferEmittable(ss, {}).emittable);
  }
});
