# Meritly

**Employee Work Monitoring & Performance Management System**

A web app where HR assigns tasks to employees, employees submit their completed
work, the system automatically records completion and missed deadlines, and HR
monitors each employee's performance — with an **AI-generated performance review**
to help HR rate fairly.

> CSE327 — Software Engineering course project.

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 14 (App Router) |
| Language | JavaScript |
| Styling | Tailwind CSS |
| Database + Auth + Storage | Supabase (Postgres) |
| AI | Google Gemini |
| Charts | Recharts |

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy the environment template and fill in your keys:
   ```bash
   cp .env.local.example .env.local
   ```
   - `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from your
     Supabase project (Settings → API).
   - `GEMINI_API_KEY` — from https://aistudio.google.com/app/apikey (needed for
     the AI performance summary).
3. Run the dev server:
   ```bash
   npm run dev
   ```
4. Open http://localhost:3000.

## Roles

- **HR / Manager** — assign & manage tasks, review submissions, view performance
  dashboards, and rate employees.
- **Employee** — see assigned tasks, start them, submit work (with file upload),
  and view their own stats.

## Build Roadmap

The app is built feature-by-feature (see `PRD.md`):

1. Project setup & foundation ✅
2. Database schema (tables + RLS)
3. Authentication & role-based routing
4. HR task assignment
5. Employee task view & start
6. Work submission (with file upload)
7. HR submission review
8. Automatic overdue tracking
9. HR performance dashboard
10. AI performance summary & rating (Gemini)
