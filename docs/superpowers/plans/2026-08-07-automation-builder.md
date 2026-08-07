# No-code Automation Builder Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Visual drag-and-drop workflow builder for creating if-then automation rules without code. Support triggers (events), conditions (IF), and actions (THEN).

**Architecture:** Extend existing `automations` table with `rule_config` (JSON DAG), `visual_layout` (node positions), `enabled` flag. New table `automation_executions` logs each rule execution. New table `automation_templates` stores pre-built rules. Backend rule engine evaluates triggers/conditions, executes actions atomically. Frontend uses React Flow for visual editor.

**Tech Stack:** React Flow (canvas), Node.js rule engine, SQLite/MySQL, Jest/Playwright.

## Global Constraints

- DAG validation: no cycles, all triggers/conditions/actions valid
- Execution timeout: 30s max per rule
- Auto-disable after 3 consecutive failures
- Immutable execution history (audit trail)
- Template library for common workflows

---

## File Structure

**Backend:**
- `backend/migrations.js` — Extend automations table
- `backend/models/rule-engine.js` — DAG evaluation logic (new)
- `backend/routes/automations.js` — Extend with builder endpoints
- `backend/jobs/execute-automation.js` — Async execution (new)
- `backend/tests/backend/automation-builder.test.js` — Tests (new)

**Frontend:**
- `frontend/src/screens/AutomationBuilderScreen.tsx` — Main editor (new)
- `frontend/src/screens/AutomationListScreen.tsx` — Rule list/management (new)
- `frontend/src/components/FlowCanvas.tsx` — React Flow wrapper (new)
- `frontend/src/components/NodePalette.tsx` — Trigger/Condition/Action nodes (new)
- `frontend/src/components/RuleTestPanel.tsx` — Dry-run testing (new)
- `frontend/src/components/TemplateLibrary.tsx` — Pre-built rules (new)
- `frontend/tests/e2e/automation-builder.spec.ts` — E2E tests (new)

---

## Task Breakdown

### Task 1: Database Schema

- [ ] Add migrations to `backend/migrations.js`:

```javascript
{
  id: '012_automation_builder_support',
  description: 'Extend automations for visual builder',
  steps: [
    {
      addColumn: {
        table: 'automations',
        column: 'rule_config',
        sqlite: 'ALTER TABLE automations ADD COLUMN rule_config TEXT',
        mysql: 'ALTER TABLE automations ADD COLUMN rule_config JSON',
      },
    },
    {
      addColumn: {
        table: 'automations',
        column: 'visual_layout',
        sqlite: 'ALTER TABLE automations ADD COLUMN visual_layout TEXT',
        mysql: 'ALTER TABLE automations ADD COLUMN visual_layout JSON',
      },
    },
    {
      addColumn: {
        table: 'automations',
        column: 'enabled',
        sqlite: 'ALTER TABLE automations ADD COLUMN enabled BOOLEAN DEFAULT true',
        mysql: 'ALTER TABLE automations ADD COLUMN enabled BOOLEAN DEFAULT true',
      },
    },
    {
      addColumn: {
        table: 'automations',
        column: 'last_executed_at',
        sqlite: 'ALTER TABLE automations ADD COLUMN last_executed_at DATETIME',
        mysql: 'ALTER TABLE automations ADD COLUMN last_executed_at DATETIME',
      },
    },
  ],
}
```

Then add tables for executions and templates.

- [ ] Commit: `git commit -m "feat: add automation builder schema"`

---

### Task 2: Rule Engine

**Files:**
- Create: `backend/models/rule-engine.js`

- [ ] Create rule engine with DAG validation and execution:

```javascript
const VALID_TRIGGERS = ['feature_status_changed', 'feature_created', 'feature_merged'];
const VALID_CONDITIONS = ['field_equals', 'field_gt', 'field_lt', 'field_contains'];
const VALID_ACTIONS = ['send_message', 'update_feature', 'create_task'];

class RuleEngine {
  static validateDAG(ruleConfig) {
    // Check: no cycles, all node types valid, required fields present
    const visited = new Set();
    const recursionStack = new Set();
    
    const hasCycle = (nodeId) => {
      visited.add(nodeId);
      recursionStack.add(nodeId);
      
      const node = ruleConfig.nodes.find(n => n.id === nodeId);
      if (!node) return false;
      
      const children = ruleConfig.edges.filter(e => e.from === nodeId).map(e => e.to);
      for (const child of children) {
        if (!visited.has(child) && hasCycle(child)) return true;
        if (recursionStack.has(child)) return true;
      }
      
      recursionStack.delete(nodeId);
      return false;
    };
    
    for (const node of ruleConfig.nodes) {
      if (hasCycle(node.id)) throw new Error('Rule has circular dependency');
    }
    
    // Validate node types and fields
    for (const node of ruleConfig.nodes) {
      if (node.type === 'trigger' && !VALID_TRIGGERS.includes(node.config.trigger)) {
        throw new Error(`Invalid trigger: ${node.config.trigger}`);
      }
      if (node.type === 'action' && !VALID_ACTIONS.includes(node.config.action)) {
        throw new Error(`Invalid action: ${node.config.action}`);
      }
    }
  }
  
  static async execute(ruleConfig, context, timeout = 30000) {
    return Promise.race([
      this._executeWithTimeout(ruleConfig, context),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout)),
    ]);
  }
  
  static async _executeWithTimeout(ruleConfig, context) {
    // Evaluate rule DAG: trigger → conditions → actions
    // Return { success, changes, errors }
  }
}

module.exports = RuleEngine;
```

- [ ] Commit: `git commit -m "feat: implement rule engine with DAG validation"`

---

### Task 3: Automation Endpoints

**Files:**
- Modify: `backend/routes/automations.js`

- [ ] Extend existing route with:
  - `POST /api/automations` - Save rule with validation
  - `POST /api/automations/:id/test` - Dry-run
  - `POST /api/automations/:id/execute` - Manual trigger
  - `GET /api/automations/:id/executions` - History
  - `GET /api/automations/templates` - Library

- [ ] Commit: `git commit -m "feat: add automation builder API endpoints"`

---

### Task 4: Frontend Builder UI

**Files:**
- Create 5-6 new React components for visual editor

- [ ] Use React Flow to build canvas with draggable nodes
- [ ] Implement trigger/condition/action node types
- [ ] Add test panel for dry-run
- [ ] Add template library UI

- [ ] Commit: `git commit -m "feat: add visual automation builder UI"`

---

### Task 5: E2E Tests

- [ ] Test: Create rule, drag nodes, configure conditions, test, enable
- [ ] Test: Manual execution, view history
- [ ] Test: Load template, customize, save

- [ ] Commit: `git commit -m "test: add E2E tests for automation builder"`

---

## Summary

✅ No-code interface for rule creation  
✅ DAG validation prevents loops  
✅ Execution history immutable  
✅ Test mode for verification  
✅ Template library for common patterns  

Ready for execution.
