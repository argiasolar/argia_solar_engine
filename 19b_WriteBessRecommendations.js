// =============================================================================
// ARGIA ENGINE -- File: 19b_WriteBessRecommendations.gs   (BDF-1)
// Writer for the BESS_RECOMMENDATIONS designer-tool sheet.
//
// SCOPE
//   - Renders a flat ranked table of battery candidates with payback, savings,
//     coverage flag, and tariff provenance.
//   - This is a DESIGNER TOOL sheet, not a customer-facing v2 output. No
//     design tokens, no banner, no conditional formatting rules. Just data.
//   - Idempotent: clears the sheet before each write. Designer re-runs
//     "Suggest BESS" as often as they like.
//
// LAYOUT (flat table, per BDF-1 spec):
//   Row 1: title + last-updated timestamp
//   Row 2: blank
//   Row 3: tariff inputs (3 cells: punta MXN/kWh, base MXN/kWh, demand MXN/kW)
//   Row 4: tariff provenance (where each value came from)
//   Row 5: site summary (max kW punta, avg punta kWh, months read, catalog count)
//   Row 6: blank
//   Row 7: column headers
//   Row 8+: ranked candidates (real products + ladder), sorted by payback ascending
//   Row N+2: warnings, one per row
//   Row M+2: "blocked" reason if applicable (only when suggestBessSizing returned blocked)
//
// SOURCE OF TRUTH
//   The `result` arg is whatever suggestBessSizing(ss) returned. The writer
//   does no math -- displaying the engine's output 1:1 + light formatting.
//   If the engine drifts from this contract, this writer's tests catch it
//   before the live sheet does.
// =============================================================================

var BESS_RECOMMENDATIONS_SHEET = 'BESS_RECOMMENDATIONS';

// Column layout (1-indexed). Update both this map and the headers row if cols
// shift, plus the tests. The order here IS the order on the sheet.
var BR_COL = {
  RANK:           1,   // A
  BATTERY_ID:     2,   // B
  CAPACITY_KWH:   3,   // C
  POWER_KW:       4,   // D
  USABLE_KWH:     5,   // E
  SHAVE_KW:       6,   // F
  COVERAGE:       7,   // G
  DEMAND_SAVING:  8,   // H
  SHIFT_SAVING:   9,   // I
  TOTAL_SAVING:  10,   // J
  CAPEX:         11,   // K
  PAYBACK_YRS:   12,   // L
  SOURCE:        13,   // M  -- LIBRARY / LADDER
  // -- BDF-6: hidden columns for picker wiring ---------------------------
  // The picker (21_BessPickerWiring) reads these to populate INPUT_BESS specs
  // when a designer selects a recommendation label. They're hidden by default
  // because they're plumbing, not customer-facing.
  BASE_BATTERY_ID: 14, // N (hidden) -- underlying catalog batteryId for stacks
  STACK_QTY:       15, // O (hidden) -- 1 for single units, N for stacks
};

var BR_HEADERS = [
  '#', 'Battery ID', 'Cap kWh', 'Power kW', 'Usable kWh',
  'Shave kW', 'Coverage', 'Demand $/yr', 'Shift $/yr', 'Total $/yr',
  'CAPEX MXN', 'Payback yrs', 'Source',
  '_baseBatteryId', '_stackQty'   // hidden picker plumbing
];

// ---------------------------------------------------------------------------
// writeBessRecommendations(ss, result, opts?) -> void
//
// @param {Spreadsheet} ss      active spreadsheet
// @param {Object}      result  output of suggestBessSizing(ss)
// @param {Object}      [opts]  optional knobs
//   opts.sheetName  string  override target sheet name (tests only)
//
// Side effect: writes to opts.sheetName (default BESS_RECOMMENDATIONS).
// Throws nothing the caller hasn't caused; sheet existence is handled here.
// ---------------------------------------------------------------------------
function writeBessRecommendations(ss, result, opts) {
  ss = ss || SpreadsheetApp.getActive();
  opts = opts || {};
  var sheetName = opts.sheetName || BESS_RECOMMENDATIONS_SHEET;

  // -- Get-or-create the sheet ---------------------------------------------
  var sh = ss.getSheetByName(sheetName);
  if (!sh) sh = ss.insertSheet(sheetName);
  sh.clear();
  sh.clearConditionalFormatRules();

  // -- Header strip --------------------------------------------------------
  var tsLocal = Utilities.formatDate(new Date(),
                  Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  sh.getRange(1, 1).setValue('BESS Recommendations -- generated ' + tsLocal)
    .setFontWeight('bold').setFontSize(12);

  // -- Blocked path: write the reason and stop -----------------------------
  if (result.blocked) {
    sh.getRange(3, 1).setValue('Suggestion blocked: ' + result.blocked)
      .setFontColor('#cc0000').setFontWeight('bold');
    _brSetColumnWidths(sh);
    return;
  }

  // -- BDF-3: Verdict banner (row 2) ---------------------------------------
  // When threshold is enabled, the top-line answer is "RECOMMENDED: X" or
  // "NO CANDIDATE MEETS THRESHOLD". When disabled, no banner (avoids noise).
  // Uses the engine's already-computed result.recommendation (which honors
  // the threshold via _pickRecommendation's filter).
  var thr = result.threshold || { thresholdMxn: 0, provenance: 'DISABLED' };
  if (thr.thresholdMxn > 0) {
    var bannerText, bannerColor;
    if (result.recommendation) {
      var rec = result.recommendation;
      bannerText = 'RECOMMENDED: ' + rec.label
        + '  ·  $' + Math.round(rec.annualSavingMxn).toLocaleString() + '/yr'
        + '  ·  ' + (isFinite(rec.paybackYears) ? rec.paybackYears.toFixed(1) + ' yr payback' : 'no payback')
        + '  (threshold: $' + Math.round(thr.thresholdMxn).toLocaleString() + '/yr)';
      bannerColor = '#1b5e20';  // dark green
    } else {
      // Find the best below-threshold candidate to surface the gap
      var bestBelow = null;
      var cands = result.candidates || [];
      for (var bi = 0; bi < cands.length; bi++) {
        if (!bestBelow || cands[bi].annualSavingMxn > bestBelow.annualSavingMxn) {
          bestBelow = cands[bi];
        }
      }
      if (bestBelow) {
        var pct = Math.round(100 * bestBelow.annualSavingMxn / thr.thresholdMxn);
        bannerText = 'NO CANDIDATE MEETS THRESHOLD'
          + '  ·  best is ' + bestBelow.label
          + ' at $' + Math.round(bestBelow.annualSavingMxn).toLocaleString() + '/yr'
          + ' (' + pct + '% of $' + Math.round(thr.thresholdMxn).toLocaleString() + ')';
      } else {
        bannerText = 'NO CANDIDATE MEETS THRESHOLD';
      }
      bannerColor = '#b71c1c';  // dark red
    }
    sh.getRange(2, 1, 1, 13).merge();
    sh.getRange(2, 1).setValue(bannerText)
      .setFontWeight('bold').setFontSize(11)
      .setFontColor('#ffffff').setBackground(bannerColor)
      .setHorizontalAlignment('center');
  }

  // -- Tariff inputs (row 3) -----------------------------------------------
  var tar = result.tariff;
  sh.getRange(3, 1).setValue('Tariff inputs:');
  sh.getRange(3, 2).setValue('Punta:');
  sh.getRange(3, 3).setValue(tar.puntaMxnPerKwh).setNumberFormat('#,##0.0000" MXN/kWh"');
  sh.getRange(3, 4).setValue('Base:');
  sh.getRange(3, 5).setValue(tar.baseMxnPerKwh).setNumberFormat('#,##0.0000" MXN/kWh"');
  sh.getRange(3, 6).setValue('Demand:');
  sh.getRange(3, 7).setValue(tar.demandChargeMxnPerKw).setNumberFormat('#,##0.00" MXN/kW-month"');

  // -- Provenance (row 4) --------------------------------------------------
  sh.getRange(4, 1).setValue('Sources:').setFontStyle('italic');
  sh.getRange(4, 2).setValue(_brProvLabel(tar.puntaSource)).setFontStyle('italic');
  sh.getRange(4, 4).setValue(_brProvLabel(tar.baseSource)).setFontStyle('italic');
  sh.getRange(4, 6).setValue(_brProvLabel(tar.demandSource)).setFontStyle('italic');

  // -- Site summary (row 5) ------------------------------------------------
  var s = result.siteSummary || {};
  sh.getRange(5, 1).setValue('Site:');
  sh.getRange(5, 2).setValue('max punta kW:');
  sh.getRange(5, 3).setValue(s.maxMonthlyPuntaKw || 0).setNumberFormat('#,##0');
  sh.getRange(5, 4).setValue('avg punta kWh:');
  sh.getRange(5, 5).setValue(Math.round(s.avgMonthlyPuntaKwh || 0)).setNumberFormat('#,##0');
  sh.getRange(5, 6).setValue('months read:');
  sh.getRange(5, 7).setValue(s.monthsAnalyzed || 0);
  sh.getRange(5, 8).setValue('catalog:');
  sh.getRange(5, 9).setValue((result.batteryCatalog && result.batteryCatalog.count) || 0
    + ' products');

  // -- BDF-2: Interconnection (row 6) --------------------------------------
  // Uses the previously-blank row between site summary and column headers.
  // Tells the designer WHICH mode is active and what the engine assumes
  // about PV surplus availability for battery charging.
  var ic = result.interconnection || {};
  sh.getRange(6, 1).setValue('Interconnection:');
  sh.getRange(6, 2).setValue(ic.mode || 'UNKNOWN').setFontWeight('bold');
  if (ic.exportPriceMxnPerKwh > 0) {
    sh.getRange(6, 3).setValue('Export price:');
    sh.getRange(6, 4).setValue(ic.exportPriceMxnPerKwh).setNumberFormat('#,##0.00" MXN/kWh"');
  }
  if (ic.pvAnnualSurplusKwh > 0) {
    sh.getRange(6, 5).setValue('PV surplus/yr:');
    sh.getRange(6, 6).setValue(Math.round(ic.pvAnnualSurplusKwh)).setNumberFormat('#,##0" kWh"');
  }
  // Mode explainer — clarifies WHY the savings come out as they do.
  // Merged across remaining columns so the designer can't miss it.
  var explainer = _brModeExplainer(ic.mode);
  if (explainer) {
    sh.getRange(6, 7, 1, 7).merge();
    sh.getRange(6, 7).setValue(explainer).setFontStyle('italic')
      .setHorizontalAlignment('left');
  }

  // -- Column headers (row 7) ----------------------------------------------
  for (var c = 0; c < BR_HEADERS.length; c++) {
    sh.getRange(7, c + 1).setValue(BR_HEADERS[c])
      .setFontWeight('bold').setBackground('#f0f0f0');
  }

  // -- Ranked table (row 8+) -----------------------------------------------
  // BDF-4: when a threshold is configured, the displayed table shows ONLY
  // candidates that meet it (matches user choice "show only stacks that
  // meet threshold"). When threshold is disabled (0), all candidates render.
  // This is a DISPLAY filter -- the engine's result.candidates is unchanged
  // so per-row meetsThreshold flags and BDF-1/2/3 tests keep working.
  var displayCandidates = (result.candidates || []).slice();
  if (thr.thresholdMxn > 0) {
    displayCandidates = displayCandidates.filter(function(c) {
      return c.meetsThreshold === true;
    });
  }
  // Sort by payback ascending. Treat null/Infinity as "infinity" (sort last).
  // Tie-break by total saving descending (bigger battery wins on ties).
  var ranked = displayCandidates.sort(function(a, b) {
    var pa = _brSortablePayback(a);
    var pb = _brSortablePayback(b);
    if (pa !== pb) return pa - pb;
    return (b.annualSavingMxn || 0) - (a.annualSavingMxn || 0);
  });

  var nextRow = 8;
  for (var i = 0; i < ranked.length; i++) {
    var c = ranked[i];
    var r = nextRow + i;
    sh.getRange(r, BR_COL.RANK).setValue(i + 1);
    sh.getRange(r, BR_COL.BATTERY_ID).setValue(c.label);
    sh.getRange(r, BR_COL.CAPACITY_KWH).setValue(Math.round(c.capacityKwh)).setNumberFormat('#,##0');
    sh.getRange(r, BR_COL.POWER_KW).setValue(c.powerKw == null ? '' : Math.round(c.powerKw)).setNumberFormat('#,##0');
    sh.getRange(r, BR_COL.USABLE_KWH).setValue(Math.round(c.usableKwh || 0)).setNumberFormat('#,##0');
    sh.getRange(r, BR_COL.SHAVE_KW).setValue(c.shavedKw == null ? '' : Math.round(c.shavedKw * 10) / 10).setNumberFormat('#,##0.0');
    sh.getRange(r, BR_COL.COVERAGE).setValue(c.coverageFlag || '');
    sh.getRange(r, BR_COL.DEMAND_SAVING).setValue(Math.round(c.annualDemandSavingMxn || 0)).setNumberFormat('"$"#,##0');
    sh.getRange(r, BR_COL.SHIFT_SAVING).setValue(Math.round(c.annualEnergyShiftSavingMxn || 0)).setNumberFormat('"$"#,##0');
    sh.getRange(r, BR_COL.TOTAL_SAVING).setValue(Math.round(c.annualSavingMxn || 0)).setNumberFormat('"$"#,##0');
    sh.getRange(r, BR_COL.CAPEX).setValue(Math.round(c.installedCapexMxn || 0)).setNumberFormat('"$"#,##0');
    var pb = c.paybackYears;
    if (pb == null || !isFinite(pb)) {
      sh.getRange(r, BR_COL.PAYBACK_YRS).setValue('N/A');
    } else {
      sh.getRange(r, BR_COL.PAYBACK_YRS).setValue(Math.round(pb * 10) / 10).setNumberFormat('#,##0.0');
    }
    sh.getRange(r, BR_COL.SOURCE).setValue(c.source || '');
    // BDF-6: hidden picker plumbing. Even non-stacked candidates carry
    // baseBatteryId (= their own batteryId) and stackQty=1, so the picker
    // can resolve any recommendation uniformly.
    sh.getRange(r, BR_COL.BASE_BATTERY_ID).setValue(c.baseBatteryId || '');
    sh.getRange(r, BR_COL.STACK_QTY).setValue(c.stackQty || 1);

    // BDF-3: when threshold is enabled, visually flag rows that fail to meet
    // it. Below-threshold rows get a muted grey font across the whole row;
    // the Total $/yr cell turns red. Designer scans once and sees the cutoff.
    // When threshold is disabled, no styling is applied.
    if (thr.thresholdMxn > 0 && c.meetsThreshold === false) {
      sh.getRange(r, 1, 1, BR_HEADERS.length).setFontColor('#9e9e9e');
      sh.getRange(r, BR_COL.TOTAL_SAVING).setFontColor('#b71c1c').setFontWeight('bold');
    } else if (thr.thresholdMxn > 0 && c.meetsThreshold === true) {
      // Pass-through styling for above-threshold rows: bold green on Total $/yr
      sh.getRange(r, BR_COL.TOTAL_SAVING).setFontColor('#1b5e20').setFontWeight('bold');
    }
  }

  // -- Warnings ------------------------------------------------------------
  if (result.warnings && result.warnings.length > 0) {
    var warnRow = nextRow + ranked.length + 1;
    sh.getRange(warnRow, 1).setValue('Warnings:')
      .setFontWeight('bold').setFontColor('#cc7700');
    for (var w = 0; w < result.warnings.length; w++) {
      sh.getRange(warnRow + 1 + w, 1).setValue('- ' + result.warnings[w]);
      sh.getRange(warnRow + 1 + w, 1, 1, BR_HEADERS.length).merge();
    }
  }

  _brSetColumnWidths(sh);
  sh.setFrozenRows(7);

  // BDF-8: apply consistent font family across the whole sheet so it
  // visually matches INPUT_* and the rest of the engine output.
  // We do this LAST so we don't override per-cell color/weight set above.
  // (setFontFamily only changes the family, leaving color/weight intact.)
  //
  // Defensive: guard against minimal sheet mocks that don't implement
  // getLastRow / getLastColumn / setFontFamily. Test fixtures from
  // BDF-1..4 use such mocks; production GAS always provides all three.
  try {
    var brFont = 'Inter';
    try {
      if (typeof loadDesignTokens === 'function' && typeof token === 'function') {
        resetDesignTokenCache_();
        loadDesignTokens(ss);
        brFont = token('FONT_FAMILY');
      }
    } catch (e1) {
      // tokens unavailable -- keep brFont = 'Inter' default
    }
    if (typeof sh.getLastRow === 'function'
     && typeof sh.getLastColumn === 'function') {
      var maxR = Math.max(sh.getLastRow(), 7);
      var maxC = Math.max(sh.getLastColumn(), BR_HEADERS.length);
      var rng = sh.getRange(1, 1, maxR, maxC);
      if (typeof rng.setFontFamily === 'function') {
        rng.setFontFamily(brFont);
      }
    }
  } catch (e2) {
    // Font sweep is purely cosmetic — never block the writer.
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function _brProvLabel(source) {
  switch (source) {
    case 'INPUT_BESS_OVERRIDE': return '(from INPUT_BESS override)';
    case 'INPUT_CFE_DERIVED':   return '(auto-derived from INPUT_CFE)';
    case 'MISSING':             return '(MISSING -- energy-shift disabled)';
    default:                     return '(unknown source)';
  }
}

// BDF-2: short explainer for the interconnection mode. Designers see this
// inline so they understand WHY the savings come out the way they do.
function _brModeExplainer(mode) {
  switch (mode) {
    case 'NET_METERING':
      return 'Grid already stores PV surplus at retail — battery time-shift value drops to ~0; only demand-charge savings remain.';
    case 'NET_BILLING':
      return 'PV surplus exports at low price — battery captures the gap between punta tariff and export price (RTE-adjusted).';
    case 'ZERO_EXPORT':
      return 'PV surplus would be curtailed — battery captures full punta rate from otherwise-wasted energy.';
    case 'UNKNOWN':
      return 'Mode not detected from INPUT_CFE; engine assumes grid-to-grid arbitrage (conservative for NET_METERING / ZERO_EXPORT).';
    default:
      return '';
  }
}

function _brSortablePayback(c) {
  if (c.paybackYears == null || !isFinite(c.paybackYears)) return 9999;
  return c.paybackYears;
}

function _brSetColumnWidths(sh) {
  // Reasonable widths so the table fits on a typical screen without scroll.
  // Locked here so the writer is deterministic for tests.
  sh.setColumnWidth(BR_COL.RANK, 35);
  sh.setColumnWidth(BR_COL.BATTERY_ID, 165);
  sh.setColumnWidth(BR_COL.CAPACITY_KWH, 75);
  sh.setColumnWidth(BR_COL.POWER_KW, 75);
  sh.setColumnWidth(BR_COL.USABLE_KWH, 80);
  sh.setColumnWidth(BR_COL.SHAVE_KW, 75);
  sh.setColumnWidth(BR_COL.COVERAGE, 75);
  sh.setColumnWidth(BR_COL.DEMAND_SAVING, 100);
  sh.setColumnWidth(BR_COL.SHIFT_SAVING, 100);
  sh.setColumnWidth(BR_COL.TOTAL_SAVING, 110);
  sh.setColumnWidth(BR_COL.CAPEX, 130);
  sh.setColumnWidth(BR_COL.PAYBACK_YRS, 90);
  sh.setColumnWidth(BR_COL.SOURCE, 80);
  // BDF-6: hide picker plumbing columns (N, O). They carry baseBatteryId
  // and stackQty so the picker can resolve recommendation selections, but
  // the designer doesn't need to see them.
  sh.hideColumns(BR_COL.BASE_BATTERY_ID, 2);  // hides N and O
}
