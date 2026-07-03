# Incident Playbook — Lum Him Khue ERP

> For the owner / technical operator. Staff-facing daily procedures live in `RUNBOOK.md`.
> Golden rules for every incident: **1)** don't repeat the failed action blindly,
> **2)** check POS history / reconciliation before "fixing" anything,
> **3)** never hand-edit payment rows in the database,
> **4)** after any money incident run `npm run reconcile:payments` and keep the output.
>
> Approval levels: 🟢 cashier can handle · 🟡 owner/manager decision · 🔴 owner + snapshot first.

---

### 1. Payment saved but receipt did not print 🟢
- **Symptoms:** success screen shown / payment in POS history, no paper.
- **Do:** reprint from history (พิมพ์ซ้ำ). Check printer paper/power/LAN. Try browser-print fallback.
- **Don't:** pay again; delete the payment.
- **Check:** POS → ประวัติ — payment exists with correct amount.
- **Recovery:** printer section (§10); handwritten copy as a stopgap if legally acceptable.
- **Audit:** none needed — money state is correct.

### 2. Receipt printed but payment not found in history 🟡
- **Symptoms:** paper receipt exists; POS history has no matching payment (should be near-impossible post-16C — writes are atomic; a receipt only auto-prints after commit).
- **Do:** search history by table + time; check pos/history on another device (cache). If genuinely absent: treat the receipt as void, collect payment again through the system.
- **Don't:** insert a payment row manually.
- **Check:** `npm run reconcile:payments` (R1–R6); audit report for a `process_payment` entry at that time.
- **Recovery:** if audit shows the payment existed and was deleted → §"suspected fraud" path: review payment_adjustments ledger.
- **Audit:** record incident + receipt photo; reconcile output attached.

### 3. Duplicate payment suspected 🟡
- **Symptoms:** customer says charged twice / two similar receipts.
- **Do:** POS history for that session — two payments? Check bank app for two actual transfers. If a true duplicate exists (pre-16B era or two devices): owner deletes ONE via the delete flow with reason "duplicate", refund the customer.
- **Don't:** delete both; edit amounts.
- **Check:** `npm run reconcile:payments` — R6 (overpaid/double-final) flags it.
- **Approve:** owner (delete is owner-only).
- **Audit:** adjustment ledger row is created automatically by the delete; keep the refund slip.

### 4. Wrong amount paid (over/undercharged) 🟡
- **Do:** small cash error → settle in cash, note it in the shift-close reason. Structural error (wrong bill): owner reopens the payment (reopen flow, reason required) → correct the bill → collect the right amount.
- **Don't:** "fix" by editing guest counts after payment without reopening.
- **Check:** saved bill (charge lines) vs receipt vs payment total; reconcile R3.
- **Approve:** manager can reopen (open shifts); owner for closed shifts.

### 5. Cashier saved wrong customer count 🟢→🟡
- **Before payment:** just edit guests and save again (atomic, safe).
- **After partial payment:** paid heads can't be reduced (guard) — correct only the unpaid part; if truly wrong, owner reopens the payment first.
- **Check:** POS card total matches the corrected bill.

### 6. Tax invoice duplicate suspected 🔴
- **Symptoms:** two receipts showing the same เลขใบกำกับภาษี.
- **Do:** run `npm run reconcile:payments` — **R9** confirms. If confirmed: photograph both, inform the accountant immediately (legal document), issue a corrective invoice per accountant guidance.
- **Don't:** delete either session; reuse the number.
- **Note:** the generator race was fixed in 16C-C3; duplicates should only predate it. New duplicates after 16C-C3 = file a bug immediately.
- **Approve:** owner + accountant.

### 7. Database migration failed 🔴
- **Do:** STOP — do not deploy code that requires the migration. All project migrations are idempotent: re-run **once**. Still failing → read the error; restore the pre-migration Neon snapshot if any partial state is suspected.
- **Check:** `npm run db:check-migrations` tells you exactly what's missing/applied.
- **Don't:** improvise ALTERs by hand; run db:push.
- **Recovery:** MIGRATIONS.md §2 process; append the run record either way.
- **Approve:** owner; snapshot mandatory before retrying.

### 8. Vercel deploy failed / app broken after deploy 🟡
- **Do:** Vercel → Deployments → **promote the previous deployment** (instant rollback). Then debug the build locally (typecheck/lint/test:money).
- **Don't:** hotfix-push repeatedly against a broken production.
- **Check:** deploy logs; `db:check-migrations` against prod (missing migration is the most likely cause for runtime payment failures — e.g. 16B column).
- **Audit:** reconcile after service resumes.

### 9. Neon outage / internet outage 🔴
- **Symptoms:** everything spins; payments fail; QR ordering dead.
- **Do:** switch to paper mode — handwritten order pads + calculator bills + manual receipt book; keep every slip. Check https://neonstatus.com / router. When back: re-enter bills through POS (open table → save bill → pay) so records are complete, or record a summarized end-of-day entry per accountant guidance.
- **Don't:** keep tapping pay (each tap is a new attempt once connectivity flaps — check history first per RUNBOOK §7).
- **Audit:** reconcile after recovery; expect R7a growth if shifts couldn't open — document it.

### 10. Printer offline 🟢
- **Do:** paper → power → cable/Wi-Fi → printer self-test. Try the other transport (USB ↔ network ↔ browser print) in printer settings (/printers). Payments continue working — print later from history.
- **Don't:** block checkout on printing.
- **Escalate:** if no transport works, browser window.print() to any available printer as the fallback.

### 11. Android bridge (POS app) offline 🟡
- **Symptoms:** tablet app can't print via the local bridge.
- **Do:** restart the Android app; check the tablet and printer are on the same LAN; fall back to opening the web POS in a browser (network/browser print transports still work).
- **Check:** print a test page from /printers.
- **Don't:** reinstall/clear app data mid-service (loses local printer config) — do that after close.

---

## After ANY money incident (checklist)

1. `npm run reconcile:payments` — attach the output to the incident note
2. If findings appeared: match them to the incident; do NOT repair data ad hoc — plan the fix, snapshot, execute, re-run reconcile
3. Write one paragraph in the incident log: what happened, when, who, resolution
4. If it revealed a software bug: freeze the affected flow (staff instruction) and file it for a fix phase
