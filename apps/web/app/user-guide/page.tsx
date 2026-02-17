import Link from "next/link";

const quickSteps = [
  "Open the app and wait for guest identity to initialize.",
  "Save your Public Identity ID and Recovery Key in a safe place.",
  "Fill baseline lifestyle inputs and click Generate Baseline.",
  "Add or edit scenarios, then click Run Scenarios.",
  "Read score, trend, and comparison summary.",
  "Use Saved Sessions to load previous work from the same identity."
];

export default function UserGuidePage() {
  return (
    <main className="page explain-page">
      <section className="card">
        <p className="badge">User Guide</p>
        <h1>How To Use This App</h1>
        <p className="subtitle">
          This guide explains what to click, what each section means, and how identity
          works.
        </p>
        <div className="hero-actions">
          <Link className="chip-link" href="/">
            Back To Simulator
          </Link>
          <Link className="chip-link" href="/how-it-works">
            Formula + Graphs Page
          </Link>
        </div>
      </section>

      <section className="card">
        <h2>1) Quick Start</h2>
        <ol className="guide-list">
          {quickSteps.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </section>

      <section className="card">
        <h2>2) What Each Section Does</h2>
        <div className="guide-grid">
          <div className="guide-item">
            <h3>Identity</h3>
            <p>
              Shows who you are in this app right now. Your saved sessions are attached to
              this identity.
            </p>
          </div>
          <div className="guide-item">
            <h3>Baseline Input</h3>
            <p>
              Your starting lifestyle profile. This becomes the reference point for all
              scenario comparisons.
            </p>
          </div>
          <div className="guide-item">
            <h3>Scenarios</h3>
            <p>
              What-if changes (like more sleep, better activity, stress event). You can add
              multiple scenarios.
            </p>
          </div>
          <div className="guide-item">
            <h3>Saved Sessions</h3>
            <p>
              List of past runs for the same identity. Click <strong>Load</strong> to bring
              old results back on screen.
            </p>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>3) Identity Explained Like A Locker Key</h2>
        <p>
          Your guest identity is like a locker key. Only that key can open that locker.
        </p>
        <div className="guide-grid">
          <div className="guide-item">
            <h3>Same Key</h3>
            <p>You see the same saved sessions and can load them again.</p>
          </div>
          <div className="guide-item">
            <h3>Recovery</h3>
            <p>
              If you lose access (new browser/device), use <strong>Public Identity ID</strong>{" "}
              and <strong>Recovery Key</strong> in the Recover Identity form.
            </p>
          </div>
          <div className="guide-item">
            <h3>New Key</h3>
            <p>
              If you click <strong>Create New Guest Identity</strong>, you get a new key. Old
              sessions stay in database, but are not visible to this new identity.
            </p>
          </div>
        </div>
        <p className="identity-warning">
          Keep the recovery key offline. It is shown once and is needed to recover your
          old sessions.
        </p>
      </section>

      <section className="card">
        <h2>4) Key Summary</h2>
        <ul>
          <li>It is an educational digital twin simulation, not a medical tool.</li>
          <li>It uses weighted math to show relative trend changes.</li>
          <li>Baseline and scenarios are compared using score difference rules.</li>
          <li>Identity keeps each user's sessions private and separate.</li>
        </ul>
        <p className="notice">
          Educational simulation only. This app does not provide diagnosis, treatment, or
          prescriptions.
        </p>
      </section>
    </main>
  );
}
