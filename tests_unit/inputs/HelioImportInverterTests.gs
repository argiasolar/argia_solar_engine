// =============================================================================
// ARGIA TESTS -- tests_unit/inputs/HelioImportInverterTests.gs
//
// Regression: inverter row glued onto one line by the Drive PDF->Doc converter
// (Aurora "Annual Production Report", PROLOGIS mxc00107).
//
// Bug: the converter emits the Components row as a single line that
//   (a) does NOT start with "Inverters" -- it is prefixed by the table header
//       "Component Name Count", and
//   (b) glues the count to the brand with no space: "(SolarEdge)5 (500.00 kW)".
// All prior patterns were anchored with /^Inverters/ and required a space
// before the qty, so none fired -> 0 inverters parsed.
//
// Fix: the eGlued pattern matches "Inverters" mid-line and tolerates the
// missing space (\s* between brand and qty).
//
// Fixture lines below are the ACTUAL converter output captured from the live
// import (via _DEBUG_DumpHelioLines), not an offline approximation.
//
// parseHelioscopeData(pages) is pure (no GAS deps), so we feed a synthetic
// `pages` array and assert on data.inverters.
// =============================================================================

registerTest({
  id      : 'REG_HELIO_GLUED_INVERTER_ROW',
  group   : 'regression',
  module  : 'inputs/helio_import',
  scenarios: [],
  tags    : ['regression', 'inputs', 'helio', 'import'],
  source  : 'tests_unit/inputs/HelioImportInverterTests.gs',
  fn: function (t, ctx) {
    t.suite('REG helio: glued single-line inverter row is parsed');

    // --- Case A: real converter layout (the PROLOGIS bug) --------------------
    // Includes the singular "Inverter" lines from the Condition Set table and
    // the "Inverter Output" energy row as false-positive guards: only the
    // glued Components row should produce an inverter.
    var realPage = [
      'Inverter AC Nameplate',
      '500.00 kW',
      'Load Ratio: 1.24',
      'Inverter Output',                 // energy row -- must NOT match
      '1,018,079.00',
      'Inverter',                        // Condition Set, singular -- must NOT match
      'SE100KUS (SolarEdge)',            //   (model on its own line, no count)
      ' Components',
      'Component Name Count Inverters SE100KUS (SolarEdge)5 (500.00 kW)',
      'Strings 10 AWG (Copper)30 (5,344.1 m)'
    ].join('\n');

    var dReal = parseHelioscopeData([realPage]);
    t.assert('real: exactly one inverter found', 1,          dReal.inverters.length);
    t.assert('real: model',                      'SE100KUS', dReal.inverters[0].model);
    t.assert('real: brand',                      'SolarEdge', dReal.inverters[0].brand);
    t.assert('real: qty',                        5,          dReal.inverters[0].qty);
    t.assert('real: per-unit kW',                100,        Math.round(dReal.inverters[0].kw));
    t.assert('real: total kW',                   500,
             Math.round(dReal.inverters[0].qty * dReal.inverters[0].kw));

    // --- Case B: clean single-line layout (no regression on legacy path) -----
    var cleanPage = [
      'Inverters SE100KUS (SolarEdge) 5 (500.00 kW)'
    ].join('\n');
    var dClean = parseHelioscopeData([cleanPage]);
    t.assert('clean: exactly one inverter found', 1, dClean.inverters.length);
    t.assert('clean: qty',                        5, dClean.inverters[0].qty);
  }
});
