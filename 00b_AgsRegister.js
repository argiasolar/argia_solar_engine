// =============================================================================
// 00b_AgsRegister.js  —  ARGIA GOLDEN STANDARD (AGS) PARAMETER REGISTER
// -----------------------------------------------------------------------------
// AGS conformance track — Task A1 (mechanism only, ZERO behaviour change).
//
// WHAT THIS IS
//   The single in-code home for every AGS-B canonical value the engine needs,
//   encoded exactly as Appendix B (Parameter Register) of the ARGIA Golden
//   Standard v1.5 defines it — each value carries its register ID, its N/S/P
//   class, its owning chapter, and its source. This is the literal AGS rule
//   "every number lives here once; chapters reference an ID, never restate the
//   value" (AGS-B §How-this-register-works) brought into the codebase.
//
// WHAT THIS IS NOT (yet)
//   A1 does NOT rewire any engine constant. Nothing in 02_LoadDB.js / the calc
//   modules reads this file yet, so behaviour is byte-identical and the full
//   self-test stays ALL GREEN. The rewire (and the calibration fixes it makes
//   visible) is Task A2.
//
// WHAT IT BUYS NOW
//   `agsConformanceReport(observed)` is a PURE function that compares the
//   engine's *current operative* values against the AGS canonical values and
//   returns a structured drift report. This turns the Category-A findings of
//   the AGS review (DC/AC band, degradation default, ...) into an automated,
//   regression-tracked check instead of prose in a chat.
//
// CLASS (per AGS-000 §0.5 / AGS-B):
//   N = normative / code-fixed (never overridden by the Engine)
//   S = standard assumption  (one canonical value; deviation must be justified)
//   P = project input         (never a constant — a method rule for derivation)
//
// SEVERITY of a drift delta:
//   'BLOCK'  engine is LESS strict than an AGS limit → would release work AGS
//            forbids (e.g. DC/AC fail-threshold above 1.40). Must reconcile.
//   'REVIEW' engine value differs from an AGS S-value → needs a recorded
//            justification or a calibration to the AGS figure.
//   'INFO'   engine does not yet model this value independently (delegated /
//            absent) — a build item for a later task, not a wrong number.
//
// Pure & Node-unit-testable. No SpreadsheetApp / no I/O at load.
// Reads with: docs/AGS_CONFORMANCE_PLAN.md, AGS-B (Parameter Register),
//             AGS-C (Master Formula Register, FR-204-04 / FR-207-03).
// =============================================================================

/**
 * The register. Keyed by AGS-B ID. Each entry is frozen-by-convention: it is
 * the canonical value and must only change when AGS-B changes (and then the
 * conformance tests change with it — that IS the change-control gate).
 *
 * `value` semantics:
 *   - scalar for a single canonical figure (PB-01 = 0.004)
 *   - object for a band / structured rule (DCAC-BAND, PB-06 z-values)
 *   - null with cls 'P' for a method-rule-only entry (no constant exists)
 */
var AGS_REGISTER = {

  // --- B.2 Reference & STC --------------------------------------------------
  'STC-03': { id: 'STC-03', value: 0.20, unit: '-', cls: 'S', owner: 'AGS-202',
              source: 'AGS-B §B.2 — albedo default (measured preferred)',
              note: 'Ground albedo when not site-measured.' },

  // --- B.3 Regulatory thresholds (Mexico) -----------------------------------
  'REG-01': { id: 'REG-01', value: 0.7, unit: 'MW', cls: 'N', owner: 'AGS-102',
              source: 'AGS-B §B.3 — LSE Art. 19 (DOF 18-Mar-2025); Generación Exenta',
              note: 'Per-central exempt-generation ceiling. > 0.7 MW ⇒ Class B (permitted).' },

  // --- B.5 DC array & electrical limits -------------------------------------
  // The 1.25 / 1.5625 PV-circuit-current factors (FR-205-04). The engine
  // already uses 1.25 and 1.25² — these rows let the report confirm it.
  'DC-01': { id: 'DC-01', value: 1.25, unit: '×Isc', cls: 'N', owner: 'AGS-205',
             source: 'AGS-B §B.5 / FR-205-04 — NOM-001-SEDE 690-8(A)',
             note: 'Max PV circuit current = 1.25 × Isc,corr.' },
  'DC-02': { id: 'DC-02', value: 1.5625, unit: '×Isc', cls: 'N', owner: 'AGS-205',
             source: 'AGS-B §B.5 / FR-205-04 — NOM-001-SEDE 690-8(B)',
             note: 'Conductor/OCPD ampacity basis = 1.25 × (DC-01) = 1.5625 × Isc,corr.' },
  'DC-04': { id: 'DC-04', value: 0.02, unit: 'fraction', cls: 'S', owner: 'AGS-205',
             source: 'AGS-B §B.5 — DC voltage-drop design target ≤ 2%',
             note: 'Design target, not a code limit; deviation justified.' },

  // --- B.9 Performance & bankability ----------------------------------------
  'PB-01': { id: 'PB-01', value: 0.004, unit: 'fraction/yr', cls: 'S', owner: 'AGS-204/207',
             source: 'AGS-B §B.9 — annual degradation default ≤ 0.4%/yr (linear); Yr-1 ≤ 1%',
             note: 'Warranted linear degradation cap. Quarantined: 0.6%.' },
  'PB-02': { id: 'PB-02', value: 0.87, unit: '-', cls: 'S', owner: 'AGS-202',
             source: 'AGS-B §B.9 — Year-1 PR_STC benchmark (IEC 61724-1 §14.3.2); std PR ≈ 0.80',
             note: 'Temperature-corrected PR is the end-to-end metric.' },
  'PB-03': { id: 'PB-03', value: 0.99, unit: '-', cls: 'S', owner: 'AGS-202/207',
             source: 'AGS-B §B.9 — system availability default 99% (98% acceptable)',
             note: 'New C&I default.' },
  'PB-04': { id: 'PB-04', value: 0.03, unit: 'fraction', cls: 'S', owner: 'AGS-202',
             source: 'AGS-B §B.9 — soiling loss default 3% (≥2% floor; ≥3% dusty/arid)',
             note: 'Mexico C&I default.' },
  // PB-05 specific-yield classification bands (kWh/kWp/yr), high-irradiance MX.
  'PB-05': { id: 'PB-05',
             value: { excellent: 1700, good: 1550, moderate: 1400 },
             unit: 'kWh/kWp/yr', cls: 'S', owner: 'AGS-207',
             source: 'AGS-B §B.9 — yield bands: excellent ≥1700 · good 1550–1700 · moderate 1400–1550 · review <1400',
             note: 'Zone-dependent; benchmark against site POA, not absolute.' },
  // PB-06 uncertainty bands (1-σ) + exceedance z-values (FR-207-03).
  'PB-06': { id: 'PB-06',
             value: { sigmaExcellent: 0.04, sigmaGood: 0.06, sigmaAcceptable: 0.08,
                      zP75: 0.674, zP90: 1.282, zP99: 2.326 },
             unit: 'fraction / z', cls: 'S', owner: 'AGS-207',
             source: 'AGS-B §B.9 / FR-207-03 — σ bands & z-values',
             note: 'σ <4% excellent · 4–6% good · 6–8% acceptable · >8% review. Pxx = P50·(1−z·σ).' },
  'PB-07': { id: 'PB-07', value: 0.70, unit: 'fraction', cls: 'S', owner: 'AGS-203',
             source: 'AGS-B §B.9 — roof coverage/utilization ceiling ≤ 70% gross (computed net)',
             note: 'Flush / E-W may exceed with justification.' },

  // --- B.8 BESS -------------------------------------------------------------
  // BS-06 usable-capacity defaults: DoD / RTE / SOH_EOL (FR-301-01/02).
  'BS-06': { id: 'BS-06',
             value: { dodMax: 0.90, rteAc: 0.90, sohEol: 0.80 },
             unit: 'fraction', cls: 'S', owner: 'AGS-301',
             source: 'AGS-B §B.8 — DoD ≤ 90%, RTE ≈ 90% (AC), SOH_EOL ≈ 80% (LFP)',
             note: 'Replace with datasheet when available.' },
  'BS-07': { id: 'BS-07', value: true, unit: 'flag', cls: 'N', owner: 'AGS-303',
             source: 'AGS-B §B.8 — grid-forming required if BESS injects/exports to RGD or intentional islanding',
             note: 'Not triggered by SAE-GE status alone.' },

  // --- AGS-C derived: DC/AC acceptance band (FR-204-04 + AGS-204 §7) ---------
  // AGS-204 §7: PASS Rdcac in 1.10–1.40; REVIEW 1.35–1.40 (pending clipping
  // study); FAIL > 1.40 without study (release prohibited). Encoded as a band
  // so the report can compare the engine's review/hard thresholds directly.
  'DCAC-BAND': { id: 'DCAC-BAND',
                 value: { min: 1.10, reviewLow: 1.35, max: 1.40 },
                 unit: 'ratio', cls: 'N', owner: 'AGS-204',
                 source: 'AGS-C FR-204-04 + AGS-204 §7 — Rdcac PASS 1.10–1.40, REVIEW 1.35–1.40, FAIL >1.40',
                 note: 'AGS is stricter than the engine policy default (warn 1.5 / hard 1.8).' }
};

// -----------------------------------------------------------------------------
// ACCESSORS — traceability by construction (AGS-801 R5)
// -----------------------------------------------------------------------------

/** Return the full register entry for an AGS-B ID. Throws on unknown ID —
 *  an output that references a value with no register entry is, by AGS-802 R1,
 *  "not validated". Failing loudly here is that rule enforced in code. */
function agsGet(id) {
  if (AGS_REGISTER.hasOwnProperty(id)) return AGS_REGISTER[id];
  throw new Error('agsGet: unknown AGS register ID "' + id + '" (no oracle — see AGS-802 R1)');
}

/** Just the canonical value for an ID (scalar or structured). Throws on unknown. */
function agsValue(id) { return agsGet(id).value; }

/** All entries as an array (stable order by ID). */
function agsAll() {
  return Object.keys(AGS_REGISTER).sort().map(function (k) { return AGS_REGISTER[k]; });
}

/**
 * Register self-integrity check — the in-code analogue of AGS-B change control.
 * Every entry must have a non-empty id/source and a class in {N,S,P}; IDs must
 * be unique (object keys guarantee that) and match the entry's own `.id`.
 * Returns { ok, problems[] }. Pure.
 */
function agsRegisterSelfCheck() {
  var problems = [];
  var VALID_CLASS = { N: 1, S: 1, P: 1 };
  Object.keys(AGS_REGISTER).forEach(function (k) {
    var e = AGS_REGISTER[k];
    if (!e || typeof e !== 'object') { problems.push(k + ': not an object'); return; }
    if (e.id !== k)               problems.push(k + ': .id "' + e.id + '" != key');
    if (!e.source)                problems.push(k + ': missing source');
    if (!VALID_CLASS[e.cls])      problems.push(k + ': class "' + e.cls + '" not in {N,S,P}');
    if (e.value === undefined)    problems.push(k + ': value undefined');
  });
  return { ok: problems.length === 0, problems: problems };
}

// -----------------------------------------------------------------------------
// CONFORMANCE / DRIFT REPORT — pure (AGS-802 §5.1 flag discipline)
// -----------------------------------------------------------------------------

/**
 * Compare the engine's CURRENT operative values against the AGS register.
 *
 * PURE: takes a plain `observed` object (the caller supplies the engine's live
 * numbers — A2 will feed it from `nom` + client defaults; the unit tests feed
 * it the known current constants). Never reads a workbook.
 *
 * @param {Object} observed  Any subset of:
 *   {
 *     dcAcReviewAbove,   // engine: ratio above which DC/AC is flagged REVIEW   (now 1.5)
 *     dcAcFailAbove,     // engine: ratio above which DC/AC is hard-failed       (now 1.8)
 *     panelDegradationPct,// engine: client-financials degradation default       (now 0.005)
 *     dcCurrentFactor,   // engine: DC-01 factor                                 (now 1.25)
 *     bessRtePct,        // engine: BESS round-trip efficiency default           (now 0.90)
 *     bessSohEolModeled, // engine: does sizing derate to SOH_EOL?  (bool)       (now false)
 *     roofUtilCeiling,   // engine: roof utilization ceiling, if modeled         (now undefined)
 *     bankabilityModeled // engine: P50/P90/σ bankability present?  (bool)       (now false)
 *   }
 * @return {{ status:string, deltas:Array, conformant:Array, notModeled:Array }}
 *   status: 'BLOCK' if any BLOCK delta, else 'REVIEW' if any REVIEW delta, else 'PASS'.
 */
function agsConformanceReport(observed) {
  observed = observed || {};
  var deltas = [], conformant = [], notModeled = [];

  function delta(id, sev, agsVal, engVal, msg) {
    deltas.push({ id: id, severity: sev, agsValue: agsVal, engineValue: engVal, message: msg });
  }
  function ok(id, val, msg) { conformant.push({ id: id, value: val, message: msg }); }
  function info(id, msg) { notModeled.push({ id: id, message: msg }); }

  // --- DC/AC band (DCAC-BAND / FR-204-04) -----------------------------------
  if (observed.dcAcFailAbove !== undefined) {
    var band = agsValue('DCAC-BAND');
    if (Number(observed.dcAcFailAbove) > band.max + 1e-9) {
      delta('DCAC-BAND', 'BLOCK', band.max, observed.dcAcFailAbove,
            'Engine hard-fails DC/AC only above ' + observed.dcAcFailAbove +
            '; AGS-204 §7 prohibits release above ' + band.max + ' without a clipping study.');
    } else {
      ok('DCAC-BAND', observed.dcAcFailAbove, 'DC/AC fail-threshold within AGS limit.');
    }
    if (observed.dcAcReviewAbove !== undefined &&
        Number(observed.dcAcReviewAbove) > band.reviewLow + 1e-9) {
      delta('DCAC-BAND', 'REVIEW', '[' + band.reviewLow + ',' + band.max + ']',
            observed.dcAcReviewAbove,
            'Engine flags DC/AC REVIEW only above ' + observed.dcAcReviewAbove +
            '; AGS-204 §7 reviews the ' + band.reviewLow + '–' + band.max + ' band.');
    }
  }

  // --- Degradation default (PB-01) ------------------------------------------
  if (observed.panelDegradationPct !== undefined) {
    var pb01 = agsValue('PB-01');
    if (Number(observed.panelDegradationPct) > pb01 + 1e-9) {
      delta('PB-01', 'REVIEW', pb01, observed.panelDegradationPct,
            'Engine degradation default ' + (observed.panelDegradationPct * 100) +
            '%/yr exceeds the AGS warranted cap of ' + (pb01 * 100) + '%/yr (PB-01).');
    } else {
      ok('PB-01', observed.panelDegradationPct, 'Degradation default within AGS cap.');
    }
  }

  // --- DC current factor (DC-01) — expect already aligned -------------------
  if (observed.dcCurrentFactor !== undefined) {
    var dc01 = agsValue('DC-01');
    if (Math.abs(Number(observed.dcCurrentFactor) - dc01) > 1e-9) {
      delta('DC-01', 'BLOCK', dc01, observed.dcCurrentFactor,
            'DC circuit-current factor differs from NOM 690-8(A) value (FR-205-04).');
    } else {
      ok('DC-01', observed.dcCurrentFactor, 'DC-01 current factor matches AGS.');
    }
  }

  // --- BESS RTE (BS-06.rteAc) — expect already aligned ----------------------
  if (observed.bessRtePct !== undefined) {
    var rte = agsValue('BS-06').rteAc;
    if (Math.abs(Number(observed.bessRtePct) - rte) > 0.02 + 1e-9) {
      delta('BS-06', 'REVIEW', rte, observed.bessRtePct,
            'BESS RTE default differs materially from the AGS BS-06 reference (' + rte + ').');
    } else {
      ok('BS-06', observed.bessRtePct, 'BESS RTE within AGS reference band.');
    }
  }

  // --- Capabilities AGS requires that may not be modeled yet (INFO) ---------
  if (observed.bessSohEolModeled === false) {
    info('BS-06', 'BESS sizing does not derate usable energy to SOH_EOL (FR-301-02) — A4 build item.');
  }
  if (observed.bankabilityModeled === false) {
    info('PB-06', 'No P50/P75/P90 + σ bankability model present (AGS-207 / FR-207-03) — A4 build item.');
  }

  var status = deltas.some(function (d) { return d.severity === 'BLOCK'; }) ? 'BLOCK'
             : deltas.some(function (d) { return d.severity === 'REVIEW'; }) ? 'REVIEW'
             : 'PASS';

  return { status: status, deltas: deltas, conformant: conformant, notModeled: notModeled };
}

// -----------------------------------------------------------------------------
// LIVE WIRING — map the engine's loaded config to the conformance report (pure)
// -----------------------------------------------------------------------------

/**
 * Build the conformance `observed` object from the engine's live `nom`
 * constants + client-financials defaults, then run the report. PURE: callers
 * pass plain objects (A2 feeds the loaded `nom` + CLIENT_FIN_DEFAULTS; the unit
 * test feeds synthetic ones). Never reads a workbook.
 *
 * After A2, DC/AC is advisory-only: the engine flags from `nom.dcAcAgsReviewLow`
 * and never hard-blocks, so `dcAcFailAbove` is intentionally omitted (no block)
 * — that is what clears the DC/AC drift while keeping the designer in control.
 *
 * @param {Object} nom            loaded NOM constants (02_LoadDB)
 * @param {Object} clientDefaults CLIENT_FIN_DEFAULTS (31a_RunClientFinancials)
 * @param {Object} [opts]         { bankabilityModeled, bessSohEolModeled } overrides
 * @return {Object} agsConformanceReport result
 */
function agsConformanceFromNom(nom, clientDefaults, opts) {
  nom = nom || {}; clientDefaults = clientDefaults || {}; opts = opts || {};
  var observed = {
    // DC/AC: engine now flags from the AGS review-low and never blocks.
    dcAcReviewAbove:     (nom.dcAcAgsReviewLow !== undefined) ? nom.dcAcAgsReviewLow : 1.35,
    // dcAcFailAbove deliberately omitted -> no hard block to report.
    panelDegradationPct: clientDefaults.panelDegradationPct,
    dcCurrentFactor:     (nom.currentFactor1 !== undefined) ? nom.currentFactor1 : nom.dcCurrentFactor,
    bessRtePct:          (opts.bessRtePct !== undefined) ? opts.bessRtePct : 0.90,
    bessSohEolModeled:   (opts.bessSohEolModeled !== undefined) ? opts.bessSohEolModeled : false,
    bankabilityModeled:  (opts.bankabilityModeled !== undefined) ? opts.bankabilityModeled : false
  };
  return agsConformanceReport(observed);
}

// Apps Script has no module system; these are global by design. This export
// shim is a harmless no-op under Apps Script and lets Node tooling require the
// file directly if ever needed (the self-test rig eval-loads it, not require).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AGS_REGISTER: AGS_REGISTER, agsGet: agsGet, agsValue: agsValue, agsAll: agsAll,
    agsRegisterSelfCheck: agsRegisterSelfCheck, agsConformanceReport: agsConformanceReport,
    agsConformanceFromNom: agsConformanceFromNom
  };
}
