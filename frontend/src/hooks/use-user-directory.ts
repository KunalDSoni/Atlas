// Shared user directory for rendering mentions.
//
// A mention stores an id; the badge shows the person's current name, so a
// rename updates every mention ever written. That needs an id-to-user lookup
// available wherever text renders — comment lists, descriptions, wiki pages.
//
// One request serves the whole app: the promise is cached at module scope, so
// twenty comments on a page share a single fetch. Atlas is a team tool, so the
// directory is small enough to hold whole.

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { User } from '@/lib/types';

export interface MentionDirectory {
  byId: Map<string, User>;
  /** Lowercase full and first names to the ids answering to them. Populated
   *  only for active users — a legacy mention of a deactivated account should
   *  not resolve. */
  nameIndex: Map<string, string[]>;
  /** False until the first fetch settles. Mentions render optimistically with
   *  their stored name meanwhile, so text does not flicker from badge to prose. */
  loaded: boolean;
}

/** SQLite hands back 0/1 while MySQL can hand back a boolean; the User type
 *  only promises a number. Normalise in one place. */
export function isInactive(user: { is_active?: number | boolean }): boolean {
  return user.is_active === 0 || user.is_active === false;
}

const EMPTY: MentionDirectory = { byId: new Map(), nameIndex: new Map(), loaded: false };

let cached: Promise<MentionDirectory> | null = null;

function build(users: User[]): MentionDirectory {
  const byId = new Map<string, User>();
  const nameIndex = new Map<string, string[]>();

  for (const u of users) {
    byId.set(u.id, u);
    if (isInactive(u)) continue;
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

/** Drop the cache so the next consumer refetches. Call after a rename or a
 *  deactivation, so badges stop showing a stale name. */
export function invalidateUserDirectory() {
  cached = null;
}

export function useUserDirectory(): MentionDirectory {
  const [directory, setDirectory] = useState<MentionDirectory>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    if (!cached) {
      // A failed lookup yields an empty directory rather than a thrown render:
      // mentions degrade to their stored names, and nothing else breaks.
      cached = api.users.list().then(build).catch(() => ({ ...EMPTY, loaded: true }));
    }
    void cached.then((d) => { if (!cancelled) setDirectory(d); });
    return () => { cancelled = true; };
  }, []);

  return directory;
}
