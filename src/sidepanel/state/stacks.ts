/** Which GitHub stacks the user opened in the list; folded by default, until the panel closes. */
import { signal } from '@preact/signals';

export const openStacks = signal<readonly string[]>([]);

export function toggleStack(id: string): void {
  openStacks.value = openStacks.value.includes(id)
    ? openStacks.value.filter((open) => open !== id)
    : [...openStacks.value, id];
}
