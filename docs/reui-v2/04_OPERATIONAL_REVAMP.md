# Phase 12.6 — Operational Staff Revamp Plan

> **WARNING:** These pages contain production-critical payment and session logic.
> All changes in this phase are **cosmetic and ergonomic only**.
> Never change server action calls, data shapes, or business logic flow.

---

## Ground Rules for This Phase

1. Do not change `lib/actions/pos.ts`, `lib/actions/sessions.ts`, `lib/actions/shifts.ts`
2. Do not change the POS payment flow, shift validation, or session state machine
3. Do not change the KDS serve/cancel mutations
4. Do not change the Tables DnD logic or session open/close flow
5. Do not change the Queue status machine
6. All changes must be visually verifiable — no data behavior changes
7. If in doubt, do not change it

---

## `/pos` — POS Terminal

**Component:** `components/staff/PosTerminal.tsx`

**Permitted changes (cosmetic only):**
- Session list cards (left panel): larger session label, cleaner elapsed timer badge, better status color
- Pricing tiles: adjust padding, improve active state highlight
- ShiftWidget: ensure it stays visible and clearly shows shift status (open/closed)
- Payment step: move from Dialog to full-screen Sheet (bottom-up on mobile, centered on desktop) — but only if the form fields, validation, and submit call are **100% identical** to current
- Receipt confirmation: clean up the success state UI

**Do NOT change:**
- Any call to `processPayment()`, `closeSession()`, `updateSessionGuests()`
- The numpad logic
- The payment calculation display (subtotal, discount, total)
- The print receipt flow

---

## `/pos/shifts` — Cashier Shifts

**Component:** `components/staff/ShiftsHistoryClient.tsx`, `components/staff/ShiftHistoryTable.tsx`

**Permitted changes:**
- Open shift form: cleaner layout, better opening float input
- Close shift form: cleaner cash count input, difference display
- Shift history: DataTable with date filter and status badges
- Open/close shift → Sheet instead of Dialog

**Do NOT change:**
- `openShift()`, `closeShift()`, `reviewShift()` call signatures
- Shift validation (shift must be open before payment)

---

## `/payment-settings` — Payment Settings

**Component:** `components/admin/PaymentSettingsPage.tsx`

**Permitted changes:**
- Payment methods list: DataTable with type badge, active toggle
- Receiving accounts list: DataTable with type badge
- Create/edit method → Sheet
- Create/edit account → Sheet
- Method↔Account linking → Sheet or inline toggle

Already partially polished in the previous V1 polish phase. V2 brings it in line with the new admin shell.

---

## `/kds` — Kitchen Display System

**Component:** `components/staff/KdsBoard.tsx`

**Permitted changes:**
- Station card: add elapsed timer badge (amber > 5 min, red > 10 min)
- Card header: cleaner table number chip, order time display
- Item list: better spacing, allergen indicators if present
- Station column header: improve label + item count badge

**Do NOT change:**
- The `serveGroup()` / `cancelGroup()` mutations
- Station grouping logic
- Poll interval (3s)
- The `groupItems()` function

---

## `/tables` — Floor Plan

**Component:** `components/staff/TableGrid.tsx`

**Permitted changes:**
- Table card (draggable): improve color coding by status (available=green, occupied=amber, closing=red, linked=blue)
- Side Sheet for table actions: replace the current Dialog with a Sheet that slides in from the right, showing session detail + actions
- Session open dialog: keep as Dialog (small confirm-style), just clean up visual

**Do NOT change:**
- DnD logic (dnd-kit)
- `openSession()`, `closeSession()`, `updateTablePosition()` calls
- `tableStatus` state machine
- Zone color logic

---

## `/queue` — Queue Board

**Component:** `components/staff/QueueBoard.tsx`

**Permitted changes:**
- Queue entry card: larger queue number, better party size display, status badge
- Called entry: distinct visual highlight (primary background)
- Seated entry: muted/crossed-out style
- Action buttons: larger touch targets (min 44px)

**Do NOT change:**
- Queue status transitions (`waiting → called → seated → left`)
- Poll interval (5s)
- Any `callQueue()`, `seatQueue()`, `leaveQueue()` calls

---

## `/kds/history`, `/queue/history`, `/tables/history`, `/pos/history`

All history pages: apply unified DataTable + date filter pattern from admin phase.

These are lower-risk — they're display-only pages with no mutations.

---

## `/printers`

**Component:** `components/staff/PrintersPage.tsx`

Changes: minimal polish only. This page has specialized hardware config UI.
Do not restructure the printer test / config forms.

---

## Touch Target Requirements

All buttons in operational staff pages must have minimum **44×44px** touch target.

```tsx
// Use size="lg" or explicit min-h-[44px] for touch buttons
<Button size="lg" className="min-h-[44px]">...</Button>
```

---

## Testing After Changes

Since Playwright is removed, manual testing checklist:

For POS:
- [ ] Can open a table session
- [ ] Can add/remove guests
- [ ] Can close session
- [ ] Can process payment (cash and QR)
- [ ] Can print receipt
- [ ] Shift widget shows current shift status

For KDS:
- [ ] Items appear by station
- [ ] Serve group marks items as served
- [ ] Cancel group marks items as cancelled
- [ ] New orders appear within 3s

For Tables:
- [ ] Table status colors are correct
- [ ] Can drag table in edit mode
- [ ] Can open session from table
- [ ] Can view session detail

For Queue:
- [ ] Can call a queue entry
- [ ] Can seat a queue entry
- [ ] New entries appear within 5s
