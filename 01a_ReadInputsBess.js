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
// ---------------------------------------------------------------------------
// resolveBessVoltage  (Increment 4b-2.5b)
// ---------------------------------------------------------------------------
// Decides which voltage calcBessCircuit should use for one side (DC bus or
// AC system). Pure function -- no sheet access -- so it is fully unit-testable.
//
// Priority:
//   1. DB voltage (the selected catalog product's Nominal_Voltage_V) when it
//      is a positive number. Catalog products carry an authoritative voltage;
//      preferring it stops a designer hand-typing a wrong value for a known
//      product.
//   2. The manual INPUT_BESS cell (C18 / C19) when the DB has nothing -- this
//      is the CUSTOM_MANUAL path, and also a deliberate override hook.
//   3. 0 when neither is available. 0 means "not supplied"; calcBessCircuit
//      then returns sizeable:false and MDC §7 prints "pendiente". A 0 is a
//      valid state, never an error -- the engine must not invent a voltage.
//
// dbVoltage / manualVoltage are whatever lookupBatteryVoltage / readInput
// produced; both are coerced and screened so a blank, NaN, negative or
// non-numeric value collapses to "absent".
function resolveBessVoltage(dbVoltage, manualVoltage) {
  var db = Number(dbVoltage);
  if (isFinite(db) && db > 0) return db;
  var manual = Number(manualVoltage);
  if (isFinite(manual) && manual > 0) return manual;
  return 0;
}

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
  var batteryId = String(readInput(ss, 'bessBatteryId') || 'CUSTOM_MANUAL');

  // Voltage resolution (Increment 4b-2.5b). DC bus voltage applies to every
  // coupling; AC system voltage only matters for AC_COUPLED batteries. For
  // each side: prefer the catalog product's DB voltage, fall back to the
  // manual INPUT_BESS cell, else 0 (-> calcBessCircuit reports "pendiente").
  // lookupBatteryVoltage lives in 02_LoadDB.gs (shared global scope) and
  // already returns 0 for CUSTOM_MANUAL / unknown / not-yet-loaded DB.
  var dbVoltage = lookupBatteryVoltage(ss, batteryId);
  var dcBusVoltageV = resolveBessVoltage(
    dbVoltage, readInput(ss, 'bessDcBusVoltageV'));
  // The product DB carries one nominal voltage; there is no separate AC
  // figure in it, so the AC side resolves from the manual cell only. (dbAc
  // is passed as 0 so resolveBessVoltage falls straight through to manual.)
  var acVoltageV = resolveBessVoltage(
    0, readInput(ss, 'bessAcVoltageV'));

  var bess = {
    // Selection
    batteryId:          batteryId,
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

    // Voltage (consumed by calcBessCircuit). 0 = not supplied.
    dcBusVoltageV:      dcBusVoltageV,
    acVoltageV:         acVoltageV,

    // Commercial
    capexMxn:           Number(readInput(ss, 'bessCapexMxn'))        || 0,

    // PEAK_SHAVING extras (ignored by SELF_CONSUMPTION_MAX)
    loadFactorFC:       Number(readInput(ss, 'bessLoadFactorFC')),
    puntaWindowSummerH: Number(readInput(ss, 'bessPuntaWindowSummerH')),
    puntaWindowWinterH: Number(readInput(ss, 'bessPuntaWindowWinterH')),
  };

  return bess;
}