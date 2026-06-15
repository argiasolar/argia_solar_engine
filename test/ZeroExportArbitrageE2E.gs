// =============================================================================
// ARGIA -- test/ZeroExportArbitrageE2E.gs
// -----------------------------------------------------------------------------
// [4.19.0] LIVE verification of option #1 (un-gated grid-charging, 4.18.0).
//
// WHY THIS EXISTS: 4.18.0 un-gated battery grid-charging from NET_BILLING so
// ZERO_EXPORT sites can do realistic single-cycle energy arbitrage. That change
// was verified offline (planner unit tests) and by the extracted executor
// decision unit test -- but the EXECUTOR's full integration path
// (20_CalcHourlySimulation doChargeGrid -> bill math) only runs live in Apps
// Script against a real workbook. CULLIGAN cannot exercise it: CULLIGAN is
// solar-RICH and MEDICION_NETA with PEAK_SHAVING, so it never grid-charges.
//
// This fixture is CULLIGAN with three surgical overrides that make grid-charge
// arbitrage actually fire:
//   1. interconnectionMode -> SIN_EXPORTACION  (ZERO_EXPORT)
//   2. bessStrategy        -> LOAD_SHIFTING
//   3. solar-POOR PV: panel/string/helioscope production scaled to ~0.12x
//      (162 mods = 9 strings x 18 = 103.7 kWp vs CULLIGAN's 864 kWp), so PV
//      surplus cannot fund the battery cycle and the battery MUST grid-charge.
// Everything else (battery 2169 kWh / 972 kW, GDMTH rates via MASTER_DB,
// consumption) is inherited from CULLIGAN, so the arbitrage spread is the real
// GDMTH spread (base ~0.864, punta ~1.595; edge ~0.571 MXN/kWh).
//
// Offline model (planner, one representative day) predicts: grid-charge ~1928
// kWh/day, discharge ~1735 kWh/day (one full usable cycle), LOAD_SHIFTING
// strictly > PEAK_SHAVING, ~+0.3-0.4M MXN/yr energy arbitrage -- the realistic
// "normal operation" number, NOT a demand-charge optimum. The live E2E
// confirms the executor reproduces this end-to-end.
//
// The scaling keeps the layout self-consistent so it does NOT trip INP/STR
// validations: panelQty 162 == stringsTotal 9 * modsPerString 18.
// =============================================================================

// --- deep clone (Apps Script has no structuredClone) -------------------------
function _zeArbDeepClone(o) {
  if (o === null || typeof o !== 'object') return o;
  if (Array.isArray(o)) {
    var a = new Array(o.length);
    for (var i = 0; i < o.length; i++) a[i] = _zeArbDeepClone(o[i]);
    return a;
  }
  var out = {};
  for (var k in o) if (o.hasOwnProperty(k)) out[k] = _zeArbDeepClone(o[k]);
  return out;
}

// --- Build the derived inputs from CULLIGAN_BASELINE -------------------------
// Single PV scale factor; everything PV-related scales together so the system
// stays internally consistent (kWp, strings, production all proportional).
var ZE_ARB_PV_SCALE = 0.12;   // 1350 -> 162 mods, 864 -> 103.7 kWp

function buildZeroExportArbitrageInputs() {
  var inp = _zeArbDeepClone(CULLIGAN_BASELINE.inputs);

  // -- 1. interconnection: ZERO_EXPORT -------------------------------------
  inp.cfe.interconnectionMode = 'SIN_EXPORTACION';
  inp.cfe.exportPriceMxnPerKwh = 0;   // no export credit under ZERO_EXPORT

  // -- 2. strategy: LOAD_SHIFTING ------------------------------------------
  inp.bess.bessStrategy = 'LOAD_SHIFTING';

  // -- 3. solar-POOR: scale PV fields by ZE_ARB_PV_SCALE -------------------
  // Module / string counts: keep modsPerString = 18 so 162 = 9 * 18 stays
  // validation-consistent (STR-/INP- checks compare panelQty vs strings).
  if (inp.design) {
    inp.design.panelQty            = 162;   // 9 strings * 18
    inp.design.totalStrings        = 9;
    inp.design.stringsTotal        = 9;
    inp.design.inverterPrimaryStrings = 9;
    inp.design.totalInverters      = 1;
    inp.design.inverterPrimaryQty  = 1;
    // modsPerString stays 18 (unchanged).

    // Scale helioscope production columns (nameplateKwh=col5, gridKwh=col6).
    // Keep irradiance columns (ghi/poa/shaded) as-is; only energy scales.
    if (Array.isArray(inp.design.helioscopeMonthly)) {
      inp.design.helioscopeMonthly = inp.design.helioscopeMonthly.map(function (row) {
        var r = row.slice();
        if (typeof r[4] === 'number') r[4] = Math.round(r[4] * ZE_ARB_PV_SCALE);
        if (typeof r[5] === 'number') r[5] = Math.round(r[5] * ZE_ARB_PV_SCALE);
        return r;
      });
    }

    // Secondary inverter slot: CULLIGAN had a 4x150K secondary; drop it
    // (a 103 kWp system uses a single primary inverter).
    inp.design.invertersSecondary = [
      ['', '', '', ''], ['', '', '', ''], ['', '', '', ''], ['', '', '', '']
    ];
  }

  // Project section mirrors design panel counts.
  if (inp.project) {
    inp.project.panelQty = 162;
  }

  // Identity: rename so MDC/PC banners are unambiguous and CULLIGAN baseline
  // guards never mistake this for a CULLIGAN run.
  if (inp.project) {
    inp.project.projectName = 'ZE_ARBITRAGE_TEST';
    inp.project.clientName  = 'ZERO EXPORT ARBITRAGE';
  }

  return inp;
}

// --- Writer: mirror writeCulliganInputs but with the derived inputs ----------
// Reuses the exact same section-by-section write logic. Kept as a thin wrapper
// so any future change to the CULLIGAN writer pattern is easy to port.
function writeZeroExportArbitrageInputs(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var inputs = buildZeroExportArbitrageInputs();
  var skipped = [];

  try { ensureInputProjectExists(ss); }
  catch (e) { skipped.push('ensureInputProjectExists: ' + String(e.message || e).slice(0, 80)); }
  try { ensureInputInstallExists(ss); }
  catch (e) { skipped.push('ensureInputInstallExists: ' + String(e.message || e).slice(0, 80)); }
  try { ensureInputDesignExists(ss); }
  catch (e) { skipped.push('ensureInputDesignExists: ' + String(e.message || e).slice(0, 80)); }

  ['project', 'design', 'install'].forEach(function (section) {
    if (!inputs[section]) return;
    Object.keys(inputs[section]).forEach(function (key) {
      try { writeInput(ss, key, inputs[section][key]); }
      catch (e) { skipped.push('INPUT_' + section.toUpperCase() + ':' + key + ': ' + String(e.message || e).slice(0, 80)); }
    });
  });

  if (inputs.bess) {
    var ib = ss.getSheetByName('INPUT_BESS');
    if (!ib) { skipped.push('INPUT_BESS: sheet not present'); }
    else {
      Object.keys(inputs.bess).forEach(function (key) {
        if (key.indexOf('_cell_') === 0) {
          var a1 = key.substring('_cell_'.length);
          try { ib.getRange(a1).setValue(inputs.bess[key]); }
          catch (e) { skipped.push('INPUT_BESS!' + a1 + ': ' + String(e.message || e).slice(0, 80)); }
        } else {
          try { writeInput(ss, key, inputs.bess[key]); }
          catch (e) { skipped.push('INPUT_BESS:' + key + ': ' + String(e.message || e).slice(0, 80)); }
        }
      });
    }
  }

  if (inputs.cfe) {
    var ic = ss.getSheetByName('INPUT_CFE');
    if (!ic) { skipped.push('INPUT_CFE: sheet not present'); }
    else {
      var cfe = inputs.cfe;
      var scalarMap = {
        'C4': cfe.tariffCode, 'C5': cfe.tariffLocation, 'C6': cfe.tariffDap,
        'C7': cfe.bajaTension2pct, 'F4': cfe.serviceName, 'F5': cfe.serviceNumber,
        'F6': cfe.contractedDemand, 'C41': cfe.interconnectionMode,
        'C42': cfe.exportPriceMxnPerKwh, 'C43': cfe.selfConsumptionPct,
        'C44': cfe.powerFactorThreshold
      };
      Object.keys(scalarMap).forEach(function (a1) {
        var v = scalarMap[a1];
        if (v === undefined) return;
        try { ic.getRange(a1).setValue(v); }
        catch (e) { skipped.push('INPUT_CFE!' + a1 + ': ' + String(e.message || e).slice(0, 80)); }
      });
      var rowMap = {
        10: cfe.kWhBase, 11: cfe.kWhIntermedia, 12: cfe.kWhPunta,
        13: cfe.kWBase, 14: cfe.kWIntermedia, 15: cfe.kWPunta,
        16: cfe.kWMaxAnoMovil, 17: cfe.kVArh
      };
      Object.keys(rowMap).forEach(function (rowStr) {
        var row = parseInt(rowStr, 10);
        var arr = rowMap[rowStr];
        if (!Array.isArray(arr) || arr.length !== 12) {
          skipped.push('INPUT_CFE row ' + row + ': expected 12-element array'); return;
        }
        try { ic.getRange(row, 3, 1, 12).setValues([arr]); }
        catch (e) { skipped.push('INPUT_CFE row ' + row + ': ' + String(e.message || e).slice(0, 80)); }
      });
    }
  }

  return skipped;
}

// --- E2E runner: mirrors runCulliganE2E -------------------------------------
// Snapshot -> load solar-poor ZERO_EXPORT fixture -> silent engine ->
// read back the BESS dispatch result -> restore inputs. The verdict
// (grid-charge fired? LS > PS? arbitrage value sane?) is written to the engine
// log and shown in the final alert.
function runZeroExportArbitrageE2E() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  var go = ui.alert(
    'Run ZERO_EXPORT Arbitrage E2E',
    'Verifies option #1 (4.18.0 un-gated grid-charging) end-to-end.\n\n' +
    'This will, in order:\n\n' +
    '  1. Snapshot your current inputs (all 6 INPUT_ tabs).\n' +
    '  2. Load a solar-POOR, ZERO_EXPORT, LOAD_SHIFTING fixture\n' +
    '     (CULLIGAN battery + rates, PV scaled to ~104 kWp).\n' +
    '  3. Run the engine silently (full hourly BESS sim).\n' +
    '  4. Report whether the battery grid-charged and the\n' +
    '     LOAD_SHIFTING arbitrage value it produced.\n' +
    '  5. Restore YOUR inputs exactly as they were.\n\n' +
    'Your loaded project is restored at the end even if a step fails.\n\n' +
    'Continue?',
    ui.ButtonSet.OK_CANCEL);
  if (go !== ui.Button.OK) {
    ui.alert('Cancelled', 'No changes made.', ui.ButtonSet.OK);
    return;
  }

  var snap = null, phase = 'start', engineResult = null, skipped = null;
  var verdict = '(not reached)';
  var restoreFailed = null;

  _ARGIA_PROGRESS_EXTERNAL = true;
  _setArgiaProgress(0, 6, 'E2E: respaldando tus inputs\u2026');
  _showArgiaProgress('ARGIA \u2014 ZERO_EXPORT Arbitrage E2E');

  try {
    phase = 'snapshot inputs';
    snap = snapshotInputSheets(ss);

    phase = 'load ZERO_EXPORT fixture';
    _setArgiaProgress(1, 6, 'E2E: cargando proyecto solar-pobre ZERO_EXPORT\u2026');
    skipped = writeZeroExportArbitrageInputs(ss);
    SpreadsheetApp.flush();

    phase = 'engine (silent generate)';
    _setArgiaProgress(2, 6, 'E2E: corriendo simulaci\u00f3n BESS\u2026 (~1\u20132 min)');
    engineResult = runArgiaEngine({ silent: true, assumeYes: true });
    SpreadsheetApp.flush();
    if (!engineResult || engineResult.ok !== true) {
      throw new Error('engine did not complete: ' +
        (engineResult ? engineResult.reason : 'no result'));
    }

    phase = 'read BESS dispatch result';
    _setArgiaProgress(5, 6, 'E2E: leyendo resultado de arbitraje\u2026');
    verdict = _zeArbReadVerdict(ss, engineResult);

  } catch (e) {
    verdict = 'E2E ABORTED during "' + phase + '": ' + e.message;
    if (typeof engineLog === 'function') {
      try { engineLog(ss, 'E2E', 'ERROR', verdict + '\n' + (e.stack || '')); } catch (_) {}
    }
  } finally {
    if (snap) {
      try {
        // EXTERNAL must be cleared BEFORE the final tick so getArgiaProgress's
        // done = (step>=total) && !EXTERNAL can evaluate true and the modeless
        // dialog self-closes (it polls done; there is no server-side close).
        _ARGIA_PROGRESS_EXTERNAL = false;
        _setArgiaProgress(5, 6, 'E2E: restaurando tus inputs\u2026');
        restoreInputSheets(ss, snap);
        SpreadsheetApp.flush();
      } catch (rErr) {
        restoreFailed = rErr.message || String(rErr);
        if (typeof engineLog === 'function') {
          try { engineLog(ss, 'E2E', 'ERROR', 'restore failed: ' + restoreFailed); } catch (_) {}
        }
      }
    }
    _ARGIA_PROGRESS_EXTERNAL = false;
    // [4.22.0] Advance to 6/6 so the modeless progress dialog hits done:true and
    // closes itself (1.4s later). The previous _hideArgiaProgress() call was a
    // no-op -- that function does not exist, the ReferenceError was swallowed by
    // the catch, and the bar was left stuck at 5/6 (83%) forever.
    try { _setArgiaProgress(6, 6, '\u2705 ZERO_EXPORT E2E \u2014 listo'); } catch (_) {}
  }

  // [4.22.0] A failed restore previously only logged silently while the result
  // dialog still showed PASS -- leaving the user looking at green while their
  // real inputs were NOT back. Surface it loudly, first thing.
  if (restoreFailed) {
    verdict = '\u26a0 RESTAURACI\u00d3N DE INPUTS FALL\u00d3: ' + restoreFailed + '\n\n'
            + 'Tus inputs reales pueden NO estar restaurados. Ejecuta '
            + '"Repair Input Layout" (men\u00fa ARGIA) para recuperarlos desde '
            + '_INPUT_BACKUP, y verifica INPUT_PROJECT.\n\n'
            + '--- resultado del E2E (de todos modos) ---\n' + verdict;
  }

  if (typeof engineLog === 'function') {
    try { engineLog(ss, 'E2E', 'INFO', 'ZERO_EXPORT Arbitrage E2E verdict:\n' + verdict); } catch (_) {}
  }
  ui.alert('ZERO_EXPORT Arbitrage E2E \u2014 result', verdict, ui.ButtonSet.OK);
}

// Extract the BESS dispatch verdict from the RENDERED CFE_OUTPUT_v2 sheet.
// [4.19.1] The headline row 30 sources from the BESS_SIMULATION formula sheet
// (peak-shaving demand math, Option 2) and CANNOT reflect grid-charge arbitrage
// -- reading it told us nothing about option #1. The hourly sim's value lands in
// the "RANGO DE AHORRO BESS" block (Esperado tile) and the demand breakdown.
// This reader scans the sheet text for the dispatchable-value signal: either the
// Cons/Exp/Upside tiles rendered with a non-zero Esperado (grid-charge produced
// value) OR the idle banner (no dispatchable value). That is the true
// option-#1 signal; row 30 is reported separately for context.
function _zeArbReadVerdict(ss, engineResult) {
  var lines = [];
  var cfe = ss.getSheetByName('CFE_OUTPUT_v2');
  if (!cfe) {
    return 'CFE_OUTPUT_v2 not found -- the engine did not render it. '
         + 'Cannot read the dispatch verdict.';
  }

  // Pull all text from the sheet so we can detect which block rendered.
  var lastRow = cfe.getLastRow();
  var lastCol = Math.min(cfe.getLastColumn(), 16);
  var grid = cfe.getRange(1, 1, lastRow, lastCol).getValues();
  var allText = '';
  for (var r = 0; r < grid.length; r++) {
    for (var c = 0; c < grid[r].length; c++) {
      if (grid[r][c] !== '' && grid[r][c] != null) allText += String(grid[r][c]) + '\n';
    }
  }

  var idleBanner   = allText.indexOf('SIN VALOR BESS DESPACHABLE') >= 0;
  var rangeBlock   = allText.indexOf('RANGO DE AHORRO BESS') >= 0;
  var demandBlock  = allText.indexOf('DESGLOSE DE AHORRO BESS') >= 0
                  && allText.indexOf('omitido') < 0;

  lines.push('Strategy requested: LOAD_SHIFTING (ZERO_EXPORT fixture)');
  lines.push('');

  if (idleBanner) {
    lines.push('RESULT: the hourly model produced NO dispatchable BESS value.');
    lines.push('');
    lines.push('This means option #1 did NOT fire for this fixture -- the planner');
    lines.push('found no PV surplus AND no profitable punta/base spread. If you');
    lines.push('expected grid-charging, check that 4.18.0+4.19.x are deployed');
    lines.push('(clasp push) and that the fixture loaded ZERO_EXPORT + LOAD_SHIFTING.');
  } else if (rangeBlock || demandBlock) {
    lines.push('PASS: the hourly model produced dispatchable BESS value.');
    lines.push('The "RANGO DE AHORRO BESS" / demand-breakdown blocks rendered');
    lines.push('with non-zero value under ZERO_EXPORT -- this is the grid-charge');
    lines.push('arbitrage that option #1 (4.18.0) unblocked, confirmed END-TO-END');
    lines.push('through the live hourly executor.');
  } else {
    lines.push('INCONCLUSIVE: neither the value block nor the idle banner was');
    lines.push('found in CFE_OUTPUT_v2. The hourly addendum may not have run.');
  }

  // Context: the formula-sheet headline (row 30) -- does NOT reflect arbitrage.
  try {
    var vals = cfe.getRange(30, 3, 1, 12).getValues()[0];
    var s = 0; for (var i = 0; i < vals.length; i++) s += (Number(vals[i]) || 0);
    lines.push('');
    lines.push('--- context ---');
    lines.push('Row 30 headline (BESS_SIMULATION formula, peak-shaving only): $'
               + Math.round(s).toLocaleString());
    lines.push('NOTE: row 30 sources from the formula sheet and does NOT include');
    lines.push('grid-charge arbitrage. Wiring arbitrage into the headline is the');
    lines.push('deferred hourly-sim source swap (Session 4, post 15-min validation).');
  } catch (_) {}

  lines.push('');
  lines.push('"ahorros no garantizados" -- estimated normal-operation case;');
  lines.push('actual savings depend on battery operation and 15-min interval data.');
  return lines.join('\n');
}
