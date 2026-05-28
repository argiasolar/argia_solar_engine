Chunk 5 — Proper BESS Strategy: Architecture \& Plan

Status going in: v4.0.0 shipped. Dispatcher is strategy-aware in the hourly sim, but customer-facing CFE\_OUTPUT section 2 still reads formula-driven BESS\_SIMULATION (peak-shaving only). PEAK\_SHAVING and LOAD\_SHIFTING produce identical section-2 numbers in the workbook. Fixing that properly requires real work — not patches.



The honest problem statement

Three architectural truths we confirmed in v4.0.0:



The customer numbers come from BESS\_SIMULATION (in-cell formulas), not from the hourly sim. The hourly sim's strategy-aware dispatch never reaches CFE\_OUTPUT section 2.

The formula sheet cannot resolve intraday PV surplus. Monthly aggregates can't tell the difference between "solar at noon while load is high" and "solar evenly distributed." So the formula sheet structurally can't distinguish strategies for energy arbitrage.

The hourly dispatcher is greedy single-hour. It can't reason about non-local effects (today's charging decision affects this month's billed demand peak). Adding a peak cap creates real conflicts: too tight = forbids arbitrage in PV-poor sites; too loose = manufactures phantom peaks in solar-rich sites.



The fix needs both: a smarter dispatcher and the wiring to surface its numbers to the customer.



The design (monthly-budget allocator)

Replace the per-hour greedy dispatcher with a two-level approach:

Level 1 — Monthly budget planner (NEW)

Given each month's PV shape, load shape, rate spread, RTE, battery capacity/power, and existing demand peak ceiling, compute:



Daily charge budget (kWh) split into PV-charged and grid-charged components

Per-hour charge schedule across base hours, capped so base import never exceeds the existing demand ceiling

Per-hour discharge schedule placing kWh in punta hours (then intermedia if budget remains)

Honor max 1 cycle/day total and RTE losses



Level 2 — Per-hour executor (REPLACES current \_bessDispatchHour)

Walks 8760 hours but consults the precomputed schedule from Level 1 rather than greedy-deciding hour by hour. Per-hour function becomes: "is this hour scheduled for charge X kWh / discharge Y kWh? Execute respecting SoC bounds."

This shape solves all the problems greedy can't:



Demand-peak interactions (Level 1 knows the ceiling and budgets within it)

Bootstrap (Level 1 explicitly funds grid charging when PV is insufficient)

Strategy differentiation (Level 1's allocation logic differs per strategy; Level 2 just executes)





Strategy semantics — what each does in Level 1



PEAK\_SHAVING — Allocate all daily discharge to punta hours. Charge budget = MIN(usable\_throughput, PV\_chargeable). No grid charging. PV-surplus-limited.

SELF\_CONSUMPTION\_MAX — Allocate discharge to highest-rate hours with residual import (punta first, intermedia second). Charge from PV surplus until SoC full. No grid charging. Functionally identical to PEAK\_SHAVING in evening-punta sites (documented convergence).

LOAD\_SHIFTING — Allocate full daily throughput to punta discharge. Charge from PV first, then grid-charge the gap in base hours, capped per-hour by demand ceiling headroom. Only active under NET\_BILLING with profitable spread.





Wiring CFE\_OUTPUT section 2 to the hourly sim

Once the dispatcher is trustworthy:



Run hourly sim three times per project: baseline (no PV, no BESS), PV-only (PV, no BESS), proposed (PV + BESS).

BESS-attributable per-tier savings = (PV-only bill tier) − (PV+BESS bill tier), per month, per tier (Capacidad / Distribución / Variable).

\_cfeOutV2\_fillSection2 reads from the hourly result instead of bsim\_\* cells when present, falls back to formula sheet otherwise.

Per-tier deltas floored at zero (a tier can't show negative "saving").





Concrete deliverables (in order)



Lock the spec before coding. Write expected behavior tables for 4 archetype projects:



CULLIGAN (864 kWp / 2169 kWh, solar-rich, GDMTH) — PS ≈ SC ≈ LS expected

DRAXLMAIER (mixed, real workbook in /mnt/project)

AUTOPLASTEK (mixed, real workbook in /mnt/project)

Synthetic PV-poor (small PV, big load) — LS should clearly beat PS

For each, write down what we expect each strategy to produce qualitatively before implementing.





Implement Level 1 monthly budget planner as a pure function (\_planMonthlyBessSchedule(monthCtx, strategy)). Pure function = aggressively unit-testable.

Implement Level 2 schedule executor replacing the body of the current hour loop's battery block. Same return shape, so writers downstream don't break.

Add PV-only third run in 20a\_RunHourlySimulation.js so BESS-attributable savings can be isolated.

Wire \_cfeOutV2\_fillSection2 to prefer hourly-sim per-tier deltas, fall back to formula cells.

Verify against the 4 archetype projects — run them, compare against pre-Chunk-5 numbers, document the deltas. CULLIGAN headline numbers must not move significantly (solar-rich = identical strategies).

Unit tests — budget planner per strategy (\~10 tests), executor (\~5 tests), section-2-from-hourly per-tier (already drafted in dropped Chunk 4b work, recoverable from this transcript). Target: 270+ harness PASS.

Update CULLIGAN regression baseline if numbers shift, with explicit changelog entry naming which tier moved and why.





Risk register \& honest constraints



Performance. 3 sim runs × 8760 hours × budget planner overhead may push runtime. Profile first; if slow, the planner can be once-per-month not once-per-day.

Hourly PV shape is still a placeholder (flat across 14 daylight hours in 20\_CalcHourlySimulation.js:537). The Chunk 5 dispatcher is only as accurate as that shape. Feeding real hourly PV from the PV calc step would be a separate, parallel improvement — flag it but don't block on it.

Demand-peak ceiling reference. What we backed away from in Chunk 4b: the right ceiling for grid-charging is the raw net-of-PV peak load, NOT a battery-adjusted peak. Lock this in spec before coding.

Convergence assertion stays. PEAK\_SHAVING ≈ SELF\_CONSUMPTION\_MAX in evening-punta sites is correct and asserted in existing tests. Chunk 5 must preserve this — if they diverge significantly after the rewrite, something's wrong.





What we do NOT do in Chunk 5



Don't touch the formula-driven BESS\_SIMULATION sheet. Leave it as the fallback path. Don't try to make it strategy-aware — it structurally can't.

Don't change INPUT\_BESS layout. Strategy stays at C7.

Don't expose new user-facing knobs. The complexity is internal.

Don't ship without 4-project verification. Numbers moving on real projects without a clear explanation is unacceptable.





Version

v5.0.0 (MAJOR — section-2 numbers change for any project where the dispatcher disagrees with the formula sheet, which is most non-solar-rich projects).



Estimated scope

3–4 focused sessions:



Session 1: spec lockdown + Level 1 budget planner + planner tests

Session 2: Level 2 executor + integration with hourly sim + harness green

Session 3: section-2 wiring + writer tests + first project verifications

Session 4: 4-project verification, regression baseline update, ship



Save this somewhere in the repo — docs/CHUNK\_5\_PLAN.md or similar — so when we pick it up next session we don't re-litigate the architecture.

