import React from 'react';
import {
  View,
  FlatList,
  ActivityIndicator,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useEpics } from '../api/hooks';
import { notifyError } from '../utils/notifications';

export function EpicsScreen({ route }: any) {
  const { projectId } = route.params;
  const { data: epics, isLoading, error } = useEpics(projectId);

  if (error) {
    notifyError('Failed to load epics');
  }

  const renderEpic = ({ item }: { item: any }) => (
    <TouchableOpacity style={styles.epicItem}>
      <Text style={styles.epicTitle}>{item.title}</Text>
      <Text style={styles.epicCount}>
        {item.children?.length || 0} child issues
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {isLoading && <ActivityIndicator size="large" color="#0066cc" />}

      {!isLoading && epics && epics.length > 0 && (
        <FlatList
          data={epics}
          keyExtractor={(item) => item.id}
          renderItem={renderEpic}
        />
      )}

      {!isLoading && (!epics || epics.length === 0) && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No epics</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  epicItem: {
    backgroundColor: 'white',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  epicTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  epicCount: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
  },
});
