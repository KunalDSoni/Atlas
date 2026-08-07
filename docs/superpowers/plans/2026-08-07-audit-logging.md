# Advanced Audit Logging Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enhance existing audit log with export (CSV/JSON), advanced filtering, retention policies, and compliance report builders without breaking current audit trail.

**Architecture:** Existing `auditlog` table stays immutable. New tables: `audit_log_exports` (tracks generated exports), `audit_retention_policies` (global retention rules). Frontend adds Admin Audit Log screen with filter UI, export generator, retention policy editor. Export runs async in background, sends notification when ready.

**Tech Stack:** Node.js/Express, SQLite/MySQL, React + Tailwind, CSV/JSON export libraries.

## Global Constraints

- Existing `auditlog` table is immutable (read-only)
- Export must redact sensitive fields (passwords, tokens, API keys)
- Exports expire after retention period (default 30 days)
- Admin-only access for all audit operations
- Async export (no blocking UI)

---

## File Structure

**Backend:**
- `backend/migrations.js` — Add export/retention tables
- `backend/routes/admin.js` — Extend with audit endpoints
- `backend/jobs/export-audit-log.js` — Async export job (new)
- `backend/lib/audit-exporter.js` — Export logic (new)
- `backend/tests/backend/audit-export.test.js` — Tests (new)

**Frontend:**
- `frontend/src/screens/AdminAuditLog.tsx` — Main audit screen (new)
- `frontend/src/components/AuditLogExportPanel.tsx` — Export builder (new)
- `frontend/src/components/AuditLogFilter.tsx` — Filter UI (new)
- `frontend/src/components/RetentionPolicyEditor.tsx` — Policy settings (new)
- `frontend/tests/e2e/audit-export.spec.ts` — E2E tests (new)

---

## Task Breakdown

### Task 1: Database Migrations

- [ ] Add migrations to `backend/migrations.js`:

```javascript
{
  id: '011_audit_export_support',
  description: 'Add audit export tracking tables',
  steps: [
    {
      sql: {
        sqlite: `CREATE TABLE IF NOT EXISTS audit_log_exports (
          id VARCHAR(36) PRIMARY KEY,
          created_by_id VARCHAR(36),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          export_format VARCHAR(20),
          filter_criteria TEXT,
          row_count INT,
          file_path TEXT,
          file_size INT,
          expiration_date DATETIME,
          downloaded_at DATETIME,
          KEY idx_created_by (created_by_id)
        )`,
        mysql: `CREATE TABLE IF NOT EXISTS audit_log_exports (
          id VARCHAR(36) PRIMARY KEY,
          created_by_id VARCHAR(36),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          export_format VARCHAR(20),
          filter_criteria JSON,
          row_count INT,
          file_path TEXT,
          file_size INT,
          expiration_date DATETIME,
          downloaded_at DATETIME,
          KEY idx_created_by (created_by_id)
        )`,
      },
    },
    {
      sql: {
        sqlite: `CREATE TABLE IF NOT EXISTS audit_retention_policies (
          id VARCHAR(36) PRIMARY KEY,
          retention_days INT DEFAULT 365,
          auto_archive_enabled BOOLEAN DEFAULT false,
          archive_storage_type VARCHAR(50) DEFAULT 'local',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_by_id VARCHAR(36),
          updated_at DATETIME
        )`,
        mysql: `CREATE TABLE IF NOT EXISTS audit_retention_policies (
          id VARCHAR(36) PRIMARY KEY,
          retention_days INT DEFAULT 365,
          auto_archive_enabled BOOLEAN DEFAULT false,
          archive_storage_type VARCHAR(50) DEFAULT 'local',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_by_id VARCHAR(36),
          updated_at DATETIME
        )`,
      },
    },
  ],
}
```

- [ ] Commit: `git commit -m "feat: add audit logging tables for export and retention"`

---

### Task 2: Audit Export Logic

**Files:**
- Create: `backend/lib/audit-exporter.js`
- Create: `backend/jobs/export-audit-log.js`

- [ ] Create `backend/lib/audit-exporter.js`:

```javascript
const { stringify } = require('csv-stringify/sync');
const fs = require('fs');
const path = require('path');

const REDACTED_FIELDS = ['password', 'token', 'api_key', 'secret'];

class AuditExporter {
  static redactFields(record) {
    const redacted = { ...record };
    REDACTED_FIELDS.forEach(field => {
      if (redacted[field]) {
        redacted[field] = '***REDACTED***';
      }
    });
    return redacted;
  }
  
  static buildQuery(filters) {
    let sql = 'SELECT * FROM auditlog WHERE 1=1';
    const params = [];
    
    if (filters.dateRange) {
      const [from, to] = filters.dateRange;
      sql += ' AND created_at >= ? AND created_at <= ?';
      params.push(from, to);
    }
    
    if (filters.userIds?.length) {
      sql += ` AND actor_id IN (${filters.userIds.map(() => '?').join(',')})`;
      params.push(...filters.userIds);
    }
    
    if (filters.actionTypes?.length) {
      sql += ` AND type IN (${filters.actionTypes.map(() => '?').join(',')})`;
      params.push(...filters.actionTypes);
    }
    
    if (filters.resourceTypes?.length) {
      sql += ` AND resource_type IN (${filters.resourceTypes.map(() => '?').join(',')})`;
      params.push(...filters.resourceTypes);
    }
    
    sql += ' ORDER BY created_at DESC';
    return { sql, params };
  }
  
  static exportToCSV(records) {
    const redacted = records.map(r => this.redactFields(r));
    return stringify(redacted, { header: true });
  }
  
  static exportToJSON(records) {
    const redacted = records.map(r => this.redactFields(r));
    return JSON.stringify(redacted, null, 2);
  }
}

module.exports = AuditExporter;
```

- [ ] Create `backend/jobs/export-audit-log.js`:

```javascript
const db = require('../db');
const AuditExporter = require('../lib/audit-exporter');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

async function exportAuditLog(exportId) {
  try {
    const exportRecord = db.get('SELECT * FROM audit_log_exports WHERE id = ?', [exportId]);
    if (!exportRecord) return;
    
    const filters = JSON.parse(exportRecord.filter_criteria || '{}');
    const { sql, params } = AuditExporter.buildQuery(filters);
    const records = db.all(sql, params);
    
    const dir = path.join(process.cwd(), 'exports');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    
    let content, filename;
    if (exportRecord.export_format === 'csv') {
      content = AuditExporter.exportToCSV(records);
      filename = `audit-log-${exportId}.csv`;
    } else {
      content = AuditExporter.exportToJSON(records);
      filename = `audit-log-${exportId}.json`;
    }
    
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, content);
    const fileSize = fs.statSync(filePath).size;
    
    db.run(
      `UPDATE audit_log_exports SET file_path = ?, file_size = ?, row_count = ? WHERE id = ?`,
      [filePath, fileSize, records.length, exportId]
    );
    
    // Send notification (placeholder)
    console.log(`Export ${exportId} complete: ${records.length} rows`);
  } catch (error) {
    console.error(`Export ${exportId} failed:`, error);
  }
}

module.exports = { exportAuditLog };
```

- [ ] Commit: `git commit -m "feat: add audit export logic"`

---

### Task 3: Backend Audit API Endpoints

**Files:**
- Modify: `backend/routes/admin.js`

- [ ] Add to `backend/routes/admin.js`:

```javascript
const { exportAuditLog } = require('../jobs/export-audit-log');
const AuditExporter = require('../lib/audit-exporter');

// POST /api/admin/audit-log/export
router.post('/audit-log/export', adminOnly, async (req, res) => {
  try {
    const { format, filters } = req.body;
    
    if (!['csv', 'json'].includes(format)) {
      return res.status(400).json({ error: true, message: 'Invalid format' });
    }
    
    const exportId = uuidv4();
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + 30);
    
    db.run(
      `INSERT INTO audit_log_exports (id, created_by_id, export_format, filter_criteria, expiration_date)
       VALUES (?, ?, ?, ?, ?)`,
      [exportId, req.user.id, format, JSON.stringify(filters || {}), expirationDate.toISOString()]
    );
    
    // Queue async export job
    exportAuditLog(exportId).catch(err => console.error('Export job failed:', err));
    
    res.json({ data: { exportId, status: 'processing' } });
  } catch (error) {
    res.status(500).json({ error: true, message: error.message });
  }
});

// GET /api/admin/audit-log/exports
router.get('/audit-log/exports', adminOnly, (req, res) => {
  try {
    const exports = db.all(
      `SELECT id, created_at, export_format, row_count, expiration_date, downloaded_at
       FROM audit_log_exports ORDER BY created_at DESC LIMIT 50`
    );
    res.json({ data: exports });
  } catch (error) {
    res.status(500).json({ error: true, message: error.message });
  }
});

// DELETE /api/admin/audit-log/exports/:id
router.delete('/audit-log/exports/:id', adminOnly, (req, res) => {
  try {
    const exportRecord = db.get('SELECT * FROM audit_log_exports WHERE id = ?', [req.params.id]);
    if (!exportRecord) return res.status(404).json({ error: true, message: 'Export not found' });
    
    if (exportRecord.file_path) fs.unlinkSync(exportRecord.file_path);
    db.run('DELETE FROM audit_log_exports WHERE id = ?', [req.params.id]);
    
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ error: true, message: error.message });
  }
});

// PUT /api/admin/audit-log/retention-policy
router.put('/audit-log/retention-policy', adminOnly, (req, res) => {
  try {
    const { retentionDays, autoArchiveEnabled } = req.body;
    
    db.run(
      `UPDATE audit_retention_policies SET retention_days = ?, auto_archive_enabled = ?, updated_by_id = ?, updated_at = datetime('now')`,
      [retentionDays, autoArchiveEnabled ? 1 : 0, req.user.id]
    );
    
    const policy = db.get('SELECT * FROM audit_retention_policies LIMIT 1');
    res.json({ data: policy });
  } catch (error) {
    res.status(500).json({ error: true, message: error.message });
  }
});
```

- [ ] Commit: `git commit -m "feat: add audit export API endpoints"`

---

### Task 4: Frontend Components

**Files:**
- Create: `frontend/src/screens/AdminAuditLog.tsx`
- Create: `frontend/src/components/AuditLogExportPanel.tsx`
- Create: `frontend/src/components/AuditLogFilter.tsx`

- [ ] Create comprehensive React components (similar structure to other screens)

- [ ] Commit: `git commit -m "feat: add audit log admin UI"`

---

### Task 5: E2E Tests

- [ ] Write tests for export flow, filtering, retention policy UI

- [ ] Commit: `git commit -m "test: add E2E tests for audit export"`

---

## Summary

✅ Immutable audit trail preserved  
✅ Export redacts sensitive data  
✅ Async export doesn't block UI  
✅ Retention policies configurable  
✅ Admin-only access  

This plan is ready for execution.
