// =============================================================================
// ARGIA -- writers_v2/WriteClientFinancialsV2.js
// -----------------------------------------------------------------------------
// TRACK B P0 -- Client financial story (writer)
//
// Renders CLIENT_FINANCIALS_v2: the cash-purchase financial narrative in the
// proposal's visual language --
//   1. headline KPI block ("¿Cuánto vas a ahorrar?": Yr-1 savings, % of bill,
//      demand-charge slice, CAPEX, payback, ROI, NPV, IRR, LCOE)
//   2. CO2 / ESG block (tonnes, cars, trees + factor caveat)
//   3. cash projection table (per year: savings, O&M, reserve, net, position)
//   4. scenario comparison (do-nothing vs cash [vs BaaS when supplied])
//
// STRUCTURAL INVARIANTS (same discipline as the BaaS writer):
//   - PROPOSAL-tier disclaimer is ALWAYS rendered (row 4): the savings are
//     engine estimates, not guaranteed, interval data required for bankable.
//   - the CO2 block is written by the same code path that writes the factor
//     caveat, so an emissions figure can never appear without its source note.
//
// Shares the design-token system and the _baasFmt/_baasPct formatters.
// =============================================================================

function writeClientFinancialsV2(ss, fin, opts) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  opts = opts || {};
  if (!fin || !fin.cash || !fin.headline) {
    throw new Error('writeClientFinancialsV2: fin result missing (run calcClientFinancials first)');
  }

  var sh = ss.getSheetByName('CLIENT_FINANCIALS_v2');
  if (!sh) sh = ss.insertSheet('CLIENT_FINANCIALS_v2');
  else sh.clear();

  if (typeof resetDesignTokenCache_ === 'function') resetDesignTokenCache_();
  if (typeof loadDesignTokens === 'function') loadDesignTokens(ss);
  try { sh.setHiddenGridlines(true); } catch (e) { /* mock */ }

  sh.setColumnWidth(1, 50);
  sh.setColumnWidth(2, 260);
  for (var cw = 3; cw <= 11; cw++) sh.setColumnWidth(cw, 110);

  var fmt = _baasFmt;
  var pct = _baasPct;

  try {
    if (typeof _insertArgiaLogo === 'function') _insertArgiaLogo(sh, 2, 1);
  } catch (logoErr) { /* title alone is fine */ }

  // -- Banner: title + subtitle --------------------------------------------
  sh.getRange(2, 3, 1, 8).breakApart().merge()
    .setValue('ANÁLISIS FINANCIERO — COMPRA DIRECTA')
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_TITLE'))
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontColor(token('TEXT_PRIMARY'))
    .setVerticalAlignment('bottom').setHorizontalAlignment('left');
  sh.setRowHeight(2, tokenNum('ROW_H_TITLE'));
  sh.getRange(3, 3, 1, 8).breakApart().merge()
    .setValue('Análisis a ' + fin.headline.termYears
            + ' años · cifras en MXN antes de IVA · v2')
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontColor(token('TEXT_SECONDARY'))
    .setHorizontalAlignment('left');

  // -- Row 4: PROPOSAL disclaimer (structural invariant) ---------------------
  sh.getRange(4, 1, 1, 12).breakApart().merge()
    .setValue('ESTIMACIÓN DE PROPUESTA — ahorros no garantizados. '
            + 'Se requieren datos de intervalos de 15 minutos para validación '
            + 'bancable. Cifras en pesos mexicanos antes de IVA.')
    .setFontFamily(token('FONT_FAMILY'))
    .setBackground(token('BG_CALLOUT')).setFontColor(token('STATUS_WARN'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL')).setFontWeight('bold').setWrap(true)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.setRowHeight(4, 34);

  // -- Headline KPIs ----------------------------------------------------------
  var h = fin.headline, c = fin.cash;
  var kpiRow = 6;
  var paybackStr = (c.simplePaybackYears != null)
    ? c.simplePaybackYears.toFixed(1) + ' años'
    : 'no se recupera en ' + h.termYears + ' años';
  var discPaybackStr = (c.discountedPaybackYears != null)
    ? c.discountedPaybackYears.toFixed(1) + ' años'
    : 'n/d en el plazo';
  var kpis = [
    ['Ahorro Año 1',                 '$' + fmt(h.year1SavingsMxn) + '  (' + pct(h.savingsPctOfBill) + ' de tu recibo actual)'],
    ['Ahorro por demanda (Año 1)',   '$' + fmt(h.demandChargeSavingMxnYear1) + '  (' + pct(h.demandChargePctOfSavings) + ' del ahorro)'],
    ['Inversión (CAPEX total)',      '$' + fmt(c.capexMxn)],
    ['Recuperación simple',          paybackStr],
    ['Recuperación descontada',      discPaybackStr],
    ['ROI al plazo',                 pct(c.roiPctOverTerm)],
    ['VPN',                          '$' + fmt(c.npvMxn)],
    ['TIR',                          (c.irr != null) ? pct(c.irr) : 'n/d'],
    ['LCOE',                         fin.lcoe.mxnPerKwh.toFixed(2) + ' MXN/kWh'],
    ['Ahorro total al plazo',        '$' + fmt(h.termTotalNetMxn)]
  ];
  for (var i = 0; i < kpis.length; i++) {
    sh.getRange(kpiRow + i, 2).setValue(kpis[i][0]).setFontWeight('bold');
    sh.getRange(kpiRow + i, 4).setValue(kpis[i][1]);
  }
  if (opts.capexBreakdown) {
    sh.getRange(kpiRow + kpis.length, 2, 1, 8).merge()
      .setValue('CAPEX = materiales (BOM_v2) $' + fmt(opts.capexBreakdown.materialsMxn)
              + ' + instalación (INSTALLATION_v2) $' + fmt(opts.capexBreakdown.installMxn))
      .setFontSize(9).setFontColor(token('TEXT_MUTED')).setFontStyle('italic');
  }

  // -- CO2 / ESG block (figure + caveat written together: invariant) ---------
  var co2Row = kpiRow + kpis.length + 2;
  sh.getRange(co2Row, 2).setValue('IMPACTO AMBIENTAL')
    .setFontWeight('bold').setFontColor(token('TEXT_PRIMARY'));
  var co2Lines = [
    ['CO2e evitado Año 1',     fin.co2.year1Tons.toFixed(0) + ' toneladas'],
    ['CO2e evitado al plazo',  fin.co2.termTons.toFixed(0) + ' toneladas'],
    ['Equivale a',             fin.co2.carsEquivalent.toFixed(0) + ' autos fuera de circulación / '
                             + fin.co2.treesEquivalent.toFixed(0) + ' árboles plantados (por año)']
  ];
  for (var j = 0; j < co2Lines.length; j++) {
    sh.getRange(co2Row + 1 + j, 2).setValue(co2Lines[j][0]).setFontWeight('bold');
    sh.getRange(co2Row + 1 + j, 4).setValue(co2Lines[j][1]);
  }
  sh.getRange(co2Row + 1 + co2Lines.length, 2, 1, 8).merge()
    .setValue(opts.co2FactorNote
            || ('Factor de emisión ' + fin.co2.factorTonPerMwh
              + ' tCO2e/MWh (verificar factor oficial CRE vigente).'))
    .setFontSize(8).setFontColor(token('TEXT_MUTED')).setFontStyle('italic').setWrap(true);

  // -- Cash projection table --------------------------------------------------
  var tableTop = co2Row + co2Lines.length + 3;
  var headers = ['Año', 'Ahorro en\nrecibo', 'O&M', 'Reserva\nreemplazo',
                 'Ahorro\nneto', 'Posición\nacumulada'];
  for (var hc = 0; hc < headers.length; hc++) {
    sh.getRange(tableTop, hc + 1).setValue(headers[hc])
      .setFontWeight('bold').setBackground(token('BG_INPUT_CELL')).setWrap(true)
      .setVerticalAlignment('middle').setHorizontalAlignment('center');
  }
  sh.setRowHeight(tableTop, 40);
  var yrs = fin.cash.years;
  for (var y = 0; y < yrs.length; y++) {
    var r = yrs[y];
    var vals = [
      r.year,
      '$' + fmt(r.billSavingsMxn),
      r.omMxn > 0 ? '$' + fmt(r.omMxn) : '-',
      r.replacementReserveMxn > 0 ? '$' + fmt(r.replacementReserveMxn) : '-',
      '$' + fmt(r.netSavingsMxn),
      '$' + fmt(r.cumulativePositionMxn)
    ];
    for (var vc = 0; vc < vals.length; vc++) {
      sh.getRange(tableTop + 1 + y, vc + 1).setValue(vals[vc])
        .setHorizontalAlignment(vc === 0 ? 'center' : 'right');
    }
  }

  // -- Scenario comparison ------------------------------------------------------
  var hasBaas = fin.scenarios.length > 0
             && ('baasCumulativeNetMxn' in fin.scenarios[0]);
  var scTop = tableTop + 1 + yrs.length + 2;
  sh.getRange(scTop - 1, 1, 1, 8).merge()
    .setValue('COMPARACIÓN DE ESCENARIOS (acumulado por año)')
    .setFontWeight('bold').setFontColor(token('TEXT_PRIMARY'));
  var scHeaders = ['Año', 'Gasto CFE acumulado\nSIN sistema', 'Posición acumulada\nCOMPRA'];
  if (hasBaas) scHeaders.push('Ahorro acumulado\nARRENDAMIENTO');
  for (var sc = 0; sc < scHeaders.length; sc++) {
    sh.getRange(scTop, sc + 1).setValue(scHeaders[sc])
      .setFontWeight('bold').setBackground(token('BG_INPUT_CELL')).setWrap(true)
      .setVerticalAlignment('middle').setHorizontalAlignment('center');
  }
  sh.setRowHeight(scTop, 40);
  for (var sy = 0; sy < fin.scenarios.length; sy++) {
    var srow = fin.scenarios[sy];
    var svals = [srow.year,
                 '$' + fmt(srow.doNothingCumulativeSpendMxn),
                 '$' + fmt(srow.cashCumulativePositionMxn)];
    if (hasBaas) svals.push('$' + fmt(srow.baasCumulativeNetMxn));
    for (var sv = 0; sv < svals.length; sv++) {
      sh.getRange(scTop + 1 + sy, sv + 1).setValue(svals[sv])
        .setHorizontalAlignment(sv === 0 ? 'center' : 'right');
    }
  }
  if (!hasBaas) {
    sh.getRange(scTop + 1 + fin.scenarios.length + 1, 1, 1, 10).merge()
      .setValue('Genere la Proyección BaaS ("Generate BaaS Projection") y vuelva a '
              + 'generar este análisis para incluir el escenario de arrendamiento.')
      .setFontSize(9).setFontColor(token('TEXT_MUTED')).setFontStyle('italic').setWrap(true);
  }

  SpreadsheetApp.flush && SpreadsheetApp.flush();
  return { sheet: sh.getName(), rows: yrs.length, hasBaas: hasBaas };
}
