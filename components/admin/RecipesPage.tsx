'use client';

import { useState, useTransition, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  BookOpen,
  Plus,
  Trash2,
  Save,
  ChevronRight,
  Search,
  AlertCircle,
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

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <p className="text-xs text-muted-foreground">สูตรอาหารสำหรับ</p>
          <h2 className="text-base font-semibold text-foreground">{menuItem.name}</h2>
        </div>
        <button
          type="button"
          aria-label="ปิด"
          onClick={onClose}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex flex-1 min-h-0 gap-0 divide-x divide-border">
        {/* Left: existing recipes list */}
        <div className="w-44 shrink-0 overflow-y-auto p-3 space-y-1">
          <button
            type="button"
            onClick={newRecipe}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          >
            <Plus className="size-3.5" />
            สูตรใหม่
          </button>
          {recipes.map((recipe) => (
            <button
              key={recipe.id}
              type="button"
              onClick={() => loadRecipe(recipe)}
              className={`w-full truncate rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors ${
                editingRecipeId === recipe.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted/50'
              }`}
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
              <input
                value={recipeName}
                onChange={(e) => setRecipeName(e.target.value)}
                placeholder="เช่น สูตรมาตรฐาน"
                className="w-full rounded-lg border border-border bg-background text-foreground px-3 py-1.5 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
              />
            </div>
            <div className="w-24">
              <label className="block text-xs font-medium text-muted-foreground mb-1">ขนาดเสิร์ฟ</label>
              <input
                type="number"
                min={1}
                value={servingSize}
                onChange={(e) => setServingSize(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full rounded-lg border border-border bg-background text-foreground px-3 py-1.5 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
              />
            </div>
          </div>

          {/* Ingredient search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาวัตถุดิบ..."
              className="w-full rounded-lg border border-border bg-background text-foreground pl-8 pr-3 py-1.5 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
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
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={row.quantity || ''}
                    onChange={(e) => updateRow(row.key, { quantity: parseFloat(e.target.value) || 0 })}
                    placeholder="ปริมาณ"
                    className="w-20 rounded-lg border border-border bg-background text-foreground px-2 py-1.5 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
                  />
                  <input
                    value={row.unit}
                    onChange={(e) => updateRow(row.key, { unit: e.target.value })}
                    placeholder="หน่วย"
                    className="w-16 rounded-lg border border-border bg-background text-foreground px-2 py-1.5 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
                  />
                  <span className="w-16 text-right text-xs text-muted-foreground tabular-nums">
                    ฿{fmt(lineCost)}
                  </span>
                  <button
                    type="button"
                    aria-label="ลบ"
                    onClick={() => removeRow(row.key)}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              onClick={addRow}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-3.5" />
              เพิ่มวัตถุดิบ
            </button>
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
                <span className={`font-semibold ${
                  liveTheoreticalCost > 0
                    ? ((menuItem.price - liveTheoreticalCost) / menuItem.price) * 100 < 30
                      ? 'text-red-600'
                      : 'text-green-600'
                    : 'text-muted-foreground'
                }`}>
                  {liveTheoreticalCost > 0
                    ? fmtPct(((menuItem.price - liveTheoreticalCost) / menuItem.price) * 100)
                    : '—'}
                </span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Save className="size-3.5" />
              บันทึก
            </button>
            {editingRecipeId && (
              <button
                type="button"
                onClick={() => handleDelete(editingRecipeId)}
                disabled={isPending}
                className="flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 className="size-3.5" />
                ลบสูตร
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
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
    <div className="flex h-full overflow-hidden">
      {/* Left panel: menu item list */}
      <div className={`flex flex-col ${selected ? 'hidden lg:flex w-96' : 'flex-1'} border-r border-border bg-card`}>
        {/* Header */}
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-[15px] font-bold tracking-tight text-foreground">สูตรอาหาร</h1>
            <span className="text-xs text-muted-foreground">{totalWithRecipe}/{matrix.length} มีสูตร</span>
          </div>
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาเมนู..."
              className="w-full rounded-lg border border-border bg-background text-foreground pl-9 pr-3 py-2 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
            />
          </div>
          <button
            type="button"
            onClick={() => setFilterNoRecipe((v) => !v)}
            className={`text-xs font-medium px-2.5 py-1 rounded-full transition-colors ${
              filterNoRecipe
                ? 'bg-amber-100 text-amber-800'
                : 'bg-muted/50 text-muted-foreground hover:bg-muted'
            }`}
          >
            {filterNoRecipe ? 'แสดงทั้งหมด' : 'เฉพาะยังไม่มีสูตร'}
          </button>
        </div>

        {/* Stats row */}
        <div className="flex gap-4 border-b border-border bg-muted/30 px-5 py-3">
          <div>
            <p className="text-xs text-muted-foreground">ต้นทุนเฉลี่ย</p>
            <p className="text-sm font-semibold text-foreground">฿{fmt(avgCost)}</p>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto divide-y divide-border">
          {filtered.length === 0 && (
            <div className="py-12 text-center">
              <BookOpen className="mx-auto size-8 text-muted-foreground/60 mb-2" />
              <p className="text-sm text-muted-foreground">ไม่พบเมนู</p>
            </div>
          )}
          {filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelected(item)}
              className={`w-full flex items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-muted/30 ${
                selected?.id === item.id ? 'bg-muted/30' : ''
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{item.name}</span>
                  {!item.hasRecipe && (
                    <AlertCircle className="size-3.5 shrink-0 text-amber-400" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{item.categoryName}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-medium text-foreground">
                  ฿{fmt(item.theoreticalCost)}
                </p>
                {item.margin !== null && (
                  <p className={`text-xs font-medium ${item.margin < 30 ? 'text-red-500' : 'text-green-600'}`}>
                    {fmtPct(item.margin)}
                  </p>
                )}
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
            </button>
          ))}
        </div>
      </div>

      {/* Right panel: recipe editor */}
      {selected && (
        <div className="flex-1 min-w-0 bg-card overflow-hidden">
          <RecipeEditor
            menuItem={selected}
            allIngredients={allIngredients}
            onClose={() => setSelected(null)}
            onSaved={invalidate}
          />
        </div>
      )}

      {!selected && (
        <div className="hidden lg:flex flex-1 items-center justify-center bg-muted/30">
          <div className="text-center">
            <BookOpen className="mx-auto size-10 text-muted-foreground/60 mb-3" />
            <p className="text-sm text-muted-foreground">เลือกเมนูเพื่อจัดการสูตรอาหาร</p>
          </div>
        </div>
      )}
    </div>
  );
}
