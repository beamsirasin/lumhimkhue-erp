import { create } from 'zustand';

export interface CartMenuItem {
  menuItemId: string;
  name: string;
  extraPrice: number;
  isBuffet: boolean;
  maxPerOrder: number | null;
}

interface CartItem extends CartMenuItem {
  quantity: number;
}

interface CartStore {
  sessionToken: string | null;
  items: Record<string, CartItem>;
  initCart: (token: string) => void;
  setQuantity: (item: CartMenuItem, qty: number) => void;
  clear: () => void;
}

export const useCartStore = create<CartStore>((set, get) => ({
  sessionToken: null,
  items: {},

  initCart(token) {
    if (get().sessionToken !== token) {
      set({ sessionToken: token, items: {} });
    }
  },

  setQuantity(item, qty) {
    set((state) => {
      const next = { ...state.items };
      if (qty <= 0) {
        delete next[item.menuItemId];
      } else {
        next[item.menuItemId] = { ...item, quantity: qty };
      }
      return { items: next };
    });
  },

  clear() {
    set({ items: {} });
  },
}));

export const selectTotalItems = (state: CartStore) =>
  Object.values(state.items).reduce((s, i) => s + i.quantity, 0);

export const selectTotalExtra = (state: CartStore) =>
  Object.values(state.items).reduce(
    (s, i) => s + (i.isBuffet ? 0 : i.extraPrice * i.quantity),
    0,
  );
