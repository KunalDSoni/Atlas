import React from 'react';
import { ScrollView, View, Text, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { fetchProjectStatuses } from '../api/statuses';
import { fetchProjectIssues, Issue } from '../api/issues';
import { IssueCard } from '../components/IssueCard';

type Props = {
  route: { params: { projectId: string; projectName: string } };
  navigation: { navigate: (screen: string, params: any) => void };
};

export function BoardScreen({ route, navigation }: Props) {
  const { projectId } = route.params;

  const statusesQuery = useQuery({ queryKey: ['statuses', projectId], queryFn: () => fetchProjectStatuses(projectId) });
  const issuesQuery = useQuery({ queryKey: ['issues', projectId], queryFn: () => fetchProjectIssues(projectId) });

  if (statusesQuery.isLoading || issuesQuery.isLoading) return <ActivityIndicator style={styles.center} />;

  const statuses = [...(statusesQuery.data ?? [])].sort((a, b) => a.position - b.position);
  const issues = issuesQuery.data ?? [];

  return (
    <View style={styles.container}>
      <Pressable style={styles.createButton} onPress={() => navigation.navigate('CreateIssue', { projectId })}>
        <Text style={styles.createButtonText}>+ New Issue</Text>
      </Pressable>
      <ScrollView horizontal>
        {statuses.map((status) => (
          <View key={status.id} style={styles.column}>
            <Text style={styles.columnTitle}>{status.label}</Text>
            {issues
              .filter((issue: Issue) => issue.status === status.key)
              .map((issue: Issue) => (
                <IssueCard key={issue.id} issue={issue} onPress={() => navigation.navigate('IssueDetail', { issueId: issue.id })} />
              ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center' },
  container: { flex: 1 },
  createButton: { padding: 12, backgroundColor: '#2563eb', alignItems: 'center' },
  createButtonText: { color: '#fff', fontWeight: '600' },
  column: { width: 260, padding: 8, borderRightWidth: 1, borderRightColor: '#eee' },
  columnTitle: { fontWeight: '700', marginBottom: 8 },
});
