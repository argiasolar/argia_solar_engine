// =============================================================================
// ARGIA TESTS -- tests_unit/wiring/BessPickerWiringTests.gs   (BDF-6)
// Unit tests for the INPUT_BESS C6 picker logic.
// Pure function tests; no spreadsheet required.
// =============================================================================

registerTest({
  id      : 'UNIT_BESS_PICKER_BDF6',
  group   : 'unit',
  module  : 'wiring/bess_picker',
  scenarios: [],
  tags    : ['unit', 'wiring', 'picker', 'bdf6'],
  source  : 'tests_unit/wiring/BessPickerWiringTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT wiring/bess_picker: resolvePickerSelection');

    // Synthetic catalog (mimics 16M_PRODUCTS_BESS)
    var catalog = [
      { batteryId: 'CUSTOM_MANUAL', capacityKwh: 0, powerKw: 0,
        minSocPct: 0.1, maxSocPct: 0.9, rtePct: 0.9, installedCapexMxn: 0 },
      { batteryId: 'BYD_2MWH', capacityKwh: 2000, powerKw: 1000,
        minSocPct: 0.05, maxSocPct: 0.95, rtePct: 0.913, installedCapexMxn: 8500000 },
      { batteryId: 'CATL_3MWH', capacityKwh: 3000, powerKw: 1500,
        minSocPct: 0.10, maxSocPct: 0.90, rtePct: 0.92, installedCapexMxn: 12000000 },
    ];

    // Synthetic recommendations (mimics BESS_RECOMMENDATIONS rows)
    var recs = [
      { label: 'BYD_2MWH (2000 kWh)',
        baseBatteryId: 'BYD_2MWH', stackQty: 1,
        capacityKwh: 2000, powerKw: 1000, installedCapexMxn: 8500000 },
      { label: '2 × BYD_2MWH (4000 kWh, 2000 kW)',
        baseBatteryId: 'BYD_2MWH', stackQty: 2,
        capacityKwh: 4000, powerKw: 2000, installedCapexMxn: 17000000 },
      { label: '5 × BYD_2MWH (10000 kWh, 5000 kW)',
        baseBatteryId: 'BYD_2MWH', stackQty: 5,
        capacityKwh: 10000, powerKw: 5000, installedCapexMxn: 42500000 },
    ];

    // ==== TEST 1: CUSTOM_MANUAL returns custom-manual ===================
    var r1 = resolvePickerSelection('CUSTOM_MANUAL', catalog, recs);
    t.assert('CUSTOM_MANUAL -> source=CUSTOM_MANUAL', 'CUSTOM_MANUAL', r1.source);
    t.assert('CUSTOM_MANUAL -> found=false', false, r1.found);

    // ==== TEST 2: Empty string also custom-manual =======================
    var r2 = resolvePickerSelection('', catalog, recs);
    t.assert('Empty string -> source=CUSTOM_MANUAL', 'CUSTOM_MANUAL', r2.source);

    // ==== TEST 3: Catalog single match ==================================
    var r3 = resolvePickerSelection('BYD_2MWH', catalog, recs);
    // NOTE: recs has a BYD_2MWH-based recommendation too -- recommendation
    // labels and catalog IDs overlap by design. The picker checks recs FIRST.
    // The recommendation labels include " (2000 kWh)" suffix so 'BYD_2MWH'
    // alone matches catalog, not recs. Verify this is what we want.
    t.assert('Catalog ID match -> source=CATALOG', 'CATALOG', r3.source);
    t.assert('Catalog ID -> capacity comes from catalog row',
             2000, r3.capacityKwh);
    t.assert('Catalog ID -> power comes from catalog row',
             1000, r3.powerKw);
    t.assertNear('Catalog ID -> minSoc from catalog',
                 0.05, r3.minSocPct, 0.001);
    t.assert('Catalog ID -> qty=1 (single unit)', 1, r3.qty);

    // ==== TEST 4: Recommendation match (single unit) ====================
    var r4 = resolvePickerSelection('BYD_2MWH (2000 kWh)', catalog, recs);
    t.assert('Recommendation label -> source=RECOMMENDATION',
             'RECOMMENDATION', r4.source);
    t.assert('Single-unit recommendation -> qty=1', 1, r4.qty);
    t.assert('Single-unit recommendation -> capacity matches',
             2000, r4.capacityKwh);
    // SOC/RTE come from underlying catalog (baseBatteryId = BYD_2MWH)
    t.assertNear('Single-unit recommendation -> minSoc from baseBatteryId catalog',
                 0.05, r4.minSocPct, 0.001);
    t.assertNear('Single-unit recommendation -> rte from baseBatteryId catalog',
                 0.913, r4.rtePct, 0.001);

    // ==== TEST 5: Stacked recommendation (the critical case) ============
    var r5 = resolvePickerSelection('5 × BYD_2MWH (10000 kWh, 5000 kW)', catalog, recs);
    t.assert('Stacked rec -> source=RECOMMENDATION',
             'RECOMMENDATION', r5.source);
    t.assert('Stacked rec -> qty=5 (from rec row)', 5, r5.qty);
    t.assert('Stacked rec -> capacity = qty × base = 10000',
             10000, r5.capacityKwh);
    t.assert('Stacked rec -> power = qty × base = 5000',
             5000, r5.powerKw);
    t.assert('Stacked rec -> CAPEX = qty × base = 42.5M',
             42500000, r5.capexMxn);
    // SOC/RTE come from underlying catalog product (NOT multiplied by qty)
    t.assertNear('Stacked rec -> minSoc from catalog (not scaled by qty)',
                 0.05, r5.minSocPct, 0.001);
    t.assertNear('Stacked rec -> rte from catalog (not scaled by qty)',
                 0.913, r5.rtePct, 0.001);

    // ==== TEST 6: Unknown label -> custom-manual (no error) ============
    var r6 = resolvePickerSelection('TESLA_MEGAPACK_2025', catalog, recs);
    t.assert('Unknown label -> source=CUSTOM_MANUAL', 'CUSTOM_MANUAL', r6.source);
    t.assert('Unknown label -> found=false', false, r6.found);
    t.assert('Unknown label -> batteryId preserved (designer typed it)',
             'TESLA_MEGAPACK_2025', r6.batteryId);

    // ==== TEST 7: Catalog without library defaults =====================
    // When catalog is empty (workbook with no products), only recs work.
    var r7 = resolvePickerSelection('BYD_2MWH', [], recs);
    t.assert('Empty catalog + catalog-only label -> custom-manual',
             'CUSTOM_MANUAL', r7.source);
    var r7b = resolvePickerSelection('BYD_2MWH (2000 kWh)', [], recs);
    t.assert('Empty catalog + rec label -> recommendation',
             'RECOMMENDATION', r7b.source);
    // SOC defaults to 10/90 when base not in catalog
    t.assertNear('Empty catalog -> rec minSoc defaults to 0.10',
                 0.10, r7b.minSocPct, 0.001);

    // ==== TEST 8: Empty recs + catalog match ===========================
    var r8 = resolvePickerSelection('CATL_3MWH', catalog, []);
    t.assert('Empty recs + catalog match -> source=CATALOG', 'CATALOG', r8.source);
    t.assert('Catalog match -> capacity correct', 3000, r8.capacityKwh);

    // ==== TEST 9: Whitespace handling ===================================
    var r9 = resolvePickerSelection('  BYD_2MWH  ', catalog, recs);
    t.assert('Trimmed catalog match works', 'CATALOG', r9.source);

    // ==== TEST 10: Null inputs =========================================
    var r10 = resolvePickerSelection(null, catalog, recs);
    t.assert('Null c6 -> CUSTOM_MANUAL', 'CUSTOM_MANUAL', r10.source);

    var r10b = resolvePickerSelection('BYD_2MWH', null, null);
    t.assert('Null catalog + recs -> CUSTOM_MANUAL', 'CUSTOM_MANUAL', r10b.source);

    // ==== TEST 11: Recommendation takes precedence over catalog =======
    // If a recommendation label exactly equals a catalog ID, recs win.
    // (Unlikely in practice, but explicit precedence is testable.)
    var catalog2 = catalog.concat([{
      batteryId: 'BYD_2MWH (2000 kWh)',  // catalog id matches a rec label
      capacityKwh: 999, powerKw: 999, minSocPct: 0.2, maxSocPct: 0.8, rtePct: 0.85,
      installedCapexMxn: 1,
    }]);
    var r11 = resolvePickerSelection('BYD_2MWH (2000 kWh)', catalog2, recs);
    t.assert('Recommendations checked first (precedence)',
             'RECOMMENDATION', r11.source);
    t.assert('Recommendation value wins over catalog with same name',
             2000, r11.capacityKwh);   // from rec, not 999 from catalog

    // ==== TEST 12: Stacked rec with missing baseBatteryId ==============
    // If baseBatteryId is missing/blank, SOC defaults must kick in.
    var recsOrphan = [{
      label: 'ORPHAN_STACK', baseBatteryId: '', stackQty: 3,
      capacityKwh: 3000, powerKw: 1500, installedCapexMxn: 9000000,
    }];
    var r12 = resolvePickerSelection('ORPHAN_STACK', catalog, recsOrphan);
    t.assert('Orphan rec -> source=RECOMMENDATION', 'RECOMMENDATION', r12.source);
    t.assertNear('Orphan rec -> minSoc default 0.10', 0.10, r12.minSocPct, 0.001);
    t.assertNear('Orphan rec -> maxSoc default 0.90', 0.90, r12.maxSocPct, 0.001);
    t.assertNear('Orphan rec -> rte default 0.90', 0.90, r12.rtePct, 0.001);
    t.assert('Orphan rec -> qty preserved', 3, r12.qty);
    t.assert('Orphan rec -> capacity preserved', 3000, r12.capacityKwh);
  }
});
