// =============================================================================
// ARGIA ENGINE v7 -- File: 00_Main.gs
// Entry point, constants, menu.
//
// ARCHITECTURE:
//   readInputs()         -> inp{}
//   lookupPanel()        -> panel{}
//   buildInverterBank()  -> invBank[]
//   loadNomConstants()   -> nom{}        << ALL engineering limits from NOM_DB
//   runValidation()      -> validation{} << BLOCKS on critical errors
//   readElecTables()     -> tbls{}
//   calcDC(inp, panel, invBank, nom, tbls)  -> dc{}
//   calcAC(inp, invBank, nom, tbls, dc)     -> ac{}
//   calcLayout(inp, dc, ac, nom)            -> lay{}
//   writeMdcV2(ss, inp, panel, invBank, dc, ac, lay, nom, bessResult)
//   writeBomV2(ss, inp, panel, invBank, dc, ac, lay, nom, bessResult)
//
// DATA CONTRACT RULE: every calc function receives ONLY typed objects.
// No function reads from the spreadsheet directly except readInputs/readElecTables/load*.
// =============================================================================

// ---------------------------------------------------------------------------
// SHEET NAME CONSTANTS -- must match exact tab names in Google Sheet.
//
// Output sheets (MDC, BOM, INSTALLATION, CFE_OUTPUT, PROJECT_CARD, RFQ_*)
// are NOT in this object -- the engine writes only the v2 tabs (MDC_v2,
// BOM_v2, ...) which are listed in V2_SHEETS in templates/TemplateRegistry.js.
// Legacy entries (SH.MDC, SH.BOM, SH.INSTALL_COST, SH.CFE_OUTPUT) were
// removed 2026-05-27 (v3.7.5) when the codebase went v2-only.
// ---------------------------------------------------------------------------
var SH = {
  // Input sheets
  INPUT_GENERAL  : 'INPUT_GENERAL',
  INPUT_DESIGN   : 'INPUT_DESIGN',
  INPUT_PROJECT  : 'INPUT_PROJECT',
  INPUT_INSTALL  : 'INPUT_INSTALL',
  INPUT_CFE      : 'INPUT_CFE',
  INPUT_BESS     : 'INPUT_BESS',
  INPUT_BAAS     : 'INPUT_BAAS',
  // Simulation worksheets
  CFE_SIM        : 'CFE_SIMULATION',
  BESS_SIM       : 'BESS_SIMULATION',
  // Master-data mirrors / lookup tables
  PANELS_MIRROR  : '11M_PRODUCTS_PANELS',
  INV_MIRROR     : '12M_PRODUCTS_INVERTERS',
  BESS_MIRROR    : '16M_PRODUCTS_BESS',
  ELEC_TABLES    : '15M_ELEC_TABLES',
  // Installation library tables
  INSTALL_LIB        : '90M_INSTALL_LIB',
  INSTALL_FACTORS    : '91M_INSTALL_FACTORS',
  INSTALL_ROLE_RATES : '92M_INSTALL_ROLE_RATES',
  INSTALL_EQUIP_RATES: '93M_INSTALL_EQUIP_RATES',
  // Audit / logging
  LOGS           : 'LOGS',
};

// ---------------------------------------------------------------------------
// MDC COLUMN CONSTANTS (1-based)
// ---------------------------------------------------------------------------
var MDC_COL = {
  LABEL  : 2,  // B -- static, never overwritten
  VALUE  : 3,  // C -- engine writes here
  UNIT   : 4,  // D -- static
  SOURCE : 5,  // E -- static
  STATUS : 6,  // F -- engine writes PASS/FAIL/REVIEW
};

// ---------------------------------------------------------------------------
// MDC ROW MAP (1-based) -- single source of truth for both writer + tests.
// Updated 2026-04-24 Phase 2e: row consolidation pass.
//   - I_DESIGN: was row 22 (iDesign = Imax×1.25), now row 21 (Isc×1.5625, consolidated from rows 21+22)
//   - APPARENT_REQ: was rows 64 (apparent) + 65 (apparent×1.20), now row 64 (consolidated, with 20% margin)
//   - Removed legacy rows 82 (duplicate "Criterio final") and 88 (mislabeled "Cable DC total")
//   - All downstream rows shift up accordingly
// ---------------------------------------------------------------------------
// MDC ROW MAP (1-based) -- single source of truth for both writer + tests.
// Updated 2026-04-25 Phase 2e: column header row moved from row 1 to row 4
// to sit visually under the banner. All data rows shift down by 1.
//   - HEADER row 1 (legacy) → COLUMN_HEADERS row 4
//   - EMISSION_STATUS row 4 → row 5
//   - All section + data rows shift down by 1
//   - Net: layout ends at row 97 (was 96)
// ---------------------------------------------------------------------------
var MDC_ROW = {
  // Banner area (rows 2-3)
  BANNER_TITLE: 2,
  BANNER_SUBTITLE: 3,
  // Column header row (DESCRIPCIÓN | VALOR | UNIDAD | ...)
  COLUMN_HEADERS: 4,
  // Emission status banner
  EMISSION_STATUS: 5,

  // §0 GENERALES (rows 6-18, was 5-17)
  SEC0_HEADER: 6,           // was 5
  PROJECT: 7,               // was 6
  CLIENT: 8,                // was 7
  MODULE: 9,                // was 8
  INVERTER: 10,             // was 9
  QTY_MODULES: 11,          // was 10
  QTY_INVERTERS: 12,        // was 11
  MODS_PER_STRING: 13,      // was 12
  STRINGS_PER_INV: 14,      // was 13
  DC_KW: 15,                // was 14
  AC_KW: 16,                // was 15
  DC_AC_RATIO: 17,          // was 16
  AC_VOLTAGE: 18,           // was 17

  // §1 MEMORIA DC (rows 20-32, was 19-31)
  SEC1_HEADER: 20,          // was 19
  ISC: 21,                  // was 20
  I_DESIGN: 22,             // was 21 (consolidated)
  FT_DC: 23,                // was 22
  FAG_DC: 24,               // was 23
  AMP_REQ_DC: 25,           // was 24
  COND_DC: 26,              // was 25
  AREA_DC: 27,              // was 26
  OCPD_DC: 28,              // was 27
  EGC_DC: 29,               // was 28
  VDROP_DC: 30,             // was 29
  CONDUIT_DC: 31,           // was 30
  RESULT_DC: 32,            // was 31

  // §1.1 VALIDACION VOLTAJE (rows 34-42, was 33-41)
  SEC11_HEADER: 34,         // was 33
  VOC_COLD: 35,             // was 34
  VMP_HOT: 36,              // was 35
  MIN_MODS: 37,             // was 36
  MAX_MODS: 38,             // was 37
  ACTUAL_MODS: 39,          // was 38
  CHECK_WINDOW: 40,         // was 39
  CHECK_DC_LIMIT: 41,       // was 40
  STR03_MPPT: 42,           // was 41

  // §2 SALIDA AC INVERSOR (rows 43-54, was 42-53)
  SEC2_HEADER: 43,          // was 42
  I_AC_NOM: 44,             // was 43
  OCPD_AC_INV: 45,          // was 44
  FT_AC: 46,                // was 45
  FAG_AC: 47,               // was 46
  AMP_REQ_AC: 48,           // was 47
  COND_AC: 49,              // was 48
  AREA_AC: 50,              // was 49
  EGC_AC: 51,               // was 50
  VDROP_AC: 52,             // was 51
  CONDUIT_AC: 53,           // was 52
  RESULT_AC: 54,            // was 53

  // §3 TABLERO AC / ALIMENTADOR (rows 55-67, was 54-66)
  SEC3_HEADER: 55,          // was 54
  I_TOTAL_AC: 56,           // was 55
  MAIN_BREAKER: 57,         // was 56
  PARALLEL_RUNS: 58,        // was 57
  I_PER_RUN: 59,            // was 58
  COND_MAIN: 60,            // was 59
  AREA_MAIN: 61,            // was 60
  EGC_MAIN: 62,             // was 61
  VDROP_FEEDER: 63,         // was 62
  CONDUIT_MAIN: 64,         // was 63
  APPARENT_REQ: 65,         // was 64 (consolidated)
  TRANSFORMER: 66,          // was 65
  RESULT_FEEDER: 67,        // was 66

  // §4 BANDERAS REVISION (rows 68-72, was 67-71)
  SEC4_HEADER: 68,          // was 67
  FLAG_LAYOUT: 69,          // was 68
  FLAG_WINDOW: 70,          // was 69
  FLAG_DC_LIMIT: 71,        // was 70
  FLAG_FINAL: 72,           // was 71

  // §5 SUPUESTOS (rows 74-81, was 73-80)
  SEC5_HEADER: 74,          // was 73
  TEMP_MIN: 75,             // was 74
  TEMP_MAX: 76,             // was 75
  ROOF_CLEARANCE: 77,       // was 76
  LEN_DC: 78,               // was 77
  LEN_AC: 79,               // was 78
  LEN_FEEDER: 80,           // was 79
  POWER_FACTOR: 81,         // was 80

  // §5.5 REFERENCIAS (rows 82-86, was 81-85)
  SEC55_HEADER: 82,         // was 81
  REF_UNIFILAR: 83,         // was 82
  REF_LAYOUT: 84,           // was 83
  REF_PROTECCIONES: 85,     // was 84
  REF_CEDULA: 86,           // was 85

  // §6 LAYOUT / ESCALADO (rows 87-93, was 86-92)
  SEC6_HEADER: 87,          // was 86
  AREA_GROSS: 88,           // was 87
  ARRAY_W: 89,              // was 88
  ARRAY_L: 90,              // was 89
  CABLE_DC_TOTAL: 91,       // was 90
  CABLE_AC_TOTAL: 92,       // was 91
  STATUS_SCALING: 93,       // was 92

  // Footer (rows 96-97, was 95-96)
  LEGEND: 96,               // was 95
  TIMESTAMP: 97,            // was 96

  // §7 BESS / ALMACENAMIENTO (rows 100-110) -- Increment 4b-3
  // Placed below the footer (gap at 98-99) so the existing layout and any
  // references to rows 96-97 are untouched. The MDC writer clears rows 6-120,
  // so this band is already inside the cleared range. The section only
  // renders when the project includes a battery; PV-only runs leave it blank.
  SEC7_HEADER:     100,
  BESS_MODEL:      101,     // battery product / ID + strategy
  BESS_CAPACITY:   102,     // nominal capacity kWh
  BESS_POWER:      103,     // nominal power kW
  BESS_USABLE:     104,     // usable capacity kWh (after SoC/deg/backup)
  BESS_COUPLING:   105,     // DC_COUPLED / AC_COUPLED
  BESS_CIRC_STAT:  106,     // circuit sizing status / "pendiente" line
  BESS_CIRC_RUN1:  107,     // reserved: run 1 conductor/OCPD/EGC (4b-2.5)
  BESS_CIRC_RUN2:  108,     // reserved: run 2 (AC-coupled only)
  BESS_BUSBAR:     109,     // coupling-aware busbar 120% note
  BESS_NOM_CITE:   110,     // NOM citation row
  // BDF-7: new check rows
  BESS_VDROP_DC:   111,     // DC voltage drop (NOM 690 / 250)
  BESS_VDROP_AC:   112,     // AC voltage drop (only AC_COUPLED)
  BESS_DISCONNECT: 113,     // AC disconnect verification (NOM 690-13/15)
  BESS_GEC:        114,     // GEC sizing (NOM 250-66)
  BESS_BOS_SUMMARY: 115,    // BoS line count + provenance summary
};

// ---------------------------------------------------------------------------
// MDC column indices + provenance / issuance constants
// Moved here from 07_WriteMDC.js by Tier 2 cutover (2026-05-26). The legacy
// file was deleted; the v2 writer in writers_v2/WriteMdcV2.js references
// these globals.
// ---------------------------------------------------------------------------
var MC = {
  LABEL      : 2,   // B
  VALUE      : 3,   // C
  UNIT       : 4,   // D
  STATUS     : 5,   // E  -- PASS/FAIL/REVIEW (moved from H to E in Phase 2e)
  CITATION   : 6,   // F  -- NOM article / table
  FORMULA    : 7,   // G  -- formula trace
};
// PROVENANCE column was dropped from the sheet layout, but the constants
// are kept so existing row() call sites compile. The 4th argument is
// silently ignored by the writer.
var PROV = {
  STANDARD   : 'STANDARD',
  INPUT      : 'INPUT',
  DB         : 'DB',
  ASSUMPTION : 'ASSUMPTION',
  AUTO_CALC  : 'AUTO-CALC',
};
// Issuance status constants -- rendered in MDC.C72.
var ISSUE = {
  PASS       : 'EMITTABLE',
  OBS        : 'EMITTABLE WITH OBSERVATIONS',
  BLOCKED    : 'NOT EMITTABLE',
};


// ---------------------------------------------------------------------------
// BOM ROW MAP (1-based) -- single source of truth for BOM writer + tests.
// Created 2026-04-25 Phase 2e. Mirrors the pattern used for MDC_ROW above.
// Updated 2026-04-25 Phase 2e batch 2: shifted all values by +3 to make
// room for banner at rows 1-3 (logo + title + subtitle).
//
// The BOM has fixed-row sections with reserved blank rows for additional
// items (multi-panel, multi-inverter, multi-structure projects). Subtotal
// rows are at fixed positions so SUM ranges in the writer are stable.
//
// Per-inverter AC block: AC_INV_BLOCK_START is the START of the per-inverter
// pattern, each inverter gets 4 rows (cable, EGC, breaker, conduit).
// ---------------------------------------------------------------------------
var BOM_ROW = {
  // Banner (rows 1-3) — logo + title + subtitle
  BANNER_TITLE:         2,
  BANNER_SUBTITLE:      3,

  // Project metadata + headers + exchange rate (rows 4-6)
  PROJECT_META:         4,   // engine writes "BOM -- TESTPROJ-001 | ..." string
  HEADERS:              5,   // # | DESCRIPCION | QTY | UNIDAD | PRECIO U | TOTAL
  EXCHANGE_RATE:        6,   // "TC USD/MXN:" + value (referenced as $F$6 in formulas)

  // §1 PANELES (rows 7-13)
  SEC_PANELS:           7,
  PANEL_PRIMARY:        8,
  // rows 9-12 reserved for additional panel models
  SUBTOTAL_PANELS:      13,

  // §2 INVERSORES (rows 14-20)
  SEC_INVERTERS:        14,
  INVERTER_PRIMARY:     15,
  // rows 16-19 reserved for additional inverter models
  SUBTOTAL_INVERTERS:   20,

  // §3 ESTRUCTURA (rows 21-25)
  SEC_STRUCTURE:        21,
  STRUCTURE_PRIMARY:    22,
  STRUCTURE_SECONDARY:  23,
  STRUCTURE_INVERTER:   24,
  SUBTOTAL_STRUCTURE:   25,

  // §4 ELECTRICO DC (rows 26-35)
  SEC_DC:               26,
  DC_CABLE:             27,
  DC_GROUNDING:         28,
  DC_MC4:               29,
  DC_OCPD:              30,
  DC_CONDUIT:           31,
  DC_RSD:               32,
  // rows 33-34 reserved
  SUBTOTAL_DC:          35,

  // §5 ELECTRICO AC (rows 36-63)
  SEC_AC:               36,
  AC_FEEDER:            37,
  AC_EGC:               38,
  AC_BREAKER:           39,
  AC_CONDUIT:           40,
  AC_PANELBOARD:        41,
  // Per-inverter block: rows 42-61 (up to 5 inverter types × 4 rows each)
  AC_INV_BLOCK_START:   42,
  AC_INV_BLOCK_PER_INV: 4,
  AC_INV1_CABLE:        42,
  AC_INV1_EGC:          43,
  AC_INV1_BREAKER:      44,
  AC_INV1_CONDUIT:      45,
  SUBTOTAL_AC:          63,

  // §6 TRANSFORMADOR (rows 64-68)
  SEC_TRANSFORMER:      64,
  TRANSFORMER:          65,
  // rows 66-67 reserved
  SUBTOTAL_TRANSFORMER: 68,

  // §7 MONITOREO + PERMISOS (rows 69-78)
  SEC_MONITORING:       69,
  MON_DATALOGGER:       70,
  MON_METER:            71,
  MON_UVIE:             72,
  MON_CFE:              73,
  MON_COMMISSIONING:    74,
  MON_THERMOGRAPHY:     75,
  // rows 76-77 reserved
  SUBTOTAL_MONITORING:  78,

  // §8 BESS (rows 79-91) - BDF-7
  // 12 line items + subtotal. Engine writes per calcBessBosQuantities output.
  // Rows that don't apply to a given coupling (DC_COUPLED skips AC lines)
  // are left blank with no qty/price.
  SEC_BESS:             79,
  BESS_BATTERY_LINE:    80,   // BESS-01 battery (per stack)
  BESS_DC_CABLE:        81,   // BESS-02
  BESS_DC_EGC:          82,   // BESS-03
  BESS_AC_CABLE:        83,   // BESS-04 (AC_COUPLED only)
  BESS_AC_EGC:          84,   // BESS-05 (AC_COUPLED only)
  BESS_DC_CONDUIT:      85,   // BESS-06
  BESS_AC_CONDUIT:      86,   // BESS-07 (AC_COUPLED only)
  BESS_DC_OCPD:         87,   // BESS-08
  BESS_AC_OCPD:         88,   // BESS-09 (AC_COUPLED only)
  BESS_AC_DISCONNECT:   89,   // BESS-10 (AC_COUPLED only)
  BESS_GEC_LINE:        90,   // BESS-11
  BESS_COMMISSIONING:   91,   // BESS-12
  SUBTOTAL_BESS:        92,

  // Footer (row 94)
  GRAND_TOTAL:          94,
};

// ---------------------------------------------------------------------------
// BOM COLUMN MAP (1-based)
// ---------------------------------------------------------------------------
var BOM_COL = {
  ITEM:        1,   // A — item number
  DESCRIPTION: 2,   // B — long descriptive text
  QTY:         3,   // C — quantity (drives line total formula)
  UNIT:        4,   // D — pcs / m / par / etc
  UNIT_PRICE:  5,   // E — price per unit (USD)
  TOTAL_USD:   6,   // F — line total USD (formula: =C*E)
  TOTAL_MXN:   7,   // G — line total MXN (formula: =F*$F$<EXCHANGE_RATE> where EXCHANGE_RATE=BOM_ROW.EXCHANGE_RATE, row 6)
  REFERENCE:   8,   // H — DB ref / NOM citation / note
  MEMORIA:     9,   // I — derivation / "why this number" (mirrors MDC formula column)
};

// ---------------------------------------------------------------------------
// PROJECT_CARD_v2 ROW + COLUMN MAP (Chunk 3, 2026-05-25)
// ---------------------------------------------------------------------------
// PC_v2 uses a fixed-row layout (unlike legacy PC which increments row++ as
// it writes). Fixed rows let the template and writer share addresses so:
//   - The template paints labels + section headers at known rows.
//   - The writer fills only values at the same known rows.
//   - Tests can assert "value X landed at row Y col Z" without simulating
//     the layout flow.
//
// LAYOUT (10 cols, mirrors legacy):
//   A=margin   B=label-left   C=USD-cost     D=MXN-cost   E=validation
//   F=spacer   G=label-right  H=USD-sales    I=MXN-sales  J=margin%
//
// COST CATEGORIES — 9 rows (legacy had 8; BESS is the new 9th).
//   PV-only rows show "—" / 0 in the BESS row, but the row stays in layout.
// ---------------------------------------------------------------------------
var PC_ROW = {
  // Banner (row 1) — title, project number, date
  TITLE:                1,

  // §0 BUSINESS CASE (rows 3-6)
  SEC_BUSINESS_HEADER:  3,
  BUSINESS_CUSTOMER:    4,
  BUSINESS_PROJECT:     5,
  BUSINESS_LOCATION:    6,

  // §1 PROJECT TEAM (rows 8-11)
  SEC_TEAM_HEADER:      8,
  TEAM_BIZ_MANAGER:     9,
  TEAM_DESIGNER:        10,
  TEAM_PROJ_MANAGER:    11,

  // §2 SCOPE OF WORK (cols B-E) + ADDITIONAL INFO (cols G-J) — rows 13-22
  // Both panes share the same row range; scope items in left, info labels right.
  // 8 row slots: enough for panels + up to 4 inverter banks + structure + BESS
  // (left), and the 6 info fields (right): power peak, system coverage,
  // installation type, selling price, cost, storage (BESS-only).
  SEC_SCOPE_HEADER:     13,
  SCOPE_ROW_FIRST:      14,
  SCOPE_ROW_LAST:       21,   // 8 rows total (14..21)
  // Additional Info fixed addresses (in the right pane, cols G-J):
  INFO_POWER_PEAK:      14,
  INFO_COVERAGE:        15,
  INFO_INSTALL_TYPE:    16,
  INFO_SELLING_PRICE:   17,
  INFO_COST:            18,
  INFO_STORAGE:         19,   // NEW for PC_v2 (BESS-only; "—" when disabled)

  // §3 SCHEDULE (rows 23-26)
  SEC_SCHEDULE_HEADER:  23,
  SCHEDULE_R1:          24,
  SCHEDULE_R2:          25,
  SCHEDULE_R3:          26,

  // §4 COST COMPARISON (rows 28-40)
  // Row 28: header band ("COST COMPARISON" + exchange rate)
  // Row 29: sub-banner: ESTIMATED COSTS | VALIDATION | SALES PRICE | MARGIN
  // Row 30: column units: USD | MXN | vs range | USD | MXN | %
  // Rows 31-39: the 9 cost categories
  // Row 40: TOTAL
  SEC_COST_HEADER:      28,
  COST_SUBBANNER:       29,
  COST_UNITS:           30,
  COST_PANELS:          31,
  COST_INVERTERS:       32,
  COST_STRUCTURE:       33,
  COST_ELEC_DC:         34,
  COST_ELEC_AC:         35,
  COST_MONITORING:      36,
  COST_PERMITS:         37,
  COST_INSTALL:         38,
  COST_BESS:            39,    // NEW for PC_v2
  COST_TOTAL:           40,

  // §5 PRICE-AFTER-DISCOUNT + GROSS PROFIT (rows 41-43)
  PRICE_DISCOUNT_ROW:   41,    // "Payment Terms" + "Discount %" cell
  PRICE_AFTER_DISC:     42,    // "Payment time" + price-after-discount formula
  PRICE_GROSS_PROFIT:   43,    // "Gross Profit:" + formula

  // §6 DOCUMENTATION (rows 45-50)
  SEC_DOCS_HEADER:      45,
  DOCS_R1:              46,
  DOCS_R2:              47,
  DOCS_R3:              48,
  DOCS_R4:              49,
  DOCS_R5:              50,

  // §7 RISKS (rows 52-57)
  SEC_RISKS_HEADER:     52,
  RISKS_PENALTIES:      53,
  RISKS_WARRANTY:       54,
  RISKS_INSURANCE:      55,
  RISKS_FIRE:           56,
  RISKS_WORKPLACE:      57,

  // §8 COMMENTS (rows 59-60)
  SEC_COMMENTS_HEADER:  59,
  COMMENTS_BODY:        60,

  // §9 SIGNATURES (rows 62-69) — 4 signatures × 2 rows each
  SIG_SUBMITTED_DESIGN: 62,
  SIG_SUBMITTED_PM:     64,
  SIG_RECEIVED:         66,
  SIG_APPROVED:         68,
  LAST_ROW:             69
};

// ---------------------------------------------------------------------------
// PROJECT_CARD_v2 COLUMN MAP (1-based)
// ---------------------------------------------------------------------------
var PC_COL = {
  MARGIN_L:    1,   // A
  LABEL_L:     2,   // B
  USD_COST:    3,   // C
  MXN_COST:    4,   // D
  VALIDATION:  5,   // E
  SPACER:      6,   // F
  LABEL_R:     7,   // G
  USD_SALES:   8,   // H
  MXN_SALES:   9,   // I
  MARGIN_PCT:  10   // J
};

// ---------------------------------------------------------------------------
// MASTERLINK FOLDER HELPER
// Reads H2 (Offer folder) and I2 (Helioscope folder) from 00_MASTERLINK tab.
// Called by runArgiaEngine, importHelioscopePdf, _runKicker, _loadImages.
// ---------------------------------------------------------------------------
function getMasterLinkFolderIds(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var sh = (ss.getSheetByName('00_MASTER_LINK') || ss.getSheetByName('00_MASTERLINK'));
  if (!sh) throw new Error(
    'Sheet 00_MASTERLINK not found.\n' +
    'Add folder IDs: H2 = Offer folder, I2 = Helioscope folder, K2 = Image assets folder.'
  );
  // H2=col8, I2=col9, K2=col11
  var vals = sh.getRange(2, 8, 1, 4).getValues()[0];
  var offerFolderId  = String(vals[0] || '').trim();
  var helioFolderId  = String(vals[1] || '').trim();
  // J2 (col10) reserved; K2 (col11, index 3) = image assets folder
  var imageFolderId  = String(vals[3] || '').trim();
  if (!offerFolderId) throw new Error(
    'Offer folder ID missing in 00_MASTERLINK!H2.\n' +
    'Paste the Google Drive folder ID where generated offers should be saved.'
  );
  if (!helioFolderId) throw new Error(
    'Helioscope folder ID missing in 00_MASTERLINK!I2.\n' +
    'Paste the Google Drive folder ID where Helioscope PDFs and Helioscope.png are stored.'
  );
  return { offerFolderId: offerFolderId, helioFolderId: helioFolderId, imageFolderId: imageFolderId };
}

// ---------------------------------------------------------------------------
// SHARED PROGRESS BAR
// Used by runArgiaEngine() and importHelioscopePdf().
// The Kicker (30_ArgiaKicker.gs) keeps its own separate progress key.
//
// HTML dialog polls getArgiaProgress() every 600 ms via google.script.run.
// Call _setArgiaProgress() at each meaningful step, then _showArgiaProgress()
// once before the work starts (modeless dialog stays open while main runs).
// ---------------------------------------------------------------------------
var ARGIA_PROGRESS_KEY = 'ARGIA_PROGRESS';

/** Called by the HTML dialog every 600 ms — must be a top-level function. */
function getArgiaProgress() {
  var raw = PropertiesService.getScriptProperties().getProperty(ARGIA_PROGRESS_KEY);
  return raw ? JSON.parse(raw) : null;
}

function _setArgiaProgress(step, total, label) {
  PropertiesService.getScriptProperties().setProperty(
    ARGIA_PROGRESS_KEY,
    JSON.stringify({
      step  : step,
      total : total,
      pct   : Math.round(step / total * 100),
      label : label,
      done  : step >= total
    })
  );
}

/**
 * Open the modeless progress dialog.
 * Call this AFTER _setArgiaProgress(0, total, 'Starting…') so the bar
 * is already initialised when the dialog first polls.
 */
function _showArgiaProgress(title) {
  var html =
    '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<style>' +
    'body{font-family:Arial,sans-serif;padding:18px 22px;margin:0;background:#fff;box-sizing:border-box;}' +
    'h3{font-size:13px;color:#0D1B2A;margin:0 0 12px;font-weight:700;letter-spacing:0.03em;}' +
    '#task{font-size:11px;color:#555;margin-bottom:9px;min-height:16px;' +
          'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '.bg{background:#E5E7EB;border-radius:5px;height:10px;overflow:hidden;}' +
    '.fill{background:#0D1B2A;height:10px;border-radius:5px;width:0%;transition:width 0.35s ease;}' +
    '#pct{font-size:10px;color:#999;text-align:right;margin-top:4px;}' +
    '</style></head><body>' +
    '<h3>' + title + '</h3>' +
    '<div id="task">Starting\u2026</div>' +
    '<div class="bg"><div class="fill" id="bar"></div></div>' +
    '<div id="pct">0 %</div>' +
    '<script>' +
    'function poll(){' +
      'google.script.run' +
        '.withSuccessHandler(function(p){' +
          'if(!p){setTimeout(poll,600);return;}' +
          'document.getElementById("task").textContent=p.label;' +
          'document.getElementById("bar").style.width=p.pct+"%";' +
          'document.getElementById("pct").textContent=p.pct+" %";' +
          'if(p.done){setTimeout(function(){google.script.host.close();},1400);}' +
          'else{setTimeout(poll,600);}' +
        '})' +
        '.withFailureHandler(function(){setTimeout(poll,800);})' +
        '.getArgiaProgress();' +
    '}' +
    'setTimeout(poll,400);' +
    '<\/script></body></html>';
  SpreadsheetApp.getUi().showModelessDialog(
    HtmlService.createHtmlOutput(html).setWidth(420).setHeight(130),
    title
  );
}

// ---------------------------------------------------------------------------
// MENU
// ---------------------------------------------------------------------------
function onOpen() {
  var ui = SpreadsheetApp.getUi();

  // ── ARGIA menu ───────────────────────────────────────────────
  // Layout reorganized 2026-05-27 (v3.7.7):
  //   - Top: generate-workflow items (the ~daily-use buttons).
  //   - Exports submenu: unchanged.
  //   - Setup submenu: all dev/ops utilities including the test runners
  //     (regression / integration / unit / all). Tests run rarely and
  //     don't belong at top level.
  //
  // Removed in this cleanup:
  //   - "Setup Project Card Inputs" (function runSetupProjectCardInputs
  //     was never defined; menu item would have thrown).
  //   - "Run Tests for Current Chunk" (chunk-tracking was a migration
  //     scaffolding tool; migration is complete).
  ui.createMenu('ARGIA')
    .addItem('Import Helioscope',         'importHelioscopePdf')
    .addItem('Verify Layout',             'verifyInputs')
    .addItem('Suggest BESS',              'onMenuSuggestBess')
    .addItem('Generate MDC and BOM',      'runArgiaEngine')
    .addItem('Generate Installation',     'runInstallCostStandalone')
    .addItem('Generate Project Card',     'runWriteProjectCardV2')
    .addItem('Generate RFQs',             'runWriteAllRfqsV2')
    .addItem('Generate BaaS Projection',  'runBaasProjectionMenu')
    .addSeparator()
    .addItem('Update Input Audit',        'auditInputs')
    .addSubMenu(ui.createMenu('Exports')
      .addItem('Export MDC',                         'exportMDC')
      .addItem('Export BOM',                         'exportBOM')
      .addItem('Export Installation',                'exportInstallation')
      .addItem('Export Project Card',                'exportProjectCard')
      .addSeparator()
      .addSubMenu(ui.createMenu('Export RFQ')
        .addItem('Export RFQ \u2014 Paneles',        'exportRfqPaneles')
        .addItem('Export RFQ \u2014 Inversores',     'exportRfqInversores')
        .addItem('Export RFQ \u2014 Estructura',     'exportRfqEstructura')
        .addItem('Export RFQ \u2014 Electrico',      'exportRfqElectrico')
        .addItem('Export RFQ \u2014 Monitoreo',      'exportRfqMonitoreo')
        .addItem('Export RFQ \u2014 BESS',           'exportRfqBess')
        .addSeparator()
        .addItem('Export All RFQs',                  'exportAllRfqs'))
      .addSeparator()
      .addItem('Export All (MDC+BOM+Install+PC)',    'exportAll'))
    .addSeparator()
    .addSubMenu(ui.createMenu('Administrator Panel')
      // -- Test ------------------------------------------------
      .addSubMenu(ui.createMenu('Test')
        .addItem('Run Unit Tests (fast)',                     'runUnitTests')
        .addItem('Run Integration Tests (modifies workbook)', 'runIntegrationTests')
        .addItem('Run Regression Tests',                      'runRegressionTests')
        .addItem('Run ALL Tests',                             'runTests'))
      // -- Setup -----------------------------------------------
      .addSubMenu(ui.createMenu('Setup')
        .addItem('Setup Install Inputs',                'runSetupInstallInputs')
        .addItem('Setup BESS Install \u00a76',          'setupInputBessInstallRows')
        .addItem('Setup BESS Steady-state (BDF-11.1)',  'runSetupBessSimulationSteady')
        .addItem('Setup INPUT_BESS Styling',            'setupInputBessStyling')
        .addItem('Setup SOLAR Section (PV toggle)',     'runSetupInputProjectPvSection')
        .addItem('Setup RESILIENCE Section (backup)',   'runSetupInputBessResilienceSection'))
      .addSeparator()
      // -- Repair ----------------------------------------------
      .addItem('Repair CFE_SIM Totals',                 'runRepairCfeSimulationTotals')
      .addItem('Repair CFE_SIM Capacidad (BDF-11)',     'runRepairCfeSimulationCapacidad')
      .addItem('Repair: resilience collision',          'runRepairResilienceCollision')
      .addSeparator()
      // -- Refresh ---------------------------------------------
      .addItem('Refresh BESS Strategy Dropdown',        'refreshBessStrategyDropdown')
      .addItem('Refresh Logo Cache',                    'refreshArgiaLogoCache')
      .addSeparator()
      // -- Delete ----------------------------------------------
      .addItem('Delete Legacy Tabs',                    'runDeleteLegacyTabs')
      .addSeparator()
      // -- Load / fixtures -------------------------------------
      .addItem('Load CULLIGAN Fixture',                 'runLoadCulliganFixture')
      .addItem('Restore Inputs from Backup',            'runRestoreInputsFromBackup')
      .addSeparator()
      // -- Operational -----------------------------------------
      .addItem('Update CFE Output',                     'runUpdateCfeOutputV2'))
    .addToUi();
}

// ---------------------------------------------------------------------------
// DIAGNOSTIC -- run first to confirm all sheets exist
// ---------------------------------------------------------------------------
function diagSheets() {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var ui  = SpreadsheetApp.getUi();
  var msg = 'Spreadsheet: ' + ss.getName() + '\n\nSheet check:\n';
  var allOk = true;
  Object.keys(SH).forEach(function(key) {
    var name  = SH[key];
    var found = ss.getSheetByName(name) !== null;
    // Bug B7 fix (3.7.8): dropped `&& name !== 'BOM'` — SH.BOM was removed in 3.7.5,
    // so the check was dead. SH no longer holds any output sheet names.
    if (!found && name !== 'LOGS') allOk = false;
    msg += (found ? '  [OK]      ' : '  [MISSING] ') + name + '\n';
  });
  msg += '\n' + (allOk ? 'All required sheets found.' : 'Fix MISSING sheets before running.');
  ui.alert('Sheet Diagnostic', msg, ui.ButtonSet.OK);
}

// ---------------------------------------------------------------------------
// MAIN ENTRY POINT
// ---------------------------------------------------------------------------
function runArgiaEngine() {
  var startTime = Date.now();
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var ui  = SpreadsheetApp.getUi();
  var TOTAL = 14; // progress steps

  try {
    // -- Show progress bar before any work starts ---------------------------
    _setArgiaProgress(0, TOTAL, 'Starting\u2026');
    _showArgiaProgress('ARGIA \u2014 Building MDC & BOM');

    logRunStart(ss);

    // Step 1: sheet check ---------------------------------------------------
    _setArgiaProgress(1, TOTAL, 'Checking sheets\u2026');
    engineLog(ss, 'Engine', 'INFO', 'Step 1: checking sheets');
    // Install master-data sheets are optional -- they only need IMPORTRANGE
    // to be set up. Core engine (MDC_v2 / BOM_v2) runs even if install
    // mirrors are missing.
    // INPUT_GENERAL is RETIRED (v2.0.2+) -- the SH constant lingers for
    // back-compat but the sheet is no longer required at startup.
    var OPTIONAL_SHEETS = ['90M_INSTALL_LIB', '91M_INSTALL_FACTORS',
      '92M_INSTALL_ROLE_RATES', '93M_INSTALL_EQUIP_RATES',
      'INPUT_GENERAL'];
    var missing = [];
    Object.keys(SH).forEach(function(key) {
      var name = SH[key];
      if (name === 'LOGS') return;
      if (OPTIONAL_SHEETS.indexOf(name) !== -1) return;
      if (ss.getSheetByName(name) === null) missing.push(name);
    });
    if (missing.length > 0) throw new Error(
      'Sheets not found: ' + missing.join(', ') +
      '\nRun "Sheet Diagnostic" from the ARGIA menu.'
    );

    // Step 2: NOM constants -------------------------------------------------
    _setArgiaProgress(2, TOTAL, 'Loading NOM constants\u2026');
    engineLog(ss, 'Engine', 'INFO', 'Step 2: loading NOM constants');
    var nom = loadNomConstants(ss);

    // Step 3: inputs --------------------------------------------------------
    _setArgiaProgress(3, TOTAL, 'Reading inputs\u2026');
    engineLog(ss, 'Engine', 'INFO', 'Step 3: reading inputs');
    var inp = readInputs(ss);
    engineLog(ss, 'Engine', 'INFO',
      'Project: ' + inp.projectName + ' | Panel: ' + inp.panelModel +
      ' x' + inp.panelQty + ' | Inverters: ' + inp.inverterBank.length + ' type(s)');

    // Step 4: DB lookup -----------------------------------------------------
    _setArgiaProgress(4, TOTAL, 'Loading products from DB\u2026');
    engineLog(ss, 'Engine', 'INFO', 'Step 4: loading products from DB');
    var panel   = lookupPanel(ss, inp.panelModel);
    var invBank = buildInverterBank(ss, inp.inverterBank);
    engineLog(ss, 'Engine', 'OK',
      'Panel: ' + panel['PANEL_MODEL'] + ' ' + panel['PANEL_POWER_W'] + 'W | ' +
      invBank.map(function(i) { return i.qty + 'x' + i.model; }).join(', '));

    // Step 5: validation ----------------------------------------------------
    _setArgiaProgress(5, TOTAL, 'Running validation\u2026');
    engineLog(ss, 'Engine', 'INFO', 'Step 5: running validation');
    var validation = runValidation(ss, inp, panel, invBank, nom);
    if (!validation.passed) {
      _setArgiaProgress(TOTAL, TOTAL, '\u274C Blocked \u2014 validation errors');
      ui.alert('ENGINE BLOCKED \u2014 Validation Errors', formatValidationAlert(validation), ui.ButtonSet.OK);
      return;
    }
    if (validation.majors.length > 0) {
      // Progress bar pauses here while user reads the warning dialog -- that is fine.
      var response = ui.alert(
        'Validation Warnings Found',
        formatValidationAlert(validation) + '\nContinue anyway?',
        ui.ButtonSet.YES_NO
      );
      if (response !== ui.Button.YES) {
        _setArgiaProgress(TOTAL, TOTAL, 'Cancelled.');
        engineLog(ss, 'Engine', 'INFO', 'User cancelled after validation warnings.');
        return;
      }
    }

    // Step 6: electrical tables ---------------------------------------------
    _setArgiaProgress(6, TOTAL, 'Loading electrical tables\u2026');
    engineLog(ss, 'Engine', 'INFO', 'Step 6: loading electrical tables');
    var tbls = readElecTables(ss);

    // Step 7: DC calculations -----------------------------------------------
    _setArgiaProgress(7, TOTAL, 'DC calculations\u2026');
    engineLog(ss, 'Engine', 'INFO', 'Step 7: DC calculations');
    var dc = calcDC(inp, panel, invBank, nom, tbls);
    engineLog(ss, 'Engine', dc.resultDC.indexOf('FAIL') !== -1 ? 'MAJOR' : 'OK',
      'DC result: ' + dc.resultDC);

    // Step 8: AC calculations -----------------------------------------------
    _setArgiaProgress(8, TOTAL, 'AC calculations\u2026');
    engineLog(ss, 'Engine', 'INFO', 'Step 8: AC calculations');
    var ac = calcAC(inp, panel, invBank, nom, tbls, dc);
    engineLog(ss, 'Engine', ac.resultFeeder.indexOf('FAIL') !== -1 ? 'MAJOR' : 'OK',
      'AC result: ' + ac.resultFeeder);

    // Step 9: layout scaling ------------------------------------------------
    _setArgiaProgress(9, TOTAL, 'Layout scaling\u2026');
    engineLog(ss, 'Engine', 'INFO', 'Step 9: layout scaling');
    var lay = calcLayout(inp, dc, ac, nom);

    // Step 9.5: BESS step ---------------------------------------------------
    // Reads INPUT_BESS (toggle-aware). PV-only projects return a clean
    // disabled result and the engine continues unchanged. A genuinely
    // invalid battery spec throws and is caught by the outer handler.
    engineLog(ss, 'Engine', 'INFO', 'Step 9.5: BESS step');
    var bessResult;
    try {
      bessResult = runBessStep(ss);
      bessResult.summary.forEach(function(line) {
        engineLog(ss, 'BESS', 'INFO', line);
      });
      bessResult.warnings.forEach(function(w) {
        engineLog(ss, 'BESS', 'WARNING', w);
      });
    } catch (bessErr) {
      // A bad battery spec should not silently vanish, but it also should
      // not block the PV MDC/BOM. Log it loudly; surface it in the alert.
      bessResult = { bessEnabled: false, bess: null, usableCapacityKwh: 0,
                     monthlyThroughputKwh: 0, warnings: [], summary: [],
                     specError: bessErr.message };
      engineLog(ss, 'BESS', 'MAJOR',
        'BESS step failed: ' + bessErr.message +
        '. PV outputs continue; fix INPUT_BESS and re-run.');
    }

    // 4.0.0: LOAD_SHIFTING <-> interconnection consistency check.
    // LOAD_SHIFTING only does grid arbitrage under FACTURACION_NETA. Under any
    // other interconnection it silently behaves like PEAK_SHAVING (identical
    // numbers). Surface that LOUDLY so the designer is never fooled by a
    // strategy that isn't actually active. Logged as MAJOR and pushed into
    // bessResult.warnings so it appears in the end-of-run alert too.
    try {
      if (bessResult && bessResult.bessEnabled && bessResult.bess &&
          String(bessResult.bess.strategy || '').toUpperCase() === 'LOAD_SHIFTING') {
        var icCheck = readBessInterconnectionFromInputCfe(ss);
        if (!icCheck || icCheck.mode !== 'NET_BILLING') {
          var icMsg = 'LOAD_SHIFTING selected but interconnection is '
            + ((icCheck && icCheck.mode) || 'UNKNOWN')
            + ' (needs FACTURACION_NETA/NET_BILLING for grid arbitrage). '
            + 'Battery will NOT charge from grid; results are identical to '
            + 'PEAK_SHAVING. Set INPUT_CFE!C41 = FACTURACION_NETA, or pick '
            + 'PEAK_SHAVING to reflect actual behavior.';
          engineLog(ss, 'BESS', 'MAJOR', icMsg);
          if (bessResult.warnings) bessResult.warnings.push(icMsg);
        }
      }
    } catch (icErr) {
      engineLog(ss, 'BESS', 'WARNING',
        'LOAD_SHIFTING interconnection check skipped: ' + icErr.message);
    }

    // Step 9.6: BESS BoS quantities + voltage drop + NOM checks (BDF-7) ------
    // Pure-function chain that turns the BESS step's circuit result + the
    // INPUT_BESS §6 install context into BOM line items, voltage-drop
    // verification, and NOM compliance checks. Results attached to
    // bessResult so downstream writers (MDC §7, BOM §8) can consume them.
    // Wrapped in try/catch: a calc bug never breaks the rest of the pipeline.
    if (bessResult.bessEnabled && bessResult.bess && bessResult.circuit) {
      engineLog(ss, 'Engine', 'INFO', 'Step 9.6: BESS BoS + NOM checks');
      try {
        var installCtx = readBessInstallContext(ss);
        // BDF-7.1: coupling has a single authoritative source —
        // bessResult.coupling (derived from INPUT_DESIGN!C17). Inject it
        // here so the calc functions never get a stale or contradictory
        // value from a removed/old INPUT_BESS!C43 cell.
        installCtx.coupling = bessResult.coupling;
        var bosResult = calcBessBosQuantities({
          bess: bessResult.bess,
          circuit: bessResult.circuit,
          installContext: installCtx,
          nom: nom,
        });
        var vdResult = calcBessVoltageDrop({
          circuit: bessResult.circuit,
          installContext: installCtx,
          nom: nom,
        });
        var nomChecksResult = calcBessNomChecks({
          circuit: bessResult.circuit,
          bos: bosResult,
          installContext: installCtx,
          nom: nom,
        });
        bessResult.installContext = installCtx;
        bessResult.bos = bosResult;
        bessResult.voltageDrop = vdResult;
        bessResult.nomChecks = nomChecksResult;
        // Log summary
        var blockedTag = bosResult.blocked ? ' (blocked: ' + bosResult.reason + ')' : '';
        engineLog(ss, 'BESS', 'INFO',
          'BoS: ' + (bosResult.lines ? bosResult.lines.length : 0) + ' lines' + blockedTag);
        // Surface FAIL-status NOM checks loudly
        (nomChecksResult.checks || []).forEach(function(c) {
          if (c.status === 'FAIL') {
            engineLog(ss, 'BESS', 'MAJOR',
              'NOM check FAIL: ' + c.title + ' -- ' + c.detail);
          }
        });
        (vdResult.checks || []).forEach(function(c) {
          if (c.status === 'FAIL') {
            engineLog(ss, 'BESS', 'MAJOR',
              'Voltage drop FAIL on ' + c.runName + ': ' +
              (c.vdropPct * 100).toFixed(2) + '%');
          }
        });
      } catch (bdfErr) {
        engineLog(ss, 'BESS', 'WARNING',
          'BDF-7 BoS/voltage/NOM calc skipped: ' + bdfErr.message);
        bessResult.bos = null;
        bessResult.voltageDrop = null;
        bessResult.nomChecks = null;
      }
    }

    // Step 10: write MDC_v2 ----------------------------------------------------
    // Tier 1 cutover (2026-05-26): legacy writeMDC removed from the pipeline.
    // v2 is now the only path. The legacy try/catch fallback is gone -- if
    // the v2 writer breaks, the engine fails loudly (which is correct: there
    // is no alternative output now).
    _setArgiaProgress(10, TOTAL, 'Writing MDC_v2\u2026');
    engineLog(ss, 'Engine', 'INFO', 'Step 10: writing MDC_v2');
    setupMdcTemplate(ss);
    writeMdcV2(ss, inp, panel, invBank, dc, ac, lay, nom, bessResult);

    // Step 11: write BOM_v2 ----------------------------------------------------
    // Tier 1 cutover (2026-05-26): legacy writeBOM removed from the pipeline.
    // v2 includes the BESS section (Section 8) -- one of the bugs v2 fixed.
    _setArgiaProgress(11, TOTAL, 'Writing BOM_v2\u2026');
    engineLog(ss, 'Engine', 'INFO', 'Step 11: writing BOM_v2');
    setupBomTemplate(ss);
    writeBomV2(ss, inp, panel, invBank, dc, ac, lay, nom, bessResult);

    // Step 12: install cost calc + write INSTALLATION_v2 ---------------------
    // Tier 1 cutover (2026-05-26): runInstallCost no longer writes legacy
    // INSTALLATION -- it now only computes the result. writeInstallationV2
    // is the only output path. runInstallCost still attaches .drivers to
    // the returned object so writeInstallationV2 can consume both.
    _setArgiaProgress(12, TOTAL, 'Installation cost\u2026');
    engineLog(ss, 'Engine', 'INFO', 'Step 12: installation cost');
    var installResult = null;
    try {
      installResult = runInstallCost(ss, inp, invBank, dc, ac, lay, bessResult);
    } catch (installErr) {
      engineLog(ss, 'Engine', 'WARNING',
        'Installation cost skipped: ' + installErr.message +
        '. Run "Generate Installation" from menu after fixing.');
    }

    // Step 12-v2: write INSTALLATION_v2 ---------------------------------------
    // Consumes the calc result from runInstallCost. try/catch isolation is
    // kept here because the writer does sheet I/O and may fail independently
    // of the calc layers.
    if (installResult) {
      engineLog(ss, 'Engine', 'INFO', 'Step 12-v2: writing INSTALLATION_v2');
      try {
        setupInstallationTemplate(ss);
        writeInstallationV2(ss, installResult, installResult.drivers);
        writeInstallationDriverMapV2(ss, installResult.drivers, installResult);
      } catch (v2InstErr) {
        engineLog(ss, 'V2', 'WARNING',
          'INSTALLATION_v2 skipped: ' + v2InstErr.message +
          '. Legacy INSTALLATION unaffected.\n' + (v2InstErr.stack || ''));
      }
    } else {
      engineLog(ss, 'V2', 'INFO',
        'Step 12-v2: skipped because legacy Step 12 returned no result');
    }

    // Step 13: write PROJECT_CARD_v2 ------------------------------------------
    // Tier 1 cutover (2026-05-26): legacy writeProjectCard removed from the
    // pipeline. PROJECT_CARD_v2 now includes the BESS line item (C39), one of
    // the bugs v2 fixed.
    _setArgiaProgress(13, TOTAL, 'Writing Project Card\u2026');
    engineLog(ss, 'Engine', 'INFO', 'Step 13: writing PROJECT_CARD_v2');
    try {
      setupProjectCardTemplate(ss);
      writeProjectCardV2(ss, inp, panel, invBank, dc, ac, lay, nom, bessResult);
    } catch (pcErr) {
      engineLog(ss, 'Engine', 'WARNING',
        'Project Card skipped: ' + pcErr.message +
        '. Run "Generate Project Card" from menu after fixing.');
    }

    // Step 13.4: Hourly Simulation (BDF-5) -----------------------------------
    // Produces 8760-hour load/PV/battery dispatch + cost. Result is attached
    // to engineResult.hourlySimulation. Pure compute — never writes to sheets.
    // try/catch matches Step 9.5: a sim bug never breaks the rest of the
    // pipeline. CFE_OUTPUT (Step 13.5) consumes this result for side-by-side
    // display when available.
    engineLog(ss, 'Engine', 'INFO', 'Step 13.4: hourly simulation');
    var hourlySim = null;
    try {
      hourlySim = runHourlySimulation(ss);
      if (hourlySim.blocked) {
        engineLog(ss, 'HourlySim', 'WARNING',
          'Hourly simulation blocked: ' + hourlySim.blocked);
      } else {
        engineLog(ss, 'HourlySim', 'INFO',
          'Hourly sim OK: load ' + Math.round(hourlySim.annual.loadKwh) + ' kWh, '
          + 'total cost MXN ' + Math.round(hourlySim.annual.totalCostMxn));
        for (var hw = 0; hw < hourlySim.warnings.length; hw++) {
          engineLog(ss, 'HourlySim', 'WARNING', hourlySim.warnings[hw]);
        }
      }
    } catch (hsErr) {
      engineLog(ss, 'HourlySim', 'MAJOR',
        'Hourly simulation failed: ' + hsErr.message
        + '. Engine continues with monthly-only numbers.');
      hourlySim = null;
    }

    // Step 13.5: CFE_OUTPUT_v2 render ----------------------------------------
    // Tier 1 cutover (2026-05-26): legacy writeCfeOutput removed from the
    // pipeline. CFE_OUTPUT_v2 is the only path now.
    //
    // hourlySim is forwarded so v2 can render the BDF-5 addendum (rows 45-64:
    // hourly summary + bill components + provenance). If hourlySim is
    // null/blocked the addendum is skipped.
    engineLog(ss, 'Engine', 'INFO', 'Step 13.5: writing CFE_OUTPUT_v2');
    try {
      writeCfeOutputV2(ss, hourlySim);
    } catch (cfeErr) {
      engineLog(ss, 'Engine', 'WARNING',
        'CFE_OUTPUT_v2 skipped: ' + cfeErr.message +
        '. Other outputs are unaffected.');
    }

    // Step 14: output consistency check --------------------------------------
    // Asserts MDC / BOM / INSTALLATION / PROJECT_CARD agree on project
    // identity (project name, module count, inverter count). Catches the
    // bug class where test fixtures wrote to output sheets and the engine
    // has not re-run -- the workbook looks normal but is internally
    // inconsistent (different projects per sheet).
    //
    // Wrapped in try/catch matching Steps 9.5 / 13.5: a validator bug
    // never breaks the rest of the engine. The validator emits its own
    // CRITICAL logs + UI alert on mismatch.
    engineLog(ss, 'Engine', 'INFO', 'Step 14: output consistency check');
    try {
      runOutputConsistencyCheck(ss);
    } catch (ocErr) {
      engineLog(ss, 'Engine', 'WARNING',
        'Output consistency check threw (non-fatal): ' + ocErr.message);
    }

    // Step 14.5: install cost sanity check (3.7.8 / Chunk 3) -----------------
    // Advisory only. Compares the just-computed install cost against
    // industry-typical ranges (PV MXN/Wp, BESS USD/kWh, blended labor MXN/MH).
    // Surfaces warnings to LOGS and the end-of-run alert. Bounds live in
    // 02_LoadDB.buildNomLimitsDefaults() under the install_* keys, so Ops
    // can tighten them without code changes once 94_INSTALL_BENCHMARKS
    // has historical data.
    //
    // Wrapped in try/catch matching Step 14: a guardrail bug never breaks
    // the engine.
    var sanityResult = null;
    engineLog(ss, 'Engine', 'INFO', 'Step 14.5: install cost sanity check');
    try {
      sanityResult = runInstallCostSanityCheck(ss, {
        installResult: installResult,
        bessResult:    bessResult,
        inp:           inp,
        panel:         panel
      });
    } catch (sanityErr) {
      engineLog(ss, 'Engine', 'WARNING',
        'Install cost sanity check threw (non-fatal): ' + sanityErr.message);
    }

    // Done ------------------------------------------------------------------
    _setArgiaProgress(TOTAL, TOTAL, '\u2705 Complete!');
    logRunEnd(ss, Date.now() - startTime);

    // v2.0.0: stamp engine version on every successful run.
    // Wrapped in try/catch so stamping failure never blocks the engine.
    try { stampMeta(ss, {runType: 'engine'}); }
    catch (stampErr) {
      // Bug B6 fix (3.7.8): 'WARN' was a typo; canonical level is 'WARNING' (10_Logger.js:33,45)
      try { engineLog(ss, 'Engine', 'WARNING', 'stampMeta failed: ' + stampErr.message); } catch (_) {}
    }

    Utilities.sleep(1600); // let dialog reach 100 % before auto-close

    var flags = [
      dc.dc01Pass ? null : 'DC-01 Voc FAIL',
      dc.dc02Pass ? null : 'DC-02 Vmp FAIL',
      dc.vdropDCFail ? 'DC-07 vdrop FAIL' : null,
      dc.str01Pass ? null : 'STR-01 window FAIL',
      (bessResult && bessResult.specError) ? 'BESS spec error (see LOGS)' : null,
    ].filter(Boolean);

    var bessLine = '';
    if (bessResult && bessResult.bessEnabled) {
      bessLine = '\n\nBESS: ' + bessResult.bess.capacityKwh + ' kWh / '
        + bessResult.bess.powerKw + ' kW '
        + '(usable ' + bessResult.usableCapacityKwh.toFixed(0) + ' kWh)'
        + (bessResult.warnings.length > 0
            ? ' \u2014 ' + bessResult.warnings.length + ' warning(s), see LOGS.'
            : '.');
    }

    // 3.7.8 / Chunk 3: append install cost sanity warnings (if any).
    // We surface these in the dialog so the designer notices when computed
    // install cost is implausible vs industry benchmarks.
    var sanityLine = '';
    if (sanityResult && sanityResult.warnings && sanityResult.warnings.length > 0) {
      sanityLine = '\n\nInstall cost guardrails ('
                 + sanityResult.warnings.length + ' warning'
                 + (sanityResult.warnings.length === 1 ? '' : 's') + '):\n  - '
                 + sanityResult.warnings.join('\n  - ')
                 + '\n\nSee LOGS sheet for full detail.';
    }

    // Keep the input/output audit in sync with this run so _AUDIT_INPUTS
    // never drifts behind the workbook. Non-fatal: wrapped internally.
    _refreshInputAudit_();

    ui.alert(
      'ARGIA ENGINE \u2014 Complete',
      'MDC and BOM generated in ' + ((Date.now() - startTime) / 1000).toFixed(1) + 's.\n\n' +
      (flags.length > 0
        ? 'Active flags:\n' + flags.join('\n') + '\n\nSee section 4.0 in MDC and LOGS sheet.'
        : 'All NOM checks passed.') +
      bessLine +
      sanityLine,
      ui.ButtonSet.OK
    );

  } catch (e) {
    try {
      _setArgiaProgress(TOTAL, TOTAL, '\u274C Error \u2014 see alert');
      engineLog(ss, 'Engine', 'ERROR', e.message + '\n' + e.stack);
    } catch (_) {}
    ui.alert('ENGINE ERROR', e.message + '\n\nStack:\n' + e.stack, ui.ButtonSet.OK);
  }
}

// ---------------------------------------------------------------------------
// VERIFY INPUTS (safe pre-check -- no writes to MDC/BOM)
// ---------------------------------------------------------------------------
function verifyInputs() {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var ui  = SpreadsheetApp.getUi();
  try {
    var nom     = loadNomConstants(ss);
    var inp     = readInputs(ss);
    var panel   = lookupPanel(ss, inp.panelModel);
    var invBank = buildInverterBank(ss, inp.inverterBank);
    var val     = runValidation(ss, inp, panel, invBank, nom);
    ui.alert('Input Verification', formatValidationAlert(val), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Verify Error', e.message, ui.ButtonSet.OK);
  }
}



// ===========================================================================
// CULLIGAN FIXTURE LOADER  (PR-2, 2026-05-26)
// ---------------------------------------------------------------------------
// Two menu-driven helpers for loading the CULLIGAN reference project into the
// active workbook's INPUT sheets, and restoring the prior data afterwards.
//
//   runLoadCulliganFixture()       — backs up current INPUT_* sheets, then
//                                    writes the CULLIGAN_BASELINE fixture
//                                    from test/CULLIGAN_BASELINE_fixture.gs.
//   runRestoreInputsFromBackup()   — restores from the backup created above.
//
// Both prompt the user with a confirmation dialog before doing anything
// destructive. The backup machinery is shared with TESTPROJ-001 e2e tests
// (test/TestSheetBackup.gs).
//
// CONTEXT
//   Before this lander, running the v2 baseline regression test against
//   CULLIGAN required typing all 158 input values by hand. This loader
//   automates that step.
// ===========================================================================

/**
 * Load the CULLIGAN_BASELINE fixture into the active workbook's INPUT sheets.
 *
 * FLOW:
 *   1. Confirm with the user.
 *   2. backupAllInputSheets(ss) -- creates hidden _TEST_BACKUP_* twins of
 *      INPUT_PROJECT / INPUT_DESIGN / INPUT_INSTALL / INPUT_BESS / INPUT_CFE.
 *   3. writeCulliganInputs(ss) -- writes all 158 fixture values.
 *   4. Show a summary dialog (fields written, anything skipped, next steps).
 *
 * SAFETY:
 *   - Confirmation prompt before any destructive write.
 *   - Backup happens BEFORE the fixture writes so a user error mid-flow
 *     can still be undone via "Restore Inputs from Backup".
 *   - If backup fails, no fixture writes happen.
 *   - If a fixture write throws, the backup remains intact for manual restore.
 */
function runLoadCulliganFixture() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  var confirmResp = ui.alert(
    'Load CULLIGAN Fixture',
    'This will:\n\n' +
    '  1. Back up your current INPUT_PROJECT, INPUT_DESIGN, INPUT_INSTALL,\n' +
    '     INPUT_BESS, INPUT_CFE sheets (hidden _TEST_BACKUP_* twins).\n' +
    '  2. Overwrite those sheets with the CULLIGAN reference project.\n\n' +
    'Use "Restore Inputs from Backup" afterwards to get your data back.\n\n' +
    'Continue?',
    ui.ButtonSet.OK_CANCEL);
  if (confirmResp !== ui.Button.OK) {
    ui.alert('Cancelled', 'No changes made.', ui.ButtonSet.OK);
    return;
  }

  // Step 1: backup ---------------------------------------------------------
  try {
    backupAllInputSheets(ss);
  } catch (e) {
    ui.alert('Backup failed',
             'Could not back up input sheets: ' + e.message + '\n\n' +
             'NO CHANGES MADE to your inputs.',
             ui.ButtonSet.OK);
    return;
  }

  // Step 2: write fixture --------------------------------------------------
  var skipped;
  try {
    skipped = writeCulliganInputs(ss);
  } catch (e) {
    ui.alert('Write failed',
             'writeCulliganInputs threw: ' + e.message + '\n\n' +
             'Some inputs may have been written before the failure.\n' +
             'Your backup is still available via "Restore Inputs from Backup".',
             ui.ButtonSet.OK);
    return;
  }

  // Step 3: summary --------------------------------------------------------
  var msg = 'CULLIGAN fixture loaded.\n\n' +
            'Project: CULLIGAN  (1350 modules, 864 kWp, BESS enabled)\n\n';
  if (skipped && skipped.length > 0) {
    msg += skipped.length + ' field(s) could not be written:\n';
    var preview = skipped.slice(0, 10);
    preview.forEach(function (s) { msg += '  - ' + s + '\n'; });
    if (skipped.length > 10) {
      msg += '  ... (' + (skipped.length - 10) + ' more)\n';
    }
    msg += '\nMost commonly: dropdown cells whose validation list does\n' +
           'not include the fixture value, or labels/notes cells protected\n' +
           'by data validation. Engine math is rarely affected.\n\n';
  } else {
    msg += 'All fields written without skips.\n\n';
  }
  msg += 'NEXT STEPS:\n' +
         '  1. ARGIA menu -> "Generate MDC and BOM" (runs the engine)\n' +
         '  2. ARGIA menu -> "Generate RFQs v2" (writes RFQ sheets)\n' +
         '  3. ARGIA menu -> "Run Regression Tests" (validates baseline)\n' +
         '  4. ARGIA menu -> Setup -> "Restore Inputs from Backup"';
  ui.alert('Loaded', msg, ui.ButtonSet.OK);
}


/**
 * Restore INPUT_* sheets from the most recent backup created by
 * runLoadCulliganFixture (or any prior backupAllInputSheets() call).
 *
 * FLOW:
 *   1. Sanity-check at least one _TEST_BACKUP_* sheet exists. If not, bail
 *      with a readable message (nothing to restore).
 *   2. Confirm with the user.
 *   3. restoreAllInputSheets(ss) -- copies backup data back to live sheets
 *      and deletes the backup sheets.
 */
function runRestoreInputsFromBackup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  // Sanity check: is there anything to restore?
  var anyBackup = false;
  if (typeof TEST_INPUT_BACKUP_NAMES === 'object') {
    Object.keys(TEST_INPUT_BACKUP_NAMES).forEach(function (orig) {
      if (ss.getSheetByName(TEST_INPUT_BACKUP_NAMES[orig])) {
        anyBackup = true;
      }
    });
  }
  if (!anyBackup) {
    ui.alert('No backup found',
             'No _TEST_BACKUP_* sheets exist in this workbook.\n\n' +
             'A backup is created automatically when you click\n' +
             '"Load CULLIGAN Fixture". If your current inputs ARE\n' +
             'your original data, there is nothing to restore.',
             ui.ButtonSet.OK);
    return;
  }

  var confirmResp = ui.alert(
    'Restore Inputs from Backup',
    'This will:\n\n' +
    '  1. Overwrite your current INPUT_* sheets with the most recent\n' +
    '     backup (created when you last loaded a fixture).\n' +
    '  2. Delete the backup sheets after restore.\n\n' +
    'Your current INPUT data will be LOST. Continue?',
    ui.ButtonSet.OK_CANCEL);
  if (confirmResp !== ui.Button.OK) {
    ui.alert('Cancelled', 'No changes made.', ui.ButtonSet.OK);
    return;
  }

  try {
    restoreAllInputSheets(ss);
  } catch (e) {
    ui.alert('Restore failed',
             'restoreAllInputSheets threw: ' + e.message + '\n\n' +
             'The backup sheets may still be present -- you can also\n' +
             'manually copy data from them (hidden, named _TEST_BACKUP_*).',
             ui.ButtonSet.OK);
    return;
  }

  ui.alert('Restored',
           'INPUT sheets restored from backup.\n' +
           'Backup sheets have been deleted.',
           ui.ButtonSet.OK);
}


// ===========================================================================
// DELETE LEGACY TABS  (Cleanup, v3.7.5 / 2026-05-27)
// ---------------------------------------------------------------------------
// Removes legacy output tabs from the active workbook. The engine has been
// writing only the _v2 tabs since Tier 1 (3.5.0); the legacy tabs are
// orphaned data carried for a transition period. This utility deletes
// them once the user has confirmed no team workflow depends on them.
//
// LEGACY TABS this targets (10 total):
//   MDC, BOM, INSTALLATION, CFE_OUTPUT, PROJECT_CARD,
//   RFQ_PANELES, RFQ_INVERSORES, RFQ_ESTRUCTURA, RFQ_ELECTRICO,
//   RFQ_MONITOREO, 95_INSTALL_DRIVER_MAP.
//
// SAFETY GATES (all enforced before deleting):
//   1. The v2 counterpart MUST exist in the workbook.
//   2. The v2 counterpart MUST have data (getLastRow() > 5 -- past header).
//   3. The user must confirm a prompt that lists exactly which tabs will
//      be deleted and which will be skipped + why.
//   4. Each deletion is logged via engineLog so the LOGS tab has an
//      audit trail.
//
// REVERSIBILITY: Google Sheets keeps deleted tabs in File -> Version
// history for ~30 days; recovery via that path is documented in the
// confirmation prompt.
// ===========================================================================
function runDeleteLegacyTabs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  // Canonical legacy -> v2 mapping. Mirrors V2_LEGACY_MAP plus the
  // INSTALL_DRIVER_MAP entry, which is in V2_SHEETS but intentionally
  // absent from V2_LEGACY_MAP (so it gets its own line here).
  var TARGETS = [
    { legacy: 'MDC',                    v2: 'MDC_v2' },
    { legacy: 'BOM',                    v2: 'BOM_v2' },
    { legacy: 'INSTALLATION',           v2: 'INSTALLATION_v2' },
    { legacy: 'PROJECT_CARD',           v2: 'PROJECT_CARD_v2' },
    { legacy: 'CFE_OUTPUT',             v2: 'CFE_OUTPUT_v2' },
    { legacy: 'RFQ_PANELES',            v2: 'RFQ_PANELES_v2' },
    { legacy: 'RFQ_INVERSORES',         v2: 'RFQ_INVERSORES_v2' },
    { legacy: 'RFQ_ESTRUCTURA',         v2: 'RFQ_ESTRUCTURA_v2' },
    { legacy: 'RFQ_ELECTRICO',          v2: 'RFQ_ELECTRICO_v2' },
    { legacy: 'RFQ_MONITOREO',          v2: 'RFQ_MONITOREO_v2' },
    { legacy: '95_INSTALL_DRIVER_MAP',  v2: '95_INSTALL_DRIVER_MAP_v2' }
  ];

  // ---- Classify each target ----------------------------------------------
  // willDelete: legacy present + v2 present + v2 populated
  // skipNoV2:   legacy present but v2 missing (safety -> skip)
  // skipV2Empty: legacy present, v2 present but empty (safety -> skip)
  // notPresent: legacy already gone (nothing to do)
  var willDelete  = [];
  var skipNoV2    = [];
  var skipV2Empty = [];
  var notPresent  = [];

  TARGETS.forEach(function(t) {
    var legacyShe = ss.getSheetByName(t.legacy);
    if (!legacyShe) {
      notPresent.push(t.legacy);
      try { engineLog(ss, 'Cleanup', 'INFO',
                      'classify ' + t.legacy + ': NOT_PRESENT (already gone)'); }
      catch (_) {}
      return;
    }
    var v2She = ss.getSheetByName(t.v2);
    if (!v2She) {
      skipNoV2.push(t);
      try { engineLog(ss, 'Cleanup', 'INFO',
                      'classify ' + t.legacy + ': SKIP_NO_V2 (' + t.v2 + ' missing)'); }
      catch (_) {}
      return;
    }
    // v2 must have something beyond a banner -- last row > 5 is the heuristic
    // (banner usually fills rows 1-3, header row 4, sometimes blank 5).
    // Record the actual lastRow so the dialog can show exactly why a tab
    // ended up in skipV2Empty.
    var lastRow = 0;
    try { lastRow = v2She.getLastRow(); } catch (_) {}
    if (lastRow <= 5) {
      t._v2LastRow = lastRow;  // attach for diagnostic in dialog
      skipV2Empty.push(t);
      try { engineLog(ss, 'Cleanup', 'INFO',
                      'classify ' + t.legacy + ': SKIP_V2_EMPTY (' +
                      t.v2 + '.lastRow=' + lastRow + ', threshold>5)'); }
      catch (_) {}
      return;
    }
    willDelete.push(t);
    try { engineLog(ss, 'Cleanup', 'INFO',
                    'classify ' + t.legacy + ': WILL_DELETE (' +
                    t.v2 + '.lastRow=' + lastRow + ')'); }
    catch (_) {}
  });

  // ---- Nothing to do? ----------------------------------------------------
  if (willDelete.length === 0 && skipNoV2.length === 0 && skipV2Empty.length === 0) {
    ui.alert('Already v2-only',
             'No legacy tabs found in this workbook. Nothing to delete.',
             ui.ButtonSet.OK);
    return;
  }

  // ---- Build confirmation message ----------------------------------------
  var msg = 'This will permanently delete the following legacy tabs from\n' +
            'this workbook:\n\n';

  if (willDelete.length > 0) {
    msg += 'WILL DELETE (' + willDelete.length + '):\n';
    willDelete.forEach(function(t) {
      msg += '  - ' + t.legacy + '  (v2 counterpart ' + t.v2 + ' is populated)\n';
    });
    msg += '\n';
  }

  if (skipNoV2.length > 0) {
    msg += 'WILL SKIP -- v2 counterpart missing (' + skipNoV2.length + '):\n';
    skipNoV2.forEach(function(t) {
      msg += '  - ' + t.legacy + '  (no ' + t.v2 + ' in this workbook)\n';
    });
    msg += '  Run "Generate MDC and BOM" first to create the v2 tabs,\n' +
           '  then re-run this cleanup.\n\n';
  }

  if (skipV2Empty.length > 0) {
    msg += 'WILL SKIP -- v2 counterpart empty (' + skipV2Empty.length + '):\n';
    skipV2Empty.forEach(function(t) {
      msg += '  - ' + t.legacy + '  (' + t.v2 +
             ' lastRow=' + (t._v2LastRow == null ? '?' : t._v2LastRow) +
             ', threshold is >5)\n';
    });
    msg += '  Run the engine first so the v2 tabs get populated.\n\n';
  }

  if (notPresent.length > 0) {
    msg += 'ALREADY GONE (' + notPresent.length + '):\n';
    msg += '  ' + notPresent.join(', ') + '\n\n';
  }

  if (willDelete.length === 0) {
    msg += 'Nothing to delete in this run.';
    ui.alert('Delete Legacy Tabs -- nothing to do',
             msg,
             ui.ButtonSet.OK);
    return;
  }

  msg += 'RECOVERY: deleted tabs can be restored from File -> Version\n' +
         'history (Google Sheets keeps versions for ~30 days).\n\n' +
         'Proceed with deletion?';

  var resp = ui.alert('Delete Legacy Tabs', msg, ui.ButtonSet.OK_CANCEL);
  if (resp !== ui.Button.OK) {
    ui.alert('Cancelled', 'No tabs deleted.', ui.ButtonSet.OK);
    return;
  }

  // ---- Delete + log ------------------------------------------------------
  var deleted = [];
  var errors  = [];
  willDelete.forEach(function(t) {
    try {
      var sh = ss.getSheetByName(t.legacy);
      if (sh) {
        ss.deleteSheet(sh);
        deleted.push(t.legacy);
        try { engineLog(ss, 'Cleanup', 'INFO',
                        'Deleted legacy tab: ' + t.legacy +
                        ' (v2 counterpart ' + t.v2 + ' verified populated)'); }
        catch (_) {}
      }
    } catch (e) {
      errors.push({ name: t.legacy, message: e.message });
      try { engineLog(ss, 'Cleanup', 'ERROR',
                      'Could not delete ' + t.legacy + ': ' + e.message); }
      catch (_) {}
    }
  });

  // ---- Result message ----------------------------------------------------
  var result = 'Deleted ' + deleted.length + ' legacy tab(s):\n  ' +
               deleted.join('\n  ');
  if (errors.length > 0) {
    result += '\n\nErrors (' + errors.length + '):\n';
    errors.forEach(function(e) {
      result += '  - ' + e.name + ': ' + e.message + '\n';
    });
  }
  if (skipNoV2.length + skipV2Empty.length > 0) {
    result += '\n\nSkipped (' + (skipNoV2.length + skipV2Empty.length) +
              '): see prior dialog for reasons.';
  }
  ui.alert('Cleanup complete', result, ui.ButtonSet.OK);
}


// ===========================================================================
// PROJECT CARD v2 STANDALONE  (Tier 1 cutover, 2026-05-26)
// ---------------------------------------------------------------------------
// Standalone entry point for "Generate Project Card" menu item. Replaces the
// legacy runWriteProjectCard() which called writeProjectCard().
//
// FLOW
//   Mirrors the engine's mini-pipeline up to writeProjectCardV2: reads inputs,
//   loads panel/inverter, computes DC/AC/layout/BESS, calls writeProjectCardV2.
//   Skips the BOM / installation / CFE writers since they are not Project Card
//   prerequisites (writeProjectCardV2 reads its inputs from the calc layers
//   plus already-populated INSTALLATION_v2 / BOM_v2 sheets).
//
// NOTE
//   Running this standalone without a prior engine run means INSTALLATION_v2
//   and BOM_v2 may be stale -- the user is responsible for running the engine
//   first (same caveat as the legacy version).
// ===========================================================================
function runWriteProjectCardV2() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var TOTAL = 6;

  try {
    _setArgiaProgress(0, TOTAL, 'Starting Project Card\u2026');
    _showArgiaProgress('ARGIA \u2014 Project Card');

    _setArgiaProgress(1, TOTAL, 'Reading inputs\u2026');
    var nom     = loadNomConstants(ss);
    var inp     = readInputs(ss);

    _setArgiaProgress(2, TOTAL, 'Loading equipment\u2026');
    var panel   = lookupPanel(ss, inp.panelModel);
    var invBank = buildInverterBank(ss, inp.inverterBank);
    var tbls    = readElecTables(ss);

    _setArgiaProgress(3, TOTAL, 'Calculating DC / AC / layout\u2026');
    var dc      = calcDC(inp, panel, invBank, nom, tbls);
    var ac      = calcAC(inp, panel, invBank, nom, tbls, dc);
    var lay     = calcLayout(inp, dc, ac, nom);

    _setArgiaProgress(4, TOTAL, 'Reading BESS spec (if enabled)\u2026');
    // Fixed 2026-05-26: was calling nonexistent runBessSuggestion(...) which
    // threw a ReferenceError caught silently below, forcing bessResult=null
    // and hiding all BESS info on the Project Card. The actual function is
    // runBessStep(ss) -- same one used by Step 9.5 of the full engine
    // pipeline. PC v2 only needs bessResult.bessEnabled + bessResult.bess
    // (capacityKwh, powerKw), so runBessStep alone is sufficient -- we
    // don't need the downstream BoS/voltage-drop/NOM additions.
    var bessResult = null;
    try {
      bessResult = runBessStep(ss);
    } catch (bessErr) {
      // Invalid battery spec -- log loudly. writeProjectCardV2 handles
      // null bessResult by hiding all BESS lines (template owns the
      // labels, writer owns the values).
      engineLog(ss, 'ProjectCardV2', 'WARNING',
        'BESS read failed: ' + (bessErr.message || bessErr) +
        '. Project Card will hide BESS lines.');
    }

    _setArgiaProgress(5, TOTAL, 'Writing PROJECT_CARD_v2\u2026');
    setupProjectCardTemplate(ss);
    writeProjectCardV2(ss, inp, panel, invBank, dc, ac, lay, nom, bessResult);

    _setArgiaProgress(TOTAL, TOTAL, '\u2705 Done!');
    Utilities.sleep(1200);

    ui.alert('PROJECT_CARD_v2 generated.\n\n' +
             'Tip: Use ARGIA -> Exports -> Export Project Card to save as PDF.');
  } catch (e) {
    try { _setArgiaProgress(TOTAL, TOTAL, '\u274C Error'); } catch(_) {}
    ui.alert('Project Card v2 Error', e.message, ui.ButtonSet.OK);
  }
}


// ---------------------------------------------------------------------------
// runBaasProjectionMenu() -- Chunk 6 menu handler. Standalone (Option A):
// generates BAAS_PROJECTION_v2 from BESS materials + BESS install CAPEX and
// the BESS-attributable savings. Touches nothing in the PPA / FINANCE path.
// Requires a prior engine run (needs BOM_v2 + INSTALLATION_v2 + CFE_OUTPUT_v2
// populated).
// ---------------------------------------------------------------------------
function runBaasProjectionMenu() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  try {
    var ret = runBaasProjection(ss);

    var msg = 'BAAS_PROJECTION_v2 generated.\n\n'
      + 'BaaS CAPEX (materiales + instalacion BESS): $'
      + _baasFmt(ret.capex.totalMxn) + ' MXN\n'
      + '  - materiales (BOM_v2): $' + _baasFmt(ret.capex.materialsMxn) + '\n'
      + '  - instalacion (INSTALLATION_v2): $' + _baasFmt(ret.capex.installMxn) + '\n\n'
      + 'Mensualidad Ano 1: $' + _baasFmt(ret.result.headline.mensualidadAno1) + ' MXN\n'
      + 'Ahorro neto Ano 1: $' + _baasFmt(ret.result.headline.ahorroAno1Mxn)
      + ' (' + _baasPct(ret.result.headline.ahorroAno1Pct) + ')\n'
      + 'TIR ARGIA: ' + (ret.result.argiaIrr != null ? _baasPct(ret.result.argiaIrr) : 'n/d');

    if (ret.warnings && ret.warnings.length) {
      msg += '\n\nAvisos:\n- ' + ret.warnings.join('\n- ');
    }
    if (!ret.ok) {
      msg += '\n\n\u26A0 Datos incompletos: ejecute primero "Generate MDC and BOM" '
           + 'y "Update CFE Output" para poblar BOM/INSTALLATION/CFE.';
    }
    ui.alert('BaaS Projection', msg, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('BaaS Projection Error', e.message + '\n\n' + (e.stack || ''), ui.ButtonSet.OK);
  }
}
