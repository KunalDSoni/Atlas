import React, { useState } from 'react';
import { Modal, View, Text, TextInput, Button, StyleSheet, ActivityIndicator } from 'react-native';

/**
 * Ask for a duration in minutes.
 *
 * A controlled Modal rather than Alert.prompt, which is iOS-only. Kept as its
 * own component so any screen that needs to log time can use it.
 *
 * On failure the modal STAYS OPEN with the entered value: a bad connection must
 * never silently discard what someone typed, which for an abandoned timer is
 * their only remaining record of the session.
 */
export function TimeEntryModal({
  visible,
  title,
  onSubmit,
  onCancel,
}: {
  visible: boolean;
  title: string;
  onSubmit: (minutes: number) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const minutes = Number(value);
  const valid = Number.isFinite(minutes) && minutes > 0;

  async function submit() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(Math.round(minutes));
      setValue('');
      onCancel();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not log the time');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <TextInput
            style={styles.input}
            placeholder="Minutes"
            keyboardType="number-pad"
            value={value}
            onChangeText={setValue}
            editable={!busy}
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <View style={styles.actions}>
            <Button title="Cancel" onPress={onCancel} disabled={busy} />
            {busy ? <ActivityIndicator /> : <Button title="Log" onPress={submit} disabled={!valid} />}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)', padding: 24 },
  card: { backgroundColor: '#fff', borderRadius: 8, padding: 16 },
  title: { fontSize: 15, fontWeight: '600', marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 10, fontSize: 16 },
  error: { color: '#b91c1c', fontSize: 12, marginTop: 8 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 16 },
});
