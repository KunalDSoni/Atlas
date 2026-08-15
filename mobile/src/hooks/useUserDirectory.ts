// Shared user directory for rendering mentions on mobile.
//
// A mention stores an id; the badge shows the person's current name, so a
// rename updates every mention ever written. One request serves the whole app:
// the promise is cached at module scope, so a screenful of comments shares a
// single fetch.
//
// Mirrors frontend/src/hooks/use-user-directory.ts.

import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client';

export interface DirectoryUser {
  id: string;
  name: string;
  email: string;
  avatar_color: string | null;
  is_active: number;
}

export interface MentionDirectory {
  byId: Map<string, DirectoryUser>;
  /** Lowercase full and first names to the ids answering to them. Active users
   *  only — a legacy mention of a deactivated account should not resolve. */
  nameIndex: Map<string, string[]>;
  /** False until the first fetch settles. */
  loaded: boolean;
}

const EMPTY: MentionDirectory = { byId: new Map(), nameIndex: new Map(), loaded: false };

let cached: Promise<MentionDirectory> | null = null;

function build(users: DirectoryUser[]): MentionDirectory {
  const byId = new Map<string, DirectoryUser>();
  const nameIndex = new Map<string, string[]>();

  for (const u of users) {
    byId.set(u.id, u);
    if (u.is_active === 0) continue;
    const full = u.name.toLowerCase();
    for (const key of [full, full.split(/\s+/)[0]]) {
      if (!key) continue;
      const ids = nameIndex.get(key) ?? [];
      if (!ids.includes(u.id)) ids.push(u.id);
      nameIndex.set(key, ids);
    }
  }
  return { byId, nameIndex, loaded: true };
}

/** Drop the cache so the next consumer refetches, after a rename or a
 *  deactivation. */
export function invalidateUserDirectory(): void {
  cached = null;
}

export function useUserDirectory(): MentionDirectory {
  const [directory, setDirectory] = useState<MentionDirectory>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    if (!cached) {
      cached = apiFetch<DirectoryUser[]>('/users')
        .then(build)
        // A failed lookup yields an empty directory rather than a thrown
        // render: mentions degrade to their stored names.
        .catch(() => ({ ...EMPTY, loaded: true }));
    }
    void cached.then((d) => { if (!cancelled) setDirectory(d); });
    return () => { cancelled = true; };
  }, []);

  return directory;
}
