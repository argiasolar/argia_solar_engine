// =============================================================================
// ARGIA TESTS -- tests_regression/inputs/InputMapCfeCoverageTests.gs
// -----------------------------------------------------------------------------
// [A2a] Locks _MAP_CFE coverage + shape. INPUT_CFE was the last input sheet
// with no map entries (its bill is a 12-month matrix, so reads were hardcoded
// in 02_LoadDB.js / 20a). This test guards that:
//   - every CFE input the engine reads has a map key (so A2b can migrate the
//     direct reads onto readInput/inputLocation safely),
//   - scalars carry row+col, range rows carry mode:'range' + rangeA1,
//   - every entry points at the INPUT_CFE sheet,
//   - inputLocation renders both a scalar and a range correctly.
// Derived total rows (r30-r37) are intentionally NOT mapped (outputs, not inputs).
// =============================================================================

registerTest({
  id      : 'REG_INPUT_MAP_CFE_COVERAGE',
  group   : 'regression',
  module  : 'inputs/map',
  scenarios: [],
  tags    : ['inputs', 'map', 'cfe', 'a2'],
  source  : 'tests_regression/inputs/InputMapCfeCoverageTests.gs',
  fn: function (t, ctx) {
    t.suite('REG inputs/map [A2a]: _MAP_CFE coverage + shape');

    // Every CFE input the engine reads (02_LoadDB.js + 20a) must be mapped.
    var SCALARS = ['cfeTariff', 'cfeRegion', 'cfeDap', 'cfeBajaTension2pct',
                   'cfeInterconnMode', 'cfeExportPriceMxnPerKwh',
                   'cfeAutoconsumoPct', 'cfePowerFactorThreshold'];
    var RANGES  = ['cfeKwhBase', 'cfeKwhIntermedia', 'cfeKwhPunta',
                   'cfeKwBase', 'cfeKwIntermedia', 'cfeKwPunta',
                   'cfeKwMaxAnoMovil', 'cfeKvarh', 'cfeDias',
                   'cfeDemandaFacturable', 'cfeFpPct', 'cfeCapacidadMxn',
                   'cfeDistribucionMxn', 'cfeTransmisionMxn', 'cfeCenaceMxn',
                   'cfeEnergiaBMxn', 'cfeEnergiaIMxn', 'cfeEnergiaPMxn',
                   'cfeScnmemMxn', 'cfeSuministroMxn'];

    // 1. Presence
    var missing = [];
    SCALARS.concat(RANGES).forEach(function (k) { if (!hasInput(k)) missing.push(k); });
    t.assert('all 28 CFE keys present in INPUT_MAP (none missing)', '', missing.join(','));

    // 2. Every CFE entry points at INPUT_CFE
    var wrongSheet = [];
    SCALARS.concat(RANGES).forEach(function (k) {
      if (INPUT_MAP[k] && INPUT_MAP[k].sheet !== 'INPUT_CFE') wrongSheet.push(k);
    });
    t.assert('every CFE entry sheet === INPUT_CFE', '', wrongSheet.join(','));

    // 3. Scalar shape: row + col are numbers, no range mode
    var badScalar = [];
    SCALARS.forEach(function (k) {
      var m = INPUT_MAP[k] || {};
      if (typeof m.row !== 'number' || typeof m.col !== 'number' || m.mode === 'range') badScalar.push(k);
    });
    t.assert('scalars have numeric row+col (not range)', '', badScalar.join(','));

    // 4. Range shape: mode:'range' + a rangeA1 spanning C..N
    var badRange = [];
    RANGES.forEach(function (k) {
      var m = INPUT_MAP[k] || {};
      if (m.mode !== 'range' || !/^C\d+:N\d+$/.test(String(m.rangeA1 || ''))) badRange.push(k);
    });
    t.assert('ranges have mode:range + C..N rangeA1', '', badRange.join(','));

    // 5. inputLocation renders scalar + range
    t.assert('inputLocation(cfeTariff) = INPUT_CFE!C4',  'INPUT_CFE!C4',       inputLocation('cfeTariff'));
    t.assert('inputLocation(cfeKwhPunta) = INPUT_CFE!C12:N12', 'INPUT_CFE!C12:N12', inputLocation('cfeKwhPunta'));

    // 6. The exact coordinates the engine's hardcoded reads use (A2b targets)
    t.assert('cfeInterconnMode at r41/c3', 'INPUT_CFE!C41', inputLocation('cfeInterconnMode'));
    t.assert('cfeDemandaFacturable at C19:N19', 'INPUT_CFE!C19:N19', inputLocation('cfeDemandaFacturable'));
    t.assert('cfeCapacidadMxn at C21:N21', 'INPUT_CFE!C21:N21', inputLocation('cfeCapacidadMxn'));
    t.assert('cfeEnergiaPMxn at C27:N27', 'INPUT_CFE!C27:N27', inputLocation('cfeEnergiaPMxn'));
  }
});
