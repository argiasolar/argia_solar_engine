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

// Default capacity ladder (kWh). Covers commercial/industrial scale, which
// the BESS_BATTERY_LIBRARY containers (2-3.9 MWh) do not.
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

  // -- Build the candidate list: ladder + library products -----------------
  var candidates = [];
  for (var L = 0; L < ladder.length; L++) {
    candidates.push(_scoreCandidate({
      label: ladder[L] + ' kWh (ladder)',
      source: 'LADDER',
      capacityKwh: ladder[L],
      installedCapexMxn: capexPerKwh > 0 ? ladder[L] * capexPerKwh : 0,
    }, goal, usableFrac, cycles, window, maxPuntaKw, avgMonthlyPuntaKwh,
       rte, demandRate, opts));
  }
  var lib = opts.libraryProducts || [];
  for (var P = 0; P < lib.length; P++) {
    var p = lib[P];
    if (!p || !(p.capacityKwh > 0)) continue;   // skip CUSTOM/placeholder rows
    candidates.push(_scoreCandidate({
      label: (p.batteryId || 'product') + ' (' + p.capacityKwh + ' kWh)',
      source: 'LIBRARY',
      capacityKwh: p.capacityKwh,
      installedCapexMxn: _numOr(p.installedCapexMxn, 0),
    }, goal, usableFrac, cycles, window, maxPuntaKw, avgMonthlyPuntaKwh,
       rte, demandRate, opts));
  }

  // -- Pick the recommendation ---------------------------------------------
  var recommendation = _pickRecommendation(candidates, goal, opts);

  // -- Warnings ------------------------------------------------------------
  var warnings = [];
  if (provenance === 'SYNTHESIZED') {
    warnings.push('Sizing based on a SYNTHESIZED load profile (monthly CFE '
      + 'data, no 15-min intervals). Results are best-case — actual demand '
      + 'varies with which machinery runs. Confirm with a site survey.');
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
        warnings.push('No BESS_BATTERY_LIBRARY product is close to the ideal '
          + recommendation.capacityKwh + ' kWh — the library only contains '
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

  // Simple payback in years (CAPEX / annual saving). Infinity if no saving.
  var paybackYears = (annualDemandSavingMxn > 0 && cand.installedCapexMxn > 0)
    ? cand.installedCapexMxn / annualDemandSavingMxn
    : (cand.installedCapexMxn > 0 ? Infinity : null);

  return {
    label: cand.label,
    source: cand.source,
    capacityKwh: cand.capacityKwh,
    usableKwh: usableKwh,
    shaveCapableKw: shaveCapableKw,
    shavedKw: shavedKw,
    monthlyThroughputKwh: monthlyThroughputKwh,
    installedCapexMxn: cand.installedCapexMxn,
    annualDemandSavingMxn: annualDemandSavingMxn,
    paybackYears: paybackYears,
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