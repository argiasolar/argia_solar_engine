# ARGIA Engine — v4.43.0 (T9: BOM completeness families + SIN COTIZAR propagation)

**Closes G3 — "confident payback on incomplete CAPEX."** A BOM that omits a required material
family or carries an unpriced (SIN COTIZAR) line now propagates loudly: the Project Card shows
**INCOMPLETE (not PASS)**, the offer is **blocked** (override-only), and the financials headline
carries a **preliminary** caveat.

CULLIGAN is a complete, fully-priced project → it **stays PASS / emittable**. No financial goldens move.

---

## What's new

**`35_CalcBomCompleteness.js`** (new) — required-family checklist + completeness engine.

| Family | Type |
|---|---|
| PV modules, inverters, structure, DC, AC, monitoring/permits | **CORE** (always required) |
| Transformer, BESS | **Conditional** (required only when present) |

- `evaluateBomCompleteness(familyStatus)` — **pure**. Returns `requiredFamilies`, `presentFamilies`,
  `missingFamilies`, `sinCotizarFamilies`, `completenessPct`, `complete`.
- `runBomCompleteness(ss)` — **live**. Reads BOM_v2 once. Presence = section subtotal/quantity;
  SIN COTIZAR = the BOM writer's own **MISSING_PRICE red tint (`#FDECEA`)** inside the family's rows.
  An intentional *by-others* line (no tint — e.g. CULLIGAN's CFE-supplied transformer) is **not** a gap.
- `_psRuleBomCompleteness(c)` — **pure** PROJECT_STATUS rule: complete → `PASS`; missing/unpriced →
  `REVIEW_REQUIRED / BOM_INCOMPLETE`; no BOM → `BOM_NOT_EVALUATED` (never a false block).

## Propagation (3 surfaces)

1. **Project Card / offer gate** — `33_CalcProjectStatus.js` `collectProjectStatusRules` now includes
   the BOM rule (guarded). Non-PASS → `isOfferEmittable` is false unless explicitly overridden.
2. **Financials headline** — `31_/31a_` `argiaFinancialGuardNotes` gains a `BOM_INCOMPLETE` note,
   fired only when `bomIncomplete === true`, wired from `runBomCompleteness` in `runClientFinancials`.
3. **Completeness %** — exposed for T10's BOM status rule.

## Tests

- `UNIT_BOM_COMPLETENESS` — 100% complete · missing CORE family · SIN COTIZAR transformer · absent
  optional not required · completeness %.
- `UNIT_PS_RULE_BOM_COMPLETENESS` — rule levels + integration (reduce → REVIEW_REQUIRED → **offer not
  emittable** without override) + guard-note fires only when flagged.
- `REG_BOM_COMPLETENESS_CULLIGAN` (live) — CULLIGAN complete → PASS, offer emittable.

Self-test: **ALL GREEN**, 0 Unit FAIL / 0 Unit ERROR. Workbook-dependent count 49 → **50** (+1 live REG).

---

## Files

```
00a_Version.js                                      4.42.1 -> 4.43.0
35_CalcBomCompleteness.js                           NEW  (engine + rule)
33_CalcProjectStatus.js                             collectProjectStatusRules += BOM rule (guarded)
31_CalcClientFinancials.js                          argiaFinancialGuardNotes += BOM_INCOMPLETE (opt-in)
31a_RunClientFinancials.js                          wire runBomCompleteness -> guard notes
tests_unit/calc/BomCompletenessTests.gs             NEW
tests_regression/v2/BomCompletenessCulliganTests.gs NEW
CHANGELOG.md / README_4.43.0.md
```

## Deploy

```bash
git pull
unzip -o ~/Downloads/argia_v4.43.0_T9.zip -d .
node scripts/full_selftest.js

git add -A
git commit -m 'T9: BOM completeness families + SIN COTIZAR propagation to Project Card, offer gate, financials'
git push

clasp push --force 2>&1 | tee .clasp_last_push.log
node scripts/verify_deploy.js --clasp-log .clasp_last_push.log
```

Then run the CULLIGAN E2E. Expected: **still 169/169** plus the new BOM-completeness assertions
(complete → PASS, offer emittable). T9 does **not** move financial goldens.
