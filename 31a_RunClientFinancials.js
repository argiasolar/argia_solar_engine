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
//     banners B10 ('Sin PV') / L10 ('Recibo final con BESS') as fallbacks
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
  CFE_BANNER_SIN_PV: 'B10',
  CFE_BANNER_FINAL:  'L10',
  BOM_SHEET:        'BOM_v2',
  INSTALL_SHEET:    'INSTALLATION_v2'
};

var CLIENT_FIN_DEFAULTS = {
  // Factor de Emisión del Sistema Eléctrico Nacional 2024 = 0.444 tCO2e/MWh
  // (CRE/SEMARNAT aviso oficial, gob.mx "aviso_fesen_2024.pdf"; prior years:
  // 2023 = 0.438, 2022 = 0.435). The aviso for 2025 publishes ~Feb 2026 --
  // update this constant (and the REG_CLIENT_FINANCIALS_CULLIGAN_V2 CO2
  // assertion) when it lands. Longer-term home: a MASTER_DB row.
  co2FactorTonPerMwh: 0.444,
  panelDegradationPct: 0.005,

  // [T2.1 / 4.36.0] Basis for the RETURN metrics (payback / NPV / IRR / ROI):
  //   'COST'        -> capex.totalMxn (engine cost). DEFAULT -- preserves the
  //                    locked CULLIGAN goldens.
  //   'OFFER_PRICE' -> the sell price the customer actually pays
  //                    (= cost / (1 - margin), surfaced on PROJECT_CARD_v2).
  // At margin = 0 the two coincide. At margin > 0, 'COST' UNDERSTATES the
  // customer's real payback (they pay sell, not cost); 'OFFER_PRICE' is the
  // customer-correct basis for a direct purchase. Overridable per call via
  // opts.returnsBasis. CAPEX *display* (capex_cost_mxn) and Valor de Compra stay
  // on cost regardless -- this knob only moves the return-metric investment.
  returnsBasis: 'COST'
};


// ---------------------------------------------------------------------------
// _cfinResolveReturnsCapex(basis, costMxn, offerMxn) -> { capexMxn, basis, note }
// PURE. Picks the investment figure the return metrics are computed on.
// Falls back to cost (with a note) when OFFER_PRICE is requested but the sell
// price is unavailable -- never silently returns 0/NaN.
// ---------------------------------------------------------------------------
function _cfinResolveReturnsCapex(basis, costMxn, offerMxn) {
  var cost  = Number(costMxn);
  var offer = Number(offerMxn);
  if (basis === 'OFFER_PRICE') {
    if (isFinite(offer) && offer > 0) {
      return { capexMxn: offer, basis: 'OFFER_PRICE', note: '' };
    }
    return { capexMxn: (isFinite(cost) ? cost : 0), basis: 'COST',
             note: 'OFFER_PRICE requested but sell price unavailable -- fell back to COST' };
  }
  return { capexMxn: (isFinite(cost) ? cost : 0), basis: 'COST', note: '' };
}

// ---------------------------------------------------------------------------
// _cfinReadOfferPriceMxn(ss) -> sell-price TOTAL (MXN) or null.
// PROJECT_CARD_v2 TOTAL row, MXN_SALES col (cost / (1 - margin)). Uses the
// engine PC_ROW/PC_COL constants when present, else fixed I40.
// ---------------------------------------------------------------------------
function _cfinReadOfferPriceMxn(ss) {
  var pc = ss.getSheetByName('PROJECT_CARD_v2');
  if (!pc) return null;
  var row = (typeof PC_ROW !== 'undefined' && PC_ROW.COST_TOTAL) ? PC_ROW.COST_TOTAL : 40;
  var col = (typeof PC_COL !== 'undefined' && PC_COL.MXN_SALES)  ? PC_COL.MXN_SALES  : 9;
  var v = Number(pc.getRange(row, col).getValue());
  return (isFinite(v) && v > 0) ? v : null;
}


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
// Sin-sistema bill = the ONE canonical engine base in BESS_SIMULATION!D12
// (written as a value by writeAuthoritativeCfeSavings / 20b -- the same cell
// the CFE_OUTPUT banner, SLIDE_DATA and FINANCE all read). T1 repoint: read it
// directly instead of reconstructing con-PV (row 19) + ahorro (row 20), so
// CLIENT_FINANCIALS consumes the identical figure as every other consumer and
// can no longer fork from them. Fallbacks preserve standalone robustness:
// D12 -> row19+row20 -> C10 banner parse. Bill WITH system = recibo final con
// BESS (row 31), with the L10 banner as fallback.
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

  // PRIMARY: canonical engine base, BESS_SIMULATION!D12 (value written by 20b).
  var sinPv = 0;
  var bsim = ss.getSheetByName('BESS_SIMULATION');
  if (bsim) {
    var d12 = bsim.getRange('D12').getValue();
    if (typeof d12 === 'number' && d12 > 0) sinPv = d12;
  }
  // FALLBACK 1: con-PV (row 19) + ahorro-vs-sin-PV (row 20), the rendered series.
  if (!(sinPv > 0)) {
    var conPv    = _cfinSumCfeRow(cfe, C.CFE_ROW_CON_PV);
    var ahorroPv = _cfinSumCfeRow(cfe, C.CFE_ROW_AHORRO_PV);
    sinPv = conPv + ahorroPv;
    if (sinPv > 0) {
      warnings.push('ClientFin: sin-PV from CFE_OUTPUT row19+row20 fallback '
                  + '(BESS_SIMULATION!D12 canonical base unavailable).');
    }
  }
  // FALLBACK 2: the C10 banner parse.
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

  // [G6] Batch 2: O&M / replacement-reserve zero-guards. The live workbook
  // shipped a BESS financial story with O&M = $0 and reserve = $0 -- inputs
  // wired (INPUT_BAAS rows 16/17) but blank, silently overstating net
  // savings and LCOE. Pure rule in argiaFinancialGuardNotes (31_Calc...).
  var bessMatMxn = 0;
  try {
    if (typeof _baasReadCapexMxn === 'function') {
      bessMatMxn = Number(_baasReadCapexMxn(ss).materialsMxn) || 0;
    }
  } catch (gErr) { /* BESS detection is best-effort */ }
  // [T9] BOM completeness -> excluded-items note on the financials headline.
  var bomComp = null;
  try { bomComp = runBomCompleteness(ss); } catch (bcErr) { /* best-effort */ }
  var guardNotes = argiaFinancialGuardNotes({
    omCostMxnPerYear: inp.omCostMxnPerYear,
    replacementReserveMxnPerYear: inp.replacementReserveMxnPerYear,
    bessMaterialsMxn: bessMatMxn,
    bomIncomplete:          !!(bomComp && !bomComp.complete),
    bomMissingFamilies:     bomComp ? bomComp.missingFamilies : null,
    bomSinCotizarFamilies:  bomComp ? bomComp.sinCotizarFamilies : null
  });
  guardNotes.forEach(function (g) { warnings.push('ClientFin: ' + g.msg); });

  var demandSavings = _cfinReadDemandSavings(ss);
  var energyKwh     = _cfinReadEnergyKwh(ss);
  if (!(energyKwh > 0)) {
    warnings.push('ClientFin: PV kWh row sums to 0 -- LCOE and CO2 will be 0.');
  }

  // [T2.1 / 4.36.0] Return-metric basis. Default 'COST' (preserves goldens);
  // 'OFFER_PRICE' computes payback/NPV/IRR on the sell price the customer pays.
  var returnsBasis = opts.returnsBasis || CLIENT_FIN_DEFAULTS.returnsBasis;
  var offerPriceMxn = _cfinReadOfferPriceMxn(ss);
  var rc = _cfinResolveReturnsCapex(returnsBasis, capex.totalMxn, offerPriceMxn);
  if (rc.note) warnings.push('ClientFin: ' + rc.note);

  var fin = calcClientFinancials({
    analysisTermYears:       inp.leaseTermYears,
    billEscalationPct:       inp.billEscalationPct,
    savingsEscalationPct:    inp.savingsEscalationPct,
    discountRate:            inp.discountRate,
    capexMxn:                rc.capexMxn,   // return-metric investment (basis-driven)
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

  // [4.21.0] Valor de Compra (buyout / residual value) schedule. Uses the SAME
  // capex.totalMxn the rest of the sheet uses (no silent split). Straight-line
  // over the BaaS contract term (16y, the calc default) -- distinct from the
  // financials analysis horizon (15y). Guarded: only when capex is positive.
  var valorDeCompra = null;
  if (capex.totalMxn > 0) {
    try {
      valorDeCompra = calcValorDeCompra({ systemCapexMxn: capex.totalMxn });
    } catch (vdcErr) {
      warnings.push('ClientFin: Valor de Compra skipped: ' + vdcErr.message);
    }
  }

  var wrote = writeClientFinancialsV2(ss, fin, {
    co2FactorNote: 'Factor de emisión ' + CLIENT_FIN_DEFAULTS.co2FactorTonPerMwh
                 + ' tCO2e/MWh (verificar factor oficial CRE vigente).',
    capexBreakdown: capex,
    guardNotes: guardNotes.map(function (g) { return g.msg; }),  // [G6] on-sheet
    valorDeCompra: valorDeCompra   // [4.21.0] buyout schedule, may be null
  });

  // [T2 / 4.35.0] API_OUTPUT -- single offer interface. Written here (the offer
  // generation flow) because it needs the canonical financials computed above.
  // fin/capex are passed through so API_OUTPUT never re-runs the engine. Then
  // repoint the SAFE SLIDE_DATA figure keys at API_OUTPUT (the 5 basis-conflicted
  // figures are deferred -- see WriteApiOutputV2 / CHANGELOG).
  try {
    if (typeof writeApiOutputV2 === 'function') {
      var apiRet = writeApiOutputV2(ss, { fin: fin, capex: capex, returnsBasis: rc.basis });
      warnings = warnings.concat(apiRet.warnings || []);
      if (typeof repairSlideDataFromApiOutput === 'function') {
        repairSlideDataFromApiOutput(ss);
      }
    }
  } catch (apiErr) {
    warnings.push('ClientFin: API_OUTPUT write skipped: ' + apiErr.message);
  }

  return {
    ok: (bills.ok && capex.ok),
    warnings: warnings,
    capex: capex,
    bills: bills,
    fin: fin,
    wrote: wrote
  };
}
