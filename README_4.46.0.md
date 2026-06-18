# ARGIA Engine — v4.46.0 (T10c: status rules pack — BESS-decision transparency)

Third slice of **T10 — the PROJECT_STATUS rules pack**. Adds the BESS-decision transparency rule.
CULLIGAN includes BESS → PASS / emittable.

---

## What's new — BESS-decision transparency (`36_CalcStatusRules.js`)

When the engine recommends a battery but the project excludes it, the offer silently leaves
peak-shaving / arbitrage savings on the table. This rule surfaces it so the exclusion is a conscious,
disclosed decision.

| Case | Level | Code |
|---|---|---|
| recommended ∧ included | PASS | `BESS_RECOMMENDED_INCLUDED` |
| recommended ∧ **excluded** | **PASS_WITH_WARNINGS** | `BESS_RECOMMENDED_EXCLUDED` |
| not recommended | PASS | `BESS_NOT_RECOMMENDED` |
| no BESS_RECOMMENDATIONS | PASS (advisory) | `BESS_DECISION_NOT_EVALUATED` |

`PASS_WITH_WARNINGS` is a **soft gate** — the offer isn't emittable without an explicit override, but
the override is allowed (this is disclosure, not a hard block). The excluded case records the
recommended label + omitted annual savings (best candidate Total $/yr) as a % of the CFE base
(sin-PV) bill.

**Live signals** (all guarded): recommendation from the `BESS_RECOMMENDATIONS` row-2 banner; inclusion
from the BOM BESS subtotal (`> 0`); omitted savings from the candidate table + `BESS_SIMULATION!D12`.
The check-error fallback is PASS — an advisory rule never blocks the offer on its own failure.

## Tests

- `UNIT_PS_RULE_BESS_DECISION` — included → PASS · excluded → PASS_WITH_WARNINGS + omitted savings +
  soft-gate (override-able) · not recommended → PASS · no data → NOT_EVALUATED.
- `REG_BESS_DECISION_CULLIGAN` (live) — CULLIGAN BESS included → PASS, emittable.

Self-test: **ALL GREEN**, 0 Unit FAIL / 0 Unit ERROR. Workbook-dependent 52 → **53** (+1 live REG).

## T10 status

| Rule | Chunk | State |
|---|---|---|
| BOM-completeness band | T10a | shipped (4.44.0) |
| Structure-present | T10a | shipped (4.44.0) |
| CFE data-quality | T10b | shipped (4.45.0) |
| BESS-decision transparency | T10c | **shipped (this)** |
| Install-benchmark | — | **deferred** — labor-only bounds / 94M table decision (see 4.45.0) |

---

## Files

```
00a_Version.js                                      4.45.0 -> 4.46.0
36_CalcStatusRules.js                               + BESS-decision rule
33_CalcProjectStatus.js                             collectProjectStatusRules += BESS rule (guarded)
tests_unit/calc/StatusRulesTests.gs                 + UNIT_PS_RULE_BESS_DECISION
tests_regression/v2/StatusRulesCulliganTests.gs     + REG_BESS_DECISION_CULLIGAN
CHANGELOG.md / README_4.46.0.md
```

## Deploy

```bash
git pull
unzip -o ~/Downloads/argia_v4.46.0_T10c.zip -d .
node scripts/full_selftest.js

git add -A
git commit -m 'T10c: status rules pack -- BESS-decision transparency rule'
git push

clasp push --force 2>&1 | tee .clasp_last_push.log
node scripts/verify_deploy.js --clasp-log .clasp_last_push.log
```

Then run the CULLIGAN E2E. Expected: **still all-green** plus the new BESS-decision assertions
(included → PASS, emittable). No financial goldens move.
