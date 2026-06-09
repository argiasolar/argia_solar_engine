// =============================================================================
// ARGIA TESTS -- tests_regression/Pass5HygieneTests.gs
// -----------------------------------------------------------------------------
// PASS 5 hygiene / consistency guards.
//
//   5b. reconcileStringCounts: the inverter-bank sum of stringsAssigned is the
//       single source of truth; overlapping scalar inputs (totalStrings,
//       stringsTotal) that disagree are flagged. (09_Validate.gs)
//   5c. Dead inputs removed: distCabinet / arrayBlocks / layoutBlocks no longer
//       exist in INPUT_MAP, and the promoted roofToInverterDropM input does.
//       (01_ReadInputs.gs + 02c_InputMap.gs)
//   5d. BAAS dual-map drift guard: every row in INPUT_BAAS_ROWS (30a) must match
//       the corresponding INPUT_MAP baas* entry. Locks the two maps in sync so
//       neither can drift silently. (30a_ReadInputsBaas.gs vs 02c_InputMap.gs)
//
// CLASSIFICATION
//   group=regression. Pure data / pure-function checks -- no sheet access.
//
// DEPENDENCIES
//   - reconcileStringCounts (09_Validate.gs)
//   - INPUT_MAP             (02c_InputMap.gs)
//   - INPUT_BAAS_ROWS       (30a_ReadInputsBaas.gs)
// =============================================================================


// ----------------------------------------------------------------------------
// 5b) String-count reconciliation
// ----------------------------------------------------------------------------
registerTest({
  id      : 'UNIT_PASS5_STRING_COUNT_RECONCILE',
  group   : 'regression',
  module  : 'validate',
  scenarios: [],
  tags    : ['regression', 'validate', 'strings', 'pass5'],
  source  : 'tests_regression/Pass5HygieneTests.gs',
  fn      : function (t) {
    t.suite('REGRESSION validate: reconcileStringCounts');

    var bank = [{ stringsAssigned: 10 }, { stringsAssigned: 20 }]; // sum = 30

    // Consistent: scalars match the bank sum.
    var ok = reconcileStringCounts({ totalStrings: 30, stringsTotal: 30 }, bank);
    t.assert('authoritative = bank sum', 30, ok.authoritative, 0.001);
    t.assertTrue('consistent when scalars match', ok.consistent === true);
    t.assertTrue('no conflicts when consistent', ok.conflicts.length === 0);

    // Conflict: totalStrings disagrees with the bank sum.
    var bad = reconcileStringCounts({ totalStrings: 25 }, bank);
    t.assertTrue('inconsistent when totalStrings != bank', bad.consistent === false);
    t.assertTrue('conflict records the offending source',
      bad.conflicts.length === 1 && bad.conflicts[0].source === 'totalStrings' &&
      bad.conflicts[0].value === 25);
    t.assert('authoritative still bank sum on conflict', 30, bad.authoritative, 0.001);

    // Blank / zero scalars are ignored (not a conflict).
    var blank = reconcileStringCounts({ totalStrings: 0, stringsTotal: '' }, bank);
    t.assertTrue('zero/blank scalars ignored', blank.consistent === true);
  }
});


// ----------------------------------------------------------------------------
// 5c) Dead inputs removed; drop input promoted
// ----------------------------------------------------------------------------
registerTest({
  id      : 'UNIT_PASS5_DEAD_INPUTS_REMOVED',
  group   : 'regression',
  module  : 'inputs/map',
  scenarios: [],
  tags    : ['regression', 'inputs', 'hygiene', 'pass5'],
  source  : 'tests_regression/Pass5HygieneTests.gs',
  fn      : function (t) {
    t.suite('REGRESSION inputs: dead keys gone, drop input present');

    t.assertTrue('distCabinet removed from INPUT_MAP',
      !INPUT_MAP.hasOwnProperty('distCabinet'));
    t.assertTrue('arrayBlocks removed from INPUT_MAP',
      !INPUT_MAP.hasOwnProperty('arrayBlocks'));
    t.assertTrue('layoutBlocks removed from INPUT_MAP',
      !INPUT_MAP.hasOwnProperty('layoutBlocks'));

    t.assertTrue('roofToInverterDropM registered in INPUT_MAP',
      INPUT_MAP.hasOwnProperty('roofToInverterDropM'));
    // distCabinet cell freed + shifted by the row-15 hotfix (INPUT_DESIGN row 25, col 3).
    t.assertTrue('drop input default is 5 m',
      INPUT_MAP.roofToInverterDropM.default === 5);
    t.assert('drop input row', 25, INPUT_MAP.roofToInverterDropM.row, 0);
    t.assert('drop input col', 3,  INPUT_MAP.roofToInverterDropM.col, 0);
  }
});


// ----------------------------------------------------------------------------
// 5d) BAAS dual-map drift guard
// ----------------------------------------------------------------------------
registerTest({
  id      : 'UNIT_PASS5_BAAS_MAP_NO_DRIFT',
  group   : 'regression',
  module  : 'inputs/baas',
  scenarios: [],
  tags    : ['regression', 'inputs', 'baas', 'pass5'],
  source  : 'tests_regression/Pass5HygieneTests.gs',
  fn      : function (t) {
    t.suite('REGRESSION inputs: INPUT_BAAS_ROWS matches INPUT_MAP baas* rows');

    // [ INPUT_MAP key , INPUT_BAAS_ROWS key ]
    var pairs = [
      ['baasLeaseTermYears',   'LEASE_TERM'],
      ['baasLeaseType',        'LEASE_TYPE'],
      ['baasPaymentEscFixed',  'PAYMENT_ESC_FIXED'],
      ['baasInpcEsc',          'INPC_ESC'],
      ['baasBillEsc',          'BILL_ESC'],
      ['baasSavingsEsc',       'SAVINGS_ESC'],
      ['baasTargetIrr',        'TARGET_IRR'],
      ['baasDiscountRate',     'DISCOUNT_RATE'],
      ['baasOmCostYear',       'OM_COST_YEAR'],
      ['baasReplReserveYear',  'REPL_RESERVE_YEAR'],
      ['baasTaxBenefitRate',   'TAX_BENEFIT_RATE'],
      ['baasTaxAmortYears',    'TAX_AMORT_YEARS'],
      ['baasCustomerCanUseTax','CUSTOMER_CAN_USE_TAX'],
      ['baasFxRate',           'FX_RATE'],
    ];

    for (var i = 0; i < pairs.length; i++) {
      var imKey = pairs[i][0], rowKey = pairs[i][1];
      t.assertTrue('INPUT_MAP has ' + imKey, INPUT_MAP.hasOwnProperty(imKey));
      t.assertTrue('INPUT_BAAS_ROWS has ' + rowKey, INPUT_BAAS_ROWS.hasOwnProperty(rowKey));
      t.assert('row match ' + imKey + ' <-> ' + rowKey,
        INPUT_BAAS_ROWS[rowKey], INPUT_MAP[imKey].row, 0);
    }
  }
});
