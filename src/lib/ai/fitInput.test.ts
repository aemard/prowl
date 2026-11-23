import { describe, expect, it, vi } from 'vitest';
import { fitInput } from './fitInput';

const input = (lead: string, ...items: string[]) => ({ lead, items });

describe('fitInput', () => {
  /** A model that counts one token per character, `quota` of them, `used` taken already. */
  const model = (inputQuota: number, inputUsage = 0) => ({
    inputQuota,
    inputUsage,
    measureInputUsage: vi.fn(async (text: string) => text.length),
  });

  it('sends everything that fits, framed', async () => {
    expect(await fitInput(model(100), input('Title', 'a', 'b'), (t) => `---\n${t}`)).toBe(
      '---\nTitle\n\na\n\nb',
    );
  });

  it('drops the oldest items first, so the latest discussion stays', async () => {
    const items = ['old '.repeat(10), 'mid '.repeat(10), 'new '.repeat(10)];
    const fitted = await fitInput(model(100), input('Title', ...items));
    expect(fitted).toBe(['Title', items[1], items[2]].join('\n\n'));
  });

  it("counts what the model's system prompt already took", async () => {
    expect(await fitInput(model(20, 12), input('Title', 'first', 'second'))).toBe('Title');
  });

  it('measures by characters where Chrome cannot measure', async () => {
    const fitted = await fitInput({}, input('Title', 'x'.repeat(11_800), 'y'.repeat(500)));
    expect(fitted).toBe(`Title\n\n${'y'.repeat(500)}`);
  });

  it('cuts a lead too long on its own, and gives up as Chrome would when even that fails', async () => {
    const fitted = await fitInput(model(50), input('z'.repeat(200), 'item'));
    expect(fitted.length).toBeLessThanOrEqual(50);
    expect(fitted.endsWith('…')).toBe(true);
    const stubborn = { inputQuota: 10, measureInputUsage: async () => 1000 };
    await expect(fitInput(stubborn, input('Title'))).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
  });
});
