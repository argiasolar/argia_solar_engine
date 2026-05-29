// =============================================================================
// ARGIA -- 00c_SetupSectionGuard.js
// -----------------------------------------------------------------------------
// CHUNK 7 (hardening) -- a shared, defensive helper for the idempotent
// "setup section" scripts (SOLAR / RESILIENCE / BaaS / future 4B).
//
// WHY THIS EXISTS:
//   The setup scripts placed a section at hardcoded rows and wrote both the
//   column-B LABEL and the column-C/D VALUE. The value had a never-overwrite
//   guard, but the LABEL was written unconditionally ("labels are cosmetic,
//   safe to set"). That assumption was WRONG: when a setup's rows collided
//   with a pre-existing section (the INPUT_BESS "6. DISTANCIAS" incident),
//   the unconditional label write clobbered the existing section's labels
//   while the value-guard silently skipped the values -- producing a mangled,
//   half-overwritten section that the unit tests (mocks) couldn't see.
//
// WHAT THIS DOES:
//   writeSectionCell() makes BOTH the label and the value collision-aware:
//     - LABEL (col B): written only if the cell is blank OR already equals
//       the intended label. If it holds DIFFERENT content => COLLISION:
//       refuse to write, record it, and (by default) THROW so the caller
//       aborts before corrupting more rows.
//     - VALUE (col C/D): unchanged never-overwrite semantics (write only if
//       blank), but now also reports whether the cell was a collision-risk.
//
//   The intent: a setup script can NEVER again silently overwrite another
//   section's labels. If the target rows aren't what the script expects, it
//   stops loudly instead of mangling the sheet.
// =============================================================================

// ---------------------------------------------------------------------------
// _normalizeCell(v) -> trimmed string for comparison ('' for blank/null).
// ---------------------------------------------------------------------------
function _ssgNormalize(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

// ---------------------------------------------------------------------------
// writeSectionLabel(sh, row, col, intendedLabel, ctx)
//   Collision-aware label write. Returns one of:
//     'written'   -- cell was blank, label written
//     'matched'   -- cell already held the intended label (idempotent no-op)
//     'collision' -- cell held DIFFERENT content; NOT written
//   ctx (optional): { collisions: [], onCollision: 'throw'|'skip' }
//     - collisions array is appended with {row, col, expected, found}
//     - onCollision 'throw' (default) throws after recording; 'skip' returns
//       'collision' and lets the caller decide.
// ---------------------------------------------------------------------------
function writeSectionLabel(sh, row, col, intendedLabel, ctx) {
  ctx = ctx || {};
  var current = _ssgNormalize(sh.getRange(row, col).getValue());
  var intended = _ssgNormalize(intendedLabel);

  if (current === '') {
    sh.getRange(row, col).setValue(intendedLabel);
    return 'written';
  }
  if (current === intended) {
    return 'matched';   // idempotent re-run -- safe, nothing to do
  }

  // Different content already there -> COLLISION. Do NOT overwrite.
  var info = { row: row, col: col, expected: intended, found: current };
  if (ctx.collisions) ctx.collisions.push(info);
  if ((ctx.onCollision || 'throw') === 'throw') {
    throw new Error(
      'SETUP COLLISION at R' + row + 'C' + col + ': expected to write "'
      + intended + '" but cell already holds "' + current + '". '
      + 'Aborting setup to avoid clobbering an existing section. '
      + 'Pick empty rows or relocate the section.');
  }
  return 'collision';
}

// ---------------------------------------------------------------------------
// writeSectionValue(sh, row, col, defaultValue)
//   Never-overwrite value write (unchanged semantics, centralized).
//   Returns 'written' (was blank) or 'skipped' (already had a value).
// ---------------------------------------------------------------------------
function writeSectionValue(sh, row, col, defaultValue) {
  var current = sh.getRange(row, col).getValue();
  var isBlank = (current === '' || current === null || current === undefined);
  if (isBlank) {
    sh.getRange(row, col).setValue(defaultValue);
    return 'written';
  }
  return 'skipped';
}

// ---------------------------------------------------------------------------
// guardSectionRowsEmpty(sh, labelCol, rows, ctx)
//   Pre-flight check: BEFORE writing anything, scan the intended label cells.
//   If ANY of them already holds content that doesn't match what this setup
//   intends to write there, it's a collision -- report all of them and throw
//   (or, with onCollision:'skip', return the list). This lets a setup verify
//   its whole target range is safe before touching a single cell, so a
//   partial mangle can't happen.
//
//   @param rows array of { row, label } -- the intended label for each row
//   @return { ok: bool, collisions: [...] }
// ---------------------------------------------------------------------------
function guardSectionRowsEmpty(sh, labelCol, rows, ctx) {
  ctx = ctx || {};
  var collisions = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i].row, label = _ssgNormalize(rows[i].label);
    var current = _ssgNormalize(sh.getRange(row, labelCol).getValue());
    if (current !== '' && current !== label) {
      collisions.push({ row: row, col: labelCol, expected: label, found: current });
    }
  }
  if (collisions.length) {
    if ((ctx.onCollision || 'throw') === 'throw') {
      var first = collisions[0];
      throw new Error(
        'SETUP PRE-FLIGHT COLLISION: ' + collisions.length + ' target row(s) '
        + 'already hold other content. First: R' + first.row + 'C' + first.col
        + ' has "' + first.found + '" (expected to place "' + first.expected
        + '"). Aborting before any write. Relocate the section to empty rows.');
    }
    return { ok: false, collisions: collisions };
  }
  return { ok: true, collisions: [] };
}
