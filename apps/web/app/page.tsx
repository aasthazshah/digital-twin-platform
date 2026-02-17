"use client";

import { useMemo, useState } from "react";

type Trend = "improving" | "stable" | "declining";

type LifestyleInput = {
  ageRange: string;
  bodyCategory: string;
  sleepHours: number;
  activityLevel: string;
  dietCategory: string;
  healthConditionCategory: string;
  medicationAdherence?: string;
  stressLevel?: string;
};

type BaselineState = {
  sessionId?: string;
  baselineId: string;
  input: LifestyleInput;
  relativeScore: number;
  factorScores: Record<string, number>;
  trendLabel: Trend;
  generatedAt: string;
  disclaimer: string;
};

type ScenarioResult = {
  scenarioId: string;
  scenarioName: string;
  relativeScore: number;
  deltaFromBaseline: number;
  deviationPercent: number;
  trendDirection: Trend;
  generatedAt: string;
  disclaimer: string;
  error?: Array<{ field: string; message: string }>;
};

type ComparisonResult = {
  baselineScore: number;
  scenarios: Array<{
    scenarioId: string;
    scenarioName: string;
    score: number;
    delta: number;
    trendDirection: Trend;
    cue: "up" | "flat" | "down";
    summary: string;
  }>;
  disclaimer: string;
};

type ScenarioDraft = {
  id: number;
  scenarioName: string;
  sleepHours: string;
  activityLevel: string;
  dietCategory: string;
  medicationAdherence: string;
  stressLevel: string;
};

type SessionSummary = {
  sessionId: string;
  baselineScore: number | null;
  scenarioCount: number;
  hasComparison: boolean;
  createdAt: string;
  updatedAt: string;
};

type StoredSession = {
  sessionId: string;
  baseline: BaselineState | null;
  scenarioResults: ScenarioResult[];
  comparison: ComparisonResult | null;
  createdAt: string;
  updatedAt: string;
  disclaimer: string;
};

const AGE_RANGES = ["13-17", "18-25", "26-35", "36-45", "46-55", "56-65", "66+"];
const BODY_CATEGORIES = ["underweight", "healthy", "overweight", "obese"];
const ACTIVITY_LEVELS = ["sedentary", "light", "moderate", "high"];
const DIET_CATEGORIES = ["poor", "average", "balanced"];
const HEALTH_CONDITIONS = ["poor", "fair", "good"];
const ADHERENCE_OPTIONS = ["adherent", "partial", "non_adherent"];
const STRESS_OPTIONS = ["low", "moderate", "high", "acute"];

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default function Home() {
  const [input, setInput] = useState({
    ageRange: "26-35",
    bodyCategory: "healthy",
    sleepHours: "7",
    activityLevel: "moderate",
    dietCategory: "average",
    healthConditionCategory: "fair",
    medicationAdherence: "",
    stressLevel: ""
  });

  const [scenarios, setScenarios] = useState<ScenarioDraft[]>([
    {
      id: 1,
      scenarioName: "Better sleep + activity",
      sleepHours: "8",
      activityLevel: "high",
      dietCategory: "",
      medicationAdherence: "",
      stressLevel: ""
    },
    {
      id: 2,
      scenarioName: "Acute stress event",
      sleepHours: "5",
      activityLevel: "",
      dietCategory: "",
      medicationAdherence: "",
      stressLevel: "acute"
    }
  ]);

  const [baseline, setBaseline] = useState<BaselineState | null>(null);
  const [scenarioResults, setScenarioResults] = useState<ScenarioResult[]>([]);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [recentSessions, setRecentSessions] = useState<SessionSummary[]>([]);
  const [disclaimer, setDisclaimer] = useState<string>(
    "Educational simulation only. This app does not provide medical diagnosis, treatment, or prescriptions."
  );
  const [loadingBaseline, setLoadingBaseline] = useState(false);
  const [loadingScenarios, setLoadingScenarios] = useState(false);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scenarioCountText = useMemo(
    () => `${scenarios.length} scenario${scenarios.length === 1 ? "" : "s"} ready`,
    [scenarios.length]
  );

  function updateInput(field: keyof typeof input, value: string) {
    setInput((prev) => ({ ...prev, [field]: value }));
  }

  function updateScenario(id: number, field: keyof ScenarioDraft, value: string) {
    setScenarios((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  }

  function addScenario() {
    setScenarios((prev) => [
      ...prev,
      {
        id: Date.now(),
        scenarioName: `Scenario ${prev.length + 1}`,
        sleepHours: "",
        activityLevel: "",
        dietCategory: "",
        medicationAdherence: "",
        stressLevel: ""
      }
    ]);
  }

  function removeScenario(id: number) {
    setScenarios((prev) => prev.filter((item) => item.id !== id));
  }

  async function generateBaseline() {
    setError(null);
    setLoadingBaseline(true);

    try {
      const payload: LifestyleInput = {
        ageRange: input.ageRange,
        bodyCategory: input.bodyCategory,
        sleepHours: Number(input.sleepHours),
        activityLevel: input.activityLevel,
        dietCategory: input.dietCategory,
        healthConditionCategory: input.healthConditionCategory
      };

      if (input.medicationAdherence) {
        payload.medicationAdherence = input.medicationAdherence;
      }
      if (input.stressLevel) {
        payload.stressLevel = input.stressLevel;
      }

      const response = await fetch(`${API_BASE}/v1/baseline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message || "Failed to generate baseline");
      }

      const data: BaselineState = await response.json();
      setBaseline(data);
      setDisclaimer(data.disclaimer || disclaimer);
      setScenarioResults([]);
      setComparison(null);
      await fetchRecentSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate baseline");
    } finally {
      setLoadingBaseline(false);
    }
  }

  async function runScenarios() {
    if (!baseline) {
      setError("Generate a baseline first.");
      return;
    }

    setError(null);
    setLoadingScenarios(true);

    try {
      const payload = {
        baseline,
        scenarios: scenarios.map((scenario) => {
          const overrides: Record<string, string | number> = {};
          if (scenario.sleepHours !== "") {
            overrides.sleepHours = Number(scenario.sleepHours);
          }
          if (scenario.activityLevel) {
            overrides.activityLevel = scenario.activityLevel;
          }
          if (scenario.dietCategory) {
            overrides.dietCategory = scenario.dietCategory;
          }
          if (scenario.medicationAdherence) {
            overrides.medicationAdherence = scenario.medicationAdherence;
          }
          if (scenario.stressLevel) {
            overrides.stressLevel = scenario.stressLevel;
          }

          return {
            scenarioName: scenario.scenarioName || "Unnamed scenario",
            overrides
          };
        })
      };

      const runResponse = await fetch(`${API_BASE}/v1/scenarios/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!runResponse.ok) {
        const body = await runResponse.json().catch(() => null);
        throw new Error(body?.message || "Failed to run scenarios");
      }

      const runData: ScenarioResult[] = await runResponse.json();
      setScenarioResults(runData);

      const compareResponse = await fetch(`${API_BASE}/v1/scenarios/compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseline,
          scenarioResults: runData
        })
      });

      if (!compareResponse.ok) {
        const body = await compareResponse.json().catch(() => null);
        throw new Error(body?.message || "Failed to compare scenarios");
      }

      const compareData: ComparisonResult = await compareResponse.json();
      setComparison(compareData);
      setDisclaimer(compareData.disclaimer || disclaimer);
      await fetchRecentSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run scenarios");
    } finally {
      setLoadingScenarios(false);
    }
  }

  async function fetchRecentSessions() {
    setLoadingRecent(true);
    try {
      const response = await fetch(`${API_BASE}/v1/sessions?limit=10`);
      if (!response.ok) {
        return;
      }

      const data = await response.json();
      if (Array.isArray(data.items)) {
        setRecentSessions(data.items);
      }
    } catch (_error) {
      // ignore optional fetch errors in UI flow
    } finally {
      setLoadingRecent(false);
    }
  }

  async function loadSession(sessionId: string) {
    setLoadingSessionId(sessionId);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/v1/sessions/${sessionId}`);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message || "Failed to load session");
      }

      const session: StoredSession = await response.json();
      setBaseline(session.baseline);
      setScenarioResults(Array.isArray(session.scenarioResults) ? session.scenarioResults : []);
      setComparison(session.comparison || null);
      setDisclaimer(session.disclaimer || disclaimer);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load session");
    } finally {
      setLoadingSessionId(null);
    }
  }

  return (
    <main className="page">
      <div className="hero">
        <p className="badge">Phase 2</p>
        <h1>Personalized Digital Twin Health App</h1>
        <p className="subtitle">
          Baseline/scenario simulation with session persistence and reload support.
        </p>
      </div>

      <section className="card">
        <h2>1) Baseline Input</h2>
        <div className="grid">
          <label>
            Age range
            <select
              value={input.ageRange}
              onChange={(event) => updateInput("ageRange", event.target.value)}
            >
              {AGE_RANGES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label>
            Height/weight category
            <select
              value={input.bodyCategory}
              onChange={(event) => updateInput("bodyCategory", event.target.value)}
            >
              {BODY_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label>
            Sleep (hours/night)
            <input
              type="number"
              min={0}
              max={24}
              step={0.5}
              value={input.sleepHours}
              onChange={(event) => updateInput("sleepHours", event.target.value)}
            />
          </label>

          <label>
            Physical activity
            <select
              value={input.activityLevel}
              onChange={(event) => updateInput("activityLevel", event.target.value)}
            >
              {ACTIVITY_LEVELS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label>
            Diet category
            <select
              value={input.dietCategory}
              onChange={(event) => updateInput("dietCategory", event.target.value)}
            >
              {DIET_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label>
            General health condition
            <select
              value={input.healthConditionCategory}
              onChange={(event) => updateInput("healthConditionCategory", event.target.value)}
            >
              {HEALTH_CONDITIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label>
            Medication adherence (optional)
            <select
              value={input.medicationAdherence}
              onChange={(event) => updateInput("medicationAdherence", event.target.value)}
            >
              <option value="">No override</option>
              {ADHERENCE_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label>
            Stress level (optional)
            <select
              value={input.stressLevel}
              onChange={(event) => updateInput("stressLevel", event.target.value)}
            >
              <option value="">No override</option>
              {STRESS_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="actions">
          <button onClick={generateBaseline} disabled={loadingBaseline}>
            {loadingBaseline ? "Generating..." : "Generate Baseline"}
          </button>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>2) Scenarios</h2>
          <p>{scenarioCountText}</p>
        </div>

        {scenarios.map((scenario) => (
          <div className="scenario" key={scenario.id}>
            <div className="scenario-head">
              <input
                type="text"
                value={scenario.scenarioName}
                onChange={(event) =>
                  updateScenario(scenario.id, "scenarioName", event.target.value)
                }
              />
              <button className="ghost" onClick={() => removeScenario(scenario.id)}>
                Remove
              </button>
            </div>

            <div className="grid grid-scenario">
              <label>
                Sleep override
                <input
                  type="number"
                  min={0}
                  max={24}
                  step={0.5}
                  value={scenario.sleepHours}
                  onChange={(event) =>
                    updateScenario(scenario.id, "sleepHours", event.target.value)
                  }
                  placeholder="No change"
                />
              </label>

              <label>
                Activity override
                <select
                  value={scenario.activityLevel}
                  onChange={(event) =>
                    updateScenario(scenario.id, "activityLevel", event.target.value)
                  }
                >
                  <option value="">No change</option>
                  {ACTIVITY_LEVELS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Diet override
                <select
                  value={scenario.dietCategory}
                  onChange={(event) =>
                    updateScenario(scenario.id, "dietCategory", event.target.value)
                  }
                >
                  <option value="">No change</option>
                  {DIET_CATEGORIES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Medication override
                <select
                  value={scenario.medicationAdherence}
                  onChange={(event) =>
                    updateScenario(scenario.id, "medicationAdherence", event.target.value)
                  }
                >
                  <option value="">No change</option>
                  {ADHERENCE_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Stress override
                <select
                  value={scenario.stressLevel}
                  onChange={(event) =>
                    updateScenario(scenario.id, "stressLevel", event.target.value)
                  }
                >
                  <option value="">No change</option>
                  {STRESS_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        ))}

        <div className="actions">
          <button className="ghost" onClick={addScenario}>
            Add Scenario
          </button>
          <button onClick={runScenarios} disabled={!baseline || loadingScenarios}>
            {loadingScenarios ? "Running..." : "Run Scenarios"}
          </button>
        </div>
      </section>

      {error ? <p className="error">{error}</p> : null}

      {baseline ? (
        <section className="card">
          <h2>3) Baseline Result</h2>
          <div className="result-grid">
            <div className="result-box">
              <p className="label">Relative score</p>
              <p className="value">{baseline.relativeScore}</p>
            </div>
            <div className="result-box">
              <p className="label">Trend</p>
              <p className="value cap">{baseline.trendLabel}</p>
            </div>
            <div className="result-box">
              <p className="label">Session ID</p>
              <p className="value small">{baseline.sessionId || "n/a"}</p>
            </div>
          </div>
        </section>
      ) : null}

      {scenarioResults.length > 0 ? (
        <section className="card">
          <h2>4) Scenario Results</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Score</th>
                  <th>Delta</th>
                  <th>Deviation %</th>
                  <th>Trend</th>
                </tr>
              </thead>
              <tbody>
                {scenarioResults.map((row) => (
                  <tr key={row.scenarioId}>
                    <td>{row.scenarioName}</td>
                    <td>{typeof row.relativeScore === "number" ? row.relativeScore : "-"}</td>
                    <td>
                      {typeof row.deltaFromBaseline === "number" ? row.deltaFromBaseline : "-"}
                    </td>
                    <td>
                      {typeof row.deviationPercent === "number" ? row.deviationPercent : "-"}
                    </td>
                    <td className="cap">{row.trendDirection || "error"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {comparison ? (
        <section className="card">
          <h2>5) Comparison Summary</h2>
          <p className="subtitle">Baseline score: {comparison.baselineScore}</p>
          <ul>
            {comparison.scenarios.map((item) => (
              <li key={item.scenarioId}>{item.summary}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card">
        <div className="section-head">
          <h2>6) Saved Sessions</h2>
          <button className="ghost" onClick={fetchRecentSessions} disabled={loadingRecent}>
            {loadingRecent ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {recentSessions.length === 0 ? (
          <p className="subtitle">No saved sessions found yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Baseline</th>
                  <th>Scenarios</th>
                  <th>Updated</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {recentSessions.map((item) => (
                  <tr key={item.sessionId}>
                    <td>{item.sessionId}</td>
                    <td>{item.baselineScore ?? "-"}</td>
                    <td>{item.scenarioCount}</td>
                    <td>{new Date(item.updatedAt).toLocaleString()}</td>
                    <td>
                      <button
                        className="ghost"
                        onClick={() => loadSession(item.sessionId)}
                        disabled={loadingSessionId === item.sessionId}
                      >
                        {loadingSessionId === item.sessionId ? "Loading..." : "Load"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <p className="notice">{disclaimer}</p>
      </section>
    </main>
  );
}

