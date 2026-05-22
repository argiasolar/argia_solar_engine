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

**Current chunk:** Pre-Chunk 0 (planning approved, work not started)

**Completed:**
- Plan written and approved

**Not started:**
- Chunk 0: Template framework
- Chunk 1: MDC_v2
- Chunk 2: BOM_v2
- Chunk 3: PROJECT_CARD_v2
- Chunk 4: INSTALLATION_v2
- Chunks 5–9: RFQs_v2
- Chunk 10: CFE_OUTPUT_v2
- Chunk 11: Cutover
- Chunk 12: Reset feature

**Decisions locked:**
- Two parallel codebases, no shared writer code
- Tokens + primitives are infrastructure, shared
- Sheet suffix is `_v2` (lowercase)
- Files: `setup<Sheet>Template.js`, `Write<Sheet>V2.js`
- Functions: `setupXTemplate(ss)`, `writeXV2(ss, ...)`
- Folder structure: `templates/`, `writers_v2/`, etc. — built in clean
  structure from day one, legacy stays flat at root
- Cutover model: Flavor 1 (atomic, at end)
- Engine integration: both paths run in parallel during transition
- Kicker and SlideData out of scope
- Working protocol: chunk-atomic verification, no mid-chunk pushes

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
