// =============================================================================
// ARGIA TESTS -- tests_regression/inputs/BessEconomicsReadersMigrationTests.gs
// -----------------------------------------------------------------------------
// [A2b] Two BDF-3 "economics guardrails" readers in 02_LoadDB.js:
//
//   1. readInputBessTariffOverride (r38/r39) -- MIGRATED to readInput/INPUT_MAP.
//      Parity asserted: blank/0/negative -> null, positive -> the value.
//
//   2. readBessMinSavingsThreshold (r37) -- MIGRATED to readInput/INPUT_MAP [A2c].
//      It was deferred in A2b because bessMinAnnualSavingMxn's default was
//      2,000,000 while the reader treats a BLANK C37 as DISABLED (0). The A2c-0
//      seed/default split set default=0 (reader fallback) and seed=2,000,000
//      (fresh-sheet setup only), so readInput now returns 0 on a blank cell and
//      the reader resolves to DISABLED exactly as before. The blank-case
//      assertion below is the proof that readInput uses `default`, not `seed`.
//
// Reuses _mockBessS6Ss (BessInstallContextMigrationTests.gs), which serves any
// col-3 INPUT_BESS row, so both readers run without a live workbook.
// =============================================================================

registerTest({
  id      : 'REG_MIGRATE_BESS_ECONOMICS_READERS',
  group   : 'regression',
  module  : 'inputs/migration',
  scenarios: [],
  tags    : ['inputs', 'map', 'bess', 'a2', 'migration'],
  source  : 'tests_regression/inputs/BessEconomicsReadersMigrationTests.gs',
  fn: function (t, ctx) {

    // ---- readInputBessTariffOverride (MIGRATED) -----------------------------
    t.suite('REG inputs/migration [A2b]: readInputBessTariffOverride');
    var ov = readInputBessTariffOverride(_mockBessS6Ss({ 38: 2.5, 39: 1.8 }));
    t.assert('punta override read', 2.5, ov.punta);
    t.assert('base override read',  1.8, ov.base);
    var ovBlank = readInputBessTariffOverride(_mockBessS6Ss({}));
    t.assertTrue('blank punta -> null', ovBlank.punta === null);
    t.assertTrue('blank base -> null',  ovBlank.base === null);
    var ovZeroNeg = readInputBessTariffOverride(_mockBessS6Ss({ 38: 0, 39: -1 }));
    t.assertTrue('zero punta -> null',     ovZeroNeg.punta === null);
    t.assertTrue('negative base -> null',  ovZeroNeg.base === null);
    var ovOne = readInputBessTariffOverride(_mockBessS6Ss({ 38: 3.1 }));  // base blank
    t.assert('one-sided punta',   3.1,  ovOne.punta);
    t.assertTrue('one-sided base null', ovOne.base === null);
    var ovNoSheet = readInputBessTariffOverride({ getSheetByName: function(){ return null; } });
    t.assertTrue('no sheet -> punta null', ovNoSheet.punta === null);
    t.assertTrue('no sheet -> base null',  ovNoSheet.base === null);

    // ---- readBessMinSavingsThreshold (MIGRATED [A2c]) -----------------------
    t.suite('REG inputs/migration [A2c]: readBessMinSavingsThreshold (via readInput)');
    var thr = readBessMinSavingsThreshold(_mockBessS6Ss({ 37: 50000 }));
    t.assert('positive threshold value',      50000, thr.thresholdMxn);
    t.assert('positive threshold provenance', 'INPUT_BESS', thr.provenance);
    // PROOF the split holds: a BLANK C37 reads as DISABLED, i.e. readInput
    // returned default 0 (NOT the 2,000,000 seed). If readInput ever consulted
    // `seed`, this would flip to a 2M enabled threshold and fail here.
    var thrBlank = readBessMinSavingsThreshold(_mockBessS6Ss({}));
    t.assert('BLANK C37 -> threshold 0 (DISABLED, not 2M default)', 0, thrBlank.thresholdMxn);
    t.assert('BLANK C37 -> provenance DISABLED', 'DISABLED', thrBlank.provenance);
    t.assert('zero -> DISABLED',     'DISABLED',
      readBessMinSavingsThreshold(_mockBessS6Ss({ 37: 0 })).provenance);
    t.assert('negative -> DISABLED', 'DISABLED',
      readBessMinSavingsThreshold(_mockBessS6Ss({ 37: -100 })).provenance);
    t.assert('no sheet -> DISABLED', 'DISABLED',
      readBessMinSavingsThreshold({ getSheetByName: function(){ return null; } }).provenance);
  }
});
