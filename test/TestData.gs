// =============================================================================
// ARGIA TEST FRAMEWORK -- TestData.gs
// -----------------------------------------------------------------------------
// Two responsibilities:
//
//   1. TEST_SCENARIOS -- complete business cases as data. Each scenario is
//      a self-contained engineering contract: inputs, expected outputs,
//      expected warnings.
//
//   2. InputMap-backed accessors -- setInputValue / getInputValue address
//      cells by FIELD KEY (e.g. 'batteryId', 'projectName'), not by
//      hardcoded range strings. Tests survive sheet redesigns for free
//      because the field-key -> cell mapping lives in INPUT_MAP.
//
// SCENARIO SHAPE
//   var TEST_SCENARIOS = {
//     PV_BASIC_GDMTH: {
//       id: 'PV_BASIC_GDMTH',
//       description: 'TESTPROJ-001: 421 kWp PV-only, GDMTH, NM mode',
//       inputs: {
//         projectName: 'TESTPROJ-001',
//         clientName : 'TEST CUSTOMER S.A. de C.V.',
//         moduleCount: 720,
//         ...
//       },
//       expected: {
//         dc:  { iDesign: 22.30, conductor: '10', ocpd: 25 },
//         ac:  { mainBreaker: 800, transformer: 750 },
//         bom: { grandTotalUsd: 194492.51 },
//         warnings: []
//       }
//     }
//   }
//
// PUBLIC API
//   getScenario(id)                       -> deep-frozen scenario
//   setInputValue(fieldKey, value, ss)    -> write via INPUT_MAP
//   getInputValue(fieldKey, ss)           -> read via INPUT_MAP
//   applyScenarioInputs(scenarioId, ss)   -> write all scenario.inputs cells
//   backupInputCells(fieldKeys, ss)       -> snapshot for restore-after-test
//   restoreInputCells(snapshot, ss)       -> reverse a backup
//
// RELATIONSHIP TO test/TestProjects.gs
//   test/TestProjects.gs holds the three large fixture data objects
//   (TESTPROJ_001 / TESTPROJ_SYNTH_001 / TESTPROJ_PEAK_001) referenced
//   from many tests. This file (TestData.gs) holds framework-side
//   scenario plumbing (TEST_SCENARIOS, setInputValue, etc.) and is
//   separate from the fixture data. Both files are loaded by the same
//   Apps Script project; the globals from each are visible to all tests.
// =============================================================================


/** New-architecture scenarios. Empty during Pass 1; populated in Pass 2. */
var TEST_SCENARIOS = {};


/**
 * Look up a scenario by id. Returns a *copy* so tests can't accidentally
 * mutate the shared scenario.
 *
 * @param {string} id
 * @return {Object}  Throws if id is unknown.
 */
function getScenario(id) {
  if (!TEST_SCENARIOS.hasOwnProperty(id)) {
    throw new Error('getScenario: unknown scenario id "' + id + '"');
  }
  // Shallow copy is enough -- callers don't mutate nested fields in practice.
  // For deep safety, JSON-clone:
  return JSON.parse(JSON.stringify(TEST_SCENARIOS[id]));
}


/**
 * Resolve a field key to its INPUT_MAP entry. Throws on unknown key so
 * typos surface immediately rather than silently writing to wrong cells.
 */
function _td_resolveField(fieldKey) {
  if (typeof INPUT_MAP === 'undefined') {
    throw new Error('TestData: INPUT_MAP is not loaded -- '
                    + 'is 02c_InputMap.gs present?');
  }
  if (!INPUT_MAP.hasOwnProperty(fieldKey)) {
    throw new Error('TestData: unknown INPUT_MAP field "' + fieldKey + '"');
  }
  var entry = INPUT_MAP[fieldKey];
  if (!entry.sheet || !entry.row || !entry.col) {
    throw new Error('TestData: INPUT_MAP entry "' + fieldKey
                    + '" is missing sheet/row/col');
  }
  return entry;
}


/**
 * Write a value to the cell INPUT_MAP says owns this field.
 *
 * @param {string} fieldKey            INPUT_MAP key, e.g. 'batteryId'
 * @param {*}      value
 * @param {SpreadsheetApp.Spreadsheet} [ss]  Defaults to active.
 */
function setInputValue(fieldKey, value, ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var f  = _td_resolveField(fieldKey);
  var sh = ss.getSheetByName(f.sheet);
  if (!sh) {
    throw new Error('TestData: setInputValue could not find sheet "'
                    + f.sheet + '" (field ' + fieldKey + ')');
  }
  sh.getRange(f.row, f.col).setValue(value);
}


/**
 * Read the value at the cell INPUT_MAP says owns this field.
 *
 * @param {string} fieldKey
 * @param {SpreadsheetApp.Spreadsheet} [ss]
 * @return {*}
 */
function getInputValue(fieldKey, ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var f  = _td_resolveField(fieldKey);
  var sh = ss.getSheetByName(f.sheet);
  if (!sh) {
    throw new Error('TestData: getInputValue could not find sheet "'
                    + f.sheet + '" (field ' + fieldKey + ')');
  }
  return sh.getRange(f.row, f.col).getValue();
}


/**
 * Apply every key/value in scenario.inputs to the workbook. Returns a
 * snapshot suitable for restoreInputCells().
 *
 * @param {string} scenarioId
 * @param {SpreadsheetApp.Spreadsheet} [ss]
 * @return {Array<Object>}  snapshot rows
 */
function applyScenarioInputs(scenarioId, ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var sc = getScenario(scenarioId);
  if (!sc.inputs) {
    throw new Error('applyScenarioInputs: scenario "' + scenarioId
                    + '" has no inputs block');
  }
  var keys = Object.keys(sc.inputs);
  var snap = backupInputCells(keys, ss);
  keys.forEach(function (k) { setInputValue(k, sc.inputs[k], ss); });
  SpreadsheetApp.flush();
  return snap;
}


/**
 * Snapshot the current values of the given field keys.
 *
 * @param {Array<string>} fieldKeys
 * @param {SpreadsheetApp.Spreadsheet} [ss]
 * @return {Array<Object>}  [{fieldKey, value}, ...]
 */
function backupInputCells(fieldKeys, ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  return fieldKeys.map(function (k) {
    return { fieldKey: k, value: getInputValue(k, ss) };
  });
}


/**
 * Restore a snapshot from backupInputCells / applyScenarioInputs.
 */
function restoreInputCells(snapshot, ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  if (!snapshot || !snapshot.length) return;
  snapshot.forEach(function (row) {
    setInputValue(row.fieldKey, row.value, ss);
  });
  SpreadsheetApp.flush();
}
