// =============================================================================
// ARGIA ENGINE -- Phase 15 test suite: BESS C6 dropdown sync (4b-2.5c)
// Paste into 99_TestRunner.gs, and add the call
//   try { addPhase15Tests(t, ss); } catch (e) { t.error('Phase15 aborted', e); }
// right after the addPhase14Tests block in runTests().
//
// SCOPE: Increment 4b-2.5c added setupInputBess() in 02e_InputSetup.gs, which
// rewires INPUT_BESS!C6 (BATTERY_ID) data-validation to read from the live
// 16M_PRODUCTS_BESS DB. This unblocks the production gap surfaced by Phase
// 14 CASE 3 -- previously the C6 dropdown's hardcoded allowlist
// (CATL_3MWH, BYD_2MWH, ...) did not match the actual Battery_IDs in the DB
// (HW_LUNA_200KWH, ...), so no real catalog battery could be selected.
//
// This suite VERIFIES the current state of C6's validation. It does NOT run
// setupInputBess automatically -- that would permanently mutate the live
// sheet's data-validation. If C6 is still pointing at the stale hardcoded
// list, the test reports a loud, specific info line telling the user to
// run setupInputBess from the IDE once. Once setupInputBess has been run,
// the assertions pass and the dropdown is locked to the DB.
// =============================================================================

function addPhase15Tests(t, ss) {
  t.suite('Phase15: BESS C6 dropdown sync');

  // -- function availability ------------------------------------------------
  t.assert('setupInputBess defined',
           'function', typeof setupInputBess);
  t.assert('SH.INPUT_BESS constant defined',
           'INPUT_BESS', SH.INPUT_BESS);
  t.assert('SH.BESS_MIRROR constant defined',
           '16M_PRODUCTS_BESS', SH.BESS_MIRROR);

  // -- read the live validation rule at INPUT_BESS!C6 ----------------------
  var shBess = ss.getSheetByName(SH.INPUT_BESS);
  if (!shBess) {
    t.error('Phase15 setup',
            new Error('INPUT_BESS sheet missing'));
    return;
  }
  var c6 = shBess.getRange(6, 3);
  var rule = c6.getDataValidation();

  if (!rule) {
    t.info('Phase15 NOTE',
           'INPUT_BESS!C6 has NO data-validation rule. Run setupInputBess() '
           + 'from the Apps Script IDE once to install it, then re-run tests.');
    return;
  }

  // The rule's criteria tells us whether the allowlist is a hardcoded list
  // (old, stale -- VALUE_IN_LIST) or a range reference to the DB (new,
  // dynamic -- VALUE_IN_RANGE). Apps Script exposes this via
  // rule.getCriteriaType(); the corresponding values live in
  // SpreadsheetApp.DataValidationCriteria.
  var criteriaType = rule.getCriteriaType();
  var DVC = SpreadsheetApp.DataValidationCriteria;

  if (criteriaType === DVC.VALUE_IN_LIST) {
    // Old hardcoded list -- the stale state. Report loudly with the values
    // so the user sees exactly what is misaligned with the DB.
    var values = rule.getCriteriaValues();
    var staleList = (values && values[0]) ? values[0].join(' / ') : '(empty)';
    t.info('Phase15 STALE',
           'INPUT_BESS!C6 still uses a HARDCODED allowlist: [' + staleList
           + ']. This does NOT match the live 16M_PRODUCTS_BESS DB and '
           + 'blocks catalog battery selection. Fix: run setupInputBess() '
           + 'from the Apps Script IDE once. Then re-run tests.');
    // Don't fail -- this is an environmental state the test exists to
    // surface, not a regression. The assertion below will reflect it.
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

  // VALUE_IN_RANGE -- inspect which range the dropdown points at.
  var rangeVals = rule.getCriteriaValues();
  if (!rangeVals || !rangeVals[0] || typeof rangeVals[0].getSheet !== 'function') {
    t.assertTrue('C6 validation range is a real Range object', false);
    return;
  }
  var targetRange = rangeVals[0];
  var targetSheetName = targetRange.getSheet().getName();
  var targetA1 = targetRange.getA1Notation();

  t.assert('C6 dropdown reads from ' + SH.BESS_MIRROR,
           SH.BESS_MIRROR, targetSheetName);
  // Battery_ID is column A; the range should start at A2 (skip header) and
  // ideally extend to the bottom. Acceptable forms: 'A2:A', 'A2:A11', etc.
  t.assertTrue('C6 dropdown range starts at column A (Battery_ID), got '
               + targetA1,
               /^A2(:A\d*)?$/.test(targetA1));

  // -- cross-check: every dropdown value matches a real Battery_ID --------
  // Pull the actual DB IDs and confirm at least one real product (besides
  // CUSTOM_MANUAL) is now selectable from the dropdown. This catches the
  // case where setupInputBess pointed at the right range but the DB itself
  // is empty / loading (IMPORTRANGE).
  var products = getAllBatteryProducts(ss);
  var ids = products.map(function(p) {
    return String(p['Battery_ID'] || '').trim();
  }).filter(function(s) { return s !== ''; });
  t.info('Phase15 DB IDs', ids.length + ' Battery_IDs in DB: '
         + ids.join(', '));
  t.assertTrue('DB has CUSTOM_MANUAL', ids.indexOf('CUSTOM_MANUAL') >= 0);
  t.assertTrue('DB has at least one real (non-CUSTOM_MANUAL) product, so '
               + 'the dropdown is actually useful',
               ids.filter(function(s) { return s !== 'CUSTOM_MANUAL'; })
                  .length >= 1);
}