// ===== FILE STORAGE =====
// Uploads are kept on local disk in backend/uploads. On a host whose disk is
// erased on redeploy, mount a persistent volume there or files will be lost.
//
// Files are served *through* Atlas (see routes/attachments.js), so the existing
// auth + signed-URL checks remain the only way to read one.

const fs = require('fs');
const path = require('path');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

/** Store one file. `filename` is the generated unique name, never the user's. */
async function putFile(filename, buffer) {
  await fs.promises.mkdir(UPLOADS_DIR, { recursive: true });
  await fs.promises.writeFile(path.join(UPLOADS_DIR, filename), buffer);
}

/** A readable stream of the file, or null when it does not exist. */
async function getFileStream(filename) {
  const p = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(p)) return null;
  return fs.createReadStream(p);
}

async function deleteFile(filename) {
  const p = path.join(UPLOADS_DIR, filename);
  if (fs.existsSync(p)) await fs.promises.unlink(p);
}

/**
 * Pipe a stored file to an Express response. Callers set their own headers
 * (Content-Type, Content-Disposition, CSP) before calling this.
 *
 * The 'error' handler is load-bearing: without it a read that fails mid-transfer
 * becomes an unhandled 'error' event, which takes the whole process down.
 */
function pipeToResponse(stream, res) {
  stream.on('error', () => { if (!res.headersSent) res.sendStatus(500); else res.destroy(); });
  stream.pipe(res);
}

module.exports = {
  putFile,
  getFileStream,
  deleteFile,
  pipeToResponse,
};
