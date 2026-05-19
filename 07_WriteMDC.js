// =============================================================================
// ARGIA ENGINE v7 -- File: 07_WriteMDC.gs
// Writes the complete Memoria de Calculo.
//
// COLUMN MAP (all 1-based):
//   B=2  LABEL       -- static, never overwritten by engine
//   C=3  VALUE       -- calculated result
//   D=4  UNIT        -- static
//   E=5  PROVENANCE  -- source tag: STANDARD | INPUT | DB | ASSUMPTION | AUTO-CALC
//   F=6  CITATION    -- NOM article or table reference
//   G=7  FORMULA     -- human-readable formula showing the logic used
//   H=8  STATUS      -- PASS / FAIL / REVIEW / INFO (new column, engine writes here)
//
// NOTE: The existing MDC sheet uses col E as source and col F as status.
// This rewrite ADDS column G (formula trace) and moves status to col H.
// Run diagSheets() first -- if MDC has old layout, engine still writes correctly
// because we address by column number not name.
// =============================================================================
// Column indices (Phase 2e, 2026-04-25)
// PROVENANCE column dropped. STATUS moved from col H to col E so audit
// reviewers see PASS/FAIL right next to the value instead of way at the right.
var MC = {
  LABEL      : 2,   // B
  VALUE      : 3,   // C
  UNIT       : 4,   // D
  STATUS     : 5,   // E  -- PASS/FAIL/REVIEW (moved from H to E)
  CITATION   : 6,   // F  -- NOM article / table
  FORMULA    : 7,   // G  -- formula trace
};
// PROVENANCE removed from layout but kept in row() signature for now so we
// don't break the function signature. The 4th argument is silently ignored.
var PROV = {
  STANDARD   : 'STANDARD',    // legacy tags — kept so existing call sites compile
  INPUT      : 'INPUT',       // (the values are no longer rendered to the sheet)
  DB         : 'DB',
  ASSUMPTION : 'ASSUMPTION',
  AUTO_CALC  : 'AUTO-CALC',
};
// Issuance status constants
var ISSUE = {
  PASS       : 'EMITTABLE',
  OBS        : 'EMITTABLE WITH OBSERVATIONS',
  BLOCKED    : 'NOT EMITTABLE',
};
// =============================================================================
// MAIN WRITE FUNCTION
// =============================================================================
function writeMDC(ss, inp, panel, invBank, dc, ac, lay, nom, bessResult) {
  var sh = ss.getSheetByName(SH.MDC);
  if (!sh) throw new Error('MDC sheet not found: ' + SH.MDC);
  // -- Clear engine-written columns only (C, E, F, G, H) in rows 2-120
  // ClearContent for engine-written cols. Starts at row 6 (not row 2) to
  // preserve the banner area (rows 2-3 = title/subtitle in col C, set by
  // setupMDCTemplate) and the column-header row (row 4) and emission-status
  // row (row 5, which the engine RE-writes anyway via the issuance block).
  // Wipes rows 6-120 across cols C/E/F/G so engine writes start clean.
  sh.getRange(6, MC.VALUE,    115, 1).clearContent();
  sh.getRange(6, MC.STATUS,   115, 1).clearContent();
  sh.getRange(6, MC.CITATION, 115, 1).clearContent();
  sh.getRange(6, MC.FORMULA,  115, 1).clearContent();
  // Also wipe row 5 (emission status) — engine rewrites this every run
  sh.getRange(5, MC.LABEL).clearContent();
  function pct(v, d) {
    if (v === null || v === undefined || isNaN(v)) return '--';
    return (v * 100).toFixed(d !== undefined ? d : 2) + '%';
  }
  function n(v, d) {
    if (v === null || v === undefined || isNaN(v)) return '--';
    return parseFloat(v).toFixed(d !== undefined ? d : 2);
  }
  // ---------------------------------------------------------------------
  // Normalize status strings into a unified visual format for col E:
  //   PASS / OK / EMITTABLE         → "✅ PASS — <descriptive text>"
  //   REVIEW / OBSERVATIONS / OBS   → "⚠ REVIEW — <text>"
  //   FAIL / BLOQUEADO              → "❌ FAIL — <text>"
  //
  // Different engine modules produce different status formats:
  //   [PASS], [OK], [PASS+OBS], "✅ PASS — ", "EMITTABLE WITH OBSERVATIONS",
  //   "[REVIEW] Verificar...", etc.
  //
  // This helper unifies all of them so col E renders consistently and the
  // conditional formatting (green/yellow/red) catches the canonical word.
  function normalizeStatus(raw) {
    if (raw === null || raw === undefined) return null;
    var s = String(raw).trim();
    if (!s) return null;

    // If already in canonical form, return as-is
    if (/^[✅⚠❌]/.test(s)) return s;

    // Detect category by scanning for keywords (order matters: check FAIL/REVIEW
    // before PASS so "PASS+OBS" hits REVIEW, not PASS)
    var category;
    if (/FAIL|BLOQUEADO/i.test(s))                                    category = 'FAIL';
    else if (/REVIEW|OBSERVATIONS|REVISAR|PASS\+OBS/i.test(s))        category = 'REVIEW';
    else if (/\[OK\]|^OK\b|PASS|EMITTABLE/i.test(s))                  category = 'PASS';
    else return s;  // unknown — leave alone, CF won't color it

    // Strip ALL bracketed status markers from the text
    var clean = s.replace(/\[(PASS|FAIL|REVIEW|OK|PASS\+OBS)\]/gi, '').trim();
    // Strip leading "EMITTABLE", "EMITTABLE WITH OBSERVATIONS" etc. so we
    // don't double-print the keyword
    clean = clean.replace(/^(EMITTABLE\s+WITH\s+OBSERVATIONS|EMITTABLE)\s*[—\-:]?\s*/i, '');
    // Strip leading separators
    clean = clean.replace(/^\s*[—\-:]+\s*/, '').trim();

    var icon  = category === 'FAIL'   ? '❌'
              : category === 'REVIEW' ? '⚠'
              :                         '✅';
    var label = category === 'REVIEW' && /OBSERVATIONS|PASS\+OBS/i.test(s)
              ? 'OBSERVATIONS' : category;

    return clean ? (icon + ' ' + label + ' — ' + clean) : (icon + ' ' + label);
  }

  // ---------------------------------------------------------------------
  // Strip inline status markers like [PASS], [FAIL], [REVIEW], [OK],
  // [PASS+OBS], or "✅ PASS — ", "✗ FAIL — " from the start/end of a value
  // string. Keeps the descriptive text. Used for rows where the value text
  // historically had the status baked in; we now write the status to col E
  // separately and want col C to hold just the descriptive value.
  function stripStatus(text) {
    if (text === null || text === undefined) return text;
    var s = String(text);
    // Strip leading "✅ PASS — " / "✗ FAIL — " / "[PASS] " / "[OK] " / "[REVIEW] " etc.
    s = s.replace(/^\s*(✅|✗|⚠)?\s*\[?(PASS|FAIL|REVIEW|OK|PASS\+OBS)\]?\s*[—\-:]?\s*/i, '');
    // Strip trailing " [PASS]" / " [FAIL]" / " [[PASS]]" etc.
    s = s.replace(/\s*\[?\[(PASS|FAIL|REVIEW|OK)\]\]?\s*$/i, '');
    // Strip inline " [PASS]" / " [FAIL]" markers anywhere (multi-line strings)
    s = s.replace(/\s*\[(PASS|FAIL|REVIEW|OK)\]/gi, '');
    return s.trim();
  }

  // Write a full MDC row: value | citation | formula | status
  // PROVENANCE col was dropped Phase 2e; the 3rd arg is silently ignored.
  // STATUS now goes to col E (was col H) for visual proximity to value.
  function row(r, value, provenance, citation, formula, status) {
    if (value !== null && value !== undefined) {
      // Strip inline [PASS]/[FAIL] markers from value text — those now go to col E
      sh.getRange(r, MC.VALUE).setValue(stripStatus(value));
    }
    // (provenance arg ignored — col removed)
    if (citation)
      sh.getRange(r, MC.CITATION).setValue(citation);
    if (formula)
      sh.getRange(r, MC.FORMULA).setValue(formula);
    if (status)
      sh.getRange(r, MC.STATUS).setValue(normalizeStatus(status));
  }
  // Short cell ref for INPUT fields (for provenance display)
  function cellRef(sheetName, cellAddr) {
    return sheetName + '!' + cellAddr;
  }
  // Engine / DB version stamp
  var engineVersion = 'ARGIA ENGINE v7';
  var issueDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  var panelVerified = panel['PANEL_VERIFIED_ON'] ? String(panel['PANEL_VERIFIED_ON']).substring(0,10) : 'N/A';
  // (invDatasheetRefs removed Phase 2e — was only used by the dropped F3 banner write)
  // ===========================================================================
  // COVER BLOCK (rows 2-4) -- version, freeze evidence, issuance
  // ===========================================================================
  // Determine overall issuance status
  var criticalFails = [
    !dc.dc01Pass, !dc.dc02Pass, !dc.str01Pass, !dc.str02Pass,
    dc.vdropDCFail,
  ].filter(Boolean).length;
  var majorFlags = [
    dc.vdropDCReview, !dc.ocpdDCPass,
  ].filter(Boolean).length;
  var issuanceStatus = criticalFails > 0 ? ISSUE.BLOCKED
                     : majorFlags > 0    ? ISSUE.OBS
                     :                     ISSUE.PASS;
  // Phase 2e: All banner-area engine writes dropped. The banner is now
  // logo + title + subtitle only (set by setupMDCTemplate). The audit info
  // that used to live here is duplicated more usefully elsewhere:
  //   - Engine version + emission date → footer timestamp (row 97)
  //   - Panel DB verified status        → §0 MODULE row (row 9)
  //   - Inverter datasheet refs         → §0 INVERTER row (row 10)
  //   - Designer / verified-by names    → not currently rendered (TODO)
  //   - Project revision                → not implemented (no rev workflow)
  // Doing this keeps the banner clean and removes the cluttered F2/F3 strings.
  // Row 4 -- ISSUANCE STATUS (big, coloured)
  // No merge -- MDC sheet has frozen columns which blocks cross-freeze merges
  var issCell = sh.getRange(MDC_ROW.EMISSION_STATUS, MC.LABEL);
  issCell.setValue('ESTADO DE EMISION: ' + issuanceStatus +
    (criticalFails > 0 ? '  |  ' + criticalFails + ' falla(s) critica(s) sin resolver' :
     majorFlags > 0    ? '  |  ' + majorFlags + ' observacion(es) -- revisar antes de entregar' :
     '  |  Todos los checks NOM aprobados'));

  // ===========================================================================
  // SECTION 0: GENERALES
  // ===========================================================================
  row(MDC_ROW.PROJECT, inp.projectName,
      PROV.INPUT, cellRef('INPUT_GENERAL','C5'), null, null);
  row(MDC_ROW.CLIENT, inp.clientName,
      PROV.INPUT, cellRef('INPUT_GENERAL','C6'), null, null);
  row(MDC_ROW.MODULE, panel['PANEL_MODEL'] + ' -- PROD_ID: ' + (panel['PROD_ID'] || '?'),
      PROV.DB,
      'Panel DB: ' + panel['PANEL_MODEL'],
      'Verificado: ' + panelVerified, null);
  var invSummary = invBank.map(function(i) { return i.qty + 'x' + i.model; }).join(' + ');
  var invDbRefs  = invBank.map(function(i) { return i.invId || i.model; }).join(', ');
  var invTopologies = invBank.map(function(i) { return i.model + ':' + i.topology; }).join(', ');
  row(MDC_ROW.INVERTER, invSummary,
      PROV.DB,
      'Inverter DB: ' + invDbRefs,
      'Fuente: 12M_PRODUCTS_INVERTERS  |  Topologias: ' + invTopologies +
      '  |  VALID_MDC_READY: ' + invBank.map(function(i){return i.mdcReady;}).join(','), null);
  row(MDC_ROW.QTY_MODULES, inp.panelQty,
      PROV.INPUT, inputLocation('panelQty'), null, null);
  row(MDC_ROW.QTY_INVERTERS, inp.totalInverters,
      PROV.INPUT, inputLocation('totalInverters'), null, null);
  row(MDC_ROW.MODS_PER_STRING, inp.modsPerString,
      PROV.INPUT, inputLocation('modsPerString'), null, null);
  var strPerInv = invBank.map(function(i) {
    return i.stringsAssigned + '/' + i.qty + ' (' + i.model + ')';
  }).join('; ');
  row(MDC_ROW.STRINGS_PER_INV, strPerInv,
      PROV.INPUT, inputLocation('inverterPrimaryStrings') + ' + invertersSecondary col F', null, null);
  row(MDC_ROW.DC_KW, n(dc.dcKwp, 2),
      PROV.AUTO_CALC, 'Auto-calculado',
      'DC_kWp = N_modulos x Wp / 1000 = ' + inp.panelQty + ' x ' + panel['PANEL_POWER_W'] + ' / 1000', null);
  row(MDC_ROW.AC_KW, n(dc.acKwTotal, 2),
      PROV.AUTO_CALC, 'Auto-calculado',
      'AC_kW = SUM(qty_inv x kW_inv) = ' + invBank.map(function(i){return i.qty+'x'+i.acKw+'kW';}).join('+'), null);
  row(MDC_ROW.DC_AC_RATIO, n(dc.dcAcRatio, 3),
      PROV.AUTO_CALC, 'NOM_DB: project_dc_ac_ratio',
      'Relacion = DC_kWp / AC_kW = ' + n(dc.dcKwp,2) + ' / ' + n(dc.acKwTotal,2),
      dc.dcAcRatioStatus);
  var voltages = invBank.map(function(i) { return i.voltage + 'V'; })
    .filter(function(v,i,a){return a.indexOf(v)===i;}).join(' / ');
  row(MDC_ROW.AC_VOLTAGE, voltages,
      PROV.DB, 'Inverter DB: INV_AC_VOLTAGE_NOMINAL_V',
      'Fuente: 12M_PRODUCTS_INVERTERS - INV_AC_VOLTAGE_NOMINAL_V (v3)', null);
  // ===========================================================================
  // SECTION 1.0: DC
  // CONSOLIDATION 2026-04-24: was 3 rows (Isc / Imax×1.25 / iDesign×1.25),
  // now 2 rows (Isc / I_DESIGN consolidating ×1.5625 directly).
  // ===========================================================================
  row(MDC_ROW.ISC, n(dc.isc, 2),
      PROV.DB,
      'Panel DB: ' + panel['PANEL_MODEL'],
      'Isc = ' + n(dc.isc,2) + ' A  |  Fuente: 11M_PRODUCTS_PANELS - PANEL_ISC_A', null);
  row(MDC_ROW.I_DESIGN, n(dc.iDesignPerStr, 2),
      PROV.STANDARD,
      'NOM 690-8(a)(1) + 690-8(b)(1)',
      'I_diseno = Isc x 1.25 x 1.25' +
        (dc.bifacial ? ' x ' + n(nom.bifacialFactor,2) + ' (bifacial)' : '') +
        ' = ' + n(dc.isc,2) + ' x ' + n(nom.currentFactor2,3) +
        (dc.bifacial ? ' x ' + n(nom.bifacialFactor,2) : '') +
        ' = ' + n(dc.iDesignPerStr,2) + ' A', null);
  row(MDC_ROW.FT_DC, n(dc.Ft_dc, 3),
      PROV.STANDARD,
      'NOM 310-15(b)(2) Tabla',
      'Ft a ' + n(dc.ambientDC,0) + 'C  |  T_max=' + inp.maxTemp + 'C + adder_azotea=' + dc.roofAdder + 'C (conductor sizing uses max temp)  |  ' +
      cellRef('15M_ELEC_TABLES','lookup'), null);
  row(MDC_ROW.FAG_DC, n(dc.Fag_dc, 2),
      PROV.STANDARD,
      'NOM 310-15(b)(3) Tabla',
      'Fag para ' + dc.totalDCCables + ' conductores en conduit  |  ' +
      cellRef('15M_ELEC_TABLES','lookup'), null);
  row(MDC_ROW.AMP_REQ_DC, n(dc.ampReqDC, 2),
      PROV.AUTO_CALC,
      'NOM 310-15',
      'I_req = I_diseno / (Ft x Fag) = ' + n(dc.iDesignPerStr,2) + ' / (' + n(dc.Ft_dc,3) + ' x ' + n(dc.Fag_dc,2) + ') = ' + n(dc.ampReqDC,2) + ' A', null);
  row(MDC_ROW.COND_DC, dc.conductorDC + ' AWG',
      PROV.AUTO_CALC,
      'Tabla ampacidades 15M',
      'Min calibre con ampacidad >= ' + n(dc.ampReqDC,2) + ' A  |  ' + dc.conductorDC + ' AWG -> ' +
      n(dc.ampReqDC,0) + ' A OK  |  ' + cellRef('15M_ELEC_TABLES','COPPER CONDUCTORS'), null);
  row(MDC_ROW.AREA_DC, n(dc.areaConDC, 2),
      PROV.DB,
      '15M_ELEC_TABLES',
      'Area Cu = ' + n(dc.areaConDC,2) + ' mm2 para ' + dc.conductorDC + ' AWG  |  ' +
      cellRef('15M_ELEC_TABLES','Cu area mm2'), null);
  var ocpdDCStatus = dc.ocpdDCPass ? '[PASS]' : '[REVIEW] Verificar max series fuse en datasheet';
  row(MDC_ROW.OCPD_DC, dc.ocpdDC + ' A',
      PROV.STANDARD,
      'NOM 690-9 / 66_NOM_OCPD',
      'OCPD >= I_diseno  |  Min requerido: ' + n(dc.iDesignPerStr,1) + ' A  |  Siguiente estandar: ' + dc.ocpdDC + ' A',
      null);
  row(MDC_ROW.EGC_DC, dc.egcDC,
      PROV.STANDARD,
      'NOM 250-122 / 65_NOM_GROUNDING',
      'EGC_DC segun OCPD=' + dc.ocpdDC + 'A  |  Tabla 250-122  |  ' + cellRef('15M_ELEC_TABLES','GROUND CONDUCTOR'), null);
  var vdropDCStatus = dc.vdropDCFail   ? '[FAIL] > ' + pct(nom.dcVdropHard) + ' hard max'
                    : dc.vdropDCReview ? '[REVIEW] > ' + pct(nom.dcVdropTarget) + ' objetivo'
                    :                    '[PASS]';
  row(MDC_ROW.VDROP_DC, pct(dc.vdropDC),
      PROV.AUTO_CALC,
      'ARGIA policy / NOM_DB: project_dc_voltage_drop',
      'Vdrop% = (2 x L x rho/A x I) / V_string' +
      ' = (2 x ' + n(dc.dcLength,0) + 'm x ' + n(nom.cuResistivity,4) + '/' + n(dc.areaConDC,2) + ' x ' + n(dc.iDesignPerStr,2) + ') / ' + n(dc.vString,1) +
      ' = ' + pct(dc.vdropDC) +
      '  |  Limite: ' + pct(nom.dcVdropTarget) + ' objetivo / ' + pct(nom.dcVdropHard) + ' max  |  L=' + inputLocation('distInverter') + '+' + inputLocation('stationCorridorM') + ' auto',
      null);
  row(MDC_ROW.CONDUIT_DC, dc.conduitDC + '"',
      PROV.AUTO_CALC,
      'NOM Ch9 Table 1 / 64_NOM_CONDUIT_FILL',
      'Fill=' + pct(nom.fillRatioOver2) + ' para >2 conductores  |  Area cables=' + n(dc.totalDCInsArea,1) + ' mm2  |  ' +
      'Conduit minimo: ' + dc.conduitDC + '"  |  ' + cellRef('15M_ELEC_TABLES','IMC CONDUIT FILL'), null);
  row(MDC_ROW.RESULT_DC, dc.resultDC,
      PROV.AUTO_CALC, null, null, dc.resultDC);
  // ===========================================================================
  // SECTION 1.1: STRING VOLTAGE VALIDATION
  // ===========================================================================
  row(MDC_ROW.VOC_COLD, n(dc.vocColdString, 1) + ' V',
      PROV.AUTO_CALC,
      'NOM 690-8(A) / 11M_PRODUCTS_PANELS',
      'Voc_cold = Voc x (1 + Tc x (Tmin - 25)) x N' +
      ' = ' + n(panel['PANEL_VOC_V'],2) + ' x (1 + ' + panel['PANEL_TEMP_PMAX'] + ' x (' + inp.minTemp + '-25)) x ' + inp.modsPerString +
      ' = ' + n(dc.vocColdString,1) + ' V' +
      '  |  Tmin=' + inputLocation('minTemp') + '  |  Tc=' + cellRef('Panel DB','PANEL_TEMP_PMAX'), null);
  row(MDC_ROW.VMP_HOT, n(dc.vmpHotString, 1) + ' V',
      PROV.AUTO_CALC,
      'NOM 690-8 MPPT / 67_NOM_LAYOUT_RULES',
      'Vmp_hot = Vmp x (1 + Tc x (T_avg + adder_azotea - 25)) x N' +
      ' = ' + n(panel['PANEL_VMP_V'],2) + ' x (1 + ' + panel['PANEL_TEMP_PMAX'] + ' x (' + (inp.avgTemp||inp.maxTemp) + '+' + dc.roofAdder + '-25)) x ' + inp.modsPerString +
      ' = ' + n(dc.vmpHotString,1) + ' V' +
      '  |  adder=' + dc.roofAdder + 'C desde 67_NOM_LAYOUT_RULES (clearance=' + inp.roofClearanceMm + 'mm)', null);
  row(MDC_ROW.MIN_MODS, dc.minMods,
      PROV.AUTO_CALC,
      'NOM 690-8 MPPT',
      'Min_mods = CEIL(MPPT_Vmin / Vmp_hot_por_modulo)' +
      ' = CEIL(' + n(invBank[0] ? invBank[0].mpptVmin : 0,0) + ' / ' + n(dc.vmpHotPerMod,2) + ')' +
      ' = ' + dc.minMods + '  |  Inversor ref: ' + (invBank[0] ? invBank[0].model : '?'), null);
  row(MDC_ROW.MAX_MODS, dc.maxMods,
      PROV.AUTO_CALC,
      'NOM 690-8(A)',
      'Max_mods = FLOOR(Vmax_DC / Voc_cold_por_modulo)' +
      ' = FLOOR(' + n(invBank[0] ? invBank[0].maxDcV : 0,0) + ' / ' + n(dc.vocColdPerMod,2) + ')' +
      ' = ' + dc.maxMods + '  |  Inversor ref: ' + (invBank[0] ? invBank[0].model : '?'), null);
  row(MDC_ROW.ACTUAL_MODS, inp.modsPerString,
      PROV.INPUT,
      inputLocation('modsPerString'), null, null);
  var windowDetail = dc.dc01Results.map(function(r) {
    return r.invModel + ': Voc_cold=' + n(r.vocCold,1) + 'V <= ' + r.maxDcV + 'V [' + (r.pass?'PASS':'FAIL') + ']';
  }).join('\n') + '\n' + dc.dc02Results.map(function(r) {
    return r.invModel + ': Vmp_hot=' + n(r.vmpHot,1) + 'V >= ' + r.mpptVmin + 'V [' + (r.pass?'PASS':'FAIL') + ']';
  }).join('\n');
  var windowStatus = (dc.dc01Pass && dc.dc02Pass) ? '[PASS]' : '[FAIL] Ver detalle en BOM seccion fallas';
  row(MDC_ROW.CHECK_WINDOW, windowDetail,
      PROV.AUTO_CALC, 'NOM 690-8(A)/(MPPT)',
      'DC-01: Voc_cold <= Vmax_inv para CADA tipo de inversor  |  DC-02: Vmp_hot >= MPPT_min para CADA tipo',
      windowStatus);
  var dcLimitDetail = dc.str02Results.map(function(r) {
    var line = r.invModel + ': ' + r.stringsAssigned + ' asig / ' + r.stringsAvailable +
      ' disp (' + r.totalDcInputs + ' inputs/inv x ' + r.qty + ' inv)' +
      ' | MPPT: ' + n(r.strPerMppt,2) + ' str/MPPT (max=' + r.mpptCapacity + ')' +
      ' [' + (r.pass?'PASS':'FAIL') + ']';
    if (r.unevenLoading) {
      line += '\n  >> CARGA DESIGUAL: ' + r.heavyMppts + ' MPPT x ' + r.strHigh + 'str + ' +
        r.lightMppts + ' MPPT x ' + r.strLow + 'str -- verificar cableado Helioscope';
    }
    return line;
  }).join('\n');
  var dcLimitStatus = dc.str02Pass ? '[PASS]' :
    (dc.str02Results.some(function(r){return r.mpptOverload;}) ? '[FAIL] Sobrecarga MPPT' : '[FAIL]');
  if (dc.str02Pass && dc.str02UnevenWarnings && dc.str02UnevenWarnings.length > 0) {
    dcLimitStatus = '[PASS+OBS] Carga desigual entre MPPTs -- ver detalle';
  }
  row(MDC_ROW.CHECK_DC_LIMIT, dcLimitDetail,
      PROV.AUTO_CALC, 'NOM 690-8 / STR-02',
      'STR-02: strings_asig <= MPPT_count x inputs/MPPT x qty_inv' +
      ' | totalDcInputs = MPPT_count x inputs_per_MPPT' +
      ' | loading = strings_asig / (MPPT_count x qty)',
      dcLimitStatus);
  // STR-03: MPPT operating current (row 41 -- add if not in sheet, write to col C/G)
  // We write to row 41 which may not have a label yet -- set it here
  sh.getRange(MDC_ROW.STR03_MPPT, MC.LABEL).setValue('Corriente MPPT de operacion (STR-03/DC-09)');
  var str03Detail = dc.str03Results.map(function(r) {
    if (r.skipped) return r.invModel + ': ' + r.note;
    return r.invModel + ': I_op=' + n(r.iDesignIntoMppt,1) + 'A <= ' + r.iOpLimit + 'A [' + (r.passOp?'PASS':'FAIL') + ']' +
      '  |  I_sc=' + n(r.iScIntoMppt,1) + 'A <= ' + r.iScLimit + 'A [' + (r.passSc?'PASS':'FAIL') + ']';
  }).join('\n');
  var str03Status = (dc.str03Pass && dc.dc09Pass) ? '[PASS]' : '[FAIL]';
  row(MDC_ROW.STR03_MPPT, str03Detail,
      PROV.AUTO_CALC,
      'NOM STR-03/DC-09: INV_MAX_OPERATING/SHORT_CIRCUIT_CURRENT_PER_MPPT_A',
      'STR-03: I_diseno_MPPT = Isc x bifFactor x strings/MPPT <= I_op_MPPT  |  ' +
      'DC-09: I_sc_MPPT = Isc x bifFactor x strings/MPPT <= I_sc_MPPT  |  ' +
      'strings/MPPT = stringsAsignados / (qty x mpptCount)  |  bifFactor=' + n(nom.bifacialFactor,2),
      str03Status);
  // ===========================================================================
  // SECTION 2.0: AC PER INVERTER
  // ===========================================================================
  var prim = ac.primary;
  var primInv = invBank.find(function(i) { return i.model === prim.model; }) || invBank[0];
  row(MDC_ROW.I_AC_NOM, n(prim.iNom, 2) + ' A',
      PROV.AUTO_CALC,
      'NOM 690-9(A) / IEC',
      'I_AC = P_AC / (sqrt(3) x V)  [3F] = ' + n(primInv.acKw*1000,0) + ' / (1.732 x ' + primInv.voltage + ') = ' + n(prim.iNom,2) + ' A' +
      '  |  Inversor primario: ' + prim.model + '  |  Fuente: 12M_PRODUCTS_INVERTERS', prim.status);
  row(MDC_ROW.OCPD_AC_INV, prim.ocpd + ' A',
      PROV.STANDARD,
      'NOM 690-9(A) / 66_NOM_OCPD',
      'OCPD_AC >= I_AC x 1.25 = ' + n(prim.iNom,2) + ' x ' + n(nom.currentFactor1,2) + ' = ' + n(prim.ocpdReq,1) + ' A  |  Siguiente estandar: ' + prim.ocpd + ' A',
      prim.ocpdPass ? '[PASS]' : '[FAIL]');
  row(MDC_ROW.FT_AC, n(prim.Ft_ac, 3),
      PROV.STANDARD,
      'NOM 310-15(b)(2) Tabla',
      'Ft a T_max=' + inp.maxTemp + 'C (conductor sizing uses max temp)  |  ' + cellRef('15M_ELEC_TABLES','TEMP FACTOR 90C'), null);
  row(MDC_ROW.FAG_AC, n(prim.Fag_ac, 2),
      PROV.STANDARD,
      'NOM 310-15(b)(3) Tabla',
      'Fag para conductores en conduit  |  ' + cellRef('15M_ELEC_TABLES','GROUPING FACTOR'), null);
  row(MDC_ROW.AMP_REQ_AC, n(prim.ampReqAC, 2),
      PROV.AUTO_CALC,
      'NOM 310-15',
      'I_req_AC = I_AC / (Ft x Fag) = ' + n(prim.iNom,2) + ' / (' + n(prim.Ft_ac,3) + ' x ' + n(prim.Fag_ac,2) + ') = ' + n(prim.ampReqAC,2) + ' A', null);
  row(MDC_ROW.COND_AC, prim.conductor + ' AWG',
      PROV.AUTO_CALC,
      '15M_ELEC_TABLES ampacidades',
      'Min calibre con ampacidad >= ' + n(prim.ampReqAC,2) + ' A  |  ' + prim.conductor + ' AWG seleccionado', null);
  row(MDC_ROW.AREA_AC, n(prim.cuAreaMm2, 2),
      PROV.DB,
      '15M_ELEC_TABLES',
      'Area Cu para ' + prim.conductor + ' AWG = ' + n(prim.cuAreaMm2,2) + ' mm2', null);
  row(MDC_ROW.EGC_AC, prim.egc,
      PROV.STANDARD,
      'NOM 250-122 / 65_NOM_GROUNDING',
      'EGC_AC segun OCPD=' + prim.ocpd + 'A  |  Tabla 250-122', null);
  var vdropACStatus = prim.vdropACPass ? '[PASS]' : '[REVIEW] > ' + pct(nom.acVdropTarget);
  row(MDC_ROW.VDROP_AC, pct(prim.vdropAC),
      PROV.AUTO_CALC,
      'ARGIA policy / NOM_DB: project_ac_voltage_drop',
      'Vdrop_AC% = (sqrt(3) x L x rho/A x I) / V  [3F]' +
      ' = (1.732 x ' + n(prim.acLenInv,0) + ' x ' + n(nom.cuResistivity,4) + '/' + n(prim.cuAreaMm2,2) + ' x ' + n(prim.iNom,2) + ') / ' + primInv.voltage +
      ' = ' + pct(prim.vdropAC) +
      '  |  L=' + n(prim.acLenInv,0) + 'm  |  Limite: ' + pct(nom.acVdropTarget),
      null);
  row(MDC_ROW.CONDUIT_AC, prim.conduit + '"',
      PROV.AUTO_CALC,
      'NOM Ch9 Table 1 / 64_NOM_CONDUIT_FILL',
      'Fill ' + pct(nom.fillRatioOver2) + '  |  Area total=' + n(prim.totalInsArea,1) + ' mm2  |  Conduit: ' + prim.conduit + '"', null);
  var acSummary = ac.perInverter.map(function(i) {
    return i.qty + 'x' + i.model + ': I=' + n(i.iNom,1) + 'A OCPD=' + i.ocpd + 'A ' + i.conductor + 'AWG ' + i.conduit + '" Vdrop=' + pct(i.vdropAC) + ' [' + i.status + ']';
  }).join('\n');
  row(MDC_ROW.RESULT_AC, acSummary, PROV.AUTO_CALC, null,
      'Resultado por CADA tipo de inversor -- ver BOM para detalle completo', null);
  // ===========================================================================
  // SECTION 3.0: MAIN FEEDER
  // ===========================================================================
  row(MDC_ROW.I_TOTAL_AC, n(ac.iTotalAC, 1) + ' A',
      PROV.AUTO_CALC,
      'NOM 215-2',
      'I_total = SUM(I_nom_inv x qty) = ' +
      invBank.map(function(i){
        var iNom = (i.phase===3) ? (i.acKw*1000)/(1.732*i.voltage) : (i.acKw*1000)/i.voltage;
        return n(iNom,1)+'x'+i.qty;
      }).join('+') + ' = ' + n(ac.iTotalAC,1) + ' A', null);
  row(MDC_ROW.MAIN_BREAKER, ac.mainBreaker + ' A',
      PROV.STANDARD,
      'NOM 215-2 / 66_NOM_OCPD',
      'Breaker_principal >= I_total x 1.25 = ' + n(ac.iTotalAC,1) + ' x ' + n(nom.currentFactor1,2) + ' = ' + n(ac.mainBreaker/nom.currentFactor1,1) + ' A  |  Estandar: ' + ac.mainBreaker + ' A', null);
  row(MDC_ROW.PARALLEL_RUNS, ac.parallelRuns,
      PROV.ASSUMPTION,
      'NOM_DB: max_parallel_run_amps=' + nom.maxParallelRunA + 'A',
      'Corridas = CEIL(I_total / I_max_por_corrida) = CEIL(' + n(ac.iTotalAC,1) + ' / ' + nom.maxParallelRunA + ') = ' + ac.parallelRuns, null);
  row(MDC_ROW.I_PER_RUN, n(ac.iPerRun, 1) + ' A',
      PROV.AUTO_CALC, null,
      'I_por_corrida = I_total / corridas = ' + n(ac.iTotalAC,1) + ' / ' + ac.parallelRuns + ' = ' + n(ac.iPerRun,1) + ' A', null);
  row(MDC_ROW.COND_MAIN, ac.condMain + ' AWG',
      PROV.AUTO_CALC,
      '15M_ELEC_TABLES ampacidades',
      'Req=' + n(ac.ampReqMain,2) + 'A  |  Ft=' + n(ac.Ft_main,3) + '  Fag=' + n(ac.Fag_main,2) +
      '  |  Req_c = ' + n(ac.iPerRun,1) + '/('+n(ac.Ft_main,3)+'x'+n(ac.Fag_main,2)+')=' + n(ac.ampReqMain,2) + 'A  |  ' + ac.condMain + ' AWG OK', null);
  row(MDC_ROW.AREA_MAIN, n(ac.areaConMain, 2),
      PROV.DB, '15M_ELEC_TABLES', 'Area Cu para ' + ac.condMain + ' AWG', null);
  row(MDC_ROW.EGC_MAIN, ac.egcMain,
      PROV.STANDARD,
      'NOM 250-122 / 65_NOM_GROUNDING',
      'EGC_principal segun breaker=' + ac.mainBreaker + 'A  |  Tabla 250-122', null);
  var vdropFdrStatus = ac.vdropFeederPass ? '[PASS]' : '[REVIEW]';
  row(MDC_ROW.VDROP_FEEDER, pct(ac.vdropFeeder),
      PROV.AUTO_CALC,
      'NOM_DB: project_ac_voltage_drop',
      'Vdrop_feeder% = (sqrt(3) x L x rho/A x I_corrida) / V' +
      ' = (1.732 x ' + n(ac.feederLen,0) + ' x ' + n(nom.cuResistivity,4) + '/' + n(ac.areaConMain,2) + ' x ' + n(ac.iPerRun,1) + ') / ' + ac.mainVoltage +
      ' = ' + pct(ac.vdropFeeder) +
      '  |  L=' + n(ac.feederLen,0) + 'm auto  |  Limite: ' + pct(nom.acVdropTarget),
      null);
  row(MDC_ROW.CONDUIT_MAIN, ac.conduitMain + '"',
      PROV.AUTO_CALC,
      'NOM Ch9 Table 1',
      'Fill ' + pct(nom.fillRatioOver2) + '  |  Area total=' + n(ac.totalInsMain,1) + ' mm2  |  Conduit: ' + ac.conduitMain + '"', null);
  // CONSOLIDATED 2026-04-24: rows 64 (apparent) + 65 (apparent×1.20) merged
  // into single row showing the design requirement (P/FP × 1.20). Original
  // 473.7 kVA intermediate value still visible inside the formula text.
  row(MDC_ROW.APPARENT_REQ, n(ac.apparentWith20pct, 1) + ' kVA',
      PROV.AUTO_CALC,
      'NOM Art.450 + NOM_DB: transformer_margin_pct=' + (nom.transformerMargin*100) + '%',
      'S_req = (P_AC / FP) x (1 + margen)' +
      ' = (' + n(dc.acKwTotal,2) + ' / ' + inp.powerFactor + ') x (1 + ' + nom.transformerMargin + ')' +
      ' = ' + n(ac.apparentPower,1) + ' x ' + (1 + nom.transformerMargin).toFixed(2) +
      ' = ' + n(ac.apparentWith20pct,1) + ' kVA' +
      '  |  FP=' + inputLocation('powerFactor'), null);
  row(MDC_ROW.TRANSFORMER, ac.transformer + ' kVA',
      PROV.AUTO_CALC,
      'Tabla transformadores 15M / BOS',
      'Transformador comercial >= ' + n(ac.apparentWith20pct,1) + ' kVA  |  Seleccionado: ' + ac.transformer + ' kVA',
      ac.transformerPass ? '[PASS]' : '[REVIEW]');
  row(MDC_ROW.RESULT_FEEDER, ac.resultFeeder, PROV.AUTO_CALC, null, null, ac.resultFeeder);
  // ===========================================================================
  // SECTION 4.0: ISSUANCE FLAGS
  // ===========================================================================
  var layoutFlag = (inp.panelQty > 0 && inp.modsPerString > 0 && inp.stringsTotal > 0)
    ? '[OK] Layout consistente: ' + inp.panelQty + ' mods / ' + inp.modsPerString + ' mods/str / ' + inp.stringsTotal + ' strings'
    : '[INCOMPLETO] Verificar INPUT_DESIGN';
  row(MDC_ROW.FLAG_LAYOUT, layoutFlag, PROV.INPUT, inputLocation('panelQty') + ', ' + inputLocation('modsPerString') + ', ' + inputLocation('totalInverters'), null, layoutFlag);
  var windowStatus2 = (dc.dc01Pass && dc.dc02Pass) ? '[OK] Ventana de string valida para todos los inversores'
    : '[FAIL] ' + dc.dc01Results.filter(function(r){return !r.pass;}).map(function(r){return r.invModel;}).join(', ') + ' -- ver detalle fila 39';
  row(MDC_ROW.FLAG_WINDOW, windowStatus2, PROV.AUTO_CALC, 'DC-01/DC-02', null, windowStatus2);
  var dcLimFlag = dc.str02Pass ? '[OK] Capacidad de strings OK para todos los inversores'
    : '[FAIL] Strings exceden capacidad -- ver fila 40';
  row(MDC_ROW.FLAG_DC_LIMIT, dcLimFlag, PROV.AUTO_CALC, 'STR-02', null, dcLimFlag);
  // Final issuance verdict (row 72 -- keep existing label)
  sh.getRange(MDC_ROW.FLAG_FINAL, MC.VALUE).setValue(issuanceStatus);
  sh.getRange(MDC_ROW.FLAG_FINAL, MC.FORMULA).setValue(
    criticalFails > 0
      ? 'BLOQUEADO: ' + criticalFails + ' falla(s) critica(s). Resolver antes de emitir.'
      : majorFlags > 0
      ? 'EMITIR CON OBSERVACIONES: ' + majorFlags + ' item(s) requieren justificacion de ingenieria.'
      : 'Todos los checks NOM aprobados. Listo para emision.'
  );
  sh.getRange(MDC_ROW.FLAG_FINAL, MC.STATUS).setValue(normalizeStatus(issuanceStatus));
  // ===========================================================================
  // SECTION 5.0: SUPUESTOS CLAVE
  // ===========================================================================
  row(MDC_ROW.TEMP_MIN, inp.minTemp + ' C',
      PROV.INPUT, inputLocation('minTemp'),
      'T_min_sitio: temperatura minima de diseno para calculo Voc_cold', null);
  row(MDC_ROW.TEMP_MAX, inp.maxTemp + ' C / avg ' + (inp.avgTemp||'?') + ' C',
      PROV.INPUT, inputLocation('maxTemp'),
      'T_max_ambiente: temperatura maxima para calculo Ft y Vmp_hot', null);
  row(MDC_ROW.ROOF_CLEARANCE, inp.roofClearanceMm + ' mm  [adder: +' + dc.roofAdder + 'C]',
      PROV.INPUT, inputLocation('roofClearanceMm'),
      'Separacion_azotea -> adder temperatura desde 67_NOM_LAYOUT_RULES  |  ' +
      'NOM_DB limite_bajo=' + nom.roofClearanceLow + 'mm', null);
  row(MDC_ROW.LEN_DC, n(dc.dcLength, 0) + ' m',
      PROV.AUTO_CALC, 'Auto-estimado',
      'L_DC = dist_inversor + corridor = ' + inp.distInverter + ' + ' + inp.stationCorridorM + ' m  |  ' +
      inputLocation('distInverter') + ' + ' + inputLocation('stationCorridorM') +
      '  [ACTUALIZAR si longitud real difiere]', null);
  row(MDC_ROW.LEN_AC, n(prim.acLenInv, 0) + ' m',
      PROV.AUTO_CALC, 'Auto-estimado',
      'L_AC = dist_inversor + dist_prot_AC = ' + inp.distInverter + ' + ' + inp.distAcProt + ' m  |  ' +
      inputLocation('distInverter') + ' + ' + inputLocation('distAcProt'), null);
  row(MDC_ROW.LEN_FEEDER, n(ac.feederLen, 0) + ' m',
      PROV.AUTO_CALC, 'Auto-estimado',
      'L_feeder = dist_prot + dist_red + extra = ' + inp.distAcProt + '+' + inp.distGrid + '+' + inp.feederExtraM + ' m  |  ' +
      inputLocation('distAcProt') + '+' + inputLocation('distGrid') + '+' + inputLocation('feederExtraM'), null);
  row(MDC_ROW.POWER_FACTOR, inp.powerFactor,
      PROV.INPUT, inputLocation('powerFactor'), null, null);
  // ===========================================================================
  // SECTION 5.5: CROSS-REFERENCE TO DRAWING SET (new -- for UVIE)
  // ===========================================================================
  // Write a new sub-section after row 82 (existing "criterio final" static row)
  sh.getRange(MDC_ROW.SEC55_HEADER, MC.LABEL).setValue('5.5 REFERENCIAS A PLANOS / DOCUMENTOS DE DISENO');
  var drawingRows = [
    [MDC_ROW.REF_UNIFILAR,     'Diagrama unifilar',         '(Adjuntar No. de plano)', PROV.INPUT, 'UVIE / PEC - requisito de entrega', 'El diagrama debe coincidir con la configuracion calculada en este MDC'],
    [MDC_ROW.REF_LAYOUT,       'Plano de layout / azotea',  '(Adjuntar No. de plano)', PROV.INPUT, 'UVIE / PEC',                       'Verificar area requerida vs disponible: ' + inp.areaRequired + 'm2 vs ' + inp.availableSpace + 'm2'],
    [MDC_ROW.REF_PROTECCIONES, 'Diagrama de protecciones',  '(Adjuntar No. de plano)', PROV.INPUT, 'UVIE / PEC',                       'Protecciones DC y AC deben coincidir con OCPD calculados en este MDC'],
    [MDC_ROW.REF_CEDULA,       'Cedula de equipos',         '(Adjuntar No. de plano)', PROV.INPUT, 'UVIE / PEC',                       'Verificar modelos y cantidades contra BOM generado en esta corrida'],
  ];
  drawingRows.forEach(function(dr) {
    sh.getRange(dr[0], MC.LABEL).setValue(dr[1]);
    sh.getRange(dr[0], MC.VALUE).setValue(dr[2]);
    sh.getRange(dr[0], MC.VALUE).setNote('Ingresar numero de plano o revision correspondiente');
    // Phase 2e: PROVENANCE column dropped; reference rows have no status.
    sh.getRange(dr[0], MC.CITATION).setValue(dr[4]);
    sh.getRange(dr[0], MC.FORMULA).setValue(dr[5]);
  });
  // ===========================================================================
  // SECTION 6.0: LAYOUT SCALING
  // ===========================================================================
  sh.getRange(MDC_ROW.SEC6_HEADER, MC.LABEL).setValue('6.0 LAYOUT / ESCALADO DE PLANTA');
  // Show the actual panelArea used by the engine (with annotation if the
  // fallback was triggered). Without this, the audit trail shows
  // "234 x 0 x 1.2 = 618" which looks like a multiplication error.
  var areaUsed   = inp.panelAreaM2 > 0 ? inp.panelAreaM2 : 2.2;
  var areaIsDef  = !(inp.panelAreaM2 > 0);
  var areaLabel  = areaIsDef ? (areaUsed + ' (default)') : ('' + areaUsed);
  var layRows = [
    [MDC_ROW.AREA_GROSS,      'Area bruta estimada del arreglo',  n(lay.grossArea,0) + ' m2',  PROV.AUTO_CALC, 'Area = N_mods x area_modulo x factor_pasillo = ' + inp.panelQty + ' x ' + areaLabel + ' x ' + inp.walkwayFactor],
    [MDC_ROW.ARRAY_W,         'Ancho equivalente del arreglo',    n(lay.arrayWidth,0) + ' m',  PROV.AUTO_CALC, 'De geometria: area / largo'],
    [MDC_ROW.ARRAY_L,         'Largo equivalente del arreglo',    n(lay.arrayLength,0) + ' m', PROV.AUTO_CALC, 'De geometria con pitch=' + inp.rowPitch + 'm y filas=' + (inp.layoutRows || '(auto)')],
    [MDC_ROW.CABLE_DC_TOTAL,  'Cable DC total escalado',          lay.bom.dcCableM + ' m',     PROV.AUTO_CALC, 'N_strings x 2cond x L_DC x factor_spare = ' + inp.stringsTotal + ' x 2 x ' + n(dc.dcLength,0) + ' x ' + inp.dcSpareFactor],
    [MDC_ROW.CABLE_AC_TOTAL,  'Cable AC total escalado',          lay.bom.mainFeederCableM + ' m (feeder)', PROV.AUTO_CALC, 'L_feeder x 3F x spare = ' + n(ac.feederLen,0) + ' x 3 x ' + inp.acSpareFactor],
    [MDC_ROW.STATUS_SCALING,  'Status scaling / area',            lay.statusScaling,           PROV.AUTO_CALC, 'Area_disp=' + inp.availableSpace + 'm2 vs Area_req=' + inp.areaRequired + 'm2'],
  ];
  layRows.forEach(function(lr) {
    sh.getRange(lr[0], MC.LABEL).setValue(lr[0] === MDC_ROW.AREA_GROSS ? lr[1] : sh.getRange(lr[0], MC.LABEL).getValue() || lr[1]);
    row(lr[0], lr[2], lr[3], 'ENGINE V7 / INPUT_DESIGN §04 GEOMETRÍA', lr[4],
        lr[0] === MDC_ROW.STATUS_SCALING ? lay.statusScaling : null);
  });
  // ===========================================================================
  // LEGEND ROW (below all content)
  // ===========================================================================
  var legendRow = MDC_ROW.LEGEND;
  sh.getRange(legendRow, MC.LABEL)
    .setValue('LEYENDA:  STANDARD=NOM/IEC/NEC  |  INPUT=usuario  |  DB=MASTER_DB  |  ASSUMPTION=supuesto ingenieria  |  AUTO-CALC=motor');
  // ===========================================================================
  // TIMESTAMP
  // ===========================================================================
  sh.getRange(MDC_ROW.TIMESTAMP, MC.FORMULA).setValue(
    'Calculado: ' + issueDate + '  |  ' + engineVersion +
    '  |  Panel DB verificado: ' + panelVerified +
    '  |  Revision proyecto: ' + (inp.projectRevision || '00')
  );
  // ===========================================================================
  // SECTION 7.0: BESS / ALMACENAMIENTO  (Increment 4b-3b)
  // ===========================================================================
  // Renders only when the project includes a battery. PV-only runs leave the
  // §7 band (rows 100-110) blank — the writer's clearContent at the top of
  // this function already wiped it, so nothing stale survives.
  //
  // Circuit sizing: calcBessCircuit needs a battery DC-bus voltage. INPUT_BESS
  // has no voltage cell yet, so bessResult.circuit.sizeable is false today and
  // the circuit-status row prints an honest "pendiente" line. The two per-run
  // rows (RUN1/RUN2) are left blank — reserved for when a voltage input lands
  // (Increment 4b-2.5) and the circuit actually sizes. No fabricated numbers.
  if (bessResult && bessResult.bessEnabled && bessResult.bess) {
    var b   = bessResult.bess;
    var cir = bessResult.circuit;   // may be null or { sizeable, reason, runs }

    sh.getRange(MDC_ROW.SEC7_HEADER, MC.LABEL)
      .setValue('7.0 ALMACENAMIENTO / BATERÍA (BESS)');

    row(MDC_ROW.BESS_MODEL, b.batteryId + '  /  ' + b.strategy,
        PROV.INPUT, 'INPUT_BESS',
        'Producto y estrategia de operación seleccionados', null);

    row(MDC_ROW.BESS_CAPACITY, n(b.capacityKwh, 0) + ' kWh',
        PROV.INPUT, 'INPUT_BESS',
        'Capacidad nominal de placa', null);

    row(MDC_ROW.BESS_POWER, n(b.powerKw, 0) + ' kW',
        PROV.INPUT, 'INPUT_BESS',
        'Potencia nominal de placa', null);

    row(MDC_ROW.BESS_USABLE, n(bessResult.usableCapacityKwh, 1) + ' kWh',
        PROV.AUTO_CALC, 'ENGINE V7 / runBessStep',
        'Usable = capacidad x (SoC_max - SoC_min) x (1 - degradación) '
        + 'x (1 - reserva) = ' + n(b.capacityKwh, 0) + ' x ('
        + pct(b.maxSocPct, 0) + ' - ' + pct(b.minSocPct, 0) + ') x (1 - '
        + pct(b.degradationPct, 1) + ') x (1 - '
        + pct(b.backupReservePct, 0) + ')', null);

    row(MDC_ROW.BESS_COUPLING, bessResult.coupling,
        PROV.INPUT, 'INPUT_DESIGN!C17',
        'Topología de acoplamiento de la batería', null);

    // Circuit sizing status — honest "pendiente" while voltage is absent.
    if (cir && cir.sizeable) {
      row(MDC_ROW.BESS_CIRC_STAT, 'Dimensionado',
          PROV.AUTO_CALC, 'NOM-001-SEDE / Art. 706',
          'Circuito de batería dimensionado — ver runs abajo',
          '✅ PASS — circuito BESS dimensionado');
    } else {
      var pend = (cir && cir.reason)
        ? cir.reason
        : 'voltaje de batería no especificado';
      row(MDC_ROW.BESS_CIRC_STAT,
          'Pendiente — ' + pend,
          PROV.AUTO_CALC, 'NOM-001-SEDE / Art. 706',
          'El dimensionamiento de conductores/OCPD/EGC de la batería '
          + 'requiere el voltaje del bus DC. Completar dato y re-ejecutar.',
          '⚠ REVIEW — dimensionamiento de circuito pendiente');
    }

    // Per-run rows: filled only when the circuit sizes. Reserved otherwise.
    if (cir && cir.sizeable && cir.runs && cir.runs.length > 0) {
      var rrows = [MDC_ROW.BESS_CIRC_RUN1, MDC_ROW.BESS_CIRC_RUN2];
      for (var ri = 0; ri < cir.runs.length && ri < rrows.length; ri++) {
        var rn = cir.runs[ri];
        row(rrows[ri],
            'Cond ' + rn.conductorSize + ' / OCPD ' + rn.ocpdA + ' A / EGC '
            + rn.egcSize,
            PROV.AUTO_CALC, 'NOM-001-SEDE / Art. 706',
            rn.name + ': I_diseño ' + n(rn.designCurrentA, 1) + ' A', null);
      }
    }

    row(MDC_ROW.BESS_BUSBAR, bessResult.busbarNote || '--',
        PROV.AUTO_CALC, 'NOM-001-SEDE / Art. 705.12',
        'Regla 120% de barra colectora — verificación manual contra el '
        + 'tablero del sitio', null);

    row(MDC_ROW.BESS_NOM_CITE,
        'NOM-001-SEDE Art. 706 (sistemas de almacenamiento de energía)',
        PROV.STANDARD, 'NOM-001-SEDE-2012',
        'Referencia normativa para sistemas de batería (BESS)', null);
  } else {
    // PV-only run: no battery. The writer's clearContent at the top wipes
    // cols C/E/F/G for rows 6-120, but NOT col B (LABEL). The §7 block above
    // writes ONE col-B cell directly: the SEC7_HEADER. (The data-row labels
    // come from the 02e template, like every other section, so we must not
    // touch them.) Clear only the header cell so a stale "7.0 ..." title
    // from a prior battery run does not persist on a PV-only MDC.
    sh.getRange(MDC_ROW.SEC7_HEADER, MC.LABEL).clearContent();
  }

  SpreadsheetApp.flush();
  engineLog(ss, 'WriteMDC', 'OK',
    'MDC escrito. Estado emision: ' + issuanceStatus +
    ' | Criticos: ' + criticalFails + ' | Mayores: ' + majorFlags);
}