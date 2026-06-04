import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

async function seedInventory() {
  console.log('🌱 Starting inventory seed...');

  const existing = await db.select().from(schema.ingredientCategories).limit(1);
  if (existing.length > 0) {
    console.log('⚠️  Inventory data already seeded — skipping.');
    process.exit(0);
  }

  // ── Ingredient Categories ────────────────────────────────────────────────
  const categories = await db
    .insert(schema.ingredientCategories)
    .values([
      { name: 'เนื้อสด',              sortOrder: 1 },
      { name: 'อาหารทะเล',            sortOrder: 2 },
      { name: 'ผัก',                   sortOrder: 3 },
      { name: 'เครื่องปรุง/น้ำซุป',   sortOrder: 4 },
      { name: 'ของแห้ง',              sortOrder: 5 },
      { name: 'เครื่องดื่ม',           sortOrder: 6 },
    ])
    .returning();
  console.log('✅ Ingredient categories created (6)');

  const catMap = Object.fromEntries(categories.map((c) => [c.name, c.id]));

  // ── Suppliers ────────────────────────────────────────────────────────────
  const supplierRows = await db
    .insert(schema.suppliers)
    .values([
      {
        name: 'บริษัท เนื้อสด ABC จำกัด',
        contactName: 'คุณสมชาย ใจดี',
        phone: '081-234-5678',
        email: 'contact@fresh-abc.co.th',
        address: '123 ถ.พระราม 9 กรุงเทพฯ 10310',
        taxId: '0105562345678',
        notes: 'ส่งทุกวันจันทร์-ศุกร์ ก่อน 08:00',
      },
      {
        name: 'ตลาดอาหารทะเล XYZ',
        contactName: 'คุณสมหญิง ทะเล',
        phone: '089-876-5432',
        email: 'order@xyz-seafood.th',
        address: '456 ท่าเรือคลองเตย กรุงเทพฯ 10110',
        taxId: '0105563456789',
        notes: 'สั่งล่วงหน้า 1 วัน',
      },
      {
        name: 'ร้านวัตถุดิบครบครัน',
        contactName: 'คุณประสิทธิ์ ครบ',
        phone: '062-111-2233',
        address: '789 ตลาดไท ปทุมธานี 12120',
        taxId: '0105564567890',
        notes: 'ของแห้ง เครื่องปรุง ผัก ส่งสัปดาห์ละ 2 ครั้ง',
      },
    ])
    .returning();
  console.log('✅ Suppliers created (3)');

  const [supplierABC, supplierXYZ, supplierKrob] = supplierRows;

  // ── Ingredients ──────────────────────────────────────────────────────────
  await db.insert(schema.ingredients).values([
    // เนื้อสด
    {
      categoryId: catMap['เนื้อสด'],
      name: 'เนื้อวัวสไลซ์',
      unit: 'กก.',
      minStock: '5.00',
      parLevel: '15.00',
      lastCost: '320.00',
      defaultSupplierId: supplierABC.id,
    },
    {
      categoryId: catMap['เนื้อสด'],
      name: 'หมูสามชั้นสไลซ์',
      unit: 'กก.',
      minStock: '5.00',
      parLevel: '12.00',
      lastCost: '180.00',
      defaultSupplierId: supplierABC.id,
    },
    {
      categoryId: catMap['เนื้อสด'],
      name: 'ไก่สไลซ์',
      unit: 'กก.',
      minStock: '3.00',
      parLevel: '8.00',
      lastCost: '95.00',
      defaultSupplierId: supplierABC.id,
    },
    {
      categoryId: catMap['เนื้อสด'],
      name: 'ลูกชิ้นเนื้อ',
      unit: 'กก.',
      minStock: '2.00',
      parLevel: '6.00',
      lastCost: '160.00',
      defaultSupplierId: supplierABC.id,
    },

    // อาหารทะเล
    {
      categoryId: catMap['อาหารทะเล'],
      name: 'กุ้งแม่น้ำ',
      unit: 'กก.',
      minStock: '3.00',
      parLevel: '8.00',
      lastCost: '350.00',
      defaultSupplierId: supplierXYZ.id,
    },
    {
      categoryId: catMap['อาหารทะเล'],
      name: 'หอยแมลงภู่',
      unit: 'กก.',
      minStock: '3.00',
      parLevel: '7.00',
      lastCost: '120.00',
      defaultSupplierId: supplierXYZ.id,
    },
    {
      categoryId: catMap['อาหารทะเล'],
      name: 'ปลาหมึกสด',
      unit: 'กก.',
      minStock: '2.00',
      parLevel: '5.00',
      lastCost: '200.00',
      defaultSupplierId: supplierXYZ.id,
    },
    {
      categoryId: catMap['อาหารทะเล'],
      name: 'ลูกชิ้นปลา',
      unit: 'กก.',
      minStock: '2.00',
      parLevel: '5.00',
      lastCost: '130.00',
      defaultSupplierId: supplierXYZ.id,
    },

    // ผัก
    {
      categoryId: catMap['ผัก'],
      name: 'ผักกาดขาว',
      unit: 'กก.',
      minStock: '5.00',
      parLevel: '15.00',
      lastCost: '25.00',
      defaultSupplierId: supplierKrob.id,
    },
    {
      categoryId: catMap['ผัก'],
      name: 'ผักบุ้ง',
      unit: 'กก.',
      minStock: '3.00',
      parLevel: '8.00',
      lastCost: '20.00',
      defaultSupplierId: supplierKrob.id,
    },
    {
      categoryId: catMap['ผัก'],
      name: 'เห็ดรวม',
      unit: 'กก.',
      minStock: '3.00',
      parLevel: '8.00',
      lastCost: '80.00',
      defaultSupplierId: supplierKrob.id,
    },
    {
      categoryId: catMap['ผัก'],
      name: 'เต้าหู้ขาว',
      unit: 'แพ็ค',
      minStock: '10.00',
      parLevel: '25.00',
      lastCost: '15.00',
      defaultSupplierId: supplierKrob.id,
    },

    // เครื่องปรุง/น้ำซุป
    {
      categoryId: catMap['เครื่องปรุง/น้ำซุป'],
      name: 'น้ำซุปสุกี้',
      unit: 'ลิตร',
      minStock: '20.00',
      parLevel: '50.00',
      lastCost: '45.00',
      defaultSupplierId: supplierKrob.id,
    },
    {
      categoryId: catMap['เครื่องปรุง/น้ำซุป'],
      name: 'ซีอิ๊วขาว',
      unit: 'ขวด',
      minStock: '5.00',
      parLevel: '12.00',
      lastCost: '35.00',
      defaultSupplierId: supplierKrob.id,
    },

    // เครื่องดื่ม
    {
      categoryId: catMap['เครื่องดื่ม'],
      name: 'น้ำดื่มบรรจุขวด 600ml',
      unit: 'ลัง',
      minStock: '5.00',
      parLevel: '15.00',
      lastCost: '85.00',
      defaultSupplierId: supplierKrob.id,
    },
  ]);
  console.log('✅ Ingredients created (15 items)');

  console.log('');
  console.log('🎉 Inventory seed complete!');
  console.log('  - 6 ingredient categories');
  console.log('  - 3 suppliers');
  console.log('  - 15 ingredients');
}

seedInventory().catch((err) => {
  console.error('❌ Inventory seed failed:', err);
  process.exit(1);
});
