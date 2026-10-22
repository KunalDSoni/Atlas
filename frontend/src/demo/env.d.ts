/** True only in `vite build --mode demo`. Replaced at build time, so `if (__ATLAS_DEMO__)` branches vanish from the normal bundle. */
declare const __ATLAS_DEMO__: boolean;
/** True only in `vite build --mode site`, the website-only build with no app to sign in to. */
declare const __ATLAS_SITE__: boolean;

declare module '*/fixtures.json' {
  const fixtures: Record<string, unknown>;
  export default fixtures;
}
