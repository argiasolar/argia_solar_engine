// =============================================================================
// ARGIA ENGINE v7 -- File: 03_ElecTables.gs
// Reads 15M_ELEC_TABLES and exposes typed lookup functions.
// All table data is read once and returned as a 'tbls' object used by calcs.
// =============================================================================

/**
 * Reads all lookup tables from 15M_ELEC_TABLES.
 * Sheet layout (1-based rows, confirmed from file read):
 *   Row 6 = headers
 *   Col B=2  ROOF TEMP ADDER:   clearance_mm | adder_c
 *   Col E=5  TEMP FACTOR 90C:   temp_c       | Ft
 *   Col H=8  GROUPING FACTOR:   cond_max     | Fag
 *   Col K=11 STANDARD BREAKERS: rating_A
 *   Col M=13 COPPER CONDUCTORS: size | ampacity_90c | cu_area_mm2 | ins_area_mm2
 *   Col R=18 GROUND CONDUCTOR:  ocpd_max | egc_size | cu_area_mm2
 *   Col V=22 IMC CONDUIT FILL:  fill_mm2 | size_in
 *   Col Y=25 STANDARD XFMRS:   kva
 */
function readElecTables(ss) {
  const sh   = ss.getSheetByName(SH.ELEC_TABLES);
  // Read from the sub-header row (6) through the last populated row. The breaker
  // and transformer columns carry their FIRST value on row 6, and the breaker
  // column runs past the old fixed 29-row window (down to 1600 A), so a
  // hardcoded height silently clipped both ends (missing 15 A & 1600 A breakers
  // and the 75 kVA transformer). The per-column isNaN/'' filters below drop the
  // text sub-headers, so reading the header row and over-reading are both safe.
  const firstRow = 6;
  const lastRow  = sh.getLastRow();
  const height   = Math.max(0, lastRow - firstRow + 1);
  const raw      = sh.getRange(firstRow, 1, height, 25).getValues();

  // -- Roof temperature adders (col B=2, C=3 -> index 1, 2) ------------------
  const roofTempAdders = [];
  raw.forEach(r => {
    const clr = parseFloat(r[1]);
    const add = parseFloat(r[2]);
    if (!isNaN(clr) && !isNaN(add)) roofTempAdders.push({ clearanceMm: clr, adderC: add });
  });

  // -- Temperature correction factors 90degC (col E=5, F=6 -> index 4, 5) ------
  const tempFactors = [];
  raw.forEach(r => {
    const t  = parseFloat(r[4]);
    const ft = parseFloat(r[5]);
    if (!isNaN(t) && !isNaN(ft)) tempFactors.push({ tempC: t, Ft: ft });
  });

  // -- Grouping (bundling) factors (col H=8, I=9 -> index 7, 8) --------------
  const groupingFactors = [];
  raw.forEach(r => {
    const n   = parseFloat(r[7]);
    const fag = parseFloat(r[8]);
    if (!isNaN(n) && !isNaN(fag)) groupingFactors.push({ condMax: n, Fag: fag });
  });

  // -- Standard breaker ratings (col K=11 -> index 10) -----------------------
  const breakers = [];
  raw.forEach(r => {
    const v = parseFloat(r[10]);
    if (!isNaN(v)) breakers.push(v);
  });

  // -- Copper conductor ampacity (col M-P -> index 12, 13, 14, 15) -----------
  // size(AWG/kcmil label) | ampacity_90C | cu_area_mm2 | insulated_area_mm2
  const conductors = [];
  raw.forEach(r => {
    const sz  = r[12];
    const amp = parseFloat(r[13]);
    const cu  = parseFloat(r[14]);
    const ins = parseFloat(r[15]);
    if (sz !== '' && sz !== null && !isNaN(amp)) {
      conductors.push({ size: String(sz), ampacity: amp, cuAreaMm2: cu, insAreaMm2: ins });
    }
  });

  // -- Ground conductor table (col R-T -> index 17, 18, 19) -----------------
  // ocpd_max_A | egc_size(AWG) | cu_area_mm2
  const groundTable = [];
  raw.forEach(r => {
    const ocpd = parseFloat(r[17]);
    const egc  = r[18];
    const cu   = parseFloat(r[19]);
    if (!isNaN(ocpd) && egc !== '' && egc !== null) {
      groundTable.push({ ocpdMaxA: ocpd, egcSize: String(egc), cuAreaMm2: cu });
    }
  });

  // -- IMC conduit fill >2 conductors (col V-W -> index 21, 22) -------------
  // fill_area_mm2 | size_in
  const conduitTable = [];
  raw.forEach(r => {
    const fill = parseFloat(r[21]);
    const sz   = r[22];
    if (!isNaN(fill) && sz !== '' && sz !== null) {
      conduitTable.push({ fillMm2: fill, sizeIn: String(sz) });
    }
  });

  // -- Standard transformer kVA (col Y -> index 24) ---------------------------
  const transformers = [];
  raw.forEach(r => {
    const v = parseFloat(r[24]);
    if (!isNaN(v)) transformers.push(v);
  });

  return { roofTempAdders, tempFactors, groupingFactors, breakers,
           conductors, groundTable, conduitTable, transformers };
}

// -----------------------------------------------------------------------------
// LOOKUP HELPERS
// -----------------------------------------------------------------------------

/** Returns roof temperature adder (degC) for given clearance in mm. */
function getRoofTempAdder(clearanceMm, tbls) {
  // Sort ascending, return first row where clearanceMm <= threshold
  const sorted = [...tbls.roofTempAdders].sort((a, b) => a.clearanceMm - b.clearanceMm);
  for (const row of sorted) {
    if (clearanceMm <= row.clearanceMm) return row.adderC;
  }
  return sorted[sorted.length - 1].adderC; // fallback: highest adder
}

/** Returns temperature correction factor Ft for 90degC cable at given ambient degC. */
function getTempFactor(ambientC, tbls) {
  // Find exact match or interpolate -- table has 5degC steps
  const sorted = [...tbls.tempFactors].sort((a, b) => a.tempC - b.tempC);
  // Find the row where tempC >= ambientC
  for (const row of sorted) {
    if (ambientC <= row.tempC) return row.Ft;
  }
  return sorted[sorted.length - 1].Ft;
}

/** Returns grouping/bundling factor Fag for n current-carrying conductors. */
function getGroupingFactor(n, tbls) {
  const sorted = [...tbls.groupingFactors].sort((a, b) => a.condMax - b.condMax);
  for (const row of sorted) {
    if (n <= row.condMax) return row.Fag;
  }
  return sorted[sorted.length - 1].Fag;
}

/** Returns next-standard-up breaker >= required amperage. */
function nextBreaker(requiredA, tbls) {
  const sorted = [...tbls.breakers].sort((a, b) => a - b);
  for (const b of sorted) {
    if (b >= requiredA) return b;
  }
  return sorted[sorted.length - 1]; // largest available
}

/**
 * NEC 240.4 — an OCPD must not exceed the conductor's (corrected/adjusted)
 * ampacity, EXCEPT 240.4(B) permits rounding UP to the next standard OCPD when
 * the conductor ampacity is <= 800 A and does not correspond to a standard
 * breaker size. Above 800 A the next-size-up allowance does not apply.
 *
 * Pure helper -- unit-testable without a workbook. Returns true when `ocpdA`
 * legitimately protects a conductor of ampacity `conductorAmpacityA`.
 * Pass the conductor's ampacity AFTER any temp/grouping adjustment.
 */
function ocpdProtectsConductor(ocpdA, conductorAmpacityA, tbls) {
  if (!(conductorAmpacityA > 0)) return false;
  if (ocpdA <= conductorAmpacityA) return true;            // 240.4 general rule
  if (conductorAmpacityA > 800) return false;              // no 240.4(B) above 800 A
  return nextBreaker(conductorAmpacityA, tbls) === ocpdA;  // exactly the next standard size
}

// NEC 310.16 copper 75degC TERMINAL ampacities, keyed by conductor size label.
// T1 / NEC 110.14(C): equipment terminations are rated 75degC (anything >100 A,
// and most breakers/lugs). The 90degC column may be used for conditions-of-use
// derating, but the FINAL conductor's 75degC ampacity must still cover the
// terminal-basis (continuous x 1.25) load. Built-in standard values rather than
// sheet-sourced so this safety floor can't be silently mis-entered. Sizes not in
// this map (sub-14 AWG fixture wire, >1000 kcmil) impose no terminal cap.
var COND_75C_AMPACITY = {
  '14': 20, '12': 25, '10': 35, '8': 50, '6': 65, '4': 85, '3': 100, '2': 115,
  '1': 130, '1/0': 150, '2/0': 175, '3/0': 200, '4/0': 230,
  '250': 255, '300': 285, '350': 310, '400': 335, '500': 380, '600': 420,
  '700': 460, '750': 475, '800': 490, '900': 520, '1000': 545,
};
/** 75degC terminal ampacity for a conductor size label, or undefined (no cap). */
function conductorAmp75(sizeLabel) {
  var key = (String(sizeLabel).indexOf('/') >= 0)
    ? String(sizeLabel).trim()
    : String(parseFloat(sizeLabel));
  return COND_75C_AMPACITY[key];
}

/**
 * Returns the minimum conductor whose 90degC ampacity meets requiredA AND whose
 * 75degC terminal ampacity meets terminalReqA (NEC 110.14(C)). terminalReqA is
 * the no-derate, terminal-basis current (continuous x 1.25); when omitted it
 * defaults to requiredA. Returns the full conductor object.
 */
function selectConductor(requiredA, tbls, terminalReqA) {
  var termReq = (terminalReqA === undefined || terminalReqA === null) ? null : terminalReqA;
  const sorted = [...tbls.conductors].sort((a, b) => a.ampacity - b.ampacity);
  for (const c of sorted) {
    var a75 = conductorAmp75(c.size);
    var ok75 = (a75 === undefined || termReq === null) ? true : (a75 >= termReq);
    if (c.ampacity >= requiredA && ok75) return c;
  }
  // Nothing meets the requirement. Return the largest but FLAG it insufficient so
  // the caller never silently ships an under-ampacity conductor (latent feeder bug:
  // the table used to stop at 400 kcmil / 380 A vs a 413 A requirement).
  return Object.assign({}, sorted[sorted.length - 1],
                       { insufficient: true, requiredA: requiredA });
}

/**
 * Select the smallest conductor satisfying BOTH the ampacity floor AND the
 * voltage-drop limit (size for the worst case). vdropCtx = { k, lengthM, rho,
 * iA, voltageV, limitFrac }: vdrop = (k * L * (rho/A) * I) / V. Pass k=Math.sqrt(3)
 * for 3-phase AC, 2 for 1-phase, or a DC string's already-round-trip length with k=1.
 * Returns { size, cuAreaMm2, insAreaMm2, ampacity, vdrop, minAreaVdrop,
 *           governedBy:'VDROP'|'AMPACITY', insufficient }. Pure helper.
 */
function selectConductorForVdrop(ampReqA, vdropCtx, tbls, terminalReqA) {
  var termReq = (terminalReqA === undefined || terminalReqA === null) ? null : terminalReqA;
  function ok75(c) { var a = conductorAmp75(c.size); return (a === undefined || termReq === null) ? true : (a >= termReq); }
  var minArea = 0;
  if (vdropCtx && vdropCtx.limitFrac > 0 && vdropCtx.voltageV > 0) {
    minArea = (vdropCtx.k * vdropCtx.lengthM * vdropCtx.rho * vdropCtx.iA) /
              (vdropCtx.voltageV * vdropCtx.limitFrac);
  }
  var sorted = [...tbls.conductors].sort(function (a, b) { return a.ampacity - b.ampacity; });
  var byAmp = null;
  for (var i = 0; i < sorted.length; i++) {
    if (sorted[i].ampacity >= ampReqA && ok75(sorted[i])) { byAmp = sorted[i]; break; }
  }
  var chosen = null;
  for (var j = 0; j < sorted.length; j++) {
    if (sorted[j].ampacity >= ampReqA && sorted[j].cuAreaMm2 >= minArea && ok75(sorted[j])) { chosen = sorted[j]; break; }
  }
  var insufficient = false;
  if (!chosen) { chosen = sorted[sorted.length - 1]; insufficient = true; }
  var vdrop = (vdropCtx && vdropCtx.voltageV > 0)
    ? (vdropCtx.k * vdropCtx.lengthM * (vdropCtx.rho / chosen.cuAreaMm2) * vdropCtx.iA) / vdropCtx.voltageV
    : 0;
  var governedBy = (byAmp && chosen.cuAreaMm2 > byAmp.cuAreaMm2) ? 'VDROP' : 'AMPACITY';
  return { size: chosen.size, cuAreaMm2: chosen.cuAreaMm2, insAreaMm2: chosen.insAreaMm2,
           ampacity: chosen.ampacity, vdrop: vdrop, minAreaVdrop: minArea,
           governedBy: governedBy, insufficient: insufficient, ampReq: ampReqA };
}

/** Returns EGC size string for given OCPD amperage. */
function getEgcSize(ocpdA, tbls) {
  const sorted = [...tbls.groundTable].sort((a, b) => a.ocpdMaxA - b.ocpdMaxA);
  for (const row of sorted) {
    if (ocpdA <= row.ocpdMaxA) return { egcSize: row.egcSize, cuAreaMm2: row.cuAreaMm2 };
  }
  return { egcSize: sorted[sorted.length - 1].egcSize,
           cuAreaMm2: sorted[sorted.length - 1].cuAreaMm2 };
}

/**
 * Returns the correct unit label ('AWG' or 'kcmil') for a conductor size string.
 * AWG sizes:   14, 12, 10, 8, 6, 4, 3, 2, 1, 1/0, 2/0, 3/0, 4/0
 * kcmil sizes: 250, 300, 350, 400, 500, 600, 750, 1000, ...
 * Fixes Phase 1 bug #4: kcmil conductors were mislabeled 'AWG' in MDC + BOM.
 */
function conductorUnit(size) {
  var s = String(size).trim();
  if (s.indexOf('/') >= 0) return 'AWG';          // 1/0..4/0
  var n = parseFloat(s);
  return (!isNaN(n) && n >= 250) ? 'kcmil' : 'AWG';
}

/**
 * Returns minimum IMC conduit size (in) for given total cable insulated area.
 * Applies 40% fill rule (for >2 conductors).
 *
 * Phase A (2026-04-28): falsy-default bug fixed. Was `fillRatio = fillRatio || 0.40`
 * which silently coerces 0 to 0.40 — same shape as bug #1 you fought elsewhere.
 * If a caller ever passes 0 (no fill allowed), they should get a sane error,
 * not a silently substituted 40%.
 */
function selectConduit(totalInsAreaMm2, fillRatio, tbls) {
  if (fillRatio === undefined || fillRatio === null) {
    fillRatio = 0.40; // NEC/NOM Ch9 default for >2 conductors
  }
  var fillNeeded = totalInsAreaMm2 / fillRatio; // required conduit area at configured fill ratio
  const sorted = [...tbls.conduitTable].sort((a, b) => a.fillMm2 - b.fillMm2);
  for (const row of sorted) {
    if (row.fillMm2 >= fillNeeded) return row.sizeIn;
  }
  return sorted[sorted.length - 1].sizeIn;
}

/** Returns next-standard-up transformer kVA. */
function nextTransformer(requiredKva, tbls) {
  const sorted = [...tbls.transformers].sort((a, b) => a - b);
  for (const t of sorted) {
    if (t >= requiredKva) return t;
  }
  return sorted[sorted.length - 1];
}

/** PASS/FAIL/REVIEW status string helper */
function statusFlag(pass, fail, label) {
  if (fail)  return `? FAIL -- ${label}`;
  if (!pass) return `?? REVIEW -- ${label}`;
  return `? PASS`;
}
