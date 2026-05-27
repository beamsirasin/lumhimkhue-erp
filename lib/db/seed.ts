import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { nanoid } from 'nanoid';
import bcryptjs from 'bcryptjs';
import * as schema from './schema';

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

async function seed() {
  console.log('🌱 Starting seed...');

  // Guard: skip if already seeded
  const existingUsers = await db.select().from(schema.users).limit(1);
  if (existingUsers.length > 0) {
    console.log('⚠️  Database already has data — skipping seed to avoid duplicates.');
    process.exit(0);
  }

  // ── Users ─────────────────────────────────────────────────────────────────
  const passwordHash = await bcryptjs.hash('password123', 12);

  await db.insert(schema.users).values([
    {
      email: 'owner@shabu.local',
      passwordHash,
      name: 'เจ้าของร้าน',
      role: 'owner',
      isActive: true,
    },
    {
      email: 'cashier@shabu.local',
      passwordHash,
      name: 'แคชเชียร์',
      role: 'cashier',
      isActive: true,
    },
    {
      email: 'kitchen@shabu.local',
      passwordHash,
      name: 'พ่อครัว',
      role: 'kitchen',
      isActive: true,
    },
  ]);
  console.log('✅ Users created');

  // ── Pricing Tiers ─────────────────────────────────────────────────────────
  await db.insert(schema.pricingTiers).values([
    {
      code: 'adult',
      name: 'ผู้ใหญ่',
      price: '266.00',
      vatIncluded: true,
      vatRate: '7.00',
      sortOrder: 1,
      isActive: true,
    },
    {
      code: 'child',
      name: 'เด็ก',
      price: '159.00',
      vatIncluded: true,
      vatRate: '7.00',
      sortOrder: 2,
      isActive: true,
    },
    {
      code: 'toddler',
      name: 'เด็กเล็ก',
      price: '0.00',
      vatIncluded: true,
      vatRate: '7.00',
      sortOrder: 3,
      isActive: true,
      notes: 'เด็กที่ยังไม่รับประทานอาหารได้เอง',
    },
    {
      code: 'staff',
      name: 'พนักงาน',
      price: '0.00',
      vatIncluded: true,
      vatRate: '7.00',
      sortOrder: 4,
      isActive: true,
      notes: 'พนักงานร้านหรือพาร์ทเนอร์',
    },
    {
      code: 'staff_guest_first',
      name: 'พนักงานพา (คนแรก)',
      price: '199.00',
      vatIncluded: true,
      vatRate: '7.00',
      sortOrder: 5,
      isActive: true,
      notes: 'แขกที่พนักงานพามา คนแรก (คนถัดไปคิดราคาผู้ใหญ่)',
    },
  ]);
  console.log('✅ Pricing tiers created (5 tiers)');

  // ── Tables ────────────────────────────────────────────────────────────────
  // 10 tables arranged in a 5-column grid (spacing 120px, 20px margin)
  // cols  0   1   2   3   4
  // row0: 1   2   3   4   5    (zone: ทั่วไป)
  // row1: 6   7   8   9  10    (6-7: ทั่วไป, 8-10: VIP)
  const tableRows = Array.from({ length: 10 }, (_, i) => {
    const col = i % 5;
    const row = Math.floor(i / 5);
    return {
      label: String(i + 1),          // "1" … "10"
      capacity: 4,
      zone: i >= 7 ? 'VIP' : 'ทั่วไป',
      status: 'available' as const,
      qrToken: nanoid(16),
      positionX: col * 120 + 20,
      positionY: row * 120 + 20,
      width: 80,
      height: 80,
      shape: 'square' as const,
    };
  });

  await db.insert(schema.tables).values(tableRows);
  console.log('✅ Tables created (10 tables, grid layout)');

  // ── Categories ────────────────────────────────────────────────────────────
  const categoryData = [
    { name: 'เนื้อ',       sortOrder: 1, station: 'meat'      as const },
    { name: 'อาหารทะเล',  sortOrder: 2, station: 'seafood'   as const },
    { name: 'ผัก',         sortOrder: 3, station: 'vegetable' as const },
    { name: 'เส้น',        sortOrder: 4, station: 'noodle'    as const },
    { name: 'ของหวาน',    sortOrder: 5, station: 'dessert'   as const },
    { name: 'เครื่องดื่ม', sortOrder: 6, station: 'drink'     as const },
    { name: 'น้ำจิ้ม',    sortOrder: 7, station: 'sauce'     as const },
  ];

  const insertedCategories = await db
    .insert(schema.categories)
    .values(categoryData)
    .returning();

  const catMap = Object.fromEntries(insertedCategories.map((c) => [c.name, c.id]));
  console.log('✅ Categories created');

  // ── Menu Items ────────────────────────────────────────────────────────────
  const menuData: {
    categoryId: string;
    name: string;
    description?: string;
    isBuffet: boolean;
    extraPrice?: string;
    maxPerOrder?: number;
  }[] = [
    // เนื้อ (buffet)
    { categoryId: catMap['เนื้อ'], name: 'เนื้อวัวสไลซ์',   isBuffet: true, maxPerOrder: 3 },
    { categoryId: catMap['เนื้อ'], name: 'หมูสามชั้น',       isBuffet: true, maxPerOrder: 3 },
    { categoryId: catMap['เนื้อ'], name: 'ไก่สไลซ์',         isBuffet: true, maxPerOrder: 3 },
    { categoryId: catMap['เนื้อ'], name: 'เนื้อแกะ',         isBuffet: true, maxPerOrder: 2 },
    { categoryId: catMap['เนื้อ'], name: 'ลูกชิ้นเนื้อ',     isBuffet: true, maxPerOrder: 5 },

    // อาหารทะเล (buffet)
    { categoryId: catMap['อาหารทะเล'], name: 'กุ้งแม่น้ำ',  isBuffet: true, maxPerOrder: 3 },
    { categoryId: catMap['อาหารทะเล'], name: 'หอยแมลงภู่',  isBuffet: true, maxPerOrder: 5 },
    { categoryId: catMap['อาหารทะเล'], name: 'ปลาหมึก',     isBuffet: true, maxPerOrder: 3 },
    { categoryId: catMap['อาหารทะเล'], name: 'ปู',           isBuffet: true, maxPerOrder: 2 },
    { categoryId: catMap['อาหารทะเล'], name: 'ลูกชิ้นปลา',  isBuffet: true, maxPerOrder: 5 },

    // ผัก (buffet)
    { categoryId: catMap['ผัก'], name: 'ผักบุ้ง',     isBuffet: true, maxPerOrder: 5 },
    { categoryId: catMap['ผัก'], name: 'ผักกาดขาว',   isBuffet: true, maxPerOrder: 5 },
    { categoryId: catMap['ผัก'], name: 'เห็ดรวม',     isBuffet: true, maxPerOrder: 4 },
    { categoryId: catMap['ผัก'], name: 'เต้าหู้ขาว',  isBuffet: true, maxPerOrder: 4 },
    { categoryId: catMap['ผัก'], name: 'ข้าวโพด',     isBuffet: true, maxPerOrder: 3 },

    // เส้น (buffet)
    { categoryId: catMap['เส้น'], name: 'วุ้นเส้น',  isBuffet: true, maxPerOrder: 3 },
    { categoryId: catMap['เส้น'], name: 'เส้นใหญ่',  isBuffet: true, maxPerOrder: 3 },
    { categoryId: catMap['เส้น'], name: 'มาม่า',     isBuffet: true, maxPerOrder: 2 },

    // ของหวาน (buffet)
    { categoryId: catMap['ของหวาน'], name: 'ไอศกรีมวานิลลา',    isBuffet: true, maxPerOrder: 2 },
    { categoryId: catMap['ของหวาน'], name: 'ไอศกรีมช็อคโกแลต',  isBuffet: true, maxPerOrder: 2 },
    { categoryId: catMap['ของหวาน'], name: 'เยลลี่รวม',          isBuffet: true, maxPerOrder: 3 },

    // เครื่องดื่ม (buffet)
    { categoryId: catMap['เครื่องดื่ม'], name: 'น้ำเปล่า', isBuffet: true, maxPerOrder: 5 },
    { categoryId: catMap['เครื่องดื่ม'], name: 'น้ำส้ม',   isBuffet: true, maxPerOrder: 3 },
    { categoryId: catMap['เครื่องดื่ม'], name: 'ชาเขียว',  isBuffet: true, maxPerOrder: 3 },
    { categoryId: catMap['เครื่องดื่ม'], name: 'น้ำอัดลม', isBuffet: true, maxPerOrder: 3 },

    // น้ำจิ้ม (buffet)
    { categoryId: catMap['น้ำจิ้ม'], name: 'น้ำจิ้มสุกี้', isBuffet: true, maxPerOrder: 3 },
    { categoryId: catMap['น้ำจิ้ม'], name: 'น้ำจิ้มซีฟู้ด', isBuffet: true, maxPerOrder: 3 },
    { categoryId: catMap['น้ำจิ้ม'], name: 'ซอสงา',          isBuffet: true, maxPerOrder: 3 },

    // Extra — คิดเงินเพิ่ม (ไม่ใช่ buffet)
    {
      categoryId: catMap['เนื้อ'],
      name: 'เนื้อวากิว A5',
      isBuffet: false,
      extraPrice: '199',
      maxPerOrder: 2,
      description: 'เนื้อวากิวแท้ A5 นำเข้าจากญี่ปุ่น',
    },
    {
      categoryId: catMap['เครื่องดื่ม'],
      name: 'เบียร์สด',
      isBuffet: false,
      extraPrice: '120',
      maxPerOrder: 5,
      description: 'เบียร์สดแก้วใหญ่',
    },
  ];

  await db.insert(schema.menuItems).values(
    menuData.map((item) => ({
      categoryId: item.categoryId,
      name: item.name,
      description: item.description ?? null,
      isBuffet: item.isBuffet,
      extraPrice: item.extraPrice ?? '0',
      maxPerOrder: item.maxPerOrder ?? null,
      cooldownSeconds: 0,
      isAvailable: true,
      allergens: [],
    })),
  );
  console.log('✅ Menu items created (30 items, 2 extra-charge)');

  console.log('');
  console.log('🎉 Seed complete!');
  console.log('');
  console.log('Login credentials:');
  console.log('  owner@shabu.local   / password123  (role: owner)');
  console.log('  cashier@shabu.local / password123  (role: cashier)');
  console.log('  kitchen@shabu.local / password123  (role: kitchen)');
  console.log('');
  console.log('Pricing tiers seeded:');
  console.log('  adult             ฿266  ผู้ใหญ่');
  console.log('  child             ฿159  เด็ก');
  console.log('  toddler           ฿0    เด็กเล็ก');
  console.log('  staff             ฿0    พนักงาน');
  console.log('  staff_guest_first ฿199  พนักงานพา (คนแรก)');
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
