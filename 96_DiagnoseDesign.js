// =============================================================================
// ARGIA ENGINE v7 -- File: 96_DiagnoseDesign.gs
// One-off diagnostic. Run diagnoseDesignReads() from the IDE, check Logger
// output. Shows what each DESIGN field looks like from three perspectives:
//
//   1. new coord (where writeInput writes / readInput reads)
//   2. legacy coord (where legacy fixture writes to col M)
//   3. what readInput() actually returns
//
// Purpose: identify which fields have coordinate or write/read mismatches
// after the DESIGN data-flow migration. Paste the Logger output to Claude
// so a targeted fix can be written instead of speculating.
//
// SAFE: read-only. Does not modify any sheet or cell.
// =============================================================================

function diagnoseDesignReads() {
  var ss = SpreadsheetApp.getActive();
  // Suspect fields — the ones whose test assertions moved
  var keys = [
    'minTemp', 'maxTemp', 'avgTemp',
    'distInverter', 'distAcProt', 'distGrid', 'feederExtraM',
    'acSpareFactor', 'dcSpareFactor', 'powerFactor',
    'dcVdropLimit', 'acVdropLimit', 'tempCoeffVocOverride',
    'areaRequired', 'availableSpace', 'aspectRatio',
    'rowPitch', 'projectType',
    'supplyTransformer',
  ];

  var lines = [];
  lines.push('DIAGNOSTIC: DESIGN field reads');
  lines.push('=' .repeat(90));
  lines.push('key                   | new coord     | new cell val      | legacy addr     | legacy cell val  | readInput returns');
  lines.push('-' .repeat(130));

  keys.forEach(function(k) {
    var m = INPUT_MAP[k];
    if (!m) { lines.push(k + ' -- NOT IN MAP'); return; }

    var sh = ss.getSheetByName(m.sheet);
    if (!sh) { lines.push(k + ' -- sheet "' + m.sheet + '" not found'); return; }

    var newCoord   = m.sheet + '!' + _ioColLetter(m.col) + m.row;
    var newValue;
    try { newValue = sh.getRange(m.row, m.col).getValue(); }
    catch (e) { newValue = 'ERR:' + e.message; }

    var legacyCoord = m.legacyAddr || '(none)';
    var legacyValue = '';
    if (m.legacyAddr) {
      try {
        var parts = m.legacyAddr.split('!');
        var legSh = ss.getSheetByName(parts[0]);
        if (legSh) legacyValue = legSh.getRange(parts[1]).getValue();
        else legacyValue = '(sheet not found)';
      } catch (e) { legacyValue = 'ERR:' + e.message; }
    }

    var readResult;
    try { readResult = readInput(ss, k); }
    catch (e) { readResult = 'ERR:' + e.message; }

    lines.push(
      k.padEnd(21) + ' | ' +
      newCoord.padEnd(13) + ' | ' +
      String(JSON.stringify(newValue)).padEnd(17) + ' | ' +
      legacyCoord.padEnd(15) + ' | ' +
      String(JSON.stringify(legacyValue)).padEnd(16) + ' | ' +
      JSON.stringify(readResult)
    );
  });

  var output = lines.join('\n');
  Logger.log(output);
  // Also show via UI so you can copy from the dialog if Logger is awkward
  try {
    SpreadsheetApp.getUi().alert('Diagnostic output', output, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    // Running headless — Logger output is enough
  }
}
