const { getDb, queryOne, queryAll, run } = require('../database');
const { v4: uuidv4 } = require('uuid');

class FeatureMergeHistory {
  static async create(parentId, childId, userId, childRequestCount, notes) {
    const id = uuidv4();
    const db = await getDb();
    const sql = `
      INSERT INTO feature_merge_history
      (id, parent_feature_id, child_feature_id, merged_at, merged_by_id, child_request_count, notes)
      VALUES (?, ?, ?, datetime('now'), ?, ?, ?)
    `;

    // `notes` is optional, and the driver rejects a bound `undefined` outright
    // ("tried to bind a value of an unknown type"). That turned every merge
    // submitted without a reason into a 400 whose body carried no message,
    // and left no history row — so the merge's own undo then answered 404.
    // Only the old UI's habit of sending reason: '' kept it out of sight.
    await run(db, sql, [id, parentId, childId, userId, childRequestCount ?? 0, notes ?? null]);
    return this.findById(id);
  }

  static async findById(id) {
    const db = await getDb();
    const sql = 'SELECT * FROM feature_merge_history WHERE id = ?';
    return await queryOne(db, sql, [id]);
  }

  static async findByParentId(parentId) {
    const db = await getDb();
    const sql = 'SELECT * FROM feature_merge_history WHERE parent_feature_id = ? ORDER BY merged_at DESC';
    return await queryAll(db, sql, [parentId]);
  }

  static async findByChildId(childId) {
    const db = await getDb();
    const sql = 'SELECT * FROM feature_merge_history WHERE child_feature_id = ?';
    return await queryOne(db, sql, [childId]);
  }
}

module.exports = FeatureMergeHistory;
