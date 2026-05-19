// =============================================================================
// ARGIA ENGINE v2.2.0 -- File: 04c_MigrateV220.gs
// Live engine migration for v2.2.0:
//   - Adds INPUT_PROJECT toggle "INSTALAR BATERIA: YES/NO" (row 63)
//   - Adds CFE_SIMULATION row 41 exposing exportedKwh per month
//   - Creates INPUT_BESS sheet (if missing)
//   - Creates BESS_SIMULATION sheet (if missing)
//   - Creates BESS_BATTERY_LIBRARY sheet (if missing) with placeholder rows
//
// SAFETY: Narrow backup/restore pattern (v2.0.3 discipline).
//   - NEVER calls clearContent() on existing user data
//   - Only touches specific named cells
//   - Snapshots user-entered values before changes
//   - Rolls back on validation failure
//   - Idempotent: re-running won't overwrite user values
//
// CALLER: Run once after deploying v2.2.0 code.
//   migrateToV220();   // operates on active spreadsheet
//
// Design rationale documented inline below.
// =============================================================================

function migrateToV220(ss) {
  ss = ss || SpreadsheetApp.getActive();
  var inputProject = ss.getSheetByName('INPUT_PROJECT');
  var cfeSim       = ss.getSheetByName('CFE_SIMULATION');
  if (!inputProject) throw new Error('migrateToV220: INPUT_PROJECT sheet missing');
  if (!cfeSim)       throw new Error('migrateToV220: CFE_SIMULATION sheet missing');

  Logger.log('migrateToV220: snapshotting current state...');

  // ---- SNAPSHOT ---------------------------------------------------------
  var backup = {
    inputProject: {
      B62_E65: inputProject.getRange('B62:E65').getValues(),
      B62_E65_formulas: inputProject.getRange('B62:E65').getFormulas(),
    },
    cfeSim: {
      // Row 41 may exist (B41 already used in v2.0.x for "ENERGY SAVINGS")
      // We need to preserve whatever is there.
      B41_N41: cfeSim.getRange('B41:N41').getValues(),
      B41_N41_formulas: cfeSim.getRange('B41:N41').getFormulas(),
      // Row 42 will be the new "exported kWh" row
      B42_N42: cfeSim.getRange('B42:N42').getValues(),
      B42_N42_formulas: cfeSim.getRange('B42:N42').getFormulas(),
    },
  };

  try {
    Logger.log('migrateToV220: adding INPUT_PROJECT toggle...');
    _v220_addInputProjectBessToggle(inputProject);

    Logger.log('migrateToV220: adding CFE_SIMULATION exported kWh row...');
    _v220_addCfeSimExportedKwhRow(cfeSim);

    Logger.log('migrateToV220: creating INPUT_BESS sheet...');
    _v220_createInputBessSheet(ss);

    Logger.log('migrateToV220: creating BESS_BATTERY_LIBRARY sheet...');
    _v220_createBessBatteryLibrary(ss);

    Logger.log('migrateToV220: creating BESS_SIMULATION sheet...');
    _v220_createBessSimulationSheet(ss);

    Logger.log('migrateToV220: validating...');
    _v220_validatePostMigration(ss);

  } catch (e) {
    Logger.log('migrateToV220 FAILED: ' + e.message + ' — rolling back...');
    _v220_restoreBackup(inputProject, cfeSim, backup);
    // Best-effort cleanup of any newly-created sheets
    ['INPUT_BESS', 'BESS_SIMULATION', 'BESS_BATTERY_LIBRARY'].forEach(function(name) {
      var sh = ss.getSheetByName(name);
      if (sh && sh.getRange('A1').getValue() === '__V220_MIGRATION_IN_PROGRESS__') {
        ss.deleteSheet(sh);
      }
    });
    throw new Error('v2.2.0 migration failed, rolled back: ' + e.message);
  }

  if (typeof stampMeta === 'function') stampMeta(ss);
  Logger.log('migrateToV220: complete. Engine now at v2.2.0.');
}

// ---------------------------------------------------------------------------
// STEP 1: INPUT_PROJECT TOGGLE
// ---------------------------------------------------------------------------
function _v220_addInputProjectBessToggle(sh) {
  // Insert in rows 62-65 (existing content ends at row 60)
  // Layout:
  //   B62: "7.0"    C62: "ALMACENAMIENTO"     (section header, matches existing style)
  //   B64: "Instalar batería"   D64: dropdown YES/NO (default NO)

  sh.getRange('B62').setValue('7.0');
  sh.getRange('C62').setValue('ALMACENAMIENTO');

  sh.getRange('B64').setValue('Instalar batería');
  var d64 = sh.getRange('D64');
  if (d64.getValue() === '' || d64.getValue() === null) {
    d64.setValue('NO');
  }
  // Style: match existing cream input cells if token available
  try {
    d64.setBackground(token('BG_INPUT_CELL'));
  } catch (e) {
    d64.setBackground('#FFF8E7');
  }
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['YES', 'NO'], true)
    .setAllowInvalid(false)
    .build();
  d64.setDataValidation(rule);
  d64.setNote('YES: el motor calcula impacto BESS en CFE_SIMULATION y BESS_SIMULATION.\n' +
              'NO (default): preserva comportamiento v2.1.4.');
}

// ---------------------------------------------------------------------------
// STEP 2: CFE_SIMULATION ROW 42 — EXPORTED KWH (per month)
// (Row 41 already exists as "ENERGY SAVINGS"; we add 42)
// ---------------------------------------------------------------------------
function _v220_addCfeSimExportedKwhRow(sh) {
  // Check if row 42 is already a "PV Exportado" row (idempotent guard)
  var existing = sh.getRange('B42').getValue();
  if (existing === 'PV Exportado kWh') {
    Logger.log('v220: row 42 already has PV Exportado label, refreshing formulas only');
  }

  sh.getRange('B42').setValue('PV Exportado kWh');

  var months = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'];
  // For each month c in C..N:
  //   exported = MAX(0, PV - self_consumed)
  // where self_consumed depends on mode:
  //   NM: min(PV, total_load)        — load = C5+C6+C7
  //   SE/FN: min(intermedia, self_pct × PV)   — intermedia = C6
  // self_pct: ISBLANK ? (FN→0.7, SE→1.0) : value
  for (var i = 0; i < months.length; i++) {
    var c = months[i];
    var pvKwh = c + '8';                      // CFE_SIMULATION!C8 = PV monthly kWh
    var totalLoad = '(' + c + '5+' + c + '6+' + c + '7)';
    var intermediaLoad = c + '6';
    var selfPct = 'IF(ISBLANK(INPUT_CFE!$C$43),' +
                     'IF(INPUT_CFE!$C$41="FACTURACION_NETA",0.7,1),' +
                     'INPUT_CFE!$C$43)';

    var selfConsumed =
      'IF(INPUT_CFE!$C$41="MEDICION_NETA",' +
        'MIN(' + pvKwh + ',' + totalLoad + '),' +
        'MIN(' + intermediaLoad + ',' + selfPct + '*' + pvKwh + '))';

    var formula = '=MAX(0,' + pvKwh + ' - ' + selfConsumed + ')';
    sh.getRange(c + '42').setFormula(formula);
  }
}

// ---------------------------------------------------------------------------
// STEP 3: INPUT_BESS sheet
// ---------------------------------------------------------------------------
function _v220_createInputBessSheet(ss) {
  var sh = ss.getSheetByName('INPUT_BESS');
  var isNew = false;
  if (!sh) {
    sh = ss.insertSheet('INPUT_BESS');
    isNew = true;
    sh.getRange('A1').setValue('__V220_MIGRATION_IN_PROGRESS__');  // rollback marker
  }

  // Helper: only write if blank (idempotent for existing user data)
  function setIfBlank(addr, value) {
    var cell = sh.getRange(addr);
    if (cell.getValue() === '' || cell.getValue() === null) {
      cell.setValue(value);
    }
  }

  // Banner
  sh.getRange('B2').setValue('INPUT BESS');
  sh.getRange('B3').setValue('Configuración del sistema de almacenamiento (v2.2.0 SELF_CONSUMPTION_MAX)');

  // Section 1: Battery selection
  sh.getRange('B5').setValue('1. SELECCIÓN DE BATERÍA').setFontWeight('bold');
  sh.getRange('B6').setValue('BATTERY_ID:');
  setIfBlank('C6', 'CUSTOM_MANUAL');
  var batteryIds = ['CUSTOM_MANUAL', 'CATL_3MWH', 'BYD_2MWH',
                    'HUAWEI_2MWH', 'TESLA_3_9MWH', 'LOCAL_INTEGRATOR'];
  sh.getRange('C6').setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(batteryIds, true)
      .setAllowInvalid(false)
      .build());
  sh.getRange('C6').setNote('Selección de batería de BESS_BATTERY_LIBRARY.\n' +
                            'CATL/BYD/Tesla/Huawei son PLACEHOLDER — validar con proveedor antes de cotizar.');

  sh.getRange('B7').setValue('BESS_STRATEGY:');
  setIfBlank('C7', 'SELF_CONSUMPTION_MAX');
  sh.getRange('C7').setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(['SELF_CONSUMPTION_MAX'], true)
      .setAllowInvalid(false)
      .build());
  sh.getRange('C7').setNote('Estrategia de despacho.\n' +
                            'v2.2.0 solo soporta SELF_CONSUMPTION_MAX.\n' +
                            'PEAK_SHAVING y HYBRID en v2.3.0 (requiere datos 15-min).');

  // XLOOKUP info columns (E-G)
  sh.getRange('E6').setValue('Provider:');
  sh.getRange('F6').setFormula(_v220_xlookup('$C$6', 'B'));
  sh.getRange('E7').setValue('Model:');
  sh.getRange('F7').setFormula(_v220_xlookup('$C$6', 'C'));

  // Section 2: Technical specs
  sh.getRange('B9').setValue('2. ESPECIFICACIONES TÉCNICAS').setFontWeight('bold');
  sh.getRange('B10').setValue('Capacidad nominal kWh:');
  sh.getRange('C10').setFormula(_v220_xlookup('$C$6', 'E'));
  sh.getRange('B11').setValue('Potencia kW:');
  sh.getRange('C11').setFormula(_v220_xlookup('$C$6', 'F'));
  sh.getRange('B12').setValue('Min SOC %:');
  sh.getRange('C12').setFormula(_v220_xlookup('$C$6', 'G'));
  sh.getRange('C12').setNumberFormat('0%');
  sh.getRange('B13').setValue('Max SOC %:');
  sh.getRange('C13').setFormula(_v220_xlookup('$C$6', 'H'));
  sh.getRange('C13').setNumberFormat('0%');
  sh.getRange('B14').setValue('RTE %:');
  sh.getRange('C14').setFormula(_v220_xlookup('$C$6', 'I'));
  sh.getRange('C14').setNumberFormat('0%');

  sh.getRange('B15').setValue('Ciclos por día:');
  setIfBlank('C15', 1.0);
  sh.getRange('B16').setValue('Degradación %/año:');
  setIfBlank('C16', 0.025);
  sh.getRange('C16').setNumberFormat('0.00%');
  sh.getRange('B17').setValue('Reserva backup %:');
  setIfBlank('C17', 0.0);
  sh.getRange('C17').setNumberFormat('0%');

  // Section 3: Commercial
  sh.getRange('B19').setValue('3. INFORMACIÓN COMERCIAL').setFontWeight('bold');
  sh.getRange('B20').setValue('CAPEX MXN:');
  sh.getRange('C20').setFormula(_v220_xlookup('$C$6', 'L'));
  sh.getRange('C20').setNumberFormat('#,##0');
  sh.getRange('C20').setNote('CAPEX instalado. Default desde BESS_BATTERY_LIBRARY; PLACEHOLDER values son 0 — requieren cotización real.');

  // Clean up rollback marker if we got here
  if (isNew) {
    sh.getRange('A1').clearContent();
  }
}

function _v220_xlookup(idCell, libColumn) {
  return '=IFERROR(XLOOKUP(' + idCell + ',BESS_BATTERY_LIBRARY!$A:$A,' +
         'BESS_BATTERY_LIBRARY!$' + libColumn + ':$' + libColumn + '),"")';
}

// ---------------------------------------------------------------------------
// STEP 4: BESS_BATTERY_LIBRARY sheet
// ---------------------------------------------------------------------------
function _v220_createBessBatteryLibrary(ss) {
  var sh = ss.getSheetByName('BESS_BATTERY_LIBRARY');
  var isNew = false;
  if (!sh) {
    sh = ss.insertSheet('BESS_BATTERY_LIBRARY');
    isNew = true;
    sh.getRange('A1').setValue('__V220_MIGRATION_IN_PROGRESS__');
  }

  // Only write header + placeholder rows if sheet is fresh
  var firstCell = sh.getRange('A2').getValue();
  if (firstCell === '' || firstCell === null) {
    var rows = [
      // header (row 1)
      ['Battery_ID', 'Provider', 'Model', 'Chemistry',
       'Nominal_Capacity_kWh', 'Power_kW', 'Min_SOC_%', 'Max_SOC_%',
       'Round_Trip_Efficiency_%', 'Warranty_Years', 'Expected_Life_Years',
       'Installed_CAPEX_MXN', 'Notes'],
      // CUSTOM_MANUAL — always present
      ['CUSTOM_MANUAL', 'Custom', 'User-defined', 'LFP',
       0, 0, 0.10, 0.90, 0.90, 10, 15, 0,
       'Override all values manually. Default starting point.'],
      // Pre-populated placeholders (Q3 round 2 decision)
      ['CATL_3MWH', 'CATL', '3.0 MWh container', 'LFP',
       3000, 1500, 0.05, 0.90, 0.92, 10, 20, 0,
       'PLACEHOLDER — requires supplier quote.'],
      ['BYD_2MWH', 'BYD', '2.0 MWh BESS', 'LFP',
       2000, 1000, 0.05, 0.90, 0.91, 10, 15, 0,
       'PLACEHOLDER — requires supplier quote.'],
      ['HUAWEI_2MWH', 'Huawei', '2.0 MWh industrial', 'LFP',
       2000, 1000, 0.05, 0.90, 0.91, 10, 15, 0,
       'PLACEHOLDER — requires supplier quote.'],
      ['TESLA_3_9MWH', 'Tesla', 'Megapack 3.9 MWh', 'LFP',
       3900, 1900, 0.05, 0.90, 0.92, 10, 20, 0,
       'PLACEHOLDER — requires supplier quote.'],
      ['LOCAL_INTEGRATOR', 'Local', 'Supplier quote row', 'TBD',
       0, 0, 0.10, 0.90, 0.90, 10, 15, 0,
       'For local supplier quotations. Fill in from real quotes.'],
    ];
    sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
    sh.getRange('A1:M1').setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('G2:I7').setNumberFormat('0%');
    sh.getRange('L2:L7').setNumberFormat('#,##0');
  }

  if (isNew) {
    sh.getRange('A1').setValue('Battery_ID');  // overwrite rollback marker with header
  }
}

// ---------------------------------------------------------------------------
// STEP 5: BESS_SIMULATION sheet
// ---------------------------------------------------------------------------
function _v220_createBessSimulationSheet(ss) {
  var sh = ss.getSheetByName('BESS_SIMULATION');
  var isNew = false;
  if (!sh) {
    sh = ss.insertSheet('BESS_SIMULATION');
    isNew = true;
    sh.getRange('A1').setValue('__V220_MIGRATION_IN_PROGRESS__');
  }

  // Banner
  sh.getRange('B2').setValue('BESS SIMULATION');
  sh.getRange('B3').setValue('Estimación mensual de captura de energía exportada por baterías (Estrategia B)');

  // Month headers (row 4, cols C-N)
  var months = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'];
  for (var i = 0; i < months.length; i++) {
    sh.getRange(months[i] + '4').setFormula('=CFE_SIMULATION!' + months[i] + '4');
  }

  // Row labels (col B) and per-month formulas (col C-N)
  // The toggle gate: every formula returns 0 if INPUT_PROJECT!$D$64 != "YES"
  function setRowFormulas(row, label, fmt, jsFormulaFn) {
    sh.getRange('B' + row).setValue(label);
    for (var i = 0; i < months.length; i++) {
      var c = months[i];
      var inner = jsFormulaFn(c);
      var gated = '=IF(INPUT_PROJECT!$D$64="YES",' + inner + ',0)';
      sh.getRange(c + row).setFormula(gated);
      if (fmt) sh.getRange(c + row).setNumberFormat(fmt);
    }
  }

  // Row 5: PV exported kWh (from CFE_SIMULATION row 42)
  setRowFormulas(5, 'PV exportado kWh', '#,##0',
                 function(c){ return 'CFE_SIMULATION!' + c + '42'; });

  // Row 6: Battery monthly throughput kWh
  // = usable × cycles × days × RTE
  // usable = INPUT_BESS!C10 × (C13-C12) × (1-C16) × (1-C17)
  setRowFormulas(6, 'BESS throughput kWh', '#,##0.00',
    function(c) {
      return 'INPUT_BESS!$C$10 * (INPUT_BESS!$C$13 - INPUT_BESS!$C$12) * ' +
             '(1 - INPUT_BESS!$C$16) * (1 - INPUT_BESS!$C$17) * ' +
             'INPUT_BESS!$C$15 * CFE_SIMULATION!' + c + '20 * INPUT_BESS!$C$14';
    });

  // Row 7: Captured kWh = MIN(exported, throughput)
  setRowFormulas(7, 'PV capturado por BESS kWh', '#,##0.00',
    function(c){ return 'MIN(' + c + '5,' + c + '6)'; });

  // Row 8: Blended avoided tariff = (CFE_SIMULATION!C8_baseline - we need to compute
  // baseline differently. The baseline bill for this month is INPUT_CFE!C37+C38 (legacy)
  // Wait — the baseline (no PV) bill for the user's data is already in INPUT_CFE
  // The blended tariff = baseline_bill / total_consumption_kwh
  setRowFormulas(8, 'Tarifa promedio (MXN/kWh)', '0.0000',
    function(c) {
      var totalKwh = '(' + c + '5_via_load_not_pv_TODO)';   // need to think about this
      // Actually we want: baseline INPUT_CFE C37+C38 (DAP-less? need to revisit)
      // Use INPUT_CFE!C37 (Facturación, no DAP) / SUM(INPUT_CFE!C10:C12) = total_kWh
      return 'IFERROR(' +
              '(INPUT_CFE!' + c + '37+INPUT_CFE!' + c + '38) / ' +
              '(INPUT_CFE!' + c + '10+INPUT_CFE!' + c + '11+INPUT_CFE!' + c + '12),' +
              '0)';
    });

  // Row 9: Export price (only nonzero in FN)
  setRowFormulas(9, 'Precio exportación (MXN/kWh)', '0.00',
    function(c){
      return 'IF(INPUT_CFE!$C$41="FACTURACION_NETA",INPUT_CFE!$C$42,0)';
    });

  // Row 10: Value per captured kWh = blended_tariff - export_price
  setRowFormulas(10, 'Valor por kWh capturado', '0.0000',
    function(c){ return c + '8 - ' + c + '9'; });

  // Row 11: BESS savings MXN = captured × value × RTE
  setRowFormulas(11, 'Ahorro BESS MXN', '#,##0.00',
    function(c){ return c + '7 * ' + c + '10 * INPUT_BESS!$C$14'; });

  // Row 12: Bill after PV (link to CFE_SIMULATION!C39)
  setRowFormulas(12, 'Factura post-PV MXN', '#,##0.00',
    function(c){ return 'CFE_SIMULATION!' + c + '39'; });

  // Row 13: Bill after PV+BESS = MAX(0, billAfterPv - savings)
  setRowFormulas(13, 'Factura post-PV+BESS MXN', '#,##0.00',
    function(c){ return 'MAX(0,' + c + '12 - ' + c + '11)'; });

  // Annual summary (col O)
  sh.getRange('O4').setValue('ANUAL');
  for (var r = 5; r <= 13; r++) {
    sh.getRange('O' + r).setFormula('=SUM(C' + r + ':N' + r + ')');
    sh.getRange('O' + r).setNumberFormat(sh.getRange('C' + r).getNumberFormat());
  }
  sh.getRange('O4').setFontWeight('bold');

  // Disclaimer at bottom
  sh.getRange('B16').setValue('NOTA').setFontWeight('bold');
  sh.getRange('B17').setValue('v2.2.0 implementa solo SELF_CONSUMPTION_MAX. PEAK_SHAVING y HYBRID en v2.3.0.');
  sh.getRange('B18').setValue('Modelo mensual aproximado; valores reales requieren simulación con datos 15-min.');

  if (isNew) {
    sh.getRange('A1').clearContent();
  }
}

// ---------------------------------------------------------------------------
// STEP 6: VALIDATION
// ---------------------------------------------------------------------------
function _v220_validatePostMigration(ss) {
  // Verify all four new/modified sheets exist
  ['INPUT_BESS', 'BESS_BATTERY_LIBRARY', 'BESS_SIMULATION'].forEach(function(name) {
    if (!ss.getSheetByName(name)) {
      throw new Error('post-migration: sheet ' + name + ' missing');
    }
  });

  // Toggle exists
  var toggle = ss.getSheetByName('INPUT_PROJECT').getRange('D64').getValue();
  if (toggle !== 'YES' && toggle !== 'NO') {
    throw new Error('post-migration: INPUT_PROJECT!D64 toggle invalid (got ' + toggle + ')');
  }

  // BESS_SIMULATION row 13 (final bill) for Jan should be a number
  var jan = ss.getSheetByName('BESS_SIMULATION').getRange('C13').getValue();
  if (typeof jan !== 'number' || isNaN(jan)) {
    throw new Error('post-migration: BESS_SIMULATION!C13 not numeric (got ' + jan + ')');
  }
  // When toggle is NO (default), result should be 0
  // When YES, result should be plausible (1k-50M MXN range)
  if (toggle === 'NO' && jan !== 0) {
    Logger.log('warning: toggle=NO but C13=' + jan + ' (expected 0)');
  }
  if (toggle === 'YES' && (jan < 0 || jan > 50000000)) {
    throw new Error('post-migration: BESS_SIMULATION!C13 implausible (got ' + jan + ')');
  }

  Logger.log('post-migration validation OK (C13 = ' + jan + ')');
}

// ---------------------------------------------------------------------------
// ROLLBACK
// ---------------------------------------------------------------------------
function _v220_restoreBackup(inputProject, cfeSim, backup) {
  try {
    // Restore INPUT_PROJECT rows 62-65
    inputProject.getRange('B62:E65').setValues(backup.inputProject.B62_E65);
    var formulas = backup.inputProject.B62_E65_formulas;
    for (var r = 0; r < formulas.length; r++) {
      for (var c = 0; c < formulas[r].length; c++) {
        if (formulas[r][c] !== '') {
          inputProject.getRange(62 + r, 2 + c).setFormula(formulas[r][c]);
        }
      }
    }
    // Restore CFE_SIMULATION rows 41-42
    cfeSim.getRange('B41:N41').setValues(backup.cfeSim.B41_N41);
    cfeSim.getRange('B42:N42').setValues(backup.cfeSim.B42_N42);
    _v220_restoreFormulas(cfeSim, 'B41:N41', backup.cfeSim.B41_N41_formulas);
    _v220_restoreFormulas(cfeSim, 'B42:N42', backup.cfeSim.B42_N42_formulas);
  } catch (e) {
    Logger.log('ROLLBACK FAILED: ' + e.message + ' — manual recovery required');
    throw new Error('migration rolled back but restore failed: ' + e.message);
  }
}

function _v220_restoreFormulas(sh, rangeA1, formulas) {
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