import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  ScrollView,
  Button,
  ActivityIndicator,
} from 'react-native';
import { useProfile, useSettings, useUpdateSettings } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { notifyError, notifySuccess } from '../utils/notifications';

export function SettingsScreen() {
  const { signOut } = useAuth();
  const profileQuery = useProfile();
  const settingsQuery = useSettings();
  const updateSettingsMutation = useUpdateSettings({
    onSuccess: () => {
      notifySuccess('Settings updated');
    },
    onError: () => {
      notifyError('Failed to update settings');
    },
  });

  const [settings, setSettings] = useState({
    notifyMentions: true,
    notifyAssigned: true,
    notifyComments: true,
    notifyWatching: true,
    theme: 'auto' as 'auto' | 'light' | 'dark',
  });

  const handleSettingChange = (key: string, value: any) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    updateSettingsMutation.mutate(newSettings);
  };

  const handleLogout = () => {
    signOut();
  };

  return (
    <ScrollView style={styles.container}>
      {/* Profile Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Profile</Text>
        {profileQuery.isLoading ? (
          <ActivityIndicator size="large" color="#0066cc" />
        ) : profileQuery.data ? (
          <View style={styles.profileInfo}>
            <Text style={styles.label}>Name</Text>
            <Text style={styles.value}>{profileQuery.data.name}</Text>
            <Text style={styles.label}>Email</Text>
            <Text style={styles.value}>{profileQuery.data.email}</Text>
          </View>
        ) : null}
      </View>

      {/* Notification Settings */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notifications</Text>
        <View style={styles.settingRow}>
          <Text style={styles.label}>Mention Notifications</Text>
          <Switch
            value={settings.notifyMentions}
            onValueChange={(value) => handleSettingChange('notifyMentions', value)}
          />
        </View>
        <View style={styles.settingRow}>
          <Text style={styles.label}>Assignment Notifications</Text>
          <Switch
            value={settings.notifyAssigned}
            onValueChange={(value) => handleSettingChange('notifyAssigned', value)}
          />
        </View>
        <View style={styles.settingRow}>
          <Text style={styles.label}>Comment Notifications</Text>
          <Switch
            value={settings.notifyComments}
            onValueChange={(value) => handleSettingChange('notifyComments', value)}
          />
        </View>
        <View style={styles.settingRow}>
          <Text style={styles.label}>Watching Notifications</Text>
          <Switch
            value={settings.notifyWatching}
            onValueChange={(value) => handleSettingChange('notifyWatching', value)}
          />
        </View>
      </View>

      {/* Theme Settings */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Appearance</Text>
        <View style={styles.settingRow}>
          <Text style={styles.label}>Current Theme: {settings.theme}</Text>
        </View>
      </View>

      {/* Logout */}
      <View style={styles.section}>
        <Button title="Log Out" onPress={handleLogout} color="#d9534f" />
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
  profileInfo: {
    paddingTop: 8,
  },
  label: {
    fontSize: 14,
    color: '#666',
    marginTop: 12,
    marginBottom: 4,
  },
  value: {
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
});
