"use client";

// PrintButton — a simple client component that calls window.print()
// when clicked. window.print() opens the browser's print dialog where
// HR can save the page as a PDF.
//
// This must be a separate "use client" file because window is only
// available in the browser, not on the server.

import { Printer } from "lucide-react";

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
    >
      <Printer className="h-4 w-4" />
      Print / Save as PDF
    </button>
  );
}
