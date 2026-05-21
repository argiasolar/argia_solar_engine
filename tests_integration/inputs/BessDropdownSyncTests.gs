// =============================================================================
// ARGIA TESTS -- tests_integration/inputs/BessDropdownSyncTests.gs
// -----------------------------------------------------------------------------
// PASS 11 MIGRATION: BESS C6 dropdown sync verification.
//
// SOURCE: addPhase15Tests in 99s_Phase15_BessDropdownSync.gs.
//         Migrated 2026-05-21 as part of Pass 11.
//
// COVERAGE
//   READ-ONLY validation-rule inspection. Verifies INPUT_BESS!C6's data
//   validation matches the live 16M_PRODUCTS_BESS DB:
//     - setupInputBess + SH constants exist
//     - C6 has a data-validation rule
//     - Rule is VALUE_IN_RANGE (not the stale VALUE_IN_LIST)
//     - Range points at 16M_PRODUCTS_BESS column A starting from row 2
//     - Cross-check: DB has CUSTOM_MANUAL + >= 1 real product
//
// CLASSIFICATION
//   group=integration. Reads the live INPUT_BESS!C6 data-validation rule.
//   No cells written. No try/finally needed.
//
// DEPENDENCIES
//   - setupInputBess (02e_InputSetup.gs)
//   - SH.INPUT_BESS, SH.BESS_MIRROR constants (00_Main.gs)
//   - getAllBatteryProducts (02_LoadDB.gs)
//
// ENVIRONMENTAL-STATE HANDLING
//   The legacy phase has graceful skip-and-info paths when:
//     - C6 has no validation rule (asks user to run setupInputBess)
//     - Rule is the old VALUE_IN_LIST (stale hardcoded allowlist)
//     - Range value isn't a real Range object
//   Preserved verbatim because each path tells the user a specific
//   actionable thing. If we hit the stale-list path, the test records
//   ONE failed assert (intentionally) plus an info line explaining the
//   fix. This is the suite's whole point -- it exists to surface state,
//   not to enforce a contract.
//
// BACKGROUND FROM PASS 7 OBSERVATIONS
//   Pass 7 showed Phase 14 CASE 3 working unexpectedly -- the C6 dropdown
//   accepted HW_LUNA_200KWH. That suggests either setupInputBess has been
//   run since the original Phase 15 was authored, OR the legacy CASE 3
//   skip was overcautious. If THIS test passes, it confirms the dropdown
//   has actually been synced. If it fails with the "STALE" info, that
//   means CASE 3 still passes for some other reason (worth investigating).
//
// CO-EXISTENCE
//   99s_Phase15_BessDropdownSync.gs unchanged.
// =============================================================================


registerTest({
  id      : 'INT_INPUTS_BESS_C6_DROPDOWN_SYNC',
  group   : 'integration',
  module  : 'inputs/bess_dropdown',
  scenarios: [],
  tags    : ['inputs', 'bess', 'dropdown', 'data-validation', 'live-cell'],
  source  : 'tests_integration/inputs/BessDropdownSyncTests.gs',
  fn: function (t, ctx) {
    t.suite('INT inputs/bess_dropdown: C6 sync with product DB');

    // === Function availability =========================================
    t.assert('setupInputBess defined',
             'function', typeof setupInputBess);
    t.assert('SH.INPUT_BESS constant defined',
             'INPUT_BESS', SH.INPUT_BESS);
    t.assert('SH.BESS_MIRROR constant defined',
             '16M_PRODUCTS_BESS', SH.BESS_MIRROR);

    // === Read the live validation rule at INPUT_BESS!C6 ===============
    var shBess = ctx.ss.getSheetByName(SH.INPUT_BESS);
    if (!shBess) {
      t.error('setup',
              new Error('INPUT_BESS sheet missing'));
      return;
    }
    var c6 = shBess.getRange(6, 3);
    var rule = c6.getDataValidation();

    if (!rule) {
      t.info('NOTE',
             'INPUT_BESS!C6 has NO data-validation rule. Run setupInputBess() '
             + 'from the Apps Script IDE once to install it, then re-run tests.');
      return;
    }

    // The rule's criteria tells us whether the allowlist is a hardcoded
    // list (stale -- VALUE_IN_LIST) or a range reference to the DB
    // (synced -- VALUE_IN_RANGE).
    var criteriaType = rule.getCriteriaType();
    var DVC = SpreadsheetApp.DataValidationCriteria;

    if (criteriaType === DVC.VALUE_IN_LIST) {
      var values = rule.getCriteriaValues();
      var staleList = (values && values[0]) ? values[0].join(' / ') : '(empty)';
      t.info('STALE',
             'INPUT_BESS!C6 still uses a HARDCODED allowlist: [' + staleList
             + ']. This does NOT match the live 16M_PRODUCTS_BESS DB and '
             + 'blocks catalog battery selection. Fix: run setupInputBess() '
             + 'from the Apps Script IDE once. Then re-run tests.');
      // Don't fail this is environmental state, but flag the contract
      // assertion. The intentional false-assert below makes the suite
      // visibly red until the dropdown is synced.
      t.assertTrue('C6 validation type is VALUE_IN_RANGE (points at DB) -- '
                   + 'currently VALUE_IN_LIST (stale hardcoded)',
                   false);
      return;
    }

    if (criteriaType !== DVC.VALUE_IN_RANGE) {
      t.assertTrue('C6 validation type is VALUE_IN_RANGE (got '
                   + String(criteriaType) + ')',
                   false);
      return;
    }

    // VALUE_IN_RANGE -- inspect which range the dropdown points at
    var rangeVals = rule.getCriteriaValues();
    if (!rangeVals || !rangeVals[0]
        || typeof rangeVals[0].getSheet !== 'function') {
      t.assertTrue('C6 validation range is a real Range object', false);
      return;
    }
    var targetRange = rangeVals[0];
    var targetSheetName = targetRange.getSheet().getName();
    var targetA1 = targetRange.getA1Notation();

    t.assert('C6 dropdown reads from ' + SH.BESS_MIRROR,
             SH.BESS_MIRROR, targetSheetName);

    // Battery_ID is column A; range should start at A2 (skip header) and
    // ideally extend to the bottom. Acceptable forms: 'A2:A', 'A2:A11', etc.
    t.assertTrue('C6 dropdown range starts at column A (Battery_ID), got '
                 + targetA1,
                 /^A2(:A\d*)?$/.test(targetA1));

    // === Cross-check: dropdown values reflect real DB =================
    var products = getAllBatteryProducts(ctx.ss);
    var ids = products.map(function (p) {
      return String(p['Battery_ID'] || '').trim();
    }).filter(function (s) { return s !== ''; });

    t.info('DB IDs',
           ids.length + ' Battery_IDs in DB: ' + ids.join(', '));
    t.assertTrue('DB has CUSTOM_MANUAL',
                 ids.indexOf('CUSTOM_MANUAL') >= 0);
    t.assertTrue('DB has at least one real (non-CUSTOM_MANUAL) product, '
                 + 'so the dropdown is actually useful',
                 ids.filter(function (s) {
                   return s !== 'CUSTOM_MANUAL';
                 }).length >= 1);
  }
});
