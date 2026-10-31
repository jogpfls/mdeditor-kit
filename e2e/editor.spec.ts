import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('fixture loads and renders blocks', async ({ page }) => {
  const blocks = page.locator('[data-block-id]');
  await expect(blocks).toHaveCount(3);
});

test('typing inserts text', async ({ page }) => {
  const editor = page.locator('#editor');
  await editor.click();
  // Place caret in first paragraph
  const firstPara = page.locator('[data-block-id]').first();
  await firstPara.click();
  await page.keyboard.type('X');
  const state = page.locator('#state');
  await expect(state).toContainText('X');
});

test('Enter splits a block', async ({ page }) => {
  const firstPara = page.locator('[data-block-id]').first();
  await firstPara.click();
  const before = await page.locator('[data-block-id]').count();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  const after = await page.locator('[data-block-id]').count();
  expect(after).toBeGreaterThan(before);
});

test('Backspace deletes a character', async ({ page }) => {
  const firstPara = page.locator('[data-block-id]').first();
  await firstPara.click();
  const state = page.locator('#state');
  const before = (await state.textContent()) ?? '';
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  const after = (await state.textContent()) ?? '';
  expect(after.length).toBeLessThan(before.length);
});

test('Mod+B toggles bold', async ({ page }) => {
  const firstPara = page.locator('[data-block-id]').first();
  await firstPara.click();
  // Select "Hello"
  await page.keyboard.press('Home');
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  await page.keyboard.press('ControlOrMeta+b');
  const state = page.locator('#state');
  await expect(state).toContainText('**Hello**');
});

test('Mod+Z undoes the last change', async ({ page }) => {
  const firstPara = page.locator('[data-block-id]').first();
  await firstPara.click();
  await page.keyboard.press('End');
  await page.keyboard.type('X');
  const state = page.locator('#state');
  await expect(state).toContainText('X');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(state).not.toContainText('Xello');
});
