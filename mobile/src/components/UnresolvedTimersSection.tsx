import React from 'react';
import { View, Text, Button, StyleSheet, Pressable } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchUnresolvedTimers, resolveTimerSegment } from '../api/timers';
import type { UnresolvedTimer } from '../api/timers';

/**
 * Timers the server stopped without crediting any time.
 *
 * An abandoned timer credits nothing, so unless the person says how long they
 * worked the time is never recorded. On web this lives in a header chip; here
 * it lives in Settings, because React Navigation headers are a separate
 * structure and a list somebody can find is worth more than a badge that needs
 * new navigation plumbing.
 *
 * Renders nothing when there is nothing to resolve.
 */

function ranFor(t: UnresolvedTimer): string {
  const start = new Date(`${t.started_at.replace(' ', 'T')}Z`).getTime();
  const end = new Date(`${t.ended_at.replace(' ', 'T')}Z`).getTime();
  const minutes = Math.max(0, Math.round((end - start) / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function UnresolvedTimersSection({ onOpenIssue }: { onOpenIssue?: (issueId: string) => void }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['unresolved-timers'], queryFn: fetchUnresolvedTimers });

  const dismiss = useMutation({
    mutationFn: (segmentId: string) => resolveTimerSegment(segmentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['unresolved-timers'] }),
  });

  const timers = query.data ?? [];
  if (timers.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Timers with no time logged</Text>
      <Text style={styles.hint}>
        These were stopped automatically, so nothing was recorded. Open the issue to log
        what you actually worked, or dismiss them.
      </Text>

      {timers.map((t) => (
        <View key={t.id} style={styles.row}>
          <Pressable onPress={() => onOpenIssue?.(t.issue_id)}>
            <Text style={styles.key}>{t.issue_key}</Text>
            <Text style={styles.title} numberOfLines={1}>{t.title}</Text>
          </Pressable>
          <Text style={styles.meta}>Ran {ranFor(t)} before it was stopped</Text>
          <Button
            title="Dismiss"
            onPress={() => dismiss.mutate(t.id)}
            disabled={dismiss.isPending}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee' },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  hint: { fontSize: 12, color: '#666', marginBottom: 12 },
  row: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  key: { fontSize: 13, fontWeight: '600' },
  title: { fontSize: 13, color: '#444' },
  meta: { fontSize: 12, color: '#888', marginTop: 2, marginBottom: 6 },
});
