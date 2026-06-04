'use client';

import {
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export function ChartContainer({
  children,
  height = 200,
}: {
  children: React.ReactElement;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      {children}
    </ResponsiveContainer>
  );
}

export function ChartTooltip(props: React.ComponentProps<typeof Tooltip>) {
  return <Tooltip {...props} contentStyle={{ fontSize: 12, borderRadius: 8 }} />;
}

export function ChartXAxis(props: React.ComponentProps<typeof XAxis>) {
  return (
    <XAxis
      tick={{ fontSize: 11, fill: '#64748b' }}
      axisLine={false}
      tickLine={false}
      {...props}
    />
  );
}

export function ChartYAxis(props: React.ComponentProps<typeof YAxis>) {
  return (
    <YAxis
      tick={{ fontSize: 11, fill: '#64748b' }}
      axisLine={false}
      tickLine={false}
      {...props}
    />
  );
}

export { BarChart, Bar, PieChart, Pie, Cell, Legend } from 'recharts';
