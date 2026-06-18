import { Dashboard } from "./_components/Dashboard";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1 className={styles.title}>토스증권 대시보드</h1>
          <p className={styles.subtitle}>계좌 · 보유자산 · 환율</p>
        </header>
        <Dashboard />
      </main>
    </div>
  );
}
