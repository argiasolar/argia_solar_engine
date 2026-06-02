// =============================================================================
// ARGIA TESTS -- tests_regression/InputDesignDescriptionsTests.gs
// -----------------------------------------------------------------------------
// Keeps the INPUT_DESIGN impact notes (98_InputDesignDescriptions.gs) in sync
// with INPUT_MAP:
//   1. Every described key is a real INPUT_DESIGN field (no orphan notes that
//      would silently land on the wrong cell or nowhere).
//   2. Coverage: every INPUT_DESIGN field has a description (a new field added
//      without a note fails the test -> reminder to document it).
//   3. Notes are non-trivial (not blank).
//
// CLASSIFICATION: group=regression, pure data (no sheet access).
// DEPENDENCIES: INPUT_DESIGN_IMPACT (98), INPUT_MAP + SH (02c).
// =============================================================================

registerTest({
  id      : 'UNIT_INPUT_DESIGN_DESCRIPTIONS_SYNC',
  group   : 'regression',
  module  : 'inputs/descriptions',
  scenarios: [],
  tags    : ['regression', 'inputs', 'descriptions'],
  source  : 'tests_regression/InputDesignDescriptionsTests.gs',
  fn      : function (t) {
    t.suite('REGRESSION inputs: INPUT_DESIGN_IMPACT <-> INPUT_MAP');

    // 1) every described key is a real INPUT_DESIGN field
    Object.keys(INPUT_DESIGN_IMPACT).forEach(function (key) {
      var def = INPUT_MAP[key];
      t.assertTrue('described key exists in INPUT_MAP: ' + key, !!def);
      if (def) {
        t.assertTrue('described key is on INPUT_DESIGN: ' + key,
          def.sheet === SH.INPUT_DESIGN);
      }
      var txt = INPUT_DESIGN_IMPACT[key];
      t.assertTrue('description is non-trivial: ' + key,
        typeof txt === 'string' && txt.trim().length >= 15);
    });

    // 2) coverage: every INPUT_DESIGN field has a description
    Object.keys(INPUT_MAP).forEach(function (key) {
      if (INPUT_MAP[key].sheet !== SH.INPUT_DESIGN) return;
      t.assertTrue('INPUT_DESIGN field has a description: ' + key,
        Object.prototype.hasOwnProperty.call(INPUT_DESIGN_IMPACT, key));
    });
  }
});
