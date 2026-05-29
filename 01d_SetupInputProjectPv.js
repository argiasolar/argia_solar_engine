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
  SECTION_HEADER:    65,   // "8.0" / "SOLAR"
  INSTALL_PV:        66,   // D66
  HAS_EXISTING_PV:   67,   // D67
  EXISTING_PV_KWP:   68,   // D68
  EXISTING_PV_KWH:   69    // D69
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
    [R.EXISTING_PV_KWH, 'PV existente (kWh/año)',   0,    null]
  ];

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i][0], label = rows[i][1], dflt = rows[i][2], dd = rows[i][3];
    // Always (re)write the label in col B -- labels are cosmetic, safe to set.
    sh.getRange(row, 2).setValue(label);

    var valueCell = sh.getRange(row, 4);   // col D
    var current = valueCell.getValue();
    var isBlank = (current === '' || current === null || current === undefined);

    if (isBlank) {
      valueCell.setValue(dflt);
      created.push(label);
    } else {
      skipped.push(label);   // designer already set it -- never overwrite
    }

    // Apply the dropdown rule (idempotent -- safe to re-apply).
    if (dd && typeof SpreadsheetApp !== 'undefined'
        && SpreadsheetApp.newDataValidation) {
      var rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(dd, true).setAllowInvalid(false).build();
      valueCell.setDataValidation(rule);
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
