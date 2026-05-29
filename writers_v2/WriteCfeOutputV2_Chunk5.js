// =============================================================================
// ARGIA -- writers_v2/WriteCfeOutputV2_Chunk5.js
// -----------------------------------------------------------------------------
// CHUNK 5 -- Session 3
//
// Companion to WriteCfeOutputV2.js. Holds the Chunk 5 additions:
//   - tier banner + disclaimer (the LOCKED non-guarantee invariant)
//   - hourly-sim-sourced Section 2 helpers
//   - Conservative / Expected / Upside summary
//   - kW-aware demand-charge breakdown
//
// Kept in a separate file so the diff to the proven WriteCfeOutputV2.js
// stays small and reviewable, and so the Chunk 5 customer-facing changes
// can be reasoned about (and reverted) as a unit.
//
// ROW PLACEMENT STRATEGY (critical):
//   These helpers write into the GAP rows the template leaves free
//   (row 4, row 11, row 21) plus a new block BELOW the existing footer.
//   They do NOT shift any existing row. This preserves every cell
//   reference the CULLIGAN baseline test locks against the formula-sheet
//   path (3b dual-path: hourly-sim numbers added, formula-sheet numbers
//   kept as cross-check until Session 4).
// =============================================================================


// ---------------------------------------------------------------------------
// TIER BANNER + DISCLAIMER -- the LOCKED non-guarantee invariant.
//
// This is the ONLY function that writes a tier label. It writes the label
// AND the disclaimer in the same operation. There is no code path that
// emits 'PROPOSAL' without the disclaimer -- they are one operation.
//
// Renders in TWO places (caller invokes twice with different rows):
//   - top of sheet (row 4) -- first thing the eye hits
//   - above Section 2 (row 21) -- physically adjacent to the savings
//
// Text is Spanish (customer-facing sheet, Mexican industrial client).
// English original preserved here for traceability:
//   PROPOSAL: "Proposal estimate -- not guaranteed savings.
//              Interval data required for bankable validation."
// ---------------------------------------------------------------------------

function _cfeOutV2_renderTierBanner(sh, row, tier) {
  var text, bg, fg;
  var t = String(tier || 'PROPOSAL').toUpperCase();

  if (t === 'SCREENING') {
    text = 'EVALUACIÓN PRELIMINAR (SCREENING) — solo para análisis interno. '
         + 'No usar en propuestas a cliente.';
    bg = '#FCE8E6'; fg = '#B00020';            // red-ish: internal only
  } else if (t === 'BANKABLE') {
    text = 'VALIDADO CON DATOS DE INTERVALOS DE 15 MINUTOS — apto para '
         + 'propuesta bancable.';
    bg = '#E6F4EA'; fg = '#137333';            // green: validated
  } else {  // PROPOSAL (default)
    text = 'ESTIMACIÓN DE PROPUESTA — ahorros no garantizados. '
         + 'Se requieren datos de intervalos de 15 minutos para validación '
         + 'bancable (bankable). El ahorro real de demanda depende del perfil '
         + 'de carga de 15 minutos del sitio.';
    bg = '#FFF3E0'; fg = '#995700';            // amber: proceed with awareness
  }

  var rng = sh.getRange(row, 2, 1, 14);
  try { rng.breakApart(); } catch (e) {}
  rng.merge()
     .setValue(text)
     .setBackground(bg)
     .setFontColor(fg)
     .setFontSize(10)
     .setFontWeight('bold')
     .setWrap(true)
     .setVerticalAlignment('middle')
     .setHorizontalAlignment('center');
  try { sh.setRowHeight(row, 38); } catch (e) {}
}


// ---------------------------------------------------------------------------
// CONSERVATIVE / EXPECTED / UPSIDE summary (R1 view).
//
// Writes a 3-tile annual summary into a block below the existing footer
// (so no existing row shifts). Uses the autoOptimize decision object from
// _runBessAutoOptimize.
//
//   Conservative = PEAK_SHAVING everywhere (safe floor; screening-grade)
//   Expected     = customer's selected strategy (the headline; real
//                  full-bill number passed in via expectedAnnualMxn)
//   Upside       = AUTO_OPTIMIZE per-month best-of (screening-grade)
//
// DECISION 2a: Expected is the headline. Conservative/Upside frame the
// range around it.
//
// WIDE-DIVERGENCE HANDLING: when Conservative and Upside differ by more
// than a 3x ratio (or Conservative is ~0 while Upside is material), a
// useless range like "$0 .. $14M" would mislead. In that case we add an
// explanatory line naming WHY (typically: little excess PV, so most value
// is load-shifting arbitrage that needs NET_BILLING).
// ---------------------------------------------------------------------------

function _cfeOutV2_renderConsExpUpside(sh, startRow, autoOpt, expectedAnnualMxn, interconnMode) {
  var cons = Number(autoOpt && autoOpt.conservativeMxn) || 0;
  var ups  = Number(autoOpt && autoOpt.upsideMxn) || 0;
  var exp  = Number(expectedAnnualMxn) || 0;

  // Section header
  sh.getRange(startRow, 2, 1, 14).breakApart().merge()
    .setValue('RANGO DE AHORRO BESS — Conservador / Esperado / Óptimo')
    .setBackground('#ECEFF1').setFontWeight('bold').setFontSize(11)
    .setVerticalAlignment('middle');

  var tileRow = startRow + 1;

  // Conservative tile (cols 2-5, gray)
  _cfeOutV2_paintRangeTile(sh, tileRow, 2,
    'CONSERVADOR\n(solo peak shaving)', cons, '#F5F3EE');
  // Expected tile (cols 7-10, green) -- the headline
  _cfeOutV2_paintRangeTile(sh, tileRow, 7,
    'ESPERADO\n(estrategia elegida)', exp, '#C8E6C9');
  // Upside tile (cols 12-15, light blue)
  _cfeOutV2_paintRangeTile(sh, tileRow, 12,
    'ÓPTIMO\n(auto-optimizado)', ups, '#E1F5FE');

  // Wide-divergence explanatory line
  var note = _cfeOutV2_rangeExplanation(cons, exp, ups, interconnMode);
  if (note) {
    var noteRow = tileRow + 1;
    sh.getRange(noteRow, 2, 1, 14).breakApart().merge()
      .setValue(note)
      .setFontStyle('italic').setFontSize(9).setWrap(true)
      .setFontColor('#555555');
    try { sh.setRowHeight(noteRow, 32); } catch (e) {}
    return noteRow;   // last row written
  }
  return tileRow;
}


function _cfeOutV2_paintRangeTile(sh, row, col, label, value, bg) {
  sh.getRange(row, col, 1, 4).breakApart().merge()
    .setValue(label + '\n$' + _cfeOutV2_fmtChunk5(value))
    .setBackground(bg)
    .setFontSize(13)
    .setFontWeight('bold')
    .setVerticalAlignment('middle')
    .setWrap(true);
  try { sh.setRowHeight(row, 56); } catch (e) {}
}


// Returns an explanatory string when the range is wide enough to mislead,
// else ''. "Wide" = upside more than 3x conservative, OR conservative is
// near-zero while upside is material.
function _cfeOutV2_rangeExplanation(cons, exp, ups, interconnMode) {
  var nearZeroCons = (cons < 0.01 * Math.max(ups, 1));
  var wideRatio    = (cons > 0 && ups > 3 * cons);
  if (!nearZeroCons && !wideRatio) return '';

  var mode = String(interconnMode || '').toUpperCase();
  var lsAvailable = (mode === 'NET_BILLING');

  var msg = 'El rango es amplio porque este sitio tiene poco excedente '
          + 'solar: la mayor parte del valor del BESS proviene del '
          + 'desplazamiento de carga (load-shifting / arbitraje), no del '
          + 'peak shaving. ';
  if (lsAvailable) {
    msg += 'El arbitraje requiere interconexión FACTURACIÓN NETA '
         + '(NET_BILLING), que este sitio tiene — por eso el caso óptimo '
         + 'es mucho mayor que el conservador.';
  } else {
    msg += 'El arbitraje requiere interconexión FACTURACIÓN NETA '
         + '(NET_BILLING), que este sitio NO tiene configurada — el caso '
         + 'óptimo mostrado no es alcanzable bajo la interconexión actual.';
  }
  return msg;
}


// ---------------------------------------------------------------------------
// kW-AWARE DEMAND-CHARGE BREAKDOWN (R2 §2.2).
//
// Writes annual peak-reduction kW + avoided Capacidad / Distribución /
// Variable MXN, sourced from the hourly sim's attribution + the planner
// ledgers. Block below the Cons/Exp/Upside summary (no existing row shift).
// ---------------------------------------------------------------------------

function _cfeOutV2_renderDemandChargeBreakdown(sh, startRow, hourlySim) {
  var attr = hourlySim && hourlySim.attribution;
  if (!attr) return startRow;

  // Annual peak reduction (kW): pvOnly peak - pvBess peak, summed across
  // months then averaged is misleading; instead show the max monthly punta
  // reduction (the binding number for Capacidad).
  var pvOnlyPunta = attr.pvOnly && attr.pvOnly.monthlyPeakPuntaKw || [];
  var pvBessPunta = attr.pvBess && attr.pvBess.monthlyPeakPuntaKw || [];
  var maxPeakRedKw = 0;
  for (var m = 0; m < 12; m++) {
    var red = (Number(pvOnlyPunta[m]) || 0) - (Number(pvBessPunta[m]) || 0);
    if (red > maxPeakRedKw) maxPeakRedKw = red;
  }

  // Avoided MXN by component: pvOnly cost - pvBess cost, per bucket.
  var pvOnlyBucket = attr.pvOnly && attr.pvOnly.costByBucket || {};
  var pvBessBucket = attr.pvBess && attr.pvBess.costByBucket || {};
  var avoidedPunta = (Number(pvOnlyBucket.punta) || 0) - (Number(pvBessBucket.punta) || 0);
  var avoidedInter = (Number(pvOnlyBucket.intermedia) || 0) - (Number(pvBessBucket.intermedia) || 0);
  var avoidedBase  = (Number(pvOnlyBucket.base) || 0) - (Number(pvBessBucket.base) || 0);

  sh.getRange(startRow, 2, 1, 14).breakApart().merge()
    .setValue('DESGLOSE DE AHORRO BESS (estimación de propuesta)')
    .setBackground('#ECEFF1').setFontWeight('bold').setFontSize(11);

  var rows = [
    ['Reducción de pico (punta), kW',  _cfeOutV2_fmtChunk5(maxPeakRedKw) + ' kW'],
    ['Ahorro en punta, MXN/año',       '$' + _cfeOutV2_fmtChunk5(avoidedPunta)],
    ['Ahorro en intermedia, MXN/año',  '$' + _cfeOutV2_fmtChunk5(avoidedInter)],
    ['Ahorro en base, MXN/año',        '$' + _cfeOutV2_fmtChunk5(avoidedBase)],
  ];
  var r = startRow + 1;
  for (var i = 0; i < rows.length; i++) {
    sh.getRange(r, 2, 1, 8).breakApart().merge().setValue(rows[i][0]).setFontSize(10);
    sh.getRange(r, 10, 1, 6).breakApart().merge().setValue(rows[i][1])
      .setFontSize(10).setFontWeight('bold').setHorizontalAlignment('right');
    r++;
  }
  return r - 1;
}


// ---------------------------------------------------------------------------
// Shared formatter (mirror of WriteCfeOutputV2's _cfeOutV2_fmt so this file
// is self-contained if loaded standalone in tests). Thousands separator,
// no decimals.
// ---------------------------------------------------------------------------
function _cfeOutV2_fmtChunk5(n) {
  var v = Math.round(Number(n) || 0);
  return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}


// ===========================================================================
// CHUNK 7 Session 2 -- RESILIENCE / backup value block.
// ---------------------------------------------------------------------------
// Renders the backup/resilience value as its OWN, clearly-separated block.
// HARD RULE (never blend): this value is NEVER added to CFE bill savings.
// It is presented on a separate line with its value-source qualifier, and
// only shown as a real number when calcResilience produced one (i.e. a value
// source was supplied). If cost was entered without a source, the guard set
// resilienceValueMxn=0 and valueBlockedNoSource=true, and we render an
// explicit "no source -> not counted" note instead of a peso figure.
//
// @param {Object} sh    CFE_OUTPUT_v2 sheet
// @param {number} startRow
// @param {Object} resilience  hourlySim.resilience (from calcResilience)
// @return {number} last row written
// ---------------------------------------------------------------------------
function _cfeOutV2_renderResilienceBlock(sh, startRow, resilience) {
  if (!resilience) return startRow - 1;

  // Nothing to show if no backup was requested at all (no reserve, no value,
  // no warnings). Keeps the sheet clean for projects that ignore the section.
  var hasReserve = Number(resilience.reservedKwh) > 0;
  var hasValue   = Number(resilience.resilienceValueMxn) > 0;
  var blocked    = !!resilience.valueBlockedNoSource;
  if (!hasReserve && !hasValue && !blocked
      && (!resilience.warnings || !resilience.warnings.length)) {
    return startRow - 1;
  }

  var r = startRow;

  // Header -- visually distinct from the CFE savings block (different color)
  // and explicitly labeled as NOT being a CFE bill saving.
  sh.getRange(r, 2, 1, 14).breakApart().merge()
    .setValue('VALOR DE RESPALDO / RESILIENCIA (separado del ahorro CFE)')
    .setBackground('#FFF3E0').setFontWeight('bold').setFontSize(11)
    .setFontColor('#995700');
  r++;

  // The reserved capacity line (always when there is a reserve).
  if (hasReserve) {
    var covPct = Math.round((Number(resilience.coverageFraction) || 0) * 100);
    var reserveLabel = 'Capacidad reservada para respaldo, kWh';
    var reserveVal = _cfeOutV2_fmtChunk5(resilience.reservedKwh) + ' kWh'
      + (resilience.undersized ? '  (cobertura ' + covPct + '%)' : '');
    sh.getRange(r, 2, 1, 8).breakApart().merge().setValue(reserveLabel).setFontSize(10);
    sh.getRange(r, 10, 1, 6).breakApart().merge().setValue(reserveVal)
      .setFontSize(10).setFontWeight('bold').setHorizontalAlignment('right');
    r++;
  }

  // The value line -- a peso figure ONLY if a source was supplied.
  var valueLabel = 'Valor de respaldo estimado, MXN/año';
  var valueText;
  if (blocked) {
    valueText = '$0 (sin fuente de valor)';
  } else if (hasValue) {
    valueText = '$' + _cfeOutV2_fmtChunk5(resilience.resilienceValueMxn)
      + '  — fuente: ' + (resilience.valueSourceLabel || '');
  } else {
    valueText = '$0';
  }
  sh.getRange(r, 2, 1, 8).breakApart().merge().setValue(valueLabel).setFontSize(10);
  sh.getRange(r, 10, 1, 6).breakApart().merge().setValue(valueText)
    .setFontSize(10).setFontWeight('bold').setHorizontalAlignment('right')
    .setWrap(true);
  r++;

  // Disclaimer / warnings line.
  var noteParts = [];
  noteParts.push('Este valor NO es ahorro en el recibo CFE; es una '
    + 'estimación de pérdida evitada y se muestra por separado.');
  if (blocked) {
    noteParts.push('Se ingresó un costo por evento sin fuente de valor, por '
      + 'lo que el valor de respaldo no se contabiliza (anti-ROI-fantasía).');
  }
  if (resilience.warnings && resilience.warnings.length) {
    noteParts.push(resilience.warnings.join(' '));
  }
  sh.getRange(r, 2, 1, 14).breakApart().merge()
    .setValue(noteParts.join(' '))
    .setFontStyle('italic').setFontSize(9).setWrap(true)
    .setFontColor('#995700');
  r++;

  return r - 1;
}
