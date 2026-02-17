import Link from "next/link";

const WEIGHTS = [
  { label: "Sleep", weight: 25, color: "#0f766e" },
  { label: "Activity", weight: 25, color: "#0d9488" },
  { label: "Diet", weight: 20, color: "#14b8a6" },
  { label: "Body Category", weight: 10, color: "#2dd4bf" },
  { label: "General Health", weight: 10, color: "#6ee7d8" },
  { label: "Age Range", weight: 5, color: "#99f6e4" },
  { label: "Medication (Optional)", weight: 3, color: "#a7f3d0" },
  { label: "Stress (Optional)", weight: 2, color: "#bbf7d0" }
];

const EXAMPLE_FACTORS = [
  { factor: "Sleep", score: 0.875, weight: 25 },
  { factor: "Activity", score: 0.75, weight: 25 },
  { factor: "Diet", score: 0.55, weight: 20 },
  { factor: "Body Category", score: 0.8, weight: 10 },
  { factor: "General Health", score: 0.55, weight: 10 },
  { factor: "Age Range", score: 0.78, weight: 5 },
  { factor: "Medication", score: 0, weight: 0 },
  { factor: "Stress", score: 0, weight: 0 }
];

function sleepFactor(hours: number) {
  const distance = Math.abs(8 - hours);
  return Math.max(0, Math.min(1, 1 - distance / 8));
}

function sleepCurvePoints(width: number, height: number) {
  const maxHour = 24;
  return Array.from({ length: maxHour + 1 }, (_, hour) => {
    const x = (hour / maxHour) * width;
    const y = height - sleepFactor(hour) * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

function calculateExampleScore() {
  const weighted = EXAMPLE_FACTORS.reduce(
    (sum, item) => sum + item.score * (item.weight / 100),
    0
  );
  return Math.round(weighted * 10000) / 100;
}

const exampleScore = calculateExampleScore();
const scenarioScore = 79.89;
const delta = Math.round((scenarioScore - exampleScore) * 100) / 100;
const deviation = Math.round((Math.abs(delta) / Math.max(exampleScore, 1)) * 10000) / 100;

export default function HowItWorksPage() {
  const points = sleepCurvePoints(480, 180);

  return (
    <main className="page explain-page">
      <section className="card">
        <p className="badge">Student Explain Mode</p>
        <h1>How Our Health Trend Formula Works</h1>
        <p className="subtitle">
          This page is written for a 9th grade class demo. You can explain this to a
          teacher as: "It is a weighted score model, not a medical diagnosis model."
        </p>
        <div className="hero-actions">
          <Link className="chip-link" href="/">
            Back To Simulator
          </Link>
        </div>
      </section>

      <section className="card">
        <h2>1) Big Idea</h2>
        <p>
          We convert each lifestyle input into a score between <strong>0</strong> and{" "}
          <strong>1</strong>. Then we combine those scores using weights.
        </p>
        <pre className="formula-block">
{`relativeScore = 100 × weighted_sum(factorScores)`}
        </pre>
        <p className="subtitle">
          Higher score = better relative trend. It is educational and does not diagnose
          disease.
        </p>
      </section>

      <section className="card">
        <h2>2) Factor Weights (Bar Chart)</h2>
        <p className="subtitle">
          The biggest weights are sleep and activity, so they affect the score the most.
        </p>
        <div className="weight-chart">
          {WEIGHTS.map((item) => (
            <div key={item.label} className="weight-row">
              <span className="weight-label">{item.label}</span>
              <div className="weight-track">
                <div
                  className="weight-fill"
                  style={{ width: `${item.weight * 3}px`, background: item.color }}
                />
              </div>
              <span className="weight-value">{item.weight}%</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>3) Sleep Formula (Graph)</h2>
        <p>
          Sleep is best near <strong>8 hours</strong>. Too little or too much decreases the
          factor.
        </p>
        <pre className="formula-block">
{`sleepFactor = clamp(1 - |8 - sleepHours| / 8, 0, 1)`}
        </pre>
        <div className="graph-box">
          <svg
            viewBox="0 0 520 220"
            role="img"
            aria-label="Sleep factor curve"
            className="sleep-svg"
          >
            <rect x="20" y="20" width="480" height="180" fill="#fffdf8" stroke="#d8d1bf" />
            <line x1="20" y1="200" x2="500" y2="200" stroke="#8b8f99" />
            <line x1="20" y1="20" x2="20" y2="200" stroke="#8b8f99" />
            <polyline
              points={points
                .split(" ")
                .map((pair) => {
                  const [x, y] = pair.split(",");
                  return `${Number(x) + 20},${Number(y) + 20}`;
                })
                .join(" ")}
              fill="none"
              stroke="#0f766e"
              strokeWidth="3"
            />
            <line x1="180" y1="20" x2="180" y2="200" stroke="#0f766e" strokeDasharray="5 5" />
            <text x="168" y="214" className="svg-text">8h</text>
            <text x="26" y="35" className="svg-text">1.0</text>
            <text x="26" y="198" className="svg-text">0.0</text>
            <text x="410" y="214" className="svg-text">24h</text>
          </svg>
        </div>
      </section>

      <section className="card">
        <h2>4) Trend Rules</h2>
        <p>
          We compare the scenario score to the baseline score:
        </p>
        <pre className="formula-block">
{`delta = scenarioScore - baselineScore`}
        </pre>
        <div className="trend-band">
          <div className="trend-box trend-down">delta ≤ -3.0 : Declining</div>
          <div className="trend-box trend-flat">-3.0 &lt; delta &lt; +3.0 : Stable</div>
          <div className="trend-box trend-up">delta ≥ +3.0 : Improving</div>
        </div>
      </section>

      <section className="card">
        <h2>5) Worked Example</h2>
        <p className="subtitle">
          Baseline score from sample input: <strong>{exampleScore}</strong>
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Factor</th>
                <th>Score (0 to 1)</th>
                <th>Weight</th>
                <th>Contribution</th>
              </tr>
            </thead>
            <tbody>
              {EXAMPLE_FACTORS.map((item) => (
                <tr key={item.factor}>
                  <td>{item.factor}</td>
                  <td>{item.score.toFixed(3)}</td>
                  <td>{item.weight}%</td>
                  <td>{(item.score * (item.weight / 100)).toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="subtitle">Now test a scenario score: <strong>{scenarioScore}</strong></p>
        <pre className="formula-block">
{`delta = ${scenarioScore} - ${exampleScore} = ${delta}
deviationPercent = |delta| / baseline × 100
deviationPercent = ${deviation}%`}
        </pre>
        <p>
          Because delta is greater than +3, trend direction is <strong>Improving</strong>.
        </p>
      </section>

      <section className="card">
        <h2>6) What To Tell Your Teacher</h2>
        <ul>
          <li>This is a weighted math model for learning.</li>
          <li>Inputs are self-reported categories and hours.</li>
          <li>Output is a relative trend score, not a diagnosis.</li>
          <li>What-if scenarios help compare habits before real-world choices.</li>
        </ul>
        <p className="notice">
          Educational simulation only. No diagnosis, treatment advice, or prescriptions.
        </p>
      </section>
    </main>
  );
}

