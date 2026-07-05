# Product Requirements Document (PRD)
## Employee Work Monitoring & Performance Management System

**Version:** 1.0
**Course:** Software Engineering
**Team size:** 3
**Author:** [Your name]
**Date:** July 2026

---

## 1. Overview

### 1.1 Purpose
A web application where **HR assigns tasks to employees**, **employees submit their completed work**, the system **automatically records completion and missed deadlines**, and HR **monitors each employee's performance** — with an **AI-generated performance review** to help HR rate fairly.

### 1.2 Problem it solves
In many organizations, task assignment and follow-up happen over scattered messages and spreadsheets. There's no single record of what was assigned, whether it was done, and whether it was on time. This system centralizes the full loop: **assign → do → submit → review → track → evaluate.**

### 1.3 Goals
- Give HR one place to assign and monitor work.
- Give employees a clear view of what they owe and a way to submit it.
- Automatically create an accountability record (including missed work).
- Summarize performance with AI so HR reviews are consistent and fast.

### 1.4 Non-goals (out of scope for this project)
Payroll, attendance/clock-in, chat/messaging, mobile app, multi-company support. These keep the scope realistic for a course deadline.

---

## 2. Users & Roles

| Role | Who they are | What they can do |
|------|--------------|------------------|
| **HR / Manager** | Assigns and oversees work | Create/edit/delete tasks, review submissions, see all employees' performance, rate employees |
| **Employee** | Does the assigned work | See their own tasks, start them, submit work, see their own stats |

The app shows a **different dashboard depending on role**. An employee must never be able to reach HR-only screens.

---

## 3. Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | **Next.js 14 (App Router)** | One project for both frontend pages and backend API routes; huge docs; pairs cleanly with Supabase |
| Language | **JavaScript** | Simpler than TypeScript for a deadline; one less thing to debug |
| Styling | **Tailwind CSS** | Fast styling without writing separate CSS files |
| Database + Auth + Storage | **Supabase** | Postgres database, built-in login, and file uploads — all in one free service |
| AI | **Google Gemini** (`gemini-1.5-flash`) | Free tier suitable for students; used for performance summaries |
| Charts | **Recharts** | Simple React charts for the performance dashboard |
| Build tool | **Claude Code** (in the Claude app) | Writes and edits the project files as you direct it |

---

## 4. How you will build it (workflow)

You are new to Next.js, so the working loop for **every** step is:

1. **Read the feature** in this PRD — understand *what* it does and *how* it works.
2. **Copy the "Claude Code prompt"** for that step into Claude Code.
3. **Let Claude Code create/edit the files.**
4. **Run the app** (`npm run dev`) and test that one feature.
5. **Only then move to the next step.**

Never paste a prompt for a feature whose prerequisites aren't done yet. Build in the order in Section 8.

---

## 5. Data Model

Four tables live in Supabase. (Person A creates these first; everything depends on them.)

### 5.1 `profiles`
Extends Supabase's built-in `auth.users` with app-specific info.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | same id as the auth user |
| full_name | text | shown around the app |
| role | text | `'hr'` or `'employee'` |
| created_at | timestamp | auto |

### 5.2 `tasks`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | auto |
| title | text | short task name |
| description | text | what to do |
| assigned_to | uuid | the employee (→ profiles.id) |
| assigned_by | uuid | the HR (→ profiles.id) |
| priority | text | `'high'` / `'medium'` / `'low'` |
| deadline | timestamp | due date/time |
| status | text | `pending` → `in_progress` → `submitted` → `completed` / `needs_revision` / `overdue` |
| created_at | timestamp | auto |

### 5.3 `submissions`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | auto |
| task_id | uuid | which task (→ tasks.id) |
| employee_id | uuid | who submitted |
| note | text | what they did |
| file_url | text | link to uploaded file (Supabase storage) |
| submitted_at | timestamp | auto |
| hr_feedback | text | HR's review note |
| reviewed_at | timestamp | when HR reviewed |

### 5.4 `ratings`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | auto |
| employee_id | uuid | who is rated |
| rated_by | uuid | which HR |
| score | int | HR's final 1–5 |
| ai_suggested_score | int | what the AI suggested |
| comment | text | HR's written note |
| ai_summary | text | the AI-generated review text |
| period | text | e.g. "2026-07" |
| created_at | timestamp | auto |

**Security note (important for your report):** Supabase uses *Row Level Security (RLS)*. Each table has rules so an employee can only read their own tasks/submissions, while HR can read everything. This is enforced by the database, not just the UI — a real security best-practice.

---

## 6. Features — what each does and how you'll build it

Each feature below has: **What it does**, **How it works**, and a **Claude Code prompt** to build it.

---

### Feature 1 — Project setup & foundation
**What it does:** Creates an empty, running Next.js app with Tailwind and Supabase connected. No visible features yet — this is the skeleton.

**How it works:** Next.js gives you a dev server and a folder structure. Tailwind handles styling. You create a Supabase project online, copy two keys into a `.env.local` file, and add a small helper that lets your code talk to Supabase.

**Claude Code prompt:**
> "Create a new Next.js 14 app using the App Router and JavaScript (not TypeScript), with Tailwind CSS configured. Add the `@supabase/supabase-js` and `@supabase/ssr` packages. Create `src/lib/supabaseClient.js` (browser client) and `src/lib/supabaseServer.js` (server client) that read `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the environment. Add a `.env.local.example` file listing those two variables plus `GEMINI_API_KEY`. Keep a simple landing page at `/` with the project title and a link to `/login`."

**Test:** `npm run dev`, open http://localhost:3000, see the landing page.

---

### Feature 2 — Database schema
**What it does:** Creates the four tables and the security rules in Supabase.

**How it works:** You paste one SQL script into Supabase's SQL Editor. It builds the tables from Section 5, turns on Row Level Security, adds the policies, creates the file-storage bucket, and adds a function that flags overdue tasks.

**How you'll do it (no Claude Code needed here):**
1. Create a project at supabase.com.
2. Open **SQL Editor → New query**.
3. Paste the schema SQL (ask Claude Code: *"Generate the Supabase SQL for the four tables, RLS policies, an `is_hr()` helper, a `flag_overdue_tasks()` function, and a public `submissions` storage bucket, based on the PRD data model."*).
4. Run it.
5. In **Authentication → Providers → Email**, turn **off** "Confirm email" (so login works instantly for your demo).
6. Copy your Project URL and anon key into `.env.local`.

**Test:** Tables appear under **Table Editor** in Supabase.

---

### Feature 3 — Authentication & role-based routing
**What it does:** Users sign up (choosing HR or Employee), log in, and land on a dashboard that matches their role. Employees can't reach HR pages.

**How it works:** Supabase Auth handles the actual email/password login. When someone signs up, you also create their `profiles` row with their chosen role. A `middleware.js` file checks on every dashboard request whether the user is logged in, redirecting to `/login` if not. The dashboard layout reads the user's role and shows the correct navigation.

**Claude Code prompt:**
> "Build a `/login` page (JavaScript, client component) with a toggle between Sign in and Sign up. On sign up, collect full name, email, password, and a role dropdown (employee/hr), call Supabase `auth.signUp`, then insert a matching row into the `profiles` table. On sign in, call `signInWithPassword`. Redirect to `/dashboard` on success. Add `src/middleware.js` that redirects unauthenticated users away from `/dashboard`. Add `src/app/dashboard/layout.js` that fetches the current user's profile and renders a sidebar; the sidebar shows HR links (Overview, Tasks, Employees, Performance) or Employee links (Overview, My Tasks) based on role, plus a sign-out button."

**Test:** Create one HR account and one Employee account; confirm each sees a different sidebar.

---

### Feature 4 — HR task assignment
**What it does:** HR creates a task (title, description, assignee, priority, deadline) and can edit or delete it.

**How it works:** A form on the HR "Tasks" page inserts a row into the `tasks` table with status `pending`. A list below shows all tasks. Because of RLS, only HR can insert/delete.

**Claude Code prompt:**
> "On `/dashboard/tasks` (HR only — redirect employees), build a page that lists all tasks newest-first and has a 'New task' form: title, description, assignee (dropdown of all employees from `profiles` where role='employee'), priority (high/medium/low), and deadline (datetime). Submitting inserts into `tasks` with status 'pending' and `assigned_by` = current user. Each task row shows title, status badge, priority, assignee name, and deadline, with a Delete button (HR only)."

**Test:** As HR, assign a task to your employee account.

---

### Feature 5 — Employee task view & start
**What it does:** An employee sees the tasks assigned to them and can mark one "in progress."

**How it works:** The "My Tasks" page queries `tasks` where `assigned_to` = the logged-in user. A "Start" button updates that task's status to `in_progress`.

**Claude Code prompt:**
> "On `/dashboard/my-tasks`, list only the current user's tasks (assigned_to = them), sorted by deadline. Show title, description, priority, deadline, and a status badge. For tasks that are 'pending', show a 'Start' button that sets status to 'in_progress'."

**Test:** Log in as the employee; see the task from Feature 4; click Start.

---

### Feature 6 — Work submission (with file upload)
**What it does:** An employee submits their finished work: a written note plus an optional file.

**How it works:** A "Submit work" button opens a form. The file uploads to Supabase Storage (the `submissions` bucket); its public URL is saved. A row is inserted into `submissions`, and the task's status changes to `submitted`.

**Claude Code prompt:**
> "Add a 'Submit work' action to each active task on `/dashboard/my-tasks`. It opens a modal with a text note (required) and an optional file input. On submit: if a file is chosen, upload it to the Supabase 'submissions' storage bucket and get its public URL; insert a row into `submissions` (task_id, employee_id, note, file_url); then update the task status to 'submitted'."

**Test:** Submit work with a file; confirm the task now shows "submitted."

---

### Feature 7 — HR submission review
**What it does:** HR reads a submission and either approves it (task → completed) or returns it for revision (task → needs_revision) with feedback.

**How it works:** On the HR Tasks page, tasks with status `submitted` get a "Review" button. It loads the latest submission for that task, shows the note and file link, and offers Approve / Return, saving HR feedback to the submission.

**Claude Code prompt:**
> "On `/dashboard/tasks`, for tasks with status 'submitted', add a 'Review' button that opens a modal showing the latest submission's note and a link to its file. Add an optional feedback textbox and two buttons: 'Approve & complete' (sets task status to 'completed') and 'Return for revision' (sets status to 'needs_revision'). Both save the feedback and a reviewed_at timestamp on the submission."

**Test:** As HR, review the employee's submission and approve it.

---

### Feature 8 — Automatic overdue tracking
**What it does:** Any task whose deadline has passed without being finished is automatically marked `overdue` and recorded against the employee.

**How it works:** A database function `flag_overdue_tasks()` sets status to `overdue` for tasks still `pending`/`in_progress` past their deadline. The app calls this function whenever a dashboard loads, so records stay current without manual action.

**Claude Code prompt:**
> "In the SQL schema, add a `flag_overdue_tasks()` function that updates tasks to status 'overdue' where deadline < now() and status is 'pending' or 'in_progress'. In the app, call `supabase.rpc('flag_overdue_tasks')` at the top of the dashboard, my-tasks, employees, and performance pages so overdue tasks are flagged on load."

**Test:** Create a task with a deadline a minute in the past; reload; it shows "overdue."

---

### Feature 9 — HR performance dashboard
**What it does:** HR sees each employee's stats: total tasks, completed, on-time rate, overdue count, completion rate — with a chart.

**How it works:** For a selected employee, the app pulls all their tasks and computes the numbers, then draws a bar chart with Recharts. An "Employees" list page links to each person's performance.

**Claude Code prompt:**
> "Create a shared helper `src/lib/stats.js` with `computeStats(tasks)` returning total, completed, onTime, late, overdue, pending, completionRate, onTimeRate. Build `/dashboard/employees` (HR only) listing every employee with their totals and a link to `/dashboard/performance?emp=<id>`. Build `/dashboard/performance` that, for the selected employee, shows stat cards and a Recharts bar chart of Completed / On time / Late / Overdue / Pending."

**Test:** As HR, open Performance and see the employee's numbers and chart.

---

### Feature 10 — AI performance summary & rating (Gemini)
**What it does:** HR clicks "Generate with AI" and gets a short written performance review plus a suggested 1–5 rating. HR can accept or override it, then save.

**How it works:** A Next.js API route (`/api/ai-summary`) receives the employee's stats, builds a prompt, and calls the Gemini API server-side (so the key is never exposed to the browser). Gemini returns a summary + suggested score as JSON. HR sets the final score and saves a row into `ratings`.

**Claude Code prompt:**
> "Create a server API route `POST /api/ai-summary` that verifies the caller is an HR (via their profile), reads `GEMINI_API_KEY` from the environment, and calls Google Gemini `gemini-1.5-flash` with a prompt that includes the employee's stats and asks for a JSON object `{summary, suggestedScore}` (score 1–5). On `/dashboard/performance`, add a 'Generate with AI' button that calls this route and displays the summary and suggested score, a 1–5 rating selector defaulting to the AI's suggestion, an optional comment, and a 'Save rating' button that inserts into the `ratings` table."

**Test:** Set the Gemini key, click Generate, see the summary and score, save the rating.

---

## 7. Optional stretch features (only if time allows)
- **Employee self-view of their rating** (transparency).
- **In-app notifications** (bell icon when a task is assigned or reviewed).
- **Edit/reassign** an existing task.

These are not required for the core system and shouldn't be started until Features 1–10 are done.

---

## 8. Build order (recommended sequence)

Do these strictly in order — each depends on the ones before:

1. Feature 1 — Setup
2. Feature 2 — Database schema
3. Feature 3 — Auth & roles
4. Feature 4 — HR assigns tasks
5. Feature 5 — Employee sees & starts tasks
6. Feature 6 — Employee submits work
7. Feature 7 — HR reviews submissions
8. Feature 8 — Overdue tracking
9. Feature 9 — Performance dashboard
10. Feature 10 — AI summary & rating

By step 7 you already have a working end-to-end loop to demo. Steps 8–10 add the "monitoring & intelligence" that makes the project stand out.

---

## 9. Team responsibility split (3 people)

| Person | Owns features | Focus |
|--------|---------------|-------|
| **A** | 1, 2, 3 | Foundation: setup, database, auth & roles. Starts first; others depend on this. |
| **B** | 4, 5, 6, 7, 8 | Task lifecycle: assign → view → submit → review → overdue. The core loop. |
| **C** | 9, 10 | Performance dashboard + Gemini AI. Builds on B's task data. |

While you're building solo right now, follow the same order — you'll just do A, then B, then C yourself, and hand off cleanly when your teammates join.

---

## 10. Success criteria (how you know it's done)

- [ ] HR and Employee can each sign up, log in, and see the correct dashboard.
- [ ] HR can assign a task with a deadline to an employee.
- [ ] Employee can see the task, start it, and submit work with a file.
- [ ] HR can review the submission and approve or return it.
- [ ] A missed-deadline task is automatically shown as overdue.
- [ ] HR can view per-employee performance stats and a chart.
- [ ] HR can generate an AI summary + suggested rating and save a final rating.

---

## 11. Setup checklist (before Feature 1)

- [x] Node.js installed
- [x] Claude Code installed (running in the Claude app)
- [ ] Supabase account created
- [ ] Gemini API key from https://aistudio.google.com/app/apikey
- [ ] A code editor / terminal ready

---

*End of PRD. Build one feature at a time, test after each, and keep this document open as your reference.*
