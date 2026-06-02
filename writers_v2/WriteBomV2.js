// =============================================================================
// ARGIA ENGINE v2 -- File: writers_v2/WriteBomV2.gs
// -----------------------------------------------------------------------------
// CHUNK 4 — BOM_v2 data writer.
//
// CONTRACT
//   writeBomV2(ss, inp, panel, invBank, dc, ac, lay, nom, bessResult)
//   - Assumes setupBomTemplate(ss) has run and BOM_v2 sheet exists with all
//     section headers / subtotals / grand total band already styled and
//     all cell formats (number, alignment, font) applied to content rows.
//   - Writes ONLY values + value-bearing formulas at fixed (row, col) addresses
//     defined by BOM_ROW and BOM_COL in 00_Main.js.
//   - Idempotent at data level: same inputs → same cells. Re-running the
//     engine produces the same BOM_v2 contents.
//
// PARITY WITH LEGACY
//   Mirrors 08_WriteBOM.js section-by-section. Every value, formula, note,
//   and reference text is meant to match legacy on a CULLIGAN run within
//   the regression baseline tolerances.
//
//   Deliberate differences from legacy:
//     1. Target sheet is V2_SHEETS.BOM ('BOM_v2'), not SH.BOM ('BOM').
//     2. No clearContent/clearNote at top — the template's clear() already
//        wiped the sheet before this writer ran.
//     3. No inline styleSectionHeader / styleSubtotal / styleGrandTotal
//        calls — the template owns all formatting.
//     4. The §8 BESS reset block (legacy lines 936-991) is GONE. Template
//        sets §8 row heights and styles correctly from the start.
//     5. All DB helpers are _bomV2_* (writers_v2/helpers/BomDbHelpers.js),
//        not the legacy helpers in 08_WriteBOM.js. Both coexist until cutover.
//
// READS FROM
//   - Untouched DB mirror sheets (13M_PRODUCTS_STRUCTURES, 14M_PRODUCTS_BOS)
//     via _bomV2_ helpers
//   - INPUT_INSTALL!D16 (trayM) via readInput()
//   - Live BESS calc results in bessResult.bos.lines (when present)
//   - For BESS battery line price: lookupBatteryUnitPrice (shared infra,
//     02_LoadDB.js — not writer code)
//   - For BESS BoS pricing: _bomV2_resolveBessBosPrice (in this file),
//     which uses _bomV2_ helpers + selectConduit (shared infra,
//     03_ElecTables.js)
//
// CALLED BY
//   runArgiaEngine() (Step 11-v2), wrapped in try/catch so a v2 bug never
//   breaks the legacy BOM.
//
// DEPENDENCIES
//   - V2_SHEETS.BOM                              -- templates/TemplateRegistry.gs
//   - BOM_ROW, BOM_COL                           -- 00_Main.js (shared)
//   - readInput, inputLocation                   -- 02d_InputIO.js (shared infra)
//   - conductorUnit                              -- 03_ElecTables.js (shared infra)
//   - readElecTables, selectConduit              -- 03_ElecTables.js (shared infra)
//   - lookupBatteryUnitPrice                     -- 02_LoadDB.js (shared infra)
//   - All _bomV2_* DB helpers                    -- writers_v2/helpers/BomDbHelpers.js
// =============================================================================


// -----------------------------------------------------------------------------
// writeBomV2
// -----------------------------------------------------------------------------
//   The 10th parameter (_testOpts) is a hidden test seam — production callers
//   omit it. Exposes injection points for readInput, _bomV2_loadStructureDb,
//   _bomV2_loadBosDb, and lookupBatteryUnitPrice so unit tests can drive
//   the writer without real sheets.
// -----------------------------------------------------------------------------
function writeBomV2(ss, inp, panel, invBank, dc, ac, lay, nom, bessResult, _testOpts) {
  ss = ss || SpreadsheetApp.getActive();
  _testOpts = _testOpts || {};
  var readInputFn          = _testOpts.readInputFn          || null;  // resolved via fallback below
  var loadStructureDbFn    = _testOpts.loadStructureDbFn    || _bomV2_loadStructureDb;
  var loadBosDbFn          = _testOpts.loadBosDbFn          || _bomV2_loadBosDb;
  var lookupBatteryPriceFn = _testOpts.lookupBatteryPriceFn || null;  // resolved via fallback below
  var readElecTablesFn     = _testOpts.readElecTablesFn     || null;  // resolved via fallback in _resolveBessBosPrice
  var selectConduitFn      = _testOpts.selectConduitFn      || null;
  var conductorUnitFn      = _testOpts.conductorUnitFn      || null;

  // Fall back to the globals when no override (Apps Script V8 bare-name
  // resolution means we need this dance — same pattern as PC_v2).
  function rdInput(key) {
    return readInputFn ? readInputFn(ss, key) : readInput(ss, key);
  }
  function rdBatteryPrice(batteryId) {
    return lookupBatteryPriceFn
      ? lookupBatteryPriceFn(ss, batteryId)
      : lookupBatteryUnitPrice(ss, batteryId);
  }
  function rdConductorUnit(awg) {
    return conductorUnitFn ? conductorUnitFn(awg) : conductorUnit(awg);
  }

  var sheetName = V2_SHEETS.BOM;
  var bom = ss.getSheetByName(sheetName);
  if (!bom) {
    throw new Error('writeBomV2: ' + sheetName + ' sheet not found. '
                  + 'Call setupBomTemplate(ss) first.');
  }

  var bosDb       = loadBosDbFn(ss);
  var structureDb = loadStructureDbFn(ss);
  var itemNo      = 1;
  var trayM       = parseFloat(rdInput('trayM')) || 0;

  // ---- Local write helpers ------------------------------------------------
  function w(r, c, val) {
    if (val !== null && val !== undefined && val !== '') {
      bom.getRange(r, c).setValue(val);
    }
  }
  // wp(row, priceMxn, priceUsd, priceInfo):
  //   priceUsd > 0 → direct USD unit price written to col E
  //   priceMxn > 0 → MXN unit price written as =mxn/$F$<EXCHANGE_RATE> to col E
  //   Either way: col F gets =C*E, col G gets =F*$F$<EXCHANGE_RATE>
  //   priceInfo (optional): {provenance|sourceTag|manualOverride} -> Pass 6a
  //   per-line price status note. Lines that are not a firm CATALOG_PRICE get a
  //   note so anything needing a quote is visible BOM-wide. Backward-compatible:
  //   when priceInfo is omitted the status is derived from the prices alone.
  function wp(r, priceMxn, priceUsd, priceInfo) {
    if (priceUsd && priceUsd > 0) {
      bom.getRange(r, BOM_COL.UNIT_PRICE).setValue(priceUsd).setNumberFormat('#,##0.00');
    } else if (priceMxn && priceMxn > 0) {
      bom.getRange(r, BOM_COL.UNIT_PRICE)
        .setFormula('=' + priceMxn.toFixed(4) + '/$F$' + BOM_ROW.EXCHANGE_RATE)
        .setNumberFormat('#,##0.00');
    }
    bom.getRange(r, BOM_COL.TOTAL_USD).setFormula('=C' + r + '*E' + r).setNumberFormat('#,##0.00');
    bom.getRange(r, BOM_COL.TOTAL_MXN).setFormula('=F' + r + '*$F$' + BOM_ROW.EXCHANGE_RATE).setNumberFormat('#,##0');

    // Pass 6a: per-line price-status note (skip clean catalog prices to reduce noise).
    try {
      var info = priceInfo || {};
      if (info.priceUsd === undefined) info.priceUsd = priceUsd;
      if (info.priceMxn === undefined) info.priceMxn = priceMxn;
      var status = classifyBomLinePriceStatus(info);
      if (status !== 'CATALOG_PRICE') {
        var LABEL = {
          SUPPLIER_QUOTED : 'Estado precio: SUPPLIER_QUOTED (cotizado por proveedor)',
          ESTIMATED       : 'Estado precio: ESTIMATED (estimado -- confirmar con cotizacion)',
          MANUAL_OVERRIDE : 'Estado precio: MANUAL_OVERRIDE (precio ingresado a mano)',
          MISSING_PRICE   : 'Estado precio: MISSING_PRICE (pendiente de cotizacion)'
        };
        note(r, BOM_COL.UNIT_PRICE, LABEL[status] || ('Estado precio: ' + status));
      }
    } catch (_pcErr) { /* status note is advisory; never break the BOM write */ }
  }
  // Subtotal: SUM(F<r1>:F<r2>) into col F, MXN-mirror into col G.
  function ws(r, r1, r2, label) {
    if (label) w(r, BOM_COL.DESCRIPTION, label);
    bom.getRange(r, BOM_COL.TOTAL_USD)
      .setFormula('=SUM(F' + r1 + ':F' + r2 + ')').setNumberFormat('#,##0.00');
    bom.getRange(r, BOM_COL.TOTAL_MXN)
      .setFormula('=F' + r + '*$F$' + BOM_ROW.EXCHANGE_RATE).setNumberFormat('#,##0');
  }
  function note(r, c, text) {
    bom.getRange(r, c).setNote(text);
  }

  // ====================================================================
  // ROW 4: project meta + ROW 5: headers + ROW 6: exchange rate
  // ====================================================================
  w(BOM_ROW.PROJECT_META, BOM_COL.ITEM,
    'BOM -- ' + inp.projectName + ' | ' + inp.clientName +
    ' | ' + inp.panelQty + ' mod x ' + panel['PANEL_POWER_W'] +
    'W = ' + dc.dcKwp.toFixed(2) + ' kWp / ' + dc.acKwTotal + ' kWac');

  ['#','DESCRIPCION','QTY','UNIDAD','PRECIO U (USD)','TOTAL (USD)','TOTAL (MXN)','REFERENCIA']
    .forEach(function(h, i) { w(BOM_ROW.HEADERS, i+1, h); });

  w(BOM_ROW.EXCHANGE_RATE, BOM_COL.UNIT_PRICE, 'TC USD/MXN:');
  bom.getRange(BOM_ROW.EXCHANGE_RATE, BOM_COL.TOTAL_USD)
    .setValue(18.50).setNumberFormat('#,##0.00')
    .setNote('Actualiza el tipo de cambio USD/MXN aqui. Todas las formulas MXN usan $F$' + BOM_ROW.EXCHANGE_RATE + '.');

  // ====================================================================
  // §1 PANELES SOLARES
  // ====================================================================
  w(BOM_ROW.SEC_PANELS, BOM_COL.DESCRIPTION, '1. PANELES SOLARES');

  var panelPriceWp = parseFloat(panel['PANEL_PRICE_Wp_USD']) || null;
  var panelUsdUnit = panelPriceWp ? panelPriceWp * parseFloat(panel['PANEL_POWER_W']) : null;
  w(BOM_ROW.PANEL_PRIMARY, BOM_COL.ITEM, itemNo++);
  w(BOM_ROW.PANEL_PRIMARY, BOM_COL.DESCRIPTION,
    (panel['PANEL_BRAND'] + ' ' + panel['PANEL_MODEL'] + ' ' +
     panel['PANEL_POWER_W'] + 'W ' + (panel['PANEL_TECHNOLOGY'] || '') +
     ' ' + (panel['PANEL_CELL_TYPE'] || '')).trim());
  w(BOM_ROW.PANEL_PRIMARY, BOM_COL.QTY, inp.panelQty);
  w(BOM_ROW.PANEL_PRIMARY, BOM_COL.UNIT, 'pcs');
  w(BOM_ROW.PANEL_PRIMARY, BOM_COL.REFERENCE, panel['PROD_ID'] || '');
  wp(BOM_ROW.PANEL_PRIMARY, null, panelUsdUnit);
  if (!panelUsdUnit) {
    note(BOM_ROW.PANEL_PRIMARY, BOM_COL.UNIT_PRICE,
         'Precio pendiente -- PANEL_PRICE_Wp_USD no definido en DB');
  }

  // Secondary panels (up to 4) in rows after PANEL_PRIMARY
  if (inp.secondaryPanels && inp.secondaryPanels.length > 0) {
    inp.secondaryPanels.slice(0, 4).forEach(function(sp, si) {
      var r = BOM_ROW.PANEL_PRIMARY + 1 + si;
      w(r, BOM_COL.ITEM, itemNo++);
      w(r, BOM_COL.DESCRIPTION, '[SECUNDARIO] ' + sp.model + ' ' + sp.powerW + 'W');
      w(r, BOM_COL.QTY, sp.qty);
      w(r, BOM_COL.UNIT, 'pcs');
      w(r, BOM_COL.REFERENCE,
        'NOM calcs usan panel primario (fila ' + BOM_ROW.PANEL_PRIMARY + ')');
      note(r, BOM_COL.UNIT_PRICE, 'Panel secundario -- cotizar por separado');
      bom.getRange(r, BOM_COL.TOTAL_USD).setFormula('=C' + r + '*E' + r).setNumberFormat('#,##0.00');
      bom.getRange(r, BOM_COL.TOTAL_MXN).setFormula('=F' + r + '*$F$' + BOM_ROW.EXCHANGE_RATE).setNumberFormat('#,##0');
    });
  }
  ws(BOM_ROW.SUBTOTAL_PANELS,
     BOM_ROW.PANEL_PRIMARY, BOM_ROW.SUBTOTAL_PANELS - 1,
     'SUBTOTAL PANELES SOLARES');

  // ====================================================================
  // §2 INVERSORES
  // ====================================================================
  w(BOM_ROW.SEC_INVERTERS, BOM_COL.DESCRIPTION, '2. INVERSORES');
  invBank.slice(0, 5).forEach(function(inv, i) {
    var r = BOM_ROW.INVERTER_PRIMARY + i;
    w(r, BOM_COL.ITEM, itemNo++);
    w(r, BOM_COL.DESCRIPTION,
      inv.model + ' ' + inv.acKw + 'kW -- ' + inv.voltage + 'V ' +
      (inv.phase === 3 ? '3F' : '1F'));
    w(r, BOM_COL.QTY, inv.qty);
    w(r, BOM_COL.UNIT, 'pcs');
    w(r, BOM_COL.REFERENCE, inv.invId || '');
    var priceUsd = (inv.priceUsd && inv.priceUsd > 0) ? inv.priceUsd : null;
    wp(r, null, priceUsd);
    if (!priceUsd) note(r, BOM_COL.UNIT_PRICE, 'Precio pendiente de cotizacion');
  });
  ws(BOM_ROW.SUBTOTAL_INVERTERS,
     BOM_ROW.INVERTER_PRIMARY, BOM_ROW.SUBTOTAL_INVERTERS - 1,
     'SUBTOTAL INVERSORES');

  // ====================================================================
  // §3 ESTRUCTURA
  // ====================================================================
  w(BOM_ROW.SEC_STRUCTURE, BOM_COL.DESCRIPTION, '3. ESTRUCTURA');

  var strRaw      = inp.structure || '';
  var strInfo     = _bomV2_resolveStructure(structureDb, strRaw);
  var strPriceUsd = strInfo ? strInfo.priceUsd : null;
  var strUsdTotal = strPriceUsd ? strPriceUsd * inp.panelQty : null;
  var strDisplay  = strInfo
    ? (strInfo.brand + ' ' + strInfo.model)
    : (strRaw || 'Estructura de montaje (ver INPUT_DESIGN)');
  var strRefText  = 'INPUT_DESIGN:C15 / 13M_PRODUCTS_STRUCTURES' +
                    (strInfo ? ' / ' + strInfo.strId : '');

  w(BOM_ROW.STRUCTURE_PRIMARY, BOM_COL.ITEM, itemNo++);
  w(BOM_ROW.STRUCTURE_PRIMARY, BOM_COL.DESCRIPTION, strDisplay);
  w(BOM_ROW.STRUCTURE_PRIMARY, BOM_COL.QTY, inp.panelQty);
  w(BOM_ROW.STRUCTURE_PRIMARY, BOM_COL.UNIT, 'pcs');
  w(BOM_ROW.STRUCTURE_PRIMARY, BOM_COL.REFERENCE, strRefText);
  if (strUsdTotal) {
    wp(BOM_ROW.STRUCTURE_PRIMARY, null, strPriceUsd);
    note(BOM_ROW.STRUCTURE_PRIMARY, BOM_COL.UNIT_PRICE,
      'USD/panel from 13M_PRODUCTS_STRUCTURES col M.\n' +
      strInfo.strId + ' (' + strInfo.brand + ' / ' + strInfo.model + '): $' +
      strPriceUsd + ' USD/panel \u00d7 ' + inp.panelQty + ' panels = $' +
      strUsdTotal.toFixed(0) + ' USD\n' +
      'Note: may need rail/accessory rows below if system requires separate rail profile.');
  } else if (strInfo) {
    note(BOM_ROW.STRUCTURE_PRIMARY, BOM_COL.UNIT_PRICE,
      'Estructura resuelta (' + strInfo.strId + ') pero precio no cargado en ' +
      'DB col M. Cotizar con proveedor.');
  } else {
    note(BOM_ROW.STRUCTURE_PRIMARY, BOM_COL.UNIT_PRICE,
      'No se pudo resolver la estructura "' + strRaw + '" en ' +
      '13M_PRODUCTS_STRUCTURES.\n' +
      'Selecciona un valor del dropdown en INPUT_DESIGN!C15 ' +
      '(formato: "BRAND \u2014 MODEL \u2014 STR_ID").\n' +
      'Cotizar con proveedor.');
  }

  // Secondary structure (e.g. rail for clip+rail systems)
  var strModel2 = String(inp.structure2 || '').trim();
  if (strModel2) {
    var strPrice2 = _bomV2_structurePriceUsdPerPanel(structureDb, strModel2);
    w(BOM_ROW.STRUCTURE_SECONDARY, BOM_COL.ITEM, itemNo++);
    w(BOM_ROW.STRUCTURE_SECONDARY, BOM_COL.DESCRIPTION, strModel2);
    w(BOM_ROW.STRUCTURE_SECONDARY, BOM_COL.QTY, inp.panelQty);
    w(BOM_ROW.STRUCTURE_SECONDARY, BOM_COL.UNIT, 'pcs');
    w(BOM_ROW.STRUCTURE_SECONDARY, BOM_COL.REFERENCE,
      'INPUT_DESIGN:M42 / 13M_PRODUCTS_STRUCTURES');
    if (strPrice2) {
      wp(BOM_ROW.STRUCTURE_SECONDARY, null, strPrice2);
      note(BOM_ROW.STRUCTURE_SECONDARY, BOM_COL.UNIT_PRICE,
           '$' + strPrice2 + ' USD/panel from DB');
    } else {
      note(BOM_ROW.STRUCTURE_SECONDARY, BOM_COL.UNIT_PRICE,
        'Precio pendiente: "' + strModel2 + '" no encontrado en ' +
        '13M_PRODUCTS_STRUCTURES. Cotizar con proveedor.');
    }
  }

  // Inverter mounting structure
  var invCount = invBank.reduce(function(s, inv) { return s + inv.qty; }, 0);
  w(BOM_ROW.STRUCTURE_INVERTER, BOM_COL.ITEM, itemNo++);
  w(BOM_ROW.STRUCTURE_INVERTER, BOM_COL.DESCRIPTION,
    'Estructura montaje inversores (rack / soporte mural)');
  w(BOM_ROW.STRUCTURE_INVERTER, BOM_COL.QTY, invCount > 0 ? invCount : 1);
  w(BOM_ROW.STRUCTURE_INVERTER, BOM_COL.UNIT, invCount > 1 ? 'pcs' : 'lot');
  w(BOM_ROW.STRUCTURE_INVERTER, BOM_COL.REFERENCE, 'Cotizar con proveedor');
  note(BOM_ROW.STRUCTURE_INVERTER, BOM_COL.UNIT_PRICE,
    'Precio a cotizar con proveedor.\n' +
    'Precio de mercado est\u00e1ndar: $600\u2013$1,500 USD/inversor seg\u00fan modelo y tipo de montaje.\n' +
    '(soporte mural, pedestal, rack IP65 para inversores 100\u2013150 kW)');
  bom.getRange(BOM_ROW.STRUCTURE_INVERTER, BOM_COL.TOTAL_USD)
    .setFormula('=C' + BOM_ROW.STRUCTURE_INVERTER + '*E' + BOM_ROW.STRUCTURE_INVERTER)
    .setNumberFormat('#,##0.00');
  bom.getRange(BOM_ROW.STRUCTURE_INVERTER, BOM_COL.TOTAL_MXN)
    .setFormula('=F' + BOM_ROW.STRUCTURE_INVERTER + '*$F$' + BOM_ROW.EXCHANGE_RATE)
    .setNumberFormat('#,##0');

  ws(BOM_ROW.SUBTOTAL_STRUCTURE,
     BOM_ROW.STRUCTURE_PRIMARY, BOM_ROW.STRUCTURE_INVERTER,
     'SUBTOTAL ESTRUCTURA');

  // ====================================================================
  // §4 ELECTRICO DC
  // ====================================================================
  w(BOM_ROW.SEC_DC, BOM_COL.DESCRIPTION, '4. ELECTRICO DC');

  // PV WIRE for DC homeruns
  var pvWireObj = _bomV2_bosPriceObj(bosDb, 'CONDUCTORS', 'PV WIRE', dc.conductorDC + ' AWG');
  w(BOM_ROW.DC_CABLE, BOM_COL.ITEM, itemNo++);
  w(BOM_ROW.DC_CABLE, BOM_COL.DESCRIPTION,
    'Cable DC ' + dc.conductorDC + ' ' + rdConductorUnit(dc.conductorDC) +
    ' PV WIRE Cu (string homeruns)');
  w(BOM_ROW.DC_CABLE, BOM_COL.QTY, lay.bom.dcCableM);
  w(BOM_ROW.DC_CABLE, BOM_COL.UNIT, 'm');
  w(BOM_ROW.DC_CABLE, BOM_COL.REFERENCE,
    'DC-05 / NOM 690.8(b)' + (pvWireObj && pvWireObj.id ? ' | ' + pvWireObj.id : ''));
  wp(BOM_ROW.DC_CABLE, null, pvWireObj ? pvWireObj.price : null);
  if (!pvWireObj) {
    note(BOM_ROW.DC_CABLE, BOM_COL.UNIT_PRICE,
         'PV WIRE ' + dc.conductorDC + ' ' + rdConductorUnit(dc.conductorDC) +
         ' no encontrado en 14M_PRODUCTS_BOS');
  }

  // DC grounding cable
  var egcDcKey = String(dc.egcDC || '').trim().toUpperCase();
  if (egcDcKey.indexOf('AWG') === -1) egcDcKey += ' AWG';
  var egcDcObj = _bomV2_groundPriceObj(bosDb, egcDcKey);
  w(BOM_ROW.DC_GROUNDING, BOM_COL.ITEM, itemNo++);
  w(BOM_ROW.DC_GROUNDING, BOM_COL.DESCRIPTION,
    'Cable tierra DC ' + dc.egcDC + ' ' + rdConductorUnit(dc.egcDC) + ' Cu desnudo');
  w(BOM_ROW.DC_GROUNDING, BOM_COL.QTY, lay.bom.dcGroundingM);
  w(BOM_ROW.DC_GROUNDING, BOM_COL.UNIT, 'm');
  w(BOM_ROW.DC_GROUNDING, BOM_COL.REFERENCE,
    'DC-06 / NOM 690.45' + (egcDcObj && egcDcObj.id ? ' | ' + egcDcObj.id : ''));
  if (egcDcObj) {
    if (egcDcObj.isUsd) { wp(BOM_ROW.DC_GROUNDING, null, egcDcObj.price); }
    else                { wp(BOM_ROW.DC_GROUNDING, egcDcObj.price, null); }
  }

  // MC4 connectors
  var mc4Obj = _bomV2_mc4PriceObj(bosDb);
  w(BOM_ROW.DC_MC4, BOM_COL.ITEM, itemNo++);
  w(BOM_ROW.DC_MC4, BOM_COL.DESCRIPTION,
    'Conector MC4 par ' + dc.conductorDC + ' ' + rdConductorUnit(dc.conductorDC));
  w(BOM_ROW.DC_MC4, BOM_COL.QTY, lay.bom.mc4Pairs);
  w(BOM_ROW.DC_MC4, BOM_COL.UNIT, 'par');
  w(BOM_ROW.DC_MC4, BOM_COL.REFERENCE,
    'String termination' + (mc4Obj && mc4Obj.id ? ' | ' + mc4Obj.id : ''));
  wp(BOM_ROW.DC_MC4, null, mc4Obj ? mc4Obj.price : null);

  // DC OCPD (fuses)
  var dcFuseObj = _bomV2_bosPriceObj(bosDb, 'PROTECTION', 'DC FUSES', '20A 10X38MM') ||
                  _bomV2_bosPriceObj(bosDb, 'PROTECTION', 'DC FUSES', '30A 10X38MM');
  w(BOM_ROW.DC_OCPD, BOM_COL.ITEM, itemNo++);
  w(BOM_ROW.DC_OCPD, BOM_COL.DESCRIPTION,
    'OCPD DC string ' + dc.ocpdDC + 'A (fusible 10x38mm)');
  w(BOM_ROW.DC_OCPD, BOM_COL.QTY, lay.bom.dcOcpdUnits);
  w(BOM_ROW.DC_OCPD, BOM_COL.UNIT, 'pcs');
  w(BOM_ROW.DC_OCPD, BOM_COL.REFERENCE,
    'DC-04 / NOM 690.9' + (dcFuseObj && dcFuseObj.id ? ' | ' + dcFuseObj.id : ''));
  if (dcFuseObj) {
    if (dcFuseObj.isUsd) { wp(BOM_ROW.DC_OCPD, null, dcFuseObj.price); }
    else                 { wp(BOM_ROW.DC_OCPD, dcFuseObj.price, null); }
  }

  // DC conduit (or cable tray if trayM > 0)
  var condSzDC     = parseFloat(dc.conduitDC);
  var condObjDC    = _bomV2_conduitPriceObj(bosDb, condSzDC);
  var condSticksDC = Math.ceil(lay.bom.dcConduitM / 3);
  w(BOM_ROW.DC_CONDUIT, BOM_COL.ITEM, itemNo++);
  if (trayM > 0) {
    var trayObjDC    = _bomV2_ladderTrayPriceObj(bosDb);
    var trayTramosDC = Math.ceil(trayM / 3);
    w(BOM_ROW.DC_CONDUIT, BOM_COL.DESCRIPTION,
      'Charola tipo escalera (DC homerun horizontal) ' + trayM + 'm');
    w(BOM_ROW.DC_CONDUIT, BOM_COL.QTY, trayTramosDC);
    w(BOM_ROW.DC_CONDUIT, BOM_COL.UNIT, 'tramo');
    w(BOM_ROW.DC_CONDUIT, BOM_COL.REFERENCE,
      'DC-08-TRAY' + (trayObjDC && trayObjDC.id ? ' | ' + trayObjDC.id : ''));
    if (trayObjDC) { wp(BOM_ROW.DC_CONDUIT, trayObjDC.price, null); }
    else note(BOM_ROW.DC_CONDUIT, BOM_COL.UNIT_PRICE,
              'Precio charola pendiente \u2014 cotizar con proveedor');
  } else {
    w(BOM_ROW.DC_CONDUIT, BOM_COL.DESCRIPTION,
      'Conduit IMC ' + _bomV2_conduitSizeLabel(dc.conduitDC) + '" x 3m (DC)');
    w(BOM_ROW.DC_CONDUIT, BOM_COL.QTY, condSticksDC);
    w(BOM_ROW.DC_CONDUIT, BOM_COL.UNIT, 'pza');
    w(BOM_ROW.DC_CONDUIT, BOM_COL.REFERENCE,
      'DC-08 / Ch9 Table 1' + (condObjDC && condObjDC.id ? ' | ' + condObjDC.id : ''));
    if (condObjDC) {
      if (condObjDC.isUsd) { wp(BOM_ROW.DC_CONDUIT, null, condObjDC.price); }
      else                 { wp(BOM_ROW.DC_CONDUIT, condObjDC.price, null); }
    }
  }

  // RSD (Rapid Shutdown Device)
  var rsdQty = lay.bom.rsdRequired ? Math.ceil(inp.stringsTotal / 5) : 0;
  w(BOM_ROW.DC_RSD, BOM_COL.ITEM, itemNo++);
  w(BOM_ROW.DC_RSD, BOM_COL.DESCRIPTION, 'Dispositivo apagado rapido RSD (ROOF)');
  w(BOM_ROW.DC_RSD, BOM_COL.QTY, rsdQty > 0 ? rsdQty : '');
  w(BOM_ROW.DC_RSD, BOM_COL.UNIT, 'pcs');
  w(BOM_ROW.DC_RSD, BOM_COL.REFERENCE, 'SAFE-01 / NOM 690.12');
  if (rsdQty > 0) {
    wp(BOM_ROW.DC_RSD, null, 2500);
    note(BOM_ROW.DC_RSD, BOM_COL.UNIT_PRICE,
      'Precio referencia $2,500 USD/unidad \u2014 confirmar con proveedor.\n' +
      'NOM 690.12 requiere RSD en instalaciones de azotea.');
  }

  // OPTIMIZERS / MLPE (Pass 4). Reserved DC row 33 (between DC_RSD and
  // SUBTOTAL_DC, so it is captured by the DC subtotal SUM). Rendered only when
  // an OPTIMIZER-topology inverter is present (e.g. SolarEdge). Quantity comes
  // from calcLayout (lay.bom.optimizerUnits). Price left to the BOM owner: the
  // optimizer model varies, so we flag it rather than fabricate a unit cost.
  var _optRow = BOM_ROW.DC_RSD + 1;          // reserved row 33
  var optQty  = (lay.bom && lay.bom.optimizerUnits) || 0;
  if (optQty > 0) {
    w(_optRow, BOM_COL.ITEM, itemNo++);
    w(_optRow, BOM_COL.DESCRIPTION, 'Optimizador de potencia (MLPE) por modulo');
    w(_optRow, BOM_COL.QTY, optQty);
    w(_optRow, BOM_COL.UNIT, 'pcs');
    w(_optRow, BOM_COL.REFERENCE, 'Inversor topologia OPTIMIZER');
    note(_optRow, BOM_COL.UNIT_PRICE,
      'Cantidad = modulos / optimizador (' + optQty + ' pcs). ' +
      'Confirmar modelo y precio del optimizador con el proveedor.');
  }

  ws(BOM_ROW.SUBTOTAL_DC,
     BOM_ROW.DC_CABLE, BOM_ROW.SUBTOTAL_DC - 1,
     'SUBTOTAL ELECTRICO DC');

  // ====================================================================
  // §5 ELECTRICO AC
  // ====================================================================
  w(BOM_ROW.SEC_AC, BOM_COL.DESCRIPTION, '5. ELECTRICO AC');

  // Main feeder cable
  var mCableObj = _bomV2_conductorPriceObj(bosDb, ac.condMain);
  w(BOM_ROW.AC_FEEDER, BOM_COL.ITEM, itemNo++);
  w(BOM_ROW.AC_FEEDER, BOM_COL.DESCRIPTION,
    'Cable alimentador principal ' + ac.condMain + ' ' +
    rdConductorUnit(ac.condMain) + ' THHW Cu');
  w(BOM_ROW.AC_FEEDER, BOM_COL.QTY, lay.bom.mainFeederCableM);
  w(BOM_ROW.AC_FEEDER, BOM_COL.UNIT, 'm');
  w(BOM_ROW.AC_FEEDER, BOM_COL.REFERENCE,
    'AC-02 / main feeder' + (mCableObj && mCableObj.id ? ' | ' + mCableObj.id : ''));
  if (mCableObj) {
    if (mCableObj.isUsd) { wp(BOM_ROW.AC_FEEDER, null, mCableObj.price); }
    else                 { wp(BOM_ROW.AC_FEEDER, mCableObj.price, null); }
  } else {
    note(BOM_ROW.AC_FEEDER, BOM_COL.UNIT_PRICE,
         'Precio pendiente \u2014 cotizar con proveedor');
  }

  // Main feeder EGC
  var mEgcObj = _bomV2_groundPriceObj(bosDb, ac.egcMain);
  w(BOM_ROW.AC_EGC, BOM_COL.ITEM, itemNo++);
  w(BOM_ROW.AC_EGC, BOM_COL.DESCRIPTION,
    'Cable tierra principal ' + ac.egcMain + ' ' +
    rdConductorUnit(ac.egcMain) + ' Cu desnudo');
  w(BOM_ROW.AC_EGC, BOM_COL.QTY, lay.bom.mainEgcM);
  w(BOM_ROW.AC_EGC, BOM_COL.UNIT, 'm');
  w(BOM_ROW.AC_EGC, BOM_COL.REFERENCE,
    'AC-03 / NOM 250.122' + (mEgcObj && mEgcObj.id ? ' | ' + mEgcObj.id : ''));
  if (mEgcObj) {
    if (mEgcObj.isUsd) { wp(BOM_ROW.AC_EGC, null, mEgcObj.price); }
    else               { wp(BOM_ROW.AC_EGC, mEgcObj.price, null); }
  } else {
    note(BOM_ROW.AC_EGC, BOM_COL.UNIT_PRICE,
         'Precio pendiente \u2014 cotizar con proveedor');
  }

  // Main breaker (3-pole, with size fallback)
  var mBrkResult = _bomV2_breakerPriceWithFallback(bosDb, ac.mainBreaker, 3);
  w(BOM_ROW.AC_BREAKER, BOM_COL.ITEM, itemNo++);
  w(BOM_ROW.AC_BREAKER, BOM_COL.DESCRIPTION,
    'Breaker principal I-LINE ' + ac.mainBreaker + 'A 3P');
  w(BOM_ROW.AC_BREAKER, BOM_COL.QTY, 1);
  w(BOM_ROW.AC_BREAKER, BOM_COL.UNIT, 'pcs');
  w(BOM_ROW.AC_BREAKER, BOM_COL.REFERENCE,
    'AC-01 / main' + (mBrkResult && mBrkResult.id ? ' | ' + mBrkResult.id : ''));
  wp(BOM_ROW.AC_BREAKER, null, mBrkResult.price || null);
  if (mBrkResult.note) note(BOM_ROW.AC_BREAKER, BOM_COL.UNIT_PRICE, mBrkResult.note);

  // Main conduit (or tray) — cableM is total across 3 phases × spare;
  // run length = cableM / 3 phases, then ÷ 3m per stick/tramo.
  var mCondSz   = parseFloat(ac.conduitMain);
  var mCondObj  = _bomV2_conduitPriceObj(bosDb, mCondSz);
  var mCondStks = Math.ceil(lay.bom.mainFeederCableM / 3 / 3);
  if (trayM > 0) {
    var trayObjAC    = _bomV2_ladderTrayPriceObj(bosDb);
    var trayTramosAC = Math.ceil(lay.bom.mainFeederCableM / 3 / 3);
    w(BOM_ROW.AC_CONDUIT, BOM_COL.DESCRIPTION,
      'Charola tipo escalera (alimentador AC horizontal) ' +
      lay.bom.mainFeederCableM + 'm');
    w(BOM_ROW.AC_CONDUIT, BOM_COL.QTY, trayTramosAC);
    w(BOM_ROW.AC_CONDUIT, BOM_COL.UNIT, 'tramo');
    w(BOM_ROW.AC_CONDUIT, BOM_COL.REFERENCE,
      'AC-05-TRAY' + (trayObjAC && trayObjAC.id ? ' | ' + trayObjAC.id : ''));
    if (trayObjAC) { wp(BOM_ROW.AC_CONDUIT, trayObjAC.price, null); }
    else note(BOM_ROW.AC_CONDUIT, BOM_COL.UNIT_PRICE,
              'Precio charola pendiente \u2014 cotizar con proveedor');
  } else {
    w(BOM_ROW.AC_CONDUIT, BOM_COL.ITEM, itemNo++);
    w(BOM_ROW.AC_CONDUIT, BOM_COL.DESCRIPTION,
      'Conduit principal IMC ' + _bomV2_conduitSizeLabel(ac.conduitMain) + '" x 3m');
    w(BOM_ROW.AC_CONDUIT, BOM_COL.QTY, mCondStks);
    w(BOM_ROW.AC_CONDUIT, BOM_COL.UNIT, 'pza');
    w(BOM_ROW.AC_CONDUIT, BOM_COL.REFERENCE,
      'AC-05' + (mCondObj && mCondObj.id ? ' | ' + mCondObj.id : ''));
    if (mCondObj) {
      if (mCondObj.isUsd) { wp(BOM_ROW.AC_CONDUIT, null, mCondObj.price); }
      else                { wp(BOM_ROW.AC_CONDUIT, mCondObj.price, null); }
    } else {
      note(BOM_ROW.AC_CONDUIT, BOM_COL.UNIT_PRICE,
           'Precio pendiente \u2014 cotizar con proveedor');
    }
  }

  // Panelboard
  var pbObj = _bomV2_panelboardPriceObj(bosDb, ac.mainBreaker);
  w(BOM_ROW.AC_PANELBOARD, BOM_COL.ITEM, itemNo++);
  w(BOM_ROW.AC_PANELBOARD, BOM_COL.DESCRIPTION,
    'Tablero I-LINE AC (panelboard) >= ' + ac.mainBreaker + 'A');
  w(BOM_ROW.AC_PANELBOARD, BOM_COL.QTY, 1);
  w(BOM_ROW.AC_PANELBOARD, BOM_COL.UNIT, 'pcs');
  w(BOM_ROW.AC_PANELBOARD, BOM_COL.REFERENCE,
    'AC interconnection' + (pbObj && pbObj.id ? ' | ' + pbObj.id : ''));
  if (pbObj) {
    if (pbObj.isUsd) { wp(BOM_ROW.AC_PANELBOARD, null, pbObj.price); }
    else             { wp(BOM_ROW.AC_PANELBOARD, pbObj.price, null); }
  } else {
    note(BOM_ROW.AC_PANELBOARD, BOM_COL.UNIT_PRICE,
         'Precio pendiente \u2014 cotizar con proveedor');
  }

  // Per-inverter blocks (up to 5 inverter banks × 4 rows each)
  var AC_INV_START = BOM_ROW.AC_INV_BLOCK_START;
  lay.bom.acPerInverterBOM.slice(0, 5).forEach(function(invBom, slotIdx) {
    var base   = AC_INV_START + slotIdx * BOM_ROW.AC_INV_BLOCK_PER_INV;
    var invObj = invBank.find(function(x) { return x.model === invBom.model; });
    var poles  = (invObj && invObj.phase === 3) ? 3 : 2;
    var label  = invBom.model + ' x' + invBom.qty;

    // row+0: AC cable
    var cableObj = _bomV2_conductorPriceObj(bosDb, invBom.conductorSize);
    w(base, BOM_COL.ITEM, itemNo++);
    w(base, BOM_COL.DESCRIPTION,
      label + ' \u2014 Cable ' + invBom.conductorSize + ' ' +
      rdConductorUnit(invBom.conductorSize) + ' THHW Cu (' + invBom.cableM + 'm)');
    w(base, BOM_COL.QTY, invBom.cableM);
    w(base, BOM_COL.UNIT, 'm');
    w(base, BOM_COL.REFERENCE,
      'AC-01 / NOM 690.8' + (cableObj && cableObj.id ? ' | ' + cableObj.id : ''));
    if (cableObj) {
      if (cableObj.isUsd) { wp(base, null, cableObj.price); }
      else                { wp(base, cableObj.price, null); }
    } else {
      note(base, BOM_COL.UNIT_PRICE, 'Precio pendiente \u2014 cotizar con proveedor');
    }

    // row+1: EGC
    var egcObj = _bomV2_groundPriceObj(bosDb, invBom.egcSize);
    w(base+1, BOM_COL.ITEM, itemNo++);
    w(base+1, BOM_COL.DESCRIPTION,
      label + ' \u2014 Cable tierra ' + invBom.egcSize + ' ' +
      rdConductorUnit(invBom.egcSize) + ' Cu desnudo (' + invBom.egcM + 'm)');
    w(base+1, BOM_COL.QTY, invBom.egcM);
    w(base+1, BOM_COL.UNIT, 'm');
    w(base+1, BOM_COL.REFERENCE,
      'AC-03 / NOM 250.122' + (egcObj && egcObj.id ? ' | ' + egcObj.id : ''));
    if (egcObj) {
      if (egcObj.isUsd) { wp(base+1, null, egcObj.price); }
      else              { wp(base+1, egcObj.price, null); }
    } else {
      note(base+1, BOM_COL.UNIT_PRICE, 'Precio pendiente \u2014 cotizar con proveedor');
    }

    // row+2: breaker w/ fallback
    var brkResult = _bomV2_breakerPriceWithFallback(bosDb, invBom.ocpdA, poles);
    w(base+2, BOM_COL.ITEM, itemNo++);
    w(base+2, BOM_COL.DESCRIPTION,
      label + ' \u2014 Breaker I-LINE ' + invBom.ocpdA + 'A ' + poles + 'P');
    w(base+2, BOM_COL.QTY, invBom.qty);
    w(base+2, BOM_COL.UNIT, 'pcs');
    w(base+2, BOM_COL.REFERENCE,
      'AC-04 / NOM 690.9' + (brkResult && brkResult.id ? ' | ' + brkResult.id : ''));
    wp(base+2, null, brkResult.price || null);
    if (brkResult.note) note(base+2, BOM_COL.UNIT_PRICE, brkResult.note);

    // row+3: conduit
    var condSz   = parseFloat(invBom.conduitSize);
    var condObj  = _bomV2_conduitPriceObj(bosDb, condSz);
    var condStks = Math.ceil(invBom.cableM / 3 / 3);
    w(base+3, BOM_COL.ITEM, itemNo++);
    w(base+3, BOM_COL.DESCRIPTION,
      label + ' \u2014 Conduit IMC ' + _bomV2_conduitSizeLabel(invBom.conduitSize) + '" x 3m');
    w(base+3, BOM_COL.QTY, condStks);
    w(base+3, BOM_COL.UNIT, 'pza');
    w(base+3, BOM_COL.REFERENCE,
      'AC-05 / Ch9 Table 1' + (condObj && condObj.id ? ' | ' + condObj.id : ''));
    if (condObj) {
      if (condObj.isUsd) { wp(base+3, null, condObj.price); }
      else               { wp(base+3, condObj.price, null); }
    } else {
      note(base+3, BOM_COL.UNIT_PRICE, 'Precio pendiente \u2014 cotizar con proveedor');
    }
  });

  ws(BOM_ROW.SUBTOTAL_AC,
     BOM_ROW.AC_FEEDER, BOM_ROW.SUBTOTAL_AC - 1,
     'SUBTOTAL ELECTRICO AC');

  // ====================================================================
  // §6 TRANSFORMADOR
  // ====================================================================
  w(BOM_ROW.SEC_TRANSFORMER, BOM_COL.DESCRIPTION, '6. TRANSFORMADOR');
  if (inp.supplyTransformer !== 0) {
    var xfmrObj = _bomV2_transformerPriceObj(bosDb, ac.transformer);
    w(BOM_ROW.TRANSFORMER, BOM_COL.ITEM, itemNo++);
    w(BOM_ROW.TRANSFORMER, BOM_COL.DESCRIPTION,
      'Transformador seco ' + ac.transformer + ' kVA (' +
      ac.apparentPower.toFixed(0) + ' kVA base +20%)');
    w(BOM_ROW.TRANSFORMER, BOM_COL.QTY, 1);
    w(BOM_ROW.TRANSFORMER, BOM_COL.UNIT, 'pcs');
    w(BOM_ROW.TRANSFORMER, BOM_COL.REFERENCE,
      'TRANS-01 / NOM Art.450' + (xfmrObj && xfmrObj.id ? ' | ' + xfmrObj.id : ''));
    if (xfmrObj) {
      if (xfmrObj.isUsd) { wp(BOM_ROW.TRANSFORMER, null, xfmrObj.price); }
      else               { wp(BOM_ROW.TRANSFORMER, xfmrObj.price, null); }
    } else {
      note(BOM_ROW.TRANSFORMER, BOM_COL.UNIT_PRICE,
           'Precio pendiente \u2014 cotizar con proveedor');
    }
  } else {
    // Customer supplies — note only, no price
    w(BOM_ROW.TRANSFORMER, BOM_COL.DESCRIPTION,
      'Transformador seco ' + ac.transformer + ' kVA \u2014 suministro del cliente');
    w(BOM_ROW.TRANSFORMER, BOM_COL.QTY, 1);
    w(BOM_ROW.TRANSFORMER, BOM_COL.UNIT, 'pcs');
    note(BOM_ROW.TRANSFORMER, BOM_COL.UNIT_PRICE,
         'Excluido del costo: INPUT_DESIGN M85=0');
  }
  ws(BOM_ROW.SUBTOTAL_TRANSFORMER,
     BOM_ROW.TRANSFORMER, BOM_ROW.SUBTOTAL_TRANSFORMER - 1,
     'SUBTOTAL TRANSFORMADOR');

  // ====================================================================
  // §7 MONITOREO + PERMISOS + COMMISSIONING
  // ====================================================================
  w(BOM_ROW.SEC_MONITORING, BOM_COL.DESCRIPTION,
    '7. MONITOREO, PERMISOS Y PUESTA EN MARCHA');
  var monObj   = _bomV2_monitoringPriceObj(bosDb);
  var meterObj = _bomV2_meterPriceObj(bosDb);

  // Datalogger
  w(BOM_ROW.MON_DATALOGGER, BOM_COL.ITEM, itemNo++);
  w(BOM_ROW.MON_DATALOGGER, BOM_COL.DESCRIPTION,
    'Sistema monitoreo / datalogger + cloud');
  w(BOM_ROW.MON_DATALOGGER, BOM_COL.QTY, 1);
  w(BOM_ROW.MON_DATALOGGER, BOM_COL.UNIT, 'pcs');
  w(BOM_ROW.MON_DATALOGGER, BOM_COL.REFERENCE, monObj ? monObj.id : 'BOS_0258');
  if (monObj) {
    if (monObj.isUsd) { wp(BOM_ROW.MON_DATALOGGER, null, monObj.price); }
    else              { wp(BOM_ROW.MON_DATALOGGER, monObj.price, null); }
  } else {
    note(BOM_ROW.MON_DATALOGGER, BOM_COL.UNIT_PRICE,
         'Precio pendiente \u2014 cotizar con proveedor');
  }

  // Meter
  w(BOM_ROW.MON_METER, BOM_COL.ITEM, itemNo++);
  w(BOM_ROW.MON_METER, BOM_COL.DESCRIPTION,
    'Medidor bidireccional ION / CFE compatible');
  w(BOM_ROW.MON_METER, BOM_COL.QTY, 1);
  w(BOM_ROW.MON_METER, BOM_COL.UNIT, 'pcs');
  w(BOM_ROW.MON_METER, BOM_COL.REFERENCE, meterObj ? meterObj.id : 'BOS_0229');
  if (meterObj) {
    if (meterObj.isUsd) { wp(BOM_ROW.MON_METER, null, meterObj.price); }
    else                { wp(BOM_ROW.MON_METER, meterObj.price, null); }
  } else {
    note(BOM_ROW.MON_METER, BOM_COL.UNIT_PRICE,
         'Precio pendiente \u2014 cotizar con proveedor');
  }

  // Permits & commissioning services (4 fixed rows, $1500 USD each)
  var svcItems = [
    [BOM_ROW.MON_UVIE,          'Gestion UVIE / UIIE ante PEC',     'DOC-01'],
    [BOM_ROW.MON_CFE,           'Tramitacion CFE interconexion',    'DOC-01'],
    [BOM_ROW.MON_COMMISSIONING, 'Puesta en marcha y commissioning', 'QA-01..03'],
    [BOM_ROW.MON_THERMOGRAPHY,  'Termografia post-instalacion',     'ENV testing']
  ];
  svcItems.forEach(function(svc) {
    var r = svc[0];
    w(r, BOM_COL.ITEM, itemNo++);
    w(r, BOM_COL.DESCRIPTION, svc[1]);
    w(r, BOM_COL.QTY, 1);
    w(r, BOM_COL.UNIT, 'servicio');
    w(r, BOM_COL.REFERENCE, svc[2]);
    wp(r, null, 1500);
    note(r, BOM_COL.UNIT_PRICE,
         'Precio referencia $1,500 USD \u2014 confirmar con proveedor');
  });
  ws(BOM_ROW.SUBTOTAL_MONITORING,
     BOM_ROW.MON_DATALOGGER, BOM_ROW.SUBTOTAL_MONITORING - 1,
     'SUBTOTAL MONITOREO + PERMISOS');

  // ====================================================================
  // §8 BESS
  // ====================================================================
  w(BOM_ROW.SEC_BESS, BOM_COL.DESCRIPTION, '8. ALMACENAMIENTO / BESS');

  var hasBessLines = bessResult && bessResult.bos && !bessResult.bos.blocked &&
                     bessResult.bos.lines && bessResult.bos.lines.length > 0;
  if (!hasBessLines) {
    // BESS not configured OR BoS calculation blocked. Write a single
    // explanatory line and leave §8 rows empty.
    var bessReason = (bessResult && bessResult.bos && bessResult.bos.reason)
                     ? bessResult.bos.reason
                     : (bessResult && !bessResult.bessEnabled
                        ? 'BESS no habilitado en INPUT_PROJECT'
                        : 'BoS pendiente \u2014 completar \u00a76 distancias en INPUT_BESS');
    w(BOM_ROW.BESS_BATTERY_LINE, BOM_COL.ITEM, itemNo++);
    w(BOM_ROW.BESS_BATTERY_LINE, BOM_COL.DESCRIPTION,
      'Sistema BESS \u2014 pendiente (' + bessReason + ')');
    w(BOM_ROW.BESS_BATTERY_LINE, BOM_COL.REFERENCE, 'BDF-7');
    note(BOM_ROW.BESS_BATTERY_LINE, BOM_COL.UNIT_PRICE,
         '\u00a78 BESS pendiente. ' + bessReason);
  } else {
    // Map each BoS line code to its reserved BOM row.
    var bessRowByCode = {
      'BESS-01': BOM_ROW.BESS_BATTERY_LINE,
      'BESS-02': BOM_ROW.BESS_DC_CABLE,
      'BESS-03': BOM_ROW.BESS_DC_EGC,
      'BESS-04': BOM_ROW.BESS_AC_CABLE,
      'BESS-05': BOM_ROW.BESS_AC_EGC,
      'BESS-06': BOM_ROW.BESS_DC_CONDUIT,
      'BESS-07': BOM_ROW.BESS_AC_CONDUIT,
      'BESS-08': BOM_ROW.BESS_DC_OCPD,
      'BESS-09': BOM_ROW.BESS_AC_OCPD,
      'BESS-10': BOM_ROW.BESS_AC_DISCONNECT,
      'BESS-11': BOM_ROW.BESS_GEC_LINE,
      'BESS-12': BOM_ROW.BESS_COMMISSIONING
    };
    bessResult.bos.lines.forEach(function(bosLine) {
      var rowIdx = bessRowByCode[bosLine.code];
      if (!rowIdx) return;   // unknown code → skip silently

      w(rowIdx, BOM_COL.ITEM, itemNo++);
      w(rowIdx, BOM_COL.DESCRIPTION, bosLine.description);
      w(rowIdx, BOM_COL.QTY, bosLine.qty);
      w(rowIdx, BOM_COL.UNIT, bosLine.unit);
      w(rowIdx, BOM_COL.REFERENCE, bosLine.nomCite || bosLine.code);
      if (bosLine.detail) {
        bom.getRange(rowIdx, BOM_COL.DESCRIPTION).setNote(bosLine.detail);
      }

      // Price resolution by productCategory
      if (bosLine.productCategory === 'BESS_BATTERY' &&
          bosLine.productSpec && bosLine.productSpec.batteryId) {
        var priceInfo = rdBatteryPrice(bosLine.productSpec.batteryId);
        if (priceInfo && priceInfo.priceMxn > 0) {
          wp(rowIdx, priceInfo.priceMxn, null, { provenance: priceInfo.provenance });
          if (priceInfo.provenance === 'CAPEX_FALLBACK') {
            note(rowIdx, BOM_COL.UNIT_PRICE,
              'Precio derivado de Installed_CAPEX_MXN (fallback). ' +
              'Considere agregar columna BESS_price_per_unit en 16M_PRODUCTS_BESS ' +
              'para precio unitario real.');
          }
        } else {
          note(rowIdx, BOM_COL.UNIT_PRICE,
            'Precio bater\u00eda pendiente \u2014 agregar columna BESS_price_per_unit ' +
            'en 16M_PRODUCTS_BESS para Battery_ID ' + bosLine.productSpec.batteryId);
        }
      } else if (bosLine.productCategory === 'COMMISSIONING') {
        var commPrice = bosLine.productSpec ? bosLine.productSpec.flatPriceMxn : 0;
        if (commPrice > 0) wp(rowIdx, commPrice, null);
      } else if (bosLine.productCategory === 'CONDUCTORS' ||
                 bosLine.productCategory === 'CONDUIT' ||
                 bosLine.productCategory === 'DISTRIBUTION') {
        var priceObj = _bomV2_resolveBessBosPrice(bosLine, bosDb, ss,
          { readElecTablesFn: readElecTablesFn, selectConduitFn: selectConduitFn });
        if (priceObj && priceObj.price > 0) {
          if (priceObj.isUsd) { wp(rowIdx, null, priceObj.price); }
          else                { wp(rowIdx, priceObj.price, null); }
          if (priceObj.id) {
            w(rowIdx, BOM_COL.REFERENCE,
              (bosLine.nomCite || bosLine.code) + ' | ' + priceObj.id);
          }
          if (priceObj.note) {
            var existingNote = bosLine.detail ? bosLine.detail + '\n\n' : '';
            note(rowIdx, BOM_COL.UNIT_PRICE, existingNote + priceObj.note);
          }
        } else {
          var noteExisting = bosLine.detail ? bosLine.detail + '\n\n' : '';
          bom.getRange(rowIdx, BOM_COL.DESCRIPTION).setNote(
            noteExisting +
            'PRECIO: pendiente \u2014 sin SKU en 14M_PRODUCTS_BOS para ' +
            bosLine.productCategory + ' / spec ' +
            JSON.stringify(bosLine.productSpec || {}));
        }
      }
    });
  }
  ws(BOM_ROW.SUBTOTAL_BESS,
     BOM_ROW.BESS_BATTERY_LINE, BOM_ROW.SUBTOTAL_BESS - 1,
     'SUBTOTAL \u00a78 BESS');

  // ====================================================================
  // GRAND TOTAL
  // ====================================================================
  w(BOM_ROW.GRAND_TOTAL, BOM_COL.DESCRIPTION, 'TOTAL MATERIAL + SERVICIOS (USD)');
  bom.getRange(BOM_ROW.GRAND_TOTAL, BOM_COL.TOTAL_USD)
    .setFormula(
      '=F' + BOM_ROW.SUBTOTAL_PANELS + '+F' + BOM_ROW.SUBTOTAL_INVERTERS +
      '+F' + BOM_ROW.SUBTOTAL_STRUCTURE + '+F' + BOM_ROW.SUBTOTAL_DC +
      '+F' + BOM_ROW.SUBTOTAL_AC + '+F' + BOM_ROW.SUBTOTAL_TRANSFORMER +
      '+F' + BOM_ROW.SUBTOTAL_MONITORING + '+F' + BOM_ROW.SUBTOTAL_BESS
    )
    .setNumberFormat('#,##0.00');
  bom.getRange(BOM_ROW.GRAND_TOTAL, BOM_COL.TOTAL_MXN)
    .setFormula('=F' + BOM_ROW.GRAND_TOTAL + '*$F$' + BOM_ROW.EXCHANGE_RATE)
    .setNumberFormat('#,##0');

  SpreadsheetApp.flush();
  if (typeof engineLog === 'function') {
    engineLog(ss, 'WriteBomV2', 'OK',
      'BOM_v2 written | ' + dc.dcKwp.toFixed(1) + ' kWp | ' +
      invBank.length + ' inverter banks' +
      (hasBessLines ? ' | BESS: ' + bessResult.bos.lines.length + ' lines'
                    : ' | BESS: PV-only'));
  }
}


// =============================================================================
// _bomV2_resolveBessBosPrice — Chunk 4 (verbatim port of legacy _resolveBessBosPrice)
// =============================================================================
//   Routes a BESS BoS line to the right _bomV2_ price helper based on
//   productCategory:
//     CONDUCTORS side=DC|AC          -> _bomV2_conductorPriceObj
//     CONDUCTORS side=DC_EGC|AC_EGC|GEC -> _bomV2_groundPriceObj
//     CONDUIT                        -> _bomV2_conduitPriceObj (size via selectConduit)
//     DISTRIBUTION                   -> _bomV2_breakerPriceWithFallback,
//                                       isUsd recovered via _bomV2_breakerILinePriceObj
//
//   Returns {price, isUsd, id, note} or null.
// =============================================================================
function _bomV2_resolveBessBosPrice(bosLine, bosDb, ss, opts) {
  opts = opts || {};
  var readElecTablesFn = opts.readElecTablesFn || null;
  var selectConduitFn  = opts.selectConduitFn  || null;

  var spec = bosLine.productSpec || {};
  var cat  = bosLine.productCategory;

  if (cat === 'CONDUCTORS') {
    var awgRaw = String(spec.awg || '').trim();
    if (!awgRaw) return null;
    var awg = awgRaw.replace(/^AWG\s+/i, '');
    if (spec.side === 'DC' || spec.side === 'AC') {
      return _bomV2_conductorPriceObj(bosDb, awg);
    }
    if (spec.side === 'DC_EGC' || spec.side === 'AC_EGC' || spec.side === 'GEC') {
      return _bomV2_groundPriceObj(bosDb, awg);
    }
    return null;
  }

  if (cat === 'CONDUIT') {
    var ca = Number(spec.condCuAreaMm2)  || 0;
    var ia = Number(spec.condInsAreaMm2) || 0;
    var n  = Number(spec.condCount)      || 0;
    if (ia <= 0 || n <= 0) return null;
    var totalInsArea = ia * n;
    var tbls;
    try {
      tbls = readElecTablesFn ? readElecTablesFn(ss) : readElecTables(ss);
    } catch (e) {
      return null;
    }
    var sizeIn = selectConduitFn
      ? selectConduitFn(totalInsArea, 0.40, tbls)
      : selectConduit(totalInsArea, 0.40, tbls);
    return _bomV2_conduitPriceObj(bosDb, sizeIn);
  }

  if (cat === 'DISTRIBUTION') {
    var amps  = Number(spec.ratingA) || 0;
    var poles = Number(spec.poles)   || 1;
    if (amps <= 0) return null;
    var breakerResult = _bomV2_breakerPriceWithFallback(bosDb, amps, poles);
    if (!breakerResult || !breakerResult.price) return null;
    var exactObj = _bomV2_breakerILinePriceObj(bosDb, amps, poles);
    var isUsd = exactObj ? !!exactObj.isUsd : false;
    return {
      price: breakerResult.price,
      isUsd: isUsd,
      id   : breakerResult.id,
      note : breakerResult.note
    };
  }

  return null;
}
