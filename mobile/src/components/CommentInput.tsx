import React, { useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useCreateComment } from '../api/hooks';
import { notifyError, notifySuccess } from '../utils/notifications';

interface CommentInputProps {
  issueId: string;
  onCommentAdded?: () => void;
}

export function CommentInput({ issueId, onCommentAdded }: CommentInputProps) {
  const [text, setText] = useState('');
  const createCommentMutation = useCreateComment(issueId, {
    onSuccess: () => {
      notifySuccess('Comment added');
      setText('');
      onCommentAdded?.();
    },
    onError: () => notifyError('Failed to add comment'),
  });

  const handleSubmit = () => {
    if (text.trim()) {
      createCommentMutation.mutate(text);
    }
  };

  const isSubmitting = createCommentMutation.isPending;

  return (
    <View style={styles.container}>
      <View style={styles.inputWrapper}>
        <TextInput
          style={styles.input}
          placeholder="Add a comment..."
          value={text}
          onChangeText={setText}
          multiline
          maxLength={5000}
          editable={!isSubmitting}
        />
      </View>

      <View style={styles.footer}>
        <Text style={styles.charCount}>
          {text.length}/5000
        </Text>
        <TouchableOpacity
          style={[
            styles.submitButton,
            (!text.trim() || isSubmitting) && styles.submitButtonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={!text.trim() || isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Text style={styles.submitButtonText}>Post</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 12,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  inputWrapper: {
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    padding: 12,
    fontSize: 14,
    minHeight: 60,
    maxHeight: 150,
    textAlignVertical: 'top',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  charCount: {
    fontSize: 12,
    color: '#999',
  },
  submitButton: {
    backgroundColor: '#0066cc',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 4,
  },
  submitButtonDisabled: {
    backgroundColor: '#ccc',
  },
  submitButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
});
