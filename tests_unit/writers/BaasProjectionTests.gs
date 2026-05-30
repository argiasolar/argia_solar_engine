// =============================================================================
// ARGIA TESTS -- tests_unit/writers/BaasProjectionTests.gs
// -----------------------------------------------------------------------------
// CHUNK 6 -- BaaS Economics Engine
//
// Locks the BaaS projection writer invariants:
//   - the TAX disclaimer (structural invariant: tax benefit shown => disclaimer)
//   - the PROPOSAL disclaimer (inherited)
//   - the validation placeholder (tier stays PROPOSAL, not live)
//
// COVERAGE (5 tests):
//   1. UNIT_BAAS_WRITER_PROPOSAL_DISCLAIMER     -- proposal disclaimer present
//   2. UNIT_BAAS_WRITER_TAX_DISCLAIMER_INVARIANT -- tax shown => disclaimer present
//   3. UNIT_BAAS_WRITER_NO_TAX_NO_FALSE_CLAIM   -- no tax => no tax-benefit claim
//   4. UNIT_BAAS_VALIDATION_PLACEHOLDER_NOT_LIVE -- tier PROPOSAL, not BANKABLE
//   5. UNIT_BAAS_WRITER_RENDERS_15_ROWS         -- projection table has all years
// =============================================================================

function _baasMockSheet() {
  var writes = [];
  function mkRange() {
    var self = {
      merge: function () { return self; },
      breakApart: function () { return self; },
      clear: function () { return self; },
      setValue: function (v) { writes.push(String(v)); return self; },
      setValues: function () { return self; },
      getValue: function () { return ''; },
      getValues: function () { return [[]]; },
      setFontWeight: function () { return self; },
      setFontFamily: function () { return self; },
      setFontSize: function () { return self; },
      setFontStyle: function () { return self; },
      setFontColor: function () { return self; },
      setBackground: function () { return self; },
      setBorder: function () { return self; },
      setNumberFormat: function () { return self; },
      setNote: function () { return self; },
      setWrap: function () { return self; },
      setVerticalAlignment: function () { return self; },
      setHorizontalAlignment: function () { return self; },
    };
    return self;
  }
  return {
    _writes: writes,
    clear: function () {},
    clearNotes: function () {},
    clearConditionalFormatRules: function () {},
    getRange: function () { return mkRange(); },
    // getLastRow = 1 so loadDesignTokens short-circuits (returns empty token
    // map) instead of scanning a non-existent _DESIGN_TOKENS data range.
    getLastRow: function () { return 1; },
    setRowHeight: function () {},
    setColumnWidth: function () {},
    setFrozenRows: function () {},
    setHiddenGridlines: function () {},
    getImages: function () { return []; },
    getName: function () { return 'BAAS_PROJECTION_v2'; }
  };
}

function _baasMockSs(sheet) {
  return {
    // Route any sheet lookup to the right stub. _DESIGN_TOKENS (requested by
    // loadDesignTokens) must serve REAL token rows so token()/tokenNum()
    // resolve -- the engine's token() fails loud on a missing key, so an
    // empty stub is not enough; it must be seeded.
    getSheetByName: function (name) {
      if (name === '_DESIGN_TOKENS') return _baasDesignTokensStub();
      return sheet;
    },
    insertSheet: function (name) {
      if (name === '_DESIGN_TOKENS') return _baasDesignTokensStub();
      return sheet;
    }
  };
}

// Seeded _DESIGN_TOKENS stub: getLastRow >= 2 + getValues returns the token
// key/value pairs, so loadDesignTokens populates the cache and token() calls
// succeed. Mirrors the pattern used by BomTemplateTests / WriteCfeOutputV2Tests.
var _BAAS_TOKEN_ROWS = [
  ['TEXT_PRIMARY',         '#111111'],
  ['TEXT_SECONDARY',       '#767676'],
  ['TEXT_MUTED',           '#B0B0B0'],
  ['BG_PAGE',              '#FAFAF7'],
  ['BG_INPUT_CELL',        '#FDFBF6'],
  ['BG_SUBTOTAL',          '#F5F3EE'],
  ['BG_CALLOUT',           '#FFF8E1'],
  ['STATUS_WARN',          '#B88728'],
  ['STATUS_FAIL',          '#B8404C'],
  ['DIVIDER_STRONG',       '#111111'],
  ['FONT_FAMILY',          'Inter'],
  ['FONT_SIZE_TITLE',      '22'],
  ['FONT_SIZE_BODY',       '10'],
  ['FONT_SIZE_SMALL',      '8'],
  ['FONT_WEIGHT_EMPHASIS', 'bold'],
  ['ROW_H_TITLE',          '42']
];
function _baasDesignTokensStub() {
  return {
    getName: function () { return '_DESIGN_TOKENS'; },
    getLastRow: function () { return _BAAS_TOKEN_ROWS.length + 1; },
    getRange: function (row, col, numRows, numCols) {
      return {
        getValue: function () { return ''; },
        getValues: function () {
          // loadDesignTokens calls getRange(2, 1, lastRow-1, 2).getValues()
          if (row === 2 && col === 1 && numCols === 2) {
            return _BAAS_TOKEN_ROWS.slice(0, numRows);
          }
          return [[]];
        },
        setValue:  function () { return this; },
        setValues: function () { return this; },
        setFontWeight: function () { return this; },
        setBackground: function () { return this; }
      };
    },
    setColumnWidth: function () {},
    setFrozenRows: function () {},
    insertSheet: function () {}
  };
}

function _baasWriterText(sheet) { return sheet._writes.join(' || '); }

function _baasWriterFixture(overrides) {
  var f = {
    leaseTermYears: 15, leaseType: 'FINANCIERO',
    paymentEscalationPct: 0.04, billEscalationPct: 0.07, savingsEscalationPct: 0.04,
    year1BillWithoutMxn: 59424421, year1BillWithMxn: 44110369,
    leasePaymentYear1Mxn: 10844217, omCostMxnPerYear: 0,
    taxBenefitRate: 0.30, taxAmortYears: 10, solarCapexMxn: 52230766.67,
    customerCanUseTaxBenefit: true, capexMxn: 0
  };
  if (overrides) for (var k in overrides) if (overrides.hasOwnProperty(k)) f[k] = overrides[k];
  return f;
}


registerTest({
  id      : 'UNIT_BAAS_WRITER_PROPOSAL_DISCLAIMER',
  group   : 'unit',
  module  : 'writers/baas',
  scenarios: [],
  tags    : ['writers', 'baas', 'chunk6', 'disclaimer'],
  source  : 'tests_unit/writers/BaasProjectionTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT writers/baas: PROPOSAL disclaimer present');

    var sheet = _baasMockSheet();
    var result = calcBaasEconomics(_baasWriterFixture());
    writeBaasProjectionV2(_baasMockSs(sheet), result, {});
    var text = _baasWriterText(sheet);

    t.assertTrue('proposal disclaimer: ahorros no garantizados',
                 text.indexOf('no garantizados') >= 0);
    t.assertTrue('proposal disclaimer: 15-min interval',
                 text.indexOf('intervalos de 15 minutos') >= 0);
  }
});


registerTest({
  id      : 'UNIT_BAAS_WRITER_TAX_DISCLAIMER_INVARIANT',
  group   : 'unit',
  module  : 'writers/baas',
  scenarios: [],
  tags    : ['writers', 'baas', 'chunk6', 'disclaimer', 'tax', 'invariant'],
  source  : 'tests_unit/writers/BaasProjectionTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT writers/baas: tax benefit shown => tax disclaimer present (INVARIANT)');

    var sheet = _baasMockSheet();
    var result = calcBaasEconomics(_baasWriterFixture({ customerCanUseTaxBenefit: true }));
    t.assertTrue('precondition: tax applies', result.taxApplies === true);

    writeBaasProjectionV2(_baasMockSs(sheet), result, {});
    var text = _baasWriterText(sheet);

    // THE INVARIANT: if a tax benefit is shown, the disclaimer MUST be there.
    t.assertTrue('tax disclaimer: only FINANCIERO + usable',
                 text.indexOf('utilidad fiscal') >= 0);
    t.assertTrue('tax disclaimer: confirm with tax advisor',
                 text.toLowerCase().indexOf('asesor fiscal') >= 0);
    t.assertTrue('tax disclaimer: ARGIA does not guarantee',
                 text.indexOf('no garantiza el aprovechamiento') >= 0);
  }
});


registerTest({
  id      : 'UNIT_BAAS_WRITER_NO_TAX_NO_FALSE_CLAIM',
  group   : 'unit',
  module  : 'writers/baas',
  scenarios: [],
  tags    : ['writers', 'baas', 'chunk6', 'tax'],
  source  : 'tests_unit/writers/BaasProjectionTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT writers/baas: no tax benefit => no tax-benefit claim shown');

    var sheet = _baasMockSheet();
    var result = calcBaasEconomics(_baasWriterFixture({ customerCanUseTaxBenefit: false }));
    t.assertTrue('precondition: tax does NOT apply', result.taxApplies === false);

    writeBaasProjectionV2(_baasMockSs(sheet), result, {});
    var text = _baasWriterText(sheet);

    // The "no tax" note appears; the affirmative tax disclaimer does not.
    t.assertTrue('shows the no-tax-benefit note',
                 text.indexOf('Sin beneficio fiscal') >= 0);
    t.assertTrue('does NOT claim an amortized tax benefit',
                 text.indexOf('no garantiza el aprovechamiento') < 0);
  }
});


registerTest({
  id      : 'UNIT_BAAS_VALIDATION_PLACEHOLDER_NOT_LIVE',
  group   : 'unit',
  module  : 'writers/baas',
  scenarios: [],
  tags    : ['writers', 'baas', 'chunk6', 'validation'],
  source  : 'tests_unit/writers/BaasProjectionTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT writers/baas: validation placeholder stays PROPOSAL, not live');

    var status = _baasValidationStatus(null);
    t.assert('tier is PROPOSAL', 'PROPOSAL', status.tier);
    t.assertTrue('interval data NOT available', status.intervalDataAvailable === false);
    t.assertTrue('bias check NOT passed', status.biasCheckPassed === false);
    t.assertTrue('reason explains placeholder', status.reason.indexOf('pendiente') >= 0);
  }
});


registerTest({
  id      : 'UNIT_BAAS_WRITER_RENDERS_15_ROWS',
  group   : 'unit',
  module  : 'writers/baas',
  scenarios: [],
  tags    : ['writers', 'baas', 'chunk6'],
  source  : 'tests_unit/writers/BaasProjectionTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT writers/baas: projection table renders all term-year rows');

    var sheet = _baasMockSheet();
    var result = calcBaasEconomics(_baasWriterFixture({ leaseTermYears: 15 }));
    var ret = writeBaasProjectionV2(_baasMockSs(sheet), result, { fxRate: 18.20 });

    t.assert('writer reports 15 rows', 15, ret.rows);
    var text = _baasWriterText(sheet);
    // Headline values present
    t.assertTrue('shows term 15 años', text.indexOf('15 años') >= 0);
    // FX note present
    t.assertTrue('shows FX assumption', text.indexOf('tipo de cambio') >= 0);
  }
});
