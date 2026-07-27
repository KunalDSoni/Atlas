import React from 'react';
import { FlatList, Pressable, Text, View, StyleSheet, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { fetchProjects, Project } from '../api/projects';

type Props = { navigation: { navigate: (screen: string, params: { projectId: string; projectName: string }) => void } };

export function ProjectListScreen({ navigation }: Props) {
  const { data, isLoading, refetch, isRefetching } = useQuery({ queryKey: ['projects'], queryFn: fetchProjects });

  if (isLoading) return <ActivityIndicator style={styles.center} />;

  return (
    <FlatList
      data={data ?? []}
      keyExtractor={(item: Project) => item.id}
      refreshing={isRefetching}
      onRefresh={refetch}
      renderItem={({ item }) => (
        <Pressable style={styles.row} onPress={() => navigation.navigate('Board', { projectId: item.id, projectName: item.name })}>
          <Text style={styles.key}>{item.key}</Text>
          <Text style={styles.name}>{item.name}</Text>
          <Text style={styles.meta}>{item.issue_count} issues</Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center' },
  row: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee' },
  key: { fontSize: 12, color: '#666' },
  name: { fontSize: 18, fontWeight: '600' },
  meta: { fontSize: 12, color: '#999' },
});
