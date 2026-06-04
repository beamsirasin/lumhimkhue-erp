'use server';

import { revalidatePath } from 'next/cache';
import { eq, asc, desc, sql, and, lt } from 'drizzle-orm';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import {
  ingredientCategories,
  ingredients,
  suppliers,
  stockCounts,
  stockCountItems,
  purchaseOrders,
  purchaseOrderItems,
} from '@/lib/db/schema';
import {
  createIngredientSchema,
  updateIngredientSchema,
  createSupplierSchema,
  updateSupplierSchema,
  saveStockCountSchema,
  createPurchaseOrderSchema,
  updatePurchaseOrderSchema,
  receivePurchaseOrderSchema,
} from '@/lib/validations/inventory';

// ── Auth helpers ──────────────────────────────────────────────────────────────

async function requireView() {
  const s = await auth();
  if (!s?.user || !can(s.user.role, 'inventory:view')) return null;
  return s;
}

async function requireEdit() {
  const s = await auth();
  if (!s?.user || !can(s.user.role, 'inventory:edit')) return null;
  return s;
}

async function requireStockCount() {
  const s = await auth();
  if (!s?.user || !can(s.user.role, 'stock_count:create')) return null;
  return s;
}

async function requirePO() {
  const s = await auth();
  if (!s?.user || !can(s.user.role, 'purchase_order:manage')) return null;
  return s;
}

// ── Ingredients ───────────────────────────────────────────────────────────────

export async function getIngredientPageData() {
  if (!await requireView()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const [cats, supps, ings] = await Promise.all([
      db.select().from(ingredientCategories).orderBy(asc(ingredientCategories.sortOrder)),
      db.select().from(suppliers).orderBy(asc(suppliers.name)),
      db.query.ingredients.findMany({
        orderBy: [asc(ingredients.name)],
        with: { category: true, defaultSupplier: true },
      }),
    ]);
    return { ok: true as const, data: { categories: cats, suppliers: supps, ingredients: ings } };
  } catch (e) {
    console.error('[getIngredientPageData]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type IngredientPageData = NonNullable<
  Extract<Awaited<ReturnType<typeof getIngredientPageData>>, { ok: true }>['data']
>;
export type IngredientRow = IngredientPageData['ingredients'][number];

export async function createIngredient(input: unknown) {
  if (!await requireEdit()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  const parsed = createIngredientSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };
  const { minStock, parLevel, lastCost, defaultSupplierId, notes, ...rest } = parsed.data;
  try {
    await db.insert(ingredients).values({
      ...rest,
      minStock: String(minStock),
      parLevel: String(parLevel),
      lastCost: String(lastCost),
      defaultSupplierId: defaultSupplierId ?? null,
      notes: notes ?? null,
    });
    revalidatePath('/inventory/ingredients');
    revalidatePath('/inventory');
    return { ok: true as const };
  } catch (e) {
    console.error('[createIngredient]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function updateIngredient(input: unknown) {
  if (!await requireEdit()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  const parsed = updateIngredientSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };
  const { id, minStock, parLevel, lastCost, defaultSupplierId, notes, ...rest } = parsed.data;
  try {
    await db.update(ingredients).set({
      ...rest,
      minStock: String(minStock),
      parLevel: String(parLevel),
      lastCost: String(lastCost),
      defaultSupplierId: defaultSupplierId ?? null,
      notes: notes ?? null,
      updatedAt: new Date(),
    }).where(eq(ingredients.id, id));
    revalidatePath('/inventory/ingredients');
    revalidatePath('/inventory');
    return { ok: true as const };
  } catch (e) {
    console.error('[updateIngredient]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function toggleIngredientActive(id: string) {
  if (!await requireEdit()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const [ing] = await db
      .select({ isActive: ingredients.isActive })
      .from(ingredients)
      .where(eq(ingredients.id, id))
      .limit(1);
    if (!ing) return { ok: false as const, error: 'ไม่พบวัตถุดิบ' };
    await db.update(ingredients)
      .set({ isActive: !ing.isActive, updatedAt: new Date() })
      .where(eq(ingredients.id, id));
    revalidatePath('/inventory/ingredients');
    revalidatePath('/inventory');
    return { ok: true as const };
  } catch (e) {
    console.error('[toggleIngredientActive]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

// ── Suppliers ─────────────────────────────────────────────────────────────────

export async function getSupplierPageData() {
  if (!await requireView()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const supps = await db.query.suppliers.findMany({
      orderBy: [asc(suppliers.name)],
      with: { purchaseOrders: { columns: { id: true } } },
    });
    return { ok: true as const, data: supps };
  } catch (e) {
    console.error('[getSupplierPageData]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type SupplierRow = NonNullable<
  Extract<Awaited<ReturnType<typeof getSupplierPageData>>, { ok: true }>['data']
>[number];

export async function createSupplier(input: unknown) {
  if (!await requireEdit()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  const parsed = createSupplierSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };
  try {
    await db.insert(suppliers).values({
      name: parsed.data.name,
      contactName: parsed.data.contactName ?? null,
      phone: parsed.data.phone ?? null,
      email: parsed.data.email ?? null,
      address: parsed.data.address ?? null,
      taxId: parsed.data.taxId ?? null,
      notes: parsed.data.notes ?? null,
    });
    revalidatePath('/inventory/suppliers');
    revalidatePath('/inventory');
    return { ok: true as const };
  } catch (e) {
    console.error('[createSupplier]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function updateSupplier(input: unknown) {
  if (!await requireEdit()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  const parsed = updateSupplierSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };
  const { id, ...data } = parsed.data;
  try {
    await db.update(suppliers).set({
      name: data.name,
      contactName: data.contactName ?? null,
      phone: data.phone ?? null,
      email: data.email ?? null,
      address: data.address ?? null,
      taxId: data.taxId ?? null,
      notes: data.notes ?? null,
    }).where(eq(suppliers.id, id));
    revalidatePath('/inventory/suppliers');
    revalidatePath('/inventory');
    return { ok: true as const };
  } catch (e) {
    console.error('[updateSupplier]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function toggleSupplierActive(id: string) {
  if (!await requireEdit()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const [s] = await db.select({ isActive: suppliers.isActive }).from(suppliers).where(eq(suppliers.id, id)).limit(1);
    if (!s) return { ok: false as const, error: 'ไม่พบผู้ขาย' };
    await db.update(suppliers).set({ isActive: !s.isActive }).where(eq(suppliers.id, id));
    revalidatePath('/inventory/suppliers');
    return { ok: true as const };
  } catch (e) {
    console.error('[toggleSupplierActive]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

// ── Stock Count ───────────────────────────────────────────────────────────────

export async function getStockCountPageData(dateStr: string) {
  if (!await requireView()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const [cats, ings, existingCount, prevCount] = await Promise.all([
      db.select().from(ingredientCategories).where(eq(ingredientCategories.isActive, true)).orderBy(asc(ingredientCategories.sortOrder)),
      db.query.ingredients.findMany({
        where: eq(ingredients.isActive, true),
        orderBy: [asc(ingredients.name)],
        with: { category: true },
      }),
      db.query.stockCounts.findFirst({
        where: eq(stockCounts.countDate, dateStr),
        with: { items: true, countedByUser: { columns: { id: true, name: true } } },
      }),
      // get most recent submitted count before today for opening balances
      db.query.stockCounts.findFirst({
        where: and(
          eq(stockCounts.status, 'submitted'),
          lt(stockCounts.countDate, dateStr),
        ),
        orderBy: [desc(stockCounts.countDate)],
        with: { items: { columns: { ingredientId: true, quantityOnHand: true } } },
      }),
    ]);

    // build opening balance map from previous count
    const openingBalances: Record<string, string> = {};
    for (const item of prevCount?.items ?? []) {
      openingBalances[item.ingredientId] = item.quantityOnHand;
    }

    return {
      ok: true as const,
      data: {
        categories: cats,
        ingredients: ings,
        existingCount: existingCount ?? null,
        openingBalances,
      },
    };
  } catch (e) {
    console.error('[getStockCountPageData]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type StockCountPageData = NonNullable<
  Extract<Awaited<ReturnType<typeof getStockCountPageData>>, { ok: true }>['data']
>;

export async function saveStockCount(input: unknown) {
  const session = await requireStockCount();
  if (!session) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  const parsed = saveStockCountSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };
  const { countDate, asDraft, notes, items } = parsed.data;
  const userId = session.user.id as string;

  try {
    const result = await db.transaction(async (tx) => {
      // upsert stock count for this date
      const existing = await tx.query.stockCounts.findFirst({
        where: eq(stockCounts.countDate, countDate),
      });

      let countId: string;

      if (existing) {
        // if already submitted and we're trying to save draft, reopen it
        await tx.update(stockCounts).set({
          status: asDraft ? 'draft' : 'submitted',
          notes: notes ?? null,
          submittedAt: asDraft ? null : new Date(),
        }).where(eq(stockCounts.id, existing.id));
        countId = existing.id;
        // delete existing items to replace
        await tx.delete(stockCountItems).where(eq(stockCountItems.stockCountId, existing.id));
      } else {
        const [newCount] = await tx.insert(stockCounts).values({
          countDate,
          countedBy: userId,
          status: asDraft ? 'draft' : 'submitted',
          notes: notes ?? null,
          submittedAt: asDraft ? null : new Date(),
        }).returning({ id: stockCounts.id });
        countId = newCount.id;
      }

      if (items.length > 0) {
        await tx.insert(stockCountItems).values(
          items.map((item) => {
            const closing = item.openingBalance + item.receivedQty - item.usedQty;
            return {
              stockCountId: countId,
              ingredientId: item.ingredientId,
              openingBalance: String(item.openingBalance.toFixed(2)),
              receivedQty: String(item.receivedQty.toFixed(2)),
              usedQty: String(item.usedQty.toFixed(2)),
              quantityOnHand: String(Math.max(0, closing).toFixed(2)),
              unit: item.unit,
              notes: item.notes ?? null,
            };
          }),
        );
      }

      return { countId };
    });

    revalidatePath('/inventory/count');
    revalidatePath('/inventory');
    return { ok: true as const, countId: result.countId };
  } catch (e) {
    console.error('[saveStockCount]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function getLowStockItems(countId: string) {
  if (!await requireView()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const items = await db.query.stockCountItems.findMany({
      where: eq(stockCountItems.stockCountId, countId),
      with: { ingredient: { with: { defaultSupplier: true, category: true } } },
    });
    const low = items.filter(
      (item) => Number(item.quantityOnHand) < Number(item.ingredient.minStock),
    );
    return { ok: true as const, data: low };
  } catch (e) {
    console.error('[getLowStockItems]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type LowStockItem = NonNullable<
  Extract<Awaited<ReturnType<typeof getLowStockItems>>, { ok: true }>['data']
>[number];

export async function getStockCountHistory() {
  if (!await requireView()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const history = await db.query.stockCounts.findMany({
      orderBy: [desc(stockCounts.countDate)],
      limit: 7,
      with: {
        countedByUser: { columns: { id: true, name: true } },
        items: { columns: { id: true } },
      },
    });
    return { ok: true as const, data: history };
  } catch (e) {
    console.error('[getStockCountHistory]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

// ── Purchase Orders ───────────────────────────────────────────────────────────

export async function getNextPoNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `PO-${year}-`;
  const result = await db
    .select({ poNumber: purchaseOrders.poNumber })
    .from(purchaseOrders)
    .where(sql`${purchaseOrders.poNumber} LIKE ${prefix + '%'}`)
    .orderBy(desc(purchaseOrders.poNumber))
    .limit(1);

  if (result.length === 0) return `${prefix}0001`;
  const last = result[0].poNumber;
  const seq = parseInt(last.replace(prefix, ''), 10);
  return `${prefix}${String(seq + 1).padStart(4, '0')}`;
}

export async function getPurchaseOrderListData() {
  if (!await requireView()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const [pos, supps] = await Promise.all([
      db.query.purchaseOrders.findMany({
        orderBy: [desc(purchaseOrders.orderDate), desc(purchaseOrders.createdAt)],
        with: {
          supplier: { columns: { id: true, name: true } },
          createdByUser: { columns: { id: true, name: true } },
          items: { columns: { id: true } },
        },
      }),
      db.select().from(suppliers).where(eq(suppliers.isActive, true)).orderBy(asc(suppliers.name)),
    ]);
    return { ok: true as const, data: { orders: pos, suppliers: supps } };
  } catch (e) {
    console.error('[getPurchaseOrderListData]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type POListData = NonNullable<
  Extract<Awaited<ReturnType<typeof getPurchaseOrderListData>>, { ok: true }>['data']
>;
export type POListItem = POListData['orders'][number];

export async function getPurchaseOrderDetail(id: string) {
  if (!await requireView()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const [po, cats, supps] = await Promise.all([
      db.query.purchaseOrders.findFirst({
        where: eq(purchaseOrders.id, id),
        with: {
          supplier: true,
          createdByUser: { columns: { id: true, name: true } },
          items: { with: { ingredient: { with: { category: true } } } },
        },
      }),
      db.select().from(ingredientCategories).orderBy(asc(ingredientCategories.sortOrder)),
      db.select().from(suppliers).where(eq(suppliers.isActive, true)).orderBy(asc(suppliers.name)),
    ]);
    if (!po) return { ok: false as const, error: 'ไม่พบใบสั่งซื้อ' };
    const ings = await db.query.ingredients.findMany({
      where: eq(ingredients.isActive, true),
      orderBy: [asc(ingredients.name)],
      with: { category: true },
    });
    return { ok: true as const, data: { po, categories: cats, suppliers: supps, ingredients: ings } };
  } catch (e) {
    console.error('[getPurchaseOrderDetail]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type PODetail = NonNullable<
  Extract<Awaited<ReturnType<typeof getPurchaseOrderDetail>>, { ok: true }>['data']
>;

export async function getPurchaseOrderFormData() {
  if (!await requireView()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const [supps, ings] = await Promise.all([
      db.select().from(suppliers).where(eq(suppliers.isActive, true)).orderBy(asc(suppliers.name)),
      db.query.ingredients.findMany({
        where: eq(ingredients.isActive, true),
        orderBy: [asc(ingredients.name)],
        with: { category: true },
      }),
    ]);
    return { ok: true as const, data: { suppliers: supps, ingredients: ings } };
  } catch (e) {
    console.error('[getPurchaseOrderFormData]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type POFormData = NonNullable<
  Extract<Awaited<ReturnType<typeof getPurchaseOrderFormData>>, { ok: true }>['data']
>;

export async function createPurchaseOrder(input: unknown) {
  const session = await requirePO();
  if (!session) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  const parsed = createPurchaseOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง' };
  const userId = session.user.id as string;

  try {
    const poNumber = await getNextPoNumber();
    const { items, vatRate, ...poData } = parsed.data;

    const subtotal = items.reduce((s, i) => s + i.quantity * i.unitCost, 0);
    const vatAmount = subtotal * (vatRate / 100);
    const total = subtotal + vatAmount;

    const result = await db.transaction(async (tx) => {
      const [po] = await tx.insert(purchaseOrders).values({
        poNumber,
        supplierId: poData.supplierId,
        status: 'draft',
        orderDate: poData.orderDate,
        expectedDate: poData.expectedDate ?? null,
        vatRate: String(vatRate),
        subtotal: String(subtotal.toFixed(2)),
        vatAmount: String(vatAmount.toFixed(2)),
        total: String(total.toFixed(2)),
        hasTaxInvoice: poData.hasTaxInvoice,
        taxInvoiceNumber: poData.taxInvoiceNumber ?? null,
        notes: poData.notes ?? null,
        createdBy: userId,
      }).returning({ id: purchaseOrders.id });

      await tx.insert(purchaseOrderItems).values(
        items.map((item) => ({
          purchaseOrderId: po.id,
          ingredientId: item.ingredientId,
          quantity: String(item.quantity),
          unit: item.unit,
          unitCost: String(item.unitCost),
          lineTotal: String((item.quantity * item.unitCost).toFixed(2)),
        })),
      );

      return po.id;
    });

    revalidatePath('/inventory/orders');
    revalidatePath('/inventory');
    return { ok: true as const, id: result };
  } catch (e) {
    console.error('[createPurchaseOrder]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function updatePurchaseOrder(input: unknown) {
  const session = await requirePO();
  if (!session) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  const parsed = updatePurchaseOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง' };
  const { id, items, vatRate, ...poData } = parsed.data;

  try {
    const [existing] = await db.select({ status: purchaseOrders.status }).from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1);
    if (!existing) return { ok: false as const, error: 'ไม่พบใบสั่งซื้อ' };
    if (existing.status !== 'draft') return { ok: false as const, error: 'แก้ไขได้เฉพาะ PO ที่ยังเป็น Draft' };

    const subtotal = items.reduce((s, i) => s + i.quantity * i.unitCost, 0);
    const vatAmount = subtotal * (vatRate / 100);
    const total = subtotal + vatAmount;

    await db.transaction(async (tx) => {
      await tx.update(purchaseOrders).set({
        supplierId: poData.supplierId,
        orderDate: poData.orderDate,
        expectedDate: poData.expectedDate ?? null,
        vatRate: String(vatRate),
        subtotal: String(subtotal.toFixed(2)),
        vatAmount: String(vatAmount.toFixed(2)),
        total: String(total.toFixed(2)),
        hasTaxInvoice: poData.hasTaxInvoice,
        taxInvoiceNumber: poData.taxInvoiceNumber ?? null,
        notes: poData.notes ?? null,
        updatedAt: new Date(),
      }).where(eq(purchaseOrders.id, id));

      await tx.delete(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, id));
      await tx.insert(purchaseOrderItems).values(
        items.map((item) => ({
          purchaseOrderId: id,
          ingredientId: item.ingredientId,
          quantity: String(item.quantity),
          unit: item.unit,
          unitCost: String(item.unitCost),
          lineTotal: String((item.quantity * item.unitCost).toFixed(2)),
        })),
      );
    });

    revalidatePath('/inventory/orders');
    revalidatePath(`/inventory/orders/${id}`);
    return { ok: true as const };
  } catch (e) {
    console.error('[updatePurchaseOrder]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function confirmOrder(id: string) {
  if (!await requirePO()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const [po] = await db.select({ status: purchaseOrders.status }).from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1);
    if (!po) return { ok: false as const, error: 'ไม่พบใบสั่งซื้อ' };
    if (po.status !== 'draft') return { ok: false as const, error: 'ยืนยันได้เฉพาะ PO ที่เป็น Draft' };
    await db.update(purchaseOrders).set({ status: 'ordered', updatedAt: new Date() }).where(eq(purchaseOrders.id, id));
    revalidatePath('/inventory/orders');
    revalidatePath(`/inventory/orders/${id}`);
    revalidatePath('/inventory');
    return { ok: true as const };
  } catch (e) {
    console.error('[confirmOrder]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function receiveOrder(input: unknown) {
  if (!await requirePO()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  const parsed = receivePurchaseOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };
  const { id, items, hasTaxInvoice, taxInvoiceNumber } = parsed.data;

  try {
    const [po] = await db.select({ status: purchaseOrders.status }).from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1);
    if (!po) return { ok: false as const, error: 'ไม่พบใบสั่งซื้อ' };
    if (po.status !== 'ordered') return { ok: false as const, error: 'รับของได้เฉพาะ PO ที่ยืนยันแล้ว' };

    const poItems = await db.query.purchaseOrderItems.findMany({
      where: eq(purchaseOrderItems.purchaseOrderId, id),
    });

    await db.transaction(async (tx) => {
      await tx.update(purchaseOrders).set({
        status: 'received',
        receivedDate: new Date().toISOString().slice(0, 10),
        hasTaxInvoice,
        taxInvoiceNumber: taxInvoiceNumber ?? null,
        updatedAt: new Date(),
      }).where(eq(purchaseOrders.id, id));

      for (const receivedItem of items) {
        await tx.update(purchaseOrderItems)
          .set({ receivedQuantity: String(receivedItem.receivedQuantity) })
          .where(eq(purchaseOrderItems.id, receivedItem.id));
      }

      // update lastCost on ingredients
      for (const poItem of poItems) {
        const receivedData = items.find((i) => i.id === poItem.id);
        if (receivedData && receivedData.receivedQuantity > 0) {
          await tx.update(ingredients)
            .set({ lastCost: poItem.unitCost, updatedAt: new Date() })
            .where(eq(ingredients.id, poItem.ingredientId));
        }
      }
    });

    revalidatePath('/inventory/orders');
    revalidatePath(`/inventory/orders/${id}`);
    revalidatePath('/inventory/ingredients');
    revalidatePath('/inventory');
    return { ok: true as const };
  } catch (e) {
    console.error('[receiveOrder]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function cancelOrder(id: string) {
  if (!await requirePO()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const [po] = await db.select({ status: purchaseOrders.status }).from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1);
    if (!po) return { ok: false as const, error: 'ไม่พบใบสั่งซื้อ' };
    if (po.status === 'received') return { ok: false as const, error: 'ไม่สามารถยกเลิก PO ที่รับของแล้ว' };
    await db.update(purchaseOrders).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(purchaseOrders.id, id));
    revalidatePath('/inventory/orders');
    revalidatePath('/inventory');
    return { ok: true as const };
  } catch (e) {
    console.error('[cancelOrder]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export async function getInventoryDashboard() {
  if (!await requireView()) return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  try {
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = today.slice(0, 7) + '-01';

    const [
      totalIngredients,
      pendingOrders,
      monthlySpend,
      latestCount,
      recentOrders,
      countHistory,
    ] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(ingredients).where(eq(ingredients.isActive, true)),
      db.select({ count: sql<number>`count(*)::int` }).from(purchaseOrders).where(eq(purchaseOrders.status, 'ordered')),
      db.select({ total: sql<string>`coalesce(sum(total),'0')` })
        .from(purchaseOrders)
        .where(sql`order_date >= ${monthStart} AND status != 'cancelled'`),
      db.query.stockCounts.findFirst({
        orderBy: [desc(stockCounts.countDate)],
        with: {
          items: {
            with: {
            ingredient: {
              columns: { id: true, minStock: true, name: true, unit: true },
              with: { defaultSupplier: { columns: { id: true, name: true } } },
            },
          },
          },
          countedByUser: { columns: { id: true, name: true } },
        },
      }),
      db.query.purchaseOrders.findMany({
        orderBy: [desc(purchaseOrders.createdAt)],
        limit: 5,
        with: { supplier: { columns: { id: true, name: true } } },
      }),
      db.query.stockCounts.findMany({
        orderBy: [desc(stockCounts.countDate)],
        limit: 7,
        with: {
          countedByUser: { columns: { id: true, name: true } },
          items: { columns: { id: true } },
        },
      }),
    ]);

    const lowStockItems = latestCount
      ? latestCount.items.filter(
          (item) => Number(item.quantityOnHand) < Number(item.ingredient.minStock),
        )
      : [];

    return {
      ok: true as const,
      data: {
        totalIngredients: totalIngredients[0].count,
        lowStockCount: lowStockItems.length,
        pendingOrders: pendingOrders[0].count,
        monthlySpend: Number(monthlySpend[0].total),
        latestCount: latestCount ?? null,
        lowStockItems,
        recentOrders,
        countHistory,
      },
    };
  } catch (e) {
    console.error('[getInventoryDashboard]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export type InventoryDashboardData = NonNullable<
  Extract<Awaited<ReturnType<typeof getInventoryDashboard>>, { ok: true }>['data']
>;
