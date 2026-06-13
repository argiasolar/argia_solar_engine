// =============================================================================
// ARGIA TESTS -- tests_unit/engine/InputsHashTests.gs
// -----------------------------------------------------------------------------
// BATCH 1 (B1.4 / B1.6) -- Unit tests for the staleness-guard hash core and
// the audit-coverage contract.
//
// SCOPE
//   Pure-function tests over argiaHashString / argiaHashGrids (00e_InputsHash)
//   plus the registry contract pinning AUDIT_OUTPUT_SHEETS to the stamped-
//   deliverables list. No spreadsheet needed; everything runs in the Node rig.
//
// COVERAGE
//   1. Hash is deterministic (same grids twice -> same hash)
//   2. Hash is sensitive to a value change
//   3. Hash is sensitive to a formula change
//   4. Formula precedence: formula wins over the displayed value, so a
//      recalculated VALUE under an unchanged FORMULA does NOT change the hash
//      (rate-mirror recalc must not fake "inputs changed")
//   5. Empty cells are ignored: trailing blank rows/cols don't change the hash
//   6. Cell-boundary safety: 'AB'|'C' hashes differently from 'A'|'BC'
//   7. Tab name participates: same grid under another tab name -> new hash
//   8. AUDIT CONTRACT: every stamped deliverable tab is audit-covered
//   9. ENGINE TABS CONTRACT: every engine-written tab is in the stamped set
// =============================================================================


function _ihtGrid(name, cells) {
  // cells: array of [r, c, formula, value] (0-based r/c)
  var maxR = 0, maxC = 0;
  cells.forEach(function (x) {
    if (x[0] + 1 > maxR) maxR = x[0] + 1;
    if (x[1] + 1 > maxC) maxC = x[1] + 1;
  });
  var formulas = [], values = [];
  for (var r = 0; r < maxR; r++) {
    var fr = [], vr = [];
    for (var c = 0; c < maxC; c++) { fr.push(''); vr.push(''); }
    formulas.push(fr); values.push(vr);
  }
  cells.forEach(function (x) {
    formulas[x[0]][x[1]] = x[2];
    values[x[0]][x[1]]   = x[3];
  });
  return { name: name, formulas: formulas, values: values };
}


registerTest({
  id      : 'UNIT_INPUTSHASH_DETERMINISTIC',
  group   : 'unit',
  module  : 'engine/inputs_hash',
  scenarios: [],
  tags    : ['engine', 'freshness', 'batch1'],
  source  : 'tests_unit/engine/InputsHashTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT engine/inputs_hash: deterministic');
    var mk = function () {
      return [_ihtGrid('INPUT_PROJECT', [[2, 3, '', 'CULLIGAN'], [3, 3, '', 864]]),
              _ihtGrid('INPUT_DESIGN',  [[5, 2, '=B3*2', 1728]])];
    };
    var h1 = argiaHashGrids(mk());
    var h2 = argiaHashGrids(mk());
    t.assert('same grids -> same hash', h1, h2);
    t.assert('hash is 8 hex chars', true, /^[0-9a-f]{8}$/.test(h1));
  }
});


registerTest({
  id      : 'UNIT_INPUTSHASH_VALUE_SENSITIVE',
  group   : 'unit',
  module  : 'engine/inputs_hash',
  scenarios: [],
  tags    : ['engine', 'freshness', 'batch1'],
  source  : 'tests_unit/engine/InputsHashTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT engine/inputs_hash: value + formula sensitivity');
    var base    = [_ihtGrid('INPUT_PROJECT', [[2, 3, '', 'CULLIGAN']])];
    var changed = [_ihtGrid('INPUT_PROJECT', [[2, 3, '', 'PROLOGIS']])];
    t.assertTrue('value change -> different hash',
                 argiaHashGrids(base) !== argiaHashGrids(changed));

    var fBase    = [_ihtGrid('INPUT_DESIGN', [[5, 2, '=B3*2', 1728]])];
    var fChanged = [_ihtGrid('INPUT_DESIGN', [[5, 2, '=B3*3', 1728]])];
    t.assertTrue('formula change -> different hash (same displayed value)',
                 argiaHashGrids(fBase) !== argiaHashGrids(fChanged));
  }
});


registerTest({
  id      : 'UNIT_INPUTSHASH_FORMULA_PRECEDENCE',
  group   : 'unit',
  module  : 'engine/inputs_hash',
  scenarios: [],
  tags    : ['engine', 'freshness', 'batch1'],
  source  : 'tests_unit/engine/InputsHashTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT engine/inputs_hash: formula precedence over recalc');
    // Same formula, DIFFERENT recalculated value (e.g. IMPORTRANGE rate
    // mirror moved). The inputs did not change -> hash must not change,
    // otherwise every mirror refresh would fake-flag all outputs stale.
    var v1 = [_ihtGrid('INPUT_CFE', [[20, 2, '=VLOOKUP(A1,RATES,2)', 0.1801]])];
    var v2 = [_ihtGrid('INPUT_CFE', [[20, 2, '=VLOOKUP(A1,RATES,2)', 0.1944]])];
    t.assert('recalculated value under unchanged formula -> same hash',
             argiaHashGrids(v1), argiaHashGrids(v2));
  }
});


registerTest({
  id      : 'UNIT_INPUTSHASH_EMPTIES_AND_BOUNDARIES',
  group   : 'unit',
  module  : 'engine/inputs_hash',
  scenarios: [],
  tags    : ['engine', 'freshness', 'batch1'],
  source  : 'tests_unit/engine/InputsHashTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT engine/inputs_hash: empties ignored, boundaries safe');

    // 5: trailing blank rows/cols must not matter.
    var tight = [_ihtGrid('INPUT_BESS', [[1, 1, '', 'YES']])];
    var padded = [_ihtGrid('INPUT_BESS', [[1, 1, '', 'YES'], [9, 9, '', '']])];
    t.assert('trailing empties -> same hash',
             argiaHashGrids(tight), argiaHashGrids(padded));

    // 6: adjacent-cell content must not merge across boundaries.
    var ab_c = [_ihtGrid('T', [[0, 0, '', 'AB'], [0, 1, '', 'C']])];
    var a_bc = [_ihtGrid('T', [[0, 0, '', 'A'],  [0, 1, '', 'BC']])];
    t.assertTrue('AB|C differs from A|BC',
                 argiaHashGrids(ab_c) !== argiaHashGrids(a_bc));

    // 7: tab name participates.
    var inProj = [_ihtGrid('INPUT_PROJECT', [[0, 0, '', 'X']])];
    var inBaas = [_ihtGrid('INPUT_BAAS',    [[0, 0, '', 'X']])];
    t.assertTrue('same cell on another tab -> different hash',
                 argiaHashGrids(inProj) !== argiaHashGrids(inBaas));
  }
});


registerTest({
  id      : 'UNIT_AUDIT_CONTRACT_COVERS_DELIVERABLES',
  group   : 'unit',
  module  : 'engine/audit_contract',
  scenarios: [],
  tags    : ['audit', 'contract', 'batch1'],
  source  : 'tests_unit/engine/InputsHashTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT engine/audit_contract: audit covers every deliverable');
    // THE drift this pins down: CLIENT_FINANCIALS_v2 shipped without an
    // audit entry and went unaudited in the live workbook. Every stamped
    // deliverable tab MUST be in AUDIT_OUTPUT_SHEETS; every input tab the
    // hash covers MUST be in AUDIT_INPUT_SHEETS. Adding a new writer
    // without updating the audit now fails the suite.
    ARGIA_STAMPED_TABS.forEach(function (name) {
      t.assertTrue('audit covers ' + name,
                   AUDIT_OUTPUT_SHEETS.indexOf(name) !== -1);
    });
    INPUT_SNAPSHOT_TABS.forEach(function (name) {
      t.assertTrue('audit covers input ' + name,
                   AUDIT_INPUT_SHEETS.indexOf(name) !== -1);
    });
  }
});


registerTest({
  id      : 'UNIT_ENGINE_TABS_SUBSET_OF_STAMPED',
  group   : 'unit',
  module  : 'engine/audit_contract',
  scenarios: [],
  tags    : ['freshness', 'contract', 'batch1'],
  source  : 'tests_unit/engine/InputsHashTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT engine/audit_contract: engine tabs are stamped tabs');
    ARGIA_ENGINE_TABS.forEach(function (name) {
      t.assertTrue('stamped set includes ' + name,
                   ARGIA_STAMPED_TABS.indexOf(name) !== -1);
    });
    // PDF export configs must point at stamped (or internal) sheets so the
    // export-time freshness check can actually find a stamp key.
    Object.keys(PDF_EXPORTS).forEach(function (k) {
      var sheet = PDF_EXPORTS[k].sheet;
      t.assertTrue('PDF export ' + k + ' targets a stamped tab (' + sheet + ')',
                   ARGIA_STAMPED_TABS.indexOf(sheet) !== -1);
    });
  }
});


registerTest({
  id      : 'UNIT_BACKUP_ROWS_UNIFORM_WIDTH',
  group   : 'unit',
  module  : 'engine/input_backup',
  scenarios: [],
  tags    : ['lifecycle', 'backup', 'batch1', 'regression'],
  source  : 'tests_unit/engine/InputsHashTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT engine/input_backup: backup row matrix is uniform width');
    // v4.13.0 SHIPPED BUG: the _INPUT_BACKUP header row was 3 columns wide
    // while data rows were 5, and Sheets' setValues throws on ragged
    // matrices ("The data has 3 but the range has 5") -- aborting both
    // INT_LIFECYCLE_PERSISTENT_BACKUP_ROUNDTRIP and START_NEW_PROJECT in
    // the live suite. The Node rig's setValues stub does not validate
    // widths, so this PURE check over argiaBuildBackupRows is the lock.
    var snap = {
      INPUT_PROJECT: {
        rows: 2, cols: 3,
        formulas: [['', '', ''], ['', '=B1*2', '']],
        values:   [['CULLIGAN', '', ''], ['', 4, 'x']]
      },
      INPUT_BAAS: {
        rows: 1, cols: 1,
        formulas: [['']],
        values:   [[15]]
      }
    };
    var rows = argiaBuildBackupRows(snap, '2026-06-11T00:00:00Z');

    t.assertTrue('at least header + 1 data row', rows.length >= 2);
    var ragged = rows.filter(function (r) { return r.length !== INPUT_BACKUP_COLS; });
    t.assert('EVERY row is exactly ' + INPUT_BACKUP_COLS + ' wide (ragged: '
             + ragged.length + ')', 0, ragged.length);

    // Header shape (padded, not truncated).
    t.assert('header marker', 'ARGIA_INPUT_BACKUP', rows[0][0]);
    t.assert('header timestamp', '2026-06-11T00:00:00Z', rows[0][1]);
    t.assert('header format version', 1, rows[0][2]);

    // Content rows: formula precedence + empty-skip.
    var dataRows = rows.slice(1);
    t.assert('4 non-empty cells captured', 4, dataRows.length);
    var formulaRow = dataRows.filter(function (r) { return r[3] === 'F'; })[0];
    t.assertTrue('formula row present with F flag', !!formulaRow);
    t.assert('formula content preserved', '=B1*2', formulaRow[4]);
    var baasRow = dataRows.filter(function (r) { return r[0] === 'INPUT_BAAS'; })[0];
    t.assertTrue('INPUT_BAAS cell captured (copyTo gap stays closed)', !!baasRow);
    t.assert('value flag on plain cell', 'V', baasRow[3]);
  }
});


registerTest({
  id      : 'UNIT_BACKUP_CHUNK_RANGES_COVER',
  group   : 'unit',
  module  : 'engine/input_backup',
  scenarios: [],
  tags    : ['lifecycle', 'backup', 'regression'],
  source  : 'tests_unit/engine/InputsHashTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT engine/input_backup: chunk planner tiles rows exactly [4.14.2]');
    // The resilient persist fallback writes rows in chunks; a planner bug
    // (gap or overlap) would silently corrupt the backup -- the one artifact
    // whose whole job is to be trustworthy when everything else breaks.
    [0, 1, 199, 200, 201, 1075].forEach(function (total) {
      var chunks = argiaChunkRanges(total, 200);
      var covered = 0;
      var prevEnd = 0;
      var contiguous = true;
      chunks.forEach(function (ch) {
        if (ch[0] !== prevEnd) contiguous = false;
        covered += ch[1];
        prevEnd = ch[0] + ch[1];
      });
      t.assert('total=' + total + ': rows covered exactly once', total, covered);
      t.assertTrue('total=' + total + ': chunks contiguous from 0', contiguous);
      t.assertTrue('total=' + total + ': no chunk exceeds size 200',
                   chunks.every(function (ch) { return ch[1] >= 1 && ch[1] <= 200; }));
    });
    t.assert('total=0 -> no chunks', 0, argiaChunkRanges(0, 200).length);
  }
});


registerTest({
  id      : 'UNIT_BACKUP_ROWS_FILTER_NON_PRIMITIVE',
  group   : 'unit',
  module  : 'engine/input_backup',
  scenarios: [],
  tags    : ['lifecycle', 'backup', 'regression'],
  source  : 'tests_unit/engine/InputsHashTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT engine/input_backup: non-primitive values excluded [4.14.3]');
    // ROOT CAUSE of the 4.14.0-4.14.2 persist failures: the ARGIA logo is
    // an in-cell image at B2 of every input tab. getValues() returns a
    // CellImage OBJECT there, and one non-serializable object poisons the
    // whole bulk setValues ("Service error: Spreadsheets"). Invisible to
    // offline replays because xlsx export drops in-cell images. The builder
    // must pass only string/number/boolean/Date and skip everything else.
    var fakeCellImage = { getUrl: function () { return ''; },
                          toString: function () { return 'CellImage'; } };
    var when = new Date('2026-06-11T00:00:00Z');
    var snap = {
      INPUT_PROJECT: {
        rows: 2, cols: 3,
        formulas: [['', '', ''], ['', '', '']],
        values:   [['', fakeCellImage, ''], ['CULLIGAN', 42, when]]
      }
    };
    var rows = argiaBuildBackupRows(snap, '2026-06-11T00:00:00Z');
    var data = rows.slice(1);

    t.assert('only the 3 primitive cells captured', 3, data.length);
    t.assertTrue('no row carries the image object',
                 data.every(function (r) { return r[4] !== fakeCellImage; }));
    t.assertTrue('r1c2 (logo cell) absent entirely',
                 data.every(function (r) { return !(r[1] === 1 && r[2] === 2); }));
    t.assert('string kept', 'CULLIGAN',
             data.filter(function (r) { return r[1] === 2 && r[2] === 1; })[0][4]);
    t.assert('number kept', 42,
             data.filter(function (r) { return r[1] === 2 && r[2] === 2; })[0][4]);
    t.assertTrue('Date kept',
                 data.filter(function (r) { return r[1] === 2 && r[2] === 3; })[0][4] instanceof Date);
    t.assertTrue('widths still uniform 5',
                 rows.every(function (r) { return r.length === 5; }));

    // Predicate contract directly.
    t.assertTrue('safe: string/number/boolean/Date',
      argiaIsBackupSafeValue('x') && argiaIsBackupSafeValue(0)
      && argiaIsBackupSafeValue(false) && argiaIsBackupSafeValue(when));
    t.assertTrue('unsafe: object / null-ish object / array',
      !argiaIsBackupSafeValue(fakeCellImage) && !argiaIsBackupSafeValue({})
      && !argiaIsBackupSafeValue([1, 2]));
  }
});
