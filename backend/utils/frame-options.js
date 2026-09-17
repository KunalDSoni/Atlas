// X-Frame-Options per request path. The app stays unframeable (clickjacking)
// except the sample-data demo, which the landing page on this same origin
// embeds. The demo holds no real data and no session.
function frameOptionsFor(pathname) {
  return pathname === '/demo' || pathname.startsWith('/demo/') ? 'SAMEORIGIN' : 'DENY';
}

module.exports = { frameOptionsFor };
