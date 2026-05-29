# 15-minute interval validation — PLACEHOLDER (not live)

> Decision (2026-05-29): structure ready, NOT live. Hard to validate
> near-term. This documents the deferral so it's a deliberate, recorded
> decision rather than an unfinished loose end.

## Current state

The engine has TWO sources for BESS savings numbers:

1. **`BESS_SIMULATION` formula sheet** — the proven, regression-locked
   source. This is what customer-facing numbers read from today.
2. **Hourly simulation (`hourlySim.attribution`)** — built in Chunk 5
   Sessions 1-3, fully tested, but NOT the customer-facing source.

Chunk 5 Session 3 (Option 2) deliberately kept the headline customer
numbers on source #1. The hourly-sim path is plumbed and ready but the
source-swap flag (`_cfeOutV2_section2Source`) points at the formula
sheet.

## Why it's not live

Swapping the customer-facing source to the hourly sim requires knowing
the hourly sim is at least as accurate as the formula sheet. That
requires **real 15-minute interval demand data** from at least one
project to validate against. We don't have that data, and it's hard to
obtain near-term.

Until we do, putting the hourly-sim numbers in the customer headline
would mean shipping an unvalidated calculation — exactly what the
PROPOSAL disclaimer warns customers about. So the formula sheet stays
the source of truth, and the disclaimer stays honest.

## The single activation point

`_baasValidationStatus(ss)` in `writers_v2/WriteBaasProjectionV2.js` is
the one switch. It currently returns:

```
{ tier: 'PROPOSAL', intervalDataAvailable: false, biasCheckPassed: false }
```

Everything downstream reads this. Nothing auto-upgrades past PROPOSAL.

## To activate (future, when data arrives)

1. Obtain 15-minute interval demand data for ≥1 real project.
2. Run the hourly sim against that project; compare its per-tier
   (base/intermedia/punta) bias vs the interval-data-derived actuals.
3. If per-tier bias ≤ 10%:
   - Set `intervalDataAvailable: true` and `biasCheckPassed: true` in
     `_baasValidationStatus` for that project class.
   - Flip `_cfeOutV2_section2Source` to `HOURLY_SIM_ATTRIBUTION` (the
     Chunk 5 Session 4 one-flag change; plumbing already in place).
   - The tier can then upgrade PROPOSAL → BANKABLE for projects with
     interval data.
4. Re-lock the CULLIGAN baseline with the (now-validated) hourly-sim
   numbers.

## What is NOT blocked by this

- The BaaS Economics Engine (Chunk 6) ships and works NOW. It reads the
  customer savings from whatever the current source-of-truth is (the
  formula sheet) and builds the lease projection on top. When the source
  eventually swaps, BaaS automatically uses the better numbers — no BaaS
  code change needed.
- The PROPOSAL disclaimer keeps every output honest in the meantime.

## Version policy note

Because the source swap is deferred indefinitely, v5.0.0 (which the
Chunk 5 roadmap gated on the 15-min validation) is NOT shipping on that
gate. The engine continues on the 4.x line (Chunk 6 ships as 4.3.0).
v5.0.0 is reserved for the eventual validated source cutover, whenever
the interval data materializes.
