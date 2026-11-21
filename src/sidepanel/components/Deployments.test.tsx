import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { Deployments } from './Deployments';

describe('Deployments', () => {
  it('names each environment and its state, and shows outside URLs as text only', () => {
    render(
      <Deployments
        id="d"
        deployments={[
          { environment: 'preview', state: 'passed', url: 'https://pr-1.example.dev' },
          {
            environment: 'docs',
            state: 'failed',
            url: 'https://github.com/acme/widgets/deployments',
          },
          { environment: 'staging', state: 'pending', url: null },
        ]}
      />,
    );
    const list = screen.getByRole('list', { name: 'Deployments' });
    expect(list.textContent).toContain('previewDeployed');
    expect(list.textContent).toContain('stagingDeploying');
    expect(screen.getByText('https://pr-1.example.dev').tagName).toBe('SPAN');
    expect(screen.getByRole('link', { name: 'github.com' })).toBeTruthy();
  });
});
