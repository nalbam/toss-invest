import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Dashboard } from "./_components/Dashboard";
import styles from "./page.module.css";

export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <Dashboard />
      </main>
    </div>
  );
}
