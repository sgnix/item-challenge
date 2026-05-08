import { describe, expect, it } from 'vitest';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { createItem, getItem, listItems } from '../handlers/items.js';
import type { CreateItemInput } from '../handlers/schemas.js';

const event = (overrides: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 => ({
  version: '2.0',
  routeKey: '$default',
  rawPath: '/',
  rawQueryString: '',
  headers: {},
  requestContext: {
    accountId: 'test',
    apiId: 'test',
    domainName: 'test',
    domainPrefix: 'test',
    http: { method: 'GET', path: '/', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'vitest' },
    requestId: 'test',
    routeKey: '$default',
    stage: '$default',
    time: new Date().toISOString(),
    timeEpoch: Date.now(),
  },
  isBase64Encoded: false,
  ...overrides,
});

const validBody: CreateItemInput = {
  subject: 'AP Biology',
  itemType: 'multiple-choice',
  difficulty: 3,
  content: {
    question: 'What is photosynthesis?',
    options: ['A', 'B', 'C', 'D'],
    correctAnswer: 'A',
    explanation: 'Plants convert sunlight to energy.',
  },
  metadata: { author: 'tester', status: 'draft', tags: ['biology'] },
  securityLevel: 'standard',
};

const parse = (r: Awaited<ReturnType<typeof createItem>>) => {
  const struct = r as APIGatewayProxyStructuredResultV2;
  return JSON.parse(struct.body ?? '{}');
};

describe('createItem', () => {
  it('returns 201 with the created item', async () => {
    const res = (await createItem(event({ body: JSON.stringify(validBody) }))) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(201);
    const body = parse(res);
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.subject).toBe('AP Biology');
    expect(body.metadata.version).toBe(1);
    expect(body.metadata.created).toBeTypeOf('number');
  });

  it('returns 400 when body is not valid JSON', async () => {
    const res = (await createItem(event({ body: '{not json' }))) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(400);
    expect(parse(res).error).toMatch(/json/i);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = (await createItem(event({ body: JSON.stringify({ subject: 'AP Biology' }) }))) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(400);
    expect(parse(res).issues.length).toBeGreaterThan(0);
  });

  it('rejects multiple-choice items without options', async () => {
    const { options: _omit, ...content } = validBody.content;
    const res = (await createItem(event({ body: JSON.stringify({ ...validBody, content }) }))) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(400);
  });
});

describe('getItem', () => {
  it('returns 404 when the id is unknown', async () => {
    const res = (await getItem(event({ pathParameters: { id: 'does-not-exist' } }))) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(404);
  });

  it('returns 200 with the item after creation', async () => {
    const created = parse((await createItem(event({ body: JSON.stringify(validBody) }))) as APIGatewayProxyStructuredResultV2);
    const res = (await getItem(event({ pathParameters: { id: created.id } }))) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(200);
    expect(parse(res).id).toBe(created.id);
  });

  it('returns 400 when id is missing from path parameters', async () => {
    const res = (await getItem(event({}))) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(400);
  });
});

describe('listItems', () => {
  it('filters by subject and respects pagination', async () => {
    // Use a unique subject to keep this test isolated from others.
    const subject = `subject-${Math.random().toString(36).slice(2)}`;
    const seed = { ...validBody, subject };
    for (let i = 0; i < 3; i++) {
      await createItem(event({ body: JSON.stringify(seed) }));
    }

    const res = (await listItems(
      event({ queryStringParameters: { subject, limit: '2', offset: '0' } }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(200);

    const body = parse(res);
    expect(body.total).toBe(3);
    expect(body.items).toHaveLength(2);
    expect(body.items.every((it: { subject: string }) => it.subject === subject)).toBe(true);
    expect(body.limit).toBe(2);
    expect(body.offset).toBe(0);
  });

  it('returns 400 for an out-of-range limit', async () => {
    const res = (await listItems(
      event({ queryStringParameters: { limit: '999' } }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(400);
  });
});
