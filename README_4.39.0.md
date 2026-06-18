# ARGIA v4.39.0 — T4: PROJECT_STATUS engine + offer gate

Builds on **4.38.0 (T5)** — apply that first if you haven't. Extract over repo root, then run the
deploy block at the bottom.

## What this adds

A single engine that decides whether a project is sellable. Each rule returns
`{ level, code, message, evidence }`; the engine reduces them to the worst level
(**PASS → PASS_WITH_WARNINGS → REVIEW_REQUIRED → BLOCKED**) and surfaces it on `_META`, the Project
Card, and `API_OUTPUT.project_status`. The PDF/offer export path is gated on it. Ships with one
trivial rule (has-CAPEX); the real rules plug in at **T10** — they all reduce through this one engine
instead of each inventing its own gate.

## Files in this package

| Path | Change |
|------|--------|
| `33_CalcProjectStatus.js` | **NEW** engine: `reduceProjectStatus`, `isOfferEmittable`, `_psRuleHasCapex`, `runProjectStatus`, `assertOfferEmittable` |
| `writers_v2/WriteApiOutputV2.js` | `project_status` = real engine result (was `PENDING_T4`) |
| `12_ExportPDF.js` | `_runExport` gates offer-class exports on status (override prompt; BLOCKED hard-refuses) |
| `00_Main.js` | `runGenerateAllDeliverables` runs the status engine at the end |
| `tests_unit/calc/ProjectStatusTests.gs` | **NEW** 3 pure tests (reduce / gate / rule) |
| `tests_regression/v2/ProjectStatusCulliganTests.gs` | **NEW** `REG_PROJECT_STATUS_CULLIGAN` |
| `00a_Version.js` | 4.38.0 → **4.39.0** |
| `CHANGELOG.md` | 4.39.0 entry |

## The gate (offer/PDF)

| status | exports? |
|---|---|
| PASS | yes, silently |
| PASS_WITH_WARNINGS / REVIEW_REQUIRED | only with explicit override prompt |
| BLOCKED | **never** (hard stop, override ignored) |

Gated exports: PROJECT_CARD, CLIENT_FINANCIALS, BAAS_PROJECTION (the customer-facing offer docs).
Internal exports (MDC / BOM / RFQ / INSTALLATION) are not gated.

## Design notes

- **Fail-closed reducer:** an unknown rule level ranks as BLOCKED, so a malformed rule can never
  silently let an offer through.
- **Project Card surface:** status writes to **row 2** — a blank spacer row, no merges/frozen panes,
  on a regenerated output sheet — so the template layout is untouched.
- **Zero real rules yet** (just has-CAPEX), exactly as the plan specifies; T10 adds the rule set.

## Verified before handover

- Live: CULLIGAN (CAPEX 37,051,893) → **PASS**, emittable. A no-CAPEX project → **BLOCKED**, and
  override cannot bypass it.
- `node scripts/full_selftest.js`: **ALL GREEN**, Unit FAILs 0, Unit ERRORs 0, 47 workbook-dependent.
- 3 new unit tests confirmed RAN + PASS; `REG_PROJECT_STATUS_CULLIGAN` RAN + workbook-error (expected).
- `node --check` clean; `^--` grep clean (code files); fresh-clone round-trip green.

## After deploy

Run **Generate ALL Deliverables**, then the CULLIGAN E2E. The summary will show
"✅ Project status: PASS", `_META` gets a `PROJECT_STATUS  PASS (CAPEX_PRESENT) @ …` stamp, Project
Card row 2 shows "ESTADO DEL PROYECTO: PASS", and `API_OUTPUT.project_status = PASS`. Exporting an
offer doc while a project is BLOCKED will be refused.

---

## Deploy (GitHub + clasp)

```bash
git pull
unzip -o ~/Downloads/argia_v4.39.0_T4.zip -d .
node scripts/full_selftest.js

git add -A
git commit -m 'T4: PROJECT_STATUS engine + offer gate; one trivial rule, T10 plugs in the rest'
git push

clasp push --force 2>&1 | tee .clasp_last_push.log
node scripts/verify_deploy.js --clasp-log .clasp_last_push.log
```

> A version MISMATCH right after push is the Apps Script CDN cache — wait ~5 min and re-run the
> verify line. Both targets (`git push`, `clasp push`) are independent; verify confirms both.
