'use server';

import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import {
  createPurchaseOrder,
  getStockCountReorderItems,
} from '@/lib/actions/inventory';

export type ReorderItem = {
  ingredientId: string;
  ingredientName: string;
  unit: string;
  parLevel: number;
  currentStock: number;
  inTransitQty: number;
  delayedIncomingQty: number;
  reorderQty: number;
  supplierId: string | null;
  supplierName: string | null;
  lastCost: number;
  hasDelayedOrder: boolean;
};

export async function checkReorderNeeded() {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'inventory:view')) {
    return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  }
  const result = await getStockCountReorderItems();
  if (!result.ok) return result;
  return {
    ok: true as const,
    data: result.data.items.map((item) => ({
      ingredientId: item.ingredientId,
      ingredientName: item.ingredientName,
      unit: item.unit,
      parLevel: item.parLevel,
      currentStock: item.quantityOnHand,
      inTransitQty: item.inTransitQty,
      delayedIncomingQty: item.delayedIncomingQty,
      reorderQty: item.reorderQty,
      supplierId: item.defaultSupplierId,
      supplierName: item.defaultSupplierName,
      lastCost: item.lastCost,
      hasDelayedOrder: item.hasDelayedOrder,
    })),
  };
}

export async function createDraftPOFromReorder(ingredientIds: string[]) {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'purchase_order:manage')) {
    return { ok: false as const, error: 'ไม่มีสิทธิ์' };
  }
  if (ingredientIds.length === 0) {
    return { ok: false as const, error: 'ไม่ได้เลือกรายการ' };
  }

  const reorder = await getStockCountReorderItems();
  if (!reorder.ok) return reorder;
  const selected = reorder.data.items.filter((item) => ingredientIds.includes(item.ingredientId));
  const missingSupplier = selected.filter((item) => !item.defaultSupplierId);
  if (missingSupplier.length > 0) {
    return {
      ok: false as const,
      error: 'มีรายการที่ยังไม่ได้กำหนด Supplier เริ่มต้น',
    };
  }

  const grouped = new Map<string, typeof selected>();
  for (const item of selected) {
    const supplierId = item.defaultSupplierId!;
    const group = grouped.get(supplierId) ?? [];
    group.push(item);
    grouped.set(supplierId, group);
  }

  const orderDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  let count = 0;
  for (const [supplierId, items] of grouped) {
    const result = await createPurchaseOrder({
      supplierId,
      orderDate,
      expectedDate: null,
      vatRate: 7,
      hasTaxInvoice: false,
      taxInvoiceNumber: null,
      notes: 'สร้างจากคำแนะนำ Reorder ของผลนับที่ตรวจรับแล้ว',
      items: items.map((item) => ({
        ingredientId: item.ingredientId,
        quantity: item.reorderQty,
        unit: item.unit,
        priceStatus: item.lastCost > 0 ? 'estimated' as const : 'pending' as const,
        unitCost: item.lastCost > 0 ? item.lastCost : null,
        lastCostSnapshot: item.lastCost,
      })),
    });
    if (!result.ok) return result;
    count += 1;
  }
  return { ok: true as const, data: { count } };
}
