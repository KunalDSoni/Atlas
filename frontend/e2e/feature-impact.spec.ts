import { test, expect, type Page } from '@playwright/test';
import { login, assertNoCrash } from './helpers';

/** The session token the SPA stores after login, in the header shape the API wants. */
async function authHeaders(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('atlas_token'));
  expect(token, 'expected a session token after login').toBeTruthy();
  return { 'x-auth-token': token as string, 'Content-Type': 'application/json' };
}

const dateNDaysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
};

/** A launched feature we own outright, so no other spec's data can shift under us. */
async function createLaunchedFeature(page: Page, name: string) {
  const headers = await authHeaders(page);
  const projects = await (await page.request.get('/api/projects', { headers })).json();
  const created = await (await page.request.post('/api/product/features', {
    headers,
    data: { name, description: 'impact spec fixture', project_id: projects[0].id, status: 'launched' },
  })).json();

  const updated = await page.request.put(`/api/product/features/${created.id}`, {
    headers,
    data: { impact_status: 'measuring' },
  });
  expect(updated.status(), 'impact_status must be settable via the feature update route').toBe(200);
  expect((await updated.json()).impact_status).toBe('measuring');

  return { headers, featureId: created.id as string, name };
}

test.describe('Feature Impact Measurement — API contract', () => {
  test('records a metric, snapshots the forecast, and rolls up to the feature', async ({ page }) => {
    await login(page);
    const { headers, featureId } = await createLaunchedFeature(page, `Impact rollup ${Date.now()}`);

    const forecast = await page.request.put(`/api/product-features/${featureId}/forecast-metrics`, {
      headers,
      data: { forecastAdoption: 100, forecastRevenue: 50000 },
    });
    expect(forecast.status()).toBe(200);
    expect((await forecast.json()).data.forecast_adoption).toBe(100);

    const recorded = await page.request.post(`/api/product-features/${featureId}/impact-metrics`, {
      headers,
      data: { metricType: 'adoption', actualValue: 120, unit: 'percentage' },
    });
    expect(recorded.status()).toBe(200);
    const metric = (await recorded.json()).data;
    // The forecast in force at record time is stored on the row, not looked up later.
    expect(metric.forecast_value).toBe(100);
    expect(metric.actual_value).toBe(120);
    expect(metric.editable).toBe(true);

    const read = await (await page.request.get(`/api/product-features/${featureId}/impact-metrics`, { headers })).json();
    // (120 - 100) / 100 * 100 = 20
    expect(read.data.metrics.adoption[0].variance).toBeCloseTo(20, 5);
    // The measurement must reach the feature row, or the dashboard can never see it.
    expect(read.data.actual_adoption).toBe(120);

    const dash = await (await page.request.get('/api/product-features/impact-dashboard', { headers })).json();
    expect(dash.data.features.some((f: { id: string }) => f.id === featureId)).toBe(true);
    expect(typeof dash.data.avg_adoption_variance).toBe('number');
  });

  test('rejects negative values and accepts zero', async ({ page }) => {
    await login(page);
    const { headers, featureId } = await createLaunchedFeature(page, `Impact bounds ${Date.now()}`);

    const negative = await page.request.post(`/api/product-features/${featureId}/impact-metrics`, {
      headers,
      data: { metricType: 'adoption', actualValue: -5 },
    });
    expect(negative.status()).toBe(400);

    const zero = await page.request.post(`/api/product-features/${featureId}/impact-metrics`, {
      headers,
      data: { metricType: 'adoption', actualValue: 0 },
    });
    expect(zero.status()).toBe(200);
    expect((await zero.json()).data.actual_value).toBe(0);
  });

  test('rejects a future measurement_date', async ({ page }) => {
    await login(page);
    const { headers, featureId } = await createLaunchedFeature(page, `Impact future ${Date.now()}`);

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const res = await page.request.post(`/api/product-features/${featureId}/impact-metrics`, {
      headers,
      data: {
        metricType: 'adoption',
        actualValue: 10,
        measurementDate: tomorrow.toISOString().split('T')[0],
      },
    });
    expect(res.status()).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/future/i);
  });

  test('accepts measurements >30 days old but marks them read-only', async ({ page }) => {
    await login(page);
    const { headers, featureId } = await createLaunchedFeature(page, `Impact audit ${Date.now()}`);

    // The rule is "becomes read-only", not "cannot be recorded" — backfilling a
    // launch month once analytics settle has to keep working.
    const old = await page.request.post(`/api/product-features/${featureId}/impact-metrics`, {
      headers,
      data: { metricType: 'adoption', actualValue: 15, measurementDate: dateNDaysAgo(31) },
    });
    expect(old.status()).toBe(200);
    expect((await old.json()).data.editable).toBe(false);

    const recent = await page.request.post(`/api/product-features/${featureId}/impact-metrics`, {
      headers,
      data: { metricType: 'adoption', actualValue: 20, measurementDate: dateNDaysAgo(29) },
    });
    expect(recent.status()).toBe(200);
    expect((await recent.json()).data.editable).toBe(true);
  });

  test('rejects an invalid impact_status', async ({ page }) => {
    await login(page);
    const { headers, featureId } = await createLaunchedFeature(page, `Impact enum ${Date.now()}`);

    const bad = await page.request.put(`/api/product/features/${featureId}`, {
      headers,
      data: { impact_status: 'totally_made_up' },
    });
    expect(bad.status()).toBe(400);

    for (const status of ['not_launched', 'launched', 'measuring', 'analyzed']) {
      const ok = await page.request.put(`/api/product/features/${featureId}`, {
        headers,
        data: { impact_status: status },
      });
      expect(ok.status(), `${status} should be accepted`).toBe(200);
    }
  });

  test('requires authentication', async ({ page }) => {
    await login(page);
    const { featureId } = await createLaunchedFeature(page, `Impact auth ${Date.now()}`);

    const res = await page.request.get(`/api/product-features/${featureId}/impact-metrics`, {
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(401);
  });
});

test.describe('Feature Impact Measurement — UI', () => {
  test('PM sets a forecast and records an actual through the detail sheet', async ({ page }) => {
    await login(page);
    const { featureId } = await createLaunchedFeature(page, `Impact UI ${Date.now()}`);

    await page.goto(`/product/features?feature=${featureId}`);
    await expect(page.getByRole('heading', { name: 'Features' })).toBeVisible({ timeout: 15_000 });

    // Open the sheet from the row rather than trusting a deep-link param.
    const row = page.locator('table tbody tr').filter({ hasText: 'Impact UI' }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();

    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 10_000 });
    await expect(sheet.getByText('Impact Measurement')).toBeVisible();
    await assertNoCrash(page);

    // Forecast
    await sheet.getByRole('button', { name: 'Edit' }).first().click();
    await sheet.getByLabel('Expected Adoption %').fill('45');
    await sheet.getByLabel('Expected Revenue ($)').fill('50000');
    await sheet.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(sheet.getByText('45%')).toBeVisible({ timeout: 10_000 });

    // Actual — this is the call that silently 401'd when the components used
    // raw fetch(), so the success toast is the real assertion here.
    await sheet.getByLabel('Actual Value').fill('38');
    await sheet.getByRole('button', { name: 'Record Metric' }).click();
    await expect(page.getByText(/Metric recorded/i)).toBeVisible({ timeout: 10_000 });

    await assertNoCrash(page);

    // And it actually landed server-side.
    const headers = await authHeaders(page);
    const read = await (await page.request.get(`/api/product-features/${featureId}/impact-metrics`, { headers })).json();
    expect(read.data.actual_adoption).toBe(38);
  });

  test('date field caps at today and warns before freezing an old measurement', async ({ page }) => {
    await login(page);
    await createLaunchedFeature(page, `Impact date ${Date.now()}`);

    await page.goto('/product/features');
    await expect(page.getByRole('heading', { name: 'Features' })).toBeVisible({ timeout: 15_000 });
    await page.locator('table tbody tr').filter({ hasText: 'Impact date' }).first().click();

    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 10_000 });

    const dateInput = sheet.getByLabel('Measurement Date');
    await expect(dateInput).toHaveAttribute('max', new Date().toISOString().split('T')[0]);

    // No warning for a fresh date.
    await expect(sheet.getByText(/read-only/i)).toHaveCount(0);

    // Past the window: warning appears and submit is gated on acknowledgement.
    await dateInput.fill(dateNDaysAgo(31));
    await expect(sheet.getByText(/read-only/i).first()).toBeVisible();

    await sheet.getByLabel('Actual Value').fill('12');
    const record = sheet.getByRole('button', { name: 'Record Metric' });
    await expect(record).toBeDisabled();

    await sheet.getByLabel(/I acknowledge/i).check();
    await expect(record).toBeEnabled();

    // Acknowledging must actually let it through — the backend used to 400 here.
    await record.click();
    await expect(page.getByText(/read-only audit trail/i)).toBeVisible({ timeout: 10_000 });
    await assertNoCrash(page);
  });

  test('impact dashboard renders forecast vs actual', async ({ page }) => {
    await login(page);
    const { headers, featureId } = await createLaunchedFeature(page, `Impact dash ${Date.now()}`);

    await page.request.put(`/api/product-features/${featureId}/forecast-metrics`, {
      headers,
      data: { forecastAdoption: 80 },
    });
    await page.request.post(`/api/product-features/${featureId}/impact-metrics`, {
      headers,
      data: { metricType: 'adoption', actualValue: 60, unit: 'percentage' },
    });

    await page.goto('/product/impact');
    await expect(page.getByText('Features Analyzed')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Avg Adoption Variance')).toBeVisible();

    // Empty dashboard would render 0 / N/A; this proves the rollup reached it.
    await expect(page.getByText('N/A')).toHaveCount(0);
    await expect(page.getByText('Adoption: Forecast vs Actual')).toBeVisible();
    await assertNoCrash(page);
  });
});
