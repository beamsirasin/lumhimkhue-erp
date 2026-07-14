'use server';

import { revalidatePath } from 'next/cache';
import { eq, inArray, or, and, ne, sql, isNull } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { nanoid } from 'nanoid';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { sessions, tables, sessionGuests, pricingTiles, buffetChargeLines, paymentAllocations } from '@/lib/db/schema';
import { z } from 'zod';
import { writeAuditLog } from '@/lib/actions/audit';
import { chargeLineTotal } from '@/lib/payments/money-math';
import { consumeManagerApprovalCode } from '@/lib/actions/manager-approval';
import { requiresApprovalForSavedGuestEdit, hasGuestCountDecrease } from '@/lib/auth/approval-code-core';

/* ─── Shared schemas ─────────────────────────────────────────────────── */

const guestRowSchema = z.object({
  pricingTileId: z.string().uuid(),
  quantity: z.number().int().min(0),
});

/* ─── openSession ────────────────────────────────────────────────────── */

const openSessionSchema = z.object({
  tableId: z.string().uuid(),
  linkedTableIds: z.array(z.string().uuid()).default([]),
  guests: z.array(guestRowSchema).default([]),
  notes: z.string().max(500).optional(),
  /** Link a CRM customer to this session for loyalty tracking */
  customerId: z.string().uuid().optional().nullable(),
});

export async function openSession(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = openSessionSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง' };

  const { tableId, linkedTableIds, guests, notes, customerId } = parsed.data;
  const allTableIds = [tableId, ...linkedTableIds];

  // Filter out zero-quantity tiles
  const nonZeroGuests = guests.filter((g) => g.quantity > 0);

  try {
    // Verify tables + pricing tiles in parallel
    const [tableRows, activeTiles] = await Promise.all([
      db
        .select({ id: tables.id, status: tables.status, label: tables.label, qrToken: tables.qrToken })
        .from(tables)
        .where(inArray(tables.id, allTableIds)),
      nonZeroGuests.length > 0
        ? db.select({ id: pricingTiles.id, code: pricingTiles.code, name: pricingTiles.name, price: pricingTiles.price })
            .from(pricingTiles).where(eq(pricingTiles.isActive, true))
        : Promise.resolve([] as { id: string; code: string; name: string; price: string }[]),
    ]);

    for (const t of tableRows) {
      if (t.id === tableId && t.status !== 'available' && t.status !== 'reserved')
        return { ok: false as const, error: `โต๊ะ ${t.label} ไม่พร้อมใช้งานในขณะนี้` };
      if (t.id !== tableId && t.status !== 'available' && t.status !== 'reserved')
        return { ok: false as const, error: `โต๊ะเชื่อมโยง ${t.label} ไม่ว่างในขณะนี้` };
    }

    const primaryTableRow = tableRows.find((t) => t.id === tableId);
    if (!primaryTableRow) return { ok: false as const, error: 'ไม่พบโต๊ะ' };

    const activeTileIds = new Set(activeTiles.map((t) => t.id));
    const tileMap = new Map(activeTiles.map((t) => [t.id, t]));
    for (const g of nonZeroGuests) {
      if (!activeTileIds.has(g.pricingTileId))
        return { ok: false as const, error: 'ไม่พบประเภทราคา' };
    }

    const startedAt = new Date();
    const sessionToken = nanoid(12);

    // ─── Phase 16C-C2B: batch-atomic write phase ─────────────────────────────
    // The primary-session id is pre-generated (batch statements cannot read
    // RETURNING values) and every insert + table update commits in one
    // db.batch() — an atomic Neon HTTP transaction. This replaces both the
    // hand-rolled compensating cleanup and the post-insert verification counts,
    // which existed only to mitigate the old non-atomic sequential writes.
    const sessionId = crypto.randomUUID();

    // Pre-generate linked session rows (tokens captured for the return value)
    const linkedSessionRows = linkedTableIds.map((ltId) => ({
      tableId: ltId,
      startedAt,
      sessionToken: nanoid(12),
      status: 'active' as const,
      parentSessionId: sessionId,
    }));

    const batchStatements: [BatchItem<'pg'>, ...BatchItem<'pg'>[]] = [
      db.insert(sessions).values({
        id: sessionId,
        tableId,
        startedAt,
        sessionToken,
        status: 'active',
        notes: notes ?? null,
        parentSessionId: null,
        customerId: customerId ?? null,
      }),
    ];

    if (linkedSessionRows.length > 0) {
      batchStatements.push(db.insert(sessions).values(linkedSessionRows));
    }

    // Session guests on the primary session (skip if none — Drizzle errors on empty values)
    if (nonZeroGuests.length > 0) {
      batchStatements.push(
        db.insert(sessionGuests).values(
          nonZeroGuests.map((g) => ({
            sessionId,
            pricingTileId: g.pricingTileId,
            quantity: g.quantity,
            unitPrice: tileMap.get(g.pricingTileId)?.price ?? '0',
          })),
        ),
      );

      // Buffet charge lines with snapshotted price.
      batchStatements.push(
        db.insert(buffetChargeLines).values(
          nonZeroGuests.map((g) => {
            const tile = tileMap.get(g.pricingTileId)!;
            const unitPrice = Number(tile.price);
            return {
              sessionId,
              pricingTileId: g.pricingTileId,
              chargeType: tile.code || tile.name || 'guest',
              label: tile.name,
              unitPrice: unitPrice.toFixed(2),
              quantity: g.quantity,
              total: chargeLineTotal(unitPrice, g.quantity),
            };
          }),
        ),
      );
    }

    batchStatements.push(db.update(tables).set({ status: 'occupied' }).where(eq(tables.id, tableId)));
    if (linkedTableIds.length > 0) {
      batchStatements.push(db.update(tables).set({ status: 'linked' }).where(inArray(tables.id, linkedTableIds)));
    }

    await db.batch(batchStatements);

    const thLocale: Intl.DateTimeFormatOptions = {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'Asia/Bangkok',
    };

    // Build linked table QR data for the success dialog
    const linkedTables = linkedSessionRows.map((ls) => {
      const tableRow = tableRows.find((t) => t.id === ls.tableId);
      return {
        tableQrToken: tableRow?.qrToken ?? '',
        tableLabel: tableRow?.label ?? '',
        sessionToken: ls.sessionToken,
      };
    });

    revalidatePath('/tables');
    revalidatePath('/pos');
    writeAuditLog({
      userId: authSession.user.id,
      role: authSession.user.role,
      action: 'create',
      entity: 'sessions',
      entityId: sessionId,
      after: { tableId, linkedTableIds, sessionToken },
    });
    if (nonZeroGuests.length > 0) {
      writeAuditLog({
        userId: authSession.user.id,
        role: authSession.user.role,
        action: 'headcount_created',
        entity: 'session_guests',
        entityId: sessionId,
        after: {
          guests: nonZeroGuests.map((g) => ({
            pricingTileId: g.pricingTileId,
            label: tileMap.get(g.pricingTileId)?.name,
            quantity: g.quantity,
            unitPrice: tileMap.get(g.pricingTileId)?.price,
          })),
        },
      });
    }
    return {
      ok: true as const,
      data: {
        sessionId,
        sessionToken,
        tableQrToken: primaryTableRow.qrToken,
        tableLabel: primaryTableRow.label,
        startedAt: startedAt.toLocaleString('th-TH', thLocale),
        linkedTables,
      },
    };
  } catch (e) {
    console.error('[openSession]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}

/* ─── closeSession ───────────────────────────────────────────────────── */

export async function closeSession(input: { sessionId: string }) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const [session] = await db
      .select({ tableId: sessions.tableId, parentSessionId: sessions.parentSessionId })
      .from(sessions)
      .where(eq(sessions.id, input.sessionId))
      .limit(1);
    if (!session) return { ok: false as const, error: 'ไม่พบข้อมูล session' };

    const primaryId = session.parentSessionId ?? input.sessionId;

    // Single query fetches primary + all children (replaces 2 separate round trips)
    const groupSessions = await db
      .select({ id: sessions.id, tableId: sessions.tableId })
      .from(sessions)
      .where(or(eq(sessions.id, primaryId), eq(sessions.parentSessionId, primaryId)));

    const allSessionIds = groupSessions.map((s) => s.id);
    const allTableIds = groupSessions.map((s) => s.tableId);

    // Parallel: update sessions and tables simultaneously
    await Promise.all([
      db.update(sessions).set({ status: 'closed', closedAt: new Date() }).where(inArray(sessions.id, allSessionIds)),
      db.update(tables).set({ status: 'available' }).where(inArray(tables.id, allTableIds)),
    ]);

    revalidatePath('/tables');
    revalidatePath('/pos');
    writeAuditLog({
      userId: authSession.user.id,
      role: authSession.user.role,
      action: 'close',
      entity: 'sessions',
      entityId: input.sessionId,
    });
    return { ok: true as const };
  } catch (e) {
    console.error('[closeSession]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}

/* ─── requestBillFromTable ───────────────────────────────────────────── */

export async function requestBillFromTable(input: { sessionId: string }) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    // Mark primary session (and its children) as closing
    const [session] = await db
      .select({ parentSessionId: sessions.parentSessionId })
      .from(sessions)
      .where(eq(sessions.id, input.sessionId))
      .limit(1);
    if (!session) return { ok: false as const, error: 'ไม่พบ session' };

    const primaryId = session.parentSessionId ?? input.sessionId;

    const linked = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.parentSessionId, primaryId));

    const allIds = [primaryId, ...linked.map((s) => s.id)];

    await db
      .update(sessions)
      .set({ status: 'closing' })
      .where(inArray(sessions.id, allIds));

    revalidatePath('/tables');
    revalidatePath('/pos');
    return { ok: true as const };
  } catch (e) {
    console.error('[requestBillFromTable]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}

/* ─── setTableAvailable ──────────────────────────────────────────────── */

export async function setTableAvailable(input: { tableId: string }) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    await db.update(tables).set({ status: 'available' }).where(eq(tables.id, input.tableId));
    revalidatePath('/tables');
    revalidatePath('/pos');
    return { ok: true as const };
  } catch (e) {
    console.error('[setTableAvailable]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}

/* ─── updateSessionGuests ────────────────────────────────────────────── */

const updateGuestsSchema = z.object({
  sessionId: z.string().uuid(),
  guests: z.array(guestRowSchema),
  // Addon-type tiles — persisted to buffet_charge_lines only (not session_guests),
  // so processPayment can still add them via lineItems without double-counting.
  addonItems: z.array(guestRowSchema).optional().default([]),
  // Phase 17POS-AUTH-A2 — required from cashiers only when this edit changes
  // an already-saved guest count (see requiresApproval check below).
  approvalCode: z.string().trim().max(20).optional(),
  reason: z.string().trim().max(500).optional(),
});

/** Phase 17POS-AUTH-A2 — true if the guest tile set actually differs (added/removed/quantity changed). */
function guestSetsEqual(
  a: { pricingTileId: string; quantity: number }[],
  b: { pricingTileId: string; quantity: number }[],
): boolean {
  const normalize = (arr: typeof a) =>
    arr.filter((g) => g.quantity > 0).map((g) => `${g.pricingTileId}:${g.quantity}`).sort();
  const na = normalize(a);
  const nb = normalize(b);
  return na.length === nb.length && na.every((v, i) => v === nb[i]);
}

export async function updateSessionGuests(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = updateGuestsSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง' };

  const { sessionId, guests, addonItems, approvalCode, reason } = parsed.data;
  const nonZeroGuests = guests.filter((g) => g.quantity > 0);
  const nonZeroAddons = addonItems.filter((a) => a.quantity > 0);
  // All items that should have active charge lines after this save
  const allNonZeroItems = [...nonZeroGuests, ...nonZeroAddons];

  try {
    // Fetch tile data, current active charge lines, and allocation sums in parallel
    const allTileIds = allNonZeroItems.map((g) => g.pricingTileId);
    const [currentChargeLines, allocationRows, tileRows, oldGuests] = await Promise.all([
      db.select().from(buffetChargeLines).where(
        and(eq(buffetChargeLines.sessionId, sessionId), isNull(buffetChargeLines.voidedAt)),
      ),
      db.select({
        chargeLineId: paymentAllocations.chargeLineId,
        allocatedQty: sql<number>`sum(${paymentAllocations.quantity})::int`,
      }).from(paymentAllocations)
        .where(eq(paymentAllocations.sessionId, sessionId))
        .groupBy(paymentAllocations.chargeLineId),
      allTileIds.length > 0
        ? db.select({ id: pricingTiles.id, code: pricingTiles.code, name: pricingTiles.name, price: pricingTiles.price })
            .from(pricingTiles).where(inArray(pricingTiles.id, allTileIds))
        : Promise.resolve([] as { id: string; code: string; name: string; price: string }[]),
      db.select().from(sessionGuests).where(eq(sessionGuests.sessionId, sessionId)),
    ]);

    const tileMap = new Map(tileRows.map((t) => [t.id, t]));
    const allocMap = new Map(allocationRows.map((r) => [r.chargeLineId, r.allocatedQty]));
    const newTileIds = new Set(allNonZeroItems.map((g) => g.pricingTileId));

    // Allocation guard: block reducing any charge line below its already-allocated quantity
    for (const line of currentChargeLines) {
      const allocatedQty = allocMap.get(line.id) ?? 0;
      if (allocatedQty === 0) continue;
      const newItem = allNonZeroItems.find((g) => g.pricingTileId === line.pricingTileId);
      const newQty = newItem?.quantity ?? 0;
      if (newQty < allocatedQty) {
        return {
          ok: false as const,
          error: `ไม่สามารถลดจำนวนต่ำกว่าจำนวนที่ชำระแล้ว (${line.label}: ชำระแล้ว ${allocatedQty} หน่วย)`,
        };
      }
    }

    // ─── Phase 17POS-AUTH-A2B: manager approval gate (all roles) ─────────────
    // Policy change from A2: EVERY role that can reach this point — owner,
    // manager, cashier (kitchen lacks manage_tables and is already blocked
    // above) — must enter a valid approval code to edit an ALREADY-SAVED
    // guest set. A fresh headcount entry (oldGuests empty) or a no-op resave
    // never requires a code. There is no silent bypass for owner/manager.
    //
    // Phase 17POS-AUTH-A4: narrowed to decreases only. Raising a quantity or
    // adding a new tile to an already-saved guest set never requires a code
    // — it only increases the bill, which isn't the fraud scenario approval
    // codes exist for (quietly removing a paying guest after the count was
    // saved). Any per-tile decrease still gates the whole edit — see
    // hasGuestCountDecrease() in lib/auth/approval-code-core.ts.
    //
    // Self-approval (Phase 17POS-AUTH-A2C): only OWNER may redeem a code
    // they generated themselves. Manager/cashier self-approval is rejected
    // inside consumeManagerApprovalCode with a specific message — see
    // isSelfApprovalAllowed() in lib/auth/approval-code-core.ts. The
    // `selfApproved` audit field below records the outcome.
    //
    // Atomic boundary: code consumption (consumeManagerApprovalCode) is a
    // separate conditional UPDATE that runs and commits BEFORE the batch
    // below. The neon-http driver has no db.transaction(), so these cannot
    // be one atomic unit; all edit-input validation (zod parse + allocation
    // guard above) runs first specifically to minimize the window where a
    // code could be marked used but the subsequent batch still fails.
    const isSavedGuestEdit = oldGuests.length > 0 && !guestSetsEqual(oldGuests, nonZeroGuests);
    const isGuestCountDecrease = hasGuestCountDecrease(oldGuests, nonZeroGuests);
    const requiresApproval = requiresApprovalForSavedGuestEdit(
      authSession.user.role,
      isSavedGuestEdit && isGuestCountDecrease,
    );
    let approvalCodeId: string | null = null;
    let approvalCodeGeneratedBy: string | null = null;

    if (requiresApproval) {
      if (!approvalCode) {
        return {
          ok: false as const,
          error: 'ต้องใช้รหัสอนุมัติสำหรับการแก้ไขจำนวนลูกค้าที่บันทึกแล้ว',
          requiresApproval: true as const,
        };
      }
      if (!reason || reason.trim().length === 0) {
        return {
          ok: false as const,
          error: 'ต้องระบุเหตุผลสำหรับการแก้ไขนี้',
          requiresApproval: true as const,
        };
      }
      const approval = await consumeManagerApprovalCode({
        code: approvalCode,
        action: 'pos_saved_guest_count_edit',
        entityType: 'session',
        entityId: sessionId,
        requestedByUserId: authSession.user.id,
        requestedByRole: authSession.user.role,
        requestedByBranchId: authSession.user.branchId ?? null,
        reason,
      });
      if (!approval.ok) return { ok: false as const, error: approval.error };
      approvalCodeId = approval.codeId;
      approvalCodeGeneratedBy = approval.generatedByUserId;
    }

    // ─── Phase 16C-C2B: batch-atomic write phase ─────────────────────────────
    // Every write decision is derived from the pre-reads above; the guest
    // delete/re-insert and every charge-line void/update/insert commit together
    // or not at all — the canonical saved bill (charge lines) can no longer
    // diverge from the guest list on a mid-write failure.

    // Replace session_guests with GUEST tiles only (addon tiles must NOT go here —
    // processPayment adds addon amounts via lineItems to avoid double-counting)
    const batchStatements: [BatchItem<'pg'>, ...BatchItem<'pg'>[]] = [
      db.delete(sessionGuests).where(eq(sessionGuests.sessionId, sessionId)),
    ];
    if (nonZeroGuests.length > 0) {
      batchStatements.push(
        db.insert(sessionGuests).values(
          nonZeroGuests.map((g) => {
            const tile = tileMap.get(g.pricingTileId);
            // Reuse snapshotted unitPrice from existing charge line if available; else use live price
            const existingLine = currentChargeLines.find((l) => l.pricingTileId === g.pricingTileId);
            const unitPrice = existingLine ? existingLine.unitPrice : (tile?.price ?? '0');
            return {
              sessionId,
              pricingTileId: g.pricingTileId,
              quantity: g.quantity,
              unitPrice,
            };
          }),
        ),
      );
    }

    // Sync buffet_charge_lines for ALL items (guests + addons)
    const chargeLineByTileId = new Map(
      currentChargeLines.map((l) => [l.pricingTileId, l]),
    );

    // Void removed lines (only safe because allocation guard above already blocked any with allocations)
    const linesToVoid = currentChargeLines.filter((l) => !newTileIds.has(l.pricingTileId ?? ''));
    if (linesToVoid.length > 0) {
      batchStatements.push(
        db.update(buffetChargeLines)
          .set({ voidedAt: new Date() })
          .where(inArray(buffetChargeLines.id, linesToVoid.map((l) => l.id))),
      );
    }

    // Update existing lines (one statement per line — distinct values) or
    // collect new ones into a single multi-row insert.
    const newLineValues: (typeof buffetChargeLines.$inferInsert)[] = [];
    for (const item of allNonZeroItems) {
      const tile = tileMap.get(item.pricingTileId);
      const existingLine = chargeLineByTileId.get(item.pricingTileId);

      if (existingLine) {
        // Keep existing unitPrice snapshot; only update quantity + total
        batchStatements.push(
          db.update(buffetChargeLines)
            .set({
              quantity: item.quantity,
              total: chargeLineTotal(existingLine.unitPrice, item.quantity),
            })
            .where(eq(buffetChargeLines.id, existingLine.id)),
        );
      } else if (tile) {
        // New tile not seen before: create charge line with current tile price
        const unitPrice = Number(tile.price);
        newLineValues.push({
          sessionId,
          pricingTileId: item.pricingTileId,
          chargeType: tile.code || tile.name || 'item',
          label: tile.name,
          unitPrice: unitPrice.toFixed(2),
          quantity: item.quantity,
          total: chargeLineTotal(unitPrice, item.quantity),
        });
      }
    }
    if (newLineValues.length > 0) {
      batchStatements.push(db.insert(buffetChargeLines).values(newLineValues));
    }

    await db.batch(batchStatements);

    writeAuditLog({
      userId: authSession.user.id,
      role: authSession.user.role,
      action: 'headcount_changed',
      entity: 'session_guests',
      entityId: sessionId,
      before: { guests: oldGuests.map((g) => ({ pricingTileId: g.pricingTileId, quantity: g.quantity })) },
      after: {
        guests: nonZeroGuests.map((g) => ({ pricingTileId: g.pricingTileId, quantity: g.quantity })),
        addons: nonZeroAddons.map((a) => ({ pricingTileId: a.pricingTileId, quantity: a.quantity })),
      },
    });

    if (approvalCodeId) {
      writeAuditLog({
        userId: authSession.user.id,
        role: authSession.user.role,
        action: 'sensitive_action_approved_by_code',
        entity: 'session',
        entityId: sessionId,
        before: { guests: oldGuests.map((g) => ({ pricingTileId: g.pricingTileId, quantity: g.quantity })) },
        after: {
          guests: nonZeroGuests.map((g) => ({ pricingTileId: g.pricingTileId, quantity: g.quantity })),
          actorUserId: authSession.user.id,
          actorRole: authSession.user.role,
          approvalCodeId,
          generatedByUserId: approvalCodeGeneratedBy,
          // Phase 17POS-AUTH-A2C: true only when actorRole === 'owner' —
          // manager/cashier self-approval never reaches this point (rejected
          // earlier by consumeManagerApprovalCode).
          selfApproved: approvalCodeGeneratedBy != null ? approvalCodeGeneratedBy === authSession.user.id : null,
          reason: reason ?? null,
          actionKey: 'pos_saved_guest_count_edit',
        },
      });
    }

    revalidatePath('/tables');
    revalidatePath('/pos');
    return { ok: true as const };
  } catch (e) {
    console.error('[updateSessionGuests]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}

/* ─── moveSession ────────────────────────────────────────────────────── */

export async function moveSession(input: { sessionId: string; newTableId: string }) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const [session] = await db
      .select({ tableId: sessions.tableId, parentSessionId: sessions.parentSessionId })
      .from(sessions)
      .where(eq(sessions.id, input.sessionId))
      .limit(1);
    if (!session) return { ok: false as const, error: 'ไม่พบ session' };

    const [newTable] = await db
      .select({ status: tables.status, label: tables.label })
      .from(tables)
      .where(eq(tables.id, input.newTableId))
      .limit(1);
    if (!newTable) return { ok: false as const, error: 'ไม่พบโต๊ะ' };
    if (newTable.status !== 'available')
      return { ok: false as const, error: `โต๊ะ ${newTable.label} ไม่ว่างในขณะนี้` };

    const oldTableId = session.tableId;
    // Secondary sessions keep 'linked' status on their new table
    const newTableStatus = session.parentSessionId ? 'linked' : 'occupied';

    // Move session to new table
    await db
      .update(sessions)
      .set({ tableId: input.newTableId })
      .where(eq(sessions.id, input.sessionId));

    // Parallel: update both table statuses simultaneously
    await Promise.all([
      db.update(tables).set({ status: 'available' }).where(eq(tables.id, oldTableId)),
      db.update(tables).set({ status: newTableStatus }).where(eq(tables.id, input.newTableId)),
    ]);

    revalidatePath('/tables');
    revalidatePath('/pos');
    return { ok: true as const };
  } catch (e) {
    console.error('[moveSession]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}

/* ─── closeSingleSession ─────────────────────────────────────────────── */
// Close only this one table/session and detach it from the linked group.
// If it's the primary, elect the first remaining secondary as the new primary.

export async function closeSingleSession(input: { sessionId: string }) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const [sess] = await db
      .select({ tableId: sessions.tableId, parentSessionId: sessions.parentSessionId })
      .from(sessions)
      .where(eq(sessions.id, input.sessionId))
      .limit(1);
    if (!sess) return { ok: false as const, error: 'ไม่พบ session' };

    const isPrimary = !sess.parentSessionId;

    if (isPrimary) {
      // Find all ACTIVE children only — closed children must not be elected as new primary
      const children = await db
        .select({ id: sessions.id, tableId: sessions.tableId })
        .from(sessions)
        .where(and(
          eq(sessions.parentSessionId, input.sessionId),
          inArray(sessions.status, ['active', 'closing']),
        ));

      if (children.length > 0) {
        // Elect first child as new primary
        const newPrimary = children[0];
        const rest = children.slice(1);

        // Transfer guests and buffet charge lines to new primary
        await db
          .update(sessionGuests)
          .set({ sessionId: newPrimary.id })
          .where(eq(sessionGuests.sessionId, input.sessionId));
        await db
          .update(buffetChargeLines)
          .set({ sessionId: newPrimary.id })
          .where(eq(buffetChargeLines.sessionId, input.sessionId));

        // New primary: clear parentSessionId
        await db
          .update(sessions)
          .set({ parentSessionId: null })
          .where(eq(sessions.id, newPrimary.id));

        // Remaining children: point to new primary
        if (rest.length > 0) {
          await db
            .update(sessions)
            .set({ parentSessionId: newPrimary.id })
            .where(inArray(sessions.id, rest.map((r) => r.id)));
        }

        // If new primary has no remaining siblings, keep 'linked' status so
        // the table still shows the grouped visual indicator on the floor map.
        const newStatus = rest.length === 0 ? 'linked' : 'occupied';
        await db.update(tables).set({ status: newStatus }).where(eq(tables.id, newPrimary.tableId));
      }
    }

    if (!isPrimary && sess.parentSessionId) {
      // Secondary being closed — check if primary now has no remaining children.
      // If so, mark the primary table as 'linked' to keep the visual grouping indicator.
      // Count only ACTIVE siblings — closed siblings must not block the 'linked' indicator
      const remainingChildren = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(
          eq(sessions.parentSessionId, sess.parentSessionId),
          ne(sessions.id, input.sessionId),
          inArray(sessions.status, ['active', 'closing']),
        ));
      if (remainingChildren.length === 0) {
        const [primarySess] = await db
          .select({ tableId: sessions.tableId })
          .from(sessions)
          .where(eq(sessions.id, sess.parentSessionId))
          .limit(1);
        if (primarySess) {
          await db.update(tables).set({ status: 'linked' }).where(eq(tables.id, primarySess.tableId));
        }
      }
    }

    // Close this session and free its table
    await db
      .update(sessions)
      .set({ status: 'closed', closedAt: new Date() })
      .where(eq(sessions.id, input.sessionId));
    await db
      .update(tables)
      .set({ status: 'available' })
      .where(eq(tables.id, sess.tableId));

    revalidatePath('/tables');
    revalidatePath('/pos');
    return { ok: true as const };
  } catch (e) {
    console.error('[closeSingleSession]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}

/* ─── transferPrimary ────────────────────────────────────────────────── */
// Make a secondary session the new primary of the linked group.
// Transfers guest (billing) data to the new primary's session.

export async function transferPrimary(input: { newPrimarySessionId: string }) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'manage_tables'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  try {
    const [newPrimSess] = await db
      .select({ tableId: sessions.tableId, parentSessionId: sessions.parentSessionId })
      .from(sessions)
      .where(eq(sessions.id, input.newPrimarySessionId))
      .limit(1);
    if (!newPrimSess) return { ok: false as const, error: 'ไม่พบ session' };
    if (!newPrimSess.parentSessionId) return { ok: false as const, error: 'โต๊ะนี้เป็นโต๊ะหลักอยู่แล้ว' };

    const oldPrimaryId = newPrimSess.parentSessionId;

    const [oldPrimSess] = await db
      .select({ tableId: sessions.tableId })
      .from(sessions)
      .where(eq(sessions.id, oldPrimaryId))
      .limit(1);
    if (!oldPrimSess) return { ok: false as const, error: 'ไม่พบ session หลัก' };

    // All other children (excluding the new primary)
    const otherChildren = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.parentSessionId, oldPrimaryId));

    // 1. Transfer session_guests and buffet charge lines from old primary to new primary
    await db
      .update(sessionGuests)
      .set({ sessionId: input.newPrimarySessionId })
      .where(eq(sessionGuests.sessionId, oldPrimaryId));
    await db
      .update(buffetChargeLines)
      .set({ sessionId: input.newPrimarySessionId })
      .where(eq(buffetChargeLines.sessionId, oldPrimaryId));

    // 2. New primary: clear parentSessionId
    await db
      .update(sessions)
      .set({ parentSessionId: null })
      .where(eq(sessions.id, input.newPrimarySessionId));

    // 3. Old primary becomes secondary → points to new primary
    await db
      .update(sessions)
      .set({ parentSessionId: input.newPrimarySessionId })
      .where(eq(sessions.id, oldPrimaryId));

    // 4. Remaining children → point to new primary
    const remainingIds = otherChildren
      .map((c) => c.id)
      .filter((id) => id !== input.newPrimarySessionId);
    if (remainingIds.length > 0) {
      await db
        .update(sessions)
        .set({ parentSessionId: input.newPrimarySessionId })
        .where(inArray(sessions.id, remainingIds));
    }

    // 5. Parallel: update both table statuses simultaneously
    await Promise.all([
      db.update(tables).set({ status: 'occupied' }).where(eq(tables.id, newPrimSess.tableId)),
      db.update(tables).set({ status: 'linked' }).where(eq(tables.id, oldPrimSess.tableId)),
    ]);

    revalidatePath('/tables');
    revalidatePath('/pos');
    return { ok: true as const };
  } catch (e) {
    console.error('[transferPrimary]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}

/* ─── createContinuationSession ─────────────────────────────────────────
   Used after partial split payment to create a new "remaining" session
   linked to the original via parentSessionId.  The new session is in
   'closing' status (ready for immediate payment) and the table is reset
   to 'occupied' since some guests are still seated.
────────────────────────────────────────────────────────────────────── */

const continuationSchema = z.object({
  originalSessionId: z.string().uuid(),
  guests: z.array(guestRowSchema).min(1),
});

export async function createContinuationSession(input: unknown) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'process_payment'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดำเนินการ' };

  const parsed = continuationSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'ข้อมูลไม่ถูกต้อง' };

  const { originalSessionId, guests } = parsed.data;

  try {
    const original = await db.query.sessions.findFirst({
      where: eq(sessions.id, originalSessionId),
    });
    if (!original) return { ok: false as const, error: 'ไม่พบ session ต้นฉบับ' };

    // Always link to the root session (so all continuations share one parent)
    const rootParentId = original.parentSessionId ?? originalSessionId;

    const [newSession] = await db
      .insert(sessions)
      .values({
        tableId:         original.tableId,
        startedAt:       new Date(),
        sessionToken:    nanoid(12),
        status:          'closing',
        notes:           '[แบ่งชำระ]',
        parentSessionId: rootParentId,
      })
      .returning({ id: sessions.id });

    await db.insert(sessionGuests).values(
      guests.map((g) => ({
        sessionId:      newSession.id,
        pricingTileId:  g.pricingTileId,
        quantity:       g.quantity,
      })),
    );

    // Table is still occupied (remaining guests are seated)
    await db.update(tables).set({ status: 'occupied' }).where(eq(tables.id, original.tableId));

    revalidatePath('/pos');
    revalidatePath('/tables');
    return { ok: true as const, data: { sessionId: newSession.id } };
  } catch (e) {
    console.error('[createContinuationSession]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}
