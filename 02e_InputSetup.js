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
// ---------------------------------------------------------------------------
// [A2c] Setup-seed value for a field, distinct from mapEntry.default.
//   mapEntry.default = the value readInput() returns for an EMPTY cell (the
//                      reader fallback; consumed by the engine at read time).
//   mapEntry.seed    = the value setup writes into a fresh cell (a suggested
//                      starting point for the designer).
// They are usually identical and only `default` is set, so this returns
// `default` by default. When the two must differ -- e.g. a reader fallback of 0
// but a sensible suggested value of 250000 -- give the field a `seed`. Returns
// '' when there is nothing to seed (so callers can guard with `!== ''`).
// ---------------------------------------------------------------------------
function _seedValueFor(mapEntry) {
  if (mapEntry && mapEntry.hasOwnProperty('seed'))    return mapEntry.seed;
  if (mapEntry && mapEntry.hasOwnProperty('default')) return mapEntry.default;
  return '';
}

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
  // ── Col-C primary entry (BESS / single-value col-C tabs) ─────────────────
  // [A2c] BESS and other col-3 tabs put the editable value in C, so the label
  // sits in B alone (no B:C merge -- C is occupied) and the unit shifts left
  // to D. Styling mirrors the col-4 primary path below. Dormant until a col-3
  // tab is rendered via _setupOneTab (no col-3 PRIMARY entry is rendered by
  // the existing Project/Install flows, which are col-4).
  if (c === 3) {
    sh.getRange(r, 2)
      .setValue(mapEntry.label + (mapEntry.required ? ' *' : ''))
      .setFontFamily(token('FONT_FAMILY'))
      .setFontSize(tokenNum('FONT_SIZE_BODY'))
      .setFontColor(token('TEXT_PRIMARY'))
      .setVerticalAlignment('middle');

    var colCCell = sh.getRange(r, 3);
    var _colCSeed = _seedValueFor(mapEntry);
    if (_colCSeed !== '') colCCell.setValue(_colCSeed);
    colCCell
      .setFontFamily(token('FONT_FAMILY'))
      .setFontSize(tokenNum('FONT_SIZE_BODY'))
      .setFontColor(token('TEXT_PRIMARY'))
      .setBackground(token('BG_INPUT_CELL'))
      .setHorizontalAlignment('right')
      .setVerticalAlignment('middle');
    _applyTypeValidation(colCCell, mapEntry);

    var colCHint = mapEntry.unit || _formatHintFor(mapEntry);
    if (colCHint) {
      sh.getRange(r, 4)
        .setValue(colCHint)
        .setFontFamily(token('FONT_FAMILY'))
        .setFontSize(tokenNum('FONT_SIZE_SMALL'))
        .setFontColor(token('TEXT_SECONDARY'))
        .setFontStyle(mapEntry.unit ? 'normal' : 'italic')
        .setHorizontalAlignment('left')
        .setVerticalAlignment('middle');
    }

    // Row-level divider beneath the whole row (B:G), matching col-4 rows.
    sh.getRange(r, 2, 1, 6).setBorder(
      null, null, true, null, null, null,
      token('DIVIDER_LINE'), SpreadsheetApp.BorderStyle.SOLID
    );
    sh.setRowHeight(r, tokenNum('ROW_H_BODY'));
    return;
  }

  if (c !== 4) {
    var secondaryCell = sh.getRange(r, c);
    var _secSeed = _seedValueFor(mapEntry);
    if (_secSeed !== '') {
      secondaryCell.setValue(_secSeed);
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
  var _primSeed = _seedValueFor(mapEntry);
  if (_primSeed !== '') {
    valueCell.setValue(_primSeed);
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
    // If the current value equals what setup would seed (seed ?? default), it's
    // not user data -- a freshly-built tab holds the seed, not a blank.
    if (v === _seedValueFor(m)) continue;
    // Anything else -> user data
    return true;
  }
  return false;
}


// ---------------------------------------------------------------------------
// Logo placement -- in-cell image via CellImage API (Tier 3.2, 2026-05-27).
//
// HISTORY:
//   v1 (legacy): sh.insertImage(blob, col, row) -- floating image. Broken
//                in PDF exports (renders as black rectangle).
//   v2 (3.7.1):  =IMAGE("https://drive.google.com/thumbnail?id=...") --
//                broken because Google's thumbnail endpoint changed in
//                fall 2025 and now serves nothing to IMAGE() callers
//                (confirmed by Adobe + others reporting the same break).
//                The cell appeared blank in Sheets and PDFs.
//   v3 (this):   SpreadsheetApp.newCellImage() with the blob read directly
//                from Drive. The image is embedded as cell content using
//                Apps Script's CellImage API. No dependency on public
//                URLs, sharing settings, thumbnail servers, or IMAGE()
//                formula behavior. Renders identically in Sheets and PDF
//                exports because in-cell images are part of the cell's
//                value, not an overlay layer.
//
// Signature unchanged: _insertArgiaLogo(sh, row, col). All 13 existing
// call sites continue to work without edit.
//
// Caching: the binary blob (small PNG, typically <30 KB) is held in
// CacheService for 6 hours so repeated template-setup calls in the same
// session don't re-read the file from Drive. PropertiesService is NOT
// used (it has a 9 KB value cap; binary > base64 + JSON quoting could
// exceed it).
//
// Public helper: refreshArgiaLogoCache() drops the cache so the next
// template-setup re-reads from Drive. Wired to ARGIA -> Setup ->
// Refresh Logo Cache in 00_Main.js.
// ---------------------------------------------------------------------------
var LOGO_FILENAME = 'argia_logo_dark.png';
var LOGO_MASTER_LINK_SHEET = '00_MASTER_LINK';
var LOGO_MASTER_LINK_CELL  = 'K2';
var LOGO_HEIGHT_PX = 42;            // px target height (legacy value)
var LOGO_CELL_WIDTH_PX = 160;       // target column width; logo aspect ~3:1
var LOGO_CACHE_KEY_B64 = '_argia_logo_b64_v3';
var LOGO_CACHE_KEY_MIME = '_argia_logo_mime_v3';
var LOGO_CACHE_KEY_FOLDER = '_argia_logo_folder_v3';
var LOGO_CACHE_TTL_SEC = 6 * 60 * 60;   // 6 hours

function _insertArgiaLogo(sh, row, col) {
  try {
    // NOTE on dedup (removed 2026-05-27, v3.7.4):
    //   v3 uses the CellImage API (in-cell image, not floating image), so
    //   this function never creates floating images. The old dedup block
    //   was a one-time cleanup for workbooks upgrading from v1's
    //   sh.insertImage approach -- but it ran on every call, and the
    //   CFE template setup has its own _cfeOutV2_removeImages cleanup
    //   step. The two were doubling up and breaking CFE's image-cleanup
    //   unit test (test counted removals; this helper's dedup was
    //   removing extra images the template author didn't expect).
    //
    //   Templates that need to clean up old floating images should do
    //   so themselves (CFE already does). For one-off cleanup of legacy
    //   workbooks, run the engine's "Reset v2 Templates" path.

    // ---- Clear any prior =IMAGE formula in the target cell --------------
    // v2 wrote an =IMAGE(...) formula. Clear it so the CellImage API can
    // own the cell value. Single cell only; we don't touch neighbors.
    var target = sh.getRange(row, col);
    try {
      var existingFormula = target.getFormula();
      if (existingFormula && existingFormula.indexOf('IMAGE(') !== -1) {
        target.clearContent();
      }
    } catch (_) { /* non-fatal */ }

    // ---- Resolve the logo as a base64 data URI --------------------------
    var dataUri = _resolveArgiaLogoDataUri_(sh.getParent());
    if (!dataUri) {
      // Already logged inside resolver. Leave the cell blank.
      return;
    }

    // ---- Build a CellImage and write it into the target cell ------------
    // CellImage API requires a URL-shaped value, but a "data:image/png;base64,..."
    // URI counts as a URL and is rendered inline (no fetch). This is the
    // documented bulletproof pattern.
    var cellImg = SpreadsheetApp.newCellImage()
      .setSourceUrl(dataUri)
      .setAltTextTitle('ARGIA Solar')
      .build();
    target.setValue(cellImg);

    // ---- Match row height and column width so the logo isn't cropped ----
    // Only widen the column if it's narrower than the target; never shrink
    // (caller may have set a deliberately wider banner column).
    try {
      var currentColW = sh.getColumnWidth(col);
      if (currentColW < LOGO_CELL_WIDTH_PX) {
        sh.setColumnWidth(col, LOGO_CELL_WIDTH_PX);
      }
    } catch (_) { /* non-fatal */ }

    try {
      var currentRowH = sh.getRowHeight(row);
      // +8px padding so the 42px logo doesn't touch the cell edges.
      var targetRowH = LOGO_HEIGHT_PX + 8;
      if (currentRowH < targetRowH) {
        sh.setRowHeight(row, targetRowH);
      }
    } catch (_) { /* non-fatal */ }

    // Center vertically, align left so the banner title (which sits to
    // the right of the logo in v2 templates) reads cleanly.
    target.setVerticalAlignment('middle').setHorizontalAlignment('left');

  } catch (e) {
    Logger.log('_insertArgiaLogo: unexpected error, skipping logo. ' + e.message);
  }
}

// ---------------------------------------------------------------------------
// _resolveArgiaLogoDataUri_: returns "data:image/png;base64,..." for the
// logo file, or null if it can't be resolved.
//
// Caching strategy:
//   - The base64 string can be ~30-100 KB for a 160-wide PNG -- too big
//     for PropertiesService (9 KB cap per value).
//   - CacheService.getScriptCache() has a 100 KB cap per value and a
//     6-hour TTL. That fits the typical logo file comfortably.
//   - If the file is larger than 100 KB or the cache is unavailable,
//     we fall through to live read every call (still works, just
//     slower -- ~1-2 DriveApp calls per template setup).
//   - Cache is keyed by folder ID. If 00_MASTER_LINK!K2 changes
//     (workbook copied to a new project), the next read goes live.
// ---------------------------------------------------------------------------
function _resolveArgiaLogoDataUri_(ss) {
  // ---- Read folder ID from 00_MASTER_LINK!K2 --------------------------
  var link = ss.getSheetByName(LOGO_MASTER_LINK_SHEET);
  if (!link) {
    Logger.log('_resolveArgiaLogoDataUri_: sheet "' + LOGO_MASTER_LINK_SHEET + '" not found, skipping logo.');
    return null;
  }
  var folderId = String(link.getRange(LOGO_MASTER_LINK_CELL).getValue() || '').trim();
  if (!folderId) {
    Logger.log('_resolveArgiaLogoDataUri_: ' + LOGO_MASTER_LINK_SHEET + '!' + LOGO_MASTER_LINK_CELL + ' is empty, skipping logo.');
    return null;
  }

  // ---- Locate the logo file + read its last-modified time -------------
  // FRESHNESS FIX (2026-06-09): the cache used to be keyed by folder ID
  // ALONE, so replacing argia_logo_dark.png in Drive kept serving the OLD
  // base64 for up to the 6h TTL -- and any setup/template re-stamp (which a
  // test run triggers) pasted the stale logo. We now build a version token
  // from folderId + file.getLastUpdated(), so a replaced file AUTO-busts the
  // cache. One cheap metadata lookup per resolve; the expensive getBlob +
  // base64 only runs on a real miss (first call or after the file changes).
  var folder;
  try { folder = DriveApp.getFolderById(folderId); }
  catch (e) {
    Logger.log('_resolveArgiaLogoDataUri_: folder ID "' + folderId + '" not accessible: ' + e.message);
    return null;
  }
  var files = folder.getFilesByName(LOGO_FILENAME);
  if (!files.hasNext()) {
    Logger.log('_resolveArgiaLogoDataUri_: "' + LOGO_FILENAME + '" not found in folder ' + folderId);
    return null;
  }
  var file = files.next();
  var stamp = '';
  try { stamp = String(file.getLastUpdated().getTime()); } catch (_) { stamp = ''; }
  var token = folderId + ':' + stamp;   // cache validity = folder + file version

  // ---- Cache hit? (validated by folder + file-version token) ----------
  var cache;
  try { cache = CacheService.getScriptCache(); } catch (_) { cache = null; }
  if (cache && stamp) {
    try {
      var cachedTok  = cache.get(LOGO_CACHE_KEY_FOLDER);   // stores the token now
      var cachedB64  = cache.get(LOGO_CACHE_KEY_B64);
      var cachedMime = cache.get(LOGO_CACHE_KEY_MIME);
      if (cachedTok === token && cachedB64 && cachedMime) {
        return 'data:' + cachedMime + ';base64,' + cachedB64;
      }
    } catch (_) { /* fall through to live read */ }
  }

  // ---- Live read (cache miss or the file changed) ---------------------
  var blob;
  try { blob = file.getBlob(); }
  catch (e) {
    Logger.log('_resolveArgiaLogoDataUri_: getBlob failed: ' + e.message);
    return null;
  }

  var mime = blob.getContentType() || 'image/png';
  var bytes = blob.getBytes();
  var b64;
  try { b64 = Utilities.base64Encode(bytes); }
  catch (e) {
    Logger.log('_resolveArgiaLogoDataUri_: base64Encode failed: ' + e.message);
    return null;
  }

  // ---- Cache the encoded blob under the version token (best-effort) ---
  if (cache && stamp && b64.length < 95 * 1024) {
    try {
      cache.put(LOGO_CACHE_KEY_FOLDER, token, LOGO_CACHE_TTL_SEC);
      cache.put(LOGO_CACHE_KEY_B64,    b64,   LOGO_CACHE_TTL_SEC);
      cache.put(LOGO_CACHE_KEY_MIME,   mime,  LOGO_CACHE_TTL_SEC);
    } catch (_) { /* non-fatal */ }
  } else if (cache && b64.length >= 95 * 1024) {
    Logger.log('_resolveArgiaLogoDataUri_: logo too large to cache (' +
               b64.length + ' bytes base64); will re-read from Drive each call.');
  }

  return 'data:' + mime + ';base64,' + b64;
}

// ---------------------------------------------------------------------------
// PUBLIC: clear the cached logo blob. Use this if the logo file is
// replaced in Drive and you want the next template-setup run to pick up
// the new version without waiting for the 6-hour TTL.
//
// Wired to ARGIA -> Setup -> Refresh Logo Cache (added in 00_Main.js).
// ---------------------------------------------------------------------------
function refreshArgiaLogoCache() {
  try {
    var cache = CacheService.getScriptCache();
    cache.removeAll([LOGO_CACHE_KEY_FOLDER, LOGO_CACHE_KEY_B64, LOGO_CACHE_KEY_MIME]);
    // Also wipe the v2 PropertiesService keys (cleans up workbooks
    // upgrading from 3.7.1).
    try {
      var props = PropertiesService.getScriptProperties();
      props.deleteProperty('_argia_logo_url_cache_v1');
      props.deleteProperty('_argia_logo_url_cache_folder_v1');
    } catch (_) { /* non-fatal */ }
    var ui = SpreadsheetApp.getUi();
    ui.alert('Argia logo cache cleared',
             'The next template-setup run will re-read the logo from Drive.',
             ui.ButtonSet.OK);
  } catch (e) {
    Logger.log('refreshArgiaLogoCache: ' + e.message);
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

function _lockOptimizersCellReadOnly(sh) {
  // C69 "Optimizadores" is NOT a design driver. The engine derives the count
  // from the inverter topology (INV_TOPOLOGY = OPTIMIZER) and the module count
  // (1 optimizer per module, worst case) — see computeOptimizerUnits(). This cell
  // is locked + greyed so it can't be mistaken for an input; the engine echoes the
  // live computed count here when MDC/BOM is generated.
  try {
    var cell = sh.getRange(69, 3); // C69
    cell.setBackground(token('BG_PAGE'))
        .setFontColor(token('TEXT_MUTED'))
        .setFontStyle('italic');
    cell.clearDataValidations();
    cell.setNote('Calculado por el motor: 1 optimizador por modulo cuando el ' +
                 'inversor es topologia OPTIMIZER. Se actualiza al generar MDC/BOM. No editable.');
    var prot = cell.protect().setDescription('ARGIA: optimizadores (auto, no editar)');
    prot.setWarningOnly(true);
  } catch (e) { /* protection unavailable in some contexts — visual cues still apply */ }
}

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
  _lockOptimizersCellReadOnly(sh);        // C69 is engine-computed, not an input

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
  var _dSeed = _seedValueFor(m);
  if (_dSeed !== '') {
    valueCell.setValue(_dSeed);
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
  var _hintSeed = _seedValueFor(m);
  if (_hintSeed !== '') {
    var defaultStr = 'default: ' + _hintSeed;
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
// HISTORICAL NOTE — Legacy template builders removed 2026-05-27 (v3.7.5).
//
// This file used to contain ~818 lines of legacy MDC/BOM/INSTALLATION tab
// template builders here (setupMDCTemplate, previewMDC, setupBOMTemplate,
// previewBOM, addInstallationBanner, restyleInstallationTopZone). They
// were orphaned after Tier 1 (3.5.0) when the engine cut over to v2
// writers; nothing in the codebase has called them since. Deleted to
// keep the codebase v2-only.
//
// The equivalent v2 builders live in templates/setupMdcTemplate.js,
// templates/setupBomTemplate.js, and templates/setupInstallationTemplate.js.
// They are registered in templates/TemplateRegistry.js and wired into
// the engine via setupAllV2Templates().
//
// To recover the legacy versions if needed: git log --diff-filter=D --
// 02e_InputSetup.js, then git show <hash>~1:02e_InputSetup.js.
// =============================================================================


// ===========================================================================
// setupInputBess  (Increment 4b-2.5c)
// ===========================================================================
// Rewires INPUT_BESS!C6 (BATTERY_ID) data-validation dropdown to read
// dynamically from 16M_PRODUCTS_BESS!A2:A. The dropdown was hand-authored
// with a stale allowlist (CATL_3MWH, BYD_2MWH, HUAWEI_2MWH, TESLA_3_9MWH,
// LOCAL_INTEGRATOR) that does not match the live DB. A user cannot today
// select any real catalog battery -- Phase 14 CASE 3 surfaced this.
//
// Pointing the validation at the DB's Battery_ID column means:
//   - The dropdown always lists exactly the products in the live DB
//   - Adding/removing a product in 16M_PRODUCTS_BESS auto-updates C6
//   - Stale entries (CATL_3MWH etc.) are removed cleanly
//
// Idempotent: safe to run repeatedly. Touches ONLY C6's validation, leaves
// the cell's current value alone (which may be a now-invalid stale ID --
// the user picks the right one from the new dropdown).
//
// To run from the Apps Script IDE: select setupInputBess, click Run.
function setupInputBess() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shBess = ss.getSheetByName(SH.INPUT_BESS);
  if (!shBess) {
    throw new Error('setupInputBess: INPUT_BESS sheet not found.');
  }
  var shDb = ss.getSheetByName(SH.BESS_MIRROR);
  if (!shDb) {
    throw new Error('setupInputBess: ' + SH.BESS_MIRROR + ' tab not found '
      + '-- cannot build dropdown from DB.');
  }

  // BDF-6: delegate to refreshBessPicker which builds a UNION dropdown
  // (catalog + recommendation labels) via a hidden helper sheet. The old
  // catalog-only requireValueInRange path is preserved as a fallback when
  // the picker module isn't deployed.
  if (typeof refreshBessPicker === 'function') {
    refreshBessPicker(ss);
    SpreadsheetApp.flush();
    return;
  }

  // Fallback: old catalog-only dropdown
  var dbIdRange = shDb.getRange('A2:A');
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(dbIdRange, true)
    .setAllowInvalid(false)
    .setHelpText('Seleccione un Battery_ID de ' + SH.BESS_MIRROR + '!A:A')
    .build();
  shBess.getRange(6, 3).setDataValidation(rule);
  SpreadsheetApp.flush();
}


// ---------------------------------------------------------------------------
// refreshBessStrategyDropdown  (4.0.0)
// ---------------------------------------------------------------------------
// Re-applies the BESS_STRATEGY (INPUT_BESS!C7) data-validation dropdown from
// the current INPUT_MAP.bessStrategy.dropdown list.
//
// WHY THIS EXISTS:
//   Data-validation rules are baked into the sheet when a tab is first built.
//   Adding a new option to INPUT_MAP.bessStrategy.dropdown (e.g. LOAD_SHIFTING
//   in 4.0.0) does NOT retroactively update a dropdown that already exists on
//   C7 -- the cell keeps the old 2-item list until something re-applies it.
//   This function does exactly that, reusing the same _applyTypeValidation
//   path the tab renderer uses, so the dropdown always matches the map.
//
//   It also clears any stale help-text tooltip on C7 (the pre-4.0.0 tooltip
//   mentioned only SELF_CONSUMPTION_MAX / PEAK_SHAVING / HYBRID).
//
// IDEMPOTENT. Safe to run any time. The current C7 value is preserved; if the
// old value is still valid the cell is unchanged, and selecting LOAD_SHIFTING
// becomes possible immediately after running this.
//
// To run from the Apps Script IDE: select refreshBessStrategyDropdown, Run.
// From the workbook: ARGIA menu -> Setup -> "Refresh BESS Strategy Dropdown".
function refreshBessStrategyDropdown() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shBess = ss.getSheetByName(SH.INPUT_BESS);
  if (!shBess) {
    throw new Error('refreshBessStrategyDropdown: INPUT_BESS sheet not found.');
  }
  if (typeof INPUT_MAP === 'undefined' || !INPUT_MAP.bessStrategy) {
    throw new Error('refreshBessStrategyDropdown: INPUT_MAP.bessStrategy missing.');
  }
  var m = INPUT_MAP.bessStrategy;           // {sheet,row,col,type:'dropdown',dropdown:[...]}
  var cell = shBess.getRange(m.row, m.col);  // C7
  cell.clearDataValidations();               // drop stale rule + tooltip
  _applyTypeValidation(cell, m);             // re-apply from current INPUT_MAP
  SpreadsheetApp.flush();
  return 'BESS strategy dropdown refreshed: ' + m.dropdown.join(' / ');
}


// ===========================================================================
// setupInputBessStyling  (BDF-9)
// ===========================================================================
// Lipstick pass for INPUT_BESS §1-§4 (rows 1-34). This sheet was hand-built
// in an early era and doesn't share the polished look of INPUT_PROJECT /
// INPUT_INSTALL. BDF-9 applies the same design-tokens layer without touching
// values, formulas, or dropdowns.
//
// What this function DOES:
//   - Apply page canvas (hidden gridlines, column widths)
//   - Insert logo (top-left) + proper title in row 2
//   - Apply token fonts/colors/dividers to existing label cells (col B)
//   - Apply BG_INPUT_CELL background to existing value cells (col C)
//   - Clear E6 / E7 "Provider:" / "Model:" leftover labels
//
// What this function DOES NOT DO:
//   - Delete or recreate the sheet
//   - Touch values in C6 (battery id), C10..C14 (XLOOKUP formula cells),
//     C20 (CAPEX MXN), or any other data cell
//   - Modify dropdowns / data validations
//   - Touch §5 (economics, BDF-3) or §6 (install, BDF-7) — those have
//     their own styling functions
//
// Idempotent. Safe to re-run after value edits.
function setupInputBessStyling() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('INPUT_BESS');
  if (!sh) {
    throw new Error('setupInputBessStyling: INPUT_BESS sheet not found.');
  }

  // Tokens (or fallbacks)
  var hasTokens = (typeof loadDesignTokens === 'function'
                && typeof token === 'function'
                && typeof tokenNum === 'function');
  if (hasTokens) {
    try {
      resetDesignTokenCache_();
      loadDesignTokens(ss);
    } catch (e) {
      hasTokens = false;
    }
  }
  var FF = hasTokens ? token('FONT_FAMILY')       : 'Inter';
  var FS = hasTokens ? tokenNum('FONT_SIZE_BODY') : 10;
  var FS_TITLE   = hasTokens ? tokenNum('FONT_SIZE_TITLE')   : 22;
  var FS_SECTION = hasTokens ? tokenNum('FONT_SIZE_SECTION') : 10;
  var TXT_PRIMARY    = hasTokens ? token('TEXT_PRIMARY')   : '#111111';
  var TXT_SECONDARY  = hasTokens ? token('TEXT_SECONDARY') : '#767676';
  var BG_INPUT_CELL  = hasTokens ? token('BG_INPUT_CELL')  : '#FDFBF6';
  var DIVIDER_LINE   = hasTokens ? token('DIVIDER_LINE')   : '#E5E3DC';
  var ROW_H_TITLE    = hasTokens ? tokenNum('ROW_H_TITLE') : 42;
  var ROW_H_SECTION  = hasTokens ? tokenNum('ROW_H_SECTION') : 28;
  var ROW_H_BODY     = hasTokens ? tokenNum('ROW_H_BODY')  : 22;

  // ---- Canvas ----------------------------------------------------------
  sh.setHiddenGridlines(true);
  sh.setColumnWidth(1, 24);     // A: narrow margin
  sh.setColumnWidth(2, 220);    // B: labels (was way too wide per image 1)
  sh.setColumnWidth(3, 280);    // C: values (battery picker labels can be long)
  sh.setColumnWidth(4, 30);     // D: spacer
  sh.setColumnWidth(5, 140);    // E: units / hints
  sh.setColumnWidth(6, 120);    // F: extra
  sh.setColumnWidth(7, 80);     // G: status
  sh.setColumnWidth(8, 80);     // H

  // ---- Logo + title (rows 1-3) ----------------------------------------
  // The OG sheet had tiny "INPUT BESS" in A2. Replace with logo in B2-C2
  // and a big-font title in D2-F2 (same pattern as INPUT_PROJECT).
  // We DO NOT delete row 1 — it's empty space matching other sheets.
  // Row 2: logo (B-C) + title (D-F). Row 3: subtitle.
  if (typeof _insertArgiaLogo === 'function') {
    try {
      _insertArgiaLogo(sh, 2, 2);
    } catch (e) {
      // Logo insert can fail if image asset isn't available; non-blocking.
    }
  }
  // Clear the old tiny "INPUT BESS" text in row 2 (was in col B) and the
  // subtitle row 3 — we replace with proper title in cols D-F.
  // SAFE: row 2 col B is now covered by logo image; col C similarly.
  // We write title at col D so it doesn't overlap the logo.
  sh.getRange(2, 4, 1, 5).breakApart().merge()
    .setValue('INPUTS DE ALMACENAMIENTO')
    .setFontFamily(FF)
    .setFontSize(FS_TITLE)
    .setFontWeight('bold')
    .setFontColor(TXT_PRIMARY)
    .setVerticalAlignment('middle')
    .setHorizontalAlignment('left');
  sh.setRowHeight(2, ROW_H_TITLE);
  // Subtitle row 3 — small + muted (matches docTitle pattern)
  sh.getRange(3, 4, 1, 5).breakApart().merge()
    .setValue('Configuración del sistema de almacenamiento (BESS)')
    .setFontFamily(FF)
    .setFontSize(FS)
    .setFontStyle('italic')
    .setFontColor(TXT_SECONDARY)
    .setVerticalAlignment('middle')
    .setHorizontalAlignment('left');
  sh.setRowHeight(3, ROW_H_BODY);

  // Freeze the title block so it stays visible when scrolling §1-§6.
  sh.setFrozenRows(3);

  // ---- Clear E6 / E7 leftovers ----------------------------------------
  // Image 1 showed "Provider:" / "Model:" labels in col E with no values.
  // These were placeholders for an old display pattern we don't use anymore.
  // Wipe the entire E6:F7 block so it's clean.
  sh.getRange(6, 5, 2, 2).clearContent().setBackground(null);

  // ---- BDF-10: clear B18 / B19 (Voltaje DC / AC orphan labels) -------
  // The OG sheet has labels at rows 18 and 19:
  //   r18 B = "Voltaje bus DC / batería (V)"
  //   r19 B = "Voltaje sistema AC (V)"
  // These were placeholders from an early design pass; no formula or
  // dropdown ever wired them up. Voltages are now sourced from
  // INPUT_BESS §6 rows 44/45 (BDF-7) and INPUT_DESIGN, so these are
  // dead labels causing visual confusion. Clear them to leave blank
  // spacer rows between §2 specs and the §3 commercial header.
  // Also clear any input-cell background that BDF-9 may have applied.
  sh.getRange(18, 2, 2, 6).clearContent();
  sh.getRange(18, 2, 2, 6).setBackground(null);
  sh.getRange(18, 2, 2, 6).setBorder(false, false, false, false, false, false);

  // ---- BDF-10: hide column Q -----------------------------------------
  // Image 2 showed col Q with helper/scratch values (4064, 2032, 0.1,
  // 0.9, 40000000) — these drive formulas in col C but shouldn't be
  // visible to the designer. Hiding the column keeps formulas working
  // while removing the visual noise. Idempotent: hideColumns is a no-op
  // if the column is already hidden.
  try {
    sh.hideColumns(17);
  } catch (e) {
    // GAS sometimes throws if column already hidden; non-blocking.
  }

  // ---- Section header rows (map-derived, A2c) --------------------------
  // Header rows come from INPUT_MAP: each section's header sits one row
  // above its first field (minRow - 1). The old hardcoded list said 19/22
  // for §3/§4 -- wrong since the §-layout moved (§3 fields start r22, §4
  // r25). Worse, the BDF-10 clear above wipes B19 and the old list then
  // wrote the §3 header BACK into r19 -- the function fought itself and
  // manufactured the duplicate-header cruft seen on live sheets. Deriving
  // the rows from the map ends that class of drift: r19 now STAYS clear.
  var SECTION_TITLES = {
    'BESS 1 SELECCION':        '1. SELECCIÓN DE BATERÍA',
    'BESS 2 ESPECIFICACIONES': '2. ESPECIFICACIONES TÉCNICAS',
    'BESS 3 COMERCIAL':        '3. INFORMACIÓN COMERCIAL',
    'BESS 4 PEAK SHAVING':     '4. PEAK SHAVING'
  };
  var secMin = {};
  Object.keys(INPUT_MAP).forEach(function (k) {
    var m = INPUT_MAP[k];
    if (m.sheet !== 'INPUT_BESS' && m.sheet !== SH.INPUT_BESS) return;
    if (!SECTION_TITLES[m.section]) return;
    if (!(m.section in secMin) || m.row < secMin[m.section]) secMin[m.section] = m.row;
  });
  var sectionRows = Object.keys(SECTION_TITLES).map(function (s) {
    return [secMin[s] - 1, SECTION_TITLES[s]];
  });
  sectionRows.forEach(function(pair) {
    var r = pair[0];
    var labelExpected = pair[1];
    // Defensive: only restyle if existing value matches (or is empty)
    var existing = String(sh.getRange(r, 2).getValue() || '').trim();
    if (existing && existing.toUpperCase().indexOf(labelExpected.split('.')[0]) === -1) {
      // Row B doesn't carry the section header we expect. Skip silently.
      return;
    }
    if (!existing) {
      // Write the label if missing
      sh.getRange(r, 2).setValue(labelExpected);
    }
    sh.getRange(r, 2)
      .setFontFamily(FF)
      .setFontSize(FS_SECTION)
      .setFontWeight('bold')
      .setFontColor(TXT_PRIMARY)
      .setVerticalAlignment('middle')
      .setHorizontalAlignment('left');
    sh.setRowHeight(r, ROW_H_SECTION);
    // Bottom divider across B-G
    sh.getRange(r, 2, 1, 6).setBorder(
      null, null, true, null, null, null,
      DIVIDER_LINE, SpreadsheetApp.BorderStyle.SOLID);
  });

  // ---- §4 helper text (map-derived row, was hardcoded C22) --------------
  // The PEAK SHAVING header row carries explanatory text in col C
  // ("Solo aplica si BESS_STRATEGY = PEAK_SHAVING"). On the live sheet that
  // is the §4 header row (map minRow - 1 = C24), NOT C22 -- the old
  // hardcoded target never fired. Style it italic + muted so the designer
  // doesn't mistake it for an input.
  var s4NoteRow = secMin['BESS 4 PEAK SHAVING'] - 1;
  var s4NoteVal = String(sh.getRange(s4NoteRow, 3).getValue() || '').trim();
  if (s4NoteVal.length > 0 && s4NoteVal.indexOf('Solo aplica') >= 0) {
    sh.getRange(s4NoteRow, 3)
      .setFontFamily(FF)
      .setFontSize(FS)
      .setFontStyle('italic')
      .setFontColor(TXT_SECONDARY)
      .setBackground(null)              // remove any input-cell background
      .setVerticalAlignment('middle')
      .setHorizontalAlignment('left');
  }

  // ---- Body rows in §1-§4 ---------------------------------------------
  // Apply consistent styling to data rows. The labels (col B) and values
  // (col C) retain whatever the sheet currently holds; we just style.
  // Body rows we know about (from the openpyxl dump):
  //   6,7 (battery id, strategy)
  //   10-17 (specs)
  //   20 (capex)
  //   23-25 (peak shaving)
  //   28-30 (monthly demand table headers)
  // We apply LABEL styling to col B and INPUT-CELL styling to col C.
  var bodyRows = [6, 7, 10, 11, 12, 13, 14, 15, 16, 17, 20, 23, 24, 25];
  bodyRows.forEach(function(r) {
    // Label (col B)
    sh.getRange(r, 2)
      .setFontFamily(FF)
      .setFontSize(FS)
      .setFontColor(TXT_PRIMARY)
      .setFontWeight('normal')
      .setVerticalAlignment('middle')
      .setHorizontalAlignment('left');
    // Value cell (col C)
    sh.getRange(r, 3)
      .setFontFamily(FF)
      .setFontSize(FS)
      .setFontColor(TXT_PRIMARY)
      .setBackground(BG_INPUT_CELL)
      .setVerticalAlignment('middle');
    sh.setRowHeight(r, ROW_H_BODY);
    // Thin divider line
    sh.getRange(r, 2, 1, 6).setBorder(
      null, null, true, null, null, null,
      DIVIDER_LINE, SpreadsheetApp.BorderStyle.SOLID);
  });

  // C6 (battery picker) keeps its data validation untouched. C7 (strategy)
  // similarly. We don't recreate dropdowns here — that's setupInputBess's job.

  SpreadsheetApp.flush();
}

// ===========================================================================
// setupCfeOutput  (REMOVED 2026-05-26 by Tier 2 cutover)
// ===========================================================================
// Was a thin IDE-facing wrapper around the legacy writeCfeOutput(ss). After
// 06_WriteCfeOutput.js was deleted, this wrapper became a dangling reference.
// The v2 equivalent is runUpdateCfeOutputV2 in writers_v2/WriteCfeOutputV2.js
// -- wired to the "Update CFE_OUTPUT" menu item since Tier 1.
// ===========================================================================
// setupInputBessEconomicsRows  (BDF-3)
// ===========================================================================
// Adds the "5. ECONOMICS GUARDRAILS" section to INPUT_BESS (rows 36-41):
//   r36 B = "5. ECONOMICS GUARDRAILS"  (section header)
//   r37 B = "Mín. ahorro anual MXN:"   C37 = 2,000,000  (default threshold)
//   r38 B = "Override tarifa punta MXN/kWh:"  C38 = (blank)
//   r39 B = "Override tarifa base MXN/kWh:"   C39 = (blank)
//   r40 B = "(notes)"   C40 = explainer text
//   r41 B = (blank spacer)
//
// IDEMPOTENT BEHAVIOR
//   - Always writes labels (col B) -- they're not user-typed content.
//   - Writes the default threshold (C37 = 2000000) only when C37 is BLANK.
//     A re-run does NOT overwrite a designer-tuned value.
//   - Never writes anything to C38 / C39 (override cells) -- those stay blank
//     by design; designer types only when they want to override auto-derive.
//
// CALLED BY
//   - Manual: select this function in Apps Script IDE, click Run.
//   - Or via "Tools > Setup Input Sheets" menu (not yet wired -- TBD if
//     you decide to surface).
//
// SAFETY
//   - Refuses to run if INPUT_BESS doesn't exist.
//   - Refuses to overwrite row 36 if it already holds NON-MATCHING content
//     (suggests a different section ended up there in a custom layout).
//     Run with care and check the sheet visually after.
// ===========================================================================
function setupInputBessEconomicsRows() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('INPUT_BESS');
  if (!sh) {
    throw new Error('setupInputBessEconomicsRows: INPUT_BESS sheet not found.');
  }

  // Safety check: if row 36 already has SOMETHING in col B that isn't our
  // section header, the designer's custom layout is sitting there. Bail.
  var existingHeader = String(sh.getRange(36, 2).getValue() || '').trim();
  var expectedHeader = '5. ECONOMICS GUARDRAILS';
  if (existingHeader && existingHeader !== expectedHeader) {
    throw new Error('setupInputBessEconomicsRows: row 36 col B already holds '
      + '"' + existingHeader + '" -- not the expected economics header. '
      + 'Resolve the layout conflict manually before running this function.');
  }

  // Section header (always written; idempotent because it's the same string)
  sh.getRange(36, 2).setValue(expectedHeader).setFontWeight('bold');

  // ---- Rows 37-39: map-driven (A2c) --------------------------------------
  // Labels, seeds and formats come from _MAP_BESS §5 via INPUT_MAP -- single
  // source of truth (these strings were hand-maintained copies of the map).
  //
  // SEED GATE: only entries with an EXPLICIT `seed` property are prefilled
  // (threshold -> 2,000,000). The tariff overrides have no seed and MUST stay
  // blank -- blank means "auto-derive from INPUT_CFE"; writing their reader
  // default (0) would visually suggest a zero tariff. (This is the
  // seed/default split from A2c-0 doing its job.)
  var S5_KEYS = ['bessMinAnnualSavingMxn', 'bessPuntaRateOverride', 'bessBaseRateOverride'];
  S5_KEYS.forEach(function (key) {
    var m = INPUT_MAP[key];
    if (!m) throw new Error('setupInputBessEconomicsRows: INPUT_MAP missing "' + key + '"');
    var r = m.row;
    sh.getRange(r, 2).setValue(m.label + ':');
    if (m.hasOwnProperty('seed') && sh.getRange(r, 3).getValue() === '') {
      sh.getRange(r, 3).setValue(m.seed);
    }
    // Format by unit; applied even to designer-set values (cheap, readability)
    var fmt = (m.unit === 'MXN')     ? '"$"#,##0'
            : (m.unit === 'MXN/kWh') ? '#,##0.0000'
            : '#,##0';
    sh.getRange(r, 3).setNumberFormat(fmt);
  });

  // Notes row
  sh.getRange(40, 2).setValue('Notas:').setFontStyle('italic');
  sh.getRange(40, 3).setValue(
    'Threshold 0 = filtro deshabilitado. Override blanks → motor auto-deriva tarifas desde INPUT_CFE (12 meses facturados).'
  ).setFontStyle('italic').setWrap(true);

  SpreadsheetApp.flush();
}


// ===========================================================================
// setupInputBessInstallRows  (BDF-7, updated BDF-7.1)
// ===========================================================================
// Adds §6 "Distancias y ubicación física" to INPUT_BESS at rows 42-53.
// These inputs feed:
//   - calcBessBosQuantities (cable meters, conduit meters)
//   - calcBessVoltageDrop   (voltage drop %)
//   - calcBessNomChecks     (GEC sizing per length)
//
// BDF-7.1 NOTE: row 43 (coupling) was removed. Coupling now comes
// exclusively from INPUT_DESIGN!C17 via bessResult, eliminating the
// duplicate-source bug. This function defensively clears any stale
// value in row 43 from earlier BDF-7 R1 setups.
//
// Idempotent: safe to call multiple times. Refuses to overwrite row 42 if
// it already contains non-matching content (suggests custom layout).
//
// LAYOUT (rows 42-53):
//   42: § header
//   43: (deprecated — see BDF-7.1 note above)
//   44-53: map-driven from _MAP_BESS_S6 via INPUT_MAP (labels, seeds, units,
//          dropdowns -- see the S6_KEYS loop below; 2026-06-10 refactor).
//          Note: bessDcBusV deliberately has NO seed -- blank/0 means the
//          battery DB nominal wins (see REG_BESS_VOLTAGE_UNIFY_C44).
function setupInputBessInstallRows() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('INPUT_BESS');
  if (!sh) {
    throw new Error('setupInputBessInstallRows: INPUT_BESS sheet not found.');
  }

  // BDF-8: load design tokens for consistent visual styling. Falls back to
  // raw fontFamily writes if the token system isn't deployed (shouldn't
  // happen in production but keeps unit tests / partial-deployment cases
  // from throwing).
  var hasTokens = (typeof loadDesignTokens === 'function'
                && typeof token === 'function'
                && typeof tokenNum === 'function');
  if (hasTokens) {
    try {
      resetDesignTokenCache_();
      loadDesignTokens(ss);
    } catch (e) {
      hasTokens = false;
    }
  }
  // Token shortcuts (resolved to safe defaults when tokens unavailable)
  var FF = hasTokens ? token('FONT_FAMILY')       : 'Inter';
  var FS = hasTokens ? tokenNum('FONT_SIZE_BODY') : 10;
  var TXT_PRIMARY    = hasTokens ? token('TEXT_PRIMARY')   : '#111111';
  var TXT_SECONDARY  = hasTokens ? token('TEXT_SECONDARY') : '#767676';
  var TXT_MUTED      = hasTokens ? token('TEXT_MUTED')     : '#B0B0B0';
  var BG_INPUT_CELL  = hasTokens ? token('BG_INPUT_CELL')  : '#FDFBF6';
  var DIVIDER_LINE   = hasTokens ? token('DIVIDER_LINE')   : '#E5E3DC';
  var ROW_H_BODY     = hasTokens ? tokenNum('ROW_H_BODY')  : 22;
  var ROW_H_SECTION  = hasTokens ? tokenNum('ROW_H_SECTION') : 28;

  // Safety check
  var existingHeader = String(sh.getRange(42, 2).getValue() || '').trim();
  var expectedHeader = '6. DISTANCIAS Y UBICACIÓN FÍSICA';
  if (existingHeader && existingHeader !== expectedHeader
      // BDF-8: also tolerate the old plain header if a partial setup ran
      && existingHeader !== '6. DISTANCIAS Y UBICACION FISICA') {
    throw new Error('setupInputBessInstallRows: row 42 col B already holds '
      + '"' + existingHeader + '" -- not the expected install header. '
      + 'Resolve layout conflict manually before running this function.');
  }

  // ---- Helper: style a label cell (col B) -------------------------------
  function styleLabel(row) {
    sh.getRange(row, 2)
      .setFontFamily(FF)
      .setFontSize(FS)
      .setFontColor(TXT_PRIMARY)
      .setFontWeight('normal')
      .setFontStyle('normal')
      .setVerticalAlignment('middle')
      .setHorizontalAlignment('left');
    sh.setRowHeight(row, ROW_H_BODY);
    // Subtle bottom divider line, matching primBodyRow's convention.
    sh.getRange(row, 2, 1, 6).setBorder(
      null, null, true, null, null, null,
      DIVIDER_LINE, SpreadsheetApp.BorderStyle.SOLID);
  }
  // ---- Helper: style a value cell (col C) -------------------------------
  function styleValue(row, opts) {
    opts = opts || {};
    var rng = sh.getRange(row, 3)
      .setFontFamily(FF)
      .setFontSize(FS)
      .setFontColor(TXT_PRIMARY)
      .setBackground(BG_INPUT_CELL)
      .setVerticalAlignment('middle')
      .setHorizontalAlignment('right');
    if (opts.numberFormat) rng.setNumberFormat(opts.numberFormat);
  }
  // ---- Helper: style a unit hint cell (col E) ---------------------------
  function styleUnit(row, hint) {
    if (hint == null || hint === '') return;
    sh.getRange(row, 5).setValue(hint)
      .setFontFamily(FF)
      .setFontSize(FS)
      .setFontColor(TXT_SECONDARY)
      .setFontStyle('italic')
      .setVerticalAlignment('middle')
      .setHorizontalAlignment('left');
  }

  // ---- Section header row 42 -------------------------------------------
  // Matches the BDF-1..BDF-3 §1-§5 visual rhythm in INPUT_BESS: bold dark
  // text on col B, thin bottom border across cols B-G.
  sh.getRange(42, 2).setValue(expectedHeader)
    .setFontFamily(FF)
    .setFontSize(hasTokens ? tokenNum('FONT_SIZE_SECTION') : 10)
    .setFontWeight(hasTokens ? token('FONT_WEIGHT_EMPHASIS') : 'bold')
    .setFontColor(TXT_PRIMARY)
    .setVerticalAlignment('middle')
    .setHorizontalAlignment('left');
  sh.setRowHeight(42, ROW_H_SECTION);
  sh.getRange(42, 2, 1, 6).setBorder(
    null, null, true, null, null, null,
    DIVIDER_LINE, SpreadsheetApp.BorderStyle.SOLID);

  // ---- Row 43: REMOVED in BDF-7.1 (coupling moved to INPUT_DESIGN!C17) -
  // We keep the row visually unobtrusive: muted italic label, cleared value.
  sh.getRange(43, 2).setValue('(Acoplamiento ahora desde INPUT_DESIGN!C17)')
    .setFontFamily(FF)
    .setFontSize(FS)
    .setFontStyle('italic')
    .setFontColor(TXT_MUTED)
    .setVerticalAlignment('middle');
  sh.getRange(43, 3).clearContent().clearDataValidations()
    .setBackground(null)
    .setNote('BDF-7.1: coupling moved to INPUT_DESIGN!C17 (single source of truth). '
           + 'Any value entered here is ignored by the engine.');
  sh.setRowHeight(43, ROW_H_BODY);

  // ---- Rows 44-53: map-driven (A2c) --------------------------------------
  // Labels, seeds, units, dropdown lists and helpText all come from
  // _MAP_BESS_S6 via INPUT_MAP -- single source of truth. Before this
  // refactor every string here was a hand-maintained copy of the map (and
  // they had already drifted: the hardcoded C44 seed was the stray 800
  // placeholder behind the voltage-drift bug, and the cable-path seed
  // disagreed with the map's value-audited seed).
  //
  // Write semantics preserved exactly: seed only fires when the cell is
  // EMPTY (non-destructive overlay -- user values are never overwritten),
  // numbers format '#,##0' (MXN gets '"$"#,##0'), dropdowns strict
  // (setAllowInvalid(false)), unit hints in col E.
  var S6_KEYS = [
    'bessDcBusV', 'bessAcV', 'bessDcRunM', 'bessAcRunM', 'bessCablePath',
    'bessS6BatteriesPerContainer', 'bessLocation', 'bessGroundingSystem',
    'bessGecRunM', 'bessCommissioningMxn'
  ];
  S6_KEYS.forEach(function (key) {
    var m = INPUT_MAP[key];
    if (!m) throw new Error('setupInputBessInstallRows: INPUT_MAP missing "' + key + '"');
    var r = m.row;

    // Label (col B) -- map label + ':' suffix, matching the tab's visual style
    sh.getRange(r, 2).setValue(m.label + ':');

    // Dropdown validation from the map list (strict, with map helpText)
    if (m.type === 'dropdown' && m.dropdown) {
      var ruleB = SpreadsheetApp.newDataValidation()
        .requireValueInList(m.dropdown, true)
        .setAllowInvalid(false);
      if (m.helpText && ruleB.setHelpText) ruleB = ruleB.setHelpText(m.helpText);
      sh.getRange(r, 3).setDataValidation(ruleB.build());
    }

    // Seed only when empty (never clobber a user value)
    var seed = _seedValueFor(m);
    if (seed !== '' && sh.getRange(r, 3).getValue() === '') {
      sh.getRange(r, 3).setValue(seed);
    }

    styleLabel(r);
    if (m.type === 'dropdown') {
      styleValue(r, {});
    } else {
      styleValue(r, { numberFormat: (m.unit === 'MXN') ? '"$"#,##0' : '#,##0' });
    }
    styleUnit(r, m.unit || '');
  });

  // ---- Notes row 55 -----------------------------------------------------
  // Italic muted helper text spanning C-G. Sized larger to fit wrap.
  sh.getRange(55, 2).setValue('Notas:')
    .setFontFamily(FF).setFontSize(FS).setFontStyle('italic')
    .setFontColor(TXT_SECONDARY)
    .setVerticalAlignment('top');
  sh.getRange(55, 3, 1, 5).breakApart().merge()
    .setValue('Distancias = trayectoria del cable (no línea recta). '
            + 'Distancia tablero ↔ CFE solo aplica para AC_COUPLED. '
            + 'Commissioning = puesta en servicio (lote, MXN).')
    .setFontFamily(FF).setFontSize(FS).setFontStyle('italic')
    .setFontColor(TXT_SECONDARY)
    .setVerticalAlignment('top')
    .setWrap(true);
  sh.setRowHeight(55, ROW_H_BODY * 2);

  SpreadsheetApp.flush();
}
