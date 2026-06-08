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
  // Read rows 7-35 (data rows after header on row 6)
  const raw  = sh.getRange(7, 1, 29, 25).getValues();

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
 * Returns the minimum conductor size (AWG string) whose 90degC ampacity
 * meets or exceeds requiredA.
 * Returns full conductor object { size, ampacity, cuAreaMm2, insAreaMm2 }.
 */
function selectConductor(requiredA, tbls) {
  const sorted = [...tbls.conductors].sort((a, b) => a.ampacity - b.ampacity);
  for (const c of sorted) {
    if (c.ampacity >= requiredA) return c;
  }
  // Nothing meets the requirement. Return the largest but FLAG it insufficient so
  // the caller never silently ships an under-ampacity conductor (latent feeder bug:
  // the table used to stop at 400 kcmil / 380 A vs a 413 A requirement).
  return Object.assign({}, sorted[sorted.length - 1],
                       { insufficient: true, requiredA: requiredA });
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
