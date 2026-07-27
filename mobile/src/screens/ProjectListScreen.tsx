import React from 'react';
import { FlatList, Pressable, Text, StyleSheet, ActivityIndicator, Button } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { fetchProjects, Project } from '../api/projects';
import { MainStackParamList } from '../navigation/MainStack';

type Props = NativeStackScreenProps<MainStackParamList, 'Projects'>;

export function ProjectListScreen({ navigation }: Props) {
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({ queryKey: ['projects'], queryFn: fetchProjects });

  if (isLoading) return <ActivityIndicator style={styles.center} />;

  if (isError) {
    return (
      <>
        <Text style={styles.errorText}>Failed to load projects.</Text>
        <Button title="Retry" onPress={() => refetch()} />
      </>
    );
  }

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
  errorText: { padding: 16, textAlign: 'center', color: '#b91c1c' },
});
