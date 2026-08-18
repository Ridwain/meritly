"use client";

import { useState } from "react";
import { Download, Users, ClipboardList } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { EmployeeSummary } from "@/lib/types";

type TaskExportItem = {
  title: string;
  description: string;
  assignee: string;
  assigner: string;
  priority: string;
  deadline: string;
  status: string;
  created_at: string;
};

type ExportClientProps = {
  employees: EmployeeSummary[];
  tasks: TaskExportItem[];
};

type EmployeeFilter = "all" | "active" | "promoted" | "archived";
type TaskFilter = "all" | "pending" | "in_progress" | "submitted" | "completed" | "overdue" | "needs_revision";

export default function ExportClient({ employees, tasks }: ExportClientProps) {
  const [empFilter, setEmpFilter] = useState<EmployeeFilter>("all");
  const [taskFilter, setTaskFilter] = useState<TaskFilter>("all");

  const handleExportEmployees = () => {
    const filtered = empFilter === "all"
      ? employees
      : employees.filter(e => e.lifecycleStatus === empFilter);

    const headers = [
      "Full Name",
      "Email",
      "Role",
      "Department",
      "Status",
      "Completed Tasks",
      "Total Tasks",
      "Completion Rate"
    ];

    const rows = filtered.map(emp => {
      const completionRate = emp.totalTasks > 0 ? Math.round((emp.completedTasks / emp.totalTasks) * 100) : 0;
      return [
        emp.full_name,
        emp.email || "N/A",
        emp.role,
        emp.departmentName,
        emp.lifecycleStatus.charAt(0).toUpperCase() + emp.lifecycleStatus.slice(1),
        emp.completedTasks,
        emp.totalTasks,
        `${completionRate}%`
      ];
    });

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(value => {
        const stringValue = String(value).replace(/"/g, '""');
        return stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n")
          ? `"${stringValue}"`
          : stringValue;
      }).join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `employee_performance_${empFilter}_report_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportTasks = () => {
    const filtered = taskFilter === "all"
      ? tasks
      : tasks.filter(t => t.status === taskFilter);

    const headers = [
      "Task Title",
      "Description",
      "Assignee",
      "Assigner",
      "Priority",
      "Deadline",
      "Status",
      "Created At"
    ];

    const rows = filtered.map(t => {
      // Format dates slightly nicer for spreadsheet import
      const deadlineStr = new Date(t.deadline).toLocaleString();
      const createdStr = new Date(t.created_at).toLocaleString();
      return [
        t.title,
        t.description,
        t.assignee,
        t.assigner,
        t.priority.toUpperCase(),
        deadlineStr,
        t.status.replace("_", " ").toUpperCase(),
        createdStr
      ];
    });

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(value => {
        const stringValue = String(value).replace(/"/g, '""');
        return stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n")
          ? `"${stringValue}"`
          : stringValue;
      }).join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `tasks_${taskFilter}_report_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Export Reports
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Select filters and download clean CSV records for spreadsheets or external reporting.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Employee Report Card */}
        <Card className="flex flex-col justify-between p-6">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Employee Performance
                </h2>
                <p className="text-xs text-slate-500">
                  Performance summaries, completed tasks, and rates
                </p>
              </div>
            </div>

            <p className="text-sm leading-relaxed text-slate-600">
              Generates a comprehensive CSV containing employee names, emails, roles, departments, active status, and calculated completion rates.
            </p>

            <div className="space-y-1.5 pt-2">
              <label htmlFor="emp-status" className="text-xs font-semibold text-slate-700">
                Account Status
              </label>
              <select
                id="emp-status"
                value={empFilter}
                onChange={(e) => setEmpFilter(e.target.value as EmployeeFilter)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="all">All Employees</option>
                <option value="active">Active Only</option>
                <option value="promoted">Promoted Only</option>
                <option value="archived">Archived Only</option>
              </select>
            </div>
          </div>

          <div className="mt-6 border-t border-slate-100 pt-4">
            <Button
              onClick={handleExportEmployees}
              className="w-full gap-2 text-white bg-brand-600 hover:bg-brand-700"
            >
              <Download className="h-4 w-4" />
              Export Performance CSV
            </Button>
          </div>
        </Card>

        {/* Tasks Report Card */}
        <Card className="flex flex-col justify-between p-6">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                <ClipboardList className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Task Assignments
                </h2>
                <p className="text-xs text-slate-500">
                  Task list details, priorities, and status history
                </p>
              </div>
            </div>

            <p className="text-sm leading-relaxed text-slate-600">
              Generates a CSV record of assigned tasks including titles, priorities, assignees, assigners, deadline schedules, and current task progress.
            </p>

            <div className="space-y-1.5 pt-2">
              <label htmlFor="task-status" className="text-xs font-semibold text-slate-700">
                Task Status
              </label>
              <select
                id="task-status"
                value={taskFilter}
                onChange={(e) => setTaskFilter(e.target.value as TaskFilter)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="all">All Tasks</option>
                <option value="pending">Pending</option>
                <option value="in_progress">In Progress</option>
                <option value="submitted">Submitted</option>
                <option value="completed">Completed</option>
                <option value="overdue">Overdue</option>
                <option value="needs_revision">Needs Revision</option>
              </select>
            </div>
          </div>

          <div className="mt-6 border-t border-slate-100 pt-4">
            <Button
              onClick={handleExportTasks}
              className="w-full gap-2 text-white bg-brand-600 hover:bg-brand-700"
            >
              <Download className="h-4 w-4" />
              Export Tasks CSV
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
