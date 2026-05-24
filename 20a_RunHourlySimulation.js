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
  var pvInfo = readMonthlyPvFromCfeSimulation(ss);
  var monthlyPv = (pvInfo.provenance === 'CFE_SIMULATION') ? { kwh: pvInfo.kwh } : null;

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
  // Demanda Facturable per month (INPUT_CFE row 19), FP (row 20),
  // 2% Baja Tension toggle (row 7)
  var inputCfe = ss.getSheetByName('INPUT_CFE');
  var demandaFacturableKw = null;
  var fpByMonth = null;
  var bajaTensionToggle = false;
  // BDF-11: kWMaxAñoMovil per month, computed with Option B + safety net:
  //   global_rolling_max = MAX( MAX(rows 13-15 across all 12 months),
  //                             MAX(row 16 across all 12 months) )
  // Then assigned as a constant to every month (CFE's rolling 12-month window
  // is global, not per-month). Option B (rows 13-15) reflects ALL demand
  // readings; safety net uses row 16 to catch partial-year-data scenarios.
  // Empty cells skipped; if NO data available, returns null and the engine
  // falls back to legacy (no BESS Capacidad effect, pre-BDF-11 behavior).
  var kWMaxAnoMovilKw = null;
  if (inputCfe) {
    demandaFacturableKw = [];
    fpByMonth = [];
    for (var c = 3; c <= 14; c++) {
      demandaFacturableKw.push(Number(inputCfe.getRange(19, c).getValue()) || 0);
      fpByMonth.push(Number(inputCfe.getRange(20, c).getValue()) || 1.0);
    }
    bajaTensionToggle = String(inputCfe.getRange(7, 3).getValue() || '')
                          .trim().toUpperCase() === 'YES';

    // BDF-11: compute Option B (max of rows 13-15)
    var optionBMax = 0;
    for (var rB = 13; rB <= 15; rB++) {
      for (var cB = 3; cB <= 14; cB++) {
        var vB = Number(inputCfe.getRange(rB, cB).getValue()) || 0;
        if (vB > optionBMax) optionBMax = vB;
      }
    }
    // BDF-11: compute safety net (max of row 16)
    var safetyMax = 0;
    for (var cS = 3; cS <= 14; cS++) {
      var vS = Number(inputCfe.getRange(16, cS).getValue()) || 0;
      if (vS > safetyMax) safetyMax = vS;
    }
    // BDF-11: take the larger of the two — defends against incomplete row 13-15
    // data when row 16 was filled from bills.
    var globalRollingMax = Math.max(optionBMax, safetyMax);
    if (globalRollingMax > 0) {
      kWMaxAnoMovilKw = new Array(12).fill(globalRollingMax);
    }
  }

  // -- Run the simulator (proposed design: with PV + battery as configured)
  var proposedResult = calcHourlySimulation({
    tariff:               billInfo.tariff,
    region:               billInfo.region,
    monthlyBill:          billInfo.monthlyBill,
    monthlyPv:            monthlyPv,
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
function _readBatterySpecForHourlySim(ss) {
  var sh = ss.getSheetByName('INPUT_BESS');
  if (!sh) return null;
  // INPUT_BESS layout (from _MAP_BESS):
  //   r10 = Capacidad nominal kWh
  //   r11 = Potencia kW
  //   r12 = Min SOC %
  //   r13 = Max SOC %
  //   r14 = RTE %
  var capacityKwh = Number(sh.getRange(10, 3).getValue()) || 0;
  if (capacityKwh <= 0) return null;  // no battery configured
  return {
    capacityKwh: capacityKwh,
    powerKw:     Number(sh.getRange(11, 3).getValue()) || 0,
    minSocPct:   Number(sh.getRange(12, 3).getValue()) || 0.10,
    maxSocPct:   Number(sh.getRange(13, 3).getValue()) || 0.90,
    rtePct:      Number(sh.getRange(14, 3).getValue()) || 0.90,
  };
}
