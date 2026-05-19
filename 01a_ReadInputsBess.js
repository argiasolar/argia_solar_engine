// =============================================================================
// ARGIA ENGINE -- File: 01a_ReadInputsBess.gs
// BESS input reader. Reads the INPUT_BESS sheet and the INPUT_PROJECT
// battery toggle, returns a typed bess{} object.
//
// DESIGN CONTRACT:
//   - readInputBess(ss) returns either:
//       * a typed bess{} object  (battery toggle = YES, capacity > 0)
//       * null                   (toggle = NO, or capacity 0/blank)
//   - The returned object's field names match EXACTLY what calcBessImpact()
//     and calcPeakShavingImpact() in 04a_CalcCFEBill.gs consume:
//       capacityKwh, powerKw, strategy, minSocPct, maxSocPct, rtePct,
//       cyclesPerDay, degradationPct, backupReservePct
//     plus PEAK_SHAVING extras: loadFactorFC, puntaWindowSummerH,
//       puntaWindowWinterH, and commercial: capexMxn.
//   - null is a valid, expected return. calcBessImpact(...) already treats a
//     null/zero-capacity bess as the no-BESS path (see BESS_NULL fixture).
//
// This module is a READER ONLY. It does not calculate and does not write.
// It follows the same data-contract rule as readInputs(): only readers
// touch the spreadsheet.
//
// SEE ALSO:
//   02c_InputMap.gs   -- INPUT_MAP entries for every cell read here
//   04a_CalcCFEBill.gs -- calcBessImpact / calcPeakShavingImpact consumers
// =============================================================================

// ---------------------------------------------------------------------------
// readInputBess(ss) -> bess{} | null
//
// @param {Spreadsheet} ss  active spreadsheet
// @return {Object|null}    typed bess object, or null when battery not selected
// ---------------------------------------------------------------------------
function readInputBess(ss) {
  ss = ss || SpreadsheetApp.getActive();

  // -- 1. Battery toggle (INPUT_PROJECT!D64) --------------------------------
  // 'YES' => build the object. Anything else ('NO', blank) => null.
  var toggle = String(readInput(ss, 'installBattery') || 'NO')
                 .trim().toUpperCase();
  if (toggle !== 'YES') {
    return null;
  }

  // -- 2. Capacity gate -----------------------------------------------------
  // Toggle can be YES while the designer has not yet entered specs.
  // A zero / blank capacity is treated as "no battery" so the engine never
  // produces a degenerate BESS result. calcBessImpact() also guards this,
  // but returning null here keeps the contract explicit.
  var capacityKwh = Number(readInput(ss, 'bessCapacityKwh')) || 0;
  if (capacityKwh <= 0) {
    return null;
  }

  // -- 3. Build the typed object -------------------------------------------
  // Every numeric field is coerced; INPUT_MAP defaults already cover blanks,
  // but Number(...) is belt-and-suspenders against a stray text value.
  var bess = {
    // Selection
    batteryId:          String(readInput(ss, 'bessBatteryId')  || 'CUSTOM_MANUAL'),
    strategy:           String(readInput(ss, 'bessStrategy')   || 'SELF_CONSUMPTION_MAX'),

    // Technical specs (consumed by calcBessImpact / calcPeakShavingImpact)
    capacityKwh:        capacityKwh,
    powerKw:            Number(readInput(ss, 'bessPowerKw'))         || 0,
    minSocPct:          Number(readInput(ss, 'bessMinSocPct')),
    maxSocPct:          Number(readInput(ss, 'bessMaxSocPct')),
    rtePct:             Number(readInput(ss, 'bessRtePct')),
    cyclesPerDay:       Number(readInput(ss, 'bessCyclesPerDay')),
    degradationPct:     Number(readInput(ss, 'bessDegradationPct')),
    backupReservePct:   Number(readInput(ss, 'bessBackupReservePct')),

    // Commercial
    capexMxn:           Number(readInput(ss, 'bessCapexMxn'))        || 0,

    // PEAK_SHAVING extras (ignored by SELF_CONSUMPTION_MAX)
    loadFactorFC:       Number(readInput(ss, 'bessLoadFactorFC')),
    puntaWindowSummerH: Number(readInput(ss, 'bessPuntaWindowSummerH')),
    puntaWindowWinterH: Number(readInput(ss, 'bessPuntaWindowWinterH')),
  };

  return bess;
}