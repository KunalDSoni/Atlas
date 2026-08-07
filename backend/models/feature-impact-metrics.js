const { getDb, queryOne, queryAll, run } = require('../database');
const { v4: uuidv4 } = require('uuid');

// A measurement older than this is frozen: it stays queryable as part of the
// audit trail but may never be edited. The window is deliberately generous —
// teams routinely backfill a launch month once analytics settle.
const EDIT_WINDOW_DAYS = 30;

// Which pb_features forecast/actual column a metric type rolls up into. Metric
// types outside this map (satisfaction, bug_rate, engagement) are recorded in
// feature_impact_metrics only — there is no feature-level column for them, and
// inventing one per metric type is what the metrics table exists to avoid.
const ROLLUP_COLUMNS = {
  adoption: { forecast: 'forecast_adoption', actual: 'actual_adoption' },
  revenue: { forecast: 'forecast_revenue', actual: 'actual_revenue' },
};

/** Midnight-anchored day delta, so a same-day measurement is always 0 days old. */
function daysOld(dateStr) {
  const measured = new Date(`${String(dateStr).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(measured.getTime())) return null;
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((today - measured) / (1000 * 60 * 60 * 24));
}

class FeatureImpactMetrics {
  static get EDIT_WINDOW_DAYS() { return EDIT_WINDOW_DAYS; }

  static rollupFor(metricType) {
    return ROLLUP_COLUMNS[metricType] || null;
  }

  static async create({
    featureId, metricType, actualValue, unit, dataSource, notes, userId, measurementDate,
  }) {
    const id = uuidv4();
    const date = (measurementDate || new Date().toISOString().split('T')[0]).slice(0, 10);
    const db = await getDb();

    // Snapshot the forecast that was in force when the measurement was taken.
    // Storing it denormalised is the point: a forecast revised later must not
    // retroactively rewrite the variance of a measurement already recorded.
    const rollup = this.rollupFor(metricType);
    let forecastValue = null;
    if (rollup) {
      const feature = await queryOne(db, `SELECT ${rollup.forecast} AS f FROM pb_features WHERE id = ?`, [featureId]);
      forecastValue = feature && feature.f !== undefined ? feature.f : null;
    }

    await run(db, `
      INSERT INTO feature_impact_metrics
      (id, feature_id, metric_type, forecast_value, actual_value, unit, measurement_date, data_source, notes, created_by_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      featureId,
      metricType,
      forecastValue,
      actualValue,
      unit || null,
      date,
      dataSource || 'manual',
      notes || null,
      userId || null,
    ]);

    // Roll the measurement up onto the feature row. Without this the impact
    // dashboard — which filters on actual_adoption/actual_revenue — can never
    // see a single feature.
    //
    // The row just written wins unless an existing measurement is dated
    // strictly later: re-recording today supersedes today, but backfilling last
    // month must not clobber a current reading. Comparing dates rather than
    // ordering by (measurement_date, created_at) matters because created_at has
    // one-second resolution, so two same-day writes tie and the winner would
    // otherwise be whichever the engine happened to return first.
    if (rollup && actualValue !== null && actualValue !== undefined) {
      const newer = await queryOne(db, `
        SELECT 1 AS found FROM feature_impact_metrics
        WHERE feature_id = ? AND metric_type = ? AND id <> ?
          AND actual_value IS NOT NULL AND measurement_date > ?
        LIMIT 1
      `, [featureId, metricType, id, date]);

      if (!newer) {
        await run(db, `UPDATE pb_features SET ${rollup.actual} = ?, updated_at = datetime('now') WHERE id = ?`,
          [actualValue, featureId]);
      }
    }

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

  /** A measurement is editable only inside the audit window. */
  static isEditable(metric) {
    if (!metric || !metric.measurement_date) return false;
    const age = daysOld(metric.measurement_date);
    return age !== null && age <= EDIT_WINDOW_DAYS;
  }

  static async canEdit(id) {
    return this.isEditable(await this.findById(id));
  }

  static calculateVariance(forecast, actual) {
    if (forecast === null || forecast === undefined || Number(forecast) === 0) return null;
    if (actual === null || actual === undefined) return null;
    return ((Number(actual) - Number(forecast)) / Number(forecast)) * 100;
  }
}

module.exports = FeatureImpactMetrics;
