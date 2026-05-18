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
// See TESTPROJ_001_SPEC_v3.md for the full rationale behind every value.
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
