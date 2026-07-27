import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ProjectListScreen } from '../screens/ProjectListScreen';
import { BoardScreen } from '../screens/BoardScreen';

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
      <Stack.Screen name="Projects" component={ProjectListScreen} options={{ title: 'Projects' }} />
      <Stack.Screen
        name="Board"
        component={BoardScreen}
        options={({ route }) => ({ title: route.params.projectName })}
      />
    </Stack.Navigator>
  );
}
