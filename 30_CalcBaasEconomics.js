// =============================================================================
// ARGIA -- 30_CalcBaasEconomics.js
// -----------------------------------------------------------------------------
// CHUNK 6 -- BaaS Economics Engine
//
// Reproduces ARGIA's actual lease/BaaS math (verified to the peso against
// the Draexlmaier and Taigene proposal PDFs, 2026-03/05).
//
// TWO LEASE PRODUCTS
//   FINANCIERO (financial lease): payment escalates at a fixed rate
//     (4.0%/yr in the proposals). Has a tax benefit (solar CAPEX
//     deduction) amortized over a fixed number of years -- BUT only for
//     customers that can actually utilize it (need taxable profit). The
//     tax benefit is CONDITIONAL and carries a disclaimer.
//   PURO (pure/operating lease): payment indexed to inflation (INPC).
//     No tax benefit.
//
// THE 15-YEAR PROJECTION (the customer deliverable)
//   For each year: bill without ARGIA, bill with ARGIA, bill savings,
//   lease payment, O&M, tax benefit, net savings, net %, cumulative,
//   cumulative %. Verified: Draexlmaier Yr-1 net =
//     15,314,052 - 10,844,217 - 0 + 1,566,923 = 6,036,758  (matches PDF)
//
// ARGIA SIDE (beyond the PDF)
//   Given CAPEX + wear-cost replacement reserve + O&M + a target IRR,
//   solve for the minimum lease payment that achieves ARGIA's IRR
//   (the floor). The maximum lease payment is where the customer's
//   net savings hits zero (the ceiling). The negotiable range is
//   [min, max].
//
// Pure function -- no SpreadsheetApp, no I/O. Fully unit-testable.
// =============================================================================

/**
 * @param {Object} o
 *   --- deal economics (from INPUT_BAAS) ---
 *   leaseTermYears        {number}  e.g. 15
 *   leaseType             {string}  'FINANCIERO' | 'PURO'
 *   paymentEscalationPct  {number}  fixed escalation for FINANCIERO (e.g. 0.04)
 *   inpcEscalationPct     {number}  INPC escalation for PURO (e.g. 0.05)
 *   billEscalationPct     {number}  CFE bill escalation (e.g. 0.07)
 *   targetIrr             {number}  ARGIA target IRR (e.g. 0.15) -- per deal
 *   discountRate          {number}  ARGIA WACC for NPV (e.g. 0.12) -- per deal
 *   --- costs (from engine/BoS/catalog) ---
 *   capexMxn              {number}  total installed CAPEX (PV + BESS)
 *   solarCapexMxn         {number}  solar-only CAPEX (drives tax benefit)
 *   omCostMxnPerYear      {number}  O&M (often bundled = 0 in the table)
 *   replacementReserveMxnPerYear {number}  battery wear reserve (Session 2)
 *   --- customer side (from Session 3 engine output) ---
 *   year1BillWithoutMxn   {number}  Yr-1 CFE bill with NO ARGIA system
 *   year1BillWithMxn      {number}  Yr-1 CFE bill WITH PV+BESS
 *   --- tax (FINANCIERO only, conditional) ---
 *   taxBenefitRate        {number}  ISR rate for solar CAPEX deduction (e.g. 0.30)
 *   taxAmortYears         {number}  years to amortize the benefit (e.g. 10)
 *   customerCanUseTaxBenefit {boolean}  must have taxable profit to utilize
 *   --- lease payment (optional; if omitted, uses min-for-target-IRR) ---
 *   leasePaymentYear1Mxn  {number}  annual Yr-1 lease; if null, solved
 * @return {Object} see bottom of function
 */
function calcBaasEconomics(o) {
  o = o || {};
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
  function bool(v, d) { return (v === true || v === false) ? v : d; }

  var term            = Math.max(1, Math.round(num(o.leaseTermYears, 15)));
  var leaseType       = (String(o.leaseType || 'FINANCIERO').toUpperCase() === 'PURO')
                        ? 'PURO' : 'FINANCIERO';
  var escFixed        = num(o.paymentEscalationPct, 0.04);
  var escInpc         = num(o.inpcEscalationPct, 0.05);
  var billEsc         = num(o.billEscalationPct, 0.07);
  var savingsEsc      = num(o.savingsEscalationPct, 0.04);   // bill-savings escalation (decays slower than bill)
  var targetIrr       = num(o.targetIrr, 0.15);
  var discountRate    = num(o.discountRate, 0.12);

  var capexMxn        = num(o.capexMxn, 0);
  var solarCapexMxn   = num(o.solarCapexMxn, 0);
  var omPerYear       = num(o.omCostMxnPerYear, 0);
  var replReserve     = num(o.replacementReserveMxnPerYear, 0);

  var bill0Without    = num(o.year1BillWithoutMxn, 0);
  var bill0With       = num(o.year1BillWithMxn, 0);

  var taxRate         = num(o.taxBenefitRate, 0.30);
  var taxAmortYears   = Math.max(1, Math.round(num(o.taxAmortYears, 10)));
  var canUseTax       = bool(o.customerCanUseTaxBenefit, false);

  // The escalation that applies to the lease payment for this product.
  var leaseEsc = (leaseType === 'PURO') ? escInpc : escFixed;

  // --- Tax benefit (FINANCIERO + customer can utilize it) ----------------
  // Solar CAPEX deduction: taxRate × solarCapex, spread over taxAmortYears.
  // CONDITIONAL: only if leaseType is FINANCIERO AND the customer has the
  // taxable profit to use the deduction. Otherwise zero. The disclaimer
  // (rendered by the writer) makes this explicit.
  var taxBenefitPerYear = 0;
  var taxApplies = (leaseType === 'FINANCIERO' && canUseTax && solarCapexMxn > 0);
  if (taxApplies) {
    taxBenefitPerYear = (taxRate * solarCapexMxn) / taxAmortYears;
  }

  // --- Resolve the Yr-1 lease payment ------------------------------------
  // If the caller supplied one, use it. Otherwise solve for the minimum
  // Yr-1 lease that gives ARGIA its target IRR.
  var leaseY1 = (o.leasePaymentYear1Mxn != null && isFinite(o.leasePaymentYear1Mxn))
    ? Number(o.leasePaymentYear1Mxn)
    : _baasSolveMinLeaseForIrr({
        capexMxn: capexMxn, term: term, leaseEsc: leaseEsc,
        omPerYear: omPerYear, replReserve: replReserve, targetIrr: targetIrr
      });

  // --- Build the 15-year projection --------------------------------------
  var projection = _baasBuildProjection({
    term: term,
    bill0Without: bill0Without, bill0With: bill0With, billEsc: billEsc,
    savingsEsc: savingsEsc,
    leaseY1: leaseY1, leaseEsc: leaseEsc,
    omPerYear: omPerYear,
    taxBenefitPerYear: taxBenefitPerYear, taxAmortYears: taxAmortYears
  });

  // --- ARGIA-side economics ----------------------------------------------
  // ARGIA cashflow: -capex at t0, +lease - om - replReserve each year.
  var argiaCashflows = [-capexMxn];
  for (var y = 1; y <= term; y++) {
    var leaseThisYear = leaseY1 * Math.pow(1 + leaseEsc, y - 1);
    argiaCashflows.push(leaseThisYear - omPerYear - replReserve);
  }
  var argiaIrr = _baasIrr(argiaCashflows);
  var argiaNpv = _baasNpv(argiaCashflows, discountRate);

  // --- Negotiable range --------------------------------------------------
  // Floor: min lease for ARGIA's target IRR (already solved or implied).
  // Ceiling: lease where customer Yr-1 net savings hits zero.
  var minLeaseY1 = _baasSolveMinLeaseForIrr({
    capexMxn: capexMxn, term: term, leaseEsc: leaseEsc,
    omPerYear: omPerYear, replReserve: replReserve, targetIrr: targetIrr
  });
  // Customer Yr-1 net = billSavings - lease - om + tax >= 0
  //   => lease <= billSavings - om + tax  (Yr-1)
  var billSavingsY1 = bill0Without - bill0With;
  var maxLeaseY1 = billSavingsY1 - omPerYear + taxBenefitPerYear;
  if (maxLeaseY1 < 0) maxLeaseY1 = 0;

  // --- Headline KPIs (match the proposal summary page) -------------------
  var ahorroNetoY1 = projection.length ? projection[0].ahorroNeto : 0;
  var ahorroNetoY1Pct = projection.length ? projection[0].ahorroNetoPct : 0;
  var ahorroAcum = projection.length ? projection[projection.length - 1].ahorroAcum : 0;

  return {
    leaseType:          leaseType,
    leaseTermYears:     term,
    leasePaymentYear1Mxn: leaseY1,
    leasePaymentYear1Mensual: leaseY1 / 12,
    leaseEscalationPct: leaseEsc,

    taxApplies:         taxApplies,
    taxBenefitPerYear:  taxBenefitPerYear,
    taxBenefitTotal:    taxBenefitPerYear * Math.min(taxAmortYears, term),

    projection:         projection,

    argiaIrr:           argiaIrr,
    argiaNpv:           argiaNpv,

    negotiableRange: {
      minLeaseY1Mxn:    minLeaseY1,
      maxLeaseY1Mxn:    maxLeaseY1,
      minLeaseMensual:  minLeaseY1 / 12,
      maxLeaseMensual:  maxLeaseY1 / 12,
      valid:            maxLeaseY1 >= minLeaseY1   // false = no viable deal
    },

    headline: {
      plazoAnios:       term,
      mensualidadAno1:  leaseY1 / 12,
      ahorroAno1Mxn:    ahorroNetoY1,
      ahorroAno1Pct:    ahorroNetoY1Pct,
      ahorroPlazoMxn:   ahorroAcum
    },

    provenance: 'BAAS_PROPOSAL_TIER_ESTIMATE'
  };
}


// ---------------------------------------------------------------------------
// Build the 15-year projection table (matches the proposal column layout).
//
// IMPORTANT (verified against Draexlmaier/Taigene PDFs): the "con ARGIA"
// bill is NOT independently escalated. It is DERIVED as (sin - ahorro),
// where the BILL SAVINGS (ahorro) escalates at its own rate -- slower than
// the CFE bill itself. This is why net savings as a % of the bill DECLINES
// over the term (10.2% -> 5.3% in the Draexlmaier financiero case): the
// bill grows ~7%/yr while the BESS+PV savings grows ~4%/yr (demand-charge
// savings track tariff inflation but the kWh-shifting benefit erodes with
// battery degradation). Modeling con = sin - ahorro with separate
// escalation rates reproduces the proposal structure faithfully.
// ---------------------------------------------------------------------------
function _baasBuildProjection(p) {
  var rows = [];
  var cumNeto = 0;
  var cumSin  = 0;
  var ahorro0 = p.bill0Without - p.bill0With;   // Yr-1 bill savings
  for (var y = 1; y <= p.term; y++) {
    var pow = y - 1;
    var billSin = p.bill0Without * Math.pow(1 + p.billEsc, pow);
    var ahorroRecibo = ahorro0 * Math.pow(1 + p.savingsEsc, pow);
    var billCon = billSin - ahorroRecibo;        // derived, matches PDF
    var lease = p.leaseY1 * Math.pow(1 + p.leaseEsc, pow);
    var opex = p.omPerYear;
    var tax = (y <= p.taxAmortYears) ? p.taxBenefitPerYear : 0;
    var ahorroNeto = ahorroRecibo - lease - opex + tax;
    cumNeto += ahorroNeto;
    cumSin  += billSin;
    rows.push({
      year:          y,
      billSin:       billSin,
      billCon:       billCon,
      ahorroRecibo:  ahorroRecibo,
      lease:         lease,
      opex:          opex,
      taxBenefit:    tax,
      ahorroNeto:    ahorroNeto,
      ahorroNetoPct: billSin > 0 ? ahorroNeto / billSin : 0,
      ahorroAcum:    cumNeto,
      ahorroAcumPct: cumSin > 0 ? cumNeto / cumSin : 0
    });
  }
  return rows;
}


// ---------------------------------------------------------------------------
// Solve for the minimum Yr-1 lease payment that gives ARGIA its target IRR.
// Bisection on leaseY1; ARGIA cashflow = -capex, then (lease - om - reserve)
// escalating each year. Monotonic in leaseY1, so bisection is safe.
// ---------------------------------------------------------------------------
function _baasSolveMinLeaseForIrr(p) {
  if (p.capexMxn <= 0) return 0;
  // IRR is increasing in leaseY1. Find leaseY1 such that IRR == targetIrr,
  // i.e. NPV at targetIrr == 0.
  function npvAtTarget(leaseY1) {
    var cf = [-p.capexMxn];
    for (var y = 1; y <= p.term; y++) {
      var lease = leaseY1 * Math.pow(1 + p.leaseEsc, y - 1);
      cf.push(lease - p.omPerYear - p.replReserve);
    }
    return _baasNpv(cf, p.targetIrr);
  }
  var lo = 0, hi = p.capexMxn;   // hi: one year's lease = full capex is way more than enough
  // Expand hi until NPV positive (guard against pathological inputs)
  var guard = 0;
  while (npvAtTarget(hi) < 0 && guard < 60) { hi *= 2; guard++; }
  for (var i = 0; i < 100; i++) {
    var mid = (lo + hi) / 2;
    if (npvAtTarget(mid) > 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}


// ---------------------------------------------------------------------------
// NPV of a cashflow array (cf[0] at t0) at rate r.
// ---------------------------------------------------------------------------
function _baasNpv(cf, r) {
  var npv = 0;
  for (var t = 0; t < cf.length; t++) {
    npv += cf[t] / Math.pow(1 + r, t);
  }
  return npv;
}


// ---------------------------------------------------------------------------
// IRR via bisection on NPV == 0. Returns null when no sign change (no IRR).
// Range scanned: -0.99 .. 10.0 (i.e. up to 1000%).
// ---------------------------------------------------------------------------
function _baasIrr(cf) {
  function npv(r) { return _baasNpv(cf, r); }
  var lo = -0.99, hi = 10.0;
  var nLo = npv(lo), nHi = npv(hi);
  if (!isFinite(nLo) || !isFinite(nHi)) return null;
  if (nLo === 0) return lo;
  if (nHi === 0) return hi;
  if ((nLo > 0) === (nHi > 0)) return null;   // no sign change -> no real IRR in range
  for (var i = 0; i < 200; i++) {
    var mid = (lo + hi) / 2;
    var nMid = npv(mid);
    if (Math.abs(nMid) < 1e-6) return mid;
    if ((nMid > 0) === (nLo > 0)) { lo = mid; nLo = nMid; }
    else { hi = mid; }
  }
  return (lo + hi) / 2;
}
