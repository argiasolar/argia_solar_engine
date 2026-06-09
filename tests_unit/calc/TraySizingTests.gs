// =============================================================================
// ARGIA TESTS -- tests_unit/calc/TraySizingTests.gs
// -----------------------------------------------------------------------------
// Cable-tray (charola) management: fill-based width sizing + DB price-by-width.
//
// Locks the previously-broken charola path (_bomV2_ladderTrayPriceObj was called
// but never defined -> latent ReferenceError on any trayM > 0). Now:
//   - _bomV2_selectTrayWidth(area) picks a standard ladder width from conductor
//     fill (reuses the same insulated area the conduit sizer uses).
//   - _bomV2_ladderTrayPriceObj(bosDb, widthMm) looks up a CABLE TRAY SKU by
//     width with a graceful price:null fallback (no crash if the DB lacks it).
//
// Pure helpers (BomDbHelpers.js) — no spreadsheet access.
// =============================================================================

registerTest({
  id      : 'UNIT_TRAY_SIZING_AND_PRICING',
  group   : 'unit',
  module  : 'calc/bom',
  scenarios: [],
  tags    : ['bom', 'charola', 'tray', 'fill', 'sizing'],
  source  : 'tests_unit/calc/TraySizingTests.gs',
  fn: function (t) {
    t.suite('charola -- width sizing by fill');

    // 1) width thresholds (area / 25 mm²/mm, rounded up to standard width).
    t.assert('0 area -> min 100mm',        100, _bomV2_selectTrayWidth(0).widthMm, 0);
    t.assert('2500 mm2 -> 100mm',          100, _bomV2_selectTrayWidth(2500).widthMm, 0);
    t.assert('2501 mm2 -> 150mm',          150, _bomV2_selectTrayWidth(2501).widthMm, 0);
    t.assert('5000 mm2 -> 200mm',          200, _bomV2_selectTrayWidth(5000).widthMm, 0);
    t.assert('7500 mm2 -> 300mm',          300, _bomV2_selectTrayWidth(7500).widthMm, 0);
    t.assert('huge area -> max 600mm',     600, _bomV2_selectTrayWidth(999999).widthMm, 0);

    // 2) monotonic: width never shrinks as area grows.
    var prev = 0;
    [0, 1000, 3000, 6000, 10000, 20000].forEach(function (a) {
      var w = _bomV2_selectTrayWidth(a).widthMm;
      t.assertTrue('width non-decreasing at area ' + a, w >= prev);
      prev = w;
    });

    // 3) note carries the fill arithmetic + a NOM reference.
    var n = _bomV2_selectTrayWidth(3000).note;   // 3000/25 = 120 -> 150mm
    t.assertTrue('note shows area',  n.indexOf('3000') >= 0);
    t.assertTrue('note shows width', n.indexOf('150') >= 0);
    t.assertTrue('note cites NOM 392', n.indexOf('392') >= 0);

    t.suite('charola -- DB price by width (+ graceful fallback)');

    // 4) DB hit: a LADDER TRAY SKU at the requested width returns its price.
    var bosDb = [
      { 'BOS_CATEGORY': 'SUPPORT', 'BOS_SUBCATEGORY': 'LADDER TRAY',
        'BOS_RATING_OR_SIZE': '300MM', 'BOS_PRICE_PER_UNIT_MXN': 1850,
        'BOS_CURRENCY': 'MXN', 'BOS_ID': 'BOS_TRAY_300' }
    ];
    var hit = _bomV2_ladderTrayPriceObj(bosDb, 300);
    t.assert('tray 300mm price from DB', 1850, hit.price, 0);
    t.assert('tray 300mm id from DB',    'BOS_TRAY_300', hit.id);
    t.assertTrue('tray 300mm not USD', hit.isUsd === false);

    // 5) no exact-width SKU but a ladder-tray SKU exists -> graceful width-agnostic
    //    fallback (preserves prior behaviour: use the available tray price).
    var fb = _bomV2_ladderTrayPriceObj(bosDb, 150);
    t.assert('fallback uses available tray price', 1850, fb.price, 0);
    t.assert('fallback echoes requested width',     150, fb.widthMm, 0);

    // 6) no ladder-tray SKU at all -> price null, synthetic id, no throw.
    var miss = _bomV2_ladderTrayPriceObj(
      [{ 'BOS_CATEGORY': 'CONDUCTORS', 'BOS_SUBCATEGORY': 'WIRE THHW',
         'BOS_RATING_OR_SIZE': '1/0 AWG', 'BOS_PRICE_PER_UNIT_MXN': 95 }], 150);
    t.assertTrue('no tray SKU -> price null', miss.price === null);
    t.assert('no tray SKU -> synthetic id', 'CABLE_TRAY_150MM', miss.id);

    // 7) empty DB: still no throw, fallback returned.
    var empty = _bomV2_ladderTrayPriceObj([], 200);
    t.assertTrue('empty DB -> price null', empty.price === null);
    t.assert('empty DB -> width echoed', 200, empty.widthMm, 0);
  }
});
