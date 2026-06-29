"use client";

import { authClient } from "@/lib/auth-client";
import page from "@/app/page.module.css";

export function LogoutButton() {
  const signOut = async () => {
    await authClient.signOut();
    window.location.href = "/login";
  };

  return (
    <button type="button" className={page.select} onClick={signOut}>
      로그아웃
    </button>
  );
}
