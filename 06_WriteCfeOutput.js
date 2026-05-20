// =============================================================================
// ARGIA ENGINE -- 06_WriteCfeOutput.gs   (Increment 4b-2.5d)
// =============================================================================
// PURPOSE
//   Render the CFE_OUTPUT tab: a customer-facing economic-impact view that
//   compares the CFE bill in three states -- Sin PV, Con PV, Con PV + BESS --
//   built ENTIRELY from values already computed by the live spreadsheet
//   formulas in INPUT_CFE, CFE_SIMULATION, and BESS_SIMULATION.
//
//   This module is a RENDERER, not a calculator. The math lives in the
//   sheets. If those sheets are right, CFE_OUTPUT is right. If a future
//   audit changes the math in CFE_SIMULATION, CFE_OUTPUT picks it up
//   automatically without a code change.
//
// SOURCES OF TRUTH  (cell map -- single point of fix if rows ever shift)
//   INPUT_CFE        rows 5-8     header strip (tariff code, service, FP, ...)
//                    rows 10-15   monthly kWh / kW (sin PV baseline)
//                    row  20      Demanda Facturable
//                    row  35      Facturación mensual (sin PV)
//                    row  37      TOTAL mensual (sin PV)
//                    rows 40-43   Interconnection mode / export / autoconsumo / FP umbral
//
//   CFE_SIMULATION   rows 5-7     monthly kWh after PV (post-displacement)
//                    row  8       monthly PV kWh generated
//                    row  35      Facturación mensual (con PV)
//                    row  37      TOTAL mensual (con PV)
//                    row  41      ENERGY SAVINGS monthly (con PV vs sin PV)
//                    row  42      PV Exportado kWh monthly
//
//   BESS_SIMULATION  rows 6-8     mode / strategy / demand provenance
//                    row  12      Recibo CFE base (annual, sin PV ni BESS)
//                    row  13      Ahorro PV -- energia (annual)
//                    row  14      Recibo despues de PV (annual)
//                    rows 15-17   Ahorro BESS Capacidad/Distribucion/Variable (annual)
//                    row  18      RECIBO CFE FINAL (annual, PV + BESS)
//                    rows 25-27   Dmax sin/shaving/con BESS monthly (kW)
//                    rows 30-32   Ahorro BESS Capacidad/Distribucion/Variable monthly
//                    rows 36-41   battery spec panel + annual savings
//
// SAFETY -- ROW DRIFT
//   The source rows above are READ BY INDEX. If INPUT_CFE or
//   CFE_SIMULATION or BESS_SIMULATION ever insert/delete rows, the indices
//   below silently point at the wrong cells. Two defenses:
//     1. The SRC map (next constant) is the ONLY place row numbers appear
//        in this file. Fix here, fix everywhere.
//     2. Phase 19 (99t_Phase19_WriteCfeOutput.gs) asserts the LABEL TEXT
//        in column B of each source sheet matches what we expect. If a
//        row shifts, Phase 19 fails LOUDLY on the label assertion before
//        any wrong number is rendered.
//
// LIFECYCLE
//   - writeCfeOutput(ss) is called from runArgiaEngine Step 13.5
//   - Wrapped in try/catch so a render bug never breaks the rest of the
//     pipeline (PDF export, etc.) -- matches the BESS Step 9.5 pattern.
//   - Recreates the CFE_OUTPUT tab from scratch each call. Manual
//     annotations in CFE_OUTPUT do NOT survive engine reruns (per spec).
// =============================================================================

// Source-cell map. Sheet + 1-based row (col is always C..N for monthly bands,
// D for annual scalars on BESS_SIM, or specific col for header strip).
// Update this map and ONLY this map when a source row shifts.
var CFE_OUT_SRC = {
  // INPUT_CFE header strip (rows 4-7 in actual layout — auditing showed the
  // map was off-by-one and reading from the wrong columns. Corrected against
  // the live OASIS LATINOAMERICA sheet on 2026-05-20.)
  //   B4 'TARIFF CODE:'      -> C4  ('GDMTH')
  //   E4 'SERVICE NAME:'     -> F4  ('OASIS LATINOAMERICA S RL CV')
  //   B5 'TARIFF LOCATION:'  -> C5  ('GOLFO CENTRO')      [unused in header strip]
  //   E5 'SERVICE NUMBER:'   -> F5  (414240911417)
  //   B6 'TARIFF DAP:'       -> C6  (0.0)                 [unused in header strip]
  //   E6 'CONTRACTED DEMAND:'-> F6  (1620)
  //   B7 '2% BAJA TENSION:'  -> C7  ('NO')
  input_tariffCode      : { sheet: 'INPUT_CFE',      row:  4, col:  3 },  // C4
  input_serviceName     : { sheet: 'INPUT_CFE',      row:  4, col:  6 },  // F4
  input_serviceNumber   : { sheet: 'INPUT_CFE',      row:  5, col:  6 },  // F5
  input_contractedKw    : { sheet: 'INPUT_CFE',      row:  6, col:  6 },  // F6
  input_2pctBT          : { sheet: 'INPUT_CFE',      row:  7, col:  3 },  // C7 ("YES"/"NO")

  // INPUT_CFE monthly bands (cols C..N = months Ene..Dic)
  input_kwhBase         : { sheet: 'INPUT_CFE',      row: 10 },
  input_kwhInter        : { sheet: 'INPUT_CFE',      row: 11 },
  input_kwhPunta        : { sheet: 'INPUT_CFE',      row: 12 },
  input_demandaFact     : { sheet: 'INPUT_CFE',      row: 19 },  // was 20 -- B20 = "FP %"
  input_facturacion     : { sheet: 'INPUT_CFE',      row: 35 },
  input_total           : { sheet: 'INPUT_CFE',      row: 37 },

  // INPUT_CFE PV interconnection settings (col C)
  // Audit 2026-05-20: actual layout is one row LOWER than the original map.
  // Real layout:
  //   B39 'PV INTERCONNECTION' (section header)
  //   B41 'MODO INTERCONEXIÓN:'      C41 ('MEDICION_NETA')
  //   B42 'PRECIO EXPORTACIÓN MXN/kWh:'  C42 (0.8)
  //   B43 'AUTOCONSUMO %:'           C43 (blank — uses calcCfeBillWithPv default)
  //   B44 'UMBRAL FACTOR POTENCIA:'  C44 (0.9)
  // Previous map pointed at C40-C43 which read the wrong rows -- e.g.
  // autoconsumoPct was reading the export-price cell (0.8), explaining the
  // "80% autoconsumo" anomaly seen in CFE_OUTPUT header.
  input_interconnMode   : { sheet: 'INPUT_CFE',      row: 41, col:  3 },  // C41
  input_exportPrice     : { sheet: 'INPUT_CFE',      row: 42, col:  3 },  // C42
  input_autoconsumoPct  : { sheet: 'INPUT_CFE',      row: 43, col:  3 },  // C43
  input_fpUmbral        : { sheet: 'INPUT_CFE',      row: 44, col:  3 },  // C44

  // CFE_SIMULATION monthly bands
  csim_kwhBaseAfterPv   : { sheet: 'CFE_SIMULATION', row:  5 },
  csim_kwhInterAfterPv  : { sheet: 'CFE_SIMULATION', row:  6 },
  csim_kwhPuntaAfterPv  : { sheet: 'CFE_SIMULATION', row:  7 },
  csim_solarKwh         : { sheet: 'CFE_SIMULATION', row:  8 },
  csim_facturacion      : { sheet: 'CFE_SIMULATION', row: 37 },  // was 35 -- B35 = "Subtotal"
  csim_total            : { sheet: 'CFE_SIMULATION', row: 39 },  // was 37 -- B37 = "Facturacion"; TOTAL below
  csim_energySavings    : { sheet: 'CFE_SIMULATION', row: 41 },
  csim_pvExportado      : { sheet: 'CFE_SIMULATION', row: 42 },

  // BESS_SIMULATION header scalars (col D)
  bsim_mode             : { sheet: 'BESS_SIMULATION', row:  6, col:  4 }, // D6
  bsim_strategy         : { sheet: 'BESS_SIMULATION', row:  7, col:  4 }, // D7
  bsim_demandProv       : { sheet: 'BESS_SIMULATION', row:  8, col:  4 }, // D8

  // BESS_SIMULATION annual waterfall (col D scalars)
  bsim_reciboBase       : { sheet: 'BESS_SIMULATION', row: 12, col:  4 }, // D12
  bsim_ahorroPv         : { sheet: 'BESS_SIMULATION', row: 13, col:  4 }, // D13
  bsim_reciboTrasPv     : { sheet: 'BESS_SIMULATION', row: 14, col:  4 }, // D14
  bsim_ahorroBessCap    : { sheet: 'BESS_SIMULATION', row: 15, col:  4 }, // D15
  bsim_ahorroBessDist   : { sheet: 'BESS_SIMULATION', row: 16, col:  4 }, // D16
  bsim_ahorroBessVar    : { sheet: 'BESS_SIMULATION', row: 17, col:  4 }, // D17
  bsim_reciboFinal      : { sheet: 'BESS_SIMULATION', row: 18, col:  4 }, // D18

  // BESS_SIMULATION monthly bands
  bsim_dmaxSinBess      : { sheet: 'BESS_SIMULATION', row: 25 },
  bsim_potShaving       : { sheet: 'BESS_SIMULATION', row: 26 },
  bsim_dmaxConBess      : { sheet: 'BESS_SIMULATION', row: 27 },
  bsim_ahorroMesCap     : { sheet: 'BESS_SIMULATION', row: 30 },
  bsim_ahorroMesDist    : { sheet: 'BESS_SIMULATION', row: 31 },
  bsim_ahorroMesVar     : { sheet: 'BESS_SIMULATION', row: 32 },

  // BESS_SIMULATION battery spec panel
  bsim_energiaUsable    : { sheet: 'BESS_SIMULATION', row: 36, col:  4 },
  bsim_potenciaKw       : { sheet: 'BESS_SIMULATION', row: 37, col:  4 },
  bsim_horasPunta       : { sheet: 'BESS_SIMULATION', row: 38, col:  4 },
};


// Read a scalar source cell. Returns the raw value (may be number, string,
// or empty). Never throws -- a missing sheet just returns ''.
function _cfeOutReadScalar(ss, srcKey) {
  var src = CFE_OUT_SRC[srcKey];
  if (!src) {
    throw new Error('CFE_OUT_SRC missing key: ' + srcKey);
  }
  var sh = ss.getSheetByName(src.sheet);
  if (!sh) return '';
  return sh.getRange(src.row, src.col || 1).getValue();
}

// Read a 12-cell monthly band (cols C..N = 3..14). Returns array of 12.
function _cfeOutReadMonthly(ss, srcKey) {
  var src = CFE_OUT_SRC[srcKey];
  if (!src) {
    throw new Error('CFE_OUT_SRC missing key: ' + srcKey);
  }
  var sh = ss.getSheetByName(src.sheet);
  if (!sh) return [0,0,0,0,0,0,0,0,0,0,0,0];
  // 1 row, 12 cols starting at C (col 3)
  var vals = sh.getRange(src.row, 3, 1, 12).getValues()[0];
  return vals;
}


// =============================================================================
// LAYOUT CONSTANTS (CFE_OUTPUT row numbers)
// =============================================================================
var CFE_OUT_ROW = {
  // Banner (rows 1-3 reserved by _insertArgiaLogo + title)
  TARIFF_HEADER       : 5,   // "TARIFF CODE" label row
  LOCATION_ROW        : 6,
  INTERCONN_ROW       : 7,
  BESS_SPEC_ROW       : 8,
  KPI_HEADLINE        : 10,  // big 3-number strip
  // Section 1 (Con PV)
  SEC1_HEADER         : 12,
  SEC1_MONTHHDR       : 13,
  SEC1_KWH_NETO       : 14,
  SEC1_SOLAR_KWH      : 15,
  SEC1_EXPORTADO      : 16,
  SEC1_DEMANDA        : 17,
  SEC1_FACTURACION    : 18,
  SEC1_TOTAL          : 19,
  SEC1_AHORRO         : 20,
  // Section 2 (Con PV + BESS)
  SEC2_HEADER         : 22,
  SEC2_MONTHHDR       : 23,
  SEC2_DMAX_SIN       : 24,
  SEC2_POT_SHAVING    : 25,
  SEC2_DMAX_CON       : 26,
  SEC2_AHORRO_CAP     : 27,
  SEC2_AHORRO_DIST    : 28,
  SEC2_AHORRO_VAR     : 29,
  SEC2_AHORRO_TOTAL   : 30,
  SEC2_RECIBO_FINAL   : 31,
  // Annual footer (keep per user)
  FOOTER_HEADER       : 33,
  FOOTER_LABELS       : 34,
  FOOTER_VALUES       : 35,
  // Charts band
  CHART1_TOP          : 38,  // waterfall
  CHART2_TOP          : 53,  // monthly comparison
  CHART3_TOP          : 68,  // demand shaving
};

// Column constants (1-based)
var CFE_OUT_COL = {
  LABEL : 2,    // B
  MONTH_START : 3,  // C = Ene .. N = Dic
};

// Month abbreviations -- match INPUT_CFE/CFE_SIM convention
var CFE_OUT_MONTHS = ['Ene','Feb','Mar','Abr','May','Jun',
                      'Jul','Ago','Sep','Oct','Nov','Dic'];


// =============================================================================
// PUBLIC: writeCfeOutput(ss)
// =============================================================================
// Renders the CFE_OUTPUT tab from scratch. Reads INPUT_CFE / CFE_SIMULATION /
// BESS_SIMULATION cells via CFE_OUT_SRC. Adds three charts. Idempotent --
// safe to call repeatedly; each call wipes and rebuilds.
function writeCfeOutput(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();

  // -- Design tokens: every renderer that uses token()/tokenNum() must load
  // -- them first. Same pattern as setupInputProject / setupInputCFE etc.
  // -- Without these two lines, the FIRST call to token() throws
  // -- "Design tokens not loaded" (which is what crashed the v1 writer).
  resetDesignTokenCache_();
  loadDesignTokens(ss);

  // -- 1. Required source sheets must exist (read-only consumer). ----------
  var required = [SH.INPUT_CFE, SH.CFE_SIM, SH.BESS_SIM];
  for (var i = 0; i < required.length; i++) {
    if (!ss.getSheetByName(required[i])) {
      throw new Error('writeCfeOutput: required source sheet "'
        + required[i] + '" not found.');
    }
  }

  // -- 2. Wipe and recreate CFE_OUTPUT. ------------------------------------
  var existing = ss.getSheetByName(SH.CFE_OUTPUT);
  if (existing) ss.deleteSheet(existing);
  var sh = ss.insertSheet(SH.CFE_OUTPUT);

  // -- 3. Canvas: 15 columns, widths matched to INPUT_CFE. -----------------
  // A=margin, B=label, C..N=12 months, O=spacer/total, P=right margin
  sh.setHiddenGridlines(true);
  var widths = [25, 260, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 90, 25];
  widths.forEach(function(w, idx) { sh.setColumnWidth(idx + 1, w); });

  // -- 4. Banner (rows 1-3) -- ARGIA logo + title, same helpers as INPUT_CFE.
  _insertArgiaLogo(sh, 2, 2);
  _writeTitleShifted(sh, 2, 'CFE OUTPUT',
    'Impacto economico: Sin PV  vs  Con PV  vs  Con PV + BESS');

  // -- 5. Header strip (rows 5-8) -- tariff + service + BESS context. ------
  _cfeOutWriteHeaderStrip(sh, ss);

  // -- 6. KPI headline (row 10) -- 3 big numbers. --------------------------
  _cfeOutWriteKpiStrip(sh, ss);

  // -- 7. Section 1: Con PV (rows 12-20). ----------------------------------
  _cfeOutWriteSection1(sh, ss);

  // -- 8. Section 2: Con PV + BESS (rows 22-31). ---------------------------
  _cfeOutWriteSection2(sh, ss);

  // -- 9. Annual footer (rows 33-35). --------------------------------------
  _cfeOutWriteFooter(sh, ss);

  // -- 10. Charts (rows 38+). ----------------------------------------------
  _cfeOutBuildCharts(sh);

  // -- 11. Freeze banner + header strip so they stay visible on scroll. ----
  // NOTE: setFrozenColumns(2) was removed -- the KPI strip on row 10 has
  // merged ranges starting at col B that span across the freeze line, which
  // Sheets rejects with "you can't freeze columns which contain only part
  // of a merged cell". Vertical freeze alone is sufficient (banner + KPIs
  // stay visible when scrolling down through the monthly tables).
  sh.setFrozenRows(10);

  SpreadsheetApp.flush();
  return sh;
}


// =============================================================================
// HEADER STRIP (rows 5-8)
// =============================================================================
// Mirrors INPUT_CFE's tariff/service header but adds a 4th row for the BESS
// spec snapshot. Two label-value pairs per row (col B label, col C value;
// col F label, col H value).
function _cfeOutWriteHeaderStrip(sh, ss) {
  var FF = token('FONT_FAMILY');
  var FS = tokenNum('FONT_SIZE_BODY');
  var EMPH = token('FONT_WEIGHT_EMPHASIS');
  var TXT = token('TEXT_PRIMARY');

  function lbl(row, col, text) {
    sh.getRange(row, col).setValue(text)
      .setFontFamily(FF).setFontSize(FS)
      .setFontColor(TXT).setHorizontalAlignment('right');
  }
  function val(row, col, value) {
    sh.getRange(row, col).setValue(value)
      .setFontFamily(FF).setFontSize(FS)
      .setFontColor(TXT).setFontWeight(EMPH);
  }

  // Row 5
  lbl(5, 2, 'TARIFF CODE');
  val(5, 3, _cfeOutReadScalar(ss, 'input_tariffCode'));
  lbl(5, 8, 'SERVICE NAME');
  val(5, 10, _cfeOutReadScalar(ss, 'input_serviceName'));

  // Row 6
  lbl(6, 2, 'SERVICE NUMBER');
  val(6, 3, _cfeOutReadScalar(ss, 'input_serviceNumber'));
  lbl(6, 8, 'CONTRACTED kW');
  val(6, 10, _cfeOutReadScalar(ss, 'input_contractedKw'));

  // Row 7
  lbl(7, 2, 'INTERCONEXION');
  val(7, 3, _cfeOutReadScalar(ss, 'input_interconnMode'));
  lbl(7, 8, 'AUTOCONSUMO %');
  val(7, 10, _cfeOutReadScalar(ss, 'input_autoconsumoPct'));

  // Row 8 -- BESS context
  lbl(8, 2, 'ESTRATEGIA BESS');
  val(8, 3, _cfeOutReadScalar(ss, 'bsim_strategy'));
  lbl(8, 8, 'BATERIA kWh / kW');
  var ekwh = _cfeOutReadScalar(ss, 'bsim_energiaUsable');
  var pkw  = _cfeOutReadScalar(ss, 'bsim_potenciaKw');
  val(8, 10, ekwh + ' kWh usable / ' + pkw + ' kW');

  sh.setRowHeight(5, tokenNum('ROW_H_BODY'));
  sh.setRowHeight(6, tokenNum('ROW_H_BODY'));
  sh.setRowHeight(7, tokenNum('ROW_H_BODY'));
  sh.setRowHeight(8, tokenNum('ROW_H_BODY'));
}


// =============================================================================
// KPI HEADLINE (row 10) -- three big numbers, color-coded
// =============================================================================
function _cfeOutWriteKpiStrip(sh, ss) {
  var FF = token('FONT_FAMILY');
  var EMPH = token('FONT_WEIGHT_EMPHASIS');

  var reciboBase  = Number(_cfeOutReadScalar(ss, 'bsim_reciboBase'))   || 0;
  var reciboPv    = Number(_cfeOutReadScalar(ss, 'bsim_reciboTrasPv')) || 0;
  var reciboFinal = Number(_cfeOutReadScalar(ss, 'bsim_reciboFinal')) || 0;

  function kpi(col, label, value, accent) {
    // Label cell (small, muted)
    sh.getRange(10, col, 1, 4).breakApart().merge()
      .setValue(label)
      .setFontFamily(FF)
      .setFontSize(tokenNum('FONT_SIZE_SMALL'))
      .setFontColor('#666666')
      .setHorizontalAlignment('left')
      .setVerticalAlignment('top')
      .setBackground(accent);
    // Value cell (overlaid via next-row trick? Sheets doesn't allow stacked
    // values in a merged cell, so we put value on row 10 by overwriting the
    // merge with value text on top + label below using a newline.)
    sh.getRange(10, col).setValue(label + '\n$' + _cfeOutFmt(value))
      .setFontFamily(FF)
      .setFontSize(tokenNum('FONT_SIZE_TITLE'))
      .setFontWeight(EMPH)
      .setFontColor(token('TEXT_PRIMARY'))
      .setVerticalAlignment('middle')
      .setWrap(true);
  }

  // Recibo sin PV -- neutral gray
  kpi(2,  'RECIBO ANUAL SIN PV',          reciboBase,  '#F5F3EE');
  // Recibo con PV -- light green
  kpi(7,  'RECIBO ANUAL CON PV',          reciboPv,    '#E8F5E9');
  // Recibo con PV+BESS -- darker green
  kpi(12, 'RECIBO ANUAL CON PV + BESS',   reciboFinal, '#C8E6C9');

  sh.setRowHeight(10, 60);
}


// =============================================================================
// SECTION 1: Bill with PV only (rows 12-20)
// =============================================================================
function _cfeOutWriteSection1(sh, ss) {
  var FF = token('FONT_FAMILY');
  var EMPH = token('FONT_WEIGHT_EMPHASIS');
  var R = CFE_OUT_ROW;

  // Section header
  sh.getRange(R.SEC1_HEADER, 2, 1, 13).breakApart().merge()
    .setValue('1.  RECIBO CON PV')
    .setFontFamily(FF)
    .setFontSize(tokenNum('FONT_SIZE_SECTION'))
    .setFontWeight(EMPH)
    .setFontColor(token('TEXT_PRIMARY'))
    .setBackground('#E3F2FD')
    .setVerticalAlignment('middle');
  sh.setRowHeight(R.SEC1_HEADER, tokenNum('ROW_H_SECTION'));

  // Month header row
  _cfeOutWriteMonthHeader(sh, R.SEC1_MONTHHDR);

  // Sum kWh after PV per month  =  CFE_SIM rows 5+6+7
  var kwhBase  = _cfeOutReadMonthly(ss, 'csim_kwhBaseAfterPv');
  var kwhInter = _cfeOutReadMonthly(ss, 'csim_kwhInterAfterPv');
  var kwhPunta = _cfeOutReadMonthly(ss, 'csim_kwhPuntaAfterPv');
  var kwhNeto = kwhBase.map(function(_, i) {
    return (Number(kwhBase[i])||0)
         + (Number(kwhInter[i])||0)
         + (Number(kwhPunta[i])||0);
  });

  // Annual savings vs sin PV  =  INPUT_CFE row 37  -  CFE_SIM row 37  (per month)
  var totalSinPv = _cfeOutReadMonthly(ss, 'input_total');
  var totalConPv = _cfeOutReadMonthly(ss, 'csim_total');
  var ahorroPv = totalSinPv.map(function(_, i) {
    return (Number(totalSinPv[i])||0) - (Number(totalConPv[i])||0);
  });

  _cfeOutWriteRow(sh, R.SEC1_KWH_NETO,    'Consumo neto (kWh)',          kwhNeto,                                    'kwh');
  _cfeOutWriteRow(sh, R.SEC1_SOLAR_KWH,   'kWh solares generados',       _cfeOutReadMonthly(ss, 'csim_solarKwh'),    'kwh');
  _cfeOutWriteRow(sh, R.SEC1_EXPORTADO,   'kWh exportados a red',        _cfeOutReadMonthly(ss, 'csim_pvExportado'), 'kwh');
  _cfeOutWriteRow(sh, R.SEC1_DEMANDA,     'Demanda facturable (kW)',     _cfeOutReadMonthly(ss, 'input_demandaFact'),'kw');
  _cfeOutWriteRow(sh, R.SEC1_FACTURACION, 'Facturacion (MXN)',           _cfeOutReadMonthly(ss, 'csim_facturacion'), 'mxn');
  _cfeOutWriteRow(sh, R.SEC1_TOTAL,       'TOTAL mensual (MXN)',         totalConPv,                                 'mxn', true);
  _cfeOutWriteRow(sh, R.SEC1_AHORRO,      'Ahorro vs Sin PV (MXN)',      ahorroPv,                                   'mxn', true, '#E8F5E9');
}


// =============================================================================
// SECTION 2: Bill with PV + BESS (rows 22-31)
// =============================================================================
function _cfeOutWriteSection2(sh, ss) {
  var FF = token('FONT_FAMILY');
  var EMPH = token('FONT_WEIGHT_EMPHASIS');
  var R = CFE_OUT_ROW;

  sh.getRange(R.SEC2_HEADER, 2, 1, 13).breakApart().merge()
    .setValue('2.  RECIBO CON PV + BESS')
    .setFontFamily(FF)
    .setFontSize(tokenNum('FONT_SIZE_SECTION'))
    .setFontWeight(EMPH)
    .setFontColor(token('TEXT_PRIMARY'))
    .setBackground('#C8E6C9')
    .setVerticalAlignment('middle');
  sh.setRowHeight(R.SEC2_HEADER, tokenNum('ROW_H_SECTION'));

  _cfeOutWriteMonthHeader(sh, R.SEC2_MONTHHDR);

  var ahorroCap  = _cfeOutReadMonthly(ss, 'bsim_ahorroMesCap');
  var ahorroDist = _cfeOutReadMonthly(ss, 'bsim_ahorroMesDist');
  var ahorroVar  = _cfeOutReadMonthly(ss, 'bsim_ahorroMesVar');

  // Monthly BESS savings total -- sum of 3 lines
  var ahorroBessTotal = ahorroCap.map(function(_, i) {
    return (Number(ahorroCap[i])||0)
         + (Number(ahorroDist[i])||0)
         + (Number(ahorroVar[i])||0);
  });

  // Final monthly bill (PV+BESS) -- TOTAL con PV minus monthly BESS savings
  var totalConPv = _cfeOutReadMonthly(ss, 'csim_total');
  var reciboFinalMonthly = totalConPv.map(function(_, i) {
    return (Number(totalConPv[i])||0) - ahorroBessTotal[i];
  });

  _cfeOutWriteRow(sh, R.SEC2_DMAX_SIN,     'Dmax punta sin BESS (kW)',     _cfeOutReadMonthly(ss, 'bsim_dmaxSinBess'), 'kw');
  _cfeOutWriteRow(sh, R.SEC2_POT_SHAVING,  'Potencia de shaving (kW)',     _cfeOutReadMonthly(ss, 'bsim_potShaving'),  'kw');
  _cfeOutWriteRow(sh, R.SEC2_DMAX_CON,     'Dmax punta con BESS (kW)',     _cfeOutReadMonthly(ss, 'bsim_dmaxConBess'), 'kw');
  _cfeOutWriteRow(sh, R.SEC2_AHORRO_CAP,   'Ahorro Capacidad (MXN)',       ahorroCap,                                  'mxn');
  _cfeOutWriteRow(sh, R.SEC2_AHORRO_DIST,  'Ahorro Distribucion (MXN)',    ahorroDist,                                 'mxn');
  _cfeOutWriteRow(sh, R.SEC2_AHORRO_VAR,   'Ahorro Variable estim. (MXN)', ahorroVar,                                  'mxn');
  _cfeOutWriteRow(sh, R.SEC2_AHORRO_TOTAL, 'Ahorro BESS mensual TOTAL',    ahorroBessTotal,                            'mxn', true, '#C8E6C9');
  _cfeOutWriteRow(sh, R.SEC2_RECIBO_FINAL, 'Recibo final con BESS (MXN)',  reciboFinalMonthly,                         'mxn', true);
}


// =============================================================================
// ANNUAL FOOTER (rows 33-35)
// =============================================================================
function _cfeOutWriteFooter(sh, ss) {
  var FF = token('FONT_FAMILY');
  var EMPH = token('FONT_WEIGHT_EMPHASIS');
  var R = CFE_OUT_ROW;

  sh.getRange(R.FOOTER_HEADER, 2, 1, 13).breakApart().merge()
    .setValue('RESUMEN ANUAL  -  Cascada de ahorros')
    .setFontFamily(FF)
    .setFontSize(tokenNum('FONT_SIZE_SECTION'))
    .setFontWeight(EMPH)
    .setFontColor(token('TEXT_PRIMARY'))
    .setBackground('#F5F3EE');
  sh.setRowHeight(R.FOOTER_HEADER, tokenNum('ROW_H_SECTION'));

  var labels = ['Sin PV', 'Ahorro PV',           'Despues de PV',
                'Ahorro BESS',     'Recibo final con BESS'];
  var reciboBase    = Number(_cfeOutReadScalar(ss, 'bsim_reciboBase'))   || 0;
  var ahorroPv      = Number(_cfeOutReadScalar(ss, 'bsim_ahorroPv'))     || 0;
  var reciboTrasPv  = Number(_cfeOutReadScalar(ss, 'bsim_reciboTrasPv')) || 0;
  var ahorroBess    = (Number(_cfeOutReadScalar(ss, 'bsim_ahorroBessCap'))  || 0)
                    + (Number(_cfeOutReadScalar(ss, 'bsim_ahorroBessDist')) || 0)
                    + (Number(_cfeOutReadScalar(ss, 'bsim_ahorroBessVar'))  || 0);
  var reciboFinal   = Number(_cfeOutReadScalar(ss, 'bsim_reciboFinal'))  || 0;
  var values = [reciboBase, ahorroPv, reciboTrasPv, ahorroBess, reciboFinal];

  // Labels row 34, values row 35.  Each block spans cols 3-4, 5-6, 7-8, 9-10, 11-12.
  var blocks = [[3,4],[5,6],[7,8],[9,10],[11,12]];
  blocks.forEach(function(cr, i) {
    sh.getRange(R.FOOTER_LABELS, cr[0], 1, cr[1]-cr[0]+1).breakApart().merge()
      .setValue(labels[i])
      .setFontFamily(FF)
      .setFontSize(tokenNum('FONT_SIZE_SMALL'))
      .setFontColor('#666666')
      .setHorizontalAlignment('center');
    sh.getRange(R.FOOTER_VALUES, cr[0], 1, cr[1]-cr[0]+1).breakApart().merge()
      .setValue('$' + _cfeOutFmt(values[i]))
      .setFontFamily(FF)
      .setFontSize(tokenNum('FONT_SIZE_TITLE'))
      .setFontWeight(EMPH)
      .setFontColor(token('TEXT_PRIMARY'))
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
  });
  sh.setRowHeight(R.FOOTER_VALUES, 40);
}


// =============================================================================
// MONTH HEADER ROW
// =============================================================================
function _cfeOutWriteMonthHeader(sh, row) {
  var FF = token('FONT_FAMILY');
  sh.getRange(row, 2).setValue('Mes')
    .setFontFamily(FF)
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontColor('#666666')
    .setHorizontalAlignment('left');
  for (var i = 0; i < 12; i++) {
    sh.getRange(row, 3 + i).setValue(CFE_OUT_MONTHS[i])
      .setFontFamily(FF)
      .setFontSize(tokenNum('FONT_SIZE_SMALL'))
      .setFontColor('#666666')
      .setHorizontalAlignment('right');
  }
  sh.getRange(row, 2, 1, 13).setBorder(false, false, true, false,
                                       false, false, '#cccccc',
                                       SpreadsheetApp.BorderStyle.SOLID);
}


// =============================================================================
// MONTHLY DATA ROW -- label in col B, 12 values in cols C..N
// =============================================================================
function _cfeOutWriteRow(sh, row, label, values, fmt, bold, bg) {
  var FF = token('FONT_FAMILY');
  var labelCell = sh.getRange(row, 2);
  labelCell.setValue(label)
    .setFontFamily(FF)
    .setFontSize(tokenNum('FONT_SIZE_BODY'))
    .setFontColor(token('TEXT_PRIMARY'));
  if (bold) labelCell.setFontWeight('bold');

  var range = sh.getRange(row, 3, 1, 12);
  range.setValues([values.slice(0, 12)])
    .setFontFamily(FF)
    .setFontSize(tokenNum('FONT_SIZE_BODY'))
    .setFontColor(token('TEXT_PRIMARY'))
    .setHorizontalAlignment('right');

  if (fmt === 'mxn') range.setNumberFormat('"$"#,##0');
  else if (fmt === 'kw') range.setNumberFormat('#,##0');
  else if (fmt === 'kwh') range.setNumberFormat('#,##0');

  if (bold) range.setFontWeight('bold');
  if (bg) {
    sh.getRange(row, 2, 1, 13).setBackground(bg);
  }
}


// =============================================================================
// CHARTS
// =============================================================================
function _cfeOutBuildCharts(sh) {
  var R = CFE_OUT_ROW;

  // Chart 1: Waterfall  -- annual savings cascade.
  // Uses the annual footer values row 35, cols C/E/G/I/K.
  // Sheets has no native waterfall, but a column chart of 5 values reads as
  // a step-down sequence when accompanied by labels in row 34.
  var c1 = sh.newChart().asColumnChart()
    .addRange(sh.getRange(R.FOOTER_LABELS, 3, 2, 12))   // labels row 34 + values row 35
    .setPosition(R.CHART1_TOP, 2, 0, 0)
    .setOption('title', 'Cascada de ahorros (anual)')
    .setOption('legend', { position: 'none' })
    .setOption('width', 1100)
    .setOption('height', 280)
    .setOption('colors', ['#1976D2'])
    .setOption('hAxis', { textStyle: { fontSize: 11 } })
    .setOption('vAxis', { format: '$#,##0' })
    .build();
  sh.insertChart(c1);

  // Chart 2: Monthly bill comparison.  Three series across 12 months:
  //   Sin PV     -- INPUT_CFE row 37  (already rendered? we need it in CFE_OUTPUT for chart range)
  //   Con PV     -- CFE_OUT row SEC1_TOTAL
  //   Con BESS   -- CFE_OUT row SEC2_RECIBO_FINAL
  // We write a small hidden helper block at rows 80-84 so the chart has a
  // contiguous data range without re-pulling sources.
  _cfeOutWriteChart2Helper(sh);
  var c2 = sh.newChart().asColumnChart()
    .addRange(sh.getRange(80, 2, 4, 13))   // labels + 3 series
    .setPosition(R.CHART2_TOP, 2, 0, 0)
    .setOption('title', 'Recibo mensual: Sin PV  vs  Con PV  vs  Con PV+BESS')
    .setOption('legend', { position: 'top' })
    .setOption('width', 1100)
    .setOption('height', 320)
    .setOption('colors', ['#9E9E9E', '#42A5F5', '#43A047'])
    .setOption('hAxis', { textStyle: { fontSize: 11 } })
    .setOption('vAxis', { format: '$#,##0' })
    .build();
  sh.insertChart(c2);

  // Chart 3: Demand shaving.  Two-line chart:
  //   Dmax sin BESS  -- row SEC2_DMAX_SIN
  //   Dmax con BESS  -- row SEC2_DMAX_CON
  _cfeOutWriteChart3Helper(sh);
  var c3 = sh.newChart().asLineChart()
    .addRange(sh.getRange(86, 2, 3, 13))   // labels + 2 series
    .setPosition(R.CHART3_TOP, 2, 0, 0)
    .setOption('title', 'Demanda en punta: kW sin BESS  vs  kW con BESS')
    .setOption('legend', { position: 'top' })
    .setOption('width', 1100)
    .setOption('height', 280)
    .setOption('colors', ['#E53935', '#43A047'])
    .setOption('hAxis', { textStyle: { fontSize: 11 } })
    .setOption('vAxis', { format: '#,##0', title: 'kW' })
    .build();
  sh.insertChart(c3);
}

// Hidden helper block for chart 2 at rows 80-83 -- written off-screen below the
// charts so it doesn't visually pollute the report.
function _cfeOutWriteChart2Helper(sh) {
  // Row 80 = month labels
  sh.getRange(80, 2).setValue('Mes').setFontColor('#999999');
  for (var i = 0; i < 12; i++) {
    sh.getRange(80, 3 + i).setValue(CFE_OUT_MONTHS[i]).setFontColor('#999999');
  }
  // Rows 81-83 = series -- pull from INPUT_CFE/CFE_SIM directly via formula
  // so any source change re-renders the chart automatically.
  sh.getRange(81, 2).setValue('Sin PV').setFontColor('#999999');
  sh.getRange(82, 2).setValue('Con PV').setFontColor('#999999');
  sh.getRange(83, 2).setValue('Con PV+BESS').setFontColor('#999999');
  for (var j = 0; j < 12; j++) {
    var colLetter = String.fromCharCode(67 + j);  // C, D, E, ...
    // INPUT_CFE row 37 = TOTAL (verified by Phase 19 label assertion).
    sh.getRange(81, 3 + j).setFormula('=INPUT_CFE!' + colLetter + '37');
    // CFE_SIMULATION row 39 = TOTAL (test feedback: row 37 was "Facturacion").
    sh.getRange(82, 3 + j).setFormula('=CFE_SIMULATION!' + colLetter + '39');
    // Con PV+BESS = Con PV - sum(BESS savings rows 30+31+32)
    sh.getRange(83, 3 + j).setFormula(
      '=CFE_SIMULATION!' + colLetter + '39 - ('
      + 'BESS_SIMULATION!' + colLetter + '30 + '
      + 'BESS_SIMULATION!' + colLetter + '31 + '
      + 'BESS_SIMULATION!' + colLetter + '32)');
  }
  // Hide helper rows visually
  sh.getRange(80, 1, 4, 16).setFontColor('#cccccc').setFontSize(7);
}

// Hidden helper block for chart 3 at rows 86-88.
function _cfeOutWriteChart3Helper(sh) {
  sh.getRange(86, 2).setValue('Mes').setFontColor('#999999');
  for (var i = 0; i < 12; i++) {
    sh.getRange(86, 3 + i).setValue(CFE_OUT_MONTHS[i]).setFontColor('#999999');
  }
  sh.getRange(87, 2).setValue('Sin BESS').setFontColor('#999999');
  sh.getRange(88, 2).setValue('Con BESS').setFontColor('#999999');
  for (var j = 0; j < 12; j++) {
    var colLetter = String.fromCharCode(67 + j);
    sh.getRange(87, 3 + j).setFormula('=BESS_SIMULATION!' + colLetter + '25');
    sh.getRange(88, 3 + j).setFormula('=BESS_SIMULATION!' + colLetter + '27');
  }
  sh.getRange(86, 1, 3, 16).setFontColor('#cccccc').setFontSize(7);
}


// =============================================================================
// NUMBER FORMATTER
// =============================================================================
function _cfeOutFmt(n) {
  var v = Number(n) || 0;
  // Spanish-style thousands separator -- match INPUT_CFE display
  return Math.round(v).toLocaleString('en-US');
}