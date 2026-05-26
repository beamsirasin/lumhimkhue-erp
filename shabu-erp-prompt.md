# Shabu Buffet ERP — Project Specification & Build Prompt

> ใช้ไฟล์นี้เป็น **prompt เริ่มต้น** ใน Claude Code และบันทึกเป็น `CLAUDE.md` ที่ root ของ repo ให้ Claude Code อ่านทุกครั้งโดยอัตโนมัติ

---

## 0. ภาพรวมโปรเจกต์ (Project Brief)

สร้างระบบ **ERP SaaS สำหรับร้านชาบูบุฟเฟต์** ในที่เดียว ครอบคลุมทั้งหน้าบ้าน (Customer) และหลังบ้าน (Staff) เป็น **monorepo เดียว** ในรูปแบบ Next.js App Router โดยแยก route groups ตาม persona

**ผู้ใช้:**
- ลูกค้า (ไม่มี account, เข้าผ่าน QR ที่โต๊ะหรือ QR คิว)
- พนักงาน 4 บทบาท: `owner`, `cashier`, `kitchen`, `host`

**ภาษา:** UI เป็นภาษาไทยทั้งหมด, comment และ code identifier เป็นภาษาอังกฤษ, สกุลเงิน THB

**ดีไซน์:** ทันสมัย สะอาด อ่านง่าย mobile-first สำหรับลูกค้า, desktop/tablet สำหรับ staff

---

## 1. Tech Stack (เลือกตามนี้เท่านั้น)

| Layer | Tool | Version |
|---|---|---|
| Framework | Next.js (App Router) | 15.x |
| Language | TypeScript (strict mode) | 5.x |
| Styling | Tailwind CSS | 4.x |
| UI Components | shadcn/ui | latest |
| Icons | lucide-react | latest |
| Fonts | IBM Plex Sans Thai (Google Fonts) | — |
| Database | Neon Postgres (serverless) | — |
| ORM | Drizzle ORM + drizzle-kit | latest |
| DB Driver | `@neondatabase/serverless` | latest |
| Auth | Auth.js (NextAuth) v5 + Credentials provider | 5.x |
| Validation | Zod | latest |
| Forms | react-hook-form + @hookform/resolvers | latest |
| State (client) | Zustand (เฉพาะ cart ลูกค้า) | latest |
| Data fetching | TanStack Query v5 (สำหรับ polling KDS/Queue) | latest |
| Date/time | date-fns + date-fns-tz (timezone: Asia/Bangkok) | latest |
| QR generation | `qrcode` (server-side) | latest |
| Charts (dashboard) | Recharts | latest |
| Tables (dashboard) | TanStack Table | latest |
| Notifications | sonner (toast) | latest |
| Password hashing | argon2 หรือ bcryptjs | — |
| Deployment | Vercel | — |

**ห้ามใช้:**
- ❌ Prisma (ใช้ Drizzle เท่านั้น เพื่อ compat กับ Neon serverless)
- ❌ Pusher / Ably / Socket.io (ใช้ polling แทน)
- ❌ External payment gateway (POS แค่บันทึก payment method)
- ❌ SMS/Email service ภายนอก (ลูกค้าเช็คคิวผ่าน QR ไม่ต้อง notify)
- ❌ Redis / queue ภายนอก (ทำงานบน Vercel + Neon เท่านั้น)

---

## 2. โครงสร้างโปรเจกต์ (Folder Structure)

```
/
├── app/
│   ├── (customer)/                  # ลูกค้า, ไม่ต้อง login
│   │   ├── t/[tableToken]/          # หน้าโต๊ะ (เปิด session, สั่งอาหาร, ดูสถานะ)
│   │   ├── q/[queueToken]/          # หน้าเช็คคิว
│   │   └── layout.tsx
│   ├── (staff)/                     # ต้อง login
│   │   ├── pos/                     # หน้า POS / แคชเชียร์
│   │   ├── kds/                     # Kitchen Display System
│   │   ├── queue/                   # จัดการคิว (host)
│   │   ├── tables/                  # จัดการสถานะโต๊ะ
│   │   └── layout.tsx
│   ├── (admin)/                     # เฉพาะ owner
│   │   ├── dashboard/               # หน้าหลัก dashboard
│   │   ├── menu/                    # จัดการเมนู
│   │   ├── packages/                # จัดการแพ็กเกจบุฟเฟต์
│   │   ├── users/                   # จัดการพนักงาน
│   │   ├── reports/                 # รายงาน
│   │   ├── settings/                # ตั้งค่าร้าน
│   │   └── layout.tsx
│   ├── login/
│   ├── api/
│   │   ├── auth/[...nextauth]/
│   │   └── webhooks/                # (เผื่ออนาคต)
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── ui/                          # shadcn primitives
│   ├── customer/                    # CustomerMenu, OrderCart, BuffetTimer, etc.
│   ├── staff/                       # KDSCard, POSPanel, TableGrid, etc.
│   └── shared/                      # AppHeader, Loading, EmptyState, etc.
├── lib/
│   ├── db/
│   │   ├── schema.ts                # Drizzle schema ทั้งหมด
│   │   ├── index.ts                 # db client + neon connection
│   │   └── seed.ts                  # seed script (menu, packages, demo user)
│   ├── auth/
│   │   ├── config.ts                # Auth.js config
│   │   └── permissions.ts           # canDo(user, action) helper
│   ├── actions/                     # Server Actions แยกตาม domain
│   │   ├── orders.ts
│   │   ├── sessions.ts
│   │   ├── queue.ts
│   │   ├── tables.ts
│   │   ├── menu.ts
│   │   └── payments.ts
│   ├── validations/                 # Zod schemas
│   └── utils.ts
├── drizzle/                         # migrations (auto-generated)
├── public/
├── middleware.ts                    # auth + role guard
├── drizzle.config.ts
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
├── .env.local                       # DATABASE_URL, AUTH_SECRET, NEXT_PUBLIC_APP_URL
└── CLAUDE.md                        # ไฟล์นี้
```

---

## 3. Database Schema (Drizzle ORM)

สร้างใน `lib/db/schema.ts` ใช้ pgTable, references, enums ตามนี้:

### Enums
```ts
roleEnum         = ['owner', 'cashier', 'kitchen', 'host']
tableStatusEnum  = ['available', 'occupied', 'cleaning', 'reserved']
sessionStatus    = ['active', 'closing', 'closed']
orderStatus      = ['pending', 'preparing', 'ready', 'served', 'cancelled']
itemStatus       = ['pending', 'preparing', 'ready', 'served', 'cancelled']
stationEnum      = ['meat', 'seafood', 'vegetable', 'noodle', 'dessert', 'drink', 'sauce']
queueStatus      = ['waiting', 'called', 'seated', 'left']
paymentMethod    = ['cash', 'qr_promptpay', 'transfer', 'card']
```

### Tables

**users** — `id uuid pk, email unique, passwordHash, name, role, isActive, createdAt, updatedAt`

**tables** — `id uuid pk, number int unique, capacity int, zone text, status, qrToken text unique`
- `qrToken` ใช้ใน URL `/t/[qrToken]/init` (สำหรับลูกค้าเริ่ม session) — เป็น static token ของโต๊ะ, ไม่หมดอายุ

**packages** — `id uuid pk, name, priceAdult numeric(10,2), priceChild, priceSenior, durationMinutes int, description, isActive bool`

**sessions** — `id uuid pk, tableId fk, packageId fk, adults int, children int, seniors int, startedAt, endsAt, closedAt nullable, status, sessionToken text unique`
- `sessionToken` ใช้ใน URL `/t/[tableToken]/s/[sessionToken]` (ลูกค้าเข้าหลังเปิดโต๊ะ) — สั้นๆ 12 ตัวอักษร, ใช้ครั้งเดียวต่อ session
- `endsAt = startedAt + durationMinutes` (คำนวณตอนเปิด session)

**categories** — `id uuid pk, name, sortOrder int, station, isActive`

**menuItems** — `id uuid pk, categoryId fk, name, description, imageUrl, isBuffet bool, extraPrice numeric(10,2) default 0, maxPerOrder int nullable, cooldownSeconds int default 0, isAvailable bool, allergens jsonb default '[]'`
- `isBuffet=true` → รวมในแพ็กเกจ, `extraPrice` = 0
- `isBuffet=false` → คิดเงินเพิ่มต่อจาน (เช่น เนื้อพรีเมียม, เครื่องดื่มแอลกอฮอล์)
- `maxPerOrder` = จำนวนสูงสุดที่สั่งได้ต่อ 1 รอบ (กันสั่งเหลือทิ้ง)
- `cooldownSeconds` = กี่วินาทีถึงสั่งซ้ำได้

**orders** — `id uuid pk, sessionId fk, orderedBySeat int nullable, status, createdAt, servedAt nullable`

**orderItems** — `id uuid pk, orderId fk, menuItemId fk, quantity int, notes text, station (copied from category), status, preparedAt, servedAt`

**queueEntries** — `id uuid pk, queueNumber text (เช่น 'A-001'), customerName, phone nullable, partySize int, preferredZone nullable, status, publicToken text unique, createdAt, calledAt, seatedAt`
- `publicToken` ใช้ใน URL `/q/[publicToken]` ที่ลูกค้าสแกนเพื่อเช็คสถานะ

**payments** — `id uuid pk, sessionId fk unique, subtotal, serviceCharge, discount, wasteCharge, total, paymentMethod, receivedAmount, changeAmount, paidAt, processedBy fk users, notes`

**auditLogs** — `id uuid pk, userId fk nullable, action, entity, entityId text, metadata jsonb, createdAt`

### Indexes
- `tables.qrToken`, `sessions.sessionToken`, `queueEntries.publicToken` (unique lookups)
- `orders.sessionId`, `orderItems.orderId`, `orderItems.station + status` (KDS query)
- `sessions.status` (active session list)
- `auditLogs.createdAt` (DESC, for recent activity)

### Relations
Define `relations()` ทั้งหมดเพื่อใช้ Drizzle's relational queries

### Seed Data
สร้าง `lib/db/seed.ts` ที่:
- สร้าง user `owner@shabu.local` / `password123` role=owner
- สร้าง 10 โต๊ะ (1-10) capacity 4 พร้อม qrToken
- สร้าง 1 package "ชาบูบุฟเฟต์ 90 นาที" ราคา 299/199/259 (ผู้ใหญ่/เด็ก/Senior) duration 90
- สร้าง categories: เนื้อ, อาหารทะเล, ผัก, เส้น, ของหวาน, เครื่องดื่ม, น้ำจิ้ม
- สร้าง menu items ~30 รายการกระจายตาม category พร้อม `isBuffet=true` เป็นค่าเริ่มต้น
- สร้าง 2 รายการ `isBuffet=false` (เนื้อวากิว +199, เบียร์ +120) เพื่อทดสอบ extra charge

---

## 4. Auth & Authorization

- ใช้ **Auth.js v5** + **Credentials provider** (email + password)
- Session strategy: JWT (เพราะ Neon serverless ไม่ดีกับ session table query บ่อย)
- เก็บ `role` ใน JWT token
- `middleware.ts` ตรวจสิทธิ์ตาม path:
  - `/(staff)/*` → ต้อง login (any role except customer-none)
  - `/(admin)/*` → ต้อง role=owner
  - `/login`, `/(customer)/*`, `/api/auth/*` → public
- `lib/auth/permissions.ts` ฟังก์ชัน `can(role, action)`:
  - owner: ทำได้ทุกอย่าง
  - cashier: pos, payments, view tables, view queue
  - kitchen: kds เท่านั้น (mark item ready/served)
  - host: queue management, tables status, open session

---

## 5. Module Specifications

### 5.1 Customer Ordering (QR) — `/t/[tableToken]`

**Flow:**
1. ลูกค้าเดินเข้าร้าน → host เปิด session ที่โต๊ะใน POS → ระบบ generate `sessionToken` ใหม่ → host ส่ง URL `/t/[tableToken]/s/[sessionToken]` ให้ลูกค้า (หรือพิมพ์ QR slip ใหม่)
2. ลูกค้าเข้าหน้าเมนู เห็น:
   - **Buffet timer** ด้านบน (countdown ใหญ่ๆ "เหลือเวลา 1:23:45")
   - **Tabs ตาม category** (เนื้อ | อาหารทะเล | ผัก | ...)
   - **Card เมนู** มีรูป ชื่อ ราคาเพิ่ม (ถ้ามี) ปุ่ม + / -
   - **Floating cart** ด้านล่างแสดงจำนวนรายการในรอบ + ปุ่ม "ส่งออเดอร์"
3. กดส่งออเดอร์ → server action ตรวจ:
   - session ยังไม่หมดเวลา
   - แต่ละ item ไม่เกิน `maxPerOrder`
   - แต่ละ item ผ่าน `cooldownSeconds` แล้ว (ดู order ล่าสุด)
4. สร้าง `orders` + `orderItems` row → cart clear → toast "ส่งออเดอร์แล้ว"

**ปุ่มอื่นที่ต้องมี:**
- "เรียกพนักงาน" → สร้าง audit log + ขึ้นแจ้งเตือนใน POS
- "ดูออเดอร์ของฉัน" → list orderItems ของ session นี้พร้อมสถานะ (`pending`/`preparing`/`ready`/`served`)
- "เช็คบิล" → ขึ้นแจ้งเตือนใน POS ว่าโต๊ะนี้พร้อมจ่าย

**Mobile-first:** ทดสอบ viewport 375px เป็นหลัก, font ใหญ่อ่านง่าย, ปุ่ม minimum 44px tap target

### 5.2 Kitchen Display System (KDS) — `/kds`

**Layout:**
- เลือก station จาก dropdown ด้านบน (เนื้อ / อาหารทะเล / ... / ทั้งหมด)
- แสดงเป็น **grid ของ cards** เรียงตามเวลา (เก่า → ใหม่)
- แต่ละ card = 1 order มี:
  - หมายเลขโต๊ะใหญ่ๆ + เวลาที่ออเดอร์เข้า + **counter นับขึ้น** (00:42, 01:35, ...)
  - รายการ items เฉพาะของ station นี้ พร้อม quantity และ note
  - สีเปลี่ยน: < 5 นาที = ขาว/น้ำเงิน, 5-10 = เหลือง, > 10 = แดง
  - ปุ่ม "พร้อมเสิร์ฟ" ต่อ item → mark `itemStatus = ready`
  - ปุ่ม "เสร็จ" ทั้ง card → mark items ทั้งหมดของ station นี้เป็น ready

**Realtime ผ่าน polling:**
- ใช้ TanStack Query `useQuery` + `refetchInterval: 3000` ดึง active order items ของ station ที่เลือก
- เพิ่ม `refetchOnWindowFocus: true`
- ไม่ต้องใช้ WebSocket / SSE สำหรับ v1

**Auto-promote logic:**
- เมื่อ `orderItems` ของ order ทั้งหมดเป็น `ready` → server action update `orders.status = 'ready'`
- เมื่อ POS กด "เสิร์ฟแล้ว" ที่ตัว order → ทุก item เป็น `served`

### 5.3 Queue System — `/queue` (host) + `/q/[publicToken]` (ลูกค้า)

**ฝั่ง host (`/queue`):**
- ฟอร์มเพิ่มคิว: ชื่อ, เบอร์ (optional), จำนวนคน, โซนที่ต้องการ (optional)
- ระบบ generate:
  - `queueNumber` = letter + 3-digit (เริ่ม A-001 ทุกวัน, reset เที่ยงคืน) — ตัวอักษรเปลี่ยนตาม preferred zone (A=ทั่วไป, V=VIP)
  - `publicToken` = nanoid 10 ตัวอักษร
- แสดง 2 ส่วน:
  - **กำลังรอ** (status=waiting) เรียงตาม createdAt
  - **เรียกแล้ว** (status=called) — รอเข้าโต๊ะ
- ปุ่มต่อแต่ละแถว: "เรียก" (waiting → called, set calledAt), "เข้าโต๊ะแล้ว" (called → seated, set seatedAt — ต้องเลือกโต๊ะที่ available), "ไม่มา" (→ left)
- ปุ่ม **พิมพ์/แสดง QR** → modal แสดง QR ของ `https://[domain]/q/[publicToken]` ใหญ่ๆ ให้ลูกค้าสแกน

**ฝั่งลูกค้า (`/q/[publicToken]`):**
- แสดง:
  - หมายเลขคิวของลูกค้าเอง ใหญ่มากๆ
  - "ขณะนี้เรียก: A-007"
  - "อีก 3 คิวก่อนถึงคุณ"
  - "เวลารอโดยประมาณ: 15-20 นาที" (คำนวณจากค่าเฉลี่ย seatedAt - calledAt ของ 10 คิวล่าสุด)
- ใช้ polling 10 วินาที
- ถ้า status=called → เปลี่ยนหน้าจอเขียวสว่าง ตัวหนังสือใหญ่ "🔔 ถึงคิวคุณแล้ว!" + sound (Web Audio API beep, optional vibrate via Vibration API)
- ถ้า status=seated/left → แสดงข้อความขอบคุณ/ลาก่อน

### 5.4 Table Management — `/tables`

- แสดงโต๊ะทั้งหมดเป็น **grid cards** จัดตาม zone
- แต่ละ card แสดง:
  - หมายเลขโต๊ะ, capacity
  - สถานะ (สีต่างกัน: available=เขียว, occupied=แดง, cleaning=ส้ม, reserved=ฟ้า)
  - ถ้า occupied → แสดงเวลาที่เปิด session, เหลือเวลา, จำนวนคน, ยอดปัจจุบัน
- คลิก card → modal action ตามสถานะ:
  - available → ปุ่ม "เปิดโต๊ะ" → เลือก package, จำนวนผู้ใหญ่/เด็ก/Senior → สร้าง session + sessionToken
  - occupied → ปุ่ม "ดูออเดอร์", "เพิ่มเวลา (+15 นาที)", "ปิดบิล"
  - cleaning → ปุ่ม "พร้อมใช้งาน" → กลับเป็น available
- ปุ่ม "เปิดโต๊ะ" หลังจาก create session แล้ว แสดง QR + URL ให้ลูกค้าสแกนทันที

### 5.5 POS — `/pos`

**Layout (3 columns):**
- ซ้าย: รายการโต๊ะที่กำลังเปิด (active sessions) — คลิกเลือก
- กลาง: รายละเอียดของโต๊ะที่เลือก — orders/items ทั้งหมด, ยอดสะสม
- ขวา: ใบเสร็จ + ปุ่ม checkout

**Checkout flow:**
1. เลือก session → เห็นยอดอัตโนมัติ:
   - subtotal = (priceAdult × adults) + (priceChild × children) + (priceSenior × seniors) + Σ(extraPrice × quantity ของ items ที่ `isBuffet=false`)
   - serviceCharge = 0 (ปรับได้ใน settings, default 0%)
2. ปุ่ม "เพิ่มส่วนลด" → input บาทหรือ %
3. ปุ่ม "ค่าเหลือทิ้ง" → input บาท (manual)
4. เลือก payment method: cash / qr_promptpay / transfer / card
5. ถ้า cash → input received amount, แสดงเงินทอน
6. ถ้า qr_promptpay → แสดง static QR PromptPay (อ่านจาก settings, ไม่ integrate gateway) + ปุ่มยืนยันว่าได้รับเงิน
7. กด "ยืนยันชำระ" → สร้าง `payments` row, set `sessions.status='closed'` + `closedAt`, set table status = `cleaning`
8. หน้าจอแสดงสรุป + ปุ่ม "พิมพ์ใบเสร็จ" (ใช้ `window.print()` + print CSS, ขนาดกระดาษ 80mm)

**แจ้งเตือนในมุมขวาบน:**
- รายการ "ลูกค้าเรียกพนักงาน" / "ลูกค้าขอเช็คบิล" (poll ทุก 5 วินาที)
- กดเพื่อ acknowledge (เก็บ audit log)

### 5.6 Owner Dashboard — `/dashboard`

**Cards ด้านบน (KPI):**
- ยอดขายวันนี้
- จำนวน sessions วันนี้
- ค่าเฉลี่ยต่อโต๊ะ
- จำนวนคิวที่รับวันนี้

**Charts:**
- กราฟแท่งยอดขาย 7 วันย้อนหลัง (recharts BarChart)
- กราฟวงกลม payment method distribution
- กราฟเส้น peak hours (ยอดขายต่อชั่วโมง วันนี้)

**Tables:**
- Top 10 menu items (count + qty)
- Sessions ล่าสุด 20 รายการ

**Sub-pages ของ admin:**
- `/menu` — CRUD เมนู + categories (ใช้ shadcn `<Sheet>` สำหรับ form)
- `/packages` — CRUD packages
- `/users` — CRUD พนักงาน (reset password, toggle active)
- `/reports` — date range picker → export CSV (sessions, payments, items)
- `/settings` — ชื่อร้าน, ที่อยู่, เลข tax, PromptPay QR (upload รูป), service charge %

---

## 6. UI/UX Guidelines

**ดีไซน์ direction:**
- โทนหลัก: **น้ำเงินเข้ม + ขาว** (สื่อสะอาด ปลอดภัย) หรือ **แดงเข้ม + ครีม** (ชาบู feel) — เลือกอย่างใดอย่างหนึ่ง consistent
- ใช้ **shadcn/ui defaults** เป็นพื้นฐาน (slate base color), ปรับ primary color เท่านั้น
- **ไม่มี gradient, ไม่มี shadow ฟุ้งๆ** — flat clean design
- Spacing generous, font weight 400/500 เท่านั้น (ไม่ใช้ 600/700)
- **Border radius:** `rounded-lg` (8px) เป็น default

**Typography:**
- หัวข้อใหญ่: 24-28px, weight 500
- หัวข้อ section: 18-20px, weight 500
- Body: 14-16px, weight 400
- Numeric (ยอดเงิน, เวลา): ใช้ font tabular-nums

**Responsive:**
- Customer pages: mobile-first (375px → up)
- Staff pages: tablet/desktop (768px → up), แต่ POS/KDS ใช้งานได้ดีบน 1024px+
- Admin dashboard: 1280px+ optimal

**Empty / loading / error states:**
- ทุกหน้าต้องมี:
  - Skeleton (shadcn Skeleton component) ตอน loading
  - Empty state พร้อมไอคอน + ข้อความแนะนำ
  - Error boundary + ปุ่ม "ลองใหม่"

**Accessibility:**
- Color contrast ≥ WCAG AA
- ปุ่มต้องมี aria-label เมื่อมีแต่ icon
- Form ทุกตัวมี label (ใช้ shadcn `<Label>`)

---

## 7. Realtime Strategy (Polling-based)

เนื่องจากไม่ใช้ Pusher/WebSocket ทุก realtime ทำด้วย polling ผ่าน TanStack Query:

| Page | Interval | Stale time |
|---|---|---|
| KDS | 3 วินาที | 0 |
| Queue (customer view) | 10 วินาที | 5 วินาที |
| Queue (host view) | 5 วินาที | 2 วินาที |
| Tables grid | 5 วินาที | 2 วินาที |
| POS notifications | 5 วินาที | 0 |
| Customer "my orders" | 10 วินาที | 5 วินาที |
| Customer buffet timer | client-side `setInterval` 1 วินาที (ไม่ poll server) |
| Dashboard | 60 วินาที | 30 วินาที |

ใช้ `refetchOnWindowFocus: true` และ `refetchOnReconnect: true` ทุก query

**Database query optimization:**
- KDS query ต้อง index จัด — `orderItems` join `orders` where `station = ? AND status IN ('pending', 'preparing')`
- ห้าม N+1 — ใช้ Drizzle relational query ดึงทุกอย่างใน roundtrip เดียว
- ทุก query ต้องมี LIMIT (default 100)

---

## 8. Coding Standards

**TypeScript:**
- `strict: true`, `noUncheckedIndexedAccess: true`
- ไม่มี `any` — ใช้ `unknown` + type guard
- Export types จาก Drizzle schema ด้วย `$inferSelect` / `$inferInsert`

**Server Actions:**
- ทุก mutation ผ่าน server action ใน `lib/actions/*.ts`
- ทุก action เริ่มด้วย:
  ```ts
  'use server';
  // 1. ตรวจ session ผ่าน auth()
  // 2. ตรวจ permission
  // 3. validate input ด้วย Zod
  // 4. execute query ใน transaction (ถ้ามีหลาย step)
  // 5. revalidatePath / revalidateTag
  // 6. return { ok: true, data } | { ok: false, error }
  ```
- ไม่ throw error ใน action — return discriminated union
- Client เรียกผ่าน react-hook-form `onSubmit` หรือ button `formAction`

**Validation:**
- ทุก input (form, URL param, search param) ผ่าน Zod schema ใน `lib/validations/*.ts`
- Schema export type ใช้ใน form

**Database queries:**
- Drizzle queries เก็บใน `lib/actions/*.ts` (ไม่แยกเป็น repository layer สำหรับ v1)
- ใช้ `db.transaction()` สำหรับ multi-step (เช่น เปิด session + update table status)

**Error handling:**
- `error.tsx` ในทุก route group
- `not-found.tsx` ในทุก dynamic route
- Toast แสดง error message ที่อ่านเข้าใจง่ายเป็นไทย

**File naming:**
- Components: `PascalCase.tsx`
- Utilities: `camelCase.ts`
- Routes: lowercase ตาม Next.js convention

**Comments:**
- เฉพาะที่จำเป็นต่อความเข้าใจ business logic
- ห้าม comment อธิบายโค้ดที่ obvious

**Git commits:**
- Conventional commits: `feat:`, `fix:`, `refactor:`, `chore:`
- 1 feature = 1 commit (atomic)

---

## 9. Environment Variables

```bash
# .env.local
DATABASE_URL="postgresql://...neon..."
AUTH_SECRET="..."                    # openssl rand -base64 32
AUTH_TRUST_HOST=true
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

ใน Vercel ตั้งทั้ง 4 ตัว และเปลี่ยน `NEXT_PUBLIC_APP_URL` เป็น domain จริง

---

## 10. Development Phases (ทำตามลำดับ)

> **กฎสำคัญ:** ห้ามข้าม phase, ห้ามทำหลาย phase พร้อมกัน — จบ phase นึงให้รันได้ดูได้ก่อน แล้วค่อยขึ้น phase ถัดไป

### Phase 1 — Foundation (Day 1)
1. `npx create-next-app@latest` ด้วย TypeScript, Tailwind, App Router, src dir = no
2. ติดตั้ง shadcn/ui (`npx shadcn@latest init`) — base color slate
3. ติดตั้ง: drizzle-orm, drizzle-kit, @neondatabase/serverless, next-auth@beta, zod, react-hook-form, @hookform/resolvers, @tanstack/react-query, zustand, date-fns, date-fns-tz, qrcode, recharts, sonner, argon2 (หรือ bcryptjs), nanoid
4. เพิ่ม shadcn components ที่ต้องใช้: button, card, input, label, form, dialog, sheet, select, table, tabs, toast/sonner, skeleton, badge, separator, dropdown-menu, command, popover, calendar
5. สร้าง `lib/db/schema.ts` + `drizzle.config.ts` → push schema ขึ้น Neon
6. สร้าง `lib/db/seed.ts` + เพิ่ม `"db:seed": "tsx lib/db/seed.ts"` ใน package.json
7. ตั้งค่า IBM Plex Sans Thai ใน `app/layout.tsx`
8. ตั้งค่า TanStack Query provider ใน root layout
9. ตั้งค่า sonner Toaster ใน root layout
10. Commit: `feat: scaffold project with db schema and seed`

### Phase 2 — Auth (Day 2)
1. Auth.js v5 config + Credentials provider
2. หน้า `/login` พร้อม form (email + password)
3. `middleware.ts` ป้องกัน route
4. `lib/auth/permissions.ts`
5. AppHeader แสดงชื่อ user + logout
6. ทดสอบ login ด้วย seed user
7. Commit: `feat: add auth with role-based middleware`

### Phase 3 — Table Management + Open Session (Day 3)
1. หน้า `/tables` แสดง grid
2. Server action `openSession`, `closeSession`, `setTableCleaning`, `setTableAvailable`
3. Modal เปิดโต๊ะ (เลือก package, จำนวนคน) → คืน sessionToken + แสดง QR
4. ทดสอบเปิดโต๊ะ
5. Commit: `feat: table management and session creation`

### Phase 4 — Customer Ordering (Day 4-5)
1. หน้า `/t/[tableToken]/s/[sessionToken]` (จะตรวจว่า session valid, ยังไม่หมดเวลา)
2. Component: BuffetTimer (countdown)
3. Component: CategoryTabs + MenuGrid + MenuCard
4. Zustand store: cart
5. Component: FloatingCart + SubmitButton
6. Server action `placeOrder` (validate maxPerOrder, cooldown, session active)
7. หน้า "ออเดอร์ของฉัน" (list orderItems ของ session นี้, polling)
8. ปุ่ม "เรียกพนักงาน" + "เช็คบิล" (สร้าง audit log)
9. Commit: `feat: customer ordering flow with QR menu`

### Phase 5 — Kitchen Display (Day 6)
1. หน้า `/kds` + station selector
2. Query active orderItems ของ station (polling 3 วินาที)
3. Component: KDSCard พร้อม timer counter (client-side `useEffect` + setInterval)
4. Server action `markItemReady`, `markOrderReady`
5. Logic auto-promote order status
6. Commit: `feat: kitchen display system with polling`

### Phase 6 — Queue System (Day 7)
1. หน้า `/queue` (host) — form + waiting list + called list
2. Server action `addQueueEntry`, `callQueue`, `seatQueue`, `markLeft`
3. Generate queueNumber + publicToken
4. Modal "พิมพ์ QR" ของแต่ละ entry
5. หน้า `/q/[publicToken]` (customer view) + polling 10s
6. คำนวณ estimated wait time
7. Beep + visual alert เมื่อ status=called
8. Commit: `feat: queue system with QR check-in`

### Phase 7 — POS (Day 8-9)
1. หน้า `/pos` 3-column layout
2. Component: ActiveSessionsList (polling 5s)
3. Component: SessionDetail (orders + items)
4. Component: BillSummary (subtotal calculator)
5. Component: CheckoutPanel (payment method, received amount, change)
6. Server action `processPayment` (สร้าง payment, close session, set table cleaning)
7. Print receipt (window.print + print CSS @media print 80mm)
8. NotificationBell (poll audit logs ของ "call_staff" / "request_bill" ในชั่วโมงล่าสุด)
9. Commit: `feat: POS with checkout and receipt printing`

### Phase 8 — Owner Dashboard (Day 10-11)
1. หน้า `/dashboard` — KPI cards + charts (recharts)
2. หน้า `/menu` — CRUD เมนู + categories
3. หน้า `/packages` — CRUD packages
4. หน้า `/users` — CRUD พนักงาน
5. หน้า `/reports` — date range + CSV export
6. หน้า `/settings` — ชื่อร้าน, PromptPay QR upload, service charge
7. Commit: `feat: owner dashboard with CRUD and reports`

### Phase 9 — Polish + Deploy (Day 12)
1. Loading skeletons ทุกหน้า
2. Empty states
3. Error boundaries
4. Mobile responsiveness audit (Chrome DevTools)
5. Print receipt CSS test
6. Push GitHub → connect Vercel → ตั้ง env vars
7. Run seed ใน production Neon (`tsx lib/db/seed.ts` แบบมี guard ไม่ run ซ้ำ)
8. Smoke test ทั้ง flow บน production URL
9. Commit: `chore: production polish and deployment`

---

## 11. งานแรก — ขอให้ Claude Code ทำตอนนี้

อ่าน spec ทั้งหมดข้างบนแล้วเริ่ม **Phase 1 — Foundation** เท่านั้น โดยทำตามนี้:

1. ถามผมว่า "เริ่มในโฟลเดอร์ว่าง หรือมีโปรเจกต์อยู่แล้ว?" และ "Neon connection string มีหรือยัง?"
2. ถ้ายังไม่มี Neon ให้บอกขั้นตอนสมัครและสร้าง project แบบสั้นๆ
3. รัน `create-next-app` ด้วย flags ที่ถูกต้อง
4. ติดตั้ง dependencies ทั้งหมดที่ระบุใน Phase 1
5. สร้าง `lib/db/schema.ts` ตาม schema ด้านบน — เต็มรูปแบบ ทุก table ทุก enum ทุก relation ทุก index
6. สร้าง `drizzle.config.ts` + `lib/db/index.ts`
7. สร้าง `lib/db/seed.ts` ตามที่ระบุ
8. ตั้งค่า IBM Plex Sans Thai + TanStack Query provider + Sonner Toaster ใน `app/layout.tsx`
9. สร้าง `.env.local.example` (template) และอธิบายให้ผมก๊อปไป `.env.local` แล้วใส่ค่าจริง
10. แสดงคำสั่งให้รัน:
    - `npm run db:push`
    - `npm run db:seed`
    - `npm run dev`
11. **หยุดที่นี่** — ยังไม่ทำ Phase 2 จนกว่าผมจะยืนยัน

**ข้อบังคับสำคัญ:**
- ทำทีละไฟล์ ทีละก้อน อ่านง่าย review ง่าย
- ทุกไฟล์ที่สร้าง ต้องผ่าน TypeScript check (no error)
- ถ้าไม่แน่ใจการตัดสินใจอะไร **ถามก่อน** อย่าเดา
- ถ้าผมขอสิ่งที่ขัดกับ spec นี้ ให้เตือนผมก่อน
- ทุก commit message เป็นภาษาอังกฤษตาม conventional commits
- รักษา code quality สูง — ถ้าเขียนแบบรีบๆ ให้เขียนใหม่
