// =============================================================================
// ARGIA TESTS -- tests_regression/Pass6TrustTests.gs
// -----------------------------------------------------------------------------
// PASS 6 trust & polish guards.
//
//   6a. classifyBomLinePriceStatus: maps a line's price info to a status
//       (CATALOG_PRICE / SUPPLIER_QUOTED / ESTIMATED / MANUAL_OVERRIDE /
//       MISSING_PRICE). (02_LoadDB.gs)
//   6b. _buildFormulaTrace: PERCENT items render their real subtotal basis
//       (not "$0"), and day-driven items render the driver value they are
//       given (the caller now rebuilds with the post-benchmark day count, so
//       a 12-day item reads "12 days", not the stale "24"). (13_CalcInstallCost.gs)
//   6c. normalizeSku: whitespace/separator-insensitive, but NOT fuzzy -- HVH
//       and HVHF stay distinct. (02_LoadDB.gs)
//
// CLASSIFICATION
//   group=regression. All exercise pure functions -- no sheet access.
//
// DEPENDENCIES
//   - normalizeSku, classifyBomLinePriceStatus (02_LoadDB.gs)
//   - _buildFormulaTrace                        (13_CalcInstallCost.gs)
// =============================================================================


// ----------------------------------------------------------------------------
// 6c) SKU normalization
// ----------------------------------------------------------------------------
registerTest({
  id      : 'UNIT_PASS6_NORMALIZE_SKU',
  group   : 'regression',
  module  : 'loaddb',
  scenarios: [],
  tags    : ['regression', 'loaddb', 'sku', 'pass6'],
  source  : 'tests_regression/Pass6TrustTests.gs',
  fn      : function (t) {
    t.suite('REGRESSION loaddb: normalizeSku');

    t.assertTrue('spaces around / and - removed',
      normalizeSku('JAM72D40 - 545 / LB') === 'JAM72D40-545/LB');
    t.assertTrue('case + outer trim normalized',
      normalizeSku('  jam72d40-545/lb  ') === 'JAM72D40-545/LB');
    t.assertTrue('internal whitespace collapsed',
      normalizeSku('SUN2000   150K') === 'SUN2000 150K');
    t.assertTrue('null -> empty string', normalizeSku(null) === '');
    // NOT fuzzy: genuinely different SKUs must stay distinct.
    t.assertTrue('HVH != HVHF (no false match)',
      normalizeSku('JA-545/HVH') !== normalizeSku('JA-545/HVHF'));
  }
});


// ----------------------------------------------------------------------------
// 6a) BOM per-line price status
// ----------------------------------------------------------------------------
registerTest({
  id      : 'UNIT_PASS6_BOM_PRICE_STATUS',
  group   : 'regression',
  module  : 'loaddb',
  scenarios: [],
  tags    : ['regression', 'loaddb', 'bom', 'price', 'pass6'],
  source  : 'tests_regression/Pass6TrustTests.gs',
  fn      : function (t) {
    t.suite('REGRESSION loaddb: classifyBomLinePriceStatus');

    t.assertTrue('USD price -> CATALOG_PRICE',
      classifyBomLinePriceStatus({ priceUsd: 100 }) === 'CATALOG_PRICE');
    t.assertTrue('MXN price -> CATALOG_PRICE',
      classifyBomLinePriceStatus({ priceMxn: 1800 }) === 'CATALOG_PRICE');
    t.assertTrue('no price -> MISSING_PRICE',
      classifyBomLinePriceStatus({}) === 'MISSING_PRICE');

    t.assertTrue('BESS per-unit provenance -> SUPPLIER_QUOTED',
      classifyBomLinePriceStatus({ provenance: 'BESS_PRICE_PER_UNIT', priceMxn: 1000 }) === 'SUPPLIER_QUOTED');
    t.assertTrue('CAPEX fallback -> ESTIMATED',
      classifyBomLinePriceStatus({ provenance: 'CAPEX_FALLBACK', priceMxn: 1000 }) === 'ESTIMATED');
    t.assertTrue('NO_DATA -> MISSING_PRICE',
      classifyBomLinePriceStatus({ provenance: 'NO_DATA' }) === 'MISSING_PRICE');
    t.assertTrue('NO_BATTERY -> MISSING_PRICE',
      classifyBomLinePriceStatus({ provenance: 'NO_BATTERY' }) === 'MISSING_PRICE');

    t.assertTrue('manual sourceTag -> MANUAL_OVERRIDE',
      classifyBomLinePriceStatus({ sourceTag: 'manual' }) === 'MANUAL_OVERRIDE');
    t.assertTrue('sourceTag beats a present price',
      classifyBomLinePriceStatus({ sourceTag: 'estimated', priceUsd: 50 }) === 'ESTIMATED');
  }
});


// ----------------------------------------------------------------------------
// 6b) Formula-trace builder renders the real basis / driver
// ----------------------------------------------------------------------------
registerTest({
  id      : 'UNIT_PASS6_FORMULA_TRACE_BASIS',
  group   : 'regression',
  module  : 'calc/install',
  scenarios: [],
  tags    : ['regression', 'install', 'trace', 'pass6'],
  source  : 'tests_regression/Pass6TrustTests.gs',
  fn      : function (t) {
    t.suite('REGRESSION calc/install: _buildFormulaTrace basis/driver');

    var noFactors = { combined: 1, values: [null, null, null, null] };

    // PERCENT: must render the subtotal basis and the computed cost, not "$0".
    var pctTrace = _buildFormulaTrace(
      { costType: 'PERCENT_OF_LABOR_EQUIP' },
      { otherMxn: 5000, driverQtyVal: 250000, factorResult: noFactors },
      { insurancePct: 0.02, laborEquipSubtotal: 250000, factorSelections: {} });
    t.assertTrue('PERCENT trace shows the labor+equip basis', pctTrace.indexOf('250,000') !== -1);
    t.assertTrue('PERCENT trace shows the computed cost',     pctTrace.indexOf('5,000') !== -1);
    t.assertTrue('PERCENT trace is not the $0 form',          pctTrace.indexOf('$0') === -1);

    // EQUIPMENT_DAY: renders the driver value it is given (post-fix the caller
    // passes the re-derived day count, so 12 -> "12 days", not the stale 24).
    var eqTrace = _buildFormulaTrace(
      { costType: 'EQUIPMENT_DAY', equipKey: 'SCISSOR_LIFT', driverUom: 'days' },
      { driverQtyVal: 12, equipRateVal: 1500, equipMxn: 18000, factorResult: noFactors },
      { factorSelections: {} });
    t.assertTrue('EQUIPMENT_DAY trace uses the given driver (12 days)', eqTrace.indexOf('12 days') !== -1);
    t.assertTrue('EQUIPMENT_DAY trace shows the day rate',  eqTrace.indexOf('1,500') !== -1);
    t.assertTrue('EQUIPMENT_DAY trace shows the cost',      eqTrace.indexOf('18,000') !== -1);
  }
});
