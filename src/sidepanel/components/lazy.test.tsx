import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { lazy } from './lazy';

const Hello = ({ name }: { name: string }) => <p>Hello {name}</p>;

describe('lazy', () => {
  it('renders the fallback, then the loaded component', async () => {
    const Lazy = lazy(
      () => Promise.resolve(Hello),
      () => <p>Loading</p>,
    );
    render(<Lazy name="Ada" />);
    expect(screen.getByText('Loading')).toBeTruthy();
    expect(await screen.findByText('Hello Ada')).toBeTruthy();
  });

  it('offers to try again when the chunk fails to load, and loads it on retry', async () => {
    const load = vi
      .fn<() => Promise<typeof Hello>>()
      .mockRejectedValueOnce(new Error('chunk gone'))
      .mockResolvedValue(Hello);
    const Lazy = lazy(load);
    render(<Lazy name="Ada" />);
    expect((await screen.findByRole('alert')).textContent).toContain('Could not load');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Hello Ada')).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
