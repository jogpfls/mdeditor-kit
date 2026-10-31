import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('Esc then Tab moves focus out of the editor', async ({ page }) => {
  const editor = page.locator('#editor');
  await editor.click();
  await expect(editor).toBeFocused();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  await expect(editor).not.toBeFocused();
});

test('Tab without Esc indents a list item', async ({ page }) => {
  // Place caret inside a list item (first, convert a paragraph to a list)
  const firstPara = page.locator('[data-block-id]').first();
  await firstPara.click();
  await page.keyboard.press('End');
  // Type a list item via input rule
  await page.keyboard.press('Enter');
  await page.keyboard.type('- item');
  const state = page.locator('#state');
  await expect(state).toContainText('- item');
  // Pressing Tab without Esc should indent the list item (not move focus)
  await page.keyboard.press('Tab');
  await expect(page.locator('#editor')).toBeFocused();
  await expect(state).toContainText('    - item');
});
