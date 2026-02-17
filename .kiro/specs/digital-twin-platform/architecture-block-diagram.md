# Personalized Digital Twin Health App - Simple Block Diagram

## Quick View

```text
User -> App UI -> API Layer -> Core Services -> Data Stores
                              -> Safety Guard -> Final Output
```

## Mermaid Block Diagram

```mermaid
flowchart LR
    U[User]
    UI[App UI]
    API[API Layer]

    V[Input Validation]
    B[Baseline Generator]
    S[Scenario Simulator]
    C[Comparison and Feedback]
    G[Safety and Disclaimer Guard]

    D[(Session Store)]
    CFG[(Scoring Config)]

    U --> UI --> API

    API --> V
    API --> B
    API --> S
    API --> C
    API --> G

    B --> CFG
    S --> CFG
    C --> CFG

    B --> D
    S --> D
    C --> D

    G --> UI
```

## Deployment View (Vercel + Railway)

```mermaid
flowchart LR
    User[User Browser]
    Vercel[Vercel - Web App]
    RailwayAPI[Railway - API Service]
    RailwayDB[(Railway PostgreSQL)]

    User --> Vercel
    Vercel -->|HTTPS: api.domain| RailwayAPI
    RailwayAPI --> RailwayDB
```
