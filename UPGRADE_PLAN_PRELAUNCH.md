# ARGIA ENGINE — Pre-Launch Upgrade Plan (Big Batches)

**Date:** 2026-06-10 · **Base:** `b303b1e` · **Test state:** 487 registered / 448 headless green / 0 fail

**Delivery mode change:** Work is grouped into 4 large batches. Each batch is ONE
push cycle: one tarball, one `full_selftest.js` run, one `git push`, one `clasp push`,
one in-sheet "Run ALL Tests". Inside a batch, items are still developed test-first,
but you only iterate per-batch, not per-fix.

**Hard sequencing:** B1 → B3 dependency is structural (Synthetic Test Mode requires
the clean-reset and run-all orchestrator from B1 to exist). B2 is independent of B1/B3
and can run in parallel if you want to split data work from code work.

---

## LAUNCH GATE (what MUST be fixed before market)

| # | Item | Batch | Why it blocks launch |
|---|------|-------|----------------------|
| G1 | BESS pricing re-quote in MASTER_DB (target ≤ $350 USD/kWh installed) | B2 (data) | Every BESS proposal currently shows negative NPV / "no payback in term". Unsellable. |
| G2 | Burdened install labor rates (or burden factor) + 1 real benchmark in 94_INSTALL_BENCHMARKS | B2 | Install at ~0.07 USD/Wp is 30–50% under real subcontract cost; margin is fictional. |
| G3 | Silent $0 lines (transformer, inverter racks) → loud "SIN COTIZAR" flags + excluded-from-PASS validation | B2 | A client-facing total that silently omits a 1000 kVA transformer is a credibility incident. |
| G4 | Staleness guard: input-hash banner on every v2 output + exports | B1 | Current workbook proves mixed-project outputs can be exported today. |
| G5 | "Start New Project" clean reset (no test residue carried into client projects) | B1 | You cannot safely start a real client project in the current workbook state. |
| G6 | Financials: O&M = 0 / replacement reserve = 0 on a BESS project → loud warning + sane defaults | B2 | Cash analysis with zero O&M on PV+BESS will not survive a client's energy consultant. |
| G7 | PDF filename fix (retired INPUT_GENERAL read) | B1 | Every exported PDF is named `ARGIA_ENGINE_CLIENT_…` today. Client-visible. |
| G8 | Synthetic validation run green on all 3 sizes (SYNTH_500/600/650) | B3 | Launch evidence that the engine works from explicit inputs only, at market-typical sizes. |

Not launch-blocking (defer freely): BESS_SIMULATION keep/retire, roof-compat check,
15-yr lease projection port, INPUT_CFE logo, repairs demotion (B4).

---

## BATCH 1 — "Workbook Lifecycle & Trust" (code-only, no DB edits)

**Theme:** everything that controls *when outputs can be trusted* and *how a project
starts/ends*. One push. Absorbs the remaining A2 infrastructure items.

### B1.1 Start New Project (admin command, menu)
- New `runStartNewProject()`: confirm dialog → persistent input snapshot (B1.2)
  → `rebuildInputsToDefault()` (promoted from private `rebuildInputsToDefault_`,
  VERIFY-POINT resolved against the live setup order) → clear ALL `*_v2` output
  tabs + 95_INSTALL_DRIVER_MAP_v2 → clear run-hash in `_META` → refresh audit.
- Files: `00_Main.js` (menu + command), `00d_InputSnapshot.js` (promote + verify),
  `02e_InputSetup.js` (any ordering fixes the VERIFY-POINT exposes).

### B1.2 Retire copyTo backup (close A2)
- Replace `TestSheetBackup.gs` copyTo path behind "Load CULLIGAN Fixture" /
  "Restore Inputs from Backup" with the proven formula-aware snapshot, persisted
  to a hidden `_INPUT_BACKUP` sheet (survives sessions, covers ALL SIX tabs incl.
  INPUT_BAAS, safe for INPUT_CFE array formulas).
- Delete the stale "INPUT_CFE deliberately excluded" comment contradiction.
- Files: `test/TestSheetBackup.gs` (retire), `00d_InputSnapshot.js` (persist layer),
  `00_Main.js` (rewire 2 menu items).

### B1.3 Generate ALL Deliverables (orchestrator)
- New `runGenerateAllDeliverables()`: runArgiaEngine → RFQs → BaaS Projection →
  Client Financials, in dependency order, single progress bar, one end-of-run
  summary alert listing per-deliverable OK/WARN/FAIL.
- Files: `00_Main.js`.

### B1.4 Staleness guard
- `computeInputsHash(ss)` over the six INPUT tabs (values+formulas, normalized).
- Engine writes hash + timestamp to `_META` at run end. Every v2 writer stamps
  the hash it consumed. New `assertOutputsFresh()`: banner row
  "⚠ ENTRADAS MODIFICADAS DESDE EL ÚLTIMO CÁLCULO — REGENERAR" on any v2 tab whose
  stamp ≠ current hash; `12_ExportPDF` refuses (with override prompt) to export
  stale tabs. BaaS/Financials runners hard-warn when BOM/INSTALLATION stamps are stale.
- Files: new `00e_InputsHash.js`, `writers_v2/*` (stamp call), `12_ExportPDF.js`,
  `30b/31a` runners.

### B1.5 PDF filename fix
- `_getProjectMeta` → read `projectName` / `clientName` via `readInput()` map
  (INPUT_PROJECT), drop INPUT_GENERAL read.
- Files: `12_ExportPDF.js`.

### B1.6 Audit completeness
- Add `CLIENT_FINANCIALS_v2` (and `BESS_RECOMMENDATIONS`) to `AUDIT_OUTPUT_SHEETS`.
- Menu item "Audit Config (auto-discover)" → `auditConfigSetup`.
- New contract test: every sheet name written by a registered v2 writer MUST appear
  in audit config/backstop → audit can never drift behind a new deliverable again.
- Files: `97_InputAudit.js`, `00_Main.js`, new unit test.

### B1 tests & gate
- New: UNIT hash determinism/sensitivity; INT start-new-project leaves zero residue
  (assert all INPUT tabs == DEFAULT golden, all v2 tabs empty); INT persistent
  backup round-trip incl. INPUT_BAAS + INPUT_CFE formulas; INT orchestrator order;
  REG stale-banner appears/clears; UNIT audit contract.
- Gate: full_selftest green; in-sheet ALL green; CULLIGAN E2E 85/85 unchanged
  (orchestrator + hash must not move golden bytes except the new stamp row, which
  the golden gets extended for — single intentional golden update, documented).
- Estimated size: ~8 files touched, ~10–12 new tests. One push.

---

## BATCH 2 — "Numbers You Can Sell" (data + calibration code)

**Theme:** every figure a client sees. Mix of YOUR data work and code guards.
One push for code; DB edits land the same day so re-verification happens once.

### B2.1 (YOU — data) BESS re-quote
- Current DB: $490–530/kWh hardware, ~$718/kWh installed (LUNA cabinets).
  Market 2026 C&I turnkey: ~$200–450/kWh. Get current Huawei MX distributor quote;
  update `16_PRODUCTS_BESS` `BESS_price_per_unit_mxn` + `Installed_CAPEX_MXN`,
  set `Quote_Date`.
- Code support: BESS price sanity check in `09c_InstallCostSanity`-style validator:
  WARN if implied USD/kWh outside [150, 450]; FAIL if Quote_Date > 9 months old.

### B2.2 (YOU — data, ME — code) Labor burden
- Either burdened MXN/MH values in 92_INSTALL_ROLE_RATES, or new
  `PERCENT / LABOR_BURDEN` factor (default 1.65×) applied to labor in
  `calcInstallCost` — factor route preferred: tunable, version-controlled, testable.
- Fill `94_INSTALL_BENCHMARKS` with ≥1 real subcontractor quote; wire
  `applyKwpBenchmarks` deviation warning (>±25% vs benchmark → MAJOR log + banner).
- Also: HD_CRANE 100,000 MXN/day → re-quote (typical 25–50k).

### B2.3 Zero-line policy in BOM/Project Card
- Transformer + inverter-rack lines: blank price → render "SIN COTIZAR" (reuse the
  B-2 structure pattern), excluded-items note on TOTAL row, Project Card validation
  shows "INCOMPLETE" not "PASS" when any SIN COTIZAR line exists.
- Files: `writers_v2/WriteBomV2.js`, `writers_v2/WriteProjectCardV2.js`, `09b`.

### B2.4 Financials O&M / reserve guards
- If BESS enabled and (omCost==0 or replacementReserve==0): banner on
  CLIENT_FINANCIALS_v2 + suggested defaults written as INPUT_BAAS/INPUT_DESIGN
  hints (O&M: 1.0–1.5% of PV CAPEX/yr; reserve: from 25_CalcBessWearCost).
- Files: `31a_RunClientFinancials.js`, `writers_v2/WriteClientFinancialsV2.js`.

### B2.5 B-1 BESS screening $92M Óptimo cap (existing queue item)
- Scope-check vs CULLIGAN-locked cells first (per standing rule), then fix + REG test.

### B2 tests & gate
- New: UNIT burden factor math; UNIT BESS $/kWh sanity bounds; REG BOM SIN COTIZAR
  transformer; REG project-card INCOMPLETE on zero-lines; REG financials zero-O&M
  banner; B-1 regression.
- Golden impact: CULLIGAN golden master WILL move (install totals, BESS totals,
  financials). One intentional, documented golden refresh after DB lands — this is
  the single biggest reason B2 is one batch: you re-baseline the golden ONCE.
- Estimated size: ~7 files + 2 DB sheets, ~8 new tests, 1 golden refresh.

---

## BATCH 3 — "Synthetic Test Mode" (depends on B1)

**Theme:** prove the engine end-to-end from EXPLICIT INPUTS ONLY — no reliance on
prefilled template values, no residue. Three market-typical sizes, scenario matrix
designed to exercise every calc branch.

### Why it must follow B1
"No prefilled data allowed" is only testable if (a) a verified DEFAULT rebuild
exists (B1.1) and (b) a full-pipeline orchestrator exists to drive all deliverables
(B1.3). The mode's core loop is: **snapshot → DEFAULT rebuild → write ONLY the
fixture's explicit inputs → runGenerateAllDeliverables → assert goldens → restore.**
Any output that differs when a template default is changed = hidden prefill
dependency = test failure. That is the whole point of the mode.

### B3.1 Fixture framework
- New `test/SyntheticFixtures.gs`: declarative registry
  `SYNTH_FIXTURES = { SYNTH_500: { inputs: {inputKey: value,…}, expected: {…} }, … }`
  written via the INPUT_MAP `writeInput()` path only (never raw A1) — so fixtures
  double as a completeness test of the input map itself: any engine-consumed input
  with no map key cannot be set explicitly → surfaces immediately.
- `runLoadSyntheticFixture(id)` + `runSyntheticE2E(id)` + `runSyntheticE2EAll()`.
- Menu: ARGIA → Administrator Panel → Synthetic Test Mode →
  [Load SYNTH_500 | Load SYNTH_600 | Load SYNTH_650 | Run E2E 500 | … | RUN ALL].
- Prefill tripwire: after DEFAULT rebuild and before fixture write, assert every
  engine-consumed numeric input cell is blank/default-sentinel; any non-default
  value = FAIL "template prefill leaked into synthetic mode".

### B3.2 Scenario matrix (each size stresses a different code region)

| | SYNTH_500 | SYNTH_600 | SYNTH_650 |
|---|---|---|---|
| DC size | 500.48 kWp (782×640W) | 599.04 kWp (936×640W) | 650.24 kWp (1016×640W) |
| Topology | STRING | **OPTIMIZER** | STRING, **2 inverter models mixed** |
| BESS | **OFF** (all BESS_* gating must zero out) | ON — PEAK_SHAVING, 2×215 kWh | ON — **LOAD_SHIFTING + FACTURACION_NETA**, 4×241 kWh |
| Tariff / region | GDMTH **BAJIO** | GDMTH **NORESTE** | GDMTH **NORTE** |
| FP scenario | PF ≥ threshold (bonus path) | **PF < 0.9 (penalty path)** | PF ≥ 0.97 case (post-Apr-2026 threshold, ≥1 MW contracted) |
| Install factors | ROOF, all defaults (1.0 path) | ROOF, HEIGHT GT_10M + RAIN + ACCESS MEDIUM (factor stack) | **CARPORT** (1.3 type factor) + TIE_IN YES |
| Structure | S-5 type selected | selected | **deliberately BLANK → must render ESTRUCTURA NO SELECCIONADA + SIN COTIZAR** |
| Transformer | none | none | **present → must render SIN COTIZAR (B2.3)** |
| Exercises | BESS-off gating, baseline factors, bonus FP, clean BOM | optimizer NA gates (MDC/STR/DC guards), factor multiplication, penalty FP, BESS install §8 | mixed inverter bank AC sizing, net-billing arbitrage sim, interconnection consistency check, zero-line policy, CARPORT path |

- Each scenario gets a golden assertion set (CULLIGAN-style, smaller: ~25–35
  assertions each) covering: MDC key electricals, BOM subtotals, INSTALLATION
  totals + derived days, CFE bill (bonus vs penalty visibly different), BESS
  dispatch headline, financials headline, and the negative assertions
  (N/A gates, SIN COTIZAR flags, LOAD_SHIFTING warning absent because mode=NET_BILLING).
- Rate isolation: synthetic fixtures write canonical tariff values to input cells
  at load time (established pattern), so goldens never break on live IMPORTRANGE drift.

### B3.3 Negative/edge scenario pack (cheap once framework exists)
- SYNTH_NEG_1: BESS toggle OFF but §5/§6 rows filled → outputs must show zero BESS.
- SYNTH_NEG_2: LOAD_SHIFTING + non-net-billing → MAJOR warning must fire.
- SYNTH_NEG_3: missing inverter model in DB → validation block, no partial writes.

### B3 gate
- All synthetic E2Es green in-sheet, CULLIGAN E2E untouched, full_selftest green.
- Estimated size: ~3 new files, ~110–140 new assertions. One push.
- **This batch's RUN ALL is launch-gate evidence G8.**

---

## BATCH 4 — "Hygiene" (last, small, zero risk)

- Dead duplicate `subsection` key in `loadInstallLib` (13_CalcInstallCost.js ~609).
- Run "Delete Legacy Tabs" in live workbook (95_INSTALL_DRIVER_MAP).
- New test: fresh DEFAULT rebuild → all repair functions (02f/02g/02h/27b) are
  no-ops → then demote repairs to a "Migrations (legacy)" submenu.
- Tariff DB UNIT-column label corrections (cosmetic; calc keys on CHARGE_TYPE).
- INPUT_CFE logo (deferred cosmetic).
- Estimated size: trivial. Can ride along with any batch if preferred.

---

## Execution order & effort

```
B1 (code)  ──────►  B3 (synthetic mode)   ► launch evidence
B2 (data+code, parallel-safe with B1) ───►  golden refresh ONCE
B4 rides last (or tucked into B3 push)
```

| Batch | Pushes | Your iterations | Rough effort |
|---|---|---|---|
| B1 | 1 | install tarball, run ALL tests once, click through new menu items once | largest code batch |
| B2 | 1 (+ your DB day) | one re-verify after DB lands, one golden refresh | medium |
| B3 | 1 | RUN ALL synthetic, read the report | medium |
| B4 | 1 (or 0, folded in) | none beyond the ride-along | trivial |

Total: **3–4 push cycles** to launch-ready, versus the historical per-fix cadence.

## Definition of LAUNCH-READY
1. G1–G8 all closed.
2. `full_selftest.js` green; in-sheet ALL tests green; CULLIGAN 85/85 (re-baselined once in B2).
3. SYNTH RUN ALL green from a Start-New-Project state — no prefilled data, no residue.
4. One real proposal regenerated end-to-end via "Generate ALL Deliverables" and
   sanity-read by a human against a competitor quote.
