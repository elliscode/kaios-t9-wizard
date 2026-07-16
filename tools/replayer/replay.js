#!/usr/bin/env node
// Launches the interactive replay viewer for a given run JSON file.
//
//   node replay.js [path/to/run.json]   (defaults to runs/example.json)
//
// See README.md for the run JSON shape and an explanation of why this
// serves the harness over a tiny local HTTP server (rather than file://)
// and loads the game inside an iframe (rather than directly in the page).
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');
const { resolveInputLog } = require('./unpack.js');

const REPO_ROOT = path.join(__dirname, '..', '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

// Serves the whole repo root as static files -- the harness references
// version-pinned game files under /backend/lambda-replay/vendored/v<N>/ and
// current render/audio/sfx under /frontend-v3/js/ via root-relative paths,
// so everything needs to resolve from one common root regardless of how
// deep tools/replayer/ itself is nested. Read-only; this never accepts a
// request body or touches anything outside REPO_ROOT.
function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const filePath = path.join(REPO_ROOT, urlPath);
      // Refuse to serve anything that escapes REPO_ROOT (e.g. via `..`).
      if (!filePath.startsWith(REPO_ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Not found: ' + urlPath);
          return;
        }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function loadRun(runPath) {
  const raw = fs.readFileSync(runPath, 'utf8');
  const run = JSON.parse(raw);
  for (const field of ['version', 'seed', 'canvas_width', 'canvas_height', 'tick_count']) {
    if (run[field] === undefined) throw new Error(`run JSON is missing required field "${field}"`);
  }
  const input_log = resolveInputLog(run);
  return {
    version: run.version,
    seed: run.seed,
    canvas_width: run.canvas_width,
    canvas_height: run.canvas_height,
    tick_count: run.tick_count,
    input_log,
  };
}

async function main() {
  const runPath = path.resolve(process.argv[2] || path.join(__dirname, 'runs', 'example.json'));
  console.log(`Loading run: ${runPath}`);
  const replayData = loadRun(runPath);
  console.log(`  version=${replayData.version} seed=${replayData.seed} tick_count=${replayData.tick_count} moves=${replayData.input_log.length}`);

  const server = await startStaticServer();
  const { port } = server.address();
  console.log(`Serving repo root at http://127.0.0.1:${port}/`);

  // Outer window is sized to comfortably fit controls + the 240x294 game
  // frame + keypad side by side -- it does NOT need to match canvas_width/
  // canvas_height itself, since the game only ever sees the iframe's own
  // fixed 240x294 viewport (see game-frame.html) regardless of the outer
  // window size.
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 720, height: 480 } });
  const page = await context.newPage();

  // Applies to the top-level page AND every child frame/iframe it
  // navigates (including game-frame.html) -- both need window.__REPLAY_DATA__.
  await page.addInitScript((data) => {
    window.__REPLAY_DATA__ = data;
  }, replayData);

  await page.goto(`http://127.0.0.1:${port}/tools/replayer/index.html`);

  console.log('Replay viewer window is open. Close it (or Ctrl+C here) to exit.');
  await new Promise((resolve) => {
    page.on('close', resolve);
    browser.on('disconnected', resolve);
  });

  await server.close();
  await browser.close().catch(() => {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
