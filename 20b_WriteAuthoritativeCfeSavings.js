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
// SAFETY: rows 39/41 and D12/D13/D14 verified to be plain per-cell formulas/
//   values (no array formulas), so setValues/setFormula are safe under the
//   array-formula rule.
//
// T1 (v4.34.0) -- CANONICAL BASE SURFACED HERE:
//   In addition to row 41, this writer now surfaces the single canonical sin-PV
//   base into BESS_SIMULATION!D12 as a VALUE (= sum of the 12 engine no-PV
//   bills). This replaces the legacy template formula D12 = O39 + O41 + O40,
//   whose +O40 term double-counted the FACTURACION_NETA export credit and forked
//   the customer-facing number from CLIENT_FINANCIALS. D14 = CFE_SIMULATION!O39
//   (audited con-PV), D13 = D14-D12 (derived -ahorro). See surfaceCfeBaseline_.
//
// ARCHITECTURE (Node-self-test friendly):
//   computeAuthoritativeCfeSavings(monthlyInputs, tarMonths, sheetConPv)  PURE
//   surfaceCfeBaseline_(annualBase)                                       PURE
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

/**
 * Emit the BESS_SIMULATION D12/D13/D14 cell-write spec from the canonical
 * engine numbers. PURE: no Spreadsheet access, no sheet reads.
 *
 * THE CANONICAL RULE (T1): the sin-PV base is the DIRECT engine annual bill
 *   (sum of calcCfeBill(PV=0).total over 12 months) -- surfaced as a VALUE in
 *   D12, never the legacy add-back reconstruction.
 *
 *   LEGACY (deleted): D12 = CFE_SIMULATION!O39 + O41 + O40
 *     = con-PV + savings + export-credit. The +O40 term double-counted the
 *     FACTURACION_NETA export credit (O40 = 0 only for no-export modes such as
 *     CULLIGAN's MEDICION_NETA), so D12 silently OVERSTATED the base by the
 *     export credit for any net-billing project. Every D12 consumer
 *     (CFE_OUTPUT banner, SLIDE_DATA, FINANCE) inherited that error, while
 *     CLIENT_FINANCIALS reconstructed O39+O41 (no +O40) and diverged.
 *
 *   FIX: d12 === annualBase, full stop. There is NO code path by which an
 *   export credit can enter this value. D14 (con-PV) stays the sheet's audited
 *   cascade (=CFE_SIMULATION!O39); D13 (-ahorro) is DERIVED (=D14-D12) so the
 *   column reconciles exactly (D12 + D13 = D14, i.e. base - ahorro = con-PV)
 *   in every interconnection mode, no O40 contamination.
 *
 * @param {number} annualBase  sum of the 12 engine no-PV monthly bills
 * @return {Object} { d12:number, d13Formula:string, d14Formula:string }
 */
function surfaceCfeBaseline_(annualBase) {
  var base = Number(annualBase);
  if (!isFinite(base)) {
    throw new Error('surfaceCfeBaseline_: annualBase not finite (' + annualBase + ')');
  }
  return {
    d12:        base,                       // canonical engine base, as a VALUE
    d13Formula: '=D14-D12',                 // -ahorro, derived, always reconciles
    d14Formula: '=CFE_SIMULATION!O39'       // con-PV = audited sheet cascade
  };
}

/** Map buildFullBillFromInputCfe monthly arrays + context -> calcCfeBill inp. PURE.
 *  dapRate mirrors INPUT_CFE!C6 (sheet DAP: <1 => % of subtotal, else flat MXN).
 *  kvarhArr is the 12-month reactive energy (INPUT_CFE row 17) that drives the
 *  CFE power-factor charge/credit; 0 only when the project carries no kVArh. */
function _authMakeCfeInp(monthlyBill, tariff, ctx, m, dapRate, kvarhArr) {
  var rollMax = (ctx && ctx.kWMaxAnoMovilKw && isFinite(ctx.kWMaxAnoMovilKw[m]))
              ? ctx.kWMaxAnoMovilKw[m] : 0;
  var kvarh = (kvarhArr && isFinite(kvarhArr[m])) ? Number(kvarhArr[m]) : 0;
  return {
    tarifa:          tariff,
    kWhBase:         Number(monthlyBill.kwhBase[m])      || 0,
    kWhIntermedia:   Number(monthlyBill.kwhIntermedia[m]) || 0,
    kWhPunta:        Number(monthlyBill.kwhPunta[m])     || 0,
    kWBase:          Number(monthlyBill.kwBase[m])       || 0,
    kWIntermedia:    Number(monthlyBill.kwIntermedia[m]) || 0,
    kWPunta:         Number(monthlyBill.kwPunta[m])      || 0,
    kWMaxAnoMovil:   rollMax,
    kVArh:           kvarh,
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
  // Unresolved rates (region/tariff miss, or an IMPORTRANGE mirror not yet
  // settled) come back as 12 ZERO-rate months -> base would collapse to ~0 and
  // savings to -con-PV. NEVER write from unresolved rates.
  if (rates.provenance === 'MISSING' || rates.provenance === 'INCOMPLETE') {
    return { ok: false, reason: 'tariff rates ' + rates.provenance + ' for '
             + bill.tariff + ' / ' + bill.region + ' -- row 41 left unchanged' };
  }

  var ctx = (typeof _readCfeMonthlyContextForHourlySim === 'function')
          ? _readCfeMonthlyContextForHourlySim(ss)
          : { bajaTensionToggle: false, kWMaxAnoMovilKw: null };

  // DAP rate (INPUT_CFE!C6): <1 => % of subtotal, else flat MXN. Mirrors sheet r38.
  // kVArh (INPUT_CFE row 17, cols C..N): drives the power-factor charge/credit.
  var dapRate = 0, kvarhArr = null;
  try {
    var ic = ss.getSheetByName('INPUT_CFE');
    if (ic) {
      var d = ic.getRange('C6').getValue(); if (isFinite(Number(d))) dapRate = Number(d);
      kvarhArr = ic.getRange(17, 3, 1, 12).getValues()[0].map(function (x) { return Number(x) || 0; });
    }
  } catch (e) {}

  var monthlyInputs = [], tarMonths = [];
  for (var m = 0; m < 12; m++) {
    monthlyInputs.push(_authMakeCfeInp(bill.monthlyBill, bill.tariff, ctx, m, dapRate, kvarhArr));
    tarMonths.push(_authMakeCfeTar(rates.months[m]));
  }

  // Sheet con-PV (row 39, cols C..N) -- the value consumers already read.
  var conPvRow = cs.getRange(39, 3, 1, 12).getValues()[0];

  var res = computeAuthoritativeCfeSavings(monthlyInputs, tarMonths, conPvRow);

  // HARD SANITY GATE: a no-PV base can never be <= the with-PV con-PV bill.
  // If it is (bad rates, broken inputs, anything), the result is nonsense --
  // leave row 41 untouched rather than poison every downstream consumer.
  var annualBase = 0, annualConPv = 0;
  for (var s = 0; s < 12; s++) { annualBase += res.base[s]; annualConPv += res.conPv[s]; }
  if (!(annualBase > annualConPv)) {
    return { ok: false,
             reason: 'engine base (' + Math.round(annualBase) + ') <= con-PV ('
                     + Math.round(annualConPv) + ') -- insane, row 41 left unchanged',
             warnings: res.warnings };
  }

  // Overwrite C41:N41 with engine savings (per-cell formulas verified, no arrays).
  cs.getRange(41, 3, 1, 12).setValues([res.savings]);

  var annual = annualBase - annualConPv;

  // SURFACE THE CANONICAL BASE (T1): BESS_SIMULATION!D12 holds the DIRECT engine
  // annual base as a VALUE -- the single source every consumer reads (CFE_OUTPUT
  // banner, SLIDE_DATA, FINANCE via 02j; CLIENT_FINANCIALS via 31a). This
  // replaces the legacy template formula D12 = O39 + O41 + O40, whose +O40 term
  // double-counted the FACTURACION_NETA export credit. D14 stays the audited
  // con-PV cascade; D13 is derived so the column reconciles in every mode.
  var bs = ss.getSheetByName('BESS_SIMULATION');
  if (bs) {
    var spec = surfaceCfeBaseline_(annualBase);
    bs.getRange('D14').setFormula(spec.d14Formula);  // con-PV = CFE_SIMULATION!O39
    bs.getRange('D12').setValue(spec.d12);            // canonical engine base (value)
    bs.getRange('D13').setFormula(spec.d13Formula);   // -ahorro = D14-D12 (derived)
    bs.getRange('D12').setNote(
      'ARGIA canonical CFE base (sin PV): sum of calcCfeBillAnnual(PV=0) over 12 '
      + 'months, per-month GDMTH tariffs. Written by writeAuthoritativeCfeSavings '
      + '(20b). NOT the legacy O39+O41+O40 reconstruction (which double-counted '
      + 'the FACTURACION_NETA export credit O40).');
  } else {
    res.warnings.push('BESS_SIMULATION sheet not found -- D12 canonical base NOT surfaced');
  }

  SpreadsheetApp.flush();

  if (res.warnings.length && typeof Logger !== 'undefined' && Logger.log) {
    Logger.log('writeAuthoritativeCfeSavings warnings: ' + res.warnings.join(' | '));
  }
  return { ok: true, annualSavings: annual, annualBase: annualBase, warnings: res.warnings };
}
