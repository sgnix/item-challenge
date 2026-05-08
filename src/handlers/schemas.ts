import { z } from 'zod';

const itemTypes = ['multiple-choice', 'free-response', 'essay'] as const;
const statuses = ['draft', 'review', 'approved', 'archived'] as const;
const securityLevels = ['standard', 'secure', 'highly-secure'] as const;

export const createItemSchema = z
  .object({
    subject: z.string().min(1).max(120),
    itemType: z.enum(itemTypes),
    difficulty: z.number().int().min(1).max(5),
    content: z.object({
      question: z.string().min(1),
      options: z.array(z.string()).min(2).optional(),
      correctAnswer: z.string().min(1),
      explanation: z.string(),
    }),
    metadata: z.object({
      author: z.string().min(1),
      status: z.enum(statuses),
      tags: z.array(z.string()).default([]),
    }),
    securityLevel: z.enum(securityLevels),
  })
  // multiple-choice without options is a footgun: enforce it here so storage doesn't have to.
  .refine(
    (v) => v.itemType !== 'multiple-choice' || (v.content.options && v.content.options.length >= 2),
    { message: 'multiple-choice items require content.options', path: ['content', 'options'] },
  );

export type CreateItemInput = z.infer<typeof createItemSchema>;

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  subject: z.string().min(1).optional(),
  status: z.enum(statuses).optional(),
});

export type ListQueryInput = z.infer<typeof listQuerySchema>;
