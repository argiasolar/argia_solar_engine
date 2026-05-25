// =============================================================================
// ARGIA ENGINE v2 -- File: writers_v2/WriteProjectCardV2.gs
// -----------------------------------------------------------------------------
// CHUNK 3 — PROJECT_CARD_v2 data writer.
//
// CONTRACT
//   writeProjectCardV2(ss, inp, panel, invBank, dc, ac, lay, nom, bessResult)
//   - Assumes setupProjectCardTemplate(ss) has run and PROJECT_CARD_v2 exists
//     with labels and section headers at the rows defined in PC_ROW.
//   - Writes ONLY data values + formulas at fixed (row, col) addresses.
//   - Idempotent at the data level: same inputs -> same cells.
//
// SIGNATURE PARITY WITH writeMdcV2
//   This writer takes (ac, lay, nom) even though it doesn't use them, so the
//   engine-to-writer contract is uniform across v2 writers. The migration
//   plan locks this convention (see OUTPUT_V2_MIGRATION_PLAN.md §Chunk 3).
//
// PARITY WITH LEGACY
//   Mirrors 14_WriteProjectCard.js semantics for the 8 PV cost categories,
//   margin derivation, validation envelope, and gross-profit formula. The
//   only deliberate additions are:
//     1. 9th cost row "Almacenamiento (BESS)" — value = BOM SUBTOTAL_BESS.
//     2. Scope-of-work BESS line when bessEnabled.
//     3. Additional Info "Storage" right-pane row when bessEnabled.
//     4. costRangeBessMin / costRangeBessMax (USD/kWh) drive the BESS row's
//        PASS/FAIL validation.
//
// READS FROM
//   - INPUT_PROJECT (via readInput): margin, dates, project number, etc.
//   - BOM sheet (legacy): 7 subtotal rows in col F (USD) and G (MXN)
//   - BOM!SUBTOTAL_BESS (row 92): BESS subtotal — only when bessEnabled
//   - INSTALLATION sheet (legacy): G9 = TOTAL_INSTALLATION_COST_MXN
//   - BOM!EXCHANGE_RATE (row 6, col F): MXN per USD rate
//
//   PC_v2 deliberately reads from legacy BOM and INSTALLATION sheets, NOT
//   from BOM_v2 / INSTALLATION_v2. Reason: those sheets don't exist yet
//   (BOM_v2 ships in Chunk 4, INSTALLATION_v2 in Chunk 5). When they ship
//   we can flip a flag here. Until then PC_v2 mirrors legacy PC's data
//   sources so numeric parity is preserved.
//
// CALLED BY
//   runArgiaEngine() (Step 13-v2), wrapped in try/catch so a v2 bug never
//   breaks the legacy Project Card.
//
// DEPENDENCIES
//   - V2_SHEETS.PROJECT_CARD     -- templates/TemplateRegistry.gs
//   - PC_ROW, PC_COL             -- 00_Main.js (Chunk 3 additions)
//   - SH.BOM, BOM_ROW, BOM_COL   -- 00_Main.js (shared with legacy)
//   - readInput                   -- 02d_InputIO.js
// =============================================================================


// -----------------------------------------------------------------------------
// PC_V2_PALETTE — shared with setupProjectCardTemplate.gs. Idempotent guard:
// whichever file loads first wins, and the other reads the existing object.
// Defined here (and identically in the template) so the writer can run in
// unit tests without requiring the template file in the same compilation unit.
// -----------------------------------------------------------------------------
var PC_V2_PALETTE = (typeof PC_V2_PALETTE !== 'undefined' && PC_V2_PALETTE) ? PC_V2_PALETTE : {
  navy     : '#0D1B2A',  navyFg  : '#FFFFFF',
  section  : '#37474F',  secFg   : '#FFFFFF',
  blue     : '#1565C0',  blueFg  : '#FFFFFF',
  light    : '#ECEFF1',
  white    : '#FFFFFF',
  green    : '#E8F5E9',
  pass     : '#C8E6C9',  passFg  : '#1B5E20',
  fail     : '#FFCDD2',  failFg  : '#B71C1C',
  orange   : '#FFF8E1'
};


// -----------------------------------------------------------------------------
// writeProjectCardV2
// -----------------------------------------------------------------------------
//   The 10th parameter (_testOpts) is a hidden test seam — production callers
//   omit it. It currently exposes one knob:
//     _testOpts.readInputFn(ss, key) → override for the global readInput().
//   Apps Script V8 resolves bare-name function calls to lexical bindings,
//   not globalThis properties, so we can't unit-test by swapping
//   globalThis.readInput. The optional injection is the cleanest seam.
// -----------------------------------------------------------------------------
function writeProjectCardV2(ss, inp, panel, invBank, dc, ac, lay, nom, bessResult, _testOpts) {
  ss = ss || SpreadsheetApp.getActive();
  _testOpts = _testOpts || {};
  var readInputFn = _testOpts.readInputFn || null;  // _pcv2ReadPcInputs falls back to global readInput when null

  var sheetName = V2_SHEETS.PROJECT_CARD;
  var pc = ss.getSheetByName(sheetName);
  if (!pc) {
    throw new Error('writeProjectCardV2: ' + sheetName + ' sheet not found. '
                  + 'Call setupProjectCardTemplate(ss) first.');
  }

  // ---- Resolve inputs -----------------------------------------------------
  var pcInp = _pcv2ReadPcInputs(ss, readInputFn);
  var bom   = _pcv2ReadBomSubtotals(ss);
  var inst  = _pcv2ReadInstallTotal(ss);
  var tc    = _pcv2ReadExchangeRate(ss);

  // BESS visibility flag. Mirrors writeMdcV2's check. PC_v2 shows the BESS
  // row regardless of bessEnabled (template owns the row), but only fills
  // values when both flags are true and a positive BOM subtotal exists.
  var bessEnabled = !!(bessResult && bessResult.bessEnabled && bessResult.bess);
  var bessUsd     = bessEnabled ? _pcv2ReadBessSubtotal(ss).usd : 0;
  var bessMxn     = bessEnabled ? _pcv2ReadBessSubtotal(ss).mxn : 0;

  var dcKwp = (dc && dc.dcKwp) || 0;
  var dcWp  = dcKwp * 1000;

  // ---- Cost totals --------------------------------------------------------
  var matUsd = bom ? (bom.panels.usd + bom.inverters.usd + bom.structure.usd +
               bom.elecDc.usd + bom.elecAc.usd + bom.monitoring.usd + bom.permits.usd) : 0;
  // bessUsd is added explicitly (it's not part of bom subtotals struct,
  // which intentionally mirrors the 7 legacy categories)
  var totalCostUsd  = matUsd + inst.usd + bessUsd;
  var costPerWpUsd  = dcWp  > 0 ? totalCostUsd / dcWp  : 0;

  // ---- Margin derivation (mirror legacy semantics) ------------------------
  // If margin was explicitly entered (>0), use it directly.
  // If margin=0 but selling price is known, derive from cost.
  // Only fall back to 20% if absolutely nothing is available.
  var selWp  = pcInp.sellingPriceWpUsd;
  var margin = pcInp.marginPct;
  if (margin <= 0 && selWp > 0 && costPerWpUsd > 0) {
    margin = (selWp - costPerWpUsd) / selWp;
  }
  if (margin <= 0) margin = 0.20;

  function salesOf(cost) { return margin < 1 ? cost / (1 - margin) : cost; }
  function fmtD(d) {
    if (!d) return '';
    if (d instanceof Date) return Utilities.formatDate(d, 'America/Monterrey', 'dd/MM/yyyy');
    return String(d);
  }
  function pctStr(n) { return Math.round(n * 100) + '%'; }

  function num(r, c, v) {
    pc.getRange(r, c).setValue(v)
      .setNumberFormat('"$\u00a0"#,##0')
      .setHorizontalAlignment('right');
  }
  function setIf(r, c, v) {
    if (v !== '' && v !== null && v !== undefined) pc.getRange(r, c).setValue(v);
  }

  // ========================================================================
  // §0  TITLE BAR — fill project number + date (labels were from template)
  // ========================================================================
  setIf(PC_ROW.TITLE, PC_COL.MXN_COST, pcInp.projectNumber);
  var today = Utilities.formatDate(new Date(), 'America/Monterrey',
                                   "dd 'de' MMMM 'de' yyyy");
  pc.getRange(PC_ROW.TITLE, PC_COL.USD_SALES)
    .setValue(today).setHorizontalAlignment('right');

  // ========================================================================
  // §1  BUSINESS CASE
  // ========================================================================
  setIf(PC_ROW.BUSINESS_CUSTOMER, PC_COL.USD_COST, inp.clientName);
  setIf(PC_ROW.BUSINESS_PROJECT,  PC_COL.USD_COST, inp.projectName);
  var loc = [inp.street, inp.city, inp.state].filter(Boolean).join(', ');
  setIf(PC_ROW.BUSINESS_LOCATION, PC_COL.USD_COST, loc);

  // ========================================================================
  // §2  PROJECT TEAM
  // ========================================================================
  setIf(PC_ROW.TEAM_BIZ_MANAGER,  PC_COL.USD_COST, inp.bizManager);
  setIf(PC_ROW.TEAM_DESIGNER,     PC_COL.USD_COST, inp.designer);
  setIf(PC_ROW.TEAM_PROJ_MANAGER, PC_COL.USD_COST, pcInp.projectManager);

  // ========================================================================
  // §3  SCOPE OF WORK (left pane) + ADDITIONAL INFORMATION (right pane)
  // ========================================================================
  // Build the scope-of-work item list. Each entry: [description, qty_string]
  var scopeItems = [];
  var panelLabel = ((panel['PANEL_BRAND'] || '') + ' ' +
                    (panel['PANEL_MODEL'] || '') + ' ' +
                    (panel['PANEL_POWER_W'] || '') + 'W').trim();
  scopeItems.push([panelLabel, inp.panelQty + ' pcs']);

  if (Array.isArray(invBank)) {
    invBank.forEach(function(inv) {
      scopeItems.push([inv.model + ' ' + inv.acKw + 'kW', inv.qty + ' pcs']);
    });
  }
  if (inp.structure)  scopeItems.push([inp.structure,  (inp.panelQty || '') + ' pcs']);
  if (inp.structure2) scopeItems.push([inp.structure2, '']);

  // BESS scope line (Chunk 3). One row only, no separate container row.
  // Format: "<batteryId> — <stackQty> stack(s) (<capacityKwh> kWh nominal)"
  // Fallback to "Battery storage system" when batteryId is CUSTOM_MANUAL.
  if (bessEnabled) {
    var b   = bessResult.bess;
    var bid = String(b.batteryId || '').trim();
    var sq  = Number(b.stackQty) || 1;
    var cap = Number(b.capacityKwh) || 0;
    var stackWord = sq === 1 ? 'stack' : 'stacks';
    var displayId = (bid === 'CUSTOM_MANUAL' || bid === '') ? 'Battery storage system' : bid;
    var bessScopeLabel = displayId + ' \u2014 ' + sq + ' ' + stackWord +
                         ' (' + Math.round(cap) + ' kWh nominal)';
    // The qty cell shows total kWh capacity (more useful than "1 system")
    scopeItems.push([bessScopeLabel, Math.round(cap) + ' kWh']);
  }

  // Write scope items into rows SCOPE_ROW_FIRST..SCOPE_ROW_LAST.
  // Cap at the available slots so we never overflow into SCHEDULE rows below.
  var maxScopeSlots = PC_ROW.SCOPE_ROW_LAST - PC_ROW.SCOPE_ROW_FIRST + 1;
  for (var si = 0; si < Math.min(scopeItems.length, maxScopeSlots); si++) {
    var r = PC_ROW.SCOPE_ROW_FIRST + si;
    setIf(r, PC_COL.LABEL_L, scopeItems[si][0]);
    setIf(r, PC_COL.MXN_COST, scopeItems[si][1]);   // col D
  }

  // Right pane: Additional Information values
  setIf(PC_ROW.INFO_POWER_PEAK,   PC_COL.USD_SALES,
        dcKwp.toFixed(1) + ' kWp');
  setIf(PC_ROW.INFO_COVERAGE,     PC_COL.USD_SALES,
        pcInp.systemCoveragePct > 0 ? pctStr(pcInp.systemCoveragePct) : '\u2014');
  setIf(PC_ROW.INFO_INSTALL_TYPE, PC_COL.USD_SALES,
        inp.businessType || '\u2014');
  // INFO_SELLING_PRICE col H is filled by formula later (after TOTAL row known)
  setIf(PC_ROW.INFO_COST,         PC_COL.USD_SALES,
        costPerWpUsd > 0 ? costPerWpUsd.toFixed(3) + ' USD/Wp' : '\u2014');
  // Storage: capacity only (no power), per decision #3
  if (bessEnabled) {
    var capKwh = Math.round(Number(bessResult.bess.capacityKwh) || 0);
    setIf(PC_ROW.INFO_STORAGE, PC_COL.USD_SALES, capKwh + ' kWh');
  } else {
    setIf(PC_ROW.INFO_STORAGE, PC_COL.USD_SALES, '\u2014');
  }

  // ========================================================================
  // §4  SCHEDULE
  // ========================================================================
  setIf(PC_ROW.SCHEDULE_R1, PC_COL.USD_COST,  fmtD(pcInp.contractSignDate));
  setIf(PC_ROW.SCHEDULE_R1, PC_COL.USD_SALES, fmtD(pcInp.contractFinishDate));
  setIf(PC_ROW.SCHEDULE_R2, PC_COL.USD_COST,  fmtD(pcInp.equipmentDeliveryDate));
  setIf(PC_ROW.SCHEDULE_R3, PC_COL.USD_COST,  fmtD(pcInp.installStartDate));
  setIf(PC_ROW.SCHEDULE_R3, PC_COL.USD_SALES, fmtD(pcInp.installFinishDate));

  // ========================================================================
  // §5  COST COMPARISON
  // ========================================================================
  // Header row: exchange rate value in col E (label was set by template in col D)
  pc.getRange(PC_ROW.SEC_COST_HEADER, PC_COL.VALIDATION)
    .setValue(tc)
    .setNumberFormat('#,##0.00')
    .setFontColor(PC_V2_PALETTE.secFg)
    .setBackground(PC_V2_PALETTE.section);

  // 9 cost categories at fixed rows
  // bom may be null if BOM sheet is missing — in that case we still write
  // labels (template did) but values are 0/blank. Tests cover this.
  var cats = [
    { row: PC_ROW.COST_PANELS,     name: 'Solar panels',
      usd: bom ? bom.panels.usd    : 0, mxn: bom ? bom.panels.mxn    : 0 },
    { row: PC_ROW.COST_INVERTERS,  name: 'Inverters',
      usd: bom ? bom.inverters.usd : 0, mxn: bom ? bom.inverters.mxn : 0 },
    { row: PC_ROW.COST_STRUCTURE,  name: 'Structure',
      usd: bom ? bom.structure.usd : 0, mxn: bom ? bom.structure.mxn : 0 },
    { row: PC_ROW.COST_ELEC_DC,    name: 'Electric DC',
      usd: bom ? bom.elecDc.usd    : 0, mxn: bom ? bom.elecDc.mxn    : 0 },
    { row: PC_ROW.COST_ELEC_AC,    name: 'Electric AC',
      usd: bom ? bom.elecAc.usd    : 0, mxn: bom ? bom.elecAc.mxn    : 0 },
    { row: PC_ROW.COST_MONITORING, name: 'Monitoring',
      usd: bom ? bom.monitoring.usd: 0, mxn: bom ? bom.monitoring.mxn: 0 },
    { row: PC_ROW.COST_PERMITS,    name: 'Permits & others',
      usd: bom ? bom.permits.usd   : 0, mxn: bom ? bom.permits.mxn   : 0 },
    { row: PC_ROW.COST_INSTALL,    name: 'Installation',
      usd: inst.usd, mxn: inst.mxn },
    // BESS row — populated even when disabled (with zeros), so the row layout
    // is consistent across PV-only and BESS projects. Validation column for
    // BESS uses a different unit ($/kWh USD vs $/kWp USD for the PV rows),
    // handled separately below.
    { row: PC_ROW.COST_BESS,       name: 'Almacenamiento (BESS)',
      usd: bessUsd, mxn: bessMxn }
  ];

  cats.forEach(function(cat) {
    if (cat.usd > 0) {
      num(cat.row, PC_COL.USD_COST,  Math.round(cat.usd));
      num(cat.row, PC_COL.MXN_COST,  Math.round(cat.mxn));
      var sUsd = salesOf(cat.usd);
      num(cat.row, PC_COL.USD_SALES, Math.round(sUsd));
      num(cat.row, PC_COL.MXN_SALES, Math.round(sUsd * tc));
      pc.getRange(cat.row, PC_COL.MARGIN_PCT)
        .setValue(pctStr(margin)).setHorizontalAlignment('right');
    } else {
      // Cost is zero — render em-dash in cost & sales cells. Keeps the row
      // visually present (matches template striping) without confusing $0.
      pc.getRange(cat.row, PC_COL.USD_COST).setValue('\u2014').setHorizontalAlignment('right');
      pc.getRange(cat.row, PC_COL.MXN_COST).setValue('\u2014').setHorizontalAlignment('right');
      pc.getRange(cat.row, PC_COL.USD_SALES).setValue('\u2014').setHorizontalAlignment('right');
      pc.getRange(cat.row, PC_COL.MXN_SALES).setValue('\u2014').setHorizontalAlignment('right');
    }

    // Validation column
    _pcv2WriteValidation(pc, cat, pcInp, dcKwp, bessResult);
  });

  // ---- TOTAL row ----------------------------------------------------------
  var totCU = 0, totCM = 0;
  cats.forEach(function(c) { totCU += c.usd; totCM += c.mxn; });
  var totSU = salesOf(totCU);
  var totSM = totSU * tc;
  pc.getRange(PC_ROW.COST_TOTAL, PC_COL.USD_COST)
    .setValue(Math.round(totCU))
    .setNumberFormat('"$\u00a0"#,##0')
    .setHorizontalAlignment('right')
    .setFontColor(PC_V2_PALETTE.secFg);
  pc.getRange(PC_ROW.COST_TOTAL, PC_COL.MXN_COST)
    .setValue(Math.round(totCM))
    .setNumberFormat('"$\u00a0"#,##0')
    .setHorizontalAlignment('right')
    .setFontColor(PC_V2_PALETTE.secFg);
  pc.getRange(PC_ROW.COST_TOTAL, PC_COL.USD_SALES)
    .setValue(Math.round(totSU))
    .setNumberFormat('"$\u00a0"#,##0')
    .setHorizontalAlignment('right')
    .setFontColor(PC_V2_PALETTE.secFg);
  pc.getRange(PC_ROW.COST_TOTAL, PC_COL.MXN_SALES)
    .setValue(Math.round(totSM))
    .setNumberFormat('"$\u00a0"#,##0')
    .setHorizontalAlignment('right')
    .setFontColor(PC_V2_PALETTE.secFg);
  pc.getRange(PC_ROW.COST_TOTAL, PC_COL.MARGIN_PCT)
    .setValue(pctStr(margin))
    .setFontColor(PC_V2_PALETTE.secFg)
    .setHorizontalAlignment('right');

  // TOTAL validation (uses costRangeTotalMin/Max in USD/kWp)
  if (dcKwp > 0 && totCU > 0) {
    var tvr = pcInp.validation['TOTAL'];
    if (tvr) {
      var tkv = totCU / dcKwp;
      var tp = tkv >= tvr.min && tkv <= tvr.max;
      pc.getRange(PC_ROW.COST_TOTAL, PC_COL.VALIDATION)
        .setValue(tp ? 'PASS' : 'FAIL')
        .setBackground(tp ? PC_V2_PALETTE.pass : PC_V2_PALETTE.fail)
        .setFontColor(tp ? PC_V2_PALETTE.passFg : PC_V2_PALETTE.failFg)
        .setFontWeight('bold')
        .setHorizontalAlignment('center');
    }
  }

  // ========================================================================
  // §5b  PRICE / DISCOUNT / GROSS PROFIT (live formulas)
  // ========================================================================
  // Selling price USD/Wp formula goes back into the Additional Info pane,
  // referring to the TOTAL row's sales USD cell so it stays live if the
  // discount changes.
  if (dcKwp > 0) {
    var spCell = pc.getRange(PC_ROW.INFO_SELLING_PRICE, PC_COL.USD_SALES);
    spCell.setFormula('=TEXT(H' + PC_ROW.COST_TOTAL + '/(' + dcKwp + '*1000),"0.000") '
                    + '& " USD/Wp  |  " '
                    + '& TEXT(H' + PC_ROW.COST_TOTAL + '/' + dcKwp + ',"#,##0") '
                    + '& " USD/kWp"');
    spCell.setNote('Calculated: Sales TOTAL / (kWp \u00d7 1000). Updates when discount changes.');
  }

  // Discount row: payment terms label in C, discount % entry in H.
  setIf(PC_ROW.PRICE_DISCOUNT_ROW, PC_COL.USD_COST, pcInp.paymentTerms);
  pc.getRange(PC_ROW.PRICE_DISCOUNT_ROW, PC_COL.USD_SALES)
    .setValue(0)
    .setNumberFormat('0%')
    .setHorizontalAlignment('right')
    .setBackground('#FFF9C4')
    .setNote('Enter discount as decimal: 0.10 = 10%');

  // Payment time row + price-after-discount formula
  setIf(PC_ROW.PRICE_AFTER_DISC, PC_COL.USD_COST, pcInp.paymentDays);
  pc.getRange(PC_ROW.PRICE_AFTER_DISC, PC_COL.USD_SALES)
    .setFormula('=H' + PC_ROW.COST_TOTAL +
                '*(1-H' + PC_ROW.PRICE_DISCOUNT_ROW + ')')
    .setNumberFormat('"$\u00a0"#,##0')
    .setHorizontalAlignment('right');
  pc.getRange(PC_ROW.PRICE_AFTER_DISC, PC_COL.MXN_SALES)
    .setFormula('=H' + PC_ROW.PRICE_AFTER_DISC + '*' + tc)
    .setNumberFormat('"$\u00a0"#,##0')
    .setHorizontalAlignment('right');

  // Gross profit formula = price after discount USD − total cost USD
  pc.getRange(PC_ROW.PRICE_GROSS_PROFIT, PC_COL.USD_SALES)
    .setFormula('=H' + PC_ROW.PRICE_AFTER_DISC +
                '-C' + PC_ROW.COST_TOTAL)
    .setNumberFormat('"$\u00a0"#,##0')
    .setFontWeight('bold')
    .setHorizontalAlignment('right');
  pc.getRange(PC_ROW.PRICE_GROSS_PROFIT, PC_COL.MXN_SALES)
    .setFormula('=H' + PC_ROW.PRICE_GROSS_PROFIT + '*' + tc)
    .setNumberFormat('"$\u00a0"#,##0')
    .setFontWeight('bold')
    .setHorizontalAlignment('right');
  // Margin % = gross profit / price after discount
  pc.getRange(PC_ROW.PRICE_GROSS_PROFIT, PC_COL.MARGIN_PCT)
    .setFormula('=IF(H' + PC_ROW.PRICE_AFTER_DISC +
                '<>0,H' + PC_ROW.PRICE_GROSS_PROFIT +
                '/H' + PC_ROW.PRICE_AFTER_DISC + ',0)')
    .setNumberFormat('0%')
    .setFontWeight('bold')
    .setHorizontalAlignment('right');

  // ========================================================================
  // §9  SIGNATURES — fill the name cells (labels & narratives are template)
  // ========================================================================
  setIf(PC_ROW.SIG_SUBMITTED_DESIGN, PC_COL.USD_COST, inp.designer);
  setIf(PC_ROW.SIG_SUBMITTED_PM,     PC_COL.USD_COST, pcInp.projectManager);
  setIf(PC_ROW.SIG_RECEIVED,         PC_COL.USD_COST, inp.bizManager);
  setIf(PC_ROW.SIG_APPROVED,         PC_COL.USD_COST, pcInp.approvedBy);

  SpreadsheetApp.flush();
  if (typeof engineLog === 'function') {
    engineLog(ss, 'WriteProjectCardV2', 'OK',
      'PC_v2 written | ' + dcKwp.toFixed(1) + ' kWp | cost $' + costPerWpUsd.toFixed(3) +
      '/Wp | margin ' + pctStr(margin) +
      (bessEnabled ? ' | BESS subtotal USD $' + Math.round(bessUsd) : ' | PV-only'));
  }
}


// -----------------------------------------------------------------------------
// _pcv2WriteValidation
// -----------------------------------------------------------------------------
//   Writes PASS / FAIL into the validation column for one cost row. Three
//   denominators in play:
//     - PV cost rows (panels..install): $/kWp USD (legacy convention)
//     - TOTAL: $/kWp USD (legacy)
//     - BESS:   $/kWh USD nominal (Chunk 3, calibrated from 4 BAAS files)
//   PV-only projects skip the BESS validation entirely (no FAIL on a "$0/kWh
//   BESS" row).
// -----------------------------------------------------------------------------
function _pcv2WriteValidation(pc, cat, pcInp, dcKwp, bessResult) {
  if (cat.usd <= 0) return;  // nothing to validate

  var range, value, denom, kVal;

  // BESS row: $/kWh USD nominal
  if (cat.row === PC_ROW.COST_BESS) {
    if (!bessResult || !bessResult.bessEnabled || !bessResult.bess) return;
    var capKwh = Number(bessResult.bess.capacityKwh) || 0;
    if (capKwh <= 0) return;
    var bessVr = pcInp.validation['BESS'];
    if (!bessVr) return;
    kVal = cat.usd / capKwh;
    var bessPass = kVal >= bessVr.min && kVal <= bessVr.max;
    pc.getRange(cat.row, PC_COL.VALIDATION)
      .setValue(bessPass ? 'PASS' : 'FAIL')
      .setBackground(bessPass ? PC_V2_PALETTE.pass : PC_V2_PALETTE.fail)
      .setFontColor(bessPass ? PC_V2_PALETTE.passFg : PC_V2_PALETTE.failFg)
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setNote('$' + kVal.toFixed(0) + '/kWh  \u2502  range $' +
               bessVr.min + '\u2013$' + bessVr.max + '/kWh');
    return;
  }

  // PV rows: $/kWp USD
  if (dcKwp <= 0) return;
  var vr = pcInp.validation[cat.name];
  if (!vr) return;
  kVal = cat.usd / dcKwp;
  var pass = kVal >= vr.min && kVal <= vr.max;
  pc.getRange(cat.row, PC_COL.VALIDATION)
    .setValue(pass ? 'PASS' : 'FAIL')
    .setBackground(pass ? PC_V2_PALETTE.pass : PC_V2_PALETTE.fail)
    .setFontColor(pass ? PC_V2_PALETTE.passFg : PC_V2_PALETTE.failFg)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setNote('$' + kVal.toFixed(0) + '/kWp  \u2502  range $' +
             vr.min + '\u2013$' + vr.max + '/kWp');
}


// -----------------------------------------------------------------------------
// _pcv2ReadPcInputs(ss, readInputFn) — same shape as legacy readPcInputs_, plus BESS range
// -----------------------------------------------------------------------------
//   Reads validation envelopes for the 8 legacy categories + TOTAL + BESS,
//   plus the standalone PC input fields (selling price, margin, dates, etc).
//   Pure read function — never mutates the sheet.
//
//   readInputFn is an optional override for unit tests. When omitted, the
//   global readInput() (from 02d_InputIO.gs) is used. We DON'T rely on
//   globalThis.readInput swap because V8's bare-name resolution prefers
//   the lexical binding over the global property.
// -----------------------------------------------------------------------------
function _pcv2ReadPcInputs(ss, readInputFn) {
  var rd = readInputFn || readInput;

  // 8 PV categories + TOTAL: $/kWp USD. BESS: $/kWh USD nominal.
  var COST_RANGE_KEYS = [
    ['Solar panels',         'costRangePanelsMin',     'costRangePanelsMax'],
    ['Inverters',            'costRangeInvertersMin',  'costRangeInvertersMax'],
    ['Structure',            'costRangeStructureMin',  'costRangeStructureMax'],
    ['Electric DC',          'costRangeElecDcMin',     'costRangeElecDcMax'],
    ['Electric AC',          'costRangeElecAcMin',     'costRangeElecAcMax'],
    ['Monitoring',           'costRangeMonitoringMin', 'costRangeMonitoringMax'],
    ['Permits & others',     'costRangePermitsMin',    'costRangePermitsMax'],
    ['Installation',         'costRangeInstallMin',    'costRangeInstallMax'],
    ['TOTAL',                'costRangeTotalMin',      'costRangeTotalMax'],
    ['BESS',                 'costRangeBessMin',       'costRangeBessMax']   // NEW
  ];

  var validation = {};
  COST_RANGE_KEYS.forEach(function(triple) {
    var label = triple[0];
    var min   = parseFloat(rd(ss, triple[1]));
    var max   = parseFloat(rd(ss, triple[2]));
    validation[label] = {
      min: isNaN(min) ? 0        : min,
      max: isNaN(max) ? Infinity : max
    };
  });

  function s(key, fb) {
    var v = rd(ss, key);
    if (v === '' || v === null || v === undefined) return fb || '';
    return String(v).trim();
  }
  function n(key) {
    var v = parseFloat(rd(ss, key));
    return isNaN(v) ? 0 : v;
  }
  function intOr(key, fb) {
    var v = parseInt(rd(ss, key));
    return isNaN(v) ? fb : v;
  }
  function dateOr(key) {
    var v = rd(ss, key);
    if (v === '' || v === null || v === undefined) return '';
    return v;
  }

  return {
    projectNumber        : s('projectNumber',        '\u2014'),
    projectManager       : s('projectManager',       ''),
    systemCoveragePct    : n('systemCoveragePct'),
    sellingPriceWpUsd    : n('sellingPriceUsdPerWp'),
    marginPct            : n('marginPct'),
    paymentTerms         : s('paymentTerms',         'N/A'),
    paymentDays          : intOr('paymentDays',       14),
    contractSignDate     : dateOr('dateSign'),
    contractFinishDate   : dateOr('dateFinishContract'),
    equipmentDeliveryDate: dateOr('dateDelivery'),
    installStartDate     : dateOr('dateInstallStart'),
    installFinishDate    : dateOr('dateInstallFinish'),
    receivedBy           : s('receivedBy',           'Luis Juaristi'),
    approvedBy           : s('approvedBy',           'Vit Kovarik'),
    validation           : validation
  };
}


// -----------------------------------------------------------------------------
// _pcv2ReadBomSubtotals(ss) — 7 PV categories from legacy BOM sheet
// -----------------------------------------------------------------------------
//   Mirrors readBomSubtotals_ in 14_WriteProjectCard.js exactly. Same row
//   constants, same Monitoring-minus-Permits-Services arithmetic.
// -----------------------------------------------------------------------------
function _pcv2ReadBomSubtotals(ss) {
  var sh = ss.getSheetByName(SH.BOM);
  if (!sh) return null;
  function usd(row) { return parseFloat(sh.getRange(row, 6).getValue()) || 0; }
  function mxn(row) { return parseFloat(sh.getRange(row, 7).getValue()) || 0; }

  var permU = usd(BOM_ROW.MON_UVIE) + usd(BOM_ROW.MON_CFE) +
              usd(BOM_ROW.MON_COMMISSIONING) + usd(BOM_ROW.MON_THERMOGRAPHY);
  var permM = mxn(BOM_ROW.MON_UVIE) + mxn(BOM_ROW.MON_CFE) +
              mxn(BOM_ROW.MON_COMMISSIONING) + mxn(BOM_ROW.MON_THERMOGRAPHY);
  var monU = usd(BOM_ROW.SUBTOTAL_MONITORING) - permU;
  var monM = mxn(BOM_ROW.SUBTOTAL_MONITORING) - permM;

  return {
    panels    : { usd: usd(BOM_ROW.SUBTOTAL_PANELS),    mxn: mxn(BOM_ROW.SUBTOTAL_PANELS)    },
    inverters : { usd: usd(BOM_ROW.SUBTOTAL_INVERTERS), mxn: mxn(BOM_ROW.SUBTOTAL_INVERTERS) },
    structure : { usd: usd(BOM_ROW.SUBTOTAL_STRUCTURE), mxn: mxn(BOM_ROW.SUBTOTAL_STRUCTURE) },
    elecDc    : { usd: usd(BOM_ROW.SUBTOTAL_DC),        mxn: mxn(BOM_ROW.SUBTOTAL_DC)        },
    elecAc    : { usd: usd(BOM_ROW.SUBTOTAL_AC) + usd(BOM_ROW.SUBTOTAL_TRANSFORMER),
                  mxn: mxn(BOM_ROW.SUBTOTAL_AC) + mxn(BOM_ROW.SUBTOTAL_TRANSFORMER) },
    monitoring: { usd: monU < 0 ? 0 : monU, mxn: monM < 0 ? 0 : monM },
    permits   : { usd: permU, mxn: permM }
  };
}


// -----------------------------------------------------------------------------
// _pcv2ReadBessSubtotal(ss) — Chunk 3: BESS subtotal from legacy BOM row 92
// -----------------------------------------------------------------------------
//   Returns { usd, mxn } from BOM!F92 / G92. Returns zeros if BOM sheet
//   missing. Mirrors the read pattern in _pcv2ReadBomSubtotals.
// -----------------------------------------------------------------------------
function _pcv2ReadBessSubtotal(ss) {
  var sh = ss.getSheetByName(SH.BOM);
  if (!sh) return { usd: 0, mxn: 0 };
  var usd = parseFloat(sh.getRange(BOM_ROW.SUBTOTAL_BESS, 6).getValue()) || 0;
  var mxn = parseFloat(sh.getRange(BOM_ROW.SUBTOTAL_BESS, 7).getValue()) || 0;
  return { usd: usd, mxn: mxn };
}


// -----------------------------------------------------------------------------
// _pcv2ReadInstallTotal(ss) — Installation total from legacy sheet
// -----------------------------------------------------------------------------
//   Same fallback chain as legacy readInstallTotal_: primary cell G9, then
//   summary block scan, then column scan from bottom.
// -----------------------------------------------------------------------------
function _pcv2ReadInstallTotal(ss) {
  var sh = ss.getSheetByName('INSTALLATION') || ss.getSheetByName('INSTALL_COST');
  if (!sh) return { usd: 0, mxn: 0 };

  var tc = _pcv2ReadExchangeRate(ss);

  var mxnVal = parseFloat(sh.getRange(9, 7).getValue()) || 0;
  if (mxnVal > 0) {
    return { usd: mxnVal / tc, mxn: mxnVal };
  }

  // Fallback 1: search rows 4-22 col G
  var bestMxn = 0;
  for (var r = 4; r <= 22; r++) {
    var v = parseFloat(sh.getRange(r, 7).getValue()) || 0;
    if (v > bestMxn) bestMxn = v;
  }
  if (bestMxn > 0) return { usd: bestMxn / tc, mxn: bestMxn };

  // Fallback 2: scan col G from bottom
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


// -----------------------------------------------------------------------------
// _pcv2ReadExchangeRate(ss) — MXN/USD from BOM!F6, fallback 18.5
// -----------------------------------------------------------------------------
function _pcv2ReadExchangeRate(ss) {
  try {
    var sh = ss.getSheetByName(SH.BOM);
    if (!sh) return 18.5;
    var v = parseFloat(sh.getRange(BOM_ROW.EXCHANGE_RATE, BOM_COL.TOTAL_USD).getValue());
    return v > 0 ? v : 18.5;
  } catch (e) {
    return 18.5;
  }
}
