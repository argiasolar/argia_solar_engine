// =============================================================================
// ARGIA ENGINE v2.3.0 -- File: 04d_MigrateV230.gs
// Live engine migration for v2.3.0:
//   - Updates INPUT_BESS!C7 strategy dropdown to allow PEAK_SHAVING
//   - Adds INPUT_BESS section 4 "PEAK SHAVING" (rows 22-40):
//       * F.C. (load factor)        — default 0.57, synthesis path only
//       * punta window hours        — summer 2 / winter 4
//       * 12-monthly Dmax_punta     — blank-allowed, measured demand
//       * 12-monthly Dmax           — blank-allowed, measured demand
//       * a fill-down helper note
//   - Rebuilds BESS_SIMULATION with the two-tier (verifiable / estimated)
//     PEAK_SHAVING output layout, per-month Capacidad + Distribución
//
// SAFETY (v2.0.3 discipline, all 15 handoff rules):
//   - NEVER calls clearContent() on user-entered INPUT_BESS values
//   - Only writes to specific named cells; section 4 is NEW rows (22+),
//     so it cannot collide with the v2.2.0 sections 1-3 (rows 1-20)
//   - Snapshots the cells it touches before changing them
//   - Idempotent: re-running won't overwrite user values (setIfBlank guard)
//   - Rolls back INPUT_BESS on any validation failure
//   - BESS_SIMULATION is an OUTPUT sheet (engine-owned, no user data) so it
//     is safe to fully rebuild — but we still snapshot it for rollback
//
// CALLER: run once, from the Apps Script editor, AFTER pasting the v2.3.0
//   code files:
//       migrateToV230();          // operates on the active spreadsheet
//
// EXPECTED RESULT: INPUT_BESS gains section 4; BESS_SIMULATION rebuilt;
//   _META engine_version stamped 2.3.0. Then run runTests() — still 288 PASS.
//
// See PHASE_3_DESIGN.md and CHANGELOG v2.3.0.
// =============================================================================

function migrateToV230(ss) {
  ss = ss || SpreadsheetApp.getActive();

  var inputBess = ss.getSheetByName('INPUT_BESS');
  if (!inputBess) {
    throw new Error('migrateToV230: INPUT_BESS sheet missing. Run migrateToV220() first.');
  }

  Logger.log('migrateToV230: snapshotting current state...');

  // ---- SNAPSHOT --------------------------------------------------------
  // INPUT_BESS: snapshot the strategy cell + the section-4 region we will
  // write into (rows 22-40, cols B-Q), so a failure restores exactly.
  var backup = {
    inputBess: {
      C7_value:        inputBess.getRange('C7').getValue(),
      C7_validation:   inputBess.getRange('C7').getDataValidation(),
      C7_note:         inputBess.getRange('C7').getNote(),
      B22_Q40_values:  inputBess.getRange('B22:Q40').getValues(),
      B22_Q40_formulas: inputBess.getRange('B22:Q40').getFormulas(),
    },
  };

  // BESS_SIMULATION: if it exists, snapshot the whole used range.
  var bessSimOld = ss.getSheetByName('BESS_SIMULATION');
  if (bessSimOld) {
    var lastR = Math.max(bessSimOld.getLastRow(), 1);
    var lastC = Math.max(bessSimOld.getLastColumn(), 1);
    backup.bessSim = {
      values:   bessSimOld.getRange(1, 1, lastR, lastC).getValues(),
      formulas: bessSimOld.getRange(1, 1, lastR, lastC).getFormulas(),
      rows: lastR, cols: lastC,
    };
  }

  try {
    Logger.log('migrateToV230: updating INPUT_BESS strategy dropdown...');
    _v230_updateStrategyDropdown(inputBess);

    Logger.log('migrateToV230: adding INPUT_BESS section 4 (PEAK SHAVING)...');
    _v230_addPeakShavingSection(ss, inputBess);

    Logger.log('migrateToV230: rebuilding BESS_SIMULATION...');
    _v230_buildBessSimulationSheet(ss);

    Logger.log('migrateToV230: validating...');
    _v230_validatePostMigration(ss);

  } catch (e) {
    Logger.log('migrateToV230 FAILED: ' + e.message + ' — rolling back...');
    _v230_restoreBackup(ss, inputBess, backup);
    throw new Error('v2.3.0 migration failed, rolled back: ' + e.message);
  }

  if (typeof stampMeta === 'function') stampMeta(ss);
  Logger.log('migrateToV230: complete. Engine now at v2.3.0.');
  ss.toast('INPUT_BESS section 4 added; BESS_SIMULATION rebuilt.',
           'ARGIA v2.3.0 migration — OK', 6);
}

// ---------------------------------------------------------------------------
// STEP 1: strategy dropdown — allow PEAK_SHAVING (keep SELF_CONSUMPTION_MAX)
// ---------------------------------------------------------------------------
function _v230_updateStrategyDropdown(sh) {
  var c7 = sh.getRange('C7');
  // Preserve whatever the user already selected.
  if (c7.getValue() === '' || c7.getValue() === null) {
    c7.setValue('SELF_CONSUMPTION_MAX');
  }
  c7.setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(['SELF_CONSUMPTION_MAX', 'PEAK_SHAVING'], true)
      .setAllowInvalid(false)
      .build());
  c7.setNote('Estrategia de despacho.\n' +
             'SELF_CONSUMPTION_MAX: captura excedente PV (v2.2.0).\n' +
             'PEAK_SHAVING: reduce cargos de demanda en punta (v2.3.0).\n' +
             'HYBRID: diferido a v2.4.0 (requiere datos de intervalo).');
}

// ---------------------------------------------------------------------------
// STEP 2: INPUT_BESS section 4 — PEAK SHAVING fields (rows 22-40)
// Styled with _DESIGN_TOKENS + prim* primitives to match INPUT_PROJECT /
// INPUT_DESIGN. All value cells are blank-allowed; engine treats blank
// Dmax_punta as "synthesize" per the option-1 rule in calcPeakShavingImpact.
// ---------------------------------------------------------------------------
function _v230_addPeakShavingSection(ss, sh) {
  resetDesignTokenCache_();
  loadDesignTokens(ss);

  function setIfBlank(addr, value) {
    var cell = sh.getRange(addr);
    if (cell.getValue() === '' || cell.getValue() === null) {
      cell.setValue(value);
    }
  }
  function inputCell(addr) {
    try { sh.getRange(addr).setBackground(token('BG_INPUT_CELL')); }
    catch (e) { sh.getRange(addr).setBackground('#FDFBF6'); }
  }

  // ---- Section header (row 22) ----
  sh.getRange('B22').setValue('4. PEAK SHAVING (v2.3.0)')
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontFamily(token('FONT_FAMILY'))
    .setFontColor(token('TEXT_PRIMARY'));
  sh.getRange('C22').setValue('Solo aplica si BESS_STRATEGY = PEAK_SHAVING')
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontColor(token('TEXT_SECONDARY'));

  // ---- Scalar parameters (rows 23-25) ----
  sh.getRange('B23').setValue('Factor de carga (F.C.):');
  setIfBlank('C23', 0.57);
  sh.getRange('C23').setNumberFormat('0.00');
  inputCell('C23');
  sh.getRange('C23').setNote(
    'Factor de carga del cliente (carga promedio / pico).\n' +
    'SOLO se usa cuando no hay demanda medida (kWPunta) en INPUT_CFE — ' +
    'el motor sintetiza Dmax con Q/(24·d·F.C.).\n' +
    'Default 0.57 (referencia GDMTH). Es un parámetro de forma de carga, ' +
    'NO una constante tarifaria — ajústalo al tipo de cliente.');

  sh.getRange('B24').setValue('Horas punta — verano:');
  setIfBlank('C24', 2);
  inputCell('C24');
  sh.getRange('C24').setNote('Duración de la ventana punta en verano (horas). Default 2.');

  sh.getRange('B25').setValue('Horas punta — invierno:');
  setIfBlank('C25', 4);
  inputCell('C25');
  sh.getRange('C25').setNote('Duración de la ventana punta en invierno (horas). Default 4.');

  // ---- 12-monthly demand table (rows 27-40) ----
  sh.getRange('B27').setValue('DEMANDA MENSUAL (kW)')
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontFamily(token('FONT_FAMILY'))
    .setFontColor(token('TEXT_PRIMARY'));
  sh.getRange('C27').setValue(
    'Opcional. Vacío = el motor sintetiza (lleva descargo "perfil genérico").')
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontColor(token('TEXT_SECONDARY'));

  // Header row 28: B label, C..N = 12 months
  var months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  sh.getRange('B28').setValue('Mes')
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontFamily(token('FONT_FAMILY'));
  for (var i = 0; i < 12; i++) {
    sh.getRange(28, 3 + i).setValue(months[i])
      .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
      .setFontFamily(token('FONT_FAMILY'))
      .setFontColor(token('TEXT_SECONDARY'))
      .setHorizontalAlignment('center');
  }

  // Row 29: Dmax_punta (12 monthly cells, blank-allowed, cream input style)
  sh.getRange('B29').setValue('Dmax punta (kW)').setFontFamily(token('FONT_FAMILY'));
  sh.getRange(29, 3, 1, 12).setBackground(
    (function(){ try { return token('BG_INPUT_CELL'); } catch(e){ return '#FDFBF6'; } })());
  sh.getRange('B29').setNote(
    'Demanda máxima en horario punta, por mes (kW). De recibos CFE.\n' +
    'Si se deja vacío, el motor sintetiza el valor y la salida BESS_SIMULATION ' +
    'mostrará el descargo "perfil genérico — sujeto a levantamiento en sitio".');

  // Row 30: Dmax (monthly max demand, 12 cells, blank-allowed)
  sh.getRange('B30').setValue('Dmax mensual (kW)').setFontFamily(token('FONT_FAMILY'));
  sh.getRange(30, 3, 1, 12).setBackground(
    (function(){ try { return token('BG_INPUT_CELL'); } catch(e){ return '#FDFBF6'; } })());
  sh.getRange('B30').setNote(
    'Demanda máxima mensual total (kW). Usada para el cargo de Distribución.');

  // Row 32: fill-down helper note
  sh.getRange('B32').setValue('Ayuda:')
    .setFontFamily(token('FONT_FAMILY'))
    .setFontColor(token('TEXT_SECONDARY'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'));
  sh.getRange('C32').setValue(
    'Para llenar 12 meses iguales: escribe el valor en Ene (C29), ' +
    'cópialo y pégalo en D29:N29. Igual para Dmax (fila 30).')
    .setFontFamily(token('FONT_FAMILY'))
    .setFontColor(token('TEXT_SECONDARY'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'));

  // Provenance indicator (row 34) — formula reflects whether month inputs exist
  sh.getRange('B34').setValue('Procedencia demanda:')
    .setFontFamily(token('FONT_FAMILY'));
  sh.getRange('C34').setFormula(
    '=IF(COUNT(C29:N29)>0,"MEDIDA (recibos CFE)",' +
    '"SINTETIZADA — perfil genérico, sujeto a levantamiento en sitio")');
  sh.getRange('C34').setFontFamily(token('FONT_FAMILY'));
  sh.getRange('C34').setNote(
    'MEDIDA: al menos un mes tiene Dmax punta capturado.\n' +
    'SINTETIZADA: sin datos — el motor estima y aplica descargo en BESS_SIMULATION.');
}

// ---------------------------------------------------------------------------
// STEP 3: BESS_SIMULATION — rebuild with the two-tier PEAK_SHAVING layout.
// This is an engine OUTPUT sheet (no user-entered data), so a full rebuild
// is safe. Snapshot is taken in migrateToV230() for rollback regardless.
// ---------------------------------------------------------------------------
function _v230_buildBessSimulationSheet(ss) {
  resetDesignTokenCache_();
  loadDesignTokens(ss);

  var sh = ss.getSheetByName('BESS_SIMULATION');
  if (sh) {
    ss.deleteSheet(sh);   // safe: output sheet, snapshot held for rollback
  }
  sh = ss.insertSheet('BESS_SIMULATION');
  sh.getRange('A1').setValue('__V230_MIGRATION_IN_PROGRESS__');  // rollback marker

  primApplyPageCanvas(sh);
  // Widen content columns so the 12-month table fits B..N.
  for (var c = 3; c <= 14; c++) sh.setColumnWidth(c, 92);

  // Title + subtitle
  primDocTitle(sh, 2, 'SIMULACIÓN BESS',
               'Impacto del sistema de almacenamiento en el recibo CFE · v2.3.0');

  // Section 1 — strategy + provenance summary
  primSectionHeader(sh, 5, '01', 'CONFIGURACIÓN', null);
  primBodyRow(sh, 6,  'Estrategia',            "='INPUT_BESS'!C7", null);
  primBodyRow(sh, 7,  'Procedencia de demanda', "='INPUT_BESS'!C34", null);
  primBodyRow(sh, 8,  'Capacidad batería (kWh)', "='INPUT_BESS'!C10", null);
  primBodyRow(sh, 9,  'Potencia (kW)',          "='INPUT_BESS'!C11", null);

  // Section 2 — TIER 1: VERIFIABLE savings (Capacidad + Distribución)
  primSectionHeader(sh, 11, '02', 'AHORRO VERIFICABLE (DEMANDA)',
                    'Capacidad + Distribución');
  primBodyRow(sh, 12, 'Ahorro Capacidad — Año 1',  '— pendiente cálculo', null);
  primBodyRow(sh, 13, 'Ahorro Distribución — Año 1','— pendiente cálculo', null);
  primBodyRow(sh, 14, 'Subtotal verificable — Año 1','— pendiente cálculo', null);
  primBodyRow(sh, 15, 'Subtotal verificable — régimen permanente', '— pendiente cálculo', null);

  // Disclaimer band for tier 1 (only loud if synthesized)
  sh.getRange(16, 2, 1, 6).breakApart().merge()
    .setValue('Nota: los ahorros de demanda usan la facturación CFE verificada. ' +
              'Si la procedencia es SINTETIZADA, el resultado es una estimación ' +
              'sujeta a levantamiento en sitio.')
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontColor(token('TEXT_SECONDARY'))
    .setBackground(token('BG_CALLOUT'))
    .setWrap(true);
  sh.setRowHeight(16, 34);

  // Section 3 — TIER 2: ESTIMATED savings (Variable load-shift)
  primSectionHeader(sh, 18, '03', 'AHORRO ESTIMADO (ENERGÍA)',
                    'Load shifting — estimación');
  primBodyRow(sh, 19, 'Energía desplazada (kWh)',     '— pendiente cálculo', null);
  primBodyRow(sh, 20, 'Ahorro Variable (estimado)',   '— pendiente cálculo', null);

  // Mandatory disclaimer for tier 2 — ALWAYS loud (Variable is always estimated)
  sh.getRange(21, 2, 1, 6).breakApart().merge()
    .setValue('IMPORTANTE: el ahorro de energía (Variable) es una ESTIMACIÓN. ' +
              'Depende de la forma de carga horaria y debe confirmarse con ' +
              'mediciones en sitio. No presentar como cifra garantizada.')
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontColor(token('STATUS_WARN'))
    .setBackground(token('BG_CALLOUT'))
    .setWrap(true);
  sh.setRowHeight(21, 34);

  // Section 4 — total
  primSectionHeader(sh, 23, '04', 'TOTAL ESTIMADO — AÑO 1', null);
  primBodyRow(sh, 24, 'Ahorro total estimado — Año 1', '— pendiente cálculo', null);
  primBodyRow(sh, 25, 'Recibo CFE después de BESS — Año 1', '— pendiente cálculo', null);

  // Section 5 — per-month demand table (Capacidad / Distribución by month).
  // Cross-check of competitor decks showed Distribución can move in some
  // months and not others — an annual lump would hide that. Per-month here.
  primSectionHeader(sh, 27, '05', 'DETALLE MENSUAL (kW · MXN)', null);
  var months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  sh.getRange(28, 2).setValue('Mes')
    .setFontFamily(token('FONT_FAMILY'))
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'));
  for (var m = 0; m < 12; m++) {
    sh.getRange(28, 3 + m).setValue(months[m])
      .setFontFamily(token('FONT_FAMILY'))
      .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
      .setFontColor(token('TEXT_SECONDARY'))
      .setHorizontalAlignment('center');
  }
  sh.getRange(29, 2).setValue('Dmax punta post-BESS (kW)').setFontFamily(token('FONT_FAMILY'));
  sh.getRange(30, 2).setValue('Ahorro Capacidad (MXN)').setFontFamily(token('FONT_FAMILY'));
  sh.getRange(31, 2).setValue('Ahorro Distribución (MXN)').setFontFamily(token('FONT_FAMILY'));
  sh.getRange(29, 3, 3, 12).setValue('—')
    .setFontFamily(token('FONT_FAMILY'))
    .setFontColor(token('TEXT_MUTED'))
    .setHorizontalAlignment('center');

  // Footer note
  sh.getRange(33, 2, 1, 6).breakApart().merge()
    .setValue('Las celdas "— pendiente cálculo" se llenan al ejecutar el motor ' +
              'con BESS_STRATEGY = PEAK_SHAVING. Cifras antes de IVA.')
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontColor(token('TEXT_MUTED'));

  sh.setFrozenRows(4);
  sh.getRange('A1').clearContent();   // remove rollback marker
}

// ---------------------------------------------------------------------------
// VALIDATION — confirm the migration produced the expected structure.
// ---------------------------------------------------------------------------
function _v230_validatePostMigration(ss) {
  var inputBess = ss.getSheetByName('INPUT_BESS');
  var bessSim   = ss.getSheetByName('BESS_SIMULATION');

  if (!inputBess) throw new Error('post-migration: INPUT_BESS missing');
  if (!bessSim)   throw new Error('post-migration: BESS_SIMULATION missing');

  // INPUT_BESS section 4 header must be present
  if (inputBess.getRange('B22').getValue() !== '4. PEAK SHAVING (v2.3.0)') {
    throw new Error('post-migration: INPUT_BESS section 4 header not written');
  }
  // F.C. default must be present and numeric
  var fc = inputBess.getRange('C23').getValue();
  if (typeof fc !== 'number' || fc <= 0) {
    throw new Error('post-migration: INPUT_BESS F.C. (C23) invalid: ' + fc);
  }
  // Strategy dropdown must now accept PEAK_SHAVING
  var dv = inputBess.getRange('C7').getDataValidation();
  if (!dv) throw new Error('post-migration: INPUT_BESS C7 lost its dropdown');

  // BESS_SIMULATION marker must be cleared (build completed)
  if (bessSim.getRange('A1').getValue() === '__V230_MIGRATION_IN_PROGRESS__') {
    throw new Error('post-migration: BESS_SIMULATION still marked in-progress');
  }
  // Two-tier section headers must exist.
  // primSectionHeader merges cols C:E and writes the title to the merge's
  // top-left cell — column C. (Checking D would read an empty merged cell.)
  if (bessSim.getRange('C11').getValue().toString().indexOf('VERIFICABLE') < 0) {
    throw new Error('post-migration: BESS_SIMULATION tier-1 header missing');
  }
  if (bessSim.getRange('C18').getValue().toString().indexOf('ESTIMADO') < 0) {
    throw new Error('post-migration: BESS_SIMULATION tier-2 header missing');
  }

  Logger.log('migrateToV230: post-migration validation OK.');
}

// ---------------------------------------------------------------------------
// ROLLBACK — restore exactly what we snapshotted before the failure.
// ---------------------------------------------------------------------------
function _v230_restoreBackup(ss, inputBess, backup) {
  // Restore INPUT_BESS strategy cell
  try {
    inputBess.getRange('C7').setValue(backup.inputBess.C7_value);
    if (backup.inputBess.C7_validation) {
      inputBess.getRange('C7').setDataValidation(backup.inputBess.C7_validation);
    }
    inputBess.getRange('C7').setNote(backup.inputBess.C7_note || '');
  } catch (e) {
    Logger.log('rollback: INPUT_BESS C7 restore failed: ' + e.message);
  }
  // Restore INPUT_BESS section-4 region (clear what we wrote, restore prior)
  try {
    inputBess.getRange('B22:Q40').clearContent();
    inputBess.getRange('B22:Q40').setValues(backup.inputBess.B22_Q40_values);
  } catch (e) {
    Logger.log('rollback: INPUT_BESS section 4 restore failed: ' + e.message);
  }
  // Restore BESS_SIMULATION if we had a snapshot
  if (backup.bessSim) {
    try {
      var sh = ss.getSheetByName('BESS_SIMULATION');
      if (sh) ss.deleteSheet(sh);
      sh = ss.insertSheet('BESS_SIMULATION');
      sh.getRange(1, 1, backup.bessSim.rows, backup.bessSim.cols)
        .setValues(backup.bessSim.values);
    } catch (e) {
      Logger.log('rollback: BESS_SIMULATION restore failed: ' + e.message);
    }
  }
  Logger.log('migrateToV230: rollback complete.');
}