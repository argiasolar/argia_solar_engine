// =============================================================================
// ARGIA ENGINE -- 20b_WriteAuthoritativeCfeSavings.js
// -----------------------------------------------------------------------------
// PHASE 0.1a: single-source CFE savings.
//
// THE PROBLEM (the "silent split"):
//   CFE_SIMULATION row 41 (monthly PV savings) was a workbook-resident ad-hoc
//   formula: =SUM(INPUT_CFE!C30,C31,C36) - SUM(C32,C33,C38). It references two
//   unrelated row bands by absolute position, so any change to INPUT_CFE layout
//   silently produced garbage (observed: -11M MXN "savings" on partial data).
//   Three consumers reconstruct base = con-PV + row41:
//     - BESS_SIMULATION!D12          = O39 + O41
//     - CFE_OUTPUT source map         reads row 39 + row 41
//     - CLIENT_FINANCIALS _cfinReadBills: sinPv = conPv + ahorroPv
//   So one bad row-41 poisoned the whole customer-facing offer.
//
// THE FIX (this file):
//   Compute savings from the VALIDATED bill engine, ONE source, every run:
//       savings[m] = calcCfeBill(inp[m], tar[m]).total   (no-PV base)
//                  - CFE_SIMULATION!{C..N}39             (sheet con-PV, unchanged)
//   and overwrite C41:N41 with those 12 values.
//
//   WHY base - sheetConPv (not engineBase - engineConPv):
//     The three consumers compute base = row39 + row41. Defining
//     savings = engineBase - sheetRow39 makes that reconstruction collapse to
//     EXACTLY engineBase, with con-PV left as the sheet's own audited cascade
//     (row 39 = C37+C38-IFERROR(C40,0)). No dependence on the engine's PV model
//     matching the sheet's -- we only trust calcCfeBill's no-PV path, the most
//     audited function in 04a (calcCfeBillWithPv / calcBessImpact both build on
//     it). row 39 is NOT touched.
//
// SAFETY: rows 39/41/D12 verified to be plain per-cell formulas (no array
//   formulas), so setValues over C41:N41 is safe under the array-formula rule.
//
// ARCHITECTURE (Node-self-test friendly):
//   computeAuthoritativeCfeSavings(monthlyInputs, tarMonths, sheetConPv)  PURE
//   writeAuthoritativeCfeSavings(ss)                                      LIVE
// =============================================================================


// -----------------------------------------------------------------------------
// PURE CORE
// -----------------------------------------------------------------------------

/**
 * Compute 12 monthly savings = no-PV base bill - sheet con-PV.
 * PURE: depends only on calcCfeBill (04a). No Spreadsheet access.
 *
 * @param {Array<Object>} monthlyInputs  12 calcCfeBill-shaped inp objects
 * @param {Array<Object>} tarMonths      12 calcCfeBill-shaped tar objects
 * @param {Array<number>} sheetConPv     12 con-PV values (CFE_SIMULATION row 39)
 * @return {Object} { base:[12], conPv:[12], savings:[12], warnings:[] }
 */
function computeAuthoritativeCfeSavings(monthlyInputs, tarMonths, sheetConPv) {
  if (!monthlyInputs || monthlyInputs.length !== 12) {
    throw new Error('computeAuthoritativeCfeSavings: need 12 monthly inputs');
  }
  if (!tarMonths || tarMonths.length !== 12) {
    throw new Error('computeAuthoritativeCfeSavings: need 12 tariff months');
  }
  var base = [], conPv = [], savings = [], warnings = [];
  for (var m = 0; m < 12; m++) {
    var b = calcCfeBill(monthlyInputs[m], tarMonths[m]).total;
    var c = Number(sheetConPv[m]);
    if (!isFinite(c)) { c = 0; warnings.push('month ' + (m + 1) + ': con-PV (row 39) not numeric; treated as 0'); }
    var s = b - c;
    // Sanity: a no-PV bill can never be cheaper than the with-PV bill.
    if (s < -1) {
      warnings.push('month ' + (m + 1) + ': negative savings (base ' + Math.round(b)
                    + ' < con-PV ' + Math.round(c) + ') -- base vs sheet con-PV mismatch');
    }
    base.push(b); conPv.push(c); savings.push(s);
  }
  return { base: base, conPv: conPv, savings: savings, warnings: warnings };
}

/** Map buildFullBillFromInputCfe monthly arrays + context -> calcCfeBill inp. PURE.
 *  dapRate mirrors INPUT_CFE!C6 (sheet DAP: <1 => % of subtotal, else flat MXN);
 *  calcCfeBill applies the identical rule, so base DAP matches sheet row 38. */
function _authMakeCfeInp(monthlyBill, tariff, ctx, m, dapRate) {
  var rollMax = (ctx && ctx.kWMaxAnoMovilKw && isFinite(ctx.kWMaxAnoMovilKw[m]))
              ? ctx.kWMaxAnoMovilKw[m] : 0;
  return {
    tarifa:          tariff,
    kWhBase:         Number(monthlyBill.kwhBase[m])      || 0,
    kWhIntermedia:   Number(monthlyBill.kwhIntermedia[m]) || 0,
    kWhPunta:        Number(monthlyBill.kwhPunta[m])     || 0,
    kWBase:          Number(monthlyBill.kwBase[m])       || 0,
    kWIntermedia:    Number(monthlyBill.kwIntermedia[m]) || 0,
    kWPunta:         Number(monthlyBill.kwPunta[m])      || 0,
    kWMaxAnoMovil:   rollMax,
    kVArh:           0,      // INPUT_CFE bill rows carry no reactive energy -> PF penalty 0 (matches sheet)
    bajaTension2pct: !!(ctx && ctx.bajaTensionToggle),
    dap:             Number(dapRate) || 0
  };
}

/** Map loadCfeTariffRates month -> calcCfeBill tar. PURE. */
function _authMakeCfeTar(rateMonth) {
  rateMonth = rateMonth || {};
  return {
    energiaBase:  Number(rateMonth.energiaBase)            || 0,
    energiaInter: Number(rateMonth.energiaIntermedia)      || 0,
    energiaPunta: Number(rateMonth.energiaPunta)           || 0,
    transmision:  Number(rateMonth.transmision)            || 0,
    cenace:       Number(rateMonth.cenace)                 || 0,
    scnmem:       Number(rateMonth.serviciosConexos)       || 0,
    capacidad:    Number(rateMonth.capacidadMxnPerKw)      || 0,
    distribucion: Number(rateMonth.distribucionMxnPerKw)   || 0,
    suministro:   Number(rateMonth.suministroBasicoMxnFlat) || 0
  };
}


// -----------------------------------------------------------------------------
// LIVE WRITER (Apps Script)
// -----------------------------------------------------------------------------

/**
 * Overwrite CFE_SIMULATION!C41:N41 with engine-computed monthly savings.
 * Called near the end of the engine run, BEFORE writeCfeOutputV2 reads row 41.
 *
 * @param {Spreadsheet} ss
 * @return {Object} { ok, reason?, annualSavings?, warnings? }
 */
function writeAuthoritativeCfeSavings(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();

  var cs = ss.getSheetByName('CFE_SIMULATION');
  if (!cs) return { ok: false, reason: 'CFE_SIMULATION sheet not found' };

  var bill = buildFullBillFromInputCfe(ss);
  if (!bill.monthlyBill || bill.provenance === 'EMPTY' || bill.provenance === 'NO_INPUT_CFE_SHEET') {
    return { ok: false, reason: 'INPUT_CFE bill empty -- row 41 left unchanged' };
  }

  var rates = loadCfeTariffRates(ss, bill.tariff, bill.region);
  if (!rates || !rates.months || rates.months.length !== 12) {
    return { ok: false, reason: 'tariff rates unavailable (' + (rates && rates.provenance) + ')' };
  }

  var ctx = (typeof _readCfeMonthlyContextForHourlySim === 'function')
          ? _readCfeMonthlyContextForHourlySim(ss)
          : { bajaTensionToggle: false, kWMaxAnoMovilKw: null };

  // DAP rate (INPUT_CFE!C6): <1 => % of subtotal, else flat MXN. Mirrors sheet r38.
  var dapRate = 0;
  try {
    var ic = ss.getSheetByName('INPUT_CFE');
    if (ic) { var d = ic.getRange('C6').getValue(); if (isFinite(Number(d))) dapRate = Number(d); }
  } catch (e) {}

  var monthlyInputs = [], tarMonths = [];
  for (var m = 0; m < 12; m++) {
    monthlyInputs.push(_authMakeCfeInp(bill.monthlyBill, bill.tariff, ctx, m, dapRate));
    tarMonths.push(_authMakeCfeTar(rates.months[m]));
  }

  // Sheet con-PV (row 39, cols C..N) -- the value consumers already read.
  var conPvRow = cs.getRange(39, 3, 1, 12).getValues()[0];

  var res = computeAuthoritativeCfeSavings(monthlyInputs, tarMonths, conPvRow);

  // Overwrite C41:N41 with engine savings (per-cell formulas verified, no arrays).
  cs.getRange(41, 3, 1, 12).setValues([res.savings]);
  SpreadsheetApp.flush();

  var annual = 0;
  for (var k = 0; k < 12; k++) annual += res.savings[k];

  if (res.warnings.length && typeof Logger !== 'undefined' && Logger.log) {
    Logger.log('writeAuthoritativeCfeSavings warnings: ' + res.warnings.join(' | '));
  }
  return { ok: true, annualSavings: annual, warnings: res.warnings };
}
