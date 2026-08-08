import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
} from 'react-native';
import { useWatchers, useAddWatcher, useRemoveWatcher, useIssueDetail } from '../api/hooks';
import { notifyError, notifySuccess } from '../utils/notifications';

interface Watcher {
  id: string;
  name: string;
  email: string;
}

interface WatchersListProps {
  issueId: string;
}

export function WatchersList({ issueId }: WatchersListProps) {
  const { data: watchers, isLoading, error, refetch } = useWatchers(issueId);
  const { data: issue } = useIssueDetail(issueId);
  const [showMemberPicker, setShowMemberPicker] = useState(false);

  const addWatcherMutation = useAddWatcher(issueId, {
    onSuccess: () => {
      notifySuccess('Watcher added');
      setShowMemberPicker(false);
      refetch();
    },
    onError: () => notifyError('Failed to add watcher'),
  });

  const removeWatcherMutation = useRemoveWatcher({
    onSuccess: () => {
      notifySuccess('Watcher removed');
      refetch();
    },
    onError: () => notifyError('Failed to remove watcher'),
  });

  if (error) {
    notifyError('Failed to load watchers');
    return null;
  }

  const handleRemoveWatcher = (watcherId: string) => {
    Alert.alert('Remove Watcher', 'Are you sure?', [
      { text: 'Cancel' },
      {
        text: 'Remove',
        onPress: () => removeWatcherMutation.mutate({ issueId, userId: watcherId }),
        style: 'destructive',
      },
    ]);
  };

  const handleAddWatcher = (userId: string) => {
    addWatcherMutation.mutate(userId);
  };

  // Get available users to add as watchers (project members not already watching)
  const availableMembers = (issue?.project?.members || []).filter(
    (member: Watcher) => !watchers?.some((w: Watcher) => w.id === member.id)
  );

  const renderWatcher = ({ item }: { item: Watcher }) => (
    <View style={styles.watcherItem}>
      <View style={styles.watcherInfo}>
        <Text style={styles.watcherName}>{item.name}</Text>
        <Text style={styles.watcherEmail}>{item.email}</Text>
      </View>
      <TouchableOpacity
        onPress={() => handleRemoveWatcher(item.id)}
        disabled={removeWatcherMutation.isPending}
      >
        <Text style={styles.removeButton}>✕</Text>
      </TouchableOpacity>
    </View>
  );

  const renderAvailableMember = ({ item }: { item: Watcher }) => (
    <TouchableOpacity
      style={styles.memberOption}
      onPress={() => handleAddWatcher(item.id)}
      disabled={addWatcherMutation.isPending}
    >
      <Text style={styles.memberName}>{item.name}</Text>
      <Text style={styles.memberEmail}>{item.email}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>
          Watchers {watchers && `(${watchers.length})`}
        </Text>
        <TouchableOpacity
          onPress={() => setShowMemberPicker(true)}
          disabled={addWatcherMutation.isPending || availableMembers.length === 0}
        >
          <Text style={styles.addButton}>+ Add</Text>
        </TouchableOpacity>
      </View>

      {isLoading && <ActivityIndicator size="small" color="#0066cc" />}

      {!isLoading && watchers && watchers.length > 0 && (
        <FlatList
          data={watchers}
          keyExtractor={(item) => item.id}
          renderItem={renderWatcher}
          scrollEnabled={false}
        />
      )}

      {!isLoading && (!watchers || watchers.length === 0) && (
        <Text style={styles.emptyText}>No watchers yet</Text>
      )}

      {/* Member Picker Modal */}
      <Modal
        visible={showMemberPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowMemberPicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Watcher</Text>
              <TouchableOpacity onPress={() => setShowMemberPicker(false)}>
                <Text style={styles.modalCloseButton}>✕</Text>
              </TouchableOpacity>
            </View>

            {availableMembers.length > 0 ? (
              <ScrollView>
                {availableMembers.map((member: Watcher) => (
                  <TouchableOpacity
                    key={member.id}
                    style={styles.memberOption}
                    onPress={() => handleAddWatcher(member.id)}
                  >
                    <Text style={styles.memberName}>{member.name}</Text>
                    <Text style={styles.memberEmail}>{member.email}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : (
              <View style={styles.emptyMembers}>
                <Text style={styles.emptyText}>No more members to add</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  addButton: {
    fontSize: 14,
    color: '#0066cc',
    fontWeight: '600',
  },
  watcherItem: {
    backgroundColor: '#f9f9f9',
    borderRadius: 6,
    padding: 10,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  watcherInfo: {
    flex: 1,
  },
  watcherName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
  watcherEmail: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  removeButton: {
    fontSize: 18,
    color: '#d9534f',
    fontWeight: 'bold',
    padding: 4,
  },
  emptyText: {
    fontSize: 13,
    color: '#999',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: 'white',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '80%',
    paddingTop: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  modalCloseButton: {
    fontSize: 20,
    color: '#999',
  },
  memberOption: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  memberName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
  memberEmail: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  emptyMembers: {
    padding: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
