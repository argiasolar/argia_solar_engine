// =============================================================================
// ARGIA ENGINE -- 09b_OutputValidate.js
// -----------------------------------------------------------------------------
// POST-WRITE OUTPUT CONSISTENCY VALIDATION
//
// PURPOSE
//   Runs at the end of runArgiaEngine() (after all writers have completed)
//   and asserts the four customer-facing output sheets agree on what
//   project they represent. Catches the bug class where MDC is fresh from
//   the current run but BOM / INSTALLATION / PROJECT_CARD still hold
//   output from a previous run -- the workbook looks normal but is
//   internally inconsistent and customer-quote-dangerous.
//
// HISTORICAL TRIGGER
//   2026-05-22: discovered ARGIA_ENGINE__29_ workbook had MDC showing
//   CULLIGAN (1350 panels) while BOM / INSTALLATION / PROJECT_CARD
//   still held TESTPROJ-001 (720 panels) from a regression-test run.
//   The test framework restored INPUT sheets but did not restore output
//   sheets. Nothing in the system detected the mismatch -- a designer
//   would have read MDC at face value and sent a $194k BOM for a project
//   that engineering memo described as 1350 panels. ~$170k under-quote.
//
//   The test framework is being fixed separately (Item 2: output-sheet
//   backup/restore in TestSheetBackup.gs). THIS file is the in-production
//   guard that catches the BUG CLASS regardless of how it gets created.
//
// SCOPE -- V1
//   Checks four output sheets: MDC, BOM, INSTALLATION, PROJECT_CARD.
//   CFE_OUTPUT and RFQ_* deferred to V2 (their identity columns are
//   less standardized; not needed to catch the bug class we hit).
//
// CHECKS
//   1. IDENTITY -- project name agrees across the four sheets
//   2. SCALE    -- module count agrees across MDC, INSTALLATION
//                  (PROJECT_CARD module count read from scope-of-work
//                   row by panel-label lookup, not fixed cell coord --
//                   the PC layout has variable rows so a fixed-cell
//                   approach would be brittle)
//   3. SCALE    -- inverter count agrees between MDC and INSTALLATION
//                  (PROJECT_CARD inverter rows are model-grouped, not
//                   summed -- intentionally excluded; see "WHY NOT PC
//                   INVERTERS" below)
//
// EMPTY-SHEET HANDLING
//   If a sheet's identity cell is empty (sheet never written, or
//   cleared via the Reset menu), the check is recorded as INFO not
//   CRITICAL. The bug we hunt is "two populated sheets disagree" --
//   "one sheet unwritten" is a different (acceptable) state.
//
// RETURN SHAPE
//   {
//     critical: [string, ...]   // mismatch messages requiring user attention
//     info:     [string, ...]   // empty-sheet skips, version notes
//     ok:       [string, ...]   // successful checks (for transparency)
//     message:  string          // human-readable summary, used in alert
//     passed:   boolean         // true iff critical.length === 0
//   }
//
// WHY THIS RUNS AT END, NOT MID-PIPELINE
//   Inputs validate at start (09_Validate.js). Outputs validate at end --
//   they only exist after writers finish. Mid-pipeline checks would fire
//   false-positive on legitimate partial state.
//
// WHY ALERT + LOG, NOT THROW
//   By the time this runs, writers are done. Throwing would not undo
//   anything -- it would just leave the workbook in the same state with
//   an uglier exit. Alert + log is the loud-but-non-destructive signal.
//
// WHY NOT PC INVERTERS
//   PROJECT_CARD writes one row per UNIQUE inverter model under SCOPE
//   OF WORK (see 14_WriteProjectCard.js line 294, the invBank.forEach).
//   For CULLIGAN: row 15 = SUN2000-100KTL-M1 qty=1, row 16 =
//   SUN2000-150K-MG0 qty=4. Total = 5. To validate, we'd need to scan a
//   row range, parse "N pcs" strings, sum -- fragile to layout changes
//   and not needed to catch the bug class (project-name + module-count
//   already differentiate two different projects). Deferred.
// =============================================================================

var OUT_VALIDATE_MODULE = 'OutputValidate';


/**
 * Read a cell and return a trimmed string, or empty string if blank.
 * Reads value() not formula(), so any formula-derived label is honored.
 */
function _ov_str(sh, a1) {
  try {
    var v = sh.getRange(a1).getValue();
    return v == null ? '' : String(v).trim();
  } catch (e) {
    return '';
  }
}


/**
 * Read a cell and return a number, or null if blank / non-numeric.
 */
function _ov_num(sh, a1) {
  try {
    var v = sh.getRange(a1).getValue();
    if (v == null || v === '') return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  } catch (e) {
    return null;
  }
}


/**
 * Find a row in PROJECT_CARD where col B contains the panel brand/model
 * and col D contains "<qty> pcs". Returns the parsed module count, or
 * null if not found (sheet empty, layout changed, panel not yet written).
 *
 * PROJECT_CARD does not have a fixed-row "module count" cell -- the panel
 * label lives in the SCOPE OF WORK block whose start row depends on
 * preceding section sizes. We search rows 12-30 (covers all realistic
 * SCOPE OF WORK positions seen across our test projects).
 */
function _ov_findPcModuleCount(pcSheet) {
  for (var r = 12; r <= 30; r++) {
    var label = _ov_str(pcSheet, 'B' + r);
    var qty   = _ov_str(pcSheet, 'D' + r);
    // The panel row label always contains a wattage like "640W"; the qty
    // string is always "<integer> pcs". Match both to avoid picking up
    // the structure row (which also lives in this block).
    if (/\d+W\b/.test(label) && /^\d+\s*pcs$/i.test(qty)) {
      var n = parseInt(qty.replace(/[^\d]/g, ''), 10);
      return isNaN(n) ? null : n;
    }
  }
  return null;
}


/**
 * Main entry. Returns the result object documented in the file header.
 *
 * @param {Spreadsheet} ss
 * @returns {{critical: string[], info: string[], ok: string[], message: string, passed: boolean}}
 */
function validateOutputConsistency(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();

  var result = { critical: [], info: [], ok: [], message: '', passed: true };

  // ─── Sheet existence ───────────────────────────────────────────────────
  var mdc  = ss.getSheetByName('MDC');
  var bom  = ss.getSheetByName('BOM');
  var inst = ss.getSheetByName('INSTALLATION');
  var pc   = ss.getSheetByName('PROJECT_CARD');

  if (!mdc)  { result.info.push('MDC sheet not present -- skipping all checks'); }
  if (!bom)  { result.info.push('BOM sheet not present -- skipping BOM checks'); }
  if (!inst) { result.info.push('INSTALLATION sheet not present -- skipping INSTALL checks'); }
  if (!pc)   { result.info.push('PROJECT_CARD sheet not present -- skipping PC checks'); }

  if (!mdc) {
    // Nothing to compare against -- MDC is the canonical source. Bail.
    result.message = 'MDC sheet absent -- consistency check skipped.';
    return result;
  }

  // ─── Read identity values ──────────────────────────────────────────────
  var mdcProj   = _ov_str(mdc, 'C7');
  var mdcClient = _ov_str(mdc, 'C8');
  var mdcMods   = _ov_num(mdc, 'C11');
  var mdcInvs   = _ov_num(mdc, 'C12');

  if (!mdcProj) {
    result.info.push('MDC.C7 project name empty -- MDC not yet written. Skipping checks.');
    result.message = 'MDC not written -- consistency check skipped.';
    return result;
  }

  // ─── CHECK 1: project name agreement ──────────────────────────────────
  // BOM stores project name inside a banner string at A4: "BOM -- <PROJ> | <CLIENT> | ..."
  // We use "contains" semantics to be robust to banner-format changes.
  if (bom) {
    var bomTitle = _ov_str(bom, 'A4');
    if (!bomTitle) {
      result.info.push('BOM not yet written (A4 empty).');
    } else if (bomTitle.indexOf(mdcProj) === -1) {
      result.critical.push(
        'PROJECT MISMATCH: MDC says "' + mdcProj + '" but BOM banner ' +
        'does not contain that project name. BOM banner reads: "' +
        bomTitle.substring(0, 80) + '"' +
        (bomTitle.length > 80 ? '...' : '')
      );
    } else {
      result.ok.push('Project name agrees: MDC <-> BOM');
    }
  }

  if (pc) {
    var pcProj = _ov_str(pc, 'C5');
    if (!pcProj) {
      result.info.push('PROJECT_CARD not yet written (C5 empty).');
    } else if (pcProj !== mdcProj) {
      result.critical.push(
        'PROJECT MISMATCH: MDC says "' + mdcProj + '" but ' +
        'PROJECT_CARD.C5 says "' + pcProj + '"'
      );
    } else {
      result.ok.push('Project name agrees: MDC <-> PROJECT_CARD');
    }
  }

  // INSTALLATION has no canonical project-name cell in its current layout.
  // It carries scale values (modules, kWp) but not the project name string.
  // Identity-by-scale below catches mismatches involving INSTALL.

  // ─── CHECK 2: module count agreement ───────────────────────────────────
  if (mdcMods == null) {
    result.info.push('MDC.C11 module count empty -- skipping module-count checks.');
  } else {
    if (inst) {
      var instMods = _ov_num(inst, 'B8');
      if (instMods == null) {
        result.info.push('INSTALLATION.B8 module count empty -- INSTALL not yet written.');
      } else if (instMods !== mdcMods) {
        result.critical.push(
          'MODULE COUNT MISMATCH: MDC says ' + mdcMods +
          ' modules, INSTALLATION says ' + instMods + ' modules'
        );
      } else {
        result.ok.push('Module count agrees: MDC <-> INSTALLATION (' + mdcMods + ')');
      }
    }

    if (pc) {
      var pcMods = _ov_findPcModuleCount(pc);
      if (pcMods == null) {
        result.info.push('PROJECT_CARD module count not found in scope rows -- PC not yet written or layout changed.');
      } else if (pcMods !== mdcMods) {
        result.critical.push(
          'MODULE COUNT MISMATCH: MDC says ' + mdcMods +
          ' modules, PROJECT_CARD scope row says ' + pcMods + ' modules'
        );
      } else {
        result.ok.push('Module count agrees: MDC <-> PROJECT_CARD (' + mdcMods + ')');
      }
    }
  }

  // ─── CHECK 3: inverter count agreement (MDC <-> INSTALLATION only) ─────
  if (mdcInvs == null) {
    result.info.push('MDC.C12 inverter count empty -- skipping inverter-count checks.');
  } else if (inst) {
    var instInvs = _ov_num(inst, 'B9');
    if (instInvs == null) {
      result.info.push('INSTALLATION.B9 inverter count empty -- INSTALL not yet written.');
    } else if (instInvs !== mdcInvs) {
      result.critical.push(
        'INVERTER COUNT MISMATCH: MDC says ' + mdcInvs +
        ' inverters, INSTALLATION says ' + instInvs + ' inverters'
      );
    } else {
      result.ok.push('Inverter count agrees: MDC <-> INSTALLATION (' + mdcInvs + ')');
    }
  }

  // ─── Build summary message ─────────────────────────────────────────────
  result.passed = (result.critical.length === 0);

  var lines = [];
  if (result.passed) {
    lines.push('OUTPUT CONSISTENCY: PASS');
    lines.push('Checked ' + result.ok.length + ' invariant(s) across ' +
               'MDC / BOM / INSTALLATION / PROJECT_CARD.');
    if (result.info.length > 0) {
      lines.push('');
      lines.push('Skipped (sheet not yet written or layout note):');
      result.info.forEach(function (m) { lines.push('  - ' + m); });
    }
  } else {
    lines.push('OUTPUT CONSISTENCY: CRITICAL MISMATCH');
    lines.push('');
    lines.push(result.critical.length + ' mismatch(es) detected. The output sheets do');
    lines.push('not agree on what project they represent. DO NOT use these sheets');
    lines.push('for customer deliverables until corrected.');
    lines.push('');
    lines.push('Mismatches:');
    result.critical.forEach(function (m) { lines.push('  - ' + m); });
    lines.push('');
    lines.push('Most likely cause: test fixtures wrote to output sheets and the');
    lines.push('engine has not yet re-run on real project inputs. Run ARGIA -> ');
    lines.push('Reset -> Reset Outputs, then re-run the engine and writers.');
    lines.push('');
    lines.push('See LOGS sheet for full detail.');
  }
  result.message = lines.join('\n');

  return result;
}


/**
 * Run the validator and emit results to LOGS + a UI alert on critical.
 * This is the function runArgiaEngine() calls at end of run.
 *
 * Failure of the validator itself never breaks the engine -- the whole
 * call is wrapped in try/catch by the caller (matches Step 9.5 / 13.5
 * pattern).
 *
 * @param {Spreadsheet} ss
 * @param {{showAlert: boolean}} [opts] -- showAlert defaults to true.
 *        Set false in headless test contexts where no UI is available.
 * @returns {object} the result object from validateOutputConsistency
 */
function runOutputConsistencyCheck(ss, opts) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  opts = opts || {};
  var showAlert = (opts.showAlert !== false);  // default true

  var result = validateOutputConsistency(ss);

  // Log every CRITICAL line individually (color-coded red in LOGS)
  result.critical.forEach(function (msg) {
    engineLog(ss, OUT_VALIDATE_MODULE, 'CRITICAL', msg);
  });

  // Log OKs once as a summary (avoid flooding LOGS with green lines)
  if (result.passed && result.ok.length > 0) {
    engineLog(ss, OUT_VALIDATE_MODULE, 'OK',
      'All ' + result.ok.length + ' output-consistency checks passed: ' +
      result.ok.join('; '));
  }

  // Log INFOs as a summary (skipped sheets are routine, not noteworthy)
  if (result.info.length > 0) {
    engineLog(ss, OUT_VALIDATE_MODULE, 'INFO',
      result.info.length + ' check(s) skipped: ' + result.info.join('; '));
  }

  // Alert popup only on critical
  if (!result.passed && showAlert) {
    try {
      SpreadsheetApp.getUi().alert(
        'OUTPUT CONSISTENCY -- ATTENTION REQUIRED',
        result.message,
        SpreadsheetApp.getUi().ButtonSet.OK
      );
    } catch (uiErr) {
      // No UI context (running headless / from trigger) -- log fallback
      engineLog(ss, OUT_VALIDATE_MODULE, 'WARNING',
        'UI alert suppressed (no UI context): ' + uiErr.message);
    }
  }

  return result;
}
