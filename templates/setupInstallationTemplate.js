// =============================================================================
// ARGIA ENGINE v2 -- File: templates/setupInstallationTemplate.gs
// -----------------------------------------------------------------------------
// CHUNK 5 — INSTALLATION_v2 template.
//
// WHAT THIS DOES
//   Seeds the INSTALLATION_v2 sheet with all the structural content the
//   writer's `writeInstallationV2` does NOT generate. Specifically:
//
//     1. Banner rows 1-3: ARGIA logo (A2), "INSTALACIÓN · MXN" title (C2),
//        subtitle (C3). Mirrors legacy `addInstallationBanner` from 02e_InputSetup.js.
//     2. Row 4 panel headers: "DRIVER / INPUT | VALUE | NOTES" in A-C,
//        "SUMMARY | <grand-total mirror>" in F-G.
//     3. Driver block rows 5-34 col A (key labels) and col C (NOTES helper text):
//          - rows 5-23 = engine-driven numeric drivers (PROJECT_DC_WP..WORK_HEIGHT_M)
//          - rows 24-31 = factor-selection dropdowns
//          - row 32 = BLENDED_LABOR_RATE_MXN_MH (reference only)
//          - rows 33-34 = CONTINGENCY_PCT, INSURANCE_PCT_ON_LABOR_EQUIP (% format)
//     4. Data-validation dropdowns on rows 24-31 col B.
//        Allowed values match `02c_InputMap.js` (single source of truth).
//        Note: editing these on INSTALLATION_v2 does NOT affect engine — engine
//        reads from INPUT_INSTALL. Same display-only-mirror behavior as legacy.
//     5. Cream/grey palette + currency formatting on summary and section grid.
//        Mirrors legacy `restyleInstallationTopZone`.
//
// WHAT THE WRITER OWNS (and template does NOT)
//   - Driver-block values in col B (rows 5-34)
//   - Summary block values (cols F-G rows 5-12) — totals, MXN/kWp, etc
//   - Section grid values (cols F-J rows 15-23)
//   - Man-hours breakdown content (rows 24+ cols F-J... wait, those collide with
//     the driver block dropdowns at col B. The MAN-HOURS BREAKDOWN block lives
//     in cols F-J starting at row 24, so it does NOT conflict with col B.)
//   - Line-item zone (rows 40+, all 28 cols)
//   - Grand total + legend at the bottom
//
// LEGACY PARITY NOTES
//   - The dropdowns on legacy INSTALLATION are display-only mirrors — engine
//     reads selections from INPUT_INSTALL, not from this sheet. v2 preserves
//     that exact behavior. The dropdowns are editable but do nothing.
//   - "$242,159" in legacy G4 in your screenshot was a stale manual entry.
//     v2 writes `=G9` as a formula so G4 always mirrors the live grand total.
//     If you want strict-legacy behavior (leave G4 blank), say so.
//   - BLENDED_LABOR_RATE_MXN_MH row 32: legacy shows 0 in screenshot, NOTES
//     say "Reference only". v2 writer populates it from `totals.avgRateMxnMH`.
//
// IDEMPOTENT
//   Safe to re-run. Existing sheet is cleared and rebuilt. Existing user
//   selections on dropdowns are NOT preserved — re-run resets them to defaults.
//   This is intentional and matches the legacy `restyleInstallationTopZone`
//   contract (which also clears + re-applies).
// =============================================================================


// -----------------------------------------------------------------------------
// LAYOUT CONSTANTS — duplicated from legacy 02e_InputSetup.js + 13_CalcInstallCost.js
// per migration §2 (v2 shares no code/constants with legacy). Numbers must match
// or the writer's value writes won't land on the template-seeded labels.
// -----------------------------------------------------------------------------
var _INST_TPL_DRV_HEADER_ROW = 4;
var _INST_TPL_DRV_START_ROW  = 5;   // First data row (matches legacy off-by-one
                                     // where IC_DRV_START=4 includes header row)
var _INST_TPL_DRV_END_ROW    = 34;  // Last data row
var _INST_TPL_DRV_COL_KEY    = 1;   // col A
var _INST_TPL_DRV_COL_VAL    = 2;   // col B
var _INST_TPL_DRV_COL_NOTES  = 3;   // col C

var _INST_TPL_SUMMARY_HDR_ROW = 4;
var _INST_TPL_SUMMARY_COL_F   = 6;
var _INST_TPL_SUMMARY_COL_G   = 7;

var _INST_TPL_SECTION_HDR_ROW = 14;
var _INST_TPL_SECTION_START   = 15;
var _INST_TPL_SECTION_END     = 23;  // 9 rows for 9 sections

var _INST_TPL_MH_HDR_ROW   = 24;
var _INST_TPL_MH_START_ROW = 25;
var _INST_TPL_MH_TOTAL_ROW = 33;  // matches legacy `setRowHeight(33, ...)` reference

// -----------------------------------------------------------------------------
// DRIVER BLOCK CONTENT — verbatim from screenshot of legacy INSTALLATION.
// Each entry is [key, notes, valueType] where valueType ∈
// {'number', 'dropdown', 'percent', 'reference'}.
// Dropdowns carry their allowed-values list as 4th element.
// Default values for dropdowns match 02c_InputMap.js so the seeded
// pre-engine-run sheet has a usable state.
// -----------------------------------------------------------------------------
var _INST_TPL_DRIVER_BLOCK = [
  // row 5-13: engine-derived from BOM / layout / helper
  { key: 'PROJECT_DC_WP',          notes: 'Link from engine',       type: 'number'  },
  { key: 'PROJECT_DC_KWP',         notes: 'Auto',                   type: 'number'  },
  { key: 'PROJECT_AC_KW',          notes: 'Link from engine',       type: 'number'  },
  { key: 'MODULE_COUNT',           notes: 'Link from engine/BOM',   type: 'number'  },
  { key: 'INVERTER_COUNT',         notes: 'Link from engine/BOM',   type: 'number'  },
  { key: 'STRING_COUNT',           notes: 'Link from engine',       type: 'number'  },
  { key: 'ARRAY_GROSS_AREA_M2',    notes: 'Link from layout/helper',type: 'number'  },
  { key: 'ARRAY_NET_AREA_M2',      notes: 'Link from layout/helper',type: 'number'  },
  { key: 'ROOF_AREA_M2',           notes: 'Input/helper',           type: 'number'  },
  // row 14-18: BOM/helper-derived cable + tray + conduit
  { key: 'DC_CABLE_M',             notes: 'Link from BOM/helper',   type: 'number'  },
  { key: 'AC_CABLE_M',             notes: 'Link from BOM/helper',   type: 'number'  },
  { key: 'TRAY_M',                 notes: 'Link from BOM/helper',   type: 'number'  },
  { key: 'CONDUIT_M',              notes: 'Link from BOM/helper',   type: 'number'  },
  { key: 'GROUNDING_M',            notes: 'Link from BOM/helper',   type: 'number'  },
  // row 19-23: project specifics + estimator inputs
  { key: 'INTERCONNECTION_POINTS', notes: 'Project specific',       type: 'number'  },
  { key: 'ANCHOR_COUNT',           notes: 'Project specific',       type: 'number'  },
  { key: 'CREW_SIZE',              notes: 'Estimator input',        type: 'number'  },
  { key: 'EST_PROJECT_DAYS',       notes: 'Estimator input',        type: 'number'  },
  { key: 'WORK_HEIGHT_M',          notes: 'Estimator input',        type: 'number'  },
  // row 24-31: factor-selection dropdowns (display-only mirror per Q1)
  { key: 'INSTALLATION_TYPE',  notes: 'Dropdown', type: 'dropdown',
    options: ['ROOF', 'GROUND', 'CARPORT'],                                default: 'ROOF'     },
  { key: 'ACCESS_DIFFICULTY',  notes: 'Dropdown', type: 'dropdown',
    options: ['EASY', 'MEDIUM', 'HARD', 'VERY_HARD'],                      default: 'MEDIUM'   },
  { key: 'SITE_HSE_CLASS',     notes: 'Dropdown', type: 'dropdown',
    options: ['STANDARD', 'STRICT', 'HIGH_CONTROL'],                       default: 'STANDARD' },
  { key: 'ENERGIZED_TIE_IN',   notes: 'Dropdown', type: 'dropdown',
    options: ['YES', 'NO'],                                                default: 'NO'       },
  { key: 'SITE_DISTANCE_CLASS',notes: 'Dropdown', type: 'dropdown',
    options: ['LOCAL', 'REGIONAL', 'REMOTE'],                              default: 'LOCAL'    },
  { key: 'NIGHT_WORK_REQUIRED',notes: 'Dropdown', type: 'dropdown',
    options: ['YES', 'NO'],                                                default: 'NO'       },
  { key: 'PROJECT_COMPLEXITY', notes: 'Dropdown', type: 'dropdown',
    options: ['LOW', 'MEDIUM', 'HIGH'],                                    default: 'MEDIUM'   },
  { key: 'WEATHER_PROFILE',    notes: 'Dropdown', type: 'dropdown',
    options: ['DRY', 'RAIN_SEASON'],                                       default: 'DRY'      },
  // row 32: blended labor rate (reference only)
  { key: 'BLENDED_LABOR_RATE_MXN_MH', notes: 'Reference only', type: 'reference' },
  // row 33-34: percent overrides
  { key: 'CONTINGENCY_PCT',              notes: 'Override allowed', type: 'percent', default: 0.05 },
  { key: 'INSURANCE_PCT_ON_LABOR_EQUIP', notes: 'Override allowed', type: 'percent', default: 0.03 }
];
// _INST_TPL_DRIVER_BLOCK has 30 entries → rows 5..34 inclusive.


// =============================================================================
// SETUP FUNCTION
// =============================================================================
function setupInstallationTemplate(ss, opts) {
  ss = ss || SpreadsheetApp.getActive();
  opts = opts || {};

  var sheetName = opts.sheetName || V2_SHEETS.INSTALLATION;

  var sh = ss.getSheetByName(sheetName);
  if (!sh) {
    sh = ss.insertSheet(sheetName);
  } else {
    sh.clear();
    sh.clearConditionalFormatRules();
  }
  sh.setHiddenGridlines(true);

  // ── 1. Banner rows 1-3 ──────────────────────────────────────────────────
  _seedInstallV2Banner(sh, opts);

  // ── 2. Panel headers row 4 ──────────────────────────────────────────────
  _seedInstallV2PanelHeaders(sh, opts);

  // ── 3. Driver block rows 5-34 (col A labels, col C notes, dropdowns) ────
  _seedInstallV2DriverBlock(sh, opts);

  // ── 4. Summary panel formatting (col F-G rows 5-12) ─────────────────────
  _seedInstallV2SummaryFormatting(sh, opts);

  // ── 5. Section grid header + row formatting (col F-J rows 14-22) ────────
  // Note: data is written by writer; this seeds the styling. Writer overlays.
  _seedInstallV2SectionGridFormatting(sh, opts);

  // ── 6. Freeze rows 1-3 ──────────────────────────────────────────────────
  sh.setFrozenRows(3);

  return sh;
}


// =============================================================================
// HELPERS — split out for readability + testability
// =============================================================================

// ── 1. BANNER ───────────────────────────────────────────────────────────────
function _seedInstallV2Banner(sh, opts) {
  // Honor design tokens when available; fall back to hard-coded defaults so
  // tests work without loadDesignTokens
  var FONT = _instTplToken('FONT_FAMILY',      'Inter');
  var FS_TITLE  = _instTplTokenNum('FONT_SIZE_TITLE', 18);
  var FS_SMALL  = _instTplTokenNum('FONT_SIZE_SMALL', 9);
  var TXT_PRIM  = _instTplToken('TEXT_PRIMARY',  '#212121');
  var TXT_SEC   = _instTplToken('TEXT_SECONDARY','#616161');
  var ROW_H     = _instTplTokenNum('ROW_H_TITLE', 36);
  var FW_EMPH   = _instTplToken('FONT_WEIGHT_EMPHASIS', 'bold');

  // Logo at A2 (best-effort — _insertArgiaLogo may not exist in tests)
  if (typeof _insertArgiaLogo === 'function') {
    try { _insertArgiaLogo(sh, 2, 1); } catch (e) { /* no logo asset available */ }
  }

  sh.getRange(2, 3)
    .setValue('INSTALACI\u00d3N \u00b7 MXN')
    .setFontFamily(FONT)
    .setFontSize(FS_TITLE)
    .setFontWeight(FW_EMPH)
    .setFontColor(TXT_PRIM)
    .setVerticalAlignment('bottom');

  sh.getRange(3, 3)
    .setValue('Mano de obra \u00b7 Equipo \u00b7 Indirectos \u00b7 Las celdas azules son inputs editables')
    .setFontFamily(FONT)
    .setFontSize(FS_SMALL)
    .setFontColor(TXT_SEC);

  sh.setRowHeight(2, ROW_H);
}


// ── 2. PANEL HEADERS row 4 ───────────────────────────────────────────────────
function _seedInstallV2PanelHeaders(sh, opts) {
  var FONT     = _instTplToken('FONT_FAMILY', 'Inter');
  var BG_HDR   = _instTplToken('BG_INPUT_CELL', '#fef7e0');
  var TXT_PRIM = _instTplToken('TEXT_PRIMARY', '#212121');
  var DIV_STRG = _instTplToken('DIVIDER_STRONG', '#bdbdbd');

  // Left panel: A4-C4 "DRIVER / INPUT | VALUE | NOTES"
  sh.getRange(4, 1, 1, 3)
    .setValues([['DRIVER / INPUT', 'VALUE', 'NOTES']])
    .setBackground(BG_HDR)
    .setFontFamily(FONT)
    .setFontSize(11)
    .setFontWeight('bold')
    .setFontColor(TXT_PRIM)
    .setBorder(null, null, true, null, null, null, DIV_STRG,
               SpreadsheetApp.BorderStyle.SOLID);

  // Right panel: F4-G4 "SUMMARY | =G9"
  sh.getRange(4, 6, 1, 2)
    .setBackground(BG_HDR)
    .setFontFamily(FONT)
    .setFontSize(11)
    .setFontWeight('bold')
    .setFontColor(TXT_PRIM)
    .setBorder(null, null, true, null, null, null, DIV_STRG,
               SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(4, 6).setValue('SUMMARY');
  // G4 mirrors the grand total (writer populates G9). The formula updates
  // automatically when the engine re-runs.
  sh.getRange(4, 7).setFormula('=G9').setNumberFormat('"$"#,##0')
    .setHorizontalAlignment('right');
}


// ── 3. DRIVER BLOCK (col A labels, col C notes, col B formatting+dropdowns) ─
function _seedInstallV2DriverBlock(sh, opts) {
  var FONT      = _instTplToken('FONT_FAMILY', 'Inter');
  var TXT_PRIM  = _instTplToken('TEXT_PRIMARY', '#212121');
  var TXT_SEC   = _instTplToken('TEXT_SECONDARY', '#616161');
  var TXT_MUTED = _instTplToken('TEXT_MUTED', '#9e9e9e');
  var BG_INPUT  = _instTplToken('BG_INPUT_CELL', '#fff8e1');

  // 1. Col A — driver-key labels (light grey, small, muted)
  var keyValues = _INST_TPL_DRIVER_BLOCK.map(function(d) { return [d.key]; });
  sh.getRange(_INST_TPL_DRV_START_ROW, _INST_TPL_DRV_COL_KEY,
              keyValues.length, 1)
    .setValues(keyValues)
    .setBackground('#fafafa')
    .setFontFamily(FONT)
    .setFontSize(9)
    .setFontColor(TXT_SEC);

  // 2. Col C — NOTES helper text (white BG, small muted)
  var notesValues = _INST_TPL_DRIVER_BLOCK.map(function(d) { return [d.notes]; });
  sh.getRange(_INST_TPL_DRV_START_ROW, _INST_TPL_DRV_COL_NOTES,
              notesValues.length, 1)
    .setValues(notesValues)
    .setBackground('#ffffff')
    .setFontFamily(FONT)
    .setFontSize(9)
    .setFontColor(TXT_MUTED);

  // 3. Col B — value cells: editable styling (writer populates values)
  sh.getRange(_INST_TPL_DRV_START_ROW, _INST_TPL_DRV_COL_VAL,
              _INST_TPL_DRIVER_BLOCK.length, 1)
    .setBackground(BG_INPUT)
    .setFontFamily(FONT)
    .setFontSize(10)
    .setFontColor(TXT_PRIM)
    .setHorizontalAlignment('right')
    .setNumberFormat('#,##0');

  // 4. Dropdowns + percent format + default values — per-row
  _INST_TPL_DRIVER_BLOCK.forEach(function(d, i) {
    var row = _INST_TPL_DRV_START_ROW + i;

    if (d.type === 'dropdown') {
      var rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(d.options, true)
        .setAllowInvalid(false)
        .build();
      sh.getRange(row, _INST_TPL_DRV_COL_VAL)
        .setDataValidation(rule)
        .setHorizontalAlignment('left')
        .setNumberFormat('@');  // text format for string dropdowns
      if (d.default !== undefined) {
        sh.getRange(row, _INST_TPL_DRV_COL_VAL).setValue(d.default);
      }
    } else if (d.type === 'percent') {
      sh.getRange(row, _INST_TPL_DRV_COL_VAL)
        .setNumberFormat('0.00%');
      if (d.default !== undefined) {
        sh.getRange(row, _INST_TPL_DRV_COL_VAL).setValue(d.default);
      }
    }
    // 'number' and 'reference' types: format already set above (#,##0).
    // Writer overlays values for those rows.
  });
}


// ── 4. SUMMARY PANEL formatting (col F-G rows 5-12) ─────────────────────────
function _seedInstallV2SummaryFormatting(sh, opts) {
  var FONT     = _instTplToken('FONT_FAMILY', 'Inter');
  var TXT_PRIM = _instTplToken('TEXT_PRIMARY', '#212121');
  var TXT_SEC  = _instTplToken('TEXT_SECONDARY', '#616161');

  // Col F labels (rows 5-12) — light grey small font
  sh.getRange(5, 6, 8, 1)
    .setBackground('#f5f5f5')
    .setFontFamily(FONT)
    .setFontSize(10)
    .setFontColor(TXT_SEC);

  // Col G values (rows 5-12) — white BG, right-aligned, currency
  sh.getRange(5, 7, 8, 1)
    .setBackground('#ffffff')
    .setFontFamily(FONT)
    .setFontSize(11)
    .setFontColor(TXT_PRIM)
    .setHorizontalAlignment('right')
    .setNumberFormat('"$"#,##0');

  // GRAND TOTAL row 9 — BOM grand-total style (cream BG + bold + thick border)
  sh.getRange(9, 6, 1, 2)
    .setBackground('#fffde7')
    .setFontFamily(FONT)
    .setFontSize(12)
    .setFontWeight('bold')
    .setFontColor(TXT_PRIM)
    .setBorder(true, null, true, null, null, null, '#424242',
               SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sh.setRowHeight(9, 28);
}


// ── 5. SECTION GRID formatting (col F-J rows 14-22) ─────────────────────────
function _seedInstallV2SectionGridFormatting(sh, opts) {
  var FONT     = _instTplToken('FONT_FAMILY', 'Inter');
  var TXT_PRIM = _instTplToken('TEXT_PRIMARY', '#212121');
  var TXT_SEC  = _instTplToken('TEXT_SECONDARY', '#616161');

  // Section data rows (15-23, 9 rows for 9 sections) — neutral white,
  // right-aligned numbers, bold TOTAL col
  sh.getRange(15, 6, 9, 5)
    .setBackground('#ffffff')
    .setFontFamily(FONT)
    .setFontSize(10)
    .setFontColor(TXT_PRIM);

  // Section name labels (col F rows 15-23) — slightly muted
  sh.getRange(15, 6, 9, 1).setFontColor(TXT_SEC);

  // Number cols (G-J rows 15-23) — right-aligned currency no decimals
  sh.getRange(15, 7, 9, 4)
    .setHorizontalAlignment('right')
    .setNumberFormat('"$"#,##0');

  // Bold TOTAL col (J) so it stands out
  sh.getRange(15, 10, 9, 1).setFontWeight('bold');

  // Row separator borders
  sh.getRange(15, 6, 9, 5).setBorder(
    null, null, true, null, null, true,
    '#eeeeee', SpreadsheetApp.BorderStyle.SOLID
  );
}


// =============================================================================
// TOKEN HELPERS — use loadDesignTokens output when available, fall back to defaults
// =============================================================================
function _instTplToken(name, fallback) {
  if (typeof token === 'function') {
    try {
      var v = token(name);
      if (v !== null && v !== undefined && v !== '') return v;
    } catch (e) { /* fall through */ }
  }
  return fallback;
}

function _instTplTokenNum(name, fallback) {
  if (typeof tokenNum === 'function') {
    try {
      var v = tokenNum(name);
      if (v && !isNaN(v)) return v;
    } catch (e) { /* fall through */ }
  }
  return fallback;
}
