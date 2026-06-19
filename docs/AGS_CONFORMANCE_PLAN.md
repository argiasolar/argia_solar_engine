# ARGIA AGS CONFORMANCE PLAN

**Purpose:** bring the ARGIA Engine into conformance with the **ARGIA Golden
Standard (AGS) v1.5** — the internal engineering standard that is the oracle for
every Engine output (AGS-801/802). This plan is a dependency-ordered track of
self-contained chunks, in the same format as `ARGIA_CONSOLIDATED_PLAN.md`.

**Status:** A1 ✅ delivered & green · A2–A6 pending.
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
| DC/AC thresholds 1.5/1.8 vs AGS-204 ≤1.40 (FAIL >1.40) | **BLOCK** | A2 |
| Degradation default 0.5%/yr vs PB-01 ≤0.4%/yr | REVIEW | A2 |
| Isc not temperature-corrected before 1.25/1.5625 (FR-205-03) | REVIEW | A2 |
| MDC cites NOM 690-8(A) for Voc-cold; correct clause is 690-7 | REVIEW | A2 |
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

## A2 — Calibration to AGS-B + clause fixes (behaviour-changing)

**Goal:** rewire the operative engine constants to read from the register and
close the four Category-A deltas. **Self-contained prompt:**

> Read `00b_AgsRegister.js` and the live NOM_DB `61_NOM_LIMITS`. (1) Point the
> DC/AC ratio gate at `agsValue('DCAC-BAND')`: REVIEW in 1.35–1.40, FAIL >1.40
> (release-prohibited) unless an AGS-202 clipping-study justification is recorded;
> keep the engine's existing override mechanism but make AGS the ceiling. (2) Set
> the client-financials degradation default to `agsValue('PB-01')` (0.004) — flag
> any project override above it REVIEW. (3) Temperature-correct Isc (FR-205-03)
> before the 1.25/1.5625 factors in `04_CalcDC.js`. (4) Fix the MDC clause
> citation for Voc-cold / max-modules-per-string from 690-8(A) to 690-7
> (FR-205-01). Re-anchor the CULLIGAN goldens to the new (correct) numbers with
> the diff explained. Wire `agsConformanceReport` to the live `nom` + client
> defaults and assert it returns status PASS in a new regression. **DoD:** drift
> report clean for these four IDs; CULLIGAN goldens updated + green; self-test
> ALL GREEN.

## A3 — AGS-802 oracle/flag layer + full hard-block list

**Goal:** extend the existing PROJECT_STATUS rules pack into the AGS-802 benchmark.

> Extend `36_CalcStatusRules.js`/`33_CalcProjectStatus.js`: build the §5.2
> output→owning-chapter→register-ID oracle map, and add every §5.3 non-negotiable
> hard-block. Human gates (DRO 206, UVIE 602) are explicit `NOT_EVALUATED`
> advisories — never a silent PASS, never a false BLOCK. Each emittable output
> carries its oracle ID + flag in a trace. Reuse the existing worst-takes-all
> reducer and `isOfferEmittable` (BLOCKED already non-overridable). **DoD:** every
> emittable output maps to an oracle; the §5.3 list is present; no silent PASS;
> self-test ALL GREEN.

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
