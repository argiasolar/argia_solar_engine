// =============================================================================
// ARGIA ENGINE v7 -- File: 13_CalcInstallCost.gs
// Installation cost calculation driven by INSTALL_DB library.
//
// FLOW:
//   setupInstallInputsSection(ss)          -- one-time: adds rows to INPUT_DESIGN
//   readInstallDrivers(ss,inp,invBank,dc,ac,lay) -> drivers{}
//   loadInstallLib(ss)                     -> lib{}
//   calcInstallCost(lib, drivers)          -> result{}
//   writeInstallCost(ss, result, drivers)  -> INSTALLATION tab
//   writeInstallDriverMap(ss, drivers, result) -> 95_INSTALL_DRIVER_MAP tab
//
// ENTRY POINTS:
//   runInstallCostStandalone()  -- menu item (runs alone, reads from current sheets)
//   called from runArgiaEngine() step 12 (receives already-computed objects)
// =============================================================================

// ---------------------------------------------------------------------------
// SHEET NAME CONSTANTS (install-specific)
// ---------------------------------------------------------------------------
var SH_IC = {
  COST        : 'INSTALLATION',
  DRIVER_MAP  : '95_INSTALL_DRIVER_MAP',
  LIB         : '90M_INSTALL_LIB',
  FACTORS     : '91M_INSTALL_FACTORS',
  ROLE_RATES  : '92M_INSTALL_ROLE_RATES',
  EQUIP_RATES : '93M_INSTALL_EQUIP_RATES',
  BENCHMARKS  : '94M_INSTALL_BENCHMARKS',
};

// ---------------------------------------------------------------------------
// INSTALLATION SHEET LAYOUT (1-based GS columns/rows)
// ---------------------------------------------------------------------------

// Line-item block
var IC_LINE_HEADER_ROW = 40;   // header row (written by setupInstallInputsSection)
var IC_LINE_START_ROW  = 41;   // first data row
var IC_LINE_COLS = {
  SECTION   : 1,  // A
  SUBSECTION: 2,  // B
  ID        : 3,  // C
  DESC      : 4,  // D
  COST_TYPE : 5,  // E
  DRV_KEY   : 6,  // F
  DRV_QTY   : 7,  // G  ← ENGINE writes
  UNIT      : 8,  // H
  BASE_RATE : 9,  // I
  ROLE      : 10, // J
  ROLE_RATE : 11, // K  ← ENGINE writes
  EQUIP_KEY : 12, // L
  F1        : 13, // M  ← ENGINE writes
  F2        : 14, // N  ← ENGINE writes
  F3        : 15, // O  ← ENGINE writes
  F4        : 16, // P  ← ENGINE writes
  CF        : 17, // Q  ← ENGINE writes (combined factor)
  APPLIES   : 18, // R
  MIN_QTY   : 19, // S
  MH        : 20, // T  ← ENGINE writes
  LABOR_MXN : 21, // U  ← ENGINE writes
  EQ_DAYS   : 22, // V  ← ENGINE writes
  EQUIP_MXN : 23, // W  ← ENGINE writes
  OTHER_MXN : 24, // X  ← ENGINE writes
  TOTAL_MXN : 25, // Y  ← ENGINE writes
  FORMULA   : 26, // Z  ← ENGINE writes (human-readable calculation trace, like MDC)
  ACTIVE    : 27, // AA
  NOTES     : 28, // AB
};
var IC_LINE_TOTAL_COLS = 28;

// Summary block (cols F=6, G=7)
var IC_SUM_COL_LABEL = 6;  // F
var IC_SUM_COL_VAL   = 7;  // G
// SUMMARY block layout (col F=label, col G=value).
// Phase 2e fix: TOTAL_INSTALL was incorrectly labeled as row 8 — that row is
// actually the divider line (─────). Real grand total is at row 9.
var IC_SUM_ROWS = {
  TOTAL_LABOR  : 5,   // row 4 = SUMMARY header (static), data starts row 5
  TOTAL_EQUIP  : 6,
  TOTAL_OTHER  : 7,
  // row 8 = divider line ─────────, no value here
  GRAND_TOTAL  : 9,   // <-- the real installation total (was mis-named TOTAL_INSTALL=8)
  TOTAL_INSTALL: 9,   // alias for backward compat with any external readers
  PER_KWP      : 10,
  PER_WP       : 11,
  PER_M2       : 12,
};

// Section summary block (cols F-J, starting at row 15)
var IC_SEC_HDR_ROW  = 14;
var IC_SEC_START_ROW= 15;
var IC_SEC_COL = { SECTION: 6, LABOR: 7, EQUIP: 8, OTHER: 9, TOTAL: 10 };
var IC_SECTIONS = [
  'AC','DC','RACKING SYSTEM','CONNECTION','SAFETY','GENERAL SITE','EQUIPMENT','BESS','INDIRECT'
];

// Driver block (col A=key, col B=value, rows 4-33)
var IC_DRV_COL_KEY = 1;
var IC_DRV_COL_VAL = 2;
var IC_DRV_START   = 4;
var IC_DRV_END     = 35;

// ---------------------------------------------------------------------------
// INPUT_DESIGN INSTALLATION SECTION (col M=13, col L=12 for labels)
// ---------------------------------------------------------------------------
var ID_INST_ROW = {
  HEADER             : 45,  // section label in col L
  CREW_SIZE          : 46,
  EST_PROJECT_DAYS   : 47,
  WORK_HEIGHT_M      : 48,
  ANCHOR_COUNT       : 49,
  INTERCONNECTION_PTS: 50,
  TRAY_M             : 51,
  CONDUIT_M          : 52,
  ACCESS_DIFFICULTY  : 53,
  SITE_HSE_CLASS     : 54,
  ENERGIZED_TIE_IN   : 55,
  SITE_DISTANCE_CLASS: 56,
  NIGHT_WORK_REQUIRED: 57,
  PROJECT_COMPLEXITY : 58,
  WEATHER_PROFILE    : 59,
  CONTINGENCY_PCT    : 60,
  INSURANCE_PCT      : 61,
  // ── Rate overrides (rows 63-77) ──────────────────────────────────────────
  // Leave blank to use INSTALL_DB default. Enter value to override for THIS
  // project only. The engine reads these FIRST before the DB mirrors.
  // This is the only safe way to tune rates — editing the 9xM mirror sheets
  // directly gets silently overwritten by IMPORTRANGE on the next refresh.
  OVERRIDE_HEADER          : 63,
  OVR_INSTALLER            : 64,  // INSTALLER MXN/MH        default: 95
  OVR_HELPER               : 65,  // HELPER MXN/MH           default: 70
  OVR_ELECTRICIAN          : 66,  // ELECTRICIAN MXN/MH      default: 130
  OVR_ELECTRICAL_ENG       : 67,  // ELECTRICAL_ENGINEER /MH default: 220
  OVR_PROJECT_ENG          : 68,  // PROJECT_ENGINEER /MH    default: 210
  OVR_COMMISSIONING        : 69,  // COMMISSIONING_TECH /MH  default: 180
  OVR_HSE_COORD            : 70,  // HSE_COORDINATOR /MH     default: 150
  OVR_QAQC_TECH            : 71,  // QAQC_TECH /MH           default: 145
  OVR_SCISSOR_LIFT         : 72,  // SCISSOR_LIFT MXN/day    default: 1800
  OVR_BOOM_LIFT            : 73,  // BOOM_LIFT MXN/day       default: 4200
  OVR_FORKLIFT             : 74,  // FORKLIFT MXN/day        default: 2200
  OVR_CRANE                : 75,  // CRANE MXN/day           default: 9500
  OVR_GENERIC_LIFT         : 76,  // GENERIC_LIFT MXN/day    default: 3500
  OVR_SCAFFOLDING          : 77,  // SCAFFOLDING MXN/day     default: 2500
  // ── kWp productivity benchmarks (rows 79-83) ────────────────────────────
  // MH per kWp. When filled, engine scales the section labour MH to this target.
  // Item proportions are preserved; only the section total MH changes.
  // ── BOM config flags (rows 85-86) ──────────────────────────────────────
  SUPPLY_TRANSFORMER   : 85,  // 1=Argia supplies transformer (default), 0=client supplies
  // ─────────────────────────────────────────────────────────────────────────
  BENCH_HEADER         : 79,
  BENCH_STRUCT_MH_KWP  : 80,  // RACKING SYSTEM section   (benchmark 0.25-0.40)
  BENCH_MODULE_MH_KWP  : 81,  // DC-01 module install only (benchmark 0.15-0.25)
  BENCH_DC_ELEC_MH_KWP : 82,  // DC electrical items excl. DC-01 (0.10-0.20)
  BENCH_AC_ELEC_MH_KWP : 83,  // AC section total labour   (benchmark 0.08-0.15)
};
var ID_INST_COL_LABEL   = 12; // L
var ID_INST_COL_VALUE   = 13; // M  (same pattern as rest of INPUT_DESIGN)
var ID_INST_COL_DEFAULT = 14; // N

// ---------------------------------------------------------------------------
// DEPRECATED 2026-04-24 Phase 2a: setupInstallInputsSection
//
// Historically this function wrote install labels + default values into the
// legacy INPUT_DESIGN tab (cols L and M, rows 45-85). In the new architecture
// install inputs live on INPUT_INSTALL and are set up by setupInputInstall()
// in 02e_InputSetup.gs. Running the old writes would pollute the new layout.
//
// This stub is a no-op with a deprecation log. Safe to delete once no legacy
// callers remain.
// ---------------------------------------------------------------------------
function setupInstallInputsSection(ss) {
  engineLog(ss, 'InstallCost', 'INFO',
    'setupInstallInputsSection is deprecated (Phase 2a). Use setupInputInstall() instead. No-op.');
}

// ---------------------------------------------------------------------------
// READ INSTALL DRIVERS
// Combines auto-derived ENGINE values with manual INPUT_DESIGN inputs.
// bessResult (optional, 7th arg) feeds the BESS driver block. When BESS is
// disabled or bessResult is absent, every BESS_* driver returns 0 -- so
// the BESS lib rows produce zero cost and the install total is unchanged.
// ---------------------------------------------------------------------------
function readInstallDrivers(ss, inp, invBank, dc, ac, lay, bessResult) {
  // Migrated from legacy INPUT_DESIGN col M on 2026-04-24 (Track A Path C2, INSTALL tab).
  // All manual fields now come via readInput() from INPUT_INSTALL.
  // readInput() returns the map's default when cell is blank (never null/NaN),
  // so we don't need the legacy n()/s() helpers for these reads.

  var crewSize           = readInput(ss, 'crewSize');
  // estProjectDays REMOVED as user input (2026-04-27).
  // Derived in calcInstallCost() from productive labor MH:
  //   estProjectDays = max(1, ceil(productive_MH / crew / 8))
  // The schedule now follows actual work scope instead of an estimator guess.
  // crewDays = crewSize × estProjectDays is updated at the same time.
  var estProjectDays     = 0;   // placeholder; calcInstallCost overwrites
  var workHeightM        = readInput(ss, 'workHeightM');
  var anchorCount        = readInput(ss, 'anchorCount');
  var interconnectionPts = readInput(ss, 'interconnectionPts');
  var trayM              = readInput(ss, 'trayM');
  var conduitM           = readInput(ss, 'conduitM');

  // supplyTransformer lives on INPUT_DESIGN per INPUT_MAP (map key is on
  // DESIGN, not INSTALL, since it's a BOM-config flag not an install driver).
  // readInput returns the numeric value; apply the same !== 0 gate as before.
  var _xfmrRaw = readInput(ss, 'supplyTransformer');
  var supplyTransformer  = (parseFloat(_xfmrRaw) !== 0) ? 1 : 0;

  // Dropdown values: readInput returns the cell's raw string. We still
  // uppercase/trim for comparison safety (dropdowns enforce the allowed
  // set via data validation, but dropdownRange values or legacy data may
  // arrive lowercased).
  var accessDifficulty   = String(readInput(ss, 'accessDifficulty')   || 'MEDIUM').toUpperCase();
  var siteHseClass       = String(readInput(ss, 'siteHseClass')       || 'STANDARD').toUpperCase();
  var energizedTieIn     = String(readInput(ss, 'energizedTieIn')     || 'NO').toUpperCase();
  var siteDistanceClass  = String(readInput(ss, 'siteDistanceClass')  || 'LOCAL').toUpperCase();
  var nightWorkRequired  = String(readInput(ss, 'nightWorkRequired')  || 'NO').toUpperCase();
  var projectComplexity  = String(readInput(ss, 'projectComplexity')  || 'MEDIUM').toUpperCase();
  var weatherProfile     = String(readInput(ss, 'weatherProfile')     || 'DRY').toUpperCase();

  var contingencyPct     = readInput(ss, 'contingencyPct');
  var insurancePct       = readInput(ss, 'insurancePct');

  // --- Auto-derived from ENGINE outputs ---
  var inverterCount  = invBank.reduce(function(s, i) { return s + i.qty; }, 0);
  var totalStrings   = invBank.reduce(function(s, i) { return s + (i.stringsAssigned || 0); }, 0);
  // Fallback: if invBank.stringsAssigned wasn't populated, read the authoritative
  // totalStrings value from INPUT_DESIGN via readInput (new coord E63, key 'totalStrings').
  // Migrated from legacy D29 read 2026-04-24 Phase 2b audit.
  if (totalStrings === 0) {
    try { totalStrings = parseInt(readInput(ss, 'totalStrings')) || 0; }
    catch(e) {}
  }

  var installationType = String(inp.projectType || 'ROOF').trim().toUpperCase();

  // Derive HEIGHT factor key from work height
  var heightKey = workHeightM <= 3  ? 'LE_3M'
                : workHeightM <= 6  ? 'LE_6M'
                : workHeightM <= 10 ? 'LE_10M'
                : 'GT_10M';

  // AC cable total: feeder cable. Branch AC per inverter is handled by AC-05 (unit count).
  // If ac.acLen exists (per-inverter branch m), add it; otherwise feeder only.
  var acCableM = (lay.bom ? lay.bom.mainFeederCableM : 0) || 0;
  if (ac.acLen && ac.acLen > 0) {
    acCableM += ac.acLen * 3 * inverterCount * (inp.acSpareFactor || 1.2);
  }

  // ---- Resolve structure into STR_ID/brand/model (groundwork) ------------
  // The dropdown text "BRAND — MODEL — STR_ID" lives in INPUT_DESIGN!C15. We
  // resolve it to a concrete row here so install logic can reference STR_ID
  // directly (e.g. STR_001 → CARPORT productivity factors). No factor formula
  // currently uses these fields — they are exposed to drivers and the
  // driver-key map for future install-rules work.
  var structureDb   = loadStructureDb(ss);  // defined in 08_WriteBOM.gs
  var structureInfo = resolveStructure(structureDb, inp.structure || '');
  var structureStrId = structureInfo ? structureInfo.strId : '';
  var structureBrand = structureInfo ? structureInfo.brand : '';
  var structureModel = structureInfo ? structureInfo.model : '';

  // ---- BESS install drivers ------------------------------------------------
  // bessResult is the output of runBessStep + the BoS pass (Step 9.6 in
  // 00_Main.js). It carries:
  //   - bessResult.bessEnabled   : true iff INPUT_PROJECT.installBattery=YES
  //                                AND a battery spec resolved successfully
  //   - bessResult.bess          : { capacityKwh, powerKw, stackQty, ... }
  //   - bessResult.bos.lines[]   : array of { code, qty, unit, ... } from
  //                                calcBessBosQuantities; each line carries
  //                                BoS quantities (m of cable, m of conduit,
  //                                count of OCPD).
  //   - bessResult.bos.blocked   : true if BoS calc could not run (we then
  //                                emit zero BESS install drivers — same as
  //                                "no BESS" — so a half-configured project
  //                                doesn't bill phantom BESS install costs).
  //
  // When ANY of these guards fail, every BESS driver is 0. That is the
  // mechanism that protects the CULLIGAN regression baseline: CULLIGAN
  // has no battery, so bessEnabled is false, every BESS_* driver is 0,
  // every BESS-I-* lib row produces 0 cost, install total is unchanged.
  var bessEnabled = !!(bessResult && bessResult.bessEnabled
                       && bessResult.bess && !bessResult.specError);
  var bess        = bessEnabled ? (bessResult.bess || {}) : {};
  var bos         = bessEnabled ? (bessResult.bos  || {}) : {};
  var bosLines    = (bos && !bos.blocked && bos.lines) ? bos.lines : [];

  var bessKwh        = bessEnabled ? (Number(bess.capacityKwh) || 0) : 0;
  var bessKw         = bessEnabled ? (Number(bess.powerKw)     || 0) : 0;
  var bessStackQty   = bessEnabled ? (Number(bess.stackQty)    || 0) : 0;

  // BESS_CONTAINER_QTY = ceil(stackQty / batteriesPerContainer). When BESS
  // is enabled but stackQty is 0 (degenerate), we still emit 0 (no crane
  // needed). When BESS is enabled and stackQty > 0 we never emit 0
  // (Math.ceil of any positive value is >= 1).
  var batteriesPerContainer = parseFloat(readInput(ss, 'bessBatteriesPerContainer'));
  if (!isFinite(batteriesPerContainer) || batteriesPerContainer <= 0) {
    batteriesPerContainer = 16;  // safety net; matches the INPUT_MAP default
  }
  var bessContainerQty = (bessEnabled && bessStackQty > 0)
    ? Math.ceil(bessStackQty / batteriesPerContainer)
    : 0;

  // BESS_HD_CRANE_DAYS = ceil(containerQty / 3). One HD crane day handles
  // up to 3 container placements (realistic for a competent rigging crew
  // with mobilization already amortized).
  var bessHdCraneDays = bessContainerQty > 0
    ? Math.ceil(bessContainerQty / 3)
    : 0;

  // Aggregate BoS quantities by code into install drivers.
  //   BESS-02 -> DC cable meters
  //   BESS-04 -> AC cable meters (always 0 in DC_COUPLED)
  //   BESS-06 + BESS-07 -> total conduit meters (DC + AC)
  //   BESS-08 + BESS-09 + BESS-10 -> total OCPD/disconnect count
  // Other codes (BESS-01 battery, -03 DC EGC, -05 AC EGC, -11 GEC, -12
  // commissioning marker) are NOT aggregated into install drivers --
  // they belong to BOM not install.
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

  // Upsell toggles. When BESS is disabled or the toggle is NO, qty is 0
  // -- the BESS-I-18 / BESS-I-19 rows then produce 0 cost.
  var bessFireToggle        = String(readInput(ss, 'bessRequiresFireSystem')       || 'NO').toUpperCase();
  var bessSpillToggle       = String(readInput(ss, 'bessRequiresSpillContainment') || 'NO').toUpperCase();
  var bessFireSystemQty       = (bessEnabled && bessFireToggle  === 'YES') ? bessContainerQty : 0;
  var bessSpillContainmentQty = (bessEnabled && bessSpillToggle === 'YES') ? bessContainerQty : 0;

  var drivers = {
    // Project scale (auto)
    projectDcWp         : (dc.dcKwp || 0) * 1000,
    projectDcKwp        : dc.dcKwp  || 0,
    projectAcKw         : dc.acKwTotal || ac.acKwTotal || 0,
    moduleCount         : inp.panelQty  || 0,
    inverterCount       : inverterCount,
    stringCount         : totalStrings,
    arrayGrossAreaM2    : (lay.grossArea  || 0),
    arrayNetAreaM2      : (lay.grossArea  || 0) / (inp.walkwayFactor || 1.15),
    roofAreaM2          : (lay.grossArea  || 0), // same as gross for roof; user can override
    dcCableM            : (lay.bom ? lay.bom.dcCableM : 0) || 0,
    acCableM            : acCableM,
    trayM               : trayM,
    supplyTransformer   : supplyTransformer,
    conduitM            : conduitM,
    groundingM          : 0, // informational only; no lib item uses this driver
    interconnectionPts  : interconnectionPts,
    anchorCount         : anchorCount,
    acTerminationCount  : inverterCount * 3,   // 3 conductors per inverter
    dcConnectorCount    : totalStrings  * 2,   // 2 MC4 per string

    // Structure (groundwork — no factor formula uses these yet)
    structureStrId      : structureStrId,
    structureBrand      : structureBrand,
    structureModel      : structureModel,

    // Manual estimator inputs
    crewSize            : crewSize,
    estProjectDays      : estProjectDays,   // 0 here; overwritten by calcInstallCost
    workHeightM         : workHeightM,
    crewDays            : 0,                // 0 here; overwritten by calcInstallCost (= crewSize × derivedDays)

    // Factor selections (drive which multiplier is applied per group)
    installationType    : installationType,
    accessDifficulty    : accessDifficulty,
    siteHseClass        : siteHseClass,
    energizedTieIn      : energizedTieIn,
    siteDistanceClass   : siteDistanceClass,
    nightWorkRequired   : nightWorkRequired,
    projectComplexity   : projectComplexity,
    weatherProfile      : weatherProfile,
    heightKey           : heightKey,

    // Override percentages
    contingencyPct      : contingencyPct,
    insurancePct        : insurancePct,

    // Factor selection map (FACTOR_GROUP → selected key)
    factorSelections: {
      'INSTALLATION_TYPE' : installationType,
      'ACCESS'            : accessDifficulty,
      'HSE'               : siteHseClass,
      'TIE_IN'            : energizedTieIn,
      'DISTANCE'          : siteDistanceClass,
      'NIGHT'             : nightWorkRequired,
      'PROJECT_COMPLEXITY': projectComplexity,
      'WEATHER'           : weatherProfile,
      'HEIGHT'            : heightKey,
      // Groundwork: no factor row uses STRUCTURE yet, but it is exposed here
      // so future structure-aware install rules (e.g. STR_001 = CARPORT
      // productivity bonus) can match by STR_ID via the existing pipeline.
      'STRUCTURE'         : structureStrId,
    },

    // Subtotals populated during calc (for PERCENT_OF items)
    laborEquipSubtotal  : 0,
    installSubtotal     : 0,

    // -- BESS install drivers (zero when no battery, see comment above) -----
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

  return drivers;
}

// ---------------------------------------------------------------------------
// LOAD INSTALL LIB from mirror sheets
// ---------------------------------------------------------------------------
function loadInstallLib(ss) {
  // Helper to read a sheet into array-of-objects
  function readSheet(sheetName) {
    var sh = ss.getSheetByName(sheetName);
    if (!sh) {
      engineLog(ss, 'InstallCost', 'WARNING', sheetName + ' mirror not found. Run IMPORTRANGE sync.');
      return [];
    }
    var data = sh.getDataRange().getValues();
    if (data.length < 2) return [];
    var hdrs = data[0].map(function(h) { return String(h).trim(); });
    return data.slice(1).map(function(row) {
      var obj = {};
      hdrs.forEach(function(h, i) { obj[h] = row[i]; });
      return obj;
    });
  }

  // --- Library items ---
  var libRows = readSheet(SH_IC.LIB);
  var lib = libRows.filter(function(r) {
    return r['COST_ITEM_ID'] && String(r['ACTIVE']).toUpperCase() === 'YES';
  }).map(function(r) {
    return {
      id               : String(r['COST_ITEM_ID']).trim(),
      active           : true,
      section          : String(r['SECTION']                 || '').trim(),
      subsection       : String(r['SUBSECTION']              || '').trim(),
      description      : String(r['DESCRIPTION']             || '').trim(),
      appliesToInstType: String(r['APPLIES_TO_INSTALL_TYPE'] || 'ALL').trim().toUpperCase(),
      appliesToRoofType: String(r['APPLIES_TO_ROOF_TYPE']    || 'ALL').trim().toUpperCase(),
      costType         : String(r['COST_TYPE']               || '').trim(),
      driverKey        : String(r['DRIVER_KEY']              || '').trim(),
      driverUom        : String(r['DRIVER_UOM']              || '').trim(),
      productivityRate : parseFloat(r['PRODUCTIVITY_RATE'])  || 0,
      productivityUom  : String(r['PRODUCTIVITY_UOM']        || '').trim(),
      laborRole        : String(r['DEFAULT_LABOR_ROLE']      || '').trim(),
      equipKey         : String(r['DEFAULT_EQUIPMENT_KEY']   || '').trim(),
      baseOtherRate    : parseFloat(r['BASE_OTHER_RATE_MXN']) || 0,
      factorGroup1     : String(r['FACTOR_GROUP_1']          || '').trim(),
      factorGroup2     : String(r['FACTOR_GROUP_2']          || '').trim(),
      factorGroup3     : String(r['FACTOR_GROUP_3']          || '').trim(),
      factorGroup4     : String(r['FACTOR_GROUP_4']          || '').trim(),
      minQty           : parseFloat(r['MIN_QTY'])            || 0,
      notes            : String(r['DEFAULT_NOTES']           || '').trim(),
    };
  });

  // --- Factor multipliers: { GROUP: { KEY: value } } ---
  var factorRows = readSheet(SH_IC.FACTORS);
  var factors = {};
  factorRows.forEach(function(r) {
    var grp = String(r['FACTOR_GROUP'] || '').trim();
    var key = String(r['FACTOR_KEY']   || '').trim();
    var val = parseFloat(r['VALUE'])   || 1.0;
    if (!grp || !key) return;
    if (!factors[grp]) factors[grp] = {};
    factors[grp][key] = val;
  });
  // Also read PERCENT group
  var pctRows = factorRows.filter(function(r) {
    return String(r['FACTOR_GROUP']).trim() === 'PERCENT';
  });
  var defaultPcts = {};
  pctRows.forEach(function(r) {
    defaultPcts[String(r['FACTOR_KEY']).trim()] = parseFloat(r['VALUE']) || 0;
  });

  // --- Role rates: { ROLE_KEY: { mxnPerMH, mxnPerDay } } ---
  var roleRows = readSheet(SH_IC.ROLE_RATES);
  var roleRates = {};
  roleRows.forEach(function(r) {
    var key = String(r['ROLE_KEY'] || '').trim();
    if (!key) return;
    roleRates[key] = {
      mxnPerMH  : parseFloat(r['MXN_PER_MAN_HOUR']) || 0,
      mxnPerDay : parseFloat(r['MXN_PER_DAY'])      || 0,
    };
  });

  // --- Equipment rates: { EQUIP_KEY: { mxnPerDay } } ---
  var equipRows = readSheet(SH_IC.EQUIP_RATES);
  var equipRates = {};
  equipRows.forEach(function(r) {
    var key = String(r['EQUIPMENT_KEY'] || '').trim();
    if (!key) return;
    equipRates[key] = {
      mxnPerDay  : parseFloat(r['MXN_PER_DAY'])  || 0,
      mxnPerWeek : parseFloat(r['MXN_PER_WEEK']) || 0,
    };
  });

  // --- Project-level rate overrides from INPUT_INSTALL rows 36-49 ----------
  // These take precedence over DB mirror values.
  // Blank cells = use DB default. Numeric value = override for this project.
  // This is the ONLY safe way to tune rates per-project: editing the 9xM
  // mirror sheets directly is overwritten by IMPORTRANGE on the next refresh.
  try {
    // Migrated to readInput() 2026-04-24. The ovr() helper preserves
    // the legacy null-signal semantics: blank / 0 / NaN → null (use DB
    // default), positive number → use as override. readInput returns
    // the map's default ('' for rate fields) when blank, which parseFloat
    // converts to NaN — same effect as before.
    function ovr(key) {
      var v = readInput(ss, key);
      var n = parseFloat(v);
      return (n > 0) ? n : null;
    }
    // Role rate overrides (map ROLE_KEY → override MXN/MH)
    var roleOverrides = {
      'INSTALLER'          : ovr('rateInstaller'),
      'HELPER'             : ovr('rateHelper'),
      'ELECTRICIAN'        : ovr('rateElectrician'),
      'ELECTRICAL_ENGINEER': ovr('rateElectricalEngineer'),
      'PROJECT_ENGINEER'   : ovr('rateProjectEngineer'),
      'COMMISSIONING_TECH' : ovr('rateCommissioningTech'),
      'HSE_COORDINATOR'    : ovr('rateHseCoordinator'),
      'QAQC_TECH'          : ovr('rateQaqcTech'),
    };
    // Equipment rate overrides (map EQUIP_KEY → override MXN/day)
    var equipOverrides = {
      'SCISSOR_LIFT' : ovr('rateScissorLift'),
      'BOOM_LIFT'    : ovr('rateBoomLift'),
      'FORKLIFT'     : ovr('rateForklift'),
      'CRANE'        : ovr('rateCrane'),
      'GENERIC_LIFT' : ovr('rateGenericLift'),
      'SCAFFOLDING'  : ovr('rateScaffolding'),
    };
    // Apply: override wins if set, else keep DB value
    Object.keys(roleOverrides).forEach(function(key) {
      if (roleOverrides[key] !== null) {
        if (!roleRates[key]) roleRates[key] = {};
        roleRates[key].mxnPerMH = roleOverrides[key];
        engineLog(ss, 'InstallCost', 'INFO',
          'Rate override: ' + key + ' → ' + roleOverrides[key] + ' MXN/MH');
      }
    });
    Object.keys(equipOverrides).forEach(function(key) {
      if (equipOverrides[key] !== null) {
        if (!equipRates[key]) equipRates[key] = {};
        equipRates[key].mxnPerDay = equipOverrides[key];
        engineLog(ss, 'InstallCost', 'INFO',
          'Equip override: ' + key + ' → ' + equipOverrides[key] + ' MXN/day');
      }
    });
  } catch(ovrErr) {
    engineLog(ss, 'InstallCost', 'WARNING', 'Rate override read failed: ' + ovrErr.message);
  }

  return { lib: lib, factors: factors, roleRates: roleRates, equipRates: equipRates, defaultPcts: defaultPcts };
}

// ---------------------------------------------------------------------------
// CALCULATE INSTALL COST
// ---------------------------------------------------------------------------
function calcInstallCost(instLib, drivers) {

  var lib        = instLib.lib;
  var factors    = instLib.factors;
  var roleRates  = instLib.roleRates;
  var equipRates = instLib.equipRates;

  // -- Helper: get driver quantity by key -----------------------------------
  function driverQty(key) {
    var map = {
      'PROJECT_ONE'           : 1,
      'PROJECT_DC_WP'         : drivers.projectDcWp,
      'PROJECT_DC_KWP'        : drivers.projectDcKwp,
      'PROJECT_AC_KW'         : drivers.projectAcKw,
      'MODULE_COUNT'          : drivers.moduleCount,
      'INVERTER_COUNT'        : drivers.inverterCount,
      'STRING_COUNT'          : drivers.stringCount,
      'ARRAY_GROSS_AREA_M2'   : drivers.arrayGrossAreaM2,
      'ARRAY_NET_AREA_M2'     : drivers.arrayNetAreaM2,
      'ROOF_AREA_M2'          : drivers.roofAreaM2,
      'DC_CABLE_M'            : drivers.dcCableM,
      'AC_CABLE_M'            : drivers.acCableM,
      'SUPPLY_TRANSFORMER'     : drivers.supplyTransformer,
      'TRAY_M'                : drivers.trayM,
      'CONDUIT_M'             : drivers.conduitM,
      'GROUNDING_M'           : drivers.groundingM,
      'INTERCONNECTION_POINTS': drivers.interconnectionPts,
      'ANCHOR_COUNT'          : drivers.anchorCount,
      'CREW_SIZE'             : drivers.crewSize,
      'EST_PROJECT_DAYS'      : drivers.estProjectDays,
      'CREW_DAYS'             : drivers.crewDays,
      'AC_TERMINATION_COUNT'  : drivers.acTerminationCount,
      'DC_CONNECTOR_COUNT'    : drivers.dcConnectorCount,
      // These are resolved after first pass
      'LABOR_EQUIP_SUBTOTAL'  : drivers.laborEquipSubtotal,
      'INSTALL_SUBTOTAL'      : drivers.installSubtotal,

      // BESS install drivers (chunk bess_install). Zero when no battery,
      // see readInstallDrivers() for the gating mechanism.
      'BESS_KWH'                   : drivers.bessKwh,
      'BESS_KW'                    : drivers.bessKw,
      'BESS_STACK_QTY'             : drivers.bessStackQty,
      'BESS_CONTAINER_QTY'         : drivers.bessContainerQty,
      'BESS_HD_CRANE_DAYS'         : drivers.bessHdCraneDays,
      'BESS_DC_CABLE_M'            : drivers.bessDcCableM,
      'BESS_AC_CABLE_M'            : drivers.bessAcCableM,
      'BESS_CONDUIT_M'             : drivers.bessConduitM,
      'BESS_OCPD_COUNT'            : drivers.bessOcpdCount,
      'BESS_PROJECT_ONE'           : drivers.bessProjectOne,
      'BESS_FIRE_SYSTEM_QTY'       : drivers.bessFireSystemQty,
      'BESS_SPILL_CONTAINMENT_QTY' : drivers.bessSpillContainmentQty,
    };
    return parseFloat(map[key]) || 0;
  }

  // -- Helper: get combined factor for a lib item ---------------------------
  function combinedFactor(item) {
    var groups = [item.factorGroup1, item.factorGroup2, item.factorGroup3, item.factorGroup4];
    var combined = 1.0;
    var factorValues = [null, null, null, null];
    groups.forEach(function(grp, idx) {
      if (!grp) return;
      var selectedKey = drivers.factorSelections[grp] || '';
      var val = (factors[grp] && factors[grp][selectedKey]) ? factors[grp][selectedKey] : 1.0;
      combined *= val;
      factorValues[idx] = val;
    });
    return { combined: combined, values: factorValues };
  }

  // -- Helper: check APPLIES_TO_INSTALL_TYPE filter -------------------------
  function itemApplies(item) {
    var applies = item.appliesToInstType;
    if (applies === 'ALL') return true;
    var types = applies.split('|').map(function(t) { return t.trim(); });
    return types.indexOf(drivers.installationType) !== -1;
  }

  // -- Helper: get role rate (MXN/MH) ---------------------------------------
  function roleRate(roleKey) {
    return (roleKey && roleRates[roleKey]) ? roleRates[roleKey].mxnPerMH : 0;
  }

  // -- Helper: get equipment day rate (MXN/day) -----------------------------
  function equipRate(equipKey) {
    return (equipKey && equipRates[equipKey]) ? equipRates[equipKey].mxnPerDay : 0;
  }

  // -- Days-driven keys: items whose driver is ONE OF these are computed AFTER
  // -- estProjectDays is derived. Everything else feeds the productive_MH that
  // -- determines days. Single source of truth for the staged-pass logic.
  var DAY_DRIVEN_KEYS = ['EST_PROJECT_DAYS', 'CREW_DAYS'];
  function isDayDriven(item) {
    return DAY_DRIVEN_KEYS.indexOf(item.driverKey) !== -1;
  }

  // -- Per-item compute (extracted from the previous single-pass loop).
  // -- Reads the current `drivers` state for everything (including derived
  // -- estProjectDays/crewDays once they're set). Returns a fully-populated
  // -- result object but does NOT push to items[] or accumulate totals —
  // -- the caller does that, so we can stage compute → derive days → compute.
  function computeOneItem(item) {
    var ct = item.costType;
    var result = {
      item          : item,
      applies       : itemApplies(item),
      driverQtyVal  : driverQty(item.driverKey),
      roleRateVal   : roleRate(item.laborRole),
      equipRateVal  : equipRate(item.equipKey),
      factorResult  : combinedFactor(item),
      mhComputed    : 0,
      laborMxn      : 0,
      equipDays     : 0,
      equipMxn      : 0,
      otherMxn      : 0,
      totalMxn      : 0,
      formulaTrace  : '',
    };

    if (!result.applies) return result;

    var drv = result.driverQtyVal;
    var cf  = result.factorResult.combined;
    var rr  = result.roleRateVal;
    var er  = result.equipRateVal;
    var pr  = item.productivityRate;
    var bor = item.baseOtherRate;
    var mq  = item.minQty;

    if (ct === 'LABOR_PRODUCTIVITY') {
      // MH = (driver_qty / productivity_rate) × combined_factor
      // labor = MH × role_rate
      if (pr > 0 && drv > 0) {
        result.mhComputed = (drv / pr) * cf;
        result.laborMxn   = result.mhComputed * rr;
      }

    } else if (ct === 'LABOR_FIXED_MH') {
      // MIN_QTY semantics (two distinct cases):
      //
      // CASE A — 'Per-unit' drivers (INTERCONNECTION_POINTS, CREW_SIZE, EST_PROJECT_DAYS):
      //   MIN_QTY = MH per driver unit.
      //   MH = max(driver_qty, 1) × MIN_QTY × CF
      //   e.g. CN-01: 1 connection point × 12 MH/point = 12 MH total
      //   e.g. SF-03: 6 crew × 4 MH/person = 24 MH for induction
      //
      // CASE B — 'Scale indicator' drivers (PROJECT_DC_KWP, MODULE_COUNT, PROJECT_AC_KW …):
      //   MIN_QTY = FLAT total MH for the whole task regardless of project size.
      //   MH = MIN_QTY × CF  (driver is used only to confirm the task applies)
      //   e.g. DC-07: 12 fixed MH total for DC testing (not 12 MH × 877 kWp!)
      //   e.g. RK-07:  6 fixed MH total for racking QAQC
      //   Note: lib items with scale drivers typically say "Use formula in project"
      //         in DEFAULT_NOTES — MIN_QTY is the MINIMUM baseline to tune from.
      var LABOR_FIXED_PER_UNIT = [
        'INTERCONNECTION_POINTS', 'CREW_SIZE', 'EST_PROJECT_DAYS'
      ];
      var isPerUnitFM = LABOR_FIXED_PER_UNIT.indexOf(item.driverKey) !== -1;
      if (mq > 0) {
        var mhBase = isPerUnitFM ? Math.max(drv, 1) * mq : mq;
        result.mhComputed = mhBase * cf;
        result.laborMxn   = result.mhComputed * rr;
      }

    } else if (ct === 'OTHER_FIXED') {
      // BASE_OTHER_RATE semantics (two distinct cases):
      //
      // CASE A — 'Scale indicator' drivers (PROJECT_DC_KWP, PROJECT_AC_KW):
      //   BASE_RATE = FLAT total cost for the task.
      //   cost = BASE_RATE × 1 × CF   (driver is informational, not a multiplier)
      //   e.g. SF-05 SIGNAGE: $2,500 flat for the project (not $2,500 × 877 kWp!)
      //
      // CASE B — 'Count' drivers (PROJECT_ONE, INTERCONNECTION_POINTS, EST_PROJECT_DAYS …):
      //   BASE_RATE = cost per driver unit.
      //   cost = BASE_RATE × driver_qty × CF
      //   e.g. GN-03 SUPERVISION: $2,800/day × 10 days = $28,000
      var OTHER_FIXED_SCALE = ['PROJECT_DC_KWP', 'PROJECT_AC_KW'];
      var isScaleOF = OTHER_FIXED_SCALE.indexOf(item.driverKey) !== -1;
      var ofQty = isScaleOF ? 1 : Math.max(drv, mq > 0 ? mq : 1);
      result.otherMxn = bor * ofQty * cf;

    } else if (ct === 'OTHER_UNIT') {
      // cost = base_rate × driver_qty × combined_factor  (0 if driver = 0)
      if (drv > 0) {
        result.otherMxn = bor * drv * cf;
      }

    } else if (ct === 'EQUIPMENT_DAY') {
      // cost = equip_day_rate × driver_qty × combined_factor
      if (er > 0 && drv > 0) {
        result.equipDays = drv;
        result.equipMxn  = er * drv * cf;
      }

    } else if (ct === 'PERCENT_OF_LABOR_EQUIP' || ct === 'PERCENT_OF_SUBTOTAL') {
      // Resolved in PERCENT pass after subtotals are known
    }

    result.totalMxn = result.laborMxn + result.equipMxn + result.otherMxn;
    result.formulaTrace = _buildFormulaTrace(item, result, drivers);
    return result;
  }

  // -- Accumulator: pushes a result into items[] (or sets at index) and
  // -- updates section + grand totals. Skips INDIRECT (PERCENT items handled
  // -- in their own pass at the end). Returns the result.
  function accumulateResult(result) {
    if (result.item.section !== 'INDIRECT') {
      var sec = result.item.section;
      if (!sectionTotals[sec]) sectionTotals[sec] = { labor: 0, equip: 0, other: 0, total: 0 };
      sectionTotals[sec].labor += result.laborMxn;
      sectionTotals[sec].equip += result.equipMxn;
      sectionTotals[sec].other += result.otherMxn;
      sectionTotals[sec].total += result.totalMxn;

      grandLabor += result.laborMxn;
      grandEquip += result.equipMxn;
      grandOther += result.otherMxn;
      grandMH    += result.mhComputed;
    }
    return result;
  }

  // -- Setup: empty items[] (filled in lib order) + zeroed section/grand totals
  var items = new Array(lib.length);
  var sectionTotals = {};
  IC_SECTIONS.forEach(function(sec) {
    sectionTotals[sec] = { labor: 0, equip: 0, other: 0, total: 0 };
  });
  var grandLabor = 0, grandEquip = 0, grandOther = 0, grandMH = 0;

  // ── STAGE A: compute + accumulate every item whose driver is NOT day-driven.
  // This populates productive labor MH (the basis for the days estimate).
  // Day-driven items are placeholdered with a stub result so items[] stays in
  // lib order; their real values are filled in Stage C below.
  lib.forEach(function(item, idx) {
    if (isDayDriven(item)) {
      // stub — real compute happens after days is derived
      items[idx] = {
        item: item, applies: itemApplies(item),
        driverQtyVal: 0, roleRateVal: roleRate(item.laborRole),
        equipRateVal: equipRate(item.equipKey),
        factorResult: combinedFactor(item),
        mhComputed: 0, laborMxn: 0, equipDays: 0, equipMxn: 0,
        otherMxn: 0, totalMxn: 0, formulaTrace: '',
      };
      return;
    }
    items[idx] = accumulateResult(computeOneItem(item));
  });

  // ── STAGE B: derive estProjectDays from productive labor MH.
  // Formula:  days = max(1, ceil(productive_MH / max(crew, 1) / 8))
  // - max(crew, 1) guards crewSize=0 (shouldn't happen but defensive).
  // - max(1, ...) ensures any project that has lib items gets at least 1 day.
  // - 8 hours/day is the assumed shift length (matches industry std for solar PV).
  // Once days is set, every day-driven item below resolves deterministically.
  var productiveMH = grandMH;
  var derivedDays  = Math.max(1, Math.ceil(productiveMH / Math.max(drivers.crewSize, 1) / 8));
  drivers.estProjectDays = derivedDays;
  drivers.crewDays       = drivers.crewSize * derivedDays;
  // (note: caller logs derivation; ss is not in scope here)

  // ── STAGE C: compute + accumulate the day-driven items now that days is set.
  // Replaces the stubs from Stage A. Items go into items[] at the same index
  // so output order matches lib order exactly.
  lib.forEach(function(item, idx) {
    if (!isDayDriven(item)) return;
    items[idx] = accumulateResult(computeOneItem(item));
  });

  // -- SECOND PASS: PERCENT_OF items (IN-01 Insurance, IN-02 Contingency) --
  drivers.laborEquipSubtotal = grandLabor + grandEquip;
  drivers.installSubtotal    = grandLabor + grandEquip + grandOther;

  var indirectLabor = 0, indirectEquip = 0, indirectOther = 0;

  items.forEach(function(result) {
    var item = result.item;
    var ct   = item.costType;
    if (ct !== 'PERCENT_OF_LABOR_EQUIP' && ct !== 'PERCENT_OF_SUBTOTAL') return;

    var pct;
    if (ct === 'PERCENT_OF_LABOR_EQUIP') {
      pct = drivers.insurancePct;
      result.driverQtyVal = drivers.laborEquipSubtotal;
      result.otherMxn     = pct * drivers.laborEquipSubtotal;
    } else {
      pct = drivers.contingencyPct;
      result.driverQtyVal = drivers.installSubtotal;
      result.otherMxn     = pct * drivers.installSubtotal;
    }
    result.totalMxn = result.otherMxn;

    indirectOther += result.otherMxn;
    if (!sectionTotals['INDIRECT']) sectionTotals['INDIRECT'] = {labor:0,equip:0,other:0,total:0};
    sectionTotals['INDIRECT'].other += result.otherMxn;
    sectionTotals['INDIRECT'].total += result.otherMxn;
  });

  grandOther += indirectOther;

  // -- Grand totals ----------------------------------------------------------
  var grandTotal = grandLabor + grandEquip + grandOther;
  var totals = {
    labor        : grandLabor,
    equip        : grandEquip,
    other        : grandOther,
    total        : grandTotal,
    perWp        : drivers.projectDcWp  > 0 ? grandTotal / drivers.projectDcWp  : 0,
    perKwp       : drivers.projectDcKwp > 0 ? grandTotal / drivers.projectDcKwp : 0,
    perM2        : drivers.arrayGrossAreaM2 > 0 ? grandTotal / drivers.arrayGrossAreaM2 : 0,
    // Man-hours summary
    totalMH      : grandMH,
    impliedDays  : (drivers.crewSize > 0 && grandMH > 0)
                   ? Math.round(grandMH / drivers.crewSize / 8) : 0,
    avgRateMxnMH : grandMH > 0 ? Math.round(grandLabor / grandMH) : 0,
  };

  // -- Role aggregation for man-hours block -----------------------------------
  var roleAgg = {};
  items.forEach(function(res) {
    if (res.laborMxn > 0 && res.item.laborRole) {
      var role = res.item.laborRole;
      if (!roleAgg[role]) roleAgg[role] = { mh: 0, cost: 0, rate: res.roleRateVal || 0 };
      roleAgg[role].mh   += res.mhComputed;
      roleAgg[role].cost += res.laborMxn;
    }
  });

  return { items: items, sectionTotals: sectionTotals, totals: totals, roleAgg: roleAgg };
}

// ---------------------------------------------------------------------------
// FORMULA TRACE
// Produces a human-readable calculation trace for each line item — same
// philosophy as the MDC FORMULA column so the user can see the math.
//
// Examples:
//   LABOR_PRODUCTIVITY : "1350 mod ÷ 3.5 mod/MH × 1.19 cf = 456 MH × $95/MH"
//   LABOR_FIXED_MH     : "max(1,1) × 12 MH/ea × 1.20 cf = 14 MH × $220/MH"
//   OTHER_FIXED        : "6 days × $2,800/day × 1.0 cf"
//   OTHER_UNIT         : "6 persons × $1,800/person"
//   EQUIPMENT_DAY      : "6 days × $1,800/day [SCISSOR_LIFT] × 1.19 cf"
//   PERCENT_OF_*       : "3% × $51,600 (labor+equip)"
// ---------------------------------------------------------------------------
function _buildFormulaTrace(item, res, drivers) {
  var ct  = item.costType;
  var drv = res.driverQtyVal;
  var cf  = res.factorResult.combined;
  var cfS = cf !== 1.0 ? (' × ' + cf.toFixed(2) + ' cf') : '';

  // Factor breakdown label — only show groups that actually differ from 1.0
  var groups  = [item.factorGroup1, item.factorGroup2, item.factorGroup3, item.factorGroup4];
  var fVals   = res.factorResult.values;
  var fParts  = [];
  groups.forEach(function(grp, i) {
    if (!grp || fVals[i] === null) return;
    var sel = (drivers.factorSelections || {})[grp] || '?';
    if (fVals[i] !== 1.0) fParts.push(grp + '=' + sel + '(' + fVals[i] + ')');
  });
  var cfDetail = fParts.length > 0 ? ' [' + fParts.join(', ') + ']' : '';

  function fmt(n) {
    if (n === null || n === undefined || isNaN(n)) return '0';
    return Math.round(n).toLocaleString();
  }
  function fmtD(n, d) {
    if (n === null || n === undefined || isNaN(n)) return '0';
    return parseFloat(n).toFixed(d !== undefined ? d : 1);
  }

  var uom = item.driverUom || 'ea';

  if (ct === 'LABOR_PRODUCTIVITY') {
    var pr  = item.productivityRate;
    var mh  = res.mhComputed;
    var rr  = res.roleRateVal;
    if (pr > 0 && drv > 0) {
      return fmtD(drv, 0) + ' ' + uom +
             ' ÷ ' + pr + ' ' + uom + '/MH' +
             cfS + cfDetail +
             ' = ' + fmtD(mh, 1) + ' MH' +
             ' × $' + fmt(rr) + '/MH' +
             ' = $' + fmt(res.laborMxn);
    }
    return 'Driver=' + fmtD(drv, 0) + ' ' + uom + ' (no compute — check driver or rate)';
  }

  if (ct === 'LABOR_FIXED_MH') {
    var mq  = item.minQty;
    var mh2 = res.mhComputed;
    var rr2 = res.roleRateVal;
    var LABOR_FIXED_PER_UNIT = ['INTERCONNECTION_POINTS','CREW_SIZE','EST_PROJECT_DAYS'];
    var isPerUnit2 = LABOR_FIXED_PER_UNIT.indexOf(item.driverKey) !== -1;
    if (isPerUnit2) {
      var units = Math.max(drv, 1);
      return 'max(' + fmtD(drv,0) + ',1)' +
             ' × ' + mq + ' MH/' + uom +
             cfS + cfDetail +
             ' = ' + fmtD(mh2,1) + ' MH' +
             ' × $' + fmt(rr2) + '/MH' +
             ' = $' + fmt(res.laborMxn);
    } else {
      return mq + ' MH (fixed baseline for task)' +
             cfS + cfDetail +
             ' = ' + fmtD(mh2,1) + ' MH' +
             ' × $' + fmt(rr2) + '/MH' +
             ' = $' + fmt(res.laborMxn) +
             ' | Tune in INPUT_DESIGN for this project';
    }
  }

  if (ct === 'OTHER_FIXED') {
    var OTHER_FIXED_SCALE2 = ['PROJECT_DC_KWP','PROJECT_AC_KW'];
    var isScale2 = OTHER_FIXED_SCALE2.indexOf(item.driverKey) !== -1;
    if (isScale2) {
      return '$' + fmt(item.baseOtherRate) + ' flat (lot-based)' +
             cfS + cfDetail +
             ' = $' + fmt(res.otherMxn);
    }
    var qty2 = Math.max(drv, item.minQty > 0 ? item.minQty : 1);
    return fmtD(qty2,0) + ' ' + uom +
           ' × $' + fmt(item.baseOtherRate) + '/' + uom +
           cfS + cfDetail +
           ' = $' + fmt(res.otherMxn);
  }

  if (ct === 'OTHER_UNIT') {
    if (drv > 0) {
      return fmtD(drv, 0) + ' ' + uom +
             ' × $' + fmt(item.baseOtherRate) + '/' + uom +
             cfS + cfDetail +
             ' = $' + fmt(res.otherMxn);
    }
    return 'Driver=' + item.driverKey + '=0 (no cost — set driver value)';
  }

  if (ct === 'EQUIPMENT_DAY') {
    var er = res.equipRateVal;
    if (drv > 0 && er > 0) {
      return fmtD(drv, 0) + ' days' +
             ' × $' + fmt(er) + '/day' +
             (item.equipKey ? ' [' + item.equipKey + ']' : '') +
             cfS + cfDetail +
             ' = $' + fmt(res.equipMxn);
    }
    return (drv === 0 ? 'Driver=' + item.driverKey + '=0' : 'No equip rate for ' + item.equipKey);
  }

  if (ct === 'PERCENT_OF_LABOR_EQUIP') {
    return fmtD(drivers.insurancePct * 100, 0) + '% × $' +
           fmt(drivers.laborEquipSubtotal) + ' (labor + equip)' +
           ' = $' + fmt(res.otherMxn);
  }

  if (ct === 'PERCENT_OF_SUBTOTAL') {
    return fmtD(drivers.contingencyPct * 100, 0) + '% × $' +
           fmt(drivers.installSubtotal) + ' (subtotal antes de contingencia)' +
           ' = $' + fmt(res.otherMxn);
  }

  return ct; // fallback: just show the cost type
}

// ---------------------------------------------------------------------------
// APPLY kWp PRODUCTIVITY BENCHMARKS
// After calcInstallCost(), scales section labour MH to match benchmark targets
// set in INPUT_DESIGN rows 80-83. Equipment and other costs are untouched.
// Item-level proportions are preserved; only total section MH is scaled.
// ---------------------------------------------------------------------------
function applyKwpBenchmarks(ss, result, drivers) {
  var kWp = drivers.projectDcKwp;
  if (!(kWp > 0)) return result;

  // Migrated to readInput() 2026-04-24. Legacy null-signal semantics preserved:
  // blank / 0 / NaN → null (no benchmark, use DB item calc). Positive → use.
  function readBench(key) {
    var v = parseFloat(readInput(ss, key));
    return (v > 0) ? v : null;
  }

  // Map each benchmark to the items it controls
  var benchDefs = [
    {
      key: 'STRUCT',
      mhPerKwp: readBench('benchStructMhKwp'),
      filter: function(r) {
        return r.item.section === 'RACKING SYSTEM' &&
               r.item.costType.indexOf('LABOR') !== -1 && r.mhComputed > 0;
      }
    },
    {
      key: 'MODULE',
      mhPerKwp: readBench('benchModuleMhKwp'),
      filter: function(r) { return r.item.id === 'DC-01' && r.mhComputed > 0; }
    },
    {
      key: 'DC_ELEC',
      mhPerKwp: readBench('benchDcElecMhKwp'),
      filter: function(r) {
        return r.item.section === 'DC' && r.item.id !== 'DC-01' &&
               r.item.costType.indexOf('LABOR') !== -1 && r.mhComputed > 0;
      }
    },
    {
      key: 'AC_ELEC',
      mhPerKwp: readBench('benchAcElecMhKwp'),
      filter: function(r) {
        return r.item.section === 'AC' &&
               r.item.costType.indexOf('LABOR') !== -1 && r.mhComputed > 0;
      }
    },
  ];

  var anyApplied = false;

  benchDefs.forEach(function(bd) {
    if (!bd.mhPerKwp) return;
    var targetMH = bd.mhPerKwp * kWp;
    var matched  = result.items.filter(bd.filter);
    if (matched.length === 0) return;
    var currentMH = matched.reduce(function(s, r) { return s + r.mhComputed; }, 0);
    if (!(currentMH > 0)) return;

    var scale = targetMH / currentMH;
    anyApplied = true;

    engineLog(ss, 'InstallCost', 'INFO',
      'kWp bench ' + bd.key + ': ' + bd.mhPerKwp + ' MH/kWp × ' + kWp.toFixed(1) +
      ' kWp = ' + targetMH.toFixed(1) + ' MH target | DB was ' +
      currentMH.toFixed(1) + ' MH | scale ×' + scale.toFixed(2));

    matched.forEach(function(res) {
      var oldMH   = res.mhComputed;
      var oldCost = res.laborMxn;
      res.mhComputed   = oldMH   * scale;
      res.laborMxn     = res.mhComputed * res.roleRateVal;
      res.totalMxn     = res.laborMxn + res.equipMxn + res.otherMxn;
      res.formulaTrace += ' ║ kWp bench: ' + bd.mhPerKwp + ' MH/kWp × ' +
        kWp.toFixed(0) + ' kWp → ' + targetMH.toFixed(1) + ' MH total' +
        ' (×' + scale.toFixed(2) + ' from DB ' + oldMH.toFixed(1) + ' MH' +
        ', $' + Math.round(oldCost).toLocaleString() + ')';
    });
  });

  if (!anyApplied) return result;

  // ── RE-DERIVE EST_PROJECT_DAYS from POST-BENCHMARK productive MH.
  // calcInstallCost initially derived days from the RAW lib productivity
  // (before any kWp benchmarks). After benchmark scaling, productive labor MH
  // has changed, so day-driven items (HSE officer × days, scissor lift × days,
  // supervisor × days, …) need their days reset and costs recomputed.
  // Without this step, day-driven costs would over-state when benchmarks scale
  // labor down (which is the typical case when tuning for a faster crew).
  //
  // Day-driven items are a small, fixed set (SF-02, SF-08, GN-03, GN-04, GN-08,
  // EQ-01..EQ-05). We recompute them inline rather than calling back into
  // calcInstallCost to avoid double-applying scaling and to keep the flow flat.
  var DAY_DRIVEN_KEYS = ['EST_PROJECT_DAYS', 'CREW_DAYS'];

  var newProductiveMH = result.items.reduce(function(s, r) {
    if (DAY_DRIVEN_KEYS.indexOf(r.item.driverKey) !== -1) return s;
    if (r.item.section === 'INDIRECT') return s;   // PERCENT items handled below
    return s + r.mhComputed;
  }, 0);

  var newDays = Math.max(1, Math.ceil(newProductiveMH / Math.max(drivers.crewSize, 1) / 8));
  if (newDays !== drivers.estProjectDays) {
    var oldDays = drivers.estProjectDays;
    drivers.estProjectDays = newDays;
    drivers.crewDays       = drivers.crewSize * newDays;
    engineLog(ss, 'InstallCost', 'INFO',
      'Post-benchmark re-derivation: EST_PROJECT_DAYS = ' + newDays +
      '  (was ' + oldDays + ' from raw lib MH; now from scaled productive MH=' +
      newProductiveMH.toFixed(1) + ')');

    // Recompute day-driven items in place. Mirrors the cost-type branches in
    // calcInstallCost.computeOneItem so semantics stay consistent.
    var LABOR_FIXED_PER_UNIT = ['INTERCONNECTION_POINTS', 'CREW_SIZE', 'EST_PROJECT_DAYS'];

    result.items.forEach(function(r) {
      var item = r.item;
      if (DAY_DRIVEN_KEYS.indexOf(item.driverKey) === -1) return;
      if (!r.applies) return;

      var cf      = r.factorResult.combined;
      var newDrv  = (item.driverKey === 'EST_PROJECT_DAYS') ? newDays : drivers.crewDays;

      // Reset cost components before recompute
      r.driverQtyVal = newDrv;
      r.mhComputed = 0; r.laborMxn = 0;
      r.equipDays  = 0; r.equipMxn = 0;
      r.otherMxn   = 0;

      if (item.costType === 'LABOR_FIXED_MH' && item.minQty > 0) {
        var isPerUnit = LABOR_FIXED_PER_UNIT.indexOf(item.driverKey) !== -1;
        var mhBase    = isPerUnit ? Math.max(newDrv, 1) * item.minQty : item.minQty;
        r.mhComputed  = mhBase * cf;
        r.laborMxn    = r.mhComputed * (r.roleRateVal || 0);
      } else if (item.costType === 'OTHER_FIXED') {
        var qty = Math.max(newDrv, item.minQty > 0 ? item.minQty : 1);
        r.otherMxn = item.baseOtherRate * qty * cf;
      } else if (item.costType === 'OTHER_UNIT') {
        if (newDrv > 0) r.otherMxn = item.baseOtherRate * newDrv * cf;
      } else if (item.costType === 'EQUIPMENT_DAY') {
        if ((r.equipRateVal || 0) > 0 && newDrv > 0) {
          r.equipDays = newDrv;
          r.equipMxn  = r.equipRateVal * newDrv * cf;
        }
      }
      r.totalMxn      = r.laborMxn + r.equipMxn + r.otherMxn;
      r.formulaTrace += ' ║ days re-derived: ' + oldDays + '→' + newDays +
                        ' (post-benchmark, productive MH=' + newProductiveMH.toFixed(0) + ')';
    });
  }

  // Recompute section totals
  var newSec = {};
  result.items.forEach(function(res) {
    var sec = res.item.section;
    if (sec === 'INDIRECT') return;
    if (!newSec[sec]) newSec[sec] = {labor:0, equip:0, other:0, total:0};
    newSec[sec].labor += res.laborMxn;
    newSec[sec].equip += res.equipMxn;
    newSec[sec].other += res.otherMxn;
    newSec[sec].total += res.totalMxn;
  });

  // Recompute grand totals (excl INDIRECT first)
  var gL = 0, gE = 0, gO = 0;
  Object.keys(newSec).forEach(function(k) {
    gL += newSec[k].labor; gE += newSec[k].equip; gO += newSec[k].other;
  });

  // Recompute PERCENT_OF items with updated subtotals
  var leSubtotal      = gL + gE;
  var installSubtotal = gL + gE + gO;
  newSec['INDIRECT']  = {labor:0, equip:0, other:0, total:0};
  result.items.forEach(function(res) {
    var ct = res.item.costType;
    if (ct === 'PERCENT_OF_LABOR_EQUIP') {
      res.otherMxn = drivers.insurancePct * leSubtotal;
    } else if (ct === 'PERCENT_OF_SUBTOTAL') {
      res.otherMxn = drivers.contingencyPct * installSubtotal;
    } else { return; }
    res.totalMxn = res.otherMxn;
    newSec['INDIRECT'].other += res.otherMxn;
    newSec['INDIRECT'].total += res.otherMxn;
    gO += res.otherMxn;
  });
  // Note: gO was accumulated from non-INDIRECT above, then INDIRECT added.
  // Recalculate cleanly:
  gO = 0;
  result.items.forEach(function(r) { gO += r.otherMxn; });

  var grandTotal = gL + gE + gO;
  var totalMH    = result.items.reduce(function(s, r) { return s + r.mhComputed; }, 0);

  result.sectionTotals = newSec;
  result.totals = {
    labor        : gL,
    equip        : gE,
    other        : gO,
    total        : grandTotal,
    perWp        : drivers.projectDcWp  > 0 ? grandTotal / drivers.projectDcWp  : 0,
    perKwp       : drivers.projectDcKwp > 0 ? grandTotal / drivers.projectDcKwp : 0,
    perM2        : drivers.arrayGrossAreaM2 > 0 ? grandTotal / drivers.arrayGrossAreaM2 : 0,
    totalMH      : totalMH,
    impliedDays  : (drivers.crewSize > 0 && totalMH > 0)
                   ? Math.round(totalMH / drivers.crewSize / 8) : 0,
    avgRateMxnMH : totalMH > 0 ? Math.round(gL / totalMH) : 0,
  };

  return result;
}

// ---------------------------------------------------------------------------
// SECTION STYLING CONSTANTS
// ---------------------------------------------------------------------------
var SEC_HDR_BG = {
  'AC'            : '#0D47A1',
  'DC'            : '#BF360C',
  'RACKING SYSTEM': '#1B5E20',
  'CONNECTION'    : '#4A148C',
  'SAFETY'        : '#B71C1C',
  'GENERAL SITE'  : '#E65100',
  'EQUIPMENT'     : '#006064',
  'INDIRECT'      : '#37474F',
};
// SEC_ITEM_BG: color palette per section. Phase 2e: no longer used in top
// zone (rows 14-22) — those now render as neutral white. Still used in the
// line-item zone (rows 41+) where each section gets its own colored band.
var SEC_ITEM_BG = {
  'AC'            : '#E3F2FD',
  'DC'            : '#FBE9E7',
  'RACKING SYSTEM': '#F1F8E9',
  'CONNECTION'    : '#F3E5F5',
  'SAFETY'        : '#FFEBEE',
  'GENERAL SITE'  : '#FFF8E1',
  'EQUIPMENT'     : '#E0F7FA',
  'INDIRECT'      : '#F5F5F5',
};
var SEC_SUB_BG = {
  'AC'            : '#BBDEFB',
  'DC'            : '#FFCCBC',
  'RACKING SYSTEM': '#DCEDC8',
  'CONNECTION'    : '#E1BEE7',
  'SAFETY'        : '#FFCDD2',
  'GENERAL SITE'  : '#FFE0B2',
  'EQUIPMENT'     : '#B2EBF2',
  'INDIRECT'      : '#ECEFF1',
};

// ---------------------------------------------------------------------------
// WRITE INSTALLATION SHEET — section-by-section layout
// ---------------------------------------------------------------------------
function writeInstallCost(ss, result, drivers) {
  var sh = ss.getSheetByName(SH_IC.COST);
  if (!sh) {
    engineLog(ss, 'InstallCost', 'ERROR', 'INSTALLATION sheet not found');
    return;
  }

  var items   = result.items;
  var secTots = result.sectionTotals;
  var totals  = result.totals;
  var C       = IC_LINE_COLS;

  function fn2(v) { return (v === null || v === undefined || isNaN(v)) ? 0 : Math.round(v * 100) / 100; }

  // ── 1. Update driver values ──────────────────────────────────────────────
  var drvMap = {
    'PROJECT_DC_WP': drivers.projectDcWp, 'PROJECT_DC_KWP': drivers.projectDcKwp,
    'PROJECT_AC_KW': drivers.projectAcKw, 'MODULE_COUNT': drivers.moduleCount,
    'INVERTER_COUNT': drivers.inverterCount, 'STRING_COUNT': drivers.stringCount,
    'ARRAY_GROSS_AREA_M2': drivers.arrayGrossAreaM2, 'ARRAY_NET_AREA_M2': drivers.arrayNetAreaM2,
    'ROOF_AREA_M2': drivers.roofAreaM2, 'DC_CABLE_M': drivers.dcCableM,
    'AC_CABLE_M': drivers.acCableM, 'TRAY_M': drivers.trayM, 'CONDUIT_M': drivers.conduitM,
    'GROUNDING_M': drivers.groundingM, 'INTERCONNECTION_POINTS': drivers.interconnectionPts,
    'ANCHOR_COUNT': drivers.anchorCount, 'CREW_SIZE': drivers.crewSize,
    'EST_PROJECT_DAYS': drivers.estProjectDays, 'CREW_DAYS': drivers.crewDays,
    'WORK_HEIGHT_M': drivers.workHeightM, 'AC_TERMINATION_COUNT': drivers.acTerminationCount,
    'DC_CONNECTOR_COUNT': drivers.dcConnectorCount,
    'CONTINGENCY_PCT': drivers.contingencyPct,
    'INSURANCE_PCT_ON_LABOR_EQUIP': drivers.insurancePct,
  };
  var drvData = sh.getRange(IC_DRV_START, IC_DRV_COL_KEY,
                             IC_DRV_END - IC_DRV_START + 1, 2).getValues();
  drvData.forEach(function(row, i) {
    var key = String(row[0]).trim();
    if (drvMap.hasOwnProperty(key)) {
      sh.getRange(IC_DRV_START + i, IC_DRV_COL_VAL).setValue(drvMap[key]);
    }
  });

  // ── 2. Redesigned summary block (cols F-J, rows 4-22) ───────────────────
  // Build summary data rows (starts at IC_SUM_ROWS.TOTAL_LABOR = 5, row 4 = SUMMARY header)
  var mhLine = totals.totalMH > 0
    ? Math.round(totals.totalMH) + ' MH  ÷ (' + drivers.crewSize + ' crew × 8h)  = ~' +
      totals.impliedDays + ' días  |  avg ' + totals.avgRateMxnMH + ' MXN/MH'
    : '—';

  // ── Summary totals (rows 5-12, cols F-G) ──────────────────────────────────
  // Row 4 = static "SUMMARY" header written by template, do not overwrite.
  // Rows 5-12 are written by engine. Labels in col F, values in col G.
  var sumData = [
    ['TOTAL LABOR MXN',   fn2(totals.labor)],   // row 5
    ['TOTAL EQUIP MXN',   fn2(totals.equip)],   // row 6
    ['TOTAL OTHER MXN',   fn2(totals.other)],   // row 7
    ['─────────────────', '──────────'],         // row 8 divider
    ['GRAND TOTAL MXN',   fn2(totals.total)],   // row 9
    ['MXN / kWp',         totals.perKwp > 0 ? Math.round(totals.perKwp) : '—'],  // row 10
    ['MXN / Wp',          totals.perWp  > 0 ? fn2(totals.perWp) : '—'],          // row 11
    ['MXN / m\u00b2',    totals.perM2  > 0 ? Math.round(totals.perM2)  : '—'],  // row 12
  ];
  sumData.forEach(function(row, i) {
    sh.getRange(IC_SUM_ROWS.TOTAL_LABOR + i, IC_SUM_COL_LABEL).setValue(row[0]);
    sh.getRange(IC_SUM_ROWS.TOTAL_LABOR + i, IC_SUM_COL_VAL  ).setValue(row[1]);
  });
  // Style GRAND TOTAL row (row 9 = index 4) — BOM grand-total style:
  // light cream BG + bold size 12 + thick top/bottom borders. Replaces the
  // previous dark-navy block per Phase 2e visual harmonization.
  sh.getRange(IC_SUM_ROWS.TOTAL_LABOR + 4, IC_SUM_COL_LABEL, 1, 2)
    .setBackground('#fffde7')
    .setFontColor('#212121')
    .setFontWeight('bold')
    .setFontSize(12)
    .setBorder(true, null, true, null, null, null, '#424242', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sh.setRowHeight(IC_SUM_ROWS.TOTAL_LABOR + 4, 28);

  // SECTION grid header (row 14, cols F-J) — BOM cream header style.
  // Was dark grey #263238 with white text.
  sh.getRange(IC_SEC_HDR_ROW, IC_SEC_COL.SECTION, 1, 5)
    .setValues([['SECTION','LABOR','EQUIP','OTHER','TOTAL']])
    .setBackground('#fef7e0')
    .setFontColor('#212121')
    .setFontWeight('bold')
    .setBorder(null, null, true, null, null, null, '#bdbdbd', SpreadsheetApp.BorderStyle.SOLID);

  // Section rows (15-22) — neutral white with bold totals.
  // Was rainbow palette via SEC_ITEM_BG. Per Phase 2e: the colored sections
  // here are dropped because: (a) PDF audience prefers neutral, (b) line-item
  // zone below uses the same colors so the visual link wasn't unique.
  IC_SECTIONS.forEach(function(sec, idx) {
    var r = IC_SEC_START_ROW + idx;
    var t = secTots[sec] || {labor:0,equip:0,other:0,total:0};
    sh.getRange(r, IC_SEC_COL.SECTION, 1, 5)
      .setValues([[sec, Math.round(t.labor), Math.round(t.equip),
                       Math.round(t.other), Math.round(t.total)]])
      .setBackground('#ffffff')
      .setFontColor('#212121')
      .setBorder(null, null, true, null, null, null, '#eeeeee', SpreadsheetApp.BorderStyle.SOLID);
    sh.getRange(r, IC_SEC_COL.TOTAL).setFontWeight('bold');
  });

  // ── 2b. Man-hours breakdown block (rows 24-35, cols F-J) ─────────────────
  // Shows labor hours by role — "X MH × Y crew × $Z/MH" transparency block.
  var MH_START = 24;  // first row of man-hours block (below section table rows 14-22)
  var MH_COLS  = [IC_SEC_COL.SECTION, IC_SEC_COL.LABOR, IC_SEC_COL.EQUIP,
                  IC_SEC_COL.OTHER, IC_SEC_COL.TOTAL];  // F G H I J

  // Header — BOM cream header style. Was dark navy #1A237E with white text.
  sh.getRange(MH_START, MH_COLS[0], 1, 5)
    .setValues([['MAN-HOURS BREAKDOWN', 'TOTAL MH', '$/MH', 'LABOR MXN', 'CHECK']])
    .setBackground('#fef7e0')
    .setFontColor('#212121')
    .setFontWeight('bold')
    .setBorder(null, null, true, null, null, null, '#bdbdbd', SpreadsheetApp.BorderStyle.SOLID);

  // Role rows
  var roleAgg  = result.roleAgg || {};
  var roleKeys = Object.keys(roleAgg).sort();
  var mhDataRows = [];
  roleKeys.forEach(function(role) {
    var ra = roleAgg[role];
    var mh   = Math.round(ra.mh * 10) / 10;
    var rate = ra.rate || 0;
    var cost = Math.round(ra.cost);
    var check = mh > 0 ? (mh.toFixed(1) + ' MH × $' + rate + '/MH') : '—';
    mhDataRows.push([role, mh, rate, cost, check]);
  });
  // Totals row
  var crewCheck = '';
  if (totals.totalMH > 0 && drivers.crewSize > 0) {
    var mhPerPersonDay = (totals.totalMH / drivers.crewSize / drivers.estProjectDays).toFixed(1);
    crewCheck = totals.totalMH.toFixed(0) + ' MH ÷ ' + drivers.crewSize + ' crew ÷ ' +
                drivers.estProjectDays + ' días = ' + mhPerPersonDay + ' MH/persona/día';
  }
  mhDataRows.push(['TOTAL', Math.round(totals.totalMH * 10) / 10,
                   totals.avgRateMxnMH || 0, Math.round(totals.labor), crewCheck]);

  if (mhDataRows.length > 0) {
    var mhRange = sh.getRange(MH_START + 1, MH_COLS[0], mhDataRows.length, 5);
    // Data rows — neutral white, small font (was pale lavender #E8EAF6).
    mhRange.setValues(mhDataRows).setFontSize(9).setBackground('#ffffff').setFontColor('#212121');
    // TOTAL row — BOM subtotal cream + bold + top border. Was dark blue.
    var totRowIdx = mhDataRows.length;
    sh.getRange(MH_START + totRowIdx, MH_COLS[0], 1, 5)
      .setBackground('#fff8e1')
      .setFontColor('#212121')
      .setFontWeight('bold')
      .setBorder(true, null, null, null, null, null, '#bdbdbd', SpreadsheetApp.BorderStyle.SOLID);
    // Italic the CHECK column
    sh.getRange(MH_START + 1, MH_COLS[4], mhDataRows.length, 1).setFontStyle('italic');
  }

  // ── 3. Clear old line items area ─────────────────────────────────────────
  sh.getRange(IC_LINE_HEADER_ROW, 1, 160, IC_LINE_TOTAL_COLS)
    .clearContent().clearFormat();

  // ── 4. Column headers ────────────────────────────────────────────────────
  var hdrs = [
    'SECTION','SUBSECTION','ID','DESCRIPTION','COST TYPE',
    'DRIVER','QTY','UNIT','BASE RATE','ROLE','$/MH','EQUIP KEY',
    'F1','F2','F3','F4','C.FACTOR','APPLIES','MIN MH',
    'MAN-HOURS','LABOR MXN','EQUIP DAYS','EQUIP MXN','OTHER MXN',
    'TOTAL MXN','FORMULA / CALCULATION TRACE','ACTIVE','NOTES'
  ];
  sh.getRange(IC_LINE_HEADER_ROW, 1, 1, IC_LINE_TOTAL_COLS)
    .setValues([hdrs])
    .setBackground('#0D1B2A').setFontColor('#FFFFFF').setFontWeight('bold');

  // ── 5. Section-by-section line items ─────────────────────────────────────
  var currentRow = IC_LINE_START_ROW;

  IC_SECTIONS.forEach(function(section) {
    var sectionItems = items.filter(function(r) { return r.item.section === section; });
    if (sectionItems.length === 0) return;

    var st    = secTots[section] || {labor:0,equip:0,other:0,total:0};
    var hdrBg = SEC_HDR_BG[section]  || '#37474F';
    var itemBg= SEC_ITEM_BG[section] || '#FAFAFA';
    var subBg = SEC_SUB_BG[section]  || '#ECEFF1';

    // Section header row
    var hdrValues = new Array(IC_LINE_TOTAL_COLS).fill('');
    hdrValues[0]                = '\u25b6  ' + section;
    hdrValues[C.LABOR_MXN - 1] = 'Labor: $' + Math.round(st.labor).toLocaleString();
    hdrValues[C.EQUIP_MXN - 1] = 'Equip: $' + Math.round(st.equip).toLocaleString();
    hdrValues[C.OTHER_MXN - 1] = 'Other: $' + Math.round(st.other).toLocaleString();
    hdrValues[C.TOTAL_MXN - 1] = 'TOTAL: $' + Math.round(st.total).toLocaleString();
    sh.getRange(currentRow, 1, 1, IC_LINE_TOTAL_COLS)
      .setValues([hdrValues])
      .setBackground(hdrBg).setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(9);
    currentRow++;

    // Item rows
    var sectionData = [];
    sectionItems.forEach(function(res) {
      var item = res.item;
      var fv   = res.factorResult.values;
      sectionData.push([
        item.section, item.subsection, item.id, item.description, item.costType,
        item.driverKey, fn2(res.driverQtyVal), item.driverUom,
        (item.costType === 'EQUIPMENT_DAY') ? res.equipRateVal
          : (item.costType.indexOf('LABOR') !== -1) ? item.productivityRate
          : item.baseOtherRate,
        item.laborRole || '', res.roleRateVal || '', item.equipKey || '',
        fv[0] !== null ? fv[0] : '', fv[1] !== null ? fv[1] : '',
        fv[2] !== null ? fv[2] : '', fv[3] !== null ? fv[3] : '',
        fn2(res.factorResult.combined), item.appliesToInstType, item.minQty,
        fn2(res.mhComputed), fn2(res.laborMxn), fn2(res.equipDays),
        fn2(res.equipMxn), fn2(res.otherMxn), fn2(res.totalMxn),
        res.formulaTrace || _buildFormulaTrace(item, res, drivers),  // Z: DB or benchmark-scaled trace
        item.active ? 'Y' : 'N', item.notes,
      ]);
    });

    if (sectionData.length > 0) {
      sh.getRange(currentRow, 1, sectionData.length, IC_LINE_TOTAL_COLS)
        .setValues(sectionData).setBackground(itemBg).setFontSize(8);
      // Zero-cost rows greyed out; bold TOTAL and italic FORMULA columns
      sectionData.forEach(function(row, i) {
        if (row[C.TOTAL_MXN - 1] === 0) {
          sh.getRange(currentRow + i, 1, 1, IC_LINE_TOTAL_COLS).setBackground('#F5F5F5').setFontColor('#AAAAAA');
        }
        sh.getRange(currentRow + i, C.TOTAL_MXN).setFontWeight('bold').setFontColor(row[C.TOTAL_MXN-1]>0?'#000000':'#AAAAAA');
        sh.getRange(currentRow + i, C.FORMULA  ).setFontStyle('italic');
      });
    }
    currentRow += sectionData.length;

    // Subtotal row
    var subValues = new Array(IC_LINE_TOTAL_COLS).fill('');
    subValues[C.DESC      - 1] = section + ' subtotal';
    subValues[C.LABOR_MXN - 1] = fn2(st.labor);
    subValues[C.EQUIP_MXN - 1] = fn2(st.equip);
    subValues[C.OTHER_MXN - 1] = fn2(st.other);
    subValues[C.TOTAL_MXN - 1] = fn2(st.total);
    sh.getRange(currentRow, 1, 1, IC_LINE_TOTAL_COLS)
      .setValues([subValues]).setBackground(subBg)
      .setFontWeight('bold').setFontStyle('italic').setFontSize(8);
    sh.getRange(currentRow, C.TOTAL_MXN).setBackground(hdrBg).setFontColor('#FFFFFF');
    currentRow += 2; // +1 subtotal +1 blank separator
  });

  // ── 6. Grand total row ───────────────────────────────────────────────────
  var grandValues = new Array(IC_LINE_TOTAL_COLS).fill('');
  grandValues[C.DESC      - 1] = 'GRAND TOTAL';
  grandValues[C.LABOR_MXN - 1] = fn2(totals.labor);
  grandValues[C.EQUIP_MXN - 1] = fn2(totals.equip);
  grandValues[C.OTHER_MXN - 1] = fn2(totals.other);
  grandValues[C.TOTAL_MXN - 1] = fn2(totals.total);
  grandValues[C.FORMULA   - 1] = totals.perKwp > 0
    ? Math.round(totals.perKwp) + ' MXN/kWp  |  ' + fn2(totals.perWp) + ' MXN/Wp'
    : '';
  sh.getRange(currentRow, 1, 1, IC_LINE_TOTAL_COLS)
    .setValues([grandValues]).setBackground('#0D1B2A')
    .setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(10);
  currentRow += 2;

  // ── 7. Legend ────────────────────────────────────────────────────────────
  var legendRows = [
    ['LEGEND — COST TYPES & COLUMN GUIDE'],
    ['LABOR_PRODUCTIVITY',
     'MH = (driver qty \u00f7 productivity rate) \u00d7 factor | Labor = MH \u00d7 rate/MH'],
    ['LABOR_FIXED_MH',
     'Scale drivers (kWp/modules): flat baseline MH = MIN_QTY | Count drivers (crew/points): MH = qty \u00d7 MIN_QTY | Tune per project'],
    ['OTHER_FIXED',
     'Count drivers: cost = rate \u00d7 qty \u00d7 factor | Lot-based (PROJECT_DC_KWP driver): flat total regardless of size'],
    ['OTHER_UNIT',
     'Unit cost: rate \u00d7 driver qty \u00d7 factor'],
    ['EQUIPMENT_DAY',
     'day_rate \u00d7 days \u00d7 factor'],
    ['PERCENT_OF_*',
     'IN-01: pct \u00d7 (labor+equip subtotal) | IN-02: pct \u00d7 install subtotal'],
    ['COLUMNS',
     'T=Man-Hours | U=Labor MXN | W=Equip MXN | X=Other MXN | Y=TOTAL MXN | Z=Full formula trace'],
  ];
  legendRows.forEach(function(row, i) {
    var r = currentRow + i;
    var padded = row.slice();
    while (padded.length < IC_LINE_TOTAL_COLS) padded.push('');
    sh.getRange(r, 1, 1, IC_LINE_TOTAL_COLS).setValues([padded.slice(0, IC_LINE_TOTAL_COLS)]);
    if (i === 0) {
      sh.getRange(r, 1, 1, IC_LINE_TOTAL_COLS)
        .setBackground('#263238').setFontColor('#FFFFFF').setFontWeight('bold');
    } else {
      sh.getRange(r, 1).setFontWeight('bold').setBackground('#ECEFF1');
      sh.getRange(r, 2).setFontStyle('italic').setBackground('#FAFAFA').setFontColor('#555555');
    }
  });

  SpreadsheetApp.flush();
  engineLog(ss, 'InstallCost', 'OK',
    'INSTALLATION written. ' +
    'Labor: $' + Math.round(totals.labor).toLocaleString() +
    ' | Equip: $' + Math.round(totals.equip).toLocaleString() +
    ' | Other: $' + Math.round(totals.other).toLocaleString() +
    ' | TOTAL: $' + Math.round(totals.total).toLocaleString() + ' MXN' +
    (totals.perKwp > 0 ? ' | ' + Math.round(totals.perKwp) + ' MXN/kWp' : ''));
}

// ---------------------------------------------------------------------------
// WRITE INSTALL DRIVER MAP (95_INSTALL_DRIVER_MAP)
// Updates value column (B) and factor columns (F-G) with current selections.
// ---------------------------------------------------------------------------
function writeInstallDriverMap(ss, drivers, result) {
  var sh = ss.getSheetByName(SH_IC.DRIVER_MAP);
  if (!sh) return;

  var data = sh.getDataRange().getValues();
  var hdrs = data[0].map(function(h) { return String(h).trim(); });
  var keyCol   = hdrs.indexOf('DRIVER_KEY');
  var valCol   = hdrs.indexOf('VALUE');
  var fgrpCol  = hdrs.indexOf('FACTOR_GROUP');
  var fkeyCol  = hdrs.indexOf('SELECTED_KEY');
  var fvalCol  = hdrs.indexOf('VALUE', fgrpCol + 1); // second VALUE col
  var pkeyCol  = hdrs.indexOf('PERCENT_KEY');
  var pvalCol  = hdrs.indexOf('VALUE', pkeyCol > 0 ? pkeyCol + 1 : fvalCol + 1);

  // Build driver value map
  var driverValues = {
    'PROJECT_ONE': 1,
    'PROJECT_DC_WP': drivers.projectDcWp,
    'PROJECT_DC_KWP': drivers.projectDcKwp,
    'PROJECT_AC_KW': drivers.projectAcKw,
    'MODULE_COUNT': drivers.moduleCount,
    'INVERTER_COUNT': drivers.inverterCount,
    'STRING_COUNT': drivers.stringCount,
    'ARRAY_GROSS_AREA_M2': drivers.arrayGrossAreaM2,
    'ARRAY_NET_AREA_M2': drivers.arrayNetAreaM2,
    'ROOF_AREA_M2': drivers.roofAreaM2,
    'DC_CABLE_M': drivers.dcCableM,
    'AC_CABLE_M': drivers.acCableM,
    'TRAY_M': drivers.trayM,
    'CONDUIT_M': drivers.conduitM,
    'GROUNDING_M': drivers.groundingM,
    'INTERCONNECTION_POINTS': drivers.interconnectionPts,
    'ANCHOR_COUNT': drivers.anchorCount,
    'CREW_SIZE': drivers.crewSize,
    'EST_PROJECT_DAYS': drivers.estProjectDays,
    'WORK_HEIGHT_M': drivers.workHeightM,
    'CREW_DAYS': drivers.crewDays,
    'AC_TERMINATION_COUNT': drivers.acTerminationCount,
    'DC_CONNECTOR_COUNT': drivers.dcConnectorCount,
  };

  // Write driver values and factor selections
  for (var i = 1; i < data.length; i++) {
    var row = data[i];

    // Update driver value
    if (keyCol >= 0 && valCol >= 0) {
      var dkey = String(row[keyCol] || '').trim();
      if (driverValues.hasOwnProperty(dkey)) {
        sh.getRange(i + 1, valCol + 1).setValue(driverValues[dkey]);
      }
    }

    // Update factor selected key and value
    if (fgrpCol >= 0 && fkeyCol >= 0 && fvalCol >= 0) {
      var grp = String(row[fgrpCol] || '').trim();
      if (grp && drivers.factorSelections[grp]) {
        var selKey = drivers.factorSelections[grp];
        sh.getRange(i + 1, fkeyCol + 1).setValue(selKey);
        // Look up factor value from the instLib (we don't have it here so write from drivers)
        // The factor value is available via the result items if needed.
        // For now, set the selected key so the user can see what was used.
      }
    }
  }

  SpreadsheetApp.flush();
  engineLog(ss, 'InstallCost', 'INFO', '95_INSTALL_DRIVER_MAP updated');
}

// ---------------------------------------------------------------------------
// MAIN ORCHESTRATOR — called from runArgiaEngine() step 12
// Also called standalone from menu.
// ---------------------------------------------------------------------------
function runInstallCost(ss, inp, invBank, dc, ac, lay, bessResult) {
  // NOTE (Phase 2a, 2026-04-24): setupInstallInputsSection() was removed from
  // the orchestrator. Install inputs now live on INPUT_INSTALL and are set up
  // by setupInputInstall() in 02e_InputSetup.gs. Running the legacy setup here
  // would pollute the new INPUT_DESIGN layout with stray labels and defaults.
  //
  // NOTE (chunk bess_install, 2026-05-25): bessResult added as 7th arg.
  // Optional -- when omitted, BESS drivers are all 0 (same as no battery).

  engineLog(ss, 'InstallCost', 'INFO', 'Loading INSTALL_DB mirrors...');
  var instLib = loadInstallLib(ss);
  if (!instLib.lib || instLib.lib.length === 0) {
    engineLog(ss, 'InstallCost', 'WARNING',
      'No items in 90M_INSTALL_LIB. Ensure IMPORTRANGE is synced from INSTALL_DB.');
    return null;
  }
  engineLog(ss, 'InstallCost', 'INFO',
    'Loaded ' + instLib.lib.length + ' lib items, ' +
    Object.keys(instLib.roleRates).length + ' roles, ' +
    Object.keys(instLib.equipRates).length + ' equipment types');

  engineLog(ss, 'InstallCost', 'INFO', 'Reading install drivers...');
  var drivers = readInstallDrivers(ss, inp, invBank, dc, ac, lay, bessResult);
  engineLog(ss, 'InstallCost', 'INFO',
    'Drivers: ' + drivers.moduleCount + ' modules, crew=' + drivers.crewSize +
    ', type=' + drivers.installationType +
    '  (EST_PROJECT_DAYS will be derived from productive MH)');

  engineLog(ss, 'InstallCost', 'INFO', 'Calculating install cost...');
  var result = calcInstallCost(instLib, drivers);
  engineLog(ss, 'InstallCost', 'INFO',
    'Derived EST_PROJECT_DAYS = ' + drivers.estProjectDays +
    '  (productive_MH=' + result.totals.totalMH.toFixed(1) +
    ' / crew=' + drivers.crewSize + ' / 8h shift)');

  // Apply kWp productivity benchmarks if set in INPUT_DESIGN rows 80-83
  result = applyKwpBenchmarks(ss, result, drivers);

  engineLog(ss, 'InstallCost', 'INFO', 'Writing INSTALLATION...');
  writeInstallCost(ss, result, drivers);

  engineLog(ss, 'InstallCost', 'INFO', 'Writing driver map...');
  writeInstallDriverMap(ss, drivers, result);

  // Chunk 5 (INSTALLATION_v2): attach drivers to the returned result so the
  // v2 path in 00_Main.js Step 12-v2 can feed both into writeInstallationV2
  // without re-running the calc layers. Backward-compatible: existing
  // callers that read result.totals / result.items continue to work
  // (the property is additive).
  result.drivers = drivers;

  return result;
}

// ---------------------------------------------------------------------------
// STANDALONE ENTRY POINT (menu: "Calculate Installation")
// Reads from MDC/BOM values already in the sheet — does not re-run engine.
// ---------------------------------------------------------------------------
function runInstallCostStandalone() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  try {
    _setArgiaProgress(0, 5, 'Starting install cost\u2026');
    _showArgiaProgress('ARGIA \u2014 Installation');

    _setArgiaProgress(1, 5, 'Reading inputs\u2026');
    var nom     = loadNomConstants(ss);
    var inp     = readInputs(ss);
    var panel   = lookupPanel(ss, inp.panelModel);
    var invBank = buildInverterBank(ss, inp.inverterBank);

    _setArgiaProgress(2, 5, 'Reading calc results\u2026');
    var tbls = readElecTables(ss);
    var dc   = calcDC(inp, panel, invBank, nom, tbls);
    var ac   = calcAC(inp, panel, invBank, nom, tbls, dc);
    var lay  = calcLayout(inp, dc, ac, nom);

    // chunk bess_install: run BESS step + BoS so the install drivers can
    // pick up BESS quantities the same way the full engine does. Fail-soft:
    // any error in the BESS chain leaves bessResult undefined, which makes
    // every BESS install driver 0 (same as no battery).
    var bessResult;
    try {
      bessResult = runBessStep(ss);
      if (bessResult && bessResult.bessEnabled && bessResult.bess && bessResult.circuit) {
        var installCtx = readBessInstallContext(ss);
        installCtx.coupling = bessResult.coupling;
        bessResult.installContext = installCtx;
        bessResult.bos = calcBessBosQuantities({
          bess: bessResult.bess,
          circuit: bessResult.circuit,
          installContext: installCtx,
          nom: nom,
        });
      }
    } catch (bessErr) {
      engineLog(ss, 'InstallCost', 'WARNING',
        'BESS step skipped in standalone install: ' + bessErr.message +
        '. BESS install drivers will be zero.');
      bessResult = undefined;
    }

    _setArgiaProgress(3, 5, 'Calculating install cost\u2026');
    var result = runInstallCost(ss, inp, invBank, dc, ac, lay, bessResult);

    _setArgiaProgress(5, 5, '\u2705 Done!');
    Utilities.sleep(1400);

    if (result) {
      var t = result.totals;
      ui.alert('Installation Complete',
        'Total: $' + Math.round(t.total).toLocaleString() + ' MXN\n' +
        'Labor: $' + Math.round(t.labor).toLocaleString() + '\n' +
        'Equipment: $' + Math.round(t.equip).toLocaleString() + '\n' +
        'Other/Indirect: $' + Math.round(t.other).toLocaleString() + '\n\n' +
        (t.perKwp > 0 ? Math.round(t.perKwp) + ' MXN/kWp' : ''),
        ui.ButtonSet.OK);
    }
  } catch(e) {
    try { _setArgiaProgress(5, 5, '\u274C Error'); } catch(_) {}
    engineLog(ss, 'InstallCost', 'ERROR', e.message + '\n' + e.stack);
    ui.alert('Installation Error', e.message, ui.ButtonSet.OK);
  }
}

// ---------------------------------------------------------------------------
// SETUP ONLY — menu shortcut
// DEPRECATED 2026-04-24 Phase 2a: install inputs now live on INPUT_INSTALL.
// Kept as a compatibility stub that redirects to setupInputInstall().
// ---------------------------------------------------------------------------
function runSetupInstallInputs() {
  setupInputInstall();
}
