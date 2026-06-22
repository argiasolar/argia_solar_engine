// =============================================================================
// ARGIA ENGINE v7 -- File: 04_CalcDC.gs
// DC-side NOM calculations. Updated for MASTER_DB v3.
//
// INVERTER FIELD USAGE (v3):
//   inv.maxDcV       (INV_DC_MAX_VOLTAGE_V)              -- DC-01 Voc cold limit
//   inv.mpptVmin     (INV_MPPT_VOLTAGE_MIN_V)            -- DC-02 Vmp hot lower limit
//   inv.mpptVmax     (INV_MPPT_VOLTAGE_MAX_V)            -- DC-02 Vmp hot upper limit
//   inv.totalDcInputs(INV_TOTAL_DC_INPUTS)               -- STR-02 capacity check
//   inv.inputsPerMppt(INV_MAX_INPUTS_PER_MPPT)           -- STR-01 window per MPPT
//   inv.iOpPerMppt   (INV_MAX_OPERATING_CURRENT_PER_MPPT_A) -- STR-03 operating I limit
//   inv.iScPerMppt   (INV_MAX_SHORT_CIRCUIT_CURRENT_PER_MPPT_A) -- DC-09 Isc limit
//   inv.iPerInput    (INV_MAX_INPUT_CURRENT_PER_INPUT_A) -- DC-11 per-input fuse
//   inv.topology     (INV_TOPOLOGY)                      -- skip MPPT checks for OPTIMIZER
// =============================================================================

/**
 * Resolve the temperature coefficients used for cold-Voc and hot-Vmp.
 *
 * Voc and Vmp have DIFFERENT temperature coefficients than Pmax, but the panel
 * DB historically only carried PANEL_TEMP_PMAX, which was applied to BOTH the
 * Voc-cold and Vmp-hot corrections (over-conservative, and wrong sign basis).
 *
 * Resolution order, per coefficient:
 *   1. Dedicated DB column (PANEL_TEMP_VOC / PANEL_TEMP_VMP) if present & nonzero
 *   2. User override (inp.tempCoeffOverride for Voc -- this is the existing
 *      'tempCoeffVocOverride' input, which previously only acted as a fallback)
 *   3. PANEL_TEMP_PMAX as a documented proxy (source flag = 'PMAX_PROXY')
 *
 * Pure helper -- unit-testable without a workbook.
 * @return {{vocCoeff:number, vmpCoeff:number, vocSource:string, vmpSource:string}}
 */
// FR-205-03 default Isc temperature coefficient (+0.05%/°C) used when the panel
// datasheet value (PANEL_TEMP_ISC) is absent. Positive: Isc rises with cell
// temperature. Datasheet-overridable; set at the conservative (high) end of the
// c-Si range so the conductor-sizing chain is not under-sized.
var AGS_ISC_TEMPCO_DEFAULT = 0.0005;

function resolveTempCoeffs(panel, inp) {
  panel = panel || {};
  inp   = inp   || {};
  var pmax = parseFloat(panel['PANEL_TEMP_PMAX']);
  var dbVoc= parseFloat(panel['PANEL_TEMP_VOC']);
  var dbVmp= parseFloat(panel['PANEL_TEMP_VMP']);
  var dbIsc= parseFloat(panel['PANEL_TEMP_ISC']);
  var ovr  = parseFloat(inp.tempCoeffOverride);
  var iscOvr = parseFloat(inp.iscCoeffOverride);
  var pmaxOk = !isNaN(pmax) && pmax !== 0;

  var vocCoeff, vocSource;
  if (!isNaN(dbVoc) && dbVoc !== 0)      { vocCoeff = dbVoc; vocSource = 'DB_VOC'; }
  else if (!isNaN(ovr) && ovr !== 0)     { vocCoeff = ovr;   vocSource = 'OVERRIDE'; }
  else if (pmaxOk)                       { vocCoeff = pmax;  vocSource = 'PMAX_PROXY'; }
  else                                   { vocCoeff = 0;     vocSource = 'NONE'; }

  var vmpCoeff, vmpSource;
  if (!isNaN(dbVmp) && dbVmp !== 0)      { vmpCoeff = dbVmp; vmpSource = 'DB_VMP'; }
  else if (pmaxOk)                       { vmpCoeff = pmax;  vmpSource = 'PMAX_PROXY'; }
  else                                   { vmpCoeff = 0;     vmpSource = 'NONE'; }

  // FR-205-03 Isc temperature coefficient (positive). Datasheet > override >
  // documented default. Unlike Voc/Vmp it never falls back to the Pmax proxy
  // (wrong sign and magnitude), so an absent datasheet value uses the default.
  var iscCoeff, iscSource;
  if (!isNaN(dbIsc) && dbIsc !== 0)         { iscCoeff = dbIsc;  iscSource = 'DB_ISC'; }
  else if (!isNaN(iscOvr) && iscOvr !== 0)  { iscCoeff = iscOvr; iscSource = 'OVERRIDE'; }
  else                                      { iscCoeff = AGS_ISC_TEMPCO_DEFAULT; iscSource = 'DEFAULT'; }

  return { vocCoeff: vocCoeff, vmpCoeff: vmpCoeff, iscCoeff: iscCoeff,
           vocSource: vocSource, vmpSource: vmpSource, iscSource: iscSource };
}

/**
 * DC voltage-drop conductor length per string (round-trip metres) + its basis.
 * Pure helper -- unit-testable without a workbook. Priority:
 *   1) longest string run (one-way manual worst case)      -> x2 (round trip)
 *   2) Helioscope average = total measured wire / strings   -> already round trip
 *   3) geometry estimate (legacy; uses roof-drop input)     -> x2 (round trip)
 * Sizing on the AVERAGE (case 2) is honest vs the old single array-to-inverter
 * distance applied to every string, but the worst string can be longer; capture
 * longestStringRunM for a code-correct worst-case.
 */
function dcVdropConductorLength(inp, dcLengthGeo) {
  if (inp.longestStringRunM > 0)
    return { lenM: 2 * inp.longestStringRunM, basis: 'OVERRIDE-LONGEST' };
  if (inp.dcStringWireM > 0 && inp.stringsTotal > 0)
    return { lenM: inp.dcStringWireM / inp.stringsTotal, basis: 'HELIOSCOPE-AVG' };
  return { lenM: 2 * (Number(dcLengthGeo) || 0), basis: 'ESTIMATE' };
}

function calcDC(inp, panel, invBank, nom, tbls) {
  var dc = {};

  // -- Panel base values ------------------------------------------------------
  var isc   = parseFloat(panel['PANEL_ISC_A'])    || 0;
  var voc   = parseFloat(panel['PANEL_VOC_V'])    || 0;
  var vmp   = parseFloat(panel['PANEL_VMP_V'])    || 0;
  var pwr   = parseFloat(panel['PANEL_POWER_W'])  || 0;
  var biface = String(panel['PANEL_BIFACIAL'] || '').toUpperCase() === 'YES';
  // Pass 4b: separate Voc / Vmp temperature coefficients (was: single Pmax
  // coeff applied to both). Falls back to the Pmax proxy when no dedicated
  // DB column / override exists, so behaviour is unchanged for panels that
  // only carry PANEL_TEMP_PMAX. Sources are stashed for the MDC to surface.
  var coeffs       = resolveTempCoeffs(panel, inp);
  var vocCoeff     = coeffs.vocCoeff;
  var vmpCoeff     = coeffs.vmpCoeff;
  dc.tempCoeffMeta = coeffs;   // {vocCoeff,vmpCoeff,vocSource,vmpSource} for MDC

  // -- Panel area + array geometry (Pass 1/2) ---------------------------------
  // Real module footprint from the DB (PANEL_LENGTH x PANEL_WIDTH; mm or m).
  // Stashed on dc as the single source of truth for area-derived BOM quantities
  // (calcLayout) and for the geometry-based run lengths below. Falls back to
  // 2.2 m2 (inside estimateArrayGeometry) when dimensions are absent.
  var _pl = parseFloat(panel['PANEL_LENGTH']);
  var _pw = parseFloat(panel['PANEL_WIDTH']);
  var _toM = function (v) { return v >= 10 ? v / 1000 : v; };
  var panelAreaM2 = (_pl > 0 && _pw > 0) ? (_toM(_pl) * _toM(_pw)) : 0;
  var geo = estimateArrayGeometry(inp, panelAreaM2);
  dc.panelAreaM2 = panelAreaM2;
  dc.grossArea   = geo.grossArea;
  dc.arrayLength = geo.arrayLength;
  dc.arrayWidth  = geo.arrayWidth;

  // -- Roof temperature adder (LAY-01) ---------------------------------------
  var roofAdder  = (inp.projectType === 'ROOF') ? getRoofTempAdder(inp.roofClearanceMm, tbls) : 0;
  // ambientDC uses MAX temp — for conductor ampacity (Ft) — NOM 310-15 conservative basis
  var ambientDC  = inp.maxTemp + roofAdder;
  // ambientAvg uses AVG temp — for Vmp hot / MPPT window — reflects typical operating conditions
  var ambientAvg = (inp.avgTemp || inp.maxTemp) + roofAdder;
  dc.roofAdder   = roofAdder;
  dc.ambientDC   = ambientDC;
  dc.ambientAvg  = ambientAvg;

  // -- AGS-205 / FR-205-03: temperature-correct Isc before the current factors -
  // Isc rises with temperature, so sizing the design current on STC Isc
  // understates it. Correct to the design MAX temperature (ambientDC — the same
  // basis as the conductor ampacity derate Ft), so the whole conductor-sizing
  // chain shares one temperature. STC Isc is retained as dc.iscStc for display.
  var iscCoeff    = coeffs.iscCoeff;
  var iscCorr     = isc * (1 + iscCoeff * (ambientDC - 25));
  dc.iscStc       = isc;
  dc.iscCorr      = iscCorr;
  dc.iscCoeffMeta = { iscCoeff: iscCoeff, iscSource: coeffs.iscSource, basisTempC: ambientDC };

  // -- DC-03: Design current -- factors from NOM_DB, on temperature-corrected Isc
  var bifFactor   = biface ? nom.bifacialFactor : 1.0;
  var isc125      = iscCorr * nom.currentFactor1;              // NOM 690.8(a) on Isc,corr (FR-205-03/04)
  var iDesignBase = iscCorr * nom.currentFactor2;             // NOM 690.8(b) on Isc,corr
  var iDesignStr  = iDesignBase * bifFactor;                   // per string / per input
  var iDesignTotal= iDesignStr * inp.parallelStrings;          // for parallel inputs

  dc.isc           = isc;     // STC Isc retained for back-compat / display
  dc.isc125        = isc125;
  dc.iDesignPerStr = iDesignStr;
  dc.iDesign       = iDesignTotal;
  dc.bifacial      = biface;
  dc.bifFactor     = bifFactor;

  // -- DC-05: Conductor ampacity ----------------------------------------------
  var Ft_dc  = getTempFactor(ambientDC, tbls);
  var dcConductorCount = Math.min(inp.parallelStrings * 2, 6);
  var Fag_dc = getGroupingFactor(dcConductorCount, tbls);
  var ampReqDC = dc.iDesignPerStr / (Ft_dc * Fag_dc);
  // DC-07 inputs up-front so the string conductor is sized for vdrop, not only ampacity.
  var vString  = vmp * inp.modsPerString;
  var dcLength = estimateDcRunM(inp, geo);          // geometry run -> BOM conduit + fallback
  var _vd      = dcVdropConductorLength(inp, dcLength);
  var condDC   = selectConductorForVdrop(ampReqDC,
      { k: 1, lengthM: _vd.lenM, rho: nom.cuResistivity,
        iA: dc.iDesignPerStr, voltageV: vString, limitFrac: nom.dcVdropTarget }, tbls);

  dc.Ft_dc       = Ft_dc;
  dc.Fag_dc      = Fag_dc;
  dc.ampReqDC    = ampReqDC;
  dc.conductorDC = condDC.size;
  dc.areaConDC   = condDC.cuAreaMm2;
  dc.insAreaDC   = condDC.insAreaMm2;
  dc.condGovernedBy = condDC.governedBy;

  // -- DC-04: OCPD per string -------------------------------------------------
  var ocpdDC = nextBreaker(dc.iDesignPerStr, tbls);
  dc.ocpdDC  = ocpdDC;

  // -- DC-11: Module fuse coordination ---------------------------------------
  var moduleMaxFuse = toNum(panel['PANEL_MAX_SERIES_FUSE_A']) || 20;
  dc.ocpdDCPass    = ocpdDC <= moduleMaxFuse;
  dc.moduleMaxFuse = moduleMaxFuse;

  // -- DC-06: EGC DC ---------------------------------------------------------
  var egcDC    = getEgcSize(ocpdDC, tbls);
  dc.egcDC     = egcDC.egcSize;
  dc.egcDCArea = egcDC.cuAreaMm2;

  // -- DC-07: Voltage drop (string conductor already sized for it in DC-05) ----
  var RperM_dc = nom.cuResistivity / condDC.cuAreaMm2;
  var vdropDC  = condDC.vdrop;

  dc.RperM_dc    = RperM_dc;
  dc.vString     = vString;
  dc.dcLength    = dcLength;        // geometry run -> BOM conduit + fallback
  dc.vdropLenM   = _vd.lenM;        // round-trip conductor length used for vdrop
  dc.vdropBasis  = _vd.basis;       // OVERRIDE-LONGEST | HELIOSCOPE-AVG | ESTIMATE
  dc.vdropDC     = vdropDC;
  dc.vdropDCPct  = vdropDC * 100;
  dc.vdropDCPass   = vdropDC <= nom.dcVdropTarget;
  dc.vdropDCReview = vdropDC > nom.dcVdropTarget && vdropDC <= nom.dcVdropWarn;
  dc.vdropDCFail   = vdropDC > nom.dcVdropHard;

  // -- DC-08: Conduit fill ----------------------------------------------------
  var totalDCCables  = inp.parallelStrings * 2 + 1;
  var totalDCInsArea = (condDC.insAreaMm2 * inp.parallelStrings * 2) + egcDC.cuAreaMm2;
  dc.conduitDC      = selectConduit(totalDCInsArea, nom.fillRatioOver2, tbls);
  dc.totalDCCables  = totalDCCables;
  dc.totalDCInsArea = totalDCInsArea;

  // -- DC-01: Voc cold check per inverter type --------------------------------
  var vocColdPerMod = voc * (1 + vocCoeff * (inp.minTemp - 25));
  var vocColdString = vocColdPerMod * inp.modsPerString;
  dc.vocColdPerMod  = vocColdPerMod;
  dc.vocColdString  = vocColdString;

  dc.dc01Results = invBank.map(function(inv) {
    // OPTIMIZER topology: skip standard Voc check, flag for manual review
    if (inv.topology === 'OPTIMIZER') {
      return { invModel: inv.model, vocCold: vocColdString, maxDcV: inv.maxDcV,
               pass: true, skipped: true, note: 'OPTIMIZER topology -- standard Voc check N/A',
               rule: 'DC-01', article: '690.8(A)' };
    }
    var pass = vocColdString <= inv.maxDcV;
    return { invModel: inv.model, vocCold: vocColdString, maxDcV: inv.maxDcV,
             pass: pass, margin: inv.maxDcV - vocColdString,
             rule: 'DC-01', article: '690.8(A)' };
  });
  dc.dc01Pass = dc.dc01Results.every(function(r) { return r.pass; });

  // -- DC-02: Vmp hot check per inverter type ---------------------------------
  // Uses average ambient + roof adder (not max) for realistic MPPT window sizing
  var hotTemp      = ambientAvg;
  var vmpHotPerMod = vmp * (1 + vmpCoeff * (hotTemp - 25));
  var vmpHotString = vmpHotPerMod * inp.modsPerString;
  dc.vmpHotPerMod  = vmpHotPerMod;
  dc.vmpHotString  = vmpHotString;

  dc.dc02Results = invBank.map(function(inv) {
    if (inv.topology === 'OPTIMIZER') {
      return { invModel: inv.model, vmpHot: vmpHotString,
               mpptVmin: inv.mpptVmin, mpptVmax: inv.mpptVmax,
               pass: true, skipped: true, note: 'OPTIMIZER topology -- standard Vmp check N/A',
               rule: 'DC-02', article: '690.8/MPPT' };
    }
    var passMin = vmpHotString >= inv.mpptVmin;
    var passMax = vmpHotString <= inv.mpptVmax;
    return { invModel: inv.model, vmpHot: vmpHotString,
             mpptVmin: inv.mpptVmin, mpptVmax: inv.mpptVmax,
             pass: passMin && passMax, passMin: passMin, passMax: passMax,
             rule: 'DC-02', article: '690.8/MPPT' };
  });
  dc.dc02Pass = dc.dc02Results.every(function(r) { return r.pass; });

  // -- STR-01: Modules per string window (per inverter type) ------------------
  dc.str01Results = invBank.map(function(inv) {
    if (inv.topology === 'OPTIMIZER') {
      return { invModel: inv.model, minMods: 0, maxMods: 999,
               actualMods: inp.modsPerString, pass: true, skipped: true,
               note: 'OPTIMIZER topology -- string window N/A', rule: 'STR-01' };
    }
    var minMods = Math.ceil(inv.mpptVmin / vmpHotPerMod);
    var maxMods = Math.floor(inv.maxDcV   / vocColdPerMod);
    var pass    = inp.modsPerString >= minMods && inp.modsPerString <= maxMods;
    return { invModel: inv.model, minMods: minMods, maxMods: maxMods,
             actualMods: inp.modsPerString, pass: pass, rule: 'STR-01' };
  });
  dc.str01Pass = dc.str01Results.every(function(r) { return r.pass; });
  dc.minMods   = dc.str01Results[0] ? dc.str01Results[0].minMods : 0;
  dc.maxMods   = dc.str01Results[0] ? dc.str01Results[0].maxMods : 0;

  // -- STR-02: Total DC input capacity + MPPT-level loading check ----------
  // Primary check : strings_assigned <= totalDcInputs * qty
  //   totalDcInputs = MPPT_count x inputs_per_MPPT (e.g. 7 x 3 = 21 for SUN2000-150K-MG0)
  // Secondary check: strings_per_MPPT <= inputs_per_MPPT  (MAJOR warning if uneven)
  dc.str02Results = invBank.map(function(inv) {
    if (inv.topology === 'OPTIMIZER') {
      // Optimizer topology parallels multiple strings per DC input, so the
      // "strings <= DC inputs" rule does not apply (mirrors 09_Validate.js and
      // the STR-01/STR-03 skips). Mark N/A so it neither fails nor drags the
      // overall DC result down.
      return { invModel: inv.model, stringsAssigned: inv.stringsAssigned,
               stringsAvailable: 0, totalDcInputs: inv.totalDcInputs,
               totalMppts: 0, mpptOverload: false, unevenLoading: false,
               pass: true, skipped: true, rule: 'STR-02',
               note: 'OPTIMIZER topology -- conteo de entradas DC N/A' };
    }
    var totalInputs  = inv.totalDcInputs * inv.qty;           // e.g. 21 x 3 = 63
    var totalMppts   = inv.mpptCount     * inv.qty;           // e.g.  7 x 3 = 21
    var pass         = inv.stringsAssigned <= totalInputs;

    // MPPT loading: average strings per MPPT tracker
    var strPerMppt   = totalMppts > 0 ? inv.stringsAssigned / totalMppts : 0;
    var mpptCapacity = inv.inputsPerMppt;                     // e.g. 3 inputs/MPPT
    var mpptOverload = strPerMppt > mpptCapacity;             // CRITICAL if avg > capacity

    // Uneven loading: remainder strings that can't distribute perfectly
    var strRemainder    = totalMppts > 0 ? inv.stringsAssigned % totalMppts : 0;
    var unevenLoading   = strRemainder !== 0;                 // MAJOR warning
    var heavyMppts      = strRemainder;                       // MPPTs carrying ceil(avg)
    var lightMppts      = totalMppts - strRemainder;          // MPPTs carrying floor(avg)
    var strHigh         = Math.ceil(strPerMppt);
    var strLow          = Math.floor(strPerMppt);

    return {
      invModel        : inv.model,
      stringsAssigned : inv.stringsAssigned,
      stringsAvailable: totalInputs,
      totalDcInputs   : inv.totalDcInputs,
      totalMppts      : totalMppts,
      mpptCapacity    : mpptCapacity,
      strPerMppt      : strPerMppt,
      mpptOverload    : mpptOverload,
      unevenLoading   : unevenLoading,
      heavyMppts      : heavyMppts,
      lightMppts      : lightMppts,
      strHigh         : strHigh,
      strLow          : strLow,
      qty             : inv.qty,
      pass            : pass && !mpptOverload,
      rule            : 'STR-02',
    };
  });
  dc.str02Pass = dc.str02Results.every(function(r) { return r.pass; });

  // Collect MPPT uneven-loading warnings (MAJOR, not CRITICAL)
  dc.str02UnevenWarnings = dc.str02Results.filter(function(r) {
    return r.unevenLoading && !r.mpptOverload && r.pass;
  });

  // -- STR-03: MPPT operating current check (v3 new: iOpPerMppt) -------------
  // Strings per MPPT = stringsAssigned / (qty * mpptCount)
  // Required: Isc * bifFactor * stringsPerMppt <= iOpPerMppt
  dc.str03Results = invBank.map(function(inv) {
    if (inv.topology === 'OPTIMIZER') {
      // N/A for optimizer topology. Set passOp/passSc so the DC-09 derivation
      // below (which reads r.passSc) also resolves to pass, not undefined.
      return { invModel: inv.model, pass: true, skipped: true,
               passOp: true, passSc: true,
               note: 'OPTIMIZER topology -- MPPT current check N/A', rule: 'STR-03' };
    }
    var totalMppts       = inv.mpptCount * inv.qty;
    var strPerMppt       = totalMppts > 0 ? inv.stringsAssigned / totalMppts : 0;
    var iStrPerMppt      = isc * bifFactor * strPerMppt;          // design Iop into MPPT
    var iScStrPerMppt    = isc * bifFactor * strPerMppt;          // same basis for Isc check
    var passOp  = iStrPerMppt   <= inv.iOpPerMppt;
    var passSc  = iScStrPerMppt <= inv.iScPerMppt;
    return {
      invModel: inv.model, strPerMppt: strPerMppt,
      iDesignIntoMppt: iStrPerMppt, iOpLimit: inv.iOpPerMppt, passOp: passOp,
      iScIntoMppt: iScStrPerMppt,   iScLimit: inv.iScPerMppt,  passSc: passSc,
      pass: passOp && passSc, rule: 'STR-03', article: '690.8/MPPT current'
    };
  });
  dc.str03Pass = dc.str03Results.every(function(r) { return r.pass; });

  // -- DC-09: Isc limit per MPPT (v3: uses iScPerMppt) ----------------------
  // Same calc as STR-03 Isc branch but kept separate for NOM rule traceability
  dc.dc09Results = dc.str03Results.map(function(r) {
    return {
      invModel: r.invModel, iScIntoMppt: r.iScIntoMppt,
      iScLimit: r.iScLimit, pass: r.passSc, skipped: r.skipped || false,
      rule: 'DC-09', article: '690.8/inverter datasheet'
    };
  });
  dc.dc09Pass = dc.dc09Results.every(function(r) { return r.pass; });

  // -- DC-10: DC/AC ratio ----------------------------------------------------
  var dcKwp      = (pwr * inp.panelQty) / 1000;
  var acKwTotal  = invBank.reduce(function(s, inv) { return s + (inv.acKw * inv.qty); }, 0);
  var ratio      = acKwTotal > 0 ? dcKwp / acKwTotal : 0;
  // AGS-204 §7 band (single source: 00b_AgsRegister.js / DCAC-BAND). Advisory
  // only — DC/AC is a designer decision, never a hard block.
  var _agsMax       = nom.dcAcAgsMax       || 1.40;
  var _agsReviewLow = nom.dcAcAgsReviewLow || 1.35;
  var ratioFail  = ratio > _agsMax;
  var ratioReview= ratio > _agsReviewLow && !ratioFail;

  dc.dcKwp     = dcKwp;
  dc.acKwTotal = acKwTotal;
  dc.dcAcRatio = ratio;
  dc.dcAcRatioStatus = ratioFail   ? '[REVIEW] Relacion > ' + _agsMax + ' (AGS-204 §7) — verificar clipping/NPV y justificar (decision del disenador)'
                     : ratioReview ? '[REVIEW] Relacion en banda AGS-204 ' + _agsReviewLow + '–' + _agsMax + ' — confirmar estudio de clipping'
                     :               '[PASS]';

  // -- Overall DC result -----------------------------------------------------
  var criticalPass = dc.dc01Pass && dc.dc02Pass && dc.str01Pass && dc.str02Pass &&
                     dc.str03Pass && dc.dc09Pass;
  dc.resultDC = criticalPass
    ? (dc.vdropDCFail   ? '[REVIEW] Seccion DC -- caida de tension excede limite'
      : dc.vdropDCReview? '[REVIEW] Seccion DC -- caida de tension sobre objetivo'
      :                   '[PASS] Seccion DC OK')
    : '[FAIL] Seccion DC -- ver banderas 4.0';

  // -- Optimizer topology flag for the BOM (Pass 4) ---------------------------
  // True when any inverter in the bank is OPTIMIZER topology (e.g. SolarEdge).
  // calcLayout uses it to add the optimizer (MLPE) line to the DC BOM, the same
  // signal 09_Validate and the DC checks already use. (Panel area + geometry
  // are stashed on dc earlier in this function.)
  dc.hasOptimizerTopology = invBank.some(function (inv) {
    return String(inv.topology || '').toUpperCase() === 'OPTIMIZER';
  });

  return dc;
}
