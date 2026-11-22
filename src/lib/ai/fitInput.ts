/**
 * Fitting a text to an on-device model's input: measured by the model where Chrome can, by
 * characters otherwise, dropping the oldest items first. Pure apart from the model's own measure.
 */

/** How much of the model's input a text takes, where Chrome tells (in tokens). */
export interface Measurable {
  inputQuota?: number;
  /** Already taken (the Prompt API's system prompt). */
  inputUsage?: number;
  measureInputUsage?(text: string): Promise<number>;
}
/** What the model reads: `lead` always, then as many of `items` (oldest first) as fit. */
export interface AiInput {
  lead: string;
  items: string[];
}

/** Where Chrome cannot measure tokens: about 3 000 English tokens, what Gemini Nano reads. */
const MAX_CHARS = 12_000;

/** An input that does not fit the model even cut down, as Chrome itself reports it. */
const tooLong = () => new DOMException('The input is too long.', 'QuotaExceededError');

/**
 * `input` as one text that fits `session`'s input quota, measured by the model itself
 * (`measureInputUsage`, `inputQuota`, less what its system prompt took) where Chrome has them,
 * else by characters: the oldest items go first, so the latest discussion stays; a lead too long
 * on its own is cut. `frame` wraps the text as it is sent. Throws a `QuotaExceededError` when
 * nothing fits.
 */
export async function fitInput(
  session: Measurable,
  input: AiInput,
  frame: (text: string) => string = (text) => text,
): Promise<string> {
  const measured = session.measureInputUsage && session.inputQuota !== undefined;
  const quota = measured ? (session.inputQuota ?? 0) - (session.inputUsage ?? 0) : MAX_CHARS;
  const size = async (text: string) =>
    measured ? ((await session.measureInputUsage?.(frame(text))) ?? Infinity) : text.length;
  const text = (dropped: number, lead = input.lead) =>
    [lead, ...input.items.slice(dropped)].filter(Boolean).join('\n\n');
  // The fewest oldest items to drop, by bisection: a handful of measurements for 25 items.
  let [low, high] = [0, input.items.length];
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((await size(text(middle))) <= quota) high = middle;
    else low = middle + 1;
  }
  const best = text(low);
  const used = await size(best);
  if (used <= quota) return frame(best);
  // ponytail: one proportional cut of the lead, with a margin; a second miss gives up.
  const cut = `${input.lead.slice(0, Math.floor((input.lead.length * quota * 0.9) / used))}…`;
  if ((await size(cut)) <= quota) return frame(cut);
  throw tooLong();
}
