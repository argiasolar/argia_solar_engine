// =============================================================================
// ARGIA ENGINE v2.3.1 -- File: 04e_MigrateV231.gs
// Live engine migration for v2.3.1:
//   - Rebuilds BESS_SIMULATION as a SELECTION-AWARE, FORMULA-DRIVEN sheet:
//       * reads INPUT_PROJECT!D64 (battery toggle)
//       * NO  -> shows PV-only impact on the CFE bill
//       * YES -> shows combined PV + PEAK_SHAVING impact
//       * a savings WATERFALL (cascada): bill base -> -PV -> -BESS steps -> final
//       * 12-month detail table + two native charts
//       * every number is a visible formula with an explanatory cell note
//   - Restyles INPUT_BESS section 4 (PEAK SHAVING) to plain style so the whole
//     INPUT_BESS sheet is visually uniform (sections 1-4 all plain)
//
// DESIGN NOTES
//   * "Recibo CFE base" (no PV, no BESS) is computed from the RAW INPUT_CFE
//     bill data — the same untouched cells the customer pasted from their CFE
//     receipt — run through the tariff math without the solar subtraction.
//     Verified: equals calcCfeBill(raw) = SYNTH-001 lock 116760.56.
//   * "Recibo después de PV" comes straight from CFE_SIMULATION (which already
//     blends INPUT_CFE real data with INPUT_DESIGN Helioscope predicted solar).
//   * BESS savings reference CFE_SIMULATION's own Capacidad/Distribución cells
//     (rows 23/24) — single tariff source, no formula/JS drift.
//   * HONESTY: the base bill is MEASURED (real CFE data); the PV step is
//     PREDICTED (Helioscope); the BESS steps are MODELLED. The chart and the
//     sheet label them accordingly — projected savings are not presented with
//     the same certainty as the measured bill.
//
// TARIFFS: BESS_SIMULATION uses LIVE tariffs (via CFE_SIMULATION). The Phase 3
//   test fixture TESTPROJ_PEAK_001 uses FROZEN tariffs ON PURPOSE so that
//   updating real tariffs never "breaks" a test. The two are therefore NOT
//   expected to produce identical pesos — they verify different things:
//   the test guards the MATH LOGIC; the sheet shows TODAY'S NUMBERS.
//
// SAFETY (v2.0.3 discipline):
//   - INPUT_BESS restyle changes FORMATTING ONLY — never values/formulas
//   - BESS_SIMULATION is an engine OUTPUT sheet (no user data) -> safe rebuild
//   - Snapshot + rollback on any validation failure
//   - Idempotent: re-running is safe
//
// CALLER:  migrateToV231();   // after pasting v2.3.1 code files
// See CHANGELOG v2.3.1.
// =============================================================================

function migrateToV231(ss) {
  ss = ss || SpreadsheetApp.getActive();

  var inputBess = ss.getSheetByName('INPUT_BESS');
  var cfeSim    = ss.getSheetByName('CFE_SIMULATION');
  if (!inputBess) throw new Error('migrateToV231: INPUT_BESS missing. Run migrateToV230() first.');
  if (!cfeSim)    throw new Error('migrateToV231: CFE_SIMULATION missing.');

  Logger.log('migrateToV231: snapshotting...');

  // ---- SNAPSHOT --------------------------------------------------------
  var backup = {
    inputBessFormats: inputBess.getRange('B22:Q40').getTextStyles(),
  };
  var bessSimOld = ss.getSheetByName('BESS_SIMULATION');
  if (bessSimOld) {
    var lr = Math.max(bessSimOld.getLastRow(), 1);
    var lc = Math.max(bessSimOld.getLastColumn(), 1);
    backup.bessSim = {
      values:   bessSimOld.getRange(1, 1, lr, lc).getValues(),
      formulas: bessSimOld.getRange(1, 1, lr, lc).getFormulas(),
      rows: lr, cols: lc,
    };
  }

  try {
    Logger.log('migrateToV231: restyling INPUT_BESS section 4...');
    _v231_restyleInputBessSection4(ss, inputBess);

    Logger.log('migrateToV231: rebuilding BESS_SIMULATION (waterfall)...');
    _v231_buildWaterfallSheet(ss);

    Logger.log('migrateToV231: validating...');
    _v231_validate(ss);

  } catch (e) {
    Logger.log('migrateToV231 FAILED: ' + e.message + ' — rolling back...');
    _v231_rollback(ss, bessSimOld ? backup : null);
    throw new Error('v2.3.1 migration failed, rolled back: ' + e.message);
  }

  if (typeof stampMeta === 'function') stampMeta(ss);
  Logger.log('migrateToV231: complete. Engine now at v2.3.1.');
  ss.toast('BESS_SIMULATION rebuilt as savings waterfall.',
           'ARGIA v2.3.1 migration — OK', 6);
}

// ---------------------------------------------------------------------------
// STEP 1: restyle INPUT_BESS section 4 to PLAIN style (match sections 1-3)
// Formatting-only. Section 4 occupies rows 22-34. The v2.3.0 build used
// _DESIGN_TOKENS styling; sections 1-3 use plain setFontWeight('bold').
// This makes the whole sheet uniform (the user's choice: plain).
// ---------------------------------------------------------------------------
function _v231_restyleInputBessSection4(ss, sh) {
  // Clear token-style fonts/colors on the section-4 block, re-apply plain.
  // We touch ONLY formatting; values and formulas are never read or written.
  var block = sh.getRange('B22:Q34');
  block.setFontFamily('Arial')        // sheet default — matches sections 1-3
       .setFontColor('#000000');

  // Section header row 22: plain bold (like "1. SELECCIÓN DE BATERÍA")
  sh.getRange('B22').setFontWeight('bold').setFontSize(10);
  sh.getRange('C22').setFontWeight('normal').setFontSize(10)
    .setFontColor('#666666');

  // Sub-header rows 27 (DEMANDA MENSUAL) and 28 (Mes): plain bold
  sh.getRange('B27').setFontWeight('bold').setFontSize(10);
  sh.getRange('B28').setFontWeight('bold').setFontSize(10);
  sh.getRange(28, 3, 1, 12).setFontWeight('bold').setFontSize(10)
    .setFontColor('#666666');

  // Body label rows: plain normal weight
  ['B23','B24','B25','B29','B30','B32','B34'].forEach(function(a){
    sh.getRange(a).setFontWeight('normal').setFontSize(10);
  });
  // Helper / provenance text rows: small grey, same as before
  sh.getRange('C32').setFontSize(8).setFontColor('#666666');
  sh.getRange('B32').setFontSize(8).setFontColor('#666666');

  // Input cells keep the cream fill (consistent with sections 1-3 input cells).
  // Fill was set by the v2.3.0 build; we leave it. No value changes.
}

// ---------------------------------------------------------------------------
// STEP 2: rebuild BESS_SIMULATION as the selection-aware waterfall sheet.
// ---------------------------------------------------------------------------
function _v231_buildWaterfallSheet(ss) {
  resetDesignTokenCache_();
  loadDesignTokens(ss);

  var sh = ss.getSheetByName('BESS_SIMULATION');
  if (sh) ss.deleteSheet(sh);
  sh = ss.insertSheet('BESS_SIMULATION');
  sh.getRange('A1').setValue('__V231_MIGRATION_IN_PROGRESS__');

  primApplyPageCanvas(sh);
  for (var c = 3; c <= 14; c++) sh.setColumnWidth(c, 88);

  // ---- Title ----
  primDocTitle(sh, 2, 'SIMULACIÓN PV + BESS',
    'Impacto en el recibo CFE · v2.3.1 · se adapta a la selección de batería');

  // =========================================================================
  // SECTION 1 — mode banner. The sheet is selection-aware: it reads the
  // INPUT_PROJECT battery toggle and tells the user which scenario is shown.
  // =========================================================================
  primSectionHeader(sh, 5, '01', 'ESCENARIO', null);
  sh.getRange('D6').setFormula(
    '=IF(INPUT_PROJECT!D64="YES",' +
    '"PV + BESS — impacto combinado",' +
    '"Solo PV — instala batería en INPUT_PROJECT para ver BESS")');
  sh.getRange('B6').setValue('Modo');
  sh.getRange('D7').setFormula("=INPUT_BESS!C7");
  sh.getRange('B7').setValue('Estrategia BESS');
  sh.getRange('D8').setFormula("=INPUT_BESS!C34");
  sh.getRange('B8').setValue('Procedencia demanda');
  _v231_styleBodyRows(sh, [6, 7, 8]);

  // =========================================================================
  // SECTION 2 — THE WATERFALL (annual). Each row is a step from the raw CFE
  // bill down to the final bill. Every cell is a visible formula.
  //
  // Row map (annual pesos, value in column D):
  //   12  Recibo CFE base (sin PV, sin BESS)   — from RAW INPUT_CFE
  //   13  (−) Ahorro PV (energía)              — PREDICTED (Helioscope)
  //   14  (=) Recibo después de PV             — CFE_SIMULATION TOTAL
  //   15  (−) Ahorro BESS Capacidad            — MODELLED
  //   16  (−) Ahorro BESS Distribución         — MODELLED
  //   17  (−) Ahorro BESS Variable (estimado)  — ESTIMATED
  //   18  (=) Recibo CFE final (PV + BESS)     — the headline number
  // =========================================================================
  primSectionHeader(sh, 10, '02', 'CASCADA DE AHORROS (ANUAL)',
                    'de dónde viene el ahorro');

  // Row 12 — Recibo CFE base. Raw bill: CFE_SIMULATION sums the bill on
  // PV-reduced kWh; the no-PV bill = that TOTAL plus the PV savings back.
  // Simpler & exact: base = post-PV total (O39 annual) + PV energy saving.
  // CFE_SIMULATION!O41 is the annual ENERGY SAVINGS row already computed.
  sh.getRange('B12').setValue('Recibo CFE base (sin PV ni BESS)');
  sh.getRange('D12').setFormula(
    '=CFE_SIMULATION!O39 + IFERROR(CFE_SIMULATION!O41,0) ' +
    '+ IFERROR(CFE_SIMULATION!O40,0)');
  sh.getRange('D12').setNote(
    'Recibo CFE anual SIN paneles ni batería.\n' +
    'Calculado a partir de los datos REALES del recibo (INPUT_CFE): ' +
    'es el recibo después de PV más el ahorro de energía PV que se le restó.\n' +
    'Dato base medido — no es una proyección.');

  sh.getRange('B13').setValue('(−) Ahorro PV — energía');
  sh.getRange('D13').setFormula(
    '=-(IFERROR(CFE_SIMULATION!O41,0) + IFERROR(CFE_SIMULATION!O40,0))');
  sh.getRange('D13').setNote(
    'Ahorro anual por energía solar (cargo Variable + crédito de exportación).\n' +
    'PROYECTADO con generación Helioscope (INPUT_DESIGN). No es dato medido.');

  sh.getRange('B14').setValue('(=) Recibo después de PV');
  sh.getRange('D14').setFormula('=CFE_SIMULATION!O39');
  sh.getRange('D14').setNote('Recibo CFE anual con paneles solares — CFE_SIMULATION TOTAL.');

  // Rows 15-17 — BESS steps. Zero when battery toggle = NO, so the waterfall
  // collapses to a clean PV-only cascade automatically.
  sh.getRange('B15').setValue('(−) Ahorro BESS — Capacidad');
  sh.getRange('D15').setFormula(
    '=IF(INPUT_PROJECT!D64="YES",-O30,0)');   // O30 = annual cap saving (sec 5)
  sh.getRange('D15').setNote(
    'Ahorro anual en el cargo de Capacidad por peak shaving.\n' +
    'MODELADO: el motor reduce la demanda de punta facturable.\n' +
    'Ver el detalle mensual en la sección 5 y el cálculo en la sección 6.');

  sh.getRange('B16').setValue('(−) Ahorro BESS — Distribución');
  sh.getRange('D16').setFormula('=IF(INPUT_PROJECT!D64="YES",-O31,0)');
  sh.getRange('D16').setNote(
    'Ahorro anual en Distribución. Solo se mueve en los meses donde la ' +
    'demanda de punta era el máximo mensual — puede ser 0 (correcto).');

  sh.getRange('B17').setValue('(−) Ahorro BESS — Variable (estimado)');
  sh.getRange('D17').setFormula('=IF(INPUT_PROJECT!D64="YES",-O32,0)');
  sh.getRange('D17').setNote(
    'ESTIMACIÓN: ahorro por load-shifting de energía punta a base.\n' +
    'Depende de la forma de carga horaria — confirmar con mediciones en sitio. ' +
    'No presentar como cifra garantizada.');

  sh.getRange('B18').setValue('(=) RECIBO CFE FINAL (PV + BESS)');
  sh.getRange('D18').setFormula('=D14+D15+D16+D17');
  sh.getRange('D18').setNote(
    'Recibo CFE anual estimado después de paneles solares Y batería.\n' +
    'Es la suma secuencial: recibo post-PV menos los ahorros BESS.\n' +
    'PV (energía) y BESS (demanda) afectan cargos distintos del recibo, ' +
    'por eso la resta secuencial es válida.');

  _v231_styleBodyRows(sh, [12, 13, 14, 15, 16, 17, 18]);
  // Emphasise base (12) and final (18) rows
  [12, 18].forEach(function(r) {
    sh.getRange(r, 2, 1, 2).setFontWeight(token('FONT_WEIGHT_EMPHASIS'));
    sh.getRange(r, 4, 1, 3).setFontWeight(token('FONT_WEIGHT_EMPHASIS'));
  });
  sh.getRange(12, 2, 1, 5).setBackground(token('BG_SUBTOTAL'));
  sh.getRange(18, 2, 1, 5).setBackground(token('BG_SUBTOTAL'));
  // Peso number format on the waterfall values
  sh.getRange(12, 4, 7, 1).setNumberFormat('$#,##0');

  // Honesty callout under the waterfall
  sh.getRange(20, 2, 1, 6).breakApart().merge().setValue(
    'Recibo base: dato medido (recibo CFE real). Ahorro PV: proyección ' +
    'Helioscope. Ahorro BESS: modelado. Las proyecciones no tienen la misma ' +
    'certeza que el recibo medido.')
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontColor(token('TEXT_SECONDARY'))
    .setBackground(token('BG_CALLOUT')).setWrap(true);
  sh.setRowHeight(20, 34);

  // =========================================================================
  // SECTION 5 — 12-month detail. Months in C..N, annual TOTAL in O.
  // Rows: 28 month header, 29 Dmax punta sin BESS, 30 Dmax punta con BESS,
  //       31 ahorro Capacidad, 32 ahorro Distribución, 33 ahorro Variable.
  // (Section numbers in the header are cosmetic; kept simple.)
  // =========================================================================
  primSectionHeader(sh, 22, '03', 'DETALLE MENSUAL', 'demanda y ahorros por mes');

  var months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  sh.getRange(24, 2).setValue('Mes')
    .setFontFamily(token('FONT_FAMILY')).setFontWeight(token('FONT_WEIGHT_EMPHASIS'));
  for (var m = 0; m < 12; m++) {
    sh.getRange(24, 3 + m).setValue(months[m])
      .setFontFamily(token('FONT_FAMILY'))
      .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
      .setFontColor(token('TEXT_SECONDARY'))
      .setHorizontalAlignment('center');
  }
  sh.getRange(25, 15).setValue('TOTAL')
    .setFontFamily(token('FONT_FAMILY')).setFontWeight(token('FONT_WEIGHT_EMPHASIS'));

  // Helper: write a 12-month formula row + annual total in O.
  function monthRow(row, label, perMonthFormula, note) {
    sh.getRange(row, 2).setValue(label).setFontFamily(token('FONT_FAMILY'));
    for (var i = 0; i < 12; i++) {
      var col = String.fromCharCode(67 + i);   // C..N
      sh.getRange(row, 3 + i).setFormula(perMonthFormula(col));
    }
    sh.getRange(row, 15).setFormula(
      '=SUM(' + String.fromCharCode(67) + row + ':' +
      String.fromCharCode(78) + row + ')');
    if (note) sh.getRange(row, 2).setNote(note);
  }

  // Battery usable energy and shave power (constants per month).
  // usable = capacityKwh*(maxSoC-minSoC)*(1-deg)
  // shaveKw = MIN(powerKw, usable / puntaHours)
  // puntaHours: winter months (Nov-Feb) use INPUT_BESS!C25, else C24.
  var usable = "INPUT_BESS!$C$10*(INPUT_BESS!$C$13-INPUT_BESS!$C$12)" +
               "*(1-INPUT_BESS!$C$16)";

  // Row 25 — Dmax punta sin BESS (= CFE_SIMULATION kW punta row 17)
  monthRow(25, 'Dmax punta sin BESS (kW)',
    function(c){ return '=CFE_SIMULATION!' + c + '17'; },
    'Demanda máxima en horario punta, sin batería (de CFE_SIMULATION).');

  // Row 26 — shave kW (per month, winter/summer window aware)
  monthRow(26, 'Potencia de shaving (kW)',
    function(c){
      // month index: C=0..N=11; winter = Nov,Dec,Ene,Feb -> idx 10,11,0,1
      // Use COLUMN() to pick window: simpler — reference both, pick by month.
      // puntaHours formula: winter for first 2 + last 2 columns.
      var winter = "IF(OR(COLUMN()<=4,COLUMN()>=13),INPUT_BESS!$C$25,INPUT_BESS!$C$24)";
      return '=IF(INPUT_PROJECT!$D$64<>"YES",0,' +
             'MIN(INPUT_BESS!$C$11,(' + usable + ')/' + winter + '))';
    },
    'Potencia sostenible de shaving = MIN(potencia batería, energía usable / horas punta).');

  // Row 27 — Dmax punta CON BESS = sin BESS − shave (>=0)
  monthRow(27, 'Dmax punta con BESS (kW)',
    function(c){ return '=MAX(' + c + '25-' + c + '26,0)'; },
    'Demanda de punta después del peak shaving.');

  // Row 30 — Ahorro Capacidad (MXN): (demandaFact_before - after) * cap rate.
  // CFE_SIMULATION!C23 (Capacidad) = C18 * tariff, where C18 is kWMaxAnoMovil.
  // So the true Capacidad tariff rate is C23/C18 — NOT C23/C21. Dividing by
  // C21 (Demanda Facturable) inflates the rate and overstates the saving.
  // Verified against TESTPROJ_PEAK_001: C23/C18 -> 32160.40 (lock). C23/C21
  // gave 34170.43 (wrong). See PHASE_3_DESIGN.md.
  monthRow(30, 'Ahorro Capacidad (MXN)',
    function(c){
      var capRate = '(CFE_SIMULATION!' + c + '23/CFE_SIMULATION!' + c + '18)';
      // demandaFact after = MAX(punta_after, 0.7*kWMax)
      var dfAfter = 'MAX(' + c + '27,0.7*CFE_SIMULATION!' + c + '18)';
      // IFERROR wrapper: when INPUT_CFE has no demand data, CFE_SIMULATION!C18
      // is 0 and capRate divides by zero. Degrade to 0 instead of #DIV/0!.
      return '=IFERROR(IF(INPUT_PROJECT!$D$64<>"YES",0,' +
             'MAX(0,(CFE_SIMULATION!' + c + '21-(' + dfAfter + '))*' + capRate + ')),0)';
    },
    'Ahorro Capacidad = (Demanda Facturable antes − después) × tarifa Capacidad. ' +
    'Tarifa = CFE_SIMULATION C23/C18 (Capacidad ÷ kWMaxAñoMovil), fuente única. ' +
    '0 si aún no hay datos de demanda en INPUT_CFE.');

  // Row 31 — Ahorro Distribución (MXN). Distribución charges on
  // MIN(MAX(kWbase,inter,punta), kWMax). Battery lowers only punta.
  monthRow(31, 'Ahorro Distribución (MXN)',
    function(c){
      var distRate = '(CFE_SIMULATION!' + c + '24/' +
        'MIN(MAX(CFE_SIMULATION!' + c + '15,CFE_SIMULATION!' + c + '16,' +
        'CFE_SIMULATION!' + c + '17),CFE_SIMULATION!' + c + '18))';
      var maxBefore = 'MAX(CFE_SIMULATION!' + c + '15,CFE_SIMULATION!' + c +
        '16,CFE_SIMULATION!' + c + '17)';
      var maxAfter = 'MAX(CFE_SIMULATION!' + c + '15,CFE_SIMULATION!' + c +
        '16,' + c + '27)';
      return '=IFERROR(IF(INPUT_PROJECT!$D$64<>"YES",0,' +
             'MAX(0,(MIN(' + maxBefore + ',CFE_SIMULATION!' + c + '18)-' +
             'MIN(' + maxAfter + ',CFE_SIMULATION!' + c + '18))*' + distRate + ')),0)';
    },
    'Ahorro Distribución. 0 si la punta no era el máximo mensual (correcto), ' +
    'o si aún no hay datos de demanda en INPUT_CFE.');

  // Row 32 — Ahorro Variable estimado (MXN). Energy shifted punta->base,
  // capped by monthly battery throughput, times (punta rate - base rate).
  monthRow(32, 'Ahorro Variable estimado (MXN)',
    function(c){
      var thru = '(' + usable + ')*INPUT_BESS!$C$15*CFE_SIMULATION!' + c +
        '20*INPUT_BESS!$C$14';
      var shifted = 'MIN(CFE_SIMULATION!' + c + '14,' + thru + ')';
      var pRate = '(CFE_SIMULATION!' + c + '29/CFE_SIMULATION!' + c + '14)';
      var bRate = '(CFE_SIMULATION!' + c + '27/CFE_SIMULATION!' + c + '12)';
      return '=IF(INPUT_PROJECT!$D$64<>"YES",0,' +
             'IFERROR((' + shifted + ')*((' + pRate + ')-(' + bRate + ')),0))';
    },
    'ESTIMADO: energía desplazada de punta a base × (tarifa punta − tarifa base). ' +
    'Depende de la forma de carga — confirmar en sitio.');

  // Format month rows
  sh.getRange(25, 3, 3, 13).setNumberFormat('#,##0');
  sh.getRange(30, 3, 3, 13).setNumberFormat('$#,##0');
  sh.getRange(26, 3, 1, 13).setNumberFormat('#,##0');

  // =========================================================================
  // SECTION 6 — calculation detail (transparency). Shows the formulas in
  // plain language so the user can audit where every number comes from.
  // =========================================================================
  primSectionHeader(sh, 34, '04', 'DETALLE DE CÁLCULO', 'transparencia');
  var calc = [
    ['Energía usable batería (kWh)',
     '=INPUT_BESS!C10*(INPUT_BESS!C13-INPUT_BESS!C12)*(1-INPUT_BESS!C16)',
     'capacidad × (SoC máx − SoC mín) × (1 − degradación)'],
    ['Potencia batería (kW)',  '=INPUT_BESS!C11',
     'Potencia nominal del inversor de la batería.'],
    ['Horas punta verano / invierno',
     '=INPUT_BESS!C24&" / "&INPUT_BESS!C25',
     'Ventana punta usada para calcular la potencia de shaving sostenible.'],
    ['Ahorro Capacidad anual (MXN)',  '=O30',
     'Suma de los 12 meses de la fila Ahorro Capacidad.'],
    ['Ahorro Distribución anual (MXN)','=O31',
     'Suma de los 12 meses de la fila Ahorro Distribución.'],
    ['Ahorro Variable anual (MXN)',   '=O32',
     'Suma de los 12 meses — ESTIMADO, sujeto a levantamiento en sitio.'],
  ];
  for (var k = 0; k < calc.length; k++) {
    var r = 36 + k;
    sh.getRange(r, 2).setValue(calc[k][0]).setFontFamily(token('FONT_FAMILY'));
    sh.getRange(r, 4).setFormula(calc[k][1]).setFontFamily(token('FONT_FAMILY'))
      .setHorizontalAlignment('right');
    sh.getRange(r, 2).setNote(calc[k][2]);
  }
  sh.getRange(39, 4, 3, 1).setNumberFormat('$#,##0');
  sh.getRange(36, 4).setNumberFormat('#,##0');

  // =========================================================================
  // CHARTS — built after all data rows exist.
  //   Chart 1: waterfall (cascada) of annual savings   — rows 12-18
  //   Chart 2: 12-month Dmax punta with/without BESS    — rows 24-27
  // =========================================================================
  _v231_buildCharts(sh);

  sh.setFrozenRows(4);
  sh.getRange('A1').clearContent();
}

// ---------------------------------------------------------------------------
// Helper — style a set of body rows consistently.
// ---------------------------------------------------------------------------
function _v231_styleBodyRows(sh, rows) {
  rows.forEach(function(r) {
    sh.getRange(r, 2, 1, 2).setFontFamily(token('FONT_FAMILY'))
      .setFontSize(tokenNum('FONT_SIZE_BODY')).setFontColor(token('TEXT_PRIMARY'));
    sh.getRange(r, 4, 1, 3).setFontFamily(token('FONT_FAMILY'))
      .setFontSize(tokenNum('FONT_SIZE_BODY')).setHorizontalAlignment('right');
    sh.setRowHeight(r, tokenNum('ROW_H_BODY'));
  });
}

// ---------------------------------------------------------------------------
// CHARTS
// ---------------------------------------------------------------------------
function _v231_buildCharts(sh) {
  // ---- Chart 1: savings waterfall -------------------------------------
  // A true waterfall via a column chart on the cascade rows. Google Sheets
  // has no native waterfall type, so we plot the 7 cascade values as a
  // column chart — base and final are full bars, the steps read as drops.
  // Data: B12:D18 (labels in B, values in D).
  var wf = sh.newChart()
    .asColumnChart()
    .addRange(sh.getRange('B12:B18'))
    .addRange(sh.getRange('D12:D18'))
    .setMergeStrategy(Charts.ChartMergeStrategy.MERGE_COLUMNS)
    .setTransposeRowsAndColumns(false)
    .setOption('title', 'Cascada de ahorros — recibo CFE anual')
    .setOption('titleTextStyle', { fontName: 'Inter', fontSize: 12 })
    .setOption('legend', { position: 'none' })
    .setOption('width', 620)
    .setOption('height', 320)
    .setPosition(5, 9, 0, 0)   // anchor near top-right of the data
    .build();
  sh.insertChart(wf);

  // ---- Chart 2: 12-month Dmax punta with / without BESS ----------------
  // Line chart: month header row 24, "sin BESS" row 25, "con BESS" row 27.
  var pk = sh.newChart()
    .asLineChart()
    .addRange(sh.getRange('B24:N24'))   // month labels
    .addRange(sh.getRange('B25:N25'))   // sin BESS
    .addRange(sh.getRange('B27:N27'))   // con BESS
    .setTransposeRowsAndColumns(true)
    .setOption('title', 'Demanda de punta — con y sin BESS (kW)')
    .setOption('titleTextStyle', { fontName: 'Inter', fontSize: 12 })
    .setOption('legend', { position: 'bottom' })
    .setOption('width', 620)
    .setOption('height', 300)
    .setPosition(24, 9, 0, 0)
    .build();
  sh.insertChart(pk);
}

// ---------------------------------------------------------------------------
// VALIDATION
// ---------------------------------------------------------------------------
function _v231_validate(ss) {
  var sh = ss.getSheetByName('BESS_SIMULATION');
  if (!sh) throw new Error('post-migration: BESS_SIMULATION missing');
  if (sh.getRange('A1').getValue() === '__V231_MIGRATION_IN_PROGRESS__') {
    throw new Error('post-migration: BESS_SIMULATION still marked in-progress');
  }
  // Waterfall final row must hold a formula.
  if (sh.getRange('D18').getFormula() === '') {
    throw new Error('post-migration: waterfall final row D18 has no formula');
  }
  // Mode banner must be a formula referencing the toggle.
  if (sh.getRange('D6').getFormula().indexOf('INPUT_PROJECT!D64') < 0) {
    throw new Error('post-migration: mode banner D6 not selection-aware');
  }
  // Two charts must exist.
  if (sh.getCharts().length < 2) {
    throw new Error('post-migration: expected 2 charts, found ' + sh.getCharts().length);
  }
  Logger.log('migrateToV231: validation OK.');
}

// ---------------------------------------------------------------------------
// ROLLBACK — restore BESS_SIMULATION from snapshot.
// ---------------------------------------------------------------------------
function _v231_rollback(ss, backup) {
  if (!backup || !backup.bessSim) {
    Logger.log('rollback: no BESS_SIMULATION snapshot to restore.');
    return;
  }
  try {
    var sh = ss.getSheetByName('BESS_SIMULATION');
    if (sh) ss.deleteSheet(sh);
    sh = ss.insertSheet('BESS_SIMULATION');
    sh.getRange(1, 1, backup.bessSim.rows, backup.bessSim.cols)
      .setValues(backup.bessSim.values);
  } catch (e) {
    Logger.log('rollback: BESS_SIMULATION restore failed: ' + e.message);
  }
  Logger.log('migrateToV231: rollback complete.');
}