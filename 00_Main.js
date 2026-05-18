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
//   writeMDC(ss, inp, panel, invBank, dc, ac, lay, nom)
//   writeBOM(ss, inp, panel, invBank, dc, ac, lay, nom)
//
// DATA CONTRACT RULE: every calc function receives ONLY typed objects.
// No function reads from the spreadsheet directly except readInputs/readElecTables/load*.
// =============================================================================

// ---------------------------------------------------------------------------
// SHEET NAME CONSTANTS -- must match exact tab names in Google Sheet
// ---------------------------------------------------------------------------
var SH = {
  INPUT_GENERAL  : 'INPUT_GENERAL',
  INPUT_DESIGN   : 'INPUT_DESIGN',
  PANELS_MIRROR  : '11M_PRODUCTS_PANELS',
  INV_MIRROR     : '12M_PRODUCTS_INVERTERS',
  ELEC_TABLES    : '15M_ELEC_TABLES',
  MDC            : 'MDC',
  BOM            : 'BOM',
  LOGS           : 'LOGS',
  // Installation cost sheets
  INSTALL_COST       : 'INSTALLATION',
  INSTALL_DRIVER_MAP : '95_INSTALL_DRIVER_MAP',
  INSTALL_LIB        : '90M_INSTALL_LIB',
  INSTALL_FACTORS    : '91M_INSTALL_FACTORS',
  INSTALL_ROLE_RATES : '92M_INSTALL_ROLE_RATES',
  INSTALL_EQUIP_RATES: '93M_INSTALL_EQUIP_RATES',
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

  // Footer (row 80)
  GRAND_TOTAL:          80,
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
  TOTAL_MXN:   7,   // G — line total MXN (formula: =F*$F$3)
  REFERENCE:   8,   // H — DB ref / NOM citation / note
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
  ui.createMenu('ARGIA')
    .addItem('Import Helioscope',         'importHelioscopePdf')
    .addItem('Verify Layout',             'verifyInputs')
    .addItem('Generate MDC and BOM',      'runArgiaEngine')
    .addItem('Generate Installation',     'runInstallCostStandalone')
    .addItem('Generate Project Card',     'runWriteProjectCard')
    .addItem('Generate RFQs',             'runWriteAllRFQs')
    .addSeparator()
    .addSubMenu(ui.createMenu('Exports')
      .addItem('Export MDC',                         'exportMDC')
      .addItem('Export BOM',                         'exportBOM')
      .addItem('Export Installation',                'exportInstallation')
      .addItem('Export Project Card',                'exportProjectCard')
      .addSeparator()
      .addItem('Export All (MDC+BOM+Install+PC)',    'exportAll'))
    .addSeparator()
    .addSubMenu(ui.createMenu('Export RFQ')
      .addItem('RFQ Paneles',    'exportRfqPaneles')
      .addItem('RFQ Inversores', 'exportRfqInversores')
      .addItem('RFQ Estructura', 'exportRfqEstructura')
      .addItem('RFQ Electrico',  'exportRfqElectrico')
      .addItem('RFQ Monitoreo',  'exportRfqMonitoreo')
      .addSeparator()
      .addItem('Export All RFQs','exportAllRfqs'))
    .addSeparator()
    .addSubMenu(ui.createMenu('Setup')
      .addItem('Setup Install Inputs',      'runSetupInstallInputs')
      .addItem('Setup Project Card Inputs', 'runSetupProjectCardInputs')
      .addItem('Setup SLIDE_DATA',          'setupSlideDataTab')
      .addItem('Data Validation',           'testKickerData'))
    .addSeparator()
    .addItem('Run Regression Tests',  'runTests')
    .addSeparator()
    .addItem('Create Offer EN',  'generateKickerEN')
    .addItem('Create Offer ES',  'generateKickerES')
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
    if (!found && name !== 'LOGS' && name !== 'BOM') allOk = false;
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
    // Install sheets are optional -- they only need IMPORTRANGE to be set up.
    // Core engine (MDC/BOM) runs even if install mirrors are missing.
    var OPTIONAL_SHEETS = ['INSTALLATION','95_INSTALL_DRIVER_MAP',
      '90M_INSTALL_LIB','91M_INSTALL_FACTORS','92M_INSTALL_ROLE_RATES','93M_INSTALL_EQUIP_RATES'];
    var missing = [];
    Object.keys(SH).forEach(function(key) {
      var name = SH[key];
      if (name === 'LOGS' || name === 'BOM') return;
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

    // Step 10: write MDC ----------------------------------------------------
    _setArgiaProgress(10, TOTAL, 'Writing MDC\u2026');
    engineLog(ss, 'Engine', 'INFO', 'Step 10: writing MDC');
    writeMDC(ss, inp, panel, invBank, dc, ac, lay, nom);

    // Step 11: write BOM ----------------------------------------------------
    _setArgiaProgress(11, TOTAL, 'Writing BOM\u2026');
    engineLog(ss, 'Engine', 'INFO', 'Step 11: writing BOM');
    writeBOM(ss, inp, panel, invBank, dc, ac, lay, nom);

    // Step 12: install cost -------------------------------------------------
    _setArgiaProgress(12, TOTAL, 'Installation cost\u2026');
    engineLog(ss, 'Engine', 'INFO', 'Step 12: installation cost');
    try {
      runInstallCost(ss, inp, invBank, dc, ac, lay);
    } catch (installErr) {
      engineLog(ss, 'Engine', 'WARNING',
        'Installation cost skipped: ' + installErr.message +
        '. Run "Calculate Installation" from menu after fixing.');
    }

    // Step 13: project card -------------------------------------------------
    _setArgiaProgress(13, TOTAL, 'Writing Project Card\u2026');
    engineLog(ss, 'Engine', 'INFO', 'Step 13: writing Project Card');
    try {
      writeProjectCard(ss, inp, panel, invBank, dc);
    } catch (pcErr) {
      engineLog(ss, 'Engine', 'WARNING',
        'Project Card skipped: ' + pcErr.message +
        '. Run "Generate Project Card" from menu after fixing.');
    }

    // Done ------------------------------------------------------------------
    _setArgiaProgress(TOTAL, TOTAL, '\u2705 Complete!');
    logRunEnd(ss, Date.now() - startTime);

    // v2.0.0: stamp engine version on every successful run.
    // Wrapped in try/catch so stamping failure never blocks the engine.
    try { stampMeta(ss, {runType: 'engine'}); }
    catch (stampErr) {
      try { engineLog(ss, 'Engine', 'WARN', 'stampMeta failed: ' + stampErr.message); } catch (_) {}
    }

    Utilities.sleep(1600); // let dialog reach 100 % before auto-close

    var flags = [
      dc.dc01Pass ? null : 'DC-01 Voc FAIL',
      dc.dc02Pass ? null : 'DC-02 Vmp FAIL',
      dc.vdropDCFail ? 'DC-07 vdrop FAIL' : null,
      dc.str01Pass ? null : 'STR-01 window FAIL',
    ].filter(Boolean);

    ui.alert(
      'ARGIA ENGINE \u2014 Complete',
      'MDC and BOM generated in ' + ((Date.now() - startTime) / 1000).toFixed(1) + 's.\n\n' +
      (flags.length > 0
        ? 'Active flags:\n' + flags.join('\n') + '\n\nSee section 4.0 in MDC and LOGS sheet.'
        : 'All NOM checks passed.'),
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
