// =============================================================================
// ARGIA TEST FRAMEWORK -- test/TestFixtures.gs
// -----------------------------------------------------------------------------
// PASS 15 ADDITION: Synthetic fixture builders for TESTPROJ-001.
//
// SCOPE
//   Three pure functions that synthesize input/panel/inverter-bank objects
//   matching TESTPROJ-001 spec. No sheet I/O -- callers can run them in
//   any context (headless tests, console verification, etc.).
//
// USED BY
//   Future Tier 2 migration (calcDC / calcAC / calcLayout end-to-end against
//   the same fixture without needing live sheet inputs). Also useful for any
//   debugging session where you want a known-good input object.
//
// COEXISTENCE WITH LEGACY
//   The legacy 99_TestRunner.gs defines buildTestInputs / buildTestPanel /
//   buildTestInverterBank at file scope. To avoid Apps Script flat-namespace
//   collisions, these new versions use DIFFERENT NAMES:
//     - Legacy: buildTestInputs       New: tdBuildTestInputs
//     - Legacy: buildTestPanel        New: tdBuildTestPanel
//     - Legacy: buildTestInverterBank New: tdBuildTestInverterBank
//   "td" = TestData prefix matches the pattern of setInputValue, etc.
//
//   Both can coexist until the legacy deletion pass; neither shadows the
//   other.
//
// SOURCE
//   Copied verbatim from 99_TestRunner.gs lines 932-1029 (buildTestInputs,
//   buildTestPanel, buildTestInverterBank). The data is the contract --
//   any change here must also be reflected in TESTPROJ_001.expected in
//   98_TestData.gs so the engine output still matches.
//
// PROVENANCE OF NUMBERS
//   Every field matches the TESTPROJ-001 spec. The minTemp -1 (not 0) value
//   is intentional: the engine has `|| -14` fallback that JavaScript treats
//   as falsy for 0, mis-firing the temperature default. See the comment in
//   98_TestData.gs for the same reasoning.
// =============================================================================


/**
 * Synthesize an `inp` object matching TESTPROJ-001 spec. No sheet read.
 * Useful for headless calc-pipeline tests that need a known fixture
 * without depending on live INPUT sheet state.
 *
 * @returns {Object} `inp` shape consumed by calcDC / calcAC / calcLayout
 */
function tdBuildTestInputs() {
  return {
    projectName: 'TESTPROJ-001',
    clientName: 'TEST CUSTOMER S.A. de C.V.',
    panelModel: 'LR5-72HTH 585M',
    panelQty: 720,
    panelPowerW: 585,
    inverterBank: [{
      label: 'INVERTER TYPE 1:',
      model: 'SUN2000-100KTL-M2',
      qty: 4, powerKw: 100,
      stringsAssigned: 40
    }],
    totalInverters: 4,
    totalStrings: 40,
    stringsTotal: 40,
    modsPerString: 18,
    parallelStrings: 1,
    // minTemp -1 (not 0) is INTENTIONAL: engine's `|| -14` fallback
    // treats 0 as falsy. See 98_TestData.gs for full reasoning.
    minTemp: -1,
    maxTemp: 38,
    avgTemp: 25,
    roofClearanceMm: 90,
    projectType: 'ROOF',
    supplyTransformer: 0,
    tempCoeffOverride: -0.0026,
    dcVdropLimit: 0.015,
    acVdropLimit: 0.020,
    powerFactor: 0.90,
    distCabinet: 0,
    distInverter: 50,
    distAcProt: 15,
    distGrid: 50,
    groundingLen: 2500,
    areaRequired: 0,
    availableSpace: 5000,
    aspectRatio: 1.5,
    invStations: 1,
    arrayBlocks: 1,
    layoutRows: 0, layoutCols: 0, layoutBlocks: 0,
    rowPitch: 2.0, walkwayFactor: 1.20,
    dcSpareFactor: 1.20, acSpareFactor: 1.20,
    feederExtraM: 0, stationCorridorM: 20,
    layoutMidDist: 0, layoutEndDist: 0,
    helio: [], annualProduction: 0,
    secondaryPanels: [],
    panelAreaM2: 2.583
  };
}


/**
 * Synthesize a `panel` object matching TESTPROJ-001's LONGI LR5-72HTH 585M.
 * Fields are header-keyed to match what lookupPanel() returns from the
 * 11M_PRODUCTS_PANELS mirror.
 *
 * @returns {Object} `panel` shape consumed by calcDC
 */
function tdBuildTestPanel() {
  return {
    'PROD_ID':         'PANEL_018',
    'PANEL_BRAND':     'LONGI SOLAR',
    'PANEL_MODEL':     'LR5-72HTH 585M',
    'PANEL_POWER_W':   585,
    'PANEL_VOC_V':     52.36,
    'PANEL_VMP_V':     44.21,
    'PANEL_ISC_A':     14.27,
    'PANEL_IMP_A':     13.24,
    'PANEL_TEMP_PMAX': -0.0029,
    'PANEL_BIFACIAL':  'NO',
    'PANEL_LENGTH':    2278,
    'PANEL_WIDTH':     1134,
    'PANEL_HEIGHT':    35,
    'PANEL_WEIGHT':    27.5
  };
}


/**
 * Synthesize an inverter-bank array matching TESTPROJ-001's 4-unit
 * HUAWEI SUN2000-100KTL-M2 setup. Field names MUST match buildInverterBank()
 * in 02_LoadDB.gs exactly -- getting them wrong = silent mismatch where
 * calc reads undefined and comparisons return false.
 *
 * @returns {Array<Object>} `invBank` array consumed by calcDC / calcAC
 */
function tdBuildTestInverterBank() {
  return [{
    id:       'INV_027',
    brand:    'HUAWEI',
    model:    'SUN2000-100KTL-M2',
    topology: 'STRING',
    mdcReady: 'VALID',
    qty: 4,
    stringsAssigned: 40,
    // AC electrical
    acKw:    100,
    voltage: 480,
    phase:   3,
    // DC voltage limits
    maxDcKw:  150,
    maxDcV:   1100,
    mpptVmin: 200,
    mpptVmax: 1000,
    startV:   200,
    // MPPT structure
    mpptCount:     10,
    inputsPerMppt: 2,
    totalDcInputs: 20,
    // Current limits
    iOpPerMppt: 30,
    iScPerMppt: 40,
    iPerInput:  20,
    iLegacy:    40,
    rsdCompatible: true,
    priceUsd: 4480
  }];
}
