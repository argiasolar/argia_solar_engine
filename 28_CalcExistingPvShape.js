// =============================================================================
// ARGIA -- 28_CalcExistingPvShape.js
// -----------------------------------------------------------------------------
// CHUNK 7 Scenario 4B -- reconstruct an EXISTING customer's PV production as
// 12 monthly kWh totals, from whatever data they can provide.
//
// Pure functions (no SpreadsheetApp, no I/O). The output (12 monthly kWh)
// feeds the existing-PV hourly shape upstream in the hourly sim, which then
// computes EXPORTABLE SURPLUS (max(0, gen - load)) for the battery to capture.
//
// SOURCE PRIORITY (reviewer-confirmed):
//   1. MONTHLY_MEASURED  -- 12 actual monthly kWh figures (FUTURE input;
//                           customers with SolarEdge/Huawei/Sungrow/Fronius).
//                           Stubbed here: if a 12-length monthly array is
//                           supplied, it wins.
//   2. ANNUAL_MEASURED   -- one annual kWh figure, distributed across months
//                           by a seasonal weight curve.
//   3. KWP_ESTIMATED     -- system size x a production factor (kWh/kWp/yr),
//                           then distributed like ANNUAL_MEASURED.
//
// The returned existingPvSource.type records which path was used, so the
// proposal can reflect confidence (measured >> estimated). Seeds future
// SCREENING / PROPOSAL / BANKABLE quality scoring.
// =============================================================================

// Seasonal monthly weights for central-highlands Mexico (Jalisco/Bajío).
// Dry season (spring) is the irradiance peak; summer rainy season dips.
// Weights are relative; they are normalized to sum=1 before use, so only the
// SHAPE matters, not the absolute values.
var _EXISTING_PV_MONTH_WEIGHTS = [
  0.085, // Jan
  0.088, // Feb
  0.098, // Mar  (climbing into dry-season peak)
  0.100, // Apr  (peak)
  0.099, // May
  0.085, // Jun  (rainy season begins)
  0.080, // Jul  (cloudiest)
  0.080, // Aug
  0.078, // Sep
  0.083, // Oct
  0.082, // Nov
  0.082  // Dec
];

// Default production factor (kWh per kWp per year) for KWP_ESTIMATED, a
// conservative central-Mexico fixed-tilt figure. Used only when annual kWh
// is not supplied.
var EXISTING_PV_DEFAULT_PROD_FACTOR = 1650;

// ---------------------------------------------------------------------------
// calcExistingPvMonthly(o) -> { monthlyKwh: number[12], annualKwh, source }
//
// @param {Object} o
//   monthlyKwh        {number[12]} OPTIONAL future input. If a valid 12-length
//                                  array with any positive value is supplied,
//                                  it is used verbatim (MONTHLY_MEASURED).
//   existingPvAnnualKwh {number}   annual production (ANNUAL_MEASURED)
//   existingPvKwp       {number}   system size (KWP_ESTIMATED fallback)
//   prodFactor          {number}   OPTIONAL kWh/kWp/yr override for KWP path
// @return {Object}
//   monthlyKwh : number[12]
//   annualKwh  : number (sum)
//   source     : { type, detail }   type in MONTHLY_MEASURED |
//                ANNUAL_MEASURED | KWP_ESTIMATED | NONE
// ---------------------------------------------------------------------------
function calcExistingPvMonthly(o) {
  o = o || {};
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }

  // -- Priority 1: MONTHLY_MEASURED (future input) ------------------------
  if (Array.isArray(o.monthlyKwh) && o.monthlyKwh.length === 12) {
    var anyPos = false, monthly1 = [];
    for (var i = 0; i < 12; i++) {
      var v = Math.max(0, num(o.monthlyKwh[i], 0));
      monthly1.push(v);
      if (v > 0) anyPos = true;
    }
    if (anyPos) {
      var annual1 = monthly1.reduce(function (a, b) { return a + b; }, 0);
      return {
        monthlyKwh: monthly1, annualKwh: annual1,
        source: { type: 'MONTHLY_MEASURED',
                  detail: '12 valores mensuales medidos' }
      };
    }
    // all-zero monthly array -> fall through to annual/kWp
  }

  // -- Priority 2: ANNUAL_MEASURED ----------------------------------------
  var annual = Math.max(0, num(o.existingPvAnnualKwh, 0));
  var sourceType = 'ANNUAL_MEASURED';
  var detail = 'producción anual medida';

  // -- Priority 3: KWP_ESTIMATED (fallback) -------------------------------
  if (annual <= 0) {
    var kwp = Math.max(0, num(o.existingPvKwp, 0));
    if (kwp > 0) {
      var pf = Math.max(0, num(o.prodFactor, EXISTING_PV_DEFAULT_PROD_FACTOR));
      annual = kwp * pf;
      sourceType = 'KWP_ESTIMATED';
      detail = kwp + ' kWp x ' + pf + ' kWh/kWp/año (estimado)';
    }
  }

  if (annual <= 0) {
    return {
      monthlyKwh: new Array(12).fill(0), annualKwh: 0,
      source: { type: 'NONE', detail: 'sin datos de PV existente' }
    };
  }

  // Distribute the annual total across months by the seasonal weight curve.
  var wsum = 0;
  for (var w = 0; w < 12; w++) wsum += _EXISTING_PV_MONTH_WEIGHTS[w];
  var monthly = [];
  for (var m = 0; m < 12; m++) {
    monthly.push(annual * (_EXISTING_PV_MONTH_WEIGHTS[m] / wsum));
  }

  return {
    monthlyKwh: monthly, annualKwh: annual,
    source: { type: sourceType, detail: detail }
  };
}
