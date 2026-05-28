# Chunk 5 — Roadmap

> Single source of truth for what each session ships. Updated at every
> session boundary. Sister doc: `docs/CHUNK_5_PLAN.md` (original plan),
> `docs/CHUNK_5_SESSION1_SPEC.md` (Session 1 contract),
> `docs/CHUNK_5_MECHANISM_PAPER.md` (math + assumptions).

---

## Tier policy (enforcement mechanism)

Every BESS calculation result carries `meta.tier`:

| Tier | Where it's allowed |
|---|---|
| `'SCREENING'` | Internal use only. Never displayed to customer as a financial commitment. |
| `'PROPOSAL'` | Customer-facing proposal. Labeled as "estimate" in writer. |
| `'BANKABLE'` | Only when 15-min interval data has been uploaded for the specific project AND v5.0.0 has shipped. |

Session 3 writer code MUST check `meta.tier` before displaying ROI /
lease price / battery sizing recommendations. SCREENING tier blocks
those displays. This is the structural guarantee that we don't ship
unvalidated numbers to customers.

---

## Session 1 — Monthly Strategy Planner (SCREENING tier)

**Status:** code-complete + 15/15 tests PASS (Node harness). Pending
push + run in Apps Script.

**Ships:**
- `20b_PlanMonthlyBessSchedule.js` — pure-function Level 1 planner
- `tests_unit/calc/PlanMonthlyBessScheduleTests.gs` — 15 unit tests
- `docs/CHUNK_5_SESSION1_SPEC.md` — contract
- `docs/CHUNK_5_MECHANISM_PAPER.md` — math review
- `docs/CHUNK_5_ROADMAP.md` — this doc

**Engine integration:** none. Module reachable only by tests.

**Tier:** SCREENING (hardcoded in planner output).

**Exit criterion:** 15/15 unit tests PASS in live Apps Script.

---

## Session 2 — Level 2 Executor + Wear Cost Module

**Pulls forward from former "Session 2.5"** per reviewer R2 §2.2. Wear
cost matters for battery selection, not just dispatch — so it ships
alongside the executor.

**Ships:**
1. **Level 2 executor.** Replaces the body of the per-hour battery
   block in `_bessDispatchHour`. Each hour now reads the precomputed
   schedule, applies real-SoC clamping, and executes. Same return
   shape (so downstream writers don't break).
2. **`25_CalcBessWearCost.js`** — pure-function module:
   ```javascript
   calcBessWearCostMxnPerKwh({
     capexMxn, capacityKwh, usablePct,
     cycleLifeAt100Dod,
     residualValuePct
   }) -> num
   ```
   Formula: `(capex × (1 − residual)) / (cycleLife × usable)`.
3. **INPUT_BESS extension.** Three new cells:
   - `bessCycleLifeAt100Dod` (default 6000)
   - `bessWarrantyYears` (default 10)
   - `bessResidualValuePct` (default 0.05)
4. **BESS_LIBRARY catalog extension.** Two new columns in MASTER_DB
   BESS_LIBRARY: `cycleLifeAt100Dod`, `warrantyYears`. CAPEX
   already there.
5. **`21_BessPickerWiring.js` scoring update.** When two batteries meet
   the technical requirements, prefer the one with lower
   `effectiveCostMxnPerLifetimeKwh = capexMxn / (cycleLife × usable)`.
   This is the reviewer's selection-effect concern: Battery A (lower
   MXN/cycle-kWh, higher upfront CAPEX) beats Battery B at the same
   technical fit.
6. **Plumb `actualBilledDemandKw` and `wearCostMxnPerKwh` into `monthCtx`** —
   the data sources are ready; this is just wiring.
7. **PV-only third sim run.** `20a_RunHourlySimulation.js` runs the
   hourly sim three times per project: (a) no PV no BESS, (b) PV only,
   (c) PV + BESS. Lets the writer isolate BESS-attributable savings.
8. **Unify PV shape.** Replace the flat-daylight PV in
   `20_CalcHourlySimulation.js:531-538` with the bell-curve shape from
   Session 1's `_planSyntheticPvBellShape`. Planner and executor now
   agree on PV timing.

**Tests:**
- ~5 unit tests for the executor (schedule-respect, SoC clamping,
  same return shape as old `_bessDispatchHour`)
- ~5 unit tests for wear cost module (formula, edge cases, no-NaN)
- 1 integration test (`UNIT_BESS_PLANNER_TO_EXECUTOR_ROUNDTRIP`):
  given a `monthCtx`, plan + execute, verify the daily totals match
  the schedule's daily budgets
- Extend `BessDispatchStrategyTests.gs` to verify PS=SC convergence
  is preserved across Level 1 + Level 2

**Tier:** still SCREENING. Customer not yet seeing these numbers.

**Exit criterion:** all unit tests PASS + CULLIGAN regression baseline
within ±1% per tier of pre-Chunk-5.

---

## Session 3 — Writer Rewrite + AUTO_OPTIMIZE + Conservative/Expected/Upside

**Ships:**
1. **`_cfeOutV2_fillSection2` rewrite.** Reads from the
   three-run hourly results instead of the formula sheet. Per-tier
   BESS-attributable savings:
   ```
   savingsByTier[t] = bill(PV_only)[t] - bill(PV_plus_BESS)[t]
   ```
   Floor at zero per tier (no negative "savings").
2. **`_runBessAutoOptimize`** — orchestration wrapper above the planner.
   For each month, plans PS / SC / LS, evaluates each at bill-calc
   level, picks the winner. Returns a composite optimal schedule per
   month with `meta.strategy = 'AUTO_OPTIMIZE'` and
   `meta.optimalByMonth = ['PS', 'PS', 'LS', ...]` showing what won
   where.
3. **Conservative / Expected / Upside view in CFE_OUTPUT_v2 §2.** Per
   reviewer R1:
   - Conservative = PEAK_SHAVING result
   - Expected = customer's selected strategy (PS, SC, or LS)
   - Upside = AUTO_OPTIMIZE result
4. **kW-aware demand-charge display.** The customer report now shows:
   - Peak reduction (kW)
   - Avoided Capacidad (MXN)
   - Avoided Distribución (MXN)
   - Avoided Variable (MXN)
   - Total annual saving with each strategy
5. **Tier label in writer.** Customer report header shows
   "Estimate — Proposal tier" with a footnote explaining what that
   means and what it would take to upgrade to Bankable.

**Tests:**
- ~10 unit tests for the writer (different strategies, missing data,
  ZERO_EXPORT mode, etc.)
- 5 tests for AUTO_OPTIMIZE (picks best, decomposition correct,
  handles tied results, etc.)

**Tier:** outputs labeled `'PROPOSAL'`. First time customer sees these
numbers.

**Exit criterion:**
- CULLIGAN customer report identical to pre-Chunk-5 within ±1% per
  tier on PS strategy
- DRAXLMAIER and AUTOPLASTEK customer reports show measurable LS
  improvement (expected: 5-25% increase in BESS-attributable savings
  for LS on these projects)
- Synthetic PV-poor archetype shows the dramatic LS-vs-PS divergence
  (>10% in favor of LS)

---

## Session 4 — Verification + 15-min Validation + Ship v5.0.0

**Ships:**
1. **4-archetype verification.** Run the engine end-to-end on:
   - CULLIGAN (real workbook)
   - DRAXLMAIER (real workbook)
   - AUTOPLASTEK_BJX (real workbook)
   - Synthetic PV-poor (test fixture)
2. **15-min interval data validation on one project.** Upload real
   15-min EDIIS data or installed-data-logger CSV for one of the four
   above. Reconstruct the monthly bill from the interval data using
   the same dispatch logic. Compare planner output to reconstruction.
3. **Bias quantification.** Document per-tier bias for SCREENING and
   PROPOSAL tiers:
   - Capacidad savings bias %
   - Distribución savings bias %
   - Variable savings bias %
4. **Regression baseline update.** Extend `REG_CULLIGAN_BASELINE_V2`
   with the new section-2 numbers.
5. **CHANGELOG entry** naming which tiers moved and why.

**Tier policy:** still PROPOSAL for projects without interval data.
Projects WITH interval data uploaded get the BANKABLE tier eligibility.

**Exit criterion (the v5.0.0 ship gate):**
- Per-tier bias ≤ 10% on the validation project; if not, **do not
  ship.** Investigate and fix or re-tier the affected output.
- CULLIGAN baseline within tolerance
- DRAXLMAIER / AUTOPLASTEK LS savings improvement measurable and
  documented
- 4 archetype expected vs actual behavior table reviewed and signed off

---

## Chunk 6 — BaaS Economics Engine

Not Chunk 5, but flagged here because the reviewer correctly noted
this is more commercially valuable than additional dispatch
sophistication. Drafted after Chunk 5 ships v5.0.0.

**Inputs (data ready or with clear sources):**
- Battery CAPEX (catalog ✅)
- Wear cost per kWh (Session 2 produces this ✅)
- Customer savings per year (Session 3 produces this ✅)
- Discount rate, target IRR, lease term, replacement reserve (NEW —
  add to INPUT_BAAS sheet)

**Outputs:**
- Min lease payment for ARGIA's target IRR
- Max lease payment for customer breakeven
- Negotiable range
- Customer Year-1 savings AFTER lease payment
- 15-year cumulative customer benefit + ARGIA margin

**Why this matters:** the 4 proposal PDFs in the project (DRAXLMAIER,
AUTOPLASTEK, CULLIGAN, TAIGENE) are all lease/BaaS-framed, not CAPEX
sales. The BaaS Economics Engine is the actual customer-facing math.
AUTO_OPTIMIZE makes the engine "smart"; BaaS makes the engine
"commercial."

---

## What's NOT on the roadmap (logged for the record)

- **Multi-cycle dispatch.** Conservative 1-cycle/day stays for warranty
  reasons. Maybe a per-battery-model option in Chunk 7+ if a customer
  warranty allows it.
- **More dispatch strategies.** Three is enough until the priority
  framework has been used in production for a quarter.
- **Better synthetic profiles than bell curve.** Helioscope hourly PV
  wiring is its own chunk after Chunk 6.
- **More sophisticated math.** The reviewer's verdict in round 3 was
  "stop designing and start coding." Production will tell us where the
  next math improvements are needed; we shouldn't pre-speculate.

---

## Version policy

- **Session 1 push:** no version bump. Module ships dark.
- **Session 2 push:** engine version bumps to **v4.1.0** when wear
  cost integrated into picker (a feature-add, no customer numbers
  change yet because writer still reads formula sheet).
- **Session 3 push:** engine bumps to **v5.0.0-rc1**. Customer numbers
  change. Tier label = PROPOSAL.
- **Session 4 push:** engine ships **v5.0.0** if and only if bias gate
  passes.

---

## Status

Current session: **1 — code-complete, awaiting push.**
