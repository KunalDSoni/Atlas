import React from 'react';
import { View, Pressable, Text, StyleSheet } from 'react-native';
import { ProjectStatus } from '../api/statuses';

export function StatusPicker({ statuses, value, onChange }: { statuses: ProjectStatus[]; value: string; onChange: (key: string) => void }) {
  return (
    <View style={styles.row}>
      {statuses.map((status) => (
        <Pressable
          key={status.id}
          style={[styles.chip, status.key === value && styles.chipActive]}
          onPress={() => onChange(status.key)}
        >
          <Text style={status.key === value ? styles.chipTextActive : styles.chipText}>{status.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: '#ccc' },
  chipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  chipText: { color: '#333' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
});
