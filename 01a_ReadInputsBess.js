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
// Priority (BDF-7.1, manual-wins):
//   1. The manual INPUT_BESS cell (§6 C44 / C45) when it is a positive
//      number -- INPUT_* overrides MASTER_DB everywhere in the engine, and
//      this is also the CUSTOM_MANUAL path.
//   2. DB voltage (the selected catalog product's Nominal_Voltage_V) as the
//      fallback for designers who haven't typed a voltage themselves.
//   3. 0 when neither is available. 0 means "not supplied"; calcBessCircuit
//      then returns sizeable:false and MDC §7 prints "pendiente". A 0 is a
//      valid state, never an error -- the engine must not invent a voltage.
//
// resolveBessVoltage  --  BDF-7.1 (order swapped: manual first, DB fallback)
//
// dbVoltage / manualVoltage are whatever lookupBatteryVoltage / readInput
// produced; both are coerced and screened so a blank, NaN, negative or
// non-numeric value collapses to "absent".
//
// Order rationale: the rest of the engine treats INPUT_* as overrides over
// MASTER_DB defaults (e.g. INPUT_DESIGN over MASTER_DB for panels). The
// BESS path was inverted before BDF-7.1 (DB first). This is now consistent:
// manual cell wins, DB is the fallback for designers who haven't typed in
// a voltage themselves.
function resolveBessVoltage(dbVoltage, manualVoltage) {
  var manual = Number(manualVoltage);
  if (isFinite(manual) && manual > 0) return manual;
  var db = Number(dbVoltage);
  if (isFinite(db) && db > 0) return db;
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
  var capacityKwhFromCell = Number(readInput(ss, 'bessCapacityKwh')) || 0;
  if (capacityKwhFromCell <= 0) {
    return null;
  }

  // -- 3. Resolve the C6 picker selection (BDF-7.1 Path R) -----------------
  // C6 may hold one of three things:
  //   (a) a recommendation label like "2 × HW_LUNA_2MWH (4064 kWh, 2032 kW)"
  //   (b) a catalog Battery_ID like "HW_LUNA_2MWH"
  //   (c) "CUSTOM_MANUAL" (or anything unknown)
  // BDF-6's resolvePickerSelection unifies the three. When it finds a
  // recommendation or catalog entry, it returns authoritative specs --
  // capacity, power, SOC, RTE, CAPEX. We use those as the single source of
  // truth so a stacked-rec selection (whose C6 label doesn't match any
  // catalog Battery_ID) doesn't break downstream DB lookups.
  //
  // For CUSTOM_MANUAL or unknown labels, picked.found === false and we fall
  // back to the formula-cell values in C10..C14, C20 (the legacy contract).
  var c6Value = String(readInput(ss, 'bessBatteryId') || 'CUSTOM_MANUAL');
  var catalog = (typeof getAllBatteryProducts === 'function')
                ? getAllBatteryProducts(ss) : [];
  var recs = (typeof readRecommendationsForPicker === 'function')
             ? readRecommendationsForPicker(ss) : [];
  var picked = (typeof resolvePickerSelection === 'function')
               ? resolvePickerSelection(c6Value, catalog, recs)
               : { source: 'CUSTOM_MANUAL', found: false };

  // -- 4. Pick the lookup ID and specs ------------------------------------
  // batteryId      : what the designer sees (the C6 label). Stays unchanged.
  // baseBatteryId  : the catalog Battery_ID to use for DB lookups (voltage,
  //                  unit price, etc.). For stacks this resolves to the
  //                  underlying product. For catalog-direct picks it equals
  //                  batteryId. For CUSTOM_MANUAL it's empty (DB lookup
  //                  returns 0, voltage falls back to manual cell).
  // stackQty       : 1 for single units, N for stacks. Downstream BOM/MDC
  //                  line items use this to compute per-unit values and
  //                  display counts correctly.
  var batteryId = c6Value;
  var baseBatteryId = picked.found ? (picked.baseBatteryId || picked.batteryId || '') : '';
  var stackQty = Number(picked.qty) || 1;

  // Specs: prefer picker-resolved values when found. When CUSTOM_MANUAL,
  // fall back to the formula-cell values (the legacy path).
  var capacityKwh, powerKw, minSocPct, maxSocPct, rtePct, capexMxn;
  if (picked.found) {
    capacityKwh = Number(picked.capacityKwh) || capacityKwhFromCell;
    powerKw     = Number(picked.powerKw)     || (Number(readInput(ss, 'bessPowerKw')) || 0);
    minSocPct   = Number(picked.minSocPct);
    maxSocPct   = Number(picked.maxSocPct);
    rtePct      = Number(picked.rtePct);
    capexMxn    = Number(picked.capexMxn)    || (Number(readInput(ss, 'bessCapexMxn')) || 0);
  } else {
    // CUSTOM_MANUAL path: use the formula-cell values (legacy contract).
    capacityKwh = capacityKwhFromCell;
    powerKw     = Number(readInput(ss, 'bessPowerKw'))     || 0;
    minSocPct   = Number(readInput(ss, 'bessMinSocPct'));
    maxSocPct   = Number(readInput(ss, 'bessMaxSocPct'));
    rtePct      = Number(readInput(ss, 'bessRtePct'));
    capexMxn    = Number(readInput(ss, 'bessCapexMxn'))    || 0;
  }

  // -- 5. Voltage resolution ----------------------------------------------
  // DC bus voltage: manual cell first (designer override), DB fallback.
  // Use baseBatteryId for the DB lookup so stacks resolve to their
  // underlying catalog row. Empty baseBatteryId (CUSTOM_MANUAL path)
  // returns 0 from the DB and falls through to manual.
  var dbVoltage = baseBatteryId
                  ? lookupBatteryVoltage(ss, baseBatteryId)
                  : 0;
  var dcBusVoltageV = resolveBessVoltage(
    dbVoltage, readInput(ss, 'bessDcBusV'));
  // The product DB carries one nominal voltage; there is no separate AC
  // figure in it, so the AC side resolves from the manual cell only.
  var acVoltageV = resolveBessVoltage(
    0, readInput(ss, 'bessAcV'));

  // -- 6. Build the typed object ------------------------------------------
  // Contract: same field shape as before BDF-7.1 plus two new fields
  // (baseBatteryId, stackQty). Existing consumers of `bess` see no change.
  var bess = {
    // Selection
    batteryId:          batteryId,
    baseBatteryId:      baseBatteryId,    // BDF-7.1: catalog ID for DB lookups
    stackQty:           stackQty,         // BDF-7.1: units in the stack
    pickerSource:       picked.source,    // BDF-7.1: 'CATALOG'|'RECOMMENDATION'|'CUSTOM_MANUAL'
    strategy:           String(readInput(ss, 'bessStrategy')   || 'SELF_CONSUMPTION_MAX'),

    // Technical specs (consumed by calcBessImpact / calcPeakShavingImpact)
    capacityKwh:        capacityKwh,
    powerKw:            powerKw,
    minSocPct:          minSocPct,
    maxSocPct:          maxSocPct,
    rtePct:             rtePct,
    cyclesPerDay:       Number(readInput(ss, 'bessCyclesPerDay')),
    degradationPct:     Number(readInput(ss, 'bessDegradationPct')),
    backupReservePct:   Number(readInput(ss, 'bessBackupReservePct')),

    // Voltage (consumed by calcBessCircuit). 0 = not supplied.
    dcBusVoltageV:      dcBusVoltageV,
    acVoltageV:         acVoltageV,

    // Commercial
    capexMxn:           capexMxn,

    // PEAK_SHAVING extras (ignored by SELF_CONSUMPTION_MAX)
    loadFactorFC:       Number(readInput(ss, 'bessLoadFactorFC')),
    puntaWindowSummerH: Number(readInput(ss, 'bessPuntaWindowSummerH')),
    puntaWindowWinterH: Number(readInput(ss, 'bessPuntaWindowWinterH')),
  };

  return bess;
}


// ---------------------------------------------------------------------------
// readBessInstallContext(ss) -> ctx{}    BDF-7  (BDF-7.1: coupling removed)
// ---------------------------------------------------------------------------
// Reads INPUT_BESS §6 (rows 42-53) — physical install context for the BESS.
//
// IMPORTANT (BDF-7.1): coupling is NO LONGER read from INPUT_BESS!C43. The
// authoritative coupling source is INPUT_DESIGN!C17, surfaced through the
// BESS step as bessResult.coupling. The orchestrator (00_Main Step 9.6)
// injects bessResult.coupling into ctx before passing to the calc functions.
// This eliminates the duplicate-source bug class where INPUT_DESIGN said
// DC_COUPLED while a stale INPUT_BESS!C43 default said AC_COUPLED.
//
// Used by:
//   - calcBessBosQuantities (cable meters, conduit meters)
//   - calcBessVoltageDrop   (voltage drop %)
//   - calcBessNomChecks     (GEC sizing per length)
//
// Returns ALWAYS — never null. If §6 hasn't been populated, fields are 0/''.
//
// LAYOUT (each row's C column holds the value):
//   r42: § header (no value)
//   r43: (removed BDF-7.1 — was coupling, now unused; setupInputBessInstallRows
//        does not write this row anymore; existing stale values are ignored)
//   r44: dcBusV                     (V)
//   r45: acV                        (V)
//   r46: dcRunM                     (m)
//   r47: acRunM                     (m)
//   r48: cablePath                  ('INTEMPERIE' / 'CONDUIT_ENTERRADO' / 'BANDEJA_INTERIOR')
//   r49: batteriesPerContainer      (int)
//   r50: location                   ('EXTERIOR' / 'INTERIOR_TECHADO' / 'SALA_ELECTRICA')
//   r51: groundingSystem            ('UFER' / 'VARILLA' / 'RED_EXISTENTE')
//   r52: gecRunM                    (m)
//   r53: commissioningMxn           (flat fee, MXN)
function readBessInstallContext(ss) {
  ss = ss || SpreadsheetApp.getActive();
  // [A2b] Coordinates now come from INPUT_MAP (_MAP_BESS_S6, see 02c_InputMap)
  // instead of hardcoded getRange(row, 3) calls. readInput() throws when
  // INPUT_BESS is absent, so the sheet is guarded first to preserve the old
  // graceful empty return. The map defaults (numbers -> 0, dropdowns -> '')
  // reproduce the previous valNum/valStr empty-cell behavior, so this is
  // behavior-preserving for all realistic inputs (locked by the migration
  // parity test, REG_MIGRATE_BESS_INSTALL_CONTEXT). Note: readInput coerces
  // numbers with parseFloat, marginally more lenient than the old Number()
  // on trailing-garbage text — immaterial for these numeric install cells.
  if (!ss.getSheetByName('INPUT_BESS')) {
    return _bessInstallContextEmpty('INPUT_BESS sheet not found');
  }
  function valNum(key) {
    return Number(readInput(ss, key)) || 0;
  }
  function valStr(key) {
    return String(readInput(ss, key) || '').trim().toUpperCase();
  }
  return {
    // BDF-7.1: coupling intentionally absent. Orchestrator injects it.
    dcBusV:                valNum('bessDcBusV'),
    acV:                   valNum('bessAcV'),
    dcRunM:                valNum('bessDcRunM'),
    acRunM:                valNum('bessAcRunM'),
    cablePath:             valStr('bessCablePath'),
    batteriesPerContainer: valNum('bessS6BatteriesPerContainer'),
    location:              valStr('bessLocation'),
    groundingSystem:       valStr('bessGroundingSystem'),
    gecRunM:               valNum('bessGecRunM'),
    commissioningMxn:      valNum('bessCommissioningMxn'),
    provenance:            'INPUT_BESS_S6',
  };
}

// ---------------------------------------------------------------------------
// applyBessAuthoritativeContext(installCtx, bessResult) -> installCtx   [A2c]
// ---------------------------------------------------------------------------
// Overrides install-context fields that have a single authoritative source
// elsewhere in the engine, so the BoS/voltage-drop/NOM calcs can never
// diverge from the circuit calc:
//
//   coupling -- bessResult.coupling (INPUT_DESIGN!C17, BDF-7.1). A stale or
//               removed INPUT_BESS!C43 value must never reach the calcs.
//   dcBusV / acV -- bessResult.bess.dcBusVoltageV / .acVoltageV, the RESOLVED
//               voltages (manual C44/C45 wins, battery DB nominal fallback,
//               else 0 -- resolveBessVoltage). The raw C44/C45 reads in the
//               context are correct when the cells are populated, but a
//               BLANK cell reads 0 while the circuit calc resolves to the DB
//               nominal -- the same silent voltage split the 2026-06-10
//               unification fixed for the populated case. Injecting the
//               resolved values closes the blank-cell case too.
//
// Mutates and returns installCtx. Pure (no sheet access) -- unit-testable.
// Both orchestration sites (00_Main step 9.6, 13 standalone install) call
// this instead of hand-injecting coupling.
// ---------------------------------------------------------------------------
function applyBessAuthoritativeContext(installCtx, bessResult) {
  installCtx.coupling = bessResult.coupling;
  if (bessResult.bess) {
    installCtx.dcBusV = Number(bessResult.bess.dcBusVoltageV) || 0;
    installCtx.acV    = Number(bessResult.bess.acVoltageV)    || 0;
  }
  return installCtx;
}


function _bessInstallContextEmpty(reason) {
  return {
    // BDF-7.1: coupling intentionally absent (orchestrator supplies it)
    dcBusV: 0, acV: 0, dcRunM: 0, acRunM: 0,
    cablePath: '', batteriesPerContainer: 0, location: '',
    groundingSystem: '', gecRunM: 0, commissioningMxn: 0,
    provenance: 'EMPTY_' + reason,
  };
}