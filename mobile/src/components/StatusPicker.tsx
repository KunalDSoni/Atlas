import React from 'react';
import { View, Pressable, Text } from 'react-native';
import { ProjectStatus } from '../api/statuses';
import { chipStyles as styles } from './chipStyles';

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
