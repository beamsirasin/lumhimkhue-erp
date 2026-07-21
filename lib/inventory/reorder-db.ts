import { eq, or } from 'drizzle-orm';
import { db } from '@/lib/db';
import { purchaseOrders } from '@/lib/db/schema';
import { deriveDeliveryState } from '@/lib/inventory/procurement-math';

export async function getOpenPoIncomingBreakdown(asOfDate: string, ingredientIds: string[]) {
  const guaranteed: Record<string, number> = {};
  const delayed: Record<string, number> = {};
  if (ingredientIds.length === 0) return { guaranteed, delayed };
  const orders = await db.query.purchaseOrders.findMany({
    where: or(
      eq(purchaseOrders.status, 'ordered'),
      eq(purchaseOrders.status, 'partial_received'),
    ),
    with: {
      items: {
        where: (item, operators) => operators.inArray(item.ingredientId, ingredientIds),
        columns: { ingredientId: true, quantity: true, receivedQuantity: true },
      },
    },
  });
  for (const order of orders) {
    const delivery = deriveDeliveryState({
      expectedDate: order.expectedDate,
      asOfDate,
      orderedQuantity: order.items.reduce((sum, item) => sum + Number(item.quantity), 0),
      receivedQuantity: order.items.reduce((sum, item) => sum + Number(item.receivedQuantity ?? 0), 0),
      status: order.status,
    });
    const bucket = delivery.isDelayed ? delayed : guaranteed;
    for (const item of order.items) {
      const remaining = Math.max(0, Number(item.quantity) - Number(item.receivedQuantity ?? 0));
      bucket[item.ingredientId] = (bucket[item.ingredientId] ?? 0) + remaining;
    }
  }
  return { guaranteed, delayed };
}
