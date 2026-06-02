// =============================================================================
// ARGIA TESTS -- tests_regression/Pass3InstallMhRegressionTests.gs
// -----------------------------------------------------------------------------
// PASS 3 installation man-hour calibration guards.
//
//   1. applyTotalMhTarget(): scales ALL productive labour proportionally so the
//      sum of man-hours equals target x kWp (the 3 MH/kWp calibration), leaving
//      equipment/other/INDIRECT untouched and preserving item proportions.
//      BUG it replaces: per-section benchmarks squashed labour to ~1 MH/kWp.
//   2. deriveInstallQuantities(): fills anchorCount / conduitM / trayM from
//      geometry/structure when blank, instead of letting them default to 0 and
//      silently delete anchoring, conduit and tray labour. Explicit values win;
//      ballasted/membrane systems get far fewer roof penetrations.
//
// CLASSIFICATION
//   group=regression. Both target pure helpers (no spreadsheet access), so they
//   run in the Node rig and from the ARGIA menu identically.
//
// DEPENDENCIES
//   - applyTotalMhTarget       (13_CalcInstallCost.gs)
//   - deriveInstallQuantities  (13_CalcInstallCost.gs)
// =============================================================================


// Build a synthetic install result with mixed item types.
function _p3_result() {
  return { items: [
    { item: { section: 'DC',             id: 'DC-01', costType: 'LABOR_PRODUCTIVITY' },
      mhComputed: 100, roleRateVal: 100, laborMxn: 10000, equipMxn: 0,    otherMxn: 0, totalMxn: 10000, formulaTrace: '' },
    { item: { section: 'RACKING SYSTEM', id: 'RK-01', costType: 'LABOR_FIXED_MH' },
      mhComputed: 50,  roleRateVal: 80,  laborMxn: 4000,  equipMxn: 0,    otherMxn: 0, totalMxn: 4000,  formulaTrace: '' },
    { item: { section: 'AC',             id: 'AC-09', costType: 'OTHER_FIXED' },
      mhComputed: 0,   roleRateVal: 0,   laborMxn: 0,     equipMxn: 5000, otherMxn: 0, totalMxn: 5000,  formulaTrace: '' },
    { item: { section: 'INDIRECT',       id: 'IN-01', costType: 'LABOR_PRODUCTIVITY' },
      mhComputed: 20,  roleRateVal: 90,  laborMxn: 1800,  equipMxn: 0,    otherMxn: 0, totalMxn: 1800,  formulaTrace: '' }
  ] };
}


// ----------------------------------------------------------------------------
// 1) Total MH target scales labour to target x kWp, preserves proportions
// ----------------------------------------------------------------------------
registerTest({
  id      : 'UNIT_PASS3_TOTAL_MH_TARGET_SCALES_LABOR',
  group   : 'regression',
  module  : 'calc/install',
  scenarios: [],
  tags    : ['regression', 'install', 'mh', 'pass3'],
  source  : 'tests_regression/Pass3InstallMhRegressionTests.gs',
  fn      : function (t) {
    t.suite('REGRESSION calc/install: total MH/kWp target');

    var res = _p3_result();
    // kWp 100, target 3 -> 300 MH. Labour (non-INDIRECT, mh>0) = 100+50 = 150.
    var out = applyTotalMhTarget(res, 100, 3);

    t.assert('applied scale',      2,   out.scale,    0.001);
    t.assert('beforeMH',           150, out.beforeMH, 0.001);
    t.assert('afterMH = target',   300, out.afterMH,  0.001);
    t.assertTrue('applied flag', out.applied === true);

    // Items scaled proportionally; labour cost recomputed at the role rate.
    t.assert('DC-01 mh x2',  200, res.items[0].mhComputed, 0.001);
    t.assert('DC-01 labor',  20000, res.items[0].laborMxn, 0.001);
    t.assert('RK-01 mh x2',  100, res.items[1].mhComputed, 0.001);
    t.assert('RK-01 labor',  8000, res.items[1].laborMxn, 0.001);

    // Non-labour and INDIRECT are NOT scaled.
    t.assert('AC OTHER_FIXED mh untouched',  0,    res.items[2].mhComputed, 0.001);
    t.assert('AC OTHER_FIXED equip untouched', 5000, res.items[2].equipMxn, 0.001);
    t.assert('INDIRECT mh untouched',        20,   res.items[3].mhComputed, 0.001);

    // Proportion preserved: DC:RK was 100:50, still 200:100.
    t.assertTrue('proportion preserved',
      Math.abs(res.items[0].mhComputed / res.items[1].mhComputed - 2) < 0.001);
  }
});


// ----------------------------------------------------------------------------
// 2) Total MH target no-ops when there is no labour to scale
// ----------------------------------------------------------------------------
registerTest({
  id      : 'UNIT_PASS3_TOTAL_MH_TARGET_NOOP_WHEN_NO_LABOR',
  group   : 'regression',
  module  : 'calc/install',
  scenarios: [],
  tags    : ['regression', 'install', 'mh', 'pass3'],
  source  : 'tests_regression/Pass3InstallMhRegressionTests.gs',
  fn      : function (t) {
    t.suite('REGRESSION calc/install: total MH target no-op');

    var res = { items: [
      { item: { section: 'AC', id: 'AC-09', costType: 'OTHER_FIXED' },
        mhComputed: 0, roleRateVal: 0, laborMxn: 0, equipMxn: 5000, otherMxn: 0, totalMxn: 5000, formulaTrace: '' }
    ] };
    var out = applyTotalMhTarget(res, 100, 3);
    t.assertFalse('not applied (no labour)', out.applied);
    t.assert('equip untouched', 5000, res.items[0].equipMxn, 0.001);
  }
});


// ----------------------------------------------------------------------------
// 3) Auto-derive blank quantities from geometry; explicit values win
// ----------------------------------------------------------------------------
registerTest({
  id      : 'UNIT_PASS3_DERIVE_INSTALL_QUANTITIES',
  group   : 'regression',
  module  : 'calc/install',
  scenarios: [],
  tags    : ['regression', 'install', 'quantities', 'pass3'],
  source  : 'tests_regression/Pass3InstallMhRegressionTests.gs',
  fn      : function (t) {
    t.suite('REGRESSION calc/install: derive blank quantities');

    var geom = { panelQty: 960, dcConduitM: 100, acConduitM: 50, arrayLength: 62 };

    // Attached / rail structure: ~1 anchor per 2 modules.
    var att = deriveInstallQuantities({ anchorCount: 0, conduitM: 0, trayM: 0 },
      { panelQty: 960, structure: 'RAIL MOUNT', roofType: 'METAL',
        dcConduitM: 100, acConduitM: 50, arrayLength: 62 });
    t.assert('attached anchors (960/2)', 480, att.anchorCount, 0.001);
    t.assert('conduit = dc+ac',          150, att.conduitM,    0.001);
    t.assert('tray = arrayLength',        62, att.trayM,       0.001);
    t.assertTrue('anchors flagged derived', att.derived.anchorCount === true);

    // Ballasted structure (RM10 EVO): far fewer penetrations (~1 per 8).
    var bal = deriveInstallQuantities({ anchorCount: 0, conduitM: 0, trayM: 0 },
      { panelQty: 960, structure: 'RM10 EVO BALLAST', roofType: 'TPO',
        dcConduitM: 100, acConduitM: 50, arrayLength: 62 });
    t.assert('ballasted anchors (960/8)', 120, bal.anchorCount, 0.001);

    // Membrane roof alone (generic structure) also counts as ballasted.
    var tpo = deriveInstallQuantities({ anchorCount: 0, conduitM: 0, trayM: 0 },
      { panelQty: 800, structure: 'GENERIC', roofType: 'PVC MEMBRANE',
        dcConduitM: 0, acConduitM: 0, arrayLength: 0 });
    t.assert('membrane anchors (800/8)', 100, tpo.anchorCount, 0.001);

    // Explicit values always win and are not flagged as derived.
    var exp = deriveInstallQuantities({ anchorCount: 25, conduitM: 200, trayM: 30 },
      { panelQty: 960, structure: 'RAIL', roofType: 'METAL',
        dcConduitM: 100, acConduitM: 50, arrayLength: 62 });
    t.assert('explicit anchors kept', 25,  exp.anchorCount, 0.001);
    t.assert('explicit conduit kept', 200, exp.conduitM,    0.001);
    t.assert('explicit tray kept',    30,  exp.trayM,       0.001);
    t.assertFalse('explicit not flagged derived', !!exp.derived.anchorCount);

    // No modules -> no anchor derivation (stays 0).
    var none = deriveInstallQuantities({ anchorCount: 0, conduitM: 0, trayM: 0 },
      { panelQty: 0, structure: 'RAIL', roofType: 'METAL',
        dcConduitM: 0, acConduitM: 0, arrayLength: 0 });
    t.assert('no modules -> 0 anchors', 0, none.anchorCount, 0.001);
  }
});
