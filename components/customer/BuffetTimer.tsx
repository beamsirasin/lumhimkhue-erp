'use client';

import { useState, useEffect } from 'react';
import { differenceInSeconds } from 'date-fns';

interface BuffetTimerProps {
  endsAt: Date;
}

export function BuffetTimer({ endsAt }: BuffetTimerProps) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, differenceInSeconds(endsAt, new Date())),
  );

  useEffect(() => {
    const id = setInterval(() => {
      setRemaining(Math.max(0, differenceInSeconds(endsAt, new Date())));
    }, 1000);
    return () => clearInterval(id);
  }, [endsAt]);

  if (remaining === 0) {
    return <span className="font-semibold text-red-600">หมดเวลา</span>;
  }

  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  const display =
    h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;

  const isUrgent = remaining < 600;

  return (
    <span
      className={`font-mono tabular-nums font-semibold ${isUrgent ? 'text-red-600' : 'text-slate-900'}`}
    >
      {display}
    </span>
  );
}
