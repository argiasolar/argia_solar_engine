// =============================================================================
// ARGIA ENGINE v7 -- File: 14_WriteProjectCard.gs
// PROJECT CARD sheet writer.
//
// Phase A cleanup (2026-04-28): INPUT_GENERAL retired. All PC inputs now
// read from INPUT_PROJECT via readInput() / INPUT_MAP. The standalone
// setupProjectCardInputs() and the menu shim runSetupProjectCardInputs()
// have been deleted -- setupInputProject() in 02e_InputSetup.gs renders all
// PC fields directly from _MAP_PROJECT.
//
// Color palette matches BOM/MDC:
//   navyBg   #0D1B2A  - title bars, total rows
//   sectionBg #37474F - section headers
//   lightBg  #ECEFF1  - odd rows
//   whiteBg  #FFFFFF  - even rows
//   passBg   #C8E6C9 / passText #1B5E20
//   failBg   #FFCDD2 / failText #B71C1C
//
// INSTALLATION sheet G9 = TOTAL_INSTALLATION_COST_MXN
// =============================================================================

var SH_PC = 'PROJECT_CARD';

// Exact palette matching BOM/MDC
var PC_C = {
  navy     : '#0D1B2A',  navyFg  : '#FFFFFF',
  section  : '#37474F',  secFg   : '#FFFFFF',
  blue     : '#1565C0',  blueFg  : '#FFFFFF',
  light    : '#ECEFF1',
  white    : '#FFFFFF',
  green    : '#E8F5E9',
  pass     : '#C8E6C9',  passFg  : '#1B5E20',
  fail     : '#FFCDD2',  failFg  : '#B71C1C',
  orange   : '#FFF8E1',
};

// ---------------------------------------------------------------------------
// READ PC INPUTS
//
// Phase A (2026-04-28): rewritten to read from INPUT_PROJECT via readInput()
// instead of label-scanning INPUT_GENERAL. Single source of truth for every
// field is INPUT_MAP (02c_InputMap.gs).
//
// COST VALIDATION RANGES
//   Were stored as 9 free-form rows on INPUT_GENERAL. Now stored as named
//   pairs (costRangeXxxMin / costRangeXxxMax) on INPUT_PROJECT rows 52-60.
//   Defaults from the map fire when cells are blank, so a fresh INPUT_PROJECT
//   tab still produces sane validation envelopes.
// ---------------------------------------------------------------------------
function readPcInputs_(ss) {
  // Cost-validation envelope: 9 categories x (min, max). Keys mirror the
  // category labels readBomSubtotals_ produces, so downstream code is
  // unchanged.
  var COST_RANGE_KEYS = [
    ['Solar panels',     'costRangePanelsMin',     'costRangePanelsMax'],
    ['Inverters',        'costRangeInvertersMin',  'costRangeInvertersMax'],
    ['Structure',        'costRangeStructureMin',  'costRangeStructureMax'],
    ['Electric DC',      'costRangeElecDcMin',     'costRangeElecDcMax'],
    ['Electric AC',      'costRangeElecAcMin',     'costRangeElecAcMax'],
    ['Monitoring',       'costRangeMonitoringMin', 'costRangeMonitoringMax'],
    ['Permits & others', 'costRangePermitsMin',    'costRangePermitsMax'],
    ['Installation',     'costRangeInstallMin',    'costRangeInstallMax'],
    ['TOTAL',            'costRangeTotalMin',      'costRangeTotalMax'],
  ];
  var validation = {};
  COST_RANGE_KEYS.forEach(function(triple) {
    var label = triple[0];
    var min   = parseFloat(readInput(ss, triple[1]));
    var max   = parseFloat(readInput(ss, triple[2]));
    validation[label] = {
      min: isNaN(min) ? 0        : min,
      max: isNaN(max) ? Infinity : max,
    };
  });

  // Helpers around readInput() for clean defaults.
  function s(key, fb) {
    var v = readInput(ss, key);
    if (v === '' || v === null || v === undefined) return fb || '';
    return String(v).trim();
  }
  function n(key) {
    var v = parseFloat(readInput(ss, key));
    return isNaN(v) ? 0 : v;
  }
  function intOr(key, fb) {
    var v = parseInt(readInput(ss, key));
    return isNaN(v) ? fb : v;
  }
  function dateOr(key) {
    var v = readInput(ss, key);
    if (v === '' || v === null || v === undefined) return '';
    return v;  // Date object or string -- callers already handle both
  }

  return {
    projectNumber        : s('projectNumber',          '\u2014'),
    projectManager       : s('projectManager',         ''),
    systemCoveragePct    : n('systemCoveragePct'),
    sellingPriceWpUsd    : n('sellingPriceUsdPerWp'),
    marginPct            : n('marginPct'),
    paymentTerms         : s('paymentTerms',           'N/A'),
    paymentDays          : intOr('paymentDays',         14),
    contractSignDate     : dateOr('dateSign'),
    contractFinishDate   : dateOr('dateFinishContract'),
    equipmentDeliveryDate: dateOr('dateDelivery'),
    installStartDate     : dateOr('dateInstallStart'),
    installFinishDate    : dateOr('dateInstallFinish'),
    receivedBy           : s('receivedBy',             'Luis Juaristi'),
    approvedBy           : s('approvedBy',             'Vit Kovarik'),
    validation           : validation,
  };
}

// ---------------------------------------------------------------------------
// READ BOM SUBTOTALS (USD col F, MXN col G)
// ---------------------------------------------------------------------------
function readBomSubtotals_(ss) {
  var sh = ss.getSheetByName(SH.BOM);
  if (!sh) return null;
  function usd(row) { return parseFloat(sh.getRange(row, 6).getValue()) || 0; }
  function mxn(row) { return parseFloat(sh.getRange(row, 7).getValue()) || 0; }
  // Permits = sum of 4 service rows (UVIE, CFE, commissioning, thermography)
  // Phase 2e: rows shifted +3 — now BOM_ROW.MON_UVIE..MON_THERMOGRAPHY
  var permU = usd(BOM_ROW.MON_UVIE) + usd(BOM_ROW.MON_CFE) +
              usd(BOM_ROW.MON_COMMISSIONING) + usd(BOM_ROW.MON_THERMOGRAPHY);
  var permM = mxn(BOM_ROW.MON_UVIE) + mxn(BOM_ROW.MON_CFE) +
              mxn(BOM_ROW.MON_COMMISSIONING) + mxn(BOM_ROW.MON_THERMOGRAPHY);
  // Monitoring = SUBTOTAL_MONITORING minus the 4 service rows
  var monU  = usd(BOM_ROW.SUBTOTAL_MONITORING) - permU;
  var monM  = mxn(BOM_ROW.SUBTOTAL_MONITORING) - permM;
  return {
    panels   : { usd: usd(BOM_ROW.SUBTOTAL_PANELS),    mxn: mxn(BOM_ROW.SUBTOTAL_PANELS)    },
    inverters: { usd: usd(BOM_ROW.SUBTOTAL_INVERTERS), mxn: mxn(BOM_ROW.SUBTOTAL_INVERTERS) },
    structure: { usd: usd(BOM_ROW.SUBTOTAL_STRUCTURE), mxn: mxn(BOM_ROW.SUBTOTAL_STRUCTURE) },
    elecDc   : { usd: usd(BOM_ROW.SUBTOTAL_DC),        mxn: mxn(BOM_ROW.SUBTOTAL_DC)        },
    elecAc   : { usd: usd(BOM_ROW.SUBTOTAL_AC) + usd(BOM_ROW.SUBTOTAL_TRANSFORMER),
                 mxn: mxn(BOM_ROW.SUBTOTAL_AC) + mxn(BOM_ROW.SUBTOTAL_TRANSFORMER) },
    monitoring:{ usd: monU < 0 ? 0 : monU, mxn: monM < 0 ? 0 : monM },
    permits  : { usd: permU, mxn: permM },
  };
}

// ---------------------------------------------------------------------------
// READ INSTALLATION MXN from INSTALLATION G9 (IC_SUM_ROWS.GRAND_TOTAL=9, IC_SUM_COL_VAL=7)
// Falls back to scan from bottom if G9 is empty
// ---------------------------------------------------------------------------
function readInstallTotal_(ss) {
  // Try both possible sheet names
  var sh = ss.getSheetByName('INSTALLATION') || ss.getSheetByName('INSTALL_COST');
  if (!sh) return { usd: 0, mxn: 0 };

  var tc = 18.5;
  try {
    var bs = ss.getSheetByName(SH.BOM);
    if (bs) tc = parseFloat(bs.getRange(BOM_ROW.EXCHANGE_RATE, BOM_COL.TOTAL_USD).getValue()) || 18.5;
  } catch(e) {}

  // Primary: GRAND TOTAL MXN at row 9, col G (was incorrectly row 8 = divider).
  // IC_SUM_ROWS.GRAND_TOTAL = 9, IC_SUM_COL_VAL = 7.
  // Falls back to scanning the SUMMARY block (rows 4-22 col G) for the largest
  // numeric value if the canonical cell is empty.
  var mxnVal = parseFloat(sh.getRange(9, 7).getValue()) || 0;
  if (mxnVal > 0) {
    return { usd: mxnVal / tc, mxn: mxnVal };
  }

  // Fallback: search rows 4-22 in col G for the largest single value (summary block)
  var bestMxn = 0;
  for (var r = 4; r <= 22; r++) {
    var v = parseFloat(sh.getRange(r, 7).getValue()) || 0;
    if (v > bestMxn) bestMxn = v;
  }
  if (bestMxn > 0) return { usd: bestMxn / tc, mxn: bestMxn };

  // Last fallback: scan entire col G from bottom
  var lr = Math.min(sh.getLastRow(), 250);
  for (var r2 = lr; r2 >= 1; r2--) {
    var v2 = parseFloat(sh.getRange(r2, 7).getValue()) || 0;
    if (v2 > 0) {
      var u2 = parseFloat(sh.getRange(r2, 6).getValue()) || 0;
      return { usd: u2 > 0 ? u2 : v2 / tc, mxn: v2 };
    }
  }
  return { usd: 0, mxn: 0 };
}

// ---------------------------------------------------------------------------
// WRITE PROJECT CARD
// ---------------------------------------------------------------------------
function writeProjectCard(ss, inp, panel, invBank, dc) {
  var pc = ss.getSheetByName(SH_PC);
  if (!pc) pc = ss.insertSheet(SH_PC);
  pc.clearContents();
  pc.clearFormats();

  var pcInp = readPcInputs_(ss);
  var bom   = readBomSubtotals_(ss);
  var inst  = readInstallTotal_(ss);
  var tc    = 18.5;
  try {
    var bs = ss.getSheetByName(SH.BOM);
    if (bs) tc = parseFloat(bs.getRange(BOM_ROW.EXCHANGE_RATE, BOM_COL.TOTAL_USD).getValue()) || 18.5;
  } catch(e) {}

  var dcKwp = dc.dcKwp || 0;
  var dcWp  = dcKwp * 1000;

  // Cost totals
  var matUsd = bom ? (bom.panels.usd + bom.inverters.usd + bom.structure.usd +
               bom.elecDc.usd + bom.elecAc.usd + bom.monitoring.usd + bom.permits.usd) : 0;
  var totalCostUsd  = matUsd + inst.usd;
  var costPerWpUsd  = dcWp  > 0 ? totalCostUsd / dcWp  : 0;
  var costPerKwpUsd = dcKwp > 0 ? totalCostUsd / dcKwp : 0;

  // Selling / margin
  var selWp   = pcInp.sellingPriceWpUsd;
  var selKwp  = selWp * 1000;
  var margin  = pcInp.marginPct;
  // If margin was explicitly entered (>0), use it directly.
  // If margin=0 but selling price is known, derive from cost.
  // Only fall back to 20% if absolutely nothing is available.
  if (margin <= 0 && selWp > 0 && costPerWpUsd > 0)
    margin = (selWp - costPerWpUsd) / selWp;
  if (margin <= 0) margin = 0.20;  // last resort default

  function salesOf(cost) { return margin < 1 ? cost / (1 - margin) : cost; }
  function fmtD(d) {
    if (!d) return '';
    if (d instanceof Date) return Utilities.formatDate(d, 'America/Monterrey', 'dd/MM/yyyy');
    return String(d);
  }
  function pctStr(n) { return Math.round(n * 100) + '%'; }
  function setVal(r, c, v) { if (v !== '' && v !== null && v !== undefined) pc.getRange(r,c).setValue(v); }
  function bold(r, c, v)   { pc.getRange(r,c).setValue(v).setFontWeight('bold'); }

  // ── Column widths ─────────────────────────────────────────────────────────
  // A=margin  B=label  C=USD-cost  D=MXN-cost  E=Validation
  // F=spacer  G=label-right  H=USD-sales  I=MXN-sales  J=Margin%
  [4, 165, 105, 110, 85, 14, 160, 105, 110, 70].forEach(function(w, i) {
    pc.setColumnWidth(i+1, w);
  });

  function hdr(r, c1, span, txt, bg, fg) {
    var rng = pc.getRange(r, c1, 1, span);
    if (span > 1) rng.merge();
    rng.setValue(txt).setFontWeight('bold').setFontSize(10)
       .setBackground(bg || PC_C.section).setFontColor(fg || PC_C.secFg)
       .setVerticalAlignment('middle');
    pc.setRowHeight(r, 24);
  }
  function spacer(r) { pc.setRowHeight(r, 5); }
  function numCell(r, c, v, fmt) {
    pc.getRange(r, c).setValue(v).setNumberFormat(fmt || '"$\u00a0"#,##0')
      .setHorizontalAlignment('right');
  }

  var row = 1;

  // ══ ROW 1: Title ═══════════════════════════════════════════════════════════
  pc.getRange(1, 1, 1, 10).setBackground(PC_C.section).setFontColor(PC_C.secFg).setFontSize(10);
  bold(1, 2, 'PROJECT CARD');
  setVal(1, 3, 'Project Number:'); setVal(1, 4, pcInp.projectNumber);
  setVal(1, 7, 'Date:');
  pc.getRange(1, 7).setHorizontalAlignment('right');
  setVal(1, 8, Utilities.formatDate(new Date(), 'America/Monterrey', "dd 'de' MMMM 'de' yyyy"));
  pc.getRange(1, 8).setHorizontalAlignment('right');
  // I1 intentionally left blank (AR3IA SOLAR removed per design)
  pc.setRowHeight(1, 26); row = 3;

  // ══ BUSINESS CASE ══════════════════════════════════════════════════════════
  hdr(row, 2, 9, 'BUSINESS CASE'); row++;
  setVal(row,2,'Customer:');    setVal(row,3,inp.clientName); row++;
  setVal(row,2,'Project name:');setVal(row,3,inp.projectName); row++;
  setVal(row,2,'Location:');    setVal(row,3,[inp.street,inp.city,inp.state].filter(Boolean).join(', ')); row++;
  spacer(row); row++;

  // ══ PROJECT TEAM ═══════════════════════════════════════════════════════════
  hdr(row, 2, 9, 'PROJECT TEAM'); row++;
  setVal(row,2,'Business manager:'); setVal(row,3,inp.bizManager); row++;
  setVal(row,2,'Designer:');         setVal(row,3,inp.designer); row++;
  setVal(row,2,'Project manager:');  setVal(row,3,pcInp.projectManager); row++;
  spacer(row); row++;

  // ══ SCOPE OF WORK (cols B-E) + ADDITIONAL INFO (cols G-J) ══════════════════
  hdr(row, 2, 4, 'SCOPE OF WORK');
  hdr(row, 7, 4, 'ADDITIONAL INFORMATION');
  row++;

  var scopeItems = [];
  var panelLabel = ((panel['PANEL_BRAND']||'') + ' ' + (panel['PANEL_MODEL']||'') +
                    ' ' + (panel['PANEL_POWER_W']||'') + 'W').trim();
  scopeItems.push([panelLabel, inp.panelQty + ' pcs']);
  invBank.forEach(function(inv) { scopeItems.push([inv.model + ' ' + inv.acKw + 'kW', inv.qty + ' pcs']); });
  if (inp.structure)  scopeItems.push([inp.structure,  (inp.panelQty||'') + ' pcs']);
  if (inp.structure2) scopeItems.push([inp.structure2, '']);

  // Write ADDITIONAL INFO rows, tracking key row numbers for later formulas
  var addInfoLabels = [
    ['Power peak',        dcKwp.toFixed(1) + ' kWp'],
    ['System coverage',   pcInp.systemCoveragePct > 0 ? pctStr(pcInp.systemCoveragePct) : '\u2014'],
    ['Installation type', inp.businessType || '\u2014'],
    ['Selling price',     null],  // written as formula below, after TOTAL row is known
    ['Cost',              costPerWpUsd > 0 ? costPerWpUsd.toFixed(3) + ' USD/Wp' : '\u2014'],
  ];

  var powerPeakRow   = -1;  // row where kWp value is in col H
  var sellingPriceRow= -1;  // row where selling price formula will go

  var maxSR = Math.max(scopeItems.length, addInfoLabels.length);
  for (var si = 0; si < maxSR; si++) {
    if (si < scopeItems.length) { setVal(row,2,scopeItems[si][0]); setVal(row,4,scopeItems[si][1]); }
    if (si < addInfoLabels.length) {
      setVal(row,7,addInfoLabels[si][0]);
      if (addInfoLabels[si][1] !== null) {
        setVal(row,8,addInfoLabels[si][1]);
      }
      if (addInfoLabels[si][0] === 'Power peak')    powerPeakRow    = row;
      if (addInfoLabels[si][0] === 'Selling price') sellingPriceRow = row;
    }
    row++;
  }
  spacer(row); row++;

  // ══ SCHEDULE ═══════════════════════════════════════════════════════════════
  hdr(row, 2, 9, 'SCHEDULE'); row++;
  setVal(row,2,'Contract sign date:');     setVal(row,3,fmtD(pcInp.contractSignDate));
  setVal(row,7,'Contract finish date:');   setVal(row,8,fmtD(pcInp.contractFinishDate)); row++;
  setVal(row,2,'Equipment delivery date:');setVal(row,3,fmtD(pcInp.equipmentDeliveryDate)); row++;
  setVal(row,2,'Installation start date:');setVal(row,3,fmtD(pcInp.installStartDate));
  setVal(row,7,'Installation finish date:');setVal(row,8,fmtD(pcInp.installFinishDate)); row++;
  spacer(row); row++;

  // ══ COST COMPARISON ════════════════════════════════════════════════════════
  hdr(row, 2, 9, 'COST COMPARISON');
  setVal(row, 4, 'Exchange rate:'); pc.getRange(row,5).setValue(tc).setNumberFormat('#,##0.00');
  row++;

  // Sub-headers row: #ECEFF1 bg, black bold text
  pc.getRange(row,2,1,9).setBackground(PC_C.light).setFontColor('#000000').setFontWeight('bold');
  pc.getRange(row,2).setValue('ESTIMATED COSTS');
  pc.getRange(row,5).setValue('VALIDATION').setHorizontalAlignment('center');
  pc.getRange(row,7).setValue('SALES PRICE');
  pc.getRange(row,10).setValue('MARGIN').setHorizontalAlignment('center');
  pc.setRowHeight(row, 22); row++;

  // USD / MXN header
  pc.getRange(row, 2, 1, 9).setBackground(PC_C.light).setFontWeight('bold');
  setVal(row,3,'USD'); setVal(row,4,'MXN'); setVal(row,5,'vs range');
  setVal(row,8,'USD'); setVal(row,9,'MXN'); setVal(row,10,'%');
  [3,4,5,8,9,10].forEach(function(c){ pc.getRange(row,c).setHorizontalAlignment('right'); });
  row++;

  // Cost rows
  var cats = bom ? [
    { name:'Solar panels',    usd:bom.panels.usd,    mxn:bom.panels.mxn    },
    { name:'Inverters',       usd:bom.inverters.usd, mxn:bom.inverters.mxn },
    { name:'Structure',       usd:bom.structure.usd, mxn:bom.structure.mxn },
    { name:'Electric DC',     usd:bom.elecDc.usd,    mxn:bom.elecDc.mxn    },
    { name:'Electric AC',     usd:bom.elecAc.usd,    mxn:bom.elecAc.mxn    },
    { name:'Monitoring',      usd:bom.monitoring.usd,mxn:bom.monitoring.mxn},
    { name:'Permits & others',usd:bom.permits.usd,   mxn:bom.permits.mxn   },
    { name:'Installation',    usd:inst.usd,          mxn:inst.mxn          },
  ] : [];

  cats.forEach(function(cat, idx) {
    var bg = idx % 2 === 0 ? PC_C.white : PC_C.light;
    pc.getRange(row, 2, 1, 9).setBackground(bg);
    setVal(row, 2, cat.name);
    if (cat.usd > 0) {
      numCell(row, 3, Math.round(cat.usd));
      numCell(row, 4, Math.round(cat.mxn));
      var sUsd = salesOf(cat.usd);
      numCell(row, 8, Math.round(sUsd));
      numCell(row, 9, Math.round(sUsd * tc));
      pc.getRange(row,10).setValue(pctStr(margin)).setHorizontalAlignment('right');
    }
    // Validation
    if (dcKwp > 0 && cat.usd > 0) {
      var vr = pcInp.validation[cat.name];
      if (vr) {
        var kVal = cat.usd / dcKwp;
        var pass = kVal >= vr.min && kVal <= vr.max;
        pc.getRange(row,5).setValue(pass ? 'PASS' : 'FAIL')
          .setBackground(pass ? PC_C.pass : PC_C.fail)
          .setFontColor(pass ? PC_C.passFg : PC_C.failFg)
          .setFontWeight('bold').setHorizontalAlignment('center')
          .setNote('$' + kVal.toFixed(0) + '/kWp  \u2502  range $' + vr.min + '\u2013$' + vr.max + '/kWp');
      }
    }
    row++;
  });

  // TOTAL row
  var totCU = cats.reduce(function(s,c){return s+c.usd;},0);
  var totCM = cats.reduce(function(s,c){return s+c.mxn;},0);
  var totSU = salesOf(totCU);
  var totSM = totSU * tc;
  pc.getRange(row,2,1,9).setBackground(PC_C.section).setFontColor(PC_C.secFg).setFontWeight('bold');
  bold(row,2,'TOTAL');
  numCell(row,3,Math.round(totCU)); pc.getRange(row,3).setFontColor(PC_C.secFg);
  numCell(row,4,Math.round(totCM)); pc.getRange(row,4).setFontColor(PC_C.secFg);
  numCell(row,8,Math.round(totSU)); pc.getRange(row,8).setFontColor(PC_C.secFg);
  numCell(row,9,Math.round(totSM)); pc.getRange(row,9).setFontColor(PC_C.secFg);
  pc.getRange(row,10).setValue(pctStr(margin)).setFontColor(PC_C.secFg).setHorizontalAlignment('right');
  // Total validation
  if (dcKwp > 0 && totCU > 0) {
    var tvr = pcInp.validation['TOTAL'];
    if (tvr) {
      var tkv = totCU / dcKwp;
      var tp = tkv >= tvr.min && tkv <= tvr.max;
      pc.getRange(row,5).setValue(tp?'PASS':'FAIL')
        .setBackground(tp?PC_C.pass:PC_C.fail).setFontColor(tp?PC_C.passFg:PC_C.failFg)
        .setFontWeight('bold').setHorizontalAlignment('center');
    }
  }
  row++;

  // ── Payment / Discount rows (live formulas) ─────────────────────────────
  // totSalesRow = the TOTAL row just written above (row-1 after row++ for total)
  var totSalesRow = row - 1;  // TOTAL row with sales USD in col H, MXN in col I
  var costTotRow  = row - 1;  // same row, col C = cost USD total

  // Now write selling price formula back into ADDITIONAL INFORMATION section:
  // Selling price USD/Wp = H_totalSales / (H_powerPeak_kWp * 1000)
  // We stored powerPeakRow (H col has kWp value as text e.g. "864.0 kWp")
  // and sellingPriceRow (H col is blank, awaiting formula)
  // Since powerPeak cell has text like "864.0 kWp", we use the JS dcKwp value directly.
  // Formula: = H{totSalesRow} / ({dcKwp} * 1000) formatted as USD/Wp
  if (sellingPriceRow > 0 && totSalesRow > 0 && dcKwp > 0) {
    var spCell = pc.getRange(sellingPriceRow, 8);
    spCell.setFormula('=TEXT(H' + totSalesRow + '/(' + dcKwp + '*1000),"0.000") & " USD/Wp  |  " & TEXT(H' + totSalesRow + '/' + dcKwp + ',"#,##0") & " USD/kWp"');
    spCell.setNote('Calculated: Sales TOTAL / (kWp × 1000). Updates when discount changes.');
  }

  // Row: Payment Terms | (spacer) | Discount label + editable % cell
  pc.getRange(row,2,1,4).setBackground(PC_C.light);
  setVal(row,2,'Payment Terms [DP/D/C/P]:'); setVal(row,3,pcInp.paymentTerms);
  bold(row,7,'Discount %');
  // Discount % in col H — user can type e.g. 0.10 for 10%. Default 0.
  pc.getRange(row,8).setValue(0).setNumberFormat('0%').setHorizontalAlignment('right')
    .setBackground('#FFF9C4').setNote('Enter discount as decimal: 0.10 = 10%');
  var discountRow = row;  // remember for formula references
  row++;

  // Row: Payment Days | (spacer) | Price after discount (formula)
  setVal(row,2,'Payment time [days]:'); setVal(row,3,pcInp.paymentDays);
  bold(row,7,'Price after discount');
  // H = sales total × (1 - discount%)
  pc.getRange(row,8).setFormula('=H' + totSalesRow + '*(1-H' + discountRow + ')')
    .setNumberFormat('"$ "#,##0').setHorizontalAlignment('right');
  pc.getRange(row,9).setFormula('=H' + row + '*' + tc)
    .setNumberFormat('"$ "#,##0').setHorizontalAlignment('right');
  var padRow = row;  // price-after-discount row
  row++;

  // Row: Gross Profit (formula: price after discount − estimated total cost)
  pc.getRange(row,7,1,4).setBackground(PC_C.green);
  bold(row,7,'Gross Profit:');
  // Gross profit = price after discount USD − estimated total cost USD
  pc.getRange(row,8).setFormula('=H' + padRow + '-C' + totSalesRow)
    .setNumberFormat('"$ "#,##0').setFontWeight('bold').setHorizontalAlignment('right');
  pc.getRange(row,9).setFormula('=H' + row + '*' + tc)
    .setNumberFormat('"$ "#,##0').setFontWeight('bold').setHorizontalAlignment('right');
  // Margin % = gross profit / price after discount
  pc.getRange(row,10).setFormula('=IF(H' + padRow + '<>0,H' + row + '/H' + padRow + ',0)')
    .setNumberFormat('0%').setFontWeight('bold').setHorizontalAlignment('right');
  row++;
  spacer(row); row++;

  // ══ DOCUMENTATION ══════════════════════════════════════════════════════════
  hdr(row,2,4,'MANDATORY DOCUMENTATION');
  hdr(row,7,4,'ADDITIONAL DOCUMENTATION');
  row++;
  var md = [['Argia offer','Yes'],['Helioscope simulation','Yes'],
            ['Installation manual','Yes'],['Contract or Customer PO','Yes'],['Technical Audit','Yes']];
  var ad = [['Installation Quotation','No'],['RFQ','Yes'],['Harmonogram','No'],['Tender specification','Yes']];
  for (var di = 0; di < Math.max(md.length, ad.length); di++) {
    if (di < md.length) { setVal(row,2,md[di][0]); setVal(row,3,md[di][1]); }
    if (di < ad.length) { setVal(row,7,ad[di][0]); setVal(row,8,ad[di][1]); }
    row++;
  }
  spacer(row); row++;

  // ══ RISKS ══════════════════════════════════════════════════════════════════
  hdr(row,2,9,'RISKS MANAGEMENT:'); row++;
  ['Penalties:','Warranty:','Insurance:','Fire:','Workplace security:'].forEach(function(lbl) {
    setVal(row,2,lbl); row++;
  });
  spacer(row); row++;

  // ══ COMMENTS ═══════════════════════════════════════════════════════════════
  hdr(row,2,9,'COMMENTS:'); row++;
  pc.setRowHeight(row, 55); row += 2;

  // ══ SIGNATURES ═════════════════════════════════════════════════════════════
  var sigs = [
    ['SUBMITTED BY:',inp.designer,'(I take responsibility for delivering engineering design according to standards NOM)'],
    ['SUBMITTED BY:',pcInp.projectManager,''],
    ['RECEIVED BY:',inp.bizManager,'(I verified and taking responsibility)'],
    ['APPROVED BY:',pcInp.approvedBy,'(Budget approval)'],
  ];
  sigs.forEach(function(sig) {
    pc.getRange(row,2,1,8).setBackground(PC_C.light);
    bold(row,2,sig[0]); setVal(row,3,sig[1]); setVal(row,7,'Date:');
    row++;
    if (sig[2]) { setVal(row,3,sig[2]); row++; }
    spacer(row); row++;
  });

  SpreadsheetApp.flush();
  engineLog(ss, 'ProjectCard', 'OK',
    'PC written | ' + dcKwp.toFixed(1) + ' kWp | cost $' + costPerWpUsd.toFixed(3) +
    '/Wp | sell $' + selWp.toFixed(3) + '/Wp | margin ' + pctStr(margin) +
    ' | install MXN=' + Math.round(inst.mxn).toLocaleString());
}

// ---------------------------------------------------------------------------
// EXPORT PROJECT CARD as PDF
// ---------------------------------------------------------------------------
function exportProjectCard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var sh = ss.getSheetByName(SH_PC);
  if (!sh) {
    ui.alert('PROJECT_CARD sheet not found.\nRun "Generate Project Card" first.');
    return;
  }
  try {
    SpreadsheetApp.flush();
    Utilities.sleep(800);

    var fileName = (ss.getName() || 'ARGIA') + '_PROJECT_CARD.pdf';
    var url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() +
      '/export?format=pdf&size=A4&portrait=true&fitw=true&gridlines=false' +
      '&printtitle=false&sheetnames=false&pagenumbers=false&fzr=false' +
      '&gid=' + sh.getSheetId();
    var response = UrlFetchApp.fetch(url, {
      headers            : { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions : true,
    });
    var code = response.getResponseCode();
    if (code !== 200) {
      throw new Error('PDF export returned HTTP ' + code + '. ' + response.getContentText().substring(0, 300));
    }
    var blob = response.getBlob().setName(fileName);

    // Save to the same folder as the spreadsheet (no MASTERLINK dependency)
    var ssFile  = DriveApp.getFileById(ss.getId());
    var parents = ssFile.getParents();
    var folder  = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();

    // Also try offer folder from MASTERLINK if available (non-fatal if missing)
    try {
      var ml = ss.getSheetByName('00_MASTERLINK');
      if (ml) {
        var fid = String(ml.getRange(2, 8).getValue()).trim();
        if (fid) folder = DriveApp.getFolderById(fid);
      }
    } catch(e_) { /* ignore — use spreadsheet folder */ }

    // Overwrite existing
    var files = folder.getFilesByName(fileName);
    while (files.hasNext()) files.next().setTrashed(true);
    var saved = folder.createFile(blob);

    ui.alert('Project Card exported as PDF!\n\nFile: ' + fileName +
             '\nFolder: ' + folder.getName() + '\n\n' + saved.getUrl());
  } catch(e) {
    ui.alert('Export Project Card failed:\n' + e.message);
  }
}

// ---------------------------------------------------------------------------
// STANDALONE WITH HTML PROGRESS DIALOG
// ---------------------------------------------------------------------------
function runWriteProjectCard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var TOTAL = 5;

  try {
    _setArgiaProgress(0, TOTAL, 'Starting Project Card\u2026');
    _showArgiaProgress('ARGIA \u2014 Project Card');

    _setArgiaProgress(1, TOTAL, 'Reading inputs\u2026');
    var nom     = loadNomConstants(ss);
    var inp     = readInputs(ss);

    _setArgiaProgress(2, TOTAL, 'Loading equipment\u2026');
    var panel   = lookupPanel(ss, inp.panelModel);
    var invBank = buildInverterBank(ss, inp.inverterBank);
    var tbls    = readElecTables(ss);
    var dc      = calcDC(inp, panel, invBank, nom, tbls);

    _setArgiaProgress(3, TOTAL, 'Reading BOM & Installation totals\u2026');
    // (readBomSubtotals_ and readInstallTotal_ called inside writeProjectCard)

    _setArgiaProgress(4, TOTAL, 'Writing Project Card sheet\u2026');
    writeProjectCard(ss, inp, panel, invBank, dc);

    _setArgiaProgress(TOTAL, TOTAL, '\u2705 Done!');
    Utilities.sleep(1200);

    ui.alert('PROJECT CARD generated.\n\nFill blank fields directly in the sheet.\nUse ARGIA \u2192 Export Project Card to save as PDF.');
  } catch(e) {
    try { _setArgiaProgress(TOTAL, TOTAL, '\u274C Error'); } catch(_) {}
    ui.alert('Project Card Error', e.message, ui.ButtonSet.OK);
  }
}
