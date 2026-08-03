import React from 'react';
import { Button } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ProjectListScreen } from '../screens/ProjectListScreen';
import { BoardScreen } from '../screens/BoardScreen';
import { IssueDetailScreen } from '../screens/IssueDetailScreen';
import { CreateIssueScreen } from '../screens/CreateIssueScreen';
import { useAuth } from '../auth/AuthContext';

function LogoutButton() {
  const { signOut } = useAuth();
  return <Button title="Log Out" onPress={() => signOut()} />;
}

export type MainStackParamList = {
  Projects: undefined;
  Board: { projectId: string; projectName: string };
  IssueDetail: { issueId: string };
  CreateIssue: { projectId: string };
};

const Stack = createNativeStackNavigator<MainStackParamList>();

export function MainStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="Projects"
        component={ProjectListScreen}
        options={{ title: 'Projects', headerRight: () => <LogoutButton /> }}
      />
      <Stack.Screen
        name="Board"
        component={BoardScreen}
        options={({ route }) => ({ title: route.params.projectName })}
      />
      <Stack.Screen name="IssueDetail" component={IssueDetailScreen} options={{ title: 'Issue' }} />
      <Stack.Screen name="CreateIssue" component={CreateIssueScreen} options={{ title: 'New Issue', presentation: 'modal' }} />
    </Stack.Navigator>
  );
}
