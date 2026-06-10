// =============================================================================
// ARGIA ENGINE -- File: 20a_RunHourlySimulation.gs   (BDF-5)
// Orchestrator for the hourly simulator.
//
// Reads inputs from live sheets:
//   - INPUT_CFE: tariff code, region, 12-month bill (base/intermedia/punta),
//                interconnection mode, export price
//   - INPUT_BESS: battery spec (capacity, power, SoC bounds, RTE)
//   - CFE_SIMULATION: monthly PV totals (kWh)
//   - INPUT_CFE: tariff rates (auto-derived)
//
// Calls calcHourlySimulation() with the assembled opts and returns the
// result for attachment to the engine result object.
//
// SAFE TO RUN MULTIPLE TIMES. No side effects on any sheet — pure read.
// =============================================================================

function runHourlySimulation(ss) {
  ss = ss || SpreadsheetApp.getActive();

  // -- Read bill + tariff + region from INPUT_CFE --------------------------
  var billInfo = buildFullBillFromInputCfe(ss);
  if (!billInfo.monthlyBill || billInfo.provenance === 'EMPTY') {
    return _hourlyBlocked('INPUT_CFE bill is empty (rows 10-15). '
      + 'Run the engine with valid CFE data before invoking hourly simulation.');
  }

  // -- Read tariff rates (all three buckets) -------------------------------
  var rateInfo = deriveFullTariffRatesFromInputCfe(ss);
  if (rateInfo.provenance === 'INSUFFICIENT_DATA') {
    // Continue — engine handles zero rates gracefully (just no cost)
    // but flag it loudly.
  }
  var tariffRates = {
    puntaMxnPerKwh:      rateInfo.puntaMxnPerKwh,
    intermediaMxnPerKwh: rateInfo.intermediaMxnPerKwh,
    baseMxnPerKwh:       rateInfo.baseMxnPerKwh,
    demandChargeMxnPerKw: 0,  // populated below
  };

  // -- Demand-charge rate --------------------------------------------------
  var demandInfo = deriveBessDemandChargeFromInputCfe(ss);
  tariffRates.demandChargeMxnPerKw = demandInfo.demandChargeMxnPerKw || 0;

  // -- Interconnection + export price --------------------------------------
  var interconn = readBessInterconnectionFromInputCfe(ss);

  // -- Monthly PV totals from CFE_SIMULATION -------------------------------
  // Chunk 7 Session 1: respect the installPv toggle. When the project does
  // NOT install new PV (battery-only scenarios 3 / 4A), force monthlyPv to
  // null -- the simulator already treats null as "no solar" (the baseline
  // run does exactly this), so the battery dispatches against the full
  // INPUT_CFE load with no new-PV subtraction and no PV-capture. This is the
  // null-PV object in action: one decision point, no scattered branches.
  var pvConfig = (typeof readInputPv === 'function')
    ? readInputPv(ss)
    : { installed: true };   // legacy fallback: behave as before (install PV)
  var pvInfo = readMonthlyPvFromCfeSimulation(ss);
  var monthlyPv = (pvConfig.installed && pvInfo.provenance === 'CFE_SIMULATION')
    ? { kwh: pvInfo.kwh }
    : null;

  // -- Chunk 7 Scenario 4B: existing-PV EXPORT capture (DATA-GATED) --------
  // The export-capture value stream is populated ONLY when the customer
  // supplied real exported kWh. We NEVER estimate export from the net bill
  // (it can't reveal hourly export). Absent -> null -> the sim runs
  // peak-shaving-only and capture is reported as "DATOS INSUFICIENTES".
  var existingPvExportMonthly = null;
  if (pvConfig.exportDataAvailable && typeof calcExistingPvMonthly === 'function'
      && pvConfig.existingExportKwh > 0) {
    // Distribute the annual exported kWh across months by the same seasonal
    // curve the PV-shape module uses. The sim shapes it to an hourly export
    // profile and feeds the battery's charging-only channel.
    var exp = calcExistingPvMonthly({ existingPvAnnualKwh: pvConfig.existingExportKwh });
    existingPvExportMonthly = { kwh: exp.monthlyKwh, source: 'EXPORT_DATA' };
  }

  // -- Battery spec from INPUT_BESS (if BESS enabled) ----------------------
  // Read defensively. If battery isn't configured, the simulator runs
  // without a battery — that's the baseline / PV-only case.
  var batterySpec = _readBatterySpecForHourlySim(ss);

  // -- BDF-5 R2: Load per-month full tariff rate table + bill inputs ------
  // Without these, the engine produces R1 output (energy+demand only) that
  // doesn't match the monthly engine's full-bill number. With them, the
  // engine computes every CFE bill component for proper side-by-side.
  var tariffRatesByMonth = null;
  var rateTable = loadCfeTariffRates(ss, billInfo.tariff, billInfo.region);
  if (rateTable.provenance === '20M_CFE_TARIFFS') {
    tariffRatesByMonth = rateTable.months;
  } else if (rateTable.provenance === 'INCOMPLETE') {
    tariffRatesByMonth = rateTable.months;  // use what we have
  }
  // [A2b] CFE monthly context (demanda facturable row 19, FP row 20, 2% baja-
  // tensión toggle row 7, BDF-11 kWMaxAñoMovil rolling max from rows 13-16)
  // extracted to _readCfeMonthlyContextForHourlySim, a readInput/INPUT_MAP-based
  // helper so it is unit-testable. Same four outputs as the old inline block.
  var _cfeCtx = _readCfeMonthlyContextForHourlySim(ss);
  var demandaFacturableKw = _cfeCtx.demandaFacturableKw;
  var fpByMonth           = _cfeCtx.fpByMonth;
  var bajaTensionToggle   = _cfeCtx.bajaTensionToggle;
  var kWMaxAnoMovilKw     = _cfeCtx.kWMaxAnoMovilKw;

  // -- Run the simulator (proposed design: with PV + battery as configured)
  var proposedResult = calcHourlySimulation({
    tariff:               billInfo.tariff,
    region:               billInfo.region,
    monthlyBill:          billInfo.monthlyBill,
    monthlyPv:            monthlyPv,
    existingPvExportMonthly: existingPvExportMonthly,   // Chunk 7 4B (gated)
    batterySpec:          batterySpec,
    interconnMode:        interconn.mode,
    exportPriceMxnPerKwh: interconn.exportPriceMxnPerKwh,
    tariffRates:          tariffRates,
    tariffRatesByMonth:   tariffRatesByMonth,
    demandaFacturableKw:  demandaFacturableKw,
    kWMaxAnoMovilKw:      kWMaxAnoMovilKw,   // BDF-11
    bajaTensionToggle:    bajaTensionToggle,
    fpByMonth:            fpByMonth,
  });

  // -- Also run a BASELINE simulation (no PV, no battery) for comparison.
  // Lets the addendum show "current bill vs proposed bill" which is the
  // designer/customer-facing number. Same inputs, just no PV/battery.
  var baselineResult = calcHourlySimulation({
    tariff:               billInfo.tariff,
    region:               billInfo.region,
    monthlyBill:          billInfo.monthlyBill,
    monthlyPv:            null,                  // no solar
    batterySpec:          null,                  // no battery
    interconnMode:        interconn.mode,
    exportPriceMxnPerKwh: interconn.exportPriceMxnPerKwh,
    tariffRates:          tariffRates,
    tariffRatesByMonth:   tariffRatesByMonth,
    demandaFacturableKw:  demandaFacturableKw,
    kWMaxAnoMovilKw:      kWMaxAnoMovilKw,   // BDF-11
    bajaTensionToggle:    bajaTensionToggle,
    fpByMonth:            fpByMonth,
  });

  // Attach baseline + provenance for downstream display
  proposedResult.baseline = {
    totalCostMxn:   baselineResult.annual.totalCostMxn,
    fullBill:       baselineResult.annual.fullBill,
    energyCostMxn:  baselineResult.annual.energyCostMxn,
    demandChargeMxn: baselineResult.annual.demandChargeMxn,
    gridImportKwh:  baselineResult.annual.gridImportKwh,
  };
  proposedResult.savingsMxn =
    baselineResult.annual.totalCostMxn - proposedResult.annual.totalCostMxn;

  // Attach provenance about input sources for downstream display
  proposedResult.inputProvenance = {
    bill:           billInfo.provenance,
    rates:          rateInfo.provenance,
    rateTable:      rateTable.provenance,
    demandCharge:   demandInfo.provenance,
    interconn:      interconn.provenance,
    pv:             pvInfo.provenance,
    battery:        batterySpec ? 'INPUT_BESS' : 'NONE',
  };

  // Chunk 7 Session 1: attach PV config + scenario classification so
  // downstream writers / BaaS can label the project (PV-only, PV+Battery,
  // battery-only greenfield, battery-only with existing PV) and surface the
  // 4A "existing-solar capture not modeled" disclaimer.
  proposedResult.pvConfig = pvConfig;
  if (typeof classifyScenario === 'function') {
    proposedResult.scenario = classifyScenario(pvConfig, !!batterySpec);
  }

  // Chunk 7 Scenario 4B: surface the export-capture data tier so the writer
  // can show either the capture value or the "DATOS INSUFICIENTES" guidance.
  // Peak-shaving economics are ALWAYS present (from the CFE bill); only the
  // export-capture stream is gated on real export data.
  proposedResult.existingPvExport = {
    available:    !!pvConfig.exportDataAvailable,
    exportKwh:    Number(pvConfig.existingExportKwh) || 0,
    captureModeled: !!(existingPvExportMonthly)
  };

  // Chunk 7 4B regime-netting: compute the HONEST capture value -- net of
  // what the exported energy was already worth under the interconnection
  // regime. Attached as its own field; NEVER blended into CFE savings.
  if (existingPvExportMonthly && typeof calcCaptureNetValue === 'function'
      && batterySpec) {
    // Captured kWh is bounded by the battery's annual throughput: it can't
    // soak more export than it can cycle. usableKwh x cycles/day x 365.
    var cyclesPerDay = Number(batterySpec.cyclesPerDay) || 1;
    var annualThroughput = (Number(batterySpec.usableKwh)
                            || (batterySpec.capacityKwh * 0.8)) * cyclesPerDay * 365;
    var exportAnnual = Number(pvConfig.existingExportKwh) || 0;
    var capturedKwh = Math.min(exportAnnual, annualThroughput);

    // Discharge value per kWh: the punta rate the battery offsets when it
    // discharges the captured energy (conservative -- ignores demand savings,
    // which peak-shaving already counts separately to avoid double-count).
    var puntaRate = Number(tariffRates.puntaMxnPerKwh) || 0;
    // Offset rate for MEDICION_NETA prior-worth: the energy rate the export
    // already displaced (~ the punta/retail rate). Use punta as the proxy.
    proposedResult.existingPvExport.captureNetValue = calcCaptureNetValue({
      capturedKwh:               capturedKwh,
      dischargeValueMxnPerKwh:   puntaRate,
      interconnMode:             interconn.mode,
      exportPriceMxnPerKwh:      interconn.exportPriceMxnPerKwh,
      offsetEnergyRateMxnPerKwh: puntaRate
    });
  }

  // Chunk 7 Session 2: attach the RESILIENCE value as its OWN field, never
  // blended into savingsMxn / CFE numbers. The writer shows it on a separate
  // line with its source qualifier. Computed here because it needs the
  // usable capacity + the value-source guard.
  if (typeof calcResilience === 'function' && batterySpec && batterySpec.resilienceInputs) {
    var ri = batterySpec.resilienceInputs;
    proposedResult.resilience = calcResilience({
      criticalLoadKw:      ri.criticalLoadKw,
      backupDurationHours: ri.backupDurationHours,
      usableKwh:           ri.usableKwh,
      eventsPerYear:       ri.eventsPerYear,
      eventCostMxn:        ri.eventCostMxn,
      eventValueSource:    ri.eventValueSource
    });
  }
  // -- Chunk 5 Session 3: AUTO_OPTIMIZE strategy evaluator ----------------
  // Reuses the monthCtxs the proposed run already built (surfaced as
  // bessMonthlyContexts). Produces Conservative/Expected/Upside bounds
  // from the planner ledgers -- no extra full sim runs (decision 1c).
  // Expected headline still comes from the real full-bill proposed run.
  if (typeof _runBessAutoOptimize === 'function'
      && proposedResult.bessMonthlyContexts) {
    var selectedStrat = (batterySpec && batterySpec.strategy)
      ? String(batterySpec.strategy) : 'PEAK_SHAVING';
    proposedResult.autoOptimize = _runBessAutoOptimize(
      proposedResult.bessMonthlyContexts,
      { selectedStrategy: selectedStrat }
    );
  }

  return proposedResult;
}

function _hourlyBlocked(reason) {
  return {
    blocked: reason,
    hours: [], warnings: [],
    annual: { loadKwh: 0, energyCostMxn: 0, demandChargeMxn: 0, totalCostMxn: 0 },
    inputProvenance: {},
  };
}

// Read battery spec from INPUT_BESS. Returns null if the project doesn't
// have a battery configured. Uses the cells already mapped in 02c_InputMap.
// [A2b] CFE monthly context for the hourly sim, extracted from runHourlySimulation
// so it can be unit-tested. Reads via readInput/INPUT_MAP. Returns the same four
// values the old inline INPUT_CFE block produced, with identical empty-cell
// coercion (Number||0 ; FP Number||1.0) and the BDF-11 rolling-max logic
// (global max of kW rows 13-15 and row 16; null when no data). Defaults
// (nulls / false) when INPUT_CFE is absent.
function _readCfeMonthlyContextForHourlySim(ss) {
  ss = ss || SpreadsheetApp.getActive();
  var out = {
    demandaFacturableKw: null,
    fpByMonth: null,
    bajaTensionToggle: false,
    kWMaxAnoMovilKw: null
  };
  if (!ss.getSheetByName('INPUT_CFE')) return out;
  var rDemanda = readInput(ss, 'cfeDemandaFacturable')[0];  // C19:N19
  var rFp      = readInput(ss, 'cfeFpPct')[0];               // C20:N20
  var rKwBase  = readInput(ss, 'cfeKwBase')[0];              // C13:N13
  var rKwInter = readInput(ss, 'cfeKwIntermedia')[0];        // C14:N14
  var rKwPunta = readInput(ss, 'cfeKwPunta')[0];             // C15:N15
  var rKwMax   = readInput(ss, 'cfeKwMaxAnoMovil')[0];       // C16:N16
  out.demandaFacturableKw = [];
  out.fpByMonth = [];
  for (var i = 0; i < 12; i++) {
    out.demandaFacturableKw.push(Number(rDemanda[i]) || 0);
    out.fpByMonth.push(Number(rFp[i]) || 1.0);
  }
  // Toggle compares against 'YES' as before (pre-existing; the dropdown is
  // SI/NO). cfeBajaTension2pct default 'NO' preserves the empty-cell result
  // ('NO' !== 'YES' -> false), matching the old empty-string behavior.
  out.bajaTensionToggle = String(readInput(ss, 'cfeBajaTension2pct') || '')
                            .trim().toUpperCase() === 'YES';
  // BDF-11: Option B = max of kW rows 13-15 across all months
  var optionBMax = 0;
  var kwRows = [rKwBase, rKwInter, rKwPunta];
  for (var rB = 0; rB < kwRows.length; rB++) {
    for (var cB = 0; cB < 12; cB++) {
      var vB = Number(kwRows[rB][cB]) || 0;
      if (vB > optionBMax) optionBMax = vB;
    }
  }
  // BDF-11: safety net = max of row 16
  var safetyMax = 0;
  for (var cS = 0; cS < 12; cS++) {
    var vS = Number(rKwMax[cS]) || 0;
    if (vS > safetyMax) safetyMax = vS;
  }
  var globalRollingMax = Math.max(optionBMax, safetyMax);
  if (globalRollingMax > 0) {
    out.kWMaxAnoMovilKw = new Array(12).fill(globalRollingMax);
  }
  return out;
}

function _readBatterySpecForHourlySim(ss) {
  ss = ss || SpreadsheetApp.getActive();
  // [A2b] reads via INPUT_MAP (_MAP_BESS); sheet guarded first because readInput
  // throws on a missing sheet (the old function returned null in that case).
  // Map defaults match the prior inline fallbacks exactly: capacity 0, minSoc
  // 0.10, maxSoc 0.90, rte 0.90, cyclesPerDay 1, all others 0. bessStrategy's
  // map default is '' so an empty C7 still falls through to the 'PEAK_SHAVING'
  // fallback below, unchanged. INPUT_BESS layout (from _MAP_BESS):
  //   r10 Capacidad kWh · r11 Potencia kW · r12 Min SOC · r13 Max SOC · r14 RTE
  if (!ss.getSheetByName('INPUT_BESS')) return null;
  var capacityKwh = Number(readInput(ss, 'bessCapacityKwh')) || 0;
  if (capacityKwh <= 0) return null;  // no battery configured
  // 3.7.9: read strategy (C7) so the hourly dispatcher can prioritize.
  // Blank/unknown falls back to PEAK_SHAVING inside the simulator.
  var strategy = String(readInput(ss, 'bessStrategy') || '').trim().toUpperCase();

  // Chunk 7 Session 2: read the backup reserve (C17) -- previously the hourly
  // sim never read this, so any reserve was ignored (savings over-credited).
  var minSocPct = Number(readInput(ss, 'bessMinSocPct')) || 0.10;
  var maxSocPct = Number(readInput(ss, 'bessMaxSocPct')) || 0.90;
  var backupReservePct = Number(readInput(ss, 'bessBackupReservePct')) || 0;

  // Chunk 7 Session 2: RESILIENCE section (7.) -- physical critical-load
  // backup spec. Rows 58-62 (col C). Rows 42-53 hold the pre-existing
  // DISTANCIAS section, so resilience lives below it in the empty zone.
  // Blank/0 => no resilience reserve.
  var criticalLoadKw      = Number(readInput(ss, 'bessCriticalLoadKw')) || 0;
  var backupDurationHours = Number(readInput(ss, 'bessBackupDurationHours')) || 0;
  var eventsPerYear       = Number(readInput(ss, 'bessEventsPerYear')) || 0;
  var eventCostMxn        = Number(readInput(ss, 'bessEventCostMxn')) || 0;
  var eventValueSource    = String(readInput(ss, 'bessEventValueSource') || '').trim().toUpperCase();

  // Compute the resilience reserve fraction (physical reserve / usable). The
  // pure calc lives in calcResilience; here we just need the fraction to feed
  // the hourly-sim usable reduction. usable = cap x (maxSoc - minSoc).
  var usableKwh = capacityKwh * (maxSocPct - minSocPct);
  var resilienceReservedFrac = 0;
  if (typeof calcResilience === 'function' && criticalLoadKw > 0 && backupDurationHours > 0) {
    var rc = calcResilience({
      criticalLoadKw: criticalLoadKw, backupDurationHours: backupDurationHours,
      usableKwh: usableKwh
    });
    resilienceReservedFrac = rc.reservedFracOfUsable;
  }

  return {
    capacityKwh: capacityKwh,
    powerKw:     Number(readInput(ss, 'bessPowerKw')) || 0,
    minSocPct:   minSocPct,
    maxSocPct:   maxSocPct,
    rtePct:      Number(readInput(ss, 'bessRtePct')) || 0.90,
    strategy:    strategy || 'PEAK_SHAVING',
    // Chunk 7 4B: surfaced for the capture-throughput cap.
    usableKwh:    usableKwh,
    cyclesPerDay: Number(readInput(ss, 'bessCyclesPerDay')) || 1,
    // Chunk 7 Session 2: reserve fields consumed by 20_ planUsable reduction.
    backupReservePct:        backupReservePct,
    resilienceReservedFrac:  resilienceReservedFrac,
    // Resilience spec carried for the value calc + writer (separate line).
    resilienceInputs: {
      criticalLoadKw: criticalLoadKw, backupDurationHours: backupDurationHours,
      eventsPerYear: eventsPerYear, eventCostMxn: eventCostMxn,
      eventValueSource: eventValueSource, usableKwh: usableKwh
    }
  };
}
