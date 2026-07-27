import React from 'react';
import { View, Pressable, Text } from 'react-native';
import { ProjectMember } from '../api/members';
import { chipStyles as styles } from './chipStyles';

export function AssigneePicker({ members, value, onChange }: { members: ProjectMember[]; value: string | null; onChange: (id: string | null) => void }) {
  return (
    <View style={styles.row}>
      <Pressable style={[styles.chip, value === null && styles.chipActive]} onPress={() => onChange(null)}>
        <Text style={value === null ? styles.chipTextActive : styles.chipText}>Unassigned</Text>
      </Pressable>
      {members.map((member) => (
        <Pressable
          key={member.id}
          style={[styles.chip, member.user_id === value && styles.chipActive]}
          onPress={() => onChange(member.user_id)}
        >
          <Text style={member.user_id === value ? styles.chipTextActive : styles.chipText}>{member.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}
