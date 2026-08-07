const { getDb, queryOne, queryAll, run } = require('../database');
const { v4: uuidv4 } = require('uuid');

class FeatureImpactMetrics {
  static async create(featureId, metricType, actualValue, unit, dataSource, notes, userId, measurementDate) {
    const id = uuidv4();
    const date = measurementDate || new Date().toISOString().split('T')[0];

    const db = await getDb();
    const sql = `
      INSERT INTO feature_impact_metrics
      (id, feature_id, metric_type, actual_value, unit, measurement_date, data_source, notes, created_by_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await run(db, sql, [
      id,
      featureId,
      metricType,
      actualValue,
      unit || null,
      date,
      dataSource || 'manual',
      notes || null,
      userId || null,
    ]);
    return this.findById(id);
  }

  static async findById(id) {
    const db = await getDb();
    return await queryOne(db, 'SELECT * FROM feature_impact_metrics WHERE id = ?', [id]);
  }

  static async findByFeatureId(featureId) {
    const db = await getDb();
    const sql = 'SELECT * FROM feature_impact_metrics WHERE feature_id = ? ORDER BY measurement_date DESC';
    return await queryAll(db, sql, [featureId]);
  }

  static async canEdit(id) {
    const metric = await this.findById(id);
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
