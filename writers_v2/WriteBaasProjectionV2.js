// =============================================================================
// ARGIA -- writers_v2/WriteBaasProjectionV2.js
// -----------------------------------------------------------------------------
// CHUNK 6 -- BaaS Economics Engine
//
// Renders the 15-year lease projection + headline KPIs into a
// BAAS_PROJECTION_v2 sheet, matching the proposal PDF layout.
//
// DISCLAIMERS (structural invariants, same discipline as the Chunk 5
// PROPOSAL tier disclaimer):
//   1. PROPOSAL-tier disclaimer (savings are estimates, not guaranteed,
//      interval data needed for bankable validation) -- inherited from the
//      engine's savings numbers.
//   2. TAX disclaimer -- whenever a tax benefit is shown, the sheet MUST
//      state it only applies to FINANCIERO leases for customers with
//      taxable profit to utilize the solar-CAPEX deduction, and to confirm
//      with a tax advisor. Rendered by the SAME function that writes the
//      tax column, so there is no path that shows a tax benefit without
//      the disclaimer.
// =============================================================================

function writeBaasProjectionV2(ss, baasResult, opts) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  opts = opts || {};
  if (!baasResult || !baasResult.projection) {
    throw new Error('writeBaasProjectionV2: baasResult.projection missing');
  }

  var sh = ss.getSheetByName('BAAS_PROJECTION_v2');
  if (!sh) sh = ss.insertSheet('BAAS_PROJECTION_v2');
  else sh.clear();

  // Shared design system, matching BOM_v2 / MDC_v2 / CFE_OUTPUT_v2:
  //   - hidden gridlines
  //   - logo anchored at (2,1); it displays across the wide col 2
  //   - title (22px token) at row 2 col 3; subtitle (small, secondary) row 3
  // Tokens drive every color/font so this sheet matches the others exactly.
  if (typeof resetDesignTokenCache_ === 'function') resetDesignTokenCache_();
  if (typeof loadDesignTokens === 'function') loadDesignTokens(ss);
  try { sh.setHiddenGridlines(true); } catch (e) { /* mock */ }

  // Column widths FIRST (before the logo) so the logo displays at full size
  // across the wide col 2 -- same ordering as the BOM/MDC templates.
  sh.setColumnWidth(1, 50);
  sh.setColumnWidth(2, 260);   // wide: the logo (anchored col 1) displays here
  for (var cw = 3; cw <= 11; cw++) sh.setColumnWidth(cw, 105);

  var fmt = _baasFmt;
  var pct = _baasPct;

  try {
    if (typeof _insertArgiaLogo === 'function') _insertArgiaLogo(sh, 2, 1);
  } catch (logoErr) { /* title alone is fine */ }

  // -- Banner: title (row 2) + subtitle (row 3), shifted to col 3 ---------
  sh.getRange(2, 3, 1, 8).breakApart().merge()
    .setValue('PROYECCIÓN DE AHORRO — ARRENDAMIENTO ' + baasResult.leaseType)
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_TITLE'))
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontColor(token('TEXT_PRIMARY'))
    .setVerticalAlignment('bottom').setHorizontalAlignment('left');
  sh.setRowHeight(2, tokenNum('ROW_H_TITLE'));
  sh.getRange(3, 3, 1, 8).breakApart().merge()
    .setValue('Proyección a ' + baasResult.headline.plazoAnios
            + ' años · cifras en MXN antes de IVA · v2')
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontColor(token('TEXT_SECONDARY'))
    .setHorizontalAlignment('left');

  // -- Row 4: PROPOSAL disclaimer (inherited; structural invariant) -------
  sh.getRange(4, 1, 1, 12).breakApart().merge()
    .setValue('ESTIMACIÓN DE PROPUESTA — ahorros no garantizados. '
            + 'Se requieren datos de intervalos de 15 minutos para validación '
            + 'bancable. Cifras en pesos mexicanos antes de IVA.')
    .setFontFamily(token('FONT_FAMILY'))
    .setBackground(token('BG_CALLOUT')).setFontColor(token('STATUS_WARN'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL')).setFontWeight('bold').setWrap(true)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.setRowHeight(4, 34);

  // -- Headline KPIs (start row 6, below the disclaimer) ------------------
  var h = baasResult.headline;
  var kpiRow = 6;
  var kpis = [
    ['Plazo',                       h.plazoAnios + ' años'],
    ['Mensualidad Año 1',           '$' + fmt(h.mensualidadAno1)],
    ['Ahorro neto Año 1',           '$' + fmt(h.ahorroAno1Mxn) + '  (' + pct(h.ahorroAno1Pct) + ')'],
    ['Ahorro acumulado al plazo',   '$' + fmt(h.ahorroPlazoMxn)],
    ['TIR ARGIA',                   baasResult.argiaIrr != null ? pct(baasResult.argiaIrr) : 'n/d']
  ];
  for (var i = 0; i < kpis.length; i++) {
    sh.getRange(kpiRow + i, 2).setValue(kpis[i][0]).setFontWeight('bold');
    sh.getRange(kpiRow + i, 4).setValue(kpis[i][1]);
  }

  // -- Negotiable range (ARGIA-internal) ----------------------------------
  var rng = baasResult.negotiableRange;
  var rngRow = kpiRow + kpis.length + 1;
  sh.getRange(rngRow, 2, 1, 8).merge()
    .setValue('RANGO NEGOCIABLE (interno ARGIA): mensualidad mínima $'
            + fmt(rng.minLeaseMensual) + ' (piso TIR) — máxima $'
            + fmt(rng.maxLeaseMensual) + ' (equilibrio cliente)'
            + (rng.valid ? '' : '  ⚠ SIN TRATO VIABLE: el piso de TIR excede el techo del cliente.'))
    .setBackground(token('BG_SUBTOTAL')).setFontSize(10)
    .setFontColor(rng.valid ? token('TEXT_PRIMARY') : token('STATUS_FAIL')).setWrap(true);

  // -- Projection table ---------------------------------------------------
  var tableTop = rngRow + 2;
  var headers = ['Año', 'Recibo sin\nEnergía Real', 'Recibo con\nEnergía Real',
                 'Ahorro en\nrecibo', 'Pago de\narrendamiento', 'Gastos de\noperación',
                 'Beneficio\nFiscal', 'Ahorro\nneto', 'Ahorro\nneto %',
                 'Ahorro\nacumulado', 'Acum %'];
  for (var c = 0; c < headers.length; c++) {
    sh.getRange(tableTop, c + 1).setValue(headers[c])
      .setFontWeight('bold').setBackground(token('BG_INPUT_CELL')).setWrap(true)
      .setVerticalAlignment('middle').setHorizontalAlignment('center');
  }
  sh.setRowHeight(tableTop, 40);

  var p = baasResult.projection;
  for (var y = 0; y < p.length; y++) {
    var row = tableTop + 1 + y;
    var r = p[y];
    var vals = [
      r.year,
      '$' + fmt(r.billSin),
      '$' + fmt(r.billCon),
      '$' + fmt(r.ahorroRecibo),
      '$' + fmt(r.lease),
      r.opex > 0 ? '$' + fmt(r.opex) : '-',
      r.taxBenefit > 0 ? '$' + fmt(r.taxBenefit) : '-',
      '$' + fmt(r.ahorroNeto),
      pct(r.ahorroNetoPct),
      '$' + fmt(r.ahorroAcum),
      pct(r.ahorroAcumPct)
    ];
    for (var cc = 0; cc < vals.length; cc++) {
      sh.getRange(row, cc + 1).setValue(vals[cc])
        .setHorizontalAlignment(cc === 0 ? 'center' : 'right');
    }
  }

  // -- TAX DISCLAIMER (structural invariant) ------------------------------
  // Rendered whenever a tax benefit is shown. Written here in the SAME
  // function that wrote the tax column, so a tax figure can never appear
  // without this disclaimer beneath it.
  var afterTable = tableTop + 1 + p.length + 1;
  if (baasResult.taxApplies) {
    sh.getRange(afterTable, 1, 1, 12).merge()
      .setValue('BENEFICIO FISCAL — aplica SOLO al arrendamiento FINANCIERO y '
              + 'únicamente si el cliente tiene utilidad fiscal suficiente para '
              + 'aprovechar la deducción del CAPEX solar. Amortizado a '
              + baasResult.projection.filter(function (x) { return x.taxBenefit > 0; }).length
              + ' años. Confirme la aplicabilidad con el asesor fiscal del cliente; '
              + 'ARGIA no garantiza el aprovechamiento fiscal.')
      .setBackground(token('BG_CALLOUT')).setFontColor(token('STATUS_WARN'))
      .setFontStyle('italic').setFontSize(9).setWrap(true);
    sh.setRowHeight(afterTable, 44);
  } else {
    sh.getRange(afterTable, 1, 1, 12).merge()
      .setValue('Sin beneficio fiscal en esta proyección (arrendamiento PURO, '
              + 'o el cliente no puede aprovechar la deducción fiscal).')
      .setFontStyle('italic').setFontSize(9).setFontColor(token('TEXT_MUTED')).setWrap(true);
  }

  // -- FX assumption note -------------------------------------------------
  var fxRow = afterTable + 1;
  if (opts.fxRate) {
    sh.getRange(fxRow, 1, 1, 12).merge()
      .setValue('Oferta considera un tipo de cambio de $' + fmt(opts.fxRate)
              + '. Cualquier variación de más del 5% resultará en un ajuste de tarifa.')
      .setFontSize(8).setFontColor(token('TEXT_MUTED')).setWrap(true);
  }


  SpreadsheetApp.flush && SpreadsheetApp.flush();
  return { sheet: sh.getName(), rows: p.length };
}


// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------
function _baasFmt(n) {
  var v = Math.round(Number(n) || 0);
  return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function _baasPct(x) {
  return ((Number(x) || 0) * 100).toFixed(1) + '%';
}


// ===========================================================================
// VALIDATION PLACEHOLDER (15-minute interval data)
// ===========================================================================
// Per the decision (2026-05-29): the hourly-sim source swap + 15-min
// validation stays a PLACEHOLDER -- structure ready, NOT live. Hard to
// validate near-term. This is the single switch that flips when interval
// data eventually arrives.
//
// Until intervalDataAvailable is true:
//   - tier stays PROPOSAL (never auto-upgrades to BANKABLE)
//   - the CFE_OUTPUT_v2 Section 2 source stays on the formula sheet
//     (Chunk 5 Session 3 Option 2 already enforces this)
//   - the BaaS projection inherits the PROPOSAL disclaimer
//
// To activate (future): supply a project's 15-min interval data, run the
// per-tier bias check, and if bias <= 10% set intervalDataAvailable true
// for that project. Everything downstream reads this one function.
// ===========================================================================
function _baasValidationStatus(ss) {
  return {
    tier:                  'PROPOSAL',
    intervalDataAvailable: false,
    biasCheckPassed:       false,
    reason:                'Datos de intervalos de 15 minutos no disponibles. '
                         + 'La proyección es una ESTIMACIÓN DE PROPUESTA. '
                         + 'Validación bancable pendiente.',
    activationNote:        'When 15-min interval data is available for a '
                         + 'project and per-tier bias <= 10%, set '
                         + 'intervalDataAvailable=true here. This is the '
                         + 'single activation point; structure is ready.'
  };
}
