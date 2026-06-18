// =============================================================================
// 37_CalcProvenance.js  —  reusable output-provenance note helper
// -----------------------------------------------------------------------------
// T11 (v4.47.0). Generalizes the FINANCE 4.32 provenance pattern: any key output
// figure can carry a plain-language note saying where it came from (label,
// derivation, sources, engine version/date). Sales-readiness + audit.
//
//   buildProvenanceNote(rec)  PURE  -- {label, formula, sources, version, date}
//                                      -> ASCII-safe Spanish note string
//   stampProvenanceNote(rng, rec)    -- guarded setNote (no-op on a mock range)
//
// ASCII-safe: fixed labels carry no accents; callers pass ASCII-safe content
// (\u escapes for accented Spanish, per engine convention). setNote is guarded
// with `typeof rng.setNote === 'function'` so unit-test mock ranges never throw.
// =============================================================================

// PURE. Format a provenance record into a multi-line note. Omits any empty field
// so a sparse record yields a compact note (empty record -> '').
function buildProvenanceNote(rec) {
  rec = rec || {};
  var out = [];
  if (rec.label)   out.push('TRAZABILIDAD: ' + rec.label);
  if (rec.formula) out.push('Calculo: ' + rec.formula);
  if (rec.sources) {
    var s = Array.isArray(rec.sources) ? rec.sources.join(', ') : String(rec.sources);
    if (s) out.push('Fuente: ' + s);
  }
  var ver = (rec.version != null && rec.version !== '')
    ? rec.version
    : (typeof ENGINE_VERSION !== 'undefined' ? ENGINE_VERSION : '');
  var footer = [];
  if (ver)      footer.push('Motor v' + ver);
  if (rec.date) footer.push(String(rec.date));
  // Footer (version/date) is metadata on real provenance content -- never emit
  // a bare version-only note for an empty record.
  if (footer.length && out.length) out.push(footer.join(' - '));
  return out.join('\n');
}

// LIVE (guarded). Stamp the note onto a range. Returns true if written, false
// if the range can't take a note (mock range / null). Never throws.
function stampProvenanceNote(rng, rec) {
  if (rng && typeof rng.setNote === 'function') {
    rng.setNote(buildProvenanceNote(rec));
    return true;
  }
  return false;
}
