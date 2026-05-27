# ARGIA Solar Engine — Output v2 Migration Plan

> Source-of-truth document for migrating every output writer to v2 architecture.
> Modeled on `ARGIA_BESS_PLAN.md`. Each phase ships with unit tests written
> alongside; integration/regression verification runs at phase boundaries
> (not per file). Engine baseline at planning: v2.3.5, DB 2026.05.

---

## 1. Why this exists

Three problems with the current output layer, learned in this conversation:

1. **Layout and data are intermingled in writers.** Most writers do both
   structural setup (fonts, borders, merges, banners) and data writing in one
   pass. The only exception is MDC, which has `setupMDCTemplate` separate from
   `writeMDC` — and MDC is the model. Every other writer mixes the two.

2. **No clean "reset" path.** Because layout lives inside writers, the only
   way to "reset" an output sheet today is to overwrite it. There is no way
   to delete the sheet content cleanly and rebuild from a known template.
   The user-facing Reset feature can't be built cleanly on top of the
   current architecture.

3. **BESS line items are missing from MDC, BOM, INSTALLATION, RFQs.** Adding
   them under the current architecture means modifying every legacy writer.
   That work is wasted if we then refactor for architecture later.

The v2 migration solves all three in one motion: rebuild each writer with
template/data separation AND add BESS at the same time.

---

## 2. Strategy

### Two parallel codebases

Legacy writers and v2 writers coexist throughout the migration. They share
**no writer code**, **no helpers**, **no template definitions**. They share
only:

- Read-only access to INPUT_* sheets (inputs are upstream data, not part of
  writer architecture)
- Design tokens (`_DESIGN_TOKENS` sheet via `02a_DesignTokens.js`) — these
  are global theme constants, infrastructure, not writer logic
- Layout primitives (`02b_LayoutPrimitives.js`) — same reasoning

Tokens and primitives are explicitly designed as infrastructure shared by
"writers and every input-template function" per their file headers. They
predate this plan and are correctly scoped already.

### Parallel output sheets

v2 writes to suffix sheets:

```
MDC          MDC_v2
BOM          BOM_v2
INSTALLATION INSTALLATION_v2
PROJECT_CARD PROJECT_CARD_v2
CFE_OUTPUT   CFE_OUTPUT_v2
RFQ_PANELES    RFQ_PANELES_v2
RFQ_INVERSORES RFQ_INVERSORES_v2
RFQ_ESTRUCTURA RFQ_ESTRUCTURA_v2
RFQ_ELECTRICO  RFQ_ELECTRICO_v2
RFQ_MONITOREO  RFQ_MONITOREO_v2
```

Both visible during transition. Side-by-side visual comparison is a primary
verification tool.

### Out of scope

- `30_ArgiaKicker.js` (slide deck generator)
- `SLIDE_DATA` sheet
- Any v2 of these

These will be developed separately in a different timeframe and are not
touched by this plan.

### Cutover model: atomic ("Flavor 1")

Legacy stays in production for the **entire** migration. `runArgiaEngine()`
calls v2 writers in addition to legacy writers, but legacy output is the
source of truth. Cutover happens in **one atomic step at the end**:

1. All 10 v2 writers complete, verified individually
2. CULLIGAN baseline locked against v2 outputs
3. One PR: switch engine to call v2 writers only, delete all legacy writer
   files, rename `MDC_v2` → `MDC` (etc.) for every sheet
4. The "v2" suffix and the entire legacy writer codebase disappear in one
   commit

No feature flags. No half-migrated state in production.

---

## 3. Architecture

### Template/data separation

Every output sheet has two functions:

**Template function** (`setupXTemplate(ss)`):
- Creates the sheet if missing, or clears it if present
- Inserts banner / logo / column headers / section labels
- Sets column widths, row heights, freezing, merges
- Sets number formats, font weights, borders, colors
- Defines named ranges if used
- Idempotent: running twice has the same effect as running once
- Pure setup — never reads INPUT_* or calc results

**Data writer** (`writeXv2(ss, inp, panel, invBank, dc, ac, lay, nom, bessResult)`):
- Assumes the template is already in place
- Writes values into known cells only
- No layout work — no `setBackground`, no `setBorder`, no `merge` calls
- One pass: receive data, set values, return

The signature mirrors the existing `writeMDC` so we don't reinvent the
engine-to-writer contract.

### Folder structure

v2 code lives in a clean folder structure from day one. Legacy stays flat
at the repo root.

```
core/         (unchanged: 00_Main.js, 10_Logger.js, etc.)
input/        (unchanged: 01_ReadInputs.js, 02c_InputMap.js, etc.)
calc/         (unchanged: 04_CalcDC.js, 05_CalcAC.js, etc.)
bess/         (unchanged: 17_CalcBessSizing.js, etc.)
db/           (unchanged: 02_LoadDB.js, 03_ElecTables.js)

templates/    (NEW — template framework + per-sheet template setups)
  TemplateRegistry.js
  setupMdcTemplate.js
  setupBomTemplate.js
  setupInstallationTemplate.js
  setupProjectCardTemplate.js
  setupCfeOutputTemplate.js
  setupRfqTemplate.js          (shared by all 5 RFQs)

writers_v2/   (NEW — v2 data writers, one per sheet)
  WriteMdcV2.js
  WriteBomV2.js
  WriteInstallationV2.js
  WriteProjectCardV2.js
  WriteCfeOutputV2.js
  WriteRfqV2.js                (shared by all 5 RFQs)

workflows/    (NEW — orchestration entry points)
  ResetOutputs.js              (deletes v2 sheets, calls setup functions)
  RunEngineV2.js               (parallel engine path during migration)

tests_unit/writers_v2/         (unit tests for v2 writers)
tests_regression/v2/           (CULLIGAN baseline locked against v2 outputs)
```

**Legacy stays at root.** No moves, no renames. When migration completes,
legacy files are deleted in the cutover commit and the root is left with
only the engine-entry files that were never writer code.

### File naming convention

| Type | Pattern | Example |
|---|---|---|
| Template setup | `setup<Sheet>Template.js` | `setupMdcTemplate.js` |
| v2 data writer | `Write<Sheet>V2.js` | `WriteBomV2.js` |
| Template setup function | `setup<Sheet>Template(ss)` | `setupMdcTemplate(ss)` |
| v2 data writer function | `write<Sheet>V2(ss, ...)` | `writeBomV2(ss, inp, ...)` |
| v2 sheet name | `<NAME>_v2` | `MDC_v2`, `RFQ_PANELES_v2` |

Lowercase v2 in sheet names matches your specification.

### Engine integration during transition

`runArgiaEngine()` runs both paths. After every legacy writer call, the
equivalent v2 writer runs immediately. Each v2 call is wrapped in its own
try/catch matching the Step 9.5 / 13.5 pattern: a v2 bug never breaks the
legacy path.

```javascript
// Step 7 (legacy)
writeMDC(ss, inp, panel, invBank, dc, ac, lay, nom, bessResult);

// Step 7-v2 (parallel during transition)
try {
  setupMdcTemplate(ss);           // idempotent — safe to call every run
  writeMdcV2(ss, inp, panel, invBank, dc, ac, lay, nom, bessResult);
} catch (v2Err) {
  engineLog(ss, 'V2', 'WARNING',
    'MDC_v2 skipped: ' + v2Err.message + '. Legacy MDC unaffected.');
}
```

This guarantees legacy continues to be the source of truth throughout the
migration. The CULLIGAN regression test continues to validate legacy. A
parallel `REG_CULLIGAN_BASELINE_V2` test validates v2 (added per writer
as we go).

---

## 4. Migration order

Recommended sequence, with reasoning. Each entry is one "chunk" of work
(approximately 1–3 days).

### Chunk 0: Template framework (PRECONDITION — must be first)

- Create `templates/TemplateRegistry.js` — declares the set of v2 sheets,
  their setup function names, and the patterns shared across all templates.
- Verify `02a_DesignTokens.js` and `02b_LayoutPrimitives.js` expose
  everything needed. If primitives are missing (the file header notes some
  as deferred — `primSubtotalRow`, `primTotalRow`, etc.), add them now
  before any writer uses them.
- No sheets created yet. No writers built. Just the scaffolding.

**Exit criterion:** Unit tests for template framework pass (run mentally
during development; actual sheet verification happens in Chunk 1).

### Chunk 1: MDC_v2

Why first:
- MDC already has template/data separation (`setupMDCTemplate` exists).
  v2 ports this pattern with minimal architecture surprises.
- MDC carries the engineering decisions (DC sizing, AC sizing, NOM
  citations). It's the technical anchor of the deliverable set.
- Adding BESS rows to MDC clarifies the BESS data contract for all
  subsequent writers — what shape `bessResult` has, what cells it
  populates, what status flags it carries.

Scope:
- `templates/setupMdcTemplate.js` — builds the MDC_v2 sheet structure
  including a new BESS section (rows ~75–88 estimated, finalized during
  build)
- `writers_v2/WriteMdcV2.js` — populates data, including BESS
- Unit tests for both
- Integration into `runArgiaEngine()` as Step 7-v2

**Exit criterion:**
1. MDC_v2 sheet renders correctly (visual check)
2. Every PV value in MDC_v2 matches the corresponding cell in MDC within
   tolerance (side-by-side verification on CULLIGAN)
3. BESS section in MDC_v2 populated with correct values from `bessResult`
4. `REG_CULLIGAN_BASELINE_V2` test created with PV asserts mirroring the
   legacy baseline + new BESS asserts

### Chunk 2: BOM_v2

Why second:
- Highest-dollar customer-facing document. Getting the architecture right
  here is highest-value.
- BOM total drives the PROJECT_CARD selling price, so BOM_v2 must be
  verified before PROJECT_CARD_v2 can be built.
- BESS adds discrete line items (battery quantity, BMS, container,
  cabling) — easy to spec from `bessResult` plus `BESS_BATTERY_LIBRARY`.

Scope:
- `templates/setupBomTemplate.js`
- `writers_v2/WriteBomV2.js` including BESS section in BOM
- Unit tests
- Engine integration as Step 8-v2

**Exit criterion:**
1. BOM_v2 grand total (PV portion) matches BOM grand total to ±$1 USD
2. Section subtotals match legacy
3. BESS line items present with correct quantities and unit prices
4. `REG_CULLIGAN_BASELINE_V2` extended with BOM_v2 PV + BESS asserts

### Chunk 3: PROJECT_CARD_v2

Why third:
- Reads from BOM totals (already verified in Chunk 2)
- Customer-facing summary — simpler structure than BOM
- BESS shows up here as one or two summary rows in the SCOPE OF WORK
  block, plus possibly an entry in the cost breakdown

Scope:
- `templates/setupProjectCardTemplate.js`
- `writers_v2/WriteProjectCardV2.js` including BESS
- Unit tests
- Engine integration as Step 13-v2

**Exit criterion:**
1. Sell USD/Wp matches legacy within rounding
2. Gross profit USD matches legacy
3. BESS appears in scope and cost breakdown
4. Baseline extended

### Chunk 4: INSTALLATION_v2

Why fourth:
- Largest writer (1,662 LOC). Most layout-heavy. Worth tackling after the
  v2 patterns are well-established by three prior writers.
- BESS adds installation drivers (battery handling, container placement,
  containment, BMS commissioning) — non-trivial but well-bounded.
- Installation total drives Project Card, but PC_v2 already exists from
  Chunk 3 and reads from legacy INSTALLATION. We'll bridge this when both
  are v2 (no engine-side change needed, just data plumbing).

Scope:
- `templates/setupInstallationTemplate.js`
- `writers_v2/WriteInstallationV2.js` including BESS
- Unit tests
- Engine integration

**Exit criterion:**
1. Labor / equipment / other totals match legacy within ±$50 MXN
2. Grand total matches legacy within ±$100 MXN
3. BESS install lines present with correct hours and rates
4. Baseline extended

### Chunks 5–9: RFQ_v2 (5 sheets)

Why grouped:
- All 5 RFQs share the same skeleton (header, item list, signature block)
- One `setupRfqTemplate(ss, sheetName, config)` function handles all 5
- One `writeRfqV2(ss, sheetName, items, config)` writes all 5
- Effectively two files cover all 5 sheets

Order: PANELES, INVERSORES, ESTRUCTURA, ELECTRICO, MONITOREO. The order
follows BOM section order. ELECTRICO will include BESS battery line if
present (BESS counts as electrical equipment for RFQ purposes).

Scope:
- `templates/setupRfqTemplate.js` (generic, parameterized by sheet)
- `writers_v2/WriteRfqV2.js` (generic, parameterized)
- Unit tests covering all 5 RFQs
- Engine integration as Step 11-v2

**Exit criterion:**
1. All 5 RFQ_*_v2 sheets render correctly
2. Item lists match legacy RFQs
3. BESS battery appears in RFQ_ELECTRICO_v2
4. Baseline extended (or accepts the verification is structural, not
   numeric — RFQs are item lists not number sheets)

### Chunk 10: CFE_OUTPUT_v2

Why last:
- Most layout-heavy writer (92 layout calls in legacy)
- Contains 3 charts (visible to customer)
- Driven by CFE_SIMULATION and BESS_SIMULATION sheets (formula sheets,
  not writers) — so the v2 work is mostly chart + layout, less data
- Reasonable risk to do last when all v2 patterns are well-established

Scope:
- `templates/setupCfeOutputTemplate.js` (including chart configuration)
- `writers_v2/WriteCfeOutputV2.js`
- Unit tests
- Engine integration as Step 13.5-v2

**Exit criterion:**
1. CFE_OUTPUT_v2 renders correctly with all 3 charts
2. Numbers match legacy
3. BESS shown if BESS enabled
4. Baseline extended

### Chunk 11: Cutover

The atomic switch. One commit / PR.

Scope:
- `runArgiaEngine()` updated to call v2 writers only
- All legacy writer files deleted (`07_WriteMDC.js`, `08_WriteBOM.js`,
  `14_WriteProjectCard.js`, `06_WriteCfeOutput.js`, `15_WriteRFQ.js`,
  the INSTALLATION writer portion of `13_CalcInstallCost.js`)
- All v2 sheet names renamed: `MDC_v2` → `MDC`, `BOM_v2` → `BOM`, etc.
- All `writeXV2` functions renamed to `writeX` (or kept as v2 — your
  call; recommend renaming, since "v2" loses meaning after cutover)
- The legacy CULLIGAN baseline test (`REG_CULLIGAN_BASELINE`) deleted;
  the v2 baseline (`REG_CULLIGAN_BASELINE_V2`) renamed to
  `REG_CULLIGAN_BASELINE`
- `setupMDCTemplate` (legacy) deleted; `setupMdcTemplate` (v2) is the
  one remaining

**Exit criterion:**
1. CULLIGAN engine run produces sheets identical to v2-suffix sheets
   before cutover (same numbers, same structure)
2. Full regression test green
3. No file references "v2" except the deleted-files git history

### Chunk 12: Reset feature (the original Item 1)

Now that templates are clean and writers are pure data, Reset Outputs
becomes trivial:

```javascript
function resetOutputs(confirm) {
  // ... confirmation dialog ...
  ['MDC', 'BOM', 'INSTALLATION', 'PROJECT_CARD', 'CFE_OUTPUT',
   'RFQ_PANELES', 'RFQ_INVERSORES', 'RFQ_ESTRUCTURA',
   'RFQ_ELECTRICO', 'RFQ_MONITOREO'].forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (sh) ss.deleteSheet(sh);
  });
  // Recreate from templates
  setupMdcTemplate(ss);
  setupBomTemplate(ss);
  setupInstallationTemplate(ss);
  setupProjectCardTemplate(ss);
  setupCfeOutputTemplate(ss);
  ['PANELES','INVERSORES','ESTRUCTURA','ELECTRICO','MONITOREO']
    .forEach(function (n) { setupRfqTemplate(ss, 'RFQ_' + n); });
}
```

Plus Reset Inputs (per Item 1 design — INPUT_MAP walk + INPUT_CFE
hardcoded cells) and Reset Everything (sequenced calls).

**Exit criterion:**
1. Three Reset menu items work (Outputs, Inputs, Everything)
2. Single confirmation dialog showing sheets touched
3. After Reset Outputs, the engine produces a clean run with no warnings
4. CULLIGAN baseline passes after Reset Outputs + engine re-run

---

## 5. Working protocol

### Chunk discipline

Each chunk is **atomic for verification**. Inside a chunk I work freely,
without push/test cycles. At the chunk boundary I deliver all files and
you verify.

For each chunk, the deliverable is:
1. New `.js` files (templates, writers, tests) — complete and self-contained
2. Updated `00_Main.js` if engine integration is needed
3. A short chunk summary noting what was built, what to test, what to
   look for in the comparison
4. Unit tests that I expect to pass when you push and run

Your verification per chunk (approximate budget):
1. Push files via clasp (5 minutes)
2. Refresh sheet, run engine on CULLIGAN inputs (1-2 minutes)
3. Open the new v2 sheet side-by-side with the legacy sheet (10 minutes)
4. Run regression tests including the extended v2 baseline (1 minute
   for tests to run, 2-3 minutes to read results)
5. Total per chunk: roughly 20-30 minutes

If verification fails: I patch and you re-verify. The chunk doesn't close
until verification passes.

### No mid-chunk pushes

I won't ask you to push partial chunks. If a chunk turns out to be too
large (real possibility — INSTALLATION might be), I'll split it into
sub-chunks before delivery, not during.

### Test discipline per chunk

Each writer chunk delivers:
- **Unit tests:** test the writer's data-handling logic against fixture
  inputs. No sheet I/O required. Test that the data assembled is correct
  before it's written.
- **Template tests:** verify the template setup is idempotent — calling
  `setupX(ss)` twice has the same effect as calling once. Verify required
  cells exist after setup. Verify formatting tokens were applied.
- **Integration:** at chunk close, the writer is wired into the engine
  and one full CULLIGAN run is required to verify side-by-side.
- **Baseline extension:** new asserts in `REG_CULLIGAN_BASELINE_V2`
  covering the new writer.

### Pause and resume

If you need to pause mid-migration:
1. Finish the current chunk if close to done. Otherwise, leave the chunk
   partially built but no engine integration committed.
2. Update this plan's "## 7. Status" section with current chunk and
   what's done / not done.
3. On resume: re-read this plan, re-read the status, resume from the
   marked chunk.

This plan is the resume point. Treat it as authoritative.

---

## 6. Risk register

Honest list of what could go wrong. Each item has a mitigation.

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| v2 numbers don't match legacy on a writer | Medium | High | Side-by-side comparison catches this at chunk close. Patch before closing chunk. |
| BESS data shape changes during BESS feature dev | Medium | High | v2 plan assumes current `bessResult` shape (per `ARGIA_BESS_PLAN.md`). If BESS changes, v2 writers adapt. Worst case: rework one or two writers' BESS sections. |
| Template framework underestimates a layout pattern | Medium | Medium | First chunk (MDC_v2) surfaces this. Add primitives as needed before later chunks. Build from real usage, not speculation. |
| Engine runtime doubles during transition | Low | Low | Two writer passes per run is acceptable for solo dev. Measure during Chunk 1. If unacceptable, add a `V2_PARALLEL_ENABLED` flag to skip v2 on routine runs. |
| Apps Script quota (6-min execution limit) hit during transition | Medium | High | Both legacy + v2 writers + tests + BESS step in one engine run might exceed 6 min. Monitor after Chunk 3. If close, add per-chunk timing and consider a "v2-only" entry point for development runs. |
| CFE_OUTPUT charts hard to regenerate correctly | Medium | Medium | Saved for Chunk 10 when patterns are mature. Chart config goes in template, not in writer. |
| INSTALLATION writer too big to migrate as one chunk | Medium | Medium | Split into INSTALLATION-PV (Chunk 4a) and INSTALLATION-BESS (Chunk 4b) if it gets unwieldy. Decision made at start of Chunk 4. |
| Folder-based files don't load in expected order | Medium | High | Apps Script load order is alphabetical *within* and *across* folders. Verify in Chunk 0 by intentionally creating cross-file dependencies and running. If load order breaks, add lazy-init guards (the existing `TEST_REGISTRY` pattern). |
| CULLIGAN BESS values not yet locked because BESS feature is mid-dev | Confirmed | Medium | v2 baseline locks PV portions first, BESS portions added as BESS feature stabilizes. If BESS produces unstable numbers, defer BESS assertions until per-writer build. |
| Cutover commit too big to review | Confirmed | Low | Deliberate. The cutover is the moment of truth — reviewing one big commit that deletes legacy is the right shape. |

---

## 7. Status

> Updated at each chunk boundary. Authoritative resume point.

---

### Current state (2026-05-27, engine v3.7.0) — Tier 1, 2, 3 shipped

The migration plan's "Chunks 0–11" have all been completed and shipped via
three "tier" commits. The detailed chunk-by-chunk history below is preserved
for context; this block is the authoritative current state.

**Tier 1 (3.5.0, 2026-05-26):** Engine writes only `_v2` sheets in
`runArgiaEngine`. Both legacy and v2 writers existed; engine called v2.
Legacy writers became dead code.

**Tier 2 (3.6.0, 2026-05-26, commit `60d83af`):** Legacy writer files
deleted (~8100 LOC removed):
- `06_WriteCfeOutput.js`, `07_WriteMDC.js`, `08_WriteBOM.js`,
  `14_WriteProjectCard.js`, `15_WriteRFQ.js`, `16_WriteOverview.js` (orphan)
- Legacy `writeInstallCost` + `writeInstallDriverMap` deleted from
  `13_CalcInstallCost.js` (~370 lines). Calc layer preserved unchanged.
- `13_CalcInstallCost.js` switched to `_bomV2_loadStructureDb` /
  `_bomV2_resolveStructure` in `writers_v2/helpers/BomDbHelpers.js`.
- Output validator (`09b_OutputValidate.js`) reads v2 sheet names.
- Five legacy test files deleted (Mdc/Cfe writer tests, e2e pipeline,
  row constants, resolve structure).
- `30_ArgiaKicker.js` (1397 lines) and its 4 menu items removed.
- Menu items "Export Project Card" + 5-item "Export RFQ" submenu
  removed from `00_Main.js` (functions they pointed at were deleted).

**Tier 3 (3.7.0, 2026-05-27):** PDF exporter cutover.
- `12_ExportPDF.js` `PDF_EXPORTS` config now targets v2 sheets with
  verified ranges from a real CULLIGAN export:
  - `MDC_v2` B1:G115 portrait (was MDC B1:F99 — +col G, +16 BESS rows)
  - `BOM_v2` A1:H94 portrait (was BOM A1:H77 — +14 BESS rows)
  - `INSTALLATION_v2` A1:J34 landscape (unchanged customer region)
  - `PROJECT_CARD_v2` A1:J69 landscape (NEW: PC export restored)
  - `RFQ_*_v2` (6 sheets) A1:M&lt;lastRow&gt; landscape (NEW: 5 categories
    + RFQ_BESS, end row resolved at export time)
- New menu structure: "Export Project Card", "Export RFQ" submenu (6
  items + Export All RFQs), "Export All" bundles MDC+BOM+Install+PC.
- 121 unit-test assertions cover the config table and URL builder
  (`PdfExportConfigTests.gs`, `PdfExportUrlBuilderTests.gs`).

**Post-cutover bugs surfaced and fixed before Tier 3** (per Tomas's
handoff, captured here for the record):
1. Logo stacking on the v2 banner (cosmetic) — fixed.
2. PC_v2 was silently reading from legacy BOM and accidentally working
   because legacy BOM had the right CULLIGAN data; led to a blank BESS
   subtotal when BOM_v2 was the only writer. Fixed by switching PC_v2
   reads to `BOM_v2`.
3. Standalone `runWriteProjectCardV2` called a nonexistent function
   (`runBessSuggestion`); should have been `runBessStep(ss)`. Fixed.
4. TOTAL row validation had a dimensional mismatch: PV rows are `$/kWp`
   USD but the BESS row is `$/kWh` USD. Validation logic now branches
   on row type so BESS gets the right range. The CULLIGAN row 39 cell
   note confirms this is working: `$727/kWh │ range $350–$800/kWh`
   → PASS. (Note: `INPUT_PROJECT!F61` unit label says "USD/kWp" but
   should say "USD/kWh" — labeling bug, math is correct. Fix separately.)

**Outstanding items deferred from Tier 3:**
- INPUT_MAP patch helper (`patchInputProjectMissingRows`) — handoff said
  "nice to have", not "must do". Skipped for now; revisit if another
  workbook needs a row 61–style patch.
- Cleanup Legacy Tabs menu item — handoff said NOT YET. Run engine on
  2–3 real production projects under v3.7.0 first, then build the
  confirmation-prompted delete menu and remove the stale legacy tabs.
- `INPUT_PROJECT!F61` unit label fix (`USD/kWp` → `USD/kWh` on the BESS
  row). Single cell. Trivial when it gets touched.

---

### Pre-Tier history (preserved for context)

**Current chunk:** BDF-6 (INPUT_BESS picker wiring) complete. Next: return to output migration (Chunk 2: BOM_v2) or another BDF follow-up.

**Track split:**
The migration now runs on TWO parallel tracks:
- **Output migration track (Chunk 0..12)** — original v2 output writer migration.
  PAUSED after Chunk 1 by user decision to prioritize BESS Designer Flow.
- **BDF track (BDF-1..5)** — BESS Designer Flow. Active.

**Completed (output migration track):**
- Plan written and approved
- **Chunk 0: Template framework** — `templates/TemplateRegistry.js`,
  `02b_LayoutPrimitives.js` extended with `primSubtotalRow`/`primTotalRow`,
  cross-folder load-order probe verified. 23/23 assertions green.
- **Chunk 1: MDC_v2** — `templates/setupMdcTemplate.js`,
  `writers_v2/WriteMdcV2.js`, Step 10-v2 wired into engine with try/catch.
  Menu patched: "▶ Run Unit Tests (fast)" + "▶ Run Tests for Current Chunk".
  `ACTIVE_CHUNK_TAG` shim in `templates/ActiveChunk.js`.
  76/76 chunk1-tagged assertions green.

**Completed (BDF track):**
- **BDF-1: Suggest BESS UX** — first production caller of `calcBessSizing`.
  Engine-math fixes: `annualEnergyShiftSavingMxn` + `coverageFlag` added to
  candidate dict; payback uses total savings, not demand-only. Tariff rates
  auto-derived from INPUT_CFE 12-month billing. Defensive duplicate-header
  check in `getAllBatteryProducts`. 49/49 bdf1-tagged assertions green.
- **BDF-2: Interconnection-mode-aware sizing** — `BESS_INTERCONN_MODE`
  enum (NET_METERING / NET_BILLING / ZERO_EXPORT / UNKNOWN). _scoreCandidate
  energy-shift math becomes mode-aware with solar/grid charge-source split.
  PV surplus read from CFE_SIMULATION row 42 (already populated by the PV
  engine step). Interconnection mode read from INPUT_CFE row 41-42.
  Writer renders new row 6 with mode + export price + PV surplus + plain-
  English explainer per mode. UNKNOWN mode preserves BDF-1 behavior byte-
  identically (backward-compat lock test verifies this).
  Files: `02_LoadDB.js` (edit), `17_CalcBessSizing.js` (edit),
  `19_RunBessSuggestion.js` (edit), `19b_WriteBessRecommendations.js` (edit),
  `templates/ActiveChunk.js` (bump), `tests_unit/calc/CalcBessSizingTests.gs`
  (extend), `tests_integration/writers_v2/WriteBessRecommendationsTests.gs`
  (extend).
  137/137 assertions green across legacy + BDF-1 + BDF-2 (test run
  2026-05-22). Real CULLIGAN run under NET_METERING (the project's actual
  mode):
  - HW_LUNA_2MWH: $1,864,210/yr (vs BDF-1's $2,233,904 — BDF-1 was
    overstating by ~17% because it assumed grid-to-grid arbitrage when
    the project actually exports for free under NET_METERING)
  - All 9 catalog products: payback 10.7-15.3 yrs
  - No candidate crosses the $2M/yr threshold under NET_METERING
  - Under hypothetical ZERO_EXPORT same hardware would save $2.77M/yr
    (49% more) — illustrating how mode dominates the economics
  HONEST CAVEAT documented in code: monthly-resolution PV-surplus proxy
  overstates solar-charge fraction when battery is small relative to
  surplus. CULLIGAN's case (battery 2032 kWh vs annual surplus 900 MWh)
  is in the tight regime where the proxy holds well. BDF-5 will tighten.
- **BDF-3: Min-savings threshold + verdict banner** — new INPUT_BESS
  section "5. ECONOMICS GUARDRAILS" with threshold cell C37 (default
  $2M), punta override C38, base override C39, notes C40. `meetsThreshold`
  field on every candidate. Threshold-aware `_pickRecommendation`. Row 2
  verdict banner (green RECOMMENDED / red NO CANDIDATE MEETS THRESHOLD)
  in writer. New `setupInputBessEconomicsRows()` idempotent function in
  `02e_InputSetup.js` (user runs once per workbook to add rows 36-40).
  Files: `02_LoadDB.js`, `02c_InputMap.js`, `02e_InputSetup.js`,
  `17_CalcBessSizing.js`, `19_RunBessSuggestion.js`,
  `19b_WriteBessRecommendations.js`, `templates/ActiveChunk.js`, unit +
  integration tests extended. 177/177 cumulative assertions green.
  Real CULLIGAN under NET_METERING with $2M threshold + live tariff
  numbers (punta 1.6848, demand 425.21 from 12-month INPUT_CFE):
  HW_LUNA_2MWH = $2.27M/yr / 8.8 yr payback / crosses threshold.
  Banner reads "RECOMMENDED: HW_LUNA_2MWH · $2,274,550/yr · 8.8 yr payback".
- **BDF-4: Stacking support** — engine reads `Stackable` (YES/NO) and
  `Max_Stack_Units` columns from MASTER_DB `16_PRODUCTS_BESS` and
  generates qty=1..maxStackUnits candidates per stackable product.
  Linear CAPEX scaling (qty × singlePrice — honest approximation,
  ±10-15% vs real quotes per documented caveat). Stack metadata
  (`stackQty`, `baseBatteryId`, `baseCapacityKwh`, `basePowerKw`) on
  every candidate. Labels like `5 × HW_LUNA_241_2S1 (1205 kWh, 540 kW)`.
  Ladder fallback when no library passed (preserves BDF-1/2/3 unit
  tests). Writer display-filter: when threshold > 0, table shows only
  meeting candidates.
  Files: `17_CalcBessSizing.js`, `19_RunBessSuggestion.js`,
  `19b_WriteBessRecommendations.js`, `templates/ActiveChunk.js`,
  unit + integration tests extended. 216/216 cumulative assertions
  green. Real CULLIGAN with stacks generates 95 candidates, 21 meeting
  $2M threshold. New options surface:
    - HW_LUNA_2MWH single = $20M / 8.8 yr / PARTIAL coverage / $2.27M/yr
    - 2 × HW_LUNA_2MWH = $40M / 9.9 yr / **FULL** coverage / $4.04M/yr
      (impossible to surface before BDF-4)
    - 15 × HW_LUNA_241_2S1 = $48M / 11.9 yr / FULL coverage / $4.04M/yr
      (picker recommends this; tied on coverage with 2 × 2MWh but picker
      doesn't optimize for CAPEX — designer reads ranked table to see
      that 2 × 2MWh is the cheaper FULL option)

**Open BDF-4 limitations (worth future small chunk):**
- Picker tie-breaks by "smallest capacity at same shave" rather than
  "lowest CAPEX for FULL coverage." Designer reads table and overrides.
- Linear CAPEX is honest approximation; real quotes ±10-15%.
- Power-constraint formula uses energy/window; ignores nameplate kW.
  Conservative — never overestimates. Deferred.
- No mixed-model stacks (`5×161 + 3×200` not expressible).

- **BDF-5: Hourly load + PV + battery dispatch simulator** — new module
  `20_CalcHourlySimulation.js` produces 8760-hour simulation of
  load/PV/battery for any project. Orchestrator `20a_RunHourlySimulation.js`
  reads from INPUT_CFE (tariff, region, 12-month bill, interconnection),
  CFE_SIMULATION (monthly PV), INPUT_BESS (battery spec). New step 13.4
  in engine pipeline runs before CFE_OUTPUT. Side-by-side designer-facing
  addendum appended to CFE_OUTPUT shows hourly engine cost vs monthly.
  Tariff support per Option R1: GDMTH hard-coded (mainland regions);
  GDMTO/GDBT/PDBT flat-rate fallback (clean); DIST/RAMT flat-rate with
  warning (until windows encoded).
  Files: `20_CalcHourlySimulation.js` (new, ~470 LOC),
  `20a_RunHourlySimulation.js` (new, ~110 LOC), `02_LoadDB.js` (edit:
  3 new readers), `06_WriteCfeOutput.js` (edit: optional addendum),
  `00_Main.js` (edit: Step 13.4), `templates/ActiveChunk.js` (bump),
  `tests_unit/calc/CalcHourlySimulationTests.gs` (new, 18 sub-tests,
  53 assertions), `tests_integration/engine/RunHourlySimulationTests.gs`
  (new, 2 tests).
  269/269 cumulative assertions green via Node dry-run (216 BDF-1..4 +
  53 BDF-5 unit). Integration tests verified after push.

  Real CULLIGAN sanity check (placeholder data in current workbook):
  - Baseline (no PV/battery): $1.22M/yr energy cost
  - With PV under NET_METERING: $0/yr (cap applied; PV covers consumption)
  - With PV + 2MWh battery under NET_METERING: $0/yr energy + demand
  - DIST tariff fallback emits clear warning + flat-rate result

  Two bugs caught + fixed during development (full disclosure):
  - NET_METERING was producing negative cost; fixed with proper annual
    cap (CFE doesn't pay you under NET_METERING).
  - Demand charge initially missing from total cost; now computed from
    monthly punta-hour peaks × demand rate.

**Open BDF-5 limitations (worth future small chunks):**
- GDMTH window data is training-data confidence, not yet verified
  against current CFE tariff document. Effective-date constant in code
  (`GDMTH_WINDOWS_EFFECTIVE_DATE = '2026-01-01'`) makes the assumption
  visible and the data easy to update.
- DIST/RAMT TOU windows not yet encoded — fall back to flat-rate with
  warning. Encode before quoting customers on these tariffs.
- PV hourly shape is piecewise-flat across daylight hours (6am-7pm);
  real PV is bell-curved. Replace when PV engine exposes hourly data.
- NET_METERING cap uses annual proxy; CFE actually caps monthly with
  credit roll-forward. Annual is reasonable for proposal-time estimates
  but exact monthly bill reconstruction would need monthly cap.
- Battery dispatch is greedy/myopic, not annually optimized. Good for
  proposal estimates; real EMS will perform somewhat better.
- Side-by-side display in CFE_OUTPUT is minimal (now ~15-row addendum
  with R2). Full side-by-side restructuring deferred to a CFE_OUTPUT_v2
  chunk that redesigns the customer-facing layout.

**BDF-5 R2 (extension, same chunk):**
First user-test of BDF-5 R1 revealed the hourly engine output was ~$7M
while the monthly engine showed $13.4M baseline — a ~$5-6M gap. Root
cause: R1 engine only modeled energy charges (rows 25-27) and the
Capacidad demand charge (row 21). A real CFE bill includes 9+ components:
Capacidad, Distribución, Transmisión, CENACE, Energía B/I/P, SCnMEM,
Suministro, 2% Baja Tension (optional), Cargo FP (power-factor
adjustment), and 16% IVA on the subtotal.

R2 extends BDF-5 to compute every component, mirroring the formulas in
INPUT_CFE rows 21-35 (same logic as 04a_CalcCFEBill). New inputs needed:
per-month tariff rate table from 20M_CFE_TARIFFS (new reader
`loadCfeTariffRates`), Demanda Facturable from INPUT_CFE row 19, FP
from row 20, 2% Baja Tension toggle from row 7. Orchestrator gathers
all and now ALSO runs a baseline (no PV/battery) simulation so the
addendum shows side-by-side "Sin PV / Con PV+BESS / Ahorro." Addendum
also shows per-component breakdown matching the monthly engine's line
items, making cross-engine comparison visual.

Backward compatibility: `tariffRatesByMonth` is optional. When omitted
(or 20M_CFE_TARIFFS missing data), engine falls back to R1 behavior
with a clear note. All 53 R1 unit tests pass unchanged.

New tests (16 added → 69 total in BDF-5 file):
- Full-bill computation produces non-null `fullBill` with all 12 component
  arrays
- IVA = subtotal × 0.16 (internal consistency)
- 2% Baja Tension toggle ON vs OFF
- Cargo FP penalty (FP < 0.9) vs bonus (FP > 0.9)
- Backward-compat: fullBill is null when tariffRatesByMonth omitted
- REGRESSION: hourly total within ±25% of hand-calculated benchmark
  (catches "totally wrong" outputs)
- Internal consistency: sum(subtotal[]) == annualSubtotalMxn
- PV reduces full-bill total cost

Real CULLIGAN-ish dryrun (placeholder workbook data, GDMTH GOLFO CENTRO):
- Baseline total: $1.39M annual (vs R1 output of $1.22M energy-only)
- Component breakdown: Capacidad $423k, Energía $563k, Distribución
  $135k, IVA $191k, etc.
- Real CULLIGAN consumes ~10× this much; engine should scale linearly
  on real data, putting baseline in the right $13-14M range.

Cumulative tests after R2: 216 BDF-1..4 + 69 BDF-5 = 285/285 green
in Node dryrun.

**Open BDF-5 R2 honest caveats:**
- Distribución in the engine uses the SIMULATED post-PV/battery peak kW.
  The monthly engine uses the BILL'S kW peaks (no PV/battery applied).
  Under PV/battery scenarios, hourly distribución will be LOWER than
  monthly — this is correct engineering (batteries shave peaks) but
  means the two engines won't agree on PV/battery cases. They should
  agree on the baseline (no PV/battery) case within a few percent.
  This is exactly the kind of two-engine cross-validation insight that
  justified building both.
- Cargo FP uses a fixed FP from INPUT_CFE row 20. The real customer's
  FP might change with PV installation (PV inverters affect reactive
  power). Engine treats FP as a constant; honest approximation.

- **BDF-6: INPUT_BESS picker wiring** — links BESS_RECOMMENDATIONS
  back to INPUT_BESS so the designer's pick from the suggestion table
  actually drives the engine's bess{} object (consumed by BOM, MDC,
  hourly sim, finance). Before BDF-6, the designer had to read the
  recommendation table with their eyes and type the Battery_ID manually
  into C6, with no validation against the suggestions. Stacked
  recommendations (`5 × BYD_2MWH (10000 kWh, 5000 kW)`) didn't have a
  catalog entry to look up, so XLOOKUP returned blank — engine got 0 kWh.

  BDF-6 adds:
  - **Picker pure-function core** (`resolvePickerSelection`) — given a
    C6 value, catalog, and recommendations, returns the resolved specs.
    Fully unit-testable; 39 assertions cover the matrix.
  - **Union dropdown source** — hidden `_BESS_PICKER_OPTIONS` helper
    sheet holds catalog Battery_IDs + recommendation labels. C6's data
    validation points at this sheet.
  - **onEdit trigger** — when C6 changes, the picker writes spec cells
    (C10-C14, C20) with literal values from the picked selection. SOC/RTE
    for stacked recommendations are pulled from the underlying catalog
    product (baseBatteryId), not multiplied by stackQty.
  - **Provenance indicator** — D6 shows `(recommendation)`, `(catalog)`,
    or `(manual)` so designer sees source at a glance.
  - **Override mechanism (O2)** — picker writes literals, designer can
    type over any cell, override sticks until next C6 change.
  - **Recommendation writer extended** — emits hidden cols N (baseBatteryId)
    and O (stackQty) so the picker can resolve any recommendation
    uniformly. Hidden via `hideColumns(14, 2)`.
  - **`refreshBessPicker()` called by `runBessSuggestion()`** so the
    dropdown updates after each Suggest BESS run.
  - **`setupInputBess()` extended** to delegate to refreshBessPicker.

  Files: `21_BessPickerWiring.js` (new), `19_RunBessSuggestion.js`
  (edit: call refreshBessPicker), `19b_WriteBessRecommendations.js`
  (edit: hidden cols), `02e_InputSetup.js` (edit: delegate),
  `templates/ActiveChunk.js` (bump),
  `tests_unit/wiring/BessPickerWiringTests.gs` (new, 12 sub-tests, 39
  assertions).

  Cumulative: 216 BDF-1..4 + 69 BDF-5 + 39 BDF-6 = 324/324 in dryrun.

**Open BDF-6 caveats:**
- Override detection works on "did the user edit this cell?" via the
  onEdit trigger pattern. After designer override, the auto value in
  the hidden marker column (Q) is stale — that's intentional, picker
  rewrites everything on next C6 change. If you want a "compare current
  to original" feature later, conditional formatting on Q vs C would
  highlight overridden cells.
- Picker fallback for unknown labels is "leave specs untouched."
  Designer typing an unrecognized batteryId doesn't trigger any auto-fill.
  This is intentional — supports the "supplier quote with custom ID"
  workflow.
- BOM and MDC display of stacked batteries is deferred (per user choice).
  Currently stacked recommendations resolve to multiplied capacity/power/
  CAPEX in INPUT_BESS. BOM/MDC see those numbers and emit whatever they
  currently emit. When BOM_v2 lands, decide whether to break into one
  line per stack vs one line per unit.

- **BDF-7: BESS BoS + voltage drop + NOM checks + BOM §8** — extends the
  engine to model the physical BESS install (distances, voltages, conduit
  routing), compute cable/conduit/breaker/disconnect quantities, verify
  NOM compliance (voltage drop NOM 690-8, disconnect 690-13/15, GEC
  sizing 250-66), and render a customer-facing §8 BESS section in BOM.

  Files added:
  - `22_CalcBessBosQuantities.js` — pure function turning circuit result +
    install context into 12 BOM line items with NOM citations
  - `23_CalcBessVoltageDrop.js` — pure %VD calc against NOM 3% / 5% limits
    for DC and AC runs, using same formulas as PV side (04_CalcDC.js)
  - `24_CalcBessNomChecks.js` — disconnect presence + GEC sizing per
    NOM 250-66 lookup table

  Files extended:
  - `18_CalcBessCircuit.js` — `_sizeRun` now exposes `cuAreaMm2`,
    `conductorLabel`, `egcLabel`, `ocpdLabel`, `parallels` so downstream
    calcs and writers can consume the conductor table data without
    re-doing the lookup
  - `02_LoadDB.js` — new header-tolerant `lookupBatteryUnitPrice` that
    accepts multiple column-header spellings (BESS_price_per_unit /
    BESS_PRICE_PER_UNIT / Price_Per_Unit_MXN) and falls back to
    Installed_CAPEX_MXN
  - `01a_ReadInputsBess.js` — new `readBessInstallContext` reads
    INPUT_BESS §6 rows 42-53 into a typed object (coupling, voltages,
    distances, cable path, location, GEC length, commissioning fee)
  - `00_Main.js` — new Step 9.6 between BESS step and writers; runs
    the three calc functions and attaches results to bessResult;
    extends BOM_ROW with §8 rows 79-92 and shifts GRAND_TOTAL to 94
  - `07_WriteMDC.js` — extends §7 with 5 new check rows (rows 111-115):
    DC vdrop, AC vdrop, disconnect, GEC, BoS summary
  - `08_WriteBOM.js` — extends signature to accept `bessResult`,
    renders §8 BESS section from `bessResult.bos.lines`, updates
    GRAND_TOTAL formula to include SUBTOTAL_BESS, extends clear range
  - `02e_InputSetup.js` — new `setupInputBessInstallRows` adds §6 to
    INPUT_BESS with dropdowns for coupling / cable path / location /
    grounding system and sensible defaults for distances

  Tests added:
  - `tests_unit/calc/CalcBessBosTests.gs` (3 test files, 65 assertions):
    BoS quantities for DC_COUPLED + AC_COUPLED, voltage drop PASS/REVIEW
    /FAIL bands, NOM 250-66 GEC lookup boundaries, disconnect presence
  - `tests_integration/engine/RunBdf7Tests.gs` (3 integration tests):
    readBessInstallContext shape verification, setupInputBessInstallRows
    idempotency, BOM §8 rows present after engine run

  Cumulative tests after BDF-7: 216 BDF-1..4 + 69 BDF-5 + 39 BDF-6 + 65
  BDF-7 = 389/389 in Node dryrun.

  Real CULLIGAN-like smoke test (5 MW BESS, AC_COUPLED, 25m DC run,
  50m AC run): 12 BOM lines produced, DC vdrop 1.66% PASS, AC vdrop
  4.60% REVIEW (engineering signal — conductor needs upsizing or move
  PCS closer), disconnect PASS, GEC sizing PASS.

  Two test-vs-code disagreements caught in development, both
  turned out to be wrong-test, right-code:
  - Test assertion about "sizeable" substring missed that the code
    correctly propagates upstream `circuit.reason` instead of using
    its own fallback text. Fixed test.
  - GEC table boundary: 107.20 mm² (4/0 AWG) falls in the "up to
    4/0" bin → required GEC = 21.15 mm² (#4), not 33.62 (#2 — that's
    the next bin up). Test expectation was wrong. Fixed.

**Open BDF-7 caveats:**
- `parallels` defaults to 1. Today's `calcBessCircuit` always picks a
  single conductor sized to handle full current. For large BESS (e.g.
  5 MW at 480V AC needs ~6000A, requires 11+ parallel runs of 500
  kcmil), the engine picks the next-larger entry in the ampacity table
  and may hit the table cap. A real install needs multi-parallel sizing
  logic. Deferred until customer demand surfaces — for BESS up to ~2 MW
  the single-conductor approximation is acceptable.
- `14M_PRODUCTS_BOS` price resolution for conduit / breakers / disconnect
  is currently a stub. Lines emit with `setNote("Precio pendiente —
  resolver SKU en 14M_PRODUCTS_BOS por categoría X / spec Y")`. Future
  small chunk: write a BoS-resolver function that joins by category +
  size/rating to find matching SKU. Until then, designer manually adds
  the prices in BOM.
- `BESS_price_per_unit` reader is header-name-tolerant (checks 4 variants
  + falls back to Installed_CAPEX_MXN). If your live DB has none of
  these headers, BESS line shows note "agregar columna BESS_price_per_unit
  en 16M_PRODUCTS_BESS para Battery_ID X." Cleanest fallback we can do
  without schema enforcement.
- NOM citation accuracy: I used `NOM-001 art. X` citations matching the
  PV side's conventions. Standard but a Mexican electrical engineer
  should verify against the current NOM-001-SEDE edition. Particularly
  art. 690-13/15 (disconnect) and 250-66 (GEC).
- INPUT_BESS §6 setup is not auto-invoked on engine run. After pushing
  this chunk, designers must run `setupInputBessInstallRows` once via
  Apps Script Editor (or future menu item) to populate rows 42-53 with
  labels + defaults. The reader handles empty/missing §6 gracefully
  (returns zeros; downstream calcs emit "pendiente" notes).

- **BDF-7.1: Bug-fix chunk — batteryId resolution + coupling cleanup**

  Two real bugs were caught after BDF-7 R1 shipped, surfaced by running
  the full engine against the CULLIGAN-like project (stacked
  HW_LUNA_2MWH × 2, DC_COUPLED):

  - **Bug A (root cause: missing integration test)**: `readInputBess`
    reads C6 raw (a stacked label like
    `"2 × HW_LUNA_2MWH (4064 kWh, 2032 kW)"`) and passed it as the
    `batteryId` to `lookupBatteryVoltage`. The DB has `HW_LUNA_2MWH`
    in `Battery_ID` column, not the stacked label, so lookup returned 0.
    Circuit became un-sizeable → BoS blocked → BOM §8 collapsed to a
    single fallback "pendiente" line. Same bug affected
    `lookupBatteryUnitPrice` (price = 0).

  - **Bug B (root cause: duplicate data source)**: BDF-7 R1 added a
    coupling cell at `INPUT_BESS!C43` with default `AC_COUPLED`.
    `INPUT_DESIGN!C17` already held the authoritative coupling
    (`DC_COUPLED` for CULLIGAN). They disagreed. MDC §7 row 113
    misreported "❌ AC_COUPLED requiere desconectador" while row 105
    correctly showed DC_COUPLED.

  Path R (proper fix) chosen for Bug A: `readInputBess` calls
  `resolvePickerSelection` (from BDF-6) to resolve C6 to either a
  catalog row or a recommendation row, then uses the picker's
  authoritative `baseBatteryId`, `stackQty`, and resolved specs.
  Eliminates dependency on C10-C14, C20 formula values for picked
  selections (CUSTOM_MANUAL still reads formula cells as before).

  F1 (full cleanup) chosen for Bug B: row 43 dropped from §6 entirely.
  `readBessInstallContext` no longer reads coupling.
  `setupInputBessInstallRows` defensively clears any stale value in
  row 43 with a note explaining the move.
  Orchestrator (`00_Main` Step 9.6) injects
  `installCtx.coupling = bessResult.coupling` before calling the BoS/
  VD/NOM calcs.

  Manual-first voltage ordering: `resolveBessVoltage` now prefers
  the manual INPUT_BESS cell over the DB value, matching the
  INPUT_*/MASTER_DB override pattern used elsewhere in the engine.

  Menu item: "Setup BESS Install §6" added to the Setup submenu.

  New `bess` object fields:
  - `baseBatteryId` — catalog Battery_ID for DB lookups
  - `stackQty` — units in the stack (1 for single)
  - `pickerSource` — `'CATALOG' | 'RECOMMENDATION' | 'CUSTOM_MANUAL'`

  Backward compat: `bess.batteryId` still carries the C6 display label.
  All existing fields unchanged. BDF-1..6 + BDF-7 R1 tests pass without
  modification (216 + 69 + 39 + 65 = 389 assertions still green).

  Files changed (BDF-7.1):
  - `01a_ReadInputsBess.js` — `readInputBess` refactored to use
    picker resolution; `resolveBessVoltage` order swapped (manual
    first); `readBessInstallContext` no longer reads coupling
  - `02e_InputSetup.js` — `setupInputBessInstallRows` clears row 43
    instead of writing a coupling cell
  - `00_Main.js` — Step 9.6 injects `installCtx.coupling =
    bessResult.coupling`; menu item "Setup BESS Install §6" added
  - `22_CalcBessBosQuantities.js`, `24_CalcBessNomChecks.js` —
    contract comments documenting where coupling comes from
  - `templates/ActiveChunk.js` — bdf7_1

  Tests added (21 assertions):
  - `tests_unit/calc/CalcBdf71Tests.gs`:
    - `UNIT_BDF71_VOLTAGE_MANUAL_FIRST` — manual cell beats DB,
      blank/zero/null/text manual falls through, both blank → 0
    - `UNIT_BDF71_COUPLING_INJECTION_CONTRACT` — DC_COUPLED produces
      no AC lines, NOM checks see DC disconnect (not AC), defensive
      circuit.coupling fallback, AC_COUPLED sanity check
    - `UNIT_BDF71_BESS_OBJECT_SHAPE` — stacked label resolves
      productSpec.batteryId to catalog ID, single-unit case,
      CUSTOM_MANUAL fallback path

  Cumulative tests after BDF-7.1: 216 + 69 + 39 + 65 + 21 = 410/410
  in Node dryrun. No regressions.

  Lesson captured: **integration tests must exercise the full data
  format path, not isolated functions.** BDF-6 unit tests passed
  because they handed `resolvePickerSelection` its own catalog/recs
  inputs. Bug A was only exposed when a stacked label flowed through
  `readInputBess → lookupBatteryVoltage` in real engine context.
  The new `UNIT_BDF71_BESS_OBJECT_SHAPE` test locks in the stacked-
  label → DB-lookup path that BDF-6 missed.

- **BDF-8: Unified formatting pass — INPUT_BESS §6 + BOM §8 + BESS_RECOMMENDATIONS**

  After BDF-7.1 fixed the functional bugs, three visual issues remained:
  - INPUT_BESS §6 rows 42-53 looked raw next to the polished §1-§5 above
    (no token-based fonts/colors, no consistent row heights, no dividers)
  - BOM §8 line descriptions overflowed column width and Sheets auto-grew
    JUST those rows, making §8 look uneven against §1-§7
  - BESS_RECOMMENDATIONS used default Sheets font (not Inter), looked
    visually inconsistent with the rest of the engine output

  **A. INPUT_BESS §6 token-based styling.** `setupInputBessInstallRows`
  now loads `_DESIGN_TOKENS` and applies them consistently:
  - Section header: `FONT_SIZE_SECTION` + `FONT_WEIGHT_EMPHASIS` +
    bottom divider line (matches INPUT_BESS §1-§4 visual rhythm)
  - Label rows: `FONT_SIZE_BODY` + `TEXT_PRIMARY` + bottom divider
  - Value cells: `BG_INPUT_CELL` background + right-aligned + number
    formats per field type (V, m, MXN with $ prefix)
  - Unit hints (col E): italic + `TEXT_SECONDARY` (e.g. "V", "m", "MXN")
  - Notes row: merged C-G, italic muted, wrap enabled
  - Row 43 (deprecated coupling cell): muted italic label, cleared
  - Defensive: function still works when tokens module isn't loaded
    (falls back to 'Inter' font, hardcoded color hex values)

  **B. BOM §8 short descriptions + cell notes.** Visible description
  in column B now stays under 60 chars per line. Engineering breakdown
  (parallels × meters × conductors) moves to a new `bosLine.detail`
  field on the calc output. The BOM writer renders `bosLine.detail`
  into the description column's cell note (hover to see). Examples:
  - Before: `"Cable DC AWG 2/0 batería ↔ PCS (1 par × 25 m × 2 conductores)"` (65 chars, wraps)
  - After:  `"Cable DC AWG 4/0 batería ↔ bus DC común"` (39 chars) + note `"1 par × 25 m × 2 conductores = 50 m totales"`
  - Battery line: `"2 × HW_LUNA_2MWH"` (16 chars) + note `"Por unidad: 2032 kWh / 1016 kW. Total stack (2 unidades): 4064 kWh / 2032 kW."`
  Plus: §8 row heights normalized to 22 (empty) / 26 (populated) so
  the section looks uniform; description column has `setWrap(true)`
  applied so any future long string wraps cleanly instead of
  overflowing.

  **C. BESS_RECOMMENDATIONS font sweep.** Single sheet-wide
  `setFontFamily('Inter')` applied at the end of `writeBessRecommendations`.
  Doesn't touch color, weight, or layout — purely the font family.
  Guards against minimal sheet mocks in test fixtures (defensive
  typeof checks on `getLastRow` / `getLastColumn` / `setFontFamily`).
  Honest scope choice: the writer comment intentionally said "no
  design tokens, just data" because this is a designer tool, not
  customer-facing. BDF-8 keeps that spirit (no banner, no logo,
  no conditional formatting) but adds the one consistency win
  that didn't cost architectural drift: the font family.

  Files changed (BDF-8):
  - `02e_InputSetup.js` — `setupInputBessInstallRows` token refactor
  - `22_CalcBessBosQuantities.js` — short `description` + new `detail` field
    per line; `_bessLineDescription` shortened; new `_bessLineDetail` helper
  - `08_WriteBOM.js` — §8 rows get `setRowHeight(26)`, description column
    `setWrap(true)`, `bosLine.detail` rendered as cell note; row-height
    reset for unpopulated rows; existing setNote-for-price logic
    appends the engineering detail when present
  - `19b_WriteBessRecommendations.js` — defensive sheet-wide font sweep
  - `templates/ActiveChunk.js` — bdf8
  - `tests_unit/calc/CalcBessBosTests.gs` — test assertion updated from
    `"Sistema BESS:"` (with colon, BDF-7 format) to `"Sistema BESS "`
    (BDF-8 format)
  - `tests_unit/calc/CalcBdf71Tests.gs` — same test assertion update

  Tests added (45 assertions):
  - `tests_unit/calc/CalcBdf8Tests.gs`:
    - `UNIT_BDF8_BOS_DESCRIPTIONS_SHORT` — every line's description
      ≤ 60 chars (the BDF-7 R1 overflow threshold), detail field is a
      string when present, DC cable detail mentions parallels + meters,
      battery detail mentions kWh + kW, disconnect detail mentions NOM
    - `UNIT_BDF8_BATTERY_DESCRIPTION_SHAPE` — stack "5 × HW_LUNA_2MWH",
      single "Sistema BESS HW_LUNA_2MWH", details carry per-unit + total
    - `UNIT_BDF8_BACKWARD_COMPAT` — quantities unchanged from BDF-7
      (60m cable, 20m GEC, 2-unit battery), productSpec preserved,
      nomCite preserved

  Cumulative tests after BDF-8: 216 + 69 + 39 + 65 + 21 + 45 = 455/455
  in Node dryrun. No regressions.

  Real CULLIGAN-like smoke test verified clean output:
  - 7 visible lines for DC_COUPLED (2 × HW_LUNA_2MWH stack)
  - All descriptions 12-39 chars (clean column rendering)
  - Engineering breakdowns in cell notes (hover to see)
  - Battery, cable, EGC, conduit, OCPD, GEC, commissioning all present

  Out of scope (deferred):
  - Full BOM_v2 rewrite (still planned as original Chunk 2)
  - BESS_RECOMMENDATIONS banner + token-based row styling
    (intentionally kept minimal per the original "designer tool, not
    customer-facing" design intent)
  - BoS SKU price resolution for conduit/breaker/disconnect (still
    needs `14M_PRODUCTS_BOS` join by category + size — separate chunk)
  - INPUT_BESS §1-§4 don't get re-styled (already polished from
    designer's manual setup; touching them risks breaking working layout)

- **BDF-9: Three real bugs caught on live BOM/INPUT_BESS run**

  After pushing BDF-8 and looking at the live workbook, three issues
  surfaced:
  - **INPUT_BESS rows 1-7 looked raw**: tiny "INPUT BESS" text instead
    of a proper logo + title, no column-width tuning, leftover
    "Provider:" / "Model:" labels in E6/E7 with no values
  - **BOM row 80 (battery line) had section-header styling**:
    light-grey background + bold + large font, making it look like
    a header instead of a line item. Root cause: BDF-7 R1's fallback
    "Sistema BESS — pendiente" text applied `styleSectionHeader`-like
    formatting; BDF-7.1 fixed the content but the cosmetic styling
    persisted into the BDF-8 release.
  - **BOM rows 81-90 had no prices**: BDF-7 documented this as a known
    gap ("BoS DB resolution requires matching by category + size — a
    separate chunk of work"). User correctly pushed back: the price
    helpers (`conductorPriceObj`, `groundPriceObj`, `conduitPriceObj`,
    `breakerPriceWithFallback`) already exist in the PV side of
    `08_WriteBOM.js`. Just needed wiring.

  **A. BOM row 80 styling reset.** Writer now resets background, font
  weight, and font size on every §8 row before populating. Eliminates
  the persistent stale-styling class of bug. ~6 LOC.

  **B. BoS price wiring (the big one).** `_resolveBessBosPrice(bosLine,
  bosDb, ss)` helper added at file scope in `08_WriteBOM.js`. Routes
  by `productCategory`:
  - `CONDUCTORS` side=DC/AC → `conductorPriceObj` (THHW or PV WIRE)
  - `CONDUCTORS` side=DC_EGC/AC_EGC/GEC → `groundPriceObj` (BARE COPPER)
  - `CONDUIT` → derives conduit size via `selectConduit` (NOM 358 fill
    rule) using new `productSpec.condCount` + `condCuAreaMm2` +
    `condInsAreaMm2`, then `conduitPriceObj`
  - `DISTRIBUTION` side=DC/AC/DISCONNECT_AC → `breakerPriceWithFallback`
    with `productSpec.poles`

  Honors `isUsd` flag from each price object: pass to `wp(r, null, p)`
  for USD prices, `wp(r, p, null)` for MXN prices (matches PV-side
  convention). Reference column gets the resolved `BOS_ID` appended
  for traceability. When `breakerPriceWithFallback` returns a note
  (next-larger size used), that note is surfaced on the price cell.

  Caveat: `breakerPriceWithFallback` drops the `isUsd` field from its
  underlying `breakerILinePriceObj` (a quirk of the PV-side helper).
  We re-look-up `isUsd` via `breakerILinePriceObj` directly to
  recover it. If exact match isn't in DB and fallback was used,
  defaults to MXN (safe assumption since most Mexican BoS pricing is
  in MXN). Honest disclosure: this could mis-price a breaker that
  exists in DB at USD but only fits the next-larger-size fallback.
  Documented gap.

  **C. INPUT_BESS lipstick pass.** New `setupInputBessStyling`
  function (~120 LOC) applies token-based styling to §1-§4 without
  touching values, formulas, or dropdowns. Key design choice: walk
  known section/body rows, apply style; refuse to write to a row
  whose existing label doesn't match expectations (defensive).
  - Page canvas: hidden gridlines, column widths (A=24, B=220, C=280,
    D=30, E=140, F=120, G=80) — fixes the B/C "way too wide" issue
  - Logo + title (rows 1-3): `_insertArgiaLogo` in B2-C2, merged
    title "INPUTS DE ALMACENAMIENTO" in D2-F2 (FS_TITLE), italic
    muted subtitle in row 3
  - Section headers (rows 5, 9, 19, 22): bold + divider line
  - Body rows: token font/color, BG_INPUT_CELL on value cells,
    thin divider
  - E6:F7 cleared (removes "Provider:" / "Model:" leftover labels)
  - `setFrozenRows(3)` so title stays visible
  - Added to Setup submenu

  **productSpec enrichment for BoS price resolution.**
  `calcBessBosQuantities` now puts the price-resolver-needed fields
  on each line's `productSpec`:
  - Conductors: `cuAreaMm2`, `insAreaMm2`, `parallels`, `phases` (AC)
  - EGC: `cuAreaMm2`
  - Conduit: `condCount`, `condCuAreaMm2`, `condInsAreaMm2`
    (computed: DC = 2 × parallels + 1 EGC; AC = 3 × parallels + 1 EGC)
  - OCPD / disconnect: `poles` (1 for DC, 3 for AC)

  Backward compat: all existing `productSpec` fields preserved
  (`awg`, `side`, `ratingA`, `conduitType`, `batteryId`,
  `flatPriceMxn`). BDF-7..8 tests still pass.

  Files changed (BDF-9):
  - `08_WriteBOM.js` — §8 row styling reset; BoS price wiring;
    new `_resolveBessBosPrice` helper at file scope
  - `22_CalcBessBosQuantities.js` — `productSpec` enriched with
    price-resolver fields for every line type
  - `02e_InputSetup.js` — new `setupInputBessStyling` function
  - `00_Main.js` — "Setup INPUT_BESS Styling" menu item added
  - `templates/ActiveChunk.js` — bdf9

  Tests added (22 assertions):
  - `tests_unit/calc/CalcBdf9Tests.gs`:
    - `UNIT_BDF9_BOS_PRODUCTSPEC_ENRICHED` — every line type carries
      the right price-resolver fields (cuAreaMm2 for conductors,
      condCount for conduit, poles for breakers, phases for AC)
    - `UNIT_BDF9_BACKWARD_COMPAT_BDF7` — quantities unchanged from
      BDF-7, existing productSpec fields preserved, DC_COUPLED still
      produces no AC lines

  Cumulative tests after BDF-9: 216 + 69 + 39 + 65 + 21 + 45 + 22 =
  477/477 in Node dryrun. No regressions.

  Honest gaps that remain:
  - BoS price resolution accuracy depends on `14M_PRODUCTS_BOS` row
    completeness. If a specific AWG isn't in DB, conductor line shows
    "pendiente". Same for conduit sizes not in DB.
  - `breakerPriceWithFallback` isUsd handling has the documented
    edge case above. Fix that helper to preserve isUsd is a small
    follow-up if you ever see USD-priced breakers in your DB.
  - INPUT_BESS lipstick is one-shot — designer runs it once, value
    edits persist. Re-running is safe but won't roll back manual
    style overrides the designer applied after.

- **BDF-10: Live-workbook polish round 2 — small bugs caught after BDF-9 push**

  After pushing BDF-9 and viewing the live BOM + INPUT_BESS, more
  small inconsistencies surfaced:
  - BOM §8 populated rows were 26 px tall while §7 rows above were 22 px,
    making §8 feel taller and creating visual misalignment in col A
    (item numbers appeared "off")
  - INPUT_BESS rows 18 / 19 had orphan labels ("Voltaje bus DC", "Voltaje
    sistema AC") from a pre-BDF-7 design pass — no formula or input
    wired them; just confused the designer
  - INPUT_BESS row 22 (PEAK SHAVING section header) had explanatory
    text in C22 ("Solo aplica si BESS_STRATEGY = PEAK_SHAVING")
    rendered as a plain input cell — looked editable when it shouldn't
  - INPUT_BESS column Q held helper/scratch values (4064, 2032, 0.1,
    0.9, 40000000) driving formulas in col C, but visible to the
    designer as noise
  - BESS-11 (GEC) had no AWG in productSpec, so the BDF-9 BoS price
    resolver returned null — line stayed pending even though the DB
    has bare-copper SKUs for every standard AWG

  **A. BOM §8 row heights → 22 px.** One-line change in `08_WriteBOM.js`:
  `bom.setRowHeight(rowIdx, 22)` instead of 26. Matches PV-side. With
  BDF-8's short descriptions, 22 px is plenty.

  **B. INPUT_BESS row 18 / 19 cleanup.** New block in
  `setupInputBessStyling`: `clearContent` + `setBackground(null)` +
  `setBorder(false, ...)` on rows 18-19 cols B-G. These become blank
  spacer rows between §2 specs and the §3 commercial header.

  **C. INPUT_BESS column Q hide.** New block: `sh.hideColumns(17)`
  wrapped in try/catch (GAS sometimes throws when column already
  hidden). Idempotent. Formulas in col C still reference Q rows
  fine — hiding doesn't affect formula evaluation.

  **D. INPUT_BESS C22 helper styling.** When C22 contains "Solo aplica"
  (the PEAK_SHAVING gate explanation), style it italic + TEXT_SECONDARY
  + no background. Reads as helper text, not an editable cell.

  **E. GEC AWG plumbing (the real bug).** New `_resolveGecAwgSpec`
  helper in `22_CalcBessBosQuantities.js` mirrors the NOM 250-66 table
  from `24_CalcBessNomChecks.js`. Given a circuit, finds the largest
  ungrounded conductor's `cuAreaMm2` and returns the required GEC AWG
  label + mm². Wired into BESS-11 line so `productSpec.awg` is now
  populated. The BDF-9 BoS resolver picks it up automatically.
  Description now includes the AWG label (e.g. "GEC (electrodo a
  tierra) AWG 4") so the designer can see what was sized without
  hovering for the cell note.

  Honest design choice: I duplicated the NOM 250-66 table in
  `22_CalcBessBosQuantities.js` rather than refactoring
  `24_CalcBessNomChecks.js` to export it. Reason: the BoS calc runs
  BEFORE nomChecks in the pipeline (lines are emitted, then nomChecks
  validates them). Importing the table from nomChecks would create a
  reverse dependency. Duplicating is OK because (a) the table is
  small + stable (NOM regulation), (b) both copies live in adjacent
  files, (c) drift between them would be caught by integration tests
  that exercise both paths. If you later want a single source of
  truth, extract the table to a shared module — small follow-up.

  Files changed (BDF-10):
  - `08_WriteBOM.js` — row height 26 → 22 on populated §8 rows
  - `22_CalcBessBosQuantities.js` — BESS-11 productSpec carries
    awg + cuAreaMm2; new `_resolveGecAwgSpec` helper at file scope
  - `02e_InputSetup.js` — new B18/B19 clear block; col Q hide;
    C22 italic-muted styling
  - `templates/ActiveChunk.js` — bdf10

  Tests added (20 assertions):
  - `tests_unit/calc/CalcBdf10Tests.gs`:
    - `UNIT_BDF10_GEC_AWG_RESOLVER` — 4/0 AWG → #4 AWG GEC,
      350 kcmil → #2 AWG GEC, 13.30 mm² → #8 AWG GEC, derivation
      string cites NOM 250-66, empty circuit handled gracefully
    - `UNIT_BDF10_BACKWARD_COMPAT_BDF9` — all BDF-9 productSpec
      fields preserved (cuAreaMm2, parallels, phases, condCount,
      poles); BDF-7 quantity contract still holds

  Cumulative tests after BDF-10: 216 + 69 + 39 + 65 + 21 + 45 + 22 +
  20 = 497/497 in Node dryrun. No regressions.

  Still pending (not in scope for BDF-10):
  - Designer should verify BESS-11 actually finds a bare-copper SKU
    for "AWG 4" in `14M_PRODUCTS_BOS`. The DB dump showed AWG 8/10/12/14
    in the BARE COPPER subcategory; #4 and larger may be missing. If
    so, that's a DB data gap, not a code bug.
  - Live row heights for monitoring §7 rows (28-30 in image 1) might
    not be exactly 22 either. If §8 still looks visually off after
    BDF-10, the next step is to set a uniform height across ALL BOM
    content rows from the template (not just §8 from the writer).

**Not started (output migration track):**
- Chunk 2: BOM_v2
- Chunk 3: PROJECT_CARD_v2
- Chunk 4: INSTALLATION_v2
- Chunks 5–9: RFQs_v2
- Chunk 10: CFE_OUTPUT_v2 (note: BDF-5 hourly synthesizer will land here)
- Chunk 11: Cutover
- Chunk 12: Reset feature

**Not started (BDF track):**
- (None — BDF track complete with BDF-1..5)

**BDF-5 known follow-ups (small chunks worth doing if customer-facing
relevance materializes):**
- DIST/RAMT window encoding (currently fall back to flat-rate with warning)
- Schedule-tab reader: have engine prefer 21M_CFE_SCHEDULE data over hard-
  coded GDMTH windows, so tariff updates are data-driven
- Real hourly PV shape from PV calc step (currently uses piecewise-flat
  daylight proxy; replaces with actual hourly PV when the PV engine
  exposes it)
- Monthly NET_METERING cap (currently uses annual proxy; CFE actually
  caps monthly with credit roll-forward)
- GDMTH window verification against current CFE tariff document for
  each region the business deploys to

**Decisions locked:**
- Two parallel codebases for the output migration, no shared writer code
- Tokens + primitives are infrastructure, shared
- Sheet suffix is `_v2` (lowercase) for output migration
- Files: `setup<Sheet>Template.js`, `Write<Sheet>V2.js`
- Functions: `setupXTemplate(ss)`, `writeXV2(ss, ...)`
- Folder structure: `templates/`, `writers_v2/`, etc.
- Cutover model: Flavor 1 (atomic, at end)
- Engine integration: both paths run in parallel during transition
- Kicker and SlideData out of scope
- Working protocol: chunk-atomic verification, no mid-chunk pushes

**Decisions locked (BDF track):**
- BESS_RECOMMENDATIONS is a DESIGNER TOOL sheet, not a customer-facing
  output. Flat table, no v2 template ceremony, no design tokens.
- Tariff rates auto-derive from INPUT_CFE's actual billed MXN-per-kWh
  rather than the 20M_CFE_TARIFFS resolver. The resolver remains future
  work; INPUT_CFE-derived rates are more accurate per-project anyway
  because they're what the customer actually pays.
- BDF-5 hourly synthesizer is for BILLING-GRADE customer-facing output
  (CFE_OUTPUT_v2). Designer-tool sizing stays MONTHLY via the existing
  `calcBessSizing`. Two engines, one for ranking, one for quantification.
  Sharing implementation between them is more dangerous than maintaining
  two clean small ones.
- `Installed_CAPEX_MXN` is the single price column. `Notes` duplication
  in MASTER_DB resolved by user. Defensive header check throws hard on
  critical-column duplicates, warns on non-critical.

**Decisions added during Chunk 1 (lessons learned, apply to all future chunks):**
- MDC_v2 keeps the legacy 8-col layout (B label, C value, D unit, E status,
  F citation, G formula, H margin). The 7-col primitive grid in
  `02b_LayoutPrimitives.js` is for inputs and simpler outputs. Other v2
  writers (BOM, ProjectCard, RFQ) will use the primitive grid where
  appropriate.
- `setup<Sheet>Template(ss, opts)` accepts an optional `opts.sheetName`
  override so integration tests can target a scratch sheet without
  corrupting the live `<Sheet>_v2`. Same pattern reused in Chunks 2+.
- Tests touching live sheet state MUST use try/finally cleanup. Bug found
  on day 1 of Chunk 1: integration tests `clear()`ed MDC_v2 before
  regression baseline ran, breaking the baseline. Pattern: unique scratch
  sheet name `_<Sheet>_v2_TEST_<timestamp>`, deleteSheet in finally block.
- Per-chunk test runner: bump `ACTIVE_CHUNK_TAG` in
  `templates/ActiveChunk.js` per chunk, tag every new test with the chunk
  name. "▶ Run Tests for Current Chunk" picks them up in seconds.
- E2E test isolation bug in legacy is real but out of scope here.
  Deferred to Chunk 11 cutover cleanup.

**Decisions added during BDF-1 (lessons learned, apply to all future chunks):**
- Always validate engine output against real data before adding UX. BDF-0
  intuition check on real CULLIGAN bill caught Issue 2 (missing coverage
  flag) and Issue 3 (missing energy-shift savings) BEFORE we built the
  writer around them. 30 minutes saved hours.
- DB schema duplicates can silently corrupt sizing outputs (last-write-
  wins in JS object construction). Defensive header check in readers is
  cheap insurance against future drift.
- Backward-compat by default: new sizer opts (puntaRateMxnPerKwh,
  baseRateMxnPerKwh) default to 0; when 0, energy-shift saving is 0 and
  payback math is identical to pre-BDF-1. 32/32 legacy tests still pass.
- Hand-check engine math against test expectations BEFORE running tests.
  In BDF-1, two test expectations used wrong SPEC numbers; running the
  engine and comparing surfaced the discrepancy in 30 seconds.

**Decisions added during BDF-2 (lessons learned, apply to all future chunks):**
- Backward-compat lock as a dedicated test. The first BDF-2 test asserts
  that calcBessSizing with `interconnMode = UNKNOWN` produces BYTE-IDENTICAL
  numbers to BDF-1. This catches accidental drift in default behavior
  during future refactors. Pattern worth replicating: every new opt should
  have a lock test confirming "omitted = previous behavior."
- Use unused-row insertions to avoid breaking existing layout tests. BDF-2
  added an interconnection row to the writer; instead of shifting all
  downstream rows (which would break BDF-1 integration tests), I put it in
  the previously-blank row 6. No existing row positions changed, all
  BDF-1 tests still pass without modification. Default to additive layouts.
- Avoid making business recommendations in code or summaries. The BDF-2
  summary initially suggested "recommend customer switch to ZERO_EXPORT"
  — but that conflates "battery economics under different modes" with
  "what mode the customer should choose," which involves constraints the
  engine doesn't know (CFE approval, contract terms). Engine produces
  numbers; humans make recommendations.
- Document monthly-resolution proxies honestly inline. BDF-2 uses annual
  PV surplus as a proxy for "available to charge battery." This is
  approximate (surplus and charge-need don't always align in time). The
  code comment says so explicitly, and the docstring quantifies WHEN it's
  reasonable (battery small relative to surplus = optimistic; large = OK).
  Future engineers reading the code know the limitation; future-them
  building BDF-5 has the spec for what tighter math is needed.

**Decisions added during BDF-3 (lessons learned, apply to all future chunks):**
- Code-driven cell creation pattern via idempotent setup functions. BDF-3
  added rows 36-40 to INPUT_BESS via `setupInputBessEconomicsRows()`.
  Pattern: safety-check existing content, write labels (always safe to
  overwrite), seed default values only when cells are blank (preserves
  designer-typed values on re-run). Run-once-per-workbook deploy step.
  Future v2 chunks adding inputs should use this pattern.
- When you change a layout (here: tariff override rows moved from 36/37 to
  38/39 to make room for the threshold), update all callers in the same
  chunk. Caught a silent bug in BDF-1 reader doing this. Drift between
  readers and writers is the worst kind of bug because it produces no
  error, just wrong numbers.
- Reader-side defensive defaults: `readBessMinSavingsThreshold` returns
  `{thresholdMxn: 0, provenance: 'DISABLED'}` when the sheet doesn't have
  the row yet (pre-BDF-3 workbook). 0 means "disabled" everywhere in the
  engine, so a pre-BDF-3 workbook silently behaves like BDF-2 — no
  regression. This is a cheap robustness pattern worth replicating: new
  features default to "off" so old workbooks aren't broken by deploys.
- Display-layer filtering is cleaner than engine-layer filtering. BDF-3
  considered filtering candidates inside `calcBessSizing` based on
  threshold; I kept the engine's return shape complete (all candidates,
  flagged with `meetsThreshold`) and put the filter in the writer.
  This preserved BDF-1/2 tests byte-identically and made the engine more
  reusable. Filter at the layer that displays, not at the layer that
  computes.

**Decisions added during BDF-4 (lessons learned, apply to all future chunks):**
- Schema-driven feature flags (vs config-driven). User added `Stackable`
  + `Max_Stack_Units` columns to MASTER_DB rather than hardcoding stack
  limits per product in JS. Engine code stays generic; business knowledge
  lives in the data. Pattern: when adding a per-product capability, ask
  "should this be a column?" before reaching for if/else.
- Either/or fallback for backward compat. BDF-4 removed ladder
  candidates when library is passed (production path), but PRESERVED
  ladder as a fallback when library is empty (legacy test path). Same
  function, two modes: production gets clean output, tests get unchanged
  behavior. Required zero test edits for the ladder-dependent BDF-1/2/3
  tests. One legacy library-coexistence test had to be updated because
  it was specifically asserting the OLD "ladder + library together"
  contract — that's the right thing to update, not to preserve.
- Engine surfaces options; picker is best-effort. With stacks, the
  picker's "smallest-capacity-for-highest-shave" tie-break sometimes
  picks the wrong stack (e.g. 15 × 241 over 2 × 2MWh for same coverage,
  higher CAPEX). Honest engineering: the picker is a suggestion, not a
  decision. The ranked table is the actual interface — designer reads
  all options and chooses. Don't over-engineer the picker to do
  multi-objective optimization; that's the designer's job.
- Honest CAPEX scaling: linear, document the ±10-15% caveat. Real
  multi-cabinet stacks have shared inverters, parallel BMS, possibly
  volume discounts. Engine assumes `qty × singlePrice` and SAYS SO in
  comments. Designers reading the code know to apply judgment when
  comparing to a real supplier quote.
- Power-constraint gap intentionally left. Engine's `shaveCapableKw =
  usableKwh / window` ignores nameplate kW. For typical 4h windows this
  is fine (almost all batteries are energy-limited, not power-limited).
  For shorter windows or very low-C-rate batteries it would underestimate
  shave. Conservative direction — never claims more than actual.
  Documented in BDF-4 limitations block. Deferred to a future small
  chunk if it ever bites in production.

**Decisions added during BDF-5 (lessons learned, apply to all future chunks):**
- Honest pushback when the question's math doesn't add up. User asked for
  "8760 hourly from monthly bills only" — that's fundamentally not enough
  information. Instead of inventing fake shape data, I surfaced the
  impossibility, presented honest options (A/B/C/D), and let the user
  choose Option A (piecewise-flat). Result is honest output the engine
  can defend. This is exactly what `userPreferences` ("no BS") asked for.
- Two bugs found during BDF-5 development by RUNNING THE ENGINE on real
  scenarios, not just running unit tests. The unit tests would have
  passed even with the NET_METERING-pays-customer bug. The "run on real
  CULLIGAN, look at the numbers" check caught it in 30 seconds. Pattern:
  every chunk that touches money math gets a real-data dry-run before
  delivery.
- Effective-date constants for embedded tariff data. GDMTH windows are
  in code as `_GDMTH_DEFAULT` with `GDMTH_WINDOWS_EFFECTIVE_DATE` next
  to it. When future-Argia updates the windows, the change is one place,
  obvious, and the provenance string in every result reflects which
  version was used. Pattern worth replicating for any tariff/regulatory
  data that has effective dates.
- Demand charges are non-negotiable in customer-facing cost output.
  Initially I built BDF-5 with energy cost only — would have produced
  numbers customers couldn't reconcile against their actual bills.
  Caught it before delivery. Pattern: any "total cost" number in
  customer-facing output must include BOTH energy AND demand.
- Minimal-addendum pattern for incremental customer-facing changes.
  Instead of restructuring `06_WriteCfeOutput.js` (700+ LOC) to do
  full side-by-side, I added a 6-row addendum. Designer sees the new
  number; existing customer-facing layout stays untouched. Full
  redesign deferred to a proper CFE_OUTPUT_v2 chunk. Pattern: when
  a chunk would force redesign of a large legacy writer, add an
  addendum first, ship it, redesign in a separate chunk.

---

## 8. Out of scope (explicitly noted)

These are not part of the v2 migration. Listed so we don't accidentally
expand scope.

- `30_ArgiaKicker.js` (slide deck generator)
- `SLIDE_DATA` sheet
- Helioscope import (`11_HelioscopImport.js`)
- INPUT setup functions (`02e_InputSetup.js`) — these are inputs, not
  outputs
- CFE_SIMULATION and BESS_SIMULATION sheets — these are formula-driven
  live sheets, not engine writers
- Any audit/diagnostic sheets (`_AUDIT_INPUTS`, `LOGS`, `_META`,
  `_TEST_RESULTS_V2`) — these are not customer-facing deliverables
- Reset Inputs / Reset Everything — built in Chunk 12 after the writers
  are migrated, not before
- Folder reorganization of legacy files — never moves. Legacy is deleted
  in cutover, not relocated
- README / CHANGELOG / lint / CI — covered by the original cleanup plan,
  deferred to after v2 migration completes
