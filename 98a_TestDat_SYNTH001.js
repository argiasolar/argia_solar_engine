// =============================================================================
// ARGIA ENGINE v2.1.0 -- File: 98a_TestData_SYNTH001.gs
// Synthetic regression fixture TESTPROJ-SYNTH-001.
//
// Sits ALONGSIDE the existing 98_TestData.gs (TESTPROJ_001) — does not replace
// it. Designers using the old fixture continue to work. New regression coverage
// is added on top.
//
// v2.1.0: added scenarios block for Phase 1 (interconnection modes + PV).
// v2.0.4: locked baseline with frozen Jan-2026 GDMTH GOLFO CENTRO tariffs.
//
// READ FIRST: FIXTURE_SPEC.md and PHASE_1_DESIGN.md
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
  //   1) handDerived — explicitly hand-derivable from FIXTURE_SPEC.md.
  //      These catch GROSS engine bugs (formula totally wrong).
  //      Tight tolerance (±1 MXN on a 120,000+ MXN bill).
  //
  //   2) snapshot — populated by running the engine ONCE on the fixture
  //      and locking the result. Catches REGRESSION (number was X, now Y).
  //      All snapshot values start as null and must be filled after first
  //      successful engine run (see procedure in FIXTURE_SPEC.md).
  // ===========================================================================
  expected: {

    // -------------------------------------------------------------------------
    // Layer 1 — hand-derived sanity checks (from FIXTURE_SPEC.md)
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
      // intermedia hours). See PHASE_1_4_DESIGN_v2.md Q1 + CHANGELOG.
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
      // this mode — documented in PHASE_1_DESIGN.md. JS value locked anyway
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
    // share of all periods). See PHASE_1_4_DESIGN_v2.md Q1.
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
  // See PHASE_2_DESIGN_v2.md for the math.
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
// running the deployed calcPeakShavingImpact() in Node. See PHASE_3_DESIGN.md.
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