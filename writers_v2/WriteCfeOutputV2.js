// =============================================================================
// ARGIA ENGINE v2 -- File: writers_v2/WriteCfeOutputV2.gs
// -----------------------------------------------------------------------------
// CHUNK 7 — v2 CFE_OUTPUT renderer. Fills data into the already-set-up
// CFE_OUTPUT_v2 sheet:
//   - Header strip values (rows 5-8)
//   - KPI strip (row 10) — 3 tiles, 3rd is conditional (steady-state)
//   - Section 1 (Con PV) monthly data rows 14-20
//   - Section 2 (Con PV + BESS) monthly data rows 24-31
//   - Annual footer cascade (row 35)
//   - Year-1 vs Year-2+ steady-state section (rows 37-42) — conditional
//   - BDF-5 hourly addendum (rows 45-64) — conditional on hourlySim arg:
//       (a) Hourly engine summary (Sin PV / Con PV+BESS / Ahorro)
//       (b) Bill components breakdown (Capacidad, Distribuci\u00f3n, etc.)
//       (c) Provenance + optional warnings
//
// ENTRY POINTS
//   - writeCfeOutputV2(ss, hourlySim)  : engine entry (Step 13.5-v2)
//   - runUpdateCfeOutputV2()           : menu entry (hourlySim=null;
//                                        addendum skipped)
//
// INVOCATION MODEL (chunk 7 decision)
//   BOTH:
//     - Engine-wired as Step 13.5-v2 in 00_Main.js (parallel to legacy 13.5)
//     - Menu item "Update CFE_OUTPUT v2" (parallel to legacy "Update CFE_OUTPUT")
//
// ISOLATION FROM LEGACY (06_WriteCfeOutput.gs)
//   - Does NOT call writeCfeOutput, _cfeOutReadScalar, _cfeOutReadMonthly,
//     _cfeOutWriteHeaderStrip, _cfeOutWriteKpiStrip, _cfeOutWriteSection1,
//     _cfeOutWriteSection2, _cfeOutWriteFooter, _cfeOutWriteYear1SteadySection
//   - Does NOT reference CFE_OUT_SRC, CFE_OUT_ROW (legacy globals)
//   - Uses CFE_OUT_SRC_V2, CFE_OUT_ROW_V2, readCfeScalar, readCfeMonthly
//     defined in chunk 7
//   - Output sheet name is V2_SHEETS.CFE_OUTPUT ('CFE_OUTPUT_v2')
//
//   When 06_WriteCfeOutput.gs is deleted at cutover (Chunk 11), v2 keeps
//   working unchanged.
//
// DEPENDENCIES (v2 + shared infra only)
//   - V2_SHEETS                                -- templates/TemplateRegistry.gs
//   - setupCfeOutputTemplate, CFE_OUT_ROW_V2   -- templates/setupCfeOutputTemplate.gs
//   - readCfeScalar, readCfeMonthly,
//     CFE_OUT_SRC_V2, CFE_OUT_MONTHS_V2        -- writers_v2/helpers/CfeOutputSourceMap.gs
//   - token, tokenNum, loadDesignTokens        -- 02a_DesignTokens.gs (shared)
// =============================================================================


// -----------------------------------------------------------------------------
// MENU ENTRY POINT (wired in 00_Main.js)
// -----------------------------------------------------------------------------
function runUpdateCfeOutputV2() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  try {
    // Menu invocation has no hourlySim — addendum will be skipped when
    // null. Engine invocation passes hourlySim from Step 13.
    writeCfeOutputV2(ss, null);
    ui.alert('CFE_OUTPUT_v2 updated.');
  } catch (err) {
    ui.alert('CFE_OUTPUT_v2 error', err.message, ui.ButtonSet.OK);
  }
}


// -----------------------------------------------------------------------------
// ENGINE ENTRY POINT (called from 00_Main.js Step 13.5-v2)
// -----------------------------------------------------------------------------
/**
 * Renders CFE_OUTPUT_v2 end-to-end. Idempotent: calls setupCfeOutputTemplate
 * first (which creates or refreshes the sheet structure), then fills data.
 *
 * @param {Spreadsheet}   ss          The active spreadsheet.
 * @param {Object|null}   hourlySim   Optional hourly-sim result from Step 13.
 *                                    When provided AND not .blocked, the
 *                                    BDF-5 addendum is appended (hourly
 *                                    summary + bill components + provenance).
 * @return {Object}                   { sheet, hasSteady, hasHourly }
 */
function writeCfeOutputV2(ss, hourlySim) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();

  if (typeof resetDesignTokenCache_ === 'function') resetDesignTokenCache_();
  if (typeof loadDesignTokens === 'function') loadDesignTokens(ss);

  // -- 1. Required source sheets must exist (read-only consumer). ----------
  // We use the same sheet names legacy uses \u2014 INPUT_CFE / CFE_SIMULATION /
  // BESS_SIMULATION are not v2-renamed; they're upstream sheets owned by
  // other modules. If they're missing, fail fast with a clear message.
  var required = ['INPUT_CFE', 'CFE_SIMULATION', 'BESS_SIMULATION'];
  for (var i = 0; i < required.length; i++) {
    if (!ss.getSheetByName(required[i])) {
      throw new Error('writeCfeOutputV2: required source sheet "' +
                      required[i] + '" not found.');
    }
  }

  // -- 2. Set up / refresh the template (idempotent). ----------------------
  var sh = setupCfeOutputTemplate(ss);

  // -- 3. Fill data section by section. ------------------------------------
  // Chunk 5 Session 3: tier banner (LOCKED disclaimer) renders FIRST, in two
  // places (top + above Section 2). The tier is PROPOSAL whenever the hourly
  // sim produced attribution data (customer-facing estimate); SCREENING
  // otherwise (internal/incomplete).
  var tier = (hourlySim && !hourlySim.blocked && hourlySim.attribution)
             ? 'PROPOSAL' : 'SCREENING';
  if (typeof _cfeOutV2_renderTierBanner === 'function') {
    _cfeOutV2_renderTierBanner(sh, CFE_OUT_ROW_V2.TIER_BANNER_TOP || 4, tier);
  }

  _cfeOutV2_fillHeaderStrip(sh, ss);
  _cfeOutV2_fillKpiStrip(sh, ss);
  _cfeOutV2_fillSection1(sh, ss);

  // Second tier banner, directly above Section 2 (adjacent to the savings).
  if (typeof _cfeOutV2_renderTierBanner === 'function') {
    _cfeOutV2_renderTierBanner(sh, CFE_OUT_ROW_V2.TIER_BANNER_SEC2 || 21, tier);
  }
  _cfeOutV2_fillSection2(sh, ss, hourlySim);
  _cfeOutV2_fillFooter(sh, ss);
  var hasSteady = _cfeOutV2_fillYear1SteadySection(sh, ss);

  // -- 4. BDF-5 hourly addendum (conditional on hourlySim arg). ------------
  // Positions itself via getLastRow()+3 so it appears right after Y1SS
  // (or after the footer if Y1SS skipped). Designer-facing block: hourly
  // engine cross-check + bill components breakdown + provenance.
  var hasHourly = false;
  if (hourlySim && !hourlySim.blocked) {
    _cfeOutV2_fillHourlyAddendum(sh, hourlySim);
    hasHourly = true;
  }

  // -- 5. Chunk 5 Session 3: Conservative/Expected/Upside + demand breakdown.
  // These render BELOW everything else (computed from getLastRow) so they
  // never collide with existing rows. Only shown when the hourly sim
  // produced attribution + autoOptimize data.
  if (hourlySim && !hourlySim.blocked && hourlySim.attribution
      && typeof _cfeOutV2_renderConsExpUpside === 'function') {
    var blockStart = sh.getLastRow() + 2;
    var ao = hourlySim.autoOptimize || null;
    // Expected headline = the proposed run's actual BESS-attributable
    // annual savings (pvOnly total - pvBess total), the real full-bill number.
    var expectedAnnual = 0;
    if (hourlySim.attribution.pvOnly && hourlySim.attribution.pvBess) {
      expectedAnnual = (Number(hourlySim.attribution.pvOnly.totalCostMxn) || 0)
                     - (Number(hourlySim.attribution.pvBess.totalCostMxn) || 0);
    }
    var interconnMode = hourlySim.interconnMode || '';
    // [B-1] Addressable annual bill = CFE cost with PV but no BESS. The screening
    // Optimo cannot exceed it (you can't save more than you pay), so pass it to
    // clamp the upside/conservative tiles to a physically achievable bound.
    var addressableMxn = (hourlySim.attribution.pvOnly
      && Number(hourlySim.attribution.pvOnly.totalCostMxn)) || 0;
    var lastRow = _cfeOutV2_renderConsExpUpside(sh, blockStart, ao, expectedAnnual, interconnMode, addressableMxn);
    if (typeof _cfeOutV2_renderDemandChargeBreakdown === 'function') {
      _cfeOutV2_renderDemandChargeBreakdown(sh, lastRow + 2, hourlySim);
    }
    // Chunk 7 Session 2: resilience/backup value block. Rendered as its own
    // separated section (never blended into CFE savings). No-op when the
    // project has no backup reserve / value / warnings.
    if (hourlySim.resilience
        && typeof _cfeOutV2_renderResilienceBlock === 'function') {
      _cfeOutV2_renderResilienceBlock(sh, (sh.getLastRow() + 2), hourlySim.resilience);
    }
    // Chunk 7 Scenario 4B: existing-PV export-capture value block (separated
    // from CFE savings, net of regime). No-op for non-4B projects.
    if (hourlySim.existingPvExport
        && typeof _cfeOutV2_renderCaptureBlock === 'function') {
      _cfeOutV2_renderCaptureBlock(sh, (sh.getLastRow() + 2), hourlySim.existingPvExport);
    }
  }

  SpreadsheetApp.flush && SpreadsheetApp.flush();
  return { sheet: sh.getName(), hasSteady: hasSteady, hasHourly: hasHourly };
}


// =============================================================================
// Strategy explainer (3.7.9) — one-line "why this strategy" for CFE_OUTPUT.
// Customer-facing. Maps the BESS_STRATEGY value to a plain-Spanish sentence
// describing what the battery prioritizes. Returns '' for unknown/blank so
// the row is simply skipped.
// =============================================================================
function _cfeOutV2_strategyExplainer(strategyRaw) {
  var s = String(strategyRaw || '').trim().toUpperCase();
  if (s === 'PEAK_SHAVING') {
    return 'Estrategia: Recorte de demanda (peak shaving). La batería prioriza '
         + 'descargar en horario PUNTA para reducir el cargo por demanda y el '
         + 'consumo en la ventana más cara; también aprovecha excedente solar e '
         + 'intermedia cuando hay energía disponible.';
  }
  if (s === 'SELF_CONSUMPTION_MAX') {
    return 'Estrategia: Autoconsumo máximo. La batería prioriza almacenar el '
         + 'excedente solar para usarlo después en vez de exportarlo, y lo '
         + 'descarga para cubrir consumo (principalmente en punta). En este '
         + 'esquema el ahorro es muy similar al de recorte de demanda, porque '
         + 'el excedente solar (mediodía) y la punta (tarde-noche) rara vez '
         + 'coinciden en la misma hora.';
  }
  if (s === 'LOAD_SHIFTING') {
    return 'Estrategia: Arbitraje horario (load shifting). Además de descargar '
         + 'en punta, la batería puede cargarse de la red en horario BASE '
         + '(barato) para descargar en PUNTA (caro), siempre que la diferencia '
         + 'de tarifa supere las pérdidas de la batería y el esquema sea '
         + 'NET_BILLING. Es la estrategia con mayor potencial de ahorro cuando '
         + 'el diferencial base→punta es alto.';
  }
  return '';
}


// =============================================================================
// Interconnection label (4.0.0) — map the raw INPUT_CFE!C41 enum to a
// human-friendly label, and never return blank. "(no definido)" makes a
// missing value visible instead of an empty cell.
// =============================================================================
function _cfeOutV2_interconnLabel(raw) {
  var s = String(raw || '').trim().toUpperCase();
  switch (s) {
    case 'FACTURACION_NETA': return 'FACTURACIÓN NETA (NET_BILLING)';
    case 'MEDICION_NETA':    return 'MEDICIÓN NETA (NET_METERING)';
    case 'SIN_EXPORTACION':  return 'SIN EXPORTACIÓN (ZERO_EXPORT)';
    case '':                 return '(no definido)';
    default:                 return raw;   // show whatever is there, unmodified
  }
}


// =============================================================================
// LOAD_SHIFTING interconnection warning (4.0.0).
//
// LOAD_SHIFTING only performs base->punta grid arbitrage under FACTURACION_NETA
// (NET_BILLING). Under MEDICION_NETA / SIN_EXPORTACION / unset, the arbitrage
// smart gate never opens and the dispatcher silently behaves like PEAK_SHAVING
// — producing IDENTICAL numbers. That silent collapse is exactly what bit us
// in testing. This returns a loud warning string when the combination is
// inert, or '' otherwise.
// =============================================================================
function _cfeOutV2_loadShiftWarning(strategyRaw, interconnRaw) {
  var strat = String(strategyRaw || '').trim().toUpperCase();
  if (strat !== 'LOAD_SHIFTING') return '';
  var ic = String(interconnRaw || '').trim().toUpperCase();
  if (ic === 'FACTURACION_NETA') return '';   // arbitrage active — no warning
  return '\u26A0 ADVERTENCIA: LOAD_SHIFTING requiere interconexión '
       + 'FACTURACIÓN_NETA (NET_BILLING) para hacer arbitraje de la red. '
       + 'La interconexión actual es ' + (ic || '(no definida)') + ', por lo que '
       + 'la batería NO carga de la red y el resultado es idéntico a '
       + 'PEAK_SHAVING. Cambie la interconexión a FACTURACION_NETA en '
       + 'INPUT_CFE!C41, o seleccione PEAK_SHAVING para reflejar el '
       + 'comportamiento real.';
}


// =============================================================================
// HEADER STRIP (rows 5-8) — values only; template owns labels
// =============================================================================
function _cfeOutV2_fillHeaderStrip(sh, ss) {
  var R = CFE_OUT_ROW_V2;

  // Row 5: TARIFF CODE (col C) | SERVICE NAME (col J)
  sh.getRange(R.TARIFF_HEADER, 3).setValue(readCfeScalar(ss, 'input_tariffCode'));
  sh.getRange(R.TARIFF_HEADER, 10).setValue(readCfeScalar(ss, 'input_serviceName'));
  // Row 6: SERVICE NUMBER | CONTRACTED kW
  sh.getRange(R.LOCATION_ROW, 3).setValue(readCfeScalar(ss, 'input_serviceNumber'));
  sh.getRange(R.LOCATION_ROW, 10).setValue(readCfeScalar(ss, 'input_contractedKw'));
  // Row 7: INTERCONEXION | AUTOCONSUMO
  // 4.0.0: always render interconnection (never leave blank). Map the raw
  // INPUT_CFE enum to a friendly label; show "(no definido)" when unset so a
  // missing value is visible rather than an empty cell.
  var interconnRaw = String(readCfeScalar(ss, 'input_interconnMode') || '').trim();
  sh.getRange(R.INTERCONN_ROW, 3).setValue(_cfeOutV2_interconnLabel(interconnRaw));
  sh.getRange(R.INTERCONN_ROW, 10).setValue(readCfeScalar(ss, 'input_autoconsumoPct'));
  // Row 8: ESTRATEGIA BESS | BATERIA kWh/kW
  var stratRaw = readCfeScalar(ss, 'bsim_strategy');
  sh.getRange(R.BESS_SPEC_ROW, 3).setValue(stratRaw);
  var ekwh = readCfeScalar(ss, 'bsim_energiaUsable');
  var pkw  = readCfeScalar(ss, 'bsim_potenciaKw');
  sh.getRange(R.BESS_SPEC_ROW, 10).setValue(
    (ekwh === '' ? '-' : ekwh) + ' kWh usable / ' +
    (pkw  === '' ? '-' : pkw)  + ' kW'
  );
  // Row 9 (3.7.9): one-line "por qué esta estrategia" explainer. Customer-
  // facing transparency — tells the reader what the battery prioritizes and
  // why it produces the savings shown below. Spans cols C-J, italic, small.
  //
  // 4.0.0: the explainer is now interconnection-aware. LOAD_SHIFTING only
  // does grid arbitrage under FACTURACION_NETA (NET_BILLING). If the strategy
  // is LOAD_SHIFTING but interconnection is NOT NET_BILLING, the dispatcher
  // silently collapses to peak-shaving behavior. We must NOT let that be
  // silent — append a loud, red warning so the designer sees that the chosen
  // strategy is not actually active.
  var warnLoadShift = _cfeOutV2_loadShiftWarning(stratRaw, interconnRaw);
  var explainer = _cfeOutV2_strategyExplainer(stratRaw);
  if (warnLoadShift) {
    explainer = (explainer ? explainer + '  ' : '') + warnLoadShift;
  }
  if (explainer) {
    var exRow = R.BESS_SPEC_ROW + 1;  // row 9
    sh.getRange(exRow, 3, 1, 8).merge();
    var exCell = sh.getRange(exRow, 3)
      .setValue(explainer)
      .setFontStyle('italic')
      .setFontSize(9)
      .setWrap(true);
    // Red text + light-red fill when the warning is present, so it cannot
    // be mistaken for a normal informational line.
    if (warnLoadShift) {
      exCell.setFontColor('#B00020').setBackground('#FCE8E6').setFontWeight('bold');
    }
  }

  // Bold values (col C and J) — matches legacy emphasis
  sh.getRange(R.TARIFF_HEADER, 3).setFontWeight('bold');
  sh.getRange(R.TARIFF_HEADER, 10).setFontWeight('bold');
  sh.getRange(R.LOCATION_ROW, 3).setFontWeight('bold');
  sh.getRange(R.LOCATION_ROW, 10).setFontWeight('bold');
  sh.getRange(R.INTERCONN_ROW, 3).setFontWeight('bold');
  sh.getRange(R.INTERCONN_ROW, 10).setFontWeight('bold');
  sh.getRange(R.BESS_SPEC_ROW, 3).setFontWeight('bold');
  sh.getRange(R.BESS_SPEC_ROW, 10).setFontWeight('bold');
}


// =============================================================================
// KPI STRIP (row 10) — three tiles, 3rd conditional on steady-state data
// =============================================================================
function _cfeOutV2_fillKpiStrip(sh, ss) {
  var R = CFE_OUT_ROW_V2;

  var reciboBase  = Number(readCfeScalar(ss, 'bsim_reciboBase'))   || 0;
  var reciboPv    = Number(readCfeScalar(ss, 'bsim_reciboTrasPv')) || 0;
  var reciboFinal = Number(readCfeScalar(ss, 'bsim_reciboFinal'))  || 0;
  var steadyRaw   = readCfeScalar(ss, 'bsim_reciboFinalSteady');
  var hasSteady   = steadyRaw !== '' && steadyRaw !== null;
  var reciboFinalSteady = hasSteady ? (Number(steadyRaw) || 0) : null;

  // Tile 1: cols 2-5, gray
  _cfeOutV2_paintKpiTile(sh, R.KPI_HEADLINE, 2,
                         'RECIBO ANUAL SIN PV', reciboBase, '#F5F3EE');
  // Tile 2: cols 7-10, light green
  _cfeOutV2_paintKpiTile(sh, R.KPI_HEADLINE, 7,
                         'RECIBO ANUAL CON PV', reciboPv, '#E8F5E9');
  // Tile 3: cols 12-15, dark green; rich-text variant if steady exists
  if (hasSteady) {
    _cfeOutV2_paintKpiTileSteady(sh, R.KPI_HEADLINE, 12,
                                 reciboFinal, reciboFinalSteady, '#C8E6C9');
    sh.setRowHeight(R.KPI_HEADLINE, 80);
  } else {
    _cfeOutV2_paintKpiTile(sh, R.KPI_HEADLINE, 12,
                           'RECIBO ANUAL CON PV + BESS', reciboFinal, '#C8E6C9');
    sh.setRowHeight(R.KPI_HEADLINE, 60);
  }
}


function _cfeOutV2_paintKpiTile(sh, row, col, label, value, bg) {
  sh.getRange(row, col, 1, 4).breakApart().merge()
    .setValue(label + '\n$' + _cfeOutV2_fmt(value))
    .setBackground(bg)
    .setFontSize(15)
    .setFontWeight('bold')
    .setVerticalAlignment('middle')
    .setWrap(true);
}


function _cfeOutV2_paintKpiTileSteady(sh, row, col, year1, steady, bg) {
  // Mixed font sizes in one cell — use rich text
  var labelText = 'RECIBO ANUAL CON PV + BESS';
  var y1Text    = '\nA\u00f1o 1: $' + _cfeOutV2_fmt(year1);
  var ssText    = '\nA\u00f1o 2+: $' + _cfeOutV2_fmt(steady);
  var full      = labelText + y1Text + ssText;

  // Best-effort rich text \u2014 fall back to plain text if newRichTextValue
  // isn't supported (mocks don't always have it).
  var rangeObj = sh.getRange(row, col, 1, 4).breakApart().merge();
  rangeObj.setBackground(bg).setVerticalAlignment('middle').setWrap(true);

  try {
    var labelStyle = SpreadsheetApp.newTextStyle()
      .setFontSize(9).setForegroundColor('#666666').build();
    var valueStyle = SpreadsheetApp.newTextStyle()
      .setFontSize(15).setBold(true).build();
    var rich = SpreadsheetApp.newRichTextValue()
      .setText(full)
      .setTextStyle(0, labelText.length, labelStyle)
      .setTextStyle(labelText.length, full.length, valueStyle)
      .build();
    sh.getRange(row, col).setRichTextValue(rich);
  } catch (e) {
    // Fallback: plain value
    sh.getRange(row, col).setValue(full).setFontSize(12).setFontWeight('bold');
  }
}


// =============================================================================
// SECTION 1 (rows 14-20) — Con PV monthly data
// =============================================================================
function _cfeOutV2_fillSection1(sh, ss) {
  var R = CFE_OUT_ROW_V2;

  // Sum kWh after PV per month = CFE_SIM rows 5+6+7
  var kwhBase  = readCfeMonthly(ss, 'csim_kwhBaseAfterPv');
  var kwhInter = readCfeMonthly(ss, 'csim_kwhInterAfterPv');
  var kwhPunta = readCfeMonthly(ss, 'csim_kwhPuntaAfterPv');
  var kwhNeto = [];
  for (var i = 0; i < 12; i++) {
    kwhNeto.push((Number(kwhBase[i])||0) + (Number(kwhInter[i])||0) + (Number(kwhPunta[i])||0));
  }

  // Annual savings vs sin PV per month = INPUT_CFE row 37 - CFE_SIM row 39
  var totalSinPv = readCfeMonthly(ss, 'input_total');
  var totalConPv = readCfeMonthly(ss, 'csim_total');
  var ahorroPv = [];
  for (var j = 0; j < 12; j++) {
    ahorroPv.push((Number(totalSinPv[j])||0) - (Number(totalConPv[j])||0));
  }

  _cfeOutV2_writeMonthlyValues(sh, R.SEC1_KWH_NETO,    kwhNeto,                            'kwh');
  _cfeOutV2_writeMonthlyValues(sh, R.SEC1_SOLAR_KWH,   readCfeMonthly(ss, 'csim_solarKwh'),    'kwh');
  _cfeOutV2_writeMonthlyValues(sh, R.SEC1_EXPORTADO,   readCfeMonthly(ss, 'csim_pvExportado'), 'kwh');
  _cfeOutV2_writeMonthlyValues(sh, R.SEC1_DEMANDA,     readCfeMonthly(ss, 'input_demandaFact'),'kw');
  _cfeOutV2_writeMonthlyValues(sh, R.SEC1_FACTURACION, readCfeMonthly(ss, 'csim_facturacion'), 'mxn');
  _cfeOutV2_writeMonthlyValues(sh, R.SEC1_TOTAL,       totalConPv,                            'mxn');
  _cfeOutV2_writeMonthlyValues(sh, R.SEC1_AHORRO,      ahorroPv,                              'mxn');
}


// =============================================================================
// SECTION 2 (rows 24-31) — Con PV + BESS monthly data
// =============================================================================
// CHUNK 5 Session 3 (Option 2 — headline stays on formula sheet):
//   Section 2 monthly numbers continue to read from the BESS_SIMULATION
//   formula sheet, UNCHANGED from 4.1.0. The hourly-sim source swap is
//   DEFERRED to Session 4, after the 15-minute interval validation tells
//   us whether the hourly sim or the formula sheet is more accurate.
//
//   Rationale: swapping the headline customer number to an unvalidated
//   calculation method — before the very validation that Session 4 exists
//   to perform — is exactly what the PROPOSAL disclaimer warns customers
//   about. So we don't do it to ourselves. The new hourly-sim VALUE
//   (Conservative/Expected/Upside range, kW-aware demand breakdown, tier
//   disclaimer) still ships this session as ADDITIVE blocks; only the
//   core monthly headline numbers stay on the proven formula-sheet source.
//
//   The `hourlySim` parameter is kept (unused for the monthly rows) so the
//   signature is forward-compatible: Session 4 flips the source here once
//   validated, with no caller change.
// =============================================================================
function _cfeOutV2_fillSection2(sh, ss, hourlySim) {
  var R = CFE_OUT_ROW_V2;

  var ahorroCap  = readCfeMonthly(ss, 'bsim_ahorroMesCap');
  var ahorroDist = readCfeMonthly(ss, 'bsim_ahorroMesDist');
  var ahorroVar  = readCfeMonthly(ss, 'bsim_ahorroMesVar');

  var ahorroBessTotal = [];
  for (var i = 0; i < 12; i++) {
    ahorroBessTotal.push(
      (Number(ahorroCap[i])||0) + (Number(ahorroDist[i])||0) + (Number(ahorroVar[i])||0)
    );
  }

  var totalConPv = readCfeMonthly(ss, 'csim_total');
  var reciboFinalMonthly = [];
  for (var j = 0; j < 12; j++) {
    reciboFinalMonthly.push((Number(totalConPv[j])||0) - ahorroBessTotal[j]);
  }

  _cfeOutV2_writeMonthlyValues(sh, R.SEC2_DMAX_SIN,     readCfeMonthly(ss, 'bsim_dmaxSinBess'), 'kw');
  _cfeOutV2_writeMonthlyValues(sh, R.SEC2_POT_SHAVING,  readCfeMonthly(ss, 'bsim_potShaving'),  'kw');
  _cfeOutV2_writeMonthlyValues(sh, R.SEC2_DMAX_CON,     readCfeMonthly(ss, 'bsim_dmaxConBess'), 'kw');
  _cfeOutV2_writeMonthlyValues(sh, R.SEC2_AHORRO_CAP,   ahorroCap,                              'mxn');
  _cfeOutV2_writeMonthlyValues(sh, R.SEC2_AHORRO_DIST,  ahorroDist,                             'mxn');
  _cfeOutV2_writeMonthlyValues(sh, R.SEC2_AHORRO_VAR,   ahorroVar,                              'mxn');
  _cfeOutV2_writeMonthlyValues(sh, R.SEC2_AHORRO_TOTAL, ahorroBessTotal,                        'mxn');
  _cfeOutV2_writeMonthlyValues(sh, R.SEC2_RECIBO_FINAL, reciboFinalMonthly,                     'mxn');

  // Session 4 will flip this to 'HOURLY_SIM_ATTRIBUTION' post-validation.
  _cfeOutV2_section2Source = 'BESS_SIMULATION_FORMULA';
}

// Module-scope marker of which source Section 2 used (read by addendum).
var _cfeOutV2_section2Source = 'BESS_SIMULATION_FORMULA';


// =============================================================================
// ANNUAL FOOTER (row 35) — 5 cascade values across merged blocks
// =============================================================================
function _cfeOutV2_fillFooter(sh, ss) {
  var R = CFE_OUT_ROW_V2;

  var reciboBase   = Number(readCfeScalar(ss, 'bsim_reciboBase'))   || 0;
  var ahorroPv     = Number(readCfeScalar(ss, 'bsim_ahorroPv'))     || 0;
  var reciboTrasPv = Number(readCfeScalar(ss, 'bsim_reciboTrasPv')) || 0;
  var ahorroBess   = (Number(readCfeScalar(ss, 'bsim_ahorroBessCap'))  || 0)
                   + (Number(readCfeScalar(ss, 'bsim_ahorroBessDist')) || 0)
                   + (Number(readCfeScalar(ss, 'bsim_ahorroBessVar'))  || 0);
  var reciboFinal  = Number(readCfeScalar(ss, 'bsim_reciboFinal'))  || 0;
  var values = [reciboBase, ahorroPv, reciboTrasPv, ahorroBess, reciboFinal];

  // Same merged blocks as template label row (3-4, 5-6, 7-8, 9-10, 11-12)
  var blocks = [[3,4],[5,6],[7,8],[9,10],[11,12]];
  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i];
    sh.getRange(R.FOOTER_VALUES, b[0], 1, b[1]-b[0]+1).breakApart().merge()
      .setValue('$' + _cfeOutV2_fmt(values[i]))
      .setFontSize(14)
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
  }
}


// =============================================================================
// YEAR-1 vs YEAR-2+ STEADY-STATE SECTION (rows 37-42) — CONDITIONAL
// Returns true if rendered, false if skipped.
// =============================================================================
function _cfeOutV2_fillYear1SteadySection(sh, ss) {
  var R = CFE_OUT_ROW_V2;
  var steadyRaw = readCfeScalar(ss, 'bsim_reciboFinalSteady');
  if (steadyRaw === '' || steadyRaw === null) return false;

  var year1Recibo       = Number(readCfeScalar(ss, 'bsim_reciboFinal')) || 0;
  var steadyRecibo      = Number(steadyRaw) || 0;
  var year1CapAhorroRaw = Number(readCfeScalar(ss, 'bsim_ahorroBessCap')) || 0;
  var year1CapAhorro    = Math.abs(year1CapAhorroRaw);  // stored negative; flip
  var steadyCapAhorro   = Number(readCfeScalar(ss, 'bsim_ahorroCapSteadyAnnual')) || 0;
  var reciboBase        = Number(readCfeScalar(ss, 'bsim_reciboBase')) || 0;
  var year1TotalAhorro  = reciboBase - year1Recibo;
  var steadyTotalAhorro = reciboBase - steadyRecibo;

  // Section header (r37)
  sh.getRange(R.Y1SS_HEADER, 2, 1, 13).breakApart().merge()
    .setValue('A\u00d1O 1  vs  A\u00d1O 2+  (despu\u00e9s que la ventana m\u00f3vil de CFE se renueva)')
    .setFontWeight('bold')
    .setFontSize(11)
    .setBackground('#FFF8E1')
    .setVerticalAlignment('middle');
  sh.setRowHeight(R.Y1SS_HEADER, 26);

  // Column labels (r38)
  sh.getRange(R.Y1SS_LABELS, 2).setValue('Concepto')
    .setFontSize(9).setFontColor('#666666');
  sh.getRange(R.Y1SS_LABELS, 5).setValue('A\u00f1o 1')
    .setFontSize(9).setFontColor('#666666').setHorizontalAlignment('right');
  sh.getRange(R.Y1SS_LABELS, 7).setValue('A\u00f1o 2+')
    .setFontSize(9).setFontColor('#666666').setHorizontalAlignment('right');
  sh.getRange(R.Y1SS_LABELS, 9).setValue('Diferencia (A\u00f1o 2+ \u2212 A\u00f1o 1)')
    .setFontSize(9).setFontColor('#666666').setHorizontalAlignment('right');

  // Three data rows — recibo (lower better), ahorros (higher better)
  _cfeOutV2_writeY1SSRow(sh, R.Y1SS_RECIBO,       'Recibo CFE final (PV + BESS)', year1Recibo,      steadyRecibo,      true,  false);
  _cfeOutV2_writeY1SSRow(sh, R.Y1SS_AHORRO_CAP,   'Ahorro BESS \u2014 Capacidad',  year1CapAhorro,   steadyCapAhorro,   false, true);
  _cfeOutV2_writeY1SSRow(sh, R.Y1SS_AHORRO_TOTAL, 'Ahorro total vs Sin PV',       year1TotalAhorro, steadyTotalAhorro, true,  true);

  // Explanatory note (r42)
  sh.getRange(R.Y1SS_NOTE, 2, 1, 13).breakApart().merge()
    .setValue(
      'Nota: CFE cobra Capacidad sobre MAX(kW punta, 0.7 \u00d7 kW m\u00e1x de los \u00faltimos ' +
      '12 meses). En el a\u00f1o 1 despu\u00e9s de instalar BESS, la "ventana m\u00f3vil" a\u00fan incluye ' +
      'picos de demanda pre-BESS, que mantienen el piso de 0.7\u00d7movil elevado. A partir del ' +
      'a\u00f1o 2, la ventana se ha renovado con los nuevos picos (m\u00e1s bajos gracias al BESS), ' +
      'y el ahorro de Capacidad llega a su valor estable. Distribuci\u00f3n y Ahorro Variable son ' +
      'iguales en ambos escenarios.'
    )
    .setFontSize(9).setFontColor('#666666').setWrap(true).setVerticalAlignment('top');
  sh.setRowHeight(R.Y1SS_NOTE, 60);

  return true;
}


function _cfeOutV2_writeY1SSRow(sh, rowNum, label, y1, ss_, bold, betterWhenHigher) {
  sh.getRange(rowNum, 2).setValue(label).setFontSize(10);
  if (bold) sh.getRange(rowNum, 2).setFontWeight('bold');

  sh.getRange(rowNum, 5).setValue('$' + _cfeOutV2_fmt(y1))
    .setFontSize(10).setHorizontalAlignment('right');
  sh.getRange(rowNum, 7).setValue('$' + _cfeOutV2_fmt(ss_))
    .setFontSize(10).setHorizontalAlignment('right');

  var diff = ss_ - y1;
  var diffStr = (diff >= 0 ? '+$' : '-$') + _cfeOutV2_fmt(Math.abs(diff));
  var isGood = betterWhenHigher ? (diff > 0) : (diff < 0);
  var diffColor = (diff === 0) ? '#111111' : (isGood ? '#2E7D32' : '#C62828');
  sh.getRange(rowNum, 9).setValue(diffStr)
    .setFontSize(10).setFontColor(diffColor).setHorizontalAlignment('right');

  if (bold) {
    sh.getRange(rowNum, 5).setFontWeight('bold');
    sh.getRange(rowNum, 7).setFontWeight('bold');
    sh.getRange(rowNum, 9).setFontWeight('bold');
  }
}


// =============================================================================
// BDF-5 HOURLY ADDENDUM (rows 45-64 in legacy CFE_OUTPUT)
// -----------------------------------------------------------------------------
// Designer-facing block that follows the Y1SS section. Two sub-blocks:
//   (a) Hourly engine summary (4 rows): Sin PV / Con PV+BESS / Ahorro
//       + a "compare vs the customer-facing number above" italic note
//   (b) Bill components breakdown (12 rows): Capacidad / Distribuci\u00f3n /
//       Transmisi\u00f3n / CENACE / Energ\u00eda B/I/P / SCnMEM+Suministro /
//       2% Baja Tension / Cargo FP / Subtotal / IVA / Facturaci\u00f3n TOTAL
//       + Provenance line + optional Warnings line
//   (c) R1 fallback (if no fullBill): energy + demand split only
//
// POSITIONING
//   Uses sh.getLastRow() + 3 so the block lands a few rows below whatever
//   was rendered last \u2014 typically Y1SS (row 42) or the footer (row 35)
//   if Y1SS was skipped. Matches legacy positioning exactly.
//
// PORTED VERBATIM from legacy 06_WriteCfeOutput.js
// _cfeOutWriteHourlySimAddendum (lines 966-1057). Field names, labels,
// colors, font sizes preserved.
// =============================================================================
function _cfeOutV2_fillHourlyAddendum(sh, hourlySim) {
  // Find an empty row near the bottom \u2014 use getLastRow()+3 as a safe gap
  var startRow = sh.getLastRow() + 3;
  if (startRow < 20) startRow = 20;

  sh.getRange(startRow, 2)
    .setValue('Hourly Simulation (BDF-5, designer reference)')
    .setFontWeight('bold').setFontSize(11).setFontColor('#1565c0');

  var ann = hourlySim.annual || {};
  var baseline = hourlySim.baseline || null;
  var savingsMxn = Number(hourlySim.savingsMxn) || 0;

  // Row +1: side-by-side cost vs baseline ----------------------------------
  // Reads as: "Hourly engine SAYS the current bill is ~$X, the proposed
  // design would bill ~$Y, saving ~$Z."
  sh.getRange(startRow + 1, 2).setValue('Sin PV (hourly):');
  sh.getRange(startRow + 1, 4).setValue(
    baseline ? Math.round(baseline.totalCostMxn) : 'n/a'
  ).setNumberFormat('"$"#,##0');

  sh.getRange(startRow + 2, 2).setValue('Con PV + BESS (hourly):');
  sh.getRange(startRow + 2, 4).setValue(Math.round(ann.totalCostMxn || 0))
    .setNumberFormat('"$"#,##0').setFontWeight('bold');

  sh.getRange(startRow + 3, 2).setValue('Ahorro anual (hourly):');
  sh.getRange(startRow + 3, 4).setValue(Math.round(savingsMxn))
    .setNumberFormat('"$"#,##0').setFontWeight('bold').setFontColor('#1b5e20');

  // Row +4: monthly engine cross-check note --------------------------------
  sh.getRange(startRow + 4, 2).setValue(
    'Comparison: see "RECIBO ANUAL CON PV + BESS" in section above. ' +
    'Disagreement > 10% means one engine has a bug \u2014 investigate.'
  ).setFontStyle('italic').setFontSize(9).setFontColor('#555555').setWrap(true);

  // Row +5: bill component breakdown (only when full-bill available) -------
  var fullBill = ann.fullBill;
  if (fullBill && fullBill.components) {
    var c = fullBill.components;
    var sum = function (arr) {
      if (!arr || !arr.length) return 0;
      var s = 0;
      for (var i = 0; i < arr.length; i++) s += (Number(arr[i]) || 0);
      return s;
    };
    var componentRow = startRow + 6;
    sh.getRange(componentRow, 2).setValue('Bill components (annual MXN, proposed):')
      .setFontWeight('bold').setFontSize(10);

    var rows = [
      ['  Capacidad',           sum(c.capacidad)],
      ['  Distribuci\u00f3n',   sum(c.distribucion)],
      ['  Transmisi\u00f3n',    sum(c.transmision)],
      ['  CENACE',              sum(c.cenace)],
      ['  Energ\u00eda B/I/P',  sum(c.energiaB) + sum(c.energiaI) + sum(c.energiaP)],
      ['  SCnMEM + Suministro', sum(c.scnmem) + sum(c.suministro)],
      ['  2% Baja Tension',     sum(c.bajaTension)],
      ['  Cargo FP',            sum(c.cargoFp)],
      ['  Subtotal',            sum(c.subtotal)],
      ['  IVA (16%)',           sum(c.iva)],
      ['  Facturaci\u00f3n TOTAL', sum(c.facturacion)]
    ];
    for (var rr = 0; rr < rows.length; rr++) {
      sh.getRange(componentRow + 1 + rr, 2).setValue(rows[rr][0]);
      sh.getRange(componentRow + 1 + rr, 4).setValue(Math.round(rows[rr][1]))
        .setNumberFormat('"$"#,##0');
    }

    // Provenance row -------------------------------------------------------
    var provLoadShape = (hourlySim.provenance && hourlySim.provenance.loadShape) || '?';
    var provWindows   = (hourlySim.provenance && hourlySim.provenance.windows)   || '?';
    var provFullBill  = fullBill.provenance || '?';
    sh.getRange(componentRow + rows.length + 2, 2).setValue(
      'Provenance: ' + provLoadShape + ' \u00b7 ' + provWindows + ' \u00b7 ' + provFullBill
    ).setFontStyle('italic').setFontSize(9).setFontColor('#555555').setWrap(true);

    // Optional warnings row ------------------------------------------------
    if (hourlySim.warnings && hourlySim.warnings.length > 0) {
      sh.getRange(componentRow + rows.length + 3, 2).setValue(
        'Warnings: ' + hourlySim.warnings.join(' | ')
      ).setFontStyle('italic').setFontSize(9).setFontColor('#cc7700').setWrap(true);
    }
  } else {
    // R1 fallback (no full bill): show the energy+demand split as before
    sh.getRange(startRow + 6, 2).setValue('  Energy cost (energy only):');
    sh.getRange(startRow + 6, 4).setValue(Math.round(ann.energyCostMxn || 0))
      .setNumberFormat('"$"#,##0');
    sh.getRange(startRow + 7, 2).setValue('  Demand charges (kW peaks):');
    sh.getRange(startRow + 7, 4).setValue(Math.round(ann.demandChargeMxn || 0))
      .setNumberFormat('"$"#,##0');
    sh.getRange(startRow + 8, 2).setValue(
      'NOTE: full CFE bill components (Distribuci\u00f3n, Transmisi\u00f3n, CENACE, ' +
      'SCnMEM, Suministro, IVA) NOT modeled \u2014 20M_CFE_TARIFFS rate data missing. ' +
      'totalCost reflects energy+demand only; not directly comparable to ' +
      'monthly engine number above.'
    ).setFontStyle('italic').setFontSize(9).setFontColor('#cc7700').setWrap(true);
  }
}


// =============================================================================
// SHARED HELPERS
// =============================================================================

/**
 * Writes 12 monthly values into a row at cols C..N with the given
 * number format hint. Used by both Section 1 and Section 2.
 *
 * @param {Sheet}  sh
 * @param {number} row     Row number (1-based)
 * @param {Array}  values  Array of 12 numeric values (or coercible)
 * @param {string} fmt     'mxn' | 'kw' | 'kwh' | other
 */
function _cfeOutV2_writeMonthlyValues(sh, row, values, fmt) {
  var safeVals = (values && values.length >= 12)
    ? values.slice(0, 12)
    : [0,0,0,0,0,0,0,0,0,0,0,0];
  var range = sh.getRange(row, 3, 1, 12);
  range.setValues([safeVals]).setFontSize(10).setHorizontalAlignment('right');
  if (fmt === 'mxn')      range.setNumberFormat('"$"#,##0');
  else if (fmt === 'kw')  range.setNumberFormat('#,##0');
  else if (fmt === 'kwh') range.setNumberFormat('#,##0');
}


/**
 * Format a number as a comma-thousands integer string (no $ sign).
 * Matches legacy _cfeOutFmt: rounds to whole MXN, displays as "1,234,567".
 */
function _cfeOutV2_fmt(n) {
  var v = Math.round(Number(n) || 0);
  return v.toLocaleString('en-US');
}
