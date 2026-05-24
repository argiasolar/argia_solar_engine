// =============================================================================
// ARGIA ENGINE v2 -- File: templates/setupMdcTemplate.gs
// -----------------------------------------------------------------------------
// CHUNK 1 — MDC_v2 template.
//
// WHAT THIS DOES
//   Creates or refreshes the MDC_v2 sheet structure:
//     - Banner (logo + title + subtitle)
//     - Column headers row
//     - Static labels in col B for every body row (§0..§7)
//     - Section header bands
//     - Conditional formatting on col E (STATUS)
//     - Frozen rows + cols
//
//   Pure setup. Never reads INPUT_* or calc results. Never writes data values
//   into col C (those come from writeMdcV2). Idempotent — running this twice
//   leaves the same visual result.
//
// LAYOUT NOTE — WHY MDC_v2 USES AN 8-COLUMN LAYOUT, NOT THE PRIMITIVE GRID
//   02b_LayoutPrimitives.js encodes a 7-column grid (cols B–G content, G = status
//   icon) for inputs and simpler outputs. The MDC uses a different, pre-existing
//   8-column convention:
//     B = label, C = value, D = unit, E = status,
//     F = NOM citation, G = formula trace, H = margin
//   This convention is locked by the existing MDC_COL constants in 00_Main.js
//   and by the customer-facing MDC layout people already review. v2 keeps it.
//   For that reason, MDC_v2 does NOT call primSectionHeader / primBodyRow.
//   It writes labels directly. Other v2 writers (BOM, ProjectCard, RFQ) will
//   use the primitive grid where appropriate.
//
// CALLED BY
//   - setupAllV2Templates(ss) in templates/TemplateRegistry.gs (Chunk 0)
//   - runArgiaEngine() (Step 10-v2) once per engine run
//   - resetOutputs() (Chunk 12, when built)
//
// DEPENDENCIES
//   - V2_SHEETS.MDC ('MDC_v2')  -- templates/TemplateRegistry.gs
//   - MDC_ROW, MDC_COL          -- 00_Main.js (shared with legacy MDC)
//   - token, tokenNum, loadDesignTokens, resetDesignTokenCache_  -- 02a
//   - _insertArgiaLogo          -- 02e_InputSetup.js (shared helper)
// =============================================================================


function setupMdcTemplate(ss, opts) {
  ss = ss || SpreadsheetApp.getActive();
  opts = opts || {};
  resetDesignTokenCache_();
  loadDesignTokens(ss);

  // sheetName override exists so integration tests can target a scratch sheet
  // (e.g. '_MDC_v2_TEST_xyz') without touching the live MDC_v2 the engine
  // writes to. Production callers (Step 10-v2, resetOutputs) omit opts and
  // get the canonical V2_SHEETS.MDC name.
  var sheetName = opts.sheetName || V2_SHEETS.MDC;
  var sh = ss.getSheetByName(sheetName);
  if (!sh) {
    sh = ss.insertSheet(sheetName);
  } else {
    // Idempotent refresh: wipe everything to a clean slate, then re-render.
    // We don't deleteSheet+insertSheet because that breaks chart references
    // and reorders the tab. clear() preserves the tab; clearConditionalFormatRules
    // prevents duplicate CF rules accumulating across re-runs.
    sh.clear();
    sh.clearConditionalFormatRules();
    sh.setHiddenGridlines(false);  // reset before re-applying below
  }

  // ---- Canvas --------------------------------------------------------------
  sh.setHiddenGridlines(true);
  sh.setColumnWidth(1,  25);   // A — margin
  sh.setColumnWidth(2, 360);   // B — label
  sh.setColumnWidth(3, 220);   // C — value
  sh.setColumnWidth(4,  60);   // D — unit
  sh.setColumnWidth(5, 130);   // E — STATUS (PASS/FAIL/REVIEW)
  sh.setColumnWidth(6, 200);   // F — CITA NOM
  sh.setColumnWidth(7, 320);   // G — FÓRMULA / NOTA
  sh.setColumnWidth(8,  25);   // H — margin

  // ---- Banner (rows 1-3) ---------------------------------------------------
  // Logo at B2, title at C2, subtitle at C3. We don't merge title/subtitle
  // across D-G because the engine writes audit info into those cols in some
  // legacy code paths (kept for compat in case we miss one).
  _insertArgiaLogo(sh, 2, 2);
  sh.getRange(MDC_ROW.BANNER_TITLE, 3)
    .setValue('MEMORIA DE CÁLCULO')
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_TITLE'))
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontColor(token('TEXT_PRIMARY'))
    .setVerticalAlignment('bottom');
  sh.getRange(MDC_ROW.BANNER_SUBTITLE, 3)
    .setValue('MDC v2 · Secuencia técnica ligada al ENGINE')
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontColor(token('TEXT_SECONDARY'));
  sh.setRowHeight(MDC_ROW.BANNER_TITLE, tokenNum('ROW_H_TITLE'));

  // ---- Column header row (row 4) -------------------------------------------
  var headers = ['', 'DESCRIPCIÓN', 'VALOR', 'UNIDAD', 'ESTADO',
                 'CITA NOM', 'FÓRMULA / NOTA', ''];
  sh.getRange(MDC_ROW.COLUMN_HEADERS, 1, 1, 8)
    .setValues([headers])
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontColor(token('TEXT_SECONDARY'))
    .setBackground(token('BG_PAGE'))
    .setVerticalAlignment('middle');
  sh.getRange(MDC_ROW.COLUMN_HEADERS, 1, 1, 8).setBorder(
    null, null, true, null, null, null,
    token('DIVIDER_LINE'), SpreadsheetApp.BorderStyle.SOLID
  );
  sh.setRowHeight(MDC_ROW.COLUMN_HEADERS, 22);

  // ---- Body row labels (col B) + units (col D) -----------------------------
  // Mirrors 02e_InputSetup.js:1464+ exactly so v2 parity with legacy.
  // §7 BESS labels are added here as a single block (the legacy version had
  // them spread across writer + template; we consolidate in the template).
  var bodyRows = [
    // §0 GENERALES
    [MDC_ROW.PROJECT,         'Proyecto',                                             ''],
    [MDC_ROW.CLIENT,          'Cliente',                                              ''],
    [MDC_ROW.MODULE,          'Módulo fotovoltaico',                                  ''],
    [MDC_ROW.INVERTER,        'Inversor',                                             ''],
    [MDC_ROW.QTY_MODULES,     'No. de módulos',                                       'pcs'],
    [MDC_ROW.QTY_INVERTERS,   'No. de inversores',                                    'pcs'],
    [MDC_ROW.MODS_PER_STRING, 'Módulos por string',                                   'pcs'],
    [MDC_ROW.STRINGS_PER_INV, 'Strings por inversor',                                 'strings'],
    [MDC_ROW.DC_KW,           'Potencia DC instalada',                                'kWdc'],
    [MDC_ROW.AC_KW,           'Potencia AC instalada',                                'kWac'],
    [MDC_ROW.DC_AC_RATIO,     'Relación DC/AC',                                       'x'],
    [MDC_ROW.AC_VOLTAGE,      'Tensión AC de inversor',                               'V'],
    // §1.0 MEMORIA DC
    [MDC_ROW.ISC,             'Isc del módulo',                                       'A'],
    [MDC_ROW.I_DESIGN,        'Corriente de diseño = Isc × 1.5625',                   'A'],
    [MDC_ROW.FT_DC,           'Ft por temperatura DC',                                ''],
    [MDC_ROW.FAG_DC,          'Fag por agrupamiento DC',                              ''],
    [MDC_ROW.AMP_REQ_DC,      'Ampacidad requerida conductor DC',                     'A'],
    [MDC_ROW.COND_DC,         'Conductor DC seleccionado',                            'AWG'],
    [MDC_ROW.AREA_DC,         'Área Cu conductor DC',                                 'mm²'],
    [MDC_ROW.OCPD_DC,         'Protección DC por cadena',                             'A'],
    [MDC_ROW.EGC_DC,          'Conductor puesta a tierra DC',                         'AWG'],
    [MDC_ROW.VDROP_DC,        'Caída de tensión DC estimada',                         '%'],
    [MDC_ROW.CONDUIT_DC,      'Conduit DC seleccionado',                              'in'],
    [MDC_ROW.RESULT_DC,       'Resultado sección DC',                                 ''],
    // §1.1 VALIDACION VOLTAJE
    [MDC_ROW.VOC_COLD,        'Voc corregido por temperatura fría',                   'V'],
    [MDC_ROW.VMP_HOT,         'Vmp corregido por temperatura caliente',               'V'],
    [MDC_ROW.MIN_MODS,        'Mín. módulos por string',                              'pcs'],
    [MDC_ROW.MAX_MODS,        'Máx. módulos por string',                              'pcs'],
    [MDC_ROW.ACTUAL_MODS,     'Módulos realmente usados por string',                  'pcs'],
    [MDC_ROW.CHECK_WINDOW,    'Revisión ventana de string',                           ''],
    [MDC_ROW.CHECK_DC_LIMIT,  'Revisión límite DC del inversor',                      ''],
    [MDC_ROW.STR03_MPPT,      'Corriente MPPT de operación (STR-03/DC-09)',           ''],
    // §2 SALIDA AC POR INVERSOR
    [MDC_ROW.I_AC_NOM,        'Corriente nominal AC por inversor',                    'A'],
    [MDC_ROW.OCPD_AC_INV,     'Protección AC por inversor',                           'A'],
    [MDC_ROW.FT_AC,           'Ft por temperatura AC',                                ''],
    [MDC_ROW.FAG_AC,          'Fag por agrupamiento AC',                              ''],
    [MDC_ROW.AMP_REQ_AC,      'Ampacidad requerida AC',                               'A'],
    [MDC_ROW.COND_AC,         'Conductor AC por inversor',                            'AWG'],
    [MDC_ROW.AREA_AC,         'Área Cu conductor AC',                                 'mm²'],
    [MDC_ROW.EGC_AC,          'Conductor puesta a tierra AC',                         'AWG'],
    [MDC_ROW.VDROP_AC,        'Caída de tensión AC por inversor',                     '%'],
    [MDC_ROW.CONDUIT_AC,      'Conduit AC por inversor',                              'in'],
    [MDC_ROW.RESULT_AC,       'Resultado salida AC por inversor',                     ''],
    // §3 ALIMENTADOR PRINCIPAL
    [MDC_ROW.I_TOTAL_AC,      'Corriente total AC',                                   'A'],
    [MDC_ROW.MAIN_BREAKER,    'Breaker principal',                                    'A'],
    [MDC_ROW.PARALLEL_RUNS,   'Corridas en paralelo por fase',                        'runs'],
    [MDC_ROW.I_PER_RUN,       'Corriente por corrida',                                'A'],
    [MDC_ROW.COND_MAIN,       'Conductor principal',                                  'AWG'],
    [MDC_ROW.AREA_MAIN,       'Área Cu conductor principal',                          'mm²'],
    [MDC_ROW.EGC_MAIN,        'Conductor puesta a tierra principal',                  'AWG'],
    [MDC_ROW.VDROP_FEEDER,    'Caída de tensión alimentador',                         '%'],
    [MDC_ROW.CONDUIT_MAIN,    'Conduit principal',                                    'in'],
    [MDC_ROW.APPARENT_REQ,    'Potencia aparente requerida (con 20% margen)',         'kVA'],
    [MDC_ROW.TRANSFORMER,     'Transformador recomendado',                            'kVA'],
    [MDC_ROW.RESULT_FEEDER,   'Resultado alimentador principal',                      ''],
    // §4 BANDERAS
    [MDC_ROW.FLAG_LAYOUT,     'Layout módulos / strings / inversores',                ''],
    [MDC_ROW.FLAG_WINDOW,     'Ventana de string',                                    ''],
    [MDC_ROW.FLAG_DC_LIMIT,   'Límite DC del inversor',                               ''],
    [MDC_ROW.FLAG_FINAL,      'Criterio de emisión final',                            ''],
    // §5 SUPUESTOS
    [MDC_ROW.TEMP_MIN,        'Temp. mínima de sitio',                                '°C'],
    [MDC_ROW.TEMP_MAX,        'Temp. ambiente máxima',                                '°C'],
    [MDC_ROW.ROOF_CLEARANCE,  'Separación sobre azotea',                              'mm'],
    [MDC_ROW.LEN_DC,          'Longitud DC promedio por string (auto)',               'm'],
    [MDC_ROW.LEN_AC,          'Longitud AC por inversor (auto)',                      'm'],
    [MDC_ROW.LEN_FEEDER,      'Longitud alimentador principal (auto)',                'm'],
    [MDC_ROW.POWER_FACTOR,    'Factor de potencia objetivo',                          ''],
    // §7 BESS — labels in the template (not the writer, unlike legacy)
    [MDC_ROW.BESS_MODEL,      'Batería: producto / estrategia',                       ''],
    [MDC_ROW.BESS_CAPACITY,   'Capacidad nominal',                                    'kWh'],
    [MDC_ROW.BESS_POWER,      'Potencia nominal',                                     'kW'],
    [MDC_ROW.BESS_USABLE,     'Capacidad usable (calculada)',                         'kWh'],
    [MDC_ROW.BESS_COUPLING,   'Topología de acoplamiento',                            ''],
    [MDC_ROW.BESS_CIRC_STAT,  'Estado dimensionamiento de circuito BESS',             ''],
    [MDC_ROW.BESS_CIRC_RUN1,  'Circuito BESS — run 1 (DC)',                           ''],
    [MDC_ROW.BESS_CIRC_RUN2,  'Circuito BESS — run 2 (AC, sólo AC-coupled)',          ''],
    [MDC_ROW.BESS_BUSBAR,     'Verificación regla 120% de barra',                     ''],
    [MDC_ROW.BESS_NOM_CITE,   'Referencia normativa BESS',                            '']
  ];

  bodyRows.forEach(function(rl) {
    var r = rl[0];
    sh.getRange(r, 2).setValue(rl[1])
      .setFontFamily(token('FONT_FAMILY'))
      .setFontSize(tokenNum('FONT_SIZE_BODY'))
      .setFontColor(token('TEXT_PRIMARY'))
      .setVerticalAlignment('middle');
    if (rl[2]) {
      sh.getRange(r, 4).setValue(rl[2])
        .setFontFamily(token('FONT_FAMILY'))
        .setFontSize(tokenNum('FONT_SIZE_BODY'))
        .setFontColor(token('TEXT_SECONDARY'))
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle');
    }
    sh.setRowHeight(r, tokenNum('ROW_H_BODY'));
  });

  // ---- Wrap long multi-line cells -----------------------------------------
  var wrapRows = [
    MDC_ROW.CHECK_WINDOW,
    MDC_ROW.CHECK_DC_LIMIT,
    MDC_ROW.STR03_MPPT,
    MDC_ROW.RESULT_AC
  ];
  wrapRows.forEach(function(r) {
    sh.getRange(r, 3).setWrap(true).setVerticalAlignment('middle');
    sh.getRange(r, 5).setWrap(true).setVerticalAlignment('middle');
  });

  // ---- Mute audit columns (F citation, G formula) -------------------------
  // Rows 6–110 covers §0 through end of §7 (BESS_NOM_CITE).
  var muteRange = sh.getRange(6, 6, MDC_ROW.BESS_NOM_CITE - 6 + 1, 2);
  muteRange
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontColor(token('TEXT_MUTED'))
    .setVerticalAlignment('top');

  // ---- Section headers -----------------------------------------------------
  var sectionHeaders = [
    [MDC_ROW.SEC0_HEADER,     '0. GENERALES DEL SISTEMA'],
    [MDC_ROW.SEC1_HEADER,     '1.0 MEMORIA DE CÁLCULO DC'],
    [MDC_ROW.SEC11_HEADER,    '1.1 VALIDACIÓN DE VOLTAJE DE STRING'],
    [MDC_ROW.SEC2_HEADER,     '2.0 SALIDA AC POR INVERSOR'],
    [MDC_ROW.SEC3_HEADER,     '3.0 TABLERO AC / ALIMENTADOR PRINCIPAL'],
    [MDC_ROW.SEC4_HEADER,     '4.0 BANDERAS DE REVISIÓN Y EMISIÓN'],
    [MDC_ROW.SEC5_HEADER,     '5.0 SUPUESTOS CLAVE DE DISEÑO'],
    [MDC_ROW.SEC55_HEADER,    '5.5 REFERENCIAS A PLANOS / DOCUMENTOS DE DISEÑO'],
    [MDC_ROW.SEC6_HEADER,     '6.0 LAYOUT / ESCALADO DE PLANTA'],
    [MDC_ROW.SEC7_HEADER,     '7.0 ALMACENAMIENTO / BATERÍA (BESS)']
  ];
  sectionHeaders.forEach(function(pair) {
    var r = pair[0];
    sh.getRange(r, 2).setValue(pair[1])
      .setFontFamily(token('FONT_FAMILY'))
      .setFontSize(tokenNum('FONT_SIZE_SECTION'))
      .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
      .setFontColor(token('TEXT_PRIMARY'))
      .setVerticalAlignment('middle')
      .setHorizontalAlignment('left');
    sh.getRange(r, 2, 1, 7)
      .setBackground(token('BG_INPUT_CELL'))
      .setFontFamily(token('FONT_FAMILY'))
      .setFontSize(tokenNum('FONT_SIZE_SECTION'))
      .setVerticalAlignment('middle');
    sh.setRowHeight(r, tokenNum('ROW_H_SECTION'));
    sh.getRange(r, 2, 1, 7).setBorder(
      null, null, true, null, null, null,
      token('DIVIDER_LINE'), SpreadsheetApp.BorderStyle.SOLID
    );
  });

  // ---- Footer row heights --------------------------------------------------
  sh.setRowHeight(MDC_ROW.LEGEND, 18);
  sh.setRowHeight(MDC_ROW.TIMESTAMP, 18);

  // ---- Conditional formatting on col E (STATUS) ---------------------------
  // Bold-only rules for PASS / REVIEW / FAIL keywords (icon prefix carries color).
  // We DROP existing CF rules first so re-runs don't accumulate duplicates.
  var statusRange = sh.getRange(6, 5, MDC_ROW.BESS_NOM_CITE - 6 + 1, 1);
  var rules = []; // cleared by clearConditionalFormatRules() above; build fresh
  ['FAIL', 'BLOQUEADO', 'REVIEW', 'OBSERVATIONS', 'PASS', 'OK'].forEach(function(kw) {
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains(kw)
      .setBold(true)
      .setRanges([statusRange])
      .build());
  });
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('EMITTABLE')
    .setBold(true)
    .setRanges([statusRange])
    .build());
  sh.setConditionalFormatRules(rules);

  // Style col E base formatting (font + alignment)
  statusRange
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_BODY'))
    .setVerticalAlignment('middle')
    .setHorizontalAlignment('left');

  // ---- Freeze --------------------------------------------------------------
  sh.setFrozenRows(5);     // banner (1-3) + col headers (4) + emission status (5)
  sh.setFrozenColumns(2);  // margin + label always visible

  return sh;
}
