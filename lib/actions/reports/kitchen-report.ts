'use server';

import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { startOfDay, endOfDay, format } from 'date-fns';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { orderItems, orders, sessions, tables, menuItems } from '@/lib/db/schema';

const TZ = 'Asia/Bangkok';
const MIN_TIMING_SAMPLES = 5;

// ─── Labels ───────────────────────────────────────────────────────────────────

export const ITEM_STATUS_LABELS: Record<string, string> = {
  pending:   'รอทำ',
  preparing: 'กำลังทำ',
  ready:     'พร้อมเสิร์ฟ',
  served:    'เสิร์ฟแล้ว',
  cancelled: 'ยกเลิก',
};

export const STATION_LABELS: Record<string, string> = {
  meat:      'เนื้อสัตว์',
  seafood:   'อาหารทะเล',
  vegetable: 'ผัก',
  noodle:    'เส้น',
  dessert:   'ของหวาน',
  drink:     'เครื่องดื่ม',
  sauce:     'น้ำจิ้ม',
};

const STATION_ORDER = ['meat', 'seafood', 'vegetable', 'noodle', 'drink', 'dessert', 'sauce'];
const ORDERED_STATUSES = ['pending', 'preparing', 'ready', 'served', 'cancelled'];

// ─── Types ────────────────────────────────────────────────────────────────────

export type KitchenItemRow = {
  orderId:    string;
  orderedAt:  string;           // orders.createdAt ISO
  tableLabel: string;
  tableZone:  string;
  itemId:     string;
  itemName:   string;
  station:    string;
  quantity:   number;
  itemStatus: string;
  servedAt:   string | null;
  prepMinutes: number | null;   // servedAt − orderedAt, null if servedAt absent
};

export type KitchenPopularItem = {
  itemName:   string;
  station:    string;
  totalQty:   number;
  orderCount: number;
  pct:        number;
};

export type KitchenStatusRow = {
  status: string;
  label:  string;
  qty:    number;
  pct:    number;
};

export type KitchenStationRow = {
  station:      string;
  label:        string;
  totalQty:     number;
  servedQty:    number;
  pendingQty:   number;
  cancelledQty: number;
  pct:          number;
};

export type KitchenTableRow = {
  tableId:     string;
  tableLabel:  string;
  tableZone:   string;
  orderCount:  number;
  totalQty:    number;
  pendingQty:  number;
  lastOrderAt: string;
};

export type KitchenDailyRow = {
  date:       string;
  orderCount: number;
  itemQty:    number;
};

export type KitchenReportData = {
  rows:             KitchenItemRow[];
  totalOrders:      number;
  totalItemQty:     number;
  servedQty:        number;
  pendingQty:       number;
  cancelledQty:     number;
  avgItemsPerOrder: number | null;
  avgPrepMinutes:   number | null;   // null → < MIN_TIMING_SAMPLES data points
  popularItems:     KitchenPopularItem[];
  stationBreakdown: KitchenStationRow[];
  tableWorkload:    KitchenTableRow[];
  dailyRows:        KitchenDailyRow[];
  statusSummary:    KitchenStatusRow[];
};

// ─── Action ───────────────────────────────────────────────────────────────────

export async function getKitchenReport(startDate: string, endDate: string) {
  const authSession = await auth();
  if (!authSession?.user) return { ok: false as const, error: 'กรุณาเข้าสู่ระบบ' };
  if (!can(authSession.user.role, 'view_reports'))
    return { ok: false as const, error: 'ไม่มีสิทธิ์ดูรายงาน' };

  const empty: KitchenReportData = {
    rows: [], totalOrders: 0, totalItemQty: 0, servedQty: 0,
    pendingQty: 0, cancelledQty: 0, avgItemsPerOrder: null,
    avgPrepMinutes: null, popularItems: [], stationBreakdown: [],
    tableWorkload: [], dailyRows: [], statusSummary: [],
  };

  try {
    const startUtc = fromZonedTime(startOfDay(toZonedTime(new Date(startDate), TZ)), TZ);
    const endUtc   = fromZonedTime(endOfDay(toZonedTime(new Date(endDate), TZ)), TZ);

    // ── Single query: all order item rows in date range ────────────────────
    // Date anchor: orders.createdAt (not null) — consistent with KDS history pattern

    const rawRows = await db
      .select({
        orderId:      orders.id,
        orderedAt:    orders.createdAt,
        sessionId:    orders.sessionId,
        tableId:      tables.id,
        tableLabel:   tables.label,
        tableZone:    tables.zone,
        itemId:       orderItems.id,
        menuItemId:   orderItems.menuItemId,
        rawItemName:  orderItems.itemName,
        quantity:     orderItems.quantity,
        station:      orderItems.station,
        itemStatus:   orderItems.status,
        servedAt:     orderItems.servedAt,
        menuItemName: menuItems.name,
      })
      .from(orderItems)
      .innerJoin(orders,   eq(orderItems.orderId,    orders.id))
      .innerJoin(sessions, eq(orders.sessionId,      sessions.id))
      .innerJoin(tables,   eq(sessions.tableId,      tables.id))
      .leftJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
      .where(and(
        gte(orders.createdAt, startUtc),
        lte(orders.createdAt, endUtc),
      ))
      .orderBy(asc(orders.createdAt));

    if (rawRows.length === 0) return { ok: true as const, data: empty };

    // ── Aggregate helpers ──────────────────────────────────────────────────

    const orderSet     = new Set<string>();
    const statusCounts = new Map<string, number>(); // status → sum qty
    const itemMap      = new Map<string, {
      itemName: string; station: string; qty: number; orderSet: Set<string>;
    }>();
    const stationMap = new Map<string, {
      total: number; served: number; pending: number; cancelled: number;
    }>();
    const dailyMap  = new Map<string, { orderSet: Set<string>; itemQty: number }>();
    const tableMap  = new Map<string, {
      label: string; zone: string; orderSet: Set<string>;
      totalQty: number; pendingQty: number; lastOrderAt: Date;
    }>();
    const prepTimes: number[] = [];

    const rows: KitchenItemRow[] = rawRows.map((r) => {
      const itemName = r.menuItemName ?? r.rawItemName ?? '(เมนูถูกลบ)';
      const prepMinutes = r.servedAt != null
        ? Math.round((r.servedAt.getTime() - r.orderedAt.getTime()) / 60_000)
        : null;

      // orders set
      orderSet.add(r.orderId);

      // status aggregation
      statusCounts.set(r.itemStatus, (statusCounts.get(r.itemStatus) ?? 0) + r.quantity);

      // popular items — key by menuItemId if available, else itemName
      const popKey = r.menuItemId ?? (r.rawItemName ?? 'unknown');
      if (!itemMap.has(popKey)) {
        itemMap.set(popKey, { itemName, station: r.station, qty: 0, orderSet: new Set() });
      }
      const pop = itemMap.get(popKey)!;
      pop.qty += r.quantity;
      pop.orderSet.add(r.orderId);

      // station aggregation
      if (!stationMap.has(r.station)) {
        stationMap.set(r.station, { total: 0, served: 0, pending: 0, cancelled: 0 });
      }
      const st = stationMap.get(r.station)!;
      st.total += r.quantity;
      if (r.itemStatus === 'served') st.served += r.quantity;
      else if (r.itemStatus === 'cancelled') st.cancelled += r.quantity;
      else st.pending += r.quantity;

      // daily aggregation — Bangkok date of orders.createdAt
      const dayKey = format(toZonedTime(r.orderedAt, TZ), 'yyyy-MM-dd');
      if (!dailyMap.has(dayKey)) dailyMap.set(dayKey, { orderSet: new Set(), itemQty: 0 });
      const day = dailyMap.get(dayKey)!;
      day.orderSet.add(r.orderId);
      day.itemQty += r.quantity;

      // table workload
      if (!tableMap.has(r.tableId)) {
        tableMap.set(r.tableId, {
          label: r.tableLabel, zone: r.tableZone,
          orderSet: new Set(), totalQty: 0, pendingQty: 0,
          lastOrderAt: r.orderedAt,
        });
      }
      const tbl = tableMap.get(r.tableId)!;
      tbl.orderSet.add(r.orderId);
      tbl.totalQty += r.quantity;
      if (r.itemStatus !== 'served' && r.itemStatus !== 'cancelled') tbl.pendingQty += r.quantity;
      if (r.orderedAt > tbl.lastOrderAt) tbl.lastOrderAt = r.orderedAt;

      // timing — use servedAt − orderedAt (reliable: serveGroup sets servedAt)
      if (prepMinutes !== null && prepMinutes >= 0) prepTimes.push(prepMinutes);

      return {
        orderId:    r.orderId,
        orderedAt:  r.orderedAt.toISOString(),
        tableLabel: r.tableLabel,
        tableZone:  r.tableZone,
        itemId:     r.itemId,
        itemName,
        station:    r.station,
        quantity:   r.quantity,
        itemStatus: r.itemStatus,
        servedAt:   r.servedAt?.toISOString() ?? null,
        prepMinutes,
      };
    });

    // ── KPIs ──────────────────────────────────────────────────────────────

    const totalOrders  = orderSet.size;
    const totalItemQty = [...statusCounts.values()].reduce((s, v) => s + v, 0);
    const servedQty    = statusCounts.get('served')    ?? 0;
    const cancelledQty = statusCounts.get('cancelled') ?? 0;
    const pendingQty   = totalItemQty - servedQty - cancelledQty;

    const avgItemsPerOrder = totalOrders > 0
      ? Math.round((totalItemQty / totalOrders) * 10) / 10
      : null;

    const avgPrepMinutes = prepTimes.length >= MIN_TIMING_SAMPLES
      ? Math.round(prepTimes.reduce((s, v) => s + v, 0) / prepTimes.length)
      : null;

    // ── Status summary ─────────────────────────────────────────────────────

    const statusSummary: KitchenStatusRow[] = ORDERED_STATUSES
      .filter((s) => (statusCounts.get(s) ?? 0) > 0)
      .map((s) => ({
        status: s,
        label:  ITEM_STATUS_LABELS[s] ?? s,
        qty:    statusCounts.get(s) ?? 0,
        pct:    totalItemQty > 0
          ? Math.round(((statusCounts.get(s) ?? 0) / totalItemQty) * 100)
          : 0,
      }));

    // ── Popular items (top 10) ─────────────────────────────────────────────

    const popularItems: KitchenPopularItem[] = [...itemMap.values()]
      .map(({ orderSet: os, qty, itemName, station }) => ({
        itemName,
        station,
        totalQty:   qty,
        orderCount: os.size,
        pct: totalItemQty > 0 ? Math.round((qty / totalItemQty) * 100) : 0,
      }))
      .sort((a, b) => b.totalQty - a.totalQty)
      .slice(0, 10);

    // ── Station breakdown ──────────────────────────────────────────────────

    const stationBreakdown: KitchenStationRow[] = STATION_ORDER
      .filter((s) => stationMap.has(s))
      .map((s) => {
        const st = stationMap.get(s)!;
        return {
          station:      s,
          label:        STATION_LABELS[s] ?? s,
          totalQty:     st.total,
          servedQty:    st.served,
          pendingQty:   st.pending,
          cancelledQty: st.cancelled,
          pct: totalItemQty > 0 ? Math.round((st.total / totalItemQty) * 100) : 0,
        };
      });

    // ── Daily rows ─────────────────────────────────────────────────────────

    const dailyRows: KitchenDailyRow[] = [...dailyMap.entries()]
      .map(([date, { orderSet: os, itemQty }]) => ({
        date,
        orderCount: os.size,
        itemQty,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // ── Table workload (top 10 by totalQty) ───────────────────────────────

    const tableWorkload: KitchenTableRow[] = [...tableMap.entries()]
      .map(([tableId, { orderSet: os, label, zone, totalQty, pendingQty, lastOrderAt }]) => ({
        tableId,
        tableLabel:  label,
        tableZone:   zone,
        orderCount:  os.size,
        totalQty,
        pendingQty,
        lastOrderAt: lastOrderAt.toISOString(),
      }))
      .sort((a, b) => b.totalQty - a.totalQty)
      .slice(0, 10);

    // Detail rows ordered newest first
    const sortedRows = [...rows].sort((a, b) =>
      new Date(b.orderedAt).getTime() - new Date(a.orderedAt).getTime(),
    );

    return {
      ok: true as const,
      data: {
        rows: sortedRows,
        totalOrders,
        totalItemQty,
        servedQty,
        pendingQty,
        cancelledQty,
        avgItemsPerOrder,
        avgPrepMinutes,
        popularItems,
        stationBreakdown,
        tableWorkload,
        dailyRows,
        statusSummary,
      } satisfies KitchenReportData,
    };
  } catch (e) {
    console.error('[getKitchenReport]', e);
    return { ok: false as const, error: 'เกิดข้อผิดพลาดในการดึงข้อมูลรายงาน' };
  }
}
