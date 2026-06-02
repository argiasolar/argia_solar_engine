// =============================================================================
// ARGIA TESTS -- tests_regression/Pass1QuantityRegressionTests.gs
// -----------------------------------------------------------------------------
// PASS 1 quantity-bug regression guards. Each test locks in one fix from the
// calculation audit so it cannot silently regress.
//
//   1. Main feeder cable scales with ac.parallelRuns (06_CalcLayout.js).
//      BUG: feederCableM = feederLen x 3 x spare  -- omitted x parallelRuns,
//      so the most expensive copper in the BOM was ~half on multi-run feeders.
//   2. Main EGC scales with ac.parallelRuns (NEC 250.122(F): a full-size EGC
//      in each parallel raceway).
//   3. Gross array area uses the real module footprint from the panel DB
//      (PANEL_LENGTH x PANEL_WIDTH, stashed on dc.panelAreaM2 by calcDC) and
//      falls back to 2.2 m2 only when dimensions are absent (06_CalcLayout.js).
//      BUG: always used the 2.2 m2 fallback, understating area ~20%.
//   4. BESS install items are gated to zero when their BESS_* driver is 0
//      (13_CalcInstallCost.js bessItemGatedToZero). BUG: OTHER_FIXED/
//      LABOR_FIXED_MH floored qty to minQty/1, billing ~71k MXN on battery=NO.
//
// CLASSIFICATION
//   group=unit/regression. All four exercise pure functions (calcLayout and
//   the bessItemGatedToZero helper) with synthetic objects -- no sheet access,
//   so they run in the Node rig and from the ARGIA menu identically.
//
// DEPENDENCIES
//   - calcLayout            (06_CalcLayout.gs)
//   - bessItemGatedToZero   (13_CalcInstallCost.gs)
// =============================================================================


// ----------------------------------------------------------------------------
// Synthetic builders. Minimum viable shapes calcLayout(inp, dc, ac, nom) reads.
// Values are chosen so the arithmetic is easy to verify by hand.
// ----------------------------------------------------------------------------
function _p1_inp(over) {
  var inp = {
    panelAreaM2   : 0,        // hardcoded 0 upstream in the real engine
    panelQty      : 10,
    walkwayFactor : 1.0,
    layoutRows    : 0,        // force the aspect-ratio path (no override)
    layoutCols    : 0,
    rowPitch      : 0,
    aspectRatio   : 1.0,
    stringsTotal  : 4,
    dcSpareFactor : 1.0,
    groundingLen  : 0,
    acSpareFactor : 1.2,
    invStations   : 1,
    areaRequired  : 0,
    availableSpace: 0,
    projectType   : 'ROOF'
  };
  if (over) { for (var k in over) inp[k] = over[k]; }
  return inp;
}

function _p1_dc(over) {
  var dc = { dcLength: 35, panelAreaM2: 0 };
  if (over) { for (var k in over) dc[k] = over[k]; }
  return dc;
}

function _p1_ac(over) {
  var ac = {
    perInverter : [{
      model: 'TEST-INV', qty: 1, acLenInv: 30,
      ocpd: 175, conductor: '1 AWG', egc: '8 AWG', conduit: '2"'
    }],
    feederLen   : 100,
    parallelRuns: 1,
    mainBreaker : 250,
    condMain    : '250 kcmil',
    egcMain     : '4 AWG',
    conduitMain : '3"',
    transformer : null
  };
  if (over) { for (var k in over) ac[k] = over[k]; }
  return ac;
}


// ----------------------------------------------------------------------------
// 1) Feeder cable scales with parallelRuns
// ----------------------------------------------------------------------------
registerTest({
  id      : 'UNIT_PASS1_FEEDER_SCALES_WITH_PARALLEL_RUNS',
  group   : 'regression',
  module  : 'calc/layout',
  scenarios: [],
  tags    : ['regression', 'layout', 'feeder', 'pass1'],
  source  : 'tests_regression/Pass1QuantityRegressionTests.gs',
  fn      : function (t) {
    t.suite('REGRESSION calc/layout: feeder x parallelRuns');

    var inp  = _p1_inp();
    var dc   = _p1_dc();
    var lay1 = calcLayout(inp, dc, _p1_ac({ parallelRuns: 1 }), null);
    var lay2 = calcLayout(inp, dc, _p1_ac({ parallelRuns: 2 }), null);

    // feederLen 100 x 3 phases x runs x spare 1.2
    t.assert('1 run  feederCableM',  360, lay1.feederCableM, 0.001);
    t.assert('2 runs feederCableM',  720, lay2.feederCableM, 0.001);
    // The regression: it must DOUBLE with two runs (was constant before).
    t.assertTrue('feeder doubles with 2 runs',
      Math.abs(lay2.feederCableM - 2 * lay1.feederCableM) < 0.001);
    t.assert('bom.mainFeederCableM (2 runs)', 720, lay2.bom.mainFeederCableM, 0.001);
  }
});


// ----------------------------------------------------------------------------
// 2) Main EGC scales with parallelRuns
// ----------------------------------------------------------------------------
registerTest({
  id      : 'UNIT_PASS1_MAIN_EGC_SCALES_WITH_PARALLEL_RUNS',
  group   : 'regression',
  module  : 'calc/layout',
  scenarios: [],
  tags    : ['regression', 'layout', 'egc', 'pass1'],
  source  : 'tests_regression/Pass1QuantityRegressionTests.gs',
  fn      : function (t) {
    t.suite('REGRESSION calc/layout: main EGC x parallelRuns');

    var inp  = _p1_inp();
    var dc   = _p1_dc();
    var lay1 = calcLayout(inp, dc, _p1_ac({ parallelRuns: 1 }), null);
    var lay2 = calcLayout(inp, dc, _p1_ac({ parallelRuns: 2 }), null);

    // feederLen 100 x runs x spare 1.2, ceil()
    t.assert('1 run  mainEgcM', 120, lay1.bom.mainEgcM, 0.001);
    t.assert('2 runs mainEgcM', 240, lay2.bom.mainEgcM, 0.001);
    t.assertTrue('EGC doubles with 2 runs',
      lay2.bom.mainEgcM === 2 * lay1.bom.mainEgcM);
  }
});


// ----------------------------------------------------------------------------
// 3) Gross area uses real module footprint from the panel DB (via dc)
// ----------------------------------------------------------------------------
registerTest({
  id      : 'UNIT_PASS1_PANEL_AREA_FROM_DB',
  group   : 'regression',
  module  : 'calc/layout',
  scenarios: [],
  tags    : ['regression', 'layout', 'panel_area', 'pass1'],
  source  : 'tests_regression/Pass1QuantityRegressionTests.gs',
  fn      : function (t) {
    t.suite('REGRESSION calc/layout: panel area from DB');

    // 2465 x 1134 mm = 2.79531 m2 (a real >=600W module). qty 10, walkway 1.0.
    var areaM2 = (2465 / 1000) * (1134 / 1000); // 2.79531
    var inp = _p1_inp({ panelQty: 10, walkwayFactor: 1.0 });
    var lay = calcLayout(inp, _p1_dc({ panelAreaM2: areaM2 }), _p1_ac(), null);

    t.assert('grossArea uses real area', areaM2 * 10, lay.grossArea, 0.01);
    // Must NOT be the old 2.2 m2 fallback result (22.0).
    t.assertTrue('grossArea is not the 2.2 fallback', lay.grossArea > 27);
  }
});


// ----------------------------------------------------------------------------
// 4) Fallback to 2.2 m2 only when dimensions are absent; inp override honoured
// ----------------------------------------------------------------------------
registerTest({
  id      : 'UNIT_PASS1_PANEL_AREA_FALLBACK_WHEN_MISSING',
  group   : 'regression',
  module  : 'calc/layout',
  scenarios: [],
  tags    : ['regression', 'layout', 'panel_area', 'pass1'],
  source  : 'tests_regression/Pass1QuantityRegressionTests.gs',
  fn      : function (t) {
    t.suite('REGRESSION calc/layout: panel area fallback / override');

    // No dc area, no inp override -> 2.2 m2 fallback. qty 10, walkway 1.0.
    var layFb = calcLayout(_p1_inp({ panelQty: 10, walkwayFactor: 1.0 }),
                           _p1_dc({ panelAreaM2: 0 }), _p1_ac(), null);
    t.assert('fallback grossArea (2.2)', 22.0, layFb.grossArea, 0.001);

    // inp.panelAreaM2 override beats the 2.2 fallback when dc has no dims.
    var layOv = calcLayout(_p1_inp({ panelQty: 10, walkwayFactor: 1.0, panelAreaM2: 2.5 }),
                           _p1_dc({ panelAreaM2: 0 }), _p1_ac(), null);
    t.assert('override grossArea (2.5)', 25.0, layOv.grossArea, 0.001);
  }
});


// ----------------------------------------------------------------------------
// 5) BESS install items gated to zero when their BESS_* driver is 0
// ----------------------------------------------------------------------------
registerTest({
  id      : 'UNIT_PASS1_BESS_ITEM_GATED_WHEN_DRIVER_ZERO',
  group   : 'regression',
  module  : 'calc/install',
  scenarios: [],
  tags    : ['regression', 'install', 'bess', 'pass1'],
  source  : 'tests_regression/Pass1QuantityRegressionTests.gs',
  fn      : function (t) {
    t.suite('REGRESSION calc/install: BESS gate predicate');

    // Battery disabled => BESS_* driver is 0 => item gated to 0 (the leak fix).
    t.assertTrue('BESS_PROJECT_ONE driver 0 -> gated',
      bessItemGatedToZero({ driverKey: 'BESS_PROJECT_ONE' }, 0));
    t.assertTrue('BESS_CONTAINER_QTY driver 0 -> gated',
      bessItemGatedToZero({ driverKey: 'BESS_CONTAINER_QTY' }, 0));

    // Battery enabled => driver > 0 => NOT gated (charges normally).
    t.assertFalse('BESS_PROJECT_ONE driver 1 -> not gated',
      bessItemGatedToZero({ driverKey: 'BESS_PROJECT_ONE' }, 1));

    // Non-BESS items are never gated by this rule, even with a 0 driver
    // (a 0 scale-indicator driver must still bill its flat cost).
    t.assertFalse('PROJECT_DC_KWP driver 0 -> not gated',
      bessItemGatedToZero({ driverKey: 'PROJECT_DC_KWP' }, 0));
    t.assertFalse('MODULE_COUNT driver 5 -> not gated',
      bessItemGatedToZero({ driverKey: 'MODULE_COUNT' }, 5));

    // Defensive: missing driverKey must not throw or gate.
    t.assertFalse('missing driverKey -> not gated',
      bessItemGatedToZero({}, 0));
  }
});
