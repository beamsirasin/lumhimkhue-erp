# Performance Baseline — Phase 14

> กรอกตัวเลขก่อนแก้ (Phase A) และหลังแก้ (Phase E) เพื่อเปรียบเทียบ

---

## วิธีวัด

### DB RTT
เรียก `GET /api/debug/db-rtt` บน localhost และ production  
บันทึก sample[0] (cold) และ avg ของ sample[1-9] (warm)

### TTFB
DevTools → Network tab → reload หน้า → document row → Timing → Waiting (TTFB)

### Button response time
DevTools → Network tab → กรอง XHR/Fetch → กดปุ่ม → ดู duration ของ server action call

---

## Before Fix (กรอกก่อน Phase D)

| Metric | localhost | production |
|--------|-----------|------------|
| DB RTT sample[0] — cold | ___ ms | ___ ms |
| DB RTT avg sample[1-9] — warm | ___ ms | ___ ms |
| TTFB /tables | ___ ms | ___ ms |
| TTFB /pos | ___ ms | ___ ms |
| TTFB /kds | ___ ms | ___ ms |
| Button: เปิดโต๊ะ (openSession) | ___ ms | ___ ms |
| Button: ปิดโต๊ะ (closeSession) | ___ ms | ___ ms |
| Button: ชำระเงิน (processPayment) | ___ ms | ___ ms |
| Vercel region (ดูใน response header x-vercel-id) | — | ___ |

---

## After Fix (กรอกหลัง Phase E)

| Metric | localhost | production | Delta |
|--------|-----------|------------|-------|
| DB RTT sample[0] — cold | ___ ms | ___ ms | ___ |
| DB RTT avg sample[1-9] — warm | ___ ms | ___ ms | ___ |
| TTFB /tables | ___ ms | ___ ms | ___ |
| Button: เปิดโต๊ะ | ___ ms | ___ ms | ___ |
| Button: ปิดโต๊ะ | ___ ms | ___ ms | ___ |
| Button: ชำระเงิน | ___ ms | ___ ms | ___ |

---

## Notes

_เพิ่ม observations ที่นี่_
