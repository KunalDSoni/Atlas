import React from 'react';
import { render, waitFor, fireEvent, screen } from '@testing-library/react-native';
import { Text, Button } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { AuthProvider, useAuth } from '../AuthContext';
import * as authApi from '../../api/auth';

jest.mock('../../api/auth');
jest.mock('expo-secure-store');

function TestConsumer() {
  const { user, isLoading, signIn, signOut } = useAuth();
  if (isLoading) return <Text>loading</Text>;
  return (
    <>
      <Text>{user ? `logged-in:${user.email}` : 'logged-out'}</Text>
      <Button title="login" onPress={() => signIn('a@b.com', 'pw')} />
      <Button title="logout" onPress={() => signOut()} />
    </>
  );
}

beforeEach(() => {
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
  (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
  (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
});

test('starts logged out when no stored session exists', async () => {
  render(<AuthProvider><TestConsumer /></AuthProvider>);
  await waitFor(() => screen.getByText('logged-out'));
});

test('signIn stores session and updates user', async () => {
  (authApi.login as jest.Mock).mockResolvedValue({ id: '1', email: 'a@b.com', name: 'A', role: 'member', avatar_color: null, avatar_url: null, token: 'tok123' });

  render(<AuthProvider><TestConsumer /></AuthProvider>);
  await waitFor(() => screen.getByText('logged-out'));

  fireEvent.press(screen.getByText('login'));

  await waitFor(() => screen.getByText('logged-in:a@b.com'));
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('atlas_token', 'tok123');
});

test('signOut clears stored session', async () => {
  (authApi.login as jest.Mock).mockResolvedValue({ id: '1', email: 'a@b.com', name: 'A', role: 'member', avatar_color: null, avatar_url: null, token: 'tok123' });
  (authApi.logout as jest.Mock).mockResolvedValue({ ok: true });

  render(<AuthProvider><TestConsumer /></AuthProvider>);
  await waitFor(() => screen.getByText('logged-out'));
  fireEvent.press(screen.getByText('login'));
  await waitFor(() => screen.getByText('logged-in:a@b.com'));

  fireEvent.press(screen.getByText('logout'));

  await waitFor(() => screen.getByText('logged-out'));
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('atlas_token');
});
