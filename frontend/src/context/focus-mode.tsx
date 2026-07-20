// Focus mode: lets a screen collapse the app chrome so its content gets the
// full window. The wiki page uses it for editing, where a 240px nav sidebar
// plus a 236px page tree left the writing column cramped.
//
// State lives here rather than in AppShell so a screen deep in the tree can
// drive it without prop-drilling through the router.

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

interface FocusModeValue {
  focused: boolean;
  setFocused: (on: boolean) => void;
  toggle: () => void;
}

const FocusModeContext = createContext<FocusModeValue>({
  focused: false,
  setFocused: () => {},
  toggle: () => {},
});

export function FocusModeProvider({ children }: { children: React.ReactNode }) {
  const [focused, setFocusedState] = useState(false);

  const setFocused = useCallback((on: boolean) => setFocusedState(on), []);
  const toggle = useCallback(() => setFocusedState((f) => !f), []);

  const value = useMemo(() => ({ focused, setFocused, toggle }), [focused, setFocused, toggle]);
  return <FocusModeContext.Provider value={value}>{children}</FocusModeContext.Provider>;
}

export function useFocusMode(): FocusModeValue {
  return useContext(FocusModeContext);
}
