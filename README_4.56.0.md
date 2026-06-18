# ARGIA Engine — v4.56.0 (T12-b round 2 + graceful popup close)

Second capture run findings, plus the progress-popup close you asked for.

## Fixed
1. **Range writes (the abort).** `writeInput` range keys need a 2D array (`[[12 values]]`); the fixtures
   store 1D, so every write threw `cfeKwhBase requires 2D array`. `_synthWriteInput` now wraps 1D →
   single-row 2D for range keys. This unblocks the engine run.
2. **Capture accumulates.** `_SYNTH_CAPTURE` now MERGES instead of clearing, so running fixtures one at
   a time builds up all three columns.
3. **Time budget.** Apps Script kills any execution at ~6 min — three engine runs can't fit in one. Run
   ALL now stops gracefully after ~4 min and tells you which fixtures remain, instead of being killed
   mid-run (which is what left the popup stuck).
4. **Popup close.** The progress dialog now has a **Cerrar** button, so you can always dismiss it —
   including after a hard timeout where the script itself can't close it.

Self-test ALL GREEN.

## How to run it (important)
Run fixtures **one at a time** — they each fit the 6-min cap and accumulate into `_SYNTH_CAPTURE`:
- Administrator Panel → Test → Synthetic Test Mode → **Run SYNTH_500**, wait for the alert
- then **Run SYNTH_600**, then **Run SYNTH_650**

`_SYNTH_CAPTURE` will fill column by column. (Run ALL still exists but is best-effort: it does what
fits in 6 min and reports the rest.)

## Files
```
00a_Version.js          4.55.0 -> 4.56.0
40_SyntheticE2E.js      2D range adapter + capture merge + time budget
00_Main.js              Cerrar button on the progress dialog
CHANGELOG.md / README_4.56.0.md
```

## Deploy
```bash
git pull
unzip -o ~/Downloads/argia_v4.56.0_T12b_round2.zip -d .
node scripts/full_selftest.js

git add -A
git commit -m 'T12-b round 2: 2D range writes, capture accumulation, time budget, popup close'
git push

clasp push --force 2>&1 | tee .clasp_last_push.log
node scripts/verify_deploy.js --clasp-log .clasp_last_push.log
```

## Then capture, one fixture at a time
Run SYNTH_500, then 600, then 650 (individually). Paste `_SYNTH_CAPTURE` back here once the three
columns differ. I'll sanity-check (sizes scale 500/600/650? SYNTH_650 BLOCKED on blank structure?
SYNTH_500 BESS zero?) and flag any remaining input-value gaps before chunk c locks the goldens.
