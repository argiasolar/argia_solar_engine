# ARGIA v4.38.0 — T5: interconnection-mode single source

Builds on **4.37.0 (T3)** — apply that first if you haven't. Extract over repo root, then run the
deploy block at the bottom.

## What this fixes

The interconnection mode (`NET_METERING` / `NET_BILLING` / `ZERO_EXPORT`) is set once in
`INPUT_CFE!C41`. The simulation resolves it through `readBessInterconnectionFromInputCfe`. But the
outputs used to re-derive it themselves from raw C41 — so CFE_OUTPUT could **show a mode the sim
never ran** (a typo'd value passed through verbatim while the sim treated it as `UNKNOWN`). Now every
output reads the one resolver, so **output mode == sim mode** by construction.

## Files in this package

| Path | Change |
|------|--------|
| `writers_v2/WriteCfeOutputV2.js` | header strip derives the displayed mode from the resolver (`_cfeOutV2_canonicalModeToRawEnum`); deletes the divergent raw read |
| `writers_v2/WriteApiOutputV2.js` | `interconnection_mode` = canonical resolved mode (`_apiInterconnMode`), not raw Spanish |
| `09d_ConsistencyGuard.js` | registry mode note: now locked by `REG_INTERCONN_MODE_CONSISTENT` |
| `tests_unit/writers_v2/InterconnModeSingleSourceTests.gs` | **NEW** `UNIT_INTERCONN_MODE_SINGLE_SOURCE` |
| `tests_regression/v2/InterconnModeConsistentTests.gs` | **NEW** `REG_INTERCONN_MODE_CONSISTENT` |
| `00a_Version.js` | 4.37.0 → **4.38.0** |
| `CHANGELOG.md` | 4.38.0 entry |

## Behavior change

- **CFE_OUTPUT display: byte-identical** on recognized inputs (CULLIGAN stays "MEDICIÓN NETA
  (NET_METERING)").
- **API_OUTPUT `interconnection_mode`: `NET_METERING`** now (was `MEDICION_NETA`) — canonical, matches
  the sim. This is the one visible change; nothing else in API moves.
- Unrecognized C41 now displays **"(no definido)"** instead of a bogus passthrough.

## Verified before handover

- Live chain against your CULLIGAN workbook: resolver `NET_METERING` → API `NET_METERING` → CFE
  display `"MEDICIÓN NETA (NET_METERING)"` (identical to before). Fork case (typo'd C41) → `UNKNOWN`
  → `"(no definido)"`.
- `node scripts/full_selftest.js`: **ALL GREEN**, Unit FAILs 0, Unit ERRORs 0, 46 workbook-dependent.
- New unit test RAN + PASS; the locked label/warning helper tests (`UNIT_CFE_STRATEGY_EXPLAINER`) and
  the resolver tests still pass (helpers untouched). `REG_INTERCONN_MODE_CONSISTENT` RAN + workbook-error (expected).
- `node --check` clean; `^--` grep clean (code files); fresh-clone round-trip green.

## Heads-up (flagged, not fixed here)

`04a_CalcCFEBill.js` defaults an *unset* mode to `MEDICION_NETA` while the resolver defaults to
`UNKNOWN` — a deeper default-policy difference in the (golden-locked) bill calc. Out of scope for this
surgical chunk; noted for a future pass. The observable sim-vs-output fork is closed.

---

## Deploy (GitHub + clasp)

```bash
git pull
unzip -o ~/Downloads/argia_v4.38.0_T5.zip -d .
node scripts/full_selftest.js

git add -A
git commit -m 'T5: interconnection-mode single source; outputs read the one resolver, API mode canonical'
git push

clasp push --force 2>&1 | tee .clasp_last_push.log
node scripts/verify_deploy.js --clasp-log .clasp_last_push.log
```

> A version MISMATCH right after push is the Apps Script CDN cache — wait ~5 min and re-run the
> verify line. Both targets (`git push`, `clasp push`) are independent; verify confirms both.
