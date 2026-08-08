import React from 'react';
import {
  View,
  FlatList,
  ActivityIndicator,
  Text,
  StyleSheet,
} from 'react-native';
import { useActivity } from '../api/hooks';
import { notifyError } from '../utils/notifications';

export function ActivityFeedScreen() {
  const { data: activities, isLoading, error } = useActivity();

  if (error) {
    notifyError('Failed to load activity feed');
  }

  const renderActivity = ({ item }: { item: any }) => (
    <View style={styles.activityItem}>
      <Text style={styles.actor}>{item.actor?.name}</Text>
      <Text style={styles.action}>{item.action}</Text>
      <Text style={styles.time}>
        {new Date(item.createdAt).toLocaleDateString()}
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      {isLoading && <ActivityIndicator size="large" color="#0066cc" />}

      {!isLoading && activities && activities.length > 0 && (
        <FlatList
          data={activities}
          keyExtractor={(item) => item.id}
          renderItem={renderActivity}
        />
      )}

      {!isLoading && (!activities || activities.length === 0) && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No recent activity</Text>
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
  activityItem: {
    backgroundColor: 'white',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  actor: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  action: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  time: {
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
