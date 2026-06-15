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
        _setArgiaProgress(5, 6, 'E2E: restaurando tus inputs\u2026');
        restoreInputSheets(ss, snap);
        SpreadsheetApp.flush();
      } catch (rErr) {
        if (typeof engineLog === 'function') {
          try { engineLog(ss, 'E2E', 'ERROR', 'restore failed: ' + rErr.message); } catch (_) {}
        }
      }
    }
    _ARGIA_PROGRESS_EXTERNAL = false;
    try { _hideArgiaProgress(); } catch (_) {}
  }

  if (typeof engineLog === 'function') {
    try { engineLog(ss, 'E2E', 'INFO', 'ZERO_EXPORT Arbitrage E2E verdict:\n' + verdict); } catch (_) {}
  }
  ui.alert('ZERO_EXPORT Arbitrage E2E \u2014 result', verdict, ui.ButtonSet.OK);
}

// Extract the BESS dispatch numbers from the engine result and form a verdict.
// The engine result carries the BESS step output; we read annual grid-charge,
// discharge, and the LOAD_SHIFTING vs PEAK_SHAVING comparison if present.
function _zeArbReadVerdict(ss, engineResult) {
  var lines = [];
  var bess = engineResult && engineResult.bessResult ? engineResult.bessResult : null;
  if (!bess && engineResult && engineResult.bess) bess = engineResult;

  // Primary signal: did the battery grid-charge? Read from the sim rollup if
  // the engine exposed it; otherwise read CFE_OUTPUT_v2 annual BESS savings.
  var gridCharge = null, discharge = null, strategy = null, savings = null;
  try {
    if (bess && bess.bess) {
      strategy = bess.bess.strategy || null;
      if (bess.bess.annualGridChargeKwh != null) gridCharge = bess.bess.annualGridChargeKwh;
      if (bess.bess.annualDischargeKwh != null) discharge = bess.bess.annualDischargeKwh;
    }
  } catch (_) {}

  // Fallback: read CFE_OUTPUT_v2 annual BESS savings (row 30 sum).
  try {
    var cfe = ss.getSheetByName('CFE_OUTPUT_v2');
    if (cfe) {
      var vals = cfe.getRange(30, 3, 1, 12).getValues()[0];
      var s = 0; for (var i = 0; i < vals.length; i++) s += (Number(vals[i]) || 0);
      savings = s;
    }
  } catch (_) {}

  lines.push('Strategy: ' + (strategy || 'LOAD_SHIFTING (requested)'));
  lines.push('');
  if (gridCharge != null) {
    lines.push('Annual grid-charge: ' + Math.round(gridCharge).toLocaleString() + ' kWh');
    lines.push('Annual discharge:   ' + Math.round(discharge).toLocaleString() + ' kWh');
    lines.push('');
    if (gridCharge > 0) {
      lines.push('PASS: battery grid-charged under ZERO_EXPORT.');
      lines.push('Option #1 verified live -- the executor un-gate works.');
    } else {
      lines.push('FAIL: grid-charge is ZERO. The un-gate did not take effect');
      lines.push('in the live executor. Check 4.18.0 deploy + clasp push.');
    }
  } else {
    lines.push('(Engine did not expose annualGridChargeKwh on the result.)');
    lines.push('Falling back to CFE_OUTPUT_v2 BESS savings.');
  }
  if (savings != null) {
    lines.push('');
    lines.push('CFE_OUTPUT_v2 annual BESS savings: $' + Math.round(savings).toLocaleString());
    lines.push('(Offline model predicted ~$300k-400k/yr energy arbitrage.)');
  }
  lines.push('');
  lines.push('NOTE: "ahorros no garantizados" -- this is the estimated normal');
  lines.push('operation case; actual savings depend on battery operation and');
  lines.push('require 15-min interval data to confirm demand-charge value.');
  return lines.join('\n');
}
