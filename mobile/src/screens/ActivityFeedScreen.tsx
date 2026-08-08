import React, { useState } from 'react';
import {
  View,
  FlatList,
  ActivityIndicator,
  Text,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { useActivity } from '../api/hooks';
import { notifyError } from '../utils/notifications';

const ACTIVITY_ICONS: Record<string, string> = {
  created: '✨',
  updated: '✏️',
  closed: '✓',
  reopened: '🔄',
  assigned: '👤',
  commented: '💬',
  linked: '🔗',
  mentioned: '@',
  status_changed: '🔄',
};

export interface ActivityItem {
  id: string;
  type: string;
  actor?: { name: string };
  action: string;
  description?: string;
  issue?: { key: string; title: string };
  createdAt: string;
}

export function ActivityFeedScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const { data: activities, isLoading, error, refetch } = useActivity();

  if (error) {
    notifyError('Failed to load activity feed');
  }

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const formatTime = (createdAt: string) => {
    const date = new Date(createdAt);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const renderActivity = ({ item }: { item: ActivityItem }) => {
    const icon = ACTIVITY_ICONS[item.type] || '📋';

    return (
      <View style={styles.activityItem}>
        <View style={styles.activityLeft}>
          <Text style={styles.icon}>{icon}</Text>
        </View>

        <View style={styles.activityContent}>
          <View style={styles.activityHeader}>
            <Text style={styles.actor}>{item.actor?.name}</Text>
            <Text style={styles.action}>{item.action}</Text>
          </View>

          {item.issue && (
            <Text style={styles.issueRef}>
              {item.issue.key} · {item.issue.title}
            </Text>
          )}

          {item.description && (
            <Text style={styles.description} numberOfLines={2}>
              {item.description}
            </Text>
          )}

          <Text style={styles.time}>{formatTime(item.createdAt)}</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {isLoading && !refreshing && (
        <ActivityIndicator size="large" color="#0066cc" style={styles.spinner} />
      )}

      {!isLoading && activities && activities.length > 0 && (
        <FlatList
          data={activities}
          keyExtractor={(item) => item.id}
          renderItem={renderActivity}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
          }
        />
      )}

      {!isLoading && (!activities || activities.length === 0) && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📭</Text>
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
  spinner: {
    marginTop: 32,
  },
  activityItem: {
    backgroundColor: 'white',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  activityLeft: {
    marginRight: 12,
    marginTop: 2,
  },
  icon: {
    fontSize: 20,
  },
  activityContent: {
    flex: 1,
  },
  activityHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  actor: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginRight: 6,
  },
  action: {
    fontSize: 14,
    color: '#666',
  },
  issueRef: {
    fontSize: 12,
    color: '#0066cc',
    fontWeight: '500',
    marginBottom: 4,
  },
  description: {
    fontSize: 13,
    color: '#666',
    marginBottom: 6,
    lineHeight: 18,
  },
  time: {
    fontSize: 11,
    color: '#999',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
  },
});
