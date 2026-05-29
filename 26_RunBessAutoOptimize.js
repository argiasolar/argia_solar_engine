// =============================================================================
// ARGIA -- 26_RunBessAutoOptimize.js
// -----------------------------------------------------------------------------
// CHUNK 5 -- Session 3
//
// AUTO_OPTIMIZE -- strategy evaluator (NOT a dispatch strategy)
// ============================================================
//
// Per reviewer R3: AUTO_OPTIMIZE is not a dispatch strategy, it's a
// strategy EVALUATOR that sits ABOVE the planner. For each month it
// plans PEAK_SHAVING / SELF_CONSUMPTION_MAX / LOAD_SHIFTING, scores each
// by estimated monthly MXN savings (from the planner's ledger), and picks
// the per-month winner.
//
// This produces the Conservative / Expected / Upside view (R1):
//   Conservative = PEAK_SHAVING everywhere (the safe floor)
//   Expected     = customer's selected strategy (computed by the real
//                  full-bill hourly sim, not here -- this module only
//                  produces the bounds)
//   Upside       = AUTO_OPTIMIZE (per-month best-of)
//
// DESIGN DECISION 1c (signed off):
//   This module does NOT run additional full 8760-hour bill-calc sims.
//   It reuses the Session 1 planner's per-strategy ledgers (est-MXN,
//   screening-grade) to score strategies. The Expected headline number
//   still comes from the real full-bill hourly sim of the selected
//   strategy (computed elsewhere in runHourlySimulation). Only the
//   Conservative/Upside BOUNDS use ledger estimates -- appropriate for
//   what they are (bounds, not commitments). This avoids 5x sim runs
//   and the Apps Script 6-minute quota risk.
//
// TIER
//   The bounds this module produces are SCREENING-grade (ledger est-MXN).
//   The writer labels the overall output PROPOSAL only because the
//   Expected headline is a real bill-calc; the Conservative/Upside range
//   is explicitly a screening-grade band around it. The disclaimer makes
//   this honest.
//
// Pure function -- takes precomputed monthCtxs, returns a decision object.
// No engine/sheet access.
// =============================================================================

/**
 * Evaluate PS / SC / LS per month and pick the best.
 *
 * @param {Array<Object>} monthCtxs -- 12 monthCtx objects (the same shape
 *   _planMonthlyBessSchedule consumes), one per month. Built by
 *   calcHourlySimulation / runHourlySimulation.
 * @param {Object} opts
 *   selectedStrategy {string}  -- the customer's chosen strategy (for the
 *                                 'Expected' tag; default 'PEAK_SHAVING')
 * @return {Object}
 *   {
 *     optimalByMonth:    ['PS','PS','LS',...]   (12 entries)
 *     conservativeMxn:   number  (annual, PS-everywhere)
 *     expectedMxn:       number  (annual, selectedStrategy-everywhere -- est)
 *     upsideMxn:         number  (annual, per-month best-of)
 *     perStrategyMonthly: {
 *       PEAK_SHAVING:         [12 monthly est-MXN],
 *       SELF_CONSUMPTION_MAX: [12 monthly est-MXN],
 *       LOAD_SHIFTING:        [12 monthly est-MXN]
 *     },
 *     monthlySchedulesByStrategy: { PS:[...], SC:[...], LS:[...] }  (for writer)
 *     provenance: 'LEDGER_EST_MXN_SCREENING'
 *   }
 */
function _runBessAutoOptimize(monthCtxs, opts) {
  opts = opts || {};
  var selected = _aoNormalizeStrategy(opts.selectedStrategy || 'PEAK_SHAVING');

  var STRATS = ['PEAK_SHAVING', 'SELF_CONSUMPTION_MAX', 'LOAD_SHIFTING'];
  var SHORT  = { PEAK_SHAVING: 'PS', SELF_CONSUMPTION_MAX: 'SC', LOAD_SHIFTING: 'LS' };

  // Guard: no contexts -> empty decision (engine handles gracefully)
  if (!monthCtxs || !monthCtxs.length) {
    return _aoEmptyDecision(selected);
  }

  // Plan every strategy for every month, capture monthly est-MXN savings.
  var perStrategyMonthly = {
    PEAK_SHAVING:         new Array(12).fill(0),
    SELF_CONSUMPTION_MAX: new Array(12).fill(0),
    LOAD_SHIFTING:        new Array(12).fill(0)
  };
  var monthlySchedulesByStrategy = {
    PEAK_SHAVING:         new Array(12).fill(null),
    SELF_CONSUMPTION_MAX: new Array(12).fill(null),
    LOAD_SHIFTING:        new Array(12).fill(null)
  };

  for (var m = 0; m < monthCtxs.length && m < 12; m++) {
    var ctx = monthCtxs[m];
    if (!ctx) continue;
    var daysInMonth = Number(ctx.daysInMonth) || 30;

    for (var s = 0; s < STRATS.length; s++) {
      var strat = STRATS[s];
      var schedule = _planMonthlyBessSchedule(ctx, strat);
      monthlySchedulesByStrategy[strat][m] = schedule;

      // Monthly est-MXN = daily ledger est-MXN × daysInMonth.
      // The ledger fields are per-day per the Session 1 spec.
      var L = (schedule && schedule.meta && schedule.meta.ledger)
              ? schedule.meta.ledger : {};
      var dailyMxn =
          (Number(L.estAvoidedCapacidadMxn)    || 0)
        + (Number(L.estAvoidedDistribucionMxn) || 0)
        + (Number(L.estAvoidedVariableMxn)     || 0);
      perStrategyMonthly[strat][m] = dailyMxn * daysInMonth;
    }
  }

  // Per-month winner = strategy with the highest monthly est-MXN savings.
  // Tie-break order: PS > SC > LS (prefer the simpler/safer strategy when
  // savings are equal -- conservative bias, and PS never grid-charges).
  var optimalByMonth = new Array(12).fill('PS');
  var upsideMonthly  = new Array(12).fill(0);
  for (var mm = 0; mm < 12; mm++) {
    var psV = perStrategyMonthly.PEAK_SHAVING[mm];
    var scV = perStrategyMonthly.SELF_CONSUMPTION_MAX[mm];
    var lsV = perStrategyMonthly.LOAD_SHIFTING[mm];

    var winner = 'PS'; var winnerV = psV;
    // Only switch off PS if the alternative is MATERIALLY better
    // (> 0.5 MXN/month avoids float-noise flapping).
    if (scV > winnerV + 0.5) { winner = 'SC'; winnerV = scV; }
    if (lsV > winnerV + 0.5) { winner = 'LS'; winnerV = lsV; }
    optimalByMonth[mm] = winner;
    upsideMonthly[mm]  = winnerV;
  }

  // Annual rollups
  var conservativeMxn = _aoSum(perStrategyMonthly.PEAK_SHAVING);
  var expectedMxn     = _aoSum(perStrategyMonthly[selected]);
  var upsideMxn       = _aoSum(upsideMonthly);

  // Upside can never be below Conservative (best-of >= PS-everywhere).
  // Defensive clamp against float noise.
  if (upsideMxn < conservativeMxn) upsideMxn = conservativeMxn;

  return {
    optimalByMonth:            optimalByMonth,
    conservativeMxn:           conservativeMxn,
    expectedMxn:               expectedMxn,
    upsideMxn:                 upsideMxn,
    perStrategyMonthly:        perStrategyMonthly,
    monthlySchedulesByStrategy: monthlySchedulesByStrategy,
    selectedStrategy:          selected,
    provenance:                'LEDGER_EST_MXN_SCREENING'
  };
}


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _aoNormalizeStrategy(raw) {
  var s = String(raw || '').toUpperCase().trim();
  if (s === 'SELF_CONSUMPTION_MAX' || s === 'SC' || s === 'SELF_CONSUMPTION') {
    return 'SELF_CONSUMPTION_MAX';
  }
  if (s === 'LOAD_SHIFTING' || s === 'LS' || s === 'LOAD_SHIFT') {
    return 'LOAD_SHIFTING';
  }
  return 'PEAK_SHAVING';
}

function _aoSum(arr) {
  var t = 0;
  for (var i = 0; i < arr.length; i++) t += (Number(arr[i]) || 0);
  return t;
}

function _aoEmptyDecision(selected) {
  return {
    optimalByMonth:            new Array(12).fill('PS'),
    conservativeMxn:           0,
    expectedMxn:               0,
    upsideMxn:                 0,
    perStrategyMonthly: {
      PEAK_SHAVING:         new Array(12).fill(0),
      SELF_CONSUMPTION_MAX: new Array(12).fill(0),
      LOAD_SHIFTING:        new Array(12).fill(0)
    },
    monthlySchedulesByStrategy: {
      PEAK_SHAVING:         new Array(12).fill(null),
      SELF_CONSUMPTION_MAX: new Array(12).fill(null),
      LOAD_SHIFTING:        new Array(12).fill(null)
    },
    selectedStrategy:          selected,
    provenance:                'NO_CONTEXTS'
  };
}
