// =============================================================================
// CULLIGAN_BASELINE -- fixture for the real CULLIGAN project run.
// -----------------------------------------------------------------------------
// Extracted from workbook ARGIA_ENGINE__39_.xlsx, engine v3.5.0, DB 2026.05,
// _META.calculated_at = 2026-05-26T18:53:42Z. The same workbook whose v2 sheets
// are locked by tests_regression/v2/CulliganBaselineV2Tests.gs.
//
// PROJECT SHAPE
//   1350 modules (LR7-72HVHF-640M, 640 Wp), 864 kWp DC
//   5 inverters (1x SUN2000-100KTL-M1 100 kW + 4x SUN2000-150K-MG0 150 kW)
//   700 kWac, PPA_ROOF, MONTERREY (NUEVOLEON), GDMTH tariff
//   BESS: 9x HW_LUNA_241_2S1 (2169 kWh / 972 kW), PEAK_SHAVING, DC_COUPLED
//
// USAGE
//   writeCulliganInputs(ss)  -- writes all sections to INPUT_PROJECT / INPUT_DESIGN
//   / INPUT_INSTALL / INPUT_BESS / INPUT_CFE. See test/TestSheetBackup.gs.
//
// BESS DC/AC bus voltage (§6 C44/C45) is read via the logical keys
// bessDcBusV / bessAcV. The earlier C18/C19 cell-coord drift was fixed
// 2026-06-10 (the dead C18/C19 map entries were removed).
// =============================================================================

var CULLIGAN_BASELINE = {

  inputs: {

    // ---------------- INPUT_PROJECT (logical keys) -----------------
    project: {
      projectName: 'CULLIGAN',
      clientName: 'CULLIGAN TEST',
      contact: 'Test Engineer',
      street: 'Av. Pruebas 100',
      city: 'MONTERREY',
      state: 'NUEVOLEON',
      clientRequirements: 'LOW ROI',
      projectNumber: 'ARG-TEST-001',
      bizManager: 'DANIEL MASCARENO',
      designer: 'EDUARDO FRAGA',
      projectManager: 'EDUARDO FRAGA',
      dateOffer: new Date(2026, 3, 23),
      dateSign: new Date(2026, 4, 5),
      dateFinishContract: new Date(2026, 8, 9),
      dateDelivery: new Date(2026, 5, 6),
      dateInstallStart: new Date(2026, 6, 7),
      dateInstallFinish: new Date(2026, 7, 8),
      businessType: 'PPA_ROOF',
      marginPct: 0.15,
      ppaDiscountPct: 0.15,
      ppaIndexationPct: 0.05,
      paymentTerms: 'DP',
      paymentDays: 14,
      systemCoveragePct: 0.25973733981949276,
      receivedBy: 'Eduardo Fraga',
      approvedBy: 'Vit Kovarik',
      costRangePanelsMin: 20,
      costRangePanelsMax: 200,
      costRangeInvertersMin: 5,
      costRangeInvertersMax: 80,
      costRangeStructureMin: 5,
      costRangeStructureMax: 80,
      costRangeElecDcMin: 0,
      costRangeElecDcMax: 200,
      costRangeElecAcMin: 0,
      costRangeElecAcMax: 200,
      costRangeMonitoringMin: 0,
      costRangeMonitoringMax: 30,
      costRangePermitsMin: 1,
      costRangePermitsMax: 20,
      costRangeInstallMin: 0,
      costRangeInstallMax: 130,
      costRangeTotalMin: 200,
      costRangeTotalMax: 700,
      installBattery: 'YES',
    },

    // ---------------- INPUT_DESIGN (logical keys + 12x6 range) -----------------
    design: {
      minTemp: -1,
      maxTemp: 38,
      avgTemp: 25,
      roofClearanceMm: 90,
      projectType: 'ROOF',
      roofType: 'KR18',
      structure: 'S-5 — STRUCTURE KR18 — STR_008',
      bessCoupling: 'DC_COUPLED',
      dcVdropLimit: 0.015,
      acVdropLimit: 0.02,
      powerFactor: 0.9,
      tempCoeffVocOverride: -0.0026,
      distCabinet: 0,
      distInverter: 50,
      distAcProt: 15,
      distGrid: 50,
      groundingLen: 2500,
      // Helioscope DC string-wire total (INPUT_DESIGN C30). Real CULLIGAN had a
      // Helioscope import; without it the engine falls back to the geometry
      // ESTIMATE (75 strings x 2 x ~115 m x 1.2 = 20792 m), which over-counts
      // dispersed layouts. 5820 x 1.05 waste = 6111 m = the locked baseline, and
      // the same value drives the HELIOSCOPE-AVG vdrop (5820/75 = 77.6 m) ->
      // 0.75% drop / 10 AWG. Restoring it fixes the entire DC->CAPEX->finance cascade.
      dcStringWireM: 5820,
      areaRequired: 3800,
      availableSpace: 5000,
      aspectRatio: 1.5,
      invStations: 1,
      arrayBlocks: 1,
      rowPitch: 0,
      walkwayFactor: 1.2,
      dcSpareFactor: 1.2,
      acSpareFactor: 1.2,
      feederExtraM: 0,
      stationCorridorM: 20,
      supplyTransformer: 0,
      panelModel: 'LR7-72HVHF-640M',
      panelQty: 1350,
      panelPowerW: 640,
      inverterPrimaryModel: 'SUN2000-100KTL-M1',
      inverterPrimaryQty: 1,
      inverterPrimaryKw: 100,
      inverterPrimaryStrings: 11,
      totalInverters: 5,
      totalStrings: 75,
      stringsTotal: 75,
      parallelStrings: 1,
      modsPerString: 18,
      optimizers: 0,

      // 12 months x 6 cols (label, ghi, poa, shaded, nameplateKwh, gridKwh)
      helioscopeMonthly: [
        ['ENE', 118.8, 122.1, 121.8, 92241.6, 82222.7],
        ['FEB', 137.5, 140.7, 140.7, 107033.6, 93177.3],
        ['MAR', 182.6, 185.6, 185.6, 142556, 122847.1],
        ['ABR', 182.5, 183.7, 183.7, 141458.6, 120671.6],
        ['MAY', 200.7, 201.9, 201.9, 155594.2, 132462.2],
        ['JUN', 206.2, 206.9, 206.9, 159760.5, 135126.3],
        ['JUL', 197.4, 198.5, 198.5, 152821.8, 129042.6],
        ['AGO', 202.2, 203.5, 203.5, 156388.8, 131732.5],
        ['SEP', 163.7, 165.5, 165.4, 127119, 108570.9],
        ['OCT', 151.4, 154.4, 154.4, 118040.2, 102535.1],
        ['NOV', 121.1, 125.2, 125.2, 94651.4, 83207.5],
        ['DIC', 116.5, 120, 119.9, 90137.3, 79771.5],
      ],

      // Secondary slots (4x3 panels, 4x4 inverters) -- mostly empty for CULLIGAN
      panelsSecondary: [
        ['', '', ''],
        ['', '', ''],
        ['', '', ''],
        ['', '', ''],
      ],
      invertersSecondary: [
        ['SUN2000-150K-MG0', 4, 150, 64],
        ['', '', '', ''],
        ['', '', '', ''],
        ['', '', '', ''],
      ],
    },

    // ---------------- INPUT_INSTALL (logical keys) -----------------
    install: {
      crewSize: 6,
      workHeightM: 6,
      anchorCount: 0,
      interconnectionPts: 1,
      trayM: 0,
      conduitM: 0,
      accessDifficulty: 'EASY',
      siteHseClass: 'STANDARD',
      energizedTieIn: 'NO',
      siteDistanceClass: 'LOCAL',
      nightWorkRequired: 'NO',
      projectComplexity: 'LOW',
      weatherProfile: 'DRY',
      contingencyPct: 0.05,
      insurancePct: 0.03,
      benchStructMhKwp: 0.3,
      benchModuleMhKwp: 0.2,
      benchDcElecMhKwp: 0.15,
      benchAcElecMhKwp: 0.12,
      bessBatteriesPerContainer: 16,
      bessRequiresFireSystem: 'NO',
      bessRequiresSpillContainment: 'YES',
      bessCommissioningDays: 2,
    },

    // ---------------- INPUT_BESS (mixed: logical keys for canon cells, _cell_ for §6) -----
    // INPUT_MAP covers C6-C39 via logical keys (most of §1-§5).
    // INPUT_BESS §6 voltages (C44/C45) now use logical keys (bessDcBusV/bessAcV).
    // The remaining §6 distance/config fields still use the _cell_<A1> convention:
    // writeCulliganInputs treats any key starting with '_cell_' as a direct cell
    // write to INPUT_BESS.
    bess: {
      // section 1-5 -- via writeInput()
      bessBatteryId: '9 × HW_LUNA_241_2S1 (2169 kWh, 972 kW)',
      bessStrategy: 'PEAK_SHAVING',
      bessCapacityKwh: 2169,
      bessPowerKw: 972,
      bessMinSocPct: 0.1,
      bessMaxSocPct: 0.9,
      bessRtePct: 0.9,
      bessCyclesPerDay: 1,
      bessDegradationPct: 0.025,
      bessBackupReservePct: 0,
      bessCapexMxn: 0,
      bessLoadFactorFC: 0.57,
      bessPuntaWindowSummerH: 2,
      bessPuntaWindowWinterH: 4,
      bessMinAnnualSavingMxn: 2000000,

      // §6 DC/AC bus voltage -- read via logical keys (cell-coord drift fixed
      // 2026-06-10). 864 = HW_LUNA_241_2S1 nominal; unifies the circuit,
      // voltage-drop and BOS calcs onto one DC voltage (previously circuit
      // used the DB nominal 864 while vdrop/BOS used a stray 800).
      bessDcBusV: 864,
      bessAcV: 480,

      // section 6+ -- direct cell writes (see writeCulliganInputs for handling)
      // NOTE (2026-06-10 capex unification): the old `_cell_C20: 28800000`
      // legacy CAPEX write was removed. Nothing ever read C20 -- the engine
      // reader is the INPUT_MAP cell bessCapexMxn (C22, written above as 0,
      // matching the pre-unification live state), and the catalog picker path
      // supplies capex in-memory. See _migrateLegacyCapexC20 in 21.
      _cell_C46: 25,
      _cell_C47: 50,
      _cell_C48: 'INTEMPERIE',
      _cell_C49: 1,
      _cell_C50: 'EXTERIOR',
      _cell_C51: 'VARILLA',
      _cell_C52: 15,
      _cell_C53: 250000,
    },

    // ---------------- INPUT_CFE (direct cells only) -----------------
    // No logical keys exist for INPUT_CFE; writeCulliganInputs writes via
    // direct cell coordinates on INPUT_CFE.
    cfe: {
      // Tariff metadata -- scalars
      tariffCode:       'GDMTH',        // C4
      tariffLocation:   'GOLFO NORTE',        // C5
      tariffDap:        0,        // C6
      bajaTension2pct:  'NO',        // C7
      serviceName:      'OASIS LATINOAMERICA S RL CV',        // F4
      serviceNumber:    414240911417,        // F5
      contractedDemand: 1620,        // F6

      // Monthly consumption -- 12-element arrays (cols C..N)
      kWhBase: [82421, 88036, 112992, 108353, 103743, 106055, 116676, 115306, 100156, 115671, 126167, 72225],  // row 10
      kWhIntermedia: [181165, 187441, 222654, 263546, 244770, 254972, 285348, 259932, 237587, 286174, 229271, 149080],  // row 11
      kWhPunta: [43956, 45183, 54473, 30896, 23283, 25815, 29270, 25327, 24040, 35036, 53453, 34970],  // row 12
      kWBase: [575, 636, 781, 764, 708, 692, 708, 673, 673, 687, 711, 549],  // row 13
      kWIntermedia: [691, 804, 856, 909, 790, 803, 823, 800, 813, 866, 865, 687],  // row 14
      kWPunta: [662, 785, 824, 792, 687, 715, 709, 690, 691, 827, 807, 644],  // row 15
      kWMaxAnoMovil: [691, 804, 856, 909, 790, 803, 823, 800, 813, 866, 865, 687],  // row 16
      kVArh: [160175, 164516, 211262, 224473, 178138, 185376, 211056, 205040, 176262, 219870, 203174, 129863],  // row 17

      // PV interconnection
      interconnectionMode:    'MEDICION_NETA',   // C41
      exportPriceMxnPerKwh:   0,   // C42
      selfConsumptionPct:     0.7,   // C43
      powerFactorThreshold:   0.9,   // C44
    },

  },  // end inputs

};  // end CULLIGAN_BASELINE
