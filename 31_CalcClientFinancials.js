// =============================================================================
// ARGIA -- 31_CalcClientFinancials.js
// -----------------------------------------------------------------------------
// TRACK B P0 -- Client financial story (pure calc core)
//
// Computes the customer-facing financial narrative for a CASH PURCHASE of the
// PV+BESS system, alongside the comparison scenarios the sales deck needs:
//
//   CASH     : year-by-year net savings, cumulative position, simple +
//              discounted payback (interpolated to fractions of a year),
//              NPV, IRR, ROI over the analysis term.
//   LCOE     : levelized cost of energy (MXN/kWh) -- discounted lifetime
//              cost over discounted lifetime generation, with panel
//              degradation.
//   CO2      : avoided emissions per year-1, total over term (degraded),
//              plus client-friendly equivalences (cars off the road,
//              trees planted).
//   SCENARIOS: 3-way cumulative comparison per year -- DO NOTHING (CFE
//              bill keeps escalating), CASH purchase, BaaS lease (the
//              net-savings-by-year array from calcBaasEconomics).
//   HEADLINE : year-1 savings, % of current bill, demand-charge savings
//              (the GDMTH hook), term totals.
//
// CONVENTIONS (same as 30_CalcBaasEconomics, verified against the
// Draexlmaier/Taigene proposal PDFs):
//   - year-1 bill savings = year1BillWithoutMxn - year1BillWithMxn
//   - bills escalate at billEscalationPct, bill SAVINGS escalate at the
//     slower savingsEscalationPct (PV generation degrades while the bill
//     grows; the proposals' tables encode this decay)
//   - all figures MXN before IVA
//
// Pure function -- no SpreadsheetApp, no I/O. Fully unit-testable.
// Reuses _baasNpv / _baasIrr from 30_CalcBaasEconomics.js.
// =============================================================================

/**
 * @param {Object} o
 *   --- analysis frame ---
 *   analysisTermYears       {number}  e.g. 15 (match the BaaS term for the 3-way)
 *   billEscalationPct       {number}  CFE bill escalation (e.g. 0.07)
 *   savingsEscalationPct    {number}  bill-savings escalation (e.g. 0.04)
 *   discountRate            {number}  customer discount rate for NPV/LCOE (e.g. 0.10)
 *   --- cash purchase ---
 *   capexMxn                {number}  total installed CAPEX, customer-paid (PV+BESS)
 *   omCostMxnPerYear        {number}  O&M paid by the customer-owner
 *   replacementReserveMxnPerYear {number} battery wear reserve (customer-owned)
 *   --- bills (engine output, same convention as calcBaasEconomics) ---
 *   year1BillWithoutMxn     {number}  Yr-1 CFE bill with NO system
 *   year1BillWithMxn        {number}  Yr-1 CFE bill WITH PV+BESS
 *   --- headline detail ---
 *   demandChargeSavingMxnYear1 {number} the demand-charge slice of Yr-1 savings
 *   --- energy & emissions ---
 *   annualEnergyKwhYear1    {number}  Yr-1 energy delivered (PV gen + BESS shift)
 *   panelDegradationPct     {number}  per-year output degradation (e.g. 0.005)
 *   co2FactorTonPerMwh      {number}  grid emission factor tCO2e/MWh. Default
 *                                     0.435 -- pass the current official CRE/
 *                                     SEMARNAT factor from the DB at call time;
 *                                     the default is a placeholder, not a source.
 *   co2TonPerCarYear        {number}  equivalence: tCO2e per car per year (4.6)
 *   co2KgPerTreeYear        {number}  equivalence: kg CO2 per tree per year (21.8)
 *   --- 3-way comparison (optional) ---
 *   baasNetSavingsByYear    {number[]} net savings per year from calcBaasEconomics
 *                                      (.projection[i].netSavingsMxn); omit/empty
 *                                      to skip the BaaS scenario.
 * @return {Object} { headline, cash, lcoe, co2, scenarios, inputsEcho }
 */
function calcClientFinancials(o) {
  o = o || {};
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }

  var term        = Math.max(1, Math.round(num(o.analysisTermYears, 15)));
  var billEsc     = num(o.billEscalationPct, 0.07);
  var savingsEsc  = num(o.savingsEscalationPct, 0.04);
  var disc        = num(o.discountRate, 0.10);

  var capex       = num(o.capexMxn, 0);
  var omPerYear   = num(o.omCostMxnPerYear, 0);
  var replReserve = num(o.replacementReserveMxnPerYear, 0);

  var bill0Without = num(o.year1BillWithoutMxn, 0);
  var bill0With    = num(o.year1BillWithMxn, 0);
  var savings1     = bill0Without - bill0With;

  var demandSaving1 = num(o.demandChargeSavingMxnYear1, 0);

  var energy1     = num(o.annualEnergyKwhYear1, 0);
  var degr        = num(o.panelDegradationPct, 0.005);
  var co2Factor   = num(o.co2FactorTonPerMwh, 0.435);
  var tonPerCar   = num(o.co2TonPerCarYear, 4.6);
  var kgPerTree   = num(o.co2KgPerTreeYear, 21.8);

  var baasNet     = (o.baasNetSavingsByYear && o.baasNetSavingsByYear.length)
                    ? o.baasNetSavingsByYear.map(function (v) { return num(v, 0); })
                    : null;

  // --- CASH projection -----------------------------------------------------
  // Year y (1-based): savings_y = savings1 * (1+savingsEsc)^(y-1)
  //                   net_y     = savings_y - om - replReserve
  // Cumulative position starts at -capex (the purchase).
  var cashYears = [];
  var cum = -capex;
  var cumNoCapex = 0;            // cumulative net cash inflow (for ROI)
  var simplePayback = (capex <= 0) ? 0 : null;  // free system pays back instantly
  var prevCum = -capex;
  for (var y = 1; y <= term; y++) {
    var savingsY = savings1 * Math.pow(1 + savingsEsc, y - 1);
    var netY     = savingsY - omPerYear - replReserve;
    cum         += netY;
    cumNoCapex  += netY;
    if (simplePayback === null && prevCum < 0 && cum >= 0 && netY > 0) {
      // linear interpolation inside year y
      simplePayback = (y - 1) + (-prevCum) / netY;
    }
    cashYears.push({
      year: y,
      billSavingsMxn: savingsY,
      omMxn: omPerYear,
      replacementReserveMxn: replReserve,
      netSavingsMxn: netY,
      cumulativePositionMxn: cum,
    });
    prevCum = cum;
  }

  // Cash flow series for NPV/IRR: t0 = -capex, then net per year.
  var cashFlows = [-capex];
  cashYears.forEach(function (r) { cashFlows.push(r.netSavingsMxn); });
  var npv = _baasNpv(cashFlows, disc);
  var irr = _baasIrr(cashFlows);

  // Discounted payback: cumulative of discounted nets vs capex.
  var discountedPayback = (capex <= 0) ? 0 : null;
  var cumDisc = -capex, prevCumDisc = -capex;
  for (var y2 = 1; y2 <= term; y2++) {
    var discNet = cashYears[y2 - 1].netSavingsMxn / Math.pow(1 + disc, y2);
    cumDisc += discNet;
    if (discountedPayback === null && prevCumDisc < 0 && cumDisc >= 0 && discNet > 0) {
      discountedPayback = (y2 - 1) + (-prevCumDisc) / discNet;
    }
    prevCumDisc = cumDisc;
  }

  // ROI over the term: total net inflows vs the capex paid.
  var roiPct = (capex > 0) ? (cumNoCapex - capex) / capex : 0;

  // --- LCOE ------------------------------------------------------------------
  // (capex + Σ_y disc(om+reserve)) / Σ_y disc(energy_y), energy degraded.
  // Discounting energy is the standard LCOE form (NREL); disc=0 collapses to
  // plain lifetime-cost / lifetime-energy.
  var costDisc = capex, energyDisc = 0, energyTotal = 0;
  for (var y3 = 1; y3 <= term; y3++) {
    var df = Math.pow(1 + disc, y3);
    var energyY = energy1 * Math.pow(1 - degr, y3 - 1);
    costDisc   += (omPerYear + replReserve) / df;
    energyDisc += energyY / df;
    energyTotal += energyY;
  }
  var lcoeMxnPerKwh = (energyDisc > 0) ? costDisc / energyDisc : 0;

  // --- CO2 --------------------------------------------------------------------
  var co2Year1Tons = (energy1 / 1000) * co2Factor;
  var co2TermTons  = (energyTotal / 1000) * co2Factor;
  var carsEquivalent  = (tonPerCar > 0)  ? co2Year1Tons / tonPerCar          : 0;
  var treesEquivalent = (kgPerTree > 0)  ? (co2Year1Tons * 1000) / kgPerTree : 0;

  // --- 3-way scenarios ---------------------------------------------------------
  // Per year: cumulative CFE spend if DO NOTHING; cumulative net position for
  // CASH (includes the -capex at t0); cumulative net savings for BAAS.
  var scenarios = [];
  var cumDoNothing = 0, cumBaas = 0;
  for (var y4 = 1; y4 <= term; y4++) {
    cumDoNothing += bill0Without * Math.pow(1 + billEsc, y4 - 1);
    var row = {
      year: y4,
      doNothingCumulativeSpendMxn: cumDoNothing,
      cashCumulativePositionMxn: cashYears[y4 - 1].cumulativePositionMxn,
    };
    if (baasNet) {
      cumBaas += (y4 - 1 < baasNet.length) ? baasNet[y4 - 1] : 0;
      row.baasCumulativeNetMxn = cumBaas;
    }
    scenarios.push(row);
  }

  // --- Headline ------------------------------------------------------------------
  var headline = {
    year1SavingsMxn: savings1,
    savingsPctOfBill: (bill0Without > 0) ? savings1 / bill0Without : 0,
    demandChargeSavingMxnYear1: demandSaving1,
    demandChargePctOfSavings: (savings1 > 0) ? demandSaving1 / savings1 : 0,
    termYears: term,
    termTotalNetMxn: cumNoCapex,
    termEndPositionMxn: cum,
  };

  return {
    headline: headline,
    cash: {
      capexMxn: capex,
      years: cashYears,
      simplePaybackYears: simplePayback,        // null = does not pay back in term
      discountedPaybackYears: discountedPayback, // null = does not pay back in term
      npvMxn: npv,
      irr: irr,                                  // null when _baasIrr can't bracket
      roiPctOverTerm: roiPct,
    },
    lcoe: {
      mxnPerKwh: lcoeMxnPerKwh,
      lifetimeEnergyKwh: energyTotal,
      discountRate: disc,
    },
    co2: {
      factorTonPerMwh: co2Factor,
      year1Tons: co2Year1Tons,
      termTons: co2TermTons,
      carsEquivalent: carsEquivalent,
      treesEquivalent: treesEquivalent,
    },
    scenarios: scenarios,
    inputsEcho: {
      year1BillWithoutMxn: bill0Without,
      year1BillWithMxn: bill0With,
      billEscalationPct: billEsc,
      savingsEscalationPct: savingsEsc,
    },
  };
}


// ---------------------------------------------------------------------------
// [G6] Batch 2 -- PURE zero-guards for the client financial story. The live
// workbook shipped a BESS proposal with O&M = $0 and replacement reserve =
// $0: inputs wired (INPUT_BAAS filas 16/17) but blank, silently overstating
// net savings and LCOE. Rules:
//   OM_ZERO       fires when O&M <= 0 -- every solar project has real O&M.
//   RESERVE_ZERO  fires when reserve <= 0 AND the project has BESS materials
//                 (battery wear is a real cost; PV-only projects are exempt).
// Returns [{code, msg}] -- callers prefix with their context tag.
// ---------------------------------------------------------------------------
function argiaFinancialGuardNotes(o) {
  o = o || {};
  var om      = Number(o.omCostMxnPerYear) || 0;
  var reserve = Number(o.replacementReserveMxnPerYear) || 0;
  var bess    = Number(o.bessMaterialsMxn) || 0;
  var notes = [];
  if (!(om > 0)) {
    notes.push({
      code: 'OM_ZERO',
      msg : 'O&M anual = $0 (INPUT_BAAS fila 16). Ahorro neto y LCOE '
          + 'sobreestimados \u2014 capture el costo real de operaci\u00f3n y '
          + 'mantenimiento antes de enviar al cliente.'
    });
  }
  if (!(reserve > 0) && bess > 0) {
    notes.push({
      code: 'RESERVE_ZERO',
      msg : 'Reserva de reemplazo BESS = $0 (INPUT_BAAS fila 17) en un '
          + 'proyecto con bater\u00eda. El desgaste del banco no est\u00e1 '
          + 'provisionado \u2014 ahorro neto sobreestimado.'
    });
  }
  return notes;
}
