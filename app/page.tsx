import { Dashboard } from "./_components/Dashboard";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <Dashboard />
      </main>
    </div>
  );
}
