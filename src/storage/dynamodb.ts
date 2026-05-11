/**
 * DynamoDB Storage Implementation (Optional)
 *
 * Selected when USE_DYNAMODB=true; otherwise the factory uses MemoryStorage.
 *
 * Schema (see ARCHITECTURE.md):
 *   pk = ITEM#<id>, sk = CURRENT | VERSION#<padded>
 *   gsi1: gsi1pk = SUBJECT#<subject>, gsi1sk = STATUS#<status>#<lastModified>
 *   sparse on gsi1: only CURRENT rows carry gsi1pk/gsi1sk
 *
 * For DynamoDB Local: DYNAMODB_ENDPOINT=http://localhost:8000
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  TransactWriteCommand,
  GetCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { ExamItem, CreateItemRequest, UpdateItemRequest, ListItemsQuery } from '../types/item.js';
import { ItemStorage } from './interface.js';
import { merge } from 'lodash';

interface Row extends ExamItem {
  pk: string;
  sk: string;
  gsi1pk?: string;
  gsi1sk?: string;
}

const VERSION_PAD = 6;
const versionSk = (n: number) => `VERSION#${String(n).padStart(VERSION_PAD, '0')}`;
const itemPk = (id: string) => `ITEM#${id}`;
const subjectPk = (subject: string) => `SUBJECT#${subject}`;
const statusSk = (status: string, lastModified: number) =>
  `STATUS#${status}#${lastModified}`;

const toCurrentRow = (item: ExamItem): Row => ({
  ...item,
  pk: itemPk(item.id),
  sk: 'CURRENT',
  gsi1pk: subjectPk(item.subject),
  gsi1sk: statusSk(item.metadata.status, item.metadata.lastModified),
});

// Snapshots intentionally omit gsi1pk/gsi1sk so subject queries against gsi1
// don't return CURRENT plus every historical version of every match.
const toVersionRow = (item: ExamItem): Row => ({
  ...item,
  pk: itemPk(item.id),
  sk: versionSk(item.metadata.version),
});

const stripKeys = (row: Record<string, unknown>): ExamItem => {
  const { pk: _p, sk: _s, gsi1pk: _gp, gsi1sk: _gs, ...item } = row;
  return item as unknown as ExamItem;
};

export class DynamoDBStorage implements ItemStorage {
  private client: DynamoDBDocumentClient;
  private tableName: string;

  constructor(client?: DynamoDBDocumentClient, tableName?: string) {
    this.client = client ?? DynamoDBDocumentClient.from(new DynamoDBClient({
      region: process.env.AWS_REGION ?? 'us-east-1',
      ...(process.env.DYNAMODB_ENDPOINT ? { endpoint: process.env.DYNAMODB_ENDPOINT } : {}),
    }));
    this.tableName = tableName ?? process.env.DYNAMODB_TABLE_NAME ?? 'ExamItems';
  }

  async createItem(data: CreateItemRequest): Promise<ExamItem> {
    const now = Date.now();
    const item: ExamItem = {
      id: randomUUID(),
      ...data,
      metadata: {
        ...data.metadata,
        created: now,
        lastModified: now,
        version: 1,
      },
    };

    await this.client.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: this.tableName,
            Item: toCurrentRow(item),
            ConditionExpression: 'attribute_not_exists(pk)',
          },
        },
        {
          Put: {
            TableName: this.tableName,
            Item: toVersionRow(item),
          },
        },
      ],
    }));

    return item;
  }

  async getItem(id: string): Promise<ExamItem | null> {
    const result = await this.client.send(new GetCommand({
      TableName: this.tableName,
      Key: {
        pk: itemPk(id),
        sk: 'CURRENT',
      },
    }));

    if (!result.Item) return null;
    return stripKeys(result.Item);
  }

  async updateItem(id: string, data: UpdateItemRequest): Promise<ExamItem | null> {
    const current = await this.getItem(id);
    if (!current) return null;

    const merged = merge({}, current, data);

    const updated: ExamItem = {
      ...merged,
      content: merged.content,
      metadata: {
        ...merged.metadata,
        lastModified: Date.now(),
        version: current.metadata.version + 1,
      },
    };

    await this.client.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: this.tableName,
            Item: toCurrentRow(updated),
            ConditionExpression: 'attribute_exists(pk)',
          },
        },
        {
          Put: {
            TableName: this.tableName,
            Item: toVersionRow(updated),
          },
        },
      ],
    }));

    return updated;
  }

  async listItems(query: ListItemsQuery): Promise<{ items: ExamItem[]; total: number }> {
    throw new Error('Not implemented');
  }

  async createVersion(id: string): Promise<ExamItem | null> {
    throw new Error('Not implemented');
  }

  async getAuditTrail(id: string): Promise<ExamItem[]> {
    throw new Error('Not implemented');
  }
}
