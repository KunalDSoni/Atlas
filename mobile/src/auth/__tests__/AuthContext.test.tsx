import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Text, Button } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import { AuthProvider, useAuth } from '../AuthContext';
import * as authApi from '../../api/auth';
import { apiFetch } from '../../api/client';

jest.mock('../../api/auth');
jest.mock('expo-secure-store');

function renderWithProviders(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><AuthProvider>{ui}</AuthProvider></QueryClientProvider>);
}

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
  jest.clearAllMocks();
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
  (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
  (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
});

test('starts logged out when no stored session exists', async () => {
  const { findByText } = await renderWithProviders(<TestConsumer />);
  await findByText('logged-out');
});

test('signIn stores session and updates user', async () => {
  (authApi.login as jest.Mock).mockResolvedValue({ id: '1', email: 'a@b.com', name: 'A', role: 'member', avatar_color: null, avatar_url: null, token: 'tok123' });

  const { findByText, getByText } = await renderWithProviders(<TestConsumer />);
  await findByText('logged-out');

  await fireEvent.press(getByText('login'));

  await findByText('logged-in:a@b.com');
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('atlas_token', 'tok123');
});

test('signOut clears stored session', async () => {
  (authApi.login as jest.Mock).mockResolvedValue({ id: '1', email: 'a@b.com', name: 'A', role: 'member', avatar_color: null, avatar_url: null, token: 'tok123' });
  (authApi.logout as jest.Mock).mockResolvedValue({ ok: true });

  const { findByText, getByText } = await renderWithProviders(<TestConsumer />);
  await findByText('logged-out');
  await fireEvent.press(getByText('login'));
  await findByText('logged-in:a@b.com');

  await fireEvent.press(getByText('logout'));

  await findByText('logged-out');
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('atlas_token');
});

test('a 401 from any request clears the session without calling logout API', async () => {
  (authApi.login as jest.Mock).mockResolvedValue({ id: '1', email: 'a@b.com', name: 'A', role: 'member', avatar_color: null, avatar_url: null, token: 'tok123' });

  const { findByText, getByText } = await renderWithProviders(<TestConsumer />);
  await findByText('logged-out');
  await fireEvent.press(getByText('login'));
  await findByText('logged-in:a@b.com');

  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'Not authenticated' }) }) as any;
  await expect(apiFetch('/projects')).rejects.toMatchObject({ status: 401 });

  await findByText('logged-out');
  expect(authApi.logout).not.toHaveBeenCalled();
});
