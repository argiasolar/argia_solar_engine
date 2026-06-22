// =============================================================================
// ARGIA ENGINE v2 -- File: writers_v2/WriteMdcV2.gs
// -----------------------------------------------------------------------------
// CHUNK 1 — MDC_v2 data writer.
//
// CONTRACT
//   writeMdcV2(ss, inp, panel, invBank, dc, ac, lay, nom, bessResult)
//   - Assumes setupMdcTemplate(ss) has run and the MDC_v2 sheet exists with
//     labels, headers, and CF rules in place.
//   - Writes ONLY data values into cols C/E/F/G of the body rows.
//   - Idempotent at the data level: writing the same inputs twice yields the
//     same cells. The template is what gives architectural idempotency; this
//     writer just fills the values.
//
// PARITY WITH LEGACY
//   This writer mirrors 07_WriteMDC.js writeMDC() row-by-row. Every value,
//   citation, formula trace, and status string is meant to match legacy
//   on a CULLIGAN run to within the tolerances used by REG_CULLIGAN_BASELINE.
//
//   The only deliberate differences:
//     1. Target sheet is V2_SHEETS.MDC ('MDC_v2'), not SH.MDC ('MDC').
//     2. No clearContent() at the top — the v2 template's clear() already
//        wiped the sheet before this writer runs.
//     3. The §7 BESS labels live in the template (not here), unlike legacy
//        which wrote a label directly when bessEnabled.
//
// CALLED BY
//   runArgiaEngine() (Step 10-v2), wrapped in try/catch so a v2 bug never
//   breaks the legacy MDC.
//
// DEPENDENCIES
//   - V2_SHEETS.MDC          -- templates/TemplateRegistry.gs
//   - MDC_ROW, MC, PROV, ISSUE -- shared with legacy (MC defined in 07_WriteMDC.js)
//   - inputLocation()        -- 02d_InputIO.js
//   - normalizeStatus(), stripStatus() -- defined as local helpers below since
//     legacy declares them as closures inside writeMDC()
// =============================================================================


function writeMdcV2(ss, inp, panel, invBank, dc, ac, lay, nom, bessResult) {
  ss = ss || SpreadsheetApp.getActive();

  var sheetName = V2_SHEETS.MDC;
  var sh = ss.getSheetByName(sheetName);
  if (!sh) {
    throw new Error('writeMdcV2: ' + sheetName + ' sheet not found. '
                  + 'Call setupMdcTemplate(ss) first.');
  }

  // ---- Formatting helpers (mirror writeMDC) -------------------------------
  function pct(v, d) {
    if (v === null || v === undefined || isNaN(v)) return '--';
    return (v * 100).toFixed(d !== undefined ? d : 2) + '%';
  }
  function n(v, d) {
    if (v === null || v === undefined || isNaN(v)) return '--';
    return parseFloat(v).toFixed(d !== undefined ? d : 2);
  }

  // ---- Status normalization (mirrors writeMDC's normalizeStatus) ----------
  function normalizeStatusV2(raw) {
    if (raw === null || raw === undefined) return null;
    var s = String(raw).trim();
    if (!s) return null;
    if (/^[✅⚠❌\u2139]/.test(s)) return s;
    var category;
    if (/\[N\/A\]|NO APLICA|NOT APPLICABLE|\bN\/A\b/i.test(s))  category = 'NA';
    else if (/FAIL|BLOQUEADO/i.test(s))                         category = 'FAIL';
    else if (/REVIEW|OBSERVATIONS|REVISAR|PASS\+OBS/i.test(s))  category = 'REVIEW';
    else if (/\[OK\]|^OK\b|PASS|EMITTABLE/i.test(s))            category = 'PASS';
    else return s;
    var clean = s.replace(/\[(PASS|FAIL|REVIEW|OK|PASS\+OBS|N\/A)\]/gi, '').trim();
    clean = clean.replace(/^[—\-:\s]+/, '').trim();
    var prefix = category === 'PASS' ? '✅ PASS' :
                 category === 'REVIEW' ? '⚠ REVIEW' :
                 category === 'NA' ? '\u2139\uFE0F N/A' :
                 '❌ FAIL';
    return clean ? prefix + ' — ' + clean : prefix;
  }
  function stripStatusV2(s) {
    if (s === null || s === undefined) return s;
    s = String(s);
    s = s.replace(/\s*\[(PASS|FAIL|REVIEW|OK)\]/gi, '');
    return s.trim();
  }

  // ---- row() helper: writes value | citation | formula | status -----------
  function row(r, value, _provIgnored, citation, formula, status) {
    if (value !== null && value !== undefined) {
      sh.getRange(r, MC.VALUE).setValue(stripStatusV2(value));
    }
    if (citation) sh.getRange(r, MC.CITATION).setValue(citation);
    if (formula)  sh.getRange(r, MC.FORMULA).setValue(formula);
    if (status)   sh.getRange(r, MC.STATUS).setValue(normalizeStatusV2(status));
  }
  function cellRef(sheetName, cellAddr) { return sheetName + '!' + cellAddr; }

  // Engine / DB version stamp
  var engineVersion = 'ARGIA ENGINE v2 (MDC_v2)';
  var issueDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  var panelVerified = panel['PANEL_VERIFIED_ON']
    ? String(panel['PANEL_VERIFIED_ON']).substring(0,10)
    : 'N/A';

  // ---- Issuance status (same logic as legacy) -----------------------------
  var criticalFails = [
    !dc.dc01Pass, !dc.dc02Pass, !dc.str01Pass, !dc.str02Pass,
    dc.vdropDCFail
  ].filter(Boolean).length;
  var majorFlags = [
    dc.vdropDCReview, !dc.ocpdDCPass
  ].filter(Boolean).length;
  var issuanceStatus = criticalFails > 0 ? ISSUE.BLOCKED
                     : majorFlags > 0    ? ISSUE.OBS
                     :                     ISSUE.PASS;

  sh.getRange(MDC_ROW.EMISSION_STATUS, MC.LABEL).setValue(
    'ESTADO DE EMISION: ' + issuanceStatus +
    (criticalFails > 0 ? '  |  ' + criticalFails + ' falla(s) critica(s) sin resolver' :
     majorFlags > 0    ? '  |  ' + majorFlags + ' observacion(es) -- revisar antes de entregar' :
     '  |  Todos los checks NOM aprobados')
  );

  // ===========================================================================
  // SECTION 0: GENERALES
  // ===========================================================================
  // Bug B9 fix (3.7.8): citations previously hardcoded 'INPUT_GENERAL!C5/C6',
  // but INPUT_GENERAL was retired in v2.0.2+ — project/client now live on
  // INPUT_PROJECT. Use inputLocation() so citations follow INPUT_MAP, the
  // single source of truth for input cell coordinates.
  row(MDC_ROW.PROJECT, inp.projectName,
      PROV.INPUT, inputLocation('projectName'), null, null);
  row(MDC_ROW.CLIENT, inp.clientName,
      PROV.INPUT, inputLocation('clientName'), null, null);
  row(MDC_ROW.MODULE, panel['PANEL_MODEL'] + ' -- PROD_ID: ' + (panel['PROD_ID'] || '?'),
      PROV.DB,
      'Panel DB: ' + panel['PANEL_MODEL'],
      'Verificado: ' + panelVerified, null);
  var invSummary = invBank.map(function(i) { return i.qty + 'x' + i.model; }).join(' + ');
  var invDbRefs  = invBank.map(function(i) { return i.invId || i.model; }).join(', ');
  var invTopologies = invBank.map(function(i) { return i.model + ':' + i.topology; }).join(', ');
  row(MDC_ROW.INVERTER, invSummary,
      PROV.DB, 'Inverter DB: ' + invDbRefs,
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
  // ===========================================================================
  row(MDC_ROW.ISC, n(dc.isc, 2),
      PROV.DB, 'Panel DB: ' + panel['PANEL_MODEL'],
      'Isc = ' + n(dc.isc,2) + ' A  |  Fuente: 11M_PRODUCTS_PANELS - PANEL_ISC_A', null);
  row(MDC_ROW.I_DESIGN, n(dc.iDesignPerStr, 2),
      PROV.STANDARD, 'NOM 690-8(a)(1)+(b)(1) / FR-205-03',
      'Isc,corr = Isc x (1 + a_Isc x (Tmax-25)) = ' + n(dc.isc,2) + ' x (1 + ' +
        n((dc.iscCoeffMeta && dc.iscCoeffMeta.iscCoeff) || 0, 5) + ' x (' +
        n(dc.ambientDC,0) + '-25)) = ' + n(dc.iscCorr || dc.isc,3) + ' A  |  ' +
      'I_diseno = Isc,corr x 1.25 x 1.25' +
        (dc.bifacial ? ' x ' + n(nom.bifacialFactor,2) + ' (bifacial)' : '') +
        ' = ' + n(dc.iscCorr || dc.isc,3) + ' x ' + n(nom.currentFactor2,3) +
        (dc.bifacial ? ' x ' + n(nom.bifacialFactor,2) : '') +
        ' = ' + n(dc.iDesignPerStr,2) + ' A', null);
  row(MDC_ROW.FT_DC, n(dc.Ft_dc, 3),
      PROV.STANDARD, 'NOM 310-15(b)(2) Tabla',
      'Ft a ' + n(dc.ambientDC,0) + 'C  |  T_max=' + inp.maxTemp + 'C + adder_azotea=' + dc.roofAdder + 'C (conductor sizing uses max temp)  |  ' +
      cellRef('15M_ELEC_TABLES','lookup'), null);
  row(MDC_ROW.FAG_DC, n(dc.Fag_dc, 2),
      PROV.STANDARD, 'NOM 310-15(b)(3) Tabla',
      'Fag para ' + dc.totalDCCables + ' conductores en conduit  |  ' +
      cellRef('15M_ELEC_TABLES','lookup'), null);
  row(MDC_ROW.AMP_REQ_DC, n(dc.ampReqDC, 2),
      PROV.AUTO_CALC, 'NOM 310-15',
      'I_req = I_diseno / (Ft x Fag) = ' + n(dc.iDesignPerStr,2) + ' / (' + n(dc.Ft_dc,3) + ' x ' + n(dc.Fag_dc,2) + ') = ' + n(dc.ampReqDC,2) + ' A', null);
  row(MDC_ROW.COND_DC, dc.conductorDC + ' AWG',
      PROV.AUTO_CALC, 'Tabla ampacidades 15M',
      'Min calibre con ampacidad >= ' + n(dc.ampReqDC,2) + ' A  |  ' + dc.conductorDC + ' AWG -> ' +
      n(dc.ampReqDC,0) + ' A OK [gobernado por ' + (dc.condGovernedBy || 'AMPACITY') + ']  |  ' + cellRef('15M_ELEC_TABLES','COPPER CONDUCTORS'), null);
  row(MDC_ROW.AREA_DC, n(dc.areaConDC, 2),
      PROV.DB, '15M_ELEC_TABLES',
      'Area Cu = ' + n(dc.areaConDC,2) + ' mm2 para ' + dc.conductorDC + ' AWG  |  ' +
      cellRef('15M_ELEC_TABLES','Cu area mm2'), null);
  row(MDC_ROW.OCPD_DC, dc.ocpdDC + ' A',
      PROV.STANDARD, 'NOM 690-9 / 66_NOM_OCPD',
      'OCPD >= I_diseno  |  Min requerido: ' + n(dc.iDesignPerStr,1) + ' A  |  Siguiente estandar: ' + dc.ocpdDC + ' A',
      null);
  row(MDC_ROW.EGC_DC, dc.egcDC,
      PROV.STANDARD, 'NOM 250-122 / 65_NOM_GROUNDING',
      'EGC_DC segun OCPD=' + dc.ocpdDC + 'A  |  Tabla 250-122  |  ' + cellRef('15M_ELEC_TABLES','GROUND CONDUCTOR'), null);
  row(MDC_ROW.VDROP_DC, pct(dc.vdropDC),
      PROV.AUTO_CALC, 'ARGIA policy / NOM_DB: project_dc_voltage_drop',
      'Vdrop% = (L_cond x rho/A x I) / V_string' +
      ' = (' + n(dc.vdropLenM,1) + 'm x ' + n(nom.cuResistivity,4) + '/' + n(dc.areaConDC,2) + ' x ' + n(dc.iDesignPerStr,2) + ') / ' + n(dc.vString,1) +
      ' = ' + pct(dc.vdropDC) +
      '  |  Limite: ' + pct(nom.dcVdropTarget) + ' objetivo / ' + pct(nom.dcVdropHard) + ' max' +
      '  |  L_cond/string [' + dc.vdropBasis + ']' +
      (dc.vdropBasis === 'HELIOSCOPE-AVG'    ? ' = Helioscope ' + n(inp.dcStringWireM,0) + 'm / ' + inp.stringsTotal + ' strings (promedio -- capturar el tramo mas largo para peor caso)'
       : dc.vdropBasis === 'OVERRIDE-LONGEST' ? ' = 2 x ' + n(inp.longestStringRunM,0) + 'm (tramo mas largo, peor caso)'
       :                                        ' = 2 x ' + n(dc.dcLength,0) + 'm (estimacion geometrica)'),
      null);
  row(MDC_ROW.CONDUIT_DC, dc.conduitDC + '"',
      PROV.AUTO_CALC, 'NOM Ch9 Table 1 / 64_NOM_CONDUIT_FILL',
      'Fill=' + pct(nom.fillRatioOver2) + ' para >2 conductores  |  Area cables=' + n(dc.totalDCInsArea,1) + ' mm2  |  ' +
      'Conduit minimo: ' + dc.conduitDC + '"  |  ' + cellRef('15M_ELEC_TABLES','IMC CONDUIT FILL'), null);
  row(MDC_ROW.RESULT_DC, dc.resultDC, PROV.AUTO_CALC, null, null, dc.resultDC);

  // ===========================================================================
  // SECTION 1.1: STRING VOLTAGE VALIDATION
  // ===========================================================================
  row(MDC_ROW.VOC_COLD, n(dc.vocColdString, 1) + ' V',
      PROV.AUTO_CALC, 'NOM 690-7 / 11M_PRODUCTS_PANELS',
      'Voc_cold = Voc x (1 + Tc x (Tmin - 25)) x N' +
      ' = ' + n(panel['PANEL_VOC_V'],2) + ' x (1 + ' + panel['PANEL_TEMP_PMAX'] + ' x (' + inp.minTemp + '-25)) x ' + inp.modsPerString +
      ' = ' + n(dc.vocColdString,1) + ' V' +
      '  |  Tmin=' + inputLocation('minTemp') + '  |  Tc=' + cellRef('Panel DB','PANEL_TEMP_PMAX'), null);
  row(MDC_ROW.VMP_HOT, n(dc.vmpHotString, 1) + ' V',
      PROV.AUTO_CALC, 'NOM 690-8 MPPT / 67_NOM_LAYOUT_RULES',
      'Vmp_hot = Vmp x (1 + Tc x (T_avg + adder_azotea - 25)) x N' +
      ' = ' + n(panel['PANEL_VMP_V'],2) + ' x (1 + ' + panel['PANEL_TEMP_PMAX'] + ' x (' + (inp.avgTemp||inp.maxTemp) + '+' + dc.roofAdder + '-25)) x ' + inp.modsPerString +
      ' = ' + n(dc.vmpHotString,1) + ' V' +
      '  |  adder=' + dc.roofAdder + 'C desde 67_NOM_LAYOUT_RULES (clearance=' + inp.roofClearanceMm + 'mm)', null);
  row(MDC_ROW.MIN_MODS, dc.minMods,
      PROV.AUTO_CALC, 'NOM 690-8 MPPT',
      'Min_mods = CEIL(MPPT_Vmin / Vmp_hot_por_modulo)' +
      ' = CEIL(' + n(invBank[0] ? invBank[0].mpptVmin : 0,0) + ' / ' + n(dc.vmpHotPerMod,2) + ')' +
      ' = ' + dc.minMods + '  |  Inversor ref: ' + (invBank[0] ? invBank[0].model : '?'), null);
  row(MDC_ROW.MAX_MODS, dc.maxMods,
      PROV.AUTO_CALC, 'NOM 690-7',
      'Max_mods = FLOOR(Vmax_DC / Voc_cold_por_modulo)' +
      ' = FLOOR(' + n(invBank[0] ? invBank[0].maxDcV : 0,0) + ' / ' + n(dc.vocColdPerMod,2) + ')' +
      ' = ' + dc.maxMods + '  |  Inversor ref: ' + (invBank[0] ? invBank[0].model : '?'), null);
  row(MDC_ROW.ACTUAL_MODS, inp.modsPerString,
      PROV.INPUT, inputLocation('modsPerString'), null, null);
  // OPTIMIZER topology regulates string voltage at each module, so the raw
  // Voc_cold / Vmp_hot string-window check does not apply. 04_CalcDC already
  // marks every dc01/dc02 result skipped for inv.topology === 'OPTIMIZER';
  // gate the display exactly like the sibling CHECK_DC_LIMIT row so the MDC
  // shows N/A instead of a misleading "[PASS]" (or a Voc_cold that exceeds
  // Vmax yet prints PASS because skipped results carry pass:true). [B-3]
  var dc01Skipped = dc.dc01Results.length > 0 &&
    dc.dc01Results.every(function(r){ return r.skipped; });
  var dc02Skipped = dc.dc02Results.length > 0 &&
    dc.dc02Results.every(function(r){ return r.skipped; });
  var windowSkipped = dc01Skipped && dc02Skipped;
  var windowDetail = dc.dc01Results.map(function(r) {
    if (r.skipped) return r.invModel + ': ' + (r.note || 'N/A');
    return r.invModel + ': Voc_cold=' + n(r.vocCold,1) + 'V <= ' + r.maxDcV + 'V [' + (r.pass?'PASS':'FAIL') + ']';
  }).join('\n') + '\n' + dc.dc02Results.map(function(r) {
    if (r.skipped) return r.invModel + ': ' + (r.note || 'N/A');
    return r.invModel + ': Vmp_hot=' + n(r.vmpHot,1) + 'V >= ' + r.mpptVmin + 'V [' + (r.pass?'PASS':'FAIL') + ']';
  }).join('\n');
  var windowStatus = windowSkipped
      ? '[N/A] OPTIMIZER -- ventana Voc/Vmp regulada por optimizadores'
    : (dc.dc01Pass && dc.dc02Pass) ? '[PASS]'
    : '[FAIL] Ver detalle en BOM seccion fallas';
  row(MDC_ROW.CHECK_WINDOW, windowDetail,
      PROV.AUTO_CALC, 'NOM 690-7 / MPPT',
      'DC-01: Voc_cold <= Vmax_inv para CADA tipo de inversor  |  DC-02: Vmp_hot >= MPPT_min para CADA tipo',
      windowStatus);
  var dcLimitDetail = dc.str02Results.map(function(r) {
    if (r.skipped) return r.invModel + ': ' + r.note;
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
  var str02Skipped = dc.str02Results.length > 0 &&
    dc.str02Results.every(function(r){ return r.skipped; });
  var dcLimitStatus = str02Skipped
      ? '[N/A] OPTIMIZER -- conteo de entradas DC no aplica'
    : dc.str02Pass ? '[PASS]'
    : (dc.str02Results.some(function(r){return r.mpptOverload;}) ? '[FAIL] Sobrecarga MPPT' : '[FAIL]');
  if (!str02Skipped && dc.str02Pass && dc.str02UnevenWarnings && dc.str02UnevenWarnings.length > 0) {
    dcLimitStatus = '[PASS+OBS] Carga desigual entre MPPTs -- ver detalle';
  }
  row(MDC_ROW.CHECK_DC_LIMIT, dcLimitDetail,
      PROV.AUTO_CALC, 'NOM 690-8 / STR-02',
      'STR-02: strings_asig <= MPPT_count x inputs/MPPT x qty_inv' +
      ' | totalDcInputs = MPPT_count x inputs_per_MPPT' +
      ' | loading = strings_asig / (MPPT_count x qty)',
      dcLimitStatus);
  var str03Detail = dc.str03Results.map(function(r) {
    if (r.skipped) return r.invModel + ': ' + r.note;
    return r.invModel + ': I_op=' + n(r.iDesignIntoMppt,1) + 'A <= ' + r.iOpLimit + 'A [' + (r.passOp?'PASS':'FAIL') + ']' +
      '  |  I_sc=' + n(r.iScIntoMppt,1) + 'A <= ' + r.iScLimit + 'A [' + (r.passSc?'PASS':'FAIL') + ']';
  }).join('\n');
  var str03Skipped = dc.str03Results.length > 0 &&
    dc.str03Results.every(function(r){ return r.skipped; });
  var str03Status = str03Skipped
      ? '[N/A] OPTIMIZER -- verificacion de corriente MPPT no aplica'
    : (dc.str03Pass && dc.dc09Pass) ? '[PASS]' : '[FAIL]';
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
      PROV.AUTO_CALC, 'NOM 690-9(A) / IEC',
      'I_AC = P_AC / (sqrt(3) x V)  [3F] = ' + n(primInv.acKw*1000,0) + ' / (1.732 x ' + primInv.voltage + ') = ' + n(prim.iNom,2) + ' A' +
      '  |  Inversor primario: ' + prim.model + '  |  Fuente: 12M_PRODUCTS_INVERTERS', prim.status);
  row(MDC_ROW.OCPD_AC_INV, prim.ocpd + ' A',
      PROV.STANDARD, 'NOM 690-9(A) / 66_NOM_OCPD',
      'OCPD_AC >= I_AC x 1.25 = ' + n(prim.iNom,2) + ' x ' + n(nom.currentFactor1,2) + ' = ' + n(prim.ocpdReq,1) + ' A  |  Siguiente estandar: ' + prim.ocpd + ' A',
      prim.ocpdPass ? '[PASS]' : '[FAIL]');
  row(MDC_ROW.FT_AC, n(prim.Ft_ac, 3),
      PROV.STANDARD, 'NOM 310-15(b)(2) Tabla',
      'Ft a T_max=' + inp.maxTemp + 'C (conductor sizing uses max temp)  |  ' + cellRef('15M_ELEC_TABLES','TEMP FACTOR 90C'), null);
  row(MDC_ROW.FAG_AC, n(prim.Fag_ac, 2),
      PROV.STANDARD, 'NOM 310-15(b)(3) Tabla',
      'Fag para conductores en conduit  |  ' + cellRef('15M_ELEC_TABLES','GROUPING FACTOR'), null);
  row(MDC_ROW.AMP_REQ_AC, n(prim.ampReqAC, 2),
      PROV.AUTO_CALC, 'NOM 310-15',
      'I_req_AC = I_AC / (Ft x Fag) = ' + n(prim.iNom,2) + ' / (' + n(prim.Ft_ac,3) + ' x ' + n(prim.Fag_ac,2) + ') = ' + n(prim.ampReqAC,2) + ' A', null);
  row(MDC_ROW.COND_AC, prim.conductor + ' AWG',
      PROV.AUTO_CALC, '15M_ELEC_TABLES ampacidades',
      'Min calibre con ampacidad >= ' + n(prim.ampReqAC,2) + ' A  |  ' + prim.conductor + ' AWG seleccionado', null);
  row(MDC_ROW.AREA_AC, n(prim.cuAreaMm2, 2),
      PROV.DB, '15M_ELEC_TABLES',
      'Area Cu para ' + prim.conductor + ' AWG = ' + n(prim.cuAreaMm2,2) + ' mm2', null);
  row(MDC_ROW.EGC_AC, prim.egc,
      PROV.STANDARD, 'NOM 250-122 / 65_NOM_GROUNDING',
      'EGC_AC segun OCPD=' + prim.ocpd + 'A  |  Tabla 250-122', null);
  row(MDC_ROW.VDROP_AC, pct(prim.vdropAC),
      PROV.AUTO_CALC, 'ARGIA policy / NOM_DB: project_ac_voltage_drop',
      'Vdrop_AC% = (sqrt(3) x L x rho/A x I) / V  [3F]' +
      ' = (1.732 x ' + n(prim.acLenInv,0) + ' x ' + n(nom.cuResistivity,4) + '/' + n(prim.cuAreaMm2,2) + ' x ' + n(prim.iNom,2) + ') / ' + primInv.voltage +
      ' = ' + pct(prim.vdropAC) +
      '  |  L=' + n(prim.acLenInv,0) + 'm  |  Limite: ' + pct(nom.acVdropTarget),
      null);
  row(MDC_ROW.CONDUIT_AC, prim.conduit + '"',
      PROV.AUTO_CALC, 'NOM Ch9 Table 1 / 64_NOM_CONDUIT_FILL',
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
      PROV.AUTO_CALC, 'NOM 215-2',
      'I_total = SUM(I_nom_inv x qty) = ' +
      invBank.map(function(i){
        var iNom = (i.phase===3) ? (i.acKw*1000)/(1.732*i.voltage) : (i.acKw*1000)/i.voltage;
        return n(iNom,1)+'x'+i.qty;
      }).join('+') + ' = ' + n(ac.iTotalAC,1) + ' A', null);
  row(MDC_ROW.MAIN_BREAKER, ac.mainBreaker + ' A',
      PROV.STANDARD, 'NOM 215-2 / 66_NOM_OCPD',
      'Breaker_principal >= I_total x 1.25 = ' + n(ac.iTotalAC,1) + ' x ' + n(nom.currentFactor1,2) + ' = ' + n(ac.mainBreaker/nom.currentFactor1,1) + ' A  |  Estandar: ' + ac.mainBreaker + ' A', null);
  row(MDC_ROW.PARALLEL_RUNS, ac.parallelRuns,
      PROV.ASSUMPTION, 'NOM_DB: max_parallel_run_amps=' + nom.maxParallelRunA + 'A',
      'Corridas = CEIL(I_total / I_max_por_corrida) = CEIL(' + n(ac.iTotalAC,1) + ' / ' + nom.maxParallelRunA + ') = ' + ac.parallelRuns, null);
  row(MDC_ROW.I_PER_RUN, n(ac.iPerRun, 1) + ' A',
      PROV.AUTO_CALC, null,
      'I_por_corrida = I_total / corridas = ' + n(ac.iTotalAC,1) + ' / ' + ac.parallelRuns + ' = ' + n(ac.iPerRun,1) + ' A', null);
  row(MDC_ROW.COND_MAIN, ac.condMain + ' AWG',
      PROV.AUTO_CALC, '15M_ELEC_TABLES ampacidades',
      'Req=' + n(ac.ampReqMain,2) + 'A  |  Ft=' + n(ac.Ft_main,3) + '  Fag=' + n(ac.Fag_main,2) +
      '  |  Req_c = ' + n(ac.iPerRun,1) + '/('+n(ac.Ft_main,3)+'x'+n(ac.Fag_main,2)+')=' + n(ac.ampReqMain,2) + 'A  |  ' + ac.condMain + ' OK [gobernado por ' + (ac.condMainGovernedBy || 'AMPACITY') + ']', null);
  row(MDC_ROW.AREA_MAIN, n(ac.areaConMain, 2),
      PROV.DB, '15M_ELEC_TABLES', 'Area Cu para ' + ac.condMain + ' AWG', null);
  row(MDC_ROW.EGC_MAIN, ac.egcMain,
      PROV.STANDARD, 'NOM 250-122 / 65_NOM_GROUNDING',
      'EGC_principal segun breaker=' + ac.mainBreaker + 'A  |  Tabla 250-122', null);
  row(MDC_ROW.VDROP_FEEDER, pct(ac.vdropFeeder),
      PROV.AUTO_CALC, 'NOM_DB: project_ac_voltage_drop',
      'Vdrop_feeder% = (sqrt(3) x L x rho/A x I_corrida) / V' +
      ' = (1.732 x ' + n(ac.feederLen,0) + ' x ' + n(nom.cuResistivity,4) + '/' + n(ac.areaConMain,2) + ' x ' + n(ac.iPerRun,1) + ') / ' + ac.mainVoltage +
      ' = ' + pct(ac.vdropFeeder) +
      '  |  L=' + n(ac.feederLen,0) + 'm auto  |  Limite: ' + pct(nom.acVdropTarget),
      null);
  row(MDC_ROW.CONDUIT_MAIN, ac.conduitMain + '"',
      PROV.AUTO_CALC, 'NOM Ch9 Table 1',
      'Fill ' + pct(nom.fillRatioOver2) + '  |  Area total=' + n(ac.totalInsMain,1) + ' mm2  |  Conduit: ' + ac.conduitMain + '"', null);
  row(MDC_ROW.APPARENT_REQ, n(ac.apparentWith20pct, 1) + ' kVA',
      PROV.AUTO_CALC, 'NOM Art.450 + NOM_DB: transformer_margin_pct=' + (nom.transformerMargin*100) + '%',
      'S_req = (P_AC / FP) x (1 + margen)' +
      ' = (' + n(dc.acKwTotal,2) + ' / ' + inp.powerFactor + ') x (1 + ' + nom.transformerMargin + ')' +
      ' = ' + n(ac.apparentPower,1) + ' x ' + (1 + nom.transformerMargin).toFixed(2) +
      ' = ' + n(ac.apparentWith20pct,1) + ' kVA' +
      '  |  FP=' + inputLocation('powerFactor'), null);
  row(MDC_ROW.TRANSFORMER, ac.transformer + ' kVA',
      PROV.AUTO_CALC, 'Tabla transformadores 15M / BOS',
      'Transformador comercial >= ' + n(ac.apparentWith20pct,1) + ' kVA  |  Seleccionado: ' + ac.transformer + ' kVA',
      ac.transformerPass ? '[PASS]' : '[REVIEW]');
  row(MDC_ROW.RESULT_FEEDER, ac.resultFeeder, PROV.AUTO_CALC, null, null, ac.resultFeeder);

  // ===========================================================================
  // SECTION 4.0: ISSUANCE FLAGS
  // ===========================================================================
  var layoutFlag = (inp.panelQty > 0 && inp.modsPerString > 0 && inp.stringsTotal > 0)
    ? '[OK] Layout consistente: ' + inp.panelQty + ' mods / ' + inp.modsPerString + ' mods/str / ' + inp.stringsTotal + ' strings'
    : '[INCOMPLETO] Verificar INPUT_DESIGN';
  row(MDC_ROW.FLAG_LAYOUT, layoutFlag, PROV.INPUT,
      inputLocation('panelQty') + ', ' + inputLocation('modsPerString') + ', ' + inputLocation('totalInverters'),
      null, layoutFlag);
  var windowStatus2 = windowSkipped
    ? '[N/A] OPTIMIZER -- ventana de string regulada por optimizadores'
    : (dc.dc01Pass && dc.dc02Pass)
    ? '[OK] Ventana de string valida para todos los inversores'
    : '[FAIL] ' + dc.dc01Results.filter(function(r){return !r.pass;}).map(function(r){return r.invModel;}).join(', ') + ' -- ver detalle fila 39';
  row(MDC_ROW.FLAG_WINDOW, windowStatus2, PROV.AUTO_CALC, 'DC-01/DC-02', null, windowStatus2);
  var dcLimFlag = str02Skipped
    ? '[N/A] OPTIMIZER -- conteo de entradas DC no aplica'
    : dc.str02Pass
    ? '[OK] Capacidad de strings OK para todos los inversores'
    : '[FAIL] Strings exceden capacidad -- ver fila 40';
  row(MDC_ROW.FLAG_DC_LIMIT, dcLimFlag, PROV.AUTO_CALC, 'STR-02', null, dcLimFlag);
  sh.getRange(MDC_ROW.FLAG_FINAL, MC.VALUE).setValue(issuanceStatus);
  sh.getRange(MDC_ROW.FLAG_FINAL, MC.FORMULA).setValue(
    criticalFails > 0
      ? 'BLOQUEADO: ' + criticalFails + ' falla(s) critica(s). Resolver antes de emitir.'
      : majorFlags > 0
      ? 'EMITIR CON OBSERVACIONES: ' + majorFlags + ' item(s) requieren justificacion de ingenieria.'
      : 'Todos los checks NOM aprobados. Listo para emision.'
  );
  sh.getRange(MDC_ROW.FLAG_FINAL, MC.STATUS).setValue(normalizeStatusV2(issuanceStatus));

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
  // SECTION 5.5: CROSS-REFERENCE TO DRAWING SET
  // ===========================================================================
  var drawingRows = [
    [MDC_ROW.REF_UNIFILAR,     'Diagrama unifilar',         '(Adjuntar No. de plano)',
       'UVIE / PEC - requisito de entrega', 'El diagrama debe coincidir con la configuracion calculada en este MDC'],
    [MDC_ROW.REF_LAYOUT,       'Plano de layout / azotea',  '(Adjuntar No. de plano)',
       'UVIE / PEC', 'Verificar area requerida vs disponible: ' + inp.areaRequired + 'm2 vs ' + inp.availableSpace + 'm2'],
    [MDC_ROW.REF_PROTECCIONES, 'Diagrama de protecciones',  '(Adjuntar No. de plano)',
       'UVIE / PEC', 'Protecciones DC y AC deben coincidir con OCPD calculados en este MDC'],
    [MDC_ROW.REF_CEDULA,       'Cedula de equipos',         '(Adjuntar No. de plano)',
       'UVIE / PEC', 'Verificar modelos y cantidades contra BOM generado en esta corrida']
  ];
  drawingRows.forEach(function(dr) {
    sh.getRange(dr[0], MC.LABEL).setValue(dr[1]);
    sh.getRange(dr[0], MC.VALUE).setValue(dr[2]);
    sh.getRange(dr[0], MC.VALUE).setNote('Ingresar numero de plano o revision correspondiente');
    sh.getRange(dr[0], MC.CITATION).setValue(dr[3]);
    sh.getRange(dr[0], MC.FORMULA).setValue(dr[4]);
  });

  // ===========================================================================
  // SECTION 6.0: LAYOUT SCALING
  // ===========================================================================
  var areaUsed   = inp.panelAreaM2 > 0 ? inp.panelAreaM2 : 2.2;
  var areaIsDef  = !(inp.panelAreaM2 > 0);
  var areaLabel  = areaIsDef ? (areaUsed + ' (default)') : ('' + areaUsed);
  var layRows = [
    [MDC_ROW.AREA_GROSS,      'Area bruta estimada del arreglo',
       n(lay.grossArea,0) + ' m2',
       'Area = N_mods x area_modulo x factor_pasillo = ' + inp.panelQty + ' x ' + areaLabel + ' x ' + inp.walkwayFactor],
    [MDC_ROW.ARRAY_W,         'Ancho equivalente del arreglo',
       n(lay.arrayWidth,0) + ' m',  'De geometria: area / largo'],
    [MDC_ROW.ARRAY_L,         'Largo equivalente del arreglo',
       n(lay.arrayLength,0) + ' m', 'De geometria con pitch=' + inp.rowPitch + 'm y filas=' + (inp.layoutRows || '(auto)')],
    [MDC_ROW.CABLE_DC_TOTAL,  'Cable DC total' + (lay.bom.dcCableBasis === 'HELIOSCOPE' ? ' (Helioscope)' : ' (estimado)'),
       lay.bom.dcCableM + ' m',
       (lay.bom.dcCableBasis === 'HELIOSCOPE'
         ? 'Cableado real de Helioscope: ' + n(lay.dcWireSourceM,0) + ' m x merma ' + (lay.bom.dcCableM/Math.max(lay.dcWireSourceM,1)).toFixed(2)
         : 'ESTIMADO: N_strings x 2cond x L_DC x spare = ' + inp.stringsTotal + ' x 2 x ' + n(dc.dcLength,0) + ' x ' + inp.dcSpareFactor)],
    [MDC_ROW.CABLE_AC_TOTAL,  'Cable AC total escalado',
       lay.bom.mainFeederCableM + ' m (feeder)',
       'L_feeder x 3F x spare = ' + n(ac.feederLen,0) + ' x 3 x ' + inp.acSpareFactor],
    [MDC_ROW.STATUS_SCALING,  'Status scaling / area',
       lay.statusScaling,
       'Area_disp=' + inp.availableSpace + 'm2 vs Area_req=' + inp.areaRequired + 'm2']
  ];
  layRows.forEach(function(lr) {
    sh.getRange(lr[0], MC.LABEL).setValue(lr[1]);
    row(lr[0], lr[2], PROV.AUTO_CALC, 'ENGINE V2 / INPUT_DESIGN §04 GEOMETRÍA', lr[3],
        lr[0] === MDC_ROW.STATUS_SCALING ? lay.statusScaling : null);
  });

  // ===========================================================================
  // LEGEND ROW
  // ===========================================================================
  sh.getRange(MDC_ROW.LEGEND, MC.LABEL)
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
  // SECTION 7.0: BESS / ALMACENAMIENTO
  // ===========================================================================
  // Renders only when bessEnabled. PV-only runs leave §7 blank (template
  // already wrote the labels; this writer just doesn't fill values).
  if (bessResult && bessResult.bessEnabled && bessResult.bess) {
    var b   = bessResult.bess;
    var cir = bessResult.circuit;

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
        PROV.AUTO_CALC, 'ENGINE V2 / runBessStep',
        'Usable = capacidad x (SoC_max - SoC_min) x (1 - degradación) '
        + 'x (1 - reserva) = ' + n(b.capacityKwh, 0) + ' x ('
        + pct(b.maxSocPct, 0) + ' - ' + pct(b.minSocPct, 0) + ') x (1 - '
        + pct(b.degradationPct, 1) + ') x (1 - '
        + pct(b.backupReservePct, 0) + ')', null);
    row(MDC_ROW.BESS_COUPLING, bessResult.coupling,
        PROV.INPUT, 'INPUT_DESIGN!C17',
        'Topología de acoplamiento de la batería', null);

    if (cir && cir.sizeable) {
      row(MDC_ROW.BESS_CIRC_STAT, 'Dimensionado',
          PROV.AUTO_CALC, 'NOM-001-SEDE / Art. 706',
          'Circuito de batería dimensionado — ver runs abajo',
          '✅ PASS — circuito BESS dimensionado');
    } else {
      var pend = (cir && cir.reason) ? cir.reason : 'voltaje de batería no especificado';
      row(MDC_ROW.BESS_CIRC_STAT,
          'Pendiente — ' + pend,
          PROV.AUTO_CALC, 'NOM-001-SEDE / Art. 706',
          'El dimensionamiento de conductores/OCPD/EGC de la batería '
          + 'requiere el voltaje del bus DC. Completar dato y re-ejecutar.',
          '⚠ REVIEW — dimensionamiento de circuito pendiente');
    }

    if (cir && cir.sizeable && cir.runs && cir.runs.length > 0) {
      var rrows = [MDC_ROW.BESS_CIRC_RUN1, MDC_ROW.BESS_CIRC_RUN2];
      for (var ri = 0; ri < cir.runs.length && ri < rrows.length; ri++) {
        var rn = cir.runs[ri];
        row(rrows[ri],
            'Cond ' + rn.conductorSize + ' / OCPD ' + rn.ocpdA + ' A / EGC ' + rn.egcSize,
            PROV.AUTO_CALC, 'NOM-001-SEDE / Art. 706',
            rn.name + ': I_diseño ' + n(rn.designCurrentA, 1) + ' A', null);
      }
    }

    row(MDC_ROW.BESS_BUSBAR, bessResult.busbarNote || '--',
        PROV.AUTO_CALC, 'NOM-001-SEDE / Art. 705.12',
        'Regla 120% de barra colectora — verificación manual contra el tablero del sitio', null);
    row(MDC_ROW.BESS_NOM_CITE,
        'NOM-001-SEDE Art. 706 (sistemas de almacenamiento de energía)',
        PROV.STANDARD, 'NOM-001-SEDE-2012',
        'Referencia normativa para sistemas de batería (BESS)', null);
  }
  // PV-only: §7 labels are visible (from template) but value cells stay empty.

  SpreadsheetApp.flush();
  engineLog(ss, 'WriteMdcV2', 'OK',
    'MDC_v2 escrito. Estado emision: ' + issuanceStatus +
    ' | Criticos: ' + criticalFails + ' | Mayores: ' + majorFlags);
}
