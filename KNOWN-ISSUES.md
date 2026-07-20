# Known Issues

## Radix popper menus render off-screen (open, unfixed)

**Symptom.** Every `DropdownMenu` in the app opens (`data-state="open"`) but is
positioned outside the viewport, so nothing appears when you click the trigger.

**Measured** (Chromium, 1280x720 viewport, `/dashboard`):

| Menu | content height | rendered y | wrapper transform |
|---|---|---|---|
| Project switcher | 159px | -318 | `matrix(1, 0, 0, 1, 0, -318)` |
| Account menu (pre-fix) | 337px | -674 | `matrix(1, 0, 0, 1, 0, -674)` |

The offset is consistently **exactly -2x the menu's own height**, which points at
the popper's position calculation rather than at CSS: the content element itself
has `transform: none` and `position: static`, and the bad translation is on the
Radix-generated wrapper. `animationName` is `none` at measurement time, so this
is not an unfinished enter animation.

**Impact.** Any menu built on `components/ui/dropdown-menu.tsx` is unreachable —
including the wiki page's "More actions" menu. The account menu was affected
until it was rewritten (below).

**Worked around, not fixed.** `UserMenu` in `components/app/app-shell.tsx` no
longer uses Radix; it is a plain absolutely-positioned panel anchored to the
header, with click-outside and Escape handling. `e2e/account-menu.spec.ts`
asserts it lies fully within the viewport, so a regression to off-screen
positioning fails the suite rather than shipping silently.

**Not yet investigated:** whether this is a version mismatch in the unified
`radix-ui` package's popper, a Tailwind v4 interaction with the
`--radix-*-content-transform-origin` / `-available-height` custom properties, or
an ancestor style breaking fixed-position measurement. Other dropdowns still
need the real fix.
