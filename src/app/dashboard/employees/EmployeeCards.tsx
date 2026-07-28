"use client";

import { useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type { EmployeeSummary } from "@/lib/types";

type EmployeeFilter = "active" | "all" | "archived" | "promoted";

const FILTERS: { key: EmployeeFilter; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "all", label: "All" },
  { key: "archived", label: "Archived" },
  { key: "promoted", label: "Promoted" },
];

export default function EmployeeCards({
  employees,
}: {
  employees: EmployeeSummary[];
}) {
  // Current workers are the most common use case, so Active is the default.
  const [filter, setFilter] = useState<EmployeeFilter>("active");

  const counts: Record<EmployeeFilter, number> = {
    all: employees.length,
    active: employees.filter((employee) => employee.lifecycleStatus === "active")
      .length,
    archived: employees.filter(
      (employee) => employee.lifecycleStatus === "archived"
    ).length,
    promoted: employees.filter(
      (employee) => employee.lifecycleStatus === "promoted"
    ).length,
  };

  const visibleEmployees =
    filter === "all"
      ? employees
      : employees.filter(
          (employee) => employee.lifecycleStatus === filter
        );

  return (
    <div>
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Filter employees by account status"
      >
        {FILTERS.map((item) => {
          const selected = filter === item.key;
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={selected}
              onClick={() => setFilter(item.key)}
              className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 ${
                selected
                  ? "border-brand-200 bg-brand-50 text-brand-700"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {item.label}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[11px] leading-none ${
                  selected
                    ? "bg-brand-100 text-brand-700"
                    : "bg-slate-100 text-slate-500"
                }`}
              >
                {counts[item.key]}
              </span>
            </button>
          );
        })}
      </div>

      {visibleEmployees.length === 0 ? (
        <Card className="mt-4 p-8 text-center text-sm text-slate-500">
          No {filter === "all" ? "current or historical" : filter} employees
          found.
        </Card>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibleEmployees.map((employee) => (
            <Link
              key={employee.id}
              href={`/dashboard/performance?emp=${employee.id}`}
              className="group block h-full rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            >
              <Card className="grid h-full min-h-[132px] grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-4 p-5 transition-colors group-hover:border-brand-300 group-hover:bg-brand-50/40 group-focus-visible:border-brand-300">
                <Avatar name={employee.full_name} className="h-11 w-11" />

                <div className="min-w-0 pt-0.5">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {employee.full_name}
                  </p>
                  <p
                    className="mt-1 truncate text-xs text-slate-500"
                    title={employee.email ?? "Email unavailable"}
                  >
                    {employee.email ?? "Email unavailable"}
                  </p>
                  <p className="mt-0.5 truncate text-xs capitalize text-slate-400">
                    Role: {employee.role}
                  </p>
                  <p className="mt-2 text-[11px] font-medium text-slate-400">
                    {employee.hasHistory &&
                    employee.lifecycleStatus !== "active"
                      ? "Past work retained"
                      : "Current performance profile"}
                  </p>
                </div>

                <div className="flex h-full min-w-[76px] flex-col items-end justify-between gap-3">
                  <Badge
                    tone={
                      employee.lifecycleStatus === "active"
                        ? "success"
                        : employee.lifecycleStatus === "archived"
                          ? "neutral"
                          : "warning"
                    }
                  >
                    {employee.lifecycleStatus === "active"
                      ? "Active"
                      : employee.lifecycleStatus === "archived"
                        ? "Archived"
                        : "Promoted"}
                  </Badge>

                  <div
                    className={`rounded-lg px-3 py-1.5 text-center ${
                      employee.totalTasks === 0
                        ? "bg-slate-100 text-slate-600"
                        : "bg-brand-50 text-brand-700"
                    }`}
                  >
                    <p className="text-sm font-semibold leading-none">
                      {employee.completedTasks}/{employee.totalTasks}
                    </p>
                    <p className="mt-1 text-[10px] font-medium leading-none">
                      completed
                    </p>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
