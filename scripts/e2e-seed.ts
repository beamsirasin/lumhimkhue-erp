import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import { drizzle } from 'drizzle-orm/neon-http';

import * as schema from '../lib/db/schema';

function getSafeE2eDatabaseUrl() {
  const databaseUrl = process.env.E2E_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('E2E_DATABASE_URL is required for E2E seed. Refusing to seed DATABASE_URL.');
  }

  const parsed = new URL(databaseUrl);
  const host = parsed.hostname.toLowerCase();
  const databaseName = parsed.pathname.toLowerCase();
  const safeLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const namedForTests = `${host}${databaseName}`.includes('test') || `${host}${databaseName}`.includes('e2e');

  if (!safeLocalHost && !namedForTests) {
    throw new Error('Refusing to seed a database that is not clearly local/test/e2e.');
  }

  return databaseUrl;
}

const databaseUrl = getSafeE2eDatabaseUrl();
const sql = neon(databaseUrl);
const db = drizzle(sql, { schema });

async function clearData() {
  await db.delete(schema.payrollAbsences);
  await db.delete(schema.payrollDeductions);
  await db.delete(schema.payrollItems);
  await db.delete(schema.payrollCycles);
  await db.delete(schema.timeEntries);
  await db.delete(schema.scheduleEntries);
  await db.delete(schema.scheduleCycles);
  await db.delete(schema.employees);
  await db.delete(schema.hrSettings);
  await db.delete(schema.goodsReceiptItems);
  await db.delete(schema.goodsReceipts);
  await db.delete(schema.purchaseOrderItems);
  await db.delete(schema.purchaseOrders);
  await db.delete(schema.stockCountAdjustments);
  await db.delete(schema.stockCountItems);
  await db.delete(schema.stockCounts);
  await db.delete(schema.recipeIngredients);
  await db.delete(schema.recipes);
  await db.delete(schema.paymentLineItems);
  await db.delete(schema.payments);
  await db.delete(schema.orderItems);
  await db.delete(schema.orders);
  await db.delete(schema.sessionGuests);
  await db.delete(schema.customerVisits);
  await db.delete(schema.sessions);
  await db.delete(schema.queueEntries);
  await db.delete(schema.customers);
  await db.delete(schema.menuItems);
  await db.delete(schema.categories);
  await db.delete(schema.pricingTiles);
  await db.delete(schema.ingredients);
  await db.delete(schema.ingredientCategories);
  await db.delete(schema.suppliers);
  await db.delete(schema.tables);
  await db.delete(schema.auditLogs);
  await db.delete(schema.monthlyExpenses);
  await db.delete(schema.taxInvoiceSequence);
  await db.delete(schema.storeSettings);
  await db.delete(schema.users);
  await db.delete(schema.branches);
}

async function seed() {
  await clearData();

  const [branch] = await db
    .insert(schema.branches)
    .values({
      name: 'E2E Shabu Branch',
      address: 'E2E Test Address',
      phone: '020000000',
      taxId: '0100000000000',
    })
    .returning();

  const passwordHash = await bcrypt.hash('password123', 10);
  const allStaffModules = ['pos', 'tables', 'queue', 'kds', 'printers'];

  const users = await db
    .insert(schema.users)
    .values([
      {
        email: 'owner@shabu.local',
        passwordHash,
        name: 'E2E Owner',
        role: 'owner',
        branchId: branch.id,
      },
      {
        email: 'admin@shabu.local',
        passwordHash,
        name: 'E2E Admin Manager',
        role: 'manager',
        branchId: branch.id,
        allowedModules: allStaffModules,
      },
      {
        email: 'cashier@shabu.local',
        passwordHash,
        name: 'E2E Cashier',
        role: 'cashier',
        branchId: branch.id,
        allowedModules: ['pos', 'tables', 'queue', 'printers'],
      },
      {
        email: 'staff@shabu.local',
        passwordHash,
        name: 'E2E Kitchen Staff',
        role: 'kitchen',
        branchId: branch.id,
        allowedModules: ['kds'],
      },
      {
        email: 'restricted@shabu.local',
        passwordHash,
        name: 'E2E Restricted Cashier',
        role: 'cashier',
        branchId: branch.id,
        allowedModules: ['kds'],
      },
    ])
    .returning();

  const owner = users.find((user) => user.email === 'owner@shabu.local');
  if (!owner) throw new Error('Owner seed user was not created.');

  await db.insert(schema.storeSettings).values({
    id: 1,
    shopNameTh: 'E2E Shabu Buffet',
    shopNameEn: 'E2E Shabu Buffet',
    companyName: 'E2E Restaurant Co., Ltd.',
    address: 'E2E Test Address',
    phone: '020000000',
    taxId: '0100000000000',
    registerNo: 'E2E-REG-1',
    receiptCounter: 0,
    receiptCounterDate: '',
  });

  await db.insert(schema.pricingTiles).values([
    {
      code: 'adult',
      name: 'Adult Buffet',
      category: 'guest',
      price: '299.00',
      color: '#DCFCE7',
      sortOrder: 1,
    },
    {
      code: 'child',
      name: 'Child Buffet',
      category: 'guest',
      price: '159.00',
      color: '#DBEAFE',
      sortOrder: 2,
    },
    {
      code: 'addon_drink_glass',
      name: 'Refill Drink',
      category: 'addon',
      price: '39.00',
      color: '#FEF3C7',
      sortOrder: 10,
    },
    {
      code: 'discount_50_baht',
      name: 'Discount 50',
      category: 'discount',
      price: '0.00',
      discountType: 'fixed',
      discountValue: '50.00',
      color: '#FEE2E2',
      sortOrder: 20,
    },
  ]);

  await db.insert(schema.tables).values(
    Array.from({ length: 8 }, (_, index) => ({
      label: String(index + 1),
      capacity: index < 4 ? 4 : 6,
      zone: 'Main',
      status: 'available' as const,
      qrToken: `e2e-table-${index + 1}`,
      positionX: 40 + (index % 4) * 120,
      positionY: 40 + Math.floor(index / 4) * 120,
      width: 90,
      height: 90,
      shape: 'square' as const,
      branchId: branch.id,
    })),
  );

  const [meatCategory, vegetableCategory] = await db
    .insert(schema.categories)
    .values([
      { name: 'Meat', station: 'meat' as const, sortOrder: 1 },
      { name: 'Vegetables', station: 'vegetable' as const, sortOrder: 2 },
    ])
    .returning();

  await db.insert(schema.menuItems).values([
    {
      categoryId: meatCategory.id,
      name: 'Beef Slice',
      nameEn: 'Beef Slice',
      isBuffet: true,
      maxPerOrder: 10,
      sortOrder: 1,
    },
    {
      categoryId: meatCategory.id,
      name: 'Pork Belly',
      nameEn: 'Pork Belly',
      isBuffet: true,
      maxPerOrder: 10,
      sortOrder: 2,
    },
    {
      categoryId: vegetableCategory.id,
      name: 'Mushroom Set',
      nameEn: 'Mushroom Set',
      isBuffet: true,
      maxPerOrder: 10,
      sortOrder: 3,
    },
  ]);

  const [ingredientCategory] = await db
    .insert(schema.ingredientCategories)
    .values({ name: 'E2E Meat', sortOrder: 1 })
    .returning();
  const [supplier] = await db
    .insert(schema.suppliers)
    .values({
      name: 'E2E Supplier',
      contactName: 'QA Supplier',
      phone: '020000001',
      avgLeadTimeDays: 1,
    })
    .returning();

  await db.insert(schema.ingredients).values([
    {
      categoryId: ingredientCategory.id,
      defaultSupplierId: supplier.id,
      name: 'E2E Beef Stock',
      unit: 'kg',
      minStock: '5.00',
      parLevel: '20.00',
      lastCost: '220.00',
      countFrequency: 'daily',
    },
    {
      categoryId: ingredientCategory.id,
      defaultSupplierId: supplier.id,
      name: 'E2E Pork Stock',
      unit: 'kg',
      minStock: '5.00',
      parLevel: '20.00',
      lastCost: '180.00',
      countFrequency: 'daily',
    },
  ]);

  await db.insert(schema.hrSettings).values({
    id: 'singleton',
    absenceRatePerDay: '300.00',
    lateRatePerMinute: '2.00',
    morningShiftStart: '09:00',
    morningShiftEnd: '17:00',
    afternoonShiftStart: '14:00',
    afternoonShiftEnd: '22:00',
    defaultBreakMinutes: 30,
  });

  await db.insert(schema.employees).values([
    {
      firstName: 'E2E',
      lastName: 'Part Timer',
      phone: '0810000001',
      type: 'part_time' as const,
      status: 'active' as const,
      hourlyRate: '65.00',
      branchId: branch.id,
      startDate: '2026-01-01',
    },
    {
      firstName: 'E2E',
      lastName: 'Monthly Staff',
      phone: '0810000002',
      type: 'full_time' as const,
      status: 'active' as const,
      baseSalaryPerCycle: '15000.00',
      incentivePerDay: '100.00',
      branchId: branch.id,
      startDate: '2026-01-01',
    },
  ]);
}

seed()
  .then(() => {
    console.log('E2E seed completed.');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
