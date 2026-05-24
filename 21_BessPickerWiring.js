// =============================================================================
// ARGIA ENGINE -- File: 21_BessPickerWiring.gs   (BDF-6)
// INPUT_BESS C6 picker wiring.
//
// PURPOSE
//   When the designer changes the Battery_ID picker (INPUT_BESS!C6), the
//   technical-spec cells (C10..C14, C20) auto-populate. The picker handles
//   THREE source types:
//     1. CATALOG product (e.g. "BYD_2MWH"). Specs come from 16M_PRODUCTS_BESS.
//     2. STACKED recommendation (e.g. "2 × BYD_2MWH (4000 kWh, 2000 kW)").
//        Capacity/power/CAPEX from the recommendation row; SOC/RTE from the
//        underlying catalog product (16M_PRODUCTS_BESS row for baseBatteryId).
//     3. CUSTOM_MANUAL. All spec cells left untouched — designer enters values
//        directly. This is the "I have a supplier quote outside the catalog"
//        path.
//
// HONEST DESIGN NOTES
//   - O2 pattern (per BDF-6 design): single-cell, picker rewrites the formula
//     on every C6 change. Manual override is "sticky" — once a designer types
//     a literal value into a spec cell, it stays until the next C6 change.
//   - Override detection: a tiny hidden marker block (cols Q..V on INPUT_BESS,
//     rows 10..20) stores the "auto value" the picker wrote. Conditional
//     formatting in the workbook compares each visible cell to its hidden
//     twin; if they differ, the cell shows the OVERRIDDEN treatment.
//   - LADDER source is NOT supported in the picker. Real workbooks always
//     have 16M_PRODUCTS_BESS, so LADDER candidates don't reach the recommendation
//     sheet under normal operation. If the designer somehow types a LADDER
//     label, the picker treats it as CUSTOM_MANUAL.
//
// PUBLIC API
//   refreshBessPicker(ss)          -- recompute dropdown options + rewire C6
//                                     validation. Called by setupInputBess()
//                                     and after each runBessSuggestion().
//   applyBessPickerForCell(ss, c6Value)
//                                  -- run picker logic for a specific selection.
//                                     Pure-ish: only writes to the spec cells.
//                                     Returns a status object for tests.
//   onEditTriggerBessPicker(e)     -- bound trigger handler. Calls applyBessPickerForCell
//                                     when the edit is to INPUT_BESS!C6.
//
// PURE TEST HOOKS (no sheet access)
//   resolvePickerSelection(c6Value, catalog, recommendations)
//                                  -- returns { source, batteryId, qty,
//                                              capacityKwh, powerKw, capexMxn,
//                                              minSocPct, maxSocPct, rtePct }
//                                     or { source: 'CUSTOM_MANUAL' } when the
//                                     selection doesn't match anything known.
// =============================================================================


// ===========================================================================
// resolvePickerSelection -- the pure core
// ===========================================================================
// Given a C6 value and the available catalog + recommendations data, decide
// what specs the picker should populate. Pure function — fully unit-testable
// without spreadsheet access.
//
// @param {string} c6Value       Value of INPUT_BESS!C6
// @param {Array}  catalog       From getAllBatteryProducts(ss). Each entry
//                               should expose: batteryId, capacityKwh, powerKw,
//                               minSocPct, maxSocPct, rtePct, installedCapexMxn.
// @param {Array}  recommendations  From BESS_RECOMMENDATIONS rows. Each entry:
//                               { label, baseBatteryId, stackQty, capacityKwh,
//                                 powerKw, installedCapexMxn }.
// @return {Object} { source, batteryId, qty, capacityKwh, powerKw, capexMxn,
//                    minSocPct, maxSocPct, rtePct, found }
function resolvePickerSelection(c6Value, catalog, recommendations) {
  var v = String(c6Value || '').trim();
  if (!v || v === 'CUSTOM_MANUAL') {
    return { source: 'CUSTOM_MANUAL', found: false };
  }

  catalog = catalog || [];
  recommendations = recommendations || [];

  // -- Try recommendations first ------------------------------------------
  // The recommendation label is what the designer would have seen and picked.
  // The row carries the resolved capacity/power/CAPEX (already × stackQty).
  for (var i = 0; i < recommendations.length; i++) {
    var rec = recommendations[i];
    if (!rec || !rec.label) continue;
    if (String(rec.label).trim() === v) {
      // Found in recommendations. SOC/RTE come from the underlying catalog
      // product (baseBatteryId), because the recommendation row doesn't have
      // them. If baseBatteryId is missing or not in catalog, fall back to
      // sensible defaults (10/90/90, conservative for a generic LFP battery).
      var base = _findCatalogEntry(catalog, rec.baseBatteryId);
      return {
        source: 'RECOMMENDATION',
        batteryId: rec.label,
        baseBatteryId: rec.baseBatteryId || '',
        qty: Number(rec.stackQty) || 1,
        capacityKwh: Number(rec.capacityKwh) || 0,
        powerKw: Number(rec.powerKw) || 0,
        capexMxn: Number(rec.installedCapexMxn) || 0,
        minSocPct: base ? (Number(base.minSocPct) || 0.10) : 0.10,
        maxSocPct: base ? (Number(base.maxSocPct) || 0.90) : 0.90,
        rtePct:    base ? (Number(base.rtePct)    || 0.90) : 0.90,
        found: true,
      };
    }
  }

  // -- Fall back to direct catalog match -----------------------------------
  // Designer picked a catalog ID directly (no stacking). Single unit.
  var cat = _findCatalogEntry(catalog, v);
  if (cat) {
    return {
      source: 'CATALOG',
      batteryId: cat.batteryId,
      baseBatteryId: cat.batteryId,
      qty: 1,
      capacityKwh: Number(cat.capacityKwh) || 0,
      powerKw:    Number(cat.powerKw)      || 0,
      capexMxn:   Number(cat.installedCapexMxn) || 0,
      minSocPct:  Number(cat.minSocPct)    || 0.10,
      maxSocPct:  Number(cat.maxSocPct)    || 0.90,
      rtePct:     Number(cat.rtePct)       || 0.90,
      found: true,
    };
  }

  // -- Unknown -> treat as custom-manual ----------------------------------
  // Designer typed something that's neither in catalog nor in recommendations.
  // We don't error out — the manual-entry path is a valid use case (supplier
  // quote with unusual ID). Caller is expected to leave specs untouched.
  return {
    source: 'CUSTOM_MANUAL',
    batteryId: v,
    found: false,
  };
}


function _findCatalogEntry(catalog, batteryId) {
  if (!batteryId) return null;
  var id = String(batteryId).trim();
  for (var i = 0; i < catalog.length; i++) {
    if (catalog[i] && String(catalog[i].batteryId).trim() === id) {
      return catalog[i];
    }
  }
  return null;
}


// ===========================================================================
// readRecommendationsForPicker -- read BESS_RECOMMENDATIONS into picker shape
// ===========================================================================
// Reads the recommendation sheet rows (row 8 onwards) into an array of
// objects shaped for resolvePickerSelection. Returns [] if the sheet doesn't
// exist (BDF-1 hasn't been run yet).
//
// EXPECTS the recommendations writer to expose baseBatteryId and stackQty in
// hidden columns N (14) and O (15). BDF-6 Part B extends the writer to do this.
//
// @return {Array<Object>} entries like { label, baseBatteryId, stackQty,
//                                        capacityKwh, powerKw, installedCapexMxn }
function readRecommendationsForPicker(ss) {
  var sh = ss.getSheetByName('BESS_RECOMMENDATIONS');
  if (!sh) return [];
  var lastRow = sh.getLastRow();
  if (lastRow < 8) return [];

  // Cols: B=label, C=capacity, D=power, K=CAPEX, N=baseBatteryId (hidden),
  //       O=stackQty (hidden). All other cols ignored.
  var range = sh.getRange(8, 1, lastRow - 7, 15).getValues();
  var out = [];
  for (var i = 0; i < range.length; i++) {
    var row = range[i];
    var label = String(row[1] || '').trim();   // col B
    if (!label) continue;
    out.push({
      label: label,
      capacityKwh:        Number(row[2]) || 0,    // col C
      powerKw:            Number(row[3]) || 0,    // col D
      installedCapexMxn:  Number(row[10]) || 0,   // col K
      baseBatteryId:      String(row[13] || ''),  // col N (hidden)
      stackQty:           Number(row[14]) || 1,   // col O (hidden)
    });
  }
  return out;
}


// ===========================================================================
// applyBessPickerForCell -- write spec cells based on C6 selection
// ===========================================================================
// Side-effecting: writes to INPUT_BESS!C10..C14, C20. Also writes the hidden
// marker block (cols Q..V, rows 10..20) so override-detection conditional
// formatting can light up cells that diverge from the auto value.
//
// Honest implementation note: this is a "rewrite formulas with literal values"
// implementation. We don't try to keep XLOOKUP-style formulas, because the
// dropdown source is dual (catalog + recommendations) and no single formula
// can branch correctly across both. Writing literals is simpler and matches
// O2's intent: the picker auto-fills, the designer can then override any
// individual cell, the override sticks until the next C6 change.
//
// @param {Spreadsheet} ss
// @param {string} c6Value   The value to apply (typically just read from C6)
// @return {Object} { source, found, batteryId, capacityKwh, powerKw, capexMxn,
//                    minSocPct, maxSocPct, rtePct, cellsWritten[] }
function applyBessPickerForCell(ss, c6Value) {
  var sh = ss.getSheetByName('INPUT_BESS');
  if (!sh) {
    return { source: 'NO_INPUT_BESS', found: false, cellsWritten: [] };
  }
  var catalog = (typeof getAllBatteryProducts === 'function')
                 ? getAllBatteryProducts(ss)
                 : [];
  var recs = readRecommendationsForPicker(ss);
  var picked = resolvePickerSelection(c6Value, catalog, recs);

  // CUSTOM_MANUAL or unknown -> leave spec cells alone. Designer enters
  // values themselves. We DO clear the hidden marker block so the override
  // indicator doesn't show stale auto values.
  if (picked.source === 'CUSTOM_MANUAL') {
    _clearBessPickerMarkers(sh);
    return Object.assign({}, picked, { cellsWritten: [] });
  }

  // Write spec cells with literal values from the picked selection.
  // Cells: C10 capacity, C11 power, C12 minSoc, C13 maxSoc, C14 rte, C20 capex.
  var writes = [
    { row: 10, val: picked.capacityKwh,  numFmt: '#,##0" kWh"' },
    { row: 11, val: picked.powerKw,      numFmt: '#,##0" kW"' },
    { row: 12, val: picked.minSocPct,    numFmt: '0.00%' },
    { row: 13, val: picked.maxSocPct,    numFmt: '0.00%' },
    { row: 14, val: picked.rtePct,       numFmt: '0.00%' },
    { row: 20, val: picked.capexMxn,     numFmt: '"$"#,##0' },
  ];
  var cellsWritten = [];
  for (var w = 0; w < writes.length; w++) {
    var rule = writes[w];
    sh.getRange(rule.row, 3).setValue(rule.val).setNumberFormat(rule.numFmt);
    // Write hidden marker (col Q = 17) holding the auto value.
    sh.getRange(rule.row, 17).setValue(rule.val);
    cellsWritten.push('C' + rule.row);
  }
  // Provenance marker in a fixed cell so designer can see where values came
  // from. Written to D6 (next to picker). Italic, small font.
  sh.getRange(6, 4).setValue('(' + picked.source.toLowerCase() + ')')
    .setFontStyle('italic').setFontColor('#666666').setFontSize(9);

  return Object.assign({}, picked, { cellsWritten: cellsWritten });
}


// Clear hidden marker block (cols Q rows 10..20) so override-indicator
// formatting goes inactive on CUSTOM_MANUAL.
function _clearBessPickerMarkers(sh) {
  for (var r = 10; r <= 20; r++) {
    sh.getRange(r, 17).clearContent();
  }
  // Clear the provenance indicator too
  sh.getRange(6, 4).clearContent().clearFormat();
  sh.getRange(6, 4).setValue('(manual)')
    .setFontStyle('italic').setFontColor('#666666').setFontSize(9);
}


// ===========================================================================
// refreshBessPicker -- rebuild dropdown options to union catalog + recs
// ===========================================================================
// The dropdown source is a hidden helper sheet `_BESS_PICKER_OPTIONS` (col A).
// We rebuild it from scratch every call: catalog Battery_IDs, then a separator,
// then recommendation labels (newest run, in rank order). C6's data validation
// points at this sheet.
//
// Called by:
//   - setupInputBess()       (manual setup from menu / IDE)
//   - runBessSuggestion()    (after each Suggest BESS run; ensures fresh recs
//                             show up in the dropdown immediately)
function refreshBessPicker(ss) {
  ss = ss || SpreadsheetApp.getActive();

  // Read sources
  var catalog = (typeof getAllBatteryProducts === 'function')
                  ? getAllBatteryProducts(ss) : [];
  var recs = readRecommendationsForPicker(ss);

  // Build helper sheet
  var HELPER = '_BESS_PICKER_OPTIONS';
  var sh = ss.getSheetByName(HELPER);
  if (!sh) {
    sh = ss.insertSheet(HELPER);
    sh.hideSheet();
  } else {
    sh.clear();
  }
  var rows = [];
  for (var i = 0; i < catalog.length; i++) {
    if (catalog[i] && catalog[i].batteryId) rows.push([catalog[i].batteryId]);
  }
  for (var j = 0; j < recs.length; j++) {
    if (recs[j] && recs[j].label) rows.push([recs[j].label]);
  }
  if (rows.length === 0) rows.push(['CUSTOM_MANUAL']);
  sh.getRange(1, 1, rows.length, 1).setValues(rows);

  // Wire validation on INPUT_BESS!C6
  var shBess = ss.getSheetByName('INPUT_BESS');
  if (shBess) {
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInRange(sh.getRange(1, 1, rows.length, 1), true)
      .setAllowInvalid(true)   // allow CUSTOM_MANUAL typed by hand
      .setHelpText('Pick from catalog or BESS_RECOMMENDATIONS (after Suggest BESS run)')
      .build();
    shBess.getRange(6, 3).setDataValidation(rule);
  }
  return { optionCount: rows.length, catalogCount: catalog.length, recCount: recs.length };
}


// ===========================================================================
// onEdit trigger (bound by installable trigger, NOT a simple onEdit)
// ===========================================================================
// Picker auto-fires when the designer changes C6. Apps Script installable
// triggers are set up via project_setup.gs or a manual one-time invocation.
//
// SAFE GUARDS:
//   - Only fires for INPUT_BESS!C6 edits.
//   - Caught exceptions just log to the LOGS sheet — never block the edit.
function onEditTriggerBessPicker(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    if (sh.getName() !== 'INPUT_BESS') return;
    if (e.range.getRow() !== 6 || e.range.getColumn() !== 3) return;
    var ss = e.source || SpreadsheetApp.getActive();
    applyBessPickerForCell(ss, e.value);
  } catch (err) {
    try {
      var ss2 = SpreadsheetApp.getActive();
      var logs = ss2.getSheetByName('LOGS') || ss2.insertSheet('LOGS');
      logs.appendRow([new Date(), 'BessPicker', 'ERROR', String(err)]);
    } catch (_) { /* nothing we can do */ }
  }
}
