import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

// The stopwatch shipped with no browser coverage at all, and spent its whole
// life behind the Log work dialog where nobody found it — the feature was
// deployed and unreachable at the same time, which no jest suite could tell us.
// These drive it from the field rail, so a regression that buries it again
// fails here rather than in someone's screenshot.

const startBtn = (page: Page) => page.getByRole('button', { name: 'Start timer' });
const pauseBtn = (page: Page) => page.getByRole('button', { name: 'Pause timer' });

/**
 * Open the first board issue and return its key.
 *
 * Keyed on data-issue-key rather than a title: edit-issue.spec renames the
 * seeded OAuth2 story to a timestamp, so any spec that opens issues by title
 * passes alone and fails in a full run, depending on order.
 */
async function openFirstIssue(page: Page): Promise<string> {
  await page.goto('/atlas/board');
  const card = page.locator('[data-issue-key]').first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  const key = await card.getAttribute('data-issue-key');
  await card.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  return key!;
}

/**
 * Put the stopwatch back in the stopped state before a test relies on it.
 *
 * Running state is the server's, not the page's, so a test that fails midway
 * leaves it running for whatever runs next, which then finds Pause where it
 * expected Start. This is deliberately NOT folded into openFirstIssue: the
 * reload test reopens the issue specifically to see a running timer, and a
 * reset hidden inside "open" would pause the thing under test.
 */
async function resetTimer(page: Page) {
  // Wait for whichever side of the toggle rendered, so the check below is a
  // decision about loaded state rather than a race against the fetch.
  await expect(startBtn(page).or(pauseBtn(page))).toBeVisible({ timeout: 15_000 });
  if (await pauseBtn(page).isVisible()) {
    await pauseBtn(page).click();
    await expect(startBtn(page)).toBeVisible({ timeout: 10_000 });
  }
}

test('the timer is reachable from the field rail without opening a dialog', async ({ page }) => {
  await login(page);
  await openFirstIssue(page);

  // The assertion that would have caught the bug: a timer control on the sheet
  // itself, with no Log work click in between. Either label satisfies it —
  // what is being checked is reachability, not which way the toggle sits.
  await expect(startBtn(page).or(pauseBtn(page))).toBeVisible({ timeout: 15_000 });
});

test('starting the timer switches the control to Pause and shows elapsed time', async ({ page }) => {
  await login(page);
  await openFirstIssue(page);
  await resetTimer(page);

  await startBtn(page).click();

  // Start and Pause are the same button re-labelled, so waiting on Pause proves
  // the server round-trip landed and the state came back running.
  await expect(pauseBtn(page)).toBeVisible({ timeout: 10_000 });

  // A running timer reports elapsed time from the first render. Under a minute
  // that is "0m", not the em-dash formatDuration gives every other zero — the
  // readout has to look live the moment you start it.
  await expect(page.getByLabel('Time logged by timer')).toHaveText(/^\d+[hm]/);

  await pauseBtn(page).click();
  await expect(startBtn(page)).toBeVisible({ timeout: 10_000 });
});

test('a running timer is still running after a cold page load', async ({ page }) => {
  await login(page);
  const key = await openFirstIssue(page);
  await resetTimer(page);

  await startBtn(page).click();
  await expect(pauseBtn(page)).toBeVisible({ timeout: 10_000 });

  // Running state is the server's, not the component's. Loading the issue URL
  // cold renders the full page rather than the drawer, so this also covers the
  // path where the timer mounts without the board behind it. Note the absence
  // of resetTimer after the reload — that is the whole point of the test.
  await page.goto(`/atlas/${key}`);
  await expect(pauseBtn(page)).toBeVisible({ timeout: 15_000 });

  await pauseBtn(page).click();
  await expect(startBtn(page)).toBeVisible({ timeout: 10_000 });
});

test('a running timer follows you out of the issue and back into it', async ({ page }) => {
  // The whole reason people lost track of timers: start one, navigate away, and
  // nothing anywhere said it was still running. GET /api/me/timer existed for
  // this from the beginning and had no caller until the header chip.
  await login(page);
  const key = await openFirstIssue(page);
  await resetTimer(page);

  await startBtn(page).click();
  await expect(pauseBtn(page)).toBeVisible({ timeout: 10_000 });

  const chip = page.getByRole('link', { name: new RegExp(`Timer running on ${key}`, 'i') });
  // Visible from a screen that is not the issue, which is the point.
  await page.goto('/atlas/board');
  await expect(chip).toBeVisible({ timeout: 15_000 });
  await expect(chip).toContainText(key);
  // No stop control while the timer is healthy — an accidental click here would
  // recreate the "my timer stopped by itself" report this feature exists to end.
  await expect(page.getByRole('button', { name: /Pause timer on/i })).toBeHidden();

  await chip.click();
  await expect(page).toHaveURL(new RegExp(`/${key}$`, 'i'));
  await expect(pauseBtn(page)).toBeVisible({ timeout: 15_000 });

  // Pausing on the issue clears the chip at once rather than a poll later.
  await pauseBtn(page).click();
  await expect(startBtn(page)).toBeVisible({ timeout: 10_000 });
  await expect(chip).toBeHidden({ timeout: 10_000 });
});
