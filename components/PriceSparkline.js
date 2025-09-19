'use client';
import { LineChart, Line, ResponsiveContainer } from 'recharts';

export default function PriceSparkline({ data }) {
  if (!data?.length) return null;
  return (
    <div className="h-12 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line type="monotone" dataKey="median" stroke="#2563eb" strokeWidth={2} dot={false}/>
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
