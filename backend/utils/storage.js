// ===== FILE STORAGE =====
// One interface, two backends:
//   • S3         — production. Chosen automatically when S3_BUCKET is set.
//   • local disk — development and tests, when it is not.
//
// Fargate erases a container's disk on every restart and deploy, so anything
// durable has to leave the container. Each tenant is confined to its own
// S3_PREFIX, and its IAM task role grants access to that prefix only — so a
// cross-tenant read is refused by AWS, not merely unlikely in application code.
//
// Files are still served *through* Atlas (see routes/attachments.js), so the
// existing auth + signed-URL checks remain the only way to read one. The bucket
// itself stays private.

const fs = require('fs');
const path = require('path');

const BUCKET = process.env.S3_BUCKET || null;
const PREFIX = (process.env.S3_PREFIX || '').replace(/^\/+|\/+$/g, '');
const REGION = process.env.AWS_REGION || 'ap-south-1';
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

const usingS3 = () => Boolean(BUCKET);
const keyFor = (filename) => (PREFIX ? `${PREFIX}/${filename}` : filename);

let client = null;
function s3() {
  if (!client) {
    const { S3Client } = require('@aws-sdk/client-s3');
    client = new S3Client({ region: REGION });
  }
  return client;
}

/** Store one file. `filename` is the generated unique name, never the user's. */
async function putFile(filename, buffer, contentType) {
  if (!usingS3()) {
    await fs.promises.mkdir(UPLOADS_DIR, { recursive: true });
    await fs.promises.writeFile(path.join(UPLOADS_DIR, filename), buffer);
    return;
  }
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  await s3().send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: keyFor(filename),
    Body: buffer,
    ContentType: contentType || 'application/octet-stream',
    ServerSideEncryption: 'AES256',
  }));
}

/** A readable stream of the file, or null when it does not exist. */
async function getFileStream(filename) {
  if (!usingS3()) {
    const p = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(p)) return null;
    return fs.createReadStream(p);
  }
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  try {
    const out = await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: keyFor(filename) }));
    return out.Body;
  } catch (e) {
    if (e.name === 'NoSuchKey' || e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return null;
    throw e;
  }
}

async function deleteFile(filename) {
  if (!usingS3()) {
    const p = path.join(UPLOADS_DIR, filename);
    if (fs.existsSync(p)) await fs.promises.unlink(p);
    return;
  }
  const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
  await s3().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: keyFor(filename) }));
}

/**
 * Pipe a stored file to an Express response. Callers set their own headers
 * (Content-Type, Content-Disposition, CSP) before calling this.
 *
 * The 'error' handler is load-bearing: without it a read that fails mid-transfer
 * becomes an unhandled 'error' event, which on Fargate takes the whole process
 * down and restarts that tenant.
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
  backend: () => (usingS3() ? 's3' : 'disk'),
};
