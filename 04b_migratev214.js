// =============================================================================
// ARGIA ENGINE v2.1.4 -- File: 04b_MigrateV214.gs
// Live engine migration for v2.1.4:
//   - Adds INPUT_CFE rows 39-44 ("PV INTERCONNECTION" sub-section)
//   - Updates CFE_SIMULATION cascade rows 9, 10, 11 to be mode-aware
//   - Updates CFE_SIMULATION row 34 (Cargo FP) to read INPUT_CFE!$C$44
//   - Adds CFE_SIMULATION row 40 (Crédito Exportación, FN mode only)
//   - Updates CFE_SIMULATION row 39 (TOTAL) to subtract row 40
//
// SAFETY: Narrow backup/restore pattern (v2.0.3 discipline).
//   - NEVER calls clearContent() or insertRows()
//   - Only setValue/setFormula on specific named cells
//   - Snapshots user data before changes; rolls back on validation failure
//   - Idempotent: re-running won't overwrite user values
//
// CALLER: Run once after deploying v2.1.4 code to an Apps Script project.
//   migrateToV214();   // operates on active spreadsheet
//
// See PHASE_1_4_DESIGN_v2.md for full design rationale.
// =============================================================================

function migrateToV214(ss) {
  ss = ss || SpreadsheetApp.getActive();
  var inputCfe = ss.getSheetByName('INPUT_CFE');
  var cfeSim   = ss.getSheetByName('CFE_SIMULATION');
  if (!inputCfe) throw new Error('migrateToV214: INPUT_CFE sheet missing');
  if (!cfeSim)   throw new Error('migrateToV214: CFE_SIMULATION sheet missing');

  Logger.log('migrateToV214: snapshotting current state...');

  // ---- SNAPSHOT ---------------------------------------------------------
  // Capture user-entered cells AND existing formulas in cells we'll touch.
  // If migration fails partway, _restoreBackup() puts everything back.
  var backup = {
    inputCfe: {
      // User-entered service metadata (cream cells)
      C4_F7:    inputCfe.getRange('C4:F7').getValues(),
      // User-entered monthly grid (cream cells)
      C10_N17:  inputCfe.getRange('C10:N17').getValues(),
      // Existing values in rows 39-44 (may or may not exist)
      B39_N44:  inputCfe.getRange('B39:N44').getValues(),
      B39_N44_formulas: inputCfe.getRange('B39:N44').getFormulas(),
    },
    cfeSim: {
      // Row 10 — we DO touch this (mode-aware intermedia)
      C10_N10:  cfeSim.getRange('C10:N10').getFormulas(),
      // Existing FP formula (row 34)
      C34_N34:  cfeSim.getRange('C34:N34').getFormulas(),
      // Existing TOTAL formula (row 39)
      C39_N39:  cfeSim.getRange('C39:N39').getFormulas(),
      // Existing row 40 (may not exist yet)
      B40_N40:  cfeSim.getRange('B40:N40').getValues(),
      B40_N40_formulas: cfeSim.getRange('B40:N40').getFormulas(),
      // NOTE: rows 9 and 11 are ARRAY formulas and we deliberately do NOT
      // touch them in v2.1.4 (see _v214_updateCfeSimCascade for rationale).
      // We also do NOT back them up, because getFormulas()+setFormula() would
      // strip their array-evaluation context if rollback ever ran.
    },
  };

  try {
    Logger.log('migrateToV214: applying INPUT_CFE updates...');
    _v214_addInputCfePvSubsection(inputCfe);

    Logger.log('migrateToV214: applying CFE_SIMULATION cascade updates...');
    _v214_updateCfeSimCascade(cfeSim);

    Logger.log('migrateToV214: applying CFE_SIMULATION Cargo FP update...');
    _v214_updateCfeSimCargoFp(cfeSim);

    Logger.log('migrateToV214: adding CFE_SIMULATION export credit row...');
    _v214_addCfeSimExportCredit(cfeSim);

    Logger.log('migrateToV214: updating CFE_SIMULATION TOTAL row...');
    _v214_updateCfeSimTotal(cfeSim);

    // Force recalculation before validation reads the result.
    // Without this, getValue() may return stale cached values for cells whose
    // formulas were just rewritten. Empirically, validation was reading
    // ~535.63 (Suministro × IVA only) because the cascade hadn't recomputed.
    SpreadsheetApp.flush();
    Utilities.sleep(500);  // belt-and-suspenders: give recalc time to propagate

    Logger.log('migrateToV214: validating result...');
    _v214_validatePostMigration(ss);

  } catch (e) {
    Logger.log('migrateToV214 FAILED: ' + e.message + ' — rolling back...');
    _v214_restoreBackup(inputCfe, cfeSim, backup);
    throw new Error('v2.1.4 migration failed, rolled back: ' + e.message);
  }

  // Stamp version (existing helper from 00a_Version.gs)
  if (typeof stampMeta === 'function') {
    stampMeta(ss);
  }
  Logger.log('migrateToV214: complete. Engine now at v2.1.4.');
}

// ---------------------------------------------------------------------------
// STEP 1: ADD INPUT_CFE PV SUB-SECTION (rows 39-44)
// ---------------------------------------------------------------------------
function _v214_addInputCfePvSubsection(sh) {
  // Row 39 BANNER
  // INPUT_CFE has frozen panes at C10 (col B frozen, cols C+ non-frozen).
  // We can't merge across that boundary, so we use TWO ranges:
  //   B39 — single label cell (in frozen zone)
  //   C39:N39 — merged banner area (in non-frozen zone)
  sh.getRange('B39').setValue('PV INTERCONNECTION')
    .setFontWeight('bold')
    .setHorizontalAlignment('left');
  // Merge only the non-frozen part (C39:N39)
  try { sh.getRange('C39:N39').merge(); } catch (e) { /* already merged */ }
  // Cream background using design token if available, otherwise sensible default
  try {
    sh.getRange('B39:N39').setBackground(token('BG_INPUT_CELL'));
  } catch (e) {
    sh.getRange('B39:N39').setBackground('#FFF8E7');
  }

  // Row 40 is intentionally left blank as a visual spacer

  // Row 41: Mode dropdown
  sh.getRange('B41').setValue('MODO INTERCONEXIÓN:').setHorizontalAlignment('right');
  var c41 = sh.getRange('C41');
  // Only set default if blank — preserve any prior user choice
  if (c41.getValue() === '' || c41.getValue() === null) {
    c41.setValue('MEDICION_NETA');
  }
  try {
    c41.setBackground(token('BG_INPUT_CELL'));
  } catch (e) {
    c41.setBackground('#FFF8E7');
  }
  var modeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['MEDICION_NETA', 'FACTURACION_NETA', 'SIN_EXPORTACION'], true)
    .setAllowInvalid(false)
    .build();
  c41.setDataValidation(modeRule);
  c41.setNote('Esquema CRE de interconexión.\n' +
              'NM = Medición Neta (neteo de energía)\n' +
              'FN = Facturación Neta (crédito en pesos por exportación)\n' +
              'SE = Sin Exportación (excedente descartado)');

  // Row 42: Export price
  sh.getRange('B42').setValue('PRECIO EXPORTACIÓN MXN/kWh:').setHorizontalAlignment('right');
  var c42 = sh.getRange('C42');
  if (c42.getValue() === '' || c42.getValue() === null) {
    c42.setValue(0.80);
  }
  try {
    c42.setBackground(token('BG_INPUT_CELL'));
  } catch (e) {
    c42.setBackground('#FFF8E7');
  }
  c42.setNumberFormat('#,##0.00');
  c42.setNote('Precio publicado por CFE para Facturación Neta.\n' +
              'Varía por región y se actualiza anualmente.\n' +
              'Solo se usa en modo FACTURACION_NETA.');

  // Row 43: Self-consumption %
  sh.getRange('B43').setValue('AUTOCONSUMO %:').setHorizontalAlignment('right');
  var c43 = sh.getRange('C43');
  // INTENTIONALLY leave c43 blank — formulas default per mode (100% SE, 70% FN)
  try {
    c43.setBackground(token('BG_INPUT_CELL'));
  } catch (e) {
    c43.setBackground('#FFF8E7');
  }
  c43.setNumberFormat('0%');
  c43.setNote('Fracción de la producción FV que se autoconsume on-site.\n' +
              'NM: ignorado (forzado 100%).\n' +
              'SE: blanco → 100% (sin curtailment).\n' +
              'FN: blanco → 70% (default industria).');

  // Row 44: FP threshold
  sh.getRange('B44').setValue('UMBRAL FACTOR POTENCIA:').setHorizontalAlignment('right');
  var c44 = sh.getRange('C44');
  if (c44.getValue() === '' || c44.getValue() === null) {
    c44.setValue(0.90);
  }
  try {
    c44.setBackground(token('BG_INPUT_CELL'));
  } catch (e) {
    c44.setBackground('#FFF8E7');
  }
  c44.setNumberFormat('0.00');
  var fpRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['0.90', '0.95', '0.97'], true)
    .setAllowInvalid(false)
    .build();
  c44.setDataValidation(fpRule);
  c44.setNote('Umbral PF según Acuerdo A/064/2018 y A/073/2023.\n' +
              '0.90 = clientes < 1 MW (default).\n' +
              '0.95 = clientes ≥ 1 MW hoy.\n' +
              '0.97 = clientes ≥ 1 MW desde abril 8, 2026 (Código de Red).');
}

// ---------------------------------------------------------------------------
// STEP 2: UPDATE CFE_SIMULATION CASCADE (rows 9, 10, 11)
// ---------------------------------------------------------------------------
function _v214_updateCfeSimCascade(sh) {
  // v2.1.4 SIMPLIFIED APPROACH (after debugging 2026-05-15):
  // Only touch row 10 (Energia Intermedia). Leave rows 9 and 11 ALONE.
  //
  // Rationale:
  //   - Rows 9, 11 are ARRAY formulas with xlookup range-concatenation,
  //     and setFormula() does not preserve their array-evaluation context.
  //     Attempts to wrap with =ARRAYFORMULA(IF(...)) caused #REF! errors and
  //     incorrect values (C39 collapsed to ~Suministro only).
  //   - It turns out we don't NEED to touch them. Analysis:
  //     * In NM mode, my mode-aware row 10 reduces to C6-C8 (original behavior).
  //       Rows 9, 11 cascade logic continues to work unchanged.
  //     * In SE/FN mode, my row 10 caps at C6 - MIN(C6, self_pct × C8),
  //       guaranteeing C10 >= 0. With C10 >= 0 every month, the N10 reference
  //       in row 11 never triggers cross-month carryover (IF(N10>0, C7, ...))
  //       always returns C7. Row 9 similarly returns C5 because C11=C7>0.
  //
  // So mode-aware row 10 alone is sufficient to deliver the v2.1.4 behavior
  // in all three modes (NM, SE, FN). Rows 9 and 11 stay as-is.

  var months = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'];

  for (var i = 0; i < months.length; i++) {
    var c = months[i];
    // Only row 10 — mode-aware intermedia displacement
    sh.getRange(c + '10').setFormula(_v214_buildRow10Formula(c));
  }
}

function _v214_buildRow10Formula(c) {
  // ENERGIA INTERMEDIA — mode-aware.
  // NM: raw - all PV (legacy behavior)
  // SE/FN: raw - MIN(raw, self_pct × PV), where self_pct defaults:
  //         SE → 1.0 if blank, FN → 0.7 if blank
  return '=IF(OR($B$4="GDMTH",$B$4="DIST"),' +
           'IF(INPUT_CFE!$C$41="MEDICION_NETA",' +
              c + '6-' + c + '8,' +
              c + '6 - MIN(' + c + '6,' +
                       'IF(ISBLANK(INPUT_CFE!$C$43),' +
                          'IF(INPUT_CFE!$C$41="FACTURACION_NETA",0.7,1),' +
                          'INPUT_CFE!$C$43) * ' + c + '8)),' +
           '0)';
}

// ---------------------------------------------------------------------------
// STEP 3: UPDATE CFE_SIMULATION CARGO FP (row 34)
// Reads threshold from INPUT_CFE!$C$44 with IFERROR fallback to 0.90.
// ---------------------------------------------------------------------------
function _v214_updateCfeSimCargoFp(sh) {
  var months = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'];
  for (var i = 0; i < months.length; i++) {
    var c = months[i];
    var pfCell = c + '22';
    var energiaCell = c + '32';
    var btCell = c + '33';
    var T = 'IFERROR(INPUT_CFE!$C$44,0.9)';
    var formula =
      '=IF(' + pfCell + ' < ' + T + ',' +
        'MAX(3/5*(' + T + '/' + pfCell + '-1),0)*(' + energiaCell + '+' + btCell + '),' +
        'MAX(1/4*(1-(' + T + '/' + pfCell + ')),0)*-(' + energiaCell + '+' + btCell + '))';
    sh.getRange(c + '34').setFormula(formula);
  }
}

// ---------------------------------------------------------------------------
// STEP 4: ADD CFE_SIMULATION EXPORT CREDIT (row 40 - NEW)
// Active only when mode = FACTURACION_NETA.
// ---------------------------------------------------------------------------
function _v214_addCfeSimExportCredit(sh) {
  // Label in B40
  sh.getRange('B40').setValue('Crédito Exportación');

  var months = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'];
  for (var i = 0; i < months.length; i++) {
    var c = months[i];
    // total_load = C5 + C6 + C7
    // self_consumed = MIN(total_load, self_pct × C8)
    // exported = C8 - self_consumed
    // credit = exported × export_price
    // self_pct: ISBLANK ? 0.7 (FN default) : value
    var selfPct = 'IF(ISBLANK(INPUT_CFE!$C$43),0.7,INPUT_CFE!$C$43)';
    var totalLoad = '(' + c + '5+' + c + '6+' + c + '7)';
    var selfConsumed = 'MIN(' + totalLoad + ',' + selfPct + '*' + c + '8)';
    var exported = '(' + c + '8-' + selfConsumed + ')';
    var price = 'IFERROR(INPUT_CFE!$C$42,0.80)';

    var formula =
      '=IF(INPUT_CFE!$C$41="FACTURACION_NETA",' +
        'MAX(0,' + exported + ') * ' + price + ',' +
        '0)';
    sh.getRange(c + '40').setFormula(formula);
  }
}

// ---------------------------------------------------------------------------
// STEP 5: UPDATE CFE_SIMULATION TOTAL (row 39)
// Subtract export credit.
// ---------------------------------------------------------------------------
function _v214_updateCfeSimTotal(sh) {
  var months = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'];
  for (var i = 0; i < months.length; i++) {
    var c = months[i];
    var formula = '=' + c + '37+' + c + '38-IFERROR(' + c + '40,0)';
    sh.getRange(c + '39').setFormula(formula);
  }
}

// ---------------------------------------------------------------------------
// STEP 6: POST-MIGRATION VALIDATION
// Sanity-check that the modified sheet still produces reasonable numbers.
// If TOTAL row is wildly off, throw to trigger rollback.
// ---------------------------------------------------------------------------
function _v214_validatePostMigration(ss) {
  var cfeSim = ss.getSheetByName('CFE_SIMULATION');
  // Read row 39 (TOTAL) for January (col C)
  var janTotal = cfeSim.getRange('C39').getValue();
  if (typeof janTotal !== 'number' || isNaN(janTotal)) {
    throw new Error('post-migration: CFE_SIMULATION!C39 not numeric (got ' + janTotal + ')');
  }
  if (janTotal < 0) {
    throw new Error('post-migration: CFE_SIMULATION!C39 negative (got ' + janTotal + ')');
  }
  if (janTotal > 50000000) {
    throw new Error('post-migration: CFE_SIMULATION!C39 implausibly high (got ' + janTotal + ')');
  }

  // The interesting case: low values (< 1000 MXN) can be LEGITIMATE if PV
  // is large enough to zero out energy charges (only Suministro × IVA remains).
  // Distinguish two cases:
  //   (a) Suministro × IVA only → C32=0 (Energía Total) AND PV > consumption → OK
  //   (b) Cascade broken → C32=0 AND PV ≤ consumption → MIGRATION BUG
  if (janTotal < 1000) {
    var c8  = cfeSim.getRange('C8').getValue();
    var c5  = cfeSim.getRange('C5').getValue();
    var c6  = cfeSim.getRange('C6').getValue();
    var c7  = cfeSim.getRange('C7').getValue();
    var consumption = (c5 || 0) + (c6 || 0) + (c7 || 0);
    var pv = c8 || 0;
    Logger.log('post-migration: low C39=' + janTotal + ', consumption=' + consumption + ', PV=' + pv);
    if (pv >= consumption) {
      // Legitimate: PV exceeds consumption, energy charges zero, only fixed fees remain
      Logger.log('post-migration: low C39 explained by PV ≥ consumption (PV=' + pv +
                 ', load=' + consumption + '). Accepting.');
    } else {
      // Cascade broken — PV doesn't cover load but energy charges still zero
      var inputCfe = ss.getSheetByName('INPUT_CFE');
      var diag = 'C5=' + c5 + ', C6=' + c6 + ', C7=' + c7 + ', C8=' + c8
               + ', C9=' + cfeSim.getRange('C9').getValue()
               + ', C10=' + cfeSim.getRange('C10').getValue()
               + ', C11=' + cfeSim.getRange('C11').getValue()
               + ', N10=' + cfeSim.getRange('N10').getValue()
               + ', C12=' + cfeSim.getRange('C12').getValue()
               + ', C13=' + cfeSim.getRange('C13').getValue()
               + ', C14=' + cfeSim.getRange('C14').getValue()
               + ', C18=' + cfeSim.getRange('C18').getValue()
               + ', C32=' + cfeSim.getRange('C32').getValue()
               + ', C39=' + janTotal
               + ', INPUT_CFE!C41=' + inputCfe.getRange('C41').getValue()
               + ', INPUT_CFE!C43=' + JSON.stringify(inputCfe.getRange('C43').getValue())
               + ', C10_formula=' + cfeSim.getRange('C10').getFormula();
      Logger.log('post-migration DIAGNOSTIC: ' + diag);
      throw new Error('post-migration: cascade broken (PV ' + pv +
                      ' < consumption ' + consumption + ', but C39=' + janTotal +
                      '). Diagnostic: ' + diag);
    }
  }
  Logger.log('post-migration: C39 = ' + janTotal + ' (validated)');
}

// ---------------------------------------------------------------------------
// ROLLBACK on failure — restore everything from the snapshot.
// ---------------------------------------------------------------------------
function _v214_restoreBackup(inputCfe, cfeSim, backup) {
  try {
    // Restore INPUT_CFE user data (cream cells)
    inputCfe.getRange('C4:F7').setValues(backup.inputCfe.C4_F7);
    inputCfe.getRange('C10:N17').setValues(backup.inputCfe.C10_N17);
    // Restore rows 39-44 (in case we wrote to them and need to revert)
    inputCfe.getRange('B39:N44').setValues(backup.inputCfe.B39_N44);
    // Then formulas (override values for cells that were formulas)
    var formulas = backup.inputCfe.B39_N44_formulas;
    for (var r = 0; r < formulas.length; r++) {
      for (var c = 0; c < formulas[r].length; c++) {
        if (formulas[r][c] !== '') {
          inputCfe.getRange(39 + r, 2 + c).setFormula(formulas[r][c]);
        }
      }
    }

    // Restore CFE_SIMULATION formulas
    // (rows 9 and 11 are deliberately not in backup — they were never modified)
    _v214_restoreFormulas(cfeSim, 'C10:N10', backup.cfeSim.C10_N10);
    _v214_restoreFormulas(cfeSim, 'C34:N34', backup.cfeSim.C34_N34);
    _v214_restoreFormulas(cfeSim, 'C39:N39', backup.cfeSim.C39_N39);
    // Row 40 may have been blank originally; restore both values and formulas
    cfeSim.getRange('B40:N40').setValues(backup.cfeSim.B40_N40);
    _v214_restoreFormulas(cfeSim, 'B40:N40', backup.cfeSim.B40_N40_formulas);
  } catch (e) {
    Logger.log('ROLLBACK FAILED: ' + e.message + ' — manual recovery required!');
    throw new Error('migration rolled back but restore failed: ' + e.message);
  }
}

function _v214_restoreFormulas(sh, rangeA1, formulas) {
  var range = sh.getRange(rangeA1);
  for (var r = 0; r < formulas.length; r++) {
    for (var c = 0; c < formulas[r].length; c++) {
      var f = formulas[r][c];
      if (f !== '') {
        range.getCell(r + 1, c + 1).setFormula(f);
      }
    }
  }
}