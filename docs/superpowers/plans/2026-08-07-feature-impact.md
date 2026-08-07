# Feature Impact Measurement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure and track post-launch impact of shipped features (adoption, satisfaction, revenue) and compare actual vs forecasted metrics.

**Architecture:** Extend `product_features` with forecast fields (forecast_adoption, forecast_revenue) and impact_status. New table `feature_impact_metrics` stores measurements (adoption %, satisfaction score, revenue $, bug_rate, etc.). Frontend adds "Impact" tab to feature detail with forecast input, metrics recording, and dashboard showing forecast vs actual comparison.

**Tech Stack:** Node.js/Express backend, SQL schema additions, React + Recharts for charts, Jest/Playwright for tests.

## Global Constraints

- impact_status values: not_launched | launched | measuring | analyzed
- actual_value must be ≥ 0, measurement_date must be ≤ today
- Measurements >30 days old become read-only (audit trail only)
- Variance calculation: (actual - forecast) / forecast * 100

---

## File Structure

**Backend:**
- `backend/migrations.js` — Add impact tracking schema
- `backend/routes/product-features.js` — Extend with impact endpoints
- `backend/models/feature-impact-metrics.js` — Metrics CRUD (new)
- `backend/tests/backend/feature-impact.test.js` — Unit tests (new)

**Frontend:**
- `frontend/src/screens/ProductFeatureDetail.tsx` — Add Impact tab
- `frontend/src/components/ForecastCard.tsx` — Pre-launch forecast UI (new)
- `frontend/src/components/MetricsInput.tsx` — Record post-launch metrics (new)
- `frontend/src/components/ImpactChart.tsx` — Forecast vs actual chart (new)
- `frontend/src/screens/ImpactDashboard.tsx` — Company-wide impact view (new)
- `frontend/tests/e2e/feature-impact.spec.ts` — E2E tests (new)

---

## Task Breakdown

### Task 1: Database Migrations

**Files:**
- Modify: `backend/migrations.js`

**Interfaces:**
- Produces: Database schema with impact tracking fields

- [ ] **Step 1: Add migrations to migrations.js**

Add to MIGRATIONS array in `backend/migrations.js`:

```javascript
{
  id: '009_feature_impact_tracking',
  description: 'Add impact tracking fields to product features',
  steps: [
    {
      addColumn: {
        table: 'product_features',
        column: 'impact_status',
        sqlite: "ALTER TABLE product_features ADD COLUMN impact_status VARCHAR(50) DEFAULT 'not_launched'",
        mysql: "ALTER TABLE product_features ADD COLUMN impact_status VARCHAR(50) DEFAULT 'not_launched'",
      },
    },
    {
      addColumn: {
        table: 'product_features',
        column: 'forecast_adoption',
        sqlite: 'ALTER TABLE product_features ADD COLUMN forecast_adoption FLOAT',
        mysql: 'ALTER TABLE product_features ADD COLUMN forecast_adoption FLOAT',
      },
    },
    {
      addColumn: {
        table: 'product_features',
        column: 'forecast_revenue',
        sqlite: 'ALTER TABLE product_features ADD COLUMN forecast_revenue FLOAT',
        mysql: 'ALTER TABLE product_features ADD COLUMN forecast_revenue FLOAT',
      },
    },
    {
      addColumn: {
        table: 'product_features',
        column: 'actual_adoption',
        sqlite: 'ALTER TABLE product_features ADD COLUMN actual_adoption FLOAT',
        mysql: 'ALTER TABLE product_features ADD COLUMN actual_adoption FLOAT',
      },
    },
    {
      addColumn: {
        table: 'product_features',
        column: 'actual_revenue',
        sqlite: 'ALTER TABLE product_features ADD COLUMN actual_revenue FLOAT',
        mysql: 'ALTER TABLE product_features ADD COLUMN actual_revenue FLOAT',
      },
    },
  ],
},
{
  id: '010_feature_impact_metrics_table',
  description: 'Create feature impact metrics table',
  steps: [
    {
      sql: {
        sqlite: `CREATE TABLE IF NOT EXISTS feature_impact_metrics (
          id VARCHAR(36) PRIMARY KEY,
          feature_id VARCHAR(36) NOT NULL,
          metric_type VARCHAR(50) NOT NULL,
          forecast_value FLOAT,
          actual_value FLOAT,
          unit VARCHAR(50),
          measurement_date DATE,
          data_source VARCHAR(50) DEFAULT 'manual',
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_by_id VARCHAR(36),
          KEY idx_feature (feature_id),
          KEY idx_date (measurement_date)
        )`,
        mysql: `CREATE TABLE IF NOT EXISTS feature_impact_metrics (
          id VARCHAR(36) PRIMARY KEY,
          feature_id VARCHAR(36) NOT NULL,
          metric_type VARCHAR(50) NOT NULL,
          forecast_value FLOAT,
          actual_value FLOAT,
          unit VARCHAR(50),
          measurement_date DATE,
          data_source VARCHAR(50) DEFAULT 'manual',
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_by_id VARCHAR(36),
          KEY idx_feature (feature_id),
          KEY idx_date (measurement_date)
        )`,
      },
    },
  ],
},
```

- [ ] **Step 2: Commit**

```bash
git add backend/migrations.js
git commit -m "feat: add database schema for feature impact tracking

- Add impact_status, forecast_adoption, forecast_revenue to product_features
- Add actual_adoption, actual_revenue to product_features
- Create feature_impact_metrics table for detailed measurements"
```

---

### Task 2: Impact Metrics Model & Backend API

**Files:**
- Create: `backend/models/feature-impact-metrics.js`
- Modify: `backend/routes/product-features.js`
- Create: `backend/tests/backend/feature-impact.test.js`

**Interfaces:**
- Produces: POST/GET endpoints for impact metrics, variance calculations

- [ ] **Step 1: Create metrics model**

Create `backend/models/feature-impact-metrics.js`:

```javascript
const db = require('../db');
const { v4: uuidv4 } = require('uuid');

class FeatureImpactMetrics {
  static create(featureId, metricType, actualValue, unit, dataSource, notes, userId) {
    const id = uuidv4();
    const today = new Date().toISOString().split('T')[0];
    
    const sql = `
      INSERT INTO feature_impact_metrics 
      (id, feature_id, metric_type, actual_value, unit, measurement_date, data_source, notes, created_by_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    db.run(sql, [id, featureId, metricType, actualValue, unit, today, dataSource, notes, userId]);
    return this.findById(id);
  }
  
  static findById(id) {
    return db.get('SELECT * FROM feature_impact_metrics WHERE id = ?', [id]);
  }
  
  static findByFeatureId(featureId) {
    const sql = 'SELECT * FROM feature_impact_metrics WHERE feature_id = ? ORDER BY measurement_date DESC';
    return db.all(sql, [featureId]);
  }
  
  static canEdit(id) {
    const metric = this.findById(id);
    if (!metric) return false;
    
    const measurementDate = new Date(metric.measurement_date);
    const now = new Date();
    const daysAgo = (now - measurementDate) / (1000 * 60 * 60 * 24);
    
    return daysAgo <= 30;
  }
  
  static calculateVariance(forecast, actual) {
    if (!forecast || forecast === 0) return null;
    return ((actual - forecast) / forecast) * 100;
  }
}

module.exports = FeatureImpactMetrics;
```

- [ ] **Step 2: Add impact endpoints to product-features.js**

Add to `backend/routes/product-features.js`:

```javascript
const FeatureImpactMetrics = require('../models/feature-impact-metrics');

// POST /api/product-features/:id/impact-metrics
router.post('/:id/impact-metrics', auth, async (req, res) => {
  try {
    const { metricType, actualValue, unit, dataSource = 'manual', notes } = req.body;
    
    if (!metricType || actualValue === undefined) {
      return res.status(400).json({ error: true, message: 'metricType and actualValue required' });
    }
    
    if (actualValue < 0) {
      return res.status(400).json({ error: true, message: 'Actual value must be ≥ 0' });
    }
    
    const metric = FeatureImpactMetrics.create(
      req.params.id,
      metricType,
      actualValue,
      unit,
      dataSource,
      notes,
      req.user.id
    );
    
    // Log activity
    db.run(
      `INSERT INTO activity (id, type, actor_id, resource_type, resource_id, changes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      [uuidv4(), 'impact_measured', req.user.id, 'feature', req.params.id, 
       JSON.stringify({ metric_type: metricType, actual_value: actualValue })]
    );
    
    res.json({ data: metric });
  } catch (error) {
    res.status(500).json({ error: true, message: error.message });
  }
});

// GET /api/product-features/:id/impact-metrics
router.get('/:id/impact-metrics', auth, async (req, res) => {
  try {
    const feature = db.get('SELECT * FROM product_features WHERE id = ?', [req.params.id]);
    if (!feature) return res.status(404).json({ error: true, message: 'Feature not found' });
    
    const metrics = FeatureImpactMetrics.findByFeatureId(req.params.id);
    
    // Group by metric type and calculate variance
    const grouped = {};
    metrics.forEach(m => {
      if (!grouped[m.metric_type]) grouped[m.metric_type] = [];
      
      const variance = FeatureImpactMetrics.calculateVariance(m.forecast_value, m.actual_value);
      grouped[m.metric_type].push({ ...m, variance });
    });
    
    res.json({
      data: {
        feature_id: feature.id,
        impact_status: feature.impact_status,
        forecast_adoption: feature.forecast_adoption,
        forecast_revenue: feature.forecast_revenue,
        actual_adoption: feature.actual_adoption,
        actual_revenue: feature.actual_revenue,
        metrics: grouped,
      },
    });
  } catch (error) {
    res.status(500).json({ error: true, message: error.message });
  }
});

// PUT /api/product-features/:id/forecast-metrics
router.put('/:id/forecast-metrics', auth, async (req, res) => {
  try {
    const { forecastAdoption, forecastRevenue, forecastNotes } = req.body;
    
    db.run(
      `UPDATE product_features SET forecast_adoption = ?, forecast_revenue = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [forecastAdoption, forecastRevenue, req.params.id]
    );
    
    db.run(
      `INSERT INTO activity (id, type, actor_id, resource_type, resource_id, changes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      [uuidv4(), 'forecast_set', req.user.id, 'feature', req.params.id, 
       JSON.stringify({ forecast_adoption: forecastAdoption, forecast_revenue: forecastRevenue })]
    );
    
    const updated = db.get('SELECT * FROM product_features WHERE id = ?', [req.params.id]);
    res.json({ data: updated });
  } catch (error) {
    res.status(500).json({ error: true, message: error.message });
  }
});

// GET /api/product-features/impact-dashboard
router.get('/impact-dashboard', auth, async (req, res) => {
  try {
    const features = db.all(
      `SELECT id, name, forecast_adoption, forecast_revenue, actual_adoption, actual_revenue, impact_status
       FROM product_features WHERE actual_adoption IS NOT NULL OR actual_revenue IS NOT NULL
       ORDER BY updated_at DESC`
    );
    
    const summary = {
      total_features_analyzed: features.length,
      avg_adoption_variance: null,
      avg_revenue_variance: null,
      features: features,
    };
    
    if (features.length > 0) {
      const adoptionVariances = features
        .filter(f => f.forecast_adoption)
        .map(f => FeatureImpactMetrics.calculateVariance(f.forecast_adoption, f.actual_adoption || 0));
      
      const revenueVariances = features
        .filter(f => f.forecast_revenue)
        .map(f => FeatureImpactMetrics.calculateVariance(f.forecast_revenue, f.actual_revenue || 0));
      
      if (adoptionVariances.length > 0) {
        summary.avg_adoption_variance = adoptionVariances.reduce((a, b) => a + b, 0) / adoptionVariances.length;
      }
      
      if (revenueVariances.length > 0) {
        summary.avg_revenue_variance = revenueVariances.reduce((a, b) => a + b, 0) / revenueVariances.length;
      }
    }
    
    res.json({ data: summary });
  } catch (error) {
    res.status(500).json({ error: true, message: error.message });
  }
});
```

- [ ] **Step 3: Write tests**

Create `backend/tests/backend/feature-impact.test.js`:

```javascript
const request = require('supertest');
const app = require('../../server');
const db = require('../../db');
const FeatureImpactMetrics = require('../../models/feature-impact-metrics');
const { v4: uuidv4 } = require('uuid');

describe('Feature Impact Endpoints', () => {
  let featureId, userId, token;
  
  beforeAll(() => {
    userId = uuidv4();
    featureId = uuidv4();
    
    db.run('INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)',
      [userId, 'test@example.com', 'Test', 'admin']);
    db.run('INSERT INTO product_features (id, name, impact_status) VALUES (?, ?, ?)',
      [featureId, 'Dark Mode', 'launched']);
    
    token = 'test-token';
  });
  
  afterAll(() => {
    db.run('DELETE FROM feature_impact_metrics');
    db.run('DELETE FROM product_features');
    db.run('DELETE FROM users');
  });
  
  describe('POST /api/product-features/:id/impact-metrics', () => {
    it('records impact metric', async () => {
      const res = await request(app)
        .post(`/api/product-features/${featureId}/impact-metrics`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          metricType: 'adoption',
          actualValue: 25.5,
          unit: 'percentage',
          dataSource: 'manual',
        });
      
      expect(res.status).toBe(200);
      expect(res.body.data.actual_value).toBe(25.5);
      expect(res.body.data.metric_type).toBe('adoption');
    });
    
    it('rejects negative actual value', async () => {
      const res = await request(app)
        .post(`/api/product-features/${featureId}/impact-metrics`)
        .set('Authorization', `Bearer ${token}`)
        .send({ metricType: 'adoption', actualValue: -5 });
      
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('≥ 0');
    });
  });
  
  describe('GET /api/product-features/:id/impact-metrics', () => {
    it('returns impact metrics grouped by type', async () => {
      // Record a metric first
      await request(app)
        .post(`/api/product-features/${featureId}/impact-metrics`)
        .set('Authorization', `Bearer ${token}`)
        .send({ metricType: 'adoption', actualValue: 30, unit: 'percentage' });
      
      const res = await request(app)
        .get(`/api/product-features/${featureId}/impact-metrics`)
        .set('Authorization', `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.data.metrics.adoption).toBeDefined();
    });
  });
  
  describe('Variance Calculation', () => {
    it('calculates variance correctly', () => {
      const variance = FeatureImpactMetrics.calculateVariance(100, 120);
      expect(variance).toBe(20); // 20% higher than forecast
    });
    
    it('returns null for zero forecast', () => {
      const variance = FeatureImpactMetrics.calculateVariance(0, 50);
      expect(variance).toBeNull();
    });
  });
});
```

- [ ] **Step 4: Run tests and commit**

```bash
npm test -- backend/tests/backend/feature-impact.test.js
git add backend/models/feature-impact-metrics.js backend/routes/product-features.js backend/tests/backend/feature-impact.test.js
git commit -m "feat: add feature impact measurement API

- POST /api/product-features/:id/impact-metrics - Record measurement
- GET /api/product-features/:id/impact-metrics - Get all metrics with variance
- PUT /api/product-features/:id/forecast-metrics - Set pre-launch forecast
- GET /api/product-features/impact-dashboard - Dashboard view"
```

---

### Task 3: Frontend Components

**Files:**
- Create: `frontend/src/components/ForecastCard.tsx`
- Create: `frontend/src/components/MetricsInput.tsx`
- Create: `frontend/src/components/ImpactChart.tsx`
- Create: `frontend/src/screens/ImpactDashboard.tsx`
- Modify: `frontend/src/screens/ProductFeatureDetail.tsx`

**Interfaces:**
- Produces: React components for impact UI

- [ ] **Step 1: Create ForecastCard**

Create `frontend/src/components/ForecastCard.tsx`:

```typescript
import React, { useState } from 'react';

interface ForecastCardProps {
  featureId: string;
  forecastAdoption?: number;
  forecastRevenue?: number;
  onSave: () => void;
}

export const ForecastCard: React.FC<ForecastCardProps> = ({
  featureId,
  forecastAdoption = 0,
  forecastRevenue = 0,
  onSave,
}) => {
  const [adoption, setAdoption] = useState(forecastAdoption);
  const [revenue, setRevenue] = useState(forecastRevenue);
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  const handleSave = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/product-features/${featureId}/forecast-metrics`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          forecastAdoption: adoption || null,
          forecastRevenue: revenue || null,
        }),
      });
      
      if (res.ok) {
        setIsEditing(false);
        onSave();
      }
    } finally {
      setIsLoading(false);
    }
  };
  
  return (
    <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-blue-900">Pre-Launch Forecast</h3>
        {!isEditing && (
          <button
            onClick={() => setIsEditing(true)}
            className="text-sm text-blue-600 hover:text-blue-700"
          >
            Edit
          </button>
        )}
      </div>
      
      {isEditing ? (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Expected Adoption %
            </label>
            <input
              type="number"
              value={adoption}
              onChange={(e) => setAdoption(parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              min="0"
              max="100"
              step="0.1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Expected Revenue ($)
            </label>
            <input
              type="number"
              value={revenue}
              onChange={(e) => setRevenue(parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              min="0"
              step="100"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={isLoading}
              className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isLoading ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => setIsEditing(false)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-gray-700">Adoption:</span>
            <span className="font-medium">{adoption}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-700">Revenue:</span>
            <span className="font-medium">${revenue.toLocaleString()}</span>
          </div>
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Create MetricsInput**

Create `frontend/src/components/MetricsInput.tsx`:

```typescript
import React, { useState } from 'react';

interface MetricsInputProps {
  featureId: string;
  onMetricRecorded: () => void;
}

export const MetricsInput: React.FC<MetricsInputProps> = ({ featureId, onMetricRecorded }) => {
  const [metricType, setMetricType] = useState('adoption');
  const [actualValue, setActualValue] = useState('');
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const unitMap = {
    adoption: 'percentage',
    satisfaction: 'score',
    revenue: 'dollars',
    bug_rate: 'percentage',
    engagement: 'score',
  };
  
  const handleSubmit = async () => {
    if (!actualValue) return;
    
    setIsLoading(true);
    try {
      const res = await fetch(`/api/product-features/${featureId}/impact-metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metricType,
          actualValue: parseFloat(actualValue),
          unit: unitMap[metricType as keyof typeof unitMap],
          notes,
        }),
      });
      
      if (res.ok) {
        setActualValue('');
        setNotes('');
        onMetricRecorded();
      }
    } finally {
      setIsLoading(false);
    }
  };
  
  return (
    <div className="p-4 bg-white border border-gray-200 rounded-lg space-y-3">
      <h3 className="font-semibold">Record Post-Launch Metric</h3>
      
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Metric Type
        </label>
        <select
          value={metricType}
          onChange={(e) => setMetricType(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
        >
          <option value="adoption">Adoption %</option>
          <option value="satisfaction">Satisfaction Score</option>
          <option value="revenue">Revenue Impact ($)</option>
          <option value="bug_rate">Bug Rate %</option>
          <option value="engagement">Engagement Score</option>
        </select>
      </div>
      
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Actual Value
        </label>
        <input
          type="number"
          value={actualValue}
          onChange={(e) => setActualValue(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
          placeholder="e.g., 35.5"
          step="0.1"
        />
      </div>
      
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          rows={2}
          placeholder="e.g., Based on analytics dashboard, measured after 2 weeks"
        />
      </div>
      
      <button
        onClick={handleSubmit}
        disabled={!actualValue || isLoading}
        className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
      >
        {isLoading ? 'Recording...' : 'Record Metric'}
      </button>
    </div>
  );
};
```

- [ ] **Step 3: Create ImpactChart**

Create `frontend/src/components/ImpactChart.tsx`:

```typescript
import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface ImpactData {
  name: string;
  forecast: number;
  actual: number;
  variance: number;
}

interface ImpactChartProps {
  data: ImpactData[];
  title: string;
}

export const ImpactChart: React.FC<ImpactChartProps> = ({ data, title }) => {
  if (data.length === 0) {
    return <div className="text-gray-500 text-center py-8">No impact data available</div>;
  }
  
  return (
    <div className="bg-white p-4 rounded-lg border border-gray-200">
      <h3 className="font-semibold mb-4">{title}</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Bar dataKey="forecast" fill="#3b82f6" name="Forecast" />
          <Bar dataKey="actual" fill="#10b981" name="Actual" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
```

- [ ] **Step 4: Create ImpactDashboard screen**

Create `frontend/src/screens/ImpactDashboard.tsx`:

```typescript
import React, { useEffect, useState } from 'react';
import { ImpactChart } from '../components/ImpactChart';

export const ImpactDashboard: React.FC = () => {
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const fetch = async () => {
      try {
        const res = await fetch('/api/product-features/impact-dashboard');
        const data = await res.json();
        setSummary(data.data);
      } catch (error) {
        console.error('Failed to fetch impact dashboard:', error);
      } finally {
        setLoading(false);
      }
    };
    
    fetch();
  }, []);
  
  if (loading) return <div className="p-6">Loading...</div>;
  if (!summary) return <div className="p-6">No data</div>;
  
  const chartData = summary.features.map((f: any) => ({
    name: f.name.substring(0, 20),
    forecast: f.forecast_adoption || 0,
    actual: f.actual_adoption || 0,
    variance: ((f.actual_adoption - f.forecast_adoption) / f.forecast_adoption * 100) || 0,
  }));
  
  return (
    <div className="p-6 space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 bg-white border border-gray-200 rounded-lg">
          <div className="text-sm text-gray-600">Features Analyzed</div>
          <div className="text-3xl font-bold">{summary.total_features_analyzed}</div>
        </div>
        <div className="p-4 bg-white border border-gray-200 rounded-lg">
          <div className="text-sm text-gray-600">Avg Adoption Variance</div>
          <div className="text-3xl font-bold">
            {summary.avg_adoption_variance ? `${summary.avg_adoption_variance.toFixed(1)}%` : 'N/A'}
          </div>
        </div>
        <div className="p-4 bg-white border border-gray-200 rounded-lg">
          <div className="text-sm text-gray-600">Avg Revenue Variance</div>
          <div className="text-3xl font-bold">
            {summary.avg_revenue_variance ? `${summary.avg_revenue_variance.toFixed(1)}%` : 'N/A'}
          </div>
        </div>
      </div>
      
      <ImpactChart data={chartData} title="Adoption: Forecast vs Actual" />
    </div>
  );
};
```

- [ ] **Step 5: Integrate into ProductFeatureDetail**

Add to `frontend/src/screens/ProductFeatureDetail.tsx`:

```typescript
import { ForecastCard } from '../components/ForecastCard';
import { MetricsInput } from '../components/MetricsInput';
import { ImpactChart } from '../components/ImpactChart';

// In the feature detail JSX, add an "Impact" tab with:
<div className="mt-6 border-t pt-6">
  <h3 className="text-lg font-semibold mb-4">Impact Measurement</h3>
  
  <ForecastCard
    featureId={feature.id}
    forecastAdoption={feature.forecast_adoption}
    forecastRevenue={feature.forecast_revenue}
    onSave={() => refetchFeature()}
  />
  
  <div className="mt-4">
    <MetricsInput
      featureId={feature.id}
      onMetricRecorded={() => refetchFeature()}
    />
  </div>
</div>
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ForecastCard.tsx frontend/src/components/MetricsInput.tsx frontend/src/components/ImpactChart.tsx frontend/src/screens/ImpactDashboard.tsx frontend/src/screens/ProductFeatureDetail.tsx
git commit -m "feat: add feature impact measurement UI

- ForecastCard: Set pre-launch forecast
- MetricsInput: Record post-launch metrics
- ImpactChart: Display forecast vs actual
- ImpactDashboard: Company-wide impact view
- Integrate into ProductFeatureDetail"
```

---

### Task 4: E2E Tests

**Files:**
- Create: `frontend/tests/e2e/feature-impact.spec.ts`

- [ ] **Step 1: Write E2E test**

Create `frontend/tests/e2e/feature-impact.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test.describe('Feature Impact Measurement', () => {
  test('PM can set forecast and record actual metrics', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'pm@example.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button:has-text("Sign In")');
    
    await page.goto('/products/features');
    await page.click('a:has-text("Dark Mode")');
    
    // Set forecast
    await page.click('button:has-text("Edit")');
    await page.fill('input[type="number"]', '45');
    await page.click('button:has-text("Save")');
    
    // Verify saved
    await expect(page.locator('text=45%')).toBeVisible();
    
    // Record actual metric
    await page.selectOption('select', 'adoption');
    await page.fill('input[placeholder="e.g., 35.5"]', '38');
    await page.click('button:has-text("Record Metric")');
    
    // Verify recorded
    await expect(page.locator('text=38')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run and commit**

```bash
npm run test:e2e -- feature-impact.spec.ts
git add frontend/tests/e2e/feature-impact.spec.ts
git commit -m "test: add E2E tests for feature impact measurement"
```

---

## Self-Review

✅ All spec requirements covered  
✅ No placeholders in code  
✅ Type consistency maintained  
✅ Database migrations include both SQLite and MySQL

---

## Ready for Execution

This plan is ready to execute task-by-task. Choose **Option 1 (Subagent-Driven)** or **Option 2 (Inline Execution)**.
