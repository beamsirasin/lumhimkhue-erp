/**
 * Printer configuration stored in IndexedDB (device-local, not synced to Neon).
 * Uses idb-keyval for a minimal key-value store over IndexedDB.
 */

import { get, set, del, entries } from 'idb-keyval';
import type { PrinterConfig } from './types';

/* ─── Key helpers ───────────────────────────────────────────────────────── */

const PREFIX = 'printer:';
const DEFAULT_KEY = 'printer:__default__';

function printerKey(id: string): string {
  return `${PREFIX}${id}`;
}

/* ─── Read ──────────────────────────────────────────────────────────────── */

export async function getAllPrinters(): Promise<PrinterConfig[]> {
  const all = await entries<string, PrinterConfig>();
  return all
    .filter(([key]) => key.startsWith(PREFIX) && key !== DEFAULT_KEY)
    .map(([, value]) => value)
    .sort((a, b) => a.name.localeCompare(b.name, 'th'));
}

export async function getPrinter(id: string): Promise<PrinterConfig | null> {
  const config = await get<PrinterConfig>(printerKey(id));
  return config ?? null;
}

export async function getDefaultPrinter(): Promise<PrinterConfig | null> {
  const defaultId = await get<string>(DEFAULT_KEY);
  if (!defaultId) return null;
  return getPrinter(defaultId);
}

/* ─── Write ─────────────────────────────────────────────────────────────── */

export async function savePrinter(config: PrinterConfig): Promise<void> {
  await set(printerKey(config.id), config);

  // If this is the only printer, auto-set as default
  const all = await getAllPrinters();
  if (all.length === 1) {
    await set(DEFAULT_KEY, config.id);
  }
}

export async function setDefaultPrinter(id: string): Promise<void> {
  await set(DEFAULT_KEY, id);
}

/* ─── Delete ────────────────────────────────────────────────────────────── */

export async function deletePrinter(id: string): Promise<void> {
  await del(printerKey(id));

  // If deleted printer was the default, clear or re-assign
  const defaultId = await get<string>(DEFAULT_KEY);
  if (defaultId === id) {
    const remaining = await getAllPrinters();
    if (remaining.length > 0) {
      await set(DEFAULT_KEY, remaining[0].id);
    } else {
      await del(DEFAULT_KEY);
    }
  }
}
