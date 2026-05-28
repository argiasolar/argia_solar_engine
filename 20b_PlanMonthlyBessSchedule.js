// =============================================================================
// ARGIA -- 20b_PlanMonthlyBessSchedule.js
// -----------------------------------------------------------------------------
// CHUNK 5 -- Session 1
//
// MONTHLY STRATEGY PLANNER (SCREENING tier)
// ==========================================
//
// This is Level 1 of the two-level BESS dispatcher: a pure function that
// turns one month of typical-day data into a 24-hour schedule of
// {pv-charge, grid-charge, discharge}. Level 2 (Session 2) walks 8760
// hours and consults this schedule. The split lets us reason about
// non-local effects -- monthly demand peaks, daily cycle budget,
// arbitrage profitability vs wear -- that the legacy greedy per-hour
// code structurally can't see.
//
// TIER
//   This module produces SCREENING-tier output. Suitable for:
//     - early project screening
//     - comparing PV / BESS / PV+BESS at the order-of-magnitude level
//     - internal proposals
//   NOT suitable for:
//     - guaranteed savings
//     - PPA/lease financial commitment
//     - bankable ROI
//     - final battery sizing
//   The SCREENING label is structural -- the writer in Session 3 must
//   respect it and not display anything that looks like a financial
//   commitment.
//
// CONTRACT
//   See docs/CHUNK_5_SESSION1_SPEC.md for the locked contract:
//     - monthCtx shape (input)
//     - schedule shape (output)
//     - invariants I1..I8
//     - strategy semantics
//     - priority stack (P1..P4)
//     - PS=SC convergence (deferred refinement, not by-design)
//     - LS arbitrage gate (NET_BILLING + spread*rte > rateBase + wearCost)
//
// NOT YET WIRED
//   Reachable only by tests in Session 1. Session 2 plugs it into
//   calcHourlySimulation by replacing the per-hour _bessDispatchHour body
//   with a schedule-lookup executor.
// =============================================================================


// ---------------------------------------------------------------------------
// Dispatch priorities -- the fixed stack every strategy MUST respect.
// Strategies select WHICH priorities are active for them. Order is fixed.
// ---------------------------------------------------------------------------

var BESS_DISPATCH_PRIORITIES = [
  'P1_AVOID_NEW_PEAK',   // Hard constraint (I6) -- never violated by any strategy.
  'P2_CAPTURE_PV',       // Soak available PV surplus into the battery.
  'P3_REDUCE_PUNTA',     // Discharge in punta hours to cut demand + energy charges.
  'P4_ARBITRAGE'         // Grid-charge in base to discharge in punta. LS only.
];

var BESS_STRATEGY_PRIORITIES = {
  PEAK_SHAVING:         ['P1_AVOID_NEW_PEAK', 'P2_CAPTURE_PV', 'P3_REDUCE_PUNTA'],
  SELF_CONSUMPTION_MAX: ['P1_AVOID_NEW_PEAK', 'P2_CAPTURE_PV', 'P3_REDUCE_PUNTA'],
  LOAD_SHIFTING:        ['P1_AVOID_NEW_PEAK', 'P2_CAPTURE_PV', 'P3_REDUCE_PUNTA', 'P4_ARBITRAGE']
};


// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Plan a one-month BESS schedule.
 *
 * @param {Object} monthCtx -- see docs/CHUNK_5_SESSION1_SPEC.md §1.1.
 *   Required fields: bucketByHour, loadByHour, pvByHour, batteryCapKwh,
 *     batteryPowerKw, minSocKwh, maxSocKwh, usableKwh, rte,
 *     interconnMode, rateBase, rateInter, ratePunta.
 *   Optional fields:
 *     planningDemandLimitKw    -- if absent, derived from load/PV
 *     actualBilledDemandKw     -- if present, planningDemandLimitKw becomes
 *                                 max(synthetic, actualBilledDemandKw)
 *     wearCostMxnPerKwh        -- if present, LS gate stricter
 *     demandRates              -- { capacidadMxnPerKw, distribucionMxnPerKw }
 *                                 used for est-MXN ledger fields
 * @param {string} strategy -- 'PEAK_SHAVING' | 'SELF_CONSUMPTION_MAX' | 'LOAD_SHIFTING'
 * @return {Object} schedule -- see spec §1.2
 */
function _planMonthlyBessSchedule(monthCtx, strategy) {
  var ctx = _planNormalizeCtx(monthCtx);
  var strat = (strategy || 'PEAK_SHAVING').toUpperCase();
  if (!BESS_STRATEGY_PRIORITIES.hasOwnProperty(strat)) strat = 'PEAK_SHAVING';

  // No battery -> empty schedule.
  if (ctx.batteryCapKwh <= 0 || ctx.usableKwh <= 0 || ctx.batteryPowerKw <= 0) {
    return _planEmptySchedule(ctx, strat, 'no battery or zero usable capacity');
  }

  // PS = SC at Level 1 is a deferred refinement, not by design.
  // The hourly tiebreaker that distinguishes them (PV-capture-first vs
  // punta-discharge-first) almost never fires in the GDMTH clock structure.
  // Documented in spec §2.2.
  var schedule;
  if (strat === 'SELF_CONSUMPTION_MAX') {
    schedule = _planPeakShaving(ctx, 'SELF_CONSUMPTION_MAX');
  } else if (strat === 'LOAD_SHIFTING') {
    schedule = _planLoadShifting(ctx);
  } else {
    schedule = _planPeakShaving(ctx, 'PEAK_SHAVING');
  }

  _planFinalizeMeta(schedule, ctx, strat);
  return schedule;
}


// ---------------------------------------------------------------------------
// Input normalization -- defensive defaults so the planner never NaNs.
// ---------------------------------------------------------------------------

function _planNormalizeCtx(o) {
  function arr24(a, fill) {
    var out = new Array(24);
    for (var h = 0; h < 24; h++) {
      var v = (a && a[h] != null) ? Number(a[h]) : fill;
      out[h] = isFinite(v) ? v : fill;
    }
    return out;
  }
  function num(v, d) {
    var n = Number(v);
    return isFinite(n) ? n : d;
  }
  var loadByHour = arr24(o && o.loadByHour, 0);
  var pvByHour = arr24(o && o.pvByHour, 0);
  var bucketByHour = new Array(24);
  for (var h = 0; h < 24; h++) {
    var b = (o && o.bucketByHour && o.bucketByHour[h]) ? String(o.bucketByHour[h]) : 'base';
    bucketByHour[h] = (b === 'punta' || b === 'intermedia') ? b : 'base';
  }
  var batteryCapKwh = Math.max(0, num(o && o.batteryCapKwh, 0));
  var batteryPowerKw = Math.max(0, num(o && o.batteryPowerKw, 0));
  var minSocKwh = Math.max(0, num(o && o.minSocKwh, 0));
  var maxSocKwh = Math.max(minSocKwh, num(o && o.maxSocKwh, batteryCapKwh));
  var usableKwh = Math.max(0, (o && o.usableKwh != null)
                              ? num(o.usableKwh, maxSocKwh - minSocKwh)
                              : maxSocKwh - minSocKwh);
  var rte = num(o && o.rte, 0.913);
  if (rte <= 0 || rte > 1) rte = 0.913;

  // Synthetic planning limit -- the schedule-independent reference.
  var syntheticLimit = 0;
  for (var i = 0; i < 24; i++) {
    var net = loadByHour[i] - pvByHour[i];
    if (net > syntheticLimit) syntheticLimit = net;
  }

  // Actual billed demand -- if supplied, becomes the conservative ceiling.
  // Per reviewer R2 §2.1: demand charges are often the reason batteries exist;
  // the planner must not plan around a peak smaller than what CFE already bills.
  var actualBilledDemandKw = num(o && o.actualBilledDemandKw, 0);

  // The PLANNING limit -- the max kW that grid charging cannot push the
  // net import above. Named per reviewer R3 §1: this is not a physical
  // constraint on the battery, it's a guardrail on the planner.
  var planningDemandLimitKw;
  if (o && o.planningDemandLimitKw != null) {
    planningDemandLimitKw = Math.max(0, num(o.planningDemandLimitKw, 0));
  } else {
    planningDemandLimitKw = Math.max(syntheticLimit, actualBilledDemandKw);
  }

  // Wear cost -- optional. When present, LS gate uses strict form.
  var wearCostMxnPerKwh = (o && o.wearCostMxnPerKwh != null)
    ? Math.max(0, num(o.wearCostMxnPerKwh, 0))
    : null;

  // Demand rates -- optional, used for est-MXN ledger fields.
  var demandRates = (o && o.demandRates) ? {
    capacidadMxnPerKw:    num(o.demandRates.capacidadMxnPerKw, 0),
    distribucionMxnPerKw: num(o.demandRates.distribucionMxnPerKw, 0)
  } : null;

  return {
    monthIndex:           num(o && o.monthIndex, 0),
    daysInMonth:          Math.max(1, num(o && o.daysInMonth, 30)),
    bucketByHour:         bucketByHour,
    loadByHour:           loadByHour,
    pvByHour:             pvByHour,
    batteryCapKwh:        batteryCapKwh,
    batteryPowerKw:       batteryPowerKw,
    minSocKwh:            minSocKwh,
    maxSocKwh:            maxSocKwh,
    usableKwh:            usableKwh,
    rte:                  rte,
    interconnMode:        (o && o.interconnMode) ? String(o.interconnMode) : 'UNKNOWN',
    rateBase:             num(o && o.rateBase, 0),
    rateInter:            num(o && o.rateInter, 0),
    ratePunta:            num(o && o.ratePunta, 0),
    syntheticLimitKw:     syntheticLimit,
    actualBilledDemandKw: actualBilledDemandKw,
    planningDemandLimitKw: planningDemandLimitKw,
    wearCostMxnPerKwh:    wearCostMxnPerKwh,
    demandRates:          demandRates
  };
}


// ---------------------------------------------------------------------------
// Bell-curve synthetic PV shape utility (reviewer R2 §2.2)
// ---------------------------------------------------------------------------
//
// Produces a 24-hour PV-kWh-per-hour vector for one day, normalized so
// the integral equals dailyKwh. Bell shape is a half-sine across hours
// 6..19 (14 daylight hours), zero elsewhere. Better than flat for
// reasoning about when surplus is actually available.
//
// The caller decides whether to use this or pass in a real hourly PV
// shape from Helioscope (future). The planner itself just consumes
// monthCtx.pvByHour.
// ---------------------------------------------------------------------------

function _planSyntheticPvBellShape(dailyKwh) {
  var pv = new Array(24).fill(0);
  if (!(dailyKwh > 0)) return pv;
  var DAY_START = 6, DAY_END = 19;
  var WINDOW = (DAY_END - DAY_START) + 1;  // 14 hours
  // Raw sin values, then normalize to sum=dailyKwh
  var raw = new Array(24).fill(0);
  var sum = 0;
  for (var h = DAY_START; h <= DAY_END; h++) {
    var t = (h - DAY_START) / (WINDOW - 1);   // 0..1 across daylight
    var s = Math.sin(Math.PI * t);            // peak at solar noon (~12:30)
    raw[h] = s;
    sum += s;
  }
  if (sum <= 0) return pv;
  for (var k = 0; k < 24; k++) pv[k] = raw[k] * dailyKwh / sum;
  return pv;
}


// ---------------------------------------------------------------------------
// Empty schedule -- used when battery is missing or PS finds no PV
// ---------------------------------------------------------------------------

function _planEmptySchedule(ctx, strat, note) {
  return {
    chargeByHour:     new Array(24).fill(0),
    gridChargeByHour: new Array(24).fill(0),
    dischargeByHour:  new Array(24).fill(0),
    meta: {
      tier:                    'SCREENING',
      strategy:                strat,
      dailyDischargeBudgetKwh: 0,
      dailyChargeBudgetKwh:    0,
      pvChargeKwh:             0,
      gridChargeKwh:           0,
      planningDemandLimitKw:   ctx ? ctx.planningDemandLimitKw : 0,
      notes:                   note ? [note] : [],
      // Ledger + priorityResults filled by _planFinalizeMeta
    }
  };
}


// ---------------------------------------------------------------------------
// PEAK_SHAVING (also SELF_CONSUMPTION_MAX at Level 1)
// ---------------------------------------------------------------------------

function _planPeakShaving(ctx, strategyLabel) {
  var notes = [];

  // P2_CAPTURE_PV setup -- PV-chargeable kWh per day
  var pvSurplusByHour = new Array(24);
  var pvChargeable = 0;
  for (var h = 0; h < 24; h++) {
    var s = Math.max(0, ctx.pvByHour[h] - ctx.loadByHour[h]);
    pvSurplusByHour[h] = s;
    pvChargeable += s;
  }

  // Daily budgets
  //   B_d  =  min( U,  S · η )     -- discharge budget (output side)
  //   B_c  =  B_d / η              -- charge budget (input side, before RTE)
  var dischargeBudgetByPv = pvChargeable * ctx.rte;
  var dischargeBudget = Math.min(ctx.usableKwh, dischargeBudgetByPv);
  var chargeBudget    = (ctx.rte > 0) ? dischargeBudget / ctx.rte : 0;
  if (chargeBudget > ctx.usableKwh / ctx.rte) chargeBudget = ctx.usableKwh / ctx.rte;
  if (chargeBudget > pvChargeable) chargeBudget = pvChargeable;

  if (pvChargeable <= 0) {
    return _planEmptySchedule(ctx, strategyLabel,
      'no PV surplus available; PEAK_SHAVING budget is zero');
  }

  // P2_CAPTURE_PV -- allocate PV charge across surplus hours, capped by power
  var chargeByHour = new Array(24).fill(0);
  var pvChargeKwh = _allocateProportional(pvSurplusByHour, chargeBudget,
                                          ctx.batteryPowerKw, chargeByHour);

  // P3_REDUCE_PUNTA -- allocate discharge against residual load,
  // punta hours first, then intermedia. Never base (I7).
  var residualByHour = new Array(24);
  for (var k = 0; k < 24; k++) {
    residualByHour[k] = Math.max(0, ctx.loadByHour[k] - ctx.pvByHour[k]);
  }
  var dischargeByHour = new Array(24).fill(0);
  var puntaWeights = _maskByBucket(residualByHour, ctx.bucketByHour, 'punta');
  var puntaUsed = _allocateProportional(puntaWeights, dischargeBudget,
                                        ctx.batteryPowerKw, dischargeByHour);
  var remainder = dischargeBudget - puntaUsed;
  if (remainder > 1e-9) {
    var interWeights = _maskByBucket(residualByHour, ctx.bucketByHour, 'intermedia');
    _allocateProportional(interWeights, remainder,
                          ctx.batteryPowerKw, dischargeByHour);
  }

  // I2 defensive zero-out (no hour both charging and discharging)
  for (var j = 0; j < 24; j++) {
    if (chargeByHour[j] > 0 && dischargeByHour[j] > 0) {
      dischargeByHour[j] = 0;
    }
  }

  return {
    chargeByHour:     chargeByHour,
    gridChargeByHour: new Array(24).fill(0),
    dischargeByHour:  dischargeByHour,
    meta: {
      tier:                    'SCREENING',
      strategy:                strategyLabel,
      dailyDischargeBudgetKwh: dischargeBudget,
      dailyChargeBudgetKwh:    pvChargeKwh,
      pvChargeKwh:             pvChargeKwh,
      gridChargeKwh:           0,
      planningDemandLimitKw:   ctx.planningDemandLimitKw,
      notes:                   notes,
    }
  };
}


// ---------------------------------------------------------------------------
// LOAD_SHIFTING (P1, P2, P3 plus P4_ARBITRAGE)
// ---------------------------------------------------------------------------

function _planLoadShifting(ctx) {
  // P4_ARBITRAGE gate. With wear cost (R3): subtract wear from the spread.
  // Without wear cost: pure spread gate (current behavior, documented bias).
  var wc = (ctx.wearCostMxnPerKwh != null) ? ctx.wearCostMxnPerKwh : 0;
  var spreadAfterWear  = (ctx.ratePunta - ctx.rateBase) * ctx.rte - wc;
  var puntaWorthBaseEq = ctx.ratePunta * ctx.rte - wc - ctx.rateBase;

  var gateOk =
       ctx.interconnMode === 'NET_BILLING'
    && spreadAfterWear  > 0
    && puntaWorthBaseEq > 0;

  if (!gateOk) {
    var schedule = _planPeakShaving(ctx, 'LOAD_SHIFTING');
    schedule.meta.notes.push(
      'LOAD_SHIFTING P4_ARBITRAGE gate blocked (interconn=' + ctx.interconnMode +
      ', spreadAfterWear=' + spreadAfterWear.toFixed(3) +
      ', wear=' + wc.toFixed(3) +
      '). Falling back to PS behavior.');
    return schedule;
  }
  if (ctx.wearCostMxnPerKwh == null) {
    // Honest about the missing input -- per reviewer R2 §2.2.
    // (Don't fail; just record.)
  }

  var notes = [];
  if (ctx.wearCostMxnPerKwh == null) {
    notes.push('WEAR_COST_NOT_SUPPLIED: LS arbitrage gate may over-fire on '
             + 'marginal spreads. Supply wearCostMxnPerKwh to suppress.');
  }

  // P2_CAPTURE_PV setup
  var pvSurplusByHour = new Array(24);
  var pvChargeable = 0;
  for (var h = 0; h < 24; h++) {
    var s = Math.max(0, ctx.pvByHour[h] - ctx.loadByHour[h]);
    pvSurplusByHour[h] = s;
    pvChargeable += s;
  }

  // P1_AVOID_NEW_PEAK setup -- per-base-hour grid-charge headroom
  // under the planning demand limit.
  var baseHeadroomByHour = new Array(24).fill(0);
  for (var bh = 0; bh < 24; bh++) {
    if (ctx.bucketByHour[bh] !== 'base') continue;
    var net = ctx.loadByHour[bh] - ctx.pvByHour[bh];
    var head = ctx.planningDemandLimitKw - net;
    if (head > 0) baseHeadroomByHour[bh] = Math.min(head, ctx.batteryPowerKw);
  }
  var totalBaseHeadroom = 0;
  for (var bk = 0; bk < 24; bk++) totalBaseHeadroom += baseHeadroomByHour[bk];

  // Target a full daily cycle; reduce if base headroom can't fund it.
  var fullCycleCharge = (ctx.rte > 0) ? ctx.usableKwh / ctx.rte : 0;
  var pvChargeTarget = Math.min(pvChargeable, fullCycleCharge);
  var gridChargeTarget = fullCycleCharge - pvChargeTarget;

  if (gridChargeTarget > totalBaseHeadroom) {
    notes.push('LOAD_SHIFTING grid-charge target ' +
      gridChargeTarget.toFixed(1) + ' kWh exceeds base headroom ' +
      totalBaseHeadroom.toFixed(1) + ' kWh; capped.');
    gridChargeTarget = totalBaseHeadroom;
  }

  var totalChargeBudget = pvChargeTarget + gridChargeTarget;
  var dischargeBudget = totalChargeBudget * ctx.rte;
  if (dischargeBudget > ctx.usableKwh) dischargeBudget = ctx.usableKwh;

  // P2_CAPTURE_PV -- allocate
  var chargeByHour = new Array(24).fill(0);
  var pvChargeKwh = _allocateProportional(pvSurplusByHour, pvChargeTarget,
                                          ctx.batteryPowerKw, chargeByHour);

  // P4_ARBITRAGE -- allocate grid charge under headroom cap
  var gridChargeByHour = new Array(24).fill(0);
  var gridChargeKwh = _allocateProportional(baseHeadroomByHour, gridChargeTarget,
                                            ctx.batteryPowerKw, gridChargeByHour);

  // P3_REDUCE_PUNTA -- allocate discharge
  var residualByHour = new Array(24);
  for (var r = 0; r < 24; r++) {
    residualByHour[r] = Math.max(0, ctx.loadByHour[r] - ctx.pvByHour[r]);
  }
  var dischargeByHour = new Array(24).fill(0);
  var puntaWeights = _maskByBucket(residualByHour, ctx.bucketByHour, 'punta');
  var puntaUsed = _allocateProportional(puntaWeights, dischargeBudget,
                                        ctx.batteryPowerKw, dischargeByHour);
  var remainder = dischargeBudget - puntaUsed;
  if (remainder > 1e-9) {
    var interWeights = _maskByBucket(residualByHour, ctx.bucketByHour, 'intermedia');
    _allocateProportional(interWeights, remainder,
                          ctx.batteryPowerKw, dischargeByHour);
  }

  // I2 defensive zero-out
  for (var z = 0; z < 24; z++) {
    if ((chargeByHour[z] + gridChargeByHour[z]) > 0 && dischargeByHour[z] > 0) {
      dischargeByHour[z] = 0;
    }
  }

  return {
    chargeByHour:     chargeByHour,
    gridChargeByHour: gridChargeByHour,
    dischargeByHour:  dischargeByHour,
    meta: {
      tier:                    'SCREENING',
      strategy:                'LOAD_SHIFTING',
      dailyDischargeBudgetKwh: dischargeBudget,
      dailyChargeBudgetKwh:    pvChargeKwh + gridChargeKwh,
      pvChargeKwh:             pvChargeKwh,
      gridChargeKwh:           gridChargeKwh,
      planningDemandLimitKw:   ctx.planningDemandLimitKw,
      notes:                   notes,
    }
  };
}


// ---------------------------------------------------------------------------
// Finalize meta -- ledger + priority results
// ---------------------------------------------------------------------------
// Called once at the end with the finished schedule. Computes everything
// the writer / customer report needs from the schedule + ctx. Pure.
//
// Per reviewer R3:
//   §1  planningDemandLimitKw (renamed from demandCeilingKw)
//   §2  effectiveBatteryUtilizationPct  (the missing commercial metric)
//   §3  priorityResults[P*] = { attempted, achieved, valueMxn }
// ---------------------------------------------------------------------------

function _planFinalizeMeta(schedule, ctx, strategy) {
  var dischargeByHour = schedule.dischargeByHour;
  var chargeByHour = schedule.chargeByHour;
  var gridChargeByHour = schedule.gridChargeByHour;

  // ---- Per-bucket discharge ----
  var dPunta = 0, dInter = 0, dBase = 0;
  for (var h = 0; h < 24; h++) {
    var d = dischargeByHour[h];
    if (ctx.bucketByHour[h] === 'punta')      dPunta += d;
    else if (ctx.bucketByHour[h] === 'intermedia') dInter += d;
    else                                       dBase  += d;
  }
  var totalDischarge = dPunta + dInter + dBase;

  // ---- Sources ----
  var pvCharge = 0, gridCharge = 0;
  for (var i = 0; i < 24; i++) {
    pvCharge   += chargeByHour[i];
    gridCharge += gridChargeByHour[i];
  }
  var totalCharge = pvCharge + gridCharge;

  // ---- Peak-reduction kW (the missing demand-charge metric, R2 §2.2) ----
  // For each hour, compute net_with_battery = load - pv - discharge + gridCharge.
  // The max-hour reduction in each bucket vs the pre-battery raw net is the kW
  // we "saved" -- the value driver for Capacidad / Distribución.
  var rawNetMax = 0, withBatteryMax = 0;
  var rawNetPuntaMax = 0, withBatteryPuntaMax = 0;
  var rawNetInterMax = 0, withBatteryInterMax = 0;
  for (var h2 = 0; h2 < 24; h2++) {
    var raw = Math.max(0, ctx.loadByHour[h2] - ctx.pvByHour[h2]);
    var withB = Math.max(0,
      ctx.loadByHour[h2] - ctx.pvByHour[h2]
      - dischargeByHour[h2]
      + gridChargeByHour[h2]
    );
    if (raw > rawNetMax) rawNetMax = raw;
    if (withB > withBatteryMax) withBatteryMax = withB;
    if (ctx.bucketByHour[h2] === 'punta') {
      if (raw > rawNetPuntaMax) rawNetPuntaMax = raw;
      if (withB > withBatteryPuntaMax) withBatteryPuntaMax = withB;
    } else if (ctx.bucketByHour[h2] === 'intermedia') {
      if (raw > rawNetInterMax) rawNetInterMax = raw;
      if (withB > withBatteryInterMax) withBatteryInterMax = withB;
    }
  }
  var peakReductionKwOverall = Math.max(0, rawNetMax - withBatteryMax);
  var peakReductionKwPunta   = Math.max(0, rawNetPuntaMax - withBatteryPuntaMax);
  var peakReductionKwInter   = Math.max(0, rawNetInterMax - withBatteryInterMax);
  var peakReductionPctOverall = (rawNetMax > 0)
    ? (peakReductionKwOverall / rawNetMax) : 0;

  // ---- est-MXN (SCREENING tier -- typical-day-derived, not 15-min) ----
  var rCap = ctx.demandRates ? ctx.demandRates.capacidadMxnPerKw : 0;
  var rDist = ctx.demandRates ? ctx.demandRates.distribucionMxnPerKw : 0;
  // Demand-charge avoidance scales by month for Capacidad/Distribucion:
  // monthly bill applies to the peak kW of the month.
  // Per-day discharge offsets are not what's billed; only peak kW.
  // We multiply by 1 (peak is monthly), but downstream caller multiplies
  // 12 if it wants annual.
  var estAvoidedCapacidadMxn    = peakReductionKwPunta * rCap;
  var estAvoidedDistribucionMxn = peakReductionKwPunta * rDist;

  // Variable savings = discharge × (bucketRate - rateBase) for each hour
  // (the energy you would have imported at the bucket rate, but get from
  // stored kWh that "cost" you only the rateBase you charged it from --
  // for PV charges, the implied cost is the export-revenue forgone, which
  // we approximate at rateBase for SCREENING tier).
  var estAvoidedVariableMxn = 0;
  for (var h3 = 0; h3 < 24; h3++) {
    var d = dischargeByHour[h3];
    if (d <= 0) continue;
    var rate = (ctx.bucketByHour[h3] === 'punta') ? ctx.ratePunta
             : (ctx.bucketByHour[h3] === 'intermedia') ? ctx.rateInter
             : ctx.rateBase;
    estAvoidedVariableMxn += d * Math.max(0, rate - ctx.rateBase);
  }
  // Per day. Caller multiplies by daysInMonth for monthly.

  // ---- Benefit attribution (kWh) ----
  // Heuristic at SCREENING tier:
  //   benefitPeakShavingKwh   = punta discharge backed by PV charge
  //   benefitTimeShiftingKwh  = punta discharge backed by grid-base charge
  //   benefitSelfConsumptionKwh = any discharge backed by PV charge
  //   benefitZeroExportKwh    = PV charge that would have been exported
  //                              under ZERO_EXPORT (= total PV charge then)
  // Decomposition: split discharge proportionally to charge sources.
  var pvFrac = (totalCharge > 0) ? pvCharge / totalCharge : 1.0;
  var gridFrac = 1 - pvFrac;
  var benefitPeakShavingKwh    = dPunta * pvFrac;
  var benefitTimeShiftingKwh   = dPunta * gridFrac;
  var benefitSelfConsumptionKwh = (dPunta + dInter) * pvFrac;
  var benefitZeroExportKwh     = (ctx.interconnMode === 'ZERO_EXPORT')
    ? pvCharge : 0;

  // ---- Effective battery utilization (R3 §2) ----
  // Daily discharge / usable capacity. 100% = battery cycles fully every day.
  // 15% = the customer paid for a 1 MWh battery but only uses 150 kWh/day.
  // Critical for sizing conversations and proposal honesty.
  var effectiveBatteryUtilizationPct = (ctx.usableKwh > 0)
    ? Math.min(1, totalDischarge / ctx.usableKwh) : 0;

  // ---- Priority results (R3 §3) ----
  // For each priority on the strategy's stack, record:
  //   attempted: did the planner attempt this priority?
  //   achieved : did it actually place kWh / shave kW?
  //   valueMxn : the daily MXN value attributable to this priority
  //              (left null if demandRates absent or non-computable)
  var stack = BESS_STRATEGY_PRIORITIES[strategy] || BESS_STRATEGY_PRIORITIES.PEAK_SHAVING;
  var priorityResults = {};

  function addPriority(name, attempted, achieved, valueMxn) {
    priorityResults[name] = {
      attempted: !!attempted,
      achieved:  !!achieved,
      valueMxn:  (valueMxn != null && isFinite(valueMxn)) ? valueMxn : null
    };
  }

  // P1 -- always attempted (any strategy with grid charging risks new peak).
  // Achieved = grid charging did not violate the limit. We assert this
  // structurally; verifying it here is a sanity check.
  var p1Achieved = true;
  for (var h4 = 0; h4 < 24; h4++) {
    var newPeak = ctx.loadByHour[h4] + gridChargeByHour[h4] - ctx.pvByHour[h4];
    if (newPeak > ctx.planningDemandLimitKw + 1e-6) { p1Achieved = false; break; }
  }
  addPriority('P1_AVOID_NEW_PEAK',
              true,
              p1Achieved,
              0);  // P1 itself doesn't generate value; it prevents loss.

  // P2 -- attempted on every strategy. Achieved iff pvCharge > 0.
  // Value: PV stored × (avg discharge bucket rate) - rateBase (avoided import
  // at displaced bucket - implied export-revenue-forgone at base).
  if (stack.indexOf('P2_CAPTURE_PV') >= 0) {
    var p2Value = (ctx.demandRates || ctx.ratePunta > 0)
      ? pvCharge * ctx.rte * Math.max(0, ctx.ratePunta - ctx.rateBase)
      : null;
    addPriority('P2_CAPTURE_PV', true, pvCharge > 0, p2Value);
  }

  // P3 -- attempted on every strategy. Achieved iff puntaDischarge > 0.
  // Value: variable savings on punta + demand-charge avoidance.
  if (stack.indexOf('P3_REDUCE_PUNTA') >= 0) {
    var p3Value = (ctx.demandRates != null)
      ? (estAvoidedCapacidadMxn + estAvoidedDistribucionMxn
         + dPunta * Math.max(0, ctx.ratePunta - ctx.rateBase))
      : null;
    addPriority('P3_REDUCE_PUNTA', true, dPunta > 0, p3Value);
  }

  // P4 -- attempted only by LS, achieved iff gridCharge > 0.
  // Value: gridCharge × (ratePunta - rateBase) × rte - wearCost
  if (stack.indexOf('P4_ARBITRAGE') >= 0) {
    var attemptedP4 = strategy === 'LOAD_SHIFTING';
    var achievedP4 = gridCharge > 0;
    var wc4 = (ctx.wearCostMxnPerKwh != null) ? ctx.wearCostMxnPerKwh : 0;
    var p4Value = gridCharge * ctx.rte
                  * Math.max(0, (ctx.ratePunta - ctx.rateBase) - wc4 / ctx.rte);
    addPriority('P4_ARBITRAGE', attemptedP4, achievedP4, p4Value);
  }

  // ---- Compose the ledger ----
  schedule.meta.ledger = {
    // Sources (kWh)
    chargedFromPvSurplusKwh:    pvCharge,
    chargedFromGridBaseKwh:     gridCharge,

    // Destinations (kWh)
    dischargedToPuntaKwh:       dPunta,
    dischargedToIntermediaKwh:  dInter,
    dischargedToBaseKwh:        dBase,   // == 0 per I7

    // Demand-charge impact (kW)
    peakReductionKwPunta:       peakReductionKwPunta,
    peakReductionKwIntermedia:  peakReductionKwInter,
    peakReductionKwOverall:     peakReductionKwOverall,
    peakReductionPctOverall:    peakReductionPctOverall,

    // Estimated MXN (SCREENING tier -- typical-day-derived)
    estAvoidedCapacidadMxn:     estAvoidedCapacidadMxn,
    estAvoidedDistribucionMxn:  estAvoidedDistribucionMxn,
    estAvoidedVariableMxn:      estAvoidedVariableMxn,

    // Benefit attribution (kWh)
    benefitSelfConsumptionKwh:  benefitSelfConsumptionKwh,
    benefitPeakShavingKwh:      benefitPeakShavingKwh,
    benefitTimeShiftingKwh:     benefitTimeShiftingKwh,
    benefitZeroExportKwh:       benefitZeroExportKwh,

    // Sizing metric (R3 §2)
    effectiveBatteryUtilizationPct: effectiveBatteryUtilizationPct
  };

  schedule.meta.priorityResults = priorityResults;
  schedule.meta.actualBilledDemandKw = ctx.actualBilledDemandKw;
  schedule.meta.syntheticLimitKw = ctx.syntheticLimitKw;
}


// ---------------------------------------------------------------------------
// Allocation helper -- distribute `target` kWh across `weights` into `into`,
// capped per hour at `perHourCap`. Iterates to redistribute saturated.
// ---------------------------------------------------------------------------

function _allocateProportional(weights, target, perHourCap, into) {
  if (!(target > 0)) return 0;
  var placed = 0;
  var perHourCapEff = Math.max(0, perHourCap);

  for (var iter = 0; iter < 10; iter++) {
    var remaining = target - placed;
    if (remaining <= 1e-9) break;

    var weightSum = 0;
    for (var h = 0; h < 24; h++) {
      var headroom = perHourCapEff - into[h];
      if (headroom > 1e-9 && weights[h] > 1e-9) {
        weightSum += weights[h];
      }
    }
    if (weightSum <= 1e-9) break;

    var spent = 0;
    for (var k = 0; k < 24; k++) {
      var head = perHourCapEff - into[k];
      if (head <= 1e-9 || weights[k] <= 1e-9) continue;
      var share = (remaining * weights[k]) / weightSum;
      if (share > head) share = head;
      if (share > 1e-12) {
        into[k] += share;
        placed += share;
        spent += share;
      }
    }
    if (spent <= 1e-9) break;
  }
  return placed;
}


function _maskByBucket(values, bucketByHour, bucket) {
  var out = new Array(24).fill(0);
  for (var h = 0; h < 24; h++) {
    if (bucketByHour[h] === bucket) out[h] = values[h];
  }
  return out;
}
