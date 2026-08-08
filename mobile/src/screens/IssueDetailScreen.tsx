import React from 'react';
import { ScrollView, Text, StyleSheet, ActivityIndicator, Button } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { fetchIssue, updateIssue } from '../api/issues';
import { fetchProjectStatuses } from '../api/statuses';
import { fetchProjectMembers } from '../api/members';
import { fetchTimer, startTimer, pauseTimer } from '../api/timers';
import { StatusPicker } from '../components/StatusPicker';
import { AssigneePicker } from '../components/AssigneePicker';
import { CommentList } from '../components/CommentList';
import { CommentInput } from '../components/CommentInput';
import { WatchersList } from '../components/WatchersList';
import { AttachmentList } from '../components/AttachmentList';
import { MainStackParamList } from '../navigation/MainStack';

type Props = NativeStackScreenProps<MainStackParamList, 'IssueDetail'>;

function formatMinutes(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

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

  const timerQuery = useQuery({ queryKey: ['timer', issueId], queryFn: () => fetchTimer(issueId) });

  const timerMutation = useMutation({
    mutationFn: (action: 'start' | 'pause') =>
      action === 'start' ? startTimer(issueId) : pauseTimer(issueId),
    onSuccess: (state) => {
      queryClient.setQueryData(['timer', issueId], state);
      queryClient.invalidateQueries({ queryKey: ['issue', issueId] });
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

      <Text style={styles.sectionLabel}>Time</Text>
      {issue.in_progress_minutes_live !== null && (
        <Text style={styles.timeValue}>
          In progress: {formatMinutes(issue.in_progress_minutes_live)}
        </Text>
      )}
      {!!timerQuery.data && timerQuery.data.elapsed_minutes > 0 && (
        <Text style={styles.timeValue}>
          Tracked: {formatMinutes(timerQuery.data.elapsed_minutes)}
        </Text>
      )}
      <Button
        title={timerQuery.data?.running ? 'Pause' : 'Start timer'}
        disabled={timerMutation.isPending}
        onPress={() => timerMutation.mutate(timerQuery.data?.running ? 'pause' : 'start')}
      />
      {timerQuery.data?.runaway && (
        <Text style={styles.warning}>Timer running over 12 hours — still working?</Text>
      )}

      {/* Watchers Section */}
      <WatchersList issueId={issueId} />

      {/* Attachments Section */}
      <AttachmentList issueId={issueId} />

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
  timeValue: { fontSize: 14, color: '#333', marginBottom: 8 },
  warning: { fontSize: 12, color: '#b91c1c', marginTop: 8 },
});
