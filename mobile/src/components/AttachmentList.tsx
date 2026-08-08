import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import { useAttachments, useDeleteAttachment } from '../api/hooks';
import { notifyError, notifySuccess } from '../utils/notifications';

interface Attachment {
  id: string;
  filename: string;
  size: number;
  url: string;
  uploadedBy?: { name: string };
  uploadedAt: string;
}

interface AttachmentListProps {
  issueId: string;
}

const FILE_TYPE_ICONS: Record<string, string> = {
  pdf: '📄',
  doc: '📝',
  docx: '📝',
  xls: '📊',
  xlsx: '📊',
  txt: '📋',
  jpg: '🖼️',
  jpeg: '🖼️',
  png: '🖼️',
  gif: '🖼️',
  zip: '📦',
  '': '📎',
};

export function AttachmentList({ issueId }: AttachmentListProps) {
  const { data: attachments, isLoading, error, refetch } = useAttachments(issueId);
  const deleteAttachmentMutation = useDeleteAttachment({
    onSuccess: () => {
      notifySuccess('Attachment deleted');
      refetch();
    },
    onError: () => notifyError('Failed to delete attachment'),
  });

  if (error) {
    notifyError('Failed to load attachments');
    return null;
  }

  if (isLoading) {
    return <ActivityIndicator size="small" color="#0066cc" />;
  }

  if (!attachments || attachments.length === 0) {
    return null;
  }

  const handleOpenAttachment = (attachment: Attachment) => {
    Linking.openURL(attachment.url).catch(() => {
      notifyError('Unable to open attachment');
    });
  };

  const handleDeleteAttachment = (attachmentId: string, filename: string) => {
    Alert.alert('Delete Attachment', `Remove "${filename}"?`, [
      { text: 'Keep' },
      {
        text: 'Delete',
        onPress: () => deleteAttachmentMutation.mutate(attachmentId),
        style: 'destructive',
      },
    ]);
  };

  const getFileIcon = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    return FILE_TYPE_ICONS[ext] || FILE_TYPE_ICONS[''];
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const renderAttachment = ({ item }: { item: Attachment }) => (
    <TouchableOpacity
      style={styles.attachmentItem}
      onPress={() => handleOpenAttachment(item)}
      activeOpacity={0.7}
    >
      <Text style={styles.icon}>{getFileIcon(item.filename)}</Text>

      <View style={styles.attachmentInfo}>
        <Text style={styles.filename} numberOfLines={1}>
          {item.filename}
        </Text>
        <View style={styles.meta}>
          <Text style={styles.size}>{formatFileSize(item.size)}</Text>
          {item.uploadedBy && (
            <Text style={styles.uploader}>
              · {item.uploadedBy.name}
            </Text>
          )}
        </View>
      </View>

      <TouchableOpacity
        onPress={() =>
          handleDeleteAttachment(item.id, item.filename)
        }
        disabled={deleteAttachmentMutation.isPending}
        style={styles.deleteButton}
      >
        <Text style={styles.deleteIcon}>✕</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        Attachments ({attachments.length})
      </Text>
      <FlatList
        data={attachments}
        keyExtractor={(item) => item.id}
        renderItem={renderAttachment}
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
    paddingTop: 12,
  },
  title: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  attachmentItem: {
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    fontSize: 24,
    marginRight: 12,
  },
  attachmentInfo: {
    flex: 1,
  },
  filename: {
    fontSize: 14,
    fontWeight: '500',
    color: '#0066cc',
  },
  meta: {
    flexDirection: 'row',
    marginTop: 4,
  },
  size: {
    fontSize: 12,
    color: '#999',
  },
  uploader: {
    fontSize: 12,
    color: '#999',
    marginLeft: 4,
  },
  deleteButton: {
    padding: 4,
  },
  deleteIcon: {
    fontSize: 16,
    color: '#d9534f',
  },
});
