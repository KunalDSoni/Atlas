import React, { useState } from 'react';
import { View, TextInput, Button, Text, StyleSheet } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createIssue } from '../api/issues';
import { ApiError } from '../api/client';

type Props = {
  route: { params: { projectId: string } };
  navigation: { goBack: () => void };
};

export function CreateIssueScreen({ route, navigation }: Props) {
  const { projectId } = route.params;
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => createIssue(projectId, { title, description }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues', projectId] });
      navigation.goBack();
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.status === 403) {
        setError("You don't have permission to create issues in this project.");
      } else {
        setError(e instanceof Error ? e.message : 'Failed to create issue');
      }
    },
  });

  const onSubmit = () => {
    setError(null);
    if (!title.trim()) return;
    mutation.mutate();
  };

  return (
    <View style={styles.container}>
      <TextInput style={styles.input} placeholder="Title" value={title} onChangeText={setTitle} />
      <TextInput
        style={[styles.input, styles.multiline]}
        placeholder="Description"
        value={description}
        onChangeText={setDescription}
        multiline
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button title="Create" onPress={onSubmit} disabled={mutation.isPending} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, marginBottom: 12 },
  multiline: { minHeight: 100, textAlignVertical: 'top' },
  error: { color: 'red', marginBottom: 12 },
});
