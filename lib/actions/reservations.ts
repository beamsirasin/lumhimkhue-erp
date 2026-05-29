'use server';

import { revalidatePath } from 'next/cache';
import { eq, inArray } from 'drizzle-orm';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import {
  reservations,
  reservationGuests,
  tables,
  pricingTiles,
} from '@/lib/db/schema';
import { z } from 'zod';

/* โ”€โ”€โ”€ Schemas โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€ */

const guestRowSchema = z.object({
  pricingTileId: z.string().uuid(),
  quantity: z.number().int().min(0),
});

const createReservationSchema = z.object({
  primaryTableId: z.string().uuid(),
  linkedTableIds: z.array(z.string().uuid()).default([]),
  customerName: z.string().min(1).max(255),
  customerPhone: z.string().max(20).optional(),
  partySize: z.number().int().min(1),
  reservedAt: z.string().datetime({ offset: true }).or(z.string()),
  notes: z.string().max(500).optional(),
  guests: z.array(guestRowSchema).default([]),
});

const updateReservationSchema = z.object({
  id: z.string().uuid(),
  customerName: z.string().min(1).max(255),
  customerPhone: z.string().max(20).optional(),
  partySize: z.number().int().min(1),
  reservedAt: z.string().datetime({ offset: true }).or(z.string()),
  notes: z.string().max(500).optional(),
  guests: z.array(guestRowSchema).default([]),
});

/* โ”€โ”€โ”€ Actions โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€ */

export async function createReservation(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'เธเธฃเธธเธ“เธฒเน€เธเนเธฒเธชเธนเนเธฃเธฐเธเธ' };
  if (!can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'เนเธกเนเธกเธตเธชเธดเธ—เธเธดเนเธ”เธณเน€เธเธดเธเธเธฒเธฃ' };

  const parsed = createReservationSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'เธเนเธญเธกเธนเธฅเนเธกเนเธ–เธนเธเธ•เนเธญเธ' };

  const {
    primaryTableId,
    linkedTableIds,
    customerName,
    customerPhone,
    partySize,
    reservedAt,
    notes,
    guests,
  } = parsed.data;

  // Verify all tables are available
  const allTableIds = [primaryTableId, ...linkedTableIds];

  try {
    const tableRows = await db
      .select({ id: tables.id, status: tables.status, label: tables.label })
      .from(tables)
      .where(inArray(tables.id, allTableIds));

    for (const t of tableRows) {
      if (t.status !== 'available')
        return { ok: false as const, error: `เนเธ•เนเธฐ ${t.label} เนเธกเนเธงเนเธฒเธเนเธเธเธ“เธฐเธเธตเน` };
    }

    // Verify active tile IDs
    const nonZeroGuests = guests.filter((g) => g.quantity > 0);
    if (nonZeroGuests.length > 0) {
      const tileIds = nonZeroGuests.map((g) => g.pricingTileId);
      const activeTiles = await db
        .select({ id: pricingTiles.id })
        .from(pricingTiles)
        .where(eq(pricingTiles.isActive, true));
      const activeSet = new Set(activeTiles.map((t) => t.id));
      for (const tid of tileIds) {
        if (!activeSet.has(tid))
          return { ok: false as const, error: 'เนเธกเนเธเธเธเธฃเธฐเน€เธ เธ—เธฃเธฒเธเธฒเธ—เธตเนเธฃเธฐเธเธธ' };
      }
    }

    const reservedDate = new Date(reservedAt);

    // Create primary reservation
    const [primaryRes] = await db
      .insert(reservations)
      .values({
        tableId: primaryTableId,
        customerName,
        customerPhone: customerPhone ?? null,
        partySize,
        reservedAt: reservedDate,
        notes: notes ?? null,
        status: 'pending',
        createdBy: authSession.user.id,
      })
      .returning({ id: reservations.id });

    // Insert guest tiles for primary reservation
    if (nonZeroGuests.length > 0) {
      await db.insert(reservationGuests).values(
        nonZeroGuests.map((g) => ({
          reservationId: primaryRes.id,
          pricingTileId: g.pricingTileId,
          quantity: g.quantity,
        })),
      );
    }

    // Create linked reservations
    if (linkedTableIds.length > 0) {
      await db.insert(reservations).values(
        linkedTableIds.map((tableId) => ({
          tableId,
          customerName,
          customerPhone: customerPhone ?? null,
          partySize: 0, // guests tracked on primary only
          reservedAt: reservedDate,
          notes: notes ?? null,
          status: 'pending' as const,
          parentReservationId: primaryRes.id,
          createdBy: authSession.user.id,
        })),
      );
    }

    // Mark all tables as reserved
    await db
      .update(tables)
      .set({ status: 'reserved' })
      .where(inArray(tables.id, allTableIds));

    revalidatePath('/', 'layout');
    return { ok: true as const, data: { id: primaryRes.id } };
  } catch (e) {
    console.error('[createReservation]', e);
    return { ok: false as const, error: 'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ” เธเธฃเธธเธ“เธฒเธฅเธญเธเนเธซเธกเน' };
  }
}

export async function cancelReservation(reservationId: string) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'เธเธฃเธธเธ“เธฒเน€เธเนเธฒเธชเธนเนเธฃเธฐเธเธ' };
  if (!can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'เนเธกเนเธกเธตเธชเธดเธ—เธเธดเนเธ”เธณเน€เธเธดเธเธเธฒเธฃ' };

  try {
    // Find primary reservation (could receive primary or linked id)
    const [res] = await db
      .select({ id: reservations.id, tableId: reservations.tableId, parentReservationId: reservations.parentReservationId })
      .from(reservations)
      .where(eq(reservations.id, reservationId))
      .limit(1);

    if (!res) return { ok: false as const, error: 'เนเธกเนเธเธเธเนเธญเธกเธนเธฅเธเธฒเธฃเธเธญเธ' };

    const primaryId = res.parentReservationId ?? res.id;

    // Find all reservations in this group
    const linked = await db
      .select({ id: reservations.id, tableId: reservations.tableId })
      .from(reservations)
      .where(eq(reservations.parentReservationId, primaryId));

    const allIds = [primaryId, ...linked.map((l) => l.id)];
    const allTableIds = [
      res.parentReservationId ? null : res.tableId,
      ...linked.map((l) => l.tableId),
    ].filter(Boolean) as string[];

    // Get primary table id
    if (!res.parentReservationId) {
      // res is the primary
      allTableIds.unshift(res.tableId);
    } else {
      const [primary] = await db
        .select({ tableId: reservations.tableId })
        .from(reservations)
        .where(eq(reservations.id, primaryId))
        .limit(1);
      if (primary) allTableIds.unshift(primary.tableId);
    }

    await db
      .update(reservations)
      .set({ status: 'cancelled' })
      .where(inArray(reservations.id, allIds));

    // Release tables back to available if no active session
    await db
      .update(tables)
      .set({ status: 'available' })
      .where(inArray(tables.id, [...new Set(allTableIds)]));

    revalidatePath('/', 'layout');
    return { ok: true as const };
  } catch (e) {
    console.error('[cancelReservation]', e);
    return { ok: false as const, error: 'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ” เธเธฃเธธเธ“เธฒเธฅเธญเธเนเธซเธกเน' };
  }
}

export async function updateReservation(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'เธเธฃเธธเธ“เธฒเน€เธเนเธฒเธชเธนเนเธฃเธฐเธเธ' };
  if (!can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'เนเธกเนเธกเธตเธชเธดเธ—เธเธดเนเธ”เธณเน€เธเธดเธเธเธฒเธฃ' };

  const parsed = updateReservationSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'เธเนเธญเธกเธนเธฅเนเธกเนเธ–เธนเธเธ•เนเธญเธ' };

  const { id, customerName, customerPhone, partySize, reservedAt, notes, guests } = parsed.data;

  try {
    await db
      .update(reservations)
      .set({
        customerName,
        customerPhone: customerPhone ?? null,
        partySize,
        reservedAt: new Date(reservedAt),
        notes: notes ?? null,
      })
      .where(eq(reservations.id, id));

    // Re-sync guests
    await db.delete(reservationGuests).where(eq(reservationGuests.reservationId, id));
    const nonZero = guests.filter((g) => g.quantity > 0);
    if (nonZero.length > 0) {
      await db.insert(reservationGuests).values(
        nonZero.map((g) => ({
          reservationId: id,
          pricingTileId: g.pricingTileId,
          quantity: g.quantity,
        })),
      );
    }

    revalidatePath('/', 'layout');
    return { ok: true as const };
  } catch (e) {
    console.error('[updateReservation]', e);
    return { ok: false as const, error: 'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ” เธเธฃเธธเธ“เธฒเธฅเธญเธเนเธซเธกเน' };
  }
}

