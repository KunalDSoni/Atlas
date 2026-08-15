/**
 * SIMILARITY CALCULATION FOR FEATURES
 * Simple similarity scorer based on name and description overlap
 */

/**
 * Calculate Levenshtein distance between two strings
 * @param {string} str1
 * @param {string} str2
 * @returns {number} Distance (lower = more similar)
 */
function levenshteinDistance(str1, str2) {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix = Array(len2 + 1).fill(null).map(() => Array(len1 + 1).fill(0));

  for (let i = 0; i <= len1; i++) matrix[0][i] = i;
  for (let j = 0; j <= len2; j++) matrix[j][0] = j;

  for (let j = 1; j <= len2; j++) {
    for (let i = 1; i <= len1; i++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + cost
      );
    }
  }

  return matrix[len2][len1];
}

/**
 * Convert Levenshtein distance to similarity score (0-1)
 * @param {string} str1
 * @param {string} str2
 * @returns {number} Similarity score 0-1
 */
function stringSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  const s1 = String(str1).toLowerCase();
  const s2 = String(str2).toLowerCase();
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1;
  const distance = levenshteinDistance(s1, s2);
  return 1 - (distance / maxLen);
}

/**
 * Calculate similarity score between two features
 * @param {object} feature1
 * @param {object} feature2
 * @returns {number} Score 0-1
 */
function calculateFeatureSimilarity(feature1, feature2) {
  if (feature1.id === feature2.id) return 0;

  // Compare names (weight: 0.6)
  const nameSimilarity = stringSimilarity(feature1.name || '', feature2.name || '') * 0.6;

  // Compare descriptions (weight: 0.4)
  const descSimilarity = stringSimilarity(feature1.description || '', feature2.description || '') * 0.4;

  return nameSimilarity + descSimilarity;
}

/**
 * Find similar features to a given feature
 * @param {object} feature - The feature to match against
 * @param {array} allFeatures - Array of all features to search through
 * @param {number} threshold - Minimum similarity score (0-1)
 * @returns {array} Array of {feature, similarity} objects, sorted by similarity descending
 */
function findSimilarFeatures(feature, allFeatures, threshold = 0.6) {
  if (!Array.isArray(allFeatures)) return [];

  const candidates = allFeatures
    // Excluded: the feature itself; anything that has already absorbed others
    // (the merge route refuses to re-merge a parent); and anything already
    // merged away, which otherwise kept being offered as a duplicate of the
    // very feature that swallowed it.
    .filter(f => f.id !== feature.id
      && !f.merged_into_id
      && JSON.parse(f.merged_from_ids || '[]').length === 0)
    .map(f => ({
      feature: f,
      similarity: calculateFeatureSimilarity(feature, f),
    }))
    .filter(c => c.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity);

  return candidates;
}

module.exports = {
  findSimilarFeatures,
  calculateFeatureSimilarity,
  stringSimilarity,
};
