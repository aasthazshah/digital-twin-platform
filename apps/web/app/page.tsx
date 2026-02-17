const features = [
  "Generate baseline health trend state",
  "Create multiple what-if scenarios",
  "Compare relative trend changes against baseline",
  "Educational use only (non-diagnostic)"
];

export default function Home() {
  return (
    <main className="page">
      <section className="card">
        <p className="badge">Website First</p>
        <h1>Personalized Digital Twin Health App</h1>
        <p className="subtitle">
          Frontend scaffold deployed first on Vercel. API and persistence are
          connected in the next phases.
        </p>
        <ul>
          {features.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="notice">
          Disclaimer: This app is for educational simulation only and does not
          provide medical diagnosis, treatment, or prescriptions.
        </p>
      </section>
    </main>
  );
}

