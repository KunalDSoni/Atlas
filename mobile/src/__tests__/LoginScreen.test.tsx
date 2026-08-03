import React from 'react';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react-native';
import { LoginScreen } from '../screens/LoginScreen';
import { useAuth } from '../auth/AuthContext';

jest.mock('../auth/AuthContext');

afterEach(async () => {
  await cleanup();
  jest.clearAllMocks();
});

test('submits email and password to signIn', async () => {
  const signIn = jest.fn().mockResolvedValue(undefined);
  (useAuth as jest.Mock).mockReturnValue({ signIn, user: null, isLoading: false, signOut: jest.fn() });

  const { getByPlaceholderText, getByText } = await render(<LoginScreen />);
  await fireEvent.changeText(getByPlaceholderText('Email'), 'a@b.com');
  await fireEvent.changeText(getByPlaceholderText('Password'), 'secret');
  await fireEvent.press(getByText('Log In'));

  await waitFor(() => expect(signIn).toHaveBeenCalledWith('a@b.com', 'secret'));
});

test('shows an error message when signIn rejects', async () => {
  const signIn = jest.fn().mockRejectedValue(new Error('Invalid credentials'));
  (useAuth as jest.Mock).mockReturnValue({ signIn, user: null, isLoading: false, signOut: jest.fn() });

  const { getByPlaceholderText, getByText, findByText } = await render(<LoginScreen />);
  await fireEvent.changeText(getByPlaceholderText('Email'), 'a@b.com');
  await fireEvent.changeText(getByPlaceholderText('Password'), 'wrong');
  await fireEvent.press(getByText('Log In'));

  await findByText('Invalid credentials');
});
