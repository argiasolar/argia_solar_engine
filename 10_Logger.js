// =============================================================================
// ARGIA ENGINE v7 -- File: 10_Logger.gs
// Structured logging to LOGS sheet.
// All engine modules call engineLog() -- never Logger.log() alone.
//
// LOGS sheet columns:
//   A: Timestamp  B: Module  C: Status  D: Message
// =============================================================================

var LOG_SHEET_NAME = 'LOGS';
var _logSheet = null;  // cached reference per execution

function getLogSheet(ss) {
  if (_logSheet) return _logSheet;
  _logSheet = ss.getSheetByName(LOG_SHEET_NAME);
  if (!_logSheet) {
    _logSheet = ss.insertSheet(LOG_SHEET_NAME);
    // Write headers
    _logSheet.getRange(1, 1, 1, 4)
      .setValues([['TIMESTAMP', 'MODULE', 'STATUS', 'MESSAGE']])
      .setFontWeight('bold')
      .setBackground('#263238')
      .setFontColor('#ffffff');
    _logSheet.setColumnWidth(1, 160);
    _logSheet.setColumnWidth(2, 110);
    _logSheet.setColumnWidth(3, 80);
    _logSheet.setColumnWidth(4, 600);
    _logSheet.setFrozenRows(1);
  }
  return _logSheet;
}

// Status values: 'OK' | 'WARNING' | 'MAJOR' | 'CRITICAL' | 'ERROR' | 'INFO' | 'START' | 'END'
function engineLog(ss, module, status, message) {
  try {
    var sh   = getLogSheet(ss);
    var ts   = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    var row  = [ts, module, status, message];
    sh.appendRow(row);

    // Apply colour coding to status cell
    var lastRow = sh.getLastRow();
    var statusCell = sh.getRange(lastRow, 3);
    var bg = '#e8f5e9'; // OK = green
    if (status === 'WARNING' || status === 'MAJOR') bg = '#fff9c4';  // yellow
    if (status === 'CRITICAL' || status === 'ERROR') bg = '#ffcdd2'; // red
    if (status === 'START' || status === 'END') bg = '#e3f2fd';      // blue
    if (status === 'INFO') bg = '#f5f5f5';                           // grey
    statusCell.setBackground(bg);
  } catch(e) {
    // Logger.log as fallback -- never let logging crash the engine
    Logger.log('[' + module + '][' + status + '] ' + message);
  }
}

// Call at start of runArgiaEngine() to mark a new run
function logRunStart(ss) {
  _logSheet = null; // reset cache so sheet is re-fetched
  var ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  engineLog(ss, 'Engine', 'START', '=== NEW RUN: ' + ts + ' ===');
}

// Call at end of successful run
function logRunEnd(ss, durationMs) {
  engineLog(ss, 'Engine', 'END',
    'Run complete in ' + (durationMs / 1000).toFixed(1) + 's');
}

// Clear LOGS sheet (keep header row)
function clearLogs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(LOG_SHEET_NAME);
  if (!sh) return;
  var lastRow = sh.getLastRow();
  if (lastRow > 1) sh.deleteRows(2, lastRow - 1);
  SpreadsheetApp.getUi().alert('Logs cleared.');
}
