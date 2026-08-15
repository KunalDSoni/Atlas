// The @ picker for React Native.
//
// A phone has no caret coordinates and no room for a floating dropdown, so the
// web's anchored list does not translate. This is the standard mobile shape
// instead: a horizontal strip of candidates docked directly above the composer,
// where the keyboard already is and the thumb already reaches.
//
// The trigger grammar and insertion come from ../utils/mentions, the same rules
// the web surfaces use, so a mention typed on a phone and one typed in a
// browser are the same thing.

import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { searchMentions, type MentionCandidate } from '../api/mentions';
import { findMentionQuery, insertMention } from '../utils/mentions';

const DEBOUNCE_MS = 150;

export interface MentionBarProps {
  /** Current composer text. */
  value: string;
  /** Caret offset, from the TextInput's onSelectionChange. */
  caret: number;
  /** Ranks project members first. Optional. */
  projectId?: string;
  /** Receives the rewritten text and where the caret should land. */
  onInsert: (next: { text: string; caret: number }) => void;
}

export function MentionBar({ value, caret, projectId, onInsert }: MentionBarProps) {
  const [items, setItems] = useState<MentionCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  // Set when the user dismisses; cleared once they leave this query.
  const dismissedAt = useRef<number | null>(null);

  const active = findMentionQuery(value, caret);
  const query = active ? active.query : null;

  if (active && dismissedAt.current !== null && dismissedAt.current !== active.start) {
    dismissedAt.current = null;
  }
  const dismissed = active !== null && dismissedAt.current === active.start;

  useEffect(() => {
    if (query === null || dismissed) { setItems([]); return; }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      searchMentions(query, projectId)
        .then((rows) => { if (!cancelled) setItems(rows); })
        // A failed lookup simply offers nobody. Typing must never be
        // interrupted by a network problem.
        .catch(() => { if (!cancelled) setItems([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, projectId, dismissed]);

  if (active === null || dismissed) return null;
  if (!loading && items.length === 0) return null;
  const queryStart = active.start;

  return (
    <View style={styles.bar} accessibilityRole="menu" accessibilityLabel="Mention a person">
      {loading && items.length === 0 ? (
        <ActivityIndicator size="small" style={styles.spinner} />
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always">
          {items.map((user) => (
            <TouchableOpacity
              key={user.id}
              style={styles.chip}
              accessibilityRole="button"
              accessibilityLabel={
                user.is_member ? user.name : `${user.name}, not a member of this project`
              }
              onPress={() => onInsert(insertMention(value, caret, user))}
            >
              <View style={[styles.avatar, { backgroundColor: user.avatar_color ?? '#94a3b8' }]}>
                <Text style={styles.avatarText}>{user.name.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View>
                <Text style={styles.name} numberOfLines={1}>{user.name}</Text>
                {!user.is_member && <Text style={styles.warning}>Not a member</Text>}
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
      <TouchableOpacity
        style={styles.dismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss mention suggestions"
        onPress={() => { dismissedAt.current = queryStart; setItems([]); }}
      >
        <Text style={styles.dismissText}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  spinner: { marginHorizontal: 12 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 9,
    marginRight: 6,
    borderRadius: 16,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  avatar: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: 'white', fontSize: 11, fontWeight: '700' },
  name: { fontSize: 13, maxWidth: 140 },
  warning: { fontSize: 10, color: '#b45309' },
  dismiss: { paddingHorizontal: 8, paddingVertical: 4 },
  dismissText: { color: '#64748b', fontSize: 13 },
});
