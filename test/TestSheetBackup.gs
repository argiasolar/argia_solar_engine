// =============================================================================
// ARGIA TEST FRAMEWORK -- test/TestSheetBackup.gs
// -----------------------------------------------------------------------------
// PASS 15 ADDITION: Full-sheet backup/restore + fixture-driven input writer.
//
// SCOPE
//   Three functions for end-to-end Tier 3 integration tests that need to
//   write TESTPROJ-001 inputs across multiple INPUT sheets, run the engine,
//   then restore the original sheet state:
//
//     backupAllInputSheets(ss)    -- duplicate each INPUT_* tab via copyTo
//                                    (preserves FORMULAS, formats, validation,
//                                     merged cells) and hide the copies
//     restoreAllInputSheets(ss)   -- restore from the hidden duplicates and
//                                    delete the backup sheets
//     writeTestprojInputs(ss)     -- write TESTPROJ_001.inputs (project/
//                                    install/design via writeInput logical
//                                    keys; legacy general via direct A1)
//
// USED BY
//   Future Tier 3 / 3.5 / 3.6 integration migrations. Per-cell backup via
//   backupInputCells (TestData.gs) doesn't scale to writing 50+ cells across
//   4 input sheets.
//
// COEXISTENCE WITH LEGACY
//   The legacy 99_TestRunner.gs has functionally-equivalent helpers under
//   different names. New framework uses DIFFERENT NAMES to coexist:
//     Legacy: TEST_BACKUP_NAMES   New: TEST_INPUT_BACKUP_NAMES
//     Legacy: backupInputs        New: backupAllInputSheets
//     Legacy: restoreInputs       New: restoreAllInputSheets
//     Legacy: writeTestInputs     New: writeTestprojInputs
//   Both can coexist until the legacy deletion pass.
//
// WHY copyTo, NOT getValues/setValues
//   An earlier legacy version used getValues()/setValues() for backup, which
//   silently replaced VLOOKUP formulas with their evaluated values on
//   restore. copyTo preserves formulas, formats, data validation, and merged
//   cells. This is the correct backup strategy for INPUT sheets that contain
//   computed cells (e.g. CFE rate lookups).
//
// WHAT'S NOT INCLUDED
//   INPUT_CFE backup is HANDLED NARROWLY by individual tests rather than
//   here. Per the legacy comment: INPUT_CFE has array formulas in rows
//   21-29 (Capacidad, Distribucion, Transmision, CENACE, Energia B/I/P,
//   SCnMEM, Suministro) that do NOT survive clearContents + copyTo cleanly.
//   Tests that need INPUT_CFE state should snapshot just the rows they
//   write (4-17 typically), not the whole sheet.
//
//   INPUT_GENERAL is included for back-compat with legacy projects that
//   still have it. Missing sheets are skipped silently (if(!src)).
// =============================================================================


/**
 * Map of original-sheet-name -> backup-sheet-name. INPUT_CFE deliberately
 * excluded (see file header for why).
 */
var TEST_INPUT_BACKUP_NAMES = {
  'INPUT_PROJECT': '_TEST_BACKUP_PROJ_V2',
  'INPUT_DESIGN':  '_TEST_BACKUP_DES_V2',
  'INPUT_INSTALL': '_TEST_BACKUP_INST_V2',
  'INPUT_GENERAL': '_TEST_BACKUP_GEN_V2'
};


/**
 * Duplicate each INPUT_* tab listed in TEST_INPUT_BACKUP_NAMES as a hidden
 * sheet, using Sheet.copyTo so formulas/formats/validation/merged cells
 * are all preserved. Idempotent: deletes any stale backup from a prior
 * interrupted run before creating fresh duplicates.
 *
 * Missing INPUT sheets are skipped silently (e.g. INPUT_GENERAL on newer
 * projects).
 *
 * @param {Spreadsheet} ss
 */
function backupAllInputSheets(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();

  // 1. Delete any stale backup sheets from a previous interrupted run
  Object.keys(TEST_INPUT_BACKUP_NAMES).forEach(function (original) {
    var backupName = TEST_INPUT_BACKUP_NAMES[original];
    var existing = ss.getSheetByName(backupName);
    if (existing) ss.deleteSheet(existing);
  });

  // 2. Create a fresh duplicate of each input sheet
  Object.keys(TEST_INPUT_BACKUP_NAMES).forEach(function (original) {
    var src = ss.getSheetByName(original);
    if (!src) return;  // missing sheet OK (e.g. INPUT_GENERAL retired)
    var copy = src.copyTo(ss);
    copy.setName(TEST_INPUT_BACKUP_NAMES[original]);
    copy.hideSheet();
  });
}


/**
 * Restore each original INPUT_* tab from its backup using Range.copyTo
 * (preserves formulas), then delete the backup sheets.
 *
 * Missing backups are skipped silently (e.g. if backupAllInputSheets
 * was never called or the original sheet was absent).
 *
 * @param {Spreadsheet} ss
 */
function restoreAllInputSheets(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();

  Object.keys(TEST_INPUT_BACKUP_NAMES).forEach(function (original) {
    var backupName = TEST_INPUT_BACKUP_NAMES[original];
    var backup = ss.getSheetByName(backupName);
    var dest   = ss.getSheetByName(original);
    if (!backup || !dest) return;

    // Clear the destination, then copy from backup
    dest.clearContents();
    var srcRange = backup.getDataRange();
    srcRange.copyTo(dest.getRange(srcRange.getRow(), srcRange.getColumn()));

    // Remove the backup sheet
    ss.deleteSheet(backup);
  });
}


/**
 * Write TESTPROJ_001 inputs across INPUT_PROJECT / INPUT_INSTALL /
 * INPUT_DESIGN (via writeInput logical keys) and INPUT_GENERAL (legacy
 * direct-A1 cells, kept for ProjectCard / RFQ writers not yet migrated).
 *
 * Cells with data validation that rejects the value (typically labels,
 * names, metadata) are collected into a `skipped` array and returned --
 * callers can log them as INFO without aborting. Numeric and structural
 * cells that affect engine math should never reject; if they do, it's
 * a real bug surfacing.
 *
 * @param {Spreadsheet} ss
 * @returns {Array<string>} list of skipped-cell descriptions (may be empty)
 */
function writeTestprojInputs(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var gen = ss.getSheetByName('INPUT_GENERAL');
  var inputs = TESTPROJ_001.inputs;
  var skipped = [];

  // Ensure the three migrated input tabs exist before writing
  try { ensureInputProjectExists(ss); }
  catch (e) {
    skipped.push('ensureInputProjectExists: '
                 + String(e.message || e).slice(0, 80));
  }
  try { ensureInputInstallExists(ss); }
  catch (e) {
    skipped.push('ensureInputInstallExists: '
                 + String(e.message || e).slice(0, 80));
  }
  try { ensureInputDesignExists(ss); }
  catch (e) {
    skipped.push('ensureInputDesignExists: '
                 + String(e.message || e).slice(0, 80));
  }

  // INPUT_PROJECT writes via logical keys
  if (inputs.project) {
    Object.keys(inputs.project).forEach(function (key) {
      try {
        writeInput(ss, key, inputs.project[key]);
      } catch (e) {
        skipped.push('INPUT_PROJECT:' + key + ': '
                     + String(e.message || e).slice(0, 80));
      }
    });
  }

  // INPUT_INSTALL writes via logical keys
  if (inputs.install) {
    Object.keys(inputs.install).forEach(function (key) {
      try {
        writeInput(ss, key, inputs.install[key]);
      } catch (e) {
        skipped.push('INPUT_INSTALL:' + key + ': '
                     + String(e.message || e).slice(0, 80));
      }
    });
  }

  // INPUT_DESIGN writes via logical keys (NEW design dict; legacy A1 refs removed)
  if (inputs.design) {
    Object.keys(inputs.design).forEach(function (key) {
      try {
        writeInput(ss, key, inputs.design[key]);
      } catch (e) {
        skipped.push('INPUT_DESIGN:' + key + ': '
                     + String(e.message || e).slice(0, 80));
      }
    });
  }

  // Legacy INPUT_GENERAL writes (kept for ProjectCard / RFQ writers).
  // If INPUT_GENERAL has been retired on this sheet, skip silently.
  if (gen && inputs.general) {
    Object.keys(inputs.general).forEach(function (cell) {
      try {
        gen.getRange(cell).setValue(inputs.general[cell]);
      } catch (e) {
        skipped.push('INPUT_GENERAL!' + cell + ': '
                     + String(e.message || e).slice(0, 80));
      }
    });
  } else if (!gen) {
    skipped.push('INPUT_GENERAL: sheet retired on this project '
                 + '-- legacy writes skipped (v2.0.2+)');
  }

  return skipped;
}
