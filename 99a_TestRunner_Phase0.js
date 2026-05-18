// =============================================================================
// ARGIA ENGINE v2.0.0 -- File: 99a_TestRunner_Phase0.gs
// Phase 0 regression test suites.
//
// Sits ALONGSIDE 99_TestRunner.gs. Adds three new test functions hooked into
// the existing runTests() pipeline via the addPhase0Tests(t, ss) entry point.
//
// SUITES:
//   1. testVersionStamping — _META sheet exists, fields are current
//   2. testFixtureSynth001HandDerived — Layer 1 (5 hand-derived checks)
//   3. testFixtureSynth001Snapshot     — Layer 2 (snapshot vs locked values)
//
// USAGE FROM 99_TestRunner.gs:
//   Inside runTests(), after the existing test calls, add:
//
//     try { addPhase0Tests(t, ss); }
//     catch (e) { t.assert('Phase0:runner', 'no_error', String(e)); }
//
// =============================================================================

// ---------------------------------------------------------------------------
// PUBLIC ENTRY POINT
// ---------------------------------------------------------------------------
function addPhase0Tests(t, ss) {
  testVersionStamping(t, ss);
  testFixtureSynth001HandDerived(t, ss);
  testFixtureSynth001Snapshot(t, ss);
}

// ---------------------------------------------------------------------------
// SUITE 1: VERSION STAMPING
//
// Confirms _META sheet exists and stamps current ENGINE_VERSION / DB_VERSION.
// This is the cheapest test — if it fails, version stamping is broken and
// every other test is unreliable.
// ---------------------------------------------------------------------------
function testVersionStamping(t, ss) {
  t.suite('Phase0: Version Stamping');

  // Force a stamp before reading (idempotent — safe to call multiple times)
  try {
    stampMeta(ss, {runType: 'test', fixture: 'TESTPROJ-SYNTH-001'});
  } catch (e) {
    t.assert('stampMeta runs', 'no_error', String(e));
    return; // Cannot continue
  }

  var meta = readMeta(ss);
  t.assertTrue('_META sheet exists',                 meta !== null);
  if (!meta) return;

  // Coerce to String on both sides: Google Sheets sometimes parses '2026.05'
  // as a Number, which makes strict-equality fail against the String constant.
  t.assert('engine_version stamped', String(ENGINE_VERSION), String(meta.engineVersion));
  t.assert('db_version stamped',     String(DB_VERSION),     String(meta.dbVersion));
  t.assertTrue('calculated_at populated',  !!meta.calculatedAt);
  t.assertTrue('calculated_by populated',  !!meta.calculatedBy);
  t.assert('fixture_used stamped',  'TESTPROJ-SYNTH-001', meta.fixtureUsed);
  t.assert('run_type stamped',      'test',               meta.runType);

  // First-run history must be present and immutable.
  t.assertTrue('first_version present',  !!meta.firstVersion);
  t.assertTrue('first_run_at present',   !!meta.firstRunAt);
}

// ---------------------------------------------------------------------------
// SUITE 2: HAND-DERIVED SANITY (Layer 1)
//
// Paints SYNTH-001 inputs into the live sheets, lets the existing
// INPUT_CFE formulas recalculate, then asserts hand-derived values.
//
// IMPORTANT: this writes to live sheets. It assumes writeTestInputs() and
// equivalents leave a backup (the existing 99_TestRunner does this).
// ---------------------------------------------------------------------------
function testFixtureSynth001HandDerived(t, ss) {
  t.suite('Phase0: SYNTH-001 hand-derived');

  // 1. Backup live inputs (delegate to existing infra if available).
  //    This backs up INPUT_PROJECT, INPUT_DESIGN, INPUT_INSTALL, INPUT_GENERAL.
  //    INPUT_CFE is handled separately by _backupCfeNarrow — its array formulas
  //    don't survive the generic clearContents+copyTo path (see v2.0.3 notes).
  try {
    if (typeof backupInputs === 'function') backupInputs(ss);
  } catch (e) {
    t.assert('backup before fixture write', 'no_error', String(e));
    // continue anyway — better partial test than none
  }
  try { _backupCfeNarrow(ss); }
  catch (e) {
    t.assert('CFE narrow backup', 'no_error', String(e));
  }

  // 2. Paint SYNTH-001 inputs
  var fxResult;
  try {
    fxResult = writeSynth001Inputs(ss);
  } catch (e) {
    t.assert('writeSynth001Inputs', 'no_error', String(e));
    _restoreIfPossible(ss);
    return;
  }
  // Surface the actual skipped write reason — silent skips hide real bugs.
  if (fxResult.skipped.length === 0) {
    t.assertTrue('SYNTH-001 inputs written (0 skipped)', true);
  } else {
    t.fail('SYNTH-001 inputs written',
           fxResult.skipped.length + ' skipped: ' + fxResult.skipped.join(' | '));
  }

  // 3. Force formula recalc (Apps Script doesn't always trigger immediately)
  SpreadsheetApp.flush();

  // 3.5. Pre-flight: confirm INPUT_CFE formula rows are healthy.
  // If a prior test run corrupted them (e.g. v2.0.2 array-formula bug),
  // we want a clear diagnostic — not NaN downstream.
  var ws = ss.getSheetByName('INPUT_CFE');
  if (!ws) {
    t.fail('INPUT_CFE sheet exists', 'sheet missing — Phase 0 cannot validate');
    _restoreIfPossible(ss);
    return;
  }
  var c37 = ws.getRange('C37').getValue();
  var c37IsNum = (typeof c37 === 'number') && !isNaN(c37);
  if (!c37IsNum) {
    t.fail('INPUT_CFE!C37 (TOTAL Jan) is a number',
           'got "' + c37 + '". Likely the array formulas in rows 21-29 ' +
           'were corrupted by a prior backup/restore cycle. ' +
           'Manual fix: in INPUT_CFE, copy a healthy column (e.g. from ' +
           'another sheet template) into rows 21-29 of cols C through N.');
    _restoreIfPossible(ss);
    return;
  }
  var tol = TESTPROJ_SYNTH_001.expected.tolerance;
  var exp = TESTPROJ_SYNTH_001.expected.handDerived;

  // Demanda Facturable (Jan) — row 19, col C
  // Engine formula: MAX(C15, 0.7*C16) = MAX(kW_punta, 0.7*kWMaxAnoMovil)
  var demanda = Number(ws.getRange('C19').getValue());
  t.assert('Jan Demanda Facturable = 90 kW (MAX(punta=90, 0.7*max=70))',
           exp.demandaFacturableJan, demanda, tol.demanda);

  // PF (Jan) — row 20, col C
  var pfJan = Number(ws.getRange('C20').getValue());
  t.assert('Jan PF ~ 0.946 (35000 / sqrt(35000^2 + 12000^2))',
           exp.pfYearAverage, pfJan, tol.pf);

  // January TOTAL bill — row 37, col C
  // SANITY range only — precise value locked by snapshot (Layer 2)
  var janTotal = Number(ws.getRange('C37').getValue());
  var inRange  = (janTotal >= exp.janBillMin) && (janTotal <= exp.janBillMax);
  t.assertTrue(
    'Jan bill in sanity range [' + exp.janBillMin + ', ' + exp.janBillMax + ']' +
    ' — actual=' + Math.round(janTotal),
    inRange
  );

  // Bill must be > 0 in every month (catches blank-sheet / zero-data failures)
  var minMonth = Infinity, maxMonth = -Infinity, monthsCount = 0;
  ['C','D','E','F','G','H','I','J','K','L','M','N'].forEach(function(col) {
    var v = Number(ws.getRange(col + '37').getValue()) || 0;
    if (v > 0) { monthsCount++; minMonth = Math.min(minMonth, v); maxMonth = Math.max(maxMonth, v); }
  });
  t.assert('All 12 months produce a positive bill', 12, monthsCount);

  // Sanity: month-to-month variance from tariff price changes should be modest
  // (<20% spread). Catches "January tariff applied to all months" bugs.
  if (monthsCount === 12) {
    var spread = (maxMonth - minMonth) / minMonth;
    t.assertTrue(
      'Month-to-month spread < 20% (got ' + (spread*100).toFixed(1) + '%)',
      spread < 0.20
    );
  }

  // 5. Restore designer's previous inputs
  _restoreIfPossible(ss);
}

// ---------------------------------------------------------------------------
// SUITE 3: SNAPSHOT REGRESSION (Layer 2)
//
// Compares full snapshot values against the locked baseline. ALL nulls in
// expected.snapshot are SKIPPED (with a warning) — this is expected before
// first lock. After first lock, any null is itself a regression.
// ---------------------------------------------------------------------------
function testFixtureSynth001Snapshot(t, ss) {
  t.suite('Phase0: SYNTH-001 snapshot');

  var snap = TESTPROJ_SYNTH_001.expected.snapshot;
  if (!snap) {
    t.fail('snapshot block exists', 'expected.snapshot missing from fixture');
    return;
  }
  if (!snap.frozenTariffs) {
    t.fail('snapshot.frozenTariffs exists',
           'frozen tariff block missing — see fixture spec');
    return;
  }

  // ---- Pure unit test: calcCfeBill() with frozen Jan tariffs ----
  // No spreadsheet involvement. Tests the JS reference implementation
  // directly. Deterministic forever, regardless of live DB state.
  if (typeof calcCfeBill !== 'function') {
    t.fail('calcCfeBill function exists',
           'calcCfeBill is not defined — is 04a_CalcCfeBill.gs loaded?');
    return;
  }

  var inp = _buildSynth001JanInputObject();
  var result;
  try {
    result = calcCfeBill(inp, snap.frozenTariffs);
  } catch (e) {
    t.fail('calcCfeBill runs without error', String(e));
    return;
  }

  // Assert: JS computation of January matches locked Jan baseline
  t.assert('calcCfeBill(SYNTH-001 Jan, frozen tariffs) total',
           snap.janBillFrozen, result.total, snap.janBillFrozenTol);

  // Assert: annual = 12 × Jan (synthetic identity)
  t.assert('calcCfeBill annual = 12 × Jan (synthetic identity)',
           snap.annualBillFrozen, 12 * result.total, snap.annualBillFrozenTol);

  // ---- Live-DB drift signal (INFO only, never fails) ----
  // Reports current live engine output for awareness. A large gap means
  // CFE has updated tariffs in 20M_CFE_TARIFFS since the lock.
  var ws = ss.getSheetByName('INPUT_CFE');
  if (ws) {
    var liveJan = Number(ws.getRange('C37').getValue());
    var liveAnnual = 0;
    ['C','D','E','F','G','H','I','J','K','L','M','N'].forEach(function(c) {
      liveAnnual += Number(ws.getRange(c + '37').getValue()) || 0;
    });
    var janDrift = Math.abs(liveJan - snap.janBillLiveAtLock);
    var annDrift = Math.abs(liveAnnual - snap.annualBillLiveAtLock);
    t.info('live engine Jan',
           liveJan.toFixed(2) + ' MXN (locked at ' + snap.janBillLiveAtLock +
           ', drift ' + janDrift.toFixed(2) + ')');
    t.info('live engine annual',
           liveAnnual.toFixed(2) + ' MXN (locked at ' + snap.annualBillLiveAtLock +
           ', drift ' + annDrift.toFixed(2) + ')');
    if (janDrift > 100) {
      t.info('LIVE-DB DRIFT',
             'Jan bill has drifted >100 MXN from lock. Likely CFE tariff ' +
             'update in 20M_CFE_TARIFFS. Engine math is still verified by ' +
             'the calcCfeBill assertion above; consider re-locking the live ' +
             'baseline in a future minor version.');
    }
  }

  // ---- Future-phase fields (null) — surfaced as INFO ----
  ['annualBillPostPv', 'annualEnergySavings'].forEach(function(key) {
    if (snap[key] === null) {
      t.info('snapshot.' + key, 'scheduled for Phase 1+ — not asserted');
    }
  });

  // ---- Intentionally out-of-scope fields (false) — surfaced as INFO ----
  ['dcKw', 'acKw', 'qtyModules', 'qtyInverters', 'bomTotalCost'].forEach(function(key) {
    if (snap[key] === false) {
      t.info('snapshot.' + key,
             'out of scope (covered by Tier 3 TESTPROJ-001 already)');
    }
  });
}

// ---------------------------------------------------------------------------
// Helper: build a single-month input object for calcCfeBill() from the
// SYNTH-001 fixture data. January = index 0.
// ---------------------------------------------------------------------------
function _buildSynth001JanInputObject() {
  var m = TESTPROJ_SYNTH_001.inputs.cfe.monthly;
  return {
    kWhBase:       m.kWhBase[0],
    kWhIntermedia: m.kWhIntermedia[0],
    kWhPunta:      m.kWhPunta[0],
    kWBase:        m.kWBase[0],
    kWIntermedia:  m.kWIntermedia[0],
    kWPunta:       m.kWPunta[0],
    kWMaxAnoMovil: m.kWMaxAnoMovil[0],
    kVArh:         m.kVArh[0],
    tarifa:          'GDMTH',
    dap:             0,
    bajaTension2pct: false,
  };
}

// ===========================================================================
// FIXTURE WRITER — paints SYNTH-001 into the sheets
// ===========================================================================
function writeSynth001Inputs(ss) {
  var fx = TESTPROJ_SYNTH_001.inputs;
  var skipped = [];

  // INPUT_PROJECT / INPUT_DESIGN / INPUT_INSTALL — go through writeInput()
  // exactly like the existing fixture (this is the existing pattern from
  // 99_TestRunner's writeTestInputs).
  try { if (typeof ensureInputProjectExists === 'function') ensureInputProjectExists(ss); }
  catch (e) { skipped.push('ensureInputProjectExists: ' + (e.message || e)); }
  try { if (typeof ensureInputInstallExists === 'function') ensureInputInstallExists(ss); }
  catch (e) { skipped.push('ensureInputInstallExists: ' + (e.message || e)); }
  try { if (typeof ensureInputDesignExists === 'function') ensureInputDesignExists(ss); }
  catch (e) { skipped.push('ensureInputDesignExists: ' + (e.message || e)); }

  ['project', 'install', 'design'].forEach(function(section) {
    if (!fx[section]) return;
    Object.keys(fx[section]).forEach(function(key) {
      try { writeInput(ss, key, fx[section][key]); }
      catch (e) { skipped.push(section + ':' + key + ': ' + (e.message || e).slice(0, 80)); }
    });
  });

  // NOTE: legacy INPUT_GENERAL writes removed in v2.0.2.
  // All identity / commercial fields now route to INPUT_PROJECT via INPUT_MAP
  // logical keys (handled by the writeInput() loop above on the 'project' section).

  // INPUT_CFE — NEW writer. Header rows 4-7, monthly grid rows 10-17 cols C:N.
  var cfe = ss.getSheetByName('INPUT_CFE');
  if (cfe && fx.cfe) {
    // Static header values
    ['C4', 'C5', 'C6', 'C7'].forEach(function(cell) {
      if (fx.cfe[cell] !== undefined) {
        try { cfe.getRange(cell).setValue(fx.cfe[cell]); }
        catch (e) { skipped.push('INPUT_CFE!' + cell + ': ' + (e.message || e).slice(0, 80)); }
      }
    });

    // Monthly grid: row mapping → INPUT_CFE rows
    //   kWhBase=10, kWhIntermedia=11, kWhPunta=12,
    //   kWBase=13, kWIntermedia=14, kWPunta=15,
    //   kWMaxAnoMovil=16, kVArh=17
    var rowMap = {
      kWhBase: 10, kWhIntermedia: 11, kWhPunta: 12,
      kWBase: 13, kWIntermedia: 14, kWPunta: 15,
      kWMaxAnoMovil: 16, kVArh: 17,
    };
    Object.keys(rowMap).forEach(function(metric) {
      var row = rowMap[metric];
      var arr = fx.cfe.monthly[metric];
      if (!arr || arr.length !== 12) {
        skipped.push('INPUT_CFE.monthly.' + metric + ': bad array');
        return;
      }
      try {
        // Columns C(3) through N(14)
        cfe.getRange(row, 3, 1, 12).setValues([arr]);
      } catch (e) {
        skipped.push('INPUT_CFE!row' + row + ': ' + (e.message || e).slice(0, 80));
      }
    });
  } else if (!cfe) {
    skipped.push('INPUT_CFE sheet missing');
  }

  return { skipped: skipped };
}

// ---------------------------------------------------------------------------
// SNAPSHOT LOCK PROCEDURE — superseded as of v2.0.4
//
// v2.0.3 and earlier: lockSynth001Snapshot() captured live engine output and
// printed it for paste. This was abandoned because:
//   - Live engine output depends on 20M_CFE_TARIFFS, which CFE updates
//     monthly — locked values became invalid almost immediately
//   - The state at lock time was mixed (TESTPROJ-001 MDC + SYNTH-001 CFE)
//
// v2.0.4+: the locked baseline lives in TESTPROJ_SYNTH_001.expected.snapshot
//   - Frozen tariffs are part of the fixture, hand-edited only
//   - Expected bill is computed in JS by calcCfeBill() — deterministic
//   - Re-locking is a DELIBERATE code change with CHANGELOG entry, not an
//     automated tool
//
// What replaces it: auditSynth001() below, which reports current live engine
// state for HUMAN REVIEW without modifying anything. Use this when you want
// to see "what does the engine say today" without locking it as truth.
// ---------------------------------------------------------------------------
function auditSynth001() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var snap = TESTPROJ_SYNTH_001.expected.snapshot;
  var lines = ['=== SYNTH-001 AUDIT — ' + new Date().toISOString() + ' ==='];

  // 1. JS reference output
  try {
    var inp = _buildSynth001JanInputObject();
    var r = calcCfeBill(inp, snap.frozenTariffs);
    lines.push('');
    lines.push('JS reference (calcCfeBill with frozen Jan-2026 tariffs):');
    lines.push('  January TOTAL: ' + r.total.toFixed(2) + ' MXN');
    lines.push('  Annual (12 × Jan): ' + (12 * r.total).toFixed(2) + ' MXN');
    lines.push('  Locked baseline Jan: ' + snap.janBillFrozen);
    lines.push('  Locked baseline ann: ' + snap.annualBillFrozen);
  } catch (e) {
    lines.push('JS reference FAILED: ' + (e.message || e));
  }

  // 2. Live engine output (with current 20M_CFE_TARIFFS)
  var ws = ss.getSheetByName('INPUT_CFE');
  if (ws) {
    var liveJan = Number(ws.getRange('C37').getValue());
    var liveAnnual = 0;
    ['C','D','E','F','G','H','I','J','K','L','M','N'].forEach(function(c) {
      liveAnnual += Number(ws.getRange(c + '37').getValue()) || 0;
    });
    lines.push('');
    lines.push('Live engine (uses current 20M_CFE_TARIFFS):');
    lines.push('  January TOTAL: ' + liveJan.toFixed(2) + ' MXN');
    lines.push('  Annual: ' + liveAnnual.toFixed(2) + ' MXN');
    lines.push('  At-lock Jan: ' + snap.janBillLiveAtLock);
    lines.push('  At-lock ann: ' + snap.annualBillLiveAtLock);
    lines.push('  Jan drift: ' + Math.abs(liveJan - snap.janBillLiveAtLock).toFixed(2) + ' MXN');
    lines.push('  Ann drift: ' + Math.abs(liveAnnual - snap.annualBillLiveAtLock).toFixed(2) + ' MXN');
  } else {
    lines.push('Live engine: INPUT_CFE sheet not found');
  }

  lines.push('');
  lines.push('NOTE: to update the locked baseline, edit TESTPROJ_SYNTH_001');
  lines.push('      .expected.snapshot in 98a_TestData_SYNTH001.gs by hand,');
  lines.push('      with a CHANGELOG entry explaining why.');

  var msg = lines.join('\n');
  Logger.log(msg);
  SpreadsheetApp.getUi().alert('SYNTH-001 audit', msg, SpreadsheetApp.getUi().ButtonSet.OK);
}

// ---------------------------------------------------------------------------
// INTERNAL: try to restore inputs after a fixture write.
// Uses the existing restore mechanism if 99_TestRunner exposes one.
// ---------------------------------------------------------------------------
function _restoreIfPossible(ss) {
  try {
    if (typeof restoreInputs === 'function') restoreInputs(ss);
  } catch (e) {
    // best-effort — don't fail the test on restore failure, just log
    Logger.log('Phase0 restore failed: ' + (e.message || e));
  }
  // Also restore INPUT_CFE narrowly (not handled by shared restoreInputs since
  // v2.0.3 — its array formulas don't survive clearContents+copyTo).
  _restoreCfeNarrow(ss);
}

// ---------------------------------------------------------------------------
// NARROW INPUT_CFE BACKUP / RESTORE (v2.0.3)
//
// Why narrow: INPUT_CFE has array formulas in rows 21-29 that break under
// the generic clearContents+copyTo approach. We only ever WRITE to rows
// 4-17 (header + monthly grid inputs) and only READ from the formula rows.
// So we back up ONLY the input cells, restore them as values, and never
// touch the formula rows at all.
//
// Storage: hidden sheet '_TEST_BACKUP_CFE_NARROW' with values+formulas
// of the input cells. Format: same range layout for round-trip safety.
// ---------------------------------------------------------------------------
var _CFE_BACKUP_SHEET = '_TEST_BACKUP_CFE_NARROW';
// Cells we ever write to in Phase 0 — header (C4:C7) + monthly grid (C10:N17)
var _CFE_HEADER_RANGE  = 'C4:C7';
var _CFE_MONTHLY_RANGE = 'C10:N17';

function _backupCfeNarrow(ss) {
  var cfe = ss.getSheetByName('INPUT_CFE');
  if (!cfe) return; // nothing to back up

  // Delete any stale backup
  var existing = ss.getSheetByName(_CFE_BACKUP_SHEET);
  if (existing) ss.deleteSheet(existing);

  var backup = ss.insertSheet(_CFE_BACKUP_SHEET);
  backup.hideSheet();

  // Capture BOTH values and formulas so we can faithfully restore either.
  // (Some sheets may have formulas in the input cells — rare but possible.)
  var hdrVals = cfe.getRange(_CFE_HEADER_RANGE).getValues();
  var hdrFmls = cfe.getRange(_CFE_HEADER_RANGE).getFormulas();
  var monVals = cfe.getRange(_CFE_MONTHLY_RANGE).getValues();
  var monFmls = cfe.getRange(_CFE_MONTHLY_RANGE).getFormulas();

  // Layout in backup sheet:
  //   A1: marker
  //   A2:A5  header values  (col A only; values are scalars)
  //   B2:B5  header formulas
  //   C2:N9  monthly values (8 rows x 12 cols)
  //   C12:N19 monthly formulas
  backup.getRange('A1').setValue('INPUT_CFE narrow backup — do not edit');
  for (var i = 0; i < hdrVals.length; i++) {
    backup.getRange(i + 2, 1).setValue(hdrVals[i][0]);
    backup.getRange(i + 2, 2).setValue(hdrFmls[i][0]);
  }
  backup.getRange(2, 3, monVals.length, monVals[0].length).setValues(monVals);
  backup.getRange(12, 3, monFmls.length, monFmls[0].length).setValues(monFmls);
}

function _restoreCfeNarrow(ss) {
  var cfe = ss.getSheetByName('INPUT_CFE');
  var backup = ss.getSheetByName(_CFE_BACKUP_SHEET);
  if (!cfe || !backup) return;

  try {
    // Header rows 4-7
    var hdrVals = backup.getRange('A2:A5').getValues();
    var hdrFmls = backup.getRange('B2:B5').getValues();
    for (var i = 0; i < hdrVals.length; i++) {
      var cell = cfe.getRange(4 + i, 3); // C4, C5, C6, C7
      var f = hdrFmls[i][0];
      if (typeof f === 'string' && f.charAt(0) === '=') {
        cell.setFormula(f);
      } else {
        cell.setValue(hdrVals[i][0]);
      }
    }
    // Monthly grid rows 10-17 x cols C-N
    var monVals = backup.getRange(2, 3, 8, 12).getValues();
    var monFmls = backup.getRange(12, 3, 8, 12).getValues();
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 12; c++) {
        var cell2 = cfe.getRange(10 + r, 3 + c);
        var f2 = monFmls[r][c];
        if (typeof f2 === 'string' && f2.charAt(0) === '=') {
          cell2.setFormula(f2);
        } else {
          cell2.setValue(monVals[r][c]);
        }
      }
    }
  } catch (e) {
    Logger.log('CFE narrow restore failed: ' + (e.message || e));
  }

  // Delete the backup sheet
  try { ss.deleteSheet(backup); } catch (_) {}
}
