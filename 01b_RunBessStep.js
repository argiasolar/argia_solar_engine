// =============================================================================
// ARGIA ENGINE -- File: 01b_RunBessStep.gs
// BESS engine step. Called by runArgiaEngine() when the project includes a
// battery. Reads the BESS inputs, validates the battery specification, and
// returns a structured result the engine can log and surface.
//
// SCOPE (this increment):
//   - Reads INPUT_BESS via readInputBess() (toggle-aware: null when no battery).
//   - Validates the battery spec is internally consistent and physically sane.
//   - Computes battery-only derived quantities that need NO tariff data:
//       usable capacity, monthly throughput.
//   - Returns a typed result + human-readable summary lines.
//
// EXPLICITLY NOT IN SCOPE (deferred, by design):
//   - CFE bill savings (calcBessImpact needs tariffs + a PV-kWh block that
//     runArgiaEngine does not assemble — that is the CFE-simulation step's job).
//   - Writing BESS_SIMULATION (that sheet is formula-driven and already
//     verified by the Phase 4 test suite; this step must not fight it).
//   - Battery MDC / BOM rows (separate increment, separate writer + tests).
//
// This module is a CALCULATOR. It does not write to the spreadsheet.
//
// SEE ALSO:
//   01a_ReadInputsBess.gs -- readInputBess()
//   04a_CalcCFEBill.gs    -- _bessUsableKwh(), calcBessImpact() (savings, later)
// =============================================================================

// ---------------------------------------------------------------------------
// runBessStep(ss) -> result{}
//
// @param {Spreadsheet} ss  active spreadsheet
// @return {Object} result with shape:
//   {
//     bessEnabled:        boolean,   // false => project is PV-only
//     bess:               Object|null,  // the typed bess input object
//     usableCapacityKwh:  number,    // 0 when disabled
//     monthlyThroughputKwh: number,  // 0 when disabled
//     warnings:           string[],  // non-blocking issues for the designer
//     summary:            string[],  // human-readable lines for the log/alert
//   }
//
// Never throws on a disabled battery. Throws only on a genuinely invalid
// battery spec (e.g. maxSoc <= minSoc) — same discipline as calcBessImpact.
// ---------------------------------------------------------------------------
function runBessStep(ss) {
  ss = ss || SpreadsheetApp.getActive();

  var bess = readInputBess(ss);

  // -- PV-only project: clean no-op -----------------------------------------
  if (bess === null) {
    return {
      bessEnabled: false,
      bess: null,
      usableCapacityKwh: 0,
      monthlyThroughputKwh: 0,
      warnings: [],
      summary: ['BESS: not selected (PV-only project).'],
    };
  }

  // -- Validate the battery spec -------------------------------------------
  // These mirror calcBessImpact's bounds checks. We validate HERE too so the
  // engine fails early with a clear message, before any output is written.
  var v = _bessValidateSpec(bess);
  if (v.error) {
    throw new Error('runBessStep: invalid battery spec — ' + v.error);
  }

  // -- Battery-only derived quantities (no tariff data needed) -------------
  // usable_kWh = capacity x (maxSoc - minSoc) x (1 - degradation) x (1 - backup)
  var usableCapacityKwh = bess.capacityKwh
    * (bess.maxSocPct - bess.minSocPct)
    * (1 - bess.degradationPct)
    * (1 - bess.backupReservePct);

  // monthly throughput uses a 30.42-day average month (same as calcBessImpact
  // default) — this is an engine-side estimate, not a billing figure.
  var DAYS_AVG_MONTH = 30.42;
  var monthlyThroughputKwh = usableCapacityKwh
    * bess.cyclesPerDay * DAYS_AVG_MONTH * bess.rtePct;

  // -- Non-blocking warnings for the designer ------------------------------
  var warnings = v.warnings.slice();

  // C-rate sanity: power vs capacity. A battery whose power is a tiny
  // fraction of capacity (or wildly above it) is usually a data-entry slip.
  if (bess.powerKw > 0 && bess.capacityKwh > 0) {
    var cRate = bess.powerKw / bess.capacityKwh;   // 1/h
    if (cRate > 2.0) {
      warnings.push('Power/capacity ratio is ' + cRate.toFixed(2)
        + 'C — unusually high; verify INPUT_BESS C10/C11.');
    } else if (cRate < 0.1) {
      warnings.push('Power/capacity ratio is ' + cRate.toFixed(2)
        + 'C — unusually low; verify INPUT_BESS C10/C11.');
    }
  } else if (bess.powerKw <= 0) {
    warnings.push('Battery power (kW) is 0 — set INPUT_BESS C11.');
  }

  if (bess.capexMxn <= 0) {
    warnings.push('Battery CAPEX is 0 — financial outputs will be incomplete '
      + 'until INPUT_BESS C20 is set.');
  }

  // -- Human-readable summary ----------------------------------------------
  var summary = [
    'BESS: ENABLED — ' + bess.batteryId + ' / ' + bess.strategy,
    'BESS: nominal ' + bess.capacityKwh + ' kWh / ' + bess.powerKw + ' kW; '
      + 'usable ' + usableCapacityKwh.toFixed(1) + ' kWh '
      + '(SoC ' + Math.round(bess.minSocPct * 100) + '-'
      + Math.round(bess.maxSocPct * 100) + '%, '
      + 'deg ' + (bess.degradationPct * 100).toFixed(1) + '%, '
      + 'backup ' + (bess.backupReservePct * 100).toFixed(1) + '%).',
    'BESS: est. monthly throughput ' + monthlyThroughputKwh.toFixed(0)
      + ' kWh (RTE ' + Math.round(bess.rtePct * 100) + '%, '
      + bess.cyclesPerDay + ' cycle/day).',
  ];

  return {
    bessEnabled: true,
    bess: bess,
    usableCapacityKwh: usableCapacityKwh,
    monthlyThroughputKwh: monthlyThroughputKwh,
    warnings: warnings,
    summary: summary,
  };
}

// ---------------------------------------------------------------------------
// _bessValidateSpec(bess) -> { error: string|null, warnings: string[] }
//
// error    -- non-null means the spec is invalid and the engine must stop.
// warnings -- non-blocking issues worth flagging to the designer.
// ---------------------------------------------------------------------------
function _bessValidateSpec(bess) {
  var warnings = [];

  // Hard errors -- these make the battery math meaningless.
  if (!(bess.capacityKwh > 0)) {
    return { error: 'capacity must be > 0 kWh', warnings: warnings };
  }
  if (bess.minSocPct < 0 || bess.minSocPct > 1) {
    return { error: 'minSocPct must be 0-1, got ' + bess.minSocPct, warnings: warnings };
  }
  if (bess.maxSocPct < 0 || bess.maxSocPct > 1) {
    return { error: 'maxSocPct must be 0-1, got ' + bess.maxSocPct, warnings: warnings };
  }
  if (bess.maxSocPct <= bess.minSocPct) {
    return { error: 'maxSocPct (' + bess.maxSocPct + ') must exceed minSocPct ('
                    + bess.minSocPct + ')', warnings: warnings };
  }
  if (bess.rtePct <= 0 || bess.rtePct > 1) {
    return { error: 'rtePct must be 0-1, got ' + bess.rtePct, warnings: warnings };
  }
  if (bess.degradationPct < 0 || bess.degradationPct > 1) {
    return { error: 'degradationPct must be 0-1, got ' + bess.degradationPct, warnings: warnings };
  }
  if (bess.backupReservePct < 0 || bess.backupReservePct > 1) {
    return { error: 'backupReservePct must be 0-1, got ' + bess.backupReservePct, warnings: warnings };
  }
  if (!(bess.cyclesPerDay > 0)) {
    return { error: 'cyclesPerDay must be > 0, got ' + bess.cyclesPerDay, warnings: warnings };
  }

  // Soft warnings -- valid but worth a second look.
  if (bess.rtePct < 0.80) {
    warnings.push('RTE ' + Math.round(bess.rtePct * 100)
      + '% is low for a modern LFP system (typ. 88-92%).');
  }
  if (bess.degradationPct > 0.05) {
    warnings.push('Annual degradation ' + (bess.degradationPct * 100).toFixed(1)
      + '% is high (typ. 2-3%/yr).');
  }
  var socWindow = bess.maxSocPct - bess.minSocPct;
  if (socWindow < 0.50) {
    warnings.push('Usable SoC window is only ' + Math.round(socWindow * 100)
      + '% — capacity is heavily derated; verify INPUT_BESS C12/C13.');
  }

  return { error: null, warnings: warnings };
}