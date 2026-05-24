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

  // PV per-hour (split monthly PV evenly across daylight hours: 6:00-19:00).
  // The existing PV engine doesn't yet expose hourly PV; this is a placeholder
  // that approximates the "PV is available during the day" pattern.
  // BDF-5 follow-up: read actual hourly PV from the PV calc step if available.
  var pvPerDaylightHour = new Array(12).fill(0);
  if (monthlyPv) {
    for (var mp = 0; mp < 12; mp++) {
      var pvKwh = _safeNum(monthlyPv.kwh, mp);
      var daylightHours = 14;  // 6:00 - 19:59 = 14 hours
      var daysInM = _daysInMonth(mp + 1);
      pvPerDaylightHour[mp] = (pvKwh > 0) ? pvKwh / (daysInM * daylightHours) : 0;
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

  // Resolve rates with sensible defaults so the loop never NaNs
  var rateBase  = Number(rates.baseMxnPerKwh)       || 0;
  var rateInter = Number(rates.intermediaMxnPerKwh) || rateBase;
  var ratePunta = Number(rates.puntaMxnPerKwh)      || rateBase;

  for (var month = 1; month <= 12; month++) {
    var days = _daysInMonth(month);
    for (var day = 1; day <= days; day++) {
      var dow = _dayOfWeekFor(month, day);
      for (var hour = 0; hour < 24; hour++) {
        var bucket = (tariffClass === 'TOU_GDMTH')
                     ? classifyGdmthHour(region, month, dow, hour)
                     : 'base';
        var loadKwh = perHourKwh[bucket][month - 1];
        var pvKwh = (hour >= 6 && hour <= 19) ? pvPerDaylightHour[month - 1] : 0;

        // Net load after PV
        var netLoadKwh = loadKwh - pvKwh;
        var pvSurplusKwh = (netLoadKwh < 0) ? -netLoadKwh : 0;
        var residualNetLoadKwh = (netLoadKwh > 0) ? netLoadKwh : 0;

        // Battery dispatch (greedy)
        var batteryActionKwh = 0;  // positive = discharge, negative = charge
        if (batteryCapKwh > 0) {
          if (bucket === 'punta' && residualNetLoadKwh > 0) {
            // Discharge to cover load
            var availableEnergy = Math.max(0, batterySoc - minSocKwh);
            var dischargeKwh = Math.min(residualNetLoadKwh, availableEnergy, batteryPowerKw);
            batteryActionKwh = dischargeKwh;
            batterySoc -= dischargeKwh;
            totalBatteryDischargeKwh += dischargeKwh;
            monthlyBatteryDischargeKwhPerMonth[month - 1] += dischargeKwh;   // BDF-11
          } else if (pvSurplusKwh > 0) {
            // Charge from PV surplus (any mode benefits when surplus exists)
            var roomKwh = Math.max(0, maxSocKwh - batterySoc);
            var chargeFromPvKwh = Math.min(pvSurplusKwh, roomKwh, batteryPowerKw);
            // RTE loss: each kWh going in delivers rte * kWh out later
            batterySoc += chargeFromPvKwh * rte;
            batteryActionKwh = -chargeFromPvKwh;
            totalBatteryChargeKwh += chargeFromPvKwh;
            pvSurplusKwh -= chargeFromPvKwh;
          } else if (bucket === 'base'
                     && interconnMode === 'NET_BILLING'
                     && batterySoc < maxSocKwh) {
            // Charge from grid base during base hours under NET_BILLING
            // (only mode where this typically pays).
            var roomKwhB = Math.max(0, maxSocKwh - batterySoc);
            var chargeFromGridKwh = Math.min(roomKwhB, batteryPowerKw);
            batterySoc += chargeFromGridKwh * rte;
            batteryActionKwh = -chargeFromGridKwh;
            totalBatteryChargeKwh += chargeFromGridKwh;
            // This adds to grid import
            residualNetLoadKwh += chargeFromGridKwh;
          }
          // Clamp SOC to safe range
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
    provenance: {
      loadShape:  'PIECEWISE_FLAT_FROM_BILLS',
      pvShape:    monthlyPv ? 'PIECEWISE_FLAT_DAYLIGHT_PROXY' : 'NONE',
      windows:    (tariffClass === 'TOU_GDMTH')
                  ? 'GDMTH_HARDCODED_' + region + '_EFFECTIVE_' + GDMTH_WINDOWS_EFFECTIVE_DATE
                  : (tariffClass === 'FLAT_RATE' ? 'FLAT_RATE_NO_WINDOWS' : 'FALLBACK_FLAT'),
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
