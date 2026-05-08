/**
 * Local dev server. Adapts Node HTTP requests into APIGatewayProxyEventV2
 * shape so handlers run identically here and behind an HTTP API in AWS.
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { createItem, getItem, listItems } from './handlers/items.js';

type Handler = (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
}

const routes: Route[] = [
  { method: 'POST', pattern: /^\/api\/items\/?$/, paramNames: [], handler: createItem },
  { method: 'GET', pattern: /^\/api\/items\/?$/, paramNames: [], handler: listItems },
  { method: 'GET', pattern: /^\/api\/items\/([^/]+)\/?$/, paramNames: ['id'], handler: getItem },
];

const PORT = Number(process.env.PORT) || 3000;

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

const buildEvent = (
  req: IncomingMessage,
  body: string,
  rawPath: string,
  query: URLSearchParams,
  pathParameters: Record<string, string>,
): APIGatewayProxyEventV2 => {
  const queryStringParameters: Record<string, string> = {};
  for (const [k, v] of query.entries()) queryStringParameters[k] = v;

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers[k] = v;
    else if (Array.isArray(v)) headers[k] = v.join(',');
  }

  return {
    version: '2.0',
    routeKey: '$default',
    rawPath,
    rawQueryString: query.toString(),
    headers,
    queryStringParameters: Object.keys(queryStringParameters).length ? queryStringParameters : undefined,
    pathParameters: Object.keys(pathParameters).length ? pathParameters : undefined,
    requestContext: {
      accountId: 'local',
      apiId: 'local',
      domainName: 'localhost',
      domainPrefix: 'localhost',
      http: {
        method: req.method ?? 'GET',
        path: rawPath,
        protocol: 'HTTP/1.1',
        sourceIp: req.socket.remoteAddress ?? '127.0.0.1',
        userAgent: headers['user-agent'] ?? '',
      },
      requestId: `local-${Date.now()}`,
      routeKey: '$default',
      stage: '$default',
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    body: body.length ? body : undefined,
    isBase64Encoded: false,
  };
};

const writeResult = (res: ServerResponse, result: APIGatewayProxyResultV2) => {
  // APIGatewayProxyResultV2 can also be a raw string/object; we always return the structured form.
  if (typeof result !== 'object' || result === null || !('statusCode' in result)) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(typeof result === 'string' ? result : JSON.stringify(result));
    return;
  }
  res.writeHead(result.statusCode ?? 200, {
    'content-type': 'application/json',
    ...(result.headers as Record<string, string> | undefined),
  });
  res.end(result.body ?? '');
};

const setCors = (res: ServerResponse) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  console.log(`${req.method} ${url.pathname}${url.search}`);

  for (const route of routes) {
    if (route.method !== req.method) continue;
    const match = route.pattern.exec(url.pathname);
    if (!match) continue;

    const pathParameters: Record<string, string> = {};
    route.paramNames.forEach((name, i) => {
      pathParameters[name] = decodeURIComponent(match[i + 1]);
    });

    const body = await readBody(req);
    const event = buildEvent(req, body, url.pathname, url.searchParams, pathParameters);

    try {
      const result = await route.handler(event);
      writeResult(res, result);
    } catch (err) {
      console.error('handler threw:', err);
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal server error' }));
    }
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'route not found' }));
}

const server = createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error('server error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal server error' }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  for (const r of routes) console.log(`  ${r.method.padEnd(4)} ${r.pattern}`);
});
