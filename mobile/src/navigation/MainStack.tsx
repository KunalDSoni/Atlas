import React from 'react';
import { Button } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ProjectListScreen } from '../screens/ProjectListScreen';
import { BoardScreen } from '../screens/BoardScreen';
import { IssueDetailScreen } from '../screens/IssueDetailScreen';
import { CreateIssueScreen } from '../screens/CreateIssueScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { ActivityFeedScreen } from '../screens/ActivityFeedScreen';
import { SprintsScreen } from '../screens/SprintsScreen';
import { FiltersScreen } from '../screens/FiltersScreen';
import { EpicsScreen } from '../screens/EpicsScreen';
import { ReportsScreen } from '../screens/ReportsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { useAuth } from '../auth/AuthContext';

function LogoutButton() {
  const { signOut } = useAuth();
  return <Button title="Log Out" onPress={() => signOut()} />;
}

export type MainStackParamList = {
  // Main navigation
  Projects: undefined;
  Board: { projectId: string; projectName: string };
  Search: undefined;
  Notifications: undefined;
  ActivityFeed: undefined;
  Sprints: { projectId: string };
  Filters: { projectId: string };
  Epics: { projectId: string };
  Reports: { projectId: string };
  Settings: undefined;

  // Detail screens
  IssueDetail: { issueId: string };

  // Modals
  CreateIssue: { projectId: string };
};

const Stack = createNativeStackNavigator<MainStackParamList>();

export function MainStack() {
  return (
    <Stack.Navigator>
      {/* Main screens */}
      <Stack.Screen
        name="Projects"
        component={ProjectListScreen}
        options={{ title: 'Projects', headerRight: () => <LogoutButton /> }}
      />

      {/* Project-specific screens */}
      <Stack.Screen
        name="Board"
        component={BoardScreen}
        options={({ route }) => ({ title: route.params.projectName })}
      />

      <Stack.Screen
        name="Sprints"
        component={SprintsScreen}
        options={{ title: 'Sprints' }}
      />

      <Stack.Screen
        name="Filters"
        component={FiltersScreen}
        options={{ title: 'Filters' }}
      />

      <Stack.Screen
        name="Epics"
        component={EpicsScreen}
        options={{ title: 'Epics' }}
      />

      <Stack.Screen
        name="Reports"
        component={ReportsScreen}
        options={{ title: 'Reports' }}
      />

      {/* Global screens */}
      <Stack.Screen
        name="Search"
        component={SearchScreen}
        options={{ title: 'Search', headerShown: true }}
      />

      <Stack.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{ title: 'Notifications' }}
      />

      <Stack.Screen
        name="ActivityFeed"
        component={ActivityFeedScreen}
        options={{ title: 'Activity' }}
      />

      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: 'Settings' }}
      />

      {/* Detail screens */}
      <Stack.Screen
        name="IssueDetail"
        component={IssueDetailScreen}
        options={{ title: 'Issue' }}
      />

      {/* Modal screens */}
      <Stack.Group screenOptions={{ presentation: 'modal' }}>
        <Stack.Screen
          name="CreateIssue"
          component={CreateIssueScreen}
          options={{ title: 'New Issue' }}
        />
      </Stack.Group>
    </Stack.Navigator>
  );
}
