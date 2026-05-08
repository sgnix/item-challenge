import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ZodError } from 'zod';
import { createStorage } from '../storage/index.js';
import { createItemSchema, listQuerySchema } from './schemas.js';

const storage = createStorage();

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const badRequest = (err: ZodError) =>
  json(400, { error: 'invalid request', issues: err.issues });

const internalError = (err: unknown, op: string) => {
  console.error(`[${op}]`, err);
  return json(500, { error: 'internal server error' });
};

const parseBody = (event: APIGatewayProxyEventV2): unknown => {
  if (!event.body) return undefined;
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  return JSON.parse(raw);
};

export const createItem = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  let parsed: unknown;
  try {
    parsed = parseBody(event);
  } catch {
    return json(400, { error: 'body is not valid JSON' });
  }

  const result = createItemSchema.safeParse(parsed);
  if (!result.success) return badRequest(result.error);

  try {
    const item = await storage.createItem(result.data);
    return json(201, item);
  } catch (err) {
    return internalError(err, 'createItem');
  }
};

export const getItem = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const id = event.pathParameters?.id;
  if (!id) return json(400, { error: 'missing path parameter: id' });

  try {
    const item = await storage.getItem(id);
    if (!item) return json(404, { error: 'item not found' });
    return json(200, item);
  } catch (err) {
    return internalError(err, 'getItem');
  }
};

export const listItems = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const result = listQuerySchema.safeParse(event.queryStringParameters ?? {});
  if (!result.success) return badRequest(result.error);

  try {
    const { items, total } = await storage.listItems(result.data);
    return json(200, { items, total, limit: result.data.limit ?? 10, offset: result.data.offset ?? 0 });
  } catch (err) {
    return internalError(err, 'listItems');
  }
};
