import React, { useState } from 'react';
import {
  View,
  FlatList,
  ActivityIndicator,
  Text,
  StyleSheet,
  TouchableOpacity,
  SwipeableListView,
  Alert,
  RefreshControl,
} from 'react-native';
import { useNotifications, useMarkNotificationAsRead, useDeleteNotification } from '../api/hooks';
import { notifyError, notifySuccess } from '../utils/notifications';

export interface Notification {
  id: string;
  type: 'issue_updated' | 'issue_commented' | 'assigned' | 'mentioned' | 'watching';
  title: string;
  message: string;
  read: boolean;
  actor?: { name: string };
  createdAt: string;
  issue?: { id: string; key: string };
}

const NOTIFICATION_ICONS: Record<string, string> = {
  issue_updated: '📝',
  issue_commented: '💬',
  assigned: '👤',
  mentioned: '@',
  watching: '👁️',
};

export function NotificationsScreen({ navigation }: any) {
  const [refreshing, setRefreshing] = useState(false);
  const { data: notifications, isLoading, error, refetch } = useNotifications();

  const markAsReadMutation = useMarkNotificationAsRead({
    onSuccess: () => refetch(),
    onError: () => notifyError('Failed to mark as read'),
  });

  const deleteNotificationMutation = useDeleteNotification({
    onSuccess: () => {
      notifySuccess('Notification deleted');
      refetch();
    },
    onError: () => notifyError('Failed to delete notification'),
  });

  if (error) {
    notifyError('Failed to load notifications');
  }

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleNotificationTap = (notification: Notification) => {
    if (!notification.read) {
      markAsReadMutation.mutate(notification.id);
    }
    if (notification.issue) {
      navigation.navigate('IssueDetail', { issueId: notification.issue.id });
    }
  };

  const handleDelete = (notificationId: string) => {
    Alert.alert('Delete Notification', 'Remove this notification?', [
      { text: 'Keep', onPress: () => {} },
      {
        text: 'Delete',
        onPress: () => deleteNotificationMutation.mutate(notificationId),
        style: 'destructive',
      },
    ]);
  };

  const unreadCount = notifications?.filter((n: Notification) => !n.read).length || 0;

  const renderNotification = ({ item }: { item: Notification }) => (
    <TouchableOpacity
      style={[styles.notificationItem, !item.read && styles.unread]}
      onPress={() => handleNotificationTap(item)}
      activeOpacity={0.7}
    >
      <View style={styles.notificationLeft}>
        <Text style={styles.icon}>
          {NOTIFICATION_ICONS[item.type] || '🔔'}
        </Text>
        {!item.read && <View style={styles.unreadDot} />}
      </View>

      <View style={styles.notificationContent}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, !item.read && styles.titleBold]}>
            {item.title}
          </Text>
          <Text style={styles.actor}>{item.actor?.name}</Text>
        </View>
        <Text style={styles.message} numberOfLines={2}>
          {item.message}
        </Text>
        <Text style={styles.time}>
          {new Date(item.createdAt).toLocaleDateString()} ·{' '}
          {new Date(item.createdAt).toLocaleTimeString()}
        </Text>
      </View>

      <TouchableOpacity
        style={styles.deleteButton}
        onPress={() => handleDelete(item.id)}
      >
        <Text style={styles.deleteIcon}>✕</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {unreadCount > 0 && (
        <View style={styles.unreadBanner}>
          <Text style={styles.unreadBannerText}>
            {unreadCount} unread notification{unreadCount !== 1 ? 's' : ''}
          </Text>
        </View>
      )}

      {isLoading && !refreshing && (
        <ActivityIndicator size="large" color="#0066cc" style={styles.spinner} />
      )}

      {!isLoading && notifications && notifications.length > 0 && (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          renderItem={renderNotification}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
          }
        />
      )}

      {!isLoading && (!notifications || notifications.length === 0) && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🔔</Text>
          <Text style={styles.emptyText}>No notifications</Text>
          <Text style={styles.emptySubtext}>You're all caught up!</Text>
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
  unreadBanner: {
    backgroundColor: '#e7f3ff',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#0066cc',
  },
  unreadBannerText: {
    fontSize: 12,
    color: '#0066cc',
    fontWeight: '600',
  },
  spinner: {
    marginTop: 32,
  },
  notificationItem: {
    backgroundColor: 'white',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  unread: {
    backgroundColor: '#f9fafb',
  },
  notificationLeft: {
    position: 'relative',
    marginRight: 12,
    marginTop: 2,
  },
  icon: {
    fontSize: 24,
  },
  unreadDot: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#0066cc',
  },
  notificationContent: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  title: {
    fontSize: 14,
    color: '#333',
    flex: 1,
  },
  titleBold: {
    fontWeight: '600',
  },
  actor: {
    fontSize: 12,
    color: '#0066cc',
    marginLeft: 8,
  },
  message: {
    fontSize: 13,
    color: '#666',
    marginBottom: 6,
    lineHeight: 18,
  },
  time: {
    fontSize: 11,
    color: '#999',
  },
  deleteButton: {
    marginLeft: 8,
    padding: 4,
  },
  deleteIcon: {
    fontSize: 18,
    color: '#ddd',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
  },
});
