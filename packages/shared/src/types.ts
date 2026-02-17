export type AgeRange =
  | "13-17"
  | "18-25"
  | "26-35"
  | "36-45"
  | "46-55"
  | "56-65"
  | "66+";

export type BodyCategory = "underweight" | "healthy" | "overweight" | "obese";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "high";
export type DietCategory = "poor" | "average" | "balanced";
export type HealthConditionCategory = "poor" | "fair" | "good";
export type MedicationAdherence = "adherent" | "partial" | "non_adherent";
export type StressLevel = "low" | "moderate" | "high" | "acute";

export interface LifestyleInput {
  ageRange: AgeRange;
  bodyCategory: BodyCategory;
  sleepHours: number;
  activityLevel: ActivityLevel;
  dietCategory: DietCategory;
  healthConditionCategory: HealthConditionCategory;
  medicationAdherence?: MedicationAdherence;
  stressLevel?: StressLevel;
}

export interface BaselineState {
  baselineId: string;
  input: LifestyleInput;
  relativeScore: number;
  factorScores: Record<string, number>;
  trendLabel: "improving" | "stable" | "declining";
  generatedAt: string;
  disclaimer: string;
}

export interface ScenarioInput {
  scenarioName: string;
  overrides: Partial<LifestyleInput>;
}

export interface ScenarioResult {
  scenarioId: string;
  scenarioName: string;
  effectiveInput: LifestyleInput;
  relativeScore: number;
  deltaFromBaseline: number;
  deviationPercent: number;
  trendDirection: "improving" | "stable" | "declining";
  generatedAt: string;
  disclaimer: string;
}

