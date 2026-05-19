// =============================================================================
// ARGIA ENGINE v7 -- File: 02e_InputSetup.gs
// Builds the new 4-tab input structure from INPUT_MAP. Each tab is created
// by iterating the fields in INPUT_MAP whose sheet === that tab name,
// grouped by section, styled with design tokens, validated by type.
//
// CURRENT STATUS
//   setupInputProject() -- POPULATED. Pilot for the other three.
//   setupInputDesign()  -- stub. Built once PROJECT design is approved.
//   setupInputInstall() -- stub. Built once PROJECT design is approved.
//   setupInputCFE()     -- stub. Empty shell per Track A scope.
//
// BEHAVIOR (per agreement 2026-04-23)
//   - If the tab exists, wipe and rebuild. Safety: if the tab exists AND has
//     user-entered values in its value column, throw unless confirm=true.
//     Prevents accidental data loss.
//   - Setup writes only labels, section headers, defaults, and validation.
//     Does NOT copy legacy data. A separate migration function handles that.
//
// VISUAL LAYOUT
//   Column widths  A:24  B-C:240  D:220  E:120  F:80  G:80 (status)
//   - A     narrow left margin (empty)
//   - B-C   label cells (merged, left-aligned)
//   - D     VALUE cell where user types -- THE ONLY EDITABLE CELL PER ROW
//   - E     unit cell (read-only, grey) -- "°C", "MXN/MH", etc.
//   - F     notes column (currently unused; reserved)
//   - G     status icon (future: ✓/!/✗ driven by validator)
//
// USAGE
//   setupInputProject()                -- create/rebuild INPUT_PROJECT
//   setupInputProject(true)            -- same, force-overwrite user data
//   From IDE Run button: select setupInputProject, click Run.
// =============================================================================


// ---------------------------------------------------------------------------
// PUBLIC: Create or rebuild INPUT_PROJECT tab
// ---------------------------------------------------------------------------
function setupInputProject(confirmOverwrite) {
  _setupOneTab(SH.INPUT_PROJECT, 'DATOS DEL PROYECTO', confirmOverwrite === true);
}

// Stubs for the remaining tabs. Built as each is approved.
function setupInputDesign(confirmOverwrite) {
  _setupDesignTab(confirmOverwrite === true);
}
function setupInputInstall(confirmOverwrite) {
  _setupOneTab(SH.INPUT_INSTALL, 'INPUTS DE INSTALACIÓN', confirmOverwrite === true);
}
function setupInputCFE(confirmOverwrite) {
  // Styling-only refresh — does NOT wipe data, does NOT touch formulas.
  // Safe to run on the live workbook. confirmOverwrite is ignored because
  // there is nothing destructive happening.
  _styleInputCFETab();
}


// ---------------------------------------------------------------------------
// Lightweight "sheet exists" helper for non-UI callers (test fixture).
// Does NOT style, does NOT lay out rows, does NOT wipe. Just guarantees the
// tab exists so writeInput() has somewhere to write.
//
// Returns the sheet. Idempotent.
// ---------------------------------------------------------------------------
function ensureInputProjectExists(ss) {
  ss = ss || SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SH.INPUT_PROJECT);
  if (sh) return sh;
  return ss.insertSheet(SH.INPUT_PROJECT);
}

function ensureInputInstallExists(ss) {
  ss = ss || SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SH.INPUT_INSTALL);
  if (sh) return sh;
  return ss.insertSheet(SH.INPUT_INSTALL);
}

function ensureInputDesignExists(ss) {
  ss = ss || SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SH.INPUT_DESIGN);
  if (sh) return sh;
  return ss.insertSheet(SH.INPUT_DESIGN);
}


// ---------------------------------------------------------------------------
// _DROPDOWNS helper tab
// ---------------------------------------------------------------------------
// Hosts live ARRAYFORMULA-driven dropdown sources for input fields whose
// option list is composed from multiple DB columns and therefore can't point
// directly at a single DB column.
//
// Currently supports:
//   col A (header DROPDOWN_STRUCTURES) — "BRAND — MODEL — STR_ID" composite
//          built live from 13M_PRODUCTS_STRUCTURES B/C/A. INPUT_DESIGN!C15
//          (map key 'structure') reads from this range.
//
// To add another composite dropdown later, claim a new column here and point
// the relevant INPUT_MAP entry at it via dropdownRange.
//
// IDEMPOTENT. Re-running this just re-asserts the formula and header text.
// The underlying ARRAYFORMULA recomputes live, so adding a structure to the
// MASTER_DB-mirrored 13M tab makes it appear in the dropdown immediately.
// ---------------------------------------------------------------------------
var DROPDOWNS_TAB = '_DROPDOWNS';

function _ensureDropdownsTab(ss) {
  ss = ss || SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(DROPDOWNS_TAB);
  if (!sh) {
    sh = ss.insertSheet(DROPDOWNS_TAB);
    // Hide it — it's plumbing, not user-facing.
    sh.hideSheet();
  }

  // Column A: structures composite ----------------------------------------
  // ARRAYFORMULA returns a column that is empty for blank source rows and
  // "BRAND — MODEL — STR_ID" otherwise. requireValueInRange honors blanks,
  // but Sheets dedupes them in the dropdown UI so users see only real options.
  sh.getRange('A1').setValue('DROPDOWN_STRUCTURES');
  sh.getRange('A2').setFormula(
    '=ARRAYFORMULA(' +
      'IF(' +
        "LEN('13M_PRODUCTS_STRUCTURES'!A2:A)=0,," +
        "'13M_PRODUCTS_STRUCTURES'!B2:B&\" — \"&" +
        "'13M_PRODUCTS_STRUCTURES'!C2:C&\" — \"&" +
        "'13M_PRODUCTS_STRUCTURES'!A2:A" +
      ')' +
    ')'
  );

  // Light formatting so a developer who unhides the tab sees what it is.
  sh.getRange('A1').setFontWeight('bold').setBackground('#F5F3EE');
  sh.setColumnWidth(1, 320);

  return sh;
}


// ---------------------------------------------------------------------------
// CORE: render one tab from INPUT_MAP entries
// ---------------------------------------------------------------------------
function _setupOneTab(tabName, docTitle, force) {
  var ss = SpreadsheetApp.getActive();
  resetDesignTokenCache_();  // pick up any token edits since last run
  loadDesignTokens(ss);

  // ---- Safety check: do not clobber user data unless force=true
  var existing = ss.getSheetByName(tabName);
  if (existing && !force) {
    var hasUserData = _detectUserData(existing, tabName);
    if (hasUserData) {
      // Derive the right setup function name from the tab name so the
      // hint message is accurate for whichever tab triggered this.
      // INPUT_PROJECT -> setupInputProject, INPUT_INSTALL -> setupInputInstall
      var setupFnName = 'setup' + tabName.split('_').map(function(p){
        return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
      }).join('');
      throw new Error(
        'setup: tab "' + tabName + '" exists and contains user-entered values.\n' +
        'Call ' + setupFnName + '(true) to force overwrite, or rename the existing ' +
        'tab first if you want to keep it as a backup.'
      );
    }
  }

  // ---- Wipe and recreate
  if (existing) ss.deleteSheet(existing);
  var sh = ss.insertSheet(tabName);

  // ---- Page canvas (hidden gridlines, column widths)
  _applyInputCanvas(sh);

  // ---- Logo (top-left, cols B-C, rows 2-3) + title shifted to col D
  // 2026-04-28: subtitle 'Rev 00 · Borrador' removed -- it was hardcoded
  // legacy text that didn't update with project state. Title alone is cleaner.
  _insertArgiaLogo(sh, 2, 2);
  _writeTitleShifted(sh, 2, docTitle, null);

  // ---- Collect this tab's fields and sections
  var sections = inputSectionsForTab(tabName);
  if (sections.length === 0) {
    sh.getRange(5, 2).setValue('No fields in INPUT_MAP for ' + tabName);
    return sh;
  }

  // ---- Render each section
  sections.forEach(function(sectionLabel) {
    var keys = inputKeysForSection(tabName, sectionLabel);
    if (keys.length === 0) return;

    // Find the section header row: min row among keys, minus 2
    var minRow = Math.min.apply(null, keys.map(function(k){ return INPUT_MAP[k].row; }));
    var headerRow = minRow - 2;
    if (headerRow < 5) headerRow = 5;  // never collide with title block

    // Parse "01 IDENTIFICACIÓN" into number + name for primSectionHeader
    var parts = sectionLabel.match(/^(\S+)\s+(.*)$/);
    var num   = parts ? parts[1] : '';
    var title = parts ? parts[2] : sectionLabel;

    primSectionHeader(sh, headerRow, num, title, null);

    // If any key in this section has a sibling entry at col 5 (paired-column
    // layout, e.g. cost-range min/max pairs), write "MIN" / "MAX" sub-headers
    // at minRow - 1 so the columns are clearly labeled.
    // Phase A polish (2026-04-28): without this, the user sees two value
    // cells side-by-side with no indication of which is min vs max.
    var hasPairedKeys = keys.some(function(k) {
      return _hasSiblingEntryAt(INPUT_MAP[k], 5);
    });
    if (hasPairedKeys && minRow - 1 > headerRow) {
      _renderPairedColumnHeaders(sh, minRow - 1);
    }

    // Render each field in the section
    keys.forEach(function(key) {
      _renderInputRow(sh, INPUT_MAP[key]);
    });
  });

  // ---- Freeze title so it stays visible when scrolling
  sh.setFrozenRows(3);

  return sh;
}


// ---------------------------------------------------------------------------
// PRIMITIVE: render one input row at its map coordinates
// Label in B:C, value cell in D, unit in E. Data validation applied per type.
// ---------------------------------------------------------------------------
function _renderInputRow(sh, mapEntry) {
  var r = mapEntry.row;
  var c = mapEntry.col || 4;

  // Phase A fix (2026-04-28): honor mapEntry.col. The cost-range pairs
  // (e.g. costRangePanelsMin at col 4 + costRangePanelsMax at col 5) live on
  // the same row. The primary entry (col=4) writes the label, value, and
  // unit. Secondary entries (col != 4) only render their own value cell --
  // they MUST NOT overwrite label/unit/divider written by the primary, and
  // the unit is suppressed entirely since col 5 is now occupied by the max
  // value.
  if (c !== 4) {
    var secondaryCell = sh.getRange(r, c);
    if (mapEntry.hasOwnProperty('default') && mapEntry.default !== '') {
      secondaryCell.setValue(mapEntry.default);
    }
    secondaryCell
      .setFontFamily(token('FONT_FAMILY'))
      .setFontSize(tokenNum('FONT_SIZE_BODY'))
      .setFontColor(token('TEXT_PRIMARY'))
      .setBackground(token('BG_INPUT_CELL'))
      .setHorizontalAlignment('right')
      .setVerticalAlignment('middle');
    _applyTypeValidation(secondaryCell, mapEntry);
    return;
  }

  // ── Primary entry rendering (col === 4) ──────────────────────────────────

  // Label (B:C merged) -----------------------------------------------------
  sh.getRange(r, 2, 1, 2).breakApart().merge()
    .setValue(mapEntry.label + (mapEntry.required ? ' *' : ''))
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_BODY'))
    .setFontColor(token('TEXT_PRIMARY'))
    .setVerticalAlignment('middle');

  // Value cell (D) ---------------------------------------------------------
  var valueCell = sh.getRange(r, 4);

  // Default value (if any) --------------------------------------------------
  if (mapEntry.hasOwnProperty('default') && mapEntry.default !== '') {
    valueCell.setValue(mapEntry.default);
  }

  // Style the value cell
  valueCell
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_BODY'))
    .setFontColor(token('TEXT_PRIMARY'))
    .setBackground(token('BG_INPUT_CELL'))
    .setHorizontalAlignment('right')
    .setVerticalAlignment('middle')
    .setBorder(
      null, null, true, null, null, null,
      token('DIVIDER_LINE'), SpreadsheetApp.BorderStyle.SOLID
    );

  // Type-driven validation and number formatting
  _applyTypeValidation(valueCell, mapEntry);

  // Unit cell — col E by default, but redirect to col F when col 5 is
  // occupied by a paired-column sibling (e.g. cost-range max value lives
  // at col E, so the unit shifts to col F to stay visible).
  var hasSecondaryAtColE = _hasSiblingEntryAt(mapEntry, 5);
  var unitCol = hasSecondaryAtColE ? 6 : 5;
  var hint = mapEntry.unit || _formatHintFor(mapEntry);
  if (hint) {
    sh.getRange(r, unitCol)
      .setValue(hint)
      .setFontFamily(token('FONT_FAMILY'))
      .setFontSize(tokenNum('FONT_SIZE_SMALL'))
      .setFontColor(token('TEXT_SECONDARY'))
      .setFontStyle(mapEntry.unit ? 'normal' : 'italic')
      .setHorizontalAlignment('left')
      .setVerticalAlignment('middle');
  }

  // Row-level divider beneath the whole row
  sh.getRange(r, 2, 1, 6).setBorder(
    null, null, true, null, null, null,
    token('DIVIDER_LINE'), SpreadsheetApp.BorderStyle.SOLID
  );

  sh.setRowHeight(r, tokenNum('ROW_H_BODY'));
}

// Helper for paired-column rendering. Returns true if any other INPUT_MAP
// entry shares this entry's row + sheet and lives at the given column.
function _hasSiblingEntryAt(primaryEntry, col) {
  var keys = Object.keys(INPUT_MAP);
  for (var i = 0; i < keys.length; i++) {
    var m = INPUT_MAP[keys[i]];
    if (m === primaryEntry) continue;
    if (m.sheet === primaryEntry.sheet && m.row === primaryEntry.row && m.col === col) {
      return true;
    }
  }
  return false;
}

// Render "MIN" / "MAX" sub-headers at cols D and E of the given row.
// Used when a section has paired-column rows (e.g. cost-range min/max pairs)
// so the user can tell which column is which without inspecting the map.
function _renderPairedColumnHeaders(sh, row) {
  var labels = ['MIN', 'MAX'];
  labels.forEach(function(label, idx) {
    sh.getRange(row, 4 + idx)
      .setValue(label)
      .setFontFamily(token('FONT_FAMILY'))
      .setFontSize(tokenNum('FONT_SIZE_SMALL'))
      .setFontColor(token('TEXT_SECONDARY'))
      .setFontWeight('bold')
      .setHorizontalAlignment('right')
      .setVerticalAlignment('middle');
  });
}


// ---------------------------------------------------------------------------
// Apply type-specific formatting and data validation to a value cell
// ---------------------------------------------------------------------------
function _applyTypeValidation(cell, mapEntry) {
  var t = mapEntry.type;

  if (t === 'number') {
    cell.setNumberFormat('#,##0.####');
    var rule = SpreadsheetApp.newDataValidation()
      .requireNumberBetween(-1e12, 1e12)
      .setAllowInvalid(true)  // let users type anything; validator flags later
      .setHelpText('Número')
      .build();
    cell.setDataValidation(rule);
  }
  else if (t === 'percent') {
    cell.setNumberFormat('0.00%');
    var rule = SpreadsheetApp.newDataValidation()
      .requireNumberBetween(-10, 10)
      .setAllowInvalid(true)
      .setHelpText('Porcentaje — e.g. 0.15 = 15%')
      .build();
    cell.setDataValidation(rule);
  }
  else if (t === 'date') {
    cell.setNumberFormat('dd/MM/yyyy');
    var rule = SpreadsheetApp.newDataValidation()
      .requireDate()
      .setAllowInvalid(false)   // strict: must be a valid date
      .setHelpText('Ingrese una fecha válida (dd/mm/yyyy)')
      .build();
    cell.setDataValidation(rule);
  }
  else if (t === 'dropdown') {
    var rule;
    if (mapEntry.dropdownRange) {
      // Range-sourced dropdown — value list lives in a sheet range,
      // changes there propagate automatically to every input cell.
      var ss = cell.getSheet().getParent();
      var range;
      try {
        range = ss.getRange(mapEntry.dropdownRange);
      } catch (e) {
        throw new Error(
          'dropdownRange for "' + mapEntry.label + '" invalid: "' +
          mapEntry.dropdownRange + '". ' + e.message
        );
      }
      rule = SpreadsheetApp.newDataValidation()
        .requireValueInRange(range, true)
        .setAllowInvalid(false)
        .setHelpText('Seleccione un valor de ' + mapEntry.dropdownRange)
        .build();
    } else {
      // Hardcoded list dropdown
      rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(mapEntry.dropdown, true)
        .setAllowInvalid(false)
        .setHelpText('Seleccione: ' + mapEntry.dropdown.join(' / '))
        .build();
    }
    cell.setDataValidation(rule);
  }
  else if (t === 'flag') {
    cell.setNumberFormat('0');
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['0', '1', 0, 1], false)
      .setAllowInvalid(false)
      .setHelpText('0 = no, 1 = sí')
      .build();
    cell.setDataValidation(rule);
  }
  // 'text' -> no validation, no format
}


// ---------------------------------------------------------------------------
// Apply page-wide canvas: hidden gridlines, column widths
// ---------------------------------------------------------------------------
function _applyInputCanvas(sh) {
  sh.setHiddenGridlines(true);
  sh.setColumnWidth(1, 24);   // A narrow margin
  sh.setColumnWidth(2, 120);  // B label part 1
  sh.setColumnWidth(3, 200);  // C label part 2 (merged with B)
  sh.setColumnWidth(4, 220);  // D VALUE cell (the editable one)
  sh.setColumnWidth(5, 120);  // E unit
  sh.setColumnWidth(6, 80);   // F reserved
  sh.setColumnWidth(7, 60);   // G status icon (future)
}


// ---------------------------------------------------------------------------
// Detect whether a tab has any user-entered values we'd clobber on rebuild.
// Conservative: looks only at the value column (D). If ANY D cell has a
// value other than the defaults from INPUT_MAP, we call it "user data".
// ---------------------------------------------------------------------------
function _detectUserData(sh, tabName) {
  var keys = inputKeysForTab(tabName);
  if (keys.length === 0) return false;
  for (var i = 0; i < keys.length; i++) {
    var m = INPUT_MAP[keys[i]];
    // Skip range-mode and skip-mode entries. Ranges are tabular blocks
    // whose "default" state is an empty 2D array; skip-mode entries
    // point at cells that cohabit with other keys.
    if (m.mode === 'range' || m.mode === 'skip') continue;
    var v = sh.getRange(m.row, m.col).getValue();
    if (v === '' || v === null || v === undefined) continue;
    // If we have a default and the current value equals it, not "user data"
    if (m.hasOwnProperty('default') && v === m.default) continue;
    // Anything else -> user data
    return true;
  }
  return false;
}


// ---------------------------------------------------------------------------
// Logo placement — top-left, cols B-C, rows 2-3.
// Reads the Drive folder ID from 00_MASTER_LINK!K2 and looks for
// argia_logo_dark.png inside. Silently skips if not found (non-fatal).
// ---------------------------------------------------------------------------
var LOGO_FILENAME = 'argia_logo_dark.png';
var LOGO_MASTER_LINK_SHEET = '00_MASTER_LINK';
var LOGO_MASTER_LINK_CELL  = 'K2';
var LOGO_HEIGHT_PX = 42;   // Was 50px; 2026-04-24 reduced 15% per user request
                            // for cleaner banner across all input tabs.

function _insertArgiaLogo(sh, row, col) {
  try {
    var ss = sh.getParent();
    var link = ss.getSheetByName(LOGO_MASTER_LINK_SHEET);
    if (!link) {
      Logger.log('_insertArgiaLogo: sheet "' + LOGO_MASTER_LINK_SHEET + '" not found, skipping logo.');
      return;
    }
    var folderId = String(link.getRange(LOGO_MASTER_LINK_CELL).getValue() || '').trim();
    if (!folderId) {
      Logger.log('_insertArgiaLogo: ' + LOGO_MASTER_LINK_SHEET + '!' + LOGO_MASTER_LINK_CELL + ' is empty, skipping logo.');
      return;
    }

    var folder;
    try { folder = DriveApp.getFolderById(folderId); }
    catch (e) {
      Logger.log('_insertArgiaLogo: folder ID "' + folderId + '" not accessible: ' + e.message);
      return;
    }

    var files = folder.getFilesByName(LOGO_FILENAME);
    if (!files.hasNext()) {
      Logger.log('_insertArgiaLogo: "' + LOGO_FILENAME + '" not found in folder ' + folderId);
      return;
    }

    var blob = files.next().getBlob();
    // Place at row 2, col B (col=2). Apps Script uses 1-based cell coords
    // for insertImage, with offset in pixels.
    var img = sh.insertImage(blob, col, row, 0, 0);

    // Scale to target height, preserve aspect ratio
    var currentH = img.getHeight();
    if (currentH > 0) {
      var ratio = LOGO_HEIGHT_PX / currentH;
      img.setHeight(LOGO_HEIGHT_PX);
      img.setWidth(Math.round(img.getWidth() * ratio));
    }
  } catch (e) {
    Logger.log('_insertArgiaLogo: unexpected error, skipping logo. ' + e.message);
  }
}


// ---------------------------------------------------------------------------
// Title shifted to col D (to leave cols B-C for the logo).
// Title on row, subtitle on row+1.
// ---------------------------------------------------------------------------
function _writeTitleShifted(sh, row, title, subtitle) {
  sh.getRange(row, 4, 1, 4).breakApart().merge()
    .setValue(title)
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_TITLE'))
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontColor(token('TEXT_PRIMARY'))
    .setVerticalAlignment('bottom');
  sh.setRowHeight(row, tokenNum('ROW_H_TITLE'));

  if (subtitle) {
    sh.getRange(row + 1, 4, 1, 4).breakApart().merge()
      .setValue(subtitle)
      .setFontFamily(token('FONT_FAMILY'))
      .setFontSize(tokenNum('FONT_SIZE_SMALL'))
      .setFontColor(token('TEXT_SECONDARY'));
  }
}


// ---------------------------------------------------------------------------
// Format hint text shown in col E when no unit is defined.
// Returns '' for types that need no hint (plain text, flags).
// ---------------------------------------------------------------------------
function _formatHintFor(mapEntry) {
  switch (mapEntry.type) {
    case 'date':     return 'dd/mm/yyyy';
    case 'percent':  return '0.15 = 15%';
    case 'dropdown': return '';   // dropdown arrow is its own hint
    case 'flag':     return '0 ó 1';
    case 'number':   return '';   // number fields usually have a unit; skip if not
    case 'text':     return '';
    default:         return '';
  }
}


// =============================================================================
// INPUT_DESIGN — custom renderer
// =============================================================================
// Different from _setupOneTab because the layout is specialized:
//   - Two-column grid for scalar inputs (left = env/elec/dist, right = geom/layout/bom)
//   - Dashboard row with 5 computed metric tiles
//   - Helioscope monthly table (12 rows)
//   - Equipment tables (panels + inverters, 5 slots each)
//   - String config block
//
// Inputs rendered via INPUT_MAP entries are picked up from _MAP_DESIGN
// automatically. Ranges and skip-mode entries are not rendered as individual
// rows — their physical cells come from the helioscope/equipment block
// render below.

function _setupDesignTab(force) {
  var ss = SpreadsheetApp.getActive();
  resetDesignTokenCache_();
  loadDesignTokens(ss);

  // ---- Build/refresh the _DROPDOWNS helper tab BEFORE any cell tries to
  // reference it. Idempotent. Required for the structure dropdown at C15.
  _ensureDropdownsTab(ss);

  // ---- Safety: check for user data
  var existing = ss.getSheetByName(SH.INPUT_DESIGN);
  if (existing && !force) {
    var hasUserData = _detectUserData(existing, SH.INPUT_DESIGN);
    if (hasUserData) {
      throw new Error(
        'setupInputDesign: tab "' + SH.INPUT_DESIGN + '" exists and contains ' +
        'user-entered values. Call setupInputDesign(true) to force overwrite, ' +
        'or rename the existing tab first to keep as backup.'
      );
    }
  }

  // ---- Wipe and recreate
  if (existing) ss.deleteSheet(existing);
  var sh = ss.insertSheet(SH.INPUT_DESIGN);

  // ---- Canvas: 12 columns, custom widths
  _applyDesignCanvas(sh);

  // ---- Banner (rows 1-3): logo in B2:C3, title in D2 shifted
  _insertArgiaLogo(sh, 2, 2);
  _writeTitleShifted(sh, 2, 'INPUT DESIGN', 'Ambiente · Eléctrico · Geometría · Helioscope');

  // ---- Dashboard (row 5 header, row 6 tiles)
  _renderDesignDashboard(sh);

  // ---- Two-column top section (rows 8-28)
  _renderDesignTopSection(sh);

  // ---- Bottom sections (rows 32+)
  _renderDesignHelioscopeBlock(sh);      // section 07: rows 32-46
  _renderDesignPanelBlock(sh);            // section 08: rows 48-54
  _renderDesignInverterBlock(sh);         // section 09: rows 56-63
  _renderDesignStringConfigBlock(sh);     // section 10: rows 65-69

  // ---- Freeze banner + dashboard
  // 7 rows: banner (1-3) + dashboard header (5) + tile values (6) + tile labels (7).
  // Freezing only 6 would cut off the unit labels under the big numbers,
  // leaving "153.27" floating without "kWp DC" beneath it when scrolling.
  sh.setFrozenRows(7);

  return sh;
}


// ---------------------------------------------------------------------------
// Canvas: 12 columns with widths optimized for two-column + helioscope layout
// ---------------------------------------------------------------------------
function _applyDesignCanvas(sh) {
  sh.setHiddenGridlines(true);
  // A=margin, B=label(L), C=value(L), D=unit(L), E=default(L),
  // F=gap, G=margin(R), H=label(R), I=value(R), J=unit(R), K=default(R), L=margin
  var widths = [25, 220, 110, 100, 130, 120, 90, 220, 110, 50, 130, 25];
  widths.forEach(function(w, i) { sh.setColumnWidth(i + 1, w); });
}


// ---------------------------------------------------------------------------
// Dashboard: section header row 5 + 5 tiles row 6
// Tiles use formulas that reference the equipment/helioscope blocks below.
// ---------------------------------------------------------------------------
function _renderDesignDashboard(sh) {
  // Section header spanning B:L
  sh.getRange(5, 2, 1, 11).breakApart().merge()
    .setValue('RESUMEN DEL DISEÑO')
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_SECTION'))
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontColor(token('TEXT_PRIMARY'))
    .setVerticalAlignment('middle')
    .setBackground(token('BG_PAGE'));
  sh.setRowHeight(5, tokenNum('ROW_H_SECTION'));
  // Paint margin col A so the dashboard band runs full-width (the merge above
  // covers B:L only; col A would otherwise be a white gap on the left edge).
  sh.getRange(5, 1).setBackground(token('BG_PAGE'));
  sh.getRange(5, 2, 1, 11).setBorder(
    null, null, true, null, null, null,
    token('DIVIDER_LINE'), SpreadsheetApp.BorderStyle.SOLID
  );

  // 5 tiles: (col-span=2 each, across B..L roughly)
  // Tile layout — each tile is 2 columns wide:
  //   B:C | D:E | F:G | H:I | J:K    (L is margin)
  var tiles = [
    { col: 2,  label: 'kWp DC',    formula: '=IFERROR((D50*E50 + SUMPRODUCT(IF(ISNUMBER(D51:D54)*ISNUMBER(E51:E54),D51:D54*E51:E54,0)))/1000, 0)' },
    { col: 4,  label: 'kWac',      formula: '=IFERROR(D58*E58 + SUMPRODUCT(IF(ISNUMBER(D59:D62)*ISNUMBER(E59:E62),D59:D62*E59:E62,0)), 0)' },
    { col: 6,  label: 'Módulos',   formula: '=IFERROR(D50 + SUM(D51:D54), 0)' },
    { col: 8,  label: 'Strings',   formula: '=IFERROR(E63, 0)' },
    { col: 10, label: 'kWh/año',   formula: '=IFERROR(G46, 0)' }
  ];

  tiles.forEach(function(t) {
    // Value cell (merged across 2 cols)
    var vCell = sh.getRange(6, t.col, 1, 2).breakApart().merge();
    vCell.setFormula(t.formula);
    vCell.setFontFamily(token('FONT_FAMILY'))
      .setFontSize(tokenNum('FONT_SIZE_TITLE'))
      .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
      .setFontColor(token('TEXT_PRIMARY'))
      .setBackground(token('BG_PAGE'))
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle')
      .setNumberFormat('#,##0.##');
  });

  // Label row under the values (row 7, spanning the same 2-col groups)
  tiles.forEach(function(t) {
    var lCell = sh.getRange(7, t.col, 1, 2).breakApart().merge();
    lCell.setValue(t.label)
      .setFontFamily(token('FONT_FAMILY'))
      .setFontSize(tokenNum('FONT_SIZE_SMALL'))
      .setFontColor(token('TEXT_SECONDARY'))
      .setBackground(token('BG_PAGE'))
      .setHorizontalAlignment('center')
      .setVerticalAlignment('top');
  });

  sh.setRowHeight(6, 40);
  sh.setRowHeight(7, 18);

  // Paint margin cols A + L of rows 6+7 with the same BG so the dashboard
  // band runs uniformly from edge to edge — without this, the page-color
  // band stops at col B / col K and the margins look like an unfinished gap.
  sh.getRange(6, 1).setBackground(token('BG_PAGE'));
  sh.getRange(6, 12).setBackground(token('BG_PAGE'));
  sh.getRange(7, 1).setBackground(token('BG_PAGE'));
  sh.getRange(7, 12).setBackground(token('BG_PAGE'));

  // Bottom divider under dashboard
  sh.getRange(7, 2, 1, 11).setBorder(
    null, null, true, null, null, null,
    token('DIVIDER_LINE'), SpreadsheetApp.BorderStyle.SOLID
  );
}


// ---------------------------------------------------------------------------
// Top section: two-column grid of scalar inputs.
// Left column  (cols B-E): sections 01, 02, 03
// Right column (cols H-K): sections 04, 05, 06
// ---------------------------------------------------------------------------
function _renderDesignTopSection(sh) {
  // Find all scalar entries for each column by their col number.
  var leftSections  = ['01 AMBIENTE Y TECHO', '02 PARÁMETROS ELÉCTRICOS', '03 DISTANCIAS'];
  var rightSections = ['04 GEOMETRÍA', '05 LAYOUT OVERRIDE', '06 BOM CONFIG'];

  leftSections.forEach(function(section) { _renderDesignColumnSection(sh, section, 'left'); });
  rightSections.forEach(function(section) { _renderDesignColumnSection(sh, section, 'right'); });
}


/**
 * Render one section's header + field rows into either the left or right
 * column of the top section.
 *
 * Left column:  label B, value C, unit D, default hint E
 * Right column: label H, value I, unit J, default hint K
 */
function _renderDesignColumnSection(sh, sectionLabel, side) {
  var keys = inputKeysForSection(SH.INPUT_DESIGN, sectionLabel).filter(function(k) {
    var m = INPUT_MAP[k];
    return !m.mode || m.mode === 'scalar';  // skip ranges and skip-mode
  });
  if (keys.length === 0) return;

  // Figure out where this section's fields live: all keys should share the
  // same col (3 for left, 9 for right). The row of the section header is
  // 2 above the minimum row of its fields.
  var minRow = Math.min.apply(null, keys.map(function(k){ return INPUT_MAP[k].row; }));
  var headerRow = minRow - 2;
  if (headerRow < 8) headerRow = 8;

  var labelCol, valueCol, unitCol, defaultCol, sectionSpanCols;
  if (side === 'left') {
    labelCol = 2; valueCol = 3; unitCol = 4; defaultCol = 5; sectionSpanCols = 4; // B:E
  } else {
    labelCol = 8; valueCol = 9; unitCol = 10; defaultCol = 11; sectionSpanCols = 4; // H:K
  }

  // Section header
  var parts = sectionLabel.match(/^(\S+)\s+(.*)$/);
  var num   = parts ? parts[1] : '';
  var title = parts ? parts[2] : sectionLabel;

  sh.getRange(headerRow, labelCol).setValue(num)
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_SECTION'))
    .setFontColor(token('TEXT_SECONDARY'))
    .setVerticalAlignment('middle');
  sh.getRange(headerRow, valueCol, 1, sectionSpanCols - 1).breakApart().merge()
    .setValue(title)
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_SECTION'))
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontColor(token('TEXT_PRIMARY'))
    .setVerticalAlignment('middle');
  sh.setRowHeight(headerRow, tokenNum('ROW_H_SECTION'));
  sh.getRange(headerRow, labelCol, 1, sectionSpanCols).setBorder(
    null, null, true, null, null, null,
    token('DIVIDER_LINE'), SpreadsheetApp.BorderStyle.SOLID
  );

  // Each field row
  keys.forEach(function(key) {
    var m = INPUT_MAP[key];
    _renderDesignFieldRow(sh, m, labelCol, valueCol, unitCol, defaultCol);
  });
}


/**
 * Render one field row into a given column quartet.
 */
function _renderDesignFieldRow(sh, m, labelCol, valueCol, unitCol, defaultCol) {
  var r = m.row;
  var labelText = (m.advanced ? '⚙ ' : '') + m.label + (m.required ? ' *' : '');

  // Label cell (single col, no merge — more compact layout)
  sh.getRange(r, labelCol).setValue(labelText)
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_BODY'))
    .setFontColor(m.advanced ? token('TEXT_SECONDARY') : token('TEXT_PRIMARY'))
    .setVerticalAlignment('middle');

  // Value cell
  var valueCell = sh.getRange(r, valueCol);
  if (m.hasOwnProperty('default') && m.default !== '') {
    valueCell.setValue(m.default);
  }
  valueCell
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_BODY'))
    .setFontColor(token('TEXT_PRIMARY'))
    .setBackground(token('BG_INPUT_CELL'))
    .setHorizontalAlignment('right')
    .setVerticalAlignment('middle')
    .setBorder(
      null, null, true, null, null, null,
      token('DIVIDER_LINE'), SpreadsheetApp.BorderStyle.SOLID
    );
  _applyTypeValidation(valueCell, m);

  // Unit cell
  if (m.unit) {
    sh.getRange(r, unitCol).setValue(m.unit)
      .setFontFamily(token('FONT_FAMILY'))
      .setFontSize(tokenNum('FONT_SIZE_SMALL'))
      .setFontColor(token('TEXT_SECONDARY'))
      .setHorizontalAlignment('left')
      .setVerticalAlignment('middle');
  }

  // Default hint cell
  if (m.hasOwnProperty('default') && m.default !== '') {
    var defaultStr = 'default: ' + m.default;
    sh.getRange(r, defaultCol).setValue(defaultStr)
      .setFontFamily(token('FONT_FAMILY'))
      .setFontSize(tokenNum('FONT_SIZE_SMALL'))
      .setFontColor(token('TEXT_MUTED'))
      .setFontStyle('italic')
      .setHorizontalAlignment('left')
      .setVerticalAlignment('middle');
  }

  sh.setRowHeight(r, tokenNum('ROW_H_BODY'));
}


// ---------------------------------------------------------------------------
// Helioscope monthly block: section header + 12-row table + total row.
// Rows 32 (header) through 46 (total).
// ---------------------------------------------------------------------------
function _renderDesignHelioscopeBlock(sh) {
  // Section header row 32
  _renderDesignFullWidthHeader(sh, 32, '07', 'HELIOSCOPE — DATOS MENSUALES');

  // Column headers row 33
  var headers = ['MES', 'GHI (kWh/m²)', 'POA (kWh/m²)', 'SOMBRA', 'NAMEPLATE kWh', 'GRID kWh'];
  sh.getRange(33, 2, 1, 6).setValues([headers])
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontColor(token('TEXT_SECONDARY'))
    .setHorizontalAlignment('left')
    .setVerticalAlignment('middle')
    .setBackground(token('BG_PAGE'));
  sh.setRowHeight(33, 22);
  sh.getRange(33, 2, 1, 6).setBorder(
    null, null, true, null, null, null,
    token('DIVIDER_LINE'), SpreadsheetApp.BorderStyle.SOLID
  );

  // 12 month rows (43-54). Month abbrs in col B, data cols C-G populated by helioscope.
  var months = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
  for (var i = 0; i < 12; i++) {
    var r = 34 + i;
    sh.getRange(r, 2).setValue(months[i])
      .setFontFamily(token('FONT_FAMILY'))
      .setFontSize(tokenNum('FONT_SIZE_BODY'))
      .setFontColor(token('TEXT_PRIMARY'))
      .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
      .setVerticalAlignment('middle');
    // Data cells stay blank until helioscope populates them.
    // Apply a subtle "read-only" look: page bg, not cream.
    sh.getRange(r, 3, 1, 5)
      .setFontFamily(token('FONT_FAMILY'))
      .setFontSize(tokenNum('FONT_SIZE_BODY'))
      .setHorizontalAlignment('right')
      .setVerticalAlignment('middle')
      .setNumberFormat('#,##0');
    sh.setRowHeight(r, tokenNum('ROW_H_BODY'));
  }

  // Total row 46: label in cols B:F, value in G
  sh.getRange(46, 2, 1, 5).breakApart().merge()
    .setValue('TOTAL ANUAL')
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_BODY'))
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontColor(token('TEXT_PRIMARY'))
    .setHorizontalAlignment('right')
    .setVerticalAlignment('middle');
  sh.getRange(46, 7)
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_BODY'))
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setHorizontalAlignment('right')
    .setNumberFormat('#,##0')
    .setVerticalAlignment('middle');
  sh.setRowHeight(46, tokenNum('ROW_H_BODY'));
  sh.getRange(46, 2, 1, 6).setBorder(
    true, null, true, null, null, null,
    token('DIVIDER_LINE'), SpreadsheetApp.BorderStyle.SOLID
  );
}


// ---------------------------------------------------------------------------
// Panel equipment block: section header + column headers + 5 data rows.
// Rows 48-54.
// ---------------------------------------------------------------------------
function _renderDesignPanelBlock(sh) {
  _renderDesignFullWidthHeader(sh, 48, '08', 'EQUIPO — PANELES');

  // Column headers row 49
  sh.getRange(49, 2).setValue('#')
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontColor(token('TEXT_SECONDARY'));
  sh.getRange(49, 3).setValue('MODELO')
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontColor(token('TEXT_SECONDARY'));
  sh.getRange(49, 4).setValue('CANTIDAD')
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontColor(token('TEXT_SECONDARY'))
    .setHorizontalAlignment('right');
  sh.getRange(49, 5).setValue('Wp')
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontColor(token('TEXT_SECONDARY'))
    .setHorizontalAlignment('right');
  sh.getRange(49, 2, 1, 4).setBorder(
    null, null, true, null, null, null,
    token('DIVIDER_LINE'), SpreadsheetApp.BorderStyle.SOLID
  );
  sh.setRowHeight(49, 22);

  // 5 data rows (59-63)
  for (var i = 0; i < 5; i++) {
    var r = 50 + i;
    sh.getRange(r, 2).setValue(i === 0 ? '★' : String(i + 1))
      .setFontFamily(token('FONT_FAMILY'))
      .setFontSize(tokenNum('FONT_SIZE_BODY'))
      .setFontColor(i === 0 ? token('TEXT_PRIMARY') : token('TEXT_MUTED'))
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
    // Data cells (model, qty, Wp) — cream tint, editable
    sh.getRange(r, 3, 1, 3)
      .setFontFamily(token('FONT_FAMILY'))
      .setFontSize(tokenNum('FONT_SIZE_BODY'))
      .setBackground(token('BG_INPUT_CELL'))
      .setVerticalAlignment('middle');
    sh.getRange(r, 3).setHorizontalAlignment('left');
    sh.getRange(r, 4, 1, 2).setHorizontalAlignment('right').setNumberFormat('#,##0');
    sh.setRowHeight(r, tokenNum('ROW_H_BODY'));
  }
}


// ---------------------------------------------------------------------------
// Inverter equipment block: section header + column headers + 5 data rows + total.
// Rows 56-63.
// ---------------------------------------------------------------------------
function _renderDesignInverterBlock(sh) {
  _renderDesignFullWidthHeader(sh, 56, '09', 'EQUIPO — INVERSORES');

  // Column headers row 57
  sh.getRange(57, 2).setValue('#')
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontColor(token('TEXT_SECONDARY'));
  sh.getRange(57, 3).setValue('MODELO')
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontColor(token('TEXT_SECONDARY'));
  sh.getRange(57, 4).setValue('CANTIDAD')
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontColor(token('TEXT_SECONDARY'))
    .setHorizontalAlignment('right');
  sh.getRange(57, 5).setValue('kW')
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontColor(token('TEXT_SECONDARY'))
    .setHorizontalAlignment('right');
  sh.getRange(57, 6).setValue('STRINGS')
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontColor(token('TEXT_SECONDARY'))
    .setHorizontalAlignment('right');
  sh.getRange(57, 2, 1, 5).setBorder(
    null, null, true, null, null, null,
    token('DIVIDER_LINE'), SpreadsheetApp.BorderStyle.SOLID
  );
  sh.setRowHeight(57, 22);

  // 5 data rows (67-71)
  for (var i = 0; i < 5; i++) {
    var r = 58 + i;
    sh.getRange(r, 2).setValue(i === 0 ? '★' : String(i + 1))
      .setFontFamily(token('FONT_FAMILY'))
      .setFontSize(tokenNum('FONT_SIZE_BODY'))
      .setFontColor(i === 0 ? token('TEXT_PRIMARY') : token('TEXT_MUTED'))
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
    // Data cells — cream tint
    sh.getRange(r, 3, 1, 4)
      .setFontFamily(token('FONT_FAMILY'))
      .setFontSize(tokenNum('FONT_SIZE_BODY'))
      .setBackground(token('BG_INPUT_CELL'))
      .setVerticalAlignment('middle');
    sh.getRange(r, 3).setHorizontalAlignment('left');
    sh.getRange(r, 4, 1, 3).setHorizontalAlignment('right').setNumberFormat('#,##0');
    sh.setRowHeight(r, tokenNum('ROW_H_BODY'));
  }

  // Total row 63
  sh.getRange(63, 2, 1, 2).breakApart().merge()
    .setValue('TOTAL')
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_BODY'))
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontColor(token('TEXT_PRIMARY'))
    .setHorizontalAlignment('right')
    .setVerticalAlignment('middle');
  sh.getRange(63, 4, 1, 2)
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_BODY'))
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setHorizontalAlignment('right')
    .setNumberFormat('#,##0')
    .setVerticalAlignment('middle');
  sh.setRowHeight(63, tokenNum('ROW_H_BODY'));
  sh.getRange(63, 2, 1, 5).setBorder(
    true, null, true, null, null, null,
    token('DIVIDER_LINE'), SpreadsheetApp.BorderStyle.SOLID
  );
}


// ---------------------------------------------------------------------------
// String config: section header + 4 scalar rows using the same single-column
// renderer as the top-section left column.
// Rows 65-69.
// ---------------------------------------------------------------------------
function _renderDesignStringConfigBlock(sh) {
  _renderDesignFullWidthHeader(sh, 65, '10', 'STRING CONFIG');

  // Render each key from section 10
  var keys = inputKeysForSection(SH.INPUT_DESIGN, '10 STRING CONFIG').filter(function(k) {
    var m = INPUT_MAP[k];
    return !m.mode || m.mode === 'scalar';
  });
  keys.forEach(function(k) {
    var m = INPUT_MAP[k];
    _renderDesignFieldRow(sh, m, 2, 3, 4, 5);
  });
}


// ---------------------------------------------------------------------------
// Full-width section header helper (used by helioscope, panels, inverters, strings)
// ---------------------------------------------------------------------------
function _renderDesignFullWidthHeader(sh, row, num, title) {
  sh.getRange(row, 2).setValue(num)
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_SECTION'))
    .setFontColor(token('TEXT_SECONDARY'))
    .setVerticalAlignment('middle');
  sh.getRange(row, 3, 1, 9).breakApart().merge()
    .setValue(title)
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_SECTION'))
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontColor(token('TEXT_PRIMARY'))
    .setVerticalAlignment('middle');
  sh.setRowHeight(row, tokenNum('ROW_H_SECTION'));
  sh.getRange(row, 2, 1, 11).setBorder(
    null, null, true, null, null, null,
    token('DIVIDER_LINE'), SpreadsheetApp.BorderStyle.SOLID
  );
}


// ---------------------------------------------------------------------------
// PREVIEW WRAPPER — for one-click run from Apps Script IDE
// Lets you run setupInputDesign(true) from the function dropdown without
// having to pass arguments. Safe to delete after layout review.
// ---------------------------------------------------------------------------
function previewInputDesign() {
  setupInputDesign(true);
}


// =============================================================================
// INPUT_CFE_RAW — visual styling only (Phase 2d, 2026-04-24)
//
// CRITICAL CONSTRAINTS:
//   1. INPUT_CFE_RAW is the manual paste target for monthly CFE bill data.
//   2. CFE_SIMULATION has 121 formulas pointing at specific cells. Internal
//      formulas in rows 18-37 also reference cells by coord. NOTHING can move.
//   3. This function does NOT clearContent (except B2 legacy label), NOT
//      setValue on data cells, NOT delete or insert rows. Values, formulas,
//      and notes are untouched.
//
// COLOR RULE (locked spec):
//   - Cream (BG_INPUT_CELL): paste cells only — service metadata + monthly
//     consumption rows where the user pastes CFE bill data.
//   - Light gray (BG_SUBTOTAL): formula cells only — calc + totals
//     (rows 18-37, cols C-N).
//   - White (default): everything else — col A, col B, cols O+, banner area,
//     row 9 month headers, blank rows 38+. No painting.
//
// EXACT PASTE CELLS (cream):
//   C4, F4, C5, F5, C6, F6, C7   (7 service metadata scalars)
//   C10:N17                       (8 rows × 12 month cols = 96 cells)
//
// EXACT FORMULA CELLS (gray):
//   C18:N37                       (20 rows × 12 month cols = 240 cells)
// =============================================================================
function _styleInputCFETab() {
  var ss = SpreadsheetApp.getActive();
  resetDesignTokenCache_();
  loadDesignTokens(ss);

  var sh = ss.getSheetByName('INPUT_CFE_RAW');
  if (!sh) {
    throw new Error('INPUT_CFE_RAW tab not found.');
  }

  // ---- 1. CANVAS RESET -----------------------------------------------------
  // Wipe ALL backgrounds and ALL borders across a generous bounding box so
  // we start from a clean white default. Values/formulas/notes are NOT
  // touched. After this, the only colored cells are the ones we explicitly
  // paint below.
  var resetMaxRow = Math.max(50, sh.getMaxRows());
  var resetMaxCol = Math.max(16, sh.getMaxColumns());
  var resetRange = sh.getRange(1, 1, resetMaxRow, resetMaxCol);
  resetRange.setBackground('#FFFFFF');
  resetRange.setBorder(false, false, false, false, false, false);

  // ---- 2. CANVAS LAYOUT ----------------------------------------------------
  sh.setHiddenGridlines(true);
  sh.setColumnWidth(1, 25);    // A — margin
  sh.setColumnWidth(2, 220);   // B — label
  for (var c = 3; c <= 14; c++) sh.setColumnWidth(c, 90);  // C..N — months
  sh.setColumnWidth(15, 25);   // O — margin

  // ---- 3. BANNER (rows 1-3) ------------------------------------------------
  // Clear any leftover images first so re-runs don't stack logos.
  try {
    sh.getImages().forEach(function(img) { img.remove(); });
  } catch (e) {
    Logger.log('_styleInputCFETab: image cleanup skipped: ' + e.message);
  }
  // Clear legacy 'CFE' label in B2 — banner replaces it.
  sh.getRange('B2').clearContent();
  _insertArgiaLogo(sh, 2, 2);
  _writeTitleShifted(sh, 2, 'INPUT CFE',
    'Datos de facturación CFE — captura mensual');

  // ---- 4. PASTE CELLS — CREAM (the only "cream" cells on the sheet) -------
  // Service metadata: 7 individual cells in rows 4-7
  //
  // F4 (SERVICE NAME) and F5 (SERVICE NUMBER) get merged with the cell to
  // their right (G4 and G5 respectively) because the values are typically
  // long strings (e.g. "OASIS LATINOAMERICA S RL CV", "414240911417") that
  // overflow a single 90px column. Safe to merge: CFE_SIMULATION has no
  // formulas referencing F4/G4/F5/G5 — those are display-only fields.
  // The merged cell still uses F4 and F5 as the canonical addresses.
  try { sh.getRange('F4:G4').breakApart().merge(); } catch(e) {}
  try { sh.getRange('F5:G5').breakApart().merge(); } catch(e) {}

  ['C4', 'F4', 'C5', 'F5', 'C6', 'F6', 'C7'].forEach(function(addr) {
    sh.getRange(addr)
      .setBackground(token('BG_INPUT_CELL'))
      .setFontFamily(token('FONT_FAMILY'))
      .setFontSize(tokenNum('FONT_SIZE_BODY'))
      .setFontColor(token('TEXT_PRIMARY'));
  });
  // Consumption block: rows 10-17, cols C-N (8 rows × 12 month cols)
  sh.getRange('C10:N17')
    .setBackground(token('BG_INPUT_CELL'))
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_BODY'))
    .setFontColor(token('TEXT_PRIMARY'))
    .setHorizontalAlignment('right')
    .setVerticalAlignment('middle')
    .setNumberFormat('#,##0');

  // ---- 5. FORMULA CELLS — LIGHT GRAY (the only "gray" cells on the sheet) -
  // Rows 18-37, cols C-N. All auto-calculated, no paste.
  sh.getRange('C18:N37')
    .setBackground(token('BG_SUBTOTAL'))
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_BODY'))
    .setFontColor(token('TEXT_SECONDARY'))
    .setHorizontalAlignment('right')
    .setVerticalAlignment('middle');

  // Number formats per row (no decimals anywhere except FP%)
  sh.getRange('C18:N18').setNumberFormat('0');                      // Días
  sh.getRange('C19:N19').setNumberFormat('#,##0');                  // Demanda Facturable
  sh.getRange('C20:N20').setNumberFormat('0.0%');                   // FP %
  sh.getRange('C21:N37').setNumberFormat('#,##0');                  // money rows

  // ---- 6. LABEL STYLING (col B + col E, no background change) -------------
  // Service metadata labels rows 4-7 + col E labels rows 4-6
  [[4,2],[4,5],[5,2],[5,5],[6,2],[6,5],[7,2]].forEach(function(rc) {
    sh.getRange(rc[0], rc[1])
      .setFontFamily(token('FONT_FAMILY'))
      .setFontSize(tokenNum('FONT_SIZE_BODY'))
      .setFontColor(token('TEXT_SECONDARY'))
      .setFontWeight('normal');
  });
  // Consumption labels rows 10-17 col B
  for (var r = 10; r <= 17; r++) {
    sh.getRange(r, 2)
      .setFontFamily(token('FONT_FAMILY'))
      .setFontSize(tokenNum('FONT_SIZE_BODY'))
      .setFontColor(token('TEXT_PRIMARY'))
      .setFontWeight('normal');
  }
  // Calc labels rows 18-29 col B (gray text, normal weight)
  for (var r = 18; r <= 29; r++) {
    sh.getRange(r, 2)
      .setFontFamily(token('FONT_FAMILY'))
      .setFontSize(tokenNum('FONT_SIZE_BODY'))
      .setFontColor(token('TEXT_SECONDARY'))
      .setFontWeight('normal');
  }
  // Totals labels rows 30-37 col B; rows 35 + 37 are headlines
  for (var r = 30; r <= 37; r++) {
    var isHeadline = (r === 35 || r === 37);
    sh.getRange(r, 2)
      .setFontFamily(token('FONT_FAMILY'))
      .setFontSize(tokenNum('FONT_SIZE_BODY'))
      .setFontColor(isHeadline ? token('TEXT_PRIMARY') : token('TEXT_SECONDARY'))
      .setFontWeight(isHeadline ? token('FONT_WEIGHT_EMPHASIS') : 'normal');
  }
  // Headline rows: also bold the data cells on rows 35 + 37
  sh.getRange('C35:N35')
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontColor(token('TEXT_PRIMARY'));
  sh.getRange('C37:N37')
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontColor(token('TEXT_PRIMARY'));

  // ---- 7. ROW 9 MONTH HEADERS (white background, styled text only) -------
  sh.getRange(9, 2, 1, 13)
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontColor(token('TEXT_SECONDARY'))
    .setHorizontalAlignment('right')
    .setVerticalAlignment('middle');

  // ---- 8. ROW HEIGHTS ------------------------------------------------------
  sh.setRowHeight(8, 12);                              // spacer row
  sh.setRowHeight(9, 24);                              // month headers
  for (var r = 10; r <= 37; r++) {
    sh.setRowHeight(r, tokenNum('ROW_H_BODY'));
  }

  // ---- 9. SUBTLE DIVIDER LINES (no fill, just borders) --------------------
  // Bottom of service block
  sh.getRange(7, 2, 1, 13).setBorder(
    null, null, true, null, null, null,
    token('DIVIDER_LINE'), SpreadsheetApp.BorderStyle.SOLID
  );
  // Bottom of month headers
  sh.getRange(9, 2, 1, 13).setBorder(
    null, null, true, null, null, null,
    token('DIVIDER_LINE'), SpreadsheetApp.BorderStyle.SOLID
  );
  // Bottom of consumption block
  sh.getRange(17, 2, 1, 13).setBorder(
    null, null, true, null, null, null,
    token('DIVIDER_LINE'), SpreadsheetApp.BorderStyle.SOLID
  );
  // Bottom of calc block
  sh.getRange(29, 2, 1, 13).setBorder(
    null, null, true, null, null, null,
    token('DIVIDER_LINE'), SpreadsheetApp.BorderStyle.SOLID
  );
  // Strong divider above Facturación (row 35)
  sh.getRange(35, 2, 1, 13).setBorder(
    true, null, null, null, null, null,
    token('DIVIDER_STRONG'), SpreadsheetApp.BorderStyle.SOLID
  );
  // Strong divider above + below TOTAL (row 37)
  sh.getRange(37, 2, 1, 13).setBorder(
    true, null, true, null, null, null,
    token('DIVIDER_STRONG'), SpreadsheetApp.BorderStyle.SOLID
  );

  // ---- 10. FREEZE ----------------------------------------------------------
  sh.setFrozenRows(9);
  sh.setFrozenColumns(2);

  return sh;
}


// ---------------------------------------------------------------------------
// PREVIEW WRAPPER for INPUT_CFE_RAW styling — for one-click run from IDE
// Safe to run on live workbook (does not wipe data).
// ---------------------------------------------------------------------------
function previewInputCFE() {
  setupInputCFE();
}


// ---------------------------------------------------------------------------
// PREVIEW WRAPPERS for INPUT_PROJECT and INPUT_INSTALL — IDE one-click runs
//
// WARNING: these tabs are rebuilt from scratch (deleteSheet + insertSheet).
// All existing data on the tab is permanently destroyed when you run these.
// Always run on a COPY of your workbook, not the live one, until you're
// committed to the new layout.
// ---------------------------------------------------------------------------
function previewInputProject() {
  setupInputProject(true);
}
function previewInputInstall() {
  setupInputInstall(true);
}


// =============================================================================
// MDC TAB SETUP (Phase 2e, 2026-04-24)
//
// Wipes the MDC tab and rebuilds the static skeleton: col B labels, col D
// units, banner area, section headers, column widths, frozen rows, fonts.
// The engine (07_WriteMDC.gs) writes runtime values into cols C, E, F, G, H
// every time runArgia() runs — those columns are intentionally left empty
// here so the engine has a clean slate to write to.
//
// ROW STRUCTURE (synced with MDC_ROW in 00_Main.gs):
//   1     Header row (DESCRIPCION | VALOR | UNIDAD | ...)
//   2-3   Banner (ARGIA logo + "MEMORIA DE CÁLCULO" title + subtitle)
//   4     Emission status banner (engine-written, big colored)
//   5     Section header §0 GENERALES
//   6-17  §0 row labels
//   19    Section header §1.0 MEMORIA DC
//   20-31 §1.0 row labels
//   33    Section header §1.1 VALIDACION VOLTAJE
//   34-41 §1.1 row labels
//   42    Section header §2 SALIDA AC
//   43-53 §2 row labels
//   54    Section header §3 ALIMENTADOR PRINCIPAL
//   55-66 §3 row labels
//   67    Section header §4 BANDERAS
//   68-71 §4 row labels
//   73    Section header §5 SUPUESTOS
//   74-80 §5 row labels
//   81    Section header §5.5 REFERENCIAS (engine-written via writeMDC)
//   82-85 §5.5 row labels (engine-written)
//   86    Section header §6 LAYOUT (engine-written)
//   87-92 §6 row labels (engine-written)
//   95    Legend (engine-written)
//   96    Timestamp (engine-written)
//
// IMPORTANT: this rebuild is destructive. Always run on a copy first.
// =============================================================================
function setupMDCTemplate(confirmOverwrite) {
  var ss = SpreadsheetApp.getActive();
  resetDesignTokenCache_();
  loadDesignTokens(ss);

  // Safety check
  var existing = ss.getSheetByName(SH.MDC || 'MDC');
  if (existing && confirmOverwrite !== true) {
    var hasData = false;
    try {
      var firstVal = existing.getRange(6, 3).getValue();  // C6 = project name
      if (firstVal) hasData = true;
    } catch(e) {}
    if (hasData) {
      throw new Error('setupMDCTemplate: MDC tab already exists and contains data. ' +
        'Call setupMDCTemplate(true) to force overwrite, or rename the existing tab to keep as backup.');
    }
  }

  // Wipe + recreate
  if (existing) ss.deleteSheet(existing);
  var sh = ss.insertSheet(SH.MDC || 'MDC');

  // ---- Canvas ---------------------------------------------------------------
  sh.setHiddenGridlines(true);
  sh.setColumnWidth(1,  25);   // A — margin
  sh.setColumnWidth(2, 360);   // B — label
  sh.setColumnWidth(3, 220);   // C — value
  sh.setColumnWidth(4,  60);   // D — unit
  sh.setColumnWidth(5, 130);   // E — STATUS (moved from H, wider for "EMITTABLE WITH OBSERVATIONS")
  sh.setColumnWidth(6, 200);   // F — CITA NOM
  sh.setColumnWidth(7, 320);   // G — FÓRMULA / NOTA
  sh.setColumnWidth(8,  25);   // H — margin (was status, now unused)

  // ---- Banner (rows 1-3) ---------------------------------------------------
  // Logo at B2, title at D2, subtitle at D3.
  // Note: we do NOT use _writeTitleShifted here because it merges D-G of the
  // title/subtitle rows. The engine writes audit-trail metadata into rows 2-3
  // cols E/F/G (engine version, designer, panel verified date, etc.) and
  // those writes collide with merged cells.
  _insertArgiaLogo(sh, 2, 2);
  // Title at C2 (sits right next to the logo). Was previously at D2 which
  // left a wide visual gap between the logo and the title text.
  sh.getRange(2, 3)
    .setValue('MEMORIA DE CÁLCULO')
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_TITLE'))
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontColor(token('TEXT_PRIMARY'))
    .setVerticalAlignment('bottom');
  sh.getRange(3, 3)
    .setValue('MDC v7 · Secuencia técnica ligada al ENGINE')
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontColor(token('TEXT_SECONDARY'));
  sh.setRowHeight(2, tokenNum('ROW_H_TITLE'));

  // ---- Column headers row (under the banner) -------------------------------
  // Phase 2e: PROVENIENCIA col dropped, ESTADO moved from col H to col E
  // so reviewers see PASS/FAIL right next to the value.
  var headers = ['', 'DESCRIPCIÓN', 'VALOR', 'UNIDAD', 'ESTADO', 'CITA NOM', 'FÓRMULA / NOTA', ''];
  sh.getRange(MDC_ROW.COLUMN_HEADERS, 1, 1, 8).setValues([headers])
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontColor(token('TEXT_SECONDARY'))
    .setBackground(token('BG_PAGE'))
    .setVerticalAlignment('middle');
  sh.getRange(MDC_ROW.COLUMN_HEADERS, 1, 1, 8).setBorder(
    null, null, true, null, null, null,
    token('DIVIDER_LINE'), SpreadsheetApp.BorderStyle.SOLID
  );
  sh.setRowHeight(MDC_ROW.COLUMN_HEADERS, 22);

  // ---- Static labels: every body row ---------------------------------------
  // Format: [row, label, unit]   (unit is '' if dimensionless or N/A)
  var bodyRows = [
    // §0 GENERALES
    [MDC_ROW.PROJECT,         'Proyecto',                                             ''],
    [MDC_ROW.CLIENT,          'Cliente',                                              ''],
    [MDC_ROW.MODULE,          'Módulo fotovoltaico',                                  ''],
    [MDC_ROW.INVERTER,        'Inversor',                                             ''],
    [MDC_ROW.QTY_MODULES,     'No. de módulos',                                       'pcs'],
    [MDC_ROW.QTY_INVERTERS,   'No. de inversores',                                    'pcs'],
    [MDC_ROW.MODS_PER_STRING, 'Módulos por string',                                   'pcs'],
    [MDC_ROW.STRINGS_PER_INV, 'Strings por inversor',                                 'strings'],
    [MDC_ROW.DC_KW,           'Potencia DC instalada',                                'kWdc'],
    [MDC_ROW.AC_KW,           'Potencia AC instalada',                                'kWac'],
    [MDC_ROW.DC_AC_RATIO,     'Relación DC/AC',                                       'x'],
    [MDC_ROW.AC_VOLTAGE,      'Tensión AC de inversor',                               'V'],
    // §1.0 MEMORIA DC (consolidated row 21)
    [MDC_ROW.ISC,             'Isc del módulo',                                       'A'],
    [MDC_ROW.I_DESIGN,        'Corriente de diseño = Isc × 1.5625',                   'A'],
    [MDC_ROW.FT_DC,           'Ft por temperatura DC',                                ''],
    [MDC_ROW.FAG_DC,          'Fag por agrupamiento DC',                              ''],
    [MDC_ROW.AMP_REQ_DC,      'Ampacidad requerida conductor DC',                     'A'],
    [MDC_ROW.COND_DC,         'Conductor DC seleccionado',                            'AWG'],
    [MDC_ROW.AREA_DC,         'Área Cu conductor DC',                                 'mm²'],
    [MDC_ROW.OCPD_DC,         'Protección DC por cadena',                             'A'],
    [MDC_ROW.EGC_DC,          'Conductor puesta a tierra DC',                         'AWG'],
    [MDC_ROW.VDROP_DC,        'Caída de tensión DC estimada',                         '%'],
    [MDC_ROW.CONDUIT_DC,      'Conduit DC seleccionado',                              'in'],
    [MDC_ROW.RESULT_DC,       'Resultado sección DC',                                 ''],
    // §1.1 VALIDACION VOLTAJE
    [MDC_ROW.VOC_COLD,        'Voc corregido por temperatura fría',                   'V'],
    [MDC_ROW.VMP_HOT,         'Vmp corregido por temperatura caliente',               'V'],
    [MDC_ROW.MIN_MODS,        'Mín. módulos por string',                              'pcs'],
    [MDC_ROW.MAX_MODS,        'Máx. módulos por string',                              'pcs'],
    [MDC_ROW.ACTUAL_MODS,     'Módulos realmente usados por string',                  'pcs'],
    [MDC_ROW.CHECK_WINDOW,    'Revisión ventana de string',                           ''],
    [MDC_ROW.CHECK_DC_LIMIT,  'Revisión límite DC del inversor',                      ''],
    [MDC_ROW.STR03_MPPT,      'Corriente MPPT de operación (STR-03/DC-09)',           ''],
    // §2 SALIDA AC POR INVERSOR
    [MDC_ROW.I_AC_NOM,        'Corriente nominal AC por inversor',                    'A'],
    [MDC_ROW.OCPD_AC_INV,     'Protección AC por inversor',                           'A'],
    [MDC_ROW.FT_AC,           'Ft por temperatura AC',                                ''],
    [MDC_ROW.FAG_AC,          'Fag por agrupamiento AC',                              ''],
    [MDC_ROW.AMP_REQ_AC,      'Ampacidad requerida AC',                               'A'],
    [MDC_ROW.COND_AC,         'Conductor AC por inversor',                            'AWG'],
    [MDC_ROW.AREA_AC,         'Área Cu conductor AC',                                 'mm²'],
    [MDC_ROW.EGC_AC,          'Conductor puesta a tierra AC',                         'AWG'],
    [MDC_ROW.VDROP_AC,        'Caída de tensión AC por inversor',                     '%'],
    [MDC_ROW.CONDUIT_AC,      'Conduit AC por inversor',                              'in'],
    [MDC_ROW.RESULT_AC,       'Resultado salida AC por inversor',                     ''],
    // §3 ALIMENTADOR PRINCIPAL (consolidated row 64)
    [MDC_ROW.I_TOTAL_AC,      'Corriente total AC',                                   'A'],
    [MDC_ROW.MAIN_BREAKER,    'Breaker principal',                                    'A'],
    [MDC_ROW.PARALLEL_RUNS,   'Corridas en paralelo por fase',                        'runs'],
    [MDC_ROW.I_PER_RUN,       'Corriente por corrida',                                'A'],
    [MDC_ROW.COND_MAIN,       'Conductor principal',                                  'AWG'],
    [MDC_ROW.AREA_MAIN,       'Área Cu conductor principal',                          'mm²'],
    [MDC_ROW.EGC_MAIN,        'Conductor puesta a tierra principal',                  'AWG'],
    [MDC_ROW.VDROP_FEEDER,    'Caída de tensión alimentador',                         '%'],
    [MDC_ROW.CONDUIT_MAIN,    'Conduit principal',                                    'in'],
    [MDC_ROW.APPARENT_REQ,    'Potencia aparente requerida (con 20% margen)',         'kVA'],
    [MDC_ROW.TRANSFORMER,     'Transformador recomendado',                            'kVA'],
    [MDC_ROW.RESULT_FEEDER,   'Resultado alimentador principal',                      ''],
    // §4 BANDERAS
    [MDC_ROW.FLAG_LAYOUT,     'Layout módulos / strings / inversores',                ''],
    [MDC_ROW.FLAG_WINDOW,     'Ventana de string',                                    ''],
    [MDC_ROW.FLAG_DC_LIMIT,   'Límite DC del inversor',                               ''],
    [MDC_ROW.FLAG_FINAL,      'Criterio de emisión final',                            ''],
    // §5 SUPUESTOS
    [MDC_ROW.TEMP_MIN,        'Temp. mínima de sitio',                                '°C'],
    [MDC_ROW.TEMP_MAX,        'Temp. ambiente máxima',                                '°C'],
    [MDC_ROW.ROOF_CLEARANCE,  'Separación sobre azotea',                              'mm'],
    [MDC_ROW.LEN_DC,          'Longitud DC promedio por string (auto)',               'm'],
    [MDC_ROW.LEN_AC,          'Longitud AC por inversor (auto)',                      'm'],
    [MDC_ROW.LEN_FEEDER,      'Longitud alimentador principal (auto)',                'm'],
    [MDC_ROW.POWER_FACTOR,    'Factor de potencia objetivo',                          ''],
    // §5.5 REFERENCIAS A PLANOS  (labels written by writer; left blank here)
    // §6 LAYOUT  (labels written by writer; left blank here)
  ];

  bodyRows.forEach(function(rl) {
    var r = rl[0];
    sh.getRange(r, 2).setValue(rl[1])
      .setFontFamily(token('FONT_FAMILY'))
      .setFontSize(tokenNum('FONT_SIZE_BODY'))
      .setFontColor(token('TEXT_PRIMARY'))
      .setVerticalAlignment('middle');
    if (rl[2]) {
      sh.getRange(r, 4).setValue(rl[2])
        .setFontFamily(token('FONT_FAMILY'))
        .setFontSize(tokenNum('FONT_SIZE_BODY'))
        .setFontColor(token('TEXT_SECONDARY'))
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle');
    }
    sh.setRowHeight(r, tokenNum('ROW_H_BODY'));
  });

  // ---- Wrap long multi-line value cells -----------------------------------
  // Some rows hold multi-line audit detail in col C (one line per inverter,
  // optional uneven-loading observation, etc.). Without wrap, the text spills
  // into adjacent cols or gets cut off. Wrap makes the row auto-grow vertically.
  var wrapRows = [
    MDC_ROW.CHECK_WINDOW,    // row 40 — Voc cold + Vmp hot per inverter
    MDC_ROW.CHECK_DC_LIMIT,  // row 41 — MPPT loading + uneven warnings
    MDC_ROW.STR03_MPPT,      // row 42 — MPPT current limits
    MDC_ROW.RESULT_AC,       // row 54 — inverter result summary
  ];
  wrapRows.forEach(function(r) {
    sh.getRange(r, 3).setWrap(true).setVerticalAlignment('middle');
    // Also wrap the status col E so any long status text stays in-cell
    sh.getRange(r, 5).setWrap(true).setVerticalAlignment('middle');
  });

  // ---- Mute audit columns (F citation, G formula) -------------------------
  // CITA NOM / FÓRMULA-NOTA are reference info — when reviewers scan the
  // sheet, the headline numbers are in col C and status is in col E.
  // Without muting these, the long audit-trail strings dominate the visual
  // field and make the important data harder to find.
  //
  // Col E (STATUS) is intentionally NOT muted — it gets conditional formatting
  // (green/yellow/red) added below to make PASS/FAIL scannable.
  // Mute F-G from row 6 down through the §7 BESS band (row 110). Rows 94-99
  // are blank (gap above §7); muting empty cells is harmless. Extending here
  // means the BESS section's F/G columns get the same muted styling as the
  // rest of the MDC without a second range to maintain.
  var muteRange = sh.getRange(6, 6, MDC_ROW.BESS_NOM_CITE - 6 + 1, 2); // F-G only
  muteRange
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontColor(token('TEXT_MUTED'))
    .setVerticalAlignment('top');

  // ---- Section headers -----------------------------------------------------
  // Each entry: [row, label]. All rows come from MDC_ROW so any future shift
  // only requires editing the constant.
  var sectionHeaders = [
    [MDC_ROW.SEC0_HEADER,     '0. GENERALES DEL SISTEMA'],
    [MDC_ROW.SEC1_HEADER,     '1.0 MEMORIA DE CÁLCULO DC'],
    [MDC_ROW.SEC11_HEADER,    '1.1 VALIDACIÓN DE VOLTAJE DE STRING'],
    [MDC_ROW.SEC2_HEADER,     '2.0 SALIDA AC POR INVERSOR'],
    [MDC_ROW.SEC3_HEADER,     '3.0 TABLERO AC / ALIMENTADOR PRINCIPAL'],
    [MDC_ROW.SEC4_HEADER,     '4.0 BANDERAS DE REVISIÓN Y EMISIÓN'],
    [MDC_ROW.SEC5_HEADER,     '5.0 SUPUESTOS CLAVE DE DISEÑO'],
    [MDC_ROW.SEC55_HEADER,    '5.5 REFERENCIAS A PLANOS / DOCUMENTOS DE DISEÑO'],
    [MDC_ROW.SEC6_HEADER,     '6.0 LAYOUT / ESCALADO DE PLANTA'],
    [MDC_ROW.SEC7_HEADER,     '7.0 ALMACENAMIENTO / BATERÍA (BESS)'],
  ];
  sectionHeaders.forEach(function(sh_pair) {
    var r = sh_pair[0];
    // Set the label in col B only (no merge). The engine writes various cols
    // on these rows for some sections (5.5 via writer line 492, 6.0 via
    // line 510), and merging would block those writes.
    sh.getRange(r, 2).setValue(sh_pair[1])
      .setFontFamily(token('FONT_FAMILY'))
      .setFontSize(tokenNum('FONT_SIZE_SECTION'))
      .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
      .setFontColor(token('TEXT_PRIMARY'))
      .setVerticalAlignment('middle')
      .setHorizontalAlignment('left');
    // Paint cream background across cols B-H to give visual emphasis without merging
    sh.getRange(r, 2, 1, 7)
      .setBackground(token('BG_INPUT_CELL'))
      .setFontFamily(token('FONT_FAMILY'))
      .setFontSize(tokenNum('FONT_SIZE_SECTION'))
      .setVerticalAlignment('middle');
    sh.setRowHeight(r, tokenNum('ROW_H_SECTION'));
    sh.getRange(r, 2, 1, 7).setBorder(
      null, null, true, null, null, null,
      token('DIVIDER_LINE'), SpreadsheetApp.BorderStyle.SOLID
    );
  });

  // ---- Footer (legend) -----------------------------------------------------
  // Legend label gets pre-styled; engine writes the actual text into col B.
  // sh.getRange(MDC_ROW.LEGEND, 2, 1, 7).merge();   // engine handles content
  sh.setRowHeight(MDC_ROW.LEGEND, 18);
  sh.setRowHeight(MDC_ROW.TIMESTAMP, 18);

  // ---- Conditional formatting on col E (STATUS) ---------------------------
  // Green for PASS / OK / EMITTABLE (success). Yellow for REVIEW / OBSERVATIONS
  // (caution). Red for FAIL / BLOCKED (problem). Auditors can scan col E
  // top-to-bottom and immediately spot anything that needs attention.
  //
  // Apps Script CF rules apply over the visible data range (rows 6-110,
  // extended from 93 to include the §7 BESS band so its circuit-status cell
  // gets the same green/yellow/red treatment as the rest of the MDC).
  var statusRange = sh.getRange(6, 5, MDC_ROW.BESS_NOM_CITE - 6 + 1, 1);
  var rules = sh.getConditionalFormatRules();

  // Drop any existing rules on this range (from prior previewMDC runs)
  rules = rules.filter(function(r) {
    var ranges = r.getRanges();
    return !ranges.some(function(rng) {
      return rng.getColumn() === 5 && rng.getRow() >= 6;
    });
  });

  // FAIL / BLOCKED — bold only, no color (icon ❌ does the visual signaling)
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains('FAIL')
    .setBold(true)
    .setRanges([statusRange])
    .build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains('BLOQUEADO')
    .setBold(true)
    .setRanges([statusRange])
    .build());

  // REVIEW / OBSERVATIONS — bold only (icon ⚠ does the signaling)
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains('REVIEW')
    .setBold(true)
    .setRanges([statusRange])
    .build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains('OBSERVATIONS')
    .setBold(true)
    .setRanges([statusRange])
    .build());

  // PASS / OK / EMITTABLE — bold only (icon ✅ does the signaling)
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains('PASS')
    .setBold(true)
    .setRanges([statusRange])
    .build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains('OK')
    .setBold(true)
    .setRanges([statusRange])
    .build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('EMITTABLE')
    .setBold(true)
    .setRanges([statusRange])
    .build());

  sh.setConditionalFormatRules(rules);

  // Style col E base formatting (font + alignment for status)
  statusRange
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_BODY'))
    .setVerticalAlignment('middle')
    .setHorizontalAlignment('left');

  // ---- Freeze --------------------------------------------------------------
  // Now safe to freeze cols too, since no merged cells cross col-2 boundary
  // (section headers no longer merge B:H, and banner title is unmerged D2/D3).
  sh.setFrozenRows(5);     // banner (1-3) + column headers (4) + emission status (5)
  sh.setFrozenColumns(2);  // margin + label always visible

  return sh;
}


// ---------------------------------------------------------------------------
// PREVIEW WRAPPER for MDC template — for one-click run from IDE
// WARNING: wipes the MDC tab. Run on a copy first.
// ---------------------------------------------------------------------------
function previewMDC() {
  setupMDCTemplate(true);
}


// =============================================================================
// BOM TAB SETUP (Phase 2e, 2026-04-25)
//
// Wipes the BOM tab and rebuilds the persistent visual canvas:
//   - Banner (rows 1-3): logo + "BILL OF MATERIALS" title + project subtitle
//   - Column headers (row 4): styled with cream background
//   - Column widths optimized for 8-col layout (#, DESC, QTY, UNIDAD, USD/u, TOTAL USD, TOTAL MXN, REF)
//   - Frozen rows so banner + headers stay visible when scrolling
//
// CONTENT (rows 5+): comes from the engine writer (08_WriteBOM.gs) every run.
// The writer's clearContent on rows 5-90 preserves the formatting we set here.
//
// NOTE: this is destructive. Always run on a copy first.
// =============================================================================
// =============================================================================
// BOM TAB SETUP (Phase 2e batch 2b, 2026-04-25)
//
// Wipes the BOM tab and rebuilds the persistent visual canvas. After this
// runs, the engine writer (08_WriteBOM.gs) populates the content rows.
//
// Layout (post-Phase-2e shift, all rows driven by BOM_ROW constants):
//   Rows 1-3:    Banner — logo at B2 + "BILL OF MATERIALS" title at C2 + subtitle at C3
//   Row 4:       PROJECT_META — engine writes "BOM -- TESTPROJ-001 | ..." string here
//   Row 5:       HEADERS — column headers (ITEM #, DESCRIPCIÓN, QTY, etc.)
//   Row 6:       EXCHANGE_RATE — TC USD/MXN value (referenced as $F$6 in formulas)
//   Rows 7-78:   Content — 7 sections with subtotals, written by the engine
//   Row 80:      GRAND_TOTAL — sum of all 7 subtotals
//
// CONTENT comes from the engine writer every run. The writer's clearContent
// starts at row 4 (BOM_ROW.PROJECT_META), so banner rows 1-3 are preserved.
//
// NOTE: this is destructive. Always run on a copy first.
// =============================================================================
function setupBOMTemplate(confirmOverwrite) {
  var ss = SpreadsheetApp.getActive();
  resetDesignTokenCache_();
  loadDesignTokens(ss);

  var existing = ss.getSheetByName(SH.BOM || 'BOM');
  if (existing && confirmOverwrite !== true) {
    var hasData = false;
    try {
      // Check first content row (after banner + headers)
      var firstVal = existing.getRange(BOM_ROW.PANEL_PRIMARY, 2).getValue();
      if (firstVal) hasData = true;
    } catch(e) {}
    if (hasData) {
      throw new Error('setupBOMTemplate: BOM tab already exists and contains data. ' +
        'Call setupBOMTemplate(true) to force overwrite, or rename the existing tab to keep as backup.');
    }
  }

  if (existing) ss.deleteSheet(existing);
  var sh = ss.insertSheet(SH.BOM || 'BOM');

  // ---- Canvas --------------------------------------------------------------
  sh.setHiddenGridlines(true);
  // 8 columns mapped to BOM_COL constants. Widths tuned for readability:
  // descriptions are the longest text, prices need 2-decimal display room.
  sh.setColumnWidth(BOM_COL.ITEM,        50);   // A — item # (centered, narrow)
  sh.setColumnWidth(BOM_COL.DESCRIPTION, 380);  // B — description (longest text)
  sh.setColumnWidth(BOM_COL.QTY,         70);   // C
  sh.setColumnWidth(BOM_COL.UNIT,        70);   // D
  sh.setColumnWidth(BOM_COL.UNIT_PRICE,  110);  // E — unit price USD
  sh.setColumnWidth(BOM_COL.TOTAL_USD,   120);  // F — line total USD
  sh.setColumnWidth(BOM_COL.TOTAL_MXN,   120);  // G — line total MXN
  sh.setColumnWidth(BOM_COL.REFERENCE,   220);  // H — references / DB IDs / NOM cites

  // ---- Banner (rows 1-3) ---------------------------------------------------
  // BOM layout: logo at A2 (small, spans A-B), title in row 2 cols C-F (merged),
  // subtitle in row 3 cols C-F. Engine writes start at row 4 so merges here
  // don't collide with engine writes.
  _insertArgiaLogo(sh, 2, 1);  // A2 (will visually appear over A-B because of width)
  // Title — spans C-F so it has room for "BILL OF MATERIALS" in title font
  sh.getRange(BOM_ROW.BANNER_TITLE, 3, 1, 4).breakApart().merge()
    .setValue('BILL OF MATERIALS')
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_TITLE'))
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontColor(token('TEXT_PRIMARY'))
    .setVerticalAlignment('bottom')
    .setHorizontalAlignment('left');
  // Subtitle — same span
  sh.getRange(BOM_ROW.BANNER_SUBTITLE, 3, 1, 4).breakApart().merge()
    .setValue('Cantidades, precios unitarios y subtotales por sección')
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontColor(token('TEXT_SECONDARY'))
    .setHorizontalAlignment('left');
  sh.setRowHeight(BOM_ROW.BANNER_TITLE, tokenNum('ROW_H_TITLE'));

  // ---- Project meta row (row 4) — pre-style for engine write --------------
  // Engine writes "BOM -- <projectName> | <client> | <kWp/kWac>" string here.
  // Pre-style as muted small text (it's reference info, not the headline).
  sh.getRange(BOM_ROW.PROJECT_META, 1, 1, 8)
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontColor(token('TEXT_MUTED'))
    .setVerticalAlignment('middle');

  // ---- Column headers (row 5) — pre-style for engine write ----------------
  // Engine will overwrite values, but our font/bg/bold styling persists
  // because setValue does not reset cell formatting.
  sh.getRange(BOM_ROW.HEADERS, 1, 1, 8)
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_BODY'))
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontColor(token('TEXT_PRIMARY'))
    .setBackground(token('BG_INPUT_CELL'))
    .setVerticalAlignment('middle')
    .setHorizontalAlignment('center');
  sh.getRange(BOM_ROW.HEADERS, BOM_COL.DESCRIPTION).setHorizontalAlignment('left');
  sh.getRange(BOM_ROW.HEADERS, BOM_COL.REFERENCE).setHorizontalAlignment('left');
  sh.setRowHeight(BOM_ROW.HEADERS, 28);
  sh.getRange(BOM_ROW.HEADERS, 1, 1, 8).setBorder(
    null, null, true, null, null, null,
    token('DIVIDER_STRONG'), SpreadsheetApp.BorderStyle.SOLID
  );

  // ---- Exchange rate row (row 6) ------------------------------------------
  // Engine writes "TC USD/MXN:" label + value here. Pre-style with light
  // background so it visually reads as a "control" (editable rate input).
  sh.getRange(BOM_ROW.EXCHANGE_RATE, 1, 1, 8)
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_BODY'))
    .setFontColor(token('TEXT_SECONDARY'))
    .setVerticalAlignment('middle');
  // Highlight the rate cell itself (col F) so users notice it's editable
  sh.getRange(BOM_ROW.EXCHANGE_RATE, BOM_COL.TOTAL_USD)
    .setBackground(token('BG_PAGE'))
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setHorizontalAlignment('right');

  // ---- Pre-style content rows (7-80) for engine writes --------------------
  // The engine's setValue calls preserve formatting, so styling here persists.
  var contentStart = BOM_ROW.SEC_PANELS;          // first content row
  var contentRows  = BOM_ROW.GRAND_TOTAL - BOM_ROW.SEC_PANELS + 1;
  var contentRange = sh.getRange(contentStart, 1, contentRows, 8);
  contentRange
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_BODY'))
    .setFontColor(token('TEXT_PRIMARY'))
    .setVerticalAlignment('middle');
  // QTY (col C) — integers with thousands sep
  sh.getRange(contentStart, BOM_COL.QTY, contentRows, 1)
    .setNumberFormat('#,##0').setHorizontalAlignment('right');
  // Unit prices (col E) — 2 decimals
  sh.getRange(contentStart, BOM_COL.UNIT_PRICE, contentRows, 1)
    .setNumberFormat('#,##0.00').setHorizontalAlignment('right');
  // Line total USD (col F) — 2 decimals
  sh.getRange(contentStart, BOM_COL.TOTAL_USD, contentRows, 1)
    .setNumberFormat('#,##0.00').setHorizontalAlignment('right');
  // Line total MXN (col G) — no decimals (cleaner for big peso numbers)
  sh.getRange(contentStart, BOM_COL.TOTAL_MXN, contentRows, 1)
    .setNumberFormat('#,##0').setHorizontalAlignment('right');
  // Description (col B) left-aligned
  sh.getRange(contentStart, BOM_COL.DESCRIPTION, contentRows, 1)
    .setHorizontalAlignment('left').setWrap(true);
  // Item # (col A) center-aligned, no decimals (writer passes integers)
  sh.getRange(contentStart, BOM_COL.ITEM, contentRows, 1)
    .setHorizontalAlignment('center').setNumberFormat('0');
  // Reference (col H) muted, smaller, left-aligned
  sh.getRange(contentStart, BOM_COL.REFERENCE, contentRows, 1)
    .setHorizontalAlignment('left')
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontColor(token('TEXT_MUTED'))
    .setWrap(true);

  // ---- Freeze --------------------------------------------------------------
  // 5 rows: banner (1-3) + project meta (4) + column headers (5).
  // Row 6 (exchange rate) intentionally NOT frozen — it's editable utility.
  sh.setFrozenRows(BOM_ROW.HEADERS);
  // Freeze cols A-B so item # + description always visible when scrolling right
  sh.setFrozenColumns(BOM_COL.DESCRIPTION);

  return sh;
}


// ---------------------------------------------------------------------------
// PREVIEW WRAPPER for BOM template
// WARNING: wipes the BOM tab. Run on a copy first.
// ---------------------------------------------------------------------------
function previewBOM() {
  setupBOMTemplate(true);
}


// =============================================================================
// INSTALLATION TAB BANNER PATCH (Phase 2e, 2026-04-25)
//
// Adds a logo + title + subtitle banner to rows 1-3 of the INSTALLATION tab,
// matching the MDC/BOM modernized banner style. This is an IN-PLACE patch:
// it touches ONLY rows 1-3 and does NOT wipe or modify any other content.
// Idempotent — safe to run multiple times.
//
// Why in-place (not destructive template like MDC/BOM):
// The INSTALLATION tab's layout (rows 4-127, 28 cols, multiple zones) was
// hand-built in the spreadsheet, not coded. Rebuilding it destructively
// would require re-engineering all that layout from screenshots, with high
// risk of subtle mismatches. The patch approach gets us a consistent banner
// with bounded scope.
// =============================================================================
function addInstallationBanner() {
  var ss = SpreadsheetApp.getActive();
  resetDesignTokenCache_();
  loadDesignTokens(ss);

  var sh = ss.getSheetByName(SH.INSTALL_COST || 'INSTALLATION');
  if (!sh) {
    throw new Error('addInstallationBanner: INSTALLATION tab not found.');
  }

  // ---- Clear rows 1-3 first (idempotent — overwrites any previous banner) -
  // We only clear cols A-E since the input panel is in A-C and the summary
  // panel starts at F. Anything in F:Z of rows 1-3 is left alone (currently
  // empty, but defensive in case of future expansion).
  sh.getRange(1, 1, 3, 5).clearContent().clearFormat();

  // ---- Insert logo at A2 ---------------------------------------------------
  // Logo is an image anchor at (row 2, col 1). Visually overlays — won't
  // fill the cell, just floats at that position.
  _insertArgiaLogo(sh, 2, 1);

  // ---- Title at C2 (right of logo) -----------------------------------------
  // Includes "(MXN)" because this tab's values are in pesos, not USD —
  // estimators need the distinction (BOM is USD-primary).
  sh.getRange(2, 3)
    .setValue('INSTALACIÓN · MXN')
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_TITLE'))
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontColor(token('TEXT_PRIMARY'))
    .setVerticalAlignment('bottom');

  // ---- Subtitle at C3 ------------------------------------------------------
  // Preserves the original instructional hint ("blue input cells"). Without
  // this, new users wouldn't know which cells are editable.
  sh.getRange(3, 3)
    .setValue('Mano de obra · Equipo · Indirectos · Las celdas azules son inputs editables')
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontColor(token('TEXT_SECONDARY'));

  // ---- Banner row heights --------------------------------------------------
  sh.setRowHeight(2, tokenNum('ROW_H_TITLE'));

  // ---- Freeze rows 1-3 so banner stays visible when scrolling -------------
  // Existing layout has input panel headers at row 4. Freezing 3 rows keeps
  // banner visible without hiding the headers.
  sh.setFrozenRows(3);

  return sh;
}


// =============================================================================
// INSTALLATION TAB TOP-ZONE RESTYLE (Phase 2e, 2026-04-25)
//
// Replaces the dark/colored hand-built styling of the top zone (rows 1-36)
// with the BOM cream/grey palette for a lighter, more professional look
// suitable for client-facing PDF export.
//
// Done in 3 clearly demarcated steps so failure mode is identifiable:
//
//   STEP 1: Restyle panel headers + totals
//     - Row 4 left+right panel headers (DRIVER/INPUT, SUMMARY) → cream + bold + divider
//     - Row 14 SECTION grid header → same
//     - Row 24 MAN-HOURS BREAKDOWN header → same
//     - Black total cells (G5-G8, G10-G12) → light cream + bold
//     - GRAND TOTAL row 9 → BOM grand-total style (darker cream + thick borders)
//     - TOTAL row 33 (man-hours) → BOM subtotal style (cream + top border + bold)
//
//   STEP 2: Tone down section row colors (rows 15-22)
//     - Replace 8 different pastel section colors with neutral white background
//     - Add bottom-border between rows for separation
//     - Keep bold on TOTAL column (J) only
//
//   STEP 3: Restyle input panel (rows 5-34, cols A-C)
//     - Driver labels (col A): keep light grey, smaller font, muted color
//     - Input cells (col B): keep blue tint (signals editable), only adjust font
//     - Notes (col C): keep white, smaller muted font
//     - DOES NOT clearFormat on input cells (preserves dropdown validations)
//
// Idempotent — safe to re-run.
//
// NO MATH IS TOUCHED. All cell values are written by the engine; this function
// only modifies cell formatting (background, font, border).
// =============================================================================
function restyleInstallationTopZone() {
  var ss = SpreadsheetApp.getActive();
  resetDesignTokenCache_();
  loadDesignTokens(ss);

  var sh = ss.getSheetByName(SH.INSTALL_COST || 'INSTALLATION');
  if (!sh) {
    throw new Error('restyleInstallationTopZone: INSTALLATION tab not found.');
  }

  var FONT       = token('FONT_FAMILY');
  var TXT_PRIM   = token('TEXT_PRIMARY');
  var TXT_SEC    = token('TEXT_SECONDARY');
  var TXT_MUTED  = token('TEXT_MUTED');
  var BG_HEADER  = token('BG_INPUT_CELL');     // cream — same as BOM column headers
  var BG_PAGE    = token('BG_PAGE');           // light page background for total cells
  var DIVIDER    = token('DIVIDER_LINE');
  var DIV_STRONG = token('DIVIDER_STRONG');

  // ===========================================================================
  // STEP 1: Restyle panel headers + total cells
  // ===========================================================================

  // Left-panel header (row 4, A-C): "DRIVER / INPUT | VALUE | NOTES"
  sh.getRange(4, 1, 1, 3)
    .setBackground(BG_HEADER)
    .setFontFamily(FONT).setFontSize(11).setFontWeight('bold')
    .setFontColor(TXT_PRIM)
    .setBorder(null, null, true, null, null, null, DIV_STRONG, SpreadsheetApp.BorderStyle.SOLID);

  // Right-panel header row 4 (F-G): "SUMMARY | $242k"
  sh.getRange(4, 6, 1, 2)
    .setBackground(BG_HEADER)
    .setFontFamily(FONT).setFontSize(11).setFontWeight('bold')
    .setFontColor(TXT_PRIM)
    .setBorder(null, null, true, null, null, null, DIV_STRONG, SpreadsheetApp.BorderStyle.SOLID);

  // SECTION grid header (row 14, F-J): SECTION | LABOR | EQUIP | OTHER | TOTAL
  sh.getRange(14, 6, 1, 5)
    .setBackground(BG_HEADER)
    .setFontFamily(FONT).setFontSize(11).setFontWeight('bold')
    .setFontColor(TXT_PRIM)
    .setBorder(null, null, true, null, null, null, DIV_STRONG, SpreadsheetApp.BorderStyle.SOLID);

  // MAN-HOURS BREAKDOWN header (row 24, F-J)
  sh.getRange(24, 6, 1, 5)
    .setBackground(BG_HEADER)
    .setFontFamily(FONT).setFontSize(11).setFontWeight('bold')
    .setFontColor(TXT_PRIM)
    .setBorder(null, null, true, null, null, null, DIV_STRONG, SpreadsheetApp.BorderStyle.SOLID);

  // Summary panel labels (col F, rows 5-12) — light grey background
  sh.getRange(5, 6, 8, 1)
    .setBackground('#f5f5f5')
    .setFontFamily(FONT).setFontSize(10)
    .setFontColor(TXT_SEC);

  // Summary panel values (col G, rows 5-12) — was BLACK, now neutral
  // Each row gets a light cream background, totals stand out via bold
  sh.getRange(5, 7, 8, 1)
    .setBackground('#ffffff')
    .setFontFamily(FONT).setFontSize(11)
    .setFontColor(TXT_PRIM)
    .setHorizontalAlignment('right')
    .setNumberFormat('#,##0');

  // GRAND TOTAL row 9 (F9-G9) — BOM grand-total style
  sh.getRange(9, 6, 1, 2)
    .setBackground('#fffde7')                            // light cream — BOM grand total bg
    .setFontFamily(FONT).setFontSize(12).setFontWeight('bold')
    .setFontColor(TXT_PRIM)
    .setBorder(true, null, true, null, null, null, '#424242', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sh.setRowHeight(9, 28);

  // Bold the TOTAL column on section grid (col J, rows 15-22)
  sh.getRange(15, 10, 8, 1).setFontWeight('bold');

  // TOTAL row 33 of man-hours (F33-J33) — BOM subtotal style
  sh.getRange(33, 6, 1, 5)
    .setBackground('#fff8e1')
    .setFontFamily(FONT).setFontSize(10).setFontWeight('bold')
    .setFontColor(TXT_PRIM)
    .setBorder(true, null, null, null, null, null, '#bdbdbd', SpreadsheetApp.BorderStyle.SOLID);

  // ===========================================================================
  // STEP 2: Tone down section row colors (rows 15-22)
  // Was: 8 different pastel backgrounds (blue, red, green, purple, pink, yellow,
  //      teal, grey). Now: white background with bottom border between rows.
  // ===========================================================================
  sh.getRange(15, 6, 8, 5)
    .setBackground('#ffffff')
    .setFontFamily(FONT).setFontSize(10)
    .setFontColor(TXT_PRIM);

  // Section name labels (col F) — slightly muted
  sh.getRange(15, 6, 8, 1).setFontColor(TXT_SEC);

  // Number columns (G-J) — right-aligned, no decimals (these are MXN totals)
  sh.getRange(15, 7, 8, 4)
    .setHorizontalAlignment('right')
    .setNumberFormat('#,##0');

  // Bold the TOTAL column (J) so it stands out
  sh.getRange(15, 10, 8, 1).setFontWeight('bold');

  // Row separator borders — light dividers between section rows
  sh.getRange(15, 6, 8, 5).setBorder(
    null, null, true, null, null, true,
    '#eeeeee', SpreadsheetApp.BorderStyle.SOLID
  );

  // ===========================================================================
  // STEP 3: Restyle input panel (rows 5-34, cols A-C)
  // CRITICAL: We do NOT clearFormat on input cells (col B) because that may
  // wipe dropdown validations on rows 24-31. We only set background+font.
  // ===========================================================================

  // Driver label cells (col A) — light cream, smaller font, muted color
  sh.getRange(5, 1, 30, 1)
    .setBackground('#fafafa')
    .setFontFamily(FONT).setFontSize(9)
    .setFontColor(TXT_SEC);

  // Input cells (col B) — light cream tint (signals editable, no blue/violet)
  // Per Phase 2e: moved away from blue palette to harmonize with BOM cream/grey
  sh.getRange(5, 2, 30, 1)
    .setBackground('#fff8e1')                  // light cream — signals editable
    .setFontFamily(FONT).setFontSize(10)
    .setFontColor(TXT_PRIM)
    .setHorizontalAlignment('right');

  // Note cells (col C) — white background, muted small font
  sh.getRange(5, 3, 30, 1)
    .setBackground('#ffffff')
    .setFontFamily(FONT).setFontSize(9)
    .setFontColor(TXT_MUTED);

  // ===========================================================================
  // BONUS: Hide gridlines for cleaner look (matches BOM)
  // ===========================================================================
  sh.setHiddenGridlines(true);

  // ===========================================================================
  // BANNER LEFTOVER CLEANUP: clear F1:J1 (and F2:J2, F3:J3) of any old
  // styling. Banner only uses cols A-E. Without this, leftover background
  // colors from the old hand-built styling remain visible above the SUMMARY
  // panel.
  // ===========================================================================
  sh.getRange(1, 6, 3, 5).clearContent().clearFormat();

  return sh;
}