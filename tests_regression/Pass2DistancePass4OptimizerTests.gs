// =============================================================================
// ARGIA TESTS -- tests_regression/Pass2DistancePass4OptimizerTests.gs
// -----------------------------------------------------------------------------
// PASS 2 (geometry-based distances) + PASS 4 (optimizer BOM line) guards.
//
//   1. estimateArrayGeometry(): array footprint/dimensions from the real module
//      area; grows with module count; honours the layout override.
//   2. estimateDcRunM(): DC home-run = flat base + vertical rise + in-array
//      averaging that SCALES with array size. BUG it replaces: a flat
//      distInverter + stationCorridorM that under-measured far strings.
//   3. estimateAcRunM(): AC branch = base + vertical rise + spread across
//      distributed inverter stations (grows with array, shrinks with stations).
//   4. computeOptimizerUnits(): 0 unless an OPTIMIZER-topology inverter is
//      present; otherwise ceil(modules / modulesPerUnit). Wires the previously
//      dead optimizer signal into a BOM quantity.
//
// CLASSIFICATION
//   group=regression. All target pure helpers (no spreadsheet access), so they
//   run in the Node rig and from the ARGIA menu identically.
//
// DEPENDENCIES
//   - estimateArrayGeometry / estimateDcRunM / estimateAcRunM /
//     computeOptimizerUnits / ROOF_TO_INVERTER_DROP_M  (06_CalcLayout.gs)
// =============================================================================


function _p2_inp(over) {
  var inp = {
    distInverter   : 10,
    stationCorridorM: 20,
    distAcProt     : 15,
    invStations    : 1,
    walkwayFactor  : 1.0,
    panelQty       : 960,
    aspectRatio    : 1.5,
    layoutRows     : 0,
    layoutCols     : 0,
    rowPitch       : 0
  };
  if (over) { for (var k in over) inp[k] = over[k]; }
  return inp;
}


// ----------------------------------------------------------------------------
// 1) Array geometry scales with module count; honours layout override
// ----------------------------------------------------------------------------
registerTest({
  id      : 'UNIT_PASS2_ARRAY_GEOMETRY',
  group   : 'regression',
  module  : 'calc/layout',
  scenarios: [],
  tags    : ['regression', 'layout', 'geometry', 'pass2'],
  source  : 'tests_regression/Pass2DistancePass4OptimizerTests.gs',
  fn      : function (t) {
    t.suite('REGRESSION calc/layout: array geometry');

    // 2.795 m2 module, 960 modules, walkway 1.0 -> grossArea 2683.2.
    var g = estimateArrayGeometry(_p2_inp(), 2.795);
    t.assert('grossArea', 2683.2, g.grossArea, 0.1);
    t.assertTrue('L x W = grossArea',
      Math.abs(g.arrayLength * g.arrayWidth - g.grossArea) < 0.5);

    // More modules -> bigger array.
    var gBig = estimateArrayGeometry(_p2_inp({ panelQty: 1920 }), 2.795);
    t.assertTrue('double modules -> larger length', gBig.arrayLength > g.arrayLength);

    // Layout override: rows x pitch sets the length directly.
    var gOv = estimateArrayGeometry(
      _p2_inp({ layoutRows: 20, layoutCols: 10, rowPitch: 2 }), 2.795);
    t.assert('override length = rows x pitch', 40, gOv.arrayLength, 0.001);

    // Missing area -> 2.2 m2 fallback inside the helper.
    var gFb = estimateArrayGeometry(_p2_inp({ panelQty: 10, walkwayFactor: 1.0 }), 0);
    t.assert('fallback area 2.2', 22.0, gFb.grossArea, 0.001);
  }
});


// ----------------------------------------------------------------------------
// 2) DC home-run is geometry-aware (vertical rise + in-array averaging)
// ----------------------------------------------------------------------------
registerTest({
  id      : 'UNIT_PASS2_DC_RUN_GEOMETRY',
  group   : 'regression',
  module  : 'calc/layout',
  scenarios: [],
  tags    : ['regression', 'layout', 'distance', 'pass2'],
  source  : 'tests_regression/Pass2DistancePass4OptimizerTests.gs',
  fn      : function (t) {
    t.suite('REGRESSION calc/layout: DC home-run length');

    var inp = _p2_inp();
    var flat = inp.distInverter + inp.stationCorridorM; // 30 -- the OLD model

    // Zero-area edge: run = base + vertical rise only.
    var runZero = estimateDcRunM(inp, { arrayLength: 0, arrayWidth: 0 });
    t.assert('zero-area run = base + drop',
      flat + ROOF_TO_INVERTER_DROP_M, runZero, 0.001);

    // Real array: strictly longer than both the flat model and the zero-area
    // case (the in-array averaging adds length).
    var run = estimateDcRunM(inp, { arrayLength: 42.29, arrayWidth: 63.45 });
    t.assertTrue('geometry run > old flat model', run > flat);
    t.assertTrue('geometry run > zero-area run', run > runZero);

    // Monotonic: a bigger array yields a longer average run.
    var runBig = estimateDcRunM(inp, { arrayLength: 200, arrayWidth: 120 });
    t.assertTrue('bigger array -> longer run', runBig > run);
  }
});


// ----------------------------------------------------------------------------
// 3) AC branch grows with array, shrinks with station count
// ----------------------------------------------------------------------------
registerTest({
  id      : 'UNIT_PASS2_AC_RUN_GEOMETRY',
  group   : 'regression',
  module  : 'calc/layout',
  scenarios: [],
  tags    : ['regression', 'layout', 'distance', 'pass2'],
  source  : 'tests_regression/Pass2DistancePass4OptimizerTests.gs',
  fn      : function (t) {
    t.suite('REGRESSION calc/layout: AC branch length');

    var inp1 = _p2_inp({ invStations: 1 });
    // base 25 + drop 5 + spread (100/2 * 1 / 1 = 50) = 80
    var ac1 = estimateAcRunM(inp1, { arrayLength: 100, arrayWidth: 60 });
    t.assert('one station', 25 + ROOF_TO_INVERTER_DROP_M + 50, ac1, 0.001);

    // Two stations halve the spread term.
    var ac2 = estimateAcRunM(_p2_inp({ invStations: 2 }), { arrayLength: 100, arrayWidth: 60 });
    t.assertTrue('more stations -> shorter branch', ac2 < ac1);
  }
});


// ----------------------------------------------------------------------------
// 4) Optimizer units wired from topology (Pass 4)
// ----------------------------------------------------------------------------
registerTest({
  id      : 'UNIT_PASS4_OPTIMIZER_UNITS',
  group   : 'regression',
  module  : 'calc/layout',
  scenarios: [],
  tags    : ['regression', 'bom', 'optimizer', 'pass4'],
  source  : 'tests_regression/Pass2DistancePass4OptimizerTests.gs',
  fn      : function (t) {
    t.suite('REGRESSION calc/layout: optimizer BOM units');

    // String-topology inverter: no optimizers.
    t.assert('no optimizer topology -> 0', 0,
      computeOptimizerUnits(false, 960, 1), 0.001);

    // Optimizer topology: one per module by default.
    t.assert('one per module', 960,
      computeOptimizerUnits(true, 960, 1), 0.001);

    // One optimizer per 2 modules (e.g. SolarEdge S-series).
    t.assert('one per two modules', 480,
      computeOptimizerUnits(true, 960, 2), 0.001);

    // Guard: a 0/blank ratio falls back to 1 per module (never divide by 0).
    t.assert('ratio 0 -> per 1', 960,
      computeOptimizerUnits(true, 960, 0), 0.001);
  }
});
