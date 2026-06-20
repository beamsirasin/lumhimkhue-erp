'use client';

import { useState, useTransition, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  BookOpen,
  Plus,
  Trash2,
  Save,
  Search,
  X,
} from 'lucide-react';
import {
  getMenuItemCostMatrix,
  getRecipesByMenuItem,
  upsertRecipe,
  deleteRecipe,
  type MenuItemCostRow,
  type RecipeWithIngredients,
} from '@/lib/actions/recipes';
import { AppShell } from '@/components/ui/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { DataCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────────

type IngredientOption = {
  id: string;
  name: string;
  unit: string;
  lastCost: string;
  category: { name: string };
};

interface Props {
  initialMatrix: MenuItemCostRow[];
  allIngredients: IngredientOption[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number | null) {
  if (n === null) return '—';
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n: number | null) {
  if (n === null) return '—';
  return `${n.toFixed(1)}%`;
}

// ── Ingredient row in recipe form ─────────────────────────────────────────────

type IngRow = {
  key: string;
  ingredientId: string;
  quantity: number;
  unit: string;
  notes: string;
};

// ── Recipe Editor Panel ────────────────────────────────────────────────────────

function RecipeEditor({
  menuItem,
  allIngredients,
  onClose,
  onSaved,
}: {
  menuItem: MenuItemCostRow;
  allIngredients: IngredientOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [recipeName, setRecipeName] = useState('');
  const [servingSize, setServingSize] = useState(1);
  const [rows, setRows] = useState<IngRow[]>([]);
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const { data: recipesData, refetch } = useQuery({
    queryKey: ['recipes', menuItem.id],
    queryFn: async () => {
      const r = await getRecipesByMenuItem(menuItem.id);
      if (!r.ok) throw new Error(r.error);
      return r.data;
    },
  });

  const recipes = recipesData ?? [];

  function loadRecipe(recipe: RecipeWithIngredients) {
    setEditingRecipeId(recipe.id);
    setRecipeName(recipe.name);
    setServingSize(recipe.servingSize);
    setRows(
      recipe.ingredients.map((ri) => ({
        key: ri.id,
        ingredientId: ri.ingredientId,
        quantity: parseFloat(ri.quantity),
        unit: ri.unit,
        notes: ri.notes ?? '',
      })),
    );
  }

  function newRecipe() {
    setEditingRecipeId(null);
    setRecipeName('');
    setServingSize(1);
    setRows([]);
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      { key: crypto.randomUUID(), ingredientId: '', quantity: 0, unit: '', notes: '' },
    ]);
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  function updateRow(key: string, patch: Partial<IngRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function handleIngredientSelect(key: string, ingredientId: string) {
    const ing = allIngredients.find((i) => i.id === ingredientId);
    updateRow(key, { ingredientId, unit: ing?.unit ?? '' });
  }

  const filteredIngredients = useMemo(() => {
    if (!search) return allIngredients;
    const q = search.toLowerCase();
    return allIngredients.filter(
      (i) => i.name.toLowerCase().includes(q) || i.category.name.toLowerCase().includes(q),
    );
  }, [allIngredients, search]);

  const liveTheoreticalCost = useMemo(() => {
    if (!rows.length) return 0;
    const raw = rows.reduce((sum, row) => {
      const ing = allIngredients.find((i) => i.id === row.ingredientId);
      if (!ing || !row.quantity) return sum;
      return sum + parseFloat(ing.lastCost) * row.quantity;
    }, 0);
    return Math.round((raw / servingSize) * 100) / 100;
  }, [rows, allIngredients, servingSize]);

  function handleSave() {
    if (!recipeName.trim()) { toast.error('กรุณากรอกชื่อสูตร'); return; }
    const invalidRows = rows.filter((r) => !r.ingredientId || r.quantity <= 0);
    if (invalidRows.length) { toast.error('กรุณากรอกวัตถุดิบและปริมาณให้ครบ'); return; }

    startTransition(async () => {
      const r = await upsertRecipe({
        id: editingRecipeId ?? undefined,
        menuItemId: menuItem.id,
        name: recipeName,
        servingSize,
        ingredients: rows.map((row) => ({
          ingredientId: row.ingredientId,
          quantity: row.quantity,
          unit: row.unit,
          notes: row.notes || null,
        })),
      });
      if (!r.ok) { toast.error(r.error); return; }
      toast.success('บันทึกสูตรแล้ว');
      refetch();
      onSaved();
    });
  }

  function handleDelete(id: string) {
    if (!confirm('ลบสูตรนี้?')) return;
    startTransition(async () => {
      const r = await deleteRecipe(id);
      if (!r.ok) { toast.error(r.error); return; }
      toast.success('ลบสูตรแล้ว');
      newRecipe();
      refetch();
      onSaved();
    });
  }

  const grossMarginPct =
    liveTheoreticalCost > 0 && menuItem.price > 0
      ? ((menuItem.price - liveTheoreticalCost) / menuItem.price) * 100
      : null;

  return (
    <DataCard
      title={menuItem.name}
      subtitle="สูตรอาหารสำหรับเมนูนี้"
      actions={
        <Button variant="ghost" size="sm" aria-label="ปิด" onClick={onClose}>
          <X className="size-4" />
        </Button>
      }
    >
      <div className="flex min-h-0 gap-0 divide-x divide-border -m-5">
        {/* Left: existing recipes list */}
        <div className="w-44 shrink-0 overflow-y-auto p-3 space-y-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={newRecipe}
            className="w-full justify-start gap-2 text-xs"
          >
            <Plus className="size-3.5" />
            สูตรใหม่
          </Button>
          {recipes.map((recipe) => (
            <button
              key={recipe.id}
              type="button"
              onClick={() => loadRecipe(recipe)}
              className={cn(
                'w-full truncate rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors',
                editingRecipeId === recipe.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted/50',
              )}
            >
              {recipe.name}
            </button>
          ))}
        </div>

        {/* Right: editor */}
        <div className="flex flex-1 flex-col overflow-y-auto p-4 space-y-4">
          {/* Recipe meta */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-muted-foreground mb-1">ชื่อสูตร</label>
              <Input
                value={recipeName}
                onChange={(e) => setRecipeName(e.target.value)}
                placeholder="เช่น สูตรมาตรฐาน"
                className="h-8 text-sm"
              />
            </div>
            <div className="w-24">
              <label className="block text-xs font-medium text-muted-foreground mb-1">ขนาดเสิร์ฟ</label>
              <Input
                type="number"
                min={1}
                value={servingSize}
                onChange={(e) => setServingSize(Math.max(1, parseInt(e.target.value) || 1))}
                className="h-8 text-sm"
              />
            </div>
          </div>

          {/* Ingredient search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาวัตถุดิบ..."
              className="pl-8 h-8 text-sm"
            />
          </div>

          {/* Ingredient rows */}
          <div className="space-y-2">
            {rows.map((row) => {
              const ing = allIngredients.find((i) => i.id === row.ingredientId);
              const lineCost = ing && row.quantity > 0
                ? Math.round(parseFloat(ing.lastCost) * row.quantity * 100) / 100
                : 0;
              return (
                <div key={row.key} className="flex items-center gap-2">
                  <select
                    value={row.ingredientId}
                    onChange={(e) => handleIngredientSelect(row.key, e.target.value)}
                    className="flex-1 rounded-lg border border-border bg-background text-foreground px-2 py-1.5 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
                  >
                    <option value="">เลือกวัตถุดิบ</option>
                    {filteredIngredients.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name} ({i.category.name})
                      </option>
                    ))}
                  </select>
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={row.quantity || ''}
                    onChange={(e) => updateRow(row.key, { quantity: parseFloat(e.target.value) || 0 })}
                    placeholder="ปริมาณ"
                    className="w-20 h-8 text-sm"
                  />
                  <Input
                    value={row.unit}
                    onChange={(e) => updateRow(row.key, { unit: e.target.value })}
                    placeholder="หน่วย"
                    className="w-16 h-8 text-sm"
                  />
                  <span className="w-16 text-right text-xs text-muted-foreground tabular-nums">
                    ฿{fmt(lineCost)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="ลบ"
                    onClick={() => removeRow(row.key)}
                    className="size-7 shrink-0 text-muted-foreground hover:text-[var(--status-danger-fg)]"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              );
            })}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={addRow}
              className="gap-1.5 text-xs text-muted-foreground"
            >
              <Plus className="size-3.5" />
              เพิ่มวัตถุดิบ
            </Button>
          </div>

          {/* Live cost summary */}
          <div className="rounded-lg bg-muted/30 px-4 py-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">ต้นทุนทางทฤษฎี / portion</span>
              <span className="font-semibold text-foreground">฿{fmt(liveTheoreticalCost)}</span>
            </div>
            {menuItem.price > 0 && (
              <div className="flex justify-between text-sm mt-1">
                <span className="text-muted-foreground">Gross Margin</span>
                <span
                  className={cn(
                    'font-semibold',
                    grossMarginPct === null
                      ? 'text-muted-foreground'
                      : grossMarginPct < 30
                        ? 'text-[var(--status-danger-fg)]'
                        : 'text-[var(--status-success-fg)]',
                  )}
                >
                  {grossMarginPct !== null ? fmtPct(grossMarginPct) : '—'}
                </span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              onClick={handleSave}
              disabled={isPending}
              size="sm"
            >
              <Save className="size-3.5" />
              บันทึก
            </Button>
            {editingRecipeId && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleDelete(editingRecipeId)}
                disabled={isPending}
                className="text-[var(--status-danger-fg)] border-[var(--status-danger-border)] hover:bg-[var(--status-danger-bg)]"
              >
                <Trash2 className="size-3.5" />
                ลบสูตร
              </Button>
            )}
          </div>
        </div>
      </div>
    </DataCard>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export function RecipesPage({ initialMatrix, allIngredients }: Props) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<MenuItemCostRow | null>(null);
  const [filterNoRecipe, setFilterNoRecipe] = useState(false);

  const { data: matrix } = useQuery({
    queryKey: ['menu-cost-matrix'],
    queryFn: async () => {
      const r = await getMenuItemCostMatrix();
      if (!r.ok) throw new Error(r.error);
      return r.data;
    },
    initialData: initialMatrix,
    staleTime: 30_000,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['menu-cost-matrix'] });
  }

  const filtered = useMemo(() => {
    let rows = matrix;
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.categoryName.toLowerCase().includes(q));
    }
    if (filterNoRecipe) rows = rows.filter((r) => !r.hasRecipe);
    return rows;
  }, [matrix, search, filterNoRecipe]);

  const totalWithRecipe = matrix.filter((r) => r.hasRecipe).length;
  const avgCost = matrix.filter((r) => r.theoreticalCost > 0).length
    ? matrix.filter((r) => r.theoreticalCost > 0).reduce((s, r) => s + r.theoreticalCost, 0) /
      matrix.filter((r) => r.theoreticalCost > 0).length
    : 0;

  return (
    <AppShell>
      <PageHeader
        title="สูตรอาหาร"
        subtitle={`${totalWithRecipe} จาก ${matrix.length} เมนูมีสูตร · ต้นทุนเฉลี่ย ฿${fmt(avgCost)}`}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[380px_1fr]">
        {/* Left panel: menu item list */}
        <DataCard
          noPadding
          title="เมนูทั้งหมด"
          subtitle={`${filtered.length} รายการ`}
          actions={
            <Button
              type="button"
              variant={filterNoRecipe ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setFilterNoRecipe((v) => !v)}
              className="text-xs"
            >
              {filterNoRecipe ? 'แสดงทั้งหมด' : 'ยังไม่มีสูตร'}
            </Button>
          }
        >
          {/* Search */}
          <div className="relative p-3 border-b border-border">
            <Search className="absolute left-5.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาเมนู..."
              className="pl-8 h-8 text-sm"
            />
          </div>

          {/* List */}
          <div className="divide-y divide-border">
            {filtered.length === 0 ? (
              <EmptyState
                icon={<BookOpen className="size-5" />}
                title="ไม่พบเมนู"
                description={filterNoRecipe ? 'ทุกเมนูมีสูตรอาหารแล้ว' : 'ลองเปลี่ยนคำค้นหา'}
                size="sm"
              />
            ) : (
              filtered.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelected(item)}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30',
                    selected?.id === item.id && 'bg-[var(--surface-primary-subtle)]',
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="truncate text-sm font-medium text-foreground">{item.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-muted-foreground">{item.categoryName}</p>
                      <StatusBadge
                        label={item.hasRecipe ? 'มีสูตร' : 'ไม่มีสูตร'}
                        variant={item.hasRecipe ? 'success' : 'warning'}
                        size="sm"
                        dot
                      />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-medium text-foreground tabular-nums">
                      ฿{fmt(item.theoreticalCost)}
                    </p>
                    {item.margin !== null && (
                      <p
                        className={cn(
                          'text-xs font-medium tabular-nums',
                          item.margin < 30
                            ? 'text-[var(--status-danger-fg)]'
                            : 'text-[var(--status-success-fg)]',
                        )}
                      >
                        {fmtPct(item.margin)}
                      </p>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </DataCard>

        {/* Right panel: recipe editor */}
        {selected ? (
          <RecipeEditor
            key={selected.id}
            menuItem={selected}
            allIngredients={allIngredients}
            onClose={() => setSelected(null)}
            onSaved={invalidate}
          />
        ) : (
          <DataCard className="flex items-center justify-center min-h-[400px]">
            <EmptyState
              icon={<BookOpen className="size-5" />}
              title="เลือกเมนูเพื่อจัดการสูตร"
              description="คลิกที่รายการเมนูทางซ้ายเพื่อเพิ่มหรือแก้ไขสูตรอาหาร"
            />
          </DataCard>
        )}
      </div>
    </AppShell>
  );
}
