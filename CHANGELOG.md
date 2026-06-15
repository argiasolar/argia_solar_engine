## [4.19.1] — 2026-06-14

**Reconciles the customer-facing CFE_OUTPUT_v2 explanatory text with the 4.18.0 un-gate. The live ZERO_EXPORT E2E surfaced that the engine was un-gated but the proposal TEXT still told customers "arbitrage requires NET_BILLING" — a direct contradiction. Fixed text + gating logic; no dispatch change.**

> THE FINDING (from the live ZERO_EXPORT E2E + a full data-flow trace):
> 4.18.0 correctly un-gated grid-charging in the planner + executor, and the
> hourly-sim attribution flows into the CFE_OUTPUT_v2 "RANGO DE AHORRO BESS"
> Esperado tile + demand breakdown. So on a ZERO_EXPORT site the proposal now
> SHOWS the arbitrage value. But three pieces of explanatory text still
> asserted the OLD rule:
>   - _cfeOutV2_rangeExplanation: "El arbitraje requiere interconexión
>     FACTURACIÓN NETA (NET_BILLING)" + lsAvailable = (mode === 'NET_BILLING').
>   - the hourly-idle banner: "el arbitraje de red está deshabilitado bajo el
>     modo de interconexión actual".
>   - two code comments asserting "arbitrage needs/gated off outside NET_BILLING".
> Net effect: a ZERO_EXPORT proposal could show the arbitrage VALUE while the
> TEXT told the customer that same arbitrage "no es alcanzable". Caught before
> reaching a customer, precisely because the live E2E forced the trace.
>
> THE FIX (explanatory layer only -- NO dispatch/engine behavior change):
> - _cfeOutV2_rangeExplanation rewritten: arbitrage is gated by ECONOMICS
>   (punta/base spread > wear), available under ANY interconnection mode incl.
>   SIN EXPORTACIÓN, because charging is import not export. The optimum assumes
>   active load-shifting operation; actual savings depend on how the battery is
>   operated (ties to the lease / normal-operation framing).
> - idle banner text now names the REAL cause of zero dispatch (no PV surplus
>   AND no profitable spread), not interconnection mode.
> - stale comments corrected.
>
> IMPORTANT: row 30 (Section 2 headline) STILL sources from the BESS_SIMULATION
> formula sheet (peak-shaving demand math) -- that source swap stays deferred
> to Session 4 pending 15-min validation, as designed. This chunk does NOT
> change the headline; it makes the EXPLANATION honest about what the hourly
> model (Esperado tile) now does.
>
> TESTS:
> - UNIT_CFE_WIDE_DIVERGENCE_EXPLAINED + UNIT_CFE_HOURLY_IDLE_LOUD_BANNER
>   updated to the new mode-invariant behavior (they encoded the old rule).
> - NEW UNIT_CFE_ARBITRAGE_EXPLANATION_MODE_INVARIANT: across 5 interconnection
>   modes, the explanation NEVER claims "requires FACTURACIÓN NETA" and always
>   states arbitrage works under any mode. Verified to FAIL if the stale claim
>   is re-injected -- permanent guard against the text drifting back.
> - ZeroExportArbitrageE2E verdict reader CORRECTED: it was reading row 30
>   (formula sheet, can't show arbitrage). Now it reads the dispatchable-value
>   signal (RANGO/demand blocks vs idle banner) -- the true option-#1 signal --
>   and reports row 30 only as labeled context.
>
> Tests 521 -> 522. ALL GREEN.
## [4.19.0] — 2026-06-14

**Live verification harness for option #1: a solar-poor ZERO_EXPORT LOAD_SHIFTING E2E fixture that makes battery grid-charging actually fire end-to-end (CULLIGAN can't — it's solar-rich). Plus offline regression protection so the un-gate can never silently revert.**

> 4.18.0 un-gated grid-charging and was verified offline (planner unit tests +
> the extracted executor decision test). But the executor's FULL integration
> path (doChargeGrid -> hourly bill math) only runs live in Apps Script, and
> CULLIGAN cannot exercise it: CULLIGAN is solar-rich, MEDICION_NETA,
> PEAK_SHAVING -- it never grid-charges. This chunk closes that gap.
>
> NEW: test/ZeroExportArbitrageE2E.gs
>   - buildZeroExportArbitrageInputs(): derives a fixture from CULLIGAN_BASELINE
>     via deep-clone + three surgical overrides:
>       1. interconnectionMode -> SIN_EXPORTACION (ZERO_EXPORT)
>       2. bessStrategy        -> LOAD_SHIFTING
>       3. solar-POOR PV: panel/string/helioscope scaled ~0.12x (162 mods =
>          9 strings x 18 = 103.7 kWp vs CULLIGAN 864 kWp; ~159 MWh/yr PV vs
>          ~4.48 GWh/yr load = ~3.5%), so PV can't fund the cycle and the
>          battery MUST grid-charge. Battery (2169 kWh / 972 kW) and real GDMTH
>          rates are inherited, so the arbitrage spread is authentic.
>     The scaling keeps panelQty == strings * modsPerString, so the live engine
>     does NOT trip INP/STR layout validations. The deep-clone does not mutate
>     CULLIGAN_BASELINE (asserted).
>   - runZeroExportArbitrageE2E(): menu runner mirroring runCulliganE2E
>     (snapshot -> load fixture -> silent engine -> read BESS dispatch verdict
>     -> restore your inputs). New menu item under the test section. Reports
>     whether the battery grid-charged live and the arbitrage value produced.
>
> NEW: tests_regression/ZeroExportArbitrageFixtureTests.gs (2 tests, offline)
>   - REG_ZE_ARBITRAGE_FIXTURE_INTEGRITY: the three overrides + layout
>     consistency + non-mutation of CULLIGAN.
>   - REG_ZE_ARBITRAGE_PLANNER_GRID_CHARGES: on the fixture's real GDMTH
>     economics + CULLIGAN battery, the planner grid-charges under ZERO_EXPORT,
>     LOAD_SHIFTING strictly out-discharges PEAK_SHAVING, discharge <= usable
>     (one realistic cycle, not an optimum), and the daily arbitrage value is
>     positive. Verified to FAIL if the 4.18.0 un-gate is reverted -- this is
>     the permanent guard against silent re-gating.
>
> Offline model (one representative day): grid-charge ~1928 kWh, discharge
> ~1735 kWh (one usable cycle), ~+0.3-0.4M MXN/yr energy arbitrage -- the
> realistic normal-operation number, not a demand-charge windfall. The live
> E2E confirms the executor reproduces this end-to-end.
>
> Tests 519 -> 521. ALL GREEN. No engine behavior change -- this chunk is
> verification + regression scaffolding only.
>
> TO RUN: deploy, then ARGIA menu > (test section) > Run ZERO_EXPORT Arbitrage
> E2E. Expect: "battery grid-charged under ZERO_EXPORT -- option #1 verified."
## [4.18.0] — 2026-06-14

**Option #1: battery grid-charging un-gated from NET_BILLING. ZERO_EXPORT sites (the majority of C&I projects, incl. CULLIGAN) now perform realistic single-cycle grid arbitrage instead of sitting idle. The gate is now PURELY economic.**

> ROOT FIX: the grid-charge arbitrage gate required interconnMode ===
> 'NET_BILLING', conflating "cannot EXPORT" (the interconnection rule) with
> "cannot IMPORT to store" (just consumption, legal under ZERO_EXPORT/SIN
> EXPORTACION every hour). Charging a battery from the grid is import, never
> export, so interconnection mode is irrelevant to whether arbitrage is
> allowed. The gate is now purely economic: a kWh bought in base and
> discharged in punta must clear wear and beat the base rate
> (ratePunta*rte > rateBase + wear).
>
> SCOPE -- all THREE gate sites changed together (no silent split):
> 1. 20b_PlanMonthlyBessSchedule.js _planLoadShifting: dropped the
>    interconnMode clause from the P4_ARBITRAGE gate.
> 2. 20_CalcHourlySimulation.js _bessGridChargeDecision (the pure fn extracted
>    in 4.17.0): dropped the interconnMode !== 'NET_BILLING' early return.
> 3. 00_Main.js: removed the obsolete MAJOR warning that told users
>    LOAD_SHIFTING "needs NET_BILLING or the battery won't grid-charge" -- it
>    fired on exactly the ZERO_EXPORT sites that now work. Replaced with an
>    INFO note.
>
> PRESERVED (correctly interconnection-specific -- these are about EXPORT, not
> import): the export-credit math in 20 (lines ~1098/1138) still pays
> NET_METERING at retail, NET_BILLING at export price, ZERO_EXPORT nothing.
> Export economics depend on interconnection mode; import-for-storage does not.
>
> MODEL IS REALISTIC, NOT OPTIMISTIC ("real-life case scenario"): the planner
> already targets ONE daily cycle (not perfect-foresight max), caps grid-charge
> at the base-hour headroom under the P1 demand limit (so it can NEVER
> manufacture a new billed peak), and allocates punta discharge proportionally
> to actual residual load. The un-gate simply lets ZERO_EXPORT sites use this
> same realistic dispatch. The "ahorros no garantizados / requires 15-min
> interval data" banner remains as the honest caveat -- actual savings depend
> on how the customer operates the battery; the lease de-risks the rest.
>
> VERIFIED on the synthetic archetypes (from 4.17.0):
>   A ZERO_EXPORT solar-poor low-base: 0/0 -> 360/324 (== NET_BILLING control D;
>     identical except interconnMode -- the CULLIGAN $0 pathology resolved).
>   B ZERO_EXPORT solar-rich (CULLIGAN): unchanged (PV already funds the cycle).
>   C ZERO_EXPORT solar-poor HIGH base: 0 -> 30 (capped by demand headroom --
>     proves the P1 ceiling survives the un-gate; battery can't make a new peak).
>   D NET_BILLING control: unchanged (no regression).
> LOAD_SHIFTING now genuinely differs from PEAK_SHAVING on ZERO_EXPORT sites
> (the original B-4 problem -- $0/$0/$0 tiles -- is resolved at the source, not
> just banner-flagged).
>
> The [OPTION_1_FLIPS]-tagged archetype assertions were flipped to the un-gated
> values; the test diff IS the behavior change. Three pre-existing tests that
> encoded the old "NET_METERING blocks arbitrage" assumption were updated to
> the new economic-only gate. Tests 519, ALL GREEN (count unchanged).
>
> NOTE: CULLIGAN itself is solar-RICH (archetype B), so its CFE_OUTPUT BESS
> number may move only modestly; the big beneficiaries are solar-poor
> ZERO_EXPORT sites. Verify the CULLIGAN E2E after deploy to confirm no
> regression to the locked baseline.
## [4.17.0] — 2026-06-13

**Test foundation for option #1 (un-gate grid-charging from NET_BILLING). Pure-function extraction of the executor gate + synthetic ZERO_EXPORT dispatch fixtures. NO behavior change — this chunk is scaffolding so the un-gate can be proven, not hoped.**

> Investigation (no code yet) established: the NET_BILLING clause on
> grid-charging conflates "can't EXPORT" (the interconnection rule) with
> "can't IMPORT for storage" (just consumption -- always legal under
> ZERO_EXPORT). The mechanism paper never gives the clause a regulatory basis
> and flags it as "reviewable". The ECONOMIC gate (ratePunta*rte > rateBase,
> spread*rte > wear) is correct and interconnection-independent and is kept.
> The gate lives in THREE places (silent split): planner 20b:379, executor
> 20:doChargeGrid, and the 00_Main warning -- all must change together.
>
> Two coverage gaps blocked testing the un-gate:
> 1. ZERO_EXPORT had ZERO synthetic dispatch coverage (every planner test used
>    NET_BILLING/NET_METERING). CULLIGAN is solar-RICH, so it can't exercise
>    grid-charging even after an un-gate (PV already fills the battery).
> 2. The executor gate (doChargeGrid) was reachable only via the workbook-
>    dependent hourly sim -- no offline coverage.
>
> THIS CHUNK (pure scaffolding, behavior identical):
> - Extracted the executor gate into _bessGridChargeDecision (pure function:
>   reads state, returns {allow, chargeKwh}, no mutation). doChargeGrid now
>   calls it. Verified the extraction reproduces the prior decision across 5
>   cases EXACTLY. This is the single place option #1 will edit in the executor.
> - Added BessZeroExportArchetypeTests: 4 synthetic archetypes from the
>   mechanism paper --
>     A ZERO_EXPORT solar-poor low-base  (today: gridCharge=0, discharge=0 --
>       the CULLIGAN $0 pathology; option #1 should make it 360/324)
>     B ZERO_EXPORT solar-rich (CULLIGAN-like; PV fills battery, ~unchanged)
>     C ZERO_EXPORT solar-poor HIGH base (P1 ceiling bites; proves the un-gate
>       can't manufacture a new peak)
>     D NET_BILLING solar-poor low-base CONTROL (gate fires today: 360/324 --
>       the reference A must converge to; A and D differ ONLY by interconnMode)
> - Added BessGridChargeDecisionTests for the pure executor gate.
> - Assertions option #1 will intentionally flip are tagged [OPTION_1_FLIPS];
>   when the un-gate lands, exactly those change and nothing else -- the test
>   diff IS the behavior change.
>
> Tests 514 -> 519. ALL GREEN. No engine behavior changed this chunk.
## [4.16.2] — 2026-06-13

**The CULLIGAN baseline "wrong workbook" guard now reports as INFO/skip, not FAIL. It was a false alarm on every test run against a real customer workbook.**

> REG_CULLIGAN_BASELINE_V2 asserts CULLIGAN's exact engineering numbers, so it
> first checks MDC_v2.C7 == "CULLIGAN" and short-circuits if not. That guard
> used t.fail(), so any test run against a workbook holding a different project
> (e.g. a live PROLOGIS deal) produced a red FAIL -- which repeatedly read as
> "something broke" when nothing had. A workbook holding another project is a
> "can't run this test here" condition (a SKIP), not an engine defect.
>
> FIX: the guard now uses t.info() (status INFO, does not count as a failure),
> mirroring the existing "no spreadsheet context" skip in the same test. The
> message explains it is the intended guard and points to Run CULLIGAN E2E
> (which loads CULLIGAN, generates, asserts, and restores inputs) as the way
> to actually exercise the baseline. Inside the E2E the workbook holds
> CULLIGAN, so this branch is not taken and all real assertions run -- no loss
> of coverage.
>
> No code/engine change; test-reporting semantics only. 514 tests, ALL GREEN.
## [4.16.1] — 2026-06-13

**Fix: the 20 CFE bill-grid range keys failed to restore in 4.16.0 ("175 restored, 20 CFE range keys FAILED"). writeInput now derives range dimensions from rangeA1.**

> 4.16.0's field-keyed restore worked (175 fields, SOLAR layout finally fixed
> and STABLE) but surfaced a latent pre-existing bug: the 20 CFE range keys
> (cfeKwhBase ... cfeSuministroMxn, C10:N10 ... C29:N29) declared rangeA1 but
> never rangeRows/rangeCols. writeInput's size check compared value dimensions
> against undefined and always threw. It never mattered before because nothing
> wrote these keys back -- the field-keyed restore is the first code path to do
> so. (The 3 INPUT_DESIGN range keys DO declare dims, so they restored fine.)
>
> FIX: writeInput derives expected dimensions from rangeA1 via _rangeA1Dims_
> when rangeRows/rangeCols are absent, falling back to the explicit values when
> present. Handles all 23 range keys uniformly. readInput was always fine.
>
> Test 513 -> 514: UNIT_WRITEINPUT_RANGE_DERIVES_DIMS locks the read->write
> round-trip for a dimensionless CFE range key. Verified to FAIL (writeInput
> throws) when the derivation is reverted, PASS with it.
>
> Net effect with 4.16.0: "Repair Input Layout" now restores ALL input values
> (scalar + every range grid) with zero failures, on a clean rebuilt layout.
## [4.16.0] — 2026-06-13

**PERMANENT FIX: "Repair Input Layout" no longer undoes its own work. Root cause of the entire 4.15.x layout saga found and eliminated — the repair was restoring the OLD layout on top of the clean rebuild.**

> THE REAL ROOT CAUSE (proven by modeling the full cycle, byte-for-byte against
> the live diagnostic): repairInputLayouts did
>     snapshotInputSheets (whole grid, by cell address)
>     -> rebuildInputsToDefault (clears + writes the clean, correct layout)
>     -> restoreInputSheets (writes the WHOLE snapshot grid back, by address)
> The whole-grid restore rewrote every captured cell -- labels AND values, at
> their OLD addresses -- ON TOP of the clean rebuild. So a rebuild that MOVED a
> field to a new row was immediately overwritten: stale labels and DUPLICATE
> rows reappeared, the moved field's new row got clobbered. This is why EVERY
> 4.15.x layout fix looked correct in the rebuild but had zero effect on the
> live sheet -- the repair resurrected the broken layout each time. The unit
> suite never caught it because no test exercised the FULL snapshot->rebuild->
> restore cycle; tests only checked the rebuild in isolation.
>
> THE FIX -- values are owned by their FIELD, not their cell address:
> - snapshotInputSheets now also captures a __fieldValues layer
>   (_snapshotFieldValues_): every INPUT_MAP key's value via readInput, keyed
>   by logical field name, position-independent. The whole CFE bill grid and
>   the helioscope/secondary tables are covered too (they are range-mode map
>   keys), so there are no un-mapped free cells.
> - New restoreInputValues(): writes each saved value via writeInput, which
>   targets wherever the CURRENT map places the field. Values FOLLOW fields to
>   new rows. It writes ONLY value cells -- never labels/headers -- so the
>   rebuild's layout is preserved. Blank snapshot values are NOT written over
>   fresh defaults.
> - repairInputLayouts now uses restoreInputValues (field-keyed), NOT
>   restoreInputSheets (whole-grid). The repair finally does what its name
>   says: fix the layout, keep the values.
> - restoreInputSheets (whole-grid) is RETAINED for the CULLIGAN E2E, where an
>   EXACT round-trip of the user's original workbook is the correct behavior.
>   The two restores are now distinct tools for distinct needs -- the
>   conflation of them was the architectural flaw.
> - Both snap-iterating loops (restoreInputSheets, argiaBuildBackupRows) skip
>   the __fieldValues meta key.
>
> Tests 511 -> 513: RepairCycleTests models the FULL cycle and asserts (1) a
> moved field keeps its value at the NEW row, (2) no stale label survives at a
> vacated row, (3) blank values don't clobber defaults. EMPIRICALLY VERIFIED:
> under the old whole-grid restore these assertions FAIL (stray "8" survives);
> under the field-keyed restore they pass. This is the test that was missing
> for the whole saga.
>
> ACTION: push + clasp, then run "Repair Input Layout" ONCE. The SOLAR section
> will finally render correctly (row 64 "Instalar batería", row 66 styled "08
> SOLAR", fields 68-72, no duplicates) AND stay that way, because the repair no
> longer fights the rebuild.

## [4.15.5] — 2026-06-13

**Fix: "Repair Input Layout" produced duplicate / stale SOLAR rows. Section 08 was being written TWICE by the rebuild — once by the generic renderer (4.15.4), once by the leftover dedicated step. Removed the double-write; made the rebuild step list introspectable and test-guarded.**

> Symptom (live, after Repair Input Layout): INPUT_PROJECT section 08 SOLAR
> showed a greyed/valueless "Instalar PV nuevo" plus DUPLICATE rows ("PV
> existente (kWh/año)" and "...exportación" appearing twice).
>
> Root cause: 4.15.4 correctly moved section 08 back into the generic
> setupInputProject(true) renderer (step 0 of rebuildInputsToDefault) with full
> styling -- BUT setupInputProjectPvSection, the OLD dedicated owner, was still
> a separate rebuild step (step 8). A full rebuild therefore wrote section 08
> twice. My 4.15.4 fix was half-complete: I moved the rows and restored styling
> but did not remove the now-redundant dedicated step.
>
> Why the unit suite missed it: the rebuild step list was a LOCAL array, not
> introspectable, so no test could assert against it.
>
> THIS RELEASE:
> - Removed setupInputProjectPvSection from the rebuild sequence. The generic
>   setupInputProject(true) is the single owner/renderer of section 08 SOLAR.
>   The dedicated function is retained ONLY as a standalone menu item.
> - Extracted the step list into rebuildInputSteps_(ss) -- named entries with
>   stable ids -- so it is introspectable and testable. Failure logging now
>   reports the step id instead of "anon".
> - New test UNIT_REBUILD_NO_DOUBLE_OWNED_SECTION (511): asserts the dedicated
>   section-08 setup is NOT in the rebuild sequence while section 08 is
>   rendered generically, that setupInputProject IS, and that no step id is
>   duplicated. Verified to FAIL when the double-write step is re-added.
>
> ACTION: after pushing, run "Repair Input Layout (keeps values)" again -- the
> SOLAR section should now render ONCE, fully styled like sections 01-07, with
> no duplicate rows.

## [4.15.4] — 2026-06-13

**Two fixes from the live "Run ALL Tests": (1) the last two CALC FAILs were a missing-tolerance bug, not a value mismatch; (2) INPUT_PROJECT section 08 SOLAR rendered UNSTYLED (rows 65-70) — fixed properly by row spacing so the generic renderer styles it like every other section.**

> 1. CALC tolerance (dcLength / acLenInv). After the 4.15.3 re-lock, these two
>    still "failed": expected 103.9305 vs got 103.9304969, and 93.1444 vs
>    93.14439748 — EQUAL to 4 decimals. Root cause: both were asserted with
>    EXACT equality (no tolerance arg) while every other decimal field in the
>    suite uses tol['default'] (0.01). Added tol['default'] to both. The values
>    were already correct (verified in 4.15.3); this only fixes the comparison.
>
> 2. SOLAR section styling. 4.15.2 stopped the row-64 merge collision by
>    marking section 08 SOLAR renderedBy:'dedicated' so the generic
>    _setupOneTab skipped it — but the dedicated setup
>    (setupInputProjectPvSection) only wrote BARE cells (no merged header band,
>    no merged labels, no input-cell styling), so rows 65-70 rendered unstyled
>    (visible in the live screenshot: bare "8.0/SOLAR" + plain label rows).
>    PROPER FIX: the real root cause was ROW SPACING — section 08's fields
>    started at row 66, only 2 rows after section 07's installBattery field at
>    64, so the generic header (minRow-2=64) landed on section 07's field.
>    Section 08 SOLAR is now shifted DOWN 2 rows (fields 68-72, header 66,
>    blank 67), which clears section 07 entirely. The renderedBy:'dedicated'
>    flag is REMOVED and 08 SOLAR is rendered by the generic _setupOneTab
>    again — so it now gets the SAME header band / merged labels / input-cell
>    styling as sections 01-07. 02c_InputMap.js (installPv D68 ...
>    existingExportKwh D72) and 01d_SetupInputProjectPv.js
>    INPUT_PROJECT_PV_ROWS move in LOCKSTEP; readers use logical keys so they
>    follow the map automatically.
>
> Tests (510, count unchanged):
> - UNIT_DEDICATED_SECTION_EXCLUDED_FROM_GENERIC_RENDER (obsolete) replaced by
>   UNIT_SOLAR_SECTION_RENDERED_AND_SPACED: asserts 08 SOLAR is rendered
>   generically, header at row 66, fields at 68/72, no dedicated flag.
> - UNIT_NO_SECTION_HEADER_OVERLAPS_FIELD_ROW still guards the collision class.
> - Collision-guard + map-lockstep tests updated to the new rows
>   (INT_SSG_SOLAR_SETUP_ABORTS_ON_COLLISION seeds B68; PV_SETUP_ROWS_MATCH).
> - Verified: reverting installPv to row 66 fires THREE tests
>   (overlap + spacing + map-lockstep). ALL GREEN at the shipped rows.

## [4.15.3] — 2026-06-13

**TESTPROJ_001 calc fixture re-locked to verified-correct values. NO engine change — the expected values were stale/mis-computed; every delta was independently verified before re-locking.**

> The live CALC_AC / CALC_DC failures were investigated to root cause (not
> rubber-stamped). Three independent, legitimate reasons — each verified by
> hand against the live engine dump before the fixture was touched:
>
> 1. GEOMETRY-AWARE RUN LENGTH (dc.dcLength 70 -> 103.93, ac.acLenInv 65 ->
>    93.14). estimateDcRunM / estimateAcRunM add an in-array cabling term
>    (((arrayLen+arrayWid)/4)*walkway for DC; (arrayLen/2)*walkway/stations
>    for AC). Reproduced by hand to the rounding digit. The old flat
>    base+corridor values predate this model. CASCADE (all verified correct):
>    - dc.conductorDC 10 -> 8 AWG: at 103.93 m a 10 AWG run breaches the 1.5%
>      vdrop limit (0.0190 > 0.015); engine correctly upsizes to 8 AWG
>      (vdrop 0.01197, passes). dc.areaConDC 5.26 -> 8.37; dc.conduitDC
>      0.75" -> 1"; dc.vdropDC 0.01282 -> 0.01197.
>    - ac.conductorPerInv 1 -> 1/0 AWG for the longer branch;
>      ac.vdropACPerInv 0.01145 -> 0.01300.
>
> 2. AC CONTINUOUS-FACTOR RULE (ac.ampReqPerInv 132.18 -> 150.35).
>    requiredAmpacity returns max(1.25*iNom, iNom/derate). The 125% continuous
>    term (150.35) now binds; the old 132.18 was only the iNom/derate term and
>    predates the max() logic. NEC/NOM-correct.
>
> 3. Voc COLD MIS-COMPUTATION CORRECTED (dc.vocColdPerMod 56.31 -> 55.8995,
>    dc.vocColdString 1013.57 -> 1006.19). The OLD expected was computed in the
>    fixture comment with tempCoeff -0.0029, but tdBuildTestInputs supplies
>    tempCoeffOverride = -0.0026. The engine has ALWAYS used -0.0026; the old
>    expected was simply wrong. 52.36 * (1 + (-0.0026)*(-26)) = 55.8995.
>    Voc_stc 52.36 unchanged (no DB change).
>
> ac.mainBreaker 800 -> 700: nextBreaker(iTotalAC*1.25 = 601.4) = 700, the
> next standard rating above 601; the old 800 was locked against a different
> table/factor.
>
> Every re-locked value was cross-checked against the live engine dump and
> matches within the fixture's own tolerance. These tests are workbook-
> dependent (read NOM/elec tables), so they verify on the live "Run ALL
> Tests", not the Node rig.
>
> NOTE: REG_CULLIGAN_BASELINE_V2 also "fails" when the workbook holds a
> non-CULLIGAN project (PROLOGIS) -- that is the intended short-circuit guard,
> not a defect. Re-run "Generate MDC and BOM" against CULLIGAN inputs first.

## [4.15.2] — 2026-06-13

**The real root cause of the repeated "step 0 merge error" — found from the live merge geometry, not guessed. Section 08 SOLAR was double-owned; the generic renderer's header merge collided with section 07's field-label merge on shared row 64.**

> Honest note: 4.15.0 and 4.15.1 reduced the symptom (rebuildFailures 11 -> 2,
> tabs render correctly) but did NOT close it. The breakthrough was reading the
> ACTUAL live merge list off INPUT_PROJECT instead of theorizing:
>   INPUT_PROJECT: 47 merges ... C17:E17, C23:E23, C32:E32 (section headers,
>   cols 3-5) and B8:C8 ... B41:C41 (field labels, cols 2-3).
> Mapping that against INPUT_MAP:
>   - _setupOneTab renders each section header as a C:E merge at (minRow-2).
>   - Section 08 SOLAR's fields start at row 66 -> generic header computed to
>     row 64 (C64:E64).
>   - Section 07 ALMACENAMIENTO's only field, installBattery, is at row 64 ->
>     label merge B64:C64.
>   - B64:C64 (cols 2-3) and C64:E64 (cols 3-5) share col 3 and neither
>     contains the other, so breakApart() on the label PARTIALLY OVERLAPS the
>     header and throws "You must select all cells in a merged range...",
>     aborting the rebuild at that point (which is why the live merges stopped
>     at row 41 / the early sections).
> '08 SOLAR' is in fact laid out by a DEDICATED idempotent setup
> (setupInputProjectPvSection, 01d) — header in col B at row 65, no merge — so
> the generic renderer should never have rendered it at all.
>
> FIX (map-driven, per the standing preference — no keyword heuristics):
> - The five '08 SOLAR' keys are tagged renderedBy:'dedicated'.
> - inputSectionsForTab now SKIPS any section whose every key is
>   renderedBy:'dedicated', so _setupOneTab no longer renders 08 SOLAR and the
>   row-64 collision cannot occur. Section 07 (no dedicated owner) is
>   unaffected and still rendered generically.
> - Defense in depth: the in-place wipe in both _setupOneTab and
>   _setupDesignTab now unmerges PER EXISTING MERGE via getMergedRanges()
>   (_unmergeAllInPlace_) instead of one big-range breakApart, so a stale
>   merge from an older layout can never survive or throw.
>
> SEPARATE FIX, same chunk (rebuild robustness): step 10
> setupInputCFE -> _styleInputCFETab threw "INPUT_CFE_RAW tab not found" and
> inflated rebuildFailures. INPUT_CFE_RAW is an OPTIONAL manual-paste tab; a
> missing tab is not a failure. It now logs INFO and returns.
>
> Tests 508 -> 510:
> - UNIT_NO_SECTION_HEADER_OVERLAPS_FIELD_ROW reconstructs what _setupOneTab
>   actually merges per tab (via the real inputSectionsForTab /
>   inputKeysForSection) and asserts no header row equals a field row.
>   Verified to FAIL (naming the exact row-64 installBattery/SOLAR collision)
>   when the dedicated flag is removed, PASS with the fix.
> - UNIT_DEDICATED_SECTION_EXCLUDED_FROM_GENERIC_RENDER locks the flag on all
>   five SOLAR keys and the skip behavior.

## [4.15.1] — 2026-06-13

**INPUT_DESIGN rebuild fixed at the root — the last input setup still using deleteSheet now wipes in place. (Caught by 4.15.0's loud logging working exactly as designed.)**

> 4.15.0 made rebuild failures loud, and on the very next live run the LOGS
> named the culprit precisely:
>   InputRebuild ERROR  rebuildInputsToDefault step 0 (anon) failed:
>     "You must select all cells in a merged range to merge or unmerge them."
>   LayoutRepair WARNING repairInputLayouts: rebuildFailures=11, logos=6
> step 0 == setupInputDesign(true). _setupDesignTab was the ONLY input setup
> never migrated off the deleteSheet()+insertSheet() pattern — the exact
> pattern the 4.14.3 CHANGELOG forbade because deleting a sheet permanently
> #REF!s every cross-sheet formula referencing it. The custom two-column /
> dashboard layout leaves merged ranges, and re-merging on the
> stale/deleted-then-recreated sheet raised the merge error. Every OTHER tab
> rebuilt + re-logoed fine (5/6 in the screenshots); INPUT_DESIGN was the
> lone holdout.
>
> THIS RELEASE:
> - _setupDesignTab now wipes IN PLACE (unfreeze -> breakApart -> clear
>   rules/validations/notes -> clear contents+formats -> reuse the same
>   sheet), identical to the shared _setupOneTab path. No deleteSheet. This
>   fixes BOTH the merge error AND the latent #REF! cascade that delete would
>   have caused on every successful run.
> - Test 507 -> 508: UNIT_INPUT_DESIGN_WIPES_IN_PLACE_NEVER_DELETES drives the
>   real _setupDesignTab against a recording mock and asserts deleteSheet is
>   never called, insertSheet is skipped when the tab exists, and the in-place
>   clean sequence runs. Verified to FAIL against the old deleteSheet code and
>   PASS against the fix.
>
> ACTION: after pushing, run "Repair Input Layout (keeps values)" once more —
> all six tabs (INPUT_DESIGN included) should now report OK, and the CULLIGAN
> E2E's closing dialog should show the green layout-invariant line.

## [4.15.0] — 2026-06-12

**Test hygiene: tests now PROVE they leave the workbook exactly as found — layout invariant enforced, logos deterministic, one repair button, admin panel slimmed.**

> The contract was always "input tabs fully mapped, always restorable" — but
> the snapshot/restore layer only guaranteed VALUES, and presentation was
> assumed. Two real consequences: (1) the 4.14.3 Start New Project storm left
> INPUT_DESIGN value-perfect but format-stripped (25 merges -> 0, all
> bold/backgrounds gone) because a rebuild step that throws after its
> in-place clear() was Logger-only silent; (2) logos vanished and every E2E
> restore threw "Service error: Spreadsheets" on the bulk write and fell back
> to the slow per-cell path, because the IN-MEMORY snapshot still carried the
> CellImage logo object (4.14.3 filtered only the persisted backup).
>
> THIS RELEASE:
> - snapshotInputSheets now sanitizes rich objects (_snapshotSanitizeValues_):
>   bulk restore can never throw on a CellImage again; the chronic per-E2E
>   fallback in LOGS ends.
> - restoreInputSheets ends by RE-ASSERTING logos on every restored tab
>   (argiaReassertInputLogos): logos are template chrome, re-derived, never
>   round-tripped. Logo present before tests => logo present after.
> - LAYOUT INVARIANT, PROVEN: argiaInputLayoutFingerprint (merges, frozen
>   panes, title styling per tab, 4 reads/tab) + pure
>   argiaDiffLayoutFingerprints. The CULLIGAN E2E fingerprints BEFORE its
>   snapshot, verifies AFTER its restore, AUTO-REPAIRS on drift, re-verifies,
>   and reports the result in its closing dialog — green check when
>   identical, named drift + repair status when not.
> - ONE repair: repairInputLayouts / "Repair Input Layout (keeps values)" —
>   persisted value backup -> styled DEFAULT rebuild -> value restore ->
>   logos -> fingerprint report. Aborts before any destructive step if the
>   backup fails. This is the fix for the live INPUT_DESIGN format wipe.
> - rebuildInputsToDefault step failures are no longer silent: collected,
>   engineLog'd, returned; Start New Project surfaces them in its summary.
> - Administrator Panel slimmed to: Test submenu, Repair Input Layout,
>   Start New Project, Load CULLIGAN Fixture, Restore Inputs from Backup,
>   Update CFE Output. Removed from UI (functions retained for editor use):
>   the six dev-time Setup entries (covered by the map-driven rebuild), the
>   three one-time migration repairs (CFE_SIM Totals / Capacidad, resilience
>   collision), both Refresh entries (re-asserted automatically), Delete
>   Legacy Tabs (migration complete), Audit Config.
> - Tests 504 -> 507: UNIT_SNAPSHOT_SANITIZES_RICH_OBJECTS,
>   UNIT_LAYOUT_FINGERPRINT_DIFF_PURE, UNIT_RESTORE_REASSERTS_LOGOS.

## [4.14.4] — 2026-06-12

**B-4: hourly-model idle state made LOUD — no more silent $0/$0/$0 screening tiles next to Section 2's real BESS savings.**

> Root cause (reproduced in Node with the live CULLIGAN bill data): the
> monthly planner's PEAK_SHAVING and SELF_CONSUMPTION_MAX charge ONLY from
> typical-day PV surplus (20b _planPeakShaving), and LOAD_SHIFTING's
> P4_ARBITRAGE is gated to NET_BILLING (20b:379). A partial-offset
> ZERO_EXPORT site — CULLIGAN, and most C&I deals — has no typical-day
> surplus, so EVERY strategy plans zero discharge: the level-2 dispatcher
> idles the battery all year, attribution pvBess == pvOnly to the peso,
> auto-optimize cons/ups = 0, and CFE_OUTPUT_v2 rendered Conservador /
> Esperado / Óptimo as $0/$0/$0 plus a 0-kW demand breakdown — directly
> below Section 2's monthly-model $800k/yr BESS savings. Silent
> model-vs-model contradiction shown to the client; the golden master never
> caught it because no assertion covers the tile block.
>
> THIS RELEASE (display layer only — no dispatch/model change):
> - _cfeOutV2_renderConsExpUpside: when cons/exp/ups are all <= 0, render
>   ONE loud orange banner explaining WHY the hourly screening found no
>   dispatchable value (no typical-day PV surplus; arbitrage gated off for
>   the project's interconnection mode, named in the banner) and pointing
>   the reader at the MONTHLY model in Section 2. Tiles are not rendered.
> - _cfeOutV2_renderDemandChargeBreakdown: same idle condition renders an
>   explicit omission note instead of a 0 kW / $0 / $0 / $0 table.
> - Tests: UNIT_CFE_HOURLY_IDLE_LOUD_BANNER and
>   UNIT_CFE_DEMAND_BREAKDOWN_IDLE_OMITTED (502 -> 504), each with a
>   non-zero control case locking that healthy ranges still render tiles
>   and the table. B-1's clamp tests unaffected.
>
> DELIBERATELY NOT in this release (separate modeling decision, own chunk):
> un-gating battery grid-charging from NET_BILLING. Grid-charging a battery
> does not violate a zero-export interconnection (the limit is on PV
> export), and the monthly model already credits demand savings the hourly
> planner cannot reach under the current gate. Changing dispatch economics
> must land as its own verified push with recalibrated expectations.

## [4.14.3] — 2026-06-11

**Root cause closed + two design bugs owned: CellImage logos poisoned the backup write; force tab rebuild #REF!'d the workbook; per-cell fallback caused the API storm.**

> The 4.14.2 bisect-style diagnostics worked: LOGS isolated five unwritable
> cells, all [TAB r2 c2 V] — B2 of each input tab. B2 holds the ARGIA logo
> as an IN-CELL image; getValues() returns a CellImage object and ONE such
> object makes the whole bulk setValues throw "Service error: Spreadsheets".
> This was the true cause of ALL persist failures since 4.14.0 (the offline
> replay missed it because xlsx export drops in-cell images). Two further
> findings from the same run, both mine to own:
> (1) startNewProjectCore step 2 (force rebuild) DELETED+recreated the input
> tabs — deleting a sheet permanently #REF!s every cross-sheet formula that
> references it. FINANCE, _AUDIT_INPUTS, 41M_FINANCE_CALCULATOR and
> BESS_SIMULATION were contaminated, cascading $0 BESS values into
> CFE_OUTPUT_v2 (the 89/105 CULLIGAN run). This would occur on EVERY
> successful Start New Project — latent Batch 1 design bug, storm or not.
> (2) 4.14.2's per-cell fallback issued ~5000 sequential setValue calls
> (1000 per failing 200-row chunk), very likely triggering the document-wide
> service timeouts that aborted 26 integration tests mid-run.

- 00d: argiaIsBackupSafeValue() — backup rows carry only
  string/number/boolean/Date; CellImage and other rich objects are skipped
  (logos are not restorable input data; setup reinserts them). PURE,
  unit-locked (UNIT_BACKUP_ROWS_FILTER_NON_PRIMITIVE).
- 00d: fallback now bisects failing chunks (_argiaBisectWrite) — a poisoned
  row is isolated in ~8 extra calls and logged with its TYPE; the per-cell
  storm path is gone.
- 02e_InputSetup: _setupOneTab force path rebuilds IN PLACE (unfreeze →
  unmerge → drop rules/validations/notes → clear) — the sheet object
  survives, so cross-sheet references never break again. Applies to every
  force setup caller, not just Start New Project.

**WORKBOOK RECOVERY REQUIRED (code cannot heal existing #REF!s):** restore
the spreadsheet via File → Version history to a state between the 15:35
CULLIGAN run (105/105) and 15:47 — script code is unaffected by sheet
version restore. Then push this hotfix and re-run Integration + CULLIGAN.

## [4.14.2] — 2026-06-11

**Hotfix: persistent backup setValues — flush after grid expansion + resilient fallback.**

> **PATCH.** 4.14.1's grid fix deployed correctly (stack moved 325→338) yet
> the SAME setValues call still threw "Service error: Spreadsheets" in both
> lifecycle tests. Evidence gathered before this fix: the live workbook's
> input tabs were replayed offline through the real argiaBuildBackupRows —
> 1075×5 matrix, content fully clean (no oversized strings, no NaN, no
> invalid UTF-16, only string/number/Date). Size and content exonerated, the
> remaining deterministic trigger is the bulk write spanning rows freshly
> inserted by insertRowsAfter in the same execution without a flush.

- 00d_InputSnapshot.js: SpreadsheetApp.flush() after grid expansion, before
  the writes (targeted fix).
- Belt-and-suspenders: if bulk setValues still throws, fall back to 200-row
  chunks, then per-cell writes for any failing chunk — every failing cell is
  logged with backup row + source tab/r/c. The backup lands regardless, and
  a genuinely poisoned cell now NAMES ITSELF in LOGS instead of aborting
  Start New Project behind an opaque service error. Same resilience pattern
  restoreInputSheets has always had.
- PURE argiaChunkRanges() planner + UNIT_BACKUP_CHUNK_RANGES_COVER (chunks
  tile [0,total) exactly once — no gap, no overlap).
- Honest note: the Node rig cannot reproduce Sheets service errors; in-sheet
  INT_LIFECYCLE_* remain the gate. If they still error after this, the LOGS
  sheet will now contain the per-cell diagnosis to fix from.

## [4.14.1] — 2026-06-11

**Hotfix: persistent backup write exceeded the sheet grid.**

> **PATCH.** First live execution past the 4.13.1 fix surfaced the next bug
> in the same path: `setNumberFormat`/`setValues` over a range larger than
> the _INPUT_BACKUP sheet's grid (fresh sheets = 1000 rows; a full input
> snapshot is one row per non-empty cell and routinely exceeds that) throws
> the opaque "Service error: Spreadsheets", aborting
> INT_LIFECYCLE_PERSISTENT_BACKUP_ROUNDTRIP and START_NEW_PROJECT at
> 00d:325. Deterministic, not transient — both tests, same line, same run.

- 00d_InputSnapshot.js: grid capacity (rows AND columns) is guaranteed via
  insertRowsAfter/insertColumnsAfter before any range operation.
- Honest test note: the Node rig's Sheets stub has no grid limits, so this
  class of bug is NOT catchable offline. The in-sheet lifecycle integration
  tests are the regression gate for this path — they have now caught two
  consecutive bugs here, which is exactly their job. Verify in-sheet after
  push.
- Batch 2 (4.14.0) live results otherwise clean: full suite 3825/3838 with
  ZERO new failures (13 FAILs = pre-existing TESTPROJ001 fixtures + CULLIGAN
  standalone artifact); CULLIGAN E2E 105/105.

## [4.14.0] — 2026-06-11

**Batch 2 (code side): commercial-calibration guards — G3 SIN COTIZAR policy + G6 O&M/reserve zero-guards.**

> Scope note: B-1 (BESS screening Óptimo cap) was found ALREADY SHIPPED at
> HEAD (clamp + cap note in WriteCfeOutputV2_Chunk5, covered by
> CfeOutputChunk5Tests) — not re-done here. G1 (BESS re-quote ≤$350/kWh) and
> G2 (burdened labor + 94_INSTALL_BENCHMARKS) remain DATA tasks; the single
> golden refresh is deferred until that data lands in the DBs.

**G3 — SIN COTIZAR zero-line policy (BOM_v2):**
- Every rendered line with qty > 0 and price status MISSING_PRICE is now
  tracked; its empty PRECIO U cell is tinted (#FDECEA) so the gap survives
  PDF export (hover notes do not).
- GRAND TOTAL label flags the sheet-level consequence: "⚠ N PARTIDA(S) SIN
  COTIZAR — TOTAL PRELIMINAR", red font, with a note listing the offending
  rows. Label built by PURE `bomGrandTotalLabel()` (unit-locked); 0 missing
  → exact legacy string. Generalizes the B-2 empty-structure banner to every
  line. CULLIGAN goldens assert BOM VALUES, not this label — values
  unchanged. NOTE: CULLIGAN may now legitimately show the flag (transformer
  / inverter-rack $0 lines were the audit finding).

**G6 — O&M / replacement-reserve zero-guards (financial story):**
- PURE `argiaFinancialGuardNotes()` in 31_CalcClientFinancials: OM_ZERO
  fires when O&M ≤ 0 (every solar project has real O&M); RESERVE_ZERO fires
  when reserve ≤ 0 AND BESS materials > 0 (PV-only exempt).
- 31a_RunClientFinancials: guards feed ret.warnings (menu alert +
  orchestrator) AND render on-sheet via opts.guardNotes — written into the
  single spacer row between the CO2 note and the cash table, so tableTop and
  all golden-locked cells below are position-identical. Row stays empty when
  clean.
- 30b_RunBaasProjection: OM_ZERO surfaced as a confirm-style warning (O&M
  may legitimately be bundled into the lease); reserve is customer-side and
  not warned in BaaS. BESS detection = BOM_v2 §8 materials subtotal.

**Tests:** +3 pure Node-runnable tests (tests_unit/writers/Batch2GuardTests.gs):
UNIT_BOM_GRAND_TOTAL_LABEL, UNIT_FIN_GUARD_OM_ZERO_FIRES,
UNIT_FIN_GUARD_RESERVE_BESS_ONLY.

## [4.13.1] — 2026-06-11

**Hotfix: persistent input backup wrote a ragged matrix.**

> **PATCH.** v4.13.0's `persistInputSnapshot` built a 3-column header row
> alongside 5-column data rows and pushed both through one
> `setValues(...,5)` — Google Sheets rejects ragged matrices ("The data has
> 3 but the range has 5"), aborting INT_LIFECYCLE_PERSISTENT_BACKUP_ROUNDTRIP
> and INT_LIFECYCLE_START_NEW_PROJECT_CLEAN in the live suite and breaking
> Start New Project + the new backup path. The banner/stamp/export-guard
> machinery was unaffected (INT_LIFECYCLE_STALE_BANNER_APPLY_CLEAR fully
> green in the same run); CULLIGAN E2E 105/105 on v4.13.0.

- 00d_InputSnapshot.js: row construction extracted to PURE
  `argiaBuildBackupRows(snap, iso)` with the header padded to the full
  `INPUT_BACKUP_COLS` (5) width; `persistInputSnapshot` consumes it.
- Why the Node rig missed it: the rig's `setValues` stub doesn't validate
  matrix widths. New pure test `UNIT_BACKUP_ROWS_UNIFORM_WIDTH` asserts
  every emitted row is exactly 5 wide (plus header shape, formula
  precedence, empty-skip, INPUT_BAAS coverage) — this class of bug now
  fails in Node before any push.

## [4.13.0] — 2026-06-10

**Batch 1 — Workbook Lifecycle & Trust.** One push closing launch gates G4,
G5, G7 (staleness guard, clean reset, PDF filenames) plus the open A2 copyTo
retirement and the audit-drift gap.

> **MINOR.** New features, no breaking changes. CULLIGAN goldens untouched
> (banner writes are stale-only; stamps live in _META rows 17+).

### B1.1 — Start New Project (admin menu)
- `startNewProjectCore(ss)` + `runStartNewProject()`: persistent backup →
  DEFAULT rebuild of all six INPUT_* tabs → clear all 13 deliverable tabs
  (+ driver map) → clear freshness stamps → audit refresh. The undo path is
  "Restore Inputs from Backup".
- `rebuildInputsToDefault()` promoted to public; its VERIFY-POINT resolved
  (ordering constraints documented + exercised by the new lifecycle test).

### B1.2 — copyTo backup retired (closes A2 remainder)
- `backupAllInputSheets` / `restoreAllInputSheets` now run on the persistent
  formula-aware snapshot (hidden `_INPUT_BACKUP` sheet): ALL SIX tabs
  including INPUT_BAAS (the copyTo map omitted it), safe for INPUT_CFE array
  formulas, survives sessions. Legacy `_TEST_BACKUP_*` twins: restored once
  if found (migration grace), deleted on next backup.

### B1.3 — Generate ALL Deliverables (menu)
- `runGenerateAllDeliverables()`: engine → RFQs (silent) → BaaS → Client
  Financials in dependency order, one end-of-run summary. Kills the
  "regenerated financials against a stale BOM" ordering hazard.
- `runWriteAllRfqsV2(opts)` gains `{silent}` + returns {succeeded, failed}
  (no-arg menu path byte-identical).

### B1.4 — Staleness guard (new 00e_InputsHash.js)
- FNV-1a inputs hash (formula precedence — IMPORTRANGE recalcs do NOT fake
  staleness), `_META` key-value stamps per deliverable tab, red A1 banner on
  stale tabs, on-demand "Check Output Freshness" menu report, and an
  export-time prompt in 12_ExportPDF before exporting any STALE deliverable.
  Engine + all five standalone runners + RFQs now stamp what they write.
  Pre-existing (UNSTAMPED) outputs are never falsely flagged.

### B1.5 — PDF filename fix
- `_getProjectMeta` read the RETIRED INPUT_GENERAL sheet, so every exported
  PDF was named `<spreadsheet>_CLIENT_…`. Now reads projectName/clientName
  via the INPUT_MAP (INPUT_PROJECT), with INPUT_GENERAL as legacy fallback.

### B1.6 — Audit completeness
- CLIENT_FINANCIALS_v2 + BESS_RECOMMENDATIONS added to AUDIT_OUTPUT_SHEETS
  (live workbook had CLIENT_FINANCIALS_v2 populated and unaudited).
- "Audit Config (auto-discover sheets)" exposed in the admin menu.
- New contract test pins the audit lists to the stamped-deliverables + input
  tabs registries — a new writer without an audit entry now fails the suite.

### Tests
- +9 registered (487 → 496): 6 unit (hash determinism/sensitivity/formula
  precedence/boundaries, audit contract, engine-tabs contract — all green in
  the Node rig) + 3 workbook-dependent integration (persistent-backup
  round-trip incl. INPUT_BAAS, banner apply/clear/idempotence + export guard,
  Start-New-Project zero-residue + undo). Node rig: 496 registered, 454
  PASS, 0 FAIL, 42 expected workbook errors.

## [4.12.1] — 2026-05-29

**Two bugfixes, both fallout from the v4.12.0 INPUT_BAAS / output-header work.**

> **PATCH.** (1) Generating the BaaS projection rebuilt + relocated the
> INPUT_BAAS tab every run. (2) Five BAAS unit tests aborted because their
> mock sheets predated the writer's design-token dependency.

### Fix 1 — INPUT_BAAS tab rebuilt/relocated on every projection run
After v4.12.0 changed setupInputBaasSheet's signature to (force), the caller
in runBaasProjection still called setupInputBaasSheet(ss). The Spreadsheet
object landed in the `force` position; the function fell through to
_setupOneTab, which deleted + recreated INPUT_BAAS (moving it to the end of
the tab order and resetting its values) on every "Generate BaaS Projection".
- 30b_RunBaasProjection.js: calls setupInputBaasSheet() with NO args
  (ensure-exists, leave existing untouched).
- 30a_ReadInputsBaas.js: hardened so ONLY explicit boolean `true` forces a
  rebuild. Any other arg (no-arg, Spreadsheet object, undefined, false) =
  ensure-only. The old setupInputBaasSheet(ss) call is now harmless.
- Verified: no-arg+exists -> untouched; ss+exists -> untouched; true+exists
  -> rebuild; no-arg+missing -> created.

### Fix 2 — BAAS unit tests aborted on design tokens
v4.12.0 added loadDesignTokens(ss) to writeBaasProjectionV2 (for the branded
header), so the writer now READS design tokens. The BAAS test mocks predated
tokens and broke in two ways:
  (a) the mock sheet lacked methods the token sheet build calls (setValues,
      getLastRow, breakApart, setBorder, ...);
  (b) even once those were added, a benign empty stub left the token cache
      empty -- and the engine's token() FAILS LOUD on a missing key, so every
      token('FONT_FAMILY') threw.
- The WRITER is unchanged -- it uses token()/tokenNum() exactly like the
  passing BOM_v2 / CFE_OUTPUT_v2 writers.
- tests_unit/writers/BaasProjectionTests.gs + tests_unit/calc/BaasWiringTests.gs:
  upgraded the mock ranges/sheets AND added a SEEDED _DESIGN_TOKENS stub
  (getLastRow >= 2, getValues returns real token key/value rows) so
  loadDesignTokens populates the cache and token() resolves -- the same
  approach BomTemplateTests / WriteCfeOutputV2Tests already use.
- Verified with a FAITHFUL replica of the engine's token() (throws on missing
  key): writeBaasProjectionV2 runs NO THROW against both mocks; FONT_FAMILY
  resolves to 'Inter'; title + PROPOSAL disclaimer rendered.


### Version
Engine 4.12.0 -> 4.12.1.

---
## [4.12.1] — 2026-05-29

**Two bugfixes, both fallout from the v4.12.0 INPUT_BAAS / output-header work.**

> **PATCH.** (1) Generating the BaaS projection rebuilt + relocated the
> INPUT_BAAS tab every run. (2) Five BAAS unit tests aborted because their
> mock sheets predated the writer's design-token dependency.

### Fix 1 — INPUT_BAAS tab rebuilt/relocated on every projection run
After v4.12.0 changed setupInputBaasSheet's signature to (force), the caller
in runBaasProjection still called setupInputBaasSheet(ss). The Spreadsheet
object landed in the `force` position; the function fell through to
_setupOneTab, which deleted + recreated INPUT_BAAS (moving it to the end of
the tab order and resetting its values) on every "Generate BaaS Projection".
- 30b_RunBaasProjection.js: calls setupInputBaasSheet() with NO args
  (ensure-exists, leave existing untouched).
- 30a_ReadInputsBaas.js: hardened so ONLY explicit boolean `true` forces a
  rebuild. Any other arg (no-arg, Spreadsheet object, undefined, false) =
  ensure-only. The old setupInputBaasSheet(ss) call is now harmless.
- Verified: no-arg+exists -> untouched; ss+exists -> untouched; true+exists
  -> rebuild; no-arg+missing -> created.

### Fix 2 — BAAS unit tests aborted on design tokens
v4.12.0 added loadDesignTokens(ss) to writeBaasProjectionV2 (for the branded
header). loadDesignTokens -> ensureDesignTokensSheet calls setValues()/
getLastRow() on the sheet; the BAAS test mocks (_baasMockSheet,
_baasWireMockSs) predated tokens and lacked those methods (plus breakApart,
setBorder), so all 5 BAAS writer/wiring tests threw before asserting.
- The WRITER is unchanged — it uses token()/tokenNum() exactly like the
  passing BOM_v2 / CFE_OUTPUT_v2 writers.
- tests_unit/writers/BaasProjectionTests.gs + tests_unit/calc/BaasWiringTests.gs:
  upgraded the mock sheets/ranges to the same benign-stub shape the passing
  token-using writer tests already use -- added breakApart, setValues,
  setBorder, setNumberFormat, getValues, getLastRow()=1 (so loadDesignTokens
  short-circuits), setFrozenRows, setHiddenGridlines, getImages, and routed
  _DESIGN_TOKENS lookups to a benign stub.
- Verified: writeBaasProjectionV2 runs with NO THROW against both upgraded
  mocks; title + PROPOSAL disclaimer still rendered.

### Version
Engine 4.12.0 -> 4.12.1.

---
## [4.12.1] — 2026-05-29

**BUGFIX: generating the BaaS projection rebuilt + relocated the INPUT_BAAS tab every run.**

> **PATCH.** After v4.12.0 changed setupInputBaasSheet's signature to
> (force) — delegating to _setupOneTab — the existing caller in
> runBaasProjection still called setupInputBaasSheet(ss). The Spreadsheet
> object was read as a truthy `force`, so every "Generate BaaS Projection"
> deleted and recreated INPUT_BAAS, moving it to the end of the tab order.

### Fixed
- 30b_RunBaasProjection.js: calls setupInputBaasSheet() with NO arguments
  (ensure-exists, leave an existing sheet untouched).
- 30a_ReadInputsBaas.js: hardened setupInputBaasSheet so ONLY an explicit
  boolean `true` forces a rebuild. Any other arg (no arg, a Spreadsheet
  object, undefined, false) means "ensure it exists, leave existing
  untouched" -- so the old setupInputBaasSheet(ss) call (or any future
  habitual ss-pass) can no longer delete/relocate the tab.

### Verified
- no-arg + exists -> untouched (no rebuild, no tab move)
- ss-arg + exists -> untouched (the old buggy call is now safe)
- force=true + exists -> rebuilds (intended)
- no-arg + missing -> creates it

### Root cause note
v4.12.0 gave setupInputBaasSheet a signature inconsistent with the engine's
readers (which take ss). The defensive coercion removes that foot-gun.

### Version
Engine 4.12.0 -> 4.12.1.

---
## [4.12.0] — 2026-05-29

**Formatting pass: INPUT_BAAS into INPUT_MAP (Group 1) + branded headers on two output sheets (Group 2).**

> **MINOR.** Consistency fixes so these sheets match the rest of the workbook.

### Group 1 — INPUT_BAAS → INPUT_MAP (full fix)
v4.11.0 restyled INPUT_BAAS by hand (a near-miss). Now its 14 fields live in
INPUT_MAP (_MAP_BAAS) and it renders through _setupOneTab -- the IDENTICAL
path as INPUT_PROJECT / INPUT_INSTALL / INPUT_BESS: label B:C, value D, col-E
format hints, dropdowns (FINANCIERO/PURO, YES/NO), percent formatting,
dividers, section header at row 6.
- Added _MAP_BAAS (14 fields, rows 8-21, col D) + SH.INPUT_BAAS constant.
- setupInputBaasSheet(force) is now a thin _setupOneTab wrapper + disclaimer
  appender. readInputBaas reads col D (was C) -- only the reader touches the
  sheet, fully contained.
- Verified: map merges clean (179 keys), section discovered, header at row 6,
  reader reads col D correctly. CONFIRMED LIVE: matches the other input sheets.

### Group 2 — branded output-sheet headers (BOM/MDC recipe)
BESS_RECOMMENDATIONS and BAAS_PROJECTION_v2 lacked the logo/header band the
other output sheets (BOM_v2, MDC_v2, CFE_OUTPUT_v2) have.

**BAAS_PROJECTION_v2 — full fix.** Follows the BOM template recipe exactly:
  - logo anchored (2,1), displaying across a widened col 2 (260px)
  - title at row 2 (FONT_SIZE_TITLE 22, token font/color), subtitle row 3
  - PROPOSAL disclaimer relocated to row 4 (tokenized callout colors); KPIs
    shifted to row 6; projection table cascades down accordingly
  - ALL hardcoded colors tokenized (table header -> BG_INPUT_CELL, range band
    -> BG_SUBTOTAL, disclaimers -> BG_CALLOUT/STATUS_WARN, status ->
    STATUS_FAIL/TEXT_PRIMARY, footnotes -> TEXT_MUTED). Zero hardcoded hex.

**BESS_RECOMMENDATIONS — partial fix (deliberate).** This is a DENSE internal
diagnostic table with ~36 rows of absolutely-positioned content starting at
row 2; a full BOM-style banner would require shifting every row (high risk for
an internal-only sheet). So: logo at (1,1) + token-styled title (FONT_SIZE_
TITLE) on row 1; the dense body is intentionally left intact. The RECOMMENDED
banner at row 2 and all downstream rows are untouched (verified no collision).
A full template rebuild remains available as a future dedicated increment.

### Verified
- BAAS: logo (2,1), col2=260, title row 2, disclaimer row 4, KPIs row 6 --
  layout holds, all colors tokenized.
- BESS: logo (1,1), token title row 1, body/banner untouched.

### How to apply
- clasp push.
- INPUT_BAAS: run setupInputBaasSheet(true) once (force rebuild). DONE/confirmed.
- BESS_RECOMMENDATIONS + BAAS_PROJECTION_v2: regenerate via a normal engine run.

### Version
Engine 4.11.0 -> 4.12.0.

---
## [4.12.0] — 2026-05-29

**Formatting pass: INPUT_BAAS into INPUT_MAP (Group 1) + branded headers on BESS_RECOMMENDATIONS & BAAS_PROJECTION_v2 (Group 2).**

> **MINOR.** Two consistency fixes so these sheets match the rest of the
> workbook. Group 1 makes INPUT_BAAS render through the SAME machinery as the
> other input sheets. Group 2 adds the ARGIA logo + token-styled header to two
> output sheets that were missing them.

### Group 1 — INPUT_BAAS → INPUT_MAP
v4.11.0 restyled INPUT_BAAS by hand (a near-miss: 2-column layout, no col-E
hints/dropdowns). Now its 14 fields live in INPUT_MAP (_MAP_BAAS) and it
renders through _setupOneTab -- the IDENTICAL path as INPUT_PROJECT /
INPUT_INSTALL / INPUT_BESS: label B:C, value D, format hints, dropdowns,
validation, dividers.
- Added _MAP_BAAS (14 fields, rows 8-21, col D, section "01 PARÁMETROS DE
  ARRENDAMIENTO"); types: percent (escalaciones/TIR/WACC/ISR), number
  (plazo/años/MXN/FX), dropdown (FINANCIERO/PURO, YES/NO). Added to _mergeMaps.
- Added SH.INPUT_BAAS constant (00_Main.js).
- setupInputBaasSheet(force) is now a thin _setupOneTab wrapper + disclaimer
  appender. readInputBaas reads col D (was C) -- only the reader touches the
  sheet, so the blast radius is contained. INPUT_BAAS_ROWS shifted to 8-21.
- Verified: map merges clean (179 keys), 14 fields registered, _setupOneTab
  discovers the section + places header at row 6, reader reads col D correctly.

### Group 2 — branded headers on the two output sheets
BESS_RECOMMENDATIONS (19b) and BAAS_PROJECTION_v2 had no logo/header band,
unlike CFE_OUTPUT_v2. Both now follow the CFE output-sheet recipe: load
tokens, stamp _insertArgiaLogo(sh, 1, 1), title in col 3 (clears the logo),
hidden gridlines.
- BAAS_PROJECTION_v2: logo + token title at row 1 (was a bare 13px title).
  Downstream rows unchanged.
- BESS_RECOMMENDATIONS: logo + token title at row 1, generation timestamp
  appended to the title (NOT a new row) so the RECOMMENDED banner at row 2 and
  all downstream row math are untouched -- verified no collision.

### Verified
- Both writers: logo at (1,1), title at (1,3); BESS row 2 left clear for the
  banner. Header changes don't shift any data rows.

### How to apply
- clasp push.
- INPUT_BAAS: run setupInputBaasSheet(true) once to rebuild with the shared
  renderer. (Signature is now (force) first-arg; bare no-arg engine call still
  leaves an existing sheet untouched.)
- BESS_RECOMMENDATIONS + BAAS_PROJECTION_v2: regenerate via a normal engine
  run -- the logo/header appears automatically.

### Version
Engine 4.11.0 -> 4.12.0.

---
## [4.12.0] — 2026-05-29

**INPUT_BAAS migrated into INPUT_MAP — now renders identically to every other input sheet.**

> **MINOR.** v4.11.0 restyled INPUT_BAAS by hand (a near-miss: it kept a
> 2-column layout and lacked the col-E hints, dropdowns, and per-row styling
> the other sheets get). This migrates its 14 fields into INPUT_MAP so it
> renders through the SAME _setupOneTab machinery as INPUT_PROJECT /
> INPUT_INSTALL / INPUT_BESS -- label B:C, value D, format hints, dropdowns,
> validation, dividers. No longer a near-miss; it IS the same renderer.

### Added
- _MAP_BAAS in 02c_InputMap.js: 14 fields (rows 8-21, col D), section
  "01 PARÁMETROS DE ARRENDAMIENTO". Proper types: percent (escalaciones,
  TIR, WACC, ISR), number (plazo, años, MXN/año, FX), dropdown (tipo
  FINANCIERO/PURO, ¿beneficio fiscal? YES/NO). Added to the _mergeMaps list.
- SH.INPUT_BAAS constant in 00_Main.js (was previously the literal string).

### Changed
- 30a_ReadInputsBaas.js:
  - setupInputBaasSheet(force) is now a thin wrapper over _setupOneTab(
    SH.INPUT_BAAS, 'INPUT BAAS', force) + a disclaimer-note appender. The
    hand-rolled styling is gone.
  - readInputBaas reads the VALUE column D (col 4) -- the house standard --
    instead of C. (Only readInputBaas touches the sheet; downstream consumes
    the returned object, so this is the full blast radius.)
  - INPUT_BAAS_ROWS shifted to rows 8-21 (clears logo block + section header
    at row 6), matching the map.

### Verified
- INPUT_MAP merges with no duplicate-key error (179 total keys).
- All 14 BaaS fields registered on INPUT_BAAS col D, one section.
- inputSectionsForTab('INPUT_BAAS') discovers the section; _setupOneTab
  places the header at row 6 (minRow 8 - 2) and renders fields 8-21 via
  _renderInputRow -- the identical path the other input sheets use.
- Reader reads all values correctly from col D after a rebuild.

### How to apply
- clasp push, then run setupInputBaasSheet(true) (force) once to rebuild the
  existing sheet with the shared renderer. (No-arg engine-run call still
  leaves an existing sheet untouched.)
- NOTE the new signature: setupInputBaasSheet(force) -- the force flag is the
  FIRST arg now (it delegates to _setupOneTab). A bare setupInputBaasSheet()
  during an engine run is unchanged (returns existing untouched).

### Version
Engine 4.11.0 -> 4.12.0.

---
## [4.11.0] — 2026-05-29

**INPUT_BAAS restyle: match the shared input-sheet design system.**

> **MINOR.** INPUT_BAAS was hand-styled (bare bold title, hardcoded colors)
> and looked inconsistent with the other input tabs. Now routed through the
> same design primitives: logo top-left (B2:C3), title shifted to D2,
> section-header band, design tokens (warm page bg, Inter type, input-cell
> backgrounds on the value column, shared callout colors).

### Changed
- 30a_ReadInputsBaas.js `setupInputBaasSheet(ss, force)`:
  - Adopts the house contract (force flag + user-data guard), matching
    _setupOneTab: no-arg returns an existing sheet untouched (engine-run
    back-compat); (ss,true) force-rebuilds with the new styling; 1-arg
    guarded call throws rather than clobbering user values.
  - Uses _insertArgiaLogo + _writeTitleShifted + primSectionHeader + design
    tokens instead of the old inline styling.
  - The reader (readInputBaas) and the row layout are UNCHANGED -- values
    still live in col C on the same rows; verified the reader reads correctly
    after a restyled rebuild.

### Tests
- Styling rebuild verified via mock: logo at B2, title shifted, section
  header rendered, all 14 rows (label B / value C) with input-cell
  backgrounds, no-arg back-compat preserved, reader integrity intact
  post-rebuild.

### Note
Applying the look to an EXISTING INPUT_BAAS requires a forced rebuild
(setupInputBaasSheet(ss, true)) -- see PLACEMENT_GUIDE. The no-arg engine
path intentionally leaves existing sheets untouched.

### Next
- BESS_RECOMMENDATIONS + BAAS_PROJECTION_v2 (output sheets) to match the
  v2 output-sheet header/logo pattern.
- Optional: native seasonal Con/Sin BESS chart (image-6 style) fed by engine
  data. Images 4 & 5 are proposal-deck assets, not engine-renderable.

### Version
Engine 4.10.1 -> 4.11.0.

---
## [4.10.0] — 2026-05-29

## [4.10.1] — 2026-05-29

**Chunk 7 4B BUGFIX: capture regime enum mismatch (caught on live output).**

> **PATCH.** The export-capture value ignored the interconnection regime and
> always computed as net-metering ($0), regardless of the actual regime.
> Found by flipping a live 4B project to SIN_EXPORTACIÓN: the main bill
> responded but the capture block stayed at the net-metering $0. Now fixed
> and verified across all three regimes.

### Root cause
`readBessInterconnectionFromInputCfe` returns ENGLISH enum strings
(NET_METERING / NET_BILLING / ZERO_EXPORT), but `calcCaptureNetValue`
(29_) only matched the SPANISH enum (MEDICION_NETA / FACTURACION_NETA /
SIN_EXPORTACION) and used a catch-all `else` that defaulted to net-metering.
So every regime fell through to the net-metering branch -> capture always
$0. The original unit tests passed only because they fed the Spanish
strings the module expected -- they didn't reflect what the engine passes.

### Fixed
- 29_CalcCaptureNetValue.js: normalize the regime, accepting BOTH the
  English (engine) and Spanish (CFE_MODE) spellings. Replaced the catch-all
  `else` with an explicit NET_METERING branch + an UNKNOWN branch that is
  CONSERVATIVE (prior worth = discharge value -> nets to 0, never overstates).

### Verified (live screenshot inputs: 200,000 kWh, gross $336,959)
  NET_METERING : $0        (correct -- export already credited ~1:1)
  NET_BILLING  : $176,959  (export was worth 0.80)
  ZERO_EXPORT  : $336,959  (export was being wasted -> full value)

### Tests
- +3 regression tests (12 total / 32 assertions green):
  - UNIT_CNV_ENGLISH_ENUM_FROM_ENGINE: the English enum produces correct,
    non-defaulted results (the bug, locked).
  - UNIT_CNV_SPANISH_ENGLISH_EQUIVALENT: both spellings give identical net
    values.
  - UNIT_CNV_UNKNOWN_REGIME_CONSERVATIVE: garbage regime nets to 0.
- The existing 9 tests updated to use the ENGLISH strings the engine passes.

### Note on capture gross rate
The live gross (~1.685 MXN/kWh) reflects this project's GDMTH punta energy
rate, not a bug -- the 3.5 figure in the design doc was an illustrative
example, not this service's rate.

### Version
Engine 4.10.0 -> 4.10.1.

---
**Chunk 7 4B (writer): export-capture value display line.**

> **PATCH/MINOR — additive, byte-identical for non-4B projects.** Renders
> the 4B export-capture value on CFE_OUTPUT_v2. v4.9.0 computed it; this
> surfaces it. Non-4B projects (no existing PV) render exactly as before
> (the block is a no-op — proven).

### Added
- **`_cfeOutV2_renderCaptureBlock`** (WriteCfeOutputV2_Chunk5.js) — a
  separated "CAPTURA DE EXCEDENTE SOLAR EXISTENTE" block, three states:
    (a) capture adds value -> net value + regime + gross/prior transparency
    (b) net-metering adds no value -> "$0 (no agrega valor)" + the battery
        rests-on-peak-shaving note
    (c) export data absent -> "DATOS INSUFICIENTES" + what data is needed
  Wired into writeCfeOutputV2 after the resilience block.

### Invariants (visible to the customer)
- Never blend: header "separado del ahorro CFE"; value render carries
  "NO es ahorro en el recibo CFE".
- The regime label + the gross − prior-worth = net subtraction are shown,
  so the honesty of the netting is transparent on the sheet.

### Tests
- **+6 tests, 15 assertions, all green** (CaptureBlockTests.gs): the three
  states, the non-4B no-op (byte-identical), the never-blend invariant,
  gross/prior/net transparency.
- Byte-identical proof: a non-4B project (existingPvExport empty) renders
  ZERO rows from the block.

### Chunk 7 4B is now complete end-to-end
inputs (D70 export gate) -> data-gated classify (4.8.0) -> capture channel
+ anti-double-count (4.8.0) -> regime-netting honest value (4.9.0) ->
CFE_OUTPUT display line (this version).

### Version
Engine 4.9.0 -> 4.10.0.

---

## [4.9.0] — 2026-05-29

**Chunk 7 4B regime-netting: the honest export-capture value.**

> **MINOR — byte-identical for non-4B projects.** Completes Scenario 4B:
> the export-capture value is now NET of what the exported energy was
> already worth under the interconnection regime. NET_METERING capture
> correctly shows LOW/zero value (the export was already credited ~1:1);
> ZERO_EXPORT shows MAXIMUM. Fixes the v4.8.0 over-statement under
> favorable net-metering.

### Added

- **`29_CalcCaptureNetValue.js`** — pure `calcCaptureNetValue()`:
  `captureNetValue = max(0, dischargeValue - priorExportWorth)`, where
  priorExportWorth depends on the regime:
    - MEDICION_NETA  (net metering)  -> ~retail (export already ~1:1) -> net LOW
    - FACTURACION_NETA (net billing) -> export price (~0.80)          -> net HIGH
    - SIN_EXPORTACION  (zero export) -> 0 (was lost)                  -> net MAX
  Floored at 0 (never shown negative); when capture adds no value, the note
  states the battery's case rests on peak-shaving, not capture.

### Changed

- `20a`: for a 4B project with export data, computes captured kWh (capped at
  the battery's annual throughput), values it at the punta rate, and runs
  calcCaptureNetValue with the project's interconnection regime. Attaches
  `result.existingPvExport.captureNetValue`. NEVER blended into CFE savings
  (its own field, like resilience). batterySpec now also surfaces usableKwh
  + cyclesPerDay for the throughput cap.

### The table this proves (worked example: 200,000 kWh/yr export, punta 3.5)
  ZERO_EXPORT   : $700,000/yr net  (max -- surplus was wasted)
  NET_BILLING   : $540,000/yr net  (high -- export was only 0.80)
  NET_METERING  : $0/yr, addsValue=false (export already credited ~1:1)

### Conservative assumption (disclosed)
For MEDICION_NETA, prior-export worth uses the punta rate as the offset
proxy. This zeroes capture under net-metering -- the SAFE direction (never
overstates). Refining the exact NM offset rate is a future tweak; the floor
ensures we never inflate retrofit value under net-metering.

### Tests
- **+9 tests, 23 assertions, all green** (`CaptureNetValueTests.gs`):
  the three-regime values, the regime ORDERING invariant (zero > billing >
  metering), the floor-at-zero invariant (never negative), addsValue flag,
  the peak-shaving note, gross+prior transparency, zero-capture-zero-value.

### Out of scope (still deferred)
- 4B capture writer line on CFE_OUTPUT (value on the result; display is a
  follow-up like resilience).
- existing PV + NEW PV + battery ("retrofit expansion").

### Version
Engine 4.8.0 -> 4.9.0.

---

## [4.8.0] — 2026-05-29

**Chunk 7 Scenario 4B: existing-PV export capture (data-gated).**

> **MINOR — byte-identical for all non-4B projects.** Adds the retrofit
> case: an existing-solar customer adds a battery to capture exported
> surplus. The export-capture value stream is DATA-GATED — computed only
> from REAL export data, never estimated from the net bill.

### The honest rule
A customer's CFE bill is NET grid import; it cannot reveal hourly export.
Estimating export from net load only produces an upper bound that overstates
midday capture. So export-capture value is computed only when the customer
supplies measured exported kWh. Absent -> peak-shaving-only + "DATOS
INSUFICIENTES" for capture. Maps to SCREENING / PROPOSAL / BANKABLE tiers.

### Added
- 28_CalcExistingPvShape.js: (monthly | annual | kWp×factor) -> 12 monthly
  kWh + existingPvSource confidence type.
- existingPvExportableSurplusByHour charging-only channel in 20b: folded into
  PV-charge surplus ONLY, never into net/demand-limit (anti-double-count).
- existingExportKwh input (INPUT_PROJECT SOLAR, D70) -- the capture GATE.

### Changed
- 01c classifyScenario: 4B data-gated (4B capture-ON with export data;
  4B-screening peak-shaving-only without). Replaces 4B-pending.
- 20a/20_: measured export shaped to hourly surplus, fed to the channel;
  baseline sim never receives it (structural anti-double-count guard).

### Tests
- +12 tests; combined 22/55 assertions green: shape module, anti-double-
  count invariant, byte-identical guard, data-gating invariant.

### Version
Engine 4.7.0 -> 4.8.0.

---
# Changelog

All notable changes to ARGIA Engine.

Format: based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (MAJOR.MINOR.PATCH).

- **MAJOR** — breaking change; existing project workbooks will recalculate to different numbers
- **MINOR** — new feature; existing projects recalculate the same
- **PATCH** — bug fix; should not change numbers (document regression risk if it does)

---

## [4.0.0] — 2026-05-28

**First major release. Shipping-readiness milestone + strategy-aware BESS
dispatch (Chunk 4).**

> **BREAKING:** Existing PV+BESS projects recalculate to different numbers.
> The hourly battery dispatch is now driven by the `bessStrategy` setting;
> before 4.0.0 the setting was read but ignored (one fixed greedy policy ran
> for every project). PV-only projects are unaffected.

### Changed — battery dispatch is now strategy-aware

- `bessStrategy` (INPUT_BESS!C7) now actually steers the hourly simulator.
  New priority-weighted dispatcher `_bessDispatchHour` in
  `20_CalcHourlySimulation.js`.
- **Philosophy:** strategy sets the PRIORITY ORDER when discharge, PV-capture,
  and grid-arbitrage compete for the battery's finite SoC and power. It is
  **not** a hard on/off switch — every strategy still pursues every saving
  type; only the contest order changes ("always pursue every saving").
- Priority chains:
  - **PEAK_SHAVING** — punta discharge (1) → PV capture (2) → intermedia
    discharge (3). No grid charging.
  - **SELF_CONSUMPTION_MAX** — PV capture (1) → discharge to cover load (2).
    No grid charging.
  - **LOAD_SHIFTING** — punta discharge (1) → base grid-charge via smart gate
    (2) → PV capture (3) → intermedia discharge (4).

### Added

- **LOAD_SHIFTING** is now selectable in the `bessStrategy` dropdown (was
  defined in the enum but never exposed). It alone grid-charges in base hours
  for base→punta arbitrage, behind a smart gate: NET_BILLING only, and only
  when `ratePunta × rte > rateBase` (arbitrage must beat round-trip losses).
- **CFE_OUTPUT_v2 strategy explainer** — a one-line plain-Spanish "por qué
  esta estrategia" sentence under the BESS spec row, describing what the
  battery prioritizes. Customer-facing transparency.
- `04a_CalcCFEBill` `BESS_STRATEGY` enum gains `LOAD_SHIFTING`; `calcBessImpact`
  now accepts it (as a conservative self-consumption-capture proxy — the
  monthly analytic layer does not model grid arbitrage; only the hourly sim
  does). Keeps both layers from throwing on a valid dropdown value.
- **`refreshBessStrategyDropdown`** (new menu action: ARGIA → Setup → "Refresh
  BESS Strategy Dropdown"). Data-validation rules are baked into the sheet when
  a tab is first built, so adding LOAD_SHIFTING to INPUT_MAP does NOT update an
  existing C7 dropdown. This one-shot re-applies the C7 validation from the
  current INPUT_MAP (and clears the stale tooltip). **Run this once after
  pushing 4.0.0 to make LOAD_SHIFTING selectable** in existing workbooks.

### Recalc impact

- **PEAK_SHAVING**: battery now also discharges in intermedia (priority 3) to
  capture secondary savings; was punta-exclusive. Slightly higher discharge
  and savings.
- **SELF_CONSUMPTION_MAX**: near-identical to PEAK_SHAVING (see convergence
  note); minimal change vs the old default behavior.
- **LOAD_SHIFTING**: materially higher savings wherever the punta/base spread
  + NET_BILLING make arbitrage profitable.

### Known convergence (documented, asserted, not a bug)

- **PEAK_SHAVING ≈ SELF_CONSUMPTION_MAX.** The one ordering difference between
  them (PV-capture-first vs punta-discharge-first) only matters if PV surplus
  and punta load occur in the *same hour*. PV surplus is midday
  (base/intermedia); punta is evening. That conflict almost never arises, so
  the two converge by design. `LOAD_SHIFTING` is the genuine differentiator.
  Both properties are asserted in `BessDispatchStrategyTests.gs` so a future
  change that breaks the relationship gets caught.

### Tests

- `tests_unit/calc/BessDispatchStrategyTests.gs` (new): 8 tests — pure-function
  policy table (punta-first, intermedia-secondary, PV-first for SC, grid-charge
  gate open/blocked/non-NET_BILLING, SoC + power limits) plus a full-sim
  comparative proving PS≈SC, LS distinct, and all three beat the no-battery
  baseline.
- `tests_unit/writers_v2/CfeStrategyExplainerTests.gs` (new): explainer text
  per strategy, case-insensitivity, blank/unknown → "".
- `tests_unit/calc/CalcHourlySimulationTests.gs` (updated): the old
  punta-exclusive discharge assertion (TEST 9) is replaced with the new
  priority-honored invariant (PEAK_SHAVING discharges in punta when punta load
  exists), reflecting the intended behavior change.
- Harness: 250 PASS / 0 FAIL.

### Fixed — interconnection display + LOAD_SHIFTING silent-collapse guard (4.0.0)

- **CFE_OUTPUT_v2 INTERCONEXION was blank.** The display source map read
  `INPUT_CFE!C40`, but the interconnection mode actually lives at **C41**
  (confirmed: the simulation reader in `02_LoadDB` and `19_RunBessSuggestion`
  both use C41). The display was reading the wrong cell. Fixed to C41.
  Interconnection now always renders, mapped to a friendly label
  (`FACTURACIÓN NETA (NET_BILLING)`, etc.), with `(no definido)` shown when
  unset instead of a blank cell.
- **LOAD_SHIFTING silently collapsed to PEAK_SHAVING under non-NET_BILLING.**
  This is correct behavior (grid arbitrage requires FACTURACION_NETA), but it
  was *silent* — selecting LOAD_SHIFTING under MEDICION_NETA produced numbers
  identical to PEAK_SHAVING with no indication why. Now warned in three places:
  1. A red, bold warning line in CFE_OUTPUT_v2 directly under the strategy.
  2. A MAJOR log entry during the engine run.
  3. The end-of-run alert dialog (via bessResult.warnings).
  The warning names the cause and the fix (set INPUT_CFE!C41 = FACTURACION_NETA
  or pick PEAK_SHAVING).
- New helpers `_cfeOutV2_interconnLabel` and `_cfeOutV2_loadShiftWarning`
  (both unit-tested) and a strategy↔interconnection consistency check in
  `00_Main.js` after the BESS step.

### Files

- `20_CalcHourlySimulation.js` — `_bessDispatchHour` + strategy threading
- `20a_RunHourlySimulation.js` — reads `bessStrategy` (C7) into batterySpec
- `02c_InputMap.js` — LOAD_SHIFTING added to dropdown
- `02e_InputSetup.js` — `refreshBessStrategyDropdown` (re-applies C7 validation)
- `04a_CalcCFEBill.js` — enum + calcBessImpact accept LOAD_SHIFTING
- `00_Main.js` — "Refresh BESS Strategy Dropdown" menu item
- `writers_v2/WriteCfeOutputV2.js` — strategy explainer + interconnection
  label + LOAD_SHIFTING warning
- `writers_v2/helpers/CfeOutputSourceMap.js` — interconnMode C40 → C41 fix
- `00a_Version.js` — 3.7.8 → 4.0.0

---

## [3.7.8] — 2026-05-27

**Shipping-readiness pass — Chunks 0+1+2+3.** Bug sweep, Node test harness,
OutputValidate unit coverage, and install cost sanity guardrails. No
breaking changes; advisory only on the new guardrails.

### Fixed — Chunk 0 (bug sweep, 7 fixes)

- **B1** `05_CalcAC.js:86`: per-inverter status ternary mislabeled
  OCPD-fail / Vdrop-pass cases as `[PASS]`. The pre-patch ternary
  `result.pass ? '[PASS]' : (result.vdropACPass ? '[PASS]' : '[REVIEW]')`
  collapses to "pass OR vdropACPass". Now `[REVIEW] -- Caída AC` unless
  both checks pass. Customer-facing: MDC §2 status column will now show
  `[REVIEW]` for the (rare) projects where the OCPD selector landed
  below the 1.25× breaker requirement but voltage drop happened to pass.
- **B2** `05_CalcAC.js:86,180`: mojibake. `Cada AC` → `Caída AC`;
  `Verifica cada de tensin` → `Verificar caída de tensión`. UTF-8
  accents restored. Customer-facing in MDC §2.
- **B3** `09_Validate.js:211`: operator-precedence latent bug. JS `&&`
  binds tighter than `||`, so `acKw > 0 && ratio < X || ratio < 0.8`
  parsed as `(acKw > 0 && ratio < X) || (ratio < 0.8)` — the second
  branch fires regardless of the `acKw > 0` guard. Today masked by an
  enclosing block guard, but a footgun. Explicit parens added.
- **B6** `00_Main.js:1034`: `engineLog(ss, 'Engine', 'WARN', ...)` typo.
  Canonical level is `'WARNING'` (10_Logger.js:33,45 documents the set).
  Pre-patch the row would have rendered without the yellow background
  in the LOGS sheet.
- **B7** `00_Main.js:691`: dead conditional `name !== 'BOM'` referenced
  `SH.BOM`, removed in 3.7.5 with the v2 cutover. Cleaned up.
- **B8** `00_Main.js:374`: stale comment `=F*$F$3` for `BOM_COL.TOTAL_MXN`.
  Fixed to reference `BOM_ROW.EXCHANGE_RATE` (the actual source row).
- **B9** `writers_v2/WriteMdcV2.js:130,132`: MDC §0 GENERALES cited
  `INPUT_GENERAL!C5/C6` for project name and client name. INPUT_GENERAL
  was retired in v2.0.2+; those fields now live at `INPUT_PROJECT!D8/D9`.
  **Customer-facing transparency lie** — MDC pointed customers at a
  sheet that no longer exists. Now uses `inputLocation('projectName')`
  and `inputLocation('clientName')`, which resolve via INPUT_MAP (the
  single source of truth for input cell coordinates).

### Added — Chunk 1 (Node test harness)

- `scripts/full_selftest.js`: Node runner that loads all 54 source files
  and 67 test files, runs every `registerTest` entry against a mock
  spreadsheet, and reports PASS / FAIL / ERROR per group.
- Refined exit gate distinguishes:
  - **Unit FAILs** (must fix before push)
  - **Unit ERRORs** that are real bugs (must fix)
  - **Workbook-dependent test ERRORs** that need a live spreadsheet
    (recognized by the throw signature `Cannot read properties of null
    (reading 'getSheetByName' | 'insertSheet' | 'getRange' |
    'getActiveSpreadsheet')`). These are expected and run from the
    ARGIA menu in a real workbook.
- Pre-push ritual: `node scripts/full_selftest.js` must end with
  `ALL GREEN`.

### Added — Chunk 2 (OutputValidate unit coverage)

- `tests_unit/engine/OutputValidateTests.gs`: 10 new tests for
  `validateOutputConsistency` (`09b_OutputValidate.js`), which had been
  in production since v2.4.0 without unit coverage. Covers:
  1. All sheets agree → `passed=true`
  2. MDC ↔ BOM project name mismatch → critical
  3. MDC ↔ PROJECT_CARD project name mismatch → critical
  4. Module count mismatch (MDC vs INSTALLATION) → critical
  5. Inverter count mismatch (MDC vs INSTALLATION) → critical
  6. MDC empty → all checks skipped (info, not critical)
  7. MDC sheet absent → graceful skip
  8. BOM_v2 absent → only BOM check skipped, others run
  9. `_ov_str` helper edge cases (null, undefined, blank, number coercion)
  10. `_ov_num` helper edge cases (parse, blank → null, non-numeric → null)

### Added — Chunk 3 (Install cost sanity guardrails)

- `09c_InstallCostSanity.js`: post-engine advisory check that compares
  computed install cost against industry-typical ranges. **Advisory only
  — never blocks the engine.** Three independent checks:
  - **PV install MXN/Wp** — warn if outside 1.0–5.0 (commercial Mexico
    floor / small-job ceiling).
  - **BESS BoP USD/kWh** — warn if outside 30–200 (only runs when BESS
    is enabled). Industry C&I commercial BESS BoP install typical is
    $60-150/kWh (NREL 2024 ATB; BloombergNEF 2024).
  - **Blended labor rate MXN/MH** — warn if outside 80–400.
- Bounds live in `buildNomLimitsDefaults()` under six new keys:
  `install_pv_mxn_per_wp_warn_min/max`,
  `install_bess_usd_per_kwh_warn_min/max`,
  `install_blended_labor_rate_warn_min/max`. Ops can tighten as
  `94_INSTALL_BENCHMARKS` fills in.
- Wired as **Step 14.5** in `runArgiaEngine`, after the existing output
  consistency check. Try/catch wrapped — a guardrail bug never breaks
  the engine.
- Warnings surface to:
  - `LOGS` sheet at WARNING level (yellow row background)
  - End-of-run UI alert dialog (new section appended after BESS line)
- `tests_unit/engine/InstallCostSanityTests.gs`: 9 new tests covering
  in-range happy path, each guardrail's LOW and HIGH paths, PV-only
  (no BESS check), missing-installResult graceful, and a CULLIGAN
  reproduction case asserting both PV LOW + BESS LOW fire with the
  exact computed values (0.61 MXN/Wp, $5.30 USD/kWh).

### Fixed — post-deploy follow-ups (same release)

After the first Apps Script run of 3.7.8, two issues surfaced that the
Node harness had not caught, plus one stale test was fixed proactively:

- **Harness fidelity gap (the important one).** The Node harness in
  `scripts/full_selftest.js` defined convenience assert methods
  (`assertNull`, `assertEq`, `assertNotNull`) that the real
  `test/TestAssert.gs` API does **not** expose. A test using one of them
  passed locally but threw `t.X is not a function` in Apps Script. The
  harness now mirrors the real API surface exactly (suite, assert,
  assertNear, assertThrows, assertContains, assertTrue, assertFalse,
  fail, assertSnapshot, expectWarning, expectNoWarning, info, error,
  flush, reset, _setContext) — no more, no less — so this class of error
  is caught before push.
- **`UNIT_INSTALL_SANITY_PV_ONLY_NO_BESS_CHECK`** used `t.assertNull`,
  which does not exist. Replaced with `t.assertTrue(..., value === null)`.
- **`INT_BDF7_BOM_BESS_SECTION_RENDERS`** read the legacy `BOM` sheet,
  deleted in the 3.7.5 v2 cutover. Updated to `BOM_v2`. (This was slated
  for Chunk 6 stale-reference cleanup; pulled forward since it was
  actively failing.)

Two regression failures observed in the same run are **pre-existing and
environmental, not 3.7.8 regressions** (documented since 3.7.6):
`REG_CULLIGAN_BASELINE_V2` and `REG_BESS_SIM_FORMULAS` both require the
workbook to be holding a fresh CULLIGAN engine run. When the full test
batch runs smoke-test fixtures over the output/simulation sheets first,
these read stale state and fail. Both self-diagnose with the fix:
re-run "Generate MDC and BOM" against CULLIGAN, then run the regression
suite without an intervening smoke-test batch. No code change.

### Regression risk

- B1: a small number of MDC §2 cells may flip from `[PASS]` to
  `[REVIEW] -- Caída AC` on projects where OCPD failed but Vdrop
  passed. Correct behavior — pre-patch was masking a real review case.
- All other bug fixes are textual or non-functional.
- Install cost sanity is purely additive. No computed cost changes.

### Test gains

- Harness baseline 218 PASS / 0 FAIL → **241 PASS / 0 FAIL** after this
  release (+23 unit tests). The 36 workbook-dependent test ERRORs are
  now correctly classified by the harness gate; they continue to run
  from the ARGIA menu in a real workbook.

---

## [3.5.0] — 2026-05-26

Chunk 7 of the output-v2 migration. Lands CFE_OUTPUT_v2 alongside the
legacy CFE_OUTPUT. **No legacy recalc** — legacy CFE_OUTPUT continues
rendering unchanged; v2 is parallel and additive.

### Added — Chunk 7 (CFE_OUTPUT_v2)

- New file `templates/setupCfeOutputTemplate.js`: strict template/writer
  split (matches chunks 4/5 pattern). Owns:
  - 16-column canvas + hidden gridlines
  - Banner: logo at (2, 1), title at (2, 3), subtitle at (3, 3) —
    matches the v2 banner convention from chunks 2-6
  - Header strip labels (rows 5-8, cols B and H)
  - KPI strip row height (row 10)
  - Section 1 (Con PV) header at row 12, month header at row 13,
    static col-B labels for rows 14-20
  - Section 2 (Con PV + BESS) header at row 22, month header at row 23,
    static col-B labels for rows 24-31
  - Annual footer header at row 33 + cascade label blocks at row 34
  - Frozen rows = 10 (banner + KPI strip stays visible on scroll)
  - **Image cleanup on refresh** — calls `sh.getImages().forEach(img.remove)`
    to prevent the stacked-logo issue observed with chunk 6 RFQs
- New file `writers_v2/WriteCfeOutputV2.js`: data writer. Entry points:
  - `writeCfeOutputV2(ss, hourlySim)` — engine entry, called from
    Step 13.5-v2. When `hourlySim` is provided AND not `.blocked`, the
    BDF-5 hourly addendum is appended (rows 45-64 by default): hourly
    engine summary (Sin PV / Con PV+BESS / Ahorro), bill components
    breakdown (11 line items: Capacidad through Facturación TOTAL),
    provenance line, and optional warnings line. R1 fallback (energy +
    demand split with a "rate data missing" note) renders when
    `hourlySim.annual.fullBill` is absent. Ported verbatim from legacy
    `_cfeOutWriteHourlySimAddendum` (lines 966-1057 of
    `06_WriteCfeOutput.js`) — same data sources, labels, colors.
  - `runUpdateCfeOutputV2()` — menu entry. Passes `null` for hourlySim,
    so menu-triggered refreshes skip the BDF-5 block.
- New file `writers_v2/helpers/CfeOutputSourceMap.js`:
  - `CFE_OUT_SRC_V2` — source cell map (verbatim copy of legacy
    `CFE_OUT_SRC`; v2 must not import legacy symbols)
  - `readCfeScalar(ss, key)` / `readCfeMonthly(ss, key)` — read helpers
  - `CFE_OUT_MONTHS_V2` — Ene..Dic labels
- 3 test files (34 tests, 292 assertions, all green via Node shim)

### Changed

- `00_Main.js`:
  - Added menu item "Update CFE_OUTPUT v2" right after legacy "Update
    CFE_OUTPUT"
  - Added menu item "Generate RFQs v2" right after legacy "Generate RFQs"
    (carry-forward from chunk 6, which was never landed in this branch)
  - Added engine **Step 13.5-v2** immediately after legacy Step 13.5:
    parallel v2 writer call, same try/catch isolation pattern
- `templates/ActiveChunk.js`: `ACTIVE_CHUNK_TAG` → `chunk7` (skips
  through `chunk6` which was never landed)
- `00a_Version.js`: `ENGINE_VERSION` `3.3.0` → `3.5.0` (jumps through
  3.4.0 which carries chunk-6 release notes inline)

### Architecture notes

- **Strict template/writer split** chosen over the pragmatic approach.
  Template = layout only; writer = data only. Matches chunks 4/5.
- **NO charts.** Legacy chart code was disabled in BDF-11 (the
  `_cfeOutBuildCharts` function still exists but the call site is
  commented out — see lines 320-329 of `06_WriteCfeOutput.js`). v2
  does not migrate the dead chart code.
- **BDF-5 hourly addendum and bill components block ARE migrated.**
  Initial chunk-7 design dropped these as designer-facing, but verifying
  side-by-side against legacy in the live workbook showed they're
  needed in v2 too. Ported verbatim from
  `_cfeOutWriteHourlySimAddendum`: same data sources
  (`hourlySim.annual`, `.baseline`, `.savingsMxn`, `.annual.fullBill`,
  `.provenance`, `.warnings`), same labels, same colors. Positioning
  uses `getLastRow()+3` (matches legacy) so the block lands right after
  whatever was last rendered — Y1SS at row 42 or the footer at row 35.
- **Engine-wired AND menu** — per user decision. Engine call runs every
  `runArgiaEngine()`; menu call lets designers update CFE_OUTPUT_v2 on
  demand without rerunning the full engine.
- **Sheet positioning** — CFE_OUTPUT_v2 is inserted immediately BEFORE
  MDC_v2 in the tab order if MDC_v2 exists. Falls back to append if
  MDC_v2 is missing (e.g. chunk 2 hasn't run on this workbook).
- v2 reads from `INPUT_CFE`, `CFE_SIMULATION`, `BESS_SIMULATION` — the
  same upstream sheets legacy reads from. These are not v2-renamed; they
  are owned by other modules.
- No legacy CFE_OUTPUT code is touched. `06_WriteCfeOutput.js`,
  `CFE_OUT_SRC`, `CFE_OUT_ROW`, `_cfeOutReadScalar`, `_cfeOutReadMonthly`,
  `_cfeOutWriteHeaderStrip`, `_cfeOutWriteKpiStrip`, `_cfeOutWriteSection1`,
  `_cfeOutWriteSection2`, `_cfeOutWriteFooter`, `_cfeOutWriteYear1SteadySection`,
  `setupCfeOutput` (menu entry) all remain untouched.

### Verification status

- ✅ All source files: `node --check` clean
- ✅ 34 unit tests / 292 assertions green via Node shim
- ⚠️ Visual verification on real spreadsheet: PENDING (run engine, then
  compare CFE_OUTPUT_v2 side-by-side with legacy CFE_OUTPUT)
- ⚠️ Y1SS section visual: PENDING (only renders if BESS steady-state
  setup tool has been run on the workbook)
- ⚠️ KPI tile 3 rich-text rendering: PENDING (rich text mocked in tests)

---

## [3.4.0] — 2026-05-26

Chunk 6 of the output-v2 migration. Lands RFQs_v2: six parallel v2 RFQ
sheets generated on demand via a new menu item. **No legacy recalc** —
legacy RFQs continue working via the existing "Generate RFQs" menu item.
**Note:** this version entry covers code that may not have been landed
in the main branch; the chunk 7 release picks up its files.

### Added — Chunk 6 (RFQs_v2)

- Six v2 RFQ sheets: `RFQ_PANELES_v2`, `RFQ_INVERSORES_v2`,
  `RFQ_ESTRUCTURA_v2`, `RFQ_ELECTRICO_v2` (includes BESS electrical BOS),
  `RFQ_MONITOREO_v2`, `RFQ_BESS_v2` (NEW — no legacy counterpart).
- Files: `templates/RfqRegistry.js`, `templates/setupRfqTemplate.js`,
  `writers_v2/WriteRfqV2.js`, `writers_v2/helpers/RfqBomReader.js`, plus
  4 test files (36 tests, 248 assertions, all green).
- Menu item "Generate RFQs v2" calls `runWriteAllRfqsV2`. Not wired into
  engine — menu-only.
- BESS row split: battery (row 80) + commissioning (row 91) → RFQ_BESS_v2;
  electrical BOS (rows 81-90) → RFQ_ELECTRICO_v2.

### Architecture notes

- v2 reads from BOM_v2 (not legacy BOM). RFQ year stamped from
  `_META!B6` (calculated_at).
- Banner convention: logo at (2, 1), title at (2, 3). Title-bar dark
  styling dropped; matches BOM_v2 / MDC_v2 / INSTALLATION_v2.
- Known limitation: floating-image cleanup not implemented in chunk 6.
  Re-running "Generate RFQs v2" without first deleting the v2 RFQ sheets
  stacks logos. Chunk 7 fixes this for CFE_OUTPUT_v2 via
  `_cfeOutV2_removeImages` and the same pattern should be retrofitted
  to other v2 templates in a follow-up chunk.

---

## [3.3.0] — 2026-05-25

Chunk 5 of the output-v2 migration. Lands INSTALLATION_v2 alongside the
legacy INSTALLATION, plus the v2 audit sheet 95_INSTALL_DRIVER_MAP_v2.
**No legacy recalc** — legacy INSTALLATION continues writing unchanged;
v2 is parallel and additive.

### Added — Chunk 5 (INSTALLATION_v2)

- New file `templates/setupInstallationTemplate.js`: **beefy template** that
  seeds all the structural content the writer doesn't generate.
  Specifically:
  - Banner rows 1-3: ARGIA logo at A2, "INSTALACIÓN · MXN" title at C2,
    Spanish subtitle at C3. Mirrors legacy `addInstallationBanner`.
  - Row 4 panel headers: "DRIVER / INPUT | VALUE | NOTES" in A4-C4 plus
    "SUMMARY | =G9" in F4-G4. G4 is a formula mirror of the grand total.
  - 30 driver-key labels in col A rows 5-34, in legacy order:
    PROJECT_DC_WP..WORK_HEIGHT_M (engine drivers, rows 5-23),
    INSTALLATION_TYPE..WEATHER_PROFILE (factor selections, rows 24-31),
    BLENDED_LABOR_RATE_MXN_MH (row 32),
    CONTINGENCY_PCT + INSURANCE_PCT_ON_LABOR_EQUIP (rows 33-34).
  - NOTES helper text in col C rows 5-34, verbatim from legacy screenshot
    ("Link from engine", "Estimator input", "Dropdown", "Reference only",
    "Override allowed", etc).
  - Data-validation dropdowns on rows 24-31 col B. Allowed-values lists
    sourced from `02c_InputMap.js` (single source of truth). Defaults
    pre-populated (ROOF, MEDIUM, STANDARD, NO, LOCAL, NO, MEDIUM, DRY).
  - Percent-format `0.00%` + defaults (0.05 / 0.03) on rows 33-34.
  - Currency `"$"#,##0` formatting on summary block + section grid.
  - Cream/grey palette mirroring legacy `restyleInstallationTopZone`.
  - Frozen rows = 3, hidden gridlines.
- New file `writers_v2/WriteInstallationV2.js`: data writer with two
  exports — `writeInstallationV2(ss, result, drivers, _testOpts)` for the
  main INSTALLATION_v2 sheet, and `writeInstallationDriverMapV2(ss, drivers,
  result, _testOpts)` for the audit sheet 95_INSTALL_DRIVER_MAP_v2. Mirrors
  the legacy `writeInstallCost` calculation outputs byte-for-byte. Writer
  does NOT touch col A or col C in the driver block (template's job).
  Writer populates col B values for all 30 driver rows including factor
  selections (sourced from `drivers.factorSelections`) and percent rows.
  Currency formatting applied to summary, section grid, MH breakdown, and
  line-item zone.
- `templates/TemplateRegistry.js`: added `V2_SHEETS.INSTALL_DRIVER_MAP
  = '95_INSTALL_DRIVER_MAP_v2'` so Reset Outputs (Chunk 12) can find the
  v2 audit sheet.
- `00_Main.js`: Step 12 captures `var installResult = runInstallCost(...)`
  return value. Step 12-v2 added after Step 12, wrapped in `try/catch`.
  Wires `setupInstallationTemplate(ss)` + `writeInstallationV2(...)` +
  `writeInstallationDriverMapV2(...)`.
- `13_CalcInstallCost.js`: tiny additive edit to `runInstallCost` —
  attaches `result.drivers = drivers` before return. Lets Step 12-v2
  reuse both without re-running calc layers. Backward-compatible.

### Why "beefy template" instead of "thin shell"

Original chunk 5 plan answered Q4 "writer does ALL formatting" and used a
thin template that only ensured the sheet existed. First user run revealed
visual gaps: no banner, no NOTES column, no dropdowns, no currency
formatting, only 24 of 30 driver-block rows populated. Root cause: the
legacy INSTALLATION sheet's structure comes from THREE sources —
`addInstallationBanner` (banner), `restyleInstallationTopZone` (palette +
formatting), and **manual hand-entry** (col A labels, col C NOTES,
dropdowns — none of which any code generates). The writer was a verbatim
port of `writeInstallCost`, which faithfully populates values onto an
already-existing hand-built structure. v2 has no hand-built structure;
the template now generates everything legacy assumed pre-existed.

### Parity quirks preserved

- Dropdowns on INSTALLATION_v2 rows 24-31 are display-only mirrors. Engine
  reads selections from INPUT_INSTALL, not from this sheet. Editing the
  dropdowns has no effect on the next engine run. Same behavior as legacy.
- 95_INSTALL_DRIVER_MAP_v2 graceful no-op when sheet missing — matches
  legacy `if (!sh) return`. Sheet structure not seeded by v2; comes from
  IMPORTRANGE or manual setup, same as legacy.
- G4 mirrors G9 via formula `=G9` (auto-updating grand-total banner). The
  legacy sheet's screenshot showed a stale "$242,159" manual entry there —
  v2 replaces it with a live formula. If strict-legacy behavior (leave G4
  blank) is wanted, raise it.

### BESS color forward-compatible addition

- Legacy `SEC_HDR_BG`/`SEC_ITEM_BG`/`SEC_SUB_BG` palettes don't list a
  BESS entry, so BESS lines render with grey fallback.
- v2 explicitly adds BESS palette entries with deep purple
  (`#311B92` / `#EDE7F6` / `#D1C4E9`) for visual distinction from INDIRECT.
- Flag for visual review before cutover (Chunk 11).

### Tests — Chunk 5

- 12 template tests: sheet creation + idempotency, custom-sheet override,
  banner content, A4-C4 panel headers, F4-G4 SUMMARY + =G9 formula,
  30 driver-key labels in col A, NOTES helper text in col C, 8 dropdowns
  on rows 24-31 with allowed-values from InputMap, dropdown defaults
  pre-populated, percent rows format + defaults, frozen rows = 3,
  setHiddenGridlines.
- 16 writer tests: throws-on-missing-sheet, driver values rows 5-23,
  factor selections rows 24-31, BLENDED_LABOR_RATE row 32, percent rows
  33-34 (decimal), summary block, section grid, MH breakdown, line-item
  zone, zero-cost row styling, grand total, legend, driver-map no-op,
  driver-map updates, null result handling, writer does NOT write col A
  labels in driver block.
- All 28 unit tests pass via `node scripts/chunk5_selftest.js`.

---

## [3.2.0] — 2026-05-25

Chunk 4 of the output-v2 migration. Lands BOM_v2 alongside the legacy
BOM. **No legacy recalc** — legacy BOM continues writing unchanged; v2
is parallel and additive.

### Added — Chunk 4 (BOM_v2)

- New file `writers_v2/helpers/BomDbHelpers.js`: namespaced `_bomV2_*`
  port of every DB-lookup helper from legacy `08_WriteBOM.js`
  (`loadBosDb`, `loadStructureDb`, `resolveStructure`, `bosPriceObj`,
  `conductorPriceObj`, `groundPriceObj`, `conduitPriceObj`,
  `breakerILinePriceObj`, `breakerPriceWithFallback`,
  `panelboardPriceObj`, `transformerPriceObj`, `mc4PriceObj`,
  `monitoringPriceObj`, `meterPriceObj`, `ladderTrayPriceObj`, and their
  `*PriceMxn` thin wrappers). Verbatim port — every function returns
  byte-identical values to the legacy helper for the same inputs. No
  shared writer code with legacy per the plan §2.
- New file `templates/setupBomTemplate.js`: idempotent template that
  builds the BOM_v2 sheet with banner, project meta row, column header
  row, exchange-rate row, 8 pre-styled section header bands, 8 pre-styled
  subtotal rows, and the grand total band. Owns all formatting (column
  widths, row heights, number formats, alignment, fonts, borders, freeze).
  Pure setup — never touches data.
- New file `writers_v2/WriteBomV2.js`: data writer that fills BOM_v2 at
  the fixed rows defined in `BOM_ROW`. Mirrors legacy `08_WriteBOM.js`
  section-by-section across all 8 sections (panels / inverters /
  structure / DC / AC / transformer / monitoring / BESS) plus grand
  total. Same wp() / ws() helper signatures, same formula shapes, same
  cell-note text.
- New §8 BESS handling in BOM_v2 (preserves legacy parity):
  - PV-only or BoS-blocked → single "Sistema BESS — pendiente"
    explanatory line at BESS_BATTERY_LINE.
  - BESS-enabled → maps BESS-01..BESS-12 codes to fixed rows
    (BESS_BATTERY_LINE through BESS_COMMISSIONING). Price resolution
    dispatches by productCategory: BESS_BATTERY → `lookupBatteryUnitPrice`
    (shared infra), COMMISSIONING → `productSpec.flatPriceMxn`,
    CONDUCTORS/CONDUIT/DISTRIBUTION → `_bomV2_resolveBessBosPrice` in the
    same file (verbatim port of legacy `_resolveBessBosPrice`).
- Step 11-v2 wired into `runArgiaEngine` after Step 11. Calls
  `setupBomTemplate(ss)` then `writeBomV2(...)`, wrapped in its own
  try/catch matching Step 10-v2 (MDC) and Step 13-v2 (PC) pattern. A v2
  bug never breaks the legacy pipeline.

### Removed in v2

- The §8 BESS row reset block from legacy `08_WriteBOM.js`
  (lines 936–991, ~55 lines of layout cleanup). In legacy it was
  necessary because the template didn't own row heights / backgrounds /
  alignment on §8 rows, so the writer had to normalize them every run.
  v2 template applies the right styles from the start, so the reset
  block isn't needed.

### Tests

- `tests_unit/writers_v2/BomDbHelpersTests.gs` — 8 unit tests for the
  `_bomV2_*` helpers covering BOS lookup, conductor cascade
  (THHW → PV WIRE), conduit size→label mapping + DE-pattern matching,
  breaker fallback (exact → next-size cascade → null+note),
  panelboard smallest-fit selection, structure resolver's 3 paths
  (STR_ID tail / brand+model / model-only), and BOS_CURRENCY=USD flag.
- `tests_unit/templates/BomTemplateTests.gs` — 6 unit tests for the
  template covering sheet creation, 8 column header values at row 5,
  column widths, section/subtotal/grand-total row heights, idempotency
  (clear() count 0→1 across two calls), and `opts.sheetName` override.
- `tests_unit/writers_v2/WriteBomV2Tests.gs` — 12 unit tests for the
  writer covering all 8 sections, the "throw when sheet missing" path,
  trayM>0 swap to ladder-tray rows, customer-supplied vs Argia-supplied
  transformer variant, PV-only vs BESS-enabled §8 behavior, and the
  GRAND_TOTAL formula referencing all 8 subtotals.
- ACTIVE_CHUNK_TAG bumped to `chunk4` so the "Run Tests for Current
  Chunk" menu item picks up exactly the 26 new tests.

### Parity quirks (called out for cleanup post-cutover)

Two legacy code paths dispatch BOS prices as USD without checking
`isUsd` — DC PV WIRE cable (line 693 in legacy) and AC main breaker
(line 790 in legacy). Both happen to work in practice because the BOS
DB MXN prices are passed-through as numbers and the line totals are
computed with `=C*E` and `=F*$F$EXCHANGE_RATE`, so the math reconciles.
v2 mirrors this verbatim for parity. Marked as "legacy parity quirk" in
the new writer tests so post-cutover cleanup is straightforward.

---

## [3.1.0] — 2026-05-25

Chunk 3 of the output-v2 migration. Lands PROJECT_CARD_v2 alongside the
legacy PROJECT_CARD. **No legacy recalc** — legacy PC continues writing
unchanged; v2 is parallel and additive.

### Added — Chunk 3 (PROJECT_CARD_v2)

- New file `templates/setupProjectCardTemplate.js`: idempotent template
  that builds the PROJECT_CARD_v2 sheet with section bands, fixed-row
  labels, and the 10-column cost-comparison layout. Pure setup — never
  touches data.
- New file `writers_v2/WriteProjectCardV2.js`: data writer that fills
  PROJECT_CARD_v2 at the fixed rows defined in `PC_ROW`. Reads from legacy
  BOM and INSTALLATION sheets (BOM_v2 / INSTALLATION_v2 ship later) so
  numeric parity with legacy PC is preserved.
- New BESS visibility in PC_v2 (three additions over legacy PC):
  - **Cost Comparison gains a 9th row** "Almacenamiento (BESS)" pulling
    USD/MXN from `BOM!SUBTOTAL_BESS` (row 92). PV-only projects render
    em-dash in the BESS row; the row remains in layout for visual consistency.
  - **Scope of Work gains a battery line** when bessEnabled, formatted as
    `<batteryId> — <stackQty> stack(s) (<kWh> kWh nominal)`. Falls back to
    "Battery storage system" when `batteryId === 'CUSTOM_MANUAL'`.
  - **Additional Information gains "Storage"** row showing nominal kWh
    capacity. Shows em-dash when bessEnabled is false.
- New PC_ROW + PC_COL constants in `00_Main.js` lock the PC_v2 layout so
  template and writer share row addresses (the architectural change that
  makes v2 cleanly testable).
- New `costRangeBessMin` / `costRangeBessMax` entries in `_MAP_PROJECT`
  (row 61 of INPUT_PROJECT, cols D/E). Unit is **USD/kWh nominal** —
  defaults **$350–$650**, calibrated from four real BAAS proposals in
  `/mnt/project`:
  - Autoplastek Puebla: 645 kWh / $5.42M MXN → $461/kWh USD
  - Draxlmaier: 10,000 kWh / $69.36M MXN → $381/kWh USD
  - Taigene León: 1,505 kWh / $10.54M MXN → $385/kWh USD
  - Culligan: 1,075 kWh / $11.33M MXN → $579/kWh USD
  Observed range $381–$579; envelope widened ~10% each side.
- Engine integration as new **Step 13-v2** in `runArgiaEngine()`,
  wrapped in try/catch matching Step 10-v2 (MDC_v2) — a v2 bug never
  breaks the legacy pipeline.
- `ACTIVE_CHUNK_TAG` bumped to `'chunk3'`.

### Tests — Chunk 3

- New file `tests_unit/writers_v2/WriteProjectCardV2Tests.gs`: 10 unit
  tests covering value writes per row, BESS visibility logic, validation
  PASS/FAIL boundaries, scope-of-work formatting, and margin derivation.
- New file `tests_unit/templates/ProjectCardTemplateTests.gs`: 5 tests
  for template invariants (sheet exists, idempotency, section headers
  at correct rows, all 9 cost-row labels present including BESS).

### Notes

- PC_v2 selling price `USD/Wp` denominator is **PV `dcKwp`** only, not
  PV-plus-BESS equivalent. $/Wp is an industry PV metric; the BESS
  portion shows separately in the cost table.
- Gross profit formula unchanged from legacy semantics — it operates on
  the TOTAL row, which now naturally includes BESS subtotal when
  bessEnabled.
- No menu entry yet — PC_v2 is generated only as part of the full engine
  run. A standalone "Generate PC v2" menu entry can land in Chunk 11
  (cutover) when v2 becomes source of truth.

---

## [3.0.0] — 2026-05-24

Catch-up release covering chunks BDF-7 through BDF-11.1. This is the first
GitHub commit since pre-BDF-7 work. Several months of engine development
are condensed into this single release. Going forward, each BDF chunk gets
its own commit.

**MAJOR bump** because BDF-11 corrected four CFE Capacidad math bugs.
Existing project workbooks WILL recalculate to different numbers after
running the included repair tools. For CULLIGAN-style projects, year-1
BESS Capacidad savings drop from ~$1.49M to ~$498K, and steady-state
savings rise to ~$3.71M. See "Migration" section below.

### Added — BDF-11.1 (Year-1 vs Steady-State visualization)

- New file `02i_SetupBessSimulationSteady.js`: idempotent setup tool that
  extends BESS_SIMULATION with rows 43-48 computing steady-state Capacidad
  savings (year 2+ after CFE's 12-month rolling demand window decays).
- `06_WriteCfeOutput.js`: CFE_OUTPUT now renders both Año 1 and Año 2+
  numbers in the headline KPI tile (when steady-state data exists), plus a
  new comparison section at rows 37-42 with green/red diff coloring and an
  explanatory note.
- Menu entry: ARGIA → Setup → "Setup BESS Steady-state (BDF-11.1)".
- New cell map entries `bsim_ahorroCapSteadyAnnual` and `bsim_reciboFinalSteady`.

### Added — BDF-11 (CFE Capacidad math bug fixes)

- New file `02h_RepairCfeSimulationCapacidad.js`: idempotent, label-asserted
  repair tool that fixes CFE_SIMULATION rows 18 and 23, plus BESS_SIMULATION
  row 30, in existing project workbooks. Safe regex-based substitution
  handles both plain and ARRAYFORMULA-wrapped formula shapes. Skips with
  diagnostic if formula doesn't match expected pattern.
- New file `tests_unit/calc/CalcBdf11Tests.gs`: 5 unit tests (41 assertions)
  validating all four bug fixes against 12 real CULLIGAN CFE bills.
- Menu entry: ARGIA → Setup → "Repair CFE_SIM Capacidad (BDF-11)".

### Fixed — BDF-11

Four CFE math bugs validated against 12 real CULLIGAN bills (GDMTH GOLFO
NORTE, May 2025 - Apr 2026):

1. **CFE_SIMULATION row 23 Capacidad formula** — was multiplying by C18
   (kWMaxAñoMovil) instead of C21 (Demanda Facturable). CFE charges Capacidad
   on `MAX(kW_punta, 0.7 × movil)`, not on movil itself. Fix: `C23 = C21 × rate`.
   Bills now match to the cent across all 12 months.

2. **CFE_SIMULATION row 18 kWMaxAñoMovil** — was synthesizing from
   `ROUNDUP(SUM(kWh)/24/loadFactor)` giving values 23-76% off reality. Fix:
   `=MAX(MAX(INPUT_CFE!C13:N15), MAX(INPUT_CFE!C16:N16))` — Option B (rolling
   max of all kW data) with safety net (period kWMax from bills) to handle
   partial-data scenarios. Same global value for every month (CFE's window
   is global, not per-month).

3. **Hourly synth (`20_CalcHourlySimulation.js`) ignored BESS effect on
   Capacidad** — `components.capacidad[bm]` used pre-BESS demanda facturable
   even after BESS shaved the punta peak. Fix: when battery is configured
   AND month had real discharge AND movil is supplied, compute Capacidad two
   ways:
   - **Year 1**: `MAX(post_BESS_punta, 0.7 × movil)` (rolling max still loaded)
   - **Steady**: `MAX(post_BESS_punta, 0.7 × post_BESS_punta)` (rolling decayed)
   - Post-BESS punta derived arithmetically from bill's kW_punta minus battery
     shave capability (mirrors `calcPeakShavingImpact` model). Critically does
     NOT use simulator's energy-averaged peak (which is structurally lower
     than measured bill peak even without BESS).
   - Exposes new output fields: `components.capacidadSteady[12]`,
     `components.facturacionSteady[12]`, `annualFacturacionSteadyMxn`,
     `kWMaxAnoMovilSource`.

4. **BESS_SIMULATION row 30 chain** — falls out of bugs #1 and #2. C30
   formula now uses `C23/C21` (correct rate) instead of `C23/C18` (which only
   worked when C23 was buggy). Updated by the repair tool above.

### Fixed — BDF-11.1 (visual polish)

- BOM rows 80-91 (§8 BESS line items): full per-column formatting
  normalization (alignment, font color, vertical alignment, font size, wrap)
  so all 12 line items render with consistent style. Previously rows 81-91
  inherited template formatting inconsistencies that made the section look
  uneven vs row 80.
- CFE_OUTPUT KPI tiles in row 10 use 15pt font (was inconsistent mix of
  22pt and 13pt). Three tiles now visually consistent.
- CFE_OUTPUT month columns C-N widened 50% (75 → 113px), column O totals
  90 → 135px. Resolves cascade row value truncation.
- CFE_OUTPUT charts removed (call to `_cfeOutBuildCharts()` commented out).
  Functions kept for backward compat but no longer rendered — data tables
  alone tell the story per designer feedback.

### Changed — BDF-11 (regression test fix)

- `tests_regression/sheet_formulas/BessSimulationFormulasTests.gs` test #6
  fixed to derive Capacidad rate from `C21` instead of `C18`. Previous test
  was a structural tautology — it derived the rate from the same buggy
  formula it was supposed to validate, so it passed even when the bug was
  present. Now correctly validates against true CFE rates.

### Added — Earlier chunks (BDF-7 through BDF-10)

Several months of BESS-related engine work landing in this catch-up:

- **BDF-7 / BDF-7.1**: BESS BoS line items in BOM §8, NOM compliance checks
  (`24_CalcBessNomChecks.js`), BoS quantity calculation
  (`22_CalcBessBosQuantities.js`), voltage drop (`23_CalcBessVoltageDrop.js`).
- **BDF-8**: BOM §8 visual normalization (row heights, description wrap,
  notes for engineering detail).
- **BDF-9**: Real price resolution for BESS BoS items via PV-side helpers;
  background/font reset on §8 rows.
- **BDF-10**: BESS battery price lookup with CAPEX fallback, dropped §8 row
  heights from 26 to 22px to match PV side.
- **BESS picker / recommendations**: New files `19_RunBessSuggestion.js`,
  `19b_WriteBessRecommendations.js`, `21_BessPickerWiring.js` for the BESS
  size-recommendation feature.
- **Hourly simulation v1**: `20_CalcHourlySimulation.js` + runner
  `20a_RunHourlySimulation.js` — 8760-hour engine producing comparison
  numbers in CFE_OUTPUT footer.
- **Test infrastructure**: New unit test files for BDF-7.1/8/9/10/11, BESS
  BoS quantities, hourly simulation. Tagged so the test runner can filter
  per chunk.

### In Progress — v2 architecture (not yet customer-facing)

The following are committed in this release but not yet wired into the
production engine pipeline. They represent ongoing work toward a v2
output architecture. Safe to ignore from a customer/designer standpoint;
running the standard engine does not exercise this code.

- `templates/` directory: template generation system
- `writers_v2/` directory: next-gen output writers
- `tests_unit/templates/`, `tests_unit/wiring/`, `tests_unit/writers_v2/`,
  `tests_integration/templates/`, `tests_integration/writers_v2/`,
  `tests_regression/v2/`: corresponding tests
- `OUTPUT_V2_MIGRATION_PLAN.md`: design doc (932-line expansion in this
  release documenting the v2 plan)

Future BDF chunks will wire these in incrementally. Until then, they sit
alongside the production code as parallel scaffolding.

### Migration — IMPORTANT

For each existing project workbook (pre-3.0.0):

1. Open the workbook.
2. ARGIA menu → Setup → **Repair CFE_SIM Capacidad (BDF-11)** → confirm
   dialog reports all 36 cells written (12 in row 18, 12 in row 23, 12 in
   BESS_SIM row 30). If any cells skip with "label mismatch" or "unparseable
   formula", do not proceed — file an issue.
3. ARGIA menu → Setup → **Setup BESS Steady-state (BDF-11.1)** → confirm
   dialog reports rows 43-48 written. Skips safely if rows have non-empty,
   non-marker content.
4. Re-run the engine (regenerate proposal). CFE_OUTPUT will show new numbers.
5. **Commercial review required**: headline savings on CULLIGAN-style projects
   shift by $1M+. Re-quote any active client whose proposal cited BESS
   Capacidad savings before re-issuing.

Both repair tools are idempotent — safe to re-run.

### Commercial impact reference (CULLIGAN, full year)

| Number | Before (buggy) | Year-1 (correct) | Steady (correct) |
|---|---:|---:|---:|
| Recibo CFE final con PV + BESS | $8,679,205 | $9,958,158 (+$1.28M) | $6,700,921 (-$1.98M) |
| BESS Capacidad savings (annual) | $1,488,320 | $498,618 | $3,708,058 |
| Total annual savings vs Sin PV | $4,734,176 | $3,744,475 | $7,001,712 |

These are pre-BDF-11 vs post-BDF-11 numbers for one specific project; magnitude
will vary by project but direction (year-1 down, steady-state up) is universal.

### Known limitations

- Template setup function is NOT updated by BDF-11. New projects created
  after this release will still have the buggy formulas until the repair
  tool is run on them. Updating the template is deferred to a future chunk.
- Distribución and Variable savings: BDF-11 did not analyze whether these
  have year-1 vs steady-state differences. Steady-state row 48 in
  BESS_SIMULATION uses year-1 values for Distribución and Variable. Deferred.
- GDMTO tariff Capacidad formula not audited for parallel bugs (different
  structure based on demanda contratada). Out of BDF-11 scope.
- Blackout value feature deferred to future chunk.
- Time-shifting and hybrid BESS strategies deferred to future chunk.

---

## [pre-3.0.0] — prior to 2026-05-24

Pre-history before this changelog was created. Engine versions 2.0.0
through 2.3.5 shipped without per-version notes. The catch-up release at
3.0.0 above covers everything from BDF-7 onward.
