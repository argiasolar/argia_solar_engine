# Sizing-constraint regression tests

Turns the conductor/OCPD review findings into executable checks that run against
the **real** engine functions (`03_ElecTables.js`, `05_CalcAC.js`,
`18_CalcBessCircuit.js`) — not reimplementations.

```
node tests_sizing/sizing_constraints_test.js
```

No dependencies. Self-contained: `elec_tables_fixture.json` is a committed copy
of the `15M_ELEC_TABLES` grid, parsed by the engine's own `readElecTables`.

## How to read the output

- **CONTROL** — the engine is already correct here. Must stay green. A control
  going red means a real regression (or the oracle drifted from the standard).
- **DEFECT (xfail)** — a constraint the engine does not yet enforce. Expected to
  reproduce the defect today. When you fix the engine, the test flips to
  `DEFECT FIXED — remove xfail`. Defects do not fail the build; only a broken
  control exits non-zero.

The oracle pairs the engine's own 90 °C ampacity column (its derate basis) with
the standard **NEC 310.16 copper 75 °C** column — the physical termination limit
the engine's data model omits entirely.

## What each test pins

| Test | Kind | Pins |
|------|------|------|
| T1 | DEFECT | 75 °C terminal cap, on a lightly-derated 125 A circuit where it actually bites: engine picks 1/0 (75 °C = 150 A) for a 156 A terminal requirement; correct is 2/0. |
| T2 | CONTROL | Per-inverter AC (180.42 A): engine = correct = 4/0. The next-size jump also clears 75 °C. |
| T3 | CONTROL | Main feeder (280.7 A/run): engine = correct = 600 kcmil. **Corrects the review's headline example — this case does *not* violate the cap;** the heavy derate already forces a big enough conductor. |
| T4 | DEFECT | OCPD must protect the conductor (NEC 240.4). BESS: 1200 A breaker on a 615 A conductor. |
| T5 | DEFECT | BESS must fail closed (or model per-stack). 9 × 108 kW stacks are lumped into one 1406 A run on a single conductor; `insufficient` is dropped and `sizeable` stays true. Per-stack is ~156 A. |
| T6 | CONTROL | 240.4(B) next-size-up rounding (250 A OCPD on 4/0) is legitimately allowed. |
| T7 | DEFECT | DC grouping count capped at 6 (`04_CalcDC.js:161`); the table defines Fag(9)=0.7 but bundles >6 still use 0.8. |
| T8 | DEFECT | `readElecTables` reads a hardcoded 29-row window; the breaker table runs past it, so 15 A and 1600 A are silently dropped (`nextBreaker` tops out at 1200). |

## Current status (pre-fix)

3 controls green, 5 defects reproduced (xfail), exit 0. The controls are the
point: they prove the suite isn't trivially red, and they mark where the review
over-claimed (T3 especially).

## Wiring into the gate

These are the kind of checks the headless `full_selftest.js` blind spot would
otherwise hide — they run with no live workbook. Add this file to the gate's
real-run set. When a defect is fixed, the runner tells you to un-xfail it, so it
becomes a permanent guardrail.

## Honest caveat

The oracle encodes NEC 310.16 values and NEC article logic (240.4, 110.14(C),
250.122). It has **not** been reconciled against the exact NOM-001-SEDE-2022
article text or any Mexico-specific ampacity tables. Before rewriting the sizing
core, confirm the 75 °C column values and article references with the standard
in hand. The structural defects (no terminal column, no OCPD/conductor
coordination, single-conductor BESS lump, truncated parse window) hold
regardless of those exact numbers.
