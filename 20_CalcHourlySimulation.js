// =============================================================================
// ARGIA ENGINE -- File: 20_CalcHourlySimulation.gs   (BDF-5)
// Hourly load + PV + battery dispatch simulator.
//
// PURPOSE
//   Customer-facing CFE_OUTPUT savings has historically been a monthly aggregate.
//   Monthly aggregation hides hour-of-day misalignments between load, PV
//   surplus, and battery state-of-charge. This module produces an 8760-hour
//   simulation that catches those misalignments and produces a more honest
//   annual savings number for customer proposals.
//
// HONEST SCOPE (BDF-5 / R1 path)
//   - Load shape: PIECEWISE FLAT within CFE tariff buckets. The customer's
//     12 monthly bills give us per-bucket monthly totals. We divide each
//     monthly total by the number of hours in that bucket for that month
//     (from the encoded CFE windows) -> per-hour kWh, replicated across all
//     hours in that bucket. Result: real granularity, synthetic shape. The
//     true machinery-on/machinery-off pattern is destroyed by monthly
//     aggregation; we don't pretend we can reconstruct it.
//   - PV shape: pulled from the existing PV calc step (whatever it produces).
//     If the existing engine only gives monthly PV totals, we apply the same
//     piecewise-flat split. If it produces hourly already, we use that.
//   - Tariff windows: GDMTH hard-coded (3 buckets per region × season ×
//     day-type, ~36 window definitions). Non-TOU tariffs (GDMTO, GDBT, PDBT)
//     get a flat-rate fallback. DIST/RAMT (TOU but not yet encoded) also
//     fall back to flat with a warning.
//   - Battery dispatch: simple greedy state machine. Discharge during punta
//     when load exceeds threshold. Charge from PV surplus during midday
//     (NET_BILLING/ZERO_EXPORT modes only). Optionally charge from grid
//     during base hours if mode permits and economics work.
//
// INVOCATION
//   Always runs as a pipeline step. Result attached to engine result under
//   .hourlySimulation key. Other writers can choose to display side-by-side
//   with the monthly engine output.
//
// LIMITATIONS (documented for designer visibility)
//   - Piecewise-flat load shape is the floor of honesty. Real customers
//     have machinery cycles; we can't see them from monthly bills.
//   - Dispatch is greedy/myopic. Doesn't optimize across the year. Real
//     site EMS would do better, but this is a proposal-time estimator.
//   - DIST/RAMT fallback to flat-rate is approximate. Encode windows
//     before quoting customers on these tariffs.
//   - GDMTH window data effective 2026; verify against CFE if used in
//     legally-binding proposals.
// =============================================================================


// ===========================================================================
// CFE GDMTH window definitions (effective 2026).
// ===========================================================================
// Source: CFE's published GDMTH schedule for Mexico's tariff regions.
// Structure: REGIONS keyed by region code. Each region has SEASONS (summer/
// winter). Each season has DAY_TYPES (weekday/saturday/sunday). Each day-type
// has BUCKETS (base/intermedia/punta) with `hours` arrays listing the start
// hour of each hour-long slot belonging to that bucket.
//
// VERIFY BEFORE PRODUCTION USE: Windows revise periodically. The 2026 data
// here reflects publicly available CFE schedules but should be confirmed
// against the customer's actual tariff document. Update the EFFECTIVE_DATE
// constant when you verify against a new CFE publication.
// ===========================================================================

var GDMTH_WINDOWS_EFFECTIVE_DATE = '2026-01-01';

// Common GDMTH structure (covers Golfo Centro, Central, Norte regions).
// Hours are integers 0..23 representing the START of each hourly slot.
// A slot at hour=18 means "18:00-19:00".
//
// Winter (Nov-Apr): punta is 18:00-22:00, intermedia in the morning and
// evening shoulders, base is overnight/midday.
// Summer (May-Oct): punta is 20:00-22:00 (shorter), intermedia is wider
// midday block, base is overnight only.
//
// Saturdays: same as weekdays but punta is shorter or absent in some regions.
// Sundays: all base.
var _GDMTH_DEFAULT = {
  winter: {
    weekday: {
      base:       [0,1,2,3,4,5,6,22,23],
      intermedia: [7,8,9,10,11,12,13,14,15,16,17],
      punta:      [18,19,20,21],
    },
    saturday: {
      base:       [0,1,2,3,4,5,6,22,23],
      intermedia: [7,8,9,10,11,12,13,14,15,16,17,18,19,20,21],
      punta:      [],
    },
    sunday: {
      base:       [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23],
      intermedia: [],
      punta:      [],
    },
  },
  summer: {
    weekday: {
      base:       [0,1,2,3,4,5,6,23],
      intermedia: [7,8,9,10,11,12,13,14,15,16,17,18,19,22],
      punta:      [20,21],
    },
    saturday: {
      base:       [0,1,2,3,4,5,6,23],
      intermedia: [7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22],
      punta:      [],
    },
    sunday: {
      base:       [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23],
      intermedia: [],
      punta:      [],
    },
  },
};

// Region map. Most regions use the default GDMTH structure; Baja California
// has different rules (different hours, no winter season as conventionally
// defined). Encoded here for completeness but the default covers ~90% of
// mainland C&I customers.
var GDMTH_REGIONS = {
  'GOLFO CENTRO': _GDMTH_DEFAULT,
  'CENTRAL':      _GDMTH_DEFAULT,
  'NORTE':        _GDMTH_DEFAULT,
  'NOROESTE':     _GDMTH_DEFAULT,
  'SUR':          _GDMTH_DEFAULT,
  'PENINSULAR':   _GDMTH_DEFAULT,
  // Note: BAJA CALIFORNIA and BAJA CALIFORNIA SUR have different schedules.
  // Falling back to default for now; encode separately if customers there.
};

// Season boundaries by month (1-indexed). May-Oct = summer, rest = winter.
// This is the standard CFE convention for most regions.
function _gdmthSeasonFor(month) {
  return (month >= 5 && month <= 10) ? 'summer' : 'winter';
}

// Day type: 0=Sunday, 1=Mon..5=Fri (all "weekday"), 6=Saturday.
function _gdmthDayTypeFor(dayOfWeek) {
  if (dayOfWeek === 0) return 'sunday';
  if (dayOfWeek === 6) return 'saturday';
  return 'weekday';
}


// ===========================================================================
// classifyHour -- assign a tariff bucket to a (region, month, dayOfWeek, hour)
// ===========================================================================
// Returns one of 'base', 'intermedia', 'punta'. Falls back to 'base' for
// unknown regions (with a warning the caller can surface).
//
// @param {string} region    - CFE region name (case-insensitive, trimmed)
// @param {number} month     - 1..12
// @param {number} dayOfWeek - 0..6 (0=Sunday)
// @param {number} hour      - 0..23
// @return {string} 'base' | 'intermedia' | 'punta'
function classifyGdmthHour(region, month, dayOfWeek, hour) {
  var key = String(region || '').trim().toUpperCase();
  var regionData = GDMTH_REGIONS[key] || _GDMTH_DEFAULT;
  var season = _gdmthSeasonFor(month);
  var dayType = _gdmthDayTypeFor(dayOfWeek);
  var seasonData = regionData[season];
  if (!seasonData) return 'base';
  var dayData = seasonData[dayType];
  if (!dayData) return 'base';
  if (dayData.punta && dayData.punta.indexOf(hour) >= 0) return 'punta';
  if (dayData.intermedia && dayData.intermedia.indexOf(hour) >= 0) return 'intermedia';
  return 'base';
}


// ===========================================================================
// daysInMonth -- 1-indexed (1=Jan). Non-leap year (deliberate; CFE bills
// reference a typical year).
// ===========================================================================
function _daysInMonth(month) {
  var d = [31,28,31,30,31,30,31,31,30,31,30,31];
  return d[month - 1];
}


// ===========================================================================
// _dayOfWeekFor -- 0=Sunday..6=Saturday. Year 2026 starts on Thursday.
// We use 2026 as a fixed reference year for the synthesis (Jan 1 = Thursday).
// This is arbitrary but consistent; the actual customer year doesn't matter
// because the engine produces a TYPICAL year's worth of hours, not a real
// calendar year.
// ===========================================================================
function _dayOfWeekFor(month, day) {
  // Days from start of 2026 to month/day (non-leap).
  var daysBefore = [0,31,59,90,120,151,181,212,243,273,304,334];
  var dayIndex = daysBefore[month - 1] + (day - 1);
  // Jan 1 2026 = Thursday = 4
  return (4 + dayIndex) % 7;
}


// ===========================================================================
// _countHoursPerBucketPerMonth -- for each (month, bucket), count hours
// ===========================================================================
// Used to convert monthly bill kWh into per-hour kWh. Result is an object
// keyed by bucket: { base: [hrs_jan, hrs_feb, ...], intermedia: [...],
// punta: [...] }. Each inner array has 12 entries.
function _countHoursPerBucketPerMonth(region) {
  var result = {
    base:       new Array(12).fill(0),
    intermedia: new Array(12).fill(0),
    punta:      new Array(12).fill(0),
  };
  for (var m = 1; m <= 12; m++) {
    var days = _daysInMonth(m);
    for (var d = 1; d <= days; d++) {
      var dow = _dayOfWeekFor(m, d);
      for (var h = 0; h < 24; h++) {
        var bucket = classifyGdmthHour(region, m, dow, h);
        result[bucket][m - 1]++;
      }
    }
  }
  return result;
}


// ===========================================================================
// _dominantBucketByHourForMonth (Chunk 5 Session 2)
// ===========================================================================
// For each clock hour 0..23, return the bucket that appears most often
// across the days of the given month. Used to build the planner's
// 24-hour bucketByHour vector when collapsing the per-DOW variance into
// a typical-day shape.
//
// For flat-rate tariffs every hour is 'base'.
// ===========================================================================
function _dominantBucketByHourForMonth(tariffClass, region, month) {
  var out = new Array(24);
  if (tariffClass !== 'TOU_GDMTH') {
    for (var hh = 0; hh < 24; hh++) out[hh] = 'base';
    return out;
  }
  var days = _daysInMonth(month);
  var counts = new Array(24);
  for (var h = 0; h < 24; h++) {
    counts[h] = { base: 0, intermedia: 0, punta: 0 };
  }
  for (var d = 1; d <= days; d++) {
    var dow = _dayOfWeekFor(month, d);
    for (var k = 0; k < 24; k++) {
      var b = classifyGdmthHour(region, month, dow, k);
      counts[k][b]++;
    }
  }
  for (var h2 = 0; h2 < 24; h2++) {
    var c = counts[h2];
    var dom = 'base'; var domN = c.base;
    if (c.intermedia > domN) { dom = 'intermedia'; domN = c.intermedia; }
    if (c.punta      > domN) { dom = 'punta';      domN = c.punta; }
    out[h2] = dom;
  }
  return out;
}


// ===========================================================================
// _fallbackFlatDaylightPv (Chunk 5 Session 2 safety fallback)
// ===========================================================================
// When _planSyntheticPvBellShape isn't loaded (e.g. unit tests that don't
// load 20b_PlanMonthlyBessSchedule.js), fall back to the pre-Session-2
// flat-daylight shape so the engine never NaNs.
// ===========================================================================
function _fallbackFlatDaylightPv(dailyKwh) {
  var pv = new Array(24).fill(0);
  if (!(dailyKwh > 0)) return pv;
  var per = dailyKwh / 14;
  for (var h = 6; h <= 19; h++) pv[h] = per;
  return pv;
}


// ===========================================================================
// Tariff classification.
// ===========================================================================
// Splits known tariffs into:
//   - 'TOU_GDMTH': 3-bucket time-of-use, supported with full window math
//   - 'TOU_UNSUPPORTED': TOU tariff whose windows aren't yet encoded.
//                       Engine falls back to flat-rate and emits a warning.
//   - 'FLAT_RATE': single-rate tariff (GDMTO, GDBT, PDBT). No bucket
//                   distinction; load distributed evenly across all hours.
//   - 'UNKNOWN': unrecognized tariff code. Treated as FLAT_RATE with warning.
function classifyTariff(tariffCode) {
  var c = String(tariffCode || '').trim().toUpperCase();
  if (c === 'GDMTH') return 'TOU_GDMTH';
  if (c === 'DIST' || c === 'RAMT') return 'TOU_UNSUPPORTED';
  if (c === 'GDMTO' || c === 'GDBT' || c === 'PDBT') return 'FLAT_RATE';
  return 'UNKNOWN';
}


// ===========================================================================
// _bessDispatchHour -- strategy-aware single-hour battery dispatch (3.7.9)
// ===========================================================================
//
// PHILOSOPHY (decided 2026-05-28): the battery ALWAYS pursues every saving
// type. Strategy is NOT a hard on/off switch; it sets the PRIORITY ORDER when
// discharge, PV capture, and grid arbitrage compete for finite SoC and power.
// We never ignore a saving opportunity — we just decide who gets first claim.
//
// THREE ACTIONS the battery can take in any hour (mutually exclusive per hour,
// because a battery cannot simultaneously charge and discharge):
//   D)  DISCHARGE to cover residual load (avoids import at the bucket rate)
//   P)  CHARGE FROM PV SURPLUS (stores free solar for later)
//   G)  CHARGE FROM GRID (arbitrage: buy cheap base, discharge in punta)
//
// PRIORITY TABLES (first matching action wins each hour):
//
//   PEAK_SHAVING       — punta demand/energy is the main driver.
//     1. Discharge in PUNTA (protect the expensive window above all).
//     2. Charge from PV surplus (any hour).
//     3. Discharge in INTERMEDIA (secondary saving — still pursued).
//     4. No grid charging.
//
//   SELF_CONSUMPTION_MAX — maximize use of own solar.
//     1. Charge from PV surplus FIRST (never spill solar; reserve SoC room).
//     2. Discharge to cover load in PUNTA.
//     3. Discharge to cover load in INTERMEDIA.
//     4. No grid charging.
//
//   LOAD_SHIFTING      — time-of-use arbitrage is the main driver.
//     1. Discharge in PUNTA (capture the spread we charged for).
//     2. Grid-charge in BASE via smart gate (only if NET_BILLING AND the
//        base->punta spread beats RTE losses: (ratePunta-rateBase)*rte > 0
//        AND ratePunta*rte > rateBase, i.e. arbitrage is actually profitable).
//     3. Charge from PV surplus.
//     4. Discharge in INTERMEDIA.
//
// All three still capture PV surplus and still discharge in intermedia — the
// ordering just changes which competes first for the same kWh. This is the
// "always pursue every saving, strategy = priority" model.
//
// KNOWN CONVERGENCE (documented 2026-05-28, verified by comparative tests):
//   PEAK_SHAVING and SELF_CONSUMPTION_MAX produce near-identical economics in
//   practice. The only ordering difference between them — PV-capture-first
//   vs punta-discharge-first — requires PV surplus and punta load in the SAME
//   hour to matter. But PV surplus occurs midday (base/intermedia buckets)
//   and punta is evening, so that conflict almost never arises. They converge
//   BY DESIGN, not by bug. LOAD_SHIFTING is the genuine differentiator: it
//   alone grid-charges for arbitrage, so it diverges materially whenever the
//   punta/base spread + NET_BILLING make arbitrage profitable. Both
//   properties are asserted in BessDispatchStrategyTests.gs.
//
// @param {Object} o  see destructure below
// @return {Object} { batteryActionKwh (+disch/-chg), batterySoc,
//                     pvSurplusKwh, residualNetLoadKwh,
//                     dischargeKwh, chargeKwh }
//
// Pure function — no engine/sheet access. Unit-tested in
// tests_unit/calc/BessDispatchStrategyTests.gs.
//
// CHUNK 5 / Session 2 — schedule-aware path:
//   When opts.scheduleHour is supplied (an object from the Session 1
//   monthly planner: { chargeKwh, gridChargeKwh, dischargeKwh }), the
//   dispatcher EXECUTES that schedule for the hour, clamping to actual
//   SoC + power bounds. When scheduleHour is absent, the legacy greedy
//   priority chains run unchanged (backward compatibility for tests +
//   any callers that don't yet supply a schedule).
// ===========================================================================
function _bessDispatchHour(o) {
  // -- Schedule-aware execution path (Session 2) ----------------------------
  // If a precomputed schedule for this hour is supplied, use it instead of
  // the greedy chains. The schedule has already enforced strategy-level
  // priorities (P1..P4), so this is pure execution: charge / discharge as
  // planned, clamp to actual SoC + power, return the same shape.
  if (o.scheduleHour) {
    return _bessExecuteScheduleHour(o);
  }

  var strategy           = o.strategy || 'PEAK_SHAVING';
  var bucket             = o.bucket;
  var residualNetLoadKwh = o.residualNetLoadKwh;
  var pvSurplusKwh       = o.pvSurplusKwh;
  var batterySoc         = o.batterySoc;
  var minSocKwh          = o.minSocKwh;
  var maxSocKwh          = o.maxSocKwh;
  var batteryPowerKw     = o.batteryPowerKw;
  var rte                = o.rte;
  var interconnMode      = o.interconnMode;
  var rateBase           = Number(o.rateBase)  || 0;
  var ratePunta          = Number(o.ratePunta) || 0;

  var batteryActionKwh = 0;
  var dischargeKwh = 0;
  var chargeKwh = 0;

  // --- Primitive actions (each respects SoC + power limits) ----------------
  function doDischarge() {
    if (residualNetLoadKwh <= 0) return false;
    var available = Math.max(0, batterySoc - minSocKwh);
    var kwh = Math.min(residualNetLoadKwh, available, batteryPowerKw);
    if (kwh <= 0) return false;
    dischargeKwh = kwh;
    batteryActionKwh = kwh;
    batterySoc -= kwh;
    return true;
  }
  function doChargePv() {
    if (pvSurplusKwh <= 0) return false;
    var room = Math.max(0, maxSocKwh - batterySoc);
    var kwh = Math.min(pvSurplusKwh, room, batteryPowerKw);
    if (kwh <= 0) return false;
    chargeKwh = kwh;
    batteryActionKwh = -kwh;
    batterySoc += kwh * rte;   // RTE loss on the way in
    pvSurplusKwh -= kwh;
    return true;
  }
  function doChargeGrid() {
    // Smart gate: only NET_BILLING, only when arbitrage actually profits.
    // After RTE losses, a kWh charged in base and discharged in punta is
    // worth ratePunta*rte but costs rateBase. Require strictly positive edge.
    if (interconnMode !== 'NET_BILLING') return false;
    if (!(ratePunta * rte > rateBase)) return false;
    var room = Math.max(0, maxSocKwh - batterySoc);
    var kwh = Math.min(room, batteryPowerKw);
    if (kwh <= 0) return false;
    chargeKwh = kwh;
    batteryActionKwh = -kwh;
    batterySoc += kwh * rte;
    residualNetLoadKwh += kwh;  // grid charge shows up as extra import
    return true;
  }

  // --- Strategy priority chains -------------------------------------------
  var isPunta = (bucket === 'punta');
  var isBase  = (bucket === 'base');

  if (strategy === 'SELF_CONSUMPTION_MAX') {
    // PV capture first (never spill solar), then discharge to cover load.
    if (doChargePv()) { /* stored solar */ }
    else if (doDischarge()) { /* covered load from battery */ }
  } else if (strategy === 'LOAD_SHIFTING') {
    if (isPunta) {
      if (!doDischarge()) doChargePv();
    } else if (isBase) {
      // Arbitrage window: try to buy cheap, else soak PV, else cover load.
      if (!doChargeGrid()) { if (!doChargePv()) doDischarge(); }
    } else {
      // intermedia: capture PV if any, else cover load
      if (!doChargePv()) doDischarge();
    }
  } else {
    // PEAK_SHAVING (default): protect punta, soak PV, then intermedia.
    if (isPunta) {
      doDischarge();           // priority 1
    } else if (doChargePv()) { // priority 2
      /* stored solar */
    } else {
      doDischarge();           // priority 3: intermedia/base load cover
    }
  }

  return {
    batteryActionKwh:   batteryActionKwh,
    batterySoc:         batterySoc,
    pvSurplusKwh:       pvSurplusKwh,
    residualNetLoadKwh: residualNetLoadKwh,
    dischargeKwh:       dischargeKwh,
    chargeKwh:          chargeKwh,
  };
}


// ===========================================================================
// _bessExecuteScheduleHour (Chunk 5 Session 2)
// ===========================================================================
//
// Level 2 of the two-level dispatcher. Given a precomputed schedule for
// this hour (from _planMonthlyBessSchedule in 20b_PlanMonthlyBessSchedule.js),
// execute it with real-SoC + power clamping.
//
// The planner's schedule already enforces I1..I8 and the priority stack.
// All this function does is apply that schedule to the actual SoC state
// in the current hour. SoC may have drifted from the planner's assumed
// trajectory (different actual load on this specific day vs the typical-day
// shape the planner used) -- the clamping handles that gracefully.
//
// Conservation rules:
//   - charge       <= maxSocKwh - batterySoc (room available)
//   - discharge    <= batterySoc - minSocKwh (energy available)
//   - all flows    <= batteryPowerKw         (power cap)
//
// Mutual exclusion (I2): when both charge and discharge are present in the
// schedule for the same hour (should never happen post-planner due to I2,
// but defensive), discharge wins.
//
// Returns the SAME shape as legacy _bessDispatchHour, so downstream
// consumers don't need to change.
// ===========================================================================
function _bessExecuteScheduleHour(o) {
  var s = o.scheduleHour || {};
  var residualNetLoadKwh = Number(o.residualNetLoadKwh) || 0;
  var pvSurplusKwh       = Number(o.pvSurplusKwh) || 0;
  var batterySoc         = Number(o.batterySoc) || 0;
  var minSocKwh          = Number(o.minSocKwh) || 0;
  var maxSocKwh          = Number(o.maxSocKwh) || 0;
  var batteryPowerKw     = Number(o.batteryPowerKw) || 0;
  var rte                = Number(o.rte) || 0.913;

  var plannedDischarge  = Math.max(0, Number(s.dischargeKwh)    || 0);
  var plannedPvCharge   = Math.max(0, Number(s.chargeKwh)       || 0);
  var plannedGridCharge = Math.max(0, Number(s.gridChargeKwh)   || 0);

  var dischargeKwh = 0;
  var chargeKwh    = 0;     // includes both PV and grid charge for return-shape parity
  var batteryActionKwh = 0;

  // Defensive: if both charge and discharge planned for same hour (shouldn't
  // happen, but the planner's I2 sweep is best-effort), discharge wins.
  if (plannedDischarge > 0) {
    var available = Math.max(0, batterySoc - minSocKwh);
    dischargeKwh = Math.min(plannedDischarge, available, batteryPowerKw);
    // Cap by actual residual load too -- can't discharge more than the
    // residual demand for this hour (no point feeding back to grid via
    // discharge under any interconnection mode).
    if (dischargeKwh > residualNetLoadKwh) {
      dischargeKwh = residualNetLoadKwh;
    }
    if (dischargeKwh > 0) {
      batteryActionKwh = dischargeKwh;
      batterySoc -= dischargeKwh;
    }
  } else if (plannedPvCharge > 0 || plannedGridCharge > 0) {
    var room = Math.max(0, maxSocKwh - batterySoc);
    var roomLeft = room;

    // PV charge first (capped by actual PV surplus this hour + power)
    if (plannedPvCharge > 0) {
      var pvUse = Math.min(plannedPvCharge, pvSurplusKwh, roomLeft, batteryPowerKw);
      if (pvUse > 0) {
        chargeKwh += pvUse;
        batterySoc += pvUse * rte;        // RTE loss on the way in
        pvSurplusKwh -= pvUse;
        roomLeft = Math.max(0, maxSocKwh - batterySoc);
      }
    }

    // Grid charge second. The "room left" and remaining power cap apply.
    var powerLeft = Math.max(0, batteryPowerKw - chargeKwh);
    if (plannedGridCharge > 0 && roomLeft > 0 && powerLeft > 0) {
      var gridUse = Math.min(plannedGridCharge, roomLeft, powerLeft);
      if (gridUse > 0) {
        chargeKwh += gridUse;
        batterySoc += gridUse * rte;
        // Grid charge shows up as extra import for the hour
        residualNetLoadKwh += gridUse;
      }
    }

    if (chargeKwh > 0) {
      batteryActionKwh = -chargeKwh;
    }
  }

  return {
    batteryActionKwh:   batteryActionKwh,
    batterySoc:         batterySoc,
    pvSurplusKwh:       pvSurplusKwh,
    residualNetLoadKwh: residualNetLoadKwh,
    dischargeKwh:       dischargeKwh,
    chargeKwh:          chargeKwh,
  };
}


// ===========================================================================
// _bessPickScheduleHourForClock (Chunk 5 Session 2)
// ===========================================================================
// Given a monthly schedule (24 hours of charge/gridCharge/discharge from
// _planMonthlyBessSchedule) and a clock hour (0..23), return the
// scheduleHour object _bessExecuteScheduleHour expects.
// ===========================================================================
function _bessPickScheduleHourForClock(monthlySchedule, hour) {
  if (!monthlySchedule) return null;
  var h = hour | 0;
  if (h < 0 || h > 23) return null;
  return {
    chargeKwh:     (monthlySchedule.chargeByHour     || [])[h] || 0,
    gridChargeKwh: (monthlySchedule.gridChargeByHour || [])[h] || 0,
    dischargeKwh:  (monthlySchedule.dischargeByHour  || [])[h] || 0
  };
}


// ===========================================================================
// calcHourlySimulation -- main entry point
// ===========================================================================
// @param {Object} opts
//   tariff            : string   CFE tariff code (e.g. 'GDMTH', 'GDMTO')
//   region            : string   CFE region name (e.g. 'GOLFO CENTRO')
//   monthlyBill       : Object   12-month bill data with:
//                                  kwhBase[12]      MWh-or-kWh, consistent
//                                  kwhIntermedia[12]
//                                  kwhPunta[12]
//                                  kwBase[12], kwIntermedia[12], kwPunta[12]
//                                Flat-rate tariffs only need kwhBase[12].
//   monthlyPv         : Object   12-month PV totals (kWh/month). Optional;
//                                if null, simulation runs without solar.
//   batterySpec       : Object   { capacityKwh, powerKw, minSocPct, maxSocPct,
//                                  rtePct } -- optional; if null, no battery
//                                in the simulation (load + grid only).
//   interconnMode     : string   NET_METERING / NET_BILLING / ZERO_EXPORT /
//                                UNKNOWN. Drives charge-source logic.
//   exportPriceMxnPerKwh : number   For NET_BILLING
//   tariffRates       : Object   { puntaMxnPerKwh, intermediaMxnPerKwh,
//                                  baseMxnPerKwh, demandChargeMxnPerKw }
//                                LEGACY rates used when tariffRatesByMonth
//                                is not supplied. Backward-compat with the
//                                BDF-5 R1 engine.
//   tariffRatesByMonth : Array   OPTIONAL 12-entry per-month rate table from
//                                loadCfeTariffRates(). When present, engine
//                                computes ALL CFE bill components (Capacidad,
//                                Distribución, Transmisión, CENACE, Energías,
//                                SCnMEM, Suministro, 2% Baja Tension, Cargo
//                                FP, IVA) instead of just energy+demand.
//                                The annual.totalCostMxn field then reflects
//                                the full CFE bill (incl. IVA), making it
//                                directly comparable to the monthly engine.
//   demandaFacturableKw : Array  OPTIONAL 12 entries. Demanda Facturable per
//                                month (INPUT_CFE row 19). Used for Capacidad
//                                charge per the live CFE formula. If omitted,
//                                falls back to monthly peak punta kW.
//   kWMaxAnoMovilKw    : Array  OPTIONAL 12 entries. kWMaxAñoMovil per month.
//                                BDF-11: when supplied, the engine computes
//                                Capacidad two ways for BESS scenarios:
//                                  components.capacidad[bm]       = YEAR-1
//                                    (df = MAX(post_BESS_kW, 0.7×movil) × rate)
//                                  components.capacidadSteady[bm] = STEADY
//                                    (df = MAX(post_BESS_kW, 0.7×post_kW) × rate)
//                                Year-1 reflects the realistic first-year bill
//                                (CFE's rolling demand window still loaded
//                                with pre-BESS peaks). Steady-state reflects
//                                year-2+ after the rolling max has decayed.
//                                If omitted, components.capacidad mirrors
//                                pre-BDF-11 behavior (no BESS Capacidad effect).
//   bajaTensionToggle : boolean  OPTIONAL. If true, applies the 2% Baja
//                                Tension surcharge per CFE rule. Default false.
//   fpByMonth         : Array    OPTIONAL 12 entries. Power factor per month
//                                from INPUT_CFE row 20. If omitted or 1.0,
//                                Cargo FP is 0. If < 0.9, penalty applies;
//                                if > 0.9, bonus applies.
//
// @return {Object} See bottom of function for shape.
function calcHourlySimulation(opts) {
  opts = opts || {};
  var warnings = [];

  var tariffClass = classifyTariff(opts.tariff);
  var region = opts.region || 'GOLFO CENTRO';
  var monthlyBill = opts.monthlyBill || {};
  var monthlyPv = opts.monthlyPv || null;
  var battery = opts.batterySpec || null;
  var interconnMode = opts.interconnMode || 'UNKNOWN';
  var exportPrice = Number(opts.exportPriceMxnPerKwh) || 0;
  var rates = opts.tariffRates || {};

  // -- Sanity checks -------------------------------------------------------
  if (!monthlyBill.kwhBase || monthlyBill.kwhBase.length !== 12) {
    return {
      blocked: 'monthlyBill.kwhBase is required and must have 12 entries.',
      hours: [], warnings: [],
    };
  }

  // -- Warnings for unsupported tariffs ------------------------------------
  if (tariffClass === 'TOU_UNSUPPORTED') {
    warnings.push('Tariff ' + opts.tariff + ' is TOU but its windows are not '
      + 'yet encoded in the engine. Falling back to flat-rate distribution. '
      + 'Engine output is approximate. Encode windows in 20_CalcHourlySimulation '
      + 'before using for binding proposals.');
  }
  if (tariffClass === 'UNKNOWN') {
    warnings.push('Tariff "' + opts.tariff + '" is not recognized. Falling '
      + 'back to flat-rate distribution. Engine output is approximate.');
  }

  // -- Compute per-bucket per-month average kWh per hour -------------------
  // For GDMTH: actual bucket-aware split. For flat/unknown: all hours
  // treated as 'base' (single bucket).
  var hoursPerBucket;
  if (tariffClass === 'TOU_GDMTH') {
    hoursPerBucket = _countHoursPerBucketPerMonth(region);
  } else {
    // Flat-rate: all hours count as base. Intermedia/punta arrays stay at 0.
    hoursPerBucket = {
      base: new Array(12).fill(0),
      intermedia: new Array(12).fill(0),
      punta: new Array(12).fill(0),
    };
    for (var m = 0; m < 12; m++) {
      hoursPerBucket.base[m] = _daysInMonth(m + 1) * 24;
    }
  }

  // Per-hour kWh for each bucket-month combination
  var perHourKwh = { base: [], intermedia: [], punta: [] };
  for (var mi = 0; mi < 12; mi++) {
    var monthlyTotalKwh, kwhB, kwhI, kwhP;
    if (tariffClass === 'TOU_GDMTH') {
      kwhB = _safeNum(monthlyBill.kwhBase, mi);
      kwhI = _safeNum(monthlyBill.kwhIntermedia, mi);
      kwhP = _safeNum(monthlyBill.kwhPunta, mi);
    } else {
      // Flat-rate: combine all bill buckets into base
      kwhB = _safeNum(monthlyBill.kwhBase, mi)
           + _safeNum(monthlyBill.kwhIntermedia, mi)
           + _safeNum(monthlyBill.kwhPunta, mi);
      kwhI = 0;
      kwhP = 0;
    }
    perHourKwh.base[mi]       = (hoursPerBucket.base[mi]       > 0) ? kwhB / hoursPerBucket.base[mi]       : 0;
    perHourKwh.intermedia[mi] = (hoursPerBucket.intermedia[mi] > 0) ? kwhI / hoursPerBucket.intermedia[mi] : 0;
    perHourKwh.punta[mi]      = (hoursPerBucket.punta[mi]      > 0) ? kwhP / hoursPerBucket.punta[mi]      : 0;
  }

  // PV per-hour (Chunk 5 Session 2: bell-curve shape from planner).
  // Previously a flat 6:00-19:59 distribution -- replaced with a
  // half-sine bell across daylight hours so the planner and the
  // executor reason about PV timing the same way. The bell is built
  // from monthly PV totals and gives ~zero at sunrise/sunset and
  // peak near solar noon.
  // BDF-5 follow-up: read actual hourly PV from the PV calc step
  // (Helioscope) if available -- not in this chunk's scope.
  var pvByHourPerMonth = new Array(12).fill(null);
  if (monthlyPv) {
    for (var mp = 0; mp < 12; mp++) {
      var pvKwh = _safeNum(monthlyPv.kwh, mp);
      var daysInM = _daysInMonth(mp + 1);
      var dailyPv = (pvKwh > 0 && daysInM > 0) ? pvKwh / daysInM : 0;
      // _planSyntheticPvBellShape lives in 20b_PlanMonthlyBessSchedule.js;
      // Apps Script global scope ⇒ direct call. Returns num[24].
      pvByHourPerMonth[mp] = (typeof _planSyntheticPvBellShape === 'function')
        ? _planSyntheticPvBellShape(dailyPv)
        : _fallbackFlatDaylightPv(dailyPv);  // safety fallback
    }
  }

  // Chunk 7 Scenario 4B: existing-PV EXPORTABLE SURPLUS, hourly. This is the
  // customer's MEASURED export (opts.existingPvExportMonthly), so it IS the
  // exportable surplus already -- we shape it to a daytime profile and pass
  // it as the charging-only channel. We do NOT subtract load from it (it is
  // already net of the customer's on-site consumption; that's what "export"
  // means). Null/absent => zero channel => peak-shaving-only (no estimate).
  var existingExportMonthly = opts.existingPvExportMonthly || null;
  var existingPvSurplusByHourPerMonth = new Array(12).fill(null);
  if (existingExportMonthly && existingExportMonthly.kwh) {
    for (var me = 0; me < 12; me++) {
      var expKwh = _safeNum(existingExportMonthly.kwh, me);
      var daysE = _daysInMonth(me + 1);
      var dailyExp = (expKwh > 0 && daysE > 0) ? expKwh / daysE : 0;
      existingPvSurplusByHourPerMonth[me] = (typeof _planSyntheticPvBellShape === 'function')
        ? _planSyntheticPvBellShape(dailyExp)
        : _fallbackFlatDaylightPv(dailyExp);
    }
  }

  // ----- Chunk 5 Session 2: build per-month monthCtx + run planner -------
  // ONE planner call per month BEFORE the 8760 loop. The schedule for
  // each month is then consulted hour-by-hour inside the loop. Planner
  // is pure; no engine/sheet side effects.
  //
  // BUGFIX 4.1.0: must resolve rateBase/rateInter/ratePunta BEFORE the
  // planner block; they were previously declared further down (~line 897
  // pre-fix). Var-hoisting made them undefined here, so the planner saw
  // rate=0 -> LS arbitrage gate failed -> LS schedule == PS schedule ->
  // UNIT_BESS_DISPATCH_STRATEGIES_DIFFER_AND_SAVE failed. Caught by
  // the regression test in Apps Script after first push of 4.1.0 to clasp.
  var rateBase  = Number(rates.baseMxnPerKwh)       || 0;
  var rateInter = Number(rates.intermediaMxnPerKwh) || rateBase;
  var ratePunta = Number(rates.puntaMxnPerKwh)      || rateBase;

  var monthlySchedules = new Array(12).fill(null);
  var monthlyContexts  = new Array(12).fill(null);   // Session 3: surfaced for AUTO_OPTIMIZE
  var plannerEnabled = (typeof _planMonthlyBessSchedule === 'function')
                      && battery
                      && Number(battery.capacityKwh) > 0;
  if (plannerEnabled) {
    // BUGFIX 4.1.0 defensive guard: confirm rates resolved before passing
    // to planner. If this fires the var-hoisting ordering bug has returned.
    if (!isFinite(rateBase) || !isFinite(rateInter) || !isFinite(ratePunta)) {
      warnings.push('Session 2 planner skipped: tariff rates not resolved at '
                  + 'planner-call site (rateBase=' + rateBase + ', rateInter='
                  + rateInter + ', ratePunta=' + ratePunta + '). '
                  + 'Falling back to legacy greedy dispatch.');
      plannerEnabled = false;
    }
  }
  if (plannerEnabled) {
    var batteryStrategyForPlanner = (battery && battery.strategy)
      ? String(battery.strategy) : 'PEAK_SHAVING';
    var planCapKwh = Number(battery.capacityKwh) || 0;
    var planPwrKw  = Number(battery.powerKw)     || 0;
    var planMinPct = Number(battery.minSocPct)   || 0.05;
    var planMaxPct = Number(battery.maxSocPct)   || 0.95;
    var planRte    = Number(battery.rtePct)      || 0.913;
    var planMinKwh = planCapKwh * planMinPct;
    var planMaxKwh = planCapKwh * planMaxPct;
    var planUsableGross = Math.max(0, planMaxKwh - planMinKwh);

    // Chunk 7 Session 2 FIX + RESILIENCE_MAX: honor a reserve fraction.
    // Previously the hourly-sim planner ignored backup reserve entirely
    // (it dispatched full usable), while the legacy/economic path reduced
    // usable by (1 - backupReservePct). That inconsistency over-credited
    // savings for any project with a reserve. We now subtract a reserve
    // fraction here too. The fraction is the MAX of:
    //   - battery.backupReservePct        (legacy percent reserve)
    //   - battery.resilienceReservedFrac  (RESILIENCE_MAX physical reserve,
    //                                       computed in 20a from criticalLoad
    //                                       x hours / usable)
    // so whichever backup requirement is larger governs. For reserve=0
    // projects (the common case, incl. CULLIGAN) this is byte-identical:
    // reserveFrac=0 -> planUsable == planUsableGross.
    var legacyReserveFrac = Number(battery.backupReservePct) || 0;
    var resilienceReserveFrac = Number(battery.resilienceReservedFrac) || 0;
    var reserveFrac = Math.max(0, Math.min(1,
      Math.max(legacyReserveFrac, resilienceReserveFrac)));
    var planUsable = planUsableGross * (1 - reserveFrac);

    // GDMTH bucket-by-clock-hour. For each clock hour, find the dominant
    // bucket across the month's actual day-of-week mix. For flat-rate
    // tariffs every hour is base.
    for (var mb = 1; mb <= 12; mb++) {
      var bucketByHour = _dominantBucketByHourForMonth(tariffClass, region, mb);
      var loadByHour = new Array(24);
      for (var h2 = 0; h2 < 24; h2++) {
        // Average load at clock hour h: use perHourKwh for the dominant
        // bucket. This is an approximation -- the actual sim varies by
        // dow/holiday -- but it's the typical-day shape the planner's
        // contract is built on (see CHUNK_5_SESSION1_SPEC §5).
        loadByHour[h2] = perHourKwh[bucketByHour[h2]][mb - 1] || 0;
      }
      var pvByHour = pvByHourPerMonth[mb - 1] || new Array(24).fill(0);
      var existingPvSurplusByHour = existingPvSurplusByHourPerMonth[mb - 1]
        || new Array(24).fill(0);

      // Actual billed demand for this month (max of three buckets)
      var billedKwBase = _safeNum(monthlyBill.kwBase,       mb - 1);
      var billedKwInt  = _safeNum(monthlyBill.kwIntermedia, mb - 1);
      var billedKwPun  = _safeNum(monthlyBill.kwPunta,      mb - 1);
      var actualBilledDemandKw = Math.max(billedKwBase, billedKwInt, billedKwPun);

      // Tariff rates: prefer per-month if available, else fall back to legacy
      var rB = rateBase, rI = rateInter, rP = ratePunta;
      var demandRatesForMonth = null;
      if (Array.isArray(opts.tariffRatesByMonth)
          && opts.tariffRatesByMonth.length === 12
          && opts.tariffRatesByMonth[mb - 1]) {
        var m12 = opts.tariffRatesByMonth[mb - 1];
        rB = Number(m12.baseMxnPerKwh) || rB;
        rI = Number(m12.intermediaMxnPerKwh) || rI;
        rP = Number(m12.puntaMxnPerKwh) || rP;
        demandRatesForMonth = {
          capacidadMxnPerKw:    Number(m12.capacidadMxnPerKw) || 0,
          distribucionMxnPerKw: Number(m12.distribucionMxnPerKw) || 0
        };
      }

      var monthCtx = {
        monthIndex:            mb - 1,
        daysInMonth:           _daysInMonth(mb),
        bucketByHour:          bucketByHour,
        loadByHour:            loadByHour,
        pvByHour:              pvByHour,
        existingPvExportableSurplusByHour: existingPvSurplusByHour,
        batteryCapKwh:         planCapKwh,
        batteryPowerKw:        planPwrKw,
        minSocKwh:             planMinKwh,
        maxSocKwh:             planMaxKwh,
        usableKwh:             planUsable,
        rte:                   planRte,
        interconnMode:         interconnMode,
        rateBase:              rB,
        rateInter:             rI,
        ratePunta:             rP,
        actualBilledDemandKw:  actualBilledDemandKw,
        wearCostMxnPerKwh:     (battery.wearCostMxnPerKwh != null)
                                 ? Number(battery.wearCostMxnPerKwh) : null,
        demandRates:           demandRatesForMonth
      };

      monthlySchedules[mb - 1] = _planMonthlyBessSchedule(monthCtx, batteryStrategyForPlanner);
      monthlyContexts[mb - 1]  = monthCtx;   // Session 3: surface for AUTO_OPTIMIZE
    }
  }

  // -- 8760-hour simulation loop -------------------------------------------
  // For each hour of the year, classify -> compute load -> compute PV ->
  // compute battery action -> compute grid flow -> compute cost.
  var hours = [];
  var batterySoc = 0;
  var batteryCapKwh = battery ? Number(battery.capacityKwh) || 0 : 0;
  var batteryPowerKw = battery ? Number(battery.powerKw) || 0 : 0;
  var minSocFrac = battery ? Number(battery.minSocPct) || 0.05 : 0.05;
  var maxSocFrac = battery ? Number(battery.maxSocPct) || 0.95 : 0.95;
  var rte = battery ? Number(battery.rtePct) || 0.913 : 1.0;
  // 3.7.9: strategy steers the priority dispatcher. Default to PEAK_SHAVING
  // (the most common commercial driver). Unknown/blank => PEAK_SHAVING.
  var batteryStrategy = (battery && battery.strategy) ? String(battery.strategy) : 'PEAK_SHAVING';
  var minSocKwh = batteryCapKwh * minSocFrac;
  var maxSocKwh = batteryCapKwh * maxSocFrac;
  if (batteryCapKwh > 0) batterySoc = minSocKwh;  // start at min SOC

  // Annual rollups
  var totalLoadKwh = 0, totalPvKwh = 0;
  var totalGridImportKwh = 0, totalGridExportKwh = 0;
  var totalBatteryDischargeKwh = 0, totalBatteryChargeKwh = 0;
  var costByBucket = { base: 0, intermedia: 0, punta: 0 };
  var importByBucket = { base: 0, intermedia: 0, punta: 0 };
  // Track import vs export separately so we can apply the NET_METERING
  // annual cap correctly (CFE doesn't pay you under NET_METERING; credit
  // is capped at consumption over the billing period).
  var totalImportCostMxn = 0;
  var totalExportCreditMxn = 0;
  // Track monthly peak kW (assuming 1 hour buckets, kW = kWh for that hour).
  // CFE demand charge is the max kW during PUNTA hours (for TOU tariffs)
  // or the max kW overall (for flat-rate tariffs). We compute both and
  // pick the appropriate one based on tariffClass.
  var monthlyPeakPuntaKw = new Array(12).fill(0);
  var monthlyPeakAllKw = new Array(12).fill(0);
  // BDF-11: track per-month battery discharge so the year-1/steady Capacidad
  // calc can detect which months had real shaving activity.
  var monthlyBatteryDischargeKwhPerMonth = new Array(12).fill(0);
  var demandRate = Number(rates.demandChargeMxnPerKw) || 0;

  // Per-month per-bucket import totals (kWh from grid), needed by the
  // BDF-5 R2 full-bill computation. We track imports (post-PV, post-battery)
  // because CFE bills the customer on what the meter records flowing in.
  var monthlyImportKwh = {
    base:       new Array(12).fill(0),
    intermedia: new Array(12).fill(0),
    punta:      new Array(12).fill(0),
  };

  // -------- Chunk 5 Session 2: single-pass attribution accumulators -------
  // Track three parallel cost streams in ONE loop pass:
  //   baseline : no PV, no BESS -- load × bucketRate
  //   pvOnly   : PV present, no BESS -- residualNetLoad × bucketRate
  //              minus export credits per interconnMode
  //   pvBess   : PV + BESS (what the legacy cost tracking already does)
  // From these, Session 3 writer can compute BESS-attributable savings as
  //   pvOnlyMxn - pvBessMxn = BESS savings (per tier, monthly).
  // No triple-runtime -- same hours, three accumulators.
  var attrBaselineCostMxn = 0;
  var attrPvOnlyCostMxn = 0;
  var attrPvBessCostMxn = 0;     // = totalImportCostMxn - totalExportCreditMxn at end
  var attrBaselineByBucket = { base: 0, intermedia: 0, punta: 0 };
  var attrPvOnlyByBucket   = { base: 0, intermedia: 0, punta: 0 };
  var attrPvBessByBucket   = { base: 0, intermedia: 0, punta: 0 };
  // Per-month peak kW under each scenario, for demand-charge attribution
  var attrBaselinePeakPuntaKw = new Array(12).fill(0);
  var attrPvOnlyPeakPuntaKw   = new Array(12).fill(0);
  var attrPvBessPeakPuntaKw   = new Array(12).fill(0);
  var attrBaselinePeakAllKw = new Array(12).fill(0);
  var attrPvOnlyPeakAllKw   = new Array(12).fill(0);
  var attrPvBessPeakAllKw   = new Array(12).fill(0);

  // (rateBase, rateInter, ratePunta declared earlier, above the planner block)

  for (var month = 1; month <= 12; month++) {
    var days = _daysInMonth(month);
    for (var day = 1; day <= days; day++) {
      var dow = _dayOfWeekFor(month, day);
      for (var hour = 0; hour < 24; hour++) {
        var bucket = (tariffClass === 'TOU_GDMTH')
                     ? classifyGdmthHour(region, month, dow, hour)
                     : 'base';
        var loadKwh = perHourKwh[bucket][month - 1];
        var pvKwh = (pvByHourPerMonth[month - 1] != null)
                    ? (pvByHourPerMonth[month - 1][hour] || 0) : 0;

        // Net load after PV
        var netLoadKwh = loadKwh - pvKwh;
        var pvSurplusKwh = (netLoadKwh < 0) ? -netLoadKwh : 0;
        var residualNetLoadKwh = (netLoadKwh > 0) ? netLoadKwh : 0;

        // Battery dispatch -- Chunk 5 Session 2 schedule-aware path.
        //
        // If the planner produced a schedule for this month (Level 1),
        // we EXECUTE that schedule hour-by-hour (Level 2), clamping to
        // real SoC. Otherwise (legacy path, no battery, or planner
        // unavailable), the greedy strategy-aware chain runs as before.
        var batteryActionKwh = 0;  // positive = discharge, negative = charge
        if (batteryCapKwh > 0) {
          var scheduleHourArg = null;
          if (plannerEnabled && monthlySchedules[month - 1]) {
            scheduleHourArg = _bessPickScheduleHourForClock(
              monthlySchedules[month - 1], hour
            );
          }
          var dispatch = _bessDispatchHour({
            strategy:           batteryStrategy,
            bucket:             bucket,
            residualNetLoadKwh: residualNetLoadKwh,
            pvSurplusKwh:       pvSurplusKwh,
            batterySoc:         batterySoc,
            minSocKwh:          minSocKwh,
            maxSocKwh:          maxSocKwh,
            batteryPowerKw:     batteryPowerKw,
            rte:                rte,
            interconnMode:      interconnMode,
            rateBase:           rateBase,
            rateInter:          rateInter,
            ratePunta:          ratePunta,
            scheduleHour:       scheduleHourArg
          });
          batteryActionKwh  = dispatch.batteryActionKwh;
          batterySoc        = dispatch.batterySoc;
          pvSurplusKwh      = dispatch.pvSurplusKwh;
          residualNetLoadKwh = dispatch.residualNetLoadKwh;
          if (dispatch.dischargeKwh > 0) {
            totalBatteryDischargeKwh += dispatch.dischargeKwh;
            monthlyBatteryDischargeKwhPerMonth[month - 1] += dispatch.dischargeKwh;  // BDF-11
          }
          if (dispatch.chargeKwh > 0) {
            totalBatteryChargeKwh += dispatch.chargeKwh;
          }
          // Clamp SOC to safe range (defensive; dispatcher already respects it)
          if (batterySoc < minSocKwh) batterySoc = minSocKwh;
          if (batterySoc > maxSocKwh) batterySoc = maxSocKwh;
        }

        // Net grid flow
        var gridImportKwh = Math.max(0, residualNetLoadKwh - (batteryActionKwh > 0 ? batteryActionKwh : 0));
        var gridExportKwh = pvSurplusKwh;  // remaining surplus after battery charge

        // Cost: import billed at bucket rate; export credited (NET_METERING/
        // NET_BILLING only). NET_METERING credits at full retail per kWh;
        // NET_BILLING credits at exportPrice. A SEPARATE annual cap (applied
        // after the loop) enforces "you can't get paid under NET_METERING
        // in Mexico" — net export credit is bounded by net import cost over
        // the billing period.
        var bucketRate = (bucket === 'punta') ? ratePunta
                        : (bucket === 'intermedia') ? rateInter
                        : rateBase;
        var importCostMxn = gridImportKwh * bucketRate;
        var exportCreditMxn = 0;
        if (interconnMode === 'NET_METERING') {
          exportCreditMxn = gridExportKwh * bucketRate;
        } else if (interconnMode === 'NET_BILLING') {
          exportCreditMxn = gridExportKwh * exportPrice;
        }
        // ZERO_EXPORT and UNKNOWN: surplus wasted, no credit
        var netCostMxn = importCostMxn - exportCreditMxn;

        // Accumulate rollups
        totalLoadKwh += loadKwh;
        totalPvKwh += pvKwh;
        totalGridImportKwh += gridImportKwh;
        totalGridExportKwh += gridExportKwh;
        totalImportCostMxn += importCostMxn;
        totalExportCreditMxn += exportCreditMxn;
        costByBucket[bucket] += netCostMxn;
        importByBucket[bucket] += gridImportKwh;
        // Peak kW tracking (1-hour buckets => kW = kWh for that hour)
        var monthIdx = month - 1;
        if (gridImportKwh > monthlyPeakAllKw[monthIdx]) {
          monthlyPeakAllKw[monthIdx] = gridImportKwh;
        }
        if (bucket === 'punta' && gridImportKwh > monthlyPeakPuntaKw[monthIdx]) {
          monthlyPeakPuntaKw[monthIdx] = gridImportKwh;
        }
        // BDF-5 R2: per-month per-bucket kWh import (for full-bill math)
        monthlyImportKwh[bucket][monthIdx] += gridImportKwh;

        // -- Chunk 5 Session 2: 3-scenario attribution accumulation --------
        // baseline (no PV, no BESS): all load is imported at bucket rate.
        // pvOnly (PV, no BESS): import = max(0, load - pv); export = max(0, pv - load).
        // pvBess: already computed above (importCostMxn - exportCreditMxn).
        var baselineImportKwh = loadKwh;
        var pvOnlyNetKwh = loadKwh - pvKwh;
        var pvOnlyImportKwh = (pvOnlyNetKwh > 0) ? pvOnlyNetKwh : 0;
        var pvOnlyExportKwh = (pvOnlyNetKwh < 0) ? -pvOnlyNetKwh : 0;

        var baselineCost = baselineImportKwh * bucketRate;
        var pvOnlyImportCost = pvOnlyImportKwh * bucketRate;
        var pvOnlyExportCredit = 0;
        if (interconnMode === 'NET_METERING') {
          pvOnlyExportCredit = pvOnlyExportKwh * bucketRate;
        } else if (interconnMode === 'NET_BILLING') {
          pvOnlyExportCredit = pvOnlyExportKwh * exportPrice;
        }
        var pvOnlyCost = pvOnlyImportCost - pvOnlyExportCredit;

        attrBaselineCostMxn += baselineCost;
        attrPvOnlyCostMxn   += pvOnlyCost;
        attrPvBessCostMxn   += netCostMxn;     // mirrors costByBucket sum
        attrBaselineByBucket[bucket] += baselineCost;
        attrPvOnlyByBucket[bucket]   += pvOnlyCost;
        attrPvBessByBucket[bucket]   += netCostMxn;

        // Per-month peak kW under each scenario (for demand-charge attribution)
        if (baselineImportKwh > attrBaselinePeakAllKw[monthIdx]) {
          attrBaselinePeakAllKw[monthIdx] = baselineImportKwh;
        }
        if (bucket === 'punta' && baselineImportKwh > attrBaselinePeakPuntaKw[monthIdx]) {
          attrBaselinePeakPuntaKw[monthIdx] = baselineImportKwh;
        }
        if (pvOnlyImportKwh > attrPvOnlyPeakAllKw[monthIdx]) {
          attrPvOnlyPeakAllKw[monthIdx] = pvOnlyImportKwh;
        }
        if (bucket === 'punta' && pvOnlyImportKwh > attrPvOnlyPeakPuntaKw[monthIdx]) {
          attrPvOnlyPeakPuntaKw[monthIdx] = pvOnlyImportKwh;
        }
        if (gridImportKwh > attrPvBessPeakAllKw[monthIdx]) {
          attrPvBessPeakAllKw[monthIdx] = gridImportKwh;
        }
        if (bucket === 'punta' && gridImportKwh > attrPvBessPeakPuntaKw[monthIdx]) {
          attrPvBessPeakPuntaKw[monthIdx] = gridImportKwh;
        }

        // Record this hour (we'll keep all 8760 in memory; ~35KB total)
        hours.push({
          month: month, day: day, dayOfWeek: dow, hour: hour,
          bucket: bucket,
          loadKwh: loadKwh, pvKwh: pvKwh,
          gridImportKwh: gridImportKwh, gridExportKwh: gridExportKwh,
          batteryKwh: batteryActionKwh,    // pos=discharge, neg=charge
          batterySoc: batterySoc,
          netCostMxn: netCostMxn,
        });
      }
    }
  }

  // -- Compute demand charge -----------------------------------------------
  // For TOU tariffs, demand is billed on the monthly punta-hour peak kW.
  // For flat-rate tariffs, on the overall monthly peak. Sum across 12 months.
  var totalDemandChargeMxn = 0;
  for (var dM = 0; dM < 12; dM++) {
    var peakKw = (tariffClass === 'TOU_GDMTH')
                 ? monthlyPeakPuntaKw[dM]
                 : monthlyPeakAllKw[dM];
    totalDemandChargeMxn += peakKw * demandRate;
  }

  // -- BDF-5 R2: Full CFE bill computation --------------------------------
  // When tariffRatesByMonth is supplied, reconstruct every line item of the
  // CFE bill from the simulated grid imports, peaks, and rate table. This
  // exactly mirrors the formulas in INPUT_CFE rows 21-35 (see 04a_CalcCFEBill
  // for the monthly engine equivalent). When tariffRatesByMonth is omitted,
  // we skip this block and totalCostMxn falls back to the R1 behavior
  // (energy + demand only).
  var fullBill = null;
  var tariffRatesByMonth = opts.tariffRatesByMonth;
  var demandaFacturableKw = opts.demandaFacturableKw || null;
  // BDF-11: 12-element array, kWMaxAñoMovil per month from INPUT_CFE row 16
  // (or, with Option B+safety, the rolling max of all kW values). When supplied,
  // unlocks year-1 vs steady-state Capacidad computation in BESS scenarios.
  var kWMaxAnoMovilKw = opts.kWMaxAnoMovilKw || null;
  var bajaTensionToggle = opts.bajaTensionToggle === true;
  var fpByMonth = opts.fpByMonth || null;

  if (Array.isArray(tariffRatesByMonth) && tariffRatesByMonth.length === 12) {
    // Per-month totals
    var components = {
      capacidad:        new Array(12).fill(0),
      capacidadSteady:  new Array(12).fill(0),   // BDF-11: year-2+ Capacidad after movil decay
      distribucion:     new Array(12).fill(0),
      transmision:      new Array(12).fill(0),
      cenace:           new Array(12).fill(0),
      energiaB:         new Array(12).fill(0),
      energiaI:         new Array(12).fill(0),
      energiaP:         new Array(12).fill(0),
      scnmem:           new Array(12).fill(0),
      suministro:       new Array(12).fill(0),
      energiaTotal:     new Array(12).fill(0),   // r30 = SUM(r21..r28) — uses YEAR-1 Capacidad
      energiaTotalSteady: new Array(12).fill(0), // BDF-11: same but with STEADY Capacidad
      bajaTension:      new Array(12).fill(0),
      cargoFp:          new Array(12).fill(0),
      subtotal:         new Array(12).fill(0),   // r33
      subtotalSteady:   new Array(12).fill(0),   // BDF-11
      iva:              new Array(12).fill(0),   // r34
      ivaSteady:        new Array(12).fill(0),   // BDF-11
      facturacion:      new Array(12).fill(0),   // r35
      facturacionSteady: new Array(12).fill(0),  // BDF-11
    };

    // Annual totals (for the "side-by-side vs monthly engine" comparison)
    var annualSubtotal = 0, annualIva = 0, annualFacturacion = 0;
    var annualSubtotalSteady = 0, annualIvaSteady = 0, annualFacturacionSteady = 0;

    for (var bm = 0; bm < 12; bm++) {
      var r = tariffRatesByMonth[bm] || {};
      var importB = monthlyImportKwh.base[bm];
      var importI = monthlyImportKwh.intermedia[bm];
      var importP = monthlyImportKwh.punta[bm];
      var totalImport = importB + importI + importP;

      // r21 Capacidad: BDF-11 — honors BESS effect with year-1 + steady-state
      //
      // PRE-BDF-11 BUG: this block used demandaFacturableKw from INPUT_CFE!C19
      // for both baseline and proposed scenarios, so BESS peak-shaving never
      // reduced Capacidad. That understates BESS Capacidad savings (especially
      // in steady-state) and prevented CFE_OUTPUT from telling the realistic
      // year-1 vs year-2+ story.
      //
      // BDF-11 fix model (mirrors calcPeakShavingImpact in 04a_CalcCFEBill.gs):
      //
      //   IF battery is configured AND simulator detected meaningful shaving
      //   (simulator's gross monthly load-shape peak > simulator post-BESS peak):
      //
      //     YEAR-1: df = MAX(post_BESS_punta, 0.7 × movil)
      //             Rolling max unchanged (BESS hasn't been in service a
      //             full year yet, so old high-demand months still bind the
      //             floor at 0.7 × pre-BESS rolling max).
      //
      //     STEADY: df = MAX(post_BESS_punta, 0.7 × post_BESS_punta)
      //             Rolling max has decayed to the BESS-shaved peak (year 2+
      //             after CFE's 12-month rolling window has cleared the old
      //             high-demand months).
      //
      //   ELSE (no battery OR no shaving): Capacidad uses bill's
      //   demanda facturable. Behaves identically to pre-BDF-11.
      //
      // CRITICAL: We CANNOT use the simulator's monthlyPeakPuntaKw[bm] as
      // the post-BESS peak in the absence of a battery. The simulator's
      // peak is energy-averaged (kWh divided across hours) which is lower
      // than the bill's MEASURED kW_punta. For a no-battery run, that
      // averaged peak is already 20-30% below bill kw_p — using it would
      // prematurely apply the 0.7×movil floor and understate the bill.
      //
      // To detect "genuine shaving": compare simulator's peak WITH battery
      // to its peak WITHOUT battery (= the load-shape gross peak). If the
      // battery dispatched any meaningful energy, the with-battery peak
      // will be lower. We approximate this by checking `battery != null`
      // AND the simulator's discharge total > 0 for the month.
      var capRate = Number(r.capacidadMxnPerKw) || 0;
      var movilKw = (kWMaxAnoMovilKw && kWMaxAnoMovilKw[bm])
                     ? Number(kWMaxAnoMovilKw[bm])
                     : null;
      // PreBessDf = the bill's demanda facturable (i.e. what CFE is
      // charging today, pre-BESS). The Capacidad baseline.
      var preBessDfKw = (demandaFacturableKw && demandaFacturableKw[bm])
                        ? Number(demandaFacturableKw[bm])
                        : monthlyPeakPuntaKw[bm];

      // Battery configured AND movil supplied AND month has battery
      // activity → compute year-1 and steady-state. Else fall back.
      // Use the simulator's already-derived batteryCapKwh / batteryPowerKw
      // (defined at the top of this function) to compute the effective shave.
      var hasBattery = (battery != null && batteryCapKwh > 0);
      var monthHadDischarge = (monthlyBatteryDischargeKwhPerMonth[bm] || 0) > 0;
      if (hasBattery && monthHadDischarge && movilKw != null && movilKw > 0) {
        // Estimate post-BESS punta kW by subtracting the shave from the
        // bill's kw_punta. The shave is the LESSER of inverter power and
        // (usable_kWh / punta_window_hours).
        var usableKwh = batteryCapKwh * (maxSocFrac - minSocFrac);
        // Punta window is region-dependent; estimate as 4h winter / 2h summer.
        var puntaHrs = _isWinterMonth(bm) ? 4 : 2;
        var shaveKw = Math.min(batteryPowerKw, usableKwh / puntaHrs);
        var postBessPuntaKw = Math.max(preBessDfKw - shaveKw, 0);

        var dfYear1  = Math.max(postBessPuntaKw, 0.7 * movilKw);
        var dfSteady = Math.max(postBessPuntaKw, 0.7 * postBessPuntaKw);
        // Cap at preBessDf (BESS can never INCREASE Capacidad)
        if (dfYear1  > preBessDfKw) dfYear1  = preBessDfKw;
        if (dfSteady > preBessDfKw) dfSteady = preBessDfKw;

        components.capacidad[bm]       = dfYear1  * capRate;
        components.capacidadSteady[bm] = dfSteady * capRate;
      } else {
        // No BESS or no movil: use bill's demanda facturable, no floor logic.
        // This preserves pre-BDF-11 behavior for baseline runs.
        components.capacidad[bm]       = preBessDfKw * capRate;
        components.capacidadSteady[bm] = preBessDfKw * capRate;
      }

      // r22 Distribución: MAX(kW base, kW intermedia, kW punta) × rate.
      // Approximated here from the SIMULATED peak (post-PV/battery) — this
      // is honest engineering: when batteries reduce peaks, distribution
      // charges should drop too. Monthly engine uses the BILL'S peaks
      // (no PV) which over-charges PV/BESS scenarios. Document the diff.
      components.distribucion[bm] =
        monthlyPeakAllKw[bm] * (Number(r.distribucionMxnPerKw) || 0);

      // r23 Transmisión: total_kWh × rate
      components.transmision[bm] = totalImport * (Number(r.transmision) || 0);
      // r24 CENACE: total_kWh × rate
      components.cenace[bm]      = totalImport * (Number(r.cenace) || 0);

      // r25-27 Energías by bucket × rate
      components.energiaB[bm] = importB * (Number(r.energiaBase) || 0);
      components.energiaI[bm] = importI * (Number(r.energiaIntermedia) || 0);
      components.energiaP[bm] = importP * (Number(r.energiaPunta) || 0);

      // r28 SCnMEM: total_kWh × rate
      components.scnmem[bm] = totalImport * (Number(r.serviciosConexos) || 0);

      // r29 Suministro: flat MXN/month
      components.suministro[bm] = Number(r.suministroBasicoMxnFlat) || 0;

      // r30 Energía Total: SUM(r21..r28) [Note: CFE formula starts at r21 not r25]
      // BDF-11: also compute a steady-state version that uses capacidadSteady
      // in place of capacidad. Distribución/Transmisión/CENACE/Energías are
      // identical in both scenarios (BESS doesn't change them); only Capacidad
      // differs (year-1 has floor, steady doesn't).
      var nonCapacidadSum = components.distribucion[bm]
                          + components.transmision[bm]
                          + components.cenace[bm]
                          + components.energiaB[bm]
                          + components.energiaI[bm]
                          + components.energiaP[bm]
                          + components.scnmem[bm];
      components.energiaTotal[bm]       = components.capacidad[bm]       + nonCapacidadSum;
      components.energiaTotalSteady[bm] = components.capacidadSteady[bm] + nonCapacidadSum;

      // r31 2% Baja Tension
      components.bajaTension[bm] = bajaTensionToggle
        ? components.energiaTotal[bm] * 0.02
        : 0;
      // BDF-11: steady-state baja tension uses steady energía total
      var bajaTensionSteady = bajaTensionToggle
        ? components.energiaTotalSteady[bm] * 0.02
        : 0;

      // r32 Cargo FP: power-factor penalty (if FP < 0.9) or bonus (if > 0.9)
      // CFE formula: if FP < 0.9 -> 3/5 * (0.9/FP - 1) * (energiaTotal + bajaTension)
      //              if FP > 0.9 -> 1/4 * (1 - 0.9/FP) * -(energiaTotal + bajaTension)
      var fp = (fpByMonth && fpByMonth[bm]) ? Number(fpByMonth[bm]) : 1.0;
      var fpBase = components.energiaTotal[bm] + components.bajaTension[bm];
      var fpBaseSteady = components.energiaTotalSteady[bm] + bajaTensionSteady;
      var cargoFpSteady = 0;
      if (fp > 0 && fp < 0.9) {
        components.cargoFp[bm] = Math.max(3/5 * (0.9/fp - 1), 0) * fpBase;
        cargoFpSteady          = Math.max(3/5 * (0.9/fp - 1), 0) * fpBaseSteady;
      } else if (fp > 0.9) {
        components.cargoFp[bm] = Math.max(1/4 * (1 - 0.9/fp), 0) * -fpBase;
        cargoFpSteady          = Math.max(1/4 * (1 - 0.9/fp), 0) * -fpBaseSteady;
      } else {
        components.cargoFp[bm] = 0;
        cargoFpSteady = 0;
      }

      // r33 Subtotal = r29 + r30 + r31 + r32
      // (Per the LIVE INPUT_CFE formula: =SUM(C29:C32). That includes
      // Suministro + Energía Total + Baja Tension + Cargo FP. Note Suministro
      // is in r29 even though it appears after r30 "Energía Total" — the
      // CFE numbering is non-sequential. The SUM(C29:C32) walks
      // Suministro, Total, BajaTension, CargoFp.)
      components.subtotal[bm] = components.suministro[bm]
                              + components.energiaTotal[bm]
                              + components.bajaTension[bm]
                              + components.cargoFp[bm];
      components.subtotalSteady[bm] = components.suministro[bm]
                                    + components.energiaTotalSteady[bm]
                                    + bajaTensionSteady
                                    + cargoFpSteady;

      // r34 IVA = subtotal × 16%
      components.iva[bm]       = components.subtotal[bm]       * 0.16;
      components.ivaSteady[bm] = components.subtotalSteady[bm] * 0.16;
      // r35 Facturación = subtotal + IVA
      components.facturacion[bm]       = components.subtotal[bm]       + components.iva[bm];
      components.facturacionSteady[bm] = components.subtotalSteady[bm] + components.ivaSteady[bm];

      annualSubtotal += components.subtotal[bm];
      annualIva += components.iva[bm];
      annualFacturacion += components.facturacion[bm];
      annualSubtotalSteady += components.subtotalSteady[bm];
      annualIvaSteady += components.ivaSteady[bm];
      annualFacturacionSteady += components.facturacionSteady[bm];
    }

    // Apply NET_METERING annual cap to the FULL bill too.
    // (The cap was already applied to the energy portion earlier; here we
    // also want to ensure the total bill doesn't go negative due to the
    // distortion. This is belt-and-suspenders honesty.)
    if (interconnMode === 'NET_METERING' && annualFacturacion < 0) {
      annualFacturacion = 0;
    }
    if (interconnMode === 'NET_METERING' && annualFacturacionSteady < 0) {
      annualFacturacionSteady = 0;
    }

    fullBill = {
      provenance: 'BDF5_R2_FULL_BILL',
      components: components,
      annualSubtotalMxn: annualSubtotal,
      annualIvaMxn: annualIva,
      annualFacturacionMxn: annualFacturacion,
      // BDF-11: steady-state annual totals (year 2+ after movil decay)
      annualSubtotalSteadyMxn:    annualSubtotalSteady,
      annualIvaSteadyMxn:         annualIvaSteady,
      annualFacturacionSteadyMxn: annualFacturacionSteady,
      demandaFacturableSource: demandaFacturableKw ? 'INPUT_CFE_C19' : 'SIM_PEAK_PUNTA_FALLBACK',
      // BDF-11: movil source provenance for designer diagnostics
      kWMaxAnoMovilSource: kWMaxAnoMovilKw ? 'INPUT_CFE_C16_OR_ROLLING' : 'NONE_LEGACY',
    };
  }

  // -- Apply NET_METERING annual cap ---------------------------------------
  // Under Mexican NET_METERING, you don't get paid: credit is capped at
  // consumption over the billing period (we use annual as proxy; CFE bills
  // monthly but credits roll forward, so annual is a reasonable approximation
  // for proposals). If export credit > energy import cost, cap at import cost.
  // IMPORTANT: demand charges are NOT offset by NET_METERING credits — the
  // credit only applies to energy (kWh) cost, not capacity (kW) cost.
  var effectiveEnergyCostMxn = totalImportCostMxn - totalExportCreditMxn;
  var capApplied = false;
  if (interconnMode === 'NET_METERING' && effectiveEnergyCostMxn < 0) {
    effectiveEnergyCostMxn = 0;
    capApplied = true;
    warnings.push('NET_METERING annual export credit exceeded import cost; '
      + 'credit was capped at consumption per Mexican NET_METERING rules. '
      + 'Surplus PV beyond annual consumption has no monetary value.');
  }
  var totalCostMxn = effectiveEnergyCostMxn + totalDemandChargeMxn;
  // When the full-bill computation ran, that's the authoritative annual cost
  // (it includes Distribución, Transmisión, CENACE, SCnMEM, Suministro, FP
  // charges, and IVA — items the R1 totalCostMxn omitted). The R1 number
  // remains exposed under `energyCostMxn + demandChargeMxn` for backward
  // compatibility with anything reading those fields directly.
  if (fullBill) {
    totalCostMxn = fullBill.annualFacturacionMxn;
  }

  return {
    blocked: false,
    warnings: warnings,
    tariff: opts.tariff,
    tariffClass: tariffClass,
    region: region,
    hours: hours,                      // 8760 entries
    annual: {
      loadKwh:           totalLoadKwh,
      pvKwh:             totalPvKwh,
      gridImportKwh:     totalGridImportKwh,
      gridExportKwh:     totalGridExportKwh,
      batteryDischargeKwh: totalBatteryDischargeKwh,
      batteryChargeKwh:    totalBatteryChargeKwh,
      energyCostMxn:     effectiveEnergyCostMxn,
      demandChargeMxn:   totalDemandChargeMxn,
      totalCostMxn:      totalCostMxn,
      importCostMxn:     totalImportCostMxn,
      exportCreditMxn:   totalExportCreditMxn,
      netMeteringCapApplied: capApplied,
      costByBucket:      costByBucket,
      importByBucket:    importByBucket,
      monthlyPeakPuntaKw: monthlyPeakPuntaKw,
      monthlyPeakAllKw:   monthlyPeakAllKw,
      monthlyImportKwh:   monthlyImportKwh,    // per-bucket per-month
      fullBill:           fullBill,            // null when tariffRatesByMonth omitted
    },
    // Chunk 5 Session 2: 3-scenario attribution (single-pass).
    // Writer (Session 3) computes BESS-attributable savings as
    //   bessSavings = pvOnly - pvBess     (per tier, per month)
    //   pvSavings   = baseline - pvOnly
    attribution: {
      baseline: {
        totalCostMxn:        attrBaselineCostMxn,
        costByBucket:        attrBaselineByBucket,
        monthlyPeakPuntaKw:  attrBaselinePeakPuntaKw,
        monthlyPeakAllKw:    attrBaselinePeakAllKw,
      },
      pvOnly: {
        totalCostMxn:        attrPvOnlyCostMxn,
        costByBucket:        attrPvOnlyByBucket,
        monthlyPeakPuntaKw:  attrPvOnlyPeakPuntaKw,
        monthlyPeakAllKw:    attrPvOnlyPeakAllKw,
      },
      pvBess: {
        totalCostMxn:        attrPvBessCostMxn,
        costByBucket:        attrPvBessByBucket,
        monthlyPeakPuntaKw:  attrPvBessPeakPuntaKw,
        monthlyPeakAllKw:    attrPvBessPeakAllKw,
      },
    },
    // Chunk 5 Session 2: planner's monthly schedules + ledgers, exposed
    // so the writer can show per-month strategy decomposition.
    bessSchedules: monthlySchedules,
    bessMonthlyContexts: monthlyContexts,   // Session 3: input to AUTO_OPTIMIZE
    interconnMode: interconnMode,           // Session 3: for range explanation
    provenance: {
      loadShape:  'PIECEWISE_FLAT_FROM_BILLS',
      pvShape:    monthlyPv
                    ? ((typeof _planSyntheticPvBellShape === 'function')
                        ? 'SYNTHETIC_BELL_CURVE_DAYLIGHT'
                        : 'PIECEWISE_FLAT_DAYLIGHT_PROXY')
                    : 'NONE',
      windows:    (tariffClass === 'TOU_GDMTH')
                  ? 'GDMTH_HARDCODED_' + region + '_EFFECTIVE_' + GDMTH_WINDOWS_EFFECTIVE_DATE
                  : (tariffClass === 'FLAT_RATE' ? 'FLAT_RATE_NO_WINDOWS' : 'FALLBACK_FLAT'),
      dispatcher: (typeof _planMonthlyBessSchedule === 'function')
                    ? 'SCHEDULE_AWARE_LEVEL2_CHUNK5'
                    : 'LEGACY_GREEDY',
    },
  };
}


// ===========================================================================
// Helpers
// ===========================================================================
function _safeNum(arr, idx) {
  if (!arr || idx < 0 || idx >= arr.length) return 0;
  var n = Number(arr[idx]);
  return isFinite(n) ? n : 0;
}

// BDF-11: which months are "winter" for CFE GDMTH punta-window purposes.
// Winter = Nov-Apr inclusive (longer 4-hour punta windows). Summer May-Oct
// (shorter 2-hour windows). Aligns with GDMTH_WINDOWS_EFFECTIVE_DATE 2026.
// bm is 0-indexed (0=Jan).
function _isWinterMonth(bm) {
  // Winter months: Jan(0), Feb(1), Mar(2), Apr(3), Nov(10), Dec(11)
  return (bm <= 3) || (bm >= 10);
}
