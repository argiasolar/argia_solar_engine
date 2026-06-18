// =============================================================================
// ARGIA TESTS -- tests_unit/calc/StructureCostTests.gs
// -----------------------------------------------------------------------------
// T7 (v4.41.0): structure cost = kWp × roof_factor($/kWp) from STRUCTURE_PRICELIST
// (34_CalcStructureCost.js). PURE -- no workbook.
// =============================================================================

registerTest({
  id: 'UNIT_STRUCTURE_COST_PRICELIST',
  group: 'unit', module: 'calc/structure_cost',
  scenarios: [], tags: ['calc', 'structure', 'pricelist', 't7'],
  source: 'tests_unit/calc/StructureCostTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/structure: kWp × factor, taxonomy, SIN COTIZAR');

    // -- kWp × factor math (CULLIGAN calibration: KR18 = 28.125 $/kWp) ---------
    var c = calcStructureCost('KR18', 864);
    t.assert('KR18 factor', 28.125, c.usdPerKwp);
    t.assertNear('CULLIGAN structure = 864 kWp × 28.125 = 24,300 USD', 24300, c.usdTotal, 0.01);
    t.assertFalse('KR18 is priced (not SIN COTIZAR)', c.sinCotizar);

    // generic kWp × factor
    t.assertNear('100 kWp × 28.125 = 2812.5', 2812.5, calcStructureCost('KR18', 100).usdTotal, 0.01);
    t.assertNear('TR36 50 kWp × 26 = 1300', 1300, calcStructureCost('TR36', 50).usdTotal, 0.01);

    // -- taxonomy normalization -----------------------------------------------
    t.assert('code passthrough', 'KR18', canonicalRoofType('KR18'));
    t.assert('lowercase code', 'FLAT', canonicalRoofType('flat'));
    t.assert('team alias Standing-Seam -> KR18', 'KR18', canonicalRoofType('Standing-Seam'));
    t.assert('team alias Ballasted -> FLAT', 'FLAT', canonicalRoofType('Ballasted'));
    t.assert('unknown -> OTHER (safe default)', 'OTHER', canonicalRoofType('zinc-tile-xyz'));
    t.assert('blank -> OTHER', 'OTHER', canonicalRoofType(''));

    // -- SIN COTIZAR: unpriced roof type, blank factor, missing kWp ------------
    var o = calcStructureCost('OTHER', 864);
    t.assertTrue('OTHER (no factor) -> SIN COTIZAR', o.sinCotizar);
    t.assert('SIN COTIZAR -> usdTotal 0', 0, o.usdTotal);
    t.assert('OTHER factor is null', null, structureFactorUsdPerKwp('OTHER'));

    var blank = calcStructureCost('', 864);
    t.assertTrue('blank roof type -> SIN COTIZAR', blank.sinCotizar);

    var noKwp = calcStructureCost('KR18', 0);
    t.assertTrue('priced roof but 0 kWp -> SIN COTIZAR', noKwp.sinCotizar);
    t.assertTrue('SIN COTIZAR note mentions cotizar', /COTIZAR/i.test(noKwp.note));

    // -- pricelist well-formed ------------------------------------------------
    STRUCTURE_CANONICAL_ROOF_TYPES.forEach(function (rt) {
      t.assertTrue('pricelist has row for ' + rt, !!STRUCTURE_PRICELIST[rt]);
    });
  }
});
