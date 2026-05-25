// =============================================================================
// ARGIA ENGINE v2 -- File: templates/ActiveChunk.gs
// -----------------------------------------------------------------------------
// Tiny shim: tracks the active migration chunk so a single menu item ("Run
// Tests for Current Chunk") can run only the tests for whatever chunk we're
// currently working on. Bump ACTIVE_CHUNK_TAG on chunk transition.
//
// WHY THIS EXISTS
//   The full regression suite takes ~2.5 minutes. While building a chunk we
//   want a ~5-second feedback loop on the specific tests we just shipped.
//   Every test in this migration is tagged with its chunk number ("chunk0",
//   "chunk1", etc.); runTestsByTag(tag) filters to just those tests.
//
// HOW TO USE
//   - Update ACTIVE_CHUNK_TAG below when starting a new chunk.
//   - From the ARGIA menu, click "Run Tests for Current Chunk".
//   - The chunk-specific tests run; nothing else is touched.
//
// HOW THE TAG IS SET ON A TEST
//   Each registerTest() call sets a `tags` array; we add the chunk name to it.
//   Example: tags: ['templates', 'v2', 'registry', 'chunk0']
//
// =============================================================================


// The currently-active chunk. Bump this when starting a new chunk.
// Valid values during migration: 'chunk0' .. 'chunk12', plus 'bdf1' .. 'bdf5'
// for the BESS Designer Flow track that runs parallel to output migration.
var ACTIVE_CHUNK_TAG = 'bess_install';


/**
 * Run all tests tagged with the currently-active chunk. Wired into the
 * ARGIA menu as "▶ Run Tests for Current Chunk".
 *
 * Returns the same shape as runUnitTests/runAllTests so the existing
 * results-sheet writer formats output normally.
 */
function runCurrentChunkTests() {
  if (typeof runTestsByTag !== 'function') {
    throw new Error('runCurrentChunkTests: runTestsByTag is not defined. '
                  + 'Make sure test/TestRunner.gs is loaded.');
  }
  return runTestsByTag(ACTIVE_CHUNK_TAG);
}
