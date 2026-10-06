/**
 * A tiny, deterministic stand-in for api.github.com and the github.com OAuth endpoints.
 *
 * Tests register handlers per GraphQL operation name or REST route, mutate state between
 * polls, and assert on the request log. Add reusable builders in ./fixtures.ts.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export const MOCK_PORT = 4010;
export const MOCK_ORIGIN = `http://127.0.0.1:${MOCK_PORT}`;

export interface LoggedRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  /** GraphQL operation name, when the request was a GraphQL query. */
  operationName?: string;
}

export interface MockResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export type GraphQLHandler = (
  variables: Record<string, unknown>,
  req: LoggedRequest,
) => MockResponse | Record<string, unknown> | Promise<MockResponse | Record<string, unknown>>;

export type RestHandler = (
  req: LoggedRequest,
  params: RegExpMatchArray,
) => MockResponse | Promise<MockResponse>;

interface RestRoute {
  method: string;
  pattern: RegExp;
  handler: RestHandler;
}

const isMockResponse = (v: unknown): v is MockResponse =>
  typeof v === 'object' && v !== null && ('status' in v || 'body' in v || 'headers' in v);

export class MockGitHub {
  private server: Server | undefined;
  private graphql = new Map<string, GraphQLHandler>();
  private routes: RestRoute[] = [];
  readonly requests: LoggedRequest[] = [];
  /** Default headers on every API response, e.g. rate-limit headers. */
  defaultHeaders: Record<string, string> = {};

  async start(port = MOCK_PORT): Promise<void> {
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((error: unknown) => {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: String(error) }));
      });
    });
    await new Promise<void>((done, fail) => {
      this.server?.once('error', fail);
      this.server?.listen(port, '127.0.0.1', () => done());
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((done) => (this.server ? this.server.close(() => done()) : done()));
    this.server = undefined;
  }

  /** Forget handlers and the request log. Called before every test. */
  reset(): void {
    this.graphql.clear();
    this.routes = [];
    this.requests.length = 0;
    this.defaultHeaders = {};
  }

  /** Respond to a GraphQL operation (matched on `operationName` or the `query Name` declaration). */
  onGraphQL(operationName: string, handler: GraphQLHandler): this {
    this.graphql.set(operationName, handler);
    return this;
  }

  /** Respond to a REST route. `path` may be a string (exact) or a RegExp matched on the path. */
  on(method: string, path: string | RegExp, handler: RestHandler): this {
    const pattern = typeof path === 'string' ? new RegExp(`^${escapeRegExp(path)}$`) : path;
    this.routes.unshift({ method: method.toUpperCase(), pattern, handler });
    return this;
  }

  requestsFor(operationOrPath: string): LoggedRequest[] {
    return this.requests.filter(
      (r) => r.operationName === operationOrPath || r.path === operationOrPath,
    );
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'access-control-expose-headers': '*',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    const url = new URL(req.url ?? '/', MOCK_ORIGIN);
    const raw = await readBody(req);
    const body = parseBody(raw, req.headers['content-type']);
    const logged: LoggedRequest = {
      method: req.method ?? 'GET',
      path: url.pathname + url.search,
      headers: req.headers,
      body,
    };

    let result: MockResponse;
    if (logged.method === 'POST' && url.pathname === '/graphql') {
      const {
        query = '',
        variables = {},
        operationName,
      } = (body ?? {}) as {
        query?: string;
        variables?: Record<string, unknown>;
        operationName?: string;
      };
      const name = operationName ?? /\b(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? '';
      logged.operationName = name;
      this.requests.push(logged);
      const handler = this.graphql.get(name);
      if (!handler) {
        result = { status: 200, body: { errors: [{ message: `No mock for operation ${name}` }] } };
      } else {
        const out = await handler(variables, logged);
        result = isMockResponse(out) ? out : { body: { data: out } };
      }
    } else {
      this.requests.push(logged);
      const route = this.routes.find(
        (r) => r.method === logged.method && r.pattern.test(url.pathname),
      );
      const match = route ? url.pathname.match(route.pattern) : null;
      result =
        route && match
          ? await route.handler(logged, match)
          : { status: 404, body: { message: `No mock for ${logged.method} ${url.pathname}` } };
    }

    res.writeHead(result.status ?? 200, {
      'content-type': 'application/json; charset=utf-8',
      ...cors,
      ...this.defaultHeaders,
      ...result.headers,
    });
    res.end(result.body === undefined ? '' : JSON.stringify(result.body));
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function parseBody(raw: string, contentType: string | undefined): unknown {
  if (!raw) return undefined;
  if (contentType?.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
