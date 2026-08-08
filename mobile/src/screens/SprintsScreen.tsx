import React, { useState } from 'react';
import {
  View,
  FlatList,
  ActivityIndicator,
  Text,
  StyleSheet,
  TouchableOpacity,
  Button,
} from 'react-native';
import { useSprints, useCreateSprint } from '../api/hooks';
import { notifyError, notifySuccess } from '../utils/notifications';

export function SprintsScreen({ route }: any) {
  const { projectId } = route.params;
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [sprintName, setSprintName] = useState('');

  const { data: sprints, isLoading, error, refetch } = useSprints(projectId);
  const createSprintMutation = useCreateSprint({
    onSuccess: () => {
      notifySuccess('Sprint created');
      setSprintName('');
      setShowCreateForm(false);
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
        projectId,
      });
    }
  };

  const renderSprint = ({ item }: { item: any }) => (
    <View style={styles.sprintItem}>
      <Text style={styles.sprintName}>{item.name}</Text>
      <Text style={styles.sprintStatus}>{item.status}</Text>
      <Text style={styles.issueCount}>
        {item.issues?.length || 0} issues
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Button
          title={showCreateForm ? 'Cancel' : 'New Sprint'}
          onPress={() => setShowCreateForm(!showCreateForm)}
        />
      </View>

      {showCreateForm && (
        <View style={styles.createForm}>
          <Text>Sprint name input would go here</Text>
          <Button title="Create" onPress={handleCreateSprint} />
        </View>
      )}

      {isLoading && <ActivityIndicator size="large" color="#0066cc" />}

      {!isLoading && sprints && sprints.length > 0 && (
        <FlatList
          data={sprints}
          keyExtractor={(item) => item.id}
          renderItem={renderSprint}
        />
      )}

      {!isLoading && (!sprints || sprints.length === 0) && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No sprints yet</Text>
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
  header: {
    backgroundColor: 'white',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  createForm: {
    backgroundColor: 'white',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  sprintItem: {
    backgroundColor: 'white',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  sprintName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  sprintStatus: {
    fontSize: 14,
    color: '#0066cc',
    marginTop: 4,
  },
  issueCount: {
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
