/**
 * FRONTEND BUILD OUTPUT TESTS
 *
 * The frontend is a Vite + React + TypeScript app (source in frontend/src). The old
 * suite string-matched a single hand-written HTML file; that file no longer exists, and
 * asserting against minified bundle text would test the minifier, not the app.
 *
 * These tests instead check the contract between the build and the Express server:
 * the artifacts the server serves must exist and be wired correctly. Behaviour is
 * covered by the API tests and by driving the real app.
 */
const fs = require('fs');
const path = require('path');

const BUILD_DIR = path.join(__dirname, '..', '..', '..', 'frontend', 'build');
const INDEX = path.join(BUILD_DIR, 'index.html');

const built = fs.existsSync(INDEX);

// Skip rather than fail when the app hasn't been built — `npm test` must not
// depend on someone having run `npm run build` first.
const describeIfBuilt = built ? describe : describe.skip;

describeIfBuilt('Built SPA shell', () => {
  let html;
  beforeAll(() => {
    html = fs.readFileSync(INDEX, 'utf8');
  });

  test('is a valid HTML document', () => {
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });

  test('has the React mount point', () => {
    expect(html).toContain('id="root"');
  });

  test('loads a hashed ES module bundle, not a CDN or in-browser transpiler', () => {
    expect(html).toMatch(/<script[^>]+type="module"[^>]+src="\/assets\/index-[^"]+\.js"/);
    expect(html).not.toContain('babel');
    expect(html).not.toContain('cdnjs.cloudflare.com');
  });

  test('links a hashed stylesheet', () => {
    expect(html).toMatch(/<link[^>]+rel="stylesheet"[^>]+href="\/assets\/index-[^"]+\.css"/);
  });

  test('references only assets that exist on disk', () => {
    const refs = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(fs.existsSync(path.join(BUILD_DIR, ref.replace(/^\//, '')))).toBe(true);
    }
  });
});

describeIfBuilt('Served artifacts', () => {
  test('the wiki app is still published alongside the SPA', () => {
    // server.js serves GET /wiki from frontend/build/wiki.html — the Vite build must
    // not wipe it (it is kept in frontend/public and copied through).
    expect(fs.existsSync(path.join(BUILD_DIR, 'wiki.html'))).toBe(true);
  });
});

describeIfBuilt('Bundle wiring', () => {
  let bundle;
  beforeAll(() => {
    const html = fs.readFileSync(INDEX, 'utf8');
    const entry = html.match(/src="\/assets\/(index-[^"]+\.js)"/)[1];
    bundle = fs.readFileSync(path.join(BUILD_DIR, 'assets', entry), 'utf8');
  });

  test('calls the API under a relative /api path (no hardcoded host)', () => {
    expect(bundle).toContain('/api');
    expect(bundle).not.toContain('http://localhost:3001');
  });

  test('authenticates with the session token header only', () => {
    expect(bundle).toContain('x-auth-token');
    // The legacy identity headers were an auth bypass; they must not come back.
    expect(bundle).not.toContain('x-user-id');
    expect(bundle).not.toContain('x-user-role');
  });
});
