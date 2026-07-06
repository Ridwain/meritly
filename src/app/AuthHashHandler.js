"use client";

import { useEffect } from "react";

// Safety net: if an auth link (invite / password recovery) ever lands on the
// landing page with tokens in the URL hash — e.g. Supabase fell back to the
// Site URL — forward it to /auth/accept, keeping the hash so the tokens survive.
export default function AuthHashHandler() {
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("access_token")) {
      window.location.replace("/auth/accept" + hash);
    }
  }, []);
  return null;
}
