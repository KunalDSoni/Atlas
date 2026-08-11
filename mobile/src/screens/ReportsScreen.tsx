import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useSprintBurndown, useVelocity } from '../api/hooks';
import { notifyError } from '../utils/notifications';

export function ReportsScreen({ route }: any) {
  const { projectId } = route.params;

  const burndownQuery = useSprintBurndown(projectId);
  const velocityQuery = useVelocity(projectId);

  if (burndownQuery.error) {
    notifyError('Failed to load burndown data');
  }

  if (velocityQuery.error) {
    notifyError('Failed to load velocity data');
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Sprint Burndown</Text>
        {burndownQuery.isLoading && <ActivityIndicator size="large" color="#0066cc" />}
        {burndownQuery.data && (
          <View style={styles.chartPlaceholder}>
            <Text>Burndown chart would render here</Text>
          </View>
        )}
        {!burndownQuery.data && !burndownQuery.isLoading && (
          <Text style={styles.emptyText}>Select a sprint to view burndown</Text>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Team Velocity</Text>
        {velocityQuery.isLoading && <ActivityIndicator size="large" color="#0066cc" />}
        {velocityQuery.data && (
          <View style={styles.chartPlaceholder}>
            <Text>Velocity chart would render here</Text>
          </View>
        )}
        {!velocityQuery.data && !velocityQuery.isLoading && (
          <Text style={styles.emptyText}>No velocity data available</Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 16,
  },
  section: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  chartPlaceholder: {
    height: 200,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
  },
});
