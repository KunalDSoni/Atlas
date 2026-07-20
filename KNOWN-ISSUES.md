# Known Issues

## RESOLVED — Radix popper menus rendered off-screen

**Symptom.** Every `DropdownMenu` opened (`data-state="open"`) but was positioned
outside the viewport, so clicking a trigger appeared to do nothing. The project
switcher was unusable and the account menu — with Settings inside it — was
unreachable.

**Measured before the fix** (Chromium, 1280x720, `/dashboard`):

| Menu | content height | rendered y | wrapper transform |
|---|---|---|---|
| Project switcher | 159px | -318 | `matrix(1, 0, 0, 1, 0, -318)` |
| Account menu | 337px | -674 | `matrix(1, 0, 0, 1, 0, -674)` |

Always **exactly -2x the menu's own height** — which is the tell. Radix's popper
renders unpositioned content at `translate3d(0, -200%, 0)` until floating-ui
reports `isPositioned`. The menus were never positioned at all; they sat in the
placeholder transform forever.

**Root cause.** `components/ui/button.tsx` shipped in shadcn's React 19 style —
a plain function component, no `forwardRef` — because React 19 accepts `ref` as
an ordinary prop. This project runs **React 18.3.1**, where a plain function
component cannot receive a ref: it silently arrives as `null`.

Every popper trigger uses `asChild` and forwards its anchor ref to `Button`
(`<DropdownMenuTrigger asChild><Button/></DropdownMenuTrigger>`). With the ref
dropped, floating-ui had no reference element to measure, `isPositioned` stayed
`false`, and the placeholder transform was never replaced.

**Fix.** `Button` is wrapped in `React.forwardRef` and passes `ref` to its
underlying element. One change; every popper in the app positions correctly.

**Regression cover.** `e2e/project-switcher.spec.ts` and `e2e/account-menu.spec.ts`
assert menus lie fully **inside the viewport** rather than merely existing in the
DOM — the distinction that made this bug invisible to the previous tests.

**If you add UI primitives:** anything used as an `asChild` trigger must forward
its ref while this project stays on React 18. `input.tsx` and `textarea.tsx`
have the same missing-`forwardRef` shape; they are not popper anchors today, so
they are not currently broken, but they will bite the moment one is used with
`asChild` or given a ref.
