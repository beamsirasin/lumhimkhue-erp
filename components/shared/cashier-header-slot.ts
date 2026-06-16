'use client';
import { createContext, type ReactNode } from 'react';

/**
 * Lets pages inside the CashierLayout inject content into the top header bar.
 * Usage: `const set = useContext(CashierHeaderSlotContext); set(<MyContent />);`
 */
export const CashierHeaderSlotContext = createContext<((node: ReactNode) => void) | null>(null);
