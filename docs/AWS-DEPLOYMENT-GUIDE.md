# Deploying Atlas to AWS — Step-by-Step (First-Timer Guide)

This guide assumes you have **never deployed anything to AWS before**. Every step
says what to click, what to type, what you should see when it works, and what to
check when it doesn't. Each section opens with a plain-English *what this is
doing* so you are never following instructions blindly.

**What you are building:** two independent copies of Atlas, one per customer —

| Customer | URL | Its database | Its files |
| -------- | --- | ------------ | --------- |
| accesspoint | `https://accesspoint.open-atlas.xyz` | `accesspoint` in shared RDS | `s3://…/accesspoint/` |
| diligence | `https://diligence.open-atlas.xyz` | `diligence` in shared RDS | `s3://…/diligence/` |

Neither can read the other's data — separate database credentials, separate S3
prefixes, separate secrets. They share only hardware they never see.

**Time:** ~4–6 hours the first time (Phase 0's code work is most of it, and most
of the rest is waiting for AWS). The second customer takes ~25 minutes.

**Region used throughout:** `ap-south-1` (Mumbai). **Domain:** `open-atlas.xyz`,
registered at IONOS, DNS delegated to Route 53 (Phase 2).

> **⚠ Read this before you start — the AWS free plan is a sandbox with an expiry
> date.** A new AWS account gets $100 in credits (up to $200 with onboarding
> tasks) and **closes after 6 months or when the credits run out, whichever comes
> first.** When it closes you lose access to your resources and data, with 90
> days to upgrade and restore before permanent deletion.
>
> Two concrete limits bite immediately:
> - **RDS automated backup retention is capped at 1 day and cannot be raised**
>   (`FreeTierRestrictionError`). Your recovery point objective is 24 hours,
>   which makes Phase 14's nightly dumps mandatory rather than a nice-to-have.
> - **No Reserved Instances or Savings Plans**, so ~35% of available savings are
>   off the table.
>
> Use the free plan to build and rehearse this guide. **Upgrade to a paid
> account before either customer stores real data.**

---

## Table of contents

**Understand first**
1. [What you are actually deploying](#1-what-you-are-actually-deploying)
2. [The AWS services, in plain words](#2-the-aws-services-in-plain-words)
3. [Before you start — tools and accounts](#3-before-you-start--tools-and-accounts)

**Phase 0 — code changes (do this before any AWS work)**
4. [Phase 0.1 — Move file uploads to S3](#4-phase-01--move-file-uploads-to-s3)
5. [Phase 0.2 — Encrypt the database connection](#5-phase-02--encrypt-the-database-connection)
6. [Phase 0.3 — Bake the RDS certificate into the image](#6-phase-03--bake-the-rds-certificate-into-the-image)
7. [Phase 0.4 — Verify locally before going near AWS](#7-phase-04--verify-locally-before-going-near-aws)

**Phase 1–8 — shared infrastructure (built once, used by every customer)**
8. [Phase 1 — Secure the account, set a budget alarm](#8-phase-1--secure-the-account-set-a-budget-alarm)
9. [Phase 2 — Move DNS from IONOS to Route 53](#9-phase-2--move-dns-from-ionos-to-route-53)
10. [Phase 3 — Network and security groups](#10-phase-3--network-and-security-groups)
11. [Phase 4 — The database server (RDS MySQL)](#11-phase-4--the-database-server-rds-mysql)
12. [Phase 5 — The uploads bucket (S3)](#12-phase-5--the-uploads-bucket-s3)
13. [Phase 6 — Build and push the image (ECR)](#13-phase-6--build-and-push-the-image-ecr)
14. [Phase 7 — The wildcard certificate (ACM)](#14-phase-7--the-wildcard-certificate-acm)
15. [Phase 8 — Load balancer, cluster, and IAM roles](#15-phase-8--load-balancer-cluster-and-iam-roles)

**Phase 9–11 — the customers**
16. [Phase 9 — Deploy customer 1 (accesspoint)](#16-phase-9--deploy-customer-1-accesspoint)
17. [Phase 10 — Verify it actually works](#17-phase-10--verify-it-actually-works)
18. [Phase 11 — Deploy customer 2 (diligence)](#18-phase-11--deploy-customer-2-diligence)

**Operating it**
19. [Phase 12 — Releasing an update](#19-phase-12--releasing-an-update)
20. [Phase 13 — Backups](#20-phase-13--backups)
21. [Phase 14 — Monitoring and alerts](#21-phase-14--monitoring-and-alerts)
22. [Phase 15 — Removing a customer](#22-phase-15--removing-a-customer)
23. [Costs](#23-costs)
24. [Troubleshooting](#24-troubleshooting)
25. [What to automate next](#25-what-to-automate-next)
26. [Security checklist](#26-security-checklist)

---

## 1. What you are actually deploying

You might expect to deploy "a frontend" and "a backend" separately. **You are
not.** Atlas ships as **one Docker image**: the Vite/React app is built into
static files (`frontend/build/`) and the Express server serves both those files
and the `/api` routes from a single address (`backend/server.js` line 98). One
image, one container, one hostname per customer.

Per customer that image runs as one small container. Shared underneath: one load
balancer, one MySQL server, one image registry, one S3 bucket, one certificate.

```
 accesspoint.open-atlas.xyz ─┐
 diligence.open-atlas.xyz    ─┼─► Application Load Balancer
 <future>.open-atlas.xyz     ─┘   "which hostname?" → that customer's container
                                        │                    │
 Route 53 DNS                    ┌──────▼──────┐      ┌──────▼──────┐
 *.open-atlas.xyz                │ accesspoint│      │  diligence  │  ECS Fargate
 (one wildcard cert)             │  Express +  │      │  Express +  │  1 task each
                                 │  React SPA  │      │  React SPA  │  ARM64
                                 └──┬───────┬──┘      └──┬───────┬──┘
                      ┌─────────────▼───────┼────────────▼───┐   │
                      │ RDS MySQL 8.0 — one instance         │   │
                      │  [db: accesspoint] [db: diligence]  │   │
                      │  each with its own user + password   │   │
                      └──────────────────────────────────────┘   │
                      ┌──────────────────────────────────────────▼─┐
                      │ S3 atlas-uploads-<suffix>/                 │
                      │  accesspoint/…    diligence/…             │
                      │  each task's IAM role sees only its prefix │
                      └────────────────────────────────────────────┘
```

**Why one copy per customer rather than one shared app?** Atlas has no
`tenant_id` anywhere in its schema — it is built to serve one organisation per
deployment. Running a copy each means a missing `WHERE` clause *cannot* leak one
customer's issues to another; there is no shared table for it to leak through.
This is the "silo" model in AWS's own SaaS guidance, and it is the standard
choice for a handful of business customers.

**Three Atlas-specific facts that shape everything below:**

1. **Uploads currently go to local disk** (`backend/routes/attachments.js:34`).
   A Fargate container's disk is erased on every restart and deploy. Phase 0.1
   fixes this. Do not skip it.
2. **Sessions live in the database** (`sessions` table), so a container restart
   does not log everyone out.
3. **Live updates (SSE) use an in-process subscriber list**
   (`backend/utils/events.js`). That is why each customer runs **exactly one
   container** — a second one would only receive half the live events.

---

## 2. The AWS services, in plain words

| Service | What it is | Its job here |
| ------- | ---------- | ------------ |
| **IAM** | Users, roles, permissions | Your login; the permissions your containers get |
| **Route 53** | DNS — the phone book turning names into addresses | Points `*.open-atlas.xyz` at the load balancer |
| **ACM** | Free TLS certificates | The padlock; one wildcard cert covers every customer |
| **VPC / Security groups** | Your private network and its firewalls | Keeps the database reachable only by your containers |
| **RDS** | Managed MySQL — AWS handles patching, backups, disks | One server; one database *inside it* per customer |
| **S3** | Unlimited file storage | Where uploaded attachments actually live |
| **ECR** | A private Docker image registry | Holds the one Atlas image both customers run |
| **ECS Fargate** | "Run this container, keep it alive" — no servers to manage | Runs one container per customer |
| **ALB** | A load balancer that can route by hostname | Sends each customer's URL to their container |
| **Secrets Manager** | Encrypted store for passwords | Each customer's DB password and session secret |
| **CloudWatch** | Logs, metrics, alarms | Where container logs go; what pages you |
| **SNS** | Notification fan-out | Emails you when an alarm fires |

**Pick one region and stay in it.** Everything must be created in the same
region or the pieces cannot see each other. This guide uses **`ap-south-1`
(Mumbai)**. Every console page has a region selector **top-right — check it every
single time you open a service.** Creating something in the wrong region is the
most common first-timer mistake, and the symptom is always "the dropdown is
empty and I don't know why".

---

## 3. Before you start — tools and accounts

Install and verify each of these. The `Verify` column should print something,
not an error.

| Tool | Why | Verify |
| ---- | --- | ------ |
| **AWS account** | [aws.amazon.com](https://aws.amazon.com) → *Create an AWS Account*. Needs a credit card even on the free plan. | You can log in |
| **AWS CLI v2** | Half these steps are one command instead of ten clicks. [Install guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) | `aws --version` |
| **Docker Desktop** | Builds the image. Must be *running*, not just installed. | `docker --version` |
| **MySQL client** | Creating each customer's database, and the backups in §20. **You do not need to install this** — see §3.2 for the Docker one-liner, which also guarantees a version match with RDS. | `docker run --rm mysql:8.0 mysql --version` |
| **Node.js 20+** | Phase 0's code changes and generating random secrets. | `node --version` |
| **Git** | Releases are driven by tags. | `git --version` |
| **IONOS login** | To change the nameservers in Phase 2. | You can reach the domain settings |

### 3.1 A note on shells — you are on Windows

Every command in this guide is written to run **as-is in PowerShell**, which is
what you get in a default Windows terminal and in VS Code. They also work in Git
Bash and on macOS/Linux. Three differences to know, because copying a command
from elsewhere on the internet will eventually bite you:

| Bash idiom | Why it breaks in PowerShell | Use instead |
| ---------- | --------------------------- | ----------- |
| `\` at end of line to continue | Not a continuation character; PowerShell reads it as a literal and mangles the command | Keep the command on **one line** (this guide does) |
| `$(date +%s)` | PowerShell resolves `date` to `Get-Date`, which rejects `+%s` and substitutes empty | Type a literal value, or use `$(Get-Date -Format yyyy-MM-dd)` |
| `VAR=value command` | PowerShell has no inline env-var prefix | `$env:VAR = "value"` on its own line first |

Where a command genuinely differs between shells (the backup and restore steps
in §20), both versions are given and labelled.

### 3.2 The MySQL client — use Docker, don't install it

Every `mysql` and `mysqldump` command in this guide can run inside a container,
which avoids a Windows install **and** removes the version-skew trap described in
§20.2 — a client from a different major version than the server produces dumps
that fail confusingly on restore. Pinning `mysql:8.0` matches RDS exactly.

```powershell
# Interactive shell (-it prompts for the password, keeping it out of your history)
docker run --rm -it mysql:8.0 mysql -h <RDS_ENDPOINT> -u atlas_admin -p --ssl-mode=REQUIRED
```

```powershell
# Running a script file, e.g. when creating a customer's database in §16.1
docker run --rm -i mysql:8.0 mysql -h <RDS_ENDPOINT> -u atlas_admin -p --ssl-mode=REQUIRED < setup.sql
```

```powershell
# Backups (§20.2) — same image, so client and server versions always agree
docker run --rm mysql:8.0 mysqldump -h <RDS_ENDPOINT> -u atlas_admin -p<PASSWORD> --ssl-mode=REQUIRED --single-transaction --routines --triggers diligence > diligence.sql
```

Wherever this guide writes `mysql …` or `mysqldump …`, either an installed
client or the Docker form above works. Docker Desktop must be running.

> **A connection test that needs no password.** Supplying a deliberately wrong
> password is a quick way to prove the network path before you have credentials
> to hand: `ERROR 1045 (28000): Access denied` means DNS, TCP, TLS and the MySQL
> protocol all worked and only authentication failed. A **timeout** instead means
> the security group is wrong; a **TLS/handshake error** means the certificate
> path is.

**Things to have written down before you begin** (you will paste them repeatedly):

- Your 12-digit **AWS account ID** (Phase 1 shows you where to find it)
- The **RDS endpoint** hostname (Phase 4)
- The **ALB DNS name** (Phase 8)
- Your **S3 bucket name** (Phase 5)

Keep these in your password manager, not a text file on the desktop. Several of
them appear alongside passwords.

---

# Phase 0 — Code changes

**Do this entire phase before touching AWS.** These are the changes that make
Atlas safe to run on disposable containers. Everything here is testable locally.

## 4. Phase 0.1 — Move file uploads to S3

**What this is doing, and why it is not optional.** Right now, when a user
attaches a PDF to an issue, Atlas writes it to `backend/uploads/` on the
container's own disk. Fargate containers are *disposable* — AWS replaces them on
every deploy, every crash, and occasionally for its own maintenance. A replaced
container starts with an empty disk. So without this change, **every file your
customers upload disappears the next time you ship an update**, and the app shows
"File not found on disk" forever after.

The fix: write files to S3 (durable, ~$0.023/GB/month, and AWS's job to keep)
while keeping every URL, permission check, and signed-link behaviour exactly as
it is today. We are swapping the storage drawer, not redesigning the filing
system.

### 4.1 Add the AWS SDK

```bash
cd D:\Development\Atlas\backend
npm install @aws-sdk/client-s3
```

### 4.2 Create the storage helper

This one new file hides the choice between "disk" and "S3" behind three
functions. When `S3_BUCKET` is not set it uses local disk exactly as before —
so your local development and the existing Jest tests keep working untouched.

Create **`backend/utils/storage.js`**:

```js
// ===== FILE STORAGE =====
// One interface, two backends:
//   • S3        — production. Chosen automatically when S3_BUCKET is set.
//   • local disk — development and tests, when it is not.
// Fargate's container disk is erased on every restart, so anything durable has
// to leave the container. Each tenant is confined to its own S3_PREFIX, and its
// IAM role grants access to that prefix only.

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

/** Store one file. `filename` is the generated unique name, not the user's. */
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
    ContentType: contentType,
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
    if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return null;
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

module.exports = { putFile, getFileStream, deleteFile, backend: () => (usingS3() ? 's3' : 'disk') };
```

### 4.3 Rewrite `backend/routes/attachments.js`

Four edits. The routes, permissions, and signed-URL logic are unchanged.

**(a) Imports and multer setup.** Replace lines 19–40 (the `UPLOADS_DIR`
constant, the `fs.existsSync` bootstrap, and the `multer.diskStorage` block)
with:

```js
const { putFile, getFileStream, deleteFile } = require('../utils/storage');

// Files are held in memory just long enough to hand them to the storage layer.
// The 50MB cap below bounds how much that can ever be.
const storage = multer.memoryStorage();
```

You can now also drop the `fs` require if nothing else in the file uses it.

**(b) The upload handler.** `memoryStorage` gives you `file.buffer` but no
`file.filename`, so generate the stored name yourself. In the `for` loop of
`POST /issues/:issueId/attachments`, replace the body with:

```js
for (const file of (req.files || [])) {
  const id = uuidv4();
  const filename = uuidv4() + path.extname(file.originalname);
  await putFile(filename, file.buffer, file.mimetype);

  await run(db, `INSERT INTO attachments (id, issue_id, filename, original_name, mime_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, req.params.issueId, filename, file.originalname, file.mimetype, file.size, req.userId]);

  const att = await queryOne(db, `SELECT a.*, u.name as uploader_name, u.avatar_color as uploader_color FROM attachments a LEFT JOIN users u ON a.uploaded_by = u.id WHERE a.id = ?`, [id]);
  results.push(withFileUrls(att));
}
```

**(c) Download and preview.** In both handlers, replace the
`path.join` + `fs.existsSync` + `res.sendFile` trio with a stream. For
`GET /attachments/:id/download`:

```js
const stream = await getFileStream(att.filename);
if (!stream) return res.status(404).json({ error: 'File not found' });

res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(att.original_name)}"`);
res.setHeader('Content-Type', att.mime_type);
stream.on('error', () => res.destroy());
stream.pipe(res);
```

And for `GET /attachments/:id/preview`, keep the existing `INLINE_SAFE` and
`Content-Security-Policy` logic exactly as it is — only swap the final
`res.sendFile(filePath)` for the same three stream lines above.

> The `stream.on('error', …)` line matters: without it, an S3 read that fails
> mid-transfer becomes an unhandled error event and takes the whole Node process
> down, which on Fargate means a restart for that customer.

**(d) Delete.** Replace the `fs.unlinkSync` block with:

```js
await deleteFile(att.filename);
```

### 4.4 Apply the same four edits to `backend/routes/wiki-attachments.js`

That file mirrors this one — same `multer.diskStorage`, same `UPLOADS_DIR`,
same disk reads in its `raw` route. Make the identical changes. Its inline
image route (`/api/wiki/attachments/:id/raw`) uses `fileSigQuery` rather than
`signedFileUrl`, but the storage swap is the same.

### 4.5 Why this design is safe

- **Per-customer isolation.** accesspoint's container runs with
  `S3_PREFIX=accesspoint`, and its IAM role (Phase 9.5) permits S3 access
  *only* under `accesspoint/*`. Even a bug that constructed the wrong key
  would be refused by AWS.
- **Access control is unchanged.** Files are still served *through* Atlas, so
  `requireAuthOrSignature` and the HMAC signed URLs in `backend/utils/signing.js`
  still gate every read. The bucket itself stays completely private — no public
  access, no presigned S3 links leaking past your permission checks.
- **Local development is unchanged.** No `S3_BUCKET` in your `.env`, no
  behaviour change, tests pass as before.

---

## 5. Phase 0.2 — Encrypt the database connection

**What this is doing.** Atlas currently connects to MySQL in plaintext
(`backend/database.js:1002` has no `ssl` option). On your laptop that is fine —
the database is on the same machine. On AWS, that traffic crosses a network, and
customer data crossing a network unencrypted is not something you want to
explain later. RDS supports TLS; we just have to ask for it and verify AWS's
certificate.

In `backend/database.js`, find `initMysql()` (around line 973) and change the
two pool constructions:

```js
// Near the top of initMysql(), after the config destructure:
const ssl = (process.env.MYSQL_SSL || '').toLowerCase() === 'true'
  ? { ca: require('fs').readFileSync(process.env.MYSQL_SSL_CA || '/app/certs/rds-global-bundle.pem'), minVersion: 'TLSv1.2' }
  : undefined;
```

Then add `ssl` (and a bounded pool) to **both** `mysql.createPool` calls and the
bootstrap `createConnection`:

```js
const pool = mysql.createPool({
  host, port, user, password, database,
  charset: 'utf8mb4', dateStrings: true, multipleStatements: false,
  ssl,
  connectionLimit: parseInt(process.env.MYSQL_POOL_SIZE, 10) || 5,
});
```

**Why `connectionLimit: 5`.** mysql2 defaults to 10 connections per pool. A
`db.t4g.micro` allows roughly 60–70 total. At two customers that is fine either
way, but bounding it now means customer number eight does not exhaust the server
and take everyone down at once.

> **Do not use `ssl: 'Amazon RDS'`.** mysql2 ships a bundled AWS CA under that
> name, but AWS rotated its root certificates (`rds-ca-rsa2048-g1`) and a stale
> bundle fails with an opaque handshake error. Reading the current bundle from
> disk — which Phase 0.3 puts there — is explicit and does not silently expire.

---

## 6. Phase 0.3 — Bake the RDS certificate into the image

**What this is doing.** Phase 0.2 verifies AWS's database certificate against a
CA bundle at `/app/certs/rds-global-bundle.pem`. This puts it there at build
time, so the running container needs no internet access to fetch it.

In the root `Dockerfile`, in the **production** stage (after `WORKDIR /app`, before
`USER atlas`), add:

```dockerfile
# AWS RDS root certificates — used to verify the TLS connection to MySQL.
ADD --chown=atlas:atlas https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/certs/rds-global-bundle.pem
RUN chmod 0444 /app/certs/rds-global-bundle.pem
```

---

## 7. Phase 0.4 — Verify locally before going near AWS

**What this is doing.** Proving the Phase 0 changes work while failures are
cheap and nobody is watching.

```bash
cd D:\Development\Atlas
npm run build --prefix frontend    # or: cd frontend && npm run build
cd backend && npm test
```

Then run the full stack and exercise the thing you just changed:

```bash
docker compose up -d --build
```

1. Open `http://localhost:3001`, log in.
2. Create an issue, **upload a file to it**, download it back. It works — this
   is still the disk backend, which is the point: you have not broken the old path.
3. Upload an image into a **wiki page** and confirm it renders inline.

**Commit this before starting Phase 1.** If anything later goes wrong you want a
clean "the code was fine" checkpoint.

```bash
git add -A
git commit -m "feat(deploy): S3-backed uploads, TLS to MySQL, bounded pool"
```

---

# Phase 1–8 — Shared infrastructure

Everything from here to Phase 8 is built **once** and serves every customer,
present and future.

## 8. Phase 1 — Secure the account, set a budget alarm

**What this is doing.** Ten minutes that prevent the two classic disasters: a
hijacked root account, and a bill you find out about a month late. Do it before
creating anything else.

**1. Turn on MFA for the root user.** Console → search **IAM** → *Add MFA* →
any authenticator app. The root user can delete everything you are about to
build and cannot be permission-limited, so this is the single highest-value
click in the guide.

**2. Create an admin user and stop using root.** IAM → *Users* → *Create user* →
name `admin`, enable console access → *Attach policies directly* →
`AdministratorAccess`. Enable MFA for this user too. **Log out of root and do
everything below as `admin`.**

**3. Create an access key for the CLI.** IAM → *Users* → `admin` → *Security
credentials* → *Create access key* → *Command Line Interface*. Then locally:

```bash
aws configure
# Access Key ID and Secret from above; region: ap-south-1; output: json
```

Verify — this also gives you the account ID you will paste everywhere:

```bash
aws sts get-caller-identity
```

You should see a 12-digit `Account`. **Write it down.** This guide writes it as
`<ACCOUNT_ID>`.

**4. Set a budget alarm.** Console → *Billing and Cost Management* → *Budgets* →
*Create budget* → template **Monthly cost budget** → amount `$100` → your email.
It is free, and it converts a misconfiguration into an email rather than an
invoice.

---

## 9. Phase 2 — Move DNS from IONOS to Route 53

**What this is doing.** DNS is the phone book that turns
`accesspoint.open-atlas.xyz` into an address. Your domain is *registered* at
IONOS, but you are going to let **Route 53** answer the questions about it. The
registration stays at IONOS — you are only changing which servers are
authoritative.

**Why bother?** Because then every DNS record lives in AWS alongside the load
balancer, so adding customer number three becomes one command instead of "log
into IONOS, remember which record, wait for a long TTL". It costs $0.50/month.

### 9.1 Create the hosted zone

```bash
aws route53 create-hosted-zone --name open-atlas.xyz --caller-reference "atlas-2026-07-20-a"
```

`--caller-reference` just has to be a string you have not used before — AWS uses
it to recognise an accidentally repeated request. Any unique value works; change
the suffix if you ever need to run this again.

In the output, find `DelegationSet.NameServers` — **four** hostnames like
`ns-123.awsdns-45.com`. Copy all four.

(Console equivalent: Route 53 → *Hosted zones* → *Create hosted zone* → name
`open-atlas.xyz`, type *Public hosted zone*. The four nameservers appear in the
`NS` record.)

### 9.2 Point IONOS at those nameservers

1. Log in to IONOS → **Domains & SSL** → click **open-atlas.xyz**.
2. Find **Nameserver** settings (sometimes under *DNS* → *Change nameservers*,
   sometimes *Use custom nameservers*).
3. Choose **custom / external nameservers** and enter all four AWS hostnames.
   Drop any trailing dot if IONOS rejects it.
4. Save.

> **⚠ STOP — do this before you touch the nameservers.** Switching to external
> nameservers makes Route 53 authoritative, and Route 53 starts out knowing
> **nothing** except the NS and SOA records. Every record that existed at IONOS —
> email, websites, verification records — stops resolving the moment caches
> expire, which for a 300-second TTL is five minutes.
>
> **Screenshot the complete IONOS DNS record list first, and recreate every
> record in Route 53 before changing the nameservers.** Filters in the IONOS
> panel can hide subdomain records — clear them and scroll to the bottom.
>
> This is not hypothetical. On this domain it turned out there were **21
> records**, including working email on the root *and* on both customer
> subdomains, DKIM keys under a non-obvious selector (`s1-ionos._domainkey`, not
> `s1`), and a live site on Render at `www`. Recovering them afterwards from
> resolver caches was luck, and it could not have found any record that nothing
> had recently looked up.
>
> If the domain is genuinely unused, there is nothing to migrate — but verify
> that, do not assume it.

### 9.3 Wait, then verify

Delegation takes anywhere from a few minutes to a few hours.

```bash
nslookup -type=NS open-atlas.xyz
```

**Success looks like:** the four `awsdns` hostnames. Until you see them, ACM
validation in Phase 7 will hang forever — so do not move past Phase 7 without
this check passing.

---

## 10. Phase 3 — Network and security groups

**What this is doing.** Security groups are firewalls. You are building a chain
where each layer only accepts traffic from the one in front of it: the internet
reaches the load balancer, only the load balancer reaches the containers, and
only the containers (plus your laptop, for admin) reach the database.

You do **not** need to build a network — every AWS account comes with a
**default VPC** that has public subnets in every availability zone and internet
access. Use it.

> **Do NOT create a NAT Gateway.** Several console wizards offer one. It costs
> ~$32/month plus data charges, and this architecture does not need it:
> containers sit in public subnets with public IPs, and the security groups
> below keep them unreachable except through the load balancer.

Console → **VPC** → *Security groups* → *Create security group*, three times, in
the **default VPC** each time:

| Name | Inbound rules | In plain English |
| ---- | ------------- | ---------------- |
| `atlas-alb-sg` | HTTPS (443) from `0.0.0.0/0`; HTTP (80) from `0.0.0.0/0` | Anyone on the internet may reach the load balancer |
| `atlas-app-sg` | Custom TCP **3001**, source = `atlas-alb-sg` | **Only** the load balancer may reach containers |
| `atlas-db-sg` | MySQL/Aurora (3306), source = `atlas-app-sg` **plus** MySQL (3306), source = *My IP* | Only containers — and your machine, for admin — reach the database |

To use a security group as a source, start typing `sg-` in the source field and
pick it from the dropdown. **Leave all outbound rules at the default** (allow
all) — containers need outbound access to pull images and reach S3.

Port **3001** is not arbitrary: it is what `Dockerfile` exposes and what
`backend/server.js` listens on.

> The *My IP* rule on `atlas-db-sg` is what lets you run `mysql` from your laptop
> to create each customer's database. **Home IP addresses change.** When `mysql`
> mysteriously stops connecting in three weeks, updating this rule is the fix.

---

## 11. Phase 4 — The database server (RDS MySQL)

**What this is doing.** Creating one managed MySQL server. Each customer gets
their own *database* inside it, with their own username and password — so
accesspoint's credentials cannot read diligence's tables. AWS handles the
patching, disk management, and automated backups.

Console → **RDS** → *Create database*:

| Setting | Value | Why |
| ------- | ----- | --- |
| Creation method | **Standard create** | Easy-create's defaults are wrong for us |
| Engine | **MySQL**, version **8.0.x** | Matches `mysql2` and `docker-compose.yml` |
| Template | **Free tier** if offered, else Production | It only pre-fills fields — set them per this table regardless |
| Availability | **Single DB instance** | Multi-AZ doubles the cost; not needed pre-revenue |
| DB instance identifier | `atlas-db` | |
| Master username | `atlas_admin` | The superuser — **never** goes in a customer's config |
| Master password | Self-managed → generate a long one → **password manager** | |
| Instance class | Burstable → **`db.t4g.micro`** | ~$14/month; comfortable for the first ~10 customers |
| Storage | 20 GiB **gp3**, autoscaling **ON**, max 100 GiB | Autoscaling prevents a full disk taking everyone down |
| Connectivity | Default VPC, **Public access: Yes**, security group **`atlas-db-sg`** only (remove `default`) | "Public" is gated by the SG — only your containers and your IP can actually connect |
| Backup | **Enable automated backups**, retention **7 days** (see note) | Point-in-time recovery |
| Encryption | **Enabled** (default) | Data encrypted at rest |
| Deletion protection | **Enabled** | Stops a stray click deleting both customers |

Create, then wait ~10 minutes for status **Available**.

> **On the free plan, backup retention is capped at 1 day** and attempting to
> raise it fails with `FreeTierRestrictionError`. Set what it lets you set, and
> treat Phase 13's nightly dumps as your real backup until you upgrade.

Copy the **Endpoint** from the database page — it looks like
`atlas-db.abcdefgh.ap-south-1.rds.amazonaws.com`. This guide calls it
`<RDS_ENDPOINT>`. **Write it down.**

**Test from your machine:**

```bash
mysql -h <RDS_ENDPOINT> -u atlas_admin -p --ssl-mode=REQUIRED
```

**Success looks like:** a `mysql>` prompt. Type `\q` to exit.

**If it hangs:** your IP is not in `atlas-db-sg` (Phase 3), or your network
blocks outbound port 3306 — many office and mobile networks do. In that case use
**AWS CloudShell** instead: console → the `>_` icon top-right (check the region!)
→ `sudo dnf install -y mariadb105` → get CloudShell's IP with
`curl -s https://checkip.amazonaws.com` → temporarily add that IP to
`atlas-db-sg` → connect. Remove the temporary rule when you are done.

---

## 12. Phase 5 — The uploads bucket (S3)

**What this is doing.** Creating the durable home for uploaded files that
Phase 0.1 taught Atlas to use. One bucket, one folder per customer.

Bucket names are **globally unique across all of AWS**, so add a suffix — your
account ID works well:

```bash
aws s3api create-bucket --bucket atlas-uploads-<ACCOUNT_ID> --region ap-south-1 --create-bucket-configuration LocationConstraint=ap-south-1
```

Then turn on versioning, which is what saves you when a file is deleted or
overwritten by mistake:

```bash
aws s3api put-bucket-versioning --bucket atlas-uploads-<ACCOUNT_ID> --versioning-configuration Status=Enabled
```

**Verify the bucket is private** — new buckets block public access and encrypt
by default, but confirm rather than assume:

```bash
aws s3api get-public-access-block --bucket atlas-uploads-<ACCOUNT_ID>
```

**Success looks like:** all four settings `true`. If any is `false`, fix it in
the console (bucket → *Permissions* → *Block public access* → *Edit* → tick all
→ save). Files are served *through* Atlas, which checks permissions first; the
bucket should never be readable from the internet directly.

---

## 13. Phase 6 — Build and push the image (ECR)

**What this is doing.** ECR is a private registry for Docker images. You build
Atlas into an image once, push it here, and both customers' containers run that
same image with different configuration.

**Create the registry (once):**

```bash
aws ecr create-repository --repository-name atlas --region ap-south-1 --image-scanning-configuration scanOnPush=true --image-tag-mutability IMMUTABLE
```

`IMMUTABLE` means a tag, once pushed, can never be overwritten. That is what
makes "roll back to `v3`" mean one exact, unchanged artifact.

**Build and push.** The build context is the **repo root**, not `backend/` — the
Dockerfile builds the frontend and backend together:

```bash
cd D:\Development\Atlas

# 1. Log Docker in to your registry (the token lasts 12 hours)
aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com

# 2. Build for ARM64 — Graviton Fargate is ~20% cheaper and node:20-alpine supports it
docker build --platform linux/arm64 -t atlas .

# 3. Tag and push
docker tag atlas:latest <ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com/atlas:v1
docker push <ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com/atlas:v1
```

The first build takes several minutes. **Always use a real version tag** (`v1`,
`v2`, …) — releases and rollbacks depend on knowing exactly which image each
customer runs.

> **The `--platform linux/arm64` flag must match the task definition's
> `cpuArchitecture` in Phase 9.** If they disagree the container starts and
> immediately dies with `exec format error`, which is a confusing message for
> what is really "wrong CPU type".

---

## 14. Phase 7 — The wildcard certificate (ACM)

**What this is doing.** Getting the free TLS certificate that puts the padlock in
the browser. Because all your customers are subdomains of one domain, **a single
wildcard certificate covers every customer you will ever add** — this is the
step you never have to repeat.

**Prerequisite:** Phase 2's `nslookup -type=NS open-atlas.xyz` must already show
AWS nameservers.

1. Console → **Certificate Manager** → **confirm the region is `ap-south-1`** →
   *Request certificate* → *Request a public certificate* → **Next**.
2. **Fully qualified domain name:** `*.open-atlas.xyz`
3. Click **Add another name to this certificate** and add `open-atlas.xyz`
   (the bare domain — the wildcard does not cover it, and you will want it later
   for a landing page).
4. **Validation method:** **DNS validation — recommended**.
5. **Key algorithm:** RSA 2048. → **Request**.

Now prove you own the domain. Because DNS is in Route 53, ACM can do this
itself:

6. Open the new certificate (status **Pending validation**) → select the domain
   rows → **Create records in Route 53** → **Create records**.

**Success looks like:** status flips to **Issued** within a few minutes (up to
~30). **Do not continue to Phase 8 until it says Issued** — the load balancer
needs it.

**If it stays Pending past 30 minutes:** delegation has not taken effect. Re-run
the `nslookup` from Phase 2.3.

---

## 15. Phase 8 — Load balancer, cluster, and IAM roles

**What this is doing.** Three shared pieces: the load balancer that reads each
request's hostname and routes it to the right customer; the cluster that is
simply a named home for your containers; and two IAM roles that say what your
containers are allowed to do.

### 15.1 The ECS cluster

Console → **ECS** → *Clusters* → *Create cluster* → name **`atlas`** → ensure
**AWS Fargate (serverless)** is ticked → **Create**. That is the whole step —
it is a logical grouping, not a server.

### 15.2 A placeholder target group

The load balancer wizard refuses to create a listener without a default target
group, but we want the real default to be "404, unknown customer". So create one
empty group whose only job is to satisfy the wizard.

Console → **EC2** → *Target groups* → *Create target group*:
- Target type **IP addresses**
- Name **`atlas-no-tenant`**
- Protocol/Port **HTTP** / **3001**, default VPC
- **Next** → register **no** targets → **Create**

### 15.3 The Application Load Balancer

Console → **EC2** → *Load balancers* → *Create load balancer* → **Application
Load Balancer** → *Create*:

| Setting | Value |
| ------- | ----- |
| Name | `atlas-alb` |
| Scheme | **Internet-facing** |
| IP address type | IPv4 |
| Network mapping | Default VPC, tick **at least two Availability Zones** (required) |
| Security groups | **`atlas-alb-sg`** — and **remove `default`** (click the × on its chip) |
| Listener | Protocol **HTTPS**, port **443**, default action *Forward to* → `atlas-no-tenant` |
| Default SSL/TLS certificate | **From ACM** → the `*.open-atlas.xyz` certificate |

**Create**, then wait for **State: Active** (~2–3 minutes).

**Copy the ALB's DNS name** — like
`atlas-alb-1234567890.ap-south-1.elb.amazonaws.com`. **Write it down**; every
customer's DNS record points at it.

### 15.4 Fix the default action and add the HTTP redirect

1. `atlas-alb` → *Listeners and rules* → click the **HTTPS:443** listener →
   *Actions* → *Edit listener* → change the default action from *Forward* to
   **Return fixed response**: status `404`, body `unknown tenant`, content type
   `text/plain`. **Save.**

   *Why:* requests for a hostname you have not configured should get a clean 404,
   not be handed to whichever customer happens to be first in the list.

2. Add the redirect so `http://` URLs are not dead ends: ALB → *Listeners and
   rules* → *Add listener* → **HTTP : 80** → **Redirect to URL** → HTTPS, port
   443, *Original host, path, query*, status **301**. **Add.**

### 15.5 Raise the idle timeout (for live updates)

Atlas pushes live updates over Server-Sent Events. The connection is long-lived
and mostly silent; `backend/routes/stream.js` sends a heartbeat every **25
seconds** to keep proxies from closing it.

The ALB's default idle timeout is 60 seconds, so the 25-second heartbeat is
*already* enough. Raise it anyway for margin — a slow moment should not sever
every customer's live updates:

ALB → *Attributes* → *Edit* → **Idle timeout: 120** seconds → save.

### 15.6 The two IAM roles

Containers need two roles, and the difference confuses everyone at first:

- **Execution role** — used by ECS itself *to start* the task: pull the image
  from ECR, read secrets, create log groups. Used before your code runs.
- **Task role** — used by *your running application* to call AWS. Atlas needs
  this for S3.

**Create the execution role:**

IAM → *Roles* → *Create role* → trusted entity **AWS service** → use case
**Elastic Container Service → Elastic Container Service Task** → attach
`AmazonECSTaskExecutionRolePolicy` → name it **`atlasTaskExecutionRole`**.

Then open the role → *Add permissions* → *Create inline policy* → **JSON**:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:ap-south-1:<ACCOUNT_ID>:secret:atlas/*"
    },
    {
      "Effect": "Allow",
      "Action": "logs:CreateLogGroup",
      "Resource": "arn:aws:logs:ap-south-1:<ACCOUNT_ID>:log-group:/atlas/*"
    }
  ]
}
```

Name it **`atlas-task-startup`**.

*Why the second statement:* the task definitions below use
`"awslogs-create-group": "true"`, and the managed policy grants
`CreateLogStream`/`PutLogEvents` but **not** `CreateLogGroup`. Without it the
task fails to start with `ResourceInitializationError: … AccessDeniedException
… logs:CreateLogGroup` — a genuinely baffling first-run error.

**The task roles are per-customer** (each is scoped to one S3 prefix), so they
are created in Phase 9.

---

# Phase 9–11 — The customers

## 16. Phase 9 — Deploy customer 1 (accesspoint)

Everything above was one-time. **This section is what you repeat per customer.**
Concrete values used here:

| Placeholder | Value |
| ----------- | ----- |
| customer slug | `accesspoint` |
| hostname | `accesspoint.open-atlas.xyz` |
| database + user | `accesspoint` |
| S3 prefix | `accesspoint/` |

### 16.1 Create the customer's database and user

**What this is doing.** Carving out an isolated database with its own login. This
is the isolation boundary — the whole silo model rests on this step.

Generate the password first (keep it; you paste it once):

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

Connect as the master user:

```bash
mysql -h <RDS_ENDPOINT> -u atlas_admin -p --ssl-mode=REQUIRED
```

```sql
  CREATE DATABASE accesspoint CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  CREATE USER 'accesspoint'@'%' IDENTIFIED BY '<THE_GENERATED_PASSWORD>';
  GRANT ALL PRIVILEGES ON accesspoint.* TO 'accesspoint'@'%';
  FLUSH PRIVILEGES;
```

That user has **no grant on any other database**. You will prove it in Phase 10.

> Atlas tries to `CREATE DATABASE IF NOT EXISTS` on boot and logs a warning if it
> lacks permission (`backend/database.js:988`). That warning is *expected and
> harmless* here — the database already exists and the scoped user deliberately
> cannot create databases. The schema and migrations still run.

### 16.2 Store the secrets

**What this is doing.** Passwords do not belong in a task definition, which is
stored and displayed in plaintext forever. Secrets Manager holds them encrypted;
ECS injects them as environment variables at startup.

**Two secrets, two different sources — do not mix them up:**

| Secret | What goes in it |
| ------ | --------------- |
| `mysql-password` | The **tenant user's** password from §16.1 — the one inside `CREATE USER 'accesspoint'@'%' IDENTIFIED BY '…'`. **Never the `atlas_admin` master password**, which would give this container superuser access to every customer's database and defeat the whole isolation model. |
| `session-secret` | A **freshly generated** 64-character hex value, never reused from another customer or another purpose. |

Generate the session secret — this signs both login sessions and attachment
URLs (`backend/utils/signing.js`), so it must be long and unique per customer.
A shared value would let a signed file URL minted by one deployment validate
against another:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```bash
aws secretsmanager create-secret --region ap-south-1 --name atlas/accesspoint/mysql-password --secret-string "<THE_TENANT_DB_PASSWORD_FROM_16.1>"

aws secretsmanager create-secret --region ap-south-1 --name atlas/accesspoint/session-secret --secret-string "<THE_64_CHAR_HEX_GENERATED_JUST_ABOVE>"
```

Each prints an **ARN**. **Copy both** — the task definition needs them. The
`atlas/` prefix is what the Phase 8.6 IAM policy allows.

### 16.3 Create this customer's task role

**What this is doing.** Granting accesspoint's container access to its own S3
folder and nothing else.

IAM → *Roles* → *Create role* → **AWS service** → **Elastic Container Service →
Elastic Container Service Task** → attach **no** managed policies → name it
**`atlasTaskRole-accesspoint`**.

Open it → *Add permissions* → *Create inline policy* → **JSON**:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::atlas-uploads-<ACCOUNT_ID>/accesspoint/*"
    }
  ]
}
```

Name it **`atlas-s3-accesspoint`**.

Note the `/accesspoint/*` at the end. That trailing scope is what makes a
cross-customer file read impossible at the AWS level, not merely unlikely at the
application level.

### 16.4 The task definition

**What this is doing.** A task definition is the recipe: which image, how much
CPU, which environment variables, which secrets, where logs go.

Console → **ECS** → *Task definitions* → *Create new task definition* →
**Create with JSON** (toggle, top-right). Paste this, filling in `<ACCOUNT_ID>`,
`<RDS_ENDPOINT>`, the two secret ARNs, and a generated admin password:

```json
{
  "family": "atlas-accesspoint",
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "cpu": "256",
  "memory": "512",
  "runtimePlatform": { "cpuArchitecture": "ARM64", "operatingSystemFamily": "LINUX" },
  "executionRoleArn": "arn:aws:iam::<ACCOUNT_ID>:role/atlasTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::<ACCOUNT_ID>:role/atlasTaskRole-accesspoint",
  "containerDefinitions": [
    {
      "name": "app",
      "image": "<ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com/atlas:v1",
      "portMappings": [{ "containerPort": 3001, "protocol": "tcp" }],
      "essential": true,
      "environment": [
        { "name": "NODE_ENV", "value": "production" },
        { "name": "PORT", "value": "3001" },
        { "name": "DB_DRIVER", "value": "mysql" },
        { "name": "MYSQL_HOST", "value": "<RDS_ENDPOINT>" },
        { "name": "MYSQL_PORT", "value": "3306" },
        { "name": "MYSQL_USER", "value": "accesspoint" },
        { "name": "MYSQL_DATABASE", "value": "accesspoint" },
        { "name": "MYSQL_SSL", "value": "true" },
        { "name": "MYSQL_POOL_SIZE", "value": "5" },
        { "name": "S3_BUCKET", "value": "atlas-uploads-<ACCOUNT_ID>" },
        { "name": "S3_PREFIX", "value": "accesspoint" },
        { "name": "AWS_REGION", "value": "ap-south-1" },
        { "name": "SEED_DEMO_DATA", "value": "false" },
        { "name": "APP_URL", "value": "https://accesspoint.open-atlas.xyz" },
        { "name": "CORS_ORIGINS", "value": "" },
        { "name": "ADMIN_NAME", "value": "Atlas Admin" },
        { "name": "ADMIN_EMAIL", "value": "<AN_ADDRESS_YOU_CAN_ACTUALLY_RECEIVE_MAIL_AT>" },
        { "name": "ADMIN_PASSWORD", "value": "<STRONG_ONE_TIME_PASSWORD>" }
      ],
      "secrets": [
        { "name": "MYSQL_PASSWORD", "valueFrom": "<ARN of atlas/accesspoint/mysql-password>" },
        { "name": "SESSION_SECRET", "valueFrom": "<ARN of atlas/accesspoint/session-secret>" }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/atlas/accesspoint",
          "awslogs-create-group": "true",
          "awslogs-region": "ap-south-1",
          "awslogs-stream-prefix": "app"
        }
      }
    }
  ]
}
```

**What the important settings mean:**

- **`SEED_DEMO_DATA=false`** — critical. `true` creates five demo accounts that
  all share the published password `password123` (see `README.md`). Never on a
  real deployment.
- **`ADMIN_*`** — creates the customer's first admin account, but **only when the
  users table is empty** (`backend/database.js:1017`). On every later restart it
  does nothing. You will remove these in Phase 10.1.

  **Pick the email address deliberately.** It becomes the login for the
  customer's first admin, and Atlas will send password and notification mail to
  it once SMTP is configured. `accesspoint.open-atlas.xyz` has **no mailbox**
  (the subdomain has no MX records), so `admin@accesspoint.open-atlas.xyz` would
  not receive anything. Use an address that actually works — your own, or the
  customer's real one. `diligence.open-atlas.xyz` *does* have IONOS mail, so
  `admin@diligence.open-atlas.xyz` is viable there if a mailbox exists.
- **`APP_URL`** — used to build links in notification emails. Without it they
  point at `localhost:3001`.
- **`CORS_ORIGINS=""`** — empty means same-origin only, which is correct: the SPA
  is served by this same container. Never set it to `*`.
- **`cpu: 256` / `memory: 512`** — 0.25 vCPU, 0.5 GB. Fine to start; raise both
  for a heavy customer (see Phase 9.7).
- **AI and email are absent** — Atlas gates both on their config being present
  (`backend/config.js`), so their features simply stay off. To enable AI for one
  customer, add an `atlas/accesspoint/anthropic-key` secret and inject it as
  `ANTHROPIC_API_KEY`. A per-customer key makes each customer's AI spend
  separately meterable.

Click **Create**.

### 16.5 Target group and routing rule

**What this is doing.** A target group is "the set of containers serving this
customer, and how to tell if they are healthy". The rule is "this hostname goes
to that group".

1. Console → **EC2** → *Target groups* → *Create target group*:
   - Target type **IP addresses**
   - Name **`atlas-accesspoint`**
   - Protocol/Port **HTTP** / **3001**, default VPC
   - **Health check path: `/api/health/ready`**
   - **Next** → register **no** targets (ECS does that) → **Create**

   *Why that path:* `/api/health/ready` runs a real `SELECT 1` against MySQL
   (`backend/server.js:87`), so a container that cannot reach its database is
   replaced instead of serving errors to the customer. The plain `/api/health`
   would return OK even with a dead database.

2. **EC2** → *Load balancers* → `atlas-alb` → *Listeners and rules* → the
   **HTTPS:443** listener → *Manage rules* → *Add rule*:
   - *Add condition* → **Host header** → `accesspoint.open-atlas.xyz`
   - *Action* → **Forward to** → `atlas-accesspoint`
   - Priority **1** → **Save**

### 16.6 The ECS service

**What this is doing.** A service is "keep exactly N copies of this task running,
register them with the load balancer, and replace any that die".

Console → **ECS** → cluster **`atlas`** → *Services* → *Create*:

| Setting | Value |
| ------- | ----- |
| Compute options | **Launch type** → **FARGATE** |
| Task definition | **`atlas-accesspoint`**, latest revision |
| Service name | **`accesspoint`** |
| Desired tasks | **1 — and it must stay 1** |
| Networking | Default VPC, the **public** subnets, security group **`atlas-app-sg`** only, **Public IP: ENABLED** |
| Load balancing | Application Load Balancer → **`atlas-alb`** → container `app 3001:3001` → **use existing** target group **`atlas-accesspoint`** |

> **Why exactly one task.** Live updates use an in-process subscriber list
> (`backend/utils/events.js`), and the API rate limiter is per-process
> (`backend/middleware/ratelimit.js`). A second container would deliver only some
> live events to each connected browser and double every rate limit. To handle a
> heavy customer, scale **up** (more CPU/memory in the task definition), not out
> — until those move to shared infrastructure.

> **`Public IP: ENABLED` is not optional.** Without it — and without a NAT
> Gateway, which we deliberately are not paying for — the container cannot reach
> ECR to pull its own image, and dies at startup with a confusing timeout.

Create, then watch the **Deployments** tab. Within ~3 minutes you should see 1
running task, and under **EC2 → Target groups → atlas-accesspoint → Targets**,
status **healthy**. If it never goes healthy, jump to §24.

### 16.7 DNS record

> **This subdomain is a clean slate.** `accesspoint.open-atlas.xyz` has no DNS
> records at all today — no email, no parking page. You are creating it from
> nothing, which is why it goes first. (Nothing needs registering: you own
> `open-atlas.xyz`, so every subdomain of it is already yours. A subdomain
> exists the moment a record for it does.)
>
> `diligence` in §18 is **not** a clean slate — it has live email records — so
> the order here matters. Learn the mechanics on the easy one.

Route 53 → *Hosted zones* → `open-atlas.xyz` → *Create record*:

- **Record name:** `accesspoint`
- **Record type:** `A`
- **Alias:** toggle **ON** → *Alias to Application and Classic Load Balancer* →
  region `ap-south-1` → select `atlas-alb`
- **Create records**

*Why an A-record alias rather than a CNAME:* aliases resolve faster, cost
nothing to query, and work at the zone apex if you later want `open-atlas.xyz`
itself to point somewhere.

```bash
nslookup accesspoint.open-atlas.xyz
```

---

## 17. Phase 10 — Verify it actually works

Run these **in order** — each isolates a different layer, so the first one that
fails tells you where the problem is.

1. **Liveness** — open `https://accesspoint.open-atlas.xyz/api/health` → **HTTP
   200**. Proves DNS, certificate, ALB rule, and a running container all line up.
2. **Readiness** — `.../api/health/ready` → **HTTP 200** with `"db":"ok"`. Proves
   the container can actually query its database over TLS.
3. **The app** — open `https://accesspoint.open-atlas.xyz`. Login screen loads,
   padlock closed.
4. **Login** with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` from the task definition.
5. **★ The upload test — the one that matters most.** Create a project and an
   issue → **attach a file** → download it back. Then upload an image into a
   **wiki page** and confirm it renders.
6. **★ The durability test — do not skip this.** ECS → service `accesspoint` →
   *Update service* → tick **Force new deployment** → *Update*. Wait ~3 minutes
   for the new task to go healthy, then **download the file from step 5 again.**

   **It must still work.** If it 404s, `S3_BUCKET` is not set or the Phase 0.1
   changes did not take effect, and you have just caught — before any customer
   did — the failure this whole design exists to prevent.
7. **Live updates** — open the app in two browser windows, logged in as the same
   admin. Change an issue's status in one; the other should update without a
   refresh. Leave both open for **three minutes** to confirm the SSE connection
   survives the ALB idle timeout.
8. **Logs** — CloudWatch → *Log groups* → `/atlas/accesspoint` → newest stream.
   You should see the migration output and the server start line.

   **Then set retention:** *Actions* → *Edit retention setting* → **30 days**.
   The default is *Never expire*, which quietly bills forever.
9. **Isolation** — after Phase 11, prove one customer's credentials cannot reach
   the other's database:

   ```bash
   mysql -h <RDS_ENDPOINT> -u accesspoint -p --ssl-mode=REQUIRED -e "USE diligence;"
   ```

   **Expected:** `ERROR 1044 (42000): Access denied for user 'accesspoint'@'%'
   to database 'diligence'`. That error is the whole security model working.

Anything failing → §24.

### 17.1 Harden the task definition once it works

**Do this as soon as the checks above pass.** It is easy to forget precisely
because everything already works.

The `environment` block is stored and displayed in **plaintext**, and **every
revision keeps its copy forever**. `ADMIN_PASSWORD` is sitting in there.

1. **Change the admin password inside the app** (or have the customer do it), so
   the seeded one is no longer valid anywhere.
2. **Create a new task definition revision** with `ADMIN_NAME`, `ADMIN_EMAIL`,
   and `ADMIN_PASSWORD` **removed** from `environment`. They are only read when
   the users table is empty, which will never be true again.
3. **Update the service** to that revision; re-run checks 1–5 above.
4. **Deregister the old revision** — it still contains the plaintext password,
   and a revision cannot be deregistered while a service uses it:

   ```bash
   aws ecs deregister-task-definition --task-definition atlas-accesspoint:1 --region ap-south-1
   ```

> **Removing a value from the current revision does not un-expose it.** Anyone
> who already read it still has it. If more than one person has console access,
> **rotate** the credential rather than merely relocating it.

---

## 18. Phase 11 — Adding another customer

This repeats Phase 9 with different values, and is the section you return to for
**every** customer after the first. **Nothing shared is rebuilt** — no new
certificate (the wildcard covers every subdomain), no new load balancer, no new
database server, no new bucket. Budget ~25 minutes each.

### 18.0 The per-customer values

Pick these before you start; everything below is mechanical once they are fixed.
**Use the lowercase slug everywhere** — MySQL database names are case-sensitive
on Linux, and mixed case causes mismatches that surface much later.

| Thing | Pattern | `diligence` | `modernharvest` |
| ----- | ------- | ----------- | --------------- |
| Slug | lowercase, no spaces | `diligence` | `modernharvest` |
| Hostname | `<slug>.open-atlas.xyz` | `diligence.open-atlas.xyz` | `modernharvest.open-atlas.xyz` |
| Database + user | `<slug>` | `diligence` | `modernharvest` |
| S3 prefix | `<slug>` | `diligence` | `modernharvest` |
| Task role | `atlasTaskRole-<slug>` | `atlasTaskRole-diligence` | `atlasTaskRole-modernharvest` |
| Task definition | `atlas-<slug>` | `atlas-diligence` | `atlas-modernharvest` |
| Target group | `atlas-<slug>` | `atlas-diligence` | `atlas-modernharvest` |
| ECS service | `<slug>` | `diligence` | `modernharvest` |
| Log group | `/atlas/<slug>` | `/atlas/diligence` | `/atlas/modernharvest` |
| Secrets | `atlas/<slug>/…` | `atlas/diligence/…` | `atlas/modernharvest/…` |
| ALB rule priority | next unused | 2 | 3 |
| Pre-existing email on the subdomain? | check first | **Yes** — see §18.1 | No — clean slate |

**Check for existing DNS records before you start**, every time:

```powershell
aws route53 list-resource-record-sets --hosted-zone-id <ZONE_ID> --query "ResourceRecordSets[?contains(Name,'<slug>')].[Type,Name]" --output text
```

And find a free ALB priority:

```powershell
aws elbv2 describe-rules --listener-arn <HTTPS_LISTENER_ARN> --query "Rules[].Priority" --output text
```

### 18.1 The steps

| Step | What changes |
| ---- | ------------ |
| **1. Database** (§16.1) | `CREATE DATABASE <slug> …; CREATE USER '<slug>'@'%' …; GRANT ALL PRIVILEGES ON <slug>.* TO '<slug>'@'%';` — a **freshly generated** password |
| **2. Secrets** (§16.2) | `atlas/<slug>/mysql-password` (the tenant user's password, **not** `atlas_admin`'s), `atlas/<slug>/session-secret` — a **fresh** session secret |
| **3. Task role** (§16.3) | `atlasTaskRole-<slug>`, scoped to `…/<slug>/*` — must match `S3_PREFIX` exactly |
| **4. Task definition** (§16.4) | `atlas-<slug>`; swap every `accesspoint` → `<slug>`; `APP_URL=https://<slug>.open-atlas.xyz`; log group `/atlas/<slug>`; the two new secret ARNs; **the current image tag** |
| **5. Target group + rule** (§16.5) | Group `atlas-<slug>`; host header `<slug>.open-atlas.xyz`; next free priority |
| **6. Service** (§16.6) | Service `<slug>`, desired **1**, `atlas-app-sg` only, Public IP ENABLED, **existing HTTPS:443 listener** |
| **7. DNS** (§16.7) | Route 53 A-record **alias** → `atlas-alb`. Check §18.1 first |
| **8. Verify** (§17) | All checks against the new hostname, **including the isolation check against every other customer's database** |
| **9. Add them to the backup job** (§20.2b) | ⚠️ **Easy to forget, fails silently.** Register a new `atlas-backup` task-definition revision with the new database appended to `DATABASES`, point the schedule at it, run once by hand, and confirm the customer's prefix appears in the backups bucket. Until you do, **this customer has no backups** |
| **10. Add their DOWN alarm** (§21.2b) | Create `atlas-<slug>-DOWN` on the new target group's `HealthyHostCount`. Until you do, this customer can be offline indefinitely without anyone being told |

### 18.2 Subdomains that already have email

> **⚠ Check this before creating the DNS record — every time, for every customer.**
>
> Some subdomains inherited mail configuration from IONOS. `diligence.open-atlas.xyz`
> carries `MX` (mx00/mx01.ionos.com), `SPF` (TXT), DKIM
> (`s1-ionos`/`s2-ionos._domainkey`) and `autodiscover` records. `accesspoint`
> and `modernharvest` are clean slates with no records at all.
>
> **Add the A-alias alongside them. Do not replace the record set, and do not
> "tidy up" the mail records** — you would silently kill email for that customer.
> Mail (`MX`) and web (`A`) are different record types at the same name and
> coexist fine.
>
> This is also the concrete reason the alias record matters: a `CNAME` cannot
> legally coexist with `MX`/`TXT` at the same name, and an ALB has no fixed IP to
> put in a plain `A` record. The Route 53 alias is the only clean way to serve
> both mail and the app on this hostname.
>
> After deploying, confirm mail still resolves:
> `nslookup -type=MX diligence.open-atlas.xyz`

> **Reuse nothing sensitive between customers.** Not the database password, not
> the session secret. A shared `SESSION_SECRET` would let a signed attachment URL
> minted by one deployment validate against the other — exactly the cross-customer
> hole this architecture exists to prevent.

**When a third customer makes this feel mechanical, that is the signal to encode
it in Terraform** (§25) so onboarding becomes one command instead of a checklist.

---

# Operating it

## 19. Phase 12 — Releasing an update

**The model in one line:** building an image and deploying it to a customer are
two separate, deliberate acts.

### 19.1 Build

```bash
cd D:\Development\Atlas

# Run the full gate locally first — nothing below checks this for you yet
cd frontend && npm run build && cd ../backend && npm test && cd ..

aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com
docker build --platform linux/arm64 -t atlas .
docker tag atlas:latest <ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com/atlas:v2
docker push <ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com/atlas:v2
```

Tag `v2` cannot be overwritten later — the repository is `IMMUTABLE`. That is
deliberate.

### 19.2 Deploy — one customer at a time

ECS → *Task definitions* → `atlas-accesspoint` → *Create new revision* → change
**only the image tag** to `:v2` → *Create*. Then ECS → cluster `atlas` → service
`accesspoint` → *Update* → set **Revision** to the new one → *Update*.

Expect ~5 minutes: the new container starts alongside the old one, and the load
balancer shifts traffic only once `/api/health/ready` passes.

**Then verify by hand** (§17, checks 1–5). Only then repeat for `diligence`.

> **One customer per release, verified in between — deliberately.** A bad release
> caught on the first customer never reaches the second. Customers briefly running
> different versions is a property of the silo model, not a problem.

### 19.3 What protects you

- **A broken container cannot take a customer down.** ECS keeps the old task
  serving until the new one passes its health check. If the new one never goes
  healthy, the old one keeps running and the deployment fails loudly.
- **A database it cannot reach counts as unhealthy**, because the health check
  runs a real query.
- **Nothing deploys by accident.** Pushing code does nothing; building does
  nothing. Only updating a service touches a customer.

### 19.4 Rolling back

Update the service back to the **previous revision**. No rebuild — the old image
is still in ECR, unchanged.

> **Rollback reverts code, not schema.** Atlas runs pending migrations on boot
> (`backend/migrations.js`), and an applied migration stays applied. So **write
> migrations to be backward-compatible with the previous release**, and never
> pair a destructive schema change with a release you might roll back — split it
> across two releases.

---

## 20. Phase 13 — Backups

Two layers, different failure modes. **You need both.**

### 20.1 Already on — RDS automated backups

Enabled in Phase 4. Point-in-time recovery of **the whole server — both customers
at once** — to any minute in the retention window. Covers "the instance died" or
"a migration corrupted everything".

**Check your actual retention — do not assume:**

```bash
aws rds describe-db-instances --db-instance-identifier atlas-db --region ap-south-1 --query "DBInstances[0].{Retention:BackupRetentionPeriod,Pending:PendingModifiedValues}"
```

On the free plan this is **1 day and cannot be raised**. If `Pending` is
non-empty, a change is queued but not yet in effect — `Retention` is what is
protecting you today.

**Two traps:** deleting a DB instance **deletes its automated backups** unless
you take a final snapshot; and point-in-time recovery only ever restores to a
**new** instance, never in place.

### 20.2 Add — nightly per-customer dumps to S3

**Why both.** Point-in-time recovery restores the whole server. When *one*
customer says "we deleted a project yesterday", restoring the instance would roll
the *other* customer back too. A per-customer dump restores only them.

Create the bucket once:

```bash
aws s3 mb s3://atlas-backups-<ACCOUNT_ID> --region ap-south-1
aws s3api put-bucket-versioning --bucket atlas-backups-<ACCOUNT_ID> --versioning-configuration Status=Enabled
```

Then, nightly, per customer (run from a host that can reach RDS on 3306 — your
laptop or CloudShell):

**PowerShell (Windows):**

```powershell
$stamp = Get-Date -Format yyyy-MM-dd
mysqldump -h <RDS_ENDPOINT> -u atlas_admin -p --ssl-mode=REQUIRED --single-transaction --routines --triggers accesspoint > "accesspoint-$stamp.sql"
aws s3 cp "accesspoint-$stamp.sql" s3://atlas-backups-<ACCOUNT_ID>/accesspoint/
# then repeat for diligence
```

**Bash (CloudShell, macOS, Linux):**

```bash
STAMP=$(date +%F)
mysqldump -h <RDS_ENDPOINT> -u atlas_admin -p --ssl-mode=REQUIRED --single-transaction --routines --triggers accesspoint > "accesspoint-$STAMP.sql"
aws s3 cp "accesspoint-$STAMP.sql" s3://atlas-backups-<ACCOUNT_ID>/accesspoint/
```

`--single-transaction` takes a consistent snapshot without locking the tables, so
the customer notices nothing.

> **Match your client's major version to RDS.** A `mysqldump` much newer than the
> server can emit syntax the server cannot restore. Check with `mysqldump
> --version` against the RDS engine version, or just use CloudShell.

**On the free plan, schedule this rather than relying on memory** — with 1-day
PITR, these dumps are your only recovery path beyond 24 hours. §25 covers
automating it with EventBridge Scheduler and a one-off ECS task. (A scheduled
GitHub Actions job will *not* work: its runners have dynamic IPs, so it would
require opening the database security group far wider than is acceptable.)

**Uploaded files** are already durable in S3 with versioning on, so they are not
part of this dump. Note that this means a restore mixes an old database with
current files — usually harmless (orphan rows referencing deleted files show as
"not found"), but worth knowing before an incident rather than during one.

### 20.2b The automated nightly job — as built

§20.2's manual commands are the fallback. The scheduled version is **already
deployed** and is what actually runs:

```
EventBridge Scheduler: atlas-nightly-backup
   cron(30 20 * * ? *) UTC  =  02:00 IST
   retries twice, max event age 1 hour
        │
        └──► ECS RunTask — Fargate, ARM64, one-off
                 task definition: atlas-backup
                 image:  <ACCOUNT>.dkr.ecr.<REGION>.amazonaws.com/atlas-backup
                 role:   atlasBackupTaskRole  (s3:PutObject on the backups bucket only)
                 secret: the RDS master password, from Secrets Manager
                 │
                 └──► s3://<backups-bucket>/<customer>/<customer>-<date>.sql.gz
```

The image is `mysql:8.0` (matching the RDS engine major version) plus AWS CLI v2,
running a shell script that loops the databases listed in `DATABASES`.

**Two `mysqldump` flags are mandatory on RDS and must not be removed:**

| Flag | Why |
| ---- | --- |
| `--set-gtid-purged=OFF` | Without it `mysqldump` issues `FLUSH TABLES WITH READ LOCK` to record a GTID position. That needs the `RELOAD` privilege, which **RDS withholds from the master user** — the dump fails with `Access denied`, which misleadingly looks like a wrong password |
| `--no-tablespaces` | Needs the `PROCESS` privilege, withheld for the same reason |

The script also **refuses to upload a dump under 1KB** and exits non-zero if any
database fails — a failed `mysqldump` otherwise produces a small file containing
only an error message, which uploads perfectly happily and looks like a backup
until the day you need it.

`--databases` is deliberately **not** used, so the dumps contain no
`CREATE DATABASE`/`USE` statements and can be restored into a scratch database
(§20.3) rather than only over the live one.

#### ⚠ Adding a customer requires updating this job

`DATABASES` is a fixed space-separated list in the task definition. **A new
customer is not backed up until you add them**, and nothing warns you:

1. Register a new `atlas-backup` revision with the customer appended to `DATABASES`
2. Point the schedule at the new revision (`aws scheduler update-schedule`, or
   EventBridge console → Schedules → Edit)
3. Run it once by hand and confirm the new prefix appears in S3

Add this to the §18 customer checklist. It fails silently and in the direction of
data loss, which is the worst combination.

#### Changing the schedule

```bash
aws scheduler update-schedule --name atlas-nightly-backup --region <REGION> --schedule-expression "cron(30 2 * * ? *)" --schedule-expression-timezone "Asia/Kolkata" --flexible-time-window "Mode=OFF" --target file://sched-target.json
```

`update-schedule` replaces the whole definition, so the full `--target` block
must be supplied — keep `sched-target.json`. Setting
`--schedule-expression-timezone` to a real zone lets you write local times
directly instead of converting to UTC.

#### Running it on demand

```bash
aws ecs run-task --cluster atlas --task-definition atlas-backup --launch-type FARGATE --network-configuration "awsvpcConfiguration={subnets=[<SUBNETS>],securityGroups=[<APP_SG>],assignPublicIp=ENABLED}"
```

`assignPublicIp=ENABLED` is required — the task needs to reach ECR, S3 and
Secrets Manager, and there is deliberately no NAT Gateway.

#### Still missing

- **No alert on failure.** A 2am failure is silent until you need a restore.
  Fix with a CloudWatch alarm on the task's exit code → SNS (§21).
- **No retention policy** on the backups bucket. Dumps accumulate indefinitely.
  Cheap, but set a deliberate window — these contain personal data, and
  "we keep it forever by accident" is not a defensible position.

### 20.3 Restore one customer — practise this now

**A backup you have never restored is a hope, not a backup.** Do this once while
nothing is at stake.

```bash
aws s3 cp s3://atlas-backups-<ACCOUNT_ID>/accesspoint/accesspoint-2026-07-20.sql .

mysql -h <RDS_ENDPOINT> -u atlas_admin -p --ssl-mode=REQUIRED -e "CREATE DATABASE accesspoint_restore CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

mysql -h <RDS_ENDPOINT> -u atlas_admin -p --ssl-mode=REQUIRED accesspoint_restore < accesspoint-2026-07-20.sql
```

**Confirm it actually landed** — an empty list means the restore failed even if
no error printed:

```bash
mysql -h <RDS_ENDPOINT> -u atlas_admin -p --ssl-mode=REQUIRED -e "USE accesspoint_restore; SHOW TABLES;"
```

You should see Atlas's tables (`users`, `issues`, `projects`, `sessions`, …).

**Then drop the scratch database** so it stops costing storage and cannot be
mistaken for the live one:

```bash
mysql -h <RDS_ENDPOINT> -u atlas_admin -p --ssl-mode=REQUIRED -e "DROP DATABASE accesspoint_restore;"
```

---

## 21. Phase 14 — Monitoring and alerts

**What this is doing.** Everything so far gets a customer *running*. This is what
tells you when one **stops** — before the customer does. Health checks already
replace a broken container automatically; monitoring is the separate job of
paging a human for what self-healing cannot fix.

The pattern is always the same three pieces:

```
 a CloudWatch metric crosses a threshold → an Alarm fires → an SNS topic → your email
```

**Set this up before either customer goes live.** An alarm added after the outage
is a lesson, not a safeguard.

### 21.1 The pager (once)

```bash
aws sns create-topic --name atlas-alerts --region ap-south-1
# note the TopicArn

aws sns subscribe --topic-arn <ALERTS_TOPIC_ARN> --protocol email --notification-endpoint you@example.com --region ap-south-1
```

**Check your inbox and click "Confirm subscription".** Until you do, every alarm
below fires silently into the void. Verify:

```bash
aws sns list-subscriptions-by-topic --topic-arn <ALERTS_TOPIC_ARN> --region ap-south-1
# SubscriptionArn must be a real ARN, not the word "PendingConfirmation"
```

### 21.2 The alarms worth having

Create these in CloudWatch → *Alarms* → *Create alarm*, each with action *Send
notification to* → `atlas-alerts`:

| Alarm | Metric | Threshold | Why |
| ----- | ------ | --------- | --- |
| **Customer is down** | `TargetGroup HealthyHostCount` per target group | `< 1` for 2 minutes | The single most important alarm — that customer's app is unreachable |
| **Database storage** | RDS `FreeStorageSpace` | `< 2 GB` | A full disk takes **both** customers down at once |
| **Database CPU** | RDS `CPUUtilization` | `> 80%` for 10 min | Early warning before it becomes an outage |
| **Database connections** | RDS `DatabaseConnections` | `> 40` | Approaching the instance's limit |
| **Container crash loop** | ECS `RunningTaskCount` per service | `< 1` for 5 minutes | Distinguishes "crashing on startup" from "unhealthy" |
| **5xx errors** | ALB `HTTPCode_Target_5XX_Count` | `> 10` in 5 min | The app is up but erroring |

Create the "customer is down" and "database storage" alarms **per target group /
once respectively** at minimum. The rest are worth the ten minutes.

### 21.2b What is actually deployed

Nine alarms and one event rule, all publishing to the `atlas-alerts` SNS topic.

| Alarm | Metric | Threshold | Catches |
| ----- | ------ | --------- | ------- |
| `atlas-<customer>-DOWN` (one per customer) | `HealthyHostCount` | `< 1` for 2 min | That customer's app is unreachable |
| `atlas-rds-storage-low` | `FreeStorageSpace` | `< 2 GB` | A full disk — takes **every** customer down at once |
| `atlas-rds-memory-low` | `FreeableMemory` | `< 100 MB` | Swapping on a 1 GB instance |
| `atlas-rds-cpu-high` | `CPUUtilization` | `> 80%` for 15 min | Early warning |
| `atlas-rds-connections-high` | `DatabaseConnections` | `> 40` | Approaching the instance limit |
| `atlas-alb-5xx` | `HTTPCode_Target_5XX_Count` | `> 10` in 5 min | App is up but erroring |
| `atlas-cert-expiring` | `DaysToExpiry` | `< 21 days` | ACM auto-renewal has failed — expiry takes all customers offline simultaneously |
| `atlas-backup-failed` *(EventBridge rule, not an alarm)* | ECS Task State Change, non-zero exit | — | The nightly backup ran and failed |

The `*-DOWN` alarms use `treat-missing-data breaching` deliberately: metrics
ceasing entirely is itself a problem and should page, not sit quietly in
`INSUFFICIENT_DATA`. All alarms also set `--ok-actions`, so a "resolved" email
follows; drop those if it proves noisy.

> **⚠ Setting an SNS topic policy replaces it wholesale — it does not merge.**
> The topic policy must grant publish rights to **all three** of: the account
> owner, `cloudwatch.amazonaws.com` (the alarms), and `events.amazonaws.com`
> (the backup rule). Adding a statement for one by itself silently blocks the
> others, and the symptom is alarms that change state correctly while no email
> ever arrives.

Three further alarms, each catching something the others cannot:

| Alarm | Metric | Threshold | Why it earns its place |
| ----- | ------ | --------- | ---------------------- |
| `atlas-rds-cpu-credits-low` | `CPUCreditBalance` | `< 30` | `db.t4g.micro` is **burstable**. At zero credits the instance is throttled hard and the app becomes inexplicably slow **while CPU utilisation looks normal** — no other alarm sees this, and it is baffling without the metric |
| `atlas-alb-elb-5xx` | `HTTPCode_ELB_5XX_Count` | `> 5` in 5 min | Errors from the load balancer itself, usually "no healthy targets". In a total outage `Target_5XX` stays silent, because nothing is there to return an error |
| `atlas-alb-slow` | `TargetResponseTime` p95 | `> 3s` for 10 min | Slowness precedes outages — the one alarm that may let you act before customers notice |

### 21.2c The dashboard

`atlas-overview` — one page covering all customers:

- Healthy containers per customer, with the failure threshold marked
- Requests and errors, split into **app 5xx** vs **ALB 5xx** (different failures)
- p95/p99 latency
- The shared RDS row — CPU, burst credits, storage, memory, connections,
  labelled as shared because a problem there hits **every** customer at once
- Live alarm status
- Two Logs Insights panels: recent errors across all customers, and the nightly
  backup history so a glance confirms it ran

```bash
aws cloudwatch put-dashboard --dashboard-name atlas-overview --dashboard-body file://dashboard.json
```

Console: CloudWatch → Dashboards → `atlas-overview`.

#### Deliberately not added

- **ECS `RunningTaskCount`** — redundant with `HealthyHostCount`, which already
  catches crashed *and* unhealthy. Duplicate coverage is how real alerts get
  ignored.
- **CloudWatch Synthetics canaries** — would log in and click through on a
  schedule, catching "up but broken" (login failing while `/api/health/ready`
  still returns 200, since it only proves the database is reachable). This is
  the largest remaining blind spot. ~$5/month for three customers on a 5-minute
  schedule — worth it once these are revenue-generating.
- **RDS read/write latency** — meaningful at scale, noise at this size.

#### A gap this does not cover

`atlas-backup-failed` catches "the backup ran and failed." It does **not** catch
"the backup never ran" — if the schedule is disabled or deleted, no task starts,
no event fires, and nothing alerts. Silence is not success.

Options for closing it are either unreliable (alarming on EventBridge Scheduler
metrics) or billable (S3 request metrics), so the pragmatic mitigation is a
monthly habit:

```bash
aws s3 ls s3://<backups-bucket>/ --recursive | tail -5
```

Confirm the dates are recent. Ten seconds, and it catches the one failure mode
the automation cannot see.

#### Adding a customer

Create a `atlas-<customer>-DOWN` alarm for their target group — §18's checklist
step. Without it, that customer can be down indefinitely with no alert.

### 21.3 Sanity-check that alerts actually arrive

Temporarily set the `HealthyHostCount` alarm threshold to `< 5` so it fires
immediately, confirm the email arrives, then set it back to `< 1`. Untested
alerting is indistinguishable from no alerting.

---

## 22. Phase 15 — Removing a customer

**Order matters** — the final backup comes first, while the data still exists.

1. **Final dump to S3** (§20.2), named e.g. `accesspoint-final-2026-07-20.sql`.
   This is what makes it possible to bring a returning customer back later.
2. **Copy their files out** of the S3 prefix if you are keeping them:
   ```bash
   aws s3 sync s3://atlas-uploads-<ACCOUNT_ID>/accesspoint/ ./accesspoint-files/
   ```
3. **Optionally deliver an export to the customer** — it is their data, and
   contracts usually promise it.
4. **Delete, in reverse creation order:**
   - ECS service `accesspoint` → set **Desired tasks 0**, then **Delete**
   - The ALB HTTPS:443 listener **rule** for that hostname
   - Target group `atlas-accesspoint`
   - The Route 53 record
   - Task definition `atlas-accesspoint` → *Deregister* its revisions
   - IAM role `atlasTaskRole-accesspoint`
   - The two `atlas/accesspoint/…` secrets
   - The S3 prefix: `aws s3 rm s3://atlas-uploads-<ACCOUNT_ID>/accesspoint/ --recursive`
   - Finally, in MySQL: `DROP DATABASE accesspoint; DROP USER 'accesspoint'@'%';`
5. Their ~$11/month stops immediately.

> **State a retention window in your terms of service** (e.g. "data is retained
> 12 months after cancellation, then permanently deleted"). Atlas holds personal
> data — names, emails, comments — and GDPR-style regimes frown on indefinite
> retention without a stated purpose. An S3 lifecycle rule can perform the final
> deletion automatically.

---

## 23. Costs

Estimates: on-demand, `ap-south-1`, at the time of writing. Re-check against the
[AWS calculator](https://calculator.aws) before budgeting.

**Fixed base — regardless of customer count:**

| Item | ~$/month |
| ---- | -------- |
| RDS MySQL `db.t4g.micro` + 20 GB gp3 | 14 |
| Application Load Balancer | 17 |
| Public IPv4 on the ALB (2 × ~$3.65) | 7 |
| Route 53 hosted zone | 0.50 |
| ECR + S3 + CloudWatch logs, misc | 3 |
| **Base** | **~42** |

**Per customer:**

| Item | ~$/month |
| ---- | -------- |
| Fargate ARM64, 0.25 vCPU / 0.5 GB, 24×7 | 7 |
| Public IPv4 on the task | 3.65 |
| Secrets Manager (2 × $0.40) | 0.80 |
| Their database and S3 prefix | ~0 |
| **Per customer** | **~11** |

| Customers | ~$/month |
| --------- | -------- |
| 2 (today) | **~64** |
| 5 | ~97 |
| 10 | ~165 (bump RDS one class) |

**Cost traps that dwarf everything above:**

1. **NAT Gateway** (~$32/month + data). Wizards love adding one. You do not need
   it.
2. **Multi-AZ RDS** doubles the database cost. Skip until revenue justifies it.
3. **Log groups with no retention.** The default is *never expire*. Set 30 days
   (§17 check 8).
4. **Forgotten resources** from a departed customer (§22).

**Optimisations already applied:** ARM64/Graviton Fargate (~20% cheaper), no NAT
Gateway, single-AZ RDS, one shared ALB.

**Available once you upgrade to a paid account and the sizes have settled:** an
RDS Reserved Instance (~30% off) and a Compute Savings Plan for Fargate (~20%
off). Neither is purchasable on the free plan.

---

## 24. Troubleshooting

Work top-down — the first matching symptom is usually the real one.

**Task starts, then stops immediately.**
ECS → cluster → *Tasks* → **Stopped** tab → click the task → read
**Stopped reason**, then the *Logs* tab.
- `exec format error` → the image was built for the wrong CPU. Rebuild with
  `--platform linux/arm64` (or set `cpuArchitecture` to `X86_64`). They must match.
- `ResourceInitializationError … logs:CreateLogGroup` → the inline policy from
  §15.6 is missing from the execution role.
- `ResourceInitializationError … secretsmanager` → the secret ARN is wrong, or
  its name does not start with `atlas/`.
- `CannotPullContainerError` → **Public IP: ENABLED** is off on the service.

**Task runs but the target never becomes healthy.**
CloudWatch → `/atlas/<customer>` → newest stream.
- `ETIMEDOUT` / `ECONNREFUSED` connecting to MySQL → `atlas-db-sg` is missing the
  rule allowing `atlas-app-sg` on 3306.
- `Access denied for user` → wrong password in Secrets Manager, or the `GRANT`
  was never run.
- TLS handshake errors → the RDS CA bundle is missing from the image (Phase 0.3)
  or `MYSQL_SSL_CA` points somewhere wrong.
- Nothing in the logs at all → the health check path is wrong. It must be
  `/api/health/ready`, and the target group port must be **3001**.

**Browser shows 404 "unknown tenant".**
The ALB has no rule matching that hostname. Check the host header on the rule for
an exact match (§16.5), including no typos and no trailing dot.

**Certificate warning in the browser.**
The ACM certificate is not attached to the HTTPS:443 listener, or DNS points
somewhere other than the ALB. Re-check §14 and §16.7.

**Uploads work but disappear after a deploy.**
`S3_BUCKET` is not set in the task definition, or the Phase 0.1 changes are not
in the image you pushed. Check the running container's environment in the ECS
console, and confirm the image tag is the one you built after the code change.

**Uploads fail with `AccessDenied`.**
The task role's S3 policy prefix does not match `S3_PREFIX`. They must agree
exactly — `S3_PREFIX=accesspoint` needs `…/accesspoint/*` in the policy.

**Live updates stop after a minute or two.**
The ALB idle timeout was not raised (§15.5), or something between the browser and
the ALB is buffering. Check the browser devtools Network tab: the `/api/stream`
request should stay open with periodic `: ping` comments.

**`mysql` from your laptop suddenly stops connecting.**
Your home IP changed. Update the *My IP* rule on `atlas-db-sg` (§10).

**A change you deployed is not visible.**
The service is still on the old revision. ECS → service → *Deployments* — the
revision number there is the truth, not the one you created.

---

## 25. What to automate next

In the order the pain usually arrives:

1. ~~**Nightly backups.**~~ **Done** — see §20.2b. EventBridge Scheduler → a
   one-off Fargate task running `mysqldump` → S3, inside the VPC. (A scheduled
   GitHub Actions job could not do this: its runners' IPs are dynamic, so it
   would need the RDS security group opened far wider than is acceptable.)
   What remains is alerting on failure and a retention policy.
2. **A release pipeline.** GitHub Actions with **OIDC** — an IAM role GitHub can
   assume, so there are no long-lived AWS keys in your repository. Two workflows:
   *build image on tag*, and *deploy one customer on manual dispatch*. Your
   existing `.github/workflows/ci-cd.yml` is the natural place to start.
3. **Terraform for the customer stack.** Once customer three feels mechanical,
   encode §16 as a module: database, user, secrets, task role, task definition,
   target group, ALB rule, service, DNS record. Onboarding becomes
   `terraform apply` with a new entry in a list — and, just as importantly,
   *offboarding* becomes complete rather than a checklist you might half-finish.
4. **Move admin access off your home IP.** Remove the *My IP* rule and reach the
   database through an SSM Session Manager bastion instead.
5. **Shared state for live updates and rate limiting.** Only when one customer
   genuinely outgrows a single container. Until then, scaling up is simpler and
   cheaper than the refactor.

---

## 26. Security checklist

Go through this before handing either URL to a customer.

**Account**
- [ ] Root user has MFA; you are working as `admin`, not root
- [ ] `admin` user has MFA
- [ ] A budget alarm exists and its email is confirmed

**Network**
- [ ] `atlas-db-sg` allows 3306 **only** from `atlas-app-sg` and your IP — never `0.0.0.0/0`
- [ ] `atlas-app-sg` allows 3001 **only** from `atlas-alb-sg`
- [ ] No NAT Gateway exists (check your bill, not your memory)

**Data**
- [ ] Each customer has their **own** database, database user, and password
- [ ] Each customer has their **own** `SESSION_SECRET` — never shared or reused
- [ ] The isolation check (§17, step 9) has been run and **denied** in both directions
- [ ] RDS encryption at rest is on; `MYSQL_SSL=true` is set in every task definition
- [ ] The uploads bucket blocks all public access; versioning is on
- [ ] Each task role is scoped to its own S3 prefix

**Application**
- [ ] `SEED_DEMO_DATA=false` in every task definition — no `password123` accounts
- [ ] `ADMIN_PASSWORD` has been changed in-app and removed from the task definition (§17.1)
- [ ] Old task definition revisions containing plaintext credentials are deregistered
- [ ] `CORS_ORIGINS` is empty, not `*`
- [ ] `NODE_ENV=production` (this is what enables HSTS in `server.js`)

**Operations**
- [ ] A restore has been practised end to end (§20.3)
- [ ] The upload-survives-redeploy test passed (§17, step 6)
- [ ] Alarms exist and a test alert actually reached your inbox
- [ ] CloudWatch log retention is set to 30 days on every log group
- [ ] RDS deletion protection is on
- [ ] **The account has been upgraded from the free plan** before real customer data lands

---

## Appendix — Notes and conventions

> **This repository is public. Do not record account IDs, resource IDs, VPC or
> security-group IDs, endpoints, bucket names, or IP addresses here.** None of
> them are secrets on their own, but together they are a free map of the
> infrastructure, and **git history is permanent** — deleting a value in a later
> commit does not remove it from the repo.
>
> Keep the filled-in values in your password manager, alongside the passwords
> they pair with (they are largely useless apart), or in a local
> `docs/AWS-VALUES.local.md`, which `.gitignore` excludes.
>
> Everything the guide needs can also be re-read from AWS at any time, e.g.
> `aws sts get-caller-identity`, `aws rds describe-db-instances`,
> `aws elbv2 describe-load-balancers`.

**Region:** `ap-south-1` (Mumbai) throughout.

**Subdomains do not need registering.** You own `open-atlas.xyz`, so every
`<anything>.open-atlas.xyz` is already yours — it exists as soon as a Route 53
record for it exists. Only a *different root domain* (e.g. `accesspoint.com`)
would be a real registration, and it would also need its own ACM certificate,
since the wildcard covers `*.open-atlas.xyz` only.

**DNS changes are made in Route 53 only.** The domain is registered at IONOS but
delegated to Route 53. Edits in the IONOS DNS panel appear to save and have no
effect whatsoever.

**The registrar account is controlled by someone else.** Two standing risks:
a lapsed renewal takes every customer offline, and a nameserver change silently
undoes the delegation. Confirm auto-renew is on, and that whoever holds that
account knows not to touch the nameservers.

**Records deliberately left in place:** `money2abroad.open-atlas.xyz` keeps its
IONOS mail records (MX/SPF/DKIM/autodiscover) even though it is no longer a
customer. Dropping it as a deployment target does not mean its email should
stop working — leave those records alone unless someone confirms otherwise.

**RDS certificate authority:** the instance uses `rds-ca-rsa2048-g1`, which is
covered by the global bundle baked into the image at Phase 0.3. If AWS rotates
the instance to a newer CA, rebuild the image so the bundle is refreshed.
