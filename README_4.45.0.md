# ARGIA Engine — v4.45.0 (T10b: status rules pack — CFE data-quality score)

Second slice of **T10 — the PROJECT_STATUS rules pack**. Adds the CFE data-quality rule. CULLIGAN has
complete 12-month billing data → 100% → PASS / emittable.

---

## What's new — CFE data-quality rule (`36_CalcStatusRules.js`, reads INPUT_CFE)

A confident bill model needs complete billing history. The rule scores five dimensions and bands the
average:

| Dimension | Source (INPUT_CFE) |
|---|---|
| Tariff code present | C4 |
| kWh — months present / 12 | rows 10–12, cols C–N |
| kW — months present / 12 | rows 13–15, cols C–N |
| Power factor — months present / 12 | row 20, cols C–N |
| Billing days — months present / 12 | row 18, cols C–N |

| Score | Level | Code |
|---|---|---|
| `≥ 80%` | PASS | `CFE_DATA_OK` |
| `60–80%` | REVIEW_REQUIRED | `CFE_DATA_LOW` |
| `< 60%` | **BLOCKED** | `CFE_DATA_CRITICAL` |
| no INPUT_CFE | PASS (advisory) | `CFE_DQ_NOT_EVALUATED` |

Thresholds are configurable (`CFE_DQ_REVIEW_PCT`, `CFE_DQ_BLOCK_PCT`). Wired into the T4 engine
(guarded).

## Tests

- `UNIT_PS_RULE_CFE_DATA_QUALITY` — 100→PASS · 90→PASS · 70→REVIEW · 30→BLOCKED (override ignored) ·
  boundaries (80→PASS, 60→REVIEW) · no data → NOT_EVALUATED.
- `REG_CFE_DATA_QUALITY_CULLIGAN` (live) — CULLIGAN 12/12 on every dimension → PASS, emittable.

Self-test: **ALL GREEN**, 0 Unit FAIL / 0 Unit ERROR. Workbook-dependent 51 → **52** (+1 live REG).

## Heads-up: install-benchmark rule deferred (no false-gating)

CULLIGAN already trips the existing install-cost sanity check on every run:

```
InstallSanity WARNING  PV install 0.70 MXN/Wp below expected min 1.00 MXN/Wp
InstallSanity WARNING  BESS BoP 5.3 USD/kWh below expected min 30 USD/kWh
```

Those bounds (`02_LoadDB` `install_*` keys) look calibrated for *full* install cost, while this
engine's install figure is **labor + services only** (materials live in the BOM). So the
install-benchmark rule cannot gate on them without making the canonical fixture non-emittable. Per the
plan ("a rule with no data source → NOT_EVALUATED, never a false BLOCK"), it stays unbuilt pending your
call on: (a) recalibrating the labor-only bounds, and/or (b) seeding the 94M benchmark table.

## Remaining T10

| Rule | Reads | Status |
|---|---|---|
| Install-benchmark band | T8 | deferred — bounds/94M decision (above) |
| BESS-decision transparency | sim | own chunk (T10c) |

---

## Files

```
00a_Version.js                                      4.44.0 -> 4.45.0
36_CalcStatusRules.js                               + CFE data-quality rule
33_CalcProjectStatus.js                             collectProjectStatusRules += CFE rule (guarded)
tests_unit/calc/StatusRulesTests.gs                 + UNIT_PS_RULE_CFE_DATA_QUALITY
tests_regression/v2/StatusRulesCulliganTests.gs     + REG_CFE_DATA_QUALITY_CULLIGAN
CHANGELOG.md / README_4.45.0.md
```

## Deploy

```bash
git pull
unzip -o ~/Downloads/argia_v4.45.0_T10b.zip -d .
node scripts/full_selftest.js

git add -A
git commit -m 'T10b: status rules pack -- CFE data-quality score rule'
git push

clasp push --force 2>&1 | tee .clasp_last_push.log
node scripts/verify_deploy.js --clasp-log .clasp_last_push.log
```

Then run the CULLIGAN E2E. Expected: **still all-green** plus the new CFE-data-quality assertions
(100% → PASS, emittable). No financial goldens move.
