import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useComments, useDeleteComment, useUpdateComment } from '../api/hooks';
import { MentionText } from './MentionText';
import { notifyError, notifySuccess } from '../utils/notifications';

interface Comment {
  id: string;
  text: string;
  author: {
    name: string;
    email: string;
  };
  createdAt: string;
  updatedAt: string;
  edited?: boolean;
}

interface CommentListProps {
  issueId: string;
}

export function CommentList({ issueId }: CommentListProps) {
  const { data: comments, isLoading, error, refetch } = useComments(issueId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const deleteCommentMutation = useDeleteComment({
    onSuccess: () => {
      notifySuccess('Comment deleted');
      refetch();
    },
    onError: () => notifyError('Failed to delete comment'),
  });

  if (error) {
    notifyError('Failed to load comments');
    return null;
  }

  if (isLoading) {
    return <ActivityIndicator size="small" color="#0066cc" />;
  }

  if (!comments || comments.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyText}>No comments yet</Text>
      </View>
    );
  }

  const handleDeleteComment = (commentId: string) => {
    Alert.alert('Delete Comment', 'Are you sure?', [
      { text: 'Cancel', onPress: () => {} },
      {
        text: 'Delete',
        onPress: () => deleteCommentMutation.mutate(commentId),
        style: 'destructive',
      },
    ]);
  };

  const renderComment = ({ item }: { item: Comment }) => (
    <View style={styles.commentItem}>
      <View style={styles.commentHeader}>
        <Text style={styles.authorName}>{item.author.name}</Text>
        <Text style={styles.timestamp}>
          {new Date(item.createdAt).toLocaleDateString()}
        </Text>
      </View>
      <MentionText text={item.text} style={styles.commentText} />
      {item.edited && <Text style={styles.editedLabel}>(edited)</Text>}
      <View style={styles.commentActions}>
        <TouchableOpacity onPress={() => setEditingId(item.id)}>
          <Text style={styles.actionText}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handleDeleteComment(item.id)}>
          <Text style={[styles.actionText, styles.deleteText]}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Comments ({comments.length})</Text>
      <FlatList
        data={comments}
        keyExtractor={(item) => item.id}
        renderItem={renderComment}
        scrollEnabled={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 16,
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  commentItem: {
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  commentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  authorName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  timestamp: {
    fontSize: 12,
    color: '#999',
  },
  commentText: {
    fontSize: 14,
    color: '#555',
    lineHeight: 20,
    marginBottom: 8,
  },
  editedLabel: {
    fontSize: 11,
    color: '#999',
    fontStyle: 'italic',
    marginBottom: 8,
  },
  commentActions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionText: {
    fontSize: 12,
    color: '#0066cc',
    fontWeight: '500',
  },
  deleteText: {
    color: '#d9534f',
  },
  emptyState: {
    paddingVertical: 20,
  },
  emptyText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
  },
});
