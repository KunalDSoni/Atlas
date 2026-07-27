import React from 'react';
import { View, Pressable, Text, StyleSheet } from 'react-native';
import { ProjectMember } from '../api/members';

export function AssigneePicker({ members, value, onChange }: { members: ProjectMember[]; value: string | null; onChange: (id: string | null) => void }) {
  return (
    <View style={styles.row}>
      <Pressable style={[styles.chip, value === null && styles.chipActive]} onPress={() => onChange(null)}>
        <Text style={value === null ? styles.chipTextActive : styles.chipText}>Unassigned</Text>
      </Pressable>
      {members.map((member) => (
        <Pressable
          key={member.id}
          style={[styles.chip, member.id === value && styles.chipActive]}
          onPress={() => onChange(member.id)}
        >
          <Text style={member.id === value ? styles.chipTextActive : styles.chipText}>{member.name}</Text>
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
