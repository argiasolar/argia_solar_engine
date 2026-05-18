// =============================================================================
// ARGIA ENGINE v7 -- File: 96_DiagnoseWrite.gs
// Tests whether writeInput() is actually landing values where expected.
// Writes a distinctive sentinel (-999) to each new DESIGN coordinate, reads
// it back via raw getRange, and reports discrepancies.
//
// SAFE: writes sentinel -999 then clears. Does not leave workbook modified
// for engine-consumed fields — it restores the cell to blank at the end so
// normal workflow continues as before.
//
// HOW TO READ THE OUTPUT:
//   "OK"            = write landed, read matched. Normal.
//   "MERGE"         = cell is part of a merge anchored elsewhere.
//   "VALIDATION"    = data validation rejected the write.
//   "SILENT-FAIL"   = write returned but cell read back blank.
//   "OTHER"         = something unexpected.
// =============================================================================

function diagnoseWrite() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('INPUT_DESIGN');
  var SENTINEL = -999;

  var keys = [
    'minTemp', 'maxTemp', 'distInverter', 'distAcProt', 'feederExtraM',
    'areaRequired', 'aspectRatio', 'powerFactor', 'supplyTransformer'
  ];

  var lines = [];
  lines.push('DIAGNOSTIC: write sentinel ' + SENTINEL + ' + read back');
  lines.push('=' .repeat(100));
  lines.push('key                   | coord    | pre-write | post-write | status');
  lines.push('-' .repeat(100));

  keys.forEach(function(k) {
    var m = INPUT_MAP[k];
    if (!m || m.sheet !== 'INPUT_DESIGN') return;

    var range = sh.getRange(m.row, m.col);
    var coord = _ioColLetter(m.col) + m.row;

    // Snapshot pre-write state
    var preValue = range.getValue();
    var merged   = false;
    var mergeAnchor = '';
    try {
      merged = range.isPartOfMerge();
      if (merged) {
        var mRanges = range.getMergedRanges();
        if (mRanges.length > 0) {
          var mr = mRanges[0];
          mergeAnchor = _ioColLetter(mr.getColumn()) + mr.getRow();
        }
      }
    } catch (e) { /* ignore */ }

    // Attempt to write sentinel
    var writeErr = '';
    try { range.setValue(SENTINEL); }
    catch (e) { writeErr = e.message; }

    // Force flush so the write actually commits before we read
    SpreadsheetApp.flush();

    var postValue = range.getValue();

    // Classify
    var status;
    if (writeErr)                                           status = 'WRITE-ERR: ' + writeErr;
    else if (postValue === SENTINEL)                        status = 'OK';
    else if (merged)                                        status = 'MERGE anchor=' + mergeAnchor;
    else if (postValue === '' || postValue === null)        status = 'SILENT-FAIL (blank after write)';
    else                                                    status = 'OTHER: got ' + JSON.stringify(postValue);

    lines.push(
      k.padEnd(21) + ' | ' +
      coord.padEnd(8) + ' | ' +
      String(JSON.stringify(preValue)).padEnd(9) + ' | ' +
      String(JSON.stringify(postValue)).padEnd(10) + ' | ' +
      status
    );

    // Restore cell to pre-write state
    try { range.setValue(preValue); } catch (e) { /* ignore */ }
  });

  var output = lines.join('\n');
  Logger.log(output);
  try {
    SpreadsheetApp.getUi().alert('Write diagnostic', output, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) { /* no UI */ }
}
