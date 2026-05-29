import { z } from 'zod';

const stationEnum = z.enum([
  'meat',
  'seafood',
  'vegetable',
  'noodle',
  'dessert',
  'drink',
  'sauce',
]);

export const createCategorySchema = z.object({
  name: z.string().min(1, 'กรุณากรอกชื่อหมวด').max(255),
  sortOrder: z.number().int().min(0).default(0),
  station: stationEnum,
  maxPerSession: z.number().int().min(1).nullable().optional(),
});

export const updateCategorySchema = createCategorySchema.extend({
  id: z.string().uuid(),
});

export const createMenuItemSchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().min(1, 'กรุณากรอกชื่อเมนู').max(255),
  nameEn: z.string().max(255).optional().nullable(),
  description: z.string().max(1000).optional(),
  descriptionEn: z.string().max(1000).optional().nullable(),
  imageUrl: z.string().nullable().optional(),
  isBuffet: z.boolean().default(true),
  extraPrice: z.number().min(0).default(0),
  maxPerOrder: z.number().int().min(1).nullable().optional(),
  cooldownSeconds: z.number().int().min(0).default(0),
});

export const updateMenuItemSchema = createMenuItemSchema.extend({
  id: z.string().uuid(),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type CreateMenuItemInput = z.infer<typeof createMenuItemSchema>;
export type UpdateMenuItemInput = z.infer<typeof updateMenuItemSchema>;
