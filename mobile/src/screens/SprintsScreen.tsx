import React, { useState } from 'react';
import {
  View,
  FlatList,
  ActivityIndicator,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSprints, useCreateSprint } from '../api/hooks';
import { notifyError, notifySuccess } from '../utils/notifications';

const STATUS_COLORS: Record<string, string> = {
  planned: '#5bc0de',
  active: '#5cb85c',
  completed: '#999',
};

const STATUS_LABELS: Record<string, string> = {
  planned: 'Planned',
  active: 'Active',
  completed: 'Completed',
};

export interface Sprint {
  id: string;
  name: string;
  status: 'planned' | 'active' | 'completed';
  startDate?: string;
  endDate?: string;
  issues?: any[];
  goal?: string;
}

export function SprintsScreen({ route, navigation }: any) {
  const { projectId } = route.params;
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [sprintName, setSprintName] = useState('');
  const [sprintGoal, setSprintGoal] = useState('');

  const { data: sprints, isLoading, error, refetch } = useSprints(projectId);
  const createSprintMutation = useCreateSprint({
    onSuccess: () => {
      notifySuccess('Sprint created');
      setSprintName('');
      setSprintGoal('');
      setShowCreateModal(false);
      refetch();
    },
    onError: () => notifyError('Failed to create sprint'),
  });

  if (error) {
    notifyError('Failed to load sprints');
  }

  const handleCreateSprint = () => {
    if (sprintName.trim()) {
      createSprintMutation.mutate({
        name: sprintName,
        goal: sprintGoal,
        projectId,
      });
    } else {
      notifyError('Sprint name is required');
    }
  };

  const handleSprintTap = (sprint: Sprint) => {
    // Navigate to sprint detail or show sprint board
    notifySuccess('Sprint: ' + sprint.name);
  };

  const renderSprint = ({ item }: { item: Sprint }) => {
    const issueCount = item.issues?.length || 0;
    const statusColor = STATUS_COLORS[item.status] || '#0066cc';

    return (
      <TouchableOpacity
        style={styles.sprintItem}
        onPress={() => handleSprintTap(item)}
        activeOpacity={0.7}
      >
        <View style={styles.sprintHeader}>
          <View>
            <Text style={styles.sprintName}>{item.name}</Text>
            {item.goal && <Text style={styles.goal}>{item.goal}</Text>}
          </View>
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: statusColor },
            ]}
          >
            <Text style={styles.statusText}>
              {STATUS_LABELS[item.status] || item.status}
            </Text>
          </View>
        </View>

        <View style={styles.sprintFooter}>
          <Text style={styles.issueCount}>
            {issueCount} issue{issueCount !== 1 ? 's' : ''}
          </Text>
          {item.startDate && (
            <Text style={styles.dates}>
              {new Date(item.startDate).toLocaleDateString()} -{' '}
              {new Date(item.endDate || item.startDate).toLocaleDateString()}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const activeSprints = sprints?.filter((s: Sprint) => s.status === 'active') || [];
  const plannedSprints = sprints?.filter((s: Sprint) => s.status === 'planned') || [];
  const completedSprints = sprints?.filter((s: Sprint) => s.status === 'completed') || [];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.createButton}
          onPress={() => setShowCreateModal(true)}
        >
          <Text style={styles.createButtonText}>+ New Sprint</Text>
        </TouchableOpacity>
      </View>

      {isLoading && (
        <ActivityIndicator size="large" color="#0066cc" style={styles.spinner} />
      )}

      {!isLoading && sprints && sprints.length > 0 && (
        <FlatList
          data={sprints}
          keyExtractor={(item) => item.id}
          renderItem={renderSprint}
          renderSectionHeader={({ section }: any) =>
            section.data.length > 0 && (
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
              </View>
            )
          }
          sections={[
            { title: 'Active', data: activeSprints },
            { title: 'Planned', data: plannedSprints },
            { title: 'Completed', data: completedSprints },
          ]}
          contentContainerStyle={styles.listContent}
        />
      )}

      {!isLoading && (!sprints || sprints.length === 0) && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🏃</Text>
          <Text style={styles.emptyText}>No sprints yet</Text>
          <Text style={styles.emptySubtext}>Create one to get started</Text>
        </View>
      )}

      {/* Create Sprint Modal */}
      <Modal
        visible={showCreateModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCreateModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalContainer}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Create Sprint</Text>
                <TouchableOpacity onPress={() => setShowCreateModal(false)}>
                  <Text style={styles.closeButton}>✕</Text>
                </TouchableOpacity>
              </View>

              <TextInput
                style={styles.input}
                placeholder="Sprint name"
                value={sprintName}
                onChangeText={setSprintName}
                placeholderTextColor="#999"
              />

              <TextInput
                style={[styles.input, styles.goalInput]}
                placeholder="Sprint goal (optional)"
                value={sprintGoal}
                onChangeText={setSprintGoal}
                placeholderTextColor="#999"
                multiline
              />

              <TouchableOpacity
                style={[
                  styles.createModalButton,
                  !sprintName.trim() && styles.buttonDisabled,
                ]}
                onPress={handleCreateSprint}
                disabled={!sprintName.trim() || createSprintMutation.isPending}
              >
                <Text style={styles.createModalButtonText}>
                  {createSprintMutation.isPending ? 'Creating...' : 'Create Sprint'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: 'white',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  createButton: {
    backgroundColor: '#0066cc',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  createButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  spinner: {
    marginTop: 32,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  sectionHeader: {
    backgroundColor: '#f5f5f5',
    paddingVertical: 8,
    marginTop: 12,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#666',
    textTransform: 'uppercase',
  },
  sprintItem: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 16,
    marginBottom: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#0066cc',
  },
  sprintHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  sprintName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  goal: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    color: 'white',
    fontSize: 11,
    fontWeight: '600',
  },
  sprintFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  issueCount: {
    fontSize: 12,
    color: '#666',
  },
  dates: {
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
    fontWeight: '600',
    color: '#666',
    marginBottom: 4,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
  },
  modalContainer: {
    flex: 1,
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
    paddingHorizontal: 16,
    paddingVertical: 20,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  closeButton: {
    fontSize: 24,
    color: '#999',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 12,
  },
  goalInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  createModalButton: {
    backgroundColor: '#0066cc',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    backgroundColor: '#ccc',
  },
  createModalButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
});
