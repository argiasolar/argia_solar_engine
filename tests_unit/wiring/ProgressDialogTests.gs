// =============================================================================
// ARGIA -- tests_unit/wiring/ProgressDialogTests.gs
// -----------------------------------------------------------------------------
// Locks the modeless progress-dialog self-close contract.
//
// The dialog (showModelessDialog) has NO server-side close -- it polls
// getArgiaProgress() and closes itself ONLY when done === true, where
//   done = (step >= total) && !_ARGIA_PROGRESS_EXTERNAL
//
// BUG (4.22.0): the ZERO_EXPORT E2E left the bar at _setArgiaProgress(5, 6, ...)
// and relied on a NON-EXISTENT _hideArgiaProgress() to close it. The
// ReferenceError was swallowed; done was never true; the dialog hung at 83%
// forever. These tests lock the two halves of the contract so any future
// caller that forgets to reach (total,total) with EXTERNAL cleared is caught.
// =============================================================================

registerTest({
  id      : 'UNIT_PROGRESS_DIALOG_DONE_CONTRACT',
  group   : 'unit',
  module  : 'wiring/progress_dialog',
  scenarios: [],
  tags    : ['wiring', 'progress', 'ui', 'regression'],
  source  : 'tests_unit/wiring/ProgressDialogTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT wiring/progress_dialog: done-flag self-close contract');

    // --- the HANG condition: step < total -> done MUST be false (still polling)
    _ARGIA_PROGRESS_EXTERNAL = false;
    _setArgiaProgress(5, 6, 'restaurando\u2026');
    t.assert('5/6 -> pct 83', 83, getArgiaProgress().pct);
    t.assertTrue('5/6 -> done FALSE (dialog keeps polling)', getArgiaProgress().done === false);

    // --- the CLEAN-CLOSE condition: step == total, EXTERNAL cleared -> done true
    _ARGIA_PROGRESS_EXTERNAL = false;
    _setArgiaProgress(6, 6, '\u2705 listo');
    t.assert('6/6 -> pct 100', 100, getArgiaProgress().pct);
    t.assertTrue('6/6 + EXTERNAL false -> done TRUE (dialog self-closes)',
                 getArgiaProgress().done === true);

    // --- EXTERNAL guard: even at total/total, if EXTERNAL is still true the
    //     dialog must NOT close (an external orchestrator owns the bar).
    _ARGIA_PROGRESS_EXTERNAL = true;
    _setArgiaProgress(6, 6, 'externally driven');
    t.assertTrue('6/6 but EXTERNAL true -> done FALSE (external owner controls close)',
                 getArgiaProgress().done === false);

    // reset so we don't leak state into other tests
    _ARGIA_PROGRESS_EXTERNAL = false;
    _setArgiaProgress(1, 1, 'reset');
  }
});
