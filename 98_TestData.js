// =============================================================================
// ARGIA ENGINE -- File: 98_TestData.gs
// Test fixture: TESTPROJ-001 deterministic contract (spec v3).
//
// This is the "one JSON file" that holds both:
//   - The synthetic inputs (Part A of spec v3)
//   - The expected engine outputs  (Parts C1, C2, C3, C4 of spec v3)
//
// Edit this file only when spec v3 is explicitly updated. Do NOT edit expected
// values to make failing tests pass -- investigate the engine instead.
//
// Phase A (2026-04-28): legacy `general:` dict deleted. Every value it held
// duplicated a key in `project:` above. After INPUT_GENERAL was retired,
// keeping a redundant set of A1-coord writes was just a footgun.
//
// Lock-value rationale is documented inline beside each value.
// =============================================================================

var TESTPROJ_001 = {

  // ===========================================================================
  // Inputs -- what the test runner writes into the sheets before running engine
  // ===========================================================================
  inputs: {

    // INPUT_PROJECT (NEW canonical home, Track A Path C2, 2026-04-24)
    // Logical-key inputs consumed by readInputs() via readInput().
    project: {
      projectName:       'TESTPROJ-001',
      clientName:        'TEST CUSTOMER S.A. de C.V.',
      contact:           'Test Engineer',
      street:            'Av. Pruebas 100',
      city:              'Mexico City',
      // state / bizManager / designer / businessType: omitted from fixture.
      // These are dropdowns with validation ranges that may not exist in a
      // freshly-created test tab. readInputs falls back to '' / 'PPA_ROOF'.
      // No tests assert on their values.

      // Commercial fields preserved on INPUT_PROJECT for ProjectCard / RFQ /
      // future CFE-sim consumers. Engine math doesn't read these.
      ppaDiscountPct:    0.15,
      ppaIndexationPct:  0.05,
      projectNumber:     'ARG-TEST-001',
      marginPct:         0.15,
      paymentDays:       14,
    },

    // INPUT_DESIGN engine fields are NOT in a dedicated fixture dict.
    // They're in the `design:` dict below since INPUT_MAP points engine
    // DESIGN readers at the same logical keys writeInput uses.

    // INPUT_INSTALL (NEW -- Track A Path C2, 2026-04-24)
    // Logical-key inputs consumed by readInstallDrivers() via readInput().
    install: {
      crewSize:              6,
      workHeightM:           6,              // HEIGHT factor = LE_6M = 1.1
      anchorCount:           0,
      interconnectionPts:    1,
      trayM:                 0,
      conduitM:              0,
      accessDifficulty:      'EASY',         // ACCESS factor = 1.0
      siteHseClass:          'STANDARD',     // HSE factor = 1.2
      energizedTieIn:        'NO',           // TIE_IN factor = 1.0
      siteDistanceClass:     'LOCAL',        // DISTANCE factor = 1.0
      nightWorkRequired:     'NO',           // NIGHT factor = 1.0
      projectComplexity:     'LOW',          // COMPLEXITY factor = 1.0
      weatherProfile:        'DRY',          // WEATHER factor = 1.0
      contingencyPct:        0.05,
      insurancePct:          0.03,

      // -----------------------------------------------------------------------
      // Tier A hardening (2026-04-30): canonical rate fixtures.
      // Written to INPUT_INSTALL D36-D49 as project-level rate overrides via
      // writeInput(). The engine's ovr() helper (13_CalcInstallCost.gs ~L437)
      // treats any positive number on these cells as an override that wins
      // over the live 92M / 93M IMPORTRANGE mirrors.
      //
      // Why: the live mirror sheets pull from INSTALL_DB via IMPORTRANGE.
      // When someone tunes a rate in INSTALL_DB, every install-cost regression
      // baseline silently drifts. Writing canonical rates as overrides for
      // every test run decouples the install-cost math tests (Tier 3.5/3.5b)
      // from DB-level price tuning. Tests now lock the FORMULA, not the price.
      //
      // Source of truth: INSTALL_DB_2.xlsx tabs 92_INSTALL_ROLE_RATES and
      // 93_INSTALL_EQUIP_RATES, snapshotted 2026-04-30. If you legitimately
      // re-baseline rates upstream and want the regression set to follow,
      // update these constants here and re-capture the affected expected
      // values in `expected.install` below.
      //
      // Note: backup/restore in the test runner is full-sheet copyTo, so
      // these writes to D36-D49 are reverted at end-of-run -- user data on
      // INPUT_INSTALL is not clobbered. (See backupInputs in 99_TestRunner.)
      // -----------------------------------------------------------------------

      // ROLE rates (MXN per man-hour) -- INPUT_INSTALL D36-D43
      rateInstaller:           100,
      rateHelper:               80,
      rateElectrician:         100,
      rateElectricalEngineer:  250,
      rateProjectEngineer:     250,
      rateCommissioningTech:   180,
      rateHseCoordinator:      150,
      rateQaqcTech:            150,

      // EQUIPMENT rates (MXN per day) -- INPUT_INSTALL D44-D49
      rateScissorLift:        1800,
      rateBoomLift:           4200,
      rateForklift:           2200,
      rateCrane:              9500,
      rateGenericLift:        3500,
      rateScaffolding:        2500,

      // BENCHMARKS (MH per kWp) -- kept inside install fixture, drives Patch 2/3
      benchStructMhKwp:      0.30,
      benchModuleMhKwp:      0.20,
      benchDcElecMhKwp:      0.15,
      benchAcElecMhKwp:      0.12,
    },

    // INPUT_DESIGN — engine inputs via logical keys (Phase 2a, 2026-04-24)
    // Uses writeInput() under the hood — writes to coords specified in
    // INPUT_MAP.
    design: {
      // NOTE: kept as logical keys (not cell refs). writeTestInputs loops
      // through these and calls writeInput(key, value). Any range-mode
      // keys (helioscopeMonthly, panelsSecondary, invertersSecondary) pass
      // a 2D array as the value.

      // §01 AMBIENTE Y TECHO
      minTemp: -1,                 // -1 preserves baseline. 0 is also valid now (bug #1 fixed).
      maxTemp: 38,
      avgTemp: 25,
      roofClearanceMm: 90,         // drives roofAdder=22
      projectType: 'ROOF',
      roofType: 'KR18',
      structure: 'STRUCTURE KR18',

      // §02 PARÁMETROS ELÉCTRICOS
      dcVdropLimit: 0.015,
      acVdropLimit: 0.020,
      powerFactor: 0.90,
      tempCoeffVocOverride: '',    // blank -> use panel DB value

      // §03 DISTANCIAS
      distCabinet: 0,
      distInverter: 50,
      distAcProt: 15,
      distGrid: 50,
      groundingLen: 2500,

      // §04 GEOMETRÍA
      areaRequired: 0,
      availableSpace: 5000,
      aspectRatio: 1.5,
      invStations: 1,
      arrayBlocks: 1,
      rowPitch: 2.0,
      walkwayFactor: 1.20,
      dcSpareFactor: 1.20,
      acSpareFactor: 1.20,
      feederExtraM: 0,             // bug #1 fix: 0 now honored correctly
      stationCorridorM: 20,

      // §05 LAYOUT OVERRIDE — blank (auto-calc)
      layoutRows: '',
      layoutCols: '',
      layoutBlocks: '',

      // §06 BOM CONFIG
      supplyTransformer: 0,        // client supplies

      // §07 HELIOSCOPE — blank (no helioscope data in test fixture)
      helioscopeMonthly: [
        ['ENE', 0, 0, 0, 0, 0],
        ['FEB', 0, 0, 0, 0, 0],
        ['MAR', 0, 0, 0, 0, 0],
        ['ABR', 0, 0, 0, 0, 0],
        ['MAY', 0, 0, 0, 0, 0],
        ['JUN', 0, 0, 0, 0, 0],
        ['JUL', 0, 0, 0, 0, 0],
        ['AGO', 0, 0, 0, 0, 0],
        ['SEP', 0, 0, 0, 0, 0],
        ['OCT', 0, 0, 0, 0, 0],
        ['NOV', 0, 0, 0, 0, 0],
        ['DIC', 0, 0, 0, 0, 0]
      ],
      annualKwh: 0,

      // §08 EQUIPO — PANELES (primary)
      panelModel: 'LR5-72HTH 585M',
      panelQty: 720,
      panelPowerW: 585,
      // Secondary panels: empty 4x3 array (no secondary types in test)
      panelsSecondary: [
        ['', '', ''],
        ['', '', ''],
        ['', '', ''],
        ['', '', '']
      ],

      // §09 EQUIPO — INVERSORES (primary)
      inverterPrimaryModel: 'SUN2000-100KTL-M2',
      inverterPrimaryQty: 4,
      inverterPrimaryKw: 100,
      inverterPrimaryStrings: 40,
      // Secondary inverters: empty 4x4 array
      invertersSecondary: [
        ['', '', '', ''],
        ['', '', '', ''],
        ['', '', '', ''],
        ['', '', '', '']
      ],
      totalInverters: 4,
      totalStrings: 40,

      // §10 STRING CONFIG
      stringsTotal: 40,
      parallelStrings: 1,
      modsPerString: 18,
      optimizers: 0
    },
  },

  // ===========================================================================
  // Expected outputs -- what the engine MUST produce
  // All values traced from engine code; spec v3 Parts C1, C2, C3, C4.
  // ===========================================================================
  expected: {

    // -------- PART C1 -- DC calc --------
    dc: {
      // Panel base
      bifFactor       : 1.00,      // non-bifacial branch
      bifacial        : false,
      isc             : 14.27,
      isc125          : 17.8375,   // 14.27 x 1.25
      iDesignPerStr   : 22.2969,   // 14.27 x 1.5625 x 1.00  (tolerance 0.001)
      iDesign         : 22.2969,
      // Temperature
      roofAdder       : 22,        // @ 90 mm clearance
      ambientDC       : 60,        // 38 + 22
      ambientAvg      : 47,        // 25 + 22
      // Ampacity
      Ft_dc           : 0.71,      // @ 60 degC
      Fag_dc          : 1.00,      // 2 conductors <= 3
      ampReqDC        : 31.40,     // 22.2969 / (0.71 * 1.00)  (tolerance 0.05)
      conductorDC     : '10',      // ampacity 40 >= 31.40
      areaConDC       : 5.26,
      insAreaDC       : 15.7,
      // OCPD
      ocpdDC          : 25,        // nextBreaker(22.2969)
      moduleMaxFuse   : 20,        // DB default (PANEL_MAX_SERIES_FUSE_A missing)
      ocpdDCPass      : false,     // 25 > 20 -- spec-locked AUDIT-FLAG
      // EGC
      egcDC           : '10',      // getEgcSize(25)
      // Vdrop
      vString         : 795.78,    // 44.21 x 18  (tolerance 0.01)
      dcLength        : 70,        // 50 + 20
      vdropDC         : 0.01282,   // (tolerance 0.0005)
      vdropDCPass     : true,
      // Conduit
      totalDCCables   : 3,         // 1*2 + 1
      conduitDC       : '0.75',
      // Voc cold (DC-01)
      // At T_min = -1 °C:
      //   vocColdPerMod = 52.36 × (1 + (-0.0029) × (-1 - 25))
      //                 = 52.36 × (1 + 0.0754) = 52.36 × 1.0754 = 56.3097
      //   vocColdString = 56.3097 × 18 = 1013.574
      vocColdPerMod   : 56.31,     // (tolerance 0.01)
      vocColdString   : 1013.57,   // (tolerance 0.05)
      dc01Pass        : true,      // 1013.57 <= 1100
      // Vmp hot (DC-02)
      vmpHotPerMod    : 41.389,    // (tolerance 0.05)
      vmpHotString    : 745.01,    // (tolerance 0.05)
      dc02Pass        : true,      // 200 <= 745.01 <= 1000
    },

    // -------- PART C2 -- AC calc --------
    ac: {
      ambientAC       : 38,        // no roof adder for AC
      // Per-inverter
      iNomPerInv      : 120.28,    // 100000 / (sqrt3 * 480)  (tolerance 0.01)
      ocpdReqPerInv   : 150.35,    // (tolerance 0.01)
      ocpdPerInv      : 175,       // nextBreaker(150.35)
      ocpdPassPerInv  : true,
      Ft_ac           : 0.91,      // @ 38 degC
      Fag_ac          : 1.00,      // 3 conductors
      ampReqPerInv    : 132.18,    // (tolerance 0.05)
      conductorPerInv : '1',       // 1 AWG, ampacity 145
      egcPerInv       : '6',
      acLenInv        : 65,        // 50 + 15
      vdropACPerInv   : 0.01145,   // (tolerance 0.0005)
      vdropACPassPerInv: true,
      conduitPerInv   : '2.5',
      // Main feeder
      iTotalAC        : 481.1252,  // 4 x 120.2814  (tolerance 0.01)
      mainBreakerReq  : 601.41,    // (tolerance 0.01)
      mainBreaker     : 800,       // nextBreaker(601.41)
      parallelRuns    : 2,         // ceil(481.13 / 400)
      iPerRun         : 240.56,    // (tolerance 0.01)
      Ft_main         : 0.91,
      Fag_main        : 0.80,      // 6 conductors (3 * 2 runs)
      ampReqMain      : 330.44,    // (tolerance 0.05)
      condMain        : '350',
      egcMain         : '1/0',
      feederLen       : 65,        // 15 + 50 + 0
      vdropFeeder     : 0.00549,   // (tolerance 0.0005)
      vdropFeederPass : true,
      conduitMain     : '4',       // fallback (fill required > table max). Engine returns String(4.0) which JS stringifies as '4' not '4.0'.
      // Transformer
      apparentPower   : 444.44,    // 400 / 0.90  (tolerance 0.01)
      apparentWith20pct: 533.33,   // (tolerance 0.01)
      transformer     : 750,
      transformerPass : true,
    },

    // -------- PART C4 -- Install cost --------
    // LOCKED lines only; PROVISIONAL lines commented out until first validated run.
    installCost: {
      // Driver values (spec C4 table)
      MODULE_COUNT    : 720,
      STRING_COUNT    : 40,
      INVERTER_COUNT  : 4,
      DC_CABLE_M      : 6720,      // 40 strings x 2 x 70m x 1.20 spare
      AC_CABLE_M      : 234,       // feeder main only -- cross-check on first run
      CREW_DAYS       : 150,
      CREW_SIZE       : 6,
      // Locked labor lines (MXN)
      laborModules    : 32400,     // 720 x 45
      laborStrings    : 1400,      // 40 x 35
      laborInverters  : 3200,      // 4 x 800
      laborDcCable    : 168000,    // 6720 x 25
      laborAcCable    : 4212,      // 234 x 18
      laborHSE        : 22500,     // 150 x 150
      laborTotal      : 231712,
      // Equipment + other
      scissorLift     : 480000,    // 150 x 3200
      mobilization    : 30000,     // 1 x 30000
      ppeKits         : 33000,     // 6 x 5500
      directSubtotal  : 774712,
      // Indirect
      insurance       : 6951.36,   // 0.03 x 231712
      contingency     : 39083.17,  // 0.05 x (774712 + 6951.36)
      grandTotal      : 820746.53,
    },

    // -------- PART C3 -- Validation flags --------
    flags: {
      critical        : 0,
      major           : 0,
      warning         : 0,
      desFlag         : 1,         // AC-02 parallel-run grouping (expected constant)
      dataFlag        : 0,
      auditFlag       : 1,         // DC-11 ocpdDC > moduleMaxFuse (expected constant)
    },

    // -------- Writer outputs -- MDC sheet --------
    // Coordinates use MDC_ROW / MDC_COL constants from 00_Main.gs.
    // Engine writes to col C (VALUE) and col E (STATUS, post-Phase-A).
    mdcCellValues: [
      // { row: MDC_ROW.PROJECT, col: 'C', expect: 'TESTPROJ-001' },
      // Populated in test runner using MDC_ROW constants
    ],
  },

  // ===========================================================================
  // Tolerances -- for floating-point comparisons
  // ===========================================================================
  tolerance: {
    'default': 0.01,      // 2 decimal places — Tier 2 direct calc values
    'loose'  : 0.05,      // Tier 2 aggregated values that propagate small errors
    'vdrop'  : 0.0005,    // voltage drop ratios
    'mdc'    : 0.1,       // Tier 3 MDC cells — writer rounds voltages/currents to 1 decimal
    'exact'  : 0,         // integers, strings
  }
};


// =============================================================================
// SYNTHETIC FIXTURES — TESTPROJ_SYNTH_001 and TESTPROJ_PEAK_001
// Merged here 2026-05-19 (repo reset): formerly 98a_TestDat_SYNTH001.gs.
// =============================================================================

//
// Design contract (do not break):
//   - Round numbers only
//   - Identical values every month (annual = 12 × monthly)
//   - 30 days every month (synthetic)
//   - GDMTH Centro tariff, no DAP, no 2% BT
//   - PF ≥ 0.90 by construction (no penalty math)
// =============================================================================

var TESTPROJ_SYNTH_001 = {

  // ===========================================================================
  // METADATA — used by stampMeta() and assertions
  // ===========================================================================
  meta: {
    fixtureName: 'TESTPROJ-SYNTH-001',
    fixtureVersion: '1.0',
    locked: '2026-05-13',
    engineVersionAtLock: '2.0.0',
    dbVersionAtLock: '2026.05',
  },

  // ===========================================================================
  // INPUTS — what the test runner paints into the project sheets
  // ===========================================================================
  inputs: {

    // INPUT_PROJECT
    project: {
      projectName:    'TESTPROJ-SYNTH-001',
      clientName:     'SYNTHETIC TEST CLIENT',
      contact:        'Test Engineer',
      street:         'Av. Sintetica 100',
      city:           'Veracruz',
      ppaDiscountPct:   0.15,
      ppaIndexationPct: 0.05,
      projectNumber:  'ARG-SYNTH-001',
      marginPct:      0.15,
      paymentDays:    14,
    },

    // INPUT_CFE (writes directly to A1-refs — INPUT_CFE has formulas in
    // rows 21-37 that recalc when rows 10-17 are populated)
    cfe: {
      'C4':  'GDMTH',         // TARIFF CODE
      'C5':  'GOLFO CENTRO',  // TARIFF LOCATION
      'C6':  0,               // DAP
      'C7':  'NO',            // 2% BAJA TENSION
      // Monthly grid: rows 10-17, columns C(Jan)..N(Dec). Identical every month.
      // Columns C=Jan, D=Feb, E=Mar, F=Apr, G=May, H=Jun, I=Jul, J=Aug, K=Sep, L=Oct, M=Nov, N=Dec
      monthly: {
        kWhBase:       [10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000],
        kWhIntermedia: [20000, 20000, 20000, 20000, 20000, 20000, 20000, 20000, 20000, 20000, 20000, 20000],
        kWhPunta:      [ 5000,  5000,  5000,  5000,  5000,  5000,  5000,  5000,  5000,  5000,  5000,  5000],
        kWBase:        [   80,    80,    80,    80,    80,    80,    80,    80,    80,    80,    80,    80],
        kWIntermedia:  [  100,   100,   100,   100,   100,   100,   100,   100,   100,   100,   100,   100],
        kWPunta:       [   90,    90,    90,    90,    90,    90,    90,    90,    90,    90,    90,    90],
        kWMaxAnoMovil: [  100,   100,   100,   100,   100,   100,   100,   100,   100,   100,   100,   100],
        kVArh:         [12000, 12000, 12000, 12000, 12000, 12000, 12000, 12000, 12000, 12000, 12000, 12000],
      },
    },

    // INPUT_INSTALL — same as TESTPROJ_001 (Phase 0 doesn't change install logic)
    install: {
      crewSize:           6,
      workHeightM:        6,
      anchorCount:        0,
      interconnectionPts: 1,
      trayM:              0,
      conduitM:           0,
      accessDifficulty:   'EASY',
      siteHseClass:       'STANDARD',
      energizedTieIn:     'NO',
      siteDistanceClass:  'LOCAL',
      nightWorkRequired:  'NO',
      projectComplexity:  'LOW',
      weatherProfile:     'DRY',
      contingencyPct:     0.05,
      insurancePct:       0.03,
      benchStructMhKwp:   0.30,
      benchModuleMhKwp:   0.20,
      benchDcElecMhKwp:   0.15,
      benchAcElecMhKwp:   0.12,
    },

    // INPUT_GENERAL: deliberately omitted. As of v2.0.2 the legacy
    // INPUT_GENERAL tab is retired in favor of INPUT_PROJECT. All identity
    // and commercial fields are written via logical keys that INPUT_MAP
    // routes to INPUT_PROJECT (see fixture.inputs.project above).

    // INPUT_DESIGN — 200 kWdc / 200 kWac for round-number PV
    design: {
      minTemp: -1,
      maxTemp: 38,
      avgTemp: 25,
      roofClearanceMm: 90,
      projectType: 'ROOF',
      roofType: 'KR18',
      // Structure: must match a value in _DROPDOWNS!A2:A100. After the field
      // merge (product_id — name — sku format), the valid value is now:
      structure: 'S-5 — STRUCTURE KR18 — STR_008',
      dcVdropLimit: 0.015,
      acVdropLimit: 0.020,
      powerFactor: 0.90,
      tempCoeffVocOverride: '',
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
      rowPitch: 2.0,
      walkwayFactor: 1.20,
      dcSpareFactor: 1.20,
      acSpareFactor: 1.20,
      feederExtraM: 0,
      stationCorridorM: 20,
      layoutRows: '',
      layoutCols: '',
      layoutBlocks: '',
      supplyTransformer: 0,
      // Synthetic Helioscope: 25,000 kWh every month, 200 kWdc total
      helioscopeMonthly: [
        ['ENE', 25000, 0, 0, 0, 0],
        ['FEB', 25000, 0, 0, 0, 0],
        ['MAR', 25000, 0, 0, 0, 0],
        ['ABR', 25000, 0, 0, 0, 0],
        ['MAY', 25000, 0, 0, 0, 0],
        ['JUN', 25000, 0, 0, 0, 0],
        ['JUL', 25000, 0, 0, 0, 0],
        ['AGO', 25000, 0, 0, 0, 0],
        ['SEP', 25000, 0, 0, 0, 0],
        ['OCT', 25000, 0, 0, 0, 0],
        ['NOV', 25000, 0, 0, 0, 0],
        ['DIC', 25000, 0, 0, 0, 0],
      ],
      annualKwh: 300000,
      panelModel: 'LR5-72HTH 585M',
      panelQty: 342,            // 342 × 585 = 200,070 W ≈ 200 kWdc
      panelPowerW: 585,
      panelsSecondary: [['','',''],['','',''],['','',''],['','','']],
      inverterPrimaryModel: 'SUN2000-100KTL-M2',
      inverterPrimaryQty: 2,    // 2 × 100 kW = 200 kWac
      inverterPrimaryKw: 100,
      inverterPrimaryStrings: 20,
      invertersSecondary: [['','','',''],['','','',''],['','','',''],['','','','']],
      totalInverters: 2,
      totalStrings: 20,
      stringsTotal: 20,
      parallelStrings: 1,
    },
  },

  // ===========================================================================
  // EXPECTED OUTPUTS
  // ===========================================================================
  //
  // Two layers:
  //
  //   1) handDerived — explicitly hand-derivable from this fixture's inputs.
  //      These catch GROSS engine bugs (formula totally wrong).
  //      Tight tolerance (±1 MXN on a 120,000+ MXN bill).
  //
  //   2) snapshot — populated by running the engine ONCE on the fixture
  //      and locking the result. Catches REGRESSION (number was X, now Y).
  //      All snapshot values start as null and must be filled after first
  //      successful engine run (procedure documented with the snapshot block).
  // ===========================================================================
  expected: {

    // -------------------------------------------------------------------------
    // Layer 1 — hand-derived sanity checks (derivable from this fixture)
    // -------------------------------------------------------------------------
    handDerived: {
      // -------------------------------------------------------------------------
      // PHILOSOPHY (revised 2026-05-14 after first test run)
      //
      // Layer 1 only asserts things I can verify offline with confidence:
      //   - Formulas that compute one value from clear inputs (PF, demanda)
      //   - Order-of-magnitude sanity (bill is in the right ballpark)
      //
      // I deliberately do NOT assert precise CFE bill values here because:
      //   - INPUT_CFE rows 21-29 use array formulas evaluated by Google Sheets
      //   - The exact interaction with Cargo FP / IVA can shift by ~1-2% in
      //     ways that don't manifest in offline openpyxl reading
      //   - That precision belongs in the SNAPSHOT layer (Layer 2), which
      //     locks whatever the engine actually produces
      // -------------------------------------------------------------------------

      // PF check — engineered by choosing kVArh=12000:
      //   PF = 35000 / SQRT(35000² + 12000²) = 35000 / 37000 = 0.94595
      pfYearAverage: 0.946,

      // Demanda Facturable check (Jan):
      //   Engine formula: MAX(C15, 0.7*C16) = MAX(kW_punta, 0.7*kWMaxAnoMovil)
      //   = MAX(90, 0.7*100) = MAX(90, 70) = 90 kW
      demandaFacturableJan: 90,

      // Sanity range — bill should be in this band for SYNTH-001 inputs.
      // Catches gross failures (wrong tariff applied, missing IVA, etc.)
      // without locking us to a precise value that varies with array-formula
      // evaluation quirks. Snapshot layer locks the exact value later.
      janBillMin:  80000,
      janBillMax: 200000,
    },

    // Tolerances for handDerived
    tolerance: {
      pf: 0.001,
      demanda: 0.5,
    },

    // -------------------------------------------------------------------------
    // Layer 2 — locked snapshot (DB-independent via frozen tariffs)
    //
    // POLICY: assertions in this layer must be deterministic regardless of
    // when the test runs. CFE updates tariff prices in 20M_CFE_TARIFFS
    // every month, so locking live engine output would create false
    // regressions every month.
    //
    // Solution: the fixture stores a frozen tariff snapshot below. The
    // test computes the expected bill in pure JS via calcCfeBill() (see
    // 04a_CalcCfeBill.gs) using ONLY these frozen tariffs — never touching
    // 20M_CFE_TARIFFS. The engine's live output is read separately and
    // reported as INFO for awareness (DB drift signal), not assertion.
    //
    // What's locked in v2.0.4:
    //   - Frozen tariff prices for Jan-2026 GDMTH GOLFO CENTRO
    //   - calcCfeBill() output for SYNTH-001 January (one month)
    //   - 12-month annual sum using the SAME frozen tariffs (synthetic
    //     identity: 12 × Jan since SYNTH-001 has identical monthly inputs)
    //
    // What's NOT locked (intentionally):
    //   - Live engine output. Reported as INFO only.
    //   - PV / BESS fields. Locked in Phase 1+ as those calcs come online.
    //   - MDC / BOM / ProjectCard. Already covered by Tier 3 (TESTPROJ-001).
    // -------------------------------------------------------------------------
    snapshot: {

      // ----- FROZEN TARIFFS (Jan-2026 GDMTH GOLFO CENTRO) ---------------------
      // Source: 20M_CFE_TARIFFS rows 2-10 effective 2026-01-01, captured
      // 2026-05-14 from the reference ARGIA_ENGINE.xlsx. These values
      // NEVER change in this fixture. When CFE updates tariffs in the
      // live DB, the engine uses the new values; this snapshot continues
      // to use these frozen ones. To re-lock at newer rates, do so
      // explicitly with a CHANGELOG entry — never automatically.
      frozenTariffs: {
        capacidad:    392.20,   // MXN/kW-month
        distribucion: 124.41,   // MXN/kW-month
        transmision:  0.1801,   // MXN/kWh
        cenace:       0.0076,   // MXN/kWh
        energiaBase:  0.8066,   // MXN/kWh
        energiaInter: 1.4986,   // MXN/kWh
        energiaPunta: 1.7675,   // MXN/kWh
        scnmem:       0.0069,   // MXN/kWh
        suministro:   461.75,   // MXN/month (flat)
      },

      // ----- EXPECTED OUTPUTS FROM calcCfeBill() WITH FROZEN TARIFFS ----------
      // Independently verified on 2026-05-14: a Python port of calcCfeBill()
      // produces 116,760.5594 MXN for January, matching the live engine
      // output (with the same inputs) to within 0.0001 MXN.
      janBillFrozen:    116760.56,
      janBillFrozenTol: 0.10,

      // Annual = 12 × January with same frozen tariffs (valid because
      // SYNTH-001 has identical monthly inputs).
      annualBillFrozen:    1401126.71,
      annualBillFrozenTol: 1.20,

      // ----- LIVE-DB DRIFT SIGNAL (reported as INFO, not asserted) -----------
      // For reference: the live engine produced these values when the
      // baseline was locked. Future test runs will report current live
      // values alongside. A large gap = CFE has updated tariffs since
      // lock; consider re-locking with a CHANGELOG entry.
      janBillLiveAtLock:    116760.56,
      annualBillLiveAtLock: 1482870.79,

      // ----- LOCKED in Phase 1 (v2.1.0), SUPERSEDED in v2.1.4: PV scenarios -----
      // v2.1.0 used PROPORTIONAL cascade across all 3 periods.
      // v2.1.4 uses INTERMEDIA-ONLY cascade for SE/FN (PV produces during
      // intermedia hours). See CHANGELOG.
      // NM unchanged (still proportional).
      // All scenarios use SYNTH-001 base inputs + 25,000 kWh/month flat PV +
      // 70% self-consumption (NM forced to 100%) + frozen Jan-2026 GDMTH GOLFO
      // CENTRO tariffs. Computed by calcCfeBillWithPv() in 04a_CalcCfeBill.gs.
      // Verified by Python recompute on 2026-05-15.

      // FACTURACION_NETA, 70% self, 0.80 MXN/kWh export (intermedia-only)
      // v2.1.0 was 85,788.68 (proportional). v2.1.4 is 82,377.81.
      janBillFNFrozen:    82377.81,
      annualBillFNFrozen: 988533.67,
      janExportCreditFN:  6000.00,      // 7500 kWh × 0.80 (unchanged)

      // SIN_EXPORTACION, 70% self explicit (intermedia-only)
      // v2.1.0 was 91,788.68 (proportional). v2.1.4 is 88,377.81.
      janBillSEFrozen:    88377.81,
      annualBillSEFrozen: 1060533.67,

      // MEDICION_NETA, JS simple impl (100% self forced, proportional cascade
      // unchanged in v2.1.4).
      // NOTE: legacy engine in NM does period-shifting carry-over which the
      // JS simple impl does NOT replicate. Engine and JS will disagree in
      // this mode — known, documented disagreement. JS value locked anyway
      // so regression on the JS path is caught.
      janBillNMFrozen_jsSimple:    91523.63,
      annualBillNMFrozen_jsSimple: 1098283.58,

      // Common tolerance for all Phase 1 PV-mode assertions
      pvScenarioTol: 0.10,

      // ----- LOCKED in Phase 1+ (currently null = scheduled) ------------------
      annualBillPostPv:     null,   // requires live CFE_SIMULATION work in v2.1.1+
      annualEnergySavings:  null,   // requires live CFE_SIMULATION work in v2.1.1+

      // ----- INTENTIONALLY OUT OF SCOPE (false = will not be locked here) -----
      // Already regression-covered by Tier 3 (TESTPROJ-001). Duplicating
      // here would add noise.
      dcKw:                  false,
      acKw:                  false,
      dcAcRatio:             false,
      qtyModules:            false,
      qtyInverters:          false,
      iscDesignCurrent:      false,
      bomTotalCost:          false,
      projectCardSystemCost: false,
    },
  },

  // ===========================================================================
  // PHASE 1.2 — PF threshold parameter sweep
  //
  // Same base inputs as SYNTH-001 (no PV). Three scenarios, varying ONLY
  // the FP threshold per Acuerdo A/064/2018 + A/073/2023 + Código de Red:
  //   T=0.90: legacy threshold (demanda_contratada < 1000 kW)
  //   T=0.95: ≥1MW customers today (Culligan MAR26+ is in this regime)
  //   T=0.97: ≥1MW customers AFTER April 8, 2026
  //
  // SYNTH-001 has PF≈0.9459. At T=0.90 → bonus; at T=0.95/0.97 → penalty.
  // Locked Jan bills computed in Python and verified by JS unit test.
  // ===========================================================================
  fpThresholdScenarios: {
    T_090: {
      fpThreshold: 0.90,
      label: 'Legacy threshold (demanda_contratada < 1000 kW)',
      expected: { janBill: 116760.56, cargoFp: -1231.5954, annual: 1401126.71 },
    },
    T_095: {
      fpThreshold: 0.95,
      label: '≥1MW threshold today (Acuerdo A/073/2023)',
      expected: { janBill: 118491.75, cargoFp:   260.8084, annual: 1421900.97 },
    },
    T_097: {
      fpThreshold: 0.97,
      label: '≥1MW post-April-8-2026 (Código de Red RES/550/2021)',
      expected: { janBill: 119984.27, cargoFp:  1547.4633, annual: 1439811.21 },
    },
  },

  // ===========================================================================
  // PHASE 1 SCENARIOS — PV + interconnection variants
  //
  // All three share the same base inputs (consumption, demand, kVArh) and the
  // same PV system (25,000 kWh/month flat). They differ only in:
  //   - interconnectionMode
  //   - selfConsumptionPct (forced to 1.0 for NM by the JS impl)
  //   - exportPriceMxnPerKwh (only used by FACTURACION_NETA)
  //
  // Test code reads from inputs.cfe.monthly for kWh/kW data, then applies the
  // scenario's pv block to calcCfeBillWithPv().
  // ===========================================================================
  scenarios: {

    NM: {
      label: 'MEDICION_NETA (net metering, 100% self-consumption forced, proportional cascade)',
      pv: {
        monthlyKwh: 25000,
        interconnectionMode: 'MEDICION_NETA',
        // selfConsumptionPct: ignored in NM, forced to 1.0
        // exportPriceMxnPerKwh: ignored in NM
      },
      expected: {
        janBill:    91523.63,
        annualBill: 1098283.58,
      },
    },

    // ============================================================
    // v2.1.4 NOTE: FN/SE lock targets SUPERSEDED from v2.1.0.
    // v2.1.0 used PROPORTIONAL cascade across all 3 periods.
    // v2.1.4 uses INTERMEDIA-ONLY cascade (PV produces during intermedia
    // hours, so it physically displaces intermedia kWh, not a proportional
    // share of all periods).
    //
    // Numerical impact: bills are LOWER under v2.1.4 because intermedia
    // tariff (1.4986 MXN/kWh) > weighted average (1.1320 MXN/kWh).
    // Delta from v2.1.0: -$3,411/month for FN/SE at 70% self.
    // ============================================================

    FN: {
      label: 'FACTURACION_NETA (70% self, 0.80 MXN/kWh export, intermedia-only)',
      pv: {
        monthlyKwh: 25000,
        interconnectionMode: 'FACTURACION_NETA',
        exportPriceMxnPerKwh: 0.80,
        selfConsumptionPct: 0.70,
      },
      expected: {
        janBill:       82377.81,    // v2.1.4 NEW (was 85788.68 in v2.1.0)
        annualBill:    988533.67,   // v2.1.4 NEW (was 1029464.16 in v2.1.0)
        janCredit:     6000.00,     // 7500 kWh × 0.80 (unchanged)
        janSelfKwh:    17500,       // 25000 × 0.70 (unchanged)
        janExportKwh:  7500,        // unchanged
      },
    },

    FN_default: {
      label: 'FACTURACION_NETA with blank selfConsumptionPct (defaults to 70%)',
      pv: {
        monthlyKwh: 25000,
        interconnectionMode: 'FACTURACION_NETA',
        exportPriceMxnPerKwh: 0.80,
        // selfConsumptionPct intentionally OMITTED — should default to 0.70
      },
      expected: {
        janBill:    82377.81,   // same as explicit FN at 0.70
        annualBill: 988533.67,
        selfPctUsed: 0.70,      // verify the default kicked in
      },
    },

    SE: {
      label: 'SIN_EXPORTACION (70% self explicit, surplus lost, intermedia-only)',
      pv: {
        monthlyKwh: 25000,
        interconnectionMode: 'SIN_EXPORTACION',
        selfConsumptionPct: 0.70,
        // exportPriceMxnPerKwh: ignored in SE
      },
      expected: {
        janBill:       88377.81,    // v2.1.4 NEW (was 91788.68 in v2.1.0)
        annualBill:    1060533.67,  // v2.1.4 NEW
        janCredit:     0,
        janSelfKwh:    17500,
        janExportKwh:  7500,         // exists but uncompensated
      },
    },

    SE_default: {
      label: 'SIN_EXPORTACION with blank selfConsumptionPct (defaults to 100%)',
      pv: {
        monthlyKwh: 25000,
        interconnectionMode: 'SIN_EXPORTACION',
        // selfConsumptionPct intentionally OMITTED — should default to 1.00
      },
      expected: {
        janBill:     86080.88,   // lower than SE at 0.70 (more displacement)
        annualBill:  1032970.56,
        selfPctUsed: 1.00,        // verify the default kicked in
      },
    },
  },

  // ===========================================================================
  // PHASE 2 (v2.2.0) — BESS scenarios
  // ===========================================================================
  // SELF_CONSUMPTION_MAX only. Strategy assumes the battery captures PV that
  // would otherwise be exported (FN) or curtailed (SE), then discharges later.
  // PEAK_SHAVING and HYBRID strategies deferred to v2.3.0 pending 15-min data.
  // Lock targets computed via Python recompute, validated against JS.
  // ===========================================================================
  bessScenarios: {

    BESS_FN_70: {
      label: 'SELF_CONSUMPTION_MAX, 200 kWh battery, FN-mode PV at 70% self',
      pv: {
        monthlyKwh: 25000,
        interconnectionMode: 'FACTURACION_NETA',
        exportPriceMxnPerKwh: 0.80,
        selfConsumptionPct: 0.70,
      },
      bess: {
        strategy: 'SELF_CONSUMPTION_MAX',
        capacityKwh: 200,
        powerKw: 100,
        minSocPct: 0.10,
        maxSocPct: 0.90,
        rtePct: 0.90,
        cyclesPerDay: 1.0,
        degradationPct: 0.025,
        backupReservePct: 0.0,
        daysInMonth: 31,             // Jan
      },
      expected: {
        bessUsableCapacityKwh:           156.00,
        bessMonthlyThroughputKwh:       4352.40,
        pvExportedKwh:                  7500.00,
        pvCapturedByBessKwh:            4352.40,
        blendedAvoidedTariffMxnPerKwh:     3.336016,
        exportPriceMxnPerKwh:              0.80,
        valuePerCapturedKwh:               2.536016,
        // v2.3.0: double-rtePct bug fixed. capturedKwh already carries RTE via
        // throughput; the value calc must not re-apply it. Verified vs deployed
        // JS + Python recompute. Prior (buggy) value was 9933.98 (−11.1%).
        pvCaptureValueMxn:             11037.76,
        baselineBill:                 116760.56,
        billAfterPv:                   82377.81,
        billAfterPvAndBess:            71340.05,    // was 72443.83 pre-fix
        annualBillAfterPvAndBess:     858572.99,    // was 871569.06 pre-fix
      },
    },

    BESS_SE: {
      label: 'SELF_CONSUMPTION_MAX, 200 kWh battery, SE-mode PV (no export credit)',
      pv: {
        monthlyKwh: 25000,
        interconnectionMode: 'SIN_EXPORTACION',
        // selfConsumptionPct omitted → default 100% in SE
      },
      bess: {
        strategy: 'SELF_CONSUMPTION_MAX',
        capacityKwh: 200,
        powerKw: 100,
        minSocPct: 0.10,
        maxSocPct: 0.90,
        rtePct: 0.90,
        cyclesPerDay: 1.0,
        degradationPct: 0.025,
        backupReservePct: 0.0,
        daysInMonth: 31,
      },
      expected: {
        // With self_pct=1.0 in SE, PV exported = 25000-20000 = 5000 (capped at intermedia)
        // NOT 7500 like the FN case. So captured = min(5000, 4352.4) = 4352.4
        // value_per = blended_avoided_tariff - 0 (no export price) = 3.336016
        // v2.3.0: double-rtePct fixed → savings = 4352.4 × 3.336016 = 14519.68
        // (prior buggy value 13067.71 applied × 0.9 a second time, −11.1%).
        pvCapturedByBessKwh:            4352.40,
        pvCaptureValueMxn:             14519.68,
        billAfterPv:                   86080.88,    // SE_default lock (unchanged)
        billAfterPvAndBess:            71561.20,    // was 73013.17 pre-fix
      },
    },

    BESS_NM: {
      label: 'SELF_CONSUMPTION_MAX with NM mode (no exported energy → 0 savings)',
      pv: {
        monthlyKwh: 25000,
        interconnectionMode: 'MEDICION_NETA',
      },
      bess: {
        strategy: 'SELF_CONSUMPTION_MAX',
        capacityKwh: 200,
        powerKw: 100,
        minSocPct: 0.10,
        maxSocPct: 0.90,
        rtePct: 0.90,
        cyclesPerDay: 1.0,
        degradationPct: 0.025,
        backupReservePct: 0.0,
        daysInMonth: 31,
      },
      expected: {
        pvExportedKwh:                     0.00,
        pvCapturedByBessKwh:               0.00,
        pvCaptureValueMxn:                 0.00,
        billAfterPv:                   91523.63,     // NM lock from Phase 1
        billAfterPvAndBess:            91523.63,     // unchanged: no BESS contribution
      },
    },

    BESS_NULL: {
      label: 'No BESS object (toggle=NO equivalent) — should return billAfterPv unchanged',
      pv: {
        monthlyKwh: 25000,
        interconnectionMode: 'FACTURACION_NETA',
        exportPriceMxnPerKwh: 0.80,
        selfConsumptionPct: 0.70,
      },
      bess: null,                    // ← key: no battery
      expected: {
        bessEnabled:                   false,
        bessUsableCapacityKwh:         0,
        pvCaptureValueMxn:             0,
        billAfterPv:                   82377.81,
        billAfterPvAndBess:            82377.81,    // unchanged
      },
    },

    BESS_ZERO_CAPACITY: {
      label: 'Zero-capacity battery (designer entered 0) — should return billAfterPv unchanged',
      pv: {
        monthlyKwh: 25000,
        interconnectionMode: 'FACTURACION_NETA',
        exportPriceMxnPerKwh: 0.80,
        selfConsumptionPct: 0.70,
      },
      bess: {
        strategy: 'SELF_CONSUMPTION_MAX',
        capacityKwh: 0,                // ← 0 capacity
        powerKw: 100,
        minSocPct: 0.10, maxSocPct: 0.90,
        rtePct: 0.90, cyclesPerDay: 1.0,
        degradationPct: 0.025, backupReservePct: 0.0,
        daysInMonth: 31,
      },
      expected: {
        bessEnabled:                   false,
        billAfterPvAndBess:            82377.81,    // unchanged
      },
    },
  },
};

// =============================================================================
// TESTPROJ_PEAK_001 — PEAK_SHAVING regression fixture (v2.3.0, Phase 3)
// =============================================================================
// SYNTH-001 cannot exercise PEAK_SHAVING: its kWMaxAnoMovil (100) and kWPunta
// (90) are too low for the 0.7×rolling-max ratchet floor to constrain, so
// Year-1 and steady-state would be identical and the ratchet would be untested.
//
// PEAK_001 is a deliberately industrial profile, with values anchored to the
// Autoplastek competitor proposals (Energía Real / ARBIA, 2026-03):
//   - punta demand ~320 kW (PUE deck shows ~319 kW avg punta)
//   - rolling max 340 kW, set CLOSE to punta so the ratchet bites
//   - intermedia 340 kW — equals the monthly max, so Distribución does NOT
//     move on a punta-only shave (verifiable distSaving = 0 — correct, not a bug)
//
// All lock targets verified by Python recompute (partB_recompute) AND by
// running the deployed calcPeakShavingImpact() in Node.
// =============================================================================
var TESTPROJ_PEAK_001 = {
  meta: {
    fixtureName: 'TESTPROJ-PEAK-001',
    purpose: 'PEAK_SHAVING strategy regression (Capacidad + Distribución + Variable)',
    tariff: 'GDMTH',
  },

  // Frozen tariffs — identical to SYNTH-001 (GDMTH GOLFO CENTRO, Jan 2026).
  frozenTariffs: {
    capacidad:    392.20,
    distribucion: 124.41,
    transmision:  0.1801,
    cenace:       0.0076,
    energiaBase:  0.8066,
    energiaInter: 1.4986,
    energiaPunta: 1.7675,
    scnmem:       0.0069,
    suministro:   461.75,
  },

  // January monthly input (industrial profile). bajaTension2pct:false matches
  // the _p2_buildSynth001JanInputObject() convention (boolean, not 'NO' string).
  janInput: {
    kWhBase:       60000,
    kWhIntermedia: 120000,
    kWhPunta:      40000,
    kWBase:        280,
    kWIntermedia:  340,    // = monthly max → Distribución unaffected by punta shave
    kWPunta:       320,
    kWMaxAnoMovil: 340,    // close to punta → ratchet floor (0.7×340=238) bites
    kVArh:         90000,
    tarifa:          'GDMTH',
    dap:             0,
    bajaTension2pct: false,
  },

  // BESS config: 645 kWh nominal / 323 kW (Autoplastek PUE deck figures).
  // puntaWindowHours=4 → winter (Jan). loadFactorFC only used on synth path.
  bess: {
    strategy:         'PEAK_SHAVING',
    capacityKwh:      645,
    powerKw:          323,
    minSocPct:        0.08,
    maxSocPct:        0.92,
    rtePct:           0.90,
    cyclesPerDay:     1.0,
    degradationPct:   0.025,
    backupReservePct: 0.0,
    daysInMonth:      31,
    puntaWindowHours: 4,
    loadFactorFC:     0.57,
    dmaxPuntaOverride: null,
  },

  // Lock targets — normal run (kWPunta=320 present → measured provenance).
  expected: {
    baselineBill:              587527.29,
    demandProvenance:          'measured(INPUT_CFE)',
    usableKwh:                 528.255,  // 645×(0.92-0.08)×(1-0.025)×(1-0)
    shaveKw:                   132.06,   // min(323 power, 528.36/4 energy)
    dmaxPuntaUsed:             320.00,
    postBessPuntaKw:           187.94,
    // Year-1 — ratchet floor (0.7×340=238) still loaded; post-BESS punta 187.94
    // is below the floor, so demandaFacturable only drops 320→238.
    capacidadSavingYear1:      32160.40,
    distribucionSavingYear1:   0.00,     // intermedia is monthly max — correct
    verifiableSavingYear1:     32160.40,
    // Steady-state — rolling max decays to 187.94; demandaFacturable 320→187.94.
    capacidadSavingSteady:     51795.40,
    distribucionSavingSteady:  0.00,
    verifiableSavingSteady:    51795.40,
    ratchetDelta:              19635.00, // steady − year1
    // Tier 2 — Variable load-shift, ESTIMATED (always disclaimed).
    energyShiftedKwh:          14738.30, // min(40000 punta kWh, throughput)
    variableSavingEstimated:   14162.05,
    totalSavingYear1:          46322.45, // verifiable + variable
    estimatedTierDisclaimer:   true,
    synthesizedDemandDisclaimer: false,
  },

  // Synthesis last-resort scenario: kWPunta removed → engine must synthesize
  // and raise the loud disclaimer. Only the disclaimer flag is asserted here;
  // the synthesized peso value is intentionally NOT locked (it depends on F.C.,
  // an assumption, not measured data).
  synthScenario: {
    janInputNoDemand: null,  // built in 99f by cloning janInput with kWPunta:0
    expected: {
      demandProvenance:            'synthesized(no demand data)',
      synthesizedDemandDisclaimer: true,
    },
  },
};