import React from 'react';
import {
  View,
  FlatList,
  ActivityIndicator,
  Text,
  StyleSheet,
  TouchableOpacity,
  Button,
} from 'react-native';
import { useFilters } from '../api/hooks';
import { notifyError } from '../utils/notifications';

export function FiltersScreen({ route }: any) {
  const { projectId } = route.params;
  const { data: filters, isLoading, error } = useFilters(projectId);

  if (error) {
    notifyError('Failed to load filters');
  }

  const renderFilter = ({ item }: { item: any }) => (
    <TouchableOpacity style={styles.filterItem}>
      <Text style={styles.filterName}>{item.name}</Text>
      {item.isDefault && <Text style={styles.defaultBadge}>Default</Text>}
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Button title="New Filter" onPress={() => {}} />
      </View>

      {isLoading && <ActivityIndicator size="large" color="#0066cc" />}

      {!isLoading && filters && filters.length > 0 && (
        <FlatList
          data={filters}
          keyExtractor={(item) => item.id}
          renderItem={renderFilter}
        />
      )}

      {!isLoading && (!filters || filters.length === 0) && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No saved filters</Text>
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
  filterItem: {
    backgroundColor: 'white',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  filterName: {
    fontSize: 16,
    color: '#333',
  },
  defaultBadge: {
    fontSize: 12,
    color: '#0066cc',
    fontWeight: 'bold',
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
