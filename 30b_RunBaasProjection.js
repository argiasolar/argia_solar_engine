// =============================================================================
// ARGIA -- 30b_RunBaasProjection.js
// -----------------------------------------------------------------------------
// CHUNK 6 -- BaaS Economics Engine: live wiring (Option A, standalone)
//
// Assembles the BaaS inputs from the workbook, runs calcBaasEconomics, and
// writes BAAS_PROJECTION_v2. BaaS is a STANDALONE battery-as-a-service lease
// model -- it touches nothing in the PPA / FINANCE / 41M_FINANCE_CALCULATOR
// path. (PPA = solar; BaaS = battery; they do not combine, per 2026-05-29.)
//
// BAAS CAPEX = BESS materials + BESS installation (BOTH, summed):
//   materials : BOM_v2!G92            (SUBTOTAL §8 BESS, MXN)
//   install   : INSTALLATION_v2 BESS section row 22 -> G22 labor + H22 equip
// Reading only the materials would understate ARGIA's IRR floor and
// underprice the lease. Fixed-cell reads, guarded by unit tests that assert
// the anchor cells still hold what we expect (BOM row 92 = BESS subtotal,
// INSTALLATION_v2!F22 = "BESS"). If the layout moves, the test goes red.
//
// BESS-ATTRIBUTABLE SAVINGS (the battery's own savings, cleanly separable
// from PV): the delta between "con PV" and "con PV + BESS".
//   Yr-1   : CFE_OUTPUT_v2 con-PV annual  - con-PV+BESS Yr-1 annual
//   Yr-2+  : CFE_OUTPUT_v2 con-PV annual  - con-PV+BESS Yr-2+ annual
// The Yr-1 vs Yr-2+ step exists because of the kWMaxAñoMovil ratchet floor
// (Session 2). The customer's "bill without ARGIA battery" is the con-PV
// bill (they finance solar separately via PPA); "bill with ARGIA battery"
// is the con-PV+BESS bill. That is the honest standalone-battery framing.
// =============================================================================

// Fixed-cell anchors (guarded by BaasWiringTests.gs).
var BAAS_WIRING_CELLS = {
  BOM_BESS_SUBTOTAL_ROW: 92,   // BOM_v2 row 92 = SUBTOTAL §8 BESS
  BOM_MXN_COL:           7,    // col G
  INSTALL_BESS_ROW:      22,   // INSTALLATION_v2 row 22 = BESS section
  INSTALL_SECTION_COL:   6,    // col F = section label (must be "BESS")
  INSTALL_LABOR_COL:     7,    // col G = labor MXN
  INSTALL_EQUIP_COL:     8     // col H = equip MXN
};


// ---------------------------------------------------------------------------
// _baasReadCapexMxn(ss) -> { materialsMxn, installMxn, totalMxn, ok, warnings }
// Fixed-cell read of BESS materials + BESS installation.
// ---------------------------------------------------------------------------
function _baasReadCapexMxn(ss) {
  var warnings = [];
  var C = BAAS_WIRING_CELLS;

  var materialsMxn = 0, installMxn = 0;

  var bom = ss.getSheetByName('BOM_v2');
  if (bom) {
    materialsMxn = parseFloat(
      bom.getRange(C.BOM_BESS_SUBTOTAL_ROW, C.BOM_MXN_COL).getValue()) || 0;
  } else {
    warnings.push('BaaS: BOM_v2 sheet not found; BESS materials = 0.');
  }

  var inst = ss.getSheetByName('INSTALLATION_v2');
  if (inst) {
    // Guard: confirm the anchor cell still labels the BESS section.
    var sectionLabel = String(
      inst.getRange(C.INSTALL_BESS_ROW, C.INSTALL_SECTION_COL).getValue() || '')
      .trim().toUpperCase();
    if (sectionLabel !== 'BESS') {
      warnings.push('BaaS: INSTALLATION_v2!F' + C.INSTALL_BESS_ROW
        + ' expected "BESS" but found "' + sectionLabel + '". '
        + 'Install layout may have changed -- BESS install cost NOT added. '
        + 'Fix the anchor row in BAAS_WIRING_CELLS and re-run.');
    } else {
      var labor = parseFloat(
        inst.getRange(C.INSTALL_BESS_ROW, C.INSTALL_LABOR_COL).getValue()) || 0;
      var equip = parseFloat(
        inst.getRange(C.INSTALL_BESS_ROW, C.INSTALL_EQUIP_COL).getValue()) || 0;
      installMxn = labor + equip;
    }
  } else {
    warnings.push('BaaS: INSTALLATION_v2 sheet not found; BESS install = 0.');
  }

  var totalMxn = materialsMxn + installMxn;
  return {
    materialsMxn: materialsMxn,
    installMxn:   installMxn,
    totalMxn:     totalMxn,
    ok:           totalMxn > 0,
    warnings:     warnings
  };
}


// ---------------------------------------------------------------------------
// _baasReadBessSavings(ss) -> { year1Mxn, steadyMxn, conPvMxn, ok, warnings }
// BESS-attributable annual savings = con-PV bill minus con-PV+BESS bill.
// Reads the engine's already-computed annual figures from CFE_OUTPUT_v2.
//
// Source cells (same numbers the KPI tiles show):
//   con PV annual          : parsed from G10 banner  (RECIBO ANUAL CON PV)
//   con PV+BESS Yr-1 annual : row 39 (Recibo CFE final PV+BESS, Año 1)  OR
//                             parsed from L10 banner Año 1
//   con PV+BESS Yr-2+ annual: parsed from L10 banner Año 2+
// We prefer the numeric row-39 / Section-2 values; the banner parse is a
// fallback. All are the formula-sheet source of truth (Chunk 5 Option 2).
// ---------------------------------------------------------------------------
function _baasReadBessSavings(ss) {
  var warnings = [];
  var cfe = ss.getSheetByName('CFE_OUTPUT_v2');
  if (!cfe) {
    return { year1Mxn: 0, steadyMxn: 0, conPvMxn: 0, ok: false,
             warnings: ['BaaS: CFE_OUTPUT_v2 not found; savings = 0.'] };
  }

  // con PV annual: sum Section 1 "recibo con PV" monthly row (row 19), which
  // is the authoritative monthly series behind the G10 tile.
  var cols = [3,4,5,6,7,8,9,10,11,12,13,14]; // C..N
  function sumRow(r) {
    var s = 0;
    for (var i = 0; i < cols.length; i++) {
      var v = cfe.getRange(r, cols[i]).getValue();
      if (typeof v === 'number') s += v;
    }
    return s;
  }
  var conPvMxn = sumRow(19);                       // Recibo con PV (monthly)
  if (!(conPvMxn > 0)) {
    conPvMxn = _baasParseBanner(cfe.getRange('G10').getValue());
    warnings.push('BaaS: con-PV annual fell back to G10 banner parse.');
  }

  // con PV+BESS Yr-1 annual: Section 2 "recibo final" row 31 sum.
  var conBessY1 = sumRow(31);
  if (!(conBessY1 > 0)) {
    conBessY1 = _baasParseBanner(cfe.getRange('L10').getValue());
    warnings.push('BaaS: con-PV+BESS Yr-1 fell back to L10 banner parse.');
  }

  // con PV+BESS Yr-2+ steady annual: from the Year1-vs-steady section.
  // Row 39 col D = "Recibo CFE final (PV + BESS)" Año 1; the steady value
  // is in the steady column or the L10 "Año 2+" banner. We parse the L10
  // banner's second number for the steady figure (robust to column layout).
  var steadyConBess = _baasParseBannerSteady(cfe.getRange('L10').getValue());
  if (!(steadyConBess > 0)) {
    steadyConBess = conBessY1;   // fall back to Yr-1 if no steady published
    warnings.push('BaaS: no steady (Yr-2+) bill found; using Yr-1 for all years.');
  }

  var year1Mxn  = Math.max(0, conPvMxn - conBessY1);
  var steadyMxn = Math.max(0, conPvMxn - steadyConBess);

  return {
    year1Mxn:  year1Mxn,
    steadyMxn: steadyMxn,
    conPvMxn:  conPvMxn,
    ok:        (year1Mxn > 0 || steadyMxn > 0),
    warnings:  warnings
  };
}


// Parse the first peso figure out of a KPI banner string like
// "RECIBO ANUAL CON PV\n$11,279,234".
function _baasParseBanner(v) {
  var s = String(v || '');
  var m = s.match(/\$\s*([\d,]+(?:\.\d+)?)/);
  return m ? parseFloat(m[1].replace(/,/g, '')) : 0;
}

// Parse the SECOND peso figure (the "Año 2+" steady value) out of an L10
// banner like "...\nAño 1: $10,471,312\nAño 2+: $7,721,664".
function _baasParseBannerSteady(v) {
  var s = String(v || '');
  var all = s.match(/\$\s*([\d,]+(?:\.\d+)?)/g);
  if (!all || all.length < 2) return 0;
  return parseFloat(all[all.length - 1].replace(/[$,\s]/g, ''));
}


// ---------------------------------------------------------------------------
// runBaasProjection(ss) -- top-level entry. Assembles inputs, runs the
// economics, writes BAAS_PROJECTION_v2. Standalone (Option A).
//
// @return {Object} { ok, sheet, warnings, capex, savings, result }
// ---------------------------------------------------------------------------
function runBaasProjection(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var warnings = [];

  // Ensure the input sheet exists (creates with defaults on first run).
  if (typeof setupInputBaasSheet === 'function') setupInputBaasSheet(ss);
  var inp = (typeof readInputBaas === 'function') ? readInputBaas(ss) : {};

  // CAPEX = BESS materials + BESS install.
  var capex = _baasReadCapexMxn(ss);
  warnings = warnings.concat(capex.warnings);

  // Solar CAPEX for the tax benefit: BaaS is battery-only, so by default
  // there is NO solar CAPEX attributable to the battery lease. The tax
  // benefit therefore does not apply unless the designer explicitly says
  // so via INPUT_BAAS (customerCanUseTaxBenefit) AND supplies a solar CAPEX
  // figure -- which for a standalone battery lease is typically 0.
  // (Per 2026-05-29: tax benefit is for the SOLAR installation, only for
  // companies that can use it. A standalone battery lease has no solar
  // CAPEX, so tax defaults off. If a combined PPA+BaaS deal later needs it,
  // that is a future change.)
  var solarCapexMxn = 0;

  // BESS-attributable savings (con-PV vs con-PV+BESS).
  var savings = _baasReadBessSavings(ss);
  warnings = warnings.concat(savings.warnings);

  // The customer's bill WITHOUT the battery is the con-PV bill; WITH the
  // battery it is con-PV minus the steady BESS saving. We use the STEADY
  // (Yr-2+) saving as the representative annual figure, because the Yr-1
  // ratchet-floor dip is a one-year artifact -- the lease is a 15-year
  // commitment and the steady saving is what recurs. (The Yr-1 vs Yr-2+
  // step is surfaced in the warnings/notes for transparency.)
  var year1BillWithoutMxn = savings.conPvMxn;
  var representativeSaving = savings.steadyMxn > 0 ? savings.steadyMxn : savings.year1Mxn;
  var year1BillWithMxn = Math.max(0, year1BillWithoutMxn - representativeSaving);

  if (savings.year1Mxn > 0 && savings.steadyMxn > 0
      && Math.abs(savings.steadyMxn - savings.year1Mxn) > 1) {
    warnings.push('BaaS: BESS savings step Yr-1 $' + Math.round(savings.year1Mxn)
      + ' -> Yr-2+ $' + Math.round(savings.steadyMxn)
      + ' (kWMaxAñoMovil ratchet). Projection uses the Yr-2+ steady saving '
      + 'as the representative annual figure.');
  }

  var result = calcBaasEconomics({
    leaseTermYears:        inp.leaseTermYears,
    leaseType:             inp.leaseType,
    paymentEscalationPct:  inp.paymentEscalationPct,
    inpcEscalationPct:     inp.inpcEscalationPct,
    billEscalationPct:     inp.billEscalationPct,
    savingsEscalationPct:  inp.savingsEscalationPct,
    targetIrr:             inp.targetIrr,
    discountRate:          inp.discountRate,
    omCostMxnPerYear:      inp.omCostMxnPerYear,
    replacementReserveMxnPerYear: inp.replacementReserveMxnPerYear,
    taxBenefitRate:        inp.taxBenefitRate,
    taxAmortYears:         inp.taxAmortYears,
    customerCanUseTaxBenefit: inp.customerCanUseTaxBenefit,
    solarCapexMxn:         solarCapexMxn,
    capexMxn:              capex.totalMxn,
    year1BillWithoutMxn:   year1BillWithoutMxn,
    year1BillWithMxn:      year1BillWithMxn
  });

  var writeRet = writeBaasProjectionV2(ss, result, { fxRate: inp.fxRate });

  return {
    ok:       capex.ok && savings.ok,
    sheet:    writeRet.sheet,
    warnings: warnings,
    capex:    capex,
    savings:  savings,
    result:   result
  };
}
