// =============================================================================
// ARGIA -- 30a_ReadInputsBaas.js
// -----------------------------------------------------------------------------
// CHUNK 6 -- BaaS Economics Engine
//
// INPUT_BAAS reader + sheet setup. READER ONLY -- reads the INPUT_BAAS sheet
// and returns a typed baasInputs{} object. Does not calculate, does not write
// results (only setupInputBaasSheet creates the sheet skeleton + defaults).
//
// Per the design sign-off:
//   - ARGIA target IRR and discount rate (WACC) live in INPUT_BAAS because
//     they differ per deal (aggressive tender vs one-time deal).
//   - Tax benefit is solar-CAPEX-driven and conditional: only customers
//     that can actually utilize it (have taxable profit). A toggle +
//     disclaimer govern it.
//   - Everything else has a sensible default the designer can override.
// =============================================================================

// ---------------------------------------------------------------------------
// Cell map for INPUT_BAAS (label in col B, value in col C).
// Rows start at 8 (not 4) so the logo/title block (rows 1-4) and the section
// header (row 6) have the same breathing room as every other input sheet.
// The reader reads col C on these rows; setup writes labels/values here.
// ---------------------------------------------------------------------------
var INPUT_BAAS_ROWS = {
  HEADER:               2,   // title block (logo B2:C3, title D2)
  SECTION_1:            6,   // section header row
  LEASE_TERM:           8,   // years
  LEASE_TYPE:           9,   // FINANCIERO | PURO
  PAYMENT_ESC_FIXED:    10,  // financiero fixed escalation (e.g. 0.04)
  INPC_ESC:             11,  // puro INPC escalation (e.g. 0.05)
  BILL_ESC:             12,  // CFE bill escalation (e.g. 0.07)
  SAVINGS_ESC:          13,  // bill-savings escalation (e.g. 0.04)
  TARGET_IRR:           14,  // ARGIA target IRR (per deal)
  DISCOUNT_RATE:        15,  // ARGIA WACC (per deal)
  OM_COST_YEAR:         16,  // O&M MXN/year (often bundled = 0)
  REPL_RESERVE_YEAR:    17,  // battery replacement reserve MXN/year
  TAX_BENEFIT_RATE:     18,  // ISR rate for solar CAPEX deduction (e.g. 0.30)
  TAX_AMORT_YEARS:      19,  // years to amortize the benefit (e.g. 10)
  CUSTOMER_CAN_USE_TAX: 20,  // YES | NO -- customer has taxable profit to use it
  FX_RATE:              21   // MXN/USD assumption (e.g. 18.20)
};

// ---------------------------------------------------------------------------
// readInputBaas(ss) -> baasInputs{}
// Always returns an object (defaults when the sheet/cells are blank).
// ---------------------------------------------------------------------------
function readInputBaas(ss) {
  ss = ss || SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('INPUT_BAAS');
  var R = INPUT_BAAS_ROWS;
  // Value column is D (col 4) -- the house standard now that INPUT_BAAS is
  // rendered by _setupOneTab via INPUT_MAP (label B:C, value D, hint E).
  var VALUE_COL = 4;

  function readNum(row, dflt) {
    if (!sh) return dflt;
    var v = Number(sh.getRange(row, VALUE_COL).getValue());
    return isFinite(v) && v !== 0 ? v
      : (sh.getRange(row, VALUE_COL).getValue() === 0 ? 0 : dflt);
  }
  function readStr(row, dflt) {
    if (!sh) return dflt;
    var v = String(sh.getRange(row, VALUE_COL).getValue() || '').trim();
    return v || dflt;
  }
  function readYesNo(row, dflt) {
    if (!sh) return dflt;
    var v = String(sh.getRange(row, VALUE_COL).getValue() || '').trim().toUpperCase();
    if (v === 'YES' || v === 'SI' || v === 'SÍ') return true;
    if (v === 'NO') return false;
    return dflt;
  }

  return {
    leaseTermYears:         Math.round(readNum(R.LEASE_TERM, 15)),
    leaseType:              (readStr(R.LEASE_TYPE, 'FINANCIERO').toUpperCase() === 'PURO')
                              ? 'PURO' : 'FINANCIERO',
    paymentEscalationPct:   readNum(R.PAYMENT_ESC_FIXED, 0.04),
    inpcEscalationPct:      readNum(R.INPC_ESC, 0.05),
    billEscalationPct:      readNum(R.BILL_ESC, 0.07),
    savingsEscalationPct:   readNum(R.SAVINGS_ESC, 0.04),
    targetIrr:              readNum(R.TARGET_IRR, 0.15),
    discountRate:           readNum(R.DISCOUNT_RATE, 0.12),
    omCostMxnPerYear:       readNum(R.OM_COST_YEAR, 0),
    replacementReserveMxnPerYear: readNum(R.REPL_RESERVE_YEAR, 0),
    taxBenefitRate:         readNum(R.TAX_BENEFIT_RATE, 0.30),
    taxAmortYears:          Math.round(readNum(R.TAX_AMORT_YEARS, 10)),
    customerCanUseTaxBenefit: readYesNo(R.CUSTOMER_CAN_USE_TAX, false),
    fxRate:                 readNum(R.FX_RATE, 18.20),
    provenance:             sh ? 'INPUT_BAAS' : 'DEFAULTS_NO_SHEET'
  };
}


// ---------------------------------------------------------------------------
// setupInputBaasSheet(force) -- create/rebuild INPUT_BAAS via the shared
// _setupOneTab renderer (same machinery as INPUT_PROJECT / INPUT_INSTALL /
// INPUT_BESS). INPUT_BAAS's fields live in INPUT_MAP (_MAP_BAAS), so this
// gets the logo, section header, col-D values, format hints, dropdowns, and
// validation for free -- identical look to every other input sheet.
//
// Signature mirrors the other setup entrypoints: force=true overwrites an
// existing sheet that has user data; otherwise _setupOneTab guards it.
// Back-compat: a no-arg call during an engine run returns an existing sheet
// untouched (never clobbers values mid-run).
// ---------------------------------------------------------------------------
function setupInputBaasSheet(force) {
  var ss = SpreadsheetApp.getActive();

  // Coerce the argument defensively. The first arg is `force` (boolean), but
  // a caller may habitually pass `ss` (a Spreadsheet object) the way readers
  // take ss -- which would be truthy and could trigger an unwanted rebuild.
  // Only an explicit boolean true forces a rebuild; anything else (no arg, a
  // Spreadsheet object, undefined, false) means "ensure it exists, leave an
  // existing sheet untouched". This makes the function impossible to foot-gun
  // into deleting+relocating the tab on every engine/projection run.
  var forceRebuild = (force === true);
  var wantEnsureOnly = !forceRebuild;

  if (wantEnsureOnly) {
    var pre = ss.getSheetByName('INPUT_BAAS');
    if (pre) return pre;   // exists -> untouched (no delete, no tab move)
    // missing -> fall through to create it (force stays false)
  }

  var sh = _setupOneTab(SH.INPUT_BAAS, 'INPUT BAAS', forceRebuild);
  _baasAppendDisclaimer(sh);
  return sh;
}

// Disclaimer note about the tax benefit, appended below the inputs. Rendered
// after _setupOneTab so it survives the rebuild. Uses shared callout tokens.
function _baasAppendDisclaimer(sh) {
  if (!sh) return;
  var noteRow = INPUT_BAAS_ROWS.FX_RATE + 2;   // two rows below the last field
  sh.getRange(noteRow, 2, 1, 6).breakApart().merge()
    .setValue('NOTA: El beneficio fiscal solo aplica al arrendamiento FINANCIERO '
            + 'y únicamente si el cliente tiene utilidad fiscal suficiente para '
            + 'aprovechar la deducción del CAPEX solar. Confirme con el asesor '
            + 'fiscal del cliente. Si no es aprovechable, ponga "NO" arriba.')
    .setFontFamily(token('FONT_FAMILY'))
    .setFontStyle('italic').setFontSize(tokenNum('FONT_SIZE_SMALL')).setWrap(true)
    .setBackground(token('BG_CALLOUT')).setFontColor(token('STATUS_WARN'));
}
