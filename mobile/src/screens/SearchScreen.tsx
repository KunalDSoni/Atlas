import React, { useState, useEffect } from 'react';
import {
  View,
  TextInput,
  FlatList,
  ActivityIndicator,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { useSearch, useIssues } from '../api/hooks';
import { IssueCard } from '../components/IssueCard';
import { notifyError } from '../utils/notifications';

type FilterType = 'all' | 'status' | 'priority' | 'assignee';

interface SearchResult {
  id: string;
  title: string;
  status: string;
  priority: string;
  [key: string]: any;
}

export function SearchScreen({ navigation }: any) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data: searchResults, isLoading: isSearchLoading, error: searchError } = useSearch(
    debouncedQuery,
    { enabled: debouncedQuery.length > 0 }
  );

  const { data: allIssues, isLoading: isIssuesLoading } = useIssues(
    { search: debouncedQuery },
    { enabled: debouncedQuery.length > 0 }
  );

  if (searchError) {
    notifyError('Failed to search issues');
  }

  const handleSelectIssue = (issueId: string) => {
    navigation.navigate('IssueDetail', { issueId });
  };

  const results = searchResults || allIssues || [];
  const isLoading = isSearchLoading || isIssuesLoading;

  // Filter results based on active filter
  const filteredResults = results.filter((issue: SearchResult) => {
    switch (activeFilter) {
      case 'status':
        return issue.status === 'In Progress' || issue.status === 'In Review';
      case 'priority':
        return issue.priority === 'High' || issue.priority === 'Highest';
      case 'assignee':
        return issue.assignee !== undefined && issue.assignee !== null;
      default:
        return true;
    }
  });

  return (
    <View style={styles.container}>
      <View style={styles.searchSection}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search issues..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholderTextColor="#999"
          autoFocus
        />
      </View>

      {debouncedQuery.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterContainer}
        >
          {(['all', 'status', 'priority', 'assignee'] as FilterType[]).map((filter) => (
            <TouchableOpacity
              key={filter}
              style={[
                styles.filterBadge,
                activeFilter === filter && styles.filterBadgeActive,
              ]}
              onPress={() => setActiveFilter(filter)}
            >
              <Text
                style={[
                  styles.filterText,
                  activeFilter === filter && styles.filterTextActive,
                ]}
              >
                {filter.charAt(0).toUpperCase() + filter.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {isLoading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#0066cc" />
        </View>
      )}

      {!isLoading && filteredResults.length > 0 && (
        <FlatList
          data={filteredResults}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => handleSelectIssue(item.id)}>
              <IssueCard issue={item} />
            </TouchableOpacity>
          )}
          contentContainerStyle={styles.listContent}
        />
      )}

      {!isLoading && filteredResults.length === 0 && debouncedQuery.length > 0 && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No issues found</Text>
          {activeFilter !== 'all' && (
            <TouchableOpacity onPress={() => setActiveFilter('all')}>
              <Text style={styles.resetFiltersText}>Reset filters</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {debouncedQuery.length === 0 && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>Enter a search term to find issues</Text>
          <Text style={styles.emptySubtext}>
            Search by issue title, description, or ID
          </Text>
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
  searchSection: {
    backgroundColor: 'white',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  searchInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#f9f9f9',
  },
  filterContainer: {
    backgroundColor: 'white',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  filterBadge: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    marginVertical: 8,
  },
  filterBadgeActive: {
    backgroundColor: '#0066cc',
    borderColor: '#0066cc',
  },
  filterText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
  },
  filterTextActive: {
    color: 'white',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
  },
  resetFiltersText: {
    fontSize: 14,
    color: '#0066cc',
    marginTop: 12,
    fontWeight: '500',
  },
});
