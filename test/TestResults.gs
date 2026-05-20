// =============================================================================
// ARGIA TEST FRAMEWORK -- TestResults.gs
// -----------------------------------------------------------------------------
// Writes test entries into the _TEST_RESULTS_V2 sheet with the expanded
// column set the new framework needs.
//
// Why a new sheet name (_TEST_RESULTS_V2) instead of overwriting the
// legacy _TEST_RESULTS? Because during Pass 1 both runners coexist. The
// legacy 99_TestRunner keeps writing _TEST_RESULTS; the new framework
// writes _TEST_RESULTS_V2. Once migration completes (Pass 7) we drop V1.
//
// COLUMN SET
//   Run_Id, Timestamp, Engine_Version, Scenario_Id, Test_Id, Group, Module,
//   Suite, Assertion, Status, Expected, Actual, Tolerance, Source,
//   Duration_ms, Error_Stack, Note
//
// SUMMARY BLOCK (rows 1-3 above the data)
//   Row 1: ARGIA TEST RESULTS · timestamp · elapsed · engine version
//   Row 2: Total | Passed | Failed | Errors | Info | Avg duration
//   Row 3: Group breakdown: unit X/Y, integration X/Y, regression X/Y
// =============================================================================


var TEST_RESULTS_SHEET_NAME_V2 = '_TEST_RESULTS_V2';


/**
 * Write the test results to the sheet. Recreates the sheet on every run.
 *
 * @param {Array<Object>} entries  From t.flush()
 * @param {number} elapsedMs       Total runner duration
 * @param {SpreadsheetApp.Spreadsheet} ss
 */
function writeTestResultsV2(entries, elapsedMs, ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TEST_RESULTS_SHEET_NAME_V2);
  if (sh) {
    sh.clear();
  } else {
    sh = ss.insertSheet(TEST_RESULTS_SHEET_NAME_V2);
  }

  // Aggregates -------------------------------------------------------------
  var totals = { PASS: 0, FAIL: 0, INFO: 0, ERROR: 0 };
  var byGroup = {};         // 'unit' -> { PASS, FAIL, INFO, ERROR }
  var durationSum = 0;
  var durationCount = 0;
  entries.forEach(function (e) {
    var st = e.status || 'INFO';
    if (typeof totals[st] !== 'number') totals[st] = 0;
    totals[st]++;
    var g = e.group || '(none)';
    if (!byGroup[g]) byGroup[g] = { PASS:0, FAIL:0, INFO:0, ERROR:0 };
    if (typeof byGroup[g][st] !== 'number') byGroup[g][st] = 0;
    byGroup[g][st]++;
    if (typeof e.durationMs === 'number') {
      durationSum += e.durationMs;
      durationCount++;
    }
  });
  var avgDur = durationCount > 0
             ? Math.round(durationSum / durationCount)
             : 0;

  // Row 1: banner ----------------------------------------------------------
  var version = (typeof ENGINE_VERSION === 'string') ? ENGINE_VERSION : '?';
  var ts = Utilities.formatDate(new Date(),
              Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  sh.getRange(1, 1).setValue(
    'ARGIA TEST RESULTS V2 · ' + ts
    + ' · ' + (elapsedMs / 1000).toFixed(1) + 's'
    + ' · engine ' + version
  );
  sh.getRange(1, 1).setFontWeight('bold');

  // Row 2: totals ----------------------------------------------------------
  var assertions = totals.PASS + totals.FAIL;  // ERROR/INFO not counted
  sh.getRange(2, 1, 1, 6).setValues([[
    'Total assertions: ' + assertions,
    'Passed: '  + totals.PASS,
    'Failed: '  + totals.FAIL,
    'Errors: '  + totals.ERROR,
    'Info: '    + totals.INFO,
    'Avg test duration: ' + avgDur + ' ms'
  ]]);
  sh.getRange(2, 1, 1, 6).setFontWeight('bold');

  // Row 3: by-group breakdown ---------------------------------------------
  var groupLine = Object.keys(byGroup).sort().map(function (g) {
    var b = byGroup[g];
    var ok = b.PASS, total = b.PASS + b.FAIL;
    return g + ' ' + ok + '/' + total
      + (b.ERROR ? ' (' + b.ERROR + ' err)' : '');
  }).join('   ·   ');
  sh.getRange(3, 1).setValue(groupLine || '(no groups)');
  sh.getRange(3, 1).setFontStyle('italic');

  // Row 4: blank divider ---------------------------------------------------
  // Row 5: header
  // Row 6+: data
  var headerRow = 5;
  var dataStartRow = 6;

  var headers = [
    'Run_Id', 'Timestamp', 'Engine_Version', 'Scenario_Id', 'Test_Id',
    'Group', 'Module', 'Suite', 'Assertion', 'Status', 'Expected',
    'Actual', 'Tolerance', 'Source', 'Duration_ms', 'Error_Stack', 'Note'
  ];
  sh.getRange(headerRow, 1, 1, headers.length).setValues([headers]);
  sh.getRange(headerRow, 1, 1, headers.length).setFontWeight('bold');

  // Data -------------------------------------------------------------------
  if (entries.length > 0) {
    var rows = entries.map(function (e) {
      return [
        e.runId       || '',
        e.timestamp ? Utilities.formatDate(e.timestamp,
                          Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss')
                    : '',
        e.engineVer   || '',
        e.scenarioId  || '',
        e.testId      || '',
        e.group       || '',
        e.module      || '',
        e.suite       || '',
        e.assertion   || '',
        _statusLabel(e.status),
        _formatCellValue(e.expected),
        _formatCellValue(e.actual),
        e.tolerance   === '' ? '' : e.tolerance,
        e.source      || '',
        e.durationMs  === '' ? '' : e.durationMs,
        _truncStack(e.errorStack),
        e.note        || ''
      ];
    });
    sh.getRange(dataStartRow, 1, rows.length, headers.length).setValues(rows);

    // Conditional coloring: red for FAIL/ERROR rows.
    var statusCol = headers.indexOf('Status') + 1;
    for (var i = 0; i < entries.length; i++) {
      var st = entries[i].status;
      if (st === 'FAIL' || st === 'ERROR') {
        sh.getRange(dataStartRow + i, statusCol).setBackground('#fce8e6');
      } else if (st === 'PASS') {
        sh.getRange(dataStartRow + i, statusCol).setBackground('#e6f4ea');
      }
    }
  }

  // Freeze + autosize ------------------------------------------------------
  sh.setFrozenRows(headerRow);
  sh.autoResizeColumns(1, headers.length);

  return sh;
}


/** Convert internal status to a user-facing label matching the legacy format. */
function _statusLabel(s) {
  switch (s) {
    case 'PASS' : return '✓ PASS';
    case 'FAIL' : return '✗ FAIL';
    case 'ERROR': return '⚠ ERROR';
    case 'INFO' : return 'i INFO';
    default     : return String(s || '');
  }
}


/**
 * Best-effort formatting of a value for a result cell. Mirrors the legacy
 * formatValueForCell helper in 99_TestRunner.gs.
 */
function _formatCellValue(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') {
    if (!isFinite(v)) return String(v);
    if (Math.abs(v) >= 1e9) return v.toExponential(3);
    return v;
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(),
                                'yyyy-MM-dd HH:mm:ss');
  }
  return String(v);
}


/** Keep error stacks bounded so a single throw doesn't blow out a cell. */
function _truncStack(stack) {
  if (!stack) return '';
  var s = String(stack);
  return s.length > 500 ? s.substring(0, 500) + ' ...' : s;
}
