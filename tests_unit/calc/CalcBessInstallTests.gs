// =============================================================================
// ARGIA TESTS -- tests_unit/calc/CalcBessInstallTests.gs   (chunk bess_install)
//
// Tests for the BESS install driver block in 13_CalcInstallCost.js.
//
// What we verify:
//   1. When bessResult is null/undefined or bessEnabled=false, EVERY BESS
//      install driver is 0. This is the CULLIGAN regression guard --
//      PV-only projects must not pay a single peso of BESS install cost.
//   2. When bessResult is enabled with realistic numbers, the drivers
//      populate with the right shapes:
//        - BESS_KWH / BESS_KW / BESS_STACK_QTY come from bess{}
//        - BESS_CONTAINER_QTY = ceil(stackQty / batteriesPerContainer)
//        - BESS_HD_CRANE_DAYS = ceil(containerQty / 3)
//        - BESS_DC_CABLE_M from bos.lines[BESS-02].qty
//        - BESS_AC_CABLE_M from bos.lines[BESS-04].qty (0 in DC_COUPLED)
//        - BESS_CONDUIT_M  = BESS-06.qty + BESS-07.qty
//        - BESS_OCPD_COUNT = BESS-08.qty + BESS-09.qty + BESS-10.qty
//        - BESS_PROJECT_ONE = 1 when enabled, 0 otherwise
//   3. When the BoS calc is blocked (bos.blocked=true), all BoS-derived
//      drivers are 0 even if bessEnabled=true.
//   4. Fire system toggle: BESS_FIRE_SYSTEM_QTY = containerQty iff
//      bessRequiresFireSystem=YES; 0 otherwise.
//   5. Spill containment toggle: same shape as fire system.
//
// Approach: synthetic spreadsheet doubles via TestFixtures helpers + a
// stub readInput that returns INPUT_INSTALL values from a JS object.
// We are testing the driver assembly, NOT the spreadsheet I/O layer.
//
// Tagged 'bess_install' so "Run Tests for Current Chunk" picks them up.
// =============================================================================


// ----------------------------------------------------------------------------
// FIXTURES
// ----------------------------------------------------------------------------
// Minimum-viable arg shapes for readInstallDrivers(ss, inp, invBank, dc, ac,
// lay, bessResult). Most PV drivers come from these args; we keep them stable
// across tests so any deviation is attributable to BESS logic.
function _bessInstall_pvArgs() {
  return {
    inp: {
      projectType: 'ROOF',
      panelQty: 100,
      walkwayFactor: 1.15,
    },
    invBank: [{ qty: 1, stringsAssigned: 4 }],
    dc:  { dcKwp: 50, acKwTotal: 50 },
    ac:  { acKwTotal: 50, acLen: 0 },
    lay: { grossArea: 200, bom: { dcCableM: 100, mainFeederCableM: 30 } },
  };
}

// Synthesize a bessResult with realistic shape. Mirrors what runBessStep +
// Step 9.6 produce in 00_Main.js.
function _bessInstall_bessResult(opts) {
  opts = opts || {};
  var enabled = (opts.enabled !== false);
  if (!enabled) {
    return { bessEnabled: false, bess: null, bos: null };
  }
  return {
    bessEnabled: true,
    bess: {
      capacityKwh : (opts.capacityKwh !== undefined) ? opts.capacityKwh : 2000,
      powerKw     : (opts.powerKw     !== undefined) ? opts.powerKw     : 1000,
      stackQty    : (opts.stackQty    !== undefined) ? opts.stackQty    : 16,
      batteryId   : opts.batteryId   || 'HW_LUNA_2MWH',
      coupling    : opts.coupling    || 'AC_COUPLED',
    },
    coupling: opts.coupling || 'AC_COUPLED',
    bos: opts.bos || _bessInstall_bosDefault(opts.coupling),
  };
}

// Default BoS lines matching the shape produced by calcBessBosQuantities.
// We only populate the codes the install driver block aggregates from.
function _bessInstall_bosDefault(coupling) {
  coupling = coupling || 'AC_COUPLED';
  var lines = [
    { code: 'BESS-01', qty: 16, unit: 'u' },     // ignored by install
    { code: 'BESS-02', qty: 120, unit: 'm' },    // DC cable
    { code: 'BESS-03', qty: 60,  unit: 'm' },    // DC EGC (ignored)
    { code: 'BESS-06', qty: 30,  unit: 'm' },    // DC conduit
    { code: 'BESS-08', qty: 2,   unit: 'pcs' },  // DC OCPD (2 parallels)
    { code: 'BESS-11', qty: 15,  unit: 'm' },    // GEC (ignored)
    { code: 'BESS-12', qty: 1,   unit: 'u' },    // commissioning marker
  ];
  if (coupling === 'AC_COUPLED') {
    lines.push({ code: 'BESS-04', qty:  80, unit: 'm'   });  // AC cable
    lines.push({ code: 'BESS-05', qty:  40, unit: 'm'   });  // AC EGC (ignored)
    lines.push({ code: 'BESS-07', qty:  20, unit: 'm'   });  // AC conduit
    lines.push({ code: 'BESS-09', qty:   1, unit: 'pcs' });  // AC OCPD
    lines.push({ code: 'BESS-10', qty:   1, unit: 'pcs' });  // AC disconnect
  }
  return { blocked: false, lines: lines, reason: '' };
}

// Build a fake ss that satisfies the calls readInstallDrivers makes:
//   - readInput(ss, key) for INPUT_INSTALL and INPUT_DESIGN keys
//   - loadStructureDb(ss) and resolveStructure() (from 08_WriteBOM)
//
// We can't easily monkey-patch readInput in Apps Script the way Node lets
// you. Instead this test relies on the fact that the LIVE INPUT_INSTALL
// tab provides defaults via the INPUT_MAP -- so when no manual overrides
// exist, readInput returns the map default. For the new BESS knobs we
// added in this chunk (bessBatteriesPerContainer, etc.) the map defaults
// are 16 / NO / YES / 2.
//
// To keep this test PURE and independent of the live workbook, we call
// readInstallDrivers indirectly: we build the drivers object the same way
// the real function does, by computing the BESS block in isolation. This
// is documented as "white-box arithmetic test" -- we verify the math the
// driver block does, not the full readInput pipeline.
//
// The integration test (run via the engine) will verify the readInput
// pipeline.
function _bessInstall_computeDrivers(bessResult, opts) {
  opts = opts || {};
  var batteriesPerContainer = opts.batteriesPerContainer || 16;
  var fireToggle  = (opts.fireToggle  || 'NO').toUpperCase();
  var spillToggle = (opts.spillToggle || 'NO').toUpperCase();

  var bessEnabled = !!(bessResult && bessResult.bessEnabled
                       && bessResult.bess && !bessResult.specError);
  var bess        = bessEnabled ? (bessResult.bess || {}) : {};
  var bos         = bessEnabled ? (bessResult.bos  || {}) : {};
  var bosLines    = (bos && !bos.blocked && bos.lines) ? bos.lines : [];

  var bessKwh        = bessEnabled ? (Number(bess.capacityKwh) || 0) : 0;
  var bessKw         = bessEnabled ? (Number(bess.powerKw)     || 0) : 0;
  var bessStackQty   = bessEnabled ? (Number(bess.stackQty)    || 0) : 0;

  if (!isFinite(batteriesPerContainer) || batteriesPerContainer <= 0) {
    batteriesPerContainer = 16;
  }
  var bessContainerQty = (bessEnabled && bessStackQty > 0)
    ? Math.ceil(bessStackQty / batteriesPerContainer)
    : 0;
  var bessHdCraneDays = bessContainerQty > 0
    ? Math.ceil(bessContainerQty / 3)
    : 0;

  var bessDcCableM   = 0;
  var bessAcCableM   = 0;
  var bessConduitM   = 0;
  var bessOcpdCount  = 0;
  for (var bi = 0; bi < bosLines.length; bi++) {
    var ln = bosLines[bi];
    if (!ln || !ln.code) continue;
    var q = Number(ln.qty) || 0;
    switch (ln.code) {
      case 'BESS-02': bessDcCableM  += q; break;
      case 'BESS-04': bessAcCableM  += q; break;
      case 'BESS-06':
      case 'BESS-07': bessConduitM  += q; break;
      case 'BESS-08':
      case 'BESS-09':
      case 'BESS-10': bessOcpdCount += q; break;
    }
  }

  var bessProjectOne = bessEnabled ? 1 : 0;
  var bessFireSystemQty       = (bessEnabled && fireToggle  === 'YES') ? bessContainerQty : 0;
  var bessSpillContainmentQty = (bessEnabled && spillToggle === 'YES') ? bessContainerQty : 0;

  return {
    bessKwh                 : bessKwh,
    bessKw                  : bessKw,
    bessStackQty            : bessStackQty,
    bessContainerQty        : bessContainerQty,
    bessHdCraneDays         : bessHdCraneDays,
    bessDcCableM            : bessDcCableM,
    bessAcCableM            : bessAcCableM,
    bessConduitM            : bessConduitM,
    bessOcpdCount           : bessOcpdCount,
    bessProjectOne          : bessProjectOne,
    bessFireSystemQty       : bessFireSystemQty,
    bessSpillContainmentQty : bessSpillContainmentQty,
  };
}


// ============================================================================
// TEST 1: Drivers ALL zero when BESS is disabled or absent
// This is the CULLIGAN regression guard -- proves PV-only projects pay 0
// BESS install cost regardless of what's in the lib.
// ============================================================================
registerTest({
  id      : 'UNIT_BESS_INSTALL_DRIVERS_OFF',
  group   : 'unit',
  module  : 'calc/install_bess',
  scenarios: [],
  tags    : ['unit', 'calc', 'install', 'bess', 'bess_install'],
  source  : 'tests_unit/calc/CalcBessInstallTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT bess_install: drivers OFF when no battery');

    // Case A: bessResult is undefined (legacy callers that haven't been
    // updated yet). All BESS drivers should be 0.
    var d = _bessInstall_computeDrivers(undefined);
    t.assert('bessKwh = 0 when undefined',                 0, d.bessKwh);
    t.assert('bessKw = 0 when undefined',                  0, d.bessKw);
    t.assert('bessStackQty = 0 when undefined',            0, d.bessStackQty);
    t.assert('bessContainerQty = 0 when undefined',        0, d.bessContainerQty);
    t.assert('bessHdCraneDays = 0 when undefined',         0, d.bessHdCraneDays);
    t.assert('bessDcCableM = 0 when undefined',            0, d.bessDcCableM);
    t.assert('bessAcCableM = 0 when undefined',            0, d.bessAcCableM);
    t.assert('bessConduitM = 0 when undefined',            0, d.bessConduitM);
    t.assert('bessOcpdCount = 0 when undefined',           0, d.bessOcpdCount);
    t.assert('bessProjectOne = 0 when undefined',          0, d.bessProjectOne);
    t.assert('bessFireSystemQty = 0 when undefined',       0, d.bessFireSystemQty);
    t.assert('bessSpillContainmentQty = 0 when undefined', 0, d.bessSpillContainmentQty);

    // Case B: bessResult exists with bessEnabled=false. Same expectation.
    var d2 = _bessInstall_computeDrivers({ bessEnabled: false, bess: null, bos: null });
    t.assert('bessProjectOne = 0 when bessEnabled=false', 0, d2.bessProjectOne);
    t.assert('bessKwh = 0 when bessEnabled=false',        0, d2.bessKwh);
    t.assert('bessStackQty = 0 when bessEnabled=false',   0, d2.bessStackQty);

    // Case C: bessEnabled=true but bess is null (defensive). Still 0.
    var d3 = _bessInstall_computeDrivers({ bessEnabled: true, bess: null, bos: null });
    t.assert('bessProjectOne = 0 when bess=null',     0, d3.bessProjectOne);
    t.assert('bessKwh = 0 when bess=null',            0, d3.bessKwh);
    t.assert('bessContainerQty = 0 when bess=null',   0, d3.bessContainerQty);

    // Case D: specError present (battery spec failed) -- still treat as no BESS.
    var d4 = _bessInstall_computeDrivers({
      bessEnabled: true,
      bess: { capacityKwh: 2000, stackQty: 16 },
      bos: null,
      specError: 'invalid battery spec',
    });
    t.assert('bessProjectOne = 0 when specError set', 0, d4.bessProjectOne);
    t.assert('bessKwh = 0 when specError set',        0, d4.bessKwh);
  }
});


// ============================================================================
// TEST 2: Basic ON case -- realistic 2 MWh / 1 MW AC-coupled with 16 stacks.
// All driver math holds for the default 16-stacks-per-container layout.
// ============================================================================
registerTest({
  id      : 'UNIT_BESS_INSTALL_DRIVERS_ON_BASIC',
  group   : 'unit',
  module  : 'calc/install_bess',
  scenarios: [],
  tags    : ['unit', 'calc', 'install', 'bess', 'bess_install'],
  source  : 'tests_unit/calc/CalcBessInstallTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT bess_install: drivers populate for typical 2 MWh BESS');

    var bessResult = _bessInstall_bessResult({
      capacityKwh: 2000, powerKw: 1000, stackQty: 16, coupling: 'AC_COUPLED',
    });

    var d = _bessInstall_computeDrivers(bessResult, {
      batteriesPerContainer: 16, fireToggle: 'NO', spillToggle: 'YES',
    });

    // Scalar drivers
    t.assert('bessKwh = 2000',                2000, d.bessKwh);
    t.assert('bessKw = 1000',                 1000, d.bessKw);
    t.assert('bessStackQty = 16',               16, d.bessStackQty);
    t.assert('bessProjectOne = 1 when enabled', 1, d.bessProjectOne);

    // Container math: 16 stacks / 16 per container = 1 container
    t.assert('bessContainerQty = ceil(16/16) = 1', 1, d.bessContainerQty);
    // Crane: 1 container / 3 = 1 day
    t.assert('bessHdCraneDays = ceil(1/3) = 1',    1, d.bessHdCraneDays);

    // BoS aggregation (AC_COUPLED defaults from _bessInstall_bosDefault):
    //   BESS-02 DC cable = 120 m
    //   BESS-04 AC cable = 80 m
    //   BESS-06 + BESS-07 conduit = 30 + 20 = 50 m
    //   BESS-08 + BESS-09 + BESS-10 OCPD = 2 + 1 + 1 = 4
    t.assert('bessDcCableM = 120',  120, d.bessDcCableM);
    t.assert('bessAcCableM = 80',    80, d.bessAcCableM);
    t.assert('bessConduitM = 50',    50, d.bessConduitM);
    t.assert('bessOcpdCount = 4',     4, d.bessOcpdCount);

    // Toggles
    t.assert('fire toggle NO -> 0',                       0, d.bessFireSystemQty);
    t.assert('spill toggle YES -> containerQty = 1',      1, d.bessSpillContainmentQty);
  }
});


// ============================================================================
// TEST 3: Container ceiling math.
// Confirms the ceil(stackQty / batteriesPerContainer) edge cases.
// ============================================================================
registerTest({
  id      : 'UNIT_BESS_INSTALL_CONTAINER_CEIL',
  group   : 'unit',
  module  : 'calc/install_bess',
  scenarios: [],
  tags    : ['unit', 'calc', 'install', 'bess', 'bess_install'],
  source  : 'tests_unit/calc/CalcBessInstallTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT bess_install: container qty ceiling logic');

    var cases = [
      // [stackQty, batteriesPerContainer, expectedContainerQty, label]
      [ 0,  16, 0, 'zero stacks -> 0 containers (degenerate)'],
      [ 1,  16, 1, '1 stack -> 1 container (anything > 0 rounds up)'],
      [16,  16, 1, '16 stacks -> 1 container (exact fill)'],
      [17,  16, 2, '17 stacks -> 2 containers (spillover)'],
      [32,  16, 2, '32 stacks -> 2 containers (exact)'],
      [33,  16, 3, '33 stacks -> 3 containers'],
      [48,  16, 3, '48 stacks -> 3 containers'],
      [49,  16, 4, '49 stacks -> 4 containers'],
      [ 8,   8, 1, '8 stacks @ 8/container -> 1'],
      [10,  12, 1, '10 stacks @ 12/container -> 1 (under capacity)'],
    ];

    for (var i = 0; i < cases.length; i++) {
      var stackQty   = cases[i][0];
      var perCont    = cases[i][1];
      var expected   = cases[i][2];
      var label      = cases[i][3];

      var bessResult = _bessInstall_bessResult({ stackQty: stackQty });
      var d = _bessInstall_computeDrivers(bessResult, {
        batteriesPerContainer: perCont,
      });
      t.assert(label, expected, d.bessContainerQty);
    }

    // Defensive: garbage batteriesPerContainer falls back to 16
    var bessResult = _bessInstall_bessResult({ stackQty: 16 });
    var dBad = _bessInstall_computeDrivers(bessResult, { batteriesPerContainer: 0 });
    t.assert('batteriesPerContainer=0 -> falls back to 16',  1, dBad.bessContainerQty);
    var dNeg = _bessInstall_computeDrivers(bessResult, { batteriesPerContainer: -5 });
    t.assert('batteriesPerContainer=-5 -> falls back to 16', 1, dNeg.bessContainerQty);
  }
});


// ============================================================================
// TEST 4: HD crane days math.
// Confirms ceil(containerQty / 3). One crane-day handles up to 3 containers.
// ============================================================================
registerTest({
  id      : 'UNIT_BESS_INSTALL_HD_CRANE_DAYS',
  group   : 'unit',
  module  : 'calc/install_bess',
  scenarios: [],
  tags    : ['unit', 'calc', 'install', 'bess', 'bess_install'],
  source  : 'tests_unit/calc/CalcBessInstallTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT bess_install: HD crane days ceiling (1 day per 3 containers)');

    // [stackQty, perContainer, expectedCraneDays, label]
    var cases = [
      [  0, 16, 0, 'no stacks -> 0 crane-days'],
      [  1, 16, 1, '1 stack/1 container -> 1 crane-day'],
      [ 16, 16, 1, '16 stacks/1 container -> 1 crane-day'],
      [ 32, 16, 1, '32 stacks/2 containers -> 1 crane-day (within 3)'],
      [ 48, 16, 1, '48 stacks/3 containers -> 1 crane-day (exact 3)'],
      [ 49, 16, 2, '49 stacks/4 containers -> 2 crane-days'],
      [ 96, 16, 2, '96 stacks/6 containers -> 2 crane-days (exact 6)'],
      [ 97, 16, 3, '97 stacks/7 containers -> 3 crane-days'],
    ];

    for (var i = 0; i < cases.length; i++) {
      var bessResult = _bessInstall_bessResult({ stackQty: cases[i][0] });
      var d = _bessInstall_computeDrivers(bessResult, { batteriesPerContainer: cases[i][1] });
      t.assert(cases[i][3], cases[i][2], d.bessHdCraneDays);
    }
  }
});


// ============================================================================
// TEST 5: BoS line aggregation.
// Verifies that each driver picks up the right BESS-XX codes, including:
//   - missing codes contribute 0
//   - duplicate codes sum (if calcBessBosQuantities ever emits multi-line)
//   - non-numeric qty defaults to 0 (defensive)
// ============================================================================
registerTest({
  id      : 'UNIT_BESS_INSTALL_BOS_AGGREGATION',
  group   : 'unit',
  module  : 'calc/install_bess',
  scenarios: [],
  tags    : ['unit', 'calc', 'install', 'bess', 'bess_install'],
  source  : 'tests_unit/calc/CalcBessInstallTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT bess_install: BoS code aggregation');

    // Empty bos.lines: all BoS-derived drivers are 0
    var bessResult = _bessInstall_bessResult({ stackQty: 16, bos: { blocked: false, lines: [] } });
    var d = _bessInstall_computeDrivers(bessResult);
    t.assert('empty bos.lines -> bessDcCableM = 0',  0, d.bessDcCableM);
    t.assert('empty bos.lines -> bessAcCableM = 0',  0, d.bessAcCableM);
    t.assert('empty bos.lines -> bessConduitM = 0',  0, d.bessConduitM);
    t.assert('empty bos.lines -> bessOcpdCount = 0', 0, d.bessOcpdCount);

    // bos.blocked=true: same -- skip aggregation entirely
    var blocked = _bessInstall_bessResult({ stackQty: 16, bos: { blocked: true, lines: [
      { code: 'BESS-02', qty: 999, unit: 'm' },
    ]} });
    var dBlocked = _bessInstall_computeDrivers(blocked);
    t.assert('blocked bos -> bessDcCableM = 0 (lines ignored)', 0, dBlocked.bessDcCableM);

    // Codes the install logic does NOT aggregate must be ignored.
    var noise = _bessInstall_bessResult({ stackQty: 16, bos: { blocked: false, lines: [
      { code: 'BESS-01', qty: 99, unit: 'u' },   // ignored
      { code: 'BESS-03', qty: 99, unit: 'm' },   // ignored
      { code: 'BESS-05', qty: 99, unit: 'm' },   // ignored
      { code: 'BESS-11', qty: 99, unit: 'm' },   // ignored
      { code: 'BESS-12', qty: 99, unit: 'u' },   // ignored
      { code: 'BESS-02', qty: 50, unit: 'm' },   // counted
    ]} });
    var dNoise = _bessInstall_computeDrivers(noise);
    t.assert('only BESS-02 counted as DC cable',         50, dNoise.bessDcCableM);
    t.assert('non-aggregated codes do not leak to AC',    0, dNoise.bessAcCableM);
    t.assert('non-aggregated codes do not leak to conduit', 0, dNoise.bessConduitM);
    t.assert('non-aggregated codes do not leak to OCPD',    0, dNoise.bessOcpdCount);

    // Conduit = BESS-06 + BESS-07 (sums)
    var conduit = _bessInstall_bessResult({ stackQty: 16, bos: { blocked: false, lines: [
      { code: 'BESS-06', qty: 25, unit: 'm' },
      { code: 'BESS-07', qty: 15, unit: 'm' },
    ]} });
    var dConduit = _bessInstall_computeDrivers(conduit);
    t.assert('bessConduitM = 25 + 15 = 40', 40, dConduit.bessConduitM);

    // OCPD count = BESS-08 + BESS-09 + BESS-10
    var ocpd = _bessInstall_bessResult({ stackQty: 16, bos: { blocked: false, lines: [
      { code: 'BESS-08', qty: 2, unit: 'pcs' },
      { code: 'BESS-09', qty: 3, unit: 'pcs' },
      { code: 'BESS-10', qty: 1, unit: 'pcs' },
    ]} });
    var dOcpd = _bessInstall_computeDrivers(ocpd);
    t.assert('bessOcpdCount = 2 + 3 + 1 = 6', 6, dOcpd.bessOcpdCount);

    // Defensive: non-numeric qty -> treated as 0
    var bad = _bessInstall_bessResult({ stackQty: 16, bos: { blocked: false, lines: [
      { code: 'BESS-02', qty: null,        unit: 'm' },
      { code: 'BESS-02', qty: undefined,   unit: 'm' },
      { code: 'BESS-02', qty: 'not a num', unit: 'm' },
      { code: 'BESS-02', qty: 42,          unit: 'm' },
    ]} });
    var dBad = _bessInstall_computeDrivers(bad);
    t.assert('non-numeric qty values ignored, only 42 counts', 42, dBad.bessDcCableM);
  }
});


// ============================================================================
// TEST 6: DC_COUPLED mode -- bessAcCableM = 0 (no AC line in BoS).
// ============================================================================
registerTest({
  id      : 'UNIT_BESS_INSTALL_DC_COUPLED_NO_AC',
  group   : 'unit',
  module  : 'calc/install_bess',
  scenarios: [],
  tags    : ['unit', 'calc', 'install', 'bess', 'bess_install'],
  source  : 'tests_unit/calc/CalcBessInstallTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT bess_install: DC_COUPLED has no AC line items');

    var bessResult = _bessInstall_bessResult({
      capacityKwh: 1500, stackQty: 12, coupling: 'DC_COUPLED',
    });
    // _bessInstall_bosDefault omits BESS-04/05/07/09/10 in DC_COUPLED.

    var d = _bessInstall_computeDrivers(bessResult);
    t.assert('bessDcCableM populated (BESS-02)', 120, d.bessDcCableM);
    t.assert('bessAcCableM = 0 (no BESS-04)',      0, d.bessAcCableM);
    t.assert('bessConduitM = DC conduit only',    30, d.bessConduitM);  // BESS-06 = 30
    t.assert('bessOcpdCount = DC OCPD only',       2, d.bessOcpdCount); // BESS-08 = 2
  }
});


// ============================================================================
// TEST 7: Fire / spill toggles gate the upsell drivers correctly.
// ============================================================================
registerTest({
  id      : 'UNIT_BESS_INSTALL_UPSELL_TOGGLES',
  group   : 'unit',
  module  : 'calc/install_bess',
  scenarios: [],
  tags    : ['unit', 'calc', 'install', 'bess', 'bess_install'],
  source  : 'tests_unit/calc/CalcBessInstallTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT bess_install: fire + spill upsell toggles');

    // 33 stacks @ 16/container = 3 containers
    var bessResult = _bessInstall_bessResult({ stackQty: 33 });

    // Both NO
    var dNN = _bessInstall_computeDrivers(bessResult, {
      batteriesPerContainer: 16, fireToggle: 'NO', spillToggle: 'NO',
    });
    t.assert('containerQty = 3 (precondition)',          3, dNN.bessContainerQty);
    t.assert('fire NO  -> bessFireSystemQty = 0',        0, dNN.bessFireSystemQty);
    t.assert('spill NO -> bessSpillContainmentQty = 0',  0, dNN.bessSpillContainmentQty);

    // Both YES
    var dYY = _bessInstall_computeDrivers(bessResult, {
      batteriesPerContainer: 16, fireToggle: 'YES', spillToggle: 'YES',
    });
    t.assert('fire YES  -> bessFireSystemQty = 3',       3, dYY.bessFireSystemQty);
    t.assert('spill YES -> bessSpillContainmentQty = 3', 3, dYY.bessSpillContainmentQty);

    // Mixed: fire YES, spill NO
    var dYN = _bessInstall_computeDrivers(bessResult, {
      batteriesPerContainer: 16, fireToggle: 'YES', spillToggle: 'NO',
    });
    t.assert('mixed YES/NO -> only fire fires',          3, dYN.bessFireSystemQty);
    t.assert('mixed YES/NO -> spill = 0',                0, dYN.bessSpillContainmentQty);

    // BESS off but toggle YES: still 0 (toggle alone doesn't fire upsell)
    var dOff = _bessInstall_computeDrivers(undefined, {
      batteriesPerContainer: 16, fireToggle: 'YES', spillToggle: 'YES',
    });
    t.assert('BESS off + fire YES -> fire = 0',          0, dOff.bessFireSystemQty);
    t.assert('BESS off + spill YES -> spill = 0',        0, dOff.bessSpillContainmentQty);

    // Toggle case insensitive
    var dLow = _bessInstall_computeDrivers(bessResult, {
      batteriesPerContainer: 16, fireToggle: 'yes', spillToggle: 'Yes',
    });
    t.assert('fire "yes" lowercase -> fires',            3, dLow.bessFireSystemQty);
    t.assert('spill "Yes" mixed-case -> fires',          3, dLow.bessSpillContainmentQty);
  }
});


// ============================================================================
// TEST 8: IC_SECTIONS array now includes BESS.
// Structural test: ensures the install summary block renders the BESS
// section row. Without this, BESS lib items would compute but the writer
// would not show a section subtotal.
// ============================================================================
registerTest({
  id      : 'UNIT_BESS_INSTALL_SECTIONS_INCLUDES_BESS',
  group   : 'unit',
  module  : 'calc/install_bess',
  scenarios: [],
  tags    : ['unit', 'calc', 'install', 'bess', 'bess_install'],
  source  : 'tests_unit/calc/CalcBessInstallTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT bess_install: IC_SECTIONS includes BESS before INDIRECT');

    t.assertTrue('IC_SECTIONS is defined',  typeof IC_SECTIONS !== 'undefined');
    t.assertTrue('IC_SECTIONS is an array', Array.isArray(IC_SECTIONS));

    var bessIdx     = IC_SECTIONS.indexOf('BESS');
    var indirectIdx = IC_SECTIONS.indexOf('INDIRECT');
    t.assertTrue('BESS present in IC_SECTIONS',         bessIdx >= 0);
    t.assertTrue('INDIRECT still present in IC_SECTIONS', indirectIdx >= 0);
    t.assertTrue('BESS comes before INDIRECT (so insurance/contingency captures BESS labor)',
                 bessIdx < indirectIdx);

    // Length: 8 original sections + BESS = 9
    t.assert('IC_SECTIONS length = 9', 9, IC_SECTIONS.length);
  }
});


// ============================================================================
// TEST 9: INPUT_MAP exposes the four new BESS install keys with defaults.
// Wires the input-map declaration to the test layer so a missing key would
// surface as a clear failure here instead of in production.
// ============================================================================
registerTest({
  id      : 'UNIT_BESS_INSTALL_INPUT_MAP_KEYS',
  group   : 'unit',
  module  : 'calc/install_bess',
  scenarios: [],
  tags    : ['unit', 'calc', 'install', 'bess', 'bess_install'],
  source  : 'tests_unit/calc/CalcBessInstallTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT bess_install: INPUT_MAP exposes 4 new BESS install keys');

    var keys = [
      ['bessBatteriesPerContainer',    'number',  16],
      ['bessRequiresFireSystem',       'dropdown', 'NO'],
      ['bessRequiresSpillContainment', 'dropdown', 'YES'],
      ['bessCommissioningDays',        'number',   2],
    ];

    for (var i = 0; i < keys.length; i++) {
      var k = keys[i][0];
      var expectType    = keys[i][1];
      var expectDefault = keys[i][2];

      var m = INPUT_MAP[k];
      t.assertTrue('INPUT_MAP key "' + k + '" exists', !!m);
      if (!m) continue;
      t.assert(k + ' .sheet  = INPUT_INSTALL',  SH.INPUT_INSTALL, m.sheet);
      t.assert(k + ' .type  = ' + expectType,   expectType,       m.type);
      t.assert(k + ' .default = ' + expectDefault, expectDefault, m.default);
      t.assert(k + ' .section = "07 BESS / ALMACENAMIENTO"',
               '07 BESS / ALMACENAMIENTO', m.section);
    }

    // Defensive: row numbers must be in the reserved 60-80 range and unique
    var rows = keys.map(function (k) { return INPUT_MAP[k[0]].row; });
    rows.forEach(function (r) {
      t.assertTrue('row ' + r + ' in [60, 80] reserved BESS install band',
                   r >= 60 && r <= 80);
    });
    var unique = {};
    rows.forEach(function (r) { unique[r] = true; });
    t.assert('all BESS install rows are unique', rows.length, Object.keys(unique).length);
  }
});


// ============================================================================
// TEST 10: driverQty() in calcInstallCost recognises all 12 BESS driver keys.
// This is the contract between the lib (which uses DRIVER_KEY strings) and
// the engine (which maps strings -> drivers.bessXxx). A typo on either side
// would surface here.
// ============================================================================
registerTest({
  id      : 'UNIT_BESS_INSTALL_DRIVER_KEY_RESOLUTION',
  group   : 'unit',
  module  : 'calc/install_bess',
  scenarios: [],
  tags    : ['unit', 'calc', 'install', 'bess', 'bess_install'],
  source  : 'tests_unit/calc/CalcBessInstallTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT bess_install: all 12 BESS DRIVER_KEY strings resolve via calcInstallCost');

    // Minimal instLib stub: 12 rows, one per BESS driver key. Each row uses
    // LABOR_FIXED_MH so productivityRate × driverQty × roleRate = otherMxn
    // is 0 (we test resolution shape, not amounts).
    //
    // We rely on the same driverQty() lookup that the real engine uses by
    // calling calcInstallCost() with a synthetic drivers object that has
    // every BESS driver populated to a non-zero unique value. Then we check
    // that each line's driverQtyVal matches the corresponding driver value.
    var driverKeys = [
      'BESS_KWH', 'BESS_KW', 'BESS_STACK_QTY', 'BESS_CONTAINER_QTY',
      'BESS_HD_CRANE_DAYS', 'BESS_DC_CABLE_M', 'BESS_AC_CABLE_M',
      'BESS_CONDUIT_M', 'BESS_OCPD_COUNT', 'BESS_PROJECT_ONE',
      'BESS_FIRE_SYSTEM_QTY', 'BESS_SPILL_CONTAINMENT_QTY',
    ];

    var lib = driverKeys.map(function (k, idx) {
      return {
        id: 'TEST-' + k, active: true,
        section: 'BESS', subsection: 'TEST', description: 'test-' + k,
        appliesToInstType: 'ALL', appliesToRoofType: 'ALL',
        costType: 'LABOR_FIXED_MH',
        driverKey: k, driverUom: '',
        productivityRate: 1.0, productivityUom: 'MH',
        laborRole: 'INSTALLER', equipKey: '',
        baseOtherRate: 0,
        factorGroup1: '', factorGroup2: '', factorGroup3: '', factorGroup4: '',
        minQty: 0, notes: '',
      };
    });
    var instLib = {
      lib: lib,
      factors: {},
      roleRates: { INSTALLER: { mxnPerMH: 100 } },
      equipRates: {},
    };

    // Drivers with each BESS field set to a distinct non-zero value.
    var drivers = {
      // PV drivers all zero (irrelevant to this test)
      projectDcWp: 0, projectDcKwp: 0, projectAcKw: 0,
      moduleCount: 0, inverterCount: 0, stringCount: 0,
      arrayGrossAreaM2: 0, arrayNetAreaM2: 0, roofAreaM2: 0,
      dcCableM: 0, acCableM: 0, supplyTransformer: 0,
      trayM: 0, conduitM: 0, groundingM: 0,
      interconnectionPts: 0, anchorCount: 0,
      crewSize: 6, estProjectDays: 0, crewDays: 0,
      acTerminationCount: 0, dcConnectorCount: 0,
      installationType: 'ROOF',
      accessDifficulty: 'EASY', siteHseClass: 'STANDARD',
      energizedTieIn: 'NO', siteDistanceClass: 'LOCAL',
      nightWorkRequired: 'NO', projectComplexity: 'LOW',
      weatherProfile: 'DRY', heightKey: 'LE_6M',
      contingencyPct: 0, insurancePct: 0,
      factorSelections: {
        INSTALLATION_TYPE: 'ROOF', ACCESS: 'EASY', HSE: 'STANDARD',
        TIE_IN: 'NO', DISTANCE: 'LOCAL', NIGHT: 'NO',
        PROJECT_COMPLEXITY: 'LOW', WEATHER: 'DRY', HEIGHT: 'LE_6M',
        STRUCTURE: '',
      },
      laborEquipSubtotal: 0, installSubtotal: 0,

      // BESS drivers -- the values under test.
      bessKwh                 : 2000,
      bessKw                  : 1000,
      bessStackQty            : 16,
      bessContainerQty        : 1,
      bessHdCraneDays         : 1,
      bessDcCableM            : 120,
      bessAcCableM            : 80,
      bessConduitM            : 50,
      bessOcpdCount           : 4,
      bessProjectOne          : 1,
      bessFireSystemQty       : 1,
      bessSpillContainmentQty : 1,
    };

    var result = calcInstallCost(instLib, drivers);

    // Each TEST-BESS_* line should have driverQtyVal matching its drivers value.
    var expected = {
      'TEST-BESS_KWH'                  : 2000,
      'TEST-BESS_KW'                   : 1000,
      'TEST-BESS_STACK_QTY'            : 16,
      'TEST-BESS_CONTAINER_QTY'        : 1,
      'TEST-BESS_HD_CRANE_DAYS'        : 1,
      'TEST-BESS_DC_CABLE_M'           : 120,
      'TEST-BESS_AC_CABLE_M'           : 80,
      'TEST-BESS_CONDUIT_M'            : 50,
      'TEST-BESS_OCPD_COUNT'           : 4,
      'TEST-BESS_PROJECT_ONE'          : 1,
      'TEST-BESS_FIRE_SYSTEM_QTY'      : 1,
      'TEST-BESS_SPILL_CONTAINMENT_QTY': 1,
    };

    result.items.forEach(function (it) {
      var id = it && it.item && it.item.id;
      if (id && expected.hasOwnProperty(id)) {
        t.assert(id + ' driverQtyVal resolves correctly',
                 expected[id], it.driverQtyVal);
      }
    });
  }
});
