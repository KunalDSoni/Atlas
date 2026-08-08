import React from 'react';
import { ScrollView, Text, StyleSheet, ActivityIndicator, Button } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { fetchIssue, updateIssue } from '../api/issues';
import { fetchProjectStatuses } from '../api/statuses';
import { fetchProjectMembers } from '../api/members';
import { StatusPicker } from '../components/StatusPicker';
import { AssigneePicker } from '../components/AssigneePicker';
import { CommentList } from '../components/CommentList';
import { CommentInput } from '../components/CommentInput';
import { MainStackParamList } from '../navigation/MainStack';

type Props = NativeStackScreenProps<MainStackParamList, 'IssueDetail'>;

export function IssueDetailScreen({ route }: Props) {
  const { issueId } = route.params;
  const queryClient = useQueryClient();

  const issueQuery = useQuery({ queryKey: ['issue', issueId], queryFn: () => fetchIssue(issueId) });
  const projectId = issueQuery.data?.project_id;

  const statusesQuery = useQuery({
    queryKey: ['statuses', projectId],
    queryFn: () => fetchProjectStatuses(projectId as string),
    enabled: !!projectId,
  });
  const membersQuery = useQuery({
    queryKey: ['members', projectId],
    queryFn: () => fetchProjectMembers(projectId as string),
    enabled: !!projectId,
  });

  const updateMutation = useMutation({
    mutationFn: (updates: { status?: string; assignee_id?: string | null }) => updateIssue(issueId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue', issueId] });
      queryClient.invalidateQueries({ queryKey: ['issues', projectId] });
    },
  });

  if (issueQuery.isError) {
    return (
      <>
        <Text style={styles.errorText}>Failed to load issue.</Text>
        <Button title="Retry" onPress={() => issueQuery.refetch()} />
      </>
    );
  }

  if (issueQuery.isLoading || !issueQuery.data) return <ActivityIndicator style={styles.center} />;

  const issue = issueQuery.data;

  const handleCommentAdded = () => {
    issueQuery.refetch();
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.key}>{issue.issue_key}</Text>
      <Text style={styles.title}>{issue.title}</Text>
      <Text style={styles.description}>{issue.description}</Text>

      <Text style={styles.sectionLabel}>Status</Text>
      <StatusPicker
        statuses={statusesQuery.data ?? []}
        value={issue.status}
        onChange={(status) => updateMutation.mutate({ status })}
      />

      <Text style={styles.sectionLabel}>Assignee</Text>
      <AssigneePicker
        members={membersQuery.data ?? []}
        value={issue.assignee_id}
        onChange={(assignee_id) => updateMutation.mutate({ assignee_id })}
      />

      {/* Comments Section */}
      <CommentList issueId={issueId} />
      <CommentInput issueId={issueId} onCommentAdded={handleCommentAdded} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center' },
  container: { padding: 16 },
  key: { fontSize: 12, color: '#888' },
  title: { fontSize: 22, fontWeight: '700', marginTop: 4, marginBottom: 12 },
  description: { fontSize: 14, color: '#333', marginBottom: 20 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#666', marginTop: 16, marginBottom: 8 },
  errorText: { padding: 16, textAlign: 'center', color: '#b91c1c' },
});
