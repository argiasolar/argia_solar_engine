// =============================================================================
// ARGIA ENGINE v7 -- File: 96_DiagnoseFlow.gs
// Simulates the exact test-runner flow (backup → write → flush → read) and
// checks whether fixture values make it through to readInput.
//
// RUN: diagnoseFlow()
// SAFE: backs up sheets before modifying, restores them after.
// =============================================================================

function diagnoseFlow() {
  var ss = SpreadsheetApp.getActive();
  var lines = [];
  lines.push('DIAGNOSTIC: full flow simulation');
  lines.push('=' .repeat(90));

  // Step 1: backup
  lines.push('[1] calling backupInputs(ss)...');
  try { backupInputs(ss); lines.push('    backup done'); }
  catch (e) { lines.push('    backup FAILED: ' + e.message); return _flowReport(lines); }

  try {
    // Step 2: write one sentinel via writeInput
    lines.push('[2] writing minTemp=-1 via writeInput...');
    writeInput(ss, 'minTemp', -1);
    writeInput(ss, 'feederExtraM', 99);
    SpreadsheetApp.flush();

    // Step 3: verify via raw getRange
    var m = INPUT_MAP.minTemp;
    var directRead = ss.getSheetByName(m.sheet).getRange(m.row, m.col).getValue();
    lines.push('[3] raw getRange read of minTemp cell: ' + JSON.stringify(directRead));

    var m2 = INPUT_MAP.feederExtraM;
    var directRead2 = ss.getSheetByName(m2.sheet).getRange(m2.row, m2.col).getValue();
    lines.push('    raw getRange read of feederExtraM cell: ' + JSON.stringify(directRead2));

    // Step 4: read via readInput
    lines.push('[4] readInput(ss, "minTemp") returns: ' + JSON.stringify(readInput(ss, 'minTemp')));
    lines.push('    readInput(ss, "feederExtraM") returns: ' + JSON.stringify(readInput(ss, 'feederExtraM')));

    // Step 5: run readInputs() like the real test does
    lines.push('[5] calling readInputs(ss) -- full engine reader...');
    var inp = readInputs(ss);
    lines.push('    inp.minTemp = ' + JSON.stringify(inp.minTemp));
    lines.push('    inp.feederExtraM = ' + JSON.stringify(inp.feederExtraM));

  } finally {
    // Always restore
    lines.push('[6] restoreInputs(ss)...');
    try { restoreInputs(ss); lines.push('    restore done'); }
    catch (e) { lines.push('    restore FAILED: ' + e.message); }
  }

  return _flowReport(lines);
}

function _flowReport(lines) {
  var output = lines.join('\n');
  Logger.log(output);
  try { SpreadsheetApp.getUi().alert('Flow diagnostic', output, SpreadsheetApp.getUi().ButtonSet.OK); }
  catch (e) { /* no UI */ }
}
