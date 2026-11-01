import { vi } from 'vitest';
import { jsonResponse } from '../../../tests/fixtures/http';
import { createGitHubClient, type FetchLike } from './client';

/** A client whose fetch answers with `answer`; `sent` holds every GraphQL request body. */
export function setup(answer: Response | object) {
  const sent: { query: string; variables: Record<string, unknown> }[] = [];
  const fetch = vi.fn<FetchLike>(async (_url, init) => {
    sent.push(JSON.parse(String(init.body)));
    return answer instanceof Response ? answer : jsonResponse({ data: answer });
  });
  const client = createGitHubClient({
    token: 'ghp_secret',
    apiUrl: 'https://api.github.com',
    fetch,
  });
  return { client, sent };
}
