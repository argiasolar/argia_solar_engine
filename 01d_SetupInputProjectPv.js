// =============================================================================
// ARGIA -- 01d_SetupInputProjectPv.js
// -----------------------------------------------------------------------------
// CHUNK 7 Session 1 -- idempotent setup for the INPUT_PROJECT "08 SOLAR"
// section (the installPv toggle + existing-PV declaration cells).
//
// Mirrors setupInputBaasSheet (Chunk 6): SAFE to run repeatedly. It only
// writes a label/default into a cell that is currently BLANK -- it never
// overwrites a value the designer has already entered. So running it on a
// sheet that already has the cells is a no-op for the values; it just
// (re)ensures the labels + dropdowns exist.
//
// Layout mirrors the battery toggle (section 07 ALMACENAMIENTO at row 62/64):
//   row 66 col C : "8.0" + "SOLAR"   (section header, cols B/C)
//   row 66 col B : "Instalar PV nuevo"        col D : YES   (dropdown YES/NO)
//   row 67 col B : "Cliente ya tiene PV"      col D : NO    (dropdown YES/NO)
//   row 68 col B : "PV existente (kWp)"       col D : 0
//   row 69 col B : "PV existente (kWh/año)"   col D : 0
//
// IMPORTANT: the cell coordinates here MUST match the input-map entries in
// 02c_InputMap.js (installPv D66, hasExistingPv D67, existingPvKwp D68,
// existingPvAnnualKwh D69). The unit test SetupInputProjectPvTests asserts
// this alignment so a future row edit can't silently desync the two.
// =============================================================================

// Single source of truth for the SOLAR-section cell coordinates. The input
// map reads the SAME rows; the test cross-checks they agree.
var INPUT_PROJECT_PV_ROWS = {
  // [4.15.4] Shifted down 2 rows (was 65-70). Section 08 SOLAR's fields now
  // start at 68 so the generic _setupOneTab header (minRow-2 = 66) clears
  // section 07's installBattery field at row 64. MUST stay in lockstep with
  // 02c_InputMap.js (installPv D68 ... existingExportKwh D72);
  // SetupInputProjectPvTests cross-checks the two agree.
  SECTION_HEADER:    66,   // "8.0" / "SOLAR"
  INSTALL_PV:        68,   // D68
  HAS_EXISTING_PV:   69,   // D69
  EXISTING_PV_KWP:   70,   // D70
  EXISTING_PV_KWH:   71,   // D71
  EXISTING_PV_EXPORT: 72   // D72  (Chunk 7 4B: export-capture gate)
};

// ---------------------------------------------------------------------------
// setupInputProjectPvSection(ss) -- ensure the SOLAR-section cells exist.
// Returns { created: [...rowsWritten], skipped: [...rowsAlreadySet] }.
// ---------------------------------------------------------------------------
function setupInputProjectPvSection(ss) {
  ss = ss || SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('INPUT_PROJECT');
  if (!sh) throw new Error('setupInputProjectPvSection: INPUT_PROJECT not found');

  var R = INPUT_PROJECT_PV_ROWS;
  var created = [], skipped = [];

  // Section header (cols B + C), mirroring "7.0 / ALMACENAMIENTO".
  if (!String(sh.getRange(R.SECTION_HEADER, 3).getValue() || '').trim()) {
    sh.getRange(R.SECTION_HEADER, 2).setValue('8.0');
    sh.getRange(R.SECTION_HEADER, 3).setValue('SOLAR').setFontWeight('bold');
    created.push('header');
  } else {
    skipped.push('header');
  }

  // Toggle / value rows: [row, label, default, dropdownOrNull]
  var rows = [
    [R.INSTALL_PV,      'Instalar PV nuevo',       'YES', ['YES', 'NO']],
    [R.HAS_EXISTING_PV, 'Cliente ya tiene PV',     'NO',  ['YES', 'NO']],
    [R.EXISTING_PV_KWP, 'PV existente (kWp)',       0,    null],
    [R.EXISTING_PV_KWH, 'PV existente (kWh/año)',   0,    null],
    [R.EXISTING_PV_EXPORT, 'PV existente: exportación (kWh/año)', 0, null]
  ];

  // Chunk 7 hardening: PRE-FLIGHT collision check. Before writing anything,
  // verify the target label cells are empty or already hold OUR labels. If a
  // row holds a DIFFERENT section's content, abort loudly instead of
  // clobbering it (the INPUT_BESS DISTANCIAS incident). guardSectionRowsEmpty
  // throws on collision by default.
  if (typeof guardSectionRowsEmpty === 'function') {
    var preflight = [];
    for (var g = 0; g < rows.length; g++) preflight.push({ row: rows[g][0], label: rows[g][1] });
    guardSectionRowsEmpty(sh, 2, preflight);
  }

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i][0], label = rows[i][1], dflt = rows[i][2], dd = rows[i][3];
    // Collision-aware label write (col B): writes only if blank or matching;
    // throws if a different label is present (guarded above, belt + braces).
    if (typeof writeSectionLabel === 'function') {
      writeSectionLabel(sh, row, 2, label);
    } else {
      sh.getRange(row, 2).setValue(label);
    }

    // Never-overwrite value (col D).
    var valueRes = (typeof writeSectionValue === 'function')
      ? writeSectionValue(sh, row, 4, dflt)
      : (function () {
          var cur = sh.getRange(row, 4).getValue();
          if (cur === '' || cur === null || cur === undefined) {
            sh.getRange(row, 4).setValue(dflt); return 'written';
          } return 'skipped';
        })();
    if (valueRes === 'written') created.push(label); else skipped.push(label);

    // Apply the dropdown rule (idempotent -- safe to re-apply).
    if (dd && typeof SpreadsheetApp !== 'undefined'
        && SpreadsheetApp.newDataValidation) {
      var rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(dd, true).setAllowInvalid(false).build();
      sh.getRange(row, 4).setDataValidation(rule);
    }
  }

  SpreadsheetApp.flush && SpreadsheetApp.flush();
  return { created: created, skipped: skipped };
}


// ---------------------------------------------------------------------------
// Menu-friendly wrapper with a confirmation toast.
// ---------------------------------------------------------------------------
function runSetupInputProjectPvSection() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  try {
    var ret = setupInputProjectPvSection(ss);
    ui.alert('SOLAR section setup',
      'INPUT_PROJECT "08 SOLAR" section ready.\n\n'
      + 'Created (were blank): ' + (ret.created.join(', ') || '(none)') + '\n'
      + 'Skipped (already set): ' + (ret.skipped.join(', ') || '(none)') + '\n\n'
      + 'installPv defaults to YES, so existing projects are unaffected. '
      + 'Set "Instalar PV nuevo" = NO for a battery-only project.',
      ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('SOLAR section setup error', e.message, ui.ButtonSet.OK);
  }
}
