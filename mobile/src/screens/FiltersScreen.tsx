import React, { useState } from 'react';
import {
  View,
  FlatList,
  ActivityIndicator,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Switch,
  ScrollView,
  TextInput,
} from 'react-native';
import { useFilters, useCreateFilter, useDeleteFilter } from '../api/hooks';
import { notifyError, notifySuccess } from '../utils/notifications';

interface Filter {
  id: string;
  name: string;
  isDefault?: boolean;
  criteria?: {
    status?: string[];
    priority?: string[];
    assignee?: string[];
  };
}

export function FiltersScreen({ route }: any) {
  const { projectId } = route.params;
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [filterName, setFilterName] = useState('');

  const { data: filters, isLoading, error, refetch } = useFilters(projectId);

  const createFilterMutation = useCreateFilter({
    onSuccess: () => {
      notifySuccess('Filter created');
      setFilterName('');
      setShowCreateModal(false);
      refetch();
    },
    onError: () => notifyError('Failed to create filter'),
  });

  const deleteFilterMutation = useDeleteFilter({
    onSuccess: () => {
      notifySuccess('Filter deleted');
      refetch();
    },
    onError: () => notifyError('Failed to delete filter'),
  });

  if (error) {
    notifyError('Failed to load filters');
  }

  const handleCreateFilter = () => {
    if (filterName.trim()) {
      createFilterMutation.mutate({
        name: filterName,
        projectId,
        criteria: {},
      });
    } else {
      notifyError('Filter name is required');
    }
  };

  const handleDeleteFilter = (filterId: string) => {
    deleteFilterMutation.mutate(filterId);
  };

  const renderFilter = ({ item }: { item: Filter }) => (
    <View style={styles.filterItem}>
      <View style={styles.filterInfo}>
        <Text style={styles.filterName}>{item.name}</Text>
        {item.isDefault && (
          <Text style={styles.defaultBadge}>Default Filter</Text>
        )}
      </View>
      <TouchableOpacity
        onPress={() => handleDeleteFilter(item.id)}
        disabled={deleteFilterMutation.isPending}
        style={styles.deleteButton}
      >
        <Text style={styles.deleteIcon}>✕</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.createButton}
          onPress={() => setShowCreateModal(true)}
        >
          <Text style={styles.createButtonText}>+ New Filter</Text>
        </TouchableOpacity>
      </View>

      {isLoading && (
        <ActivityIndicator size="large" color="#0066cc" style={styles.spinner} />
      )}

      {!isLoading && filters && filters.length > 0 && (
        <FlatList
          data={filters}
          keyExtractor={(item) => item.id}
          renderItem={renderFilter}
          contentContainerStyle={styles.listContent}
        />
      )}

      {!isLoading && (!filters || filters.length === 0) && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🔍</Text>
          <Text style={styles.emptyText}>No saved filters</Text>
          <Text style={styles.emptySubtext}>Create one to save your search</Text>
        </View>
      )}

      {/* Create Filter Modal */}
      <Modal
        visible={showCreateModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCreateModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Filter</Text>
              <TouchableOpacity onPress={() => setShowCreateModal(false)}>
                <Text style={styles.closeButton}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <Text style={styles.label}>Filter Name</Text>
              <TextInput
                style={styles.input}
                placeholder="My Filter"
                value={filterName}
                onChangeText={setFilterName}
                placeholderTextColor="#999"
              />

              <Text style={styles.label}>Filter by Status</Text>
              <View style={styles.checkboxGroup}>
                {['To Do', 'In Progress', 'In Review', 'Done'].map((status) => (
                  <View key={status} style={styles.checkboxRow}>
                    <Text>{status}</Text>
                    <Switch value={false} onValueChange={() => {}} />
                  </View>
                ))}
              </View>

              <Text style={styles.label}>Filter by Priority</Text>
              <View style={styles.checkboxGroup}>
                {['Low', 'Medium', 'High', 'Highest'].map((priority) => (
                  <View key={priority} style={styles.checkboxRow}>
                    <Text>{priority}</Text>
                    <Switch value={false} onValueChange={() => {}} />
                  </View>
                ))}
              </View>
            </ScrollView>

            <TouchableOpacity
              style={[
                styles.createButton,
                !filterName.trim() && styles.buttonDisabled,
              ]}
              onPress={handleCreateFilter}
              disabled={!filterName.trim() || createFilterMutation.isPending}
            >
              <Text style={styles.createButtonText}>
                {createFilterMutation.isPending ? 'Creating...' : 'Create Filter'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
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
  buttonDisabled: {
    backgroundColor: '#ccc',
  },
  spinner: {
    marginTop: 32,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  filterItem: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 16,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  filterInfo: {
    flex: 1,
  },
  filterName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  defaultBadge: {
    fontSize: 11,
    color: '#0066cc',
    fontWeight: '600',
    marginTop: 4,
  },
  deleteButton: {
    padding: 4,
  },
  deleteIcon: {
    fontSize: 18,
    color: '#d9534f',
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: 'white',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '90%',
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
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
  modalBody: {
    maxHeight: '60%',
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginTop: 16,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  checkboxGroup: {
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    overflow: 'hidden',
  },
  checkboxRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
});
