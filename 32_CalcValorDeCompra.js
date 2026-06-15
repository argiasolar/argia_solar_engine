// =============================================================================
// ARGIA ENGINE -- 32_CalcValorDeCompra.js
// -----------------------------------------------------------------------------
// Valor de Compra (residual value / buyout schedule) for BaaS-leased systems.
//
// Reverse-engineered from the live BaaS proposal workbooks (PPA sheet,
// "ANEXO 7 -- Valor Residual"), verified identical across Taigene, Draexlmaier
// and Autoplastek: a STRAIGHT-LINE depreciation of the installed CAPEX (incl.
// IVA) over the contract term. The workbook builds an amortization-schedule
// structure but hardcodes interest = 0, so the result is pure straight-line.
//
//   valorDeCompra(n) = capexConIva * max(0, 1 - n/term)   for n = 0..term
//   capexConIva      = systemCapexMxn * (1 + ivaPct)
//   annualDecline    = capexConIva / term     ("CUOTA")
//
// CAPEX basis is the FULL installed system (PV + BESS + install), pre-IVA --
// the buyout transfers the whole delivered system, not just the battery.
// term defaults to 16 (the workbooks use 15-yr horizon + 1).
//
// Pure function -- no sheet I/O. See docs/VALOR_DE_COMPRA_SPEC.md.
// =============================================================================

/**
 * Compute the Valor de Compra (buyout) schedule.
 *
 * @param {Object} o
 *   o.systemCapexMxn  {number}  full installed CAPEX in MXN, PRE-IVA (required, > 0)
 *   o.ivaPct          {number}  IVA fraction, default 0.16
 *   o.term            {number}  contract term in years, default 16
 * @returns {Object} {
 *   capexConIva, term, annualDeclineMxn,
 *   schedule: [{ year, valorMxn }, ...]  // length term+1, years 0..term
 *   provenance
 * }
 */
function calcValorDeCompra(o) {
  o = o || {};

  var systemCapexMxn = Number(o.systemCapexMxn);
  if (!isFinite(systemCapexMxn) || systemCapexMxn <= 0) {
    throw new Error('calcValorDeCompra: systemCapexMxn must be a positive number, got ' +
                    JSON.stringify(o.systemCapexMxn));
  }

  var ivaPct = (o.ivaPct != null) ? Number(o.ivaPct) : 0.16;
  if (!isFinite(ivaPct) || ivaPct < 0) {
    throw new Error('calcValorDeCompra: ivaPct must be >= 0, got ' + JSON.stringify(o.ivaPct));
  }

  var term = (o.term != null) ? Math.round(Number(o.term)) : 16;
  if (!isFinite(term) || term < 1) {
    throw new Error('calcValorDeCompra: term must be an integer >= 1, got ' + JSON.stringify(o.term));
  }

  var capexConIva   = systemCapexMxn * (1 + ivaPct);
  var annualDecline = capexConIva / term;

  var schedule = [];
  for (var n = 0; n <= term; n++) {
    // Straight-line, clamped to [0, capexConIva]. max(0, ...) guards the
    // year == term boundary against tiny negative float residue.
    var frac = 1 - (n / term);
    if (frac < 0) frac = 0;
    schedule.push({ year: n, valorMxn: capexConIva * frac });
  }

  return {
    capexConIva:      capexConIva,
    term:             term,
    annualDeclineMxn: annualDecline,
    schedule:         schedule,
    provenance:       'STRAIGHT_LINE_RESIDUAL'
  };
}
