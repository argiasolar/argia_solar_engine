# ARGIA Engine — v4.44.0 (T10a: status rules pack — structure-present + BOM band)

First slice of **T10 — the PROJECT_STATUS rules pack**. T10 is five rules; this chunk ships the two
deterministic, already-data-backed ones and keeps CULLIGAN PASS. The data-dependent rules follow in
their own chunks once each is verified live (see "Remaining" below).

---

## What's new

**`36_CalcStatusRules.js`** (new — the rules-pack module; later T10 chunks add to it).

**Rule: structure-cost-present** *(reads T7)* — a structure priced at $0 (null roof factor, SIN
COTIZAR, or silently dropped) means the racking is not costed. Hard stop, stricter than the BOM
"family present" check.

| structure subtotal (USD) | level | code |
|---|---|---|
| `> 0` | PASS | `STRUCTURE_COST_PRESENT` |
| `== 0` | **BLOCKED** | `STRUCTURE_COST_ZERO` |
| unknown / no BOM | PASS (advisory) | `STRUCTURE_NOT_EVALUATED` |

**BOM-completeness band** *(reads T9)* — `35_` now has a configurable `BOM_COMPLETENESS_BLOCK_PCT =
60`. Below it → **BLOCKED**; at/above it an incompleteness stays REVIEW_REQUIRED (override-able);
SIN COTIZAR-only (100% present) stays REVIEW_REQUIRED.

Both wire into `33_` `collectProjectStatusRules` (guarded — a reader failing never crashes status and
never silently passes).

## Tests

- `UNIT_PS_RULE_STRUCTURE_COST` — present → PASS · zero → BLOCKED (not emittable even with override) ·
  unknown → NOT_EVALUATED.
- `UNIT_PS_RULE_BOM_BAND` — `<60%` → BLOCKED · partial `≥60%` → REVIEW · SIN COTIZAR-only → REVIEW.
- `REG_STATUS_RULES_CULLIGAN` (live) — CULLIGAN structure priced ($24,300) → PASS, offer emittable.

Self-test: **ALL GREEN**, 0 Unit FAIL / 0 Unit ERROR. Workbook-dependent 50 → **51** (+1 live REG).

## Remaining T10 (later chunks)

| Rule | Reads | Status |
|---|---|---|
| Install-benchmark band (Green/Yellow/Red) | T8 | needs CULLIGAN sanity-check verification |
| CFE data-quality score (<80% REVIEW, <60% BLOCKED) | INPUT_CFE | composite scoring — own chunk |
| BESS-decision transparency (recommended-but-excluded) | sim | composite logic — own chunk |

---

## Files

```
00a_Version.js                                      4.43.0 -> 4.44.0
36_CalcStatusRules.js                               NEW  (structure-cost rule)
35_CalcBomCompleteness.js                           BOM rule: + BLOCKED band (BOM_COMPLETENESS_BLOCK_PCT)
33_CalcProjectStatus.js                             collectProjectStatusRules += structure rule (guarded)
tests_unit/calc/StatusRulesTests.gs                 NEW
tests_regression/v2/StatusRulesCulliganTests.gs     NEW
CHANGELOG.md / README_4.44.0.md
```

## Deploy

```bash
git pull
unzip -o ~/Downloads/argia_v4.44.0_T10a.zip -d .
node scripts/full_selftest.js

git add -A
git commit -m 'T10a: status rules pack -- structure-cost-present rule + BOM completeness BLOCKED band'
git push

clasp push --force 2>&1 | tee .clasp_last_push.log
node scripts/verify_deploy.js --clasp-log .clasp_last_push.log
```

Then run the CULLIGAN E2E. Expected: **still all-green** plus the new structure-rule assertions
(structure priced → PASS, offer emittable). No financial goldens move.
