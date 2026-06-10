// =============================================================================
// ARGIA -- 31a_RunClientFinancials.js
// -----------------------------------------------------------------------------
// TRACK B P0 -- Client financial story (wiring + orchestrator)
//
// Standalone, menu-driven (Option A, same as the BaaS projection): reads the
// engine outputs a prior run produced, feeds calcClientFinancials (the pure
// core in 31_), and renders CLIENT_FINANCIALS_v2. Touches nothing in the
// engine pipeline -- the CULLIGAN golden master is unaffected.
//
// DATA SOURCES (anchor cells, guarded with warnings like 30b):
//   CFE_OUTPUT_v2  monthly cols C..N:
//     row 15  kWh solares generados        -> annual energy (CO2 / LCOE)
//     row 19  TOTAL mensual con PV         -> con-PV bill
//     row 20  Ahorro vs Sin PV             -> sin-PV bill = row19 + row20
//     row 27  Ahorro Capacidad (BESS)      -> demand-charge savings
//     row 28  Ahorro Distribucion (BESS)   -> demand-charge savings
//     row 31  Recibo final con BESS        -> bill WITH the full system
//     banners C10 ('Sin PV') / L10 ('Recibo final con BESS') as fallbacks
//   BOM_v2          G<GRAND_TOTAL>          -> materials MXN (PV + BESS, total)
//   INSTALLATION_v2 G<GRAND_TOTAL>          -> installation MXN (total)
//   INPUT_BAAS      term / escalations / discount / O&M / reserve
//                   (single source for the economic frame, shared with BaaS
//                   so the 3-way comparison is apples-to-apples)
//
// CO2 FACTOR: passed from CLIENT_FIN_DEFAULTS below. 0.435 tCO2e/MWh is a
// PLACEHOLDER -- verify the current official CRE/SEMARNAT factor and update
// (value-audit item; the rendered sheet carries this caveat).
// =============================================================================

var CLIENT_FIN_CELLS = {
  CFE_SHEET:        'CFE_OUTPUT_v2',
  CFE_MONTH_COLS:   [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],   // C..N
  CFE_ROW_PV_KWH:   15,
  CFE_ROW_CON_PV:   19,
  CFE_ROW_AHORRO_PV: 20,
  CFE_ROW_AH_CAP:   27,
  CFE_ROW_AH_DIST:  28,
  CFE_ROW_FINAL:    31,
  CFE_BANNER_SIN_PV: 'C10',
  CFE_BANNER_FINAL:  'L10',
  BOM_SHEET:        'BOM_v2',
  INSTALL_SHEET:    'INSTALLATION_v2'
};

var CLIENT_FIN_DEFAULTS = {
  co2FactorTonPerMwh: 0.435,   // PLACEHOLDER -- verify official CRE factor
  panelDegradationPct: 0.005
};


// ---------------------------------------------------------------------------
// _cfinSumCfeRow(cfe, row) -- sum the monthly C..N numbers of one row.
// ---------------------------------------------------------------------------
function _cfinSumCfeRow(cfe, row) {
  var cols = CLIENT_FIN_CELLS.CFE_MONTH_COLS;
  var s = 0;
  for (var i = 0; i < cols.length; i++) {
    var v = cfe.getRange(row, cols[i]).getValue();
    if (typeof v === 'number') s += v;
  }
  return s;
}


// ---------------------------------------------------------------------------
// _cfinReadBills(ss) -> { billWithoutMxn, billWithMxn, ok, warnings }
// Sin-sistema bill = con-PV (row 19) + ahorro-vs-sin-PV (row 20), the same
// monthly series behind the C10 banner. Bill WITH system = recibo final con
// BESS (row 31). Banner parses (reusing 30b's _baasParseBanner) as fallbacks.
// ---------------------------------------------------------------------------
function _cfinReadBills(ss) {
  var C = CLIENT_FIN_CELLS;
  var warnings = [];
  var cfe = ss.getSheetByName(C.CFE_SHEET);
  if (!cfe) {
    return { billWithoutMxn: 0, billWithMxn: 0, ok: false,
             warnings: ['ClientFin: ' + C.CFE_SHEET + ' not found; bills = 0. '
                      + 'Run the engine + CFE output first.'] };
  }

  var conPv    = _cfinSumCfeRow(cfe, C.CFE_ROW_CON_PV);
  var ahorroPv = _cfinSumCfeRow(cfe, C.CFE_ROW_AHORRO_PV);
  var sinPv    = conPv + ahorroPv;
  if (!(sinPv > 0)) {
    sinPv = _baasParseBanner(cfe.getRange(C.CFE_BANNER_SIN_PV).getValue());
    warnings.push('ClientFin: sin-PV annual fell back to ' + C.CFE_BANNER_SIN_PV
                + ' banner parse.');
  }

  var finalBill = _cfinSumCfeRow(cfe, C.CFE_ROW_FINAL);
  if (!(finalBill > 0)) {
    finalBill = _baasParseBanner(cfe.getRange(C.CFE_BANNER_FINAL).getValue());
    warnings.push('ClientFin: final (PV+BESS) annual fell back to '
                + C.CFE_BANNER_FINAL + ' banner parse.');
  }

  return {
    billWithoutMxn: sinPv,
    billWithMxn:    finalBill,
    ok: (sinPv > 0 && finalBill > 0 && sinPv > finalBill),
    warnings: warnings
  };
}


// ---------------------------------------------------------------------------
// _cfinReadCapexTotalMxn(ss) -> { materialsMxn, installMxn, totalMxn, ok, warnings }
// TOTAL system CAPEX (PV + BESS): BOM grand total + INSTALLATION grand total.
// (The BaaS wiring reads only the BESS slices; the cash purchase buys it all.)
// Anchor rows come from the shared constants (BOM_ROW / _INST_V2_SUM_ROWS) so
// a template change moves both the writer and this reader together.
// ---------------------------------------------------------------------------
function _cfinReadCapexTotalMxn(ss) {
  var C = CLIENT_FIN_CELLS;
  var warnings = [];
  var materialsMxn = 0, installMxn = 0;

  var bom = ss.getSheetByName(C.BOM_SHEET);
  if (bom) {
    materialsMxn = parseFloat(
      bom.getRange(BOM_ROW.GRAND_TOTAL, BOM_COL.TOTAL_MXN).getValue()) || 0;
    if (!(materialsMxn > 0)) {
      warnings.push('ClientFin: BOM_v2 grand total (G' + BOM_ROW.GRAND_TOTAL
                  + ') is 0/blank.');
    }
  } else {
    warnings.push('ClientFin: BOM_v2 not found; materials = 0.');
  }

  var inst = ss.getSheetByName(C.INSTALL_SHEET);
  if (inst) {
    installMxn = parseFloat(
      inst.getRange(_INST_V2_SUM_ROWS.GRAND_TOTAL, _INST_V2_SUM_COL_VAL)
        .getValue()) || 0;
    if (!(installMxn > 0)) {
      warnings.push('ClientFin: INSTALLATION_v2 grand total (G'
                  + _INST_V2_SUM_ROWS.GRAND_TOTAL + ') is 0/blank.');
    }
  } else {
    warnings.push('ClientFin: INSTALLATION_v2 not found; install = 0.');
  }

  return {
    materialsMxn: materialsMxn,
    installMxn:   installMxn,
    totalMxn:     materialsMxn + installMxn,
    ok: (materialsMxn > 0 && installMxn > 0),
    warnings: warnings
  };
}


// ---------------------------------------------------------------------------
// _cfinReadDemandSavings(ss) -> annual MXN of the demand-charge slice
// (Ahorro Capacidad + Ahorro Distribución, the GDMTH headline hook).
// ---------------------------------------------------------------------------
function _cfinReadDemandSavings(ss) {
  var C = CLIENT_FIN_CELLS;
  var cfe = ss.getSheetByName(C.CFE_SHEET);
  if (!cfe) return 0;
  return _cfinSumCfeRow(cfe, C.CFE_ROW_AH_CAP)
       + _cfinSumCfeRow(cfe, C.CFE_ROW_AH_DIST);
}


// ---------------------------------------------------------------------------
// _cfinReadEnergyKwh(ss) -> annual PV kWh generated (row 15).
// The CO2/LCOE basis: PV generation displacing grid energy. The BESS shifts
// timing but adds no energy, so it does not add to this figure.
// ---------------------------------------------------------------------------
function _cfinReadEnergyKwh(ss) {
  var C = CLIENT_FIN_CELLS;
  var cfe = ss.getSheetByName(C.CFE_SHEET);
  if (!cfe) return 0;
  return _cfinSumCfeRow(cfe, C.CFE_ROW_PV_KWH);
}


// ---------------------------------------------------------------------------
// runClientFinancials(ss, opts) -> { ok, warnings, capex, bills, fin }
// opts.baasNetSavingsByYear (optional) enables the 3-way comparison; the menu
// handler supplies it from a fresh runBaasProjection when available.
// ---------------------------------------------------------------------------
function runClientFinancials(ss, opts) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  opts = opts || {};
  var warnings = [];

  // Economic frame shared with BaaS (single source = INPUT_BAAS) so the
  // 3-way comparison uses identical escalations/term.
  if (typeof setupInputBaasSheet === 'function') setupInputBaasSheet();
  var inp = (typeof readInputBaas === 'function') ? readInputBaas(ss) : {};

  var bills = _cfinReadBills(ss);
  warnings = warnings.concat(bills.warnings);

  var capex = _cfinReadCapexTotalMxn(ss);
  warnings = warnings.concat(capex.warnings);

  var demandSavings = _cfinReadDemandSavings(ss);
  var energyKwh     = _cfinReadEnergyKwh(ss);
  if (!(energyKwh > 0)) {
    warnings.push('ClientFin: PV kWh row sums to 0 -- LCOE and CO2 will be 0.');
  }

  var fin = calcClientFinancials({
    analysisTermYears:       inp.leaseTermYears,
    billEscalationPct:       inp.billEscalationPct,
    savingsEscalationPct:    inp.savingsEscalationPct,
    discountRate:            inp.discountRate,
    capexMxn:                capex.totalMxn,
    omCostMxnPerYear:        inp.omCostMxnPerYear,
    replacementReserveMxnPerYear: inp.replacementReserveMxnPerYear,
    year1BillWithoutMxn:     bills.billWithoutMxn,
    year1BillWithMxn:        bills.billWithMxn,
    demandChargeSavingMxnYear1: demandSavings,
    annualEnergyKwhYear1:    energyKwh,
    panelDegradationPct:     CLIENT_FIN_DEFAULTS.panelDegradationPct,
    co2FactorTonPerMwh:      CLIENT_FIN_DEFAULTS.co2FactorTonPerMwh,
    baasNetSavingsByYear:    opts.baasNetSavingsByYear || null
  });

  var wrote = writeClientFinancialsV2(ss, fin, {
    co2FactorNote: 'Factor de emisión ' + CLIENT_FIN_DEFAULTS.co2FactorTonPerMwh
                 + ' tCO2e/MWh (verificar factor oficial CRE vigente).',
    capexBreakdown: capex
  });

  return {
    ok: (bills.ok && capex.ok),
    warnings: warnings,
    capex: capex,
    bills: bills,
    fin: fin,
    wrote: wrote
  };
}
