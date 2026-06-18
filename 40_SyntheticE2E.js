// =============================================================================
// 40_SyntheticE2E.js  —  T12 (chunk b): live synthetic-fixture runner (CAPTURE)
// -----------------------------------------------------------------------------
// Mirrors runCulliganE2E, but proves the engine from a CLEAN, explicit-input
// state. For each fixture (SYNTH_500/600/650) it:
//   1. snapshots your inputs (restored at the end, even on failure)
//   2. DEFAULT rebuild (startNewProjectCore) -> blank template, no residue
//   3. prefill tripwire: asserts engine-consumed numeric inputs are blank/default
//   4. writes the fixture inputs via writeInput() ONLY (INPUT_MAP path)
//   5. runs the engine silently (runArgiaEngine)
//   6. CAPTURES the outputs (API_OUTPUT wholesale + BOM grand/structure) into the
//      _SYNTH_CAPTURE sheet, and compares the structural outcome to the fixture's
//      declared expectations (bessOff / offerEmittable / SIN COTIZAR)
//   7. restores your inputs
//
// This is the CAPTURE step: the numbers it writes to _SYNTH_CAPTURE are the
// engine's actual outputs. Review them, then chunk c LOCKS them as goldens.
// =============================================================================

var SYNTH_CAPTURE_SHEET = '_SYNTH_CAPTURE';
var SYNTH_ALL_IDS = ['SYNTH_500', 'SYNTH_600', 'SYNTH_650'];
var SYNTH_TIME_BUDGET_MS = 240000;  // ~4 min; leaves room for restore within the GAS 6-min cap

// writeInput for a range key needs a 2D array ([[12 values]]); fixtures store 1D.
function _synthWriteInput(ss, key, value) {
  var m = (typeof INPUT_MAP !== 'undefined') ? INPUT_MAP[key] : null;
  if (m && m.mode === 'range' && Array.isArray(value) && !Array.isArray(value[0])) {
    return writeInput(ss, key, [value]);   // 1D -> single-row 2D
  }
  return writeInput(ss, key, value);
}

// ---- prefill tripwire -------------------------------------------------------
function _synthFlatten(v) {
  var out = [];
  if (Array.isArray(v)) {
    v.forEach(function (row) {
      if (Array.isArray(row)) row.forEach(function (x) { out.push(x); });
      else out.push(row);
    });
  } else { out.push(v); }
  return out;
}
function _synthIsBlankDefaultOrSeed(val, def, seed) {
  if (val === '' || val === null || val === undefined) return true;
  function eq(a, b) {
    if (a === undefined || a === null) return false;
    var na = Number(val), nb = Number(b);
    if (!isNaN(na) && !isNaN(nb)) return Math.abs(na - nb) < 1e-9;
    return String(val) === String(b);
  }
  // setup writes seed (the intended fresh value) for some cells, default for
  // others -- both count as a clean reset, only foreign values are leaks.
  return eq(val, def) || eq(val, seed);
}
// LIVE. After a DEFAULT rebuild, every engine-consumed numeric input must be
// blank or its INPUT_MAP default. Any leftover project value is a leak (FAIL).
function syntheticPrefillCheck(ss) {
  var keys = (typeof syntheticPrefillKeys === 'function') ? syntheticPrefillKeys() : [];
  var leaks = [];
  keys.forEach(function (k) {
    var m = (typeof INPUT_MAP !== 'undefined') ? INPUT_MAP[k] : null;
    if (!m) return;
    var vals;
    try { vals = _synthFlatten(readInput(ss, k)); } catch (e) { return; }
    for (var i = 0; i < vals.length; i++) {
      if (!_synthIsBlankDefaultOrSeed(vals[i], m.default, m.seed)) {
        leaks.push(k + (vals.length > 1 ? ('[' + i + ']') : '') + '=' + vals[i]);
        break;
      }
    }
  });
  return { ok: leaks.length === 0, leaks: leaks, checked: keys.length };
}

// ---- capture ----------------------------------------------------------------
// LIVE. Reads the canonical outputs for one fixture into a {label:value} map.
function captureSyntheticOutputs(ss) {
  var out = {};
  // API_OUTPUT wholesale (key col A, value col B) -- the canonical offer figures.
  var api = ss.getSheetByName(typeof API_OUTPUT_SHEET !== 'undefined' ? API_OUTPUT_SHEET : 'API_OUTPUT');
  if (api) {
    var last = api.getLastRow();
    if (last >= 2) {
      var rows = api.getRange(2, 1, last - 1, 2).getValues();
      rows.forEach(function (r) { if (r[0] !== '' && r[0] !== null) out['api.' + r[0]] = r[1]; });
    }
  }
  // BOM headline cells (known coords): grand total + structure subtotal.
  var bom = ss.getSheetByName('BOM_v2');
  if (bom) {
    try { out['bom.grand_total_G94']        = bom.getRange('G94').getValue(); } catch (e) {}
    try { out['bom.structure_subtotal_F25'] = bom.getRange('F25').getValue(); } catch (e) {}
    try { out['bom.bess_subtotal_F92']      = bom.getRange('F92').getValue(); } catch (e) {}
  }
  return out;
}

// LIVE. Compares captured outcome to the fixture's declared structural spec.
function _synthCompareStructural(fixture, cap) {
  var notes = [];
  var s = fixture.structural || {};
  var emittable = String(cap['api.project_status'] || '').toUpperCase().indexOf('BLOCKED') < 0;
  if (s.offerEmittableExpected !== undefined && s.offerEmittableExpected !== emittable) {
    notes.push('EMITTABLE mismatch: expected ' + s.offerEmittableExpected + ', got ' + emittable +
               ' (status="' + cap['api.project_status'] + '")');
  }
  if (s.bessOff === true) {
    var bess = Number(cap['bom.bess_subtotal_F92']) || 0;
    if (bess > 0) notes.push('BESS expected OFF but BOM BESS subtotal=' + bess);
  }
  if (s.structurePresent === false) {
    var st = Number(cap['bom.structure_subtotal_F25']) || 0;
    if (st > 0) notes.push('structure expected BLANK (SIN COTIZAR) but subtotal=' + st);
  }
  return notes;
}

// LIVE. Writes the captured maps to _SYNTH_CAPTURE: col A = label, one column
// per fixture (B/C/D...). Union of all labels across the fixtures captured.
function _writeSyntheticCapture(ss, captures /* {id: {label:value}} */) {
  var sh = ss.getSheetByName(SYNTH_CAPTURE_SHEET);
  if (!sh) sh = ss.insertSheet(SYNTH_CAPTURE_SHEET);

  // MERGE with whatever is already there so per-fixture runs accumulate (each
  // single fixture fits the 6-min cap; Run ALL does not).
  var cell = {};      // cell[label][id] = value
  var ids = [];
  var lastR = sh.getLastRow(), lastC = sh.getLastColumn();
  if (lastR >= 1 && lastC >= 2) {
    var grid = sh.getRange(1, 1, lastR, lastC).getValues();
    var hdr = grid[0];
    for (var c = 1; c < hdr.length; c++) if (hdr[c] !== '' && hdr[c] != null) ids.push(hdr[c]);
    for (var r = 1; r < grid.length; r++) {
      var k = grid[r][0]; if (k === '' || k == null) continue;
      cell[k] = cell[k] || {};
      for (var c2 = 1; c2 < hdr.length; c2++) cell[k][hdr[c2]] = grid[r][c2];
    }
  }
  Object.keys(captures).forEach(function (id) {
    if (ids.indexOf(id) < 0) ids.push(id);
    Object.keys(captures[id]).forEach(function (l) {
      cell[l] = cell[l] || {}; cell[l][id] = captures[id][l];
    });
  });

  var labels = Object.keys(cell).sort();
  var header = ['capture_key'].concat(ids);
  var out = [header];
  labels.forEach(function (l) {
    var row = [l];
    ids.forEach(function (id) { row.push(cell[l].hasOwnProperty(id) ? cell[l][id] : ''); });
    out.push(row);
  });
  sh.clearContents();
  sh.getRange(1, 1, out.length, header.length).setValues(out);
  return { rows: labels.length, fixtures: ids.length };
}

// ---- the runner -------------------------------------------------------------
function _runSyntheticE2ECore(ss, fixtureIds) {
  var results = {}, captures = {};
  var snap = null, phase = 'start';
  var t0 = Date.now();
  var lfBefore = null;
  try { if (typeof argiaInputLayoutFingerprint === 'function') lfBefore = argiaInputLayoutFingerprint(ss); } catch (e) {}

  try {
    phase = 'snapshot inputs';
    snap = snapshotInputSheets(ss);

    for (var i = 0; i < fixtureIds.length; i++) {
      var id = fixtureIds[i];
      // Time-budget guard: GAS kills the script at ~6 min. After the first
      // fixture, if we're near the budget, stop gracefully and tell the user to
      // run the rest individually (capture accumulates).
      if (i > 0 && (Date.now() - t0) > SYNTH_TIME_BUDGET_MS) {
        for (var j = i; j < fixtureIds.length; j++) {
          results[fixtureIds[j]] = { id: fixtureIds[j], ok: false, skippedForTime: true,
            reason: 'skipped (6-min budget) -- run it on its own from the menu' };
        }
        break;
      }
      var fx = SYNTHETIC_FIXTURES[id];
      var res = { id: id, ok: false, prefillLeaks: [], structuralNotes: [], reason: '' };
      try {
        phase = id + ': DEFAULT rebuild';
        if (typeof _setArgiaProgress === 'function') _setArgiaProgress(1, 6, 'SYNTH: ' + id + ' rebuild\u2026');
        startNewProjectCore(ss);
        SpreadsheetApp.flush();

        phase = id + ': prefill tripwire';
        var pf = syntheticPrefillCheck(ss);
        res.prefillLeaks = pf.leaks;

        phase = id + ': write fixture inputs';
        if (typeof _setArgiaProgress === 'function') _setArgiaProgress(2, 6, 'SYNTH: ' + id + ' inputs\u2026');
        Object.keys(fx.inputs).forEach(function (k) { _synthWriteInput(ss, k, fx.inputs[k]); });
        SpreadsheetApp.flush();

        phase = id + ': engine generate';
        if (typeof _setArgiaProgress === 'function') _setArgiaProgress(3, 6, 'SYNTH: ' + id + ' generate\u2026 (~1\u20132 min)');
        var eng = runArgiaEngine({ silent: true, assumeYes: true });
        SpreadsheetApp.flush();
        if (!eng || eng.ok !== true) {
          res.reason = 'engine did not complete: ' + (eng ? eng.reason : 'no result') +
                       (eng && eng.error ? ' (' + eng.error + ')' : '');
          captures[id] = captureSyntheticOutputs(ss);   // capture whatever exists
          results[id] = res;
          continue;
        }

        phase = id + ': capture';
        if (typeof _setArgiaProgress === 'function') _setArgiaProgress(4, 6, 'SYNTH: ' + id + ' capture\u2026');
        var cap = captureSyntheticOutputs(ss);
        captures[id] = cap;
        res.structuralNotes = _synthCompareStructural(fx, cap);
        res.ok = true;
      } catch (eFix) {
        res.reason = 'aborted during "' + phase + '": ' + eFix.message;
        try { captures[id] = captureSyntheticOutputs(ss); } catch (_) {}
      }
      results[id] = res;
    }

    phase = 'write capture sheet';
    _writeSyntheticCapture(ss, captures);

  } catch (e) {
    if (typeof engineLog === 'function') { try { engineLog(ss, 'SYNTH_E2E', 'ERROR', 'aborted "' + phase + '": ' + e.message); } catch (_) {} }
  } finally {
    if (snap) {
      try { restoreInputSheets(ss, snap); } catch (rErr) {
        if (typeof engineLog === 'function') { try { engineLog(ss, 'SYNTH_E2E', 'ERROR', 'restore raised: ' + rErr.message); } catch (_) {} }
      }
      try {
        if (lfBefore && typeof argiaDiffLayoutFingerprints === 'function') {
          var drift = argiaDiffLayoutFingerprints(lfBefore, argiaInputLayoutFingerprint(ss));
          if (drift.length && typeof repairInputLayouts === 'function') repairInputLayouts(ss);
        }
      } catch (_) {}
    }
  }
  return results;
}

function runSyntheticE2E(fixtureId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  if (!SYNTHETIC_FIXTURES || !SYNTHETIC_FIXTURES[fixtureId]) {
    ui.alert('Synthetic E2E', 'Unknown fixture "' + fixtureId + '".', ui.ButtonSet.OK);
    return;
  }
  var go = ui.alert('Run Synthetic E2E \u2014 ' + fixtureId,
    SYNTHETIC_FIXTURES[fixtureId].label + '\n\n' +
    'Snapshots your inputs, rebuilds to DEFAULT, writes this fixture, runs the\n' +
    'engine, CAPTURES outputs to _SYNTH_CAPTURE, then restores your inputs.\n\n' +
    'Your project is restored at the end even if a step fails. Continue?',
    ui.ButtonSet.OK_CANCEL);
  if (go !== ui.Button.OK) { ui.alert('Cancelled', 'No changes made.', ui.ButtonSet.OK); return; }

  if (typeof _ARGIA_PROGRESS_EXTERNAL !== 'undefined') _ARGIA_PROGRESS_EXTERNAL = true;
  if (typeof _showArgiaProgress === 'function') _showArgiaProgress('ARGIA \u2014 Synthetic E2E');
  var results = _runSyntheticE2ECore(ss, [fixtureId]);
  if (typeof _ARGIA_PROGRESS_EXTERNAL !== 'undefined') _ARGIA_PROGRESS_EXTERNAL = false;
  if (typeof _setArgiaProgress === 'function') _setArgiaProgress(6, 6, '\u2705 Synthetic E2E \u2014 listo');
  ui.alert('Synthetic E2E \u2014 ' + fixtureId, _synthResultSummary(results), ui.ButtonSet.OK);
}

function runSyntheticE2E_ALL() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var go = ui.alert('Run ALL Synthetic E2E',
    'Runs SYNTH_500, SYNTH_600, SYNTH_650 in sequence (each: DEFAULT rebuild ->\n' +
    'fixture -> engine -> capture). Results land in _SYNTH_CAPTURE. Your inputs\n' +
    'are restored at the end. This takes a few minutes. Continue?',
    ui.ButtonSet.OK_CANCEL);
  if (go !== ui.Button.OK) { ui.alert('Cancelled', 'No changes made.', ui.ButtonSet.OK); return; }
  if (typeof _ARGIA_PROGRESS_EXTERNAL !== 'undefined') _ARGIA_PROGRESS_EXTERNAL = true;
  if (typeof _showArgiaProgress === 'function') _showArgiaProgress('ARGIA \u2014 Synthetic E2E (ALL)');
  var results = _runSyntheticE2ECore(ss, SYNTH_ALL_IDS.slice());
  if (typeof _ARGIA_PROGRESS_EXTERNAL !== 'undefined') _ARGIA_PROGRESS_EXTERNAL = false;
  if (typeof _setArgiaProgress === 'function') _setArgiaProgress(6, 6, '\u2705 Synthetic E2E \u2014 listo');
  ui.alert('Synthetic E2E \u2014 ALL', _synthResultSummary(results), ui.ButtonSet.OK);
}

function _synthResultSummary(results) {
  var lines = [];
  Object.keys(results).forEach(function (id) {
    var r = results[id];
    var icon = r.ok ? '\u2705 ' : (r.skippedForTime ? '\u23f1 ' : '\u274c ');
    lines.push(icon + id + (r.ok ? ' captured' : ' \u2014 ' + r.reason));
    if (r.prefillLeaks && r.prefillLeaks.length) lines.push('   prefill LEAK: ' + r.prefillLeaks.slice(0, 5).join(', '));
    if (r.structuralNotes && r.structuralNotes.length) lines.push('   structural: ' + r.structuralNotes.join('; '));
  });
  lines.push('');
  lines.push('Captured numbers are in the _SYNTH_CAPTURE sheet. Review them, then');
  lines.push('they get locked as goldens (chunk c). Your inputs were restored.');
  return lines.join('\n');
}

// menu wrappers
function runSyntheticE2E_500() { runSyntheticE2E('SYNTH_500'); }
function runSyntheticE2E_600() { runSyntheticE2E('SYNTH_600'); }
function runSyntheticE2E_650() { runSyntheticE2E('SYNTH_650'); }
