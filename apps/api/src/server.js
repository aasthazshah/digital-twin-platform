import cors from "cors";
import express from "express";

const app = express();
const port = Number(process.env.PORT || 4000);
const corsOrigin = process.env.CORS_ORIGIN || "*";

app.use(
  cors({
    origin:
      corsOrigin === "*"
        ? true
        : corsOrigin
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
  })
);
app.use(express.json());

const DISCLAIMER =
  "Educational simulation only. This app does not provide medical diagnosis, treatment, or prescriptions.";

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const toFactor = {
  bodyCategory: {
    underweight: 0.45,
    healthy: 0.8,
    overweight: 0.55,
    obese: 0.35
  },
  activityLevel: {
    sedentary: 0.3,
    light: 0.5,
    moderate: 0.75,
    high: 0.9
  },
  dietCategory: {
    poor: 0.3,
    average: 0.55,
    balanced: 0.85
  },
  healthConditionCategory: {
    poor: 0.3,
    fair: 0.55,
    good: 0.8
  },
  ageRange: {
    "13-17": 0.75,
    "18-25": 0.8,
    "26-35": 0.78,
    "36-45": 0.72,
    "46-55": 0.65,
    "56-65": 0.58,
    "66+": 0.5
  },
  medicationAdherence: {
    adherent: 0.8,
    partial: 0.5,
    non_adherent: 0.25
  },
  stressLevel: {
    low: 0.8,
    moderate: 0.6,
    high: 0.4,
    acute: 0.2
  }
};

const baseWeights = {
  sleepHours: 0.25,
  activityLevel: 0.25,
  dietCategory: 0.2,
  bodyCategory: 0.1,
  healthConditionCategory: 0.1,
  ageRange: 0.05,
  medicationAdherence: 0.03,
  stressLevel: 0.02
};

function sleepFactor(sleepHours) {
  const distance = Math.abs(8 - sleepHours);
  return clamp(1 - distance / 8, 0, 1);
}

function validateInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      valid: false,
      errors: [{ field: "input", message: "Input must be a JSON object" }]
    };
  }

  const required = [
    "ageRange",
    "bodyCategory",
    "sleepHours",
    "activityLevel",
    "dietCategory",
    "healthConditionCategory"
  ];

  const errors = [];
  for (const field of required) {
    if (input[field] === undefined || input[field] === null || input[field] === "") {
      errors.push({ field, message: "Field is required" });
    }
  }

  if (typeof input.sleepHours !== "number" || input.sleepHours < 0 || input.sleepHours > 24) {
    errors.push({ field: "sleepHours", message: "sleepHours must be between 0 and 24" });
  }

  return { valid: errors.length === 0, errors };
}

function computeScore(input) {
  const factors = {
    sleepHours: sleepFactor(input.sleepHours),
    bodyCategory: toFactor.bodyCategory[input.bodyCategory] ?? 0.4,
    activityLevel: toFactor.activityLevel[input.activityLevel] ?? 0.4,
    dietCategory: toFactor.dietCategory[input.dietCategory] ?? 0.4,
    healthConditionCategory:
      toFactor.healthConditionCategory[input.healthConditionCategory] ?? 0.4,
    ageRange: toFactor.ageRange[input.ageRange] ?? 0.5
  };

  if (input.medicationAdherence) {
    factors.medicationAdherence =
      toFactor.medicationAdherence[input.medicationAdherence] ?? 0.4;
  }

  if (input.stressLevel) {
    factors.stressLevel = toFactor.stressLevel[input.stressLevel] ?? 0.4;
  }

  const keys = Object.keys(factors);
  const weightTotal = keys.reduce((sum, key) => sum + (baseWeights[key] || 0), 0);
  const weighted = keys.reduce(
    (sum, key) => sum + factors[key] * ((baseWeights[key] || 0) / weightTotal),
    0
  );

  return {
    relativeScore: Math.round(weighted * 10000) / 100,
    factorScores: factors
  };
}

function trendFromDelta(delta) {
  if (delta >= 3) return "improving";
  if (delta <= -3) return "declining";
  return "stable";
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "digital-twin-api", version: "0.1.0" });
});

app.get("/v1/disclaimer", (_req, res) => {
  res.json({ text: DISCLAIMER });
});

app.post("/v1/baseline", (req, res) => {
  const input = req.body;
  const validation = validateInput(input);
  if (!validation.valid) {
    return res.status(400).json({
      code: "VALIDATION_ERROR",
      message: "Invalid baseline input",
      details: validation.errors
    });
  }

  const { relativeScore, factorScores } = computeScore(input);
  return res.json({
    baselineId: `base_${Date.now()}`,
    input,
    relativeScore,
    factorScores,
    trendLabel: "stable",
    generatedAt: new Date().toISOString(),
    disclaimer: DISCLAIMER
  });
});

app.post("/v1/scenarios/run", (req, res) => {
  const { baseline, scenarios } = req.body || {};
  if (
    !baseline ||
    typeof baseline !== "object" ||
    !baseline.input ||
    !Array.isArray(scenarios)
  ) {
    return res.status(400).json({
      code: "VALIDATION_ERROR",
      message: "Request must include baseline and scenarios[]"
    });
  }

  const baselineScore = Number(baseline.relativeScore || 0);
  const results = scenarios.map((scenario, index) => {
    const effectiveInput = { ...baseline.input, ...(scenario.overrides || {}) };
    const validation = validateInput(effectiveInput);
    if (!validation.valid) {
      return {
        scenarioId: `scn_${index + 1}`,
        scenarioName: scenario.scenarioName || `Scenario ${index + 1}`,
        error: validation.errors,
        disclaimer: DISCLAIMER
      };
    }

    const computed = computeScore(effectiveInput);
    const delta = Math.round((computed.relativeScore - baselineScore) * 100) / 100;
    const deviationPercent =
      Math.round((Math.abs(delta) / Math.max(baselineScore, 1)) * 10000) / 100;

    return {
      scenarioId: `scn_${index + 1}`,
      scenarioName: scenario.scenarioName || `Scenario ${index + 1}`,
      effectiveInput,
      relativeScore: computed.relativeScore,
      deltaFromBaseline: delta,
      deviationPercent,
      trendDirection: trendFromDelta(delta),
      generatedAt: new Date().toISOString(),
      disclaimer: DISCLAIMER
    };
  });

  return res.json(results);
});

app.post("/v1/scenarios/compare", (req, res) => {
  const { baseline, scenarioResults } = req.body || {};
  if (!baseline || typeof baseline !== "object" || !Array.isArray(scenarioResults)) {
    return res.status(400).json({
      code: "VALIDATION_ERROR",
      message: "Request must include baseline and scenarioResults[]"
    });
  }

  const normalized = scenarioResults
    .filter((item) => item && typeof item.relativeScore === "number")
    .map((item) => {
      const cue = item.trendDirection === "improving" ? "up" : item.trendDirection === "declining" ? "down" : "flat";
      return {
        scenarioId: item.scenarioId,
        scenarioName: item.scenarioName,
        score: item.relativeScore,
        delta: item.deltaFromBaseline,
        trendDirection: item.trendDirection,
        cue,
        summary: `${item.scenarioName}: ${item.trendDirection} (${item.deltaFromBaseline} vs baseline)`
      };
    });

  return res.json({
    baselineScore: baseline.relativeScore,
    scenarios: normalized,
    disclaimer: DISCLAIMER
  });
});

app.listen(port, () => {
  console.log(`API running on port ${port}`);
});
