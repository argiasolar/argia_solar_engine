# Chunk 5 — Level 1 Monthly Budget Planner: Mechanism Paper

> Audience: tester / reviewer.
> Purpose: explain **exactly** what the planner does and why.
> Companion docs: `docs/CHUNK_5_PLAN.md` (architecture), `docs/CHUNK_5_SESSION1_SPEC.md`
> (locked contract), `docs/CHUNK_5_ROADMAP.md` (session breakdown).
> Status: **post-review, code-complete, 15/15 tests PASS.** Awaiting push.
>
> **Post-review deltas from the original paper** (round 3 sign-off):
> 1. Renamed `demandCeilingKw` → `planningDemandLimitKw` throughout.
>    Reflects the honest meaning: this is a planner guardrail, not a
>    physical constraint on the battery.
> 2. Added `meta.ledger.effectiveBatteryUtilizationPct` for sizing
>    conversations.
> 3. Replaced descriptive `prioritiesActive` / `prioritiesExecuted`
>    with structured `meta.priorityResults` where each priority records
>    `{ attempted, achieved, valueMxn }`.
> 4. Added `monthCtx.actualBilledDemandKw` — limit becomes
>    `max(synthetic, actualBilled)`. Data already exists in
>    `02_LoadDB.js`.
> 5. Added optional `monthCtx.wearCostMxnPerKwh` gating LS arbitrage.
>    Full wear-cost module lands in Session 2.
> 6. Added bell-curve PV utility `_planSyntheticPvBellShape`.
> 7. Tier hardcoded as `'SCREENING'`.
> Math itself is unchanged from the reviewed version.

---

## Part I — The problem we are trying to solve

### 1.1 What the engine does today

The engine produces a customer-facing CFE bill comparison in
`CFE_OUTPUT_v2 §2`. That comparison shows four cost tiers
("Cargo Variable", "Cargo Capacidad", "Cargo Distribución", "Bonificación
por Factor de Potencia"), in two columns: **Sin BESS** vs **Con BESS**.
The delta between the two columns is what the customer is being asked
to pay for.

Those numbers come from `BESS_SIMULATION`, a spreadsheet whose cells
are pure in-sheet formulas. The formulas compute the post-BESS bill by
applying a single rule: assume the battery shaves the demand peak by a
fixed kW and assume it shifts a fixed kWh from punta into base. That
rule has the convenient property of being purely monthly — no hourly
math needed — and the inconvenient property of being identical for
every BESS strategy. Whether the customer picked PEAK\_SHAVING,
SELF\_CONSUMPTION\_MAX, or LOAD\_SHIFTING, the formula sheet produces
the same numbers, because the formulas have no input that distinguishes
them.

### 1.2 What v4.0.0 added — and what's still missing

v4.0.0 (`74df071`) made the **hourly** dispatcher strategy-aware
(`_bessDispatchHour` in `20_CalcHourlySimulation.js`). The hourly sim
now produces different annual costs for the three strategies. This
shows up in the engine's internal `hourlyResult` object.

But `CFE_OUTPUT_v2 §2` doesn't read `hourlyResult`. It reads
`BESS_SIMULATION`. So the customer report is still strategy-blind.

This is the gap Chunk 5 closes.

### 1.3 Why we can't just plug the hourly sim into section 2

Two reasons.

**Reason A: the current hourly dispatcher is greedy.** It decides each
hour in isolation. That works for some cases but breaks for the most
economically interesting one: LOAD\_SHIFTING in a PV-poor site. Greedy
LOAD\_SHIFTING wants to charge from the grid in base hours, but greedy
single-hour logic has no way to know how much charging is "enough" for
the punta window later in the day. It either over-charges (manufacturing
a phantom demand peak by stacking grid-charge on top of high base load)
or under-charges (running out of stored energy two hours into punta).

**Reason B: the current dispatcher has no notion of a demand-peak
ceiling.** CFE bills the customer on the highest 15-min interval each
month. A naive dispatcher could solve a single hour optimally and
*create* the worst hour of the month in doing so. The hourly sim
doesn't see that — it bills demand at the end, retrospectively.

So Chunk 5 has to do two things at once: (a) build a smarter
dispatcher, and (b) wire the dispatcher's output into the customer
report. This paper covers (a).

---

## Part II — The two-level architecture

### 2.1 The split

```
┌─────────────────────────────────────────────────────────────┐
│  LEVEL 1: Monthly Budget Planner                            │
│  ─────────────────────────────                              │
│  Input  : one month of typical-day shapes (load, PV, rates) │
│  Output : a 24-hour schedule of {charge, gridCharge,        │
│           discharge} that respects every constraint         │
│  Property: PURE FUNCTION. No engine access, no side effects │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼  (schedule passed by reference)
┌─────────────────────────────────────────────────────────────┐
│  LEVEL 2: Per-Hour Executor (Session 2, not Session 1)      │
│  ─────────────────────────                                  │
│  Input  : the schedule + actual SoC                         │
│  Output : per-hour battery action, respecting real SoC      │
│           drift (e.g. weekend load was lighter, battery     │
│           ended yesterday fuller than expected)             │
└─────────────────────────────────────────────────────────────┘
```

Level 1 is what Session 1 ships. Level 2 happens in Session 2.

### 2.2 Why this split

Three reasons to plan a month ahead instead of deciding hour by hour:

1. **Demand peak**. To avoid creating a new monthly peak via grid
   charging, the planner needs to know what the existing peak is. A
   greedy hour can't know that.
2. **Daily charge budget**. "Cycle the battery once per day" is a
   physical constraint that spans 24 hours. A greedy hour can't
   enforce it.
3. **Strategy semantics**. PEAK\_SHAVING wants to allocate discharge
   to punta. LOAD\_SHIFTING wants to allocate discharge to punta *and*
   sized grid-charging in base. Both are policies that operate over
   the daily horizon, not the hour.

Why not just plan the entire year at once? Because the customer's load
shape and PV are characterized monthly (CFE bills monthly, PV varies
seasonally). And because each month is independent for billing
purposes — no kWh carries across the month boundary in the CFE bill.
Monthly is the natural unit.

### 2.3 The "typical day" assumption

The planner reduces a month to **one 24-hour vector** for load and one
for PV. Everything is averaged: a 30-day month with weekday/weekend
variance becomes 24 numbers that represent "the average hour of the
month at this clock hour".

**Why this is OK for the customer report.** The customer report is
itself monthly. We're not promising to predict the exact dispatch
behavior on the 17th Tuesday — we're computing the *month's bill* as
if every day were the same shape. CFE charges based on monthly
aggregates (kWh per bucket per month) plus one demand-peak number,
so a monthly typical-day plan and a per-day plan give numerically
similar bills *as long as the typical-day shape isn't badly skewed*.

**Where this could break.** If a customer has wildly different
weekday vs weekend shapes (e.g. a factory that runs Mon–Fri at 100%
and Sat–Sun at 5%), the typical-day average smears that. Discharge
"planned" for hour 19 happens equally on Sunday (where it isn't
needed) and on Tuesday (where it is). The bill math still adds up,
but the predicted SoC trajectory drifts from reality.

**The mitigation** is that Level 2 reads actual SoC each hour and
clamps to bounds, so a drift of a few kWh is absorbed. If post-Session-4
verification shows a project where the typical-day approximation costs
us >2% accuracy, we revisit. Until then, this is the simplification we
accept.

---

## Part III — Inputs in detail

### 3.1 The `monthCtx` shape (one per month)

```javascript
{
  // — Identity (diagnostic only) —
  monthIndex:      int 0..11,         // 0 = January
  daysInMonth:     int,               // 28..31

  // — Demand & PV shapes (the typical-day) —
  bucketByHour:    string[24],        // 'base' | 'intermedia' | 'punta'
  loadByHour:      kWh/hour [24],     // average load at clock hour h
  pvByHour:        kWh/hour [24],     // average PV gen at clock hour h

  // — Battery spec (already resolved from INPUT_BESS) —
  batteryCapKwh:   kWh,               // nameplate
  batteryPowerKw:  kW,                // inverter/contactor cap
  minSocKwh:       kWh,               // = capacityKwh * minSocPct
  maxSocKwh:       kWh,               // = capacityKwh * maxSocPct
  usableKwh:       kWh,               // = maxSocKwh - minSocKwh
  rte:             fraction 0..1,     // round-trip efficiency (e.g. 0.913)

  // — Tariff & interconnection —
  interconnMode:   'NET_METERING' | 'NET_BILLING' | 'ZERO_EXPORT' | 'UNKNOWN',
  rateBase:        MXN/kWh,
  rateInter:       MXN/kWh,
  ratePunta:       MXN/kWh,

  // — Demand peak ceiling —
  planningDemandLimitKw: kW                 // see §3.4 for the precise definition
}
```

### 3.2 Where each input comes from

| Input | Source |
|---|---|
| `bucketByHour` | `classifyGdmthHour(region, month, dow, hour)` in `03_ElecTables.js`. For typical-day collapse, we take the dominant bucket per clock hour. For flat-rate tariffs, all 24 are `'base'`. |
| `loadByHour` | The `perHourKwh.{base,intermedia,punta}[month]` arrays already built in `calcHourlySimulation` (lines 506–525). We re-project these onto the 24-hour skeleton via `bucketByHour`. |
| `pvByHour` | The `pvPerDaylightHour[month]` placeholder from `calcHourlySimulation:537`, flat across hours 6–19. Same simplification the existing engine already accepts. |
| Battery fields | Resolved upstream by the existing `readInputsBess.js` / `runBessStep.js` chain into `bessResult.spec`. |
| Tariff rates | From `loadCfeTariffRates()` (`03_ElecTables.js`) per month. We use the month's own rates. |
| `interconnMode` | From `INPUT_BESS!C` or `INPUT_PV` (interconnection cell). |
| `planningDemandLimitKw` | Derived — see §3.4. |

Nothing in `monthCtx` is invented; it's all rearranged from data the
engine already has by Step 18.

### 3.3 Critical constants (with sources)

| Constant | Value | Source / lock |
|---|---|---|
| `rte` default | `0.913` | `_bessDispatchHour` default and `20_CalcHourlySimulation.js:550`. Battery library overrides per-product. |
| Min SoC default | `5%` | `20_CalcHourlySimulation.js:548`. Conservative; protects warranty. |
| Max SoC default | `95%` | `20_CalcHourlySimulation.js:549`. Conservative; protects warranty. |
| Daylight window | hours 6–19 (14 hours) | `20_CalcHourlySimulation.js:535`. Placeholder PV shape. **Flagged**: real hourly PV from the PV calc step is a parallel improvement. |
| Allocation iteration cap | `10` passes | `_allocateProportional` in `20b_PlanMonthlyBessSchedule.js`. Empirically converges in 2–3 passes; 10 is just a safety. |
| Numeric tolerance | `1e-9` kWh | Float epsilon for "is this zero". |

**No new tuning constants are introduced by Chunk 5.** Every number
above already lives in the engine. This is deliberate: we don't want
the planner to have its own knobs that could drift from the executor's
knobs.

### 3.4 The planning demand limit — the most-debated input

CFE's "Cargo Capacidad" is billed on the customer's highest demand in
the month. The dispatcher must not *create* a new peak through grid
charging — that would be the worst possible self-own (we'd add a kW
to the bill while supposedly saving money).

The question is: **what reference peak does grid charging have to
stay under?**

Three candidates were considered:

| Option | Definition | Verdict |
|---|---|---|
| A. Raw load peak | `max_h loadByHour[h]` | **Wrong.** Doesn't account for PV reducing peak. Could be conservative to the point of forbidding all grid charging. |
| B. Battery-adjusted peak | `max_h (loadByHour[h] - pvByHour[h] + plannedGridCharge[h] - plannedDischarge[h])` | **Wrong, and worse than A.** This is what we're *computing* — using it as input creates a fixed-point problem. We tried it in Chunk 4b; it deadlocks the planner. |
| C. Raw net-of-PV peak | `max_h max(0, loadByHour[h] - pvByHour[h])` | **Locked.** Schedule-independent. Reflects the peak the customer's site already sees from CFE. Grid charging can use headroom below it. |

Locked: **C** is what `planningDemandLimitKw` means. The spec (§6) calls
this the "Chunk-4b lock" and it is the most important single decision
in this whole design.

**Consequence.** If a site's load is already flat at its peak in base
hours, LS finds no grid-charge headroom and degrades to PS. That's
correct, not a bug.

---

## Part IV — The math, strategy by strategy

I use this notation throughout:

- `h` is an hour-of-day index 0..23.
- `bucket(h)` ∈ {`base`, `intermedia`, `punta`}.
- `L[h]` = `loadByHour[h]` (kWh/h, equivalently kW since the bucket is 1h).
- `PV[h]` = `pvByHour[h]`.
- `surplus[h]` = `max(0, PV[h] − L[h])`.
- `residual[h]` = `max(0, L[h] − PV[h])`.
- `η` = `rte`.
- `P_b` = `batteryPowerKw`.
- `U` = `usableKwh` = `maxSocKwh − minSocKwh`.
- `D_lim` = `planningDemandLimitKw`.
- Discharge variable `d[h]` ≥ 0, charge `c[h]` ≥ 0, grid charge `g[h]` ≥ 0.

### 4.1 The constraint set (common to all strategies)

Every strategy's output must satisfy:

> **(I1) Conservation w/ RTE losses:**
>   `Σ_h d[h]  ≤  η · Σ_h (c[h] + g[h])`
>
> Whatever we discharge has to have been stored first, after losses.
>
> **(I2) Mutual exclusion per hour:**
>   `(c[h] + g[h]) · d[h] = 0` for all `h`
>
> A battery cannot simultaneously charge and discharge.
>
> **(I3) One cycle per day:**
>   `Σ_h d[h] ≤ U` and `Σ_h (c[h] + g[h]) ≤ U / η`
>
> Battery health bound. Two cycles a day cuts lifetime in half.
>
> **(I4) Power cap:**
>   `c[h] ≤ P_b`, `g[h] ≤ P_b`, `d[h] ≤ P_b` for all `h`
>
> The inverter / battery contactor can only sustain `P_b` kW.
>
> **(I5) Grid charge gate** (only LOAD\_SHIFTING):
>   `g[h] > 0`  ⟹  `interconnMode = NET_BILLING`
>                AND  `ratePunta · η > rateBase`
>                AND  `(ratePunta − rateBase) · η > 0`
>
> Don't grid-charge unless arbitrage is profitable after losses.
>
> **(I6) Planning demand limit:**
>   `L[h] + g[h] − PV[h]  ≤  D_lim`  for all `h`
>
> Grid charging cannot create a new monthly peak.
>
> **(I7) No discharge in base hours:**
>   `d[h] = 0` if `bucket(h) = base`
>
> Base is the cheap window; spending stored energy there is a
> guaranteed loss after RTE.
>
> **(I8) PV charge bounded by PV surplus:**
>   `c[h]  ≤  surplus[h]`  for all `h`
>
> Can't charge from PV that isn't there.

The planner is correct iff its output satisfies all eight invariants
for every input. The 11 unit tests check this.

### 4.2 PEAK\_SHAVING — the math

This is the default strategy and the baseline that SELF\_CONSUMPTION\_MAX
collapses to.

**Step 1: PV chargeable energy**

```
S = Σ_h surplus[h]            (kWh of PV surplus available daily)
```

If `S = 0`, the planner returns an empty schedule and stops. The
battery simply doesn't have anything to charge from. (Could it
grid-charge anyway? Not in PS. PS is defined as PV-only charging.)

**Step 2: Daily budgets**

```
B_d  =  min( U,  S · η )       (discharge budget — what we can use)
B_c  =  B_d / η                (charge budget — what we need to draw in)
B_c  =  min( B_c, S )          (defensive: can't exceed PV surplus)
B_c  =  min( B_c, U / η )      (defensive: can't exceed cycle limit)
```

The discharge budget is whichever is smaller: the usable capacity, or
the round-trip-corrected PV surplus. The asymmetry between `U` (energy
out) and `U / η` (energy in) is the RTE accounting.

**Step 3: Charge allocation**

The PV charge `c[h]` is distributed across surplus hours proportionally
to the surplus available in each hour, capped by per-hour power. Formally:

```
Initialize c[h] = 0 for all h.
For each iteration (until converged or 10 passes):
    weights[h] = surplus[h]  if  c[h] < P_b  else  0
    W = Σ_h weights[h]
    If W = 0, stop.
    For each hour h with weights[h] > 0:
        share[h] = (B_c_remaining) · weights[h] / W
        c[h] += min(share[h], P_b - c[h])
    B_c_remaining = B_c - Σ_h c[h]
```

This is a fixed-point allocator. Hours where `surplus[h]` is bigger
get a larger share; hours that saturate at `P_b` drop out and their
share gets redistributed. The iteration is guaranteed to converge
because each pass either places at least some kWh or removes a
saturated hour from the active set.

**Step 4: Discharge allocation**

```
residual[h] = max(0, L[h] - PV[h])
puntaWeights[h]  = residual[h]  if  bucket(h) = punta  else  0
interWeights[h]  = residual[h]  if  bucket(h) = intermedia  else  0

dischargeByHour[h] = 0 for all h.
Allocate B_d across puntaWeights using the same allocator. Call placed P.
If P < B_d:
    Allocate (B_d - P) across interWeights using the same allocator.
```

Punta gets first claim because that's where the rate is highest. If
punta load is so light that the battery can cover it all and still
have stored energy left over, the remainder spills into intermedia.
No spillover into base — that's invariant I7.

**Step 5: Defensive mutual-exclusion sweep**

Theoretically I2 is already satisfied because:
- PV surplus hours are by definition midday (base or intermedia in
  GDMTH), and discharge is assigned only to punta or intermedia.
- The intermedia overlap is the only risk; but if `c[h] > 0` then
  `surplus[h] > 0` which means `PV[h] > L[h]` which means
  `residual[h] = 0` and discharge wouldn't be assigned there anyway.

Belt and braces: we sweep and zero any overlap (`d[h] := 0` if
`c[h] + g[h] > 0`). Tested by `UNIT_BESS_PLAN_NO_CHARGE_AND_DISCHARGE_SAME_HOUR`.

### 4.3 SELF\_CONSUMPTION\_MAX

The Level 1 implementation routes SC to the same builder as PS, with
just the strategy label preserved in metadata for downstream reporting.

**Justification.** The hourly difference between PS and SC is the
priority order *within a single hour* when PV surplus and punta load
coincide. In the daily skeleton, PV surplus hours are midday (06–19)
and punta hours are evening (18–21). The overlap is at most hours
18–19 in months where intermedia is unusually short, and in those
hours PV is winding down anyway.

In other words: SC and PS differ on a tiebreaker that almost never
fires in real GDMTH schedules.

The existing test
`UNIT_BESS_DISPATCH_STRATEGIES_DIFFER_AND_SAVE` already asserts this
convergence at the full-sim level (`|psCost - scCost| <= 0.02 * baseCost + 1`).
By making SC = PS at Level 1 exactly, we trivially preserve that
assertion.

**Open question for the reviewer.** Is there a project archetype
where the SC-vs-PS distinction *should* matter? If yes, the place to
put that distinction is in a future Level 1.5 — not here. The current
code is honest: it documents that SC is treated as PS, names the
strategy in the meta, and lets downstream code do whatever reporting
it wants.

### 4.4 LOAD\_SHIFTING — the math

The interesting case. This is where the dispatcher does work the
formula sheet cannot.

**Step 0: The gate**

```
gateOk =  (interconnMode = NET_BILLING)
       AND (ratePunta · η > rateBase)
       AND ((ratePunta − rateBase) · η > 0)
```

If `gateOk` is false, we fall back to PEAK\_SHAVING and add a note to
`meta.notes` explaining why.

**Why both conditions, not just one?** They look redundant — if
ratePunta > rateBase and η ∈ (0,1], then `(ratePunta − rateBase) · η > 0`
follows from positive spread. They are kept separate to mirror the
exact predicate in `_bessDispatchHour:344–345` so the gate is identical
across Levels 1 and 2. If we ever change the gate, we change it in one
place by changing both. This is intentional duplication for defensive
symmetry.

**Step 1: PV chargeable energy (same as PS)**

```
surplus[h] = max(0, PV[h] − L[h])
S = Σ_h surplus[h]
```

**Step 2: Planning demand limit headroom (new)**

```
For h with bucket(h) = base:
    net[h]       = L[h] − PV[h]    (can be negative; that's a surplus hour)
    headroom[h]  = max(0, D_lim − net[h])
    headroom[h]  = min(headroom[h], P_b)        (power cap)
For h with bucket(h) ≠ base:
    headroom[h] = 0                              (no grid charging outside base)
H = Σ_h headroom[h]
```

This is the **maximum grid-charge energy we can place in base hours
without crossing the ceiling**. Some base hours have lots of headroom
(early morning, low load); some have almost none (industrial sites
that ramp up at 5am). The planner sees both.

**Step 3: Target a full daily cycle**

```
B_c_full  =  U / η                 (full-cycle charge target)
B_pv      =  min( S, B_c_full )    (PV charges first)
B_grid    =  B_c_full - B_pv       (grid fills the rest)

If B_grid > H:                     (not enough base-hour headroom)
    note: "grid-charge target X exceeds base headroom Y; capped."
    B_grid = H

B_c  =  B_pv + B_grid
B_d  =  B_c · η
B_d  =  min( B_d, U )              (defensive: discharge ≤ usable)
```

This is the place the planner can "fail gracefully." If the demand
ceiling is tight (industrial site with flat base load), `B_grid` gets
capped, the daily charge budget shrinks, and so does the discharge.
The customer gets less LS benefit, but the planner does not violate
invariants. It logs the cap in `meta.notes` so we can audit it.

**Step 4: Charge allocation**

```
Allocate B_pv across surplus[h] using the standard allocator → c[h].
Allocate B_grid across headroom[h] using the standard allocator → g[h].
```

Two independent allocations, one for PV-source charging, one for
grid-source charging. They land in different hours by construction
(surplus hours are midday, base is 00–05, no overlap), so I2 is
automatically respected.

**Step 5: Discharge allocation (same as PS)**

```
residual[h] = max(0, L[h] − PV[h])
Allocate B_d across punta hours' residual, then intermedia.
```

**Step 6: Defensive I2 sweep (same as PS)**

### 4.5 What the LS math tells us

Three observable things:

1. **In a solar-rich site, `B_pv ≈ B_c_full`, so `B_grid ≈ 0`** and
   LS collapses to PS by accident, not by design. The customer who
   picked LS gets PS behavior for free. (This is what we expect for
   CULLIGAN.)
2. **In a solar-poor site with low base load, `B_pv ≈ 0`,
   `B_grid ≈ B_c_full`**, all paid for by base headroom, and the
   battery cycles fully every day at the punta-vs-base spread.
   This is the LS sweet spot.
3. **In a solar-poor site with high flat base load, `H ≈ 0`**, the
   ceiling bites, and LS collapses back to PS by design. The customer
   can't grid-charge their way to savings because they already use too
   much during the cheap window. Correct, expected, honest.

These three cases are the four archetypes in `CHUNK_5_SESSION1_SPEC.md §3`.

---

## Part V — The allocator (`_allocateProportional`)

The allocator is the only nontrivial helper. It's worth understanding
because both PS and LS lean on it.

### 5.1 What it does

Given:
- `weights[24]` — a non-negative vector indicating how much each hour
  "wants" energy (e.g. how much PV surplus, or how much demand-ceiling
  headroom)
- `target` — total kWh to place
- `perHourCap` — power cap per hour
- `into[24]` — accumulator (so callers can do multiple passes; e.g.
  punta + intermedia)

It distributes up to `target` kWh across the hours, weighted by
`weights`, capped at `perHourCap` per hour, and returns the kWh
actually placed (may be less than `target` if all caps bite).

### 5.2 The algorithm

```
remaining = target
For up to 10 iterations:
    Compute total weight W over hours where (capRemaining[h] > 0 and weights[h] > 0).
    If W = 0, stop.
    For each live hour h:
        share = remaining · weights[h] / W
        place = min(share, capRemaining[h])
        into[h] += place
    remaining = target − placed
    If remaining ≈ 0, stop.
```

### 5.3 Why iterate?

Naive proportional allocation overshoots when some hours saturate
their cap before others. The iteration redistributes the unspent
budget from saturated hours to live ones, weighted by their remaining
weights. It converges fast — in practice 1–2 iterations on most
inputs, and very rarely as many as 4. The cap at 10 is a safety
against pathological inputs.

### 5.4 Edge cases

- **All weights zero.** Allocator returns 0. Caller handles this
  (PS returns empty schedule with a note; LS notes "grid-charge target
  exceeds base headroom; capped to zero").
- **target = 0.** Allocator returns 0 immediately.
- **`perHourCap` = 0.** Allocator returns 0 (degenerate but defined).
- **`weights[h]` infinite or NaN.** Caller's `_planNormalizeCtx`
  filters those before they reach the allocator.

---

## Part VI — Assumptions and the limits of what this can predict

Honest list.

### 6.1 Locked simplifications (documented, accepted)

- **Typical-day collapse.** 30 days × 24 hours becomes 24 numbers per
  month. Tests § II–III assert this is OK for monthly billing; verify
  on real projects in Session 4.
- **Flat-daylight PV shape.** PV is distributed evenly across hours
  6–19. The real shape is a bell curve. This is the existing engine
  assumption (`20_CalcHourlySimulation.js:537`), not new to Chunk 5.
- **No DOW differentiation.** Weekdays and weekends collapse into the
  same 24-hour vector. Real CFE classification has DOW splits in some
  regions; the planner averages over them via the dominant-bucket
  rule.
- **Holidays not special-cased.** Christmas, Holy Week, etc., classified
  according to their normal calendar bucket. ≤4% of year, considered
  acceptable.

### 6.2 RTE accounting

The planner uses `η = rte` as a single round-trip efficiency. In
reality this decomposes into a one-way charging efficiency (`η_c`) and
a one-way discharging efficiency (`η_d`) with `η = η_c · η_d`. The
planner doesn't distinguish them because:

- The energy balance `out = in · η` is the same.
- Per-hour power limits apply to the same `P_b` regardless of direction.
- The existing hourly dispatcher uses single-η accounting
  (`20_CalcHourlySimulation.js:336`).

If the BESS hardware ever exposes asymmetric efficiencies and we care
about second-order accuracy, this is the place to extend.

### 6.3 SoC starting condition

The planner builds a daily schedule assuming the battery starts at
some baseline (effectively `minSocKwh` at midnight) and returns there
by the next midnight. Day-to-day SoC drift is Level 2's problem.

This is "max one full cycle per day" by construction. The customer
sees that as a battery-life guarantee. Two-cycle-per-day operation
(charge midnight to 6am, discharge 9–10am, charge again 1–4pm,
discharge again 6–10pm) is forbidden by the daily-cycle constraint.
If we ever want to support it (e.g. a customer with two distinct
demand peaks per day), this is the constraint that has to change.

### 6.4 What this paper does NOT cover

- **CFE bill computation.** The planner produces a *schedule*. The
  CFE bill that results from that schedule is computed by
  `04a_CalcCFEBill.js`, which is unchanged. Sessions 2–3 wire the
  schedule into the hourly sim and the hourly sim into the bill calc.
- **PV-only baseline run.** Per the plan, we'll run the hourly sim
  three times per project (no PV / PV-only / PV+BESS) to isolate
  BESS-attributable savings. That's Session 2.
- **Section 2 writer rewrite.** `_cfeOutV2_fillSection2` switching
  from formula-sheet reads to hourly-result reads is Session 3.

---

## Part VII — Reviewer checklist

If I were reading this paper to red-team it before the code runs in
production, these are the questions I'd ask. Use them as a hit list.

### 7.1 Math

- [ ] Are I1–I8 sufficient? Is there an unstated constraint we forgot?
- [ ] In §4.2 step 2, is `B_d = min(U, S · η)` the right bound? Could
      `U` ever be larger than what the battery can charge from PV but
      smaller than the round-trip-corrected punta need?
- [ ] In §4.4 step 3, when `B_grid` is capped by `H`, do we *reduce
      `B_d` proportionally* (i.e. `B_d = (B_pv + B_grid) · η`)? Yes,
      the code does this. Confirm it matches your expectation.
- [ ] Is the LS arbitrage gate correct? Should it require *some*
      minimum spread (e.g. spread > 20% of rateBase) to avoid
      churning the battery for trivial arbitrage?
- [ ] Does PS = SC at Level 1 hide a real customer-visible difference?
      Or is it correct that the formula sheet's "no distinction"
      reproduces here too?

### 7.2 Inputs

- [ ] Is the planning demand limit formula in §3.4 the right one? Specifically,
      is `max_h max(0, L[h] − PV[h])` the right reference, or should
      it be the actual CFE billed demand from the customer's prior bills?
- [ ] If `loadByHour` comes from monthly bucket averages re-projected
      onto the 24-hour skeleton, is the projection well-defined when a
      clock hour spans multiple buckets across days (e.g. hour 17
      could be intermedia or punta depending on month)?
- [ ] Should the planner reject malformed inputs (negative load, RTE > 1)
      or silently coerce? The current code coerces with defaults.

### 7.3 Behavior on real projects

- [ ] Will CULLIGAN's `bsim_*` cells (the formula-sheet section-2
      inputs) change vs the pre-Chunk-5 baseline? Expected: no, within
      ±1%. If yes, we have a bug in the formula-sheet fallback.
- [ ] Will DRAXLMAIER show measurable LS savings improvement? Expected
      yes; if no, the LS gate is too strict or the planner is too
      conservative.
- [ ] Is there a project archetype this paper missed?

### 7.4 Code

- [ ] Is `_planMonthlyBessSchedule` actually pure (no `SpreadsheetApp.*`,
      no `Logger.*`, no random)? Confirmed yes.
- [ ] Does the allocator converge for adversarial inputs? Tested in
      `UNIT_BESS_PLAN_POWER_LIMIT_RESPECTED` with tight power caps —
      passes.
- [ ] Are the 11 unit tests covering enough? Specifically, is there a
      scenario where SC ≠ PS that I'm missing?

---

## Part VIII — Decision points open for the review

Three things I'd love to hear back on before Session 2:

1. **The PS = SC choice at Level 1.** The fastest way to break this is
   for someone to produce a real project where SC should differ from
   PS. If you can produce one (in the workbooks, by hand on paper,
   anywhere), then PS = SC is wrong and I need to split them at Level
   1.

2. **The planning demand limit formula.** Should we use the customer's
   *actual prior billed demand* (the kW shown on their last 12 CFE
   bills) instead of the typical-day computed peak? The actual is
   more conservative (and possibly more correct if the typical-day
   smearing dilutes the peak). But it introduces an external input
   that has to be plumbed through.

3. **The arbitrage gate strictness.** Right now the gate fires for
   any positive RTE-corrected spread. Should there be a minimum
   spread threshold (e.g. arbitrage only profitable above 30% spread)
   to avoid churning the battery cycle life on tiny saves?

The current code answers these as "PS = SC", "typical-day peak", and
"any positive spread". All three are defensible but reviewable.

---

## Part IX — Summary in one paragraph

The planner takes one month's typical-day load + PV shapes, battery
spec, tariff rates, interconnection mode, and the raw net-of-PV peak,
and produces three 24-hour vectors (PV charge, grid charge, discharge)
that respect eight invariants. PEAK\_SHAVING and SELF\_CONSUMPTION\_MAX
return identical schedules at the monthly level — preserving the
convergence the existing tests assert. LOAD\_SHIFTING differs only
when the arbitrage gate fires (NET\_BILLING + RTE-corrected positive
spread), in which case it adds base-hour grid charging capped by the
demand-ceiling headroom, funding a full daily cycle when possible. The
planner is a pure function. It is reachable only by tests until Session
2 wires it into `calcHourlySimulation` as Level 2's input.
