// ===== ERROR RESPONSES =====
// Raw exception text (SQL errors, filesystem paths, driver internals) must not reach
// clients in production. Log it server-side; return a generic message.

function serverError(res, e) {
  console.error('[error]', e && e.stack ? e.stack : e);
  const body = { error: 'Internal server error' };
  // Keep the detail in dev/test for debuggability only.
  if (process.env.NODE_ENV !== 'production') body.detail = e && e.message;
  return res.status(500).json(body);
}

module.exports = { serverError };
