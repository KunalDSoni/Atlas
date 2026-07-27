import React from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { Issue } from '../api/issues';

export function IssueCard({ issue, onPress }: { issue: Issue; onPress: () => void }) {
  return (
    <Pressable style={styles.card} onPress={onPress}>
      <Text style={styles.key}>{issue.issue_key}</Text>
      <Text style={styles.title} numberOfLines={2}>{issue.title}</Text>
      {issue.assignee_name ? <Text style={styles.assignee}>{issue.assignee_name}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 8, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#eee' },
  key: { fontSize: 11, color: '#888' },
  title: { fontSize: 14, fontWeight: '500', marginTop: 2 },
  assignee: { fontSize: 11, color: '#666', marginTop: 6 },
});
