# Chunk 6 — RFQs_v2

Drop-in scaffold for the RFQs_v2 migration of the ARGIA Solar Engine.

## What's in the box

### New source files (drop into the repo at the indicated paths)

```
templates/RfqRegistry.js                       (registry: 6 RFQ categories)
templates/setupRfqTemplate.js                  (generic parameterized template)
writers_v2/helpers/RfqBomReader.js             (reads from BOM_v2, not legacy)
writers_v2/WriteRfqV2.js                       (generic writer + menu entry)
```

### New test files

```
tests_unit/templates/RfqRegistryTests.gs       (8 tests, 139 assertions)
tests_unit/templates/RfqTemplateTests.gs       (8 tests, 48 assertions)
tests_unit/writers_v2/RfqBomReaderTests.gs     (8 tests, 32 assertions)
tests_unit/writers_v2/WriteRfqV2Tests.gs       (12 tests, 29 assertions)
```

Total: **36 tests, 248 assertions — all green locally.**

### Required edits to existing repo files

See **PATCHES.md**. Five edits total:

1. `templates/TemplateRegistry.js` — add `RFQ_BESS` to four locations
2. `templates/ActiveChunk.js` — bump tag `chunk5` → `chunk6`
3. `00a_Version.js` — bump `ENGINE_VERSION` `3.3.0` → `3.4.0` (+ release note)
4. `00_Main.js` — add menu item `Generate RFQs v2` after the legacy one
5. `CHANGELOG.md` — add `[3.4.0]` entry at the top

### Test runner (do not push to Apps Script)

```
run_tests.js   (Node shim that runs the 36 tests locally without GAS)
```

To run:

```bash
node run_tests.js
```

Expected output ends with `ALL GREEN`. This file is for local verification
only — don't include it in the clasp push.

## Apply order

1. Copy the 4 source files to their target paths in the repo
2. Copy the 4 test files to their target paths
3. Apply each of the 5 edits in PATCHES.md
4. `clasp push` everything
5. Run "Generate RFQs v2" from the ARGIA menu in a real workbook
6. Visually compare against legacy RFQs (5 shared categories) and confirm
   RFQ_BESS_v2 shows battery + commissioning lines

## What's verified vs not

| Item                                      | Status                  |
|-------------------------------------------|-------------------------|
| Source files: `node --check` syntax       | ✅                       |
| 36 unit tests pass                        | ✅                       |
| BESS row split logic (test invariant)     | ✅                       |
| RFQ number format `RFQ-<code>-<proj>-<yr>`| ✅                       |
| Visual parity with legacy RFQs            | ⚠️  pending push        |
| BESS-02..BESS-11 actually populated       | ⚠️  depends on BOM_v2   |
| `_insertArgiaLogo` integration            | ⚠️  mocked in tests     |
| 6-min Apps Script quota                   | ✅  RFQs are menu-only  |

## Architectural decisions locked in this drop

- **6 RFQs total**, not 5 (added RFQ_BESS_v2)
- BESS battery row 80 + commissioning row 91 → `RFQ_BESS_v2`
- BESS electrical rows 81-90 → `RFQ_ELECTRICO_v2`
- RFQ year sourced from `_META!B6` (calculated_at), fallback `new Date()`
- Default currency for RFQ_BESS_v2: **MXN**
- RFQs are **menu-only**, NOT wired into `runArgiaEngine()`
- Zero references to legacy 15_WriteRFQ.js symbols (RFQ_COLORS,
  RFQ_SHEETS, writeRfqSheet_, readBomItems_, runWriteAllRFQs)
- v2 reads from BOM_v2; at cutover, BOM_v2→BOM rename updates one constant
