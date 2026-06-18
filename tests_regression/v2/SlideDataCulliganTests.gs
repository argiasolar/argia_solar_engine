// =============================================================================
// ARGIA TESTS -- tests_regression/v2/SlideDataCulliganTests.gs
// SLIDE_DATA rebuild (chunk 1): CULLIGAN SLIDE_DATA is a clean API_OUTPUT
// projection -- guarded figures correct, no #REF!. WORKBOOK-DEPENDENT.
// =============================================================================

registerTest({
  id: 'REG_SLIDE_DATA_CULLIGAN',
  group: 'regression', module: 'regression/v2/culligan',
  scenarios: [], tags: ['regression', 'culligan', 'v2', 'slide_data', 'rebuild'],
  source: 'tests_regression/v2/SlideDataCulliganTests.gs',
  fn: function (t, ctx) {
    t.suite('REG v2/culligan: SLIDE_DATA projects API_OUTPUT (no #REF!)');

    var ss  = SpreadsheetApp.getActiveSpreadsheet();
    var mdc = ss.getSheetByName('MDC_v2');
    var projName = mdc ? String(mdc.getRange(7, 3).getValue() || '') : '';
    if (projName.toUpperCase().indexOf('CULLIGAN') < 0) {
      t.info('skipped', 'Requires CULLIGAN E2E context. MDC_v2 project: "' + (projName || '(none)') + '".');
      return;
    }
    // Rebuild (idempotent) then read by key.
    writeSlideDataV2(ss);
    var sh = ss.getSheetByName('SLIDE_DATA');
    t.assertTrue('SLIDE_DATA present', !!sh);
    if (!sh) return;

    var last = sh.getLastRow();
    var vals = sh.getRange(1, 1, last, 2).getValues();
    function read(key) {
      for (var r = 0; r < vals.length; r++) if (String(vals[r][0]) === key) return vals[r][1];
      return undefined;
    }

    // no #REF! anywhere in the value column
    var refErrors = 0;
    for (var r = 1; r < vals.length; r++) {
      if (String(vals[r][1]).indexOf('#REF!') >= 0) refErrors++;
    }
    t.assert('no #REF! in SLIDE_DATA values', 0, refErrors);

    // guarded figure keys resolve to API_OUTPUT values (CULLIGAN goldens)
    t.assertNear('system_kwp = 864',           864,         Number(read('system_kwp')),         0.5);
    t.assertNear('annual_energy_cost sin-PV',  12838765.45, Number(read('annual_energy_cost')), 5);
    t.assertNear('capex_total = offer price',  43671179,    Number(read('capex_total')),        5);
    t.assertTrue('annual_savings > 0',         Number(read('annual_savings')) > 0);

    // a couple more projected figures are now correct (were stale/#REF!)
    t.assertNear('annual_mwh ~ 1321 (was 4475 stale)', 1321, Number(read('annual_mwh')), 50);
    t.assertTrue('roi_years finite', isFinite(Number(read('roi_years'))) && Number(read('roi_years')) > 0);

    // config keys are clean blanks (not #REF!), pending 99_SETUP
    t.assert('salesperson_name blank (pending config)', '', String(read('salesperson_name')));
  }
});
