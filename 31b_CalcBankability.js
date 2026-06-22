// =============================================================================
// 31b_CalcBankability.js  —  AGS-207 generation bankability (P50/P75/P90/P99, σ)
// -----------------------------------------------------------------------------
// AGS conformance track — Task A4. INFORMATIVE ONLY: this module produces the
// bankable numbers a lender sizes debt against and a developer guarantees in a
// PPA. It NEVER gates emittability (project decision: no hard blocks).
//
// Pure FR-207 math (validated against AGS-207 §6 worked example) + a live
// wrapper that reads the engine's P50 annual energy and PV degradation.
//
//   FR-207-01  σ_total = √(Σ σ_i²)                  RSS of 1-sigma sources
//   FR-207-03  Pxx = P50 × (1 − z_xx × σ_total)     z: P75 .674 · P90 1.282 · P99 2.326
//   FR-207-04  σ_IAV(N) = σ_IAV / √N                debt-term (N-year) P90
//   FR-207-05  Eₙ = E₁ × (1 − d)^(n−1)              degradation-adjusted year-by-year
//   FR-207-06  guarantee ≤ 0.95 × P90(1)            contracted baseline
//   §5.6 class: <4% excellent · 4–6% good/bankable · 6–8% acceptable · >8% review
// =============================================================================

// One-sided normal z-factors (AGS-207 §3).
var AGS_Z = { P75: 0.674, P90: 1.282, P95: 1.645, P99: 2.326 };

// AGS-207 §5.1 typical C&I 1-sigma uncertainty defaults (fractions). Used when
// site/dataset-specific values are absent — the AGS directs replacing these with
// measured values where available. IAV is the only term that scales with N.
var AGS_SIGMA_DEFAULTS = {
  resource:      0.035,  // solar resource / irradiation model (2.0–4.0%)
  iav:           0.035,  // inter-annual variability (2.5–5.0%, scales 1/√N)
  transposition: 0.015,  // GHI -> POA (1.5–3.0%)
  model:         0.030,  // PV simulation / loss model (2.0–4.0%)
  soiling:       0.010,  // soiling variability (0.5–2.0%)
  degradation:   0.005,  // degradation uncertainty (0.3–1.0%)
  availability:  0.010,  // grid/inverter downtime (0.5–1.5%)
  powerRating:   0.0075  // module flash-test tolerance (0.5–1.0%)
};

/** PURE. RSS of the 1-sigma components (FR-207-01). Uses the given set as-is;
 *  pass null to use the AGS §5.1 defaults. */
function bankabilitySigmaRss(components) {
  var c = components || AGS_SIGMA_DEFAULTS;
  var sumSq = 0;
  Object.keys(c).forEach(function (k) { var v = Number(c[k]) || 0; sumSq += v * v; });
  return Math.sqrt(sumSq);
}

/** PURE. Pxx = P50 × (1 − z·σ) (FR-207-03). */
function bankabilityPxx(p50, z, sigma) { return p50 * (1 - z * sigma); }

/** PURE. σ_IAV(N) = σ_IAV / √N (FR-207-04). */
function bankabilitySigmaIavN(sigmaIav, N) {
  N = Math.max(1, Number(N) || 1);
  return (Number(sigmaIav) || 0) / Math.sqrt(N);
}

/** PURE. Degradation-adjusted value at year n (FR-207-05); n is 1-based. */
function bankabilityDegraded(value, d, year) {
  return value * Math.pow(1 - (Number(d) || 0), Math.max(0, (Number(year) || 1) - 1));
}

/** PURE. §5.6 classification from the 1-year σ_total (fraction). */
function bankabilityClass(sigma1) {
  if (!(sigma1 >= 0)) return { code: 'NOT_EVALUATED', label: 'Not evaluated', bankable: null };
  if (sigma1 <  0.04) return { code: 'EXCELLENT',  label: 'Excellent / investment grade', bankable: true };
  if (sigma1 <= 0.06) return { code: 'GOOD',       label: 'Good / bankable',              bankable: true };
  if (sigma1 <= 0.08) return { code: 'ACCEPTABLE', label: 'Acceptable / conditional',     bankable: true };
  return { code: 'REVIEW', label: 'Review -- uncertainty too high (sigma > 8%)', bankable: false };
}

/** PURE. Full forecast. `p50` is unit-agnostic (kWh or MWh; outputs match).
 *  opts: { components, degradation, tenorYears }. components null -> AGS defaults. */
function computeBankability(p50, opts) {
  opts = opts || {};
  if (!(p50 > 0)) return { evaluated: false, reason: 'no_p50', p50: p50 || 0 };

  var d     = Number(opts.degradation) || 0;
  var N     = Math.max(1, Number(opts.tenorYears) || 10);
  var comps = opts.components || AGS_SIGMA_DEFAULTS;

  var sigma1 = bankabilitySigmaRss(comps);

  // N-year: scale IAV by 1/√N, keep the others, recombine (FR-207-04).
  var compsN = {};
  Object.keys(comps).forEach(function (k) { compsN[k] = comps[k]; });
  if (comps.iav != null) compsN.iav = bankabilitySigmaIavN(comps.iav, N);
  var sigmaN = bankabilitySigmaRss(compsN);

  var p75   = bankabilityPxx(p50, AGS_Z.P75, sigma1);
  var p90_1 = bankabilityPxx(p50, AGS_Z.P90, sigma1);
  var p99   = bankabilityPxx(p50, AGS_Z.P99, sigma1);
  var p90_N = bankabilityPxx(p50, AGS_Z.P90, sigmaN);

  var cls = bankabilityClass(sigma1);
  return {
    evaluated: true,
    p50: p50, sigma1: sigma1, sigmaN: sigmaN,
    p75: p75, p90_1yr: p90_1, p90_Nyr: p90_N, p99: p99,
    p90YearN: bankabilityDegraded(p90_1, d, N),   // single-year P90 degraded to year N
    tenorYears: N, degradation: d,
    p50_p90_gapPct: (p50 - p90_1) / p50 * 100,
    guaranteeBaseline: 0.95 * p90_1,              // FR-207-06 (year-1 baseline)
    klass: cls.code, classLabel: cls.label, bankable: cls.bankable,
    sigmaSource: (opts.components ? 'site/override' : 'AGS-207 §5.1 defaults')
  };
}

/** LIVE. Read P50 annual energy + PV degradation from the workbook; compute the
 *  forecast with AGS §5.1 default uncertainties. NOT_EVALUATED if no P50. */
function runBankability(ss) {
  var p50 = 0;
  try { p50 = Number(_cfinReadEnergyKwh(ss)) || 0; } catch (e) {}
  if (!(p50 > 0)) { try { p50 = Number(readInput(ss, 'annualKwh')) || 0; } catch (e2) {} }

  var d = 0;
  try { d = Number(readInput(ss, 'panelDegradationPct')) || 0; } catch (e3) {}
  if (!(d > 0)) d = 0.005;   // engine default (CLIENT_FIN_DEFAULTS.panelDegradationPct)

  return computeBankability(p50, { degradation: d, tenorYears: 10 });
}

// Node export (no-op in Apps Script).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AGS_Z: AGS_Z, AGS_SIGMA_DEFAULTS: AGS_SIGMA_DEFAULTS,
    bankabilitySigmaRss: bankabilitySigmaRss, bankabilityPxx: bankabilityPxx,
    bankabilitySigmaIavN: bankabilitySigmaIavN, bankabilityDegraded: bankabilityDegraded,
    bankabilityClass: bankabilityClass, computeBankability: computeBankability,
    runBankability: runBankability
  };
}
