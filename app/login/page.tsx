"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import styles from "./page.module.css";

export default function LoginPage() {
  const [pending, setPending] = useState(false);

  const signIn = async () => {
    setPending(true);
    await authClient.signIn.social({ provider: "google", callbackURL: "/" });
  };

  return (
    <main className={styles.main}>
      <div className={styles.card}>
        <h1 className={styles.title}>토스증권 대시보드</h1>
        <p className={styles.subtitle}>nalbam.com 계정으로 로그인하세요.</p>
        <button
          type="button"
          className={styles.button}
          onClick={signIn}
          disabled={pending}
        >
          {pending ? "로그인 중…" : "Google로 로그인"}
        </button>
      </div>
    </main>
  );
}
