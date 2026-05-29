// =============================================================================
// ARGIA -- 25_CalcBessWearCost.js
// -----------------------------------------------------------------------------
// CHUNK 5 -- Session 2
//
// BATTERY WEAR COST (MXN per kWh of discharge)
// =============================================
//
// Purpose
//   Compute the marginal cost in MXN of moving one kWh through the battery,
//   amortized over the battery's expected throughput lifetime. This is the
//   "shadow rate" that LOAD_SHIFTING arbitrage must beat for the gate to
//   fire. Without this, the dispatcher accepts any positive RTE-corrected
//   spread, which leads to LS over-firing on marginal arbitrage that
//   actually destroys value once battery wear is accounted for.
//
// Formula
//   throughputLifetimeKwh = cycleLifeAt100Dod × usableKwh
//   wearCostMxnPerKwh     = capexMxn × (1 - residualValuePct)
//                          ÷ throughputLifetimeKwh
//
//   Where:
//     capexMxn          -- battery purchase + installation cost (catalog)
//     residualValuePct  -- end-of-life salvage value as fraction of CAPEX
//     cycleLifeAt100Dod -- rated cycles to 70% SoH at full depth of discharge
//     usableKwh         -- (maxSocPct - minSocPct) × capacityKwh × (1 - annualDegradationCumulative)
//
//   The "× (1 - residualValuePct)" piece reflects that not the full CAPEX
//   needs to be amortized -- you recover some at end-of-life via recycling
//   / second-life resale.
//
// Honest scope
//   This is SCREENING-tier accuracy. It does NOT model:
//     - cycle-life sensitivity to depth-of-discharge (real LFP cells last
//       longer at shallower DoD; we use the manufacturer's 100% DoD rating
//       which is the conservative lower bound)
//     - calendar aging (capacity loss from time, not just cycling)
//     - temperature-dependent degradation
//     - second-life resale premium for usable hardware
//
//   For BANKABLE-tier output, supplier-specific cycle-life curves and a
//   real second-life market price are required. Until then, this is the
//   honest screening number.
//
// Pure function -- no SpreadsheetApp, no Logger, no I/O.
// =============================================================================

/**
 * Compute battery wear cost in MXN per kWh of discharge.
 *
 * @param {Object} o
 *   capexMxn          {number}  Battery installed CAPEX (MXN). Required > 0.
 *   capacityKwh       {number}  Nominal capacity (kWh). Required > 0.
 *   minSocPct         {number}  Min SoC fraction (0..1). Default 0.05.
 *   maxSocPct         {number}  Max SoC fraction (0..1). Default 0.95.
 *   cycleLifeAt100Dod {number}  Rated cycles to EoL. Required > 0.
 *   residualValuePct  {number}  Salvage fraction (0..1). Default 0.05.
 *   degradationPct    {number}  Annual degradation 0..1. Default 0.025.
 *   warrantyYears     {number}  Used to bound effective lifetime. Default 10.
 * @return {Object}
 *   { wearCostMxnPerKwh: number|null, provenance: string, components: {...} }
 *   wearCostMxnPerKwh is null when inputs are insufficient. NEVER NaN.
 */
function calcBessWearCostMxnPerKwh(o) {
  o = o || {};
  function num(v, d) {
    var n = Number(v);
    return isFinite(n) ? n : d;
  }

  var capexMxn         = num(o.capexMxn, 0);
  var capacityKwh      = num(o.capacityKwh, 0);
  var minSocPct        = num(o.minSocPct, 0.05);
  var maxSocPct        = num(o.maxSocPct, 0.95);
  var cycleLifeCycles  = num(o.cycleLifeAt100Dod, 0);
  var residualValuePct = num(o.residualValuePct, 0.05);
  var degradationPct   = num(o.degradationPct, 0.025);
  var warrantyYears    = num(o.warrantyYears, 10);

  // --- Validity gates ---------------------------------------------------
  // We return null on insufficient input rather than 0, because 0 would
  // silently disable the LS arbitrage gate (any positive spread fires).
  // null signals "wear cost unknown, gate stays in legacy mode."
  if (capexMxn <= 0) {
    return _wearReturn(null, 'INSUFFICIENT_CAPEX', {});
  }
  if (capacityKwh <= 0) {
    return _wearReturn(null, 'INSUFFICIENT_CAPACITY', {});
  }
  if (cycleLifeCycles <= 0) {
    return _wearReturn(null, 'INSUFFICIENT_CYCLE_LIFE', {});
  }

  // --- Sanity clamp on inputs that came in malformed --------------------
  if (residualValuePct < 0) residualValuePct = 0;
  if (residualValuePct > 0.5) residualValuePct = 0.5;       // 50% salvage is the realistic max
  if (degradationPct < 0) degradationPct = 0;
  if (degradationPct > 0.10) degradationPct = 0.10;         // 10%/yr would mean total loss in 10y, beyond realistic
  if (minSocPct < 0) minSocPct = 0;
  if (maxSocPct > 1) maxSocPct = 1;
  if (maxSocPct <= minSocPct) {
    return _wearReturn(null, 'INVALID_SOC_WINDOW', {});
  }

  // --- Effective usable capacity ----------------------------------------
  // At the midpoint of the battery's life, accumulated degradation has
  // reduced usable capacity by roughly half the total expected loss.
  // For SCREENING tier, we use the midpoint as the representative usable
  // capacity over the lifetime. This is the "average kWh per cycle" the
  // wear cost amortizes against.
  var socWindow = maxSocPct - minSocPct;                            // e.g. 0.90
  var fullUsableKwh = capacityKwh * socWindow;                       // nominal kWh per cycle at year 0
  var avgYearsToEol = Math.min(warrantyYears, _yearsToReachCycleEnd(cycleLifeCycles));
  // Approximate cumulative degradation at the lifetime midpoint:
  // year-by-year compounding of (1 - degradationPct)
  var midYears = avgYearsToEol / 2;
  var midDegradationFactor = Math.pow(1 - degradationPct, midYears);
  var avgUsableKwhPerCycle = fullUsableKwh * midDegradationFactor;

  if (avgUsableKwhPerCycle <= 0) {
    return _wearReturn(null, 'ZERO_USABLE_AFTER_DEGRADATION', {});
  }

  // --- Lifetime throughput ----------------------------------------------
  var throughputLifetimeKwh = cycleLifeCycles * avgUsableKwhPerCycle;

  // --- Amortized cost ---------------------------------------------------
  var amortizedCostMxn = capexMxn * (1 - residualValuePct);
  var wearCost = amortizedCostMxn / throughputLifetimeKwh;

  return _wearReturn(wearCost, 'OK', {
    capexMxn:                  capexMxn,
    capacityKwh:               capacityKwh,
    socWindow:                 socWindow,
    fullUsableKwhAtYear0:      fullUsableKwh,
    midDegradationFactor:      midDegradationFactor,
    avgUsableKwhPerCycle:      avgUsableKwhPerCycle,
    cycleLifeCycles:           cycleLifeCycles,
    throughputLifetimeKwh:     throughputLifetimeKwh,
    residualValuePct:          residualValuePct,
    amortizedCostMxn:          amortizedCostMxn,
    avgYearsToEol:             avgYearsToEol
  });
}

// ---------------------------------------------------------------------------
// Helper: convenience wrapper to return a structured response
// ---------------------------------------------------------------------------
function _wearReturn(wearCost, provenance, components) {
  return {
    wearCostMxnPerKwh: wearCost,
    provenance:        provenance,
    components:        components
  };
}

// ---------------------------------------------------------------------------
// Helper: assume 1 cycle/day (conservative). 6000 cycles = ~16.4 years.
// We then clamp by warranty in the caller. This estimates "calendar years
// to cycle EoL at one cycle per day."
// ---------------------------------------------------------------------------
function _yearsToReachCycleEnd(cycleLife) {
  return cycleLife / 365;
}


// ---------------------------------------------------------------------------
// Catalog-row helper: turn a raw 16M_PRODUCTS_BESS row (header-keyed) into
// the calcBessWearCostMxnPerKwh input. Stays in this file so the conversion
// from catalog schema to function input lives in one place.
// ---------------------------------------------------------------------------

/**
 * Build calcBessWearCostMxnPerKwh input from a battery catalog row.
 * @param {Object} catalogRow -- header-keyed row from getAllBatteryProducts
 * @return {Object} input ready for calcBessWearCostMxnPerKwh
 */
function _wearCostInputFromCatalogRow(catalogRow) {
  if (!catalogRow) return null;
  function v(k) {
    var x = catalogRow[k];
    return (x === undefined || x === null || x === '') ? undefined : Number(x);
  }
  return {
    capexMxn:          v('Installed_CAPEX_MXN'),
    capacityKwh:       v('Nominal_Capacity_kWh'),
    minSocPct:         v('Min_SOC_%'),
    maxSocPct:         v('Max_SOC_%'),
    cycleLifeAt100Dod: v('Cycle_Life_Cycles'),
    residualValuePct:  v('Residual_Value_Pct'),
    degradationPct:    v('Annual_Degradation_%'),
    warrantyYears:     v('Warranty_Years')
  };
}
