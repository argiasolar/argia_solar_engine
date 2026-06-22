# ARGIA AGS CONFORMANCE PLAN

**Purpose:** bring the ARGIA Engine into conformance with the **ARGIA Golden
Standard (AGS) v1.5** — the internal engineering standard that is the oracle for
every Engine output (AGS-801/802). This plan is a dependency-ordered track of
self-contained chunks, in the same format as `ARGIA_CONSOLIDATED_PLAN.md`.

**Status:** A1 ✅ · A2 ✅ · A2b ✅ · A3a ✅ · A3b-advisory ✅ (no blocks; real blocks deferred) · A4–A6 pending.
**Engine baseline at plan start:** v4.59.0 · self-test 587 tests, 531 PASS,
0 FAIL, 0 unit ERROR, 56 workbook-dependent ERRORs (expected).

---

## STANDING CONTEXT (read first, every chunk)

- **Repo:** `github.com/argiasolar/argia_solar_engine` (public). Two independent
  deploy targets: `clasp push` (Apps Script) and `git push` (GitHub) — verify both.
- **Self-test rig:** `node scripts/full_selftest.js`. **Ship condition:** ALL
  GREEN = Unit FAILs 0, Unit ERRORs 0; ~56 workbook-dependent ERRORs are expected.
- **Primary regression anchor:** CULLIGAN (864 kWp PV, 2169 kWh BESS, GDMTH
  Monterrey). Structural changes must not silently break its goldens.
- **Delivery cadence (chunk-atomic):** Claude builds a complete chunk → Tomasz
  deploys + runs in-sheet → reports → Claude iterates. No mid-chunk pushes.
- **Delivery package:** full clean files only (never diffs) with exact
  repo-relative paths + one-command heredoc installer (delimiter
  `ARGIA_FILE_EOF_8f3a`) + tarball extractable over repo root + a README with a
  one-row-per-file table and apply commands at the top. Round-trip
  (byte-identical) + `node --check` before handover.
- **Tests-first** for new pure modules: unit tests in Node, integration/regression
  in Apps Script (`registerTest({...})`, group `unit|integration|regression`).
- **Source file convention:** numbered prefix, lower number = earlier load.
  `00_Main`/`00a_Version` pinned first; everything else lexical. AGS register is
  foundational → `00b_AgsRegister.js`.
- **Strategic principle (carried from the Master Plan):** build mechanisms with
  placeholder values now; load real calibration values later without code changes.
- **The AGS rule that ties it together:** every result states (a) what is
  required, (b) which standard makes it required, (c) how to verify it. No number
  is used unless it traces to AGS-B (a register ID) or a calibrated measurement.

---

## The two definition-of-done gates (mirror AGS-801 §8 + AGS-802 §8)

A chunk is DONE only when **both** gates are green for its scope:

- **Gate A — Architecture (AGS-801 §8):** new logic maps 1:1 to an AGS chapter
  and reads its values from `00b_AgsRegister.js` (no hidden constants); N-values
  never overridden; S-overrides carry a recorded justification; every new output
  is traceable to a register ID / chapter clause; the engine stays edition-stamped.
- **Gate B — Validation (AGS-802 §8):** every new output is mapped to an oracle
  (chapter §7 + register ID) and flagged 🟢/🟡/🔴; non-compliance is flagged then
  corrected or justified (never silently passed); §5.3 hard-blocks are honoured;
  self-test ALL GREEN.

---

## Finding → task map (from the AGS review of v4.59.0)

| AGS finding | Severity | Task |
|---|---|---|
| No single in-code source of AGS-B values; no N/S/P tags | Architecture | **A1** |
| DC/AC hard-block at >1.8 vs AGS-204 designer-decision | **BLOCK** | A2 ✅ |
| Degradation default 0.5%/yr vs PB-01 ≤0.4%/yr | REVIEW | A2 (kept visible, designer-owned) |
| Isc not temperature-corrected before 1.25/1.5625 (FR-205-03) | REVIEW | A2b |
| MDC cites NOM 690-8(A) for Voc-cold; correct clause is 690-7 | REVIEW | A2 ✅ |
| AGS-802 oracle map + full §5.3 hard-block list (~40% wired) | Architecture | A3 |
| AGS-207 bankability absent (P50/P75/P90/P99, σ, guarantee baseline) | **BLOCK gate** | A4 |
| Regulatory class (REG-01 0.7 MW exempt / SAE-GE) absent (AGS-102) | BLOCK gate | A5 |
| UL 9540A Ed.6 time-gated BESS hard-block absent | BLOCK gate | A5 |
| No edition-lock to a manual revision; card lacks compliance state | Architecture | A6 |

---

## A1 — AGS Parameter Register (mechanism) ✅ DONE

**Goal:** the single in-code home for every AGS-B value the engine needs, each
tagged with its register ID, N/S/P class, owner and source — plus a pure
conformance/drift report that turns the Category-A findings into an automated check.

**Scope guard:** ZERO behaviour change. Nothing reads the register yet (that is
A2), so the self-test stays byte-identical ALL GREEN.

**Delivered:**
- `00b_AgsRegister.js` — `AGS_REGISTER` (STC-03, REG-01, DC-01/02/04, PB-01..07,
  BS-06/07, DCAC-BAND), `agsGet`/`agsValue`/`agsAll` (agsGet throws on unknown ID
  = AGS-802 R1), `agsRegisterSelfCheck`, and pure `agsConformanceReport(observed)`.
- `tests_unit/ags/AgsRegisterTests.gs` — 6 unit tests.

**DoD met:** self-test 593 tests, 537 PASS (+6), 0 FAIL, 0 unit ERROR, 56 workbook
ERRORs unchanged — ALL GREEN. Conformance report reproduces the known DC/AC BLOCK
+ degradation REVIEW deltas and goes clean against AGS-aligned values.

---

## A2 — DC/AC de-block + AGS band + clause fix ✅ DONE

**Goal:** honour the "DC/AC is a designer decision, never a hard block" policy,
align the DC/AC flag to the AGS-204 band, and fix the Voc-cold clause citation —
all with zero customer-facing financial change.

**Delivered:**
- DC/AC no longer hard-blocks: `09_Validate.js` DC-10 `critical` → non-blocking
  `major`, reading the `1.35/1.40` band from the register and citing AGS-204 with
  the clipping-study note (flagged, not silently passed — AGS-802 R3).
  `04_CalcDC.js` `dcAcRatioStatus` aligned to the AGS band; `02_LoadDB.js` exposes
  `nom.dcAcAgsMin/ReviewLow/Max` from `00b_AgsRegister.js`.
- MDC clause fix: Voc-cold / max-modules-per-string now cite **NOM 690-7**
  (FR-205-01), not 690-8(A). (Design-current rows correctly stay 690-8.)
- Live wiring: `agsConformanceFromNom(nom, clientDefaults)` (pure) + 2 unit tests.
- `tests_integration/engine/ValidationRulesTests.gs` DC-10 expectation updated
  (critical → major) and proven to run in Node (reverting it FAILs).

**Deliberately NOT changed (designer-owned, kept visible):**
- Degradation stays 0.5%/yr — a customer-facing financial number we will not move
  silently. The conformance report keeps surfacing it as an explicit **PB-01
  REVIEW** so it stays the designer's call; flipping to the AGS cap (0.4%) is a
  one-line change once the team decides and captures the new CULLIGAN goldens.

**DoD met:** self-test 595 tests, 539 PASS (+2), 0 FAIL, 0 unit ERROR, 56 workbook
ERRORs unchanged — ALL GREEN. CULLIGAN (1.234) stays a clean DC/AC PASS.

## A2b — Isc temperature-correction (FR-205-03) ✅ DONE (in-sheet confirmed)

**Goal:** correct the design current to use Isc,corr, not STC Isc.

**Delivered:**
- `resolveTempCoeffs` now resolves an Isc coefficient: datasheet `PANEL_TEMP_ISC`
  > `inp.iscCoeffOverride` > documented default `AGS_ISC_TEMPCO_DEFAULT` (+0.05%/°C);
  it never inherits the (negative) Pmax proxy.
- `calcDC` temperature-corrects Isc to the design max temperature (`ambientDC`, the
  same basis as the conductor-ampacity derate Ft) before the 1.25/1.5625 factors:
  `Isc,corr = Isc·(1 + α(ambientDC−25))`. STC Isc kept as `dc.iscStc`; `dc.iscCorr`
  and `dc.iscCoeffMeta` exposed for the MDC.
- MDC I_DESIGN row shows the Isc,corr derivation and cites FR-205-03.
- Two **pure** unit tests (Node-verified): coefficient resolution + the Isc,corr
  formula, cross-checked against the TESTPROJ_001 goldens (proven to guard them —
  corrupting a golden FAILs the test).

**Blast radius (TESTPROJ_001, hand-verified):** Isc 14.27 → Isc,corr 14.520 (+1.75%
at ambientDC 60 °C). Design currents move (isc125 17.84→18.15, iDesign 22.30→22.69,
ampReq 31.40→31.95, vdropDC 0.01197→0.01218) but **conductor '8', OCPD 25 A, EGC '10'
and vdropPass are unchanged** — so no BOM/CAPEX/financial change is expected. Those
goldens are workbook-dependent and confirm on the in-sheet run.

**DoD:** pure DC tests green; self-test ALL GREEN (597 tests, 541 PASS, 0 FAIL,
0 unit ERROR). **In-sheet confirmed (CULLIGAN E2E, v4.59.0):** 221/222 passed;
the one expected delta was `MDC_v2.C22 design current 23.64 → 24.05` (+1.73% @
~60 °C ambient), re-anchored. Conductor (10 AWG), OCPD, vdrop, BOM, CAPEX and
financials all unchanged — blast radius exactly as predicted.

## A3 — AGS-802 oracle/flag layer + full hard-block list

**Goal:** extend the existing PROJECT_STATUS rules pack into the AGS-802 benchmark.
Split into three chunks by what the Engine can evaluate at proposal time.

### A3a — Oracle map + human-gate ledger ✅ DONE (Node-verified; additive, no emittability change)
- `37_AgsOracleMap.js` (new): the §5.2 output→chapter→oracle map (18 rows, accessors
  `agsOracleMap` / `agsOracleFor`) and the §5.3 hard-block list as data (12 items,
  `agsHardBlockList` / `agsHumanGates` / `agsEngineHardBlocks`) — the single source
  of truth A3b and A4 build on.
- `36_CalcStatusRules.js`: `_psRuleHumanGates` + `runHumanGatesRule` surface the five
  human/field §5.3 gates (DRO 206, UVIE 602, H-point 402, HSE 501, Cat-1 601) as a
  single PASS-level `HUMAN_GATES_NOT_EVALUATED` advisory — visible, never a silent
  PASS, never a false BLOCK (they block at their downstream stage, not the proposal).
- `33_CalcProjectStatus.js`: rule wired into `collectProjectStatusRules` (guarded).
- Tests: `AgsOracleMapTests.gs` (2) + human-gates test (1); proven to guard the
  never-block invariant. **Self-test 600 tests, 544 PASS, 0 FAIL, 0 unit ERROR.**
  Because nothing new blocks, CULLIGAN's emission-status golden is unaffected
  (PASS-level rules can't change the verdict) — no golden capture needed.

### A3b — Engine-evaluable hard-blocks
**Audit (2026-06, in `37_AgsOracleMap.js`):** none of the engine-evaluable §5.3
blocks has a clean, ready-to-block data source. AGS-203 (exclusions/fire) and
AGS-302/503 (UL 9540A edition) have no data; AGS-101 (Data Pack completeness),
AGS-303 (anti-islanding/grid-forming), AGS-401 (per-panel warranty %/yr) and
AGS-302 (BESS safety/fire) are partial. So per the "no hard blocks at this moment"
decision, **none are enforced.**

**A3b-advisory ✅ DONE (Node-verified; additive, no emittability change):** the six
engine-evaluable, not-yet-wired blocks (AGS-101, 203, 302, 303, 401, 302/503;
AGS-207 deferred to A4) are surfaced as a single PASS-level
`ENGINE_BLOCKS_NOT_EVALUATED` advisory, each annotated with `waitingOn` (the audit
note for what data it needs). Visible, never a silent pass, never a block.
`_psRuleEngineBlocks` + `runEngineBlocksRule`, wired guarded into the aggregator;
test proven to guard the never-block invariant. **Self-test 601 tests, 545 PASS,
0 FAIL, 0 unit ERROR.** CULLIGAN unaffected (PASS-level).

**A3b-real (deferred):** promote a block to a real hard-block only after its field
is wired — one at a time, each with in-sheet golden capture first (A2b discipline).

### A3c → folded into A4
AGS-207 σ>8% / P50-as-guarantee block depends on the bankability model — built with A4.

## A4 — AGS-207 bankability module (biggest net-new build)

**Goal:** the P50/P75/P90/P99 + uncertainty model AGS-207 requires.

> New pure module `2x_CalcBankability.js` implementing FR-207-01 (σ_total by RSS),
> FR-207-03 (Pxx via the PB-06 z-values), FR-207-04/05 (degradation-adjusted
> P90(1) and debt-term P90(N)), FR-207-06 (guarantee baseline ≤ 0.95·P90). σ_i
> inputs are placeholders now (mechanism-first); real σ loads later without code
> changes. Hard-block (🔴, AGS-802 R4) on σ_total > 8% labelled bankable, single
> year of weather data, or P50 used as the guarantee. Reproduce the AGS-207 §6
> worked example (P50 717 MWh → guarantee 629 MWh) to the unit. **DoD:** worked
> example reproduced; hard-blocks fire; tests green.

## A5 — Regulatory classification + UL 9540A Ed.6 gate

**Goal:** the AGS-102 size class and the live BESS edition hard-block.

> Add an AGS-102 classifier: compare installed AC/DC against `agsValue('REG-01')`
> (0.7 MW) → Generación Exenta (Class A) vs permitted (Class B), and surface the
> SAE-GE classification for BESS (AGS-301/303). Add the AGS-802 time-gated
> hard-block: any BESS PO'd after 2026-06 without an explicit UL 9540A **Ed. 6**
> test report is a 🔴 (cannot be justified). **DoD:** CULLIGAN flagged Class B
> (864 kWp > 0.7 MW); UL 9540A gate fires for a post-2026-06 BESS without Ed.6;
> tests green.

## A6 — Edition-lock + project-card compliance state

**Goal:** pin the engine to the AGS revision and surface the compliance verdict.

> Stamp `_META` with the AGS manual revision the engine is locked to (AGS-801 R8 /
> AGS-000 §0.5). Aggregate the AGS-802 compliance state (🟢/🟡/🔴 + readiness:
> proposal / financing / construction) onto PROJECT_CARD_v2. **DoD:** edition
> stamp present; card shows the compliance state + readiness; full self-test +
> round-trip green.

---

## Notes / honest caveats

- A1–A6 make the Engine *conformant and self-checking*; they do **not** confer
  bankability — that is an independent engineer's call on a project (AGS How-to).
- Human gates (DRO stamp, UVIE dictamen) are modelled as explicit unmet states,
  never auto-satisfied. The Engine is decision-support (AGS-801 R6).
- All canonical figures live in `00b_AgsRegister.js`. If AGS-B changes, change the
  register and its unit test together — that is the change-control gate (AGS-B §B.10).
