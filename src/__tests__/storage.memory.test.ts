import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryStorage } from '../storage/memory.js';
import type { CreateItemRequest } from '../types/item.js';

const sample = (overrides: Partial<CreateItemRequest> = {}): CreateItemRequest => ({
  subject: 'AP Biology',
  itemType: 'multiple-choice',
  difficulty: 3,
  content: {
    question: 'q',
    options: ['A', 'B'],
    correctAnswer: 'A',
    explanation: 'e',
  },
  metadata: { author: 'tester', status: 'draft', tags: [] },
  securityLevel: 'standard',
  ...overrides,
});

describe('MemoryStorage', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('createItem assigns id, timestamps, and version=1', async () => {
    const item = await storage.createItem(sample());
    expect(item.id).toBeTruthy();
    expect(item.metadata.version).toBe(1);
    expect(item.metadata.created).toBeTypeOf('number');
    expect(item.metadata.lastModified).toBe(item.metadata.created);
  });

  it('getItem returns null when not found', async () => {
    expect(await storage.getItem('nope')).toBeNull();
  });

  it('updateItem increments version and bumps lastModified', async () => {
    const created = await storage.createItem(sample());
    // sleep one tick so lastModified differs deterministically
    await new Promise((r) => setTimeout(r, 2));

    const updated = await storage.updateItem(created.id, { subject: 'AP Calculus' });
    expect(updated?.subject).toBe('AP Calculus');
    expect(updated?.metadata.version).toBe(2);
    expect(updated!.metadata.lastModified).toBeGreaterThan(created.metadata.created);
  });

  it('listItems filters by subject and paginates', async () => {
    await storage.createItem(sample({ subject: 'A' }));
    await storage.createItem(sample({ subject: 'A' }));
    await storage.createItem(sample({ subject: 'B' }));

    const aOnly = await storage.listItems({ subject: 'A' });
    expect(aOnly.total).toBe(2);
    expect(aOnly.items.every((it) => it.subject === 'A')).toBe(true);

    const page = await storage.listItems({ limit: 1, offset: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(3);
  });

  it('getAuditTrail returns version history', async () => {
    const created = await storage.createItem(sample());
    await storage.updateItem(created.id, { subject: 'New' });
    const trail = await storage.getAuditTrail(created.id);
    expect(trail).toHaveLength(2);
    expect(trail[0].metadata.version).toBe(1);
    expect(trail[1].metadata.version).toBe(2);
  });
});
