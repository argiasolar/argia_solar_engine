# Chunk 5 — Session 1 spec (locked)

> Status: locked. Reviewed across three rounds. Sister doc:
> `docs/CHUNK_5_PLAN.md` (architecture), `docs/CHUNK_5_MECHANISM_PAPER.md`
> (math + assumptions for review).
>
> What this doc is: the exact contract Session 1 ships against.

---

## 0. Tier

`schedule.meta.tier === 'SCREENING'`.

This module produces SCREENING-tier output. Downstream code (writers,
customer reports) **must check this tier** and not display anything
that looks like a financial commitment. Investment-grade output
requires interval data and the v5.0.0 ship gate (Session 4).

---

## 1. Level 1 function contract

**Signature** (pure function, no engine/sheet access):

```javascript
_planMonthlyBessSchedule(monthCtx, strategy) -> schedule
```

### 1.1 `monthCtx` input shape

One `monthCtx` per month. Caller (the hourly sim) builds it from data
the engine already has.

**Required fields:**

| Field | Type | Units | Meaning |
|---|---|---|---|
| `bucketByHour` | string[24] | — | `'base'\|'intermedia'\|'punta'` per clock hour. |
| `loadByHour` | num[24] | kWh/h | Average load per hour-of-day for this month. |
| `pvByHour` | num[24] | kWh/h | Average PV gen per hour-of-day. Use `_planSyntheticPvBellShape(monthlyKwh)` if no real shape available. |
| `batteryCapKwh` | num | kWh | Nameplate. |
| `batteryPowerKw` | num | kW | Per-hour throughput cap. |
| `minSocKwh` | num | kWh | `capacityKwh * minSocPct`. |
| `maxSocKwh` | num | kWh | `capacityKwh * maxSocPct`. |
| `usableKwh` | num | kWh | `maxSocKwh - minSocKwh`. |
| `rte` | num | 0..1 | Round-trip efficiency. |
| `interconnMode` | string | — | `'NET_METERING'\|'NET_BILLING'\|'ZERO_EXPORT'\|'UNKNOWN'`. |
| `rateBase` | num | MXN/kWh | Base bucket energy rate. |
| `rateInter` | num | MXN/kWh | Intermedia rate. |
| `ratePunta` | num | MXN/kWh | Punta rate. |

**Optional fields:**

| Field | Type | Units | Default behavior |
|---|---|---|---|
| `actualBilledDemandKw` | num | kW | If present, planning limit becomes `max(synthetic, actualBilled)`. **Source**: `max(monthlyBill.kwBase[m], monthlyBill.kwIntermedia[m], monthlyBill.kwPunta[m])` from `02_LoadDB.js:478-480`. |
| `planningDemandLimitKw` | num | kW | If present, overrides both. Used for tests and tuning. |
| `wearCostMxnPerKwh` | num | MXN/kWh | If present, LS gate uses strict form: `(ratePunta - rateBase) * rte > wearCostMxnPerKwh`. If absent, current gate (any positive spread); logs `WEAR_COST_NOT_SUPPLIED` in notes. Real values come from Session 2's `25_CalcBessWearCost.js`. |
| `demandRates` | `{capacidadMxnPerKw, distribucionMxnPerKw}` | MXN/kW | If present, ledger `estAvoidedCapacidadMxn` / `estAvoidedDistribucionMxn` populated. If absent, those fields = 0 and meta records `DEMAND_RATES_NOT_SUPPLIED`. |
| `monthIndex` | int 0..11 | — | Diagnostic; planner doesn't branch on it. |
| `daysInMonth` | int | — | For caller's annualization; planner is daily. |

### 1.2 The planning demand limit (renamed from "demand ceiling")

Per reviewer R3 §1: this is **not** a physical constraint on the
battery. The battery can physically push net import below this limit.
It is the **upper bound the planner uses for grid-charge sizing** —
the kW level the planner refuses to plan grid charging across.

Formula:

```
planningDemandLimitKw = max(
  syntheticLimitKw,           // = max_h max(0, loadByHour[h] - pvByHour[h])
  actualBilledDemandKw        // from monthlyBill kW arrays
)
```

If `actualBilledDemandKw` is absent, the planner uses `syntheticLimitKw`
alone — but `meta.actualBilledDemandKw` will be 0, which downstream
should treat as "synthetic-only mode."

### 1.3 `schedule` output shape

```javascript
{
  // The plan
  chargeByHour:        num[24],   // kWh to charge from PV surplus
  gridChargeByHour:    num[24],   // kWh to charge from grid (LS only)
  dischargeByHour:     num[24],   // kWh to discharge

  meta: {
    tier:                    'SCREENING',
    strategy:                string,
    dailyDischargeBudgetKwh: num,
    dailyChargeBudgetKwh:    num,
    pvChargeKwh:             num,
    gridChargeKwh:           num,
    planningDemandLimitKw:   num,
    syntheticLimitKw:        num,
    actualBilledDemandKw:    num,
    notes:                   string[],

    // Ledger — see §1.4
    ledger: { ... },

    // Priority results — see §1.5
    priorityResults: { ... },
  }
}
```

### 1.4 The ledger (R3 §2 enhanced)

```javascript
meta.ledger = {
  // Sources (kWh)
  chargedFromPvSurplusKwh:     num,
  chargedFromGridBaseKwh:      num,

  // Destinations (kWh) — must satisfy I7: dischargedToBaseKwh == 0
  dischargedToPuntaKwh:        num,
  dischargedToIntermediaKwh:   num,
  dischargedToBaseKwh:         num,

  // Demand-charge impact (kW) — the most commercially relevant fields
  peakReductionKwPunta:        num,
  peakReductionKwIntermedia:   num,
  peakReductionKwOverall:      num,
  peakReductionPctOverall:     num,   // 0..1

  // Estimated MXN at SCREENING tier (typical-day-derived, not 15-min)
  // Per-day values. Caller multiplies by daysInMonth for monthly.
  estAvoidedCapacidadMxn:      num,
  estAvoidedDistribucionMxn:   num,
  estAvoidedVariableMxn:       num,

  // Benefit attribution (kWh) — for customer-report breakdowns
  benefitSelfConsumptionKwh:   num,
  benefitPeakShavingKwh:       num,
  benefitTimeShiftingKwh:      num,
  benefitZeroExportKwh:        num,

  // Sizing metric (R3 §2)
  effectiveBatteryUtilizationPct: num,   // 0..1
};
```

**Ledger consistency invariants (asserted in `UNIT_BESS_PLAN_LEDGER_BALANCES`):**

- `chargedFromPvSurplusKwh ≈ Σ chargeByHour`
- `chargedFromGridBaseKwh ≈ Σ gridChargeByHour`
- `dischargedToPuntaKwh + dischargedToIntermediaKwh + dischargedToBaseKwh ≈ Σ dischargeByHour`
- `dischargedToBaseKwh == 0` (I7)
- `effectiveBatteryUtilizationPct ∈ [0, 1]`
- `peakReductionPctOverall ∈ [0, 1]`

### 1.5 Priority results (R3 §3 structured)

For each priority on the strategy's stack, record what happened:

```javascript
meta.priorityResults = {
  P1_AVOID_NEW_PEAK: { attempted: true, achieved: true,  valueMxn: 0 },
  P2_CAPTURE_PV:     { attempted: true, achieved: true,  valueMxn: 432 },
  P3_REDUCE_PUNTA:   { attempted: true, achieved: true,  valueMxn: 41720 },
  P4_ARBITRAGE:      { attempted: true, achieved: true,  valueMxn: 288 },   // LS only
};
```

- `attempted`: the strategy declares this priority as active.
- `achieved`: kWh actually placed / kW actually shaved.
- `valueMxn`: best estimate of daily MXN value attributable to this priority. `null` if rates unavailable (or for P1, which prevents loss rather than generating value, so it's 0).

PS strategies omit P4 from the results entirely. LS includes P4 with `attempted: true`; `achieved` reflects whether the gate fired.

---

## 2. The dispatch priority stack (R3 §3)

```javascript
BESS_DISPATCH_PRIORITIES = [
  'P1_AVOID_NEW_PEAK',   // Hard constraint, never violated
  'P2_CAPTURE_PV',       // Soak PV surplus
  'P3_REDUCE_PUNTA',     // Discharge in punta
  'P4_ARBITRAGE'         // Grid-charge base → discharge punta
];

BESS_STRATEGY_PRIORITIES = {
  PEAK_SHAVING:         [P1, P2, P3],
  SELF_CONSUMPTION_MAX: [P1, P2, P3],
  LOAD_SHIFTING:        [P1, P2, P3, P4]
};
```

Adding a new strategy = declaring its priority stack. Adding a new
priority = appending to `BESS_DISPATCH_PRIORITIES` and giving it
implementation. No new strategy/priority is in Session 1's scope.

---

## 3. Invariants (formally asserted by tests)

> Notation: `c[h]` = `chargeByHour[h]`, `g[h]` = `gridChargeByHour[h]`,
> `d[h]` = `dischargeByHour[h]`, `η` = `rte`, `P_b` = `batteryPowerKw`,
> `U` = `usableKwh`, `D_lim` = `planningDemandLimitKw`.

- **I1 Conservation with RTE:** `Σ d[h] ≤ η · Σ (c[h] + g[h])`
- **I2 Mutual exclusion:** `(c[h] + g[h]) · d[h] = 0 ∀ h`
- **I3 One cycle/day:** `Σ d[h] ≤ U`  ∧  `Σ (c[h] + g[h]) ≤ U/η`
- **I4 Power cap:** `c[h] ≤ P_b`  ∧  `g[h] ≤ P_b`  ∧  `d[h] ≤ P_b`
- **I5 Grid charge gate:** `g[h] > 0 ⟹ interconn=NET_BILLING ∧ (ratePunta−rateBase)·η > wearCost ∧ ratePunta·η > rateBase + wearCost`
- **I6 Planning limit:** `L[h] + g[h] − PV[h] ≤ D_lim` for all `h`
- **I7 No base discharge:** `d[h] = 0` if `bucket(h) = base`
- **I8 PV charge bounded:** `c[h] ≤ max(0, PV[h] − L[h])`

`wearCost` defaults to 0 if `monthCtx.wearCostMxnPerKwh` is null.

---

## 4. Strategy semantics

### 4.1 PEAK_SHAVING

- Discharge budget = `min(U, S · η)` where `S = Σ_h max(0, PV[h] − L[h])`
- PV charge allocated across surplus hours, capped by power
- Discharge allocated to punta first, then intermedia (never base)
- Grid charging: forbidden

### 4.2 SELF_CONSUMPTION_MAX (deferred refinement)

Returns identical schedule to PEAK_SHAVING. The hourly tiebreaker that
distinguishes them (PV-capture-first vs punta-discharge-first when
both compete in the same hour) almost never fires in GDMTH clock
structure (PV surplus midday vs punta evening).

This is a **deferred refinement**, not a fundamental design claim. If
a project surfaces where SC must differ — e.g. a ZERO_EXPORT site
where SC's "never spill PV" really matters because exported PV is
worthless — revisit before shipping numbers to that customer.

### 4.3 LOAD_SHIFTING

- Gate: `interconn=NET_BILLING ∧ (ratePunta−rateBase)·η > wearCost ∧ ratePunta·η > rateBase + wearCost`
- If gate blocks: fall back to PEAK_SHAVING with note logged
- If gate fires:
  - Target full cycle: `chargeTarget = U/η`
  - PV charge first: `pvTarget = min(S, U/η)`
  - Grid charge fills gap, capped by base-hour headroom under `D_lim`
  - Discharge: punta first, intermedia second

---

## 5. The bell-curve PV utility

`_planSyntheticPvBellShape(monthlyKwh)` → `num[24]`

- Half-sine across hours 6..19, normalized to integrate to `monthlyKwh`.
- Used by the caller when no real hourly PV shape is available.
- Better than flat-daylight for reasoning about late-afternoon timing.
- The existing `pvPerDaylightHour` in `20_CalcHourlySimulation.js:531-538`
  is still flat; **Session 2 unifies these** so planner and executor
  agree on shape.

---

## 6. Honest doubts (kept for the record)

- **Typical-day collapse.** 30 days × 24 hours → 24 numbers per month.
  Smears weekday/weekend variance. Acceptable for monthly billing
  estimates; verify on real projects in Session 4.
- **Hourly-average bias.** Real CFE billed demand is a 15-min interval
  max. Hourly averages dilute the real peak. **This is the SCREENING
  tier's defining limitation.** Quantified in Session 4 against
  real interval data; the ship gate forbids v5.0.0 release if any
  tier shows >10% bias.
- **PS=SC at Level 1 is deferred refinement, not a permanent decision.**
- **One cycle/day is conservative modeling, not physics.** Real systems
  can multi-cycle; we under-claim deliberately for warranty + customer-
  trust reasons. Reviewed in Chunk 6+ if needed.

---

## 7. Deliverables checklist

- [x] `20b_PlanMonthlyBessSchedule.js` (planner + bell-curve utility + priority constants)
- [x] `tests_unit/calc/PlanMonthlyBessScheduleTests.gs` (15 tests, 62 assertions, all PASS)
- [x] `docs/CHUNK_5_SESSION1_SPEC.md` (this file)
- [x] `docs/CHUNK_5_MECHANISM_PAPER.md` (math + assumptions paper)
- [ ] `docs/CHUNK_5_ROADMAP.md` (sessions 1–4 + Chunk 6; written next)

Not in Session 1:
- Engine wiring (Session 2)
- Wear-cost computation module (Session 2)
- INPUT_BESS extensions for cycle life / warranty / residual (Session 2)
- PV-only third-run for BESS-attribution (Session 2)
- Section-2 writer rewrite (Session 3)
- AUTO_OPTIMIZE orchestrator (Session 3)
- 15-min validation (Session 4 ship gate)
- BaaS Economics Engine (Chunk 6)
