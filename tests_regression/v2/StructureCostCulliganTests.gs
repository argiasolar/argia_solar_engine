// =============================================================================
// ARGIA TESTS -- tests_regression/v2/StructureCostCulliganTests.gs
// -----------------------------------------------------------------------------
// T7 (v4.41.0): REG_STRUCTURE_COST_CULLIGAN.
//
// The KR18 pricelist factor is calibrated so CULLIGAN's structure cost is
// unchanged. This locks the pricelist path (kWp × factor) against the live
// baseline: BOM structure subtotal (F25) and Project Card structure (C33) must
// both equal 24,300 USD, and the pure engine must produce the same number.
//
// Module 'regression/v2/culligan'. WORKBOOK-DEPENDENT (Node error = green).
// =============================================================================

registerTest({
  id: 'REG_STRUCTURE_COST_CULLIGAN',
  group: 'regression',
  module: 'regression/v2/culligan',
  scenarios: [],
  tags: ['regression', 'baseline', 'culligan', 'v2', 'structure', 'pricelist', 't7'],
  source: 'tests_regression/v2/StructureCostCulliganTests.gs',
  fn: function (t, ctx) {
    t.suite('REG v2/culligan [T7]: structure cost via pricelist == 24,300');

    var TOL = 1.0;
    var ss  = SpreadsheetApp.getActiveSpreadsheet();
    var mdc = ss.getSheetByName('MDC_v2');
    var projName = mdc ? String(mdc.getRange(7, 3).getValue() || '') : '';
    if (projName.toUpperCase().indexOf('CULLIGAN') < 0) {
      t.info('skipped', 'Requires CULLIGAN E2E context. MDC_v2 project: "' + (projName || '(none)') + '".');
      return;
    }

    // Pure engine: KR18 @ 864 kWp = 24,300 (the calibration that preserves the golden).
    var eng = calcStructureCost('KR18', 864);
    t.assertNear('engine: 864 kWp × 28.125 = 24,300', 24300, eng.usdTotal, 0.01);
    t.assertFalse('engine: KR18 is priced', eng.sinCotizar);

    // Live BOM structure subtotal (F25, USD).
    var bom = ss.getSheetByName('BOM_v2');
    if (bom) {
      t.assertNear('BOM F25 structure subtotal == 24,300', 24300, Number(bom.getRange('F25').getValue()), TOL);
    } else { t.info('skipped', 'BOM_v2 not present.'); }

    // Live Project Card structure (C33, USD).
    var pc = ss.getSheetByName('PROJECT_CARD_v2');
    if (pc) {
      t.assertNear('PROJECT_CARD C33 structure == 24,300', 24300, Number(pc.getRange('C33').getValue()), TOL);
    } else { t.info('skipped', 'PROJECT_CARD_v2 not present.'); }
  }
});
