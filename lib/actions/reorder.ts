'use server';

import { revalidatePath } from 'next/cache';
import { eq, inArray, desc } from 'drizzle-orm';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import {
  ingredients,
  stockCounts,
  stockCountItems,
  purchaseOrders,
  purchaseOrderItems,
} from '@/lib/db/schema';
import { getNextPoNumber } from '@/lib/actions/inventory';

export type ReorderItem = {
  ingredientId: string;
  ingredientName: string;
  unit: string;
  parLevel: number;
  currentStock: number;
  reorderQty: number;
  supplierId: string | null;
  supplierName: string | null;
  lastCost: number;
};

export async function checkReorderNeeded() {
  const s = await auth();
  if (!s?.user || !can(s.user.role, 'inventory:view')) {
    return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  }
  try {
    const latestCount = await db.query.stockCounts.findFirst({
      where: eq(stockCounts.status, 'submitted'),
      orderBy: [desc(stockCounts.countDate)],
      with: {
        items: {
          with: {
            ingredient: {
              columns: {
                id: true,
                name: true,
                unit: true,
                parLevel: true,
                lastCost: true,
                defaultSupplierId: true,
              },
              with: { defaultSupplier: { columns: { id: true, name: true } } },
            },
          },
        },
      },
    });

    if (!latestCount) return { ok: true as const, data: [] as ReorderItem[] };

    const reorderItems: ReorderItem[] = latestCount.items
      .filter((item) => Number(item.quantityOnHand) < Number(item.ingredient.parLevel))
      .map((item) => ({
        ingredientId: item.ingredientId,
        ingredientName: item.ingredient.name,
        unit: item.unit,
        parLevel: Number(item.ingredient.parLevel),
        currentStock: Number(item.quantityOnHand),
        reorderQty: Math.max(0.01, Number(item.ingredient.parLevel) - Number(item.quantityOnHand)),
        supplierId: item.ingredient.defaultSupplierId ?? null,
        supplierName: item.ingredient.defaultSupplier?.name ?? null,
        lastCost: Number(item.ingredient.lastCost),
      }));

    return { ok: true as const, data: reorderItems };
  } catch (e) {
    console.error('[checkReorderNeeded]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}

export async function createDraftPOFromReorder(ingredientIds: string[]) {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'purchase_order:manage')) {
    return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  }
  if (!ingredientIds.length) return { ok: false as const, error: 'ไม่ได้เลือกรายการ' };

  try {
    const latestCount = await db.query.stockCounts.findFirst({
      where: eq(stockCounts.status, 'submitted'),
      orderBy: [desc(stockCounts.countDate)],
      with: {
        items: {
          where: inArray(stockCountItems.ingredientId, ingredientIds),
          with: {
            ingredient: {
              columns: {
                id: true,
                name: true,
                unit: true,
                parLevel: true,
                lastCost: true,
                defaultSupplierId: true,
              },
            },
          },
        },
      },
    });

    if (!latestCount) return { ok: false as const, error: 'ไม่พบข้อมูลสต็อกล่าสุด' };

    const bySupplier = new Map<string, typeof latestCount.items>();
    for (const item of latestCount.items) {
      const sid = item.ingredient.defaultSupplierId;
      if (!sid) continue;
      if (!bySupplier.has(sid)) bySupplier.set(sid, []);
      bySupplier.get(sid)!.push(item);
    }

    if (bySupplier.size === 0) {
      return { ok: false as const, error: 'รายการที่เลือกไม่มี Supplier กำหนดไว้' };
    }

    const today = new Date().toISOString().slice(0, 10);
    const userId = session.user.id as string;
    let createdCount = 0;

    for (const [supplierId, items] of bySupplier) {
      const poNumber = await getNextPoNumber();
      const lineItems = items.map((item) => {
        const reorderQty = Math.max(0.01, Number(item.ingredient.parLevel) - Number(item.quantityOnHand));
        const unitCost = Number(item.ingredient.lastCost);
        const lineTotal = Math.round(reorderQty * unitCost * 100) / 100;
        return { ingredientId: item.ingredientId, quantity: reorderQty, unit: item.unit, unitCost, lineTotal };
      });

      const subtotal = lineItems.reduce((s, li) => s + li.lineTotal, 0);
      const vatRate = 7;
      const vatAmount = Math.round(subtotal * vatRate) / 100;
      const total = subtotal + vatAmount;

      const [po] = await db
        .insert(purchaseOrders)
        .values({
          poNumber,
          supplierId,
          status: 'draft',
          orderDate: today,
          subtotal: subtotal.toFixed(2),
          vatRate: vatRate.toFixed(2),
          vatAmount: vatAmount.toFixed(2),
          total: total.toFixed(2),
          hasTaxInvoice: false,
          createdBy: userId,
          notes: 'สร้างอัตโนมัติจากระบบ Auto-Reorder',
        })
        .returning({ id: purchaseOrders.id });

      await db.insert(purchaseOrderItems).values(
        lineItems.map((li) => ({
          purchaseOrderId: po.id,
          ingredientId: li.ingredientId,
          quantity: li.quantity.toFixed(2),
          unit: li.unit,
          unitCost: li.unitCost.toFixed(2),
          lineTotal: li.lineTotal.toFixed(2),
        })),
      );

      createdCount++;
    }

    revalidatePath('/inventory/orders');
    revalidatePath('/inventory');
    return { ok: true as const, data: { count: createdCount } };
  } catch (e) {
    console.error('[createDraftPOFromReorder]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด' };
  }
}
