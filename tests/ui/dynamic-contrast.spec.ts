import { test, expect } from '@playwright/test';

const FIXTURE_URL = '/tests/fixtures/product-smoke.html';

test.describe('dynamic contrast smoke', () => {
  test('sets light contrast over dark media and switches on media change', async ({ page }) => {
    await page.goto(FIXTURE_URL);

    const wrapper = page.locator('#details');
    await expect(wrapper).toHaveAttribute('data-contrast', 'light');

    await page.evaluate(() => {
      const image = document.querySelector<HTMLImageElement>('#bg-image');
      if (!image) throw new Error('missing image');
      image.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1200' height='800'%3E%3Crect width='100%25' height='100%25' fill='white'/%3E%3C/svg%3E";
      document.dispatchEvent(new Event('media-gallery:change'));
    });

    await expect(wrapper).toHaveAttribute('data-contrast', 'dark');
  });

  test('does not force button text color', async ({ page }) => {
    await page.goto(FIXTURE_URL);

    const buttonColor = await page.locator('#cta').evaluate((el) => getComputedStyle(el).color);
    expect(buttonColor).toBe('rgb(51, 51, 51)');
  });
});
