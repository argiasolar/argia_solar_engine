// =============================================================================
// ARGIA ENGINE -- File: 13_CalcInstallCost.gs
// Installation cost calculation driven by INSTALL_DB library.
//
// FLOW:
//   setupInstallInputsSection(ss)             -- one-time: adds rows to INPUT_DESIGN
//   readInstallDrivers(ss,inp,invBank,dc,ac,lay) -> drivers{}
//   loadInstallLib(ss)                        -> lib{}
//   calcInstallCost(lib, drivers)             -> result{}
//   writeInstallationV2(ss, result, drivers)  -> INSTALLATION_v2 +
//                                                95_INSTALL_DRIVER_MAP_v2
//
// ENTRY POINTS:
//   runInstallCostStandalone() -- menu item (computes only; engine step 12
//                                 in runArgiaEngine() handles the v2 writes)
// =============================================================================

// ---------------------------------------------------------------------------
// bessItemGatedToZero(item, driverQtyVal) -> bool
// True when an install line must be forced to zero because it is a BESS item
// (driverKey starts with 'BESS_') whose driver resolved to 0 -- i.e. the
// battery is disabled or that BESS quantity is genuinely zero. Used by
// computeOneItem to stop the fixed-cost paths (OTHER_FIXED / LABOR_FIXED_MH)
// from flooring the quantity to minQty/1 and billing for storage that is not
// in the project. Kept at module scope (not nested) so it is unit-testable
// without a live workbook. See tests_regression: Pass 1 quantity guards.
// ---------------------------------------------------------------------------
function bessItemGatedToZero(item, driverQtyVal) {
  return !!(item && item.driverKey &&
            item.driverKey.indexOf('BESS_') === 0 &&
            driverQtyVal === 0);
}

// ---------------------------------------------------------------------------
// INSTALL_TARGET_MH_PER_KWP  (Pass 3 calibration)
// Total productive field-labour target, in man-hours per kWp, for the whole
// install. The old per-section MH/kWp benchmarks in INPUT_DESIGN squashed the
// job to ~1 MH/kWp; this single global target replaces that. It is intentionally
// a code constant so it is trivial to tune and lives in version control. A
// per-project override can be set in the optional INPUT_INSTALL cell
// benchTotalMhKwp (read in applyKwpBenchmarks); when that cell is blank this
// default is used. Set to 0 to fall back to the legacy per-section benchmarks.
// ---------------------------------------------------------------------------
var INSTALL_TARGET_MH_PER_KWP = 0;   // 0 = no MH-target scaling (use DB productivity as-is). Set >0 (e.g. 4-5) to normalise labour to that MH/kWp.

// ---------------------------------------------------------------------------
// applyTotalMhTarget(result, kWp, targetMhPerKwp) -> {applied, scale, ...}
// PURE. Scales every productive LABOR item proportionally so the sum of their
// man-hours equals targetMhPerKwp x kWp, preserving item-level proportions.
// Equipment / other / INDIRECT (percent) costs are untouched; day-driven items
// are re-derived by the caller afterwards. No spreadsheet access, so it is
// unit-testable. Returns a summary for logging.
// ---------------------------------------------------------------------------
function applyTotalMhTarget(result, kWp, targetMhPerKwp) {
  var targetMH = targetMhPerKwp * kWp;
  var isLabor = function (r) {
    return r.item.section !== 'INDIRECT' &&
           r.item.costType.indexOf('LABOR') !== -1 && r.mhComputed > 0;
  };
  var matched  = (result.items || []).filter(isLabor);
  var beforeMH = matched.reduce(function (s, r) { return s + r.mhComputed; }, 0);
  if (!(beforeMH > 0) || !(targetMH > 0)) {
    return { applied: false, scale: 1, targetMH: targetMH, beforeMH: beforeMH, afterMH: beforeMH };
  }
  var scale = targetMH / beforeMH;
  matched.forEach(function (res) {
    var oldMH = res.mhComputed;
    res.mhComputed = oldMH * scale;
    res.laborMxn   = res.mhComputed * res.roleRateVal;
    res.totalMxn   = res.laborMxn + res.equipMxn + res.otherMxn;
    res.formulaTrace += ' \u2551 total bench: ' + targetMhPerKwp + ' MH/kWp \u00d7 ' +
      kWp.toFixed(0) + ' kWp \u2192 ' + targetMH.toFixed(1) + ' MH total (\u00d7' +
      scale.toFixed(2) + ' from DB ' + oldMH.toFixed(1) + ' MH)';
  });
  var afterMH = matched.reduce(function (s, r) { return s + r.mhComputed; }, 0);
  return { applied: true, scale: scale, targetMH: targetMH, beforeMH: beforeMH, afterMH: afterMH };
}

// ---------------------------------------------------------------------------
// deriveInstallQuantities(raw, ctx) -> {anchorCount, conduitM, trayM, derived}
// PURE. Fills quantity drivers that would otherwise default to 0 (and silently
// delete their labour) from geometry/structure. An explicit, positive value in
// `raw` always wins -- we only derive when the field is blank/0. `derived`
// flags which fields were auto-filled (for the trace / audit).
//   conduitM  <- layout-derived DC + AC conduit runs.
//   trayM     <- main cable-tray spine along the array length.
//   anchorCount <- module count, structure-aware: attached/rail ~1 per 2
//                  modules; ballasted/membrane ~1 per 8 (wind tie-downs only).
// ---------------------------------------------------------------------------
function deriveInstallQuantities(raw, ctx) {
  raw = raw || {}; ctx = ctx || {};
  var out = {
    anchorCount: Number(raw.anchorCount) || 0,
    conduitM   : Number(raw.conduitM)    || 0,
    trayM      : Number(raw.trayM)       || 0,
    derived    : {}
  };
  var modules = Number(ctx.panelQty) || 0;
  var s  = String(ctx.structure || '').toUpperCase();
  var rf = String(ctx.roofType  || '').toUpperCase();
  var ballasted = /BALLAST|RM10|EVO|LASTRE|PESO/.test(s) || /TPO|PVC|MEMBRAN/.test(rf);

  if (!(out.anchorCount > 0) && modules > 0) {
    out.anchorCount = ballasted ? Math.ceil(modules / 8) : Math.ceil(modules / 2);
    out.derived.anchorCount = true;
  }
  if (!(out.conduitM > 0)) {
    out.conduitM = Math.ceil((Number(ctx.dcConduitM) || 0) + (Number(ctx.acConduitM) || 0));
    if (out.conduitM > 0) out.derived.conduitM = true;
  }
  if (!(out.trayM > 0)) {
    out.trayM = Math.ceil(Number(ctx.arrayLength) || 0);
    if (out.trayM > 0) out.derived.trayM = true;
  }
  return out;
}

// ---------------------------------------------------------------------------
// SHEET NAME CONSTANTS (install-specific library tables; not the output
// tabs -- those live in V2_SHEETS via templates/TemplateRegistry.js).
// ---------------------------------------------------------------------------
var SH_IC = {
  LIB         : '90M_INSTALL_LIB',
  FACTORS     : '91M_INSTALL_FACTORS',
  ROLE_RATES  : '92M_INSTALL_ROLE_RATES',
  EQUIP_RATES : '93M_INSTALL_EQUIP_RATES',
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
// -- Indirect-labour roles: PEOPLE billed per project-day (site supervisor,
// -- QAQC, HSE officer). Historically their cost landed in the OTHER bucket,
// -- which understated TOTAL LABOR by ~50% on big jobs. They are now routed
// -- into a labelled "indirect labour" sub-bucket that rolls up into TOTAL
// -- LABOR. Classified by SUBSECTION (explicit + easy to extend).
var IC_INDIRECT_LABOR_SUBSECTIONS = ['SUPERVISION', 'QAQC', 'HSE OFFICER'];
function _icIsIndirectLabor(item) {
  return IC_INDIRECT_LABOR_SUBSECTIONS.indexOf(
    String((item && item.subsection) || '').toUpperCase()) !== -1;
}

// -- PURE: the per-result contribution to the section + grand totals, honouring
// -- the bucket. INDIRECT_LABOR results move their cost from OTHER into LABOR
// -- (and into the laborIndirect sub-total). Total contribution is unchanged,
// -- so the grand total is preserved by the reclassification. INDIRECT-section
// -- (percentage) items contribute nothing here (handled in their own pass).
function _icBucketDeltas(result) {
  var zero = { labor:0, laborDirect:0, laborIndirect:0, equip:0, other:0, mh:0,
               secLabor:0, secEquip:0, secOther:0, secLaborIndirect:0, secTotal:0 };
  if (!result || !result.item || result.item.section === 'INDIRECT') return zero;
  if (result.bucket === 'INDIRECT_LABOR') {
    return { labor: result.otherMxn, laborDirect: 0, laborIndirect: result.otherMxn,
             equip: 0, other: 0, mh: 0,
             secLabor: result.otherMxn, secEquip: 0, secOther: 0,
             secLaborIndirect: result.otherMxn, secTotal: result.totalMxn };
  }
  return { labor: result.laborMxn, laborDirect: result.laborMxn, laborIndirect: 0,
           equip: result.equipMxn, other: result.otherMxn, mh: result.mhComputed,
           secLabor: result.laborMxn, secEquip: result.equipMxn, secOther: result.otherMxn,
           secLaborIndirect: 0, secTotal: result.totalMxn };
}

// -- PURE: build the per-role man-hours / labour breakdown from a results list.
// -- Σ(role MH) == Σ(item MH) == totals.totalMH by construction (every task-MH
// -- item carries a laborRole; equip/other/percent items have mhComputed 0).
// -- MUST be rebuilt from the FINAL items after any MH scaling (kWp benchmarks),
// -- or the breakdown goes stale and inflates vs the total (the T6 bug).
function _icBuildRoleAgg(items) {
  var roleAgg = {};
  (items || []).forEach(function (res) {
    if (!res || !res.item || !res.item.laborRole) return;
    if (!(res.mhComputed > 0) && !(res.laborMxn > 0)) return;  // skip pure equip/other/percent
    var role = res.item.laborRole;
    if (!roleAgg[role]) roleAgg[role] = { mh: 0, cost: 0, rate: res.roleRateVal || 0 };
    roleAgg[role].mh   += res.mhComputed;
    roleAgg[role].cost += res.laborMxn;
  });
  return roleAgg;
}

var IC_SECTIONS = [  'AC','DC','RACKING SYSTEM','CONNECTION','SAFETY','GENERAL SITE','EQUIPMENT','BESS','INDIRECT'
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

  // Pass 3: auto-derive blank quantity drivers from geometry/structure instead
  // of letting them default to 0 (which silently deletes anchoring, conduit and
  // tray labour). An explicit INPUT_INSTALL value always wins. Pure helper so
  // the rule is unit-testable; see deriveInstallQuantities().
  var _derivedQ = deriveInstallQuantities(
    { anchorCount: anchorCount, conduitM: conduitM, trayM: trayM },
    { panelQty   : inp.panelQty,
      structure  : inp.structure,
      roofType   : inp.roofType,
      dcConduitM : (lay && lay.dcConduitM) || 0,
      acConduitM : (lay && lay.acConduitM) || 0,
      arrayLength: (lay && lay.arrayLength) || 0 });
  anchorCount = _derivedQ.anchorCount;
  conduitM    = _derivedQ.conduitM;
  trayM       = _derivedQ.trayM;

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
  // Tier 2 cutover (2026-05-26): switched from legacy loadStructureDb /
  // resolveStructure (08_WriteBOM.js, deleted) to the v2 helpers in
  // writers_v2/helpers/BomDbHelpers.js. Same logic, same return shape.
  var structureDb   = _bomV2_loadStructureDb(ss);
  var structureInfo = _bomV2_resolveStructure(structureDb, inp.structure || '');
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
      subsection       : String(r['SUBSECTION']              || '').trim().toUpperCase(),
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

    // BESS gating. When the battery is disabled (or a BESS quantity is genuinely
    // zero) every BESS_* driver is 0. Without this guard the fixed-cost paths
    // (OTHER_FIXED case B and LABOR_FIXED_MH) floor the quantity to minQty/1 and
    // bill for storage equipment that is not in the project -- the ~71k MXN leak
    // seen on battery=NO via BESS-I-03/15/17. Decision is in a top-level pure
    // helper (bessItemGatedToZero) so it is unit-testable without a workbook.
    if (bessItemGatedToZero(item, result.driverQtyVal)) {
      result.formulaTrace =
        'BESS_* driver = 0 (battery disabled / zero qty) -> item gated to 0';
      return result;
    }

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
    result.bucket   = _icIsIndirectLabor(item) ? 'INDIRECT_LABOR' : 'STANDARD';
    result.formulaTrace = _buildFormulaTrace(item, result, drivers);
    return result;
  }

  // -- Accumulator: pushes a result into items[] (or sets at index) and
  // -- updates section + grand totals. Skips INDIRECT (PERCENT items handled
  // -- in their own pass at the end). Returns the result.
  function accumulateResult(result) {
    if (result.item.section !== 'INDIRECT') {
      var sec = result.item.section;
      if (!sectionTotals[sec]) sectionTotals[sec] = { labor: 0, equip: 0, other: 0, laborIndirect: 0, total: 0 };
      var d = _icBucketDeltas(result);
      sectionTotals[sec].labor         += d.secLabor;
      sectionTotals[sec].equip         += d.secEquip;
      sectionTotals[sec].other         += d.secOther;
      sectionTotals[sec].laborIndirect += d.secLaborIndirect;
      sectionTotals[sec].total         += d.secTotal;
      grandLabor         += d.labor;
      grandLaborDirect   += d.laborDirect;
      grandLaborIndirect += d.laborIndirect;
      grandEquip         += d.equip;
      grandOther         += d.other;
      grandMH            += d.mh;
    }
    return result;
  }

  // -- Setup: empty items[] (filled in lib order) + zeroed section/grand totals
  var items = new Array(lib.length);
  var sectionTotals = {};
  IC_SECTIONS.forEach(function(sec) {
    sectionTotals[sec] = { labor: 0, equip: 0, other: 0, laborIndirect: 0, total: 0 };
  });
  var grandLabor = 0, grandEquip = 0, grandOther = 0, grandMH = 0;
  var grandLaborDirect = 0, grandLaborIndirect = 0;

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
  // Insurance base = direct labour + equip (unchanged from before reclassification).
  drivers.laborEquipSubtotal = grandLaborDirect + grandEquip;
  // Contingency base = full subtotal (indirect labour now lives in grandLabor).
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
    // Pass 6b: rebuild the trace now that the subtotal basis is known. computeOneItem
    // built it in stage A when laborEquipSubtotal/installSubtotal were still undefined
    // (-> "$0"); without this rebuild the row shows a $0 trace despite a correct value.
    result.formulaTrace = _buildFormulaTrace(item, result, drivers);

    indirectOther += result.otherMxn;
    if (!sectionTotals['INDIRECT']) sectionTotals['INDIRECT'] = {labor:0,equip:0,other:0,total:0};
    sectionTotals['INDIRECT'].other += result.otherMxn;
    sectionTotals['INDIRECT'].total += result.otherMxn;
  });

  grandOther += indirectOther;

  // -- Grand totals ----------------------------------------------------------
  var grandTotal = grandLabor + grandEquip + grandOther;
  var totals = {
    labor        : grandLabor,           // honest TOTAL LABOR (direct + indirect)
    laborDirect  : grandLaborDirect,     // MH-based trade labour
    laborIndirect: grandLaborIndirect,   // supervision / QAQC / HSE (per-day roles)
    equip        : grandEquip,
    other        : grandOther,           // now excludes the per-day roles
    total        : grandTotal,
    perWp        : drivers.projectDcWp  > 0 ? grandTotal / drivers.projectDcWp  : 0,
    perKwp       : drivers.projectDcKwp > 0 ? grandTotal / drivers.projectDcKwp : 0,
    perM2        : drivers.arrayGrossAreaM2 > 0 ? grandTotal / drivers.arrayGrossAreaM2 : 0,
    // Man-hours summary
    totalMH      : grandMH,
    impliedDays  : (drivers.crewSize > 0 && grandMH > 0)
                   ? Math.round(grandMH / drivers.crewSize / 8) : 0,
    avgRateMxnMH : grandMH > 0 ? Math.round(grandLaborDirect / grandMH) : 0,
  };

  // -- Role aggregation for man-hours block -----------------------------------
  // Built from items here; REBUILT in applyKwpBenchmarks after MH scaling so the
  // breakdown always reconciles to totals.totalMH (see _icBuildRoleAgg).
  var roleAgg = _icBuildRoleAgg(items);

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
    // Benchmark cells are OPTIONAL overrides. If the key isn't registered in
    // INPUT_MAP (or the cell is blank), treat as "no override" -> null, rather
    // than throwing. (Was: readInput() threw 'unknown key' and aborted the run.)
    if (!INPUT_MAP[key]) return null;
    var v = parseFloat(readInput(ss, key));
    return (v > 0) ? v : null;
  }

  // TOTAL install-labour target (Pass 3). A single MH/kWp number for ALL
  // productive labour, which supersedes the per-section benchmarks below. The
  // old per-section cells squashed the job to ~1 MH/kWp; this scales every
  // labour item proportionally so the sum hits the target. Per-project override
  // in the optional INPUT_INSTALL cell benchTotalMhKwp; blank -> the code
  // constant INSTALL_TARGET_MH_PER_KWP. Set the effective target to 0 to fall
  // back to the legacy per-section benchmarks.
  var totalTarget = readBench('benchTotalMhKwp');
  // Default OFF (preserve DB productivity). Set INSTALL_TARGET_MH_PER_KWP > 0 (or
  // the benchTotalMhKwp cell) to normalise all productive labour to that MH/kWp.
  if (totalTarget == null) totalTarget = INSTALL_TARGET_MH_PER_KWP;

  var anyApplied = false;

  if (totalTarget > 0) {
    var _tr = applyTotalMhTarget(result, kWp, totalTarget);
    anyApplied = _tr.applied;
    if (_tr.applied) {
      engineLog(ss, 'InstallCost', 'INFO',
        'kWp bench TOTAL: ' + totalTarget + ' MH/kWp \u00d7 ' + kWp.toFixed(1) +
        ' kWp = ' + _tr.targetMH.toFixed(1) + ' MH target | DB was ' +
        _tr.beforeMH.toFixed(1) + ' MH | scale \u00d7' + _tr.scale.toFixed(2));
    }
  } else {
  // ----- legacy per-section benchmarks (only when total target disabled) -----
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
  } // end legacy per-section benchmarks (else)

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
      // Pass 6b: REBUILD the trace from the new driver instead of appending to the
      // stale stage-C line. The append-only version left the main line showing the
      // pre-benchmark day count (e.g. "24 days") and its cost while the value was
      // correctly recomputed at newDays -- the "day-doubling" trace mismatch.
      r.formulaTrace  = _buildFormulaTrace(item, r, drivers) +
                        ' \u2551 days re-derived: ' + oldDays + '\u2192' + newDays +
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

  // [T6] REBUILD the role breakdown from the SCALED items. Without this the
  // breakdown keeps calcInstallCost's pre-benchmark MH and inflates ~2.9x vs the
  // total (Σ role MH now reconciles to totals.totalMH).
  result.roleAgg = _icBuildRoleAgg(result.items);

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
// Tier 2 cutover (2026-05-26): legacy writeInstallCost + writeInstallDriverMap
// REMOVED (~370 lines deleted). v2 replacements live in:
//   - writers_v2/WriteInstallationV2.js -> writeInstallationV2
//   - writers_v2/WriteInstallationV2.js -> writeInstallationDriverMapV2
// runInstallCost below now only computes the result and returns it -- the
// engine's Step 12-v2 calls the v2 writers to render the sheets.
// ---------------------------------------------------------------------------

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

  // Tier 2 cutover (2026-05-26): legacy writeInstallCost +
  // writeInstallDriverMap functions were deleted from this file (~370
  // lines). runInstallCost now ONLY computes the result and returns it;
  // the engine's Step 12 (runArgiaEngine) calls writeInstallationV2 to
  // render both INSTALLATION_v2 and 95_INSTALL_DRIVER_MAP_v2.

  // Attach drivers to the returned result so writeInstallationV2 can
  // feed both into the v2 writer without re-running the calc layers.
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
        applyBessAuthoritativeContext(installCtx, bessResult);  // A2c: coupling + resolved voltages
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

    // Render INSTALLATION_v2 (+ 95_INSTALL_DRIVER_MAP_v2). runInstallCost only
    // COMPUTES the result; the writer was moved into the full engine's Step 12,
    // so the standalone "Generate Installation" menu path must render the sheet
    // itself -- otherwise it silently produces no INSTALLATION_v2. Mirrors
    // runArgiaEngine Step 12-v2; try/catch isolates sheet-I/O failures.
    if (result) {
      _setArgiaProgress(4, 5, 'Writing INSTALLATION_v2\u2026');
      try {
        setupInstallationTemplate(ss);
        writeInstallationV2(ss, result, result.drivers);
        writeInstallationDriverMapV2(ss, result.drivers, result);
        // Batch 1 / B1.4: freshness stamp for the tab this runner just wrote.
        if (typeof argiaStampOutputs === 'function') {
          argiaStampOutputs(ss, ['INSTALLATION_v2']);
        }
      } catch (wErr) {
        engineLog(ss, 'InstallCost', 'WARNING',
          'INSTALLATION_v2 write failed: ' + wErr.message + '\n' + (wErr.stack || ''));
      }
    }

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
