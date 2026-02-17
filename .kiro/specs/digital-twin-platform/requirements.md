# Personalized Digital Twin Health App
## Software Requirements Specification (SRS)

### 1. Project Overview

The Personalized Digital Twin Health App is an educational software application designed to simulate how lifestyle changes may influence overall health trends. The system creates a virtual health profile based on user-provided inputs and allows users to test hypothetical "what-if" scenarios.

The application is not intended for medical diagnosis or treatment.

### 2. Objectives

- Build a functional digital twin prototype.
- Simulate relative health trend changes based on lifestyle inputs.
- Allow users to compare baseline and modified scenarios.
- Provide clear and understandable feedback to users.
- Maintain privacy and avoid use of real patient medical records.

### 3. Functional Requirements

#### 3.1 User Input

The system shall allow users to enter:

- Age range
- Height and weight category
- Sleep duration (hours per night)
- Physical activity level
- Diet category
- General health condition category
- Optional: medication adherence status
- Optional: stress level indicator

#### 3.2 Baseline Generation

The system shall generate a baseline health state using user inputs.

- The baseline shall represent the expected health trend if current habits remain unchanged.
- The baseline shall serve as a reference for comparison.

#### 3.3 Scenario Simulation

The system shall allow users to:

- Modify individual lifestyle variables.
- Create multiple "what-if" scenarios.

Simulate changes such as:

- Reduced or improved sleep
- Altered diet patterns
- Increased or decreased physical activity
- Medication non-adherence
- Acute stress event

The system shall update the digital twin state after each modification.

#### 3.4 Output and Feedback

The system shall:

- Display relative changes compared to baseline.
- Indicate direction of trend (improving, stable, declining).
- Show deviation from baseline condition.
- Present results in text summaries, comparison indicators, or simple visual cues.

The system shall not provide medical diagnoses or treatment recommendations.

### 4. Non-Functional Requirements

#### 4.1 Safety and Ethics

- The system shall not collect real patient medical records.
- The system shall not diagnose diseases.
- The system shall not provide medical prescriptions.
- The app shall include a disclaimer stating it is for educational purposes only.

#### 4.2 Usability

- The user interface shall be simple and easy to understand.
- Inputs shall be clearly labeled.
- Output explanations shall be written in plain language.

#### 4.3 Performance

- Scenario simulation shall complete within 2 seconds.
- The system shall handle multiple scenario comparisons efficiently.

### 5. Assumptions and Limitations

- All data entered by users is self-reported.
- The model uses generalized logic rather than clinical datasets.
- Results are relative simulations, not predictive medical outcomes.
