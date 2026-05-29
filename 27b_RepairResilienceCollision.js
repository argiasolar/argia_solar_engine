// =============================================================================
// ARGIA -- 27b_RepairResilienceCollision.js
// -----------------------------------------------------------------------------
// CHUNK 7 Session 2 -- ONE-SHOT repair for the resilience-section collision.
//
// The first version of setupInputBessResilienceSection wrote the resilience
// labels into rows 41-46 + a merged disclaimer at row 47, which COLLIDED with
// the pre-existing "6. DISTANCIAS Y UBICACIÓN FÍSICA" section that already
// occupied rows 42-53. The numeric VALUES in column C (voltages, distances)
// survived; only the column-B LABELS (rows 41-47) were overwritten, and row
// 47's label was buried under a merged note.
//
// This repair restores the original B-column labels and clears the stray
// merged note, so the DISTANCIAS section reads correctly again. The
// resilience section has been relocated to rows 57-62 (empty zone) in the
// corrected setup. Run this ONCE on any workbook where the bad setup ran.
//
// Idempotent-ish: it simply re-writes the known-correct labels; safe to run
// more than once. It does NOT touch column C (the values were never lost).
// =============================================================================

function repairResilienceCollision(ss) {
  ss = ss || SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('INPUT_BESS');
  if (!sh) throw new Error('repairResilienceCollision: INPUT_BESS not found');

  // Restore the original "6. DISTANCIAS" labels (column B).
  var labels = {
    42: '6. DISTANCIAS Y UBICACIÓN FÍSICA',
    43: '(Acoplamiento ahora desde INPUT_DESIGN!C17)',
    44: 'Voltaje bus DC:',
    45: 'Voltaje AC sistema:',
    46: 'Distancia batería \u2194 tablero:',
    47: 'Distancia tablero \u2194 interconexión CFE:'
  };

  // Row 47 may be a merged cell from the bad disclaimer note -> unmerge first.
  try {
    var r47 = sh.getRange(47, 2, 1, 5);
    if (r47.isPartOfMerge && r47.isPartOfMerge()) r47.breakApart();
  } catch (e) { /* breakApart on non-merged range is harmless */ }

  // Clear any stray styling/value the note left across B47:F47, then restore.
  sh.getRange(47, 2, 1, 5)
    .setBackground(null).setFontColor(null).setFontStyle('normal').setWrap(false);

  var restored = [];
  for (var row in labels) {
    if (labels.hasOwnProperty(row)) {
      sh.getRange(Number(row), 2).setValue(labels[row]);
      restored.push('B' + row);
    }
  }

  // Row 41 was blank originally (section gap) -- clear if the bad setup wrote
  // a header there.
  sh.getRange(41, 2).setValue('');

  // Clear B48 label only if it was overwritten (it shouldn't have been, but be
  // safe): the original B48 is 'Trayectoria del cable:'. We do NOT touch it
  // unless it's empty, to avoid clobbering good data.

  SpreadsheetApp.flush && SpreadsheetApp.flush();
  return { restored: restored, note: 'DISTANCIAS labels B42-B47 restored; row 47 note cleared.' };
}

function runRepairResilienceCollision() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  try {
    var ret = repairResilienceCollision(ss);
    ui.alert('Repair: resilience collision',
      'Restored the original "6. DISTANCIAS" labels that the first resilience '
      + 'setup overwrote.\n\nRestored: ' + ret.restored.join(', ')
      + '\n\nThe column-C values (voltages, distances) were never lost. '
      + 'The resilience section now lives at rows 57-62 -- run '
      + '"Setup RESILIENCE Section" again to place it there.',
      ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Repair error', e.message, ui.ButtonSet.OK);
  }
}
