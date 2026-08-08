import React, { useState } from 'react';
import {
  View,
  TextInput,
  FlatList,
  ActivityIndicator,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useSearch } from '../api/hooks';
import { IssueCard } from '../components/IssueCard';
import { notifyError } from '../utils/notifications';

export function SearchScreen({ navigation }: any) {
  const [searchQuery, setSearchQuery] = useState('');
  const { data: results, isLoading, error } = useSearch(searchQuery);

  if (error) {
    notifyError('Failed to search issues');
  }

  const handleSelectIssue = (issueId: string) => {
    navigation.navigate('IssueDetail', { issueId });
  };

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.searchInput}
        placeholder="Search issues..."
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholderTextColor="#999"
      />

      {isLoading && <ActivityIndicator size="large" color="#0066cc" />}

      {!isLoading && results && results.length > 0 && (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => handleSelectIssue(item.id)}>
              <IssueCard issue={item} />
            </TouchableOpacity>
          )}
        />
      )}

      {!isLoading && (!results || results.length === 0) && searchQuery.length > 0 && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No issues found</Text>
        </View>
      )}

      {searchQuery.length === 0 && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>Enter a search term to find issues</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f5f5f5',
  },
  searchInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    fontSize: 16,
    backgroundColor: 'white',
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
