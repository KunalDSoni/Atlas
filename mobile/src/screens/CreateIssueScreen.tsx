import React, { useState } from 'react';
import { View, TextInput, Button, Text, StyleSheet } from 'react-native';
import { MentionBar } from '../components/MentionBar';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { createIssue } from '../api/issues';
import { ApiError } from '../api/client';
import { MainStackParamList } from '../navigation/MainStack';

type Props = NativeStackScreenProps<MainStackParamList, 'CreateIssue'>;

export function CreateIssueScreen({ route, navigation }: Props) {
  const { projectId } = route.params;
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [descCaret, setDescCaret] = useState(0);
  // Set only to move the caret after an insert, then released on the next
  // selection change. setNativeProps does not work under Fabric.
  const [pendingSelection, setPendingSelection] = useState<{ start: number; end: number } | undefined>();
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
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    setError(null);
    mutation.mutate();
  };

  return (
    <View style={styles.container}>
      <TextInput style={styles.input} placeholder="Title" value={title} onChangeText={setTitle} />
      <TextInput
        style={[styles.input, styles.multiline]}
        placeholder="Description"
        value={description}
        onChangeText={(next) => { setDescription(next); setDescCaret(next.length); }}
        selection={pendingSelection}
        onSelectionChange={(e) => {
          setDescCaret(e.nativeEvent.selection.start);
          if (pendingSelection) setPendingSelection(undefined);
        }}
        multiline
      />
      <MentionBar
        value={description}
        caret={descCaret}
        projectId={projectId}
        onInsert={({ text, caret }) => {
          setDescription(text);
          setDescCaret(caret);
          setPendingSelection({ start: caret, end: caret });
        }}
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
