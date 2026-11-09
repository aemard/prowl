import { readFileSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

/** Wait for assets and capture settled pixels; keep identical PNGs and their mtimes intact. */
export async function saveCapture(
  page: Page,
  path?: string,
  options: { fullPage?: boolean } = {},
): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images, (image) => image.decode().catch(() => {})));
  });
  const png = await page.screenshot({ ...options, animations: 'disabled', caret: 'hide' });
  if (path) {
    let existing: Buffer | undefined;
    try {
      existing = readFileSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (!existing?.equals(png)) writeFileSync(path, png);
  }
}
