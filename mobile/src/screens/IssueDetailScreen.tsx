import React from 'react';
import { Alert, ScrollView, Text, StyleSheet, ActivityIndicator, Button } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { fetchIssue, updateIssue } from '../api/issues';
import { fetchProjectStatuses } from '../api/statuses';
import { fetchProjectMembers } from '../api/members';
import { fetchTimer, startTimer, pauseTimer, logWork } from '../api/timers';
import type { TimerStopReason } from '../api/timers';
import { getErrorMessage } from '../utils/errors';
import { StatusPicker } from '../components/StatusPicker';
import { AssigneePicker } from '../components/AssigneePicker';
import { CommentList } from '../components/CommentList';
import { CommentInput } from '../components/CommentInput';
import { MentionText } from '../components/MentionText';
import { WatchersList } from '../components/WatchersList';
import { AttachmentList } from '../components/AttachmentList';
import { TimeEntryModal } from '../components/TimeEntryModal';
import { MainStackParamList } from '../navigation/MainStack';

type Props = NativeStackScreenProps<MainStackParamList, 'IssueDetail'>;

function formatMinutes(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Why the server stopped a timer the user never paused. Worded identically to
 * the web rail on purpose: the same event described two different ways on two
 * devices reads as two different bugs.
 */
const STOP_REASON_TEXT: Record<TimerStopReason, string> = {
  workday_end: 'left running overnight, so it was stopped at the end of that working day',
  abandoned: 'left running for more than a day, so it was stopped without logging any time',
  issue_done: 'stopped because this issue was moved to a done status',
  switched_issue: 'stopped because you started a timer on another issue',
};

// An older client against a newer server must not render a sentence with a hole
// in it. The stop is still worth reporting; only the explanation is missing.
const stopReasonText = (reason: TimerStopReason) =>
  STOP_REASON_TEXT[reason] ?? 'stopped automatically';

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
    // The server rejects completing a parent whose children are still open, and
    // its message names each one. Without this the picker would just snap back
    // on the refetch with nothing said.
    onError: (error: unknown) => {
      queryClient.invalidateQueries({ queryKey: ['issue', issueId] });
      Alert.alert('Could not update issue', getErrorMessage(error));
    },
  });

  const timerQuery = useQuery({ queryKey: ['timer', issueId], queryFn: () => fetchTimer(issueId) });
  const [logOpen, setLogOpen] = React.useState(false);

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
      <MentionText text={issue.description} style={styles.description} />

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
      {/* Status age, not tracked time — see the same note in the web rail. */}
      {issue.in_progress_minutes_live !== null && (
        <Text style={styles.timeValue}>
          In an in-progress status for: {formatMinutes(issue.in_progress_minutes_live)}
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

      {/* A stop the user did not ask for is the thing that needs explaining.
          Under a live timer it would only confuse, so it is hidden while one runs. */}
      {!!timerQuery.data?.auto_stopped && !timerQuery.data.running && (
        <>
          <Text style={styles.autoStop}>
            Your timer was {stopReasonText(timerQuery.data.auto_stopped.reason)}.
          </Text>
          {timerQuery.data.auto_stopped.reason === 'abandoned' && (
            // Nothing was credited, so there is no entry to correct — the only
            // useful action is to state the real duration.
            <Button title="Log the time you worked" onPress={() => setLogOpen(true)} />
          )}
        </>
      )}

      <TimeEntryModal
        visible={logOpen}
        title="How long did you work on this?"
        onCancel={() => setLogOpen(false)}
        onSubmit={async (minutes) => {
          await logWork(issueId, minutes);
          // Posting settles the abandoned segments for this user on this issue,
          // so the explanation above clears itself with no extra call.
          await queryClient.invalidateQueries({ queryKey: ['timer', issueId] });
          await queryClient.invalidateQueries({ queryKey: ['issue', issueId] });
        }}
      />

      {/* Watchers Section */}
      <WatchersList issueId={issueId} />

      {/* Attachments Section */}
      <AttachmentList issueId={issueId} />

      {/* Comments Section */}
      <CommentList issueId={issueId} />
      <CommentInput issueId={issueId} projectId={issue.project_id} onCommentAdded={handleCommentAdded} />
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
  autoStop: { fontSize: 12, color: '#666', marginTop: 8, marginBottom: 8 },
});
