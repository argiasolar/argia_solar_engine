// =============================================================================
// ARGIA TESTS -- tests_regression/ValidationOptimizerSkipTests.gs
// -----------------------------------------------------------------------------
// Guards the validation-layer optimizer skip. runValidation must NOT raise the
// standard string-inverter criticals (STR-02 strings-vs-DC-inputs, DC-01
// Voc_cold>Vmax, DC-02 Vmp_hot<MPPT_min) for OPTIMIZER-topology inverters,
// because module-level optimizers regulate string voltage. Those checks are
// replaced by the INV-08 warning + INV-09 (REVIEW) major. Previously the
// INV-08 warning CLAIMED the checks were skipped but the criticals still fired,
// blocking the engine on a valid SolarEdge optimizer design.
//
// CLASSIFICATION
//   group=regression. Exercises the pure predicate that gates the skip; the
//   wiring into runValidation is verified live (runValidation needs a workbook).
//
// DEPENDENCIES
//   - optimizerTopologySkipsStringChecks (09_Validate.gs)
// =============================================================================

registerTest({
  id      : 'UNIT_VALIDATE_OPTIMIZER_SKIPS_STRING_CHECKS',
  group   : 'regression',
  module  : 'validate',
  scenarios: [],
  tags    : ['regression', 'validate', 'optimizer', 'pass4'],
  source  : 'tests_regression/ValidationOptimizerSkipTests.gs',
  fn      : function (t) {
    t.suite('REGRESSION validate: optimizerTopologySkipsStringChecks');

    t.assertTrue('OPTIMIZER skips standard checks',
      optimizerTopologySkipsStringChecks({ topology: 'OPTIMIZER' }) === true);
    t.assertTrue('case-insensitive',
      optimizerTopologySkipsStringChecks({ topology: 'optimizer' }) === true);

    t.assertTrue('STRING inverter still gets the checks',
      optimizerTopologySkipsStringChecks({ topology: 'STRING' }) === false);
    t.assertTrue('blank topology gets the checks (safe default)',
      optimizerTopologySkipsStringChecks({ topology: '' }) === false);
    t.assertTrue('missing topology gets the checks',
      optimizerTopologySkipsStringChecks({}) === false);
    t.assertTrue('null inverter is safe (false)',
      optimizerTopologySkipsStringChecks(null) === false);
  }
});
