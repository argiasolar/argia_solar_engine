// =============================================================================
// ARGIA ENGINE -- File: 17_CalcBessSizing.gs
// Battery sizing engine. Given a site's monthly load profile and a sizing
// goal, sweeps a ladder of candidate battery capacities, scores each, and
// recommends a size. This is goal #1 of the BESS feature: "suggest capacity".
//
// DESIGN PHILOSOPHY:
//   - PURE CALCULATOR. Takes plain objects, returns a plain object. Does NOT
//     read the spreadsheet and does NOT touch the tariff layer. The caller
//     assembles the load profile and passes a demand-charge rate.
//   - This separation is deliberate: it keeps the engine unit-testable with
//     hand-derived numbers (like Phase 5/6), and it means the sizing engine
//     RANKS candidates rather than producing billing-grade pesos. The precise
//     bill impact of the CHOSEN size still comes from the already-tested
//     calcPeakShavingImpact / calcBessImpact when the engine runs it later.
//
// HONESTY CONTRACT:
//   - All sizing from MONTHLY CFE data is best-case. Every result carries a
//     provenance flag and a demand-exceedance warning. We never imply a
//     precision the monthly input cannot support.
//   - BLACKOUT_COVERAGE is NOT sized here: backup sizing needs a critical-load
//     kW and a desired autonomy (hours), neither of which exists in the CFE
//     bill. The engine returns a clear "needs more input" result instead of
//     fabricating a number.
//
// SEE ALSO:
//   04a_CalcCFEBill.gs -- calcPeakShavingImpact (precise scoring, used later)
//   01a_ReadInputsBess.gs -- readInputBess (battery spec the caller supplies)
// =============================================================================

// ---------------------------------------------------------------------------
// Sizing goals. Matches the INPUT_BESS dropdown.
// ---------------------------------------------------------------------------
var BESS_SIZING_GOAL = {
  PEAK_SHAVING:      'PEAK_SHAVING',
  LOAD_SHIFTING:     'LOAD_SHIFTING',
  BLACKOUT_COVERAGE: 'BLACKOUT_COVERAGE',
  MAX_ROI:           'MAX_ROI',
  ALL:               'ALL',
};

// PEAK_SHAVING sub-modes — how the engine decides the shave target.
var BESS_SHAVE_MODE = {
  TARGET_KW:   'TARGET_KW',     // shave punta down to a fixed kW
  PERCENT:     'PERCENT',       // shave punta by a fixed fraction
  AUTO:        'AUTO',          // sweep, pick best payback
};

// BDF-2: Interconnection mode. Changes the economic value of a kWh of
// stored energy because the alternative-use cost differs per mode.
//   NET_METERING -- surplus exports at retail (free grid storage). Battery
//                   energy-shift collapses to ~0; demand-charge saving
//                   intact. CFE Spanish: MEDICION_NETA.
//   NET_BILLING  -- surplus exports at exportPrice (typically lower than
//                   import retail). Battery captures the gap. CFE: FACTURACION_NETA.
//   ZERO_EXPORT  -- surplus is curtailed (wasted). Battery captures full
//                   punta-rate value. CFE: SIN_EXPORTACION.
//   UNKNOWN      -- mode not provided. Falls back to BDF-1 math (pure
//                   grid-to-grid arbitrage), which is conservative for
//                   NET_METERING/ZERO_EXPORT but approximate for NET_BILLING.
// See _scoreCandidate's BDF-2 block for the exact math per mode.
var BESS_INTERCONN_MODE = {
  NET_METERING: 'NET_METERING',
  NET_BILLING:  'NET_BILLING',
  ZERO_EXPORT:  'ZERO_EXPORT',
  UNKNOWN:      'UNKNOWN',
};

// Default capacity ladder (kWh). Covers commercial/industrial scale, which
// the 16M_PRODUCTS_BESS containers (2 MWh+) do not.
var BESS_SIZING_LADDER_KWH = [100, 250, 500, 1000, 2000];

// ---------------------------------------------------------------------------
// calcBessSizing(opts) -> result{}
//
// @param {Object} opts
//   loadProfile : {                  REQUIRED
//     months: [ { kwhPunta, kwPunta, days }, ... 1..12 entries ],
//     provenance: 'SYNTHESIZED' | 'METERED'   (default 'SYNTHESIZED')
//   }
//   goal           : BESS_SIZING_GOAL.*   (default PEAK_SHAVING)
//   shaveMode      : BESS_SHAVE_MODE.*     (PEAK_SHAVING only; default AUTO)
//   shaveTargetKw  : number   (shaveMode TARGET_KW — cap punta at this kW)
//   shavePercent   : number   (shaveMode PERCENT — 0..1, fraction to cut)
//   batterySpec    : {                    deration assumptions for candidates
//     minSocPct, maxSocPct, rtePct, degradationPct, backupReservePct,
//     cyclesPerDay, puntaWindowHours
//   }
//   demandChargeMxnPerKw : number   demand-charge rate for the savings estimate
//   capexMxnPerKwh       : number   installed cost per kWh, for payback ranking
//   ladderKwh            : number[] (optional override of the sweep ladder)
//   libraryProducts      : [ { batteryId, capacityKwh, powerKw,
//                              installedCapexMxn }, ... ]  (optional)
//
//   --- ADDED IN BDF-1 (energy-shift savings, Issue 3 fix) ----------------
//   puntaRateMxnPerKwh   : number   (default 0) -- punta-tariff energy rate
//   baseRateMxnPerKwh    : number   (default 0) -- base-tariff energy rate
//                                                  Both required for energy-
//                                                  shift savings calc;
//                                                  if either is 0, energy
//                                                  shift contribution is 0
//                                                  and engine falls back to
//                                                  the legacy demand-only
//                                                  estimate (no regression
//                                                  for callers that don't
//                                                  pass these yet).
//
//   --- ADDED IN BDF-2 (interconnection-mode-aware sizing) -----------------
//   interconnMode        : BESS_INTERCONN_MODE.*   (default UNKNOWN)
//   exportPriceMxnPerKwh : number   (default 0) -- only used for NET_BILLING.
//                                                  MXN/kWh credit for surplus
//                                                  PV exported to grid.
//   pvAnnualSurplusKwh   : number   (default 0) -- annual PV that's NOT
//                                                  consumed by the load.
//                                                  Used by NET_BILLING/
//                                                  ZERO_EXPORT to bound how
//                                                  much battery throughput
//                                                  is actually charged from
//                                                  solar (vs from grid base).
//
//                                                  When the battery's annual
//                                                  throughput need exceeds
//                                                  the available PV surplus,
//                                                  the OVERFLOW kWh fall
//                                                  back to BDF-1 grid-base
//                                                  arbitrage math.
//
//                                                  HONEST CAVEAT: this is a
//                                                  monthly-resolution proxy.
//                                                  In reality, surplus and
//                                                  battery-charge-need don't
//                                                  always align in TIME --
//                                                  surplus at 13:00 can't
//                                                  charge a battery that's
//                                                  already full from 12:00
//                                                  surplus. Precise math
//                                                  requires hourly modeling
//                                                  (deferred to BDF-5).
//                                                  This monthly proxy
//                                                  OVERSTATES the
//                                                  solar-charge fraction
//                                                  when battery is small
//                                                  relative to surplus,
//                                                  and is fine when battery
//                                                  is large relative to
//                                                  surplus (the CULLIGAN case).
//
// @return {Object} see buildResult() at the bottom for the full shape.
// ---------------------------------------------------------------------------
function calcBessSizing(opts) {
  opts = opts || {};
  var goal      = opts.goal || BESS_SIZING_GOAL.PEAK_SHAVING;
  var profile   = opts.loadProfile;
  var spec      = opts.batterySpec || {};
  var ladder    = opts.ladderKwh || BESS_SIZING_LADDER_KWH;

  // -- Validate the load profile -------------------------------------------
  if (!profile || !profile.months || profile.months.length === 0) {
    throw new Error('calcBessSizing: loadProfile.months is required and non-empty');
  }
  var provenance = profile.provenance || 'SYNTHESIZED';

  // -- BLACKOUT_COVERAGE: honest "not enough input" early return -----------
  if (goal === BESS_SIZING_GOAL.BLACKOUT_COVERAGE) {
    return {
      goal: goal,
      sizeable: false,
      reason: 'BLACKOUT_COVERAGE sizing needs a critical-load kW and a desired '
            + 'autonomy (hours). Neither can be derived from a CFE bill. Add '
            + 'these inputs to INPUT_BESS to enable backup sizing.',
      candidates: [],
      recommendation: null,
      warnings: [],
      provenance: provenance,
    };
  }

  // -- Deration assumptions for every candidate ----------------------------
  var minSoc = _numOr(spec.minSocPct,        0.10);
  var maxSoc = _numOr(spec.maxSocPct,        0.90);
  var rte    = _numOr(spec.rtePct,           0.90);
  var deg    = _numOr(spec.degradationPct,   0.025);
  var backup = _numOr(spec.backupReservePct, 0.0);
  var cycles = _numOr(spec.cyclesPerDay,     1.0);
  var window = _numOr(spec.puntaWindowHours, 4.0);

  if (maxSoc <= minSoc) {
    throw new Error('calcBessSizing: maxSocPct must exceed minSocPct');
  }
  if (window <= 0) {
    throw new Error('calcBessSizing: puntaWindowHours must be > 0');
  }

  // usable fraction of nominal capacity (the deration chain, single formula)
  var usableFrac = (maxSoc - minSoc) * (1 - deg) * (1 - backup);

  // -- Site demand summary from the monthly profile ------------------------
  // Peak-shaving targets the WORST month's punta demand: a battery that only
  // covers the average month will be exceeded for several months a year.
  var maxPuntaKw = 0;
  var sumPuntaKwh = 0;
  for (var i = 0; i < profile.months.length; i++) {
    var m = profile.months[i];
    if (m.kwPunta > maxPuntaKw) maxPuntaKw = m.kwPunta;
    sumPuntaKwh += (m.kwhPunta || 0);
  }
  var avgMonthlyPuntaKwh = sumPuntaKwh / profile.months.length;

  var demandRate = _numOr(opts.demandChargeMxnPerKw, 0);
  var capexPerKwh = _numOr(opts.capexMxnPerKwh, 0);

  // -- Build the candidate list: library products with stacks (BDF-4) ------
  //
  // For each library product we generate qty=1..maxStackUnits candidates.
  // Non-stackable products (Stackable=NO in DB) only emit a qty=1 candidate.
  // Stackable products emit qty=1, qty=2, ..., qty=maxStackUnits candidates,
  // each treated as an independent sizing option with LINEAR CAPEX scaling.
  //
  // CAPEX MODEL: qty × singlePrice. No volume discounts assumed. Real-world
  // CAPEX may differ (parallel BMS controllers, common inverters, container
  // infrastructure all complicate this). The simple linear assumption is
  // honest about its precision; designers should expect ±10-15% variance
  // when getting real supplier quotes for stacks.
  //
  // POWER + CAPACITY: linear (qty × single). The shave-capable formula in
  // _scoreCandidate still uses energy/window so stacks may be conservative
  // on shave kW when they're actually energy-limited (which is usually the
  // case for 4h windows). A future chunk could add the powerKw constraint
  // properly.
  //
  // LADDER FALLBACK: when libraryProducts is empty (testing / hypothetical
  // analysis paths), the engine falls back to synthesizing ladder candidates
  // at fixed kWh sizes. Production path always passes a library, so the
  // ladder fallback is invisible to designers. It's preserved for backward
  // compat with the BDF-1/2/3 unit tests that didn't pass libraryProducts.
  // When a library IS present, NO ladder candidates are generated (avoids
  // the BDF-1/2/3 issue where $0-CAPEX ladder rows out-ranked real products).
  var candidates = [];
  var lib = opts.libraryProducts || [];

  if (lib.length === 0) {
    // No library -> ladder fallback (BDF-1/2/3 backward-compat path)
    for (var L = 0; L < ladder.length; L++) {
      candidates.push(_scoreCandidate({
        label: ladder[L] + ' kWh (ladder)',
        source: 'LADDER',
        capacityKwh: ladder[L],
        installedCapexMxn: capexPerKwh > 0 ? ladder[L] * capexPerKwh : 0,
      }, goal, usableFrac, cycles, window, maxPuntaKw, avgMonthlyPuntaKwh,
         rte, demandRate, opts));
    }
  } else {
    // Library present -> expand each product into stack candidates
    for (var P = 0; P < lib.length; P++) {
      var p = lib[P];
      if (!p || !(p.capacityKwh > 0)) continue;   // skip CUSTOM/placeholder rows
      var maxQty = (p.stackable === true && p.maxStackUnits >= 1)
                   ? Math.floor(p.maxStackUnits) : 1;
      for (var qty = 1; qty <= maxQty; qty++) {
        var label = (qty === 1)
                    ? (p.batteryId || 'product') + ' (' + p.capacityKwh + ' kWh)'
                    : qty + ' × ' + (p.batteryId || 'product') + ' (' +
                      Math.round(qty * p.capacityKwh) + ' kWh, ' +
                      Math.round(qty * (p.powerKw || 0)) + ' kW)';
        candidates.push(_scoreCandidate({
          label: label,
          source: 'LIBRARY',
          capacityKwh: qty * p.capacityKwh,
          powerKw:     qty * (p.powerKw || 0),
          installedCapexMxn: qty * _numOr(p.installedCapexMxn, 0),
          // BDF-4 stack metadata for writer + tests
          stackQty:    qty,
          baseBatteryId: p.batteryId || '',
          baseCapacityKwh: p.capacityKwh,
          basePowerKw:    p.powerKw || 0,
        }, goal, usableFrac, cycles, window, maxPuntaKw, avgMonthlyPuntaKwh,
           rte, demandRate, opts));
      }
    }
  }

  // -- Pick the recommendation ---------------------------------------------
  // BDF-3: when a min-savings threshold is configured, only candidates that
  // MEET it are eligible to be the recommendation. If none meet, the
  // recommendation is null and a warning surfaces the verdict.
  var minThreshold = _numOr(opts.minAnnualSavingMxn, 0);
  var eligibleCandidates;
  if (minThreshold > 0) {
    eligibleCandidates = candidates.filter(function(c) { return c.meetsThreshold; });
  } else {
    eligibleCandidates = candidates;
  }
  var recommendation = _pickRecommendation(eligibleCandidates, goal, opts);

  // -- Warnings ------------------------------------------------------------
  var warnings = [];
  if (provenance === 'SYNTHESIZED') {
    warnings.push('Sizing based on a SYNTHESIZED load profile (monthly CFE '
      + 'data, no 15-min intervals). Results are best-case — actual demand '
      + 'varies with which machinery runs. Confirm with a site survey.');
  }

  // BDF-3: threshold verdict messaging
  if (minThreshold > 0 && !recommendation) {
    // Find the best candidate that DIDN'T meet, so we tell the designer
    // how far short we were.
    var bestBelow = null;
    for (var bi = 0; bi < candidates.length; bi++) {
      var cb = candidates[bi];
      if (!bestBelow || cb.annualSavingMxn > bestBelow.annualSavingMxn) {
        bestBelow = cb;
      }
    }
    if (bestBelow) {
      warnings.push('No candidate meets the configured minimum savings threshold '
        + '(' + Math.round(minThreshold).toLocaleString() + ' MXN/yr). '
        + 'Best candidate is ' + bestBelow.label
        + ' at ' + Math.round(bestBelow.annualSavingMxn).toLocaleString()
        + ' MXN/yr — ' + Math.round(100 * bestBelow.annualSavingMxn / minThreshold)
        + '% of threshold. Options: lower threshold, choose a different '
        + 'interconnection mode, or add a larger BESS product to the catalog.');
    }
  }

  if (recommendation) {
    // Demand-exceedance: the recommended battery is sized to the worst
    // observed month. If the plant runs heavier, demand will exceed it.
    warnings.push('Recommended battery covers the highest observed monthly '
      + 'punta demand (' + maxPuntaKw.toFixed(0) + ' kW). If the plant exceeds '
      + 'this, demand charges will not be fully shaved that month.');

    // Library-fit check: is there a real product close to the ideal size?
    if (recommendation.source === 'LADDER') {
      var fit = _nearestLibraryFit(recommendation.capacityKwh, lib);
      if (fit.product) {
        warnings.push('Ideal capacity is ' + recommendation.capacityKwh
          + ' kWh; nearest library product is ' + fit.product.batteryId
          + ' (' + fit.product.capacityKwh + ' kWh, '
          + fit.ratio.toFixed(1) + 'x). Consider a CUSTOM_MANUAL entry for '
          + 'an exact-size quote.');
      } else if (lib.length > 0) {
        warnings.push('No 16M_PRODUCTS_BESS product is close to the ideal '
          + recommendation.capacityKwh + ' kWh — the catalog only contains '
          + 'utility-scale containers. Add a C&I-scale product or use '
          + 'CUSTOM_MANUAL.');
      }
    }
  } else {
    warnings.push('No candidate produced a positive sizing result — verify '
      + 'the load profile and sizing goal.');
  }

  return {
    goal: goal,
    sizeable: true,
    reason: null,
    siteSummary: {
      maxMonthlyPuntaKw: maxPuntaKw,
      avgMonthlyPuntaKwh: avgMonthlyPuntaKwh,
      monthsAnalyzed: profile.months.length,
    },
    candidates: candidates,
    recommendation: recommendation,
    warnings: warnings,
    provenance: provenance,
  };
}

// ---------------------------------------------------------------------------
// _scoreCandidate -- compute one candidate's physical + economic score.
// ---------------------------------------------------------------------------
function _scoreCandidate(cand, goal, usableFrac, cycles, window,
                         maxPuntaKw, avgMonthlyPuntaKwh, rte,
                         demandRate, opts) {
  var usableKwh = cand.capacityKwh * usableFrac;

  // Physical shave capability: kW the battery can sustain across the punta
  // window = usable energy / window hours.
  var shaveCapableKw = usableKwh / window;

  // How much punta demand this candidate actually removes, depends on goal.
  var shavedKw;
  if (goal === BESS_SIZING_GOAL.PEAK_SHAVING || goal === BESS_SIZING_GOAL.ALL
      || goal === BESS_SIZING_GOAL.MAX_ROI) {
    var shaveMode = opts.shaveMode || BESS_SHAVE_MODE.AUTO;
    var desiredKw;
    if (shaveMode === BESS_SHAVE_MODE.TARGET_KW) {
      // cap punta at shaveTargetKw → desired reduction is the gap above it
      desiredKw = Math.max(0, maxPuntaKw - _numOr(opts.shaveTargetKw, maxPuntaKw));
    } else if (shaveMode === BESS_SHAVE_MODE.PERCENT) {
      desiredKw = maxPuntaKw * _numOr(opts.shavePercent, 0);
    } else {
      // AUTO: the battery shaves as much as it physically can
      desiredKw = maxPuntaKw;
    }
    // can't shave more than the battery can deliver, nor more than exists
    shavedKw = Math.min(shaveCapableKw, desiredKw, maxPuntaKw);
  } else {
    shavedKw = 0;
  }

  // Monthly demand-charge saving estimate (ranking-grade, not billing-grade).
  var monthlyDemandSavingMxn = shavedKw * demandRate;
  var annualDemandSavingMxn  = monthlyDemandSavingMxn * 12;

  // Energy throughput (for LOAD_SHIFTING context).
  var monthlyThroughputKwh = usableKwh * cycles * 30.42 * rte;

  // ---- BDF-2: Mode-aware energy-shift savings (extends BDF-1) ------------
  // The economic value of one shifted kWh depends on WHERE the charge energy
  // comes from AND WHAT the alternative use was. BDF-1 assumed pure grid-to-
  // grid arbitrage (charge from base-tariff grid, save at punta). BDF-2
  // splits this by interconnection mode + PV surplus availability:
  //
  //   NET_METERING -- grid stores surplus PV at full retail with zero RTE
  //                   loss. Battery competes against free grid storage and
  //                   loses; energy-shift saving collapses to ~0.
  //                   Net per shifted kWh: 0.
  //
  //   NET_BILLING  -- surplus PV exports at exportPrice (typically << retail
  //                   import). Battery captures the gap (puntaRate - export-
  //                   Price), minus RTE loss on the displaced opportunity.
  //                   Net per shifted kWh from solar surplus:
  //                        puntaRate - (exportPrice / rte)
  //                   If pvAnnualSurplusKwh < annualThroughputNeed, the
  //                   overflow falls back to grid-base arbitrage at BDF-1
  //                   math: puntaRate - (baseRate / rte).
  //
  //   ZERO_EXPORT  -- surplus PV is curtailed (wasted). Battery captures
  //                   100% of the punta-rate value because the alternative
  //                   was zero. RTE loss applies to wasted-anyway energy,
  //                   so doesn't reduce the saving when charging from
  //                   surplus. Overflow (surplus < need) falls back to
  //                   grid-base BDF-1 math.
  //
  //   UNKNOWN      -- preserves BDF-1 behavior exactly (no regression for
  //                   callers that don't yet pass interconnMode).
  //
  // HONEST CAVEAT (monthly-resolution proxy): we assume the battery can
  // capture all PV surplus up to its annual throughput need. In reality the
  // battery may be full when surplus appears, or empty when load needs it.
  // BDF-5 (hourly synthesizer) will tighten this. For sites where PV surplus
  // is much larger than battery throughput (CULLIGAN: 900 MWh surplus vs
  // ~600 MWh battery need), this monthly proxy is reasonably tight.

  var puntaRate    = _numOr(opts.puntaRateMxnPerKwh, 0);
  var baseRate     = _numOr(opts.baseRateMxnPerKwh,  0);
  var interconnMode = opts.interconnMode || BESS_INTERCONN_MODE.UNKNOWN;
  var exportPrice  = _numOr(opts.exportPriceMxnPerKwh, 0);
  var pvSurplus    = _numOr(opts.pvAnnualSurplusKwh, 0);

  var annualThroughputKwh = monthlyThroughputKwh * 12;

  // Split annual throughput between solar-charged and grid-charged.
  // Solar fraction is bounded by what's actually exportable.
  var solarChargedKwh, gridChargedKwh;
  if (interconnMode === BESS_INTERCONN_MODE.NET_BILLING
   || interconnMode === BESS_INTERCONN_MODE.ZERO_EXPORT) {
    solarChargedKwh = Math.min(pvSurplus, annualThroughputKwh);
    gridChargedKwh  = Math.max(0, annualThroughputKwh - solarChargedKwh);
  } else {
    solarChargedKwh = 0;
    gridChargedKwh  = annualThroughputKwh;
  }

  // Per-kWh net values
  var netShiftFromSolar = 0;
  var netShiftFromGrid  = 0;

  if (puntaRate > 0 && rte > 0) {
    switch (interconnMode) {
      case BESS_INTERCONN_MODE.NET_METERING:
        // Grid handles arbitrage at zero cost. Battery's time-shift adds nothing.
        netShiftFromGrid  = 0;
        netShiftFromSolar = 0;
        break;

      case BESS_INTERCONN_MODE.NET_BILLING:
        // Solar surplus: would have exported at exportPrice -> capture gap
        // Grid overflow: same arbitrage as BDF-1 (base-to-punta)
        netShiftFromSolar = puntaRate - (exportPrice / rte);
        if (baseRate > 0) {
          netShiftFromGrid = puntaRate - (baseRate / rte);
        }
        break;

      case BESS_INTERCONN_MODE.ZERO_EXPORT:
        // Solar surplus: would have been curtailed -> full punta capture,
        // no RTE penalty (the wasted energy didn't cost anything to "buy").
        // Grid overflow: BDF-1 base-to-punta arbitrage
        netShiftFromSolar = puntaRate;
        if (baseRate > 0) {
          netShiftFromGrid = puntaRate - (baseRate / rte);
        }
        break;

      case BESS_INTERCONN_MODE.UNKNOWN:
      default:
        // BDF-1 backward-compat: pure grid-to-grid arbitrage
        if (baseRate > 0) {
          netShiftFromGrid = puntaRate - (baseRate / rte);
        }
        break;
    }
  }

  // Clamp negative values to 0. Battery can choose NOT to arbitrage when it
  // would lose money (RTE eats thin tariff gaps).
  if (netShiftFromSolar < 0) netShiftFromSolar = 0;
  if (netShiftFromGrid  < 0) netShiftFromGrid  = 0;

  var annualShiftFromSolarMxn = solarChargedKwh * netShiftFromSolar;
  var annualShiftFromGridMxn  = gridChargedKwh  * netShiftFromGrid;
  var annualEnergyShiftSavingMxn = annualShiftFromSolarMxn + annualShiftFromGridMxn;

  // Legacy single-rate field (kept for backward compat with existing tests
  // and writers). Reflects the dominant charge source.
  var netShiftValueMxnPerKwh;
  if (annualThroughputKwh > 0) {
    netShiftValueMxnPerKwh = annualEnergyShiftSavingMxn / annualThroughputKwh;
  } else {
    netShiftValueMxnPerKwh = 0;
  }
  // Edge case: when no tariff rates passed AND mode is UNKNOWN, BDF-1
  // recorded the raw differential (could be negative for thin spreads).
  // Preserve that exactly for the negative-net-shift backward-compat test.
  if (puntaRate > 0 && baseRate > 0 && rte > 0
      && interconnMode === BESS_INTERCONN_MODE.UNKNOWN) {
    netShiftValueMxnPerKwh = puntaRate - (baseRate / rte);
  }

  // Total annual saving = demand + energy-shift. This is what payback
  // should be computed against.
  var annualSavingMxn = annualDemandSavingMxn + annualEnergyShiftSavingMxn;

  // ---- BDF-1: Peak coverage flag (Issue 2 fix) ---------------------------
  // shavedKw tells us how much demand the battery removed. If that's less
  // than the worst observed monthly punta demand, the customer will still
  // pay demand charges for the uncovered portion -- which is a meaningful
  // engineering surprise the legacy engine never surfaced.
  //   FULL    -- battery shaves the entire monthly punta peak (or close to)
  //   PARTIAL -- battery covers <90% of monthly peak; customer keeps paying
  //   NONE    -- battery shaves 0 kW (e.g. non-peak-shaving goal)
  var coverageRatio = (maxPuntaKw > 0) ? (shavedKw / maxPuntaKw) : 0;
  var coverageFlag;
  if (shavedKw <= 0) coverageFlag = 'NONE';
  else if (coverageRatio >= 0.90) coverageFlag = 'FULL';
  else coverageFlag = 'PARTIAL';

  // Simple payback in years (CAPEX / annual saving). Infinity if no saving.
  // Uses TOTAL saving (demand + shift), not demand-only, after BDF-1 fix.
  var paybackYears = (annualSavingMxn > 0 && cand.installedCapexMxn > 0)
    ? cand.installedCapexMxn / annualSavingMxn
    : (cand.installedCapexMxn > 0 ? Infinity : null);

  // BDF-3: Threshold check. The candidate "meets the threshold" if its total
  // annual saving is at or above the user-configured minimum. Threshold of
  // 0 (default) means no threshold -- every candidate meets by definition.
  // Per-candidate flag here; result-level "no recommendation crosses" verdict
  // happens in _pickRecommendation.
  var minAnnualSaving = _numOr(opts.minAnnualSavingMxn, 0);
  var meetsThreshold = (minAnnualSaving <= 0) ? true
                       : (annualSavingMxn >= minAnnualSaving);

  return {
    label: cand.label,
    source: cand.source,
    capacityKwh: cand.capacityKwh,
    powerKw: cand.powerKw || null,    // BDF-4: surface for table display
    usableKwh: usableKwh,
    shaveCapableKw: shaveCapableKw,
    shavedKw: shavedKw,
    monthlyThroughputKwh: monthlyThroughputKwh,
    installedCapexMxn: cand.installedCapexMxn,
    annualDemandSavingMxn: annualDemandSavingMxn,
    annualEnergyShiftSavingMxn: annualEnergyShiftSavingMxn,
    annualSavingMxn: annualSavingMxn,
    netShiftValueMxnPerKwh: netShiftValueMxnPerKwh,
    coverageRatio: coverageRatio,
    coverageFlag: coverageFlag,
    paybackYears: paybackYears,
    // BDF-2 transparency fields: where the battery's energy came from and
    // what each source was worth per kWh. Writer can show "65% solar, 35% grid"
    // so the designer knows what's driving the savings number.
    interconnMode: interconnMode,
    annualSolarChargedKwh: solarChargedKwh,
    annualGridChargedKwh:  gridChargedKwh,
    netShiftFromSolarMxnPerKwh: netShiftFromSolar,
    netShiftFromGridMxnPerKwh:  netShiftFromGrid,
    annualShiftFromSolarMxn: annualShiftFromSolarMxn,
    annualShiftFromGridMxn:  annualShiftFromGridMxn,
    // BDF-3: threshold check (true = at/above min savings, false = below)
    meetsThreshold: meetsThreshold,
    // BDF-4: stacking metadata. stackQty=1 for single units, >1 for stacks.
    // baseBatteryId/baseCapacityKwh/basePowerKw describe the SINGLE unit
    // being stacked, useful for writer display and downstream BOM later.
    stackQty:        cand.stackQty || 1,
    baseBatteryId:   cand.baseBatteryId || '',
    baseCapacityKwh: cand.baseCapacityKwh || cand.capacityKwh,
    basePowerKw:     cand.basePowerKw    || (cand.powerKw || 0),
  };
}

// ---------------------------------------------------------------------------
// _pickRecommendation -- choose the best candidate for the goal.
//   MAX_ROI            -> lowest finite payback
//   PEAK_SHAVING / ALL -> smallest capacity that shaves the full desired kW;
//                         if none fully covers it, the largest shavedKw.
//   LOAD_SHIFTING      -> smallest capacity whose throughput covers avg punta
//                         energy; else largest throughput.
// ---------------------------------------------------------------------------
function _pickRecommendation(candidates, goal, opts) {
  if (!candidates.length) return null;

  if (goal === BESS_SIZING_GOAL.MAX_ROI) {
    var best = null;
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (c.paybackYears == null || !isFinite(c.paybackYears)) continue;
      if (!best || c.paybackYears < best.paybackYears) best = c;
    }
    return best || null;
  }

  if (goal === BESS_SIZING_GOAL.LOAD_SHIFTING) {
    var target = _numOr(opts.avgMonthlyPuntaKwhOverride, null);
    // sort ascending by capacity, pick first that covers, else max throughput
    var byCap = candidates.slice().sort(function(a, b) {
      return a.capacityKwh - b.capacityKwh;
    });
    if (target != null) {
      for (var j = 0; j < byCap.length; j++) {
        if (byCap[j].monthlyThroughputKwh >= target) return byCap[j];
      }
    }
    var maxThru = byCap[0];
    for (var k = 1; k < byCap.length; k++) {
      if (byCap[k].monthlyThroughputKwh > maxThru.monthlyThroughputKwh) {
        maxThru = byCap[k];
      }
    }
    return maxThru;
  }

  // PEAK_SHAVING / ALL: smallest capacity that delivers the most shaved kW.
  // "Most shaved kW" first, then smallest capacity as the tie-breaker — so we
  // never recommend a bigger battery than needed to hit the same shave.
  var sorted = candidates.slice().sort(function(a, b) {
    if (b.shavedKw !== a.shavedKw) return b.shavedKw - a.shavedKw;
    return a.capacityKwh - b.capacityKwh;
  });
  return sorted[0];
}

// ---------------------------------------------------------------------------
// _nearestLibraryFit -- find the closest library product to a target kWh.
// Returns { product, ratio } where ratio = product.capacityKwh / target.
// ---------------------------------------------------------------------------
function _nearestLibraryFit(targetKwh, libraryProducts) {
  var best = null, bestRatio = null;
  for (var i = 0; i < (libraryProducts || []).length; i++) {
    var p = libraryProducts[i];
    if (!p || !(p.capacityKwh > 0)) continue;
    var ratio = p.capacityKwh / targetKwh;
    // "close" = within a 0.5x .. 2x band
    if (ratio >= 0.5 && ratio <= 2.0) {
      if (best === null || Math.abs(Math.log(ratio)) < Math.abs(Math.log(bestRatio))) {
        best = p; bestRatio = ratio;
      }
    }
  }
  return { product: best, ratio: bestRatio };
}

// ---------------------------------------------------------------------------
// _numOr -- coerce to a finite number, else fall back to def.
// ---------------------------------------------------------------------------
function _numOr(v, def) {
  var n = Number(v);
  return isFinite(n) ? n : def;
}