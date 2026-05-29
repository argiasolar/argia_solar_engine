// =============================================================================
// ARGIA -- 30a_ReadInputsBaas.js
// -----------------------------------------------------------------------------
// CHUNK 6 -- BaaS Economics Engine
//
// INPUT_BAAS reader + sheet setup. READER ONLY -- reads the INPUT_BAAS sheet
// and returns a typed baasInputs{} object. Does not calculate, does not write
// results (only setupInputBaasSheet creates the sheet skeleton + defaults).
//
// Per the design sign-off:
//   - ARGIA target IRR and discount rate (WACC) live in INPUT_BAAS because
//     they differ per deal (aggressive tender vs one-time deal).
//   - Tax benefit is solar-CAPEX-driven and conditional: only customers
//     that can actually utilize it (have taxable profit). A toggle +
//     disclaimer govern it.
//   - Everything else has a sensible default the designer can override.
// =============================================================================

// ---------------------------------------------------------------------------
// Cell map for INPUT_BAAS (label in col B, value in col C).
// ---------------------------------------------------------------------------
var INPUT_BAAS_ROWS = {
  HEADER:               2,
  LEASE_TERM:           4,   // years
  LEASE_TYPE:           5,   // FINANCIERO | PURO
  PAYMENT_ESC_FIXED:    6,   // financiero fixed escalation (e.g. 0.04)
  INPC_ESC:             7,   // puro INPC escalation (e.g. 0.05)
  BILL_ESC:             8,   // CFE bill escalation (e.g. 0.07)
  SAVINGS_ESC:          9,   // bill-savings escalation (e.g. 0.04)
  TARGET_IRR:           10,  // ARGIA target IRR (per deal)
  DISCOUNT_RATE:        11,  // ARGIA WACC (per deal)
  OM_COST_YEAR:         12,  // O&M MXN/year (often bundled = 0)
  REPL_RESERVE_YEAR:    13,  // battery replacement reserve MXN/year
  TAX_BENEFIT_RATE:     14,  // ISR rate for solar CAPEX deduction (e.g. 0.30)
  TAX_AMORT_YEARS:      15,  // years to amortize the benefit (e.g. 10)
  CUSTOMER_CAN_USE_TAX: 16,  // YES | NO -- customer has taxable profit to use it
  FX_RATE:              17   // MXN/USD assumption (e.g. 18.20)
};

// ---------------------------------------------------------------------------
// readInputBaas(ss) -> baasInputs{}
// Always returns an object (defaults when the sheet/cells are blank).
// ---------------------------------------------------------------------------
function readInputBaas(ss) {
  ss = ss || SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('INPUT_BAAS');
  var R = INPUT_BAAS_ROWS;

  function readNum(row, dflt) {
    if (!sh) return dflt;
    var v = Number(sh.getRange(row, 3).getValue());
    return isFinite(v) && v !== 0 ? v : (sh.getRange(row, 3).getValue() === 0 ? 0 : dflt);
  }
  function readStr(row, dflt) {
    if (!sh) return dflt;
    var v = String(sh.getRange(row, 3).getValue() || '').trim();
    return v || dflt;
  }
  function readYesNo(row, dflt) {
    if (!sh) return dflt;
    var v = String(sh.getRange(row, 3).getValue() || '').trim().toUpperCase();
    if (v === 'YES' || v === 'SI' || v === 'SÍ') return true;
    if (v === 'NO') return false;
    return dflt;
  }

  return {
    leaseTermYears:         Math.round(readNum(R.LEASE_TERM, 15)),
    leaseType:              (readStr(R.LEASE_TYPE, 'FINANCIERO').toUpperCase() === 'PURO')
                              ? 'PURO' : 'FINANCIERO',
    paymentEscalationPct:   readNum(R.PAYMENT_ESC_FIXED, 0.04),
    inpcEscalationPct:      readNum(R.INPC_ESC, 0.05),
    billEscalationPct:      readNum(R.BILL_ESC, 0.07),
    savingsEscalationPct:   readNum(R.SAVINGS_ESC, 0.04),
    targetIrr:              readNum(R.TARGET_IRR, 0.15),
    discountRate:           readNum(R.DISCOUNT_RATE, 0.12),
    omCostMxnPerYear:       readNum(R.OM_COST_YEAR, 0),
    replacementReserveMxnPerYear: readNum(R.REPL_RESERVE_YEAR, 0),
    taxBenefitRate:         readNum(R.TAX_BENEFIT_RATE, 0.30),
    taxAmortYears:          Math.round(readNum(R.TAX_AMORT_YEARS, 10)),
    customerCanUseTaxBenefit: readYesNo(R.CUSTOMER_CAN_USE_TAX, false),
    fxRate:                 readNum(R.FX_RATE, 18.20),
    provenance:             sh ? 'INPUT_BAAS' : 'DEFAULTS_NO_SHEET'
  };
}


// ---------------------------------------------------------------------------
// setupInputBaasSheet(ss) -- create the INPUT_BAAS sheet with labels +
// default values if it doesn't exist. Idempotent: only writes labels +
// defaults on first creation; never overwrites a designer's values.
// ---------------------------------------------------------------------------
function setupInputBaasSheet(ss) {
  ss = ss || SpreadsheetApp.getActive();
  var existing = ss.getSheetByName('INPUT_BAAS');
  if (existing) return existing;   // never clobber designer inputs

  var sh = ss.insertSheet('INPUT_BAAS');
  var R = INPUT_BAAS_ROWS;

  sh.getRange(R.HEADER, 2).setValue('INPUT_BAAS — Economía de Arrendamiento (BaaS)')
    .setFontWeight('bold').setFontSize(12);

  var rows = [
    [R.LEASE_TERM,           'Plazo del arrendamiento (años)',            15],
    [R.LEASE_TYPE,           'Tipo (FINANCIERO / PURO)',                  'FINANCIERO'],
    [R.PAYMENT_ESC_FIXED,    'Escalación pago fijo (financiero)',         0.04],
    [R.INPC_ESC,             'Escalación INPC (puro)',                    0.05],
    [R.BILL_ESC,             'Escalación recibo CFE',                     0.07],
    [R.SAVINGS_ESC,          'Escalación del ahorro (BESS+PV)',           0.04],
    [R.TARGET_IRR,           'TIR objetivo ARGIA (por trato)',            0.15],
    [R.DISCOUNT_RATE,        'Tasa de descuento / WACC ARGIA (por trato)',0.12],
    [R.OM_COST_YEAR,         'Gastos de operación (MXN/año)',             0],
    [R.REPL_RESERVE_YEAR,    'Reserva de reemplazo batería (MXN/año)',    0],
    [R.TAX_BENEFIT_RATE,     'Tasa beneficio fiscal solar (ISR)',         0.30],
    [R.TAX_AMORT_YEARS,      'Años amortización beneficio fiscal',        10],
    [R.CUSTOMER_CAN_USE_TAX, '¿Cliente puede usar beneficio fiscal? (YES/NO)', 'NO'],
    [R.FX_RATE,              'Tipo de cambio (MXN/USD)',                  18.20]
  ];
  for (var i = 0; i < rows.length; i++) {
    sh.getRange(rows[i][0], 2).setValue(rows[i][1]);
    sh.getRange(rows[i][0], 3).setValue(rows[i][2]);
  }

  // Disclaimer note about the tax benefit (its own row below the inputs).
  sh.getRange(R.FX_RATE + 2, 2, 1, 6).merge()
    .setValue('NOTA: El beneficio fiscal solo aplica al arrendamiento FINANCIERO '
            + 'y únicamente si el cliente tiene utilidad fiscal suficiente para '
            + 'aprovechar la deducción del CAPEX solar. Confirme con el asesor '
            + 'fiscal del cliente. Si no es aprovechable, ponga "NO" arriba.')
    .setFontStyle('italic').setFontSize(9).setWrap(true)
    .setBackground('#FFF3E0').setFontColor('#995700');

  sh.setColumnWidth(2, 320);
  sh.setColumnWidth(3, 140);
  return sh;
}
