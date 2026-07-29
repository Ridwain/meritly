"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, Pencil, Plus, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import type { Department, Notice } from "@/lib/types";

export default function DepartmentsClient({
  initialDepartments,
  memberCounts,
}: {
  initialDepartments: Department[];
  memberCounts: Record<number, number>;
}) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function createDepartment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = name.trim();
    if (cleanName.length < 2) return;

    setBusy(true);
    setNotice(null);
    const { error } = await supabase
      .from("departments")
      .insert({ name: cleanName });

    if (error) {
      setNotice({ type: "error", text: error.message });
    } else {
      setName("");
      setNotice({ type: "success", text: "Department created." });
      router.refresh();
    }
    setBusy(false);
  }

  async function saveRename(id: number) {
    const cleanName = editingName.trim();
    if (cleanName.length < 2) return;

    setBusy(true);
    setNotice(null);
    const { error } = await supabase
      .from("departments")
      .update({ name: cleanName })
      .eq("id", id);

    if (error) {
      setNotice({ type: "error", text: error.message });
    } else {
      setEditingId(null);
      setEditingName("");
      setNotice({ type: "success", text: "Department renamed." });
      router.refresh();
    }
    setBusy(false);
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Departments
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Create organizational boundaries used to scope users, tasks, files,
        and performance data.
      </p>

      <Card className="mt-6 p-5">
        <form
          onSubmit={createDepartment}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="min-w-[240px] flex-1">
            <Label>New department name</Label>
            <Input
              required
              minLength={2}
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Engineering"
            />
          </div>
          <Button type="submit" disabled={busy || name.trim().length < 2}>
            <Plus className="h-4 w-4" />
            {busy ? "Saving…" : "Create department"}
          </Button>
        </form>
        {notice && (
          <p
            className={`mt-3 text-sm ${
              notice.type === "error" ? "text-rose-600" : "text-emerald-600"
            }`}
          >
            {notice.text}
          </p>
        )}
      </Card>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {initialDepartments.map((department) => (
          <Card key={department.id} className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="rounded-lg bg-brand-50 p-2 text-brand-700">
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  {editingId === department.id ? (
                    <Input
                      autoFocus
                      minLength={2}
                      maxLength={80}
                      value={editingName}
                      onChange={(event) => setEditingName(event.target.value)}
                    />
                  ) : (
                    <p className="truncate font-semibold text-slate-900">
                      {department.name}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-slate-500">
                    {memberCounts[department.id] ?? 0} members
                  </p>
                </div>
              </div>

              {editingId === department.id ? (
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    onClick={() => saveRename(department.id)}
                    disabled={busy || editingName.trim().length < 2}
                    aria-label={`Save ${department.name}`}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setEditingId(null);
                      setEditingName("");
                    }}
                    disabled={busy}
                    aria-label="Cancel rename"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : department.protected ? (
                <span className="text-xs font-medium text-slate-400">
                  System
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setEditingId(department.id);
                    setEditingName(department.name);
                    setNotice(null);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Rename
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
