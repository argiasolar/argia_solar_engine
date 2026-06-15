#!/usr/bin/env node
/* =============================================================================
 * ARGIA -- scripts/verify_deploy.js
 * -----------------------------------------------------------------------------
 * Post-deploy guard. Confirms the code you THINK you shipped is actually live
 * on BOTH independent targets: GitHub (git push) and Apps Script (clasp push).
 *
 * Motivated by two real silent-deployment gaps:
 *   - 4.16.1: a file was reverted while the version/CHANGELOG moved forward
 *             -> GitHub content disagreed with what was supposedly shipped.
 *   - 4.22.0: git push succeeded but `clasp push` failed with an OAuth reauth
 *             error (invalid_rapt) that scrolled past -> Apps Script went stale
 *             while everything LOOKED fine.
 *
 * USAGE (run AFTER `git push` and `clasp push`):
 *   # capture the clasp push output so this can check it:
 *   clasp push --force 2>&1 | tee .clasp_last_push.log
 *   node scripts/verify_deploy.js --clasp-log .clasp_last_push.log
 *
 *   # or GitHub-only (no clasp log):
 *   node scripts/verify_deploy.js
 *
 *   # run its own unit tests:
 *   node scripts/verify_deploy.js --self-test
 *
 * Exit code 0 = all checks passed; 1 = a discrepancy was found (CI-friendly).
 *
 * WHAT IT CATCHES / WHAT IT DOES NOT (honest scope):
 *   [x] local tree not pushed / partially pushed / wrong branch  (GitHub diff)
 *   [x] clasp push failed silently (auth/reauth/other error)     (clasp-log scan)
 *   [ ] a self-consistent-but-WRONG local tree (local == GitHub, both wrong) --
 *       that is the job of behavior tests + minimal-file deliveries, not this.
 * ============================================================================= */

'use strict';

var fs   = require('fs');
var path = require('path');
var https = require('https');
var crypto = require('crypto');
var cp = require('child_process');

var REPO_RAW = 'https://raw.githubusercontent.com/argiasolar/argia_solar_engine/main/';

/* ---- pure helpers (unit-tested below) ------------------------------------ */

// Extract ENGINE_VERSION from 00a_Version.js text. Returns null if absent.
function extractVersion(text) {
  if (typeof text !== 'string') return null;
  var m = text.match(/ENGINE_VERSION\s*=\s*'([^']+)'/);
  return m ? m[1] : null;
}

// Scan captured `clasp push` output for failure signatures. Returns
// { ok, reason } -- ok:false means the push did NOT land.
function detectClaspError(output) {
  if (typeof output !== 'string' || output.length === 0) {
    return { ok: false, reason: 'empty clasp output (push may not have run)' };
  }
  var low = output.toLowerCase();
  // OAuth / reauth failures (the 4.22.0 case).
  if (/invalid_grant|invalid_rapt|reauth|invalid credentials|login.*required|not logged in/.test(low)) {
    return { ok: false, reason: 'clasp auth/reauth failure -- run: clasp login' };
  }
  // Any JSON error blob clasp prints on failure.
  if (/"error"\s*:/.test(low) || /\berror_description\b/.test(low)) {
    return { ok: false, reason: 'clasp returned an error object (push did not complete)' };
  }
  if (/permission|forbidden|403|unauthorized|401/.test(low)) {
    return { ok: false, reason: 'clasp permission error' };
  }
  // Success signature: clasp prints "Pushed N files." on success.
  if (/pushed\s+\d+\s+file/.test(low)) {
    return { ok: true, reason: 'clasp reported a successful push' };
  }
  // No explicit success line and no error -> inconclusive, treat as suspect.
  return { ok: false, reason: 'no "Pushed N files" success line found in clasp output' };
}

// Convert .claspignore glob patterns to a predicate: isIgnored(relPath) -> bool.
// Supports the small subset actually used: `dir/**`, `**/*.ext`, `**/name/**`,
// and exact paths.
function makeIgnoreMatcher(claspignoreText) {
  var pats = (claspignoreText || '')
    .split(/\r?\n/)
    .map(function (l) { return l.trim(); })
    .filter(function (l) { return l && l.charAt(0) !== '#'; });

  var regexes = pats.map(function (p) {
    // escape regex specials except * and /
    var rx = p.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    // Use placeholders so the single-* rule can't corrupt the ** expansions.
    rx = rx.replace(/\*\*\//g, '\u0001'); // **/  -> any leading dirs (incl none)
    rx = rx.replace(/\*\*/g, '\u0002');   // **   -> anything across segments
    rx = rx.replace(/\*/g, '[^/]*');      // *    -> anything within a segment
    rx = rx.replace(/\u0001/g, '(?:.*/)?');
    rx = rx.replace(/\u0002/g, '.*');
    return new RegExp('^' + rx + '$');
  });

  return function isIgnored(relPath) {
    var p = relPath.replace(/\\/g, '/');
    for (var i = 0; i < regexes.length; i++) if (regexes[i].test(p)) return true;
    return false;
  };
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Normalize line endings so CRLF (Windows working copy) vs LF (GitHub raw)
// does not produce false-positive diffs.
function normalizeForHash(buf) {
  return Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

/* ---- file walking -------------------------------------------------------- */

function listPushableFiles(root, isIgnored) {
  var out = [];
  (function walk(dir) {
    var ents = fs.readdirSync(dir, { withFileTypes: true });
    ents.forEach(function (e) {
      if (e.name === '.git' || e.name === 'node_modules') return;
      var full = path.join(dir, e.name);
      var rel = path.relative(root, full).replace(/\\/g, '/');
      if (e.isDirectory()) { walk(full); return; }
      if (!/\.(gs|js)$/.test(e.name)) return;     // Apps Script source only
      if (isIgnored(rel)) return;                  // respect .claspignore
      out.push(rel);
    });
  })(root);
  return out.sort();
}

/* ---- network ------------------------------------------------------------- */

function fetchRaw(relPath) {
  return new Promise(function (resolve) {
    https.get(REPO_RAW + relPath, function (res) {
      if (res.statusCode !== 200) { res.resume(); resolve({ ok: false, status: res.statusCode }); return; }
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () { resolve({ ok: true, body: Buffer.concat(chunks) }); });
    }).on('error', function (e) { resolve({ ok: false, error: e.message }); });
  });
}

/* ---- main verification --------------------------------------------------- */

function verifyGitHub(root) {
  var ignoreText = '';
  try { ignoreText = fs.readFileSync(path.join(root, '.claspignore'), 'utf8'); } catch (_) {}
  var isIgnored = makeIgnoreMatcher(ignoreText);
  var files = listPushableFiles(root, isIgnored);

  // Version sanity first (fast, high-signal).
  var localVer = extractVersion(fs.readFileSync(path.join(root, '00a_Version.js'), 'utf8'));

  return fetchRaw('00a_Version.js').then(function (vres) {
    var ghVer = vres.ok ? extractVersion(vres.body.toString('utf8')) : null;
    var result = { localVer: localVer, ghVer: ghVer, total: files.length, mismatches: [], missing: [], netErrors: 0 };

    if (localVer !== ghVer) {
      result.mismatches.push({ file: '00a_Version.js', note: 'version local=' + localVer + ' github=' + ghVer });
    }

    // Walk all pushable files, comparing normalized content hashes.
    var i = 0;
    function next() {
      if (i >= files.length) return Promise.resolve(result);
      var rel = files[i++];
      var localHash = sha256(normalizeForHash(fs.readFileSync(path.join(root, rel))));
      return fetchRaw(rel).then(function (r) {
        if (!r.ok) {
          if (r.status === 404) result.missing.push(rel);
          else result.netErrors++;
        } else {
          var ghHash = sha256(normalizeForHash(r.body));
          if (ghHash !== localHash && rel !== '00a_Version.js') {
            result.mismatches.push({ file: rel, note: 'content differs from GitHub main' });
          }
        }
        return next();
      });
    }
    return next();
  });
}

function run() {
  var args = process.argv.slice(2);
  if (args.indexOf('--self-test') >= 0) return selfTest();

  var claspLogIdx = args.indexOf('--clasp-log');
  var claspLog = claspLogIdx >= 0 ? args[claspLogIdx + 1] : null;
  var root = process.cwd();

  console.log('ARGIA deploy verification');
  console.log('repo root: ' + root);
  console.log('');

  verifyGitHub(root).then(function (gh) {
    var ghOk = (gh.mismatches.length === 0 && gh.missing.length === 0);
    console.log('== GitHub (git push target) ==');
    console.log('  local version : ' + gh.localVer);
    console.log('  github version: ' + gh.ghVer + (gh.localVer === gh.ghVer ? '  [match]' : '  [MISMATCH]'));
    console.log('  files checked : ' + gh.total);
    if (gh.netErrors) console.log('  net errors    : ' + gh.netErrors + ' (re-run; transient)');
    if (gh.missing.length)  console.log('  MISSING on GitHub (' + gh.missing.length + '): ' + gh.missing.slice(0, 8).join(', ') + (gh.missing.length > 8 ? ' …' : ''));
    if (gh.mismatches.length) {
      console.log('  CONTENT MISMATCH (' + gh.mismatches.length + '):');
      gh.mismatches.slice(0, 20).forEach(function (m) { console.log('    - ' + m.file + '  (' + m.note + ')'); });
    }
    console.log('  -> ' + (ghOk ? 'PASS: local tree matches GitHub main' : 'FAIL: local tree and GitHub main DISAGREE (push, or check branch)'));
    console.log('');

    // Apps Script (clasp) check.
    var claspOk = null, claspReason = '';
    console.log('== Apps Script (clasp push target) ==');
    if (claspLog) {
      var out = '';
      try { out = fs.readFileSync(claspLog, 'utf8'); } catch (e) { out = ''; }
      var c = detectClaspError(out);
      claspOk = c.ok; claspReason = c.reason;
      console.log('  clasp log     : ' + claspLog);
      console.log('  -> ' + (claspOk ? 'PASS: ' : 'FAIL: ') + claspReason);
    } else {
      console.log('  (no --clasp-log given; cannot verify Apps Script.)');
      console.log('  Re-run your push as:  clasp push --force 2>&1 | tee .clasp_last_push.log');
      console.log('  then:                 node scripts/verify_deploy.js --clasp-log .clasp_last_push.log');
    }
    console.log('');

    var allOk = ghOk && (claspOk !== false);
    console.log(allOk
      ? 'DEPLOY VERIFIED — both targets consistent (or clasp not checked).'
      : 'DEPLOY NOT VERIFIED — see failures above. Apps Script may be running OLD code.');
    process.exit(allOk ? 0 : 1);
  });
}

/* ---- self-test (pure functions) ------------------------------------------ */

function selfTest() {
  var pass = 0, fail = 0;
  function ok(label, cond) { if (cond) { pass++; } else { fail++; console.log('  FAIL: ' + label); } }

  // extractVersion
  ok('extractVersion basic', extractVersion("var ENGINE_VERSION = '4.22.0';") === '4.22.0');
  ok('extractVersion absent', extractVersion('no version here') === null);
  ok('extractVersion non-string', extractVersion(null) === null);

  // detectClaspError -- the 4.22.0 signatures
  ok('clasp invalid_rapt -> fail',
     detectClaspError('{"error":"invalid_grant","error_subtype":"invalid_rapt"}').ok === false);
  ok('clasp reauth -> fail', detectClaspError('reauth related error').ok === false);
  ok('clasp 403 -> fail', detectClaspError('Request had insufficient... 403 Forbidden').ok === false);
  ok('clasp success -> ok', detectClaspError('Pushed 222 files.').ok === true);
  ok('clasp empty -> fail', detectClaspError('').ok === false);
  ok('clasp no-success-line -> fail (suspect)', detectClaspError('some noise output').ok === false);

  // makeIgnoreMatcher
  var ig = makeIgnoreMatcher('scripts/**\n**/*.md\n**/__fixtures__/**');
  ok('ignore scripts/**', ig('scripts/full_selftest.js') === true);
  ok('ignore nested *.md', ig('docs/SPEC.md') === true);
  ok('ignore __fixtures__', ig('tests_unit/calc/__fixtures__/x.js') === true);
  ok('keep normal source', ig('writers_v2/WriteClientFinancialsV2.js') === false);
  ok('keep root version', ig('00a_Version.js') === false);

  // normalizeForHash -- CRLF vs LF must hash equal
  ok('CRLF==LF after normalize',
     sha256(normalizeForHash(Buffer.from('a\r\nb'))) === sha256(normalizeForHash(Buffer.from('a\nb'))));

  console.log('');
  console.log('verify_deploy self-test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
}

/* ---- exports for external test harness ------------------------------------ */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { extractVersion: extractVersion, detectClaspError: detectClaspError,
                     makeIgnoreMatcher: makeIgnoreMatcher, listPushableFiles: listPushableFiles,
                     normalizeForHash: normalizeForHash, sha256: sha256 };
}

if (require.main === module) run();
