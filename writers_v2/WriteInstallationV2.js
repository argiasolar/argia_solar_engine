// =============================================================================
// ARGIA ENGINE v2 -- File: writers_v2/WriteInstallationV2.gs
// -----------------------------------------------------------------------------
// CHUNK 5 — INSTALLATION_v2 writer.
//
// WHAT THIS DOES
//   Mirrors the legacy writeInstallCost() function from 13_CalcInstallCost.js,
//   writing the same content to INSTALLATION_v2 instead of INSTALLATION.
//   Also mirrors writeInstallDriverMap() into 95_INSTALL_DRIVER_MAP_v2.
//
//   In v2 the structural content (banner, panel headers, driver-key labels,
//   NOTES column, dropdowns, palette, number formats) is seeded by
//   setupInstallationTemplate(). The writer ONLY populates values that change
//   per engine run: the driver values in col B, the summary block totals in
//   col G, the section grid totals in cols G-J, the man-hours breakdown, and
//   the full line-item zone.
//
// LAYOUT — same as legacy
//   - Driver block: col A labels (template) + col B values (writer) +
//     col C notes (template). Rows 5-34, 30 entries. Row 4 = header.
//   - Summary block: col F labels + col G values. Rows 5-12 data + row 4 header
//     + grand-total banner mirror.
//   - Section grid: row 14 header (template) + rows 15-23 data (writer).
//   - Man-hours breakdown: row 24 header (writer) + role rows + row 33 TOTAL.
//   - Line-item zone: rows 40+ (writer), variable height per section.
//   - Grand total + legend at the bottom (writer).
//
// CALLED BY
//   - 00_Main.js Step 12-v2 with result + drivers
//   - _testOpts injection supports test mocking
//
// LEGACY VERBATIM where it matters
//   Calculation outputs match legacy byte-for-byte for the same inputs.
//   Visual output mirrors legacy after Phase 2e restyle (cream palette,
//   currency formatting, neutral section grid).
// =============================================================================


// -----------------------------------------------------------------------------
// LAYOUT CONSTANTS — duplicated from legacy per migration §2 (no shared code).
// Must match the values in templates/setupInstallationTemplate.js or template-
// seeded labels won't line up with writer-populated values.
// -----------------------------------------------------------------------------
var _INST_V2_DRV_HDR_ROW   = 4;
var _INST_V2_DRV_START_ROW = 5;
var _INST_V2_DRV_END_ROW   = 34;
var _INST_V2_DRV_COL_KEY   = 1;
var _INST_V2_DRV_COL_VAL   = 2;

// Summary block
var _INST_V2_SUM_HDR_ROW   = 4;
var _INST_V2_SUM_COL_LABEL = 6;
var _INST_V2_SUM_COL_VAL   = 7;
var _INST_V2_SUM_ROWS = {
  TOTAL_LABOR  : 5,
  TOTAL_EQUIP  : 6,
  TOTAL_OTHER  : 7,
  // row 8 = divider
  GRAND_TOTAL  : 9,
  PER_KWP      : 10,
  PER_WP       : 11,
  PER_M2       : 12
};

// Section grid (cols F-J, header row 14, data rows 15-23)
var _INST_V2_SEC_HDR_ROW   = 14;
var _INST_V2_SEC_START_ROW = 15;
var _INST_V2_SEC_COL = { SECTION: 6, LABOR: 7, EQUIP: 8, OTHER: 9, TOTAL: 10 };
var _INST_V2_SECTIONS = [
  'AC','DC','RACKING SYSTEM','CONNECTION','SAFETY','GENERAL SITE','EQUIPMENT','BESS','INDIRECT'
];

// Man-hours breakdown (cols F-J)
var _INST_V2_MH_HDR_ROW   = 24;
var _INST_V2_MH_START_ROW = 25;

// Line-item zone
var _INST_V2_LINE_HEADER_ROW = 40;
var _INST_V2_LINE_START_ROW  = 41;
var _INST_V2_LINE_TOTAL_COLS = 28;
var _INST_V2_LINE_COLS = {
  SECTION   : 1,  SUBSECTION: 2,  ID        : 3,  DESC      : 4,  COST_TYPE : 5,
  DRV_KEY   : 6,  DRV_QTY   : 7,  UNIT      : 8,  BASE_RATE : 9,  ROLE      : 10,
  ROLE_RATE : 11, EQUIP_KEY : 12, F1        : 13, F2        : 14, F3        : 15,
  F4        : 16, CF        : 17, APPLIES   : 18, MIN_QTY   : 19, MH        : 20,
  LABOR_MXN : 21, EQ_DAYS   : 22, EQUIP_MXN : 23, OTHER_MXN : 24, TOTAL_MXN : 25,
  FORMULA   : 26, ACTIVE    : 27, NOTES     : 28
};

// Section color palettes for line-item zone (verbatim from legacy)
var _INST_V2_SEC_HDR_BG = {
  'AC'            : '#0D47A1', 'DC'            : '#BF360C',
  'RACKING SYSTEM': '#1B5E20', 'CONNECTION'    : '#4A148C',
  'SAFETY'        : '#B71C1C', 'GENERAL SITE'  : '#E65100',
  'EQUIPMENT'     : '#006064', 'BESS'          : '#311B92',
  'INDIRECT'      : '#37474F'
};
var _INST_V2_SEC_ITEM_BG = {
  'AC'            : '#E3F2FD', 'DC'            : '#FBE9E7',
  'RACKING SYSTEM': '#F1F8E9', 'CONNECTION'    : '#F3E5F5',
  'SAFETY'        : '#FFEBEE', 'GENERAL SITE'  : '#FFF8E1',
  'EQUIPMENT'     : '#E0F7FA', 'BESS'          : '#EDE7F6',
  'INDIRECT'      : '#F5F5F5'
};
var _INST_V2_SEC_SUB_BG = {
  'AC'            : '#BBDEFB', 'DC'            : '#FFCCBC',
  'RACKING SYSTEM': '#DCEDC8', 'CONNECTION'    : '#E1BEE7',
  'SAFETY'        : '#FFCDD2', 'GENERAL SITE'  : '#FFE0B2',
  'EQUIPMENT'     : '#B2EBF2', 'BESS'          : '#D1C4E9',
  'INDIRECT'      : '#ECEFF1'
};
// BESS palette: legacy SEC_*_BG palettes don't list BESS (fall through to
// grey defaults '#37474F' / '#FAFAFA' / '#ECEFF1'). v2 adds deep purple
// '#311B92' / '#EDE7F6' / '#D1C4E9' for visual distinction from INDIRECT.
// Flagged for visual review before Chunk 11 cutover.

// Ordered driver-key list — must match the template's _INST_TPL_DRIVER_BLOCK
// order or values land on wrong rows.
var _INST_V2_DRIVER_ROW_KEYS = [
  'PROJECT_DC_WP', 'PROJECT_DC_KWP', 'PROJECT_AC_KW',
  'MODULE_COUNT', 'INVERTER_COUNT', 'STRING_COUNT',
  'ARRAY_GROSS_AREA_M2', 'ARRAY_NET_AREA_M2', 'ROOF_AREA_M2',
  'DC_CABLE_M', 'AC_CABLE_M', 'TRAY_M', 'CONDUIT_M', 'GROUNDING_M',
  'INTERCONNECTION_POINTS', 'ANCHOR_COUNT',
  'CREW_SIZE', 'EST_PROJECT_DAYS', 'WORK_HEIGHT_M',
  'INSTALLATION_TYPE', 'ACCESS_DIFFICULTY', 'SITE_HSE_CLASS',
  'ENERGIZED_TIE_IN', 'SITE_DISTANCE_CLASS', 'NIGHT_WORK_REQUIRED',
  'PROJECT_COMPLEXITY', 'WEATHER_PROFILE',
  'BLENDED_LABOR_RATE_MXN_MH',
  'CONTINGENCY_PCT', 'INSURANCE_PCT_ON_LABOR_EQUIP'
];


// =============================================================================
// MAIN WRITER
// =============================================================================
function writeInstallationV2(ss, result, drivers, _testOpts) {
  _testOpts = _testOpts || {};
  var logFn = _testOpts.engineLogFn ||
              (typeof engineLog === 'function' ? engineLog : function() {});
  var sheetName = _testOpts.sheetName || V2_SHEETS.INSTALLATION;

  var sh = ss.getSheetByName(sheetName);
  if (!sh) {
    throw new Error(
      'writeInstallationV2: ' + sheetName + ' sheet not found. ' +
      'Call setupInstallationTemplate(ss) first.'
    );
  }

  if (!result) {
    logFn(ss, 'InstallCostV2', 'WARNING',
      'writeInstallationV2: result is null/undefined, skipping');
    return;
  }

  var items   = result.items || [];
  var secTots = result.sectionTotals || {};
  var totals  = result.totals || {};
  var C       = _INST_V2_LINE_COLS;

  function fn2(v) {
    return (v === null || v === undefined || isNaN(v)) ? 0 : Math.round(v * 100) / 100;
  }

  // ── 1. Driver block VALUES (col B rows 5-34) ─────────────────────────────
  // Build the value map keyed by the same labels the template seeded in col A.
  // Factor-selection keys come from drivers.factorSelections (the engine's
  // resolved selections); we surface them as the "current selection" so the
  // sheet shows what the engine used.
  var sel = drivers.factorSelections || {};
  var drvValueMap = {
    'PROJECT_DC_WP':              drivers.projectDcWp,
    'PROJECT_DC_KWP':             drivers.projectDcKwp,
    'PROJECT_AC_KW':              drivers.projectAcKw,
    'MODULE_COUNT':               drivers.moduleCount,
    'INVERTER_COUNT':             drivers.inverterCount,
    'STRING_COUNT':               drivers.stringCount,
    'ARRAY_GROSS_AREA_M2':        drivers.arrayGrossAreaM2,
    'ARRAY_NET_AREA_M2':          drivers.arrayNetAreaM2,
    'ROOF_AREA_M2':               drivers.roofAreaM2,
    'DC_CABLE_M':                 drivers.dcCableM,
    'AC_CABLE_M':                 drivers.acCableM,
    'TRAY_M':                     drivers.trayM,
    'CONDUIT_M':                  drivers.conduitM,
    'GROUNDING_M':                drivers.groundingM,
    'INTERCONNECTION_POINTS':     drivers.interconnectionPts,
    'ANCHOR_COUNT':               drivers.anchorCount,
    'CREW_SIZE':                  drivers.crewSize,
    'EST_PROJECT_DAYS':           drivers.estProjectDays,
    'WORK_HEIGHT_M':              drivers.workHeightM,
    // Factor selections — drivers.factorSelections is the engine's resolved
    // map. INSTALLATION_TYPE comes from drivers.installationType (special-cased
    // by readInstallDrivers).
    'INSTALLATION_TYPE':          drivers.installationType ||
                                    sel.INSTALLATION_TYPE || '',
    'ACCESS_DIFFICULTY':          sel.ACCESS_DIFFICULTY    || '',
    'SITE_HSE_CLASS':             sel.SITE_HSE_CLASS       || '',
    'ENERGIZED_TIE_IN':           sel.ENERGIZED_TIE_IN     || '',
    'SITE_DISTANCE_CLASS':        sel.SITE_DISTANCE_CLASS  || '',
    'NIGHT_WORK_REQUIRED':        sel.NIGHT_WORK_REQUIRED  || '',
    'PROJECT_COMPLEXITY':         sel.PROJECT_COMPLEXITY   || '',
    'WEATHER_PROFILE':            sel.WEATHER_PROFILE      || '',
    'BLENDED_LABOR_RATE_MXN_MH':  totals.avgRateMxnMH      || 0,
    'CONTINGENCY_PCT':            drivers.contingencyPct,
    'INSURANCE_PCT_ON_LABOR_EQUIP': drivers.insurancePct
  };

  // Write each value to its assigned row (template-seeded col A labels guide
  // the order; we just emit in the same sequence).
  _INST_V2_DRIVER_ROW_KEYS.forEach(function(key, i) {
    var row = _INST_V2_DRV_START_ROW + i;
    var val = drvValueMap.hasOwnProperty(key) ? drvValueMap[key] : '';
    // Use undefined-safe write — empty string for null/undefined avoids
    // formula-error overlays on the dropdown cells.
    if (val === null || val === undefined) val = '';
    sh.getRange(row, _INST_V2_DRV_COL_VAL).setValue(val);
  });

  // ── 2. Summary block VALUES (col F-G rows 5-12) ──────────────────────────
  var sumData = [
    ['TOTAL LABOR MXN',   fn2(totals.labor)],
    ['TOTAL EQUIP MXN',   fn2(totals.equip)],
    ['TOTAL OTHER MXN',   fn2(totals.other)],
    ['\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500',
     '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'],
    ['GRAND TOTAL MXN',   fn2(totals.total)],
    ['MXN / kWp',         totals.perKwp > 0 ? Math.round(totals.perKwp) : '\u2014'],
    ['MXN / Wp',          totals.perWp  > 0 ? fn2(totals.perWp) : '\u2014'],
    ['MXN / m\u00b2',     totals.perM2  > 0 ? Math.round(totals.perM2)  : '\u2014']
  ];
  sumData.forEach(function(row, i) {
    sh.getRange(_INST_V2_SUM_ROWS.TOTAL_LABOR + i, _INST_V2_SUM_COL_LABEL).setValue(row[0]);
    sh.getRange(_INST_V2_SUM_ROWS.TOTAL_LABOR + i, _INST_V2_SUM_COL_VAL  ).setValue(row[1]);
  });

  // ── 3. Section grid VALUES (col F-J rows 14-23) ──────────────────────────
  // Header row 14 (template provides palette, writer fills labels)
  sh.getRange(_INST_V2_SEC_HDR_ROW, _INST_V2_SEC_COL.SECTION, 1, 5)
    .setValues([['SECTION','LABOR','EQUIP','OTHER','TOTAL']]);

  _INST_V2_SECTIONS.forEach(function(sec, idx) {
    var r = _INST_V2_SEC_START_ROW + idx;
    var t = secTots[sec] || {labor:0, equip:0, other:0, total:0};
    sh.getRange(r, _INST_V2_SEC_COL.SECTION, 1, 5)
      .setValues([[sec, Math.round(t.labor), Math.round(t.equip),
                       Math.round(t.other), Math.round(t.total)]]);
  });

  // ── 4. Man-hours breakdown (col F-J rows 24+) ────────────────────────────
  var BG_HDR    = '#fef7e0';
  var TXT_PRIM  = '#212121';
  var DIV_STRG  = '#bdbdbd';

  sh.getRange(_INST_V2_MH_HDR_ROW, _INST_V2_SEC_COL.SECTION, 1, 5)
    .setValues([['MAN-HOURS BREAKDOWN', 'TOTAL MH', '$/MH', 'LABOR MXN', 'CHECK']])
    .setBackground(BG_HDR)
    .setFontColor(TXT_PRIM)
    .setFontWeight('bold')
    .setBorder(null, null, true, null, null, null, DIV_STRG,
               SpreadsheetApp.BorderStyle.SOLID);

  var roleAgg  = result.roleAgg || {};
  var roleKeys = Object.keys(roleAgg).sort();
  var mhDataRows = [];
  roleKeys.forEach(function(role) {
    var ra = roleAgg[role];
    var mh   = Math.round(ra.mh * 10) / 10;
    var rate = ra.rate || 0;
    var cost = Math.round(ra.cost);
    var check = mh > 0 ? (mh.toFixed(1) + ' MH \u00d7 $' + rate + '/MH') : '\u2014';
    mhDataRows.push([role, mh, rate, cost, check]);
  });
  var crewCheck = '';
  if (totals.totalMH > 0 && drivers.crewSize > 0 && drivers.estProjectDays > 0) {
    var mhPerPersonDay = (totals.totalMH / drivers.crewSize / drivers.estProjectDays).toFixed(1);
    crewCheck = totals.totalMH.toFixed(0) + ' MH \u00f7 ' + drivers.crewSize +
                ' crew \u00f7 ' + drivers.estProjectDays +
                ' d\u00edas = ' + mhPerPersonDay + ' MH/persona/d\u00eda';
  }
  mhDataRows.push(['TOTAL', Math.round((totals.totalMH || 0) * 10) / 10,
                   totals.avgRateMxnMH || 0, Math.round(totals.labor || 0), crewCheck]);

  if (mhDataRows.length > 0) {
    var mhRange = sh.getRange(_INST_V2_MH_START_ROW, _INST_V2_SEC_COL.SECTION,
                              mhDataRows.length, 5);
    mhRange.setValues(mhDataRows).setFontSize(9).setBackground('#ffffff').setFontColor(TXT_PRIM);

    // Currency format on LABOR MXN col (I) for data rows
    sh.getRange(_INST_V2_MH_START_ROW, _INST_V2_SEC_COL.OTHER,
                mhDataRows.length, 1).setNumberFormat('"$"#,##0');
    // $/MH col (H)
    sh.getRange(_INST_V2_MH_START_ROW, _INST_V2_SEC_COL.EQUIP,
                mhDataRows.length, 1).setNumberFormat('"$"#,##0');

    var totRowIdx = mhDataRows.length;
    sh.getRange(_INST_V2_MH_START_ROW + totRowIdx - 1, _INST_V2_SEC_COL.SECTION, 1, 5)
      .setBackground('#fff8e1')
      .setFontColor(TXT_PRIM)
      .setFontWeight('bold')
      .setBorder(true, null, null, null, null, null, DIV_STRG,
                 SpreadsheetApp.BorderStyle.SOLID);
    // CHECK column italic
    sh.getRange(_INST_V2_MH_START_ROW, _INST_V2_SEC_COL.TOTAL,
                mhDataRows.length, 1).setFontStyle('italic');
  }

  // ── 5. Clear line-item area ──────────────────────────────────────────────
  sh.getRange(_INST_V2_LINE_HEADER_ROW, 1, 160, _INST_V2_LINE_TOTAL_COLS)
    .clearContent().clearFormat();

  // ── 6. Column headers row 40 (dark navy) ─────────────────────────────────
  var hdrs = [
    'SECTION','SUBSECTION','ID','DESCRIPTION','COST TYPE',
    'DRIVER','QTY','UNIT','BASE RATE','ROLE','$/MH','EQUIP KEY',
    'F1','F2','F3','F4','C.FACTOR','APPLIES','MIN MH',
    'MAN-HOURS','LABOR MXN','EQUIP DAYS','EQUIP MXN','OTHER MXN',
    'TOTAL MXN','FORMULA / CALCULATION TRACE','ACTIVE','NOTES'
  ];
  sh.getRange(_INST_V2_LINE_HEADER_ROW, 1, 1, _INST_V2_LINE_TOTAL_COLS)
    .setValues([hdrs])
    .setBackground('#0D1B2A').setFontColor('#FFFFFF').setFontWeight('bold');

  // ── 7. Section-by-section line items (dynamic row count) ─────────────────
  var currentRow = _INST_V2_LINE_START_ROW;
  _INST_V2_SECTIONS.forEach(function(section) {
    var sectionItems = items.filter(function(r) { return r.item.section === section; });
    if (sectionItems.length === 0) return;

    var st    = secTots[section] || {labor:0, equip:0, other:0, total:0};
    var hdrBg = _INST_V2_SEC_HDR_BG[section]  || '#37474F';
    var itemBg= _INST_V2_SEC_ITEM_BG[section] || '#FAFAFA';
    var subBg = _INST_V2_SEC_SUB_BG[section]  || '#ECEFF1';

    // Section header row
    var hdrValues = new Array(_INST_V2_LINE_TOTAL_COLS).fill('');
    hdrValues[0]                  = '\u25b6  ' + section;
    hdrValues[C.LABOR_MXN - 1]   = 'Labor: $' + Math.round(st.labor).toLocaleString();
    hdrValues[C.EQUIP_MXN - 1]   = 'Equip: $' + Math.round(st.equip).toLocaleString();
    hdrValues[C.OTHER_MXN - 1]   = 'Other: $' + Math.round(st.other).toLocaleString();
    hdrValues[C.TOTAL_MXN - 1]   = 'TOTAL: $' + Math.round(st.total).toLocaleString();
    sh.getRange(currentRow, 1, 1, _INST_V2_LINE_TOTAL_COLS)
      .setValues([hdrValues])
      .setBackground(hdrBg).setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(9);
    currentRow++;

    // Item rows
    var sectionData = [];
    sectionItems.forEach(function(res) {
      var item = res.item;
      var fv   = res.factorResult && res.factorResult.values
                 ? res.factorResult.values
                 : [null, null, null, null];
      sectionData.push([
        item.section, item.subsection, item.id, item.description, item.costType,
        item.driverKey, fn2(res.driverQtyVal), item.driverUom,
        (item.costType === 'EQUIPMENT_DAY') ? res.equipRateVal
          : (item.costType.indexOf('LABOR') !== -1) ? item.productivityRate
          : item.baseOtherRate,
        item.laborRole || '', res.roleRateVal || '', item.equipKey || '',
        fv[0] !== null && fv[0] !== undefined ? fv[0] : '',
        fv[1] !== null && fv[1] !== undefined ? fv[1] : '',
        fv[2] !== null && fv[2] !== undefined ? fv[2] : '',
        fv[3] !== null && fv[3] !== undefined ? fv[3] : '',
        fn2((res.factorResult && res.factorResult.combined) || 0),
        item.appliesToInstType, item.minQty,
        fn2(res.mhComputed), fn2(res.laborMxn), fn2(res.equipDays),
        fn2(res.equipMxn), fn2(res.otherMxn), fn2(res.totalMxn),
        res.formulaTrace || '',
        item.active ? 'Y' : 'N', item.notes || ''
      ]);
    });

    if (sectionData.length > 0) {
      sh.getRange(currentRow, 1, sectionData.length, _INST_V2_LINE_TOTAL_COLS)
        .setValues(sectionData)
        .setBackground(itemBg)
        .setFontSize(8);
      sectionData.forEach(function(row, i) {
        if (row[C.TOTAL_MXN - 1] === 0) {
          sh.getRange(currentRow + i, 1, 1, _INST_V2_LINE_TOTAL_COLS)
            .setBackground('#F5F5F5').setFontColor('#AAAAAA');
        }
        sh.getRange(currentRow + i, C.TOTAL_MXN)
          .setFontWeight('bold')
          .setFontColor(row[C.TOTAL_MXN - 1] > 0 ? '#000000' : '#AAAAAA');
        sh.getRange(currentRow + i, C.FORMULA).setFontStyle('italic');
      });
      // Currency format on $-denominated cols of the line-item rows
      sh.getRange(currentRow, C.LABOR_MXN, sectionData.length, 1)
        .setNumberFormat('"$"#,##0');
      sh.getRange(currentRow, C.EQUIP_MXN, sectionData.length, 1)
        .setNumberFormat('"$"#,##0');
      sh.getRange(currentRow, C.OTHER_MXN, sectionData.length, 1)
        .setNumberFormat('"$"#,##0');
      sh.getRange(currentRow, C.TOTAL_MXN, sectionData.length, 1)
        .setNumberFormat('"$"#,##0');
    }
    currentRow += sectionData.length;

    // Section subtotal row
    var subValues = new Array(_INST_V2_LINE_TOTAL_COLS).fill('');
    subValues[C.DESC      - 1] = section + ' subtotal';
    subValues[C.LABOR_MXN - 1] = fn2(st.labor);
    subValues[C.EQUIP_MXN - 1] = fn2(st.equip);
    subValues[C.OTHER_MXN - 1] = fn2(st.other);
    subValues[C.TOTAL_MXN - 1] = fn2(st.total);
    sh.getRange(currentRow, 1, 1, _INST_V2_LINE_TOTAL_COLS)
      .setValues([subValues])
      .setBackground(subBg)
      .setFontWeight('bold')
      .setFontStyle('italic')
      .setFontSize(8);
    sh.getRange(currentRow, C.TOTAL_MXN).setBackground(hdrBg).setFontColor('#FFFFFF');
    // Currency format on subtotal row
    sh.getRange(currentRow, C.LABOR_MXN, 1, 5).setNumberFormat('"$"#,##0');
    currentRow += 2;
  });

  // ── 8. Grand total row ───────────────────────────────────────────────────
  var grandValues = new Array(_INST_V2_LINE_TOTAL_COLS).fill('');
  grandValues[C.DESC      - 1] = 'GRAND TOTAL';
  grandValues[C.LABOR_MXN - 1] = fn2(totals.labor);
  grandValues[C.EQUIP_MXN - 1] = fn2(totals.equip);
  grandValues[C.OTHER_MXN - 1] = fn2(totals.other);
  grandValues[C.TOTAL_MXN - 1] = fn2(totals.total);
  grandValues[C.FORMULA   - 1] = totals.perKwp > 0
    ? Math.round(totals.perKwp) + ' MXN/kWp  |  ' + fn2(totals.perWp) + ' MXN/Wp'
    : '';
  sh.getRange(currentRow, 1, 1, _INST_V2_LINE_TOTAL_COLS)
    .setValues([grandValues])
    .setBackground('#0D1B2A')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setFontSize(10);
  sh.getRange(currentRow, C.LABOR_MXN, 1, 5).setNumberFormat('"$"#,##0');
  currentRow += 2;

  // ── 9. Legend ────────────────────────────────────────────────────────────
  var legendRows = [
    ['LEGEND \u2014 COST TYPES & COLUMN GUIDE'],
    ['LABOR_PRODUCTIVITY',
     'MH = (driver qty \u00f7 productivity rate) \u00d7 factor | Labor = MH \u00d7 rate/MH'],
    ['LABOR_FIXED_MH',
     'Scale drivers (kWp/modules): flat baseline MH = MIN_QTY | Count drivers (crew/points): MH = qty \u00d7 MIN_QTY | Tune per project'],
    ['OTHER_FIXED',
     'Count drivers: cost = rate \u00d7 qty \u00d7 factor | Lot-based (PROJECT_DC_KWP driver): flat total regardless of size'],
    ['OTHER_UNIT',
     'Unit cost: rate \u00d7 driver qty \u00d7 factor'],
    ['EQUIPMENT_DAY',
     'day_rate \u00d7 days \u00d7 factor'],
    ['PERCENT_OF_*',
     'IN-01: pct \u00d7 (labor+equip subtotal) | IN-02: pct \u00d7 install subtotal'],
    ['COLUMNS',
     'T=Man-Hours | U=Labor MXN | W=Equip MXN | X=Other MXN | Y=TOTAL MXN | Z=Full formula trace']
  ];
  legendRows.forEach(function(row, i) {
    var r = currentRow + i;
    var padded = row.slice();
    while (padded.length < _INST_V2_LINE_TOTAL_COLS) padded.push('');
    sh.getRange(r, 1, 1, _INST_V2_LINE_TOTAL_COLS)
      .setValues([padded.slice(0, _INST_V2_LINE_TOTAL_COLS)]);
    if (i === 0) {
      sh.getRange(r, 1, 1, _INST_V2_LINE_TOTAL_COLS)
        .setBackground('#263238').setFontColor('#FFFFFF').setFontWeight('bold');
    } else {
      sh.getRange(r, 1).setFontWeight('bold').setBackground('#ECEFF1');
      sh.getRange(r, 2).setFontStyle('italic').setBackground('#FAFAFA').setFontColor('#555555');
    }
  });

  if (!_testOpts.skipFlush && typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.flush) {
    SpreadsheetApp.flush();
  }

  logFn(ss, 'InstallCostV2', 'OK',
    'INSTALLATION_v2 written. ' +
    'Labor: $' + Math.round(totals.labor || 0).toLocaleString() +
    ' | Equip: $' + Math.round(totals.equip || 0).toLocaleString() +
    ' | Other: $' + Math.round(totals.other || 0).toLocaleString() +
    ' | TOTAL: $' + Math.round(totals.total || 0).toLocaleString() + ' MXN' +
    (totals.perKwp > 0 ? ' | ' + Math.round(totals.perKwp) + ' MXN/kWp' : ''));
}


// =============================================================================
// DRIVER MAP WRITER (95_INSTALL_DRIVER_MAP_v2)
// =============================================================================
// Mirrors legacy writeInstallDriverMap. Updates value column (B) and factor
// selection column for each driver key match. The driver-map sheet's header
// row must come from elsewhere (IMPORTRANGE / manual setup) — v2 does NOT
// assume the structure, same as legacy.
// =============================================================================
function writeInstallationDriverMapV2(ss, drivers, result, _testOpts) {
  _testOpts = _testOpts || {};
  var logFn = _testOpts.engineLogFn ||
              (typeof engineLog === 'function' ? engineLog : function() {});
  var sheetName = _testOpts.driverMapSheetName ||
                  (V2_SHEETS.INSTALL_DRIVER_MAP || '95_INSTALL_DRIVER_MAP_v2');

  var sh = ss.getSheetByName(sheetName);
  if (!sh) return;  // graceful no-op, matches legacy `if (!sh) return`

  var data = sh.getDataRange().getValues();
  if (!data || data.length === 0) return;

  var hdrs = data[0].map(function(h) { return String(h).trim(); });
  var keyCol   = hdrs.indexOf('DRIVER_KEY');
  var valCol   = hdrs.indexOf('VALUE');
  var fgrpCol  = hdrs.indexOf('FACTOR_GROUP');
  var fkeyCol  = hdrs.indexOf('SELECTED_KEY');

  var driverValues = {
    'PROJECT_ONE': 1,
    'PROJECT_DC_WP': drivers.projectDcWp,
    'PROJECT_DC_KWP': drivers.projectDcKwp,
    'PROJECT_AC_KW': drivers.projectAcKw,
    'MODULE_COUNT': drivers.moduleCount,
    'INVERTER_COUNT': drivers.inverterCount,
    'STRING_COUNT': drivers.stringCount,
    'ARRAY_GROSS_AREA_M2': drivers.arrayGrossAreaM2,
    'ARRAY_NET_AREA_M2': drivers.arrayNetAreaM2,
    'ROOF_AREA_M2': drivers.roofAreaM2,
    'DC_CABLE_M': drivers.dcCableM,
    'AC_CABLE_M': drivers.acCableM,
    'TRAY_M': drivers.trayM,
    'CONDUIT_M': drivers.conduitM,
    'GROUNDING_M': drivers.groundingM,
    'INTERCONNECTION_POINTS': drivers.interconnectionPts,
    'ANCHOR_COUNT': drivers.anchorCount,
    'CREW_SIZE': drivers.crewSize,
    'EST_PROJECT_DAYS': drivers.estProjectDays,
    'WORK_HEIGHT_M': drivers.workHeightM,
    'CREW_DAYS': drivers.crewDays,
    'AC_TERMINATION_COUNT': drivers.acTerminationCount,
    'DC_CONNECTOR_COUNT': drivers.dcConnectorCount
  };

  for (var i = 1; i < data.length; i++) {
    var row = data[i];

    if (keyCol >= 0 && valCol >= 0) {
      var dkey = String(row[keyCol] || '').trim();
      if (driverValues.hasOwnProperty(dkey)) {
        sh.getRange(i + 1, valCol + 1).setValue(driverValues[dkey]);
      }
    }

    if (fgrpCol >= 0 && fkeyCol >= 0 && drivers.factorSelections) {
      var grp = String(row[fgrpCol] || '').trim();
      if (grp && drivers.factorSelections[grp]) {
        sh.getRange(i + 1, fkeyCol + 1).setValue(drivers.factorSelections[grp]);
      }
    }
  }

  if (!_testOpts.skipFlush && typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.flush) {
    SpreadsheetApp.flush();
  }

  logFn(ss, 'InstallCostV2', 'INFO', sheetName + ' updated');
}
