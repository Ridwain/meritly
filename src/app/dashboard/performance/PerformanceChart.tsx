"use client";

// Client Component: Recharts renders to the DOM, so it can only run in the
// browser. This is also *why* it's a separate component from the page —
// the day-bucketing has to happen here too, so "today" means the viewer's
// own local day, not the server's (see bucketActivityByDay in lib/stats.ts).
import { useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { bucketActivityByDay } from "@/lib/stats";
import type { ActivityRow } from "@/lib/types";

const TREND_DAYS = 14;

export default function PerformanceChart({ activity }: { activity: ActivityRow[] }) {
  const points = useMemo(
    () => bucketActivityByDay(activity, TREND_DAYS),
    [activity]
  );

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#94a3b8" />
          <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="#94a3b8" />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: "#e2e8f0" }}
            labelStyle={{ color: "#1e293b" }}
          />
          <Line
            type="monotone"
            dataKey="count"
            name="Activity"
            stroke="#4f46e5"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
