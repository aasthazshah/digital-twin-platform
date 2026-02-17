import cors from "cors";
import crypto from "crypto";
import express from "express";
import pg from "pg";

const { Pool } = pg;

const app = express();
const port = Number(process.env.PORT || 4000);
const corsOrigin = process.env.CORS_ORIGIN || "*";
const databaseUrl = process.env.DATABASE_URL || "";
const databaseSsl = String(process.env.DATABASE_SSL || "").toLowerCase() === "true";
const authSecret = process.env.AUTH_SECRET || "dev-change-this-auth-secret";
const authTokenTtlSeconds = Number(process.env.AUTH_TOKEN_TTL_SECONDS || 60 * 60 * 24 * 30);
const recoveryThrottleWindowMsRaw = Number(
  process.env.RECOVERY_THROTTLE_WINDOW_MS || 10 * 60 * 1000
);
const recoveryThrottleMaxAttemptsRaw = Number(
  process.env.RECOVERY_THROTTLE_MAX_ATTEMPTS || 8
);

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
app.use(express.json({ limit: "1mb" }));

const DISCLAIMER =
  "Educational simulation only. This app does not provide medical diagnosis, treatment, or prescriptions.";

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const recoveryThrottleWindowMs = Number.isFinite(recoveryThrottleWindowMsRaw)
  ? clamp(Math.floor(recoveryThrottleWindowMsRaw), 1000, 24 * 60 * 60 * 1000)
  : 10 * 60 * 1000;
const recoveryThrottleMaxAttempts = Number.isFinite(recoveryThrottleMaxAttemptsRaw)
  ? clamp(Math.floor(recoveryThrottleMaxAttemptsRaw), 1, 100)
  : 8;

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

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateRecoveryKey() {
  return base64UrlEncode(crypto.randomBytes(24));
}

function hashRecoveryKey(recoveryKey, recoverySalt) {
  return base64UrlEncode(
    crypto.scryptSync(recoveryKey, recoverySalt, 32, {
      N: 16384,
      r: 8,
      p: 1
    })
  );
}

function buildRecoveryCredentials() {
  const recoveryKey = generateRecoveryKey();
  const recoverySalt = base64UrlEncode(crypto.randomBytes(16));
  const recoveryHash = hashRecoveryKey(recoveryKey, recoverySalt);
  return {
    recoveryKey,
    recoverySalt,
    recoveryHash
  };
}

function safeEqualString(a, b) {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  return (
    bufferA.length === bufferB.length && crypto.timingSafeEqual(bufferA, bufferB)
  );
}

function verifyRecoveryKey(recoveryKey, recoverySalt, expectedRecoveryHash) {
  if (
    typeof recoveryKey !== "string" ||
    !recoveryKey ||
    typeof recoverySalt !== "string" ||
    !recoverySalt ||
    typeof expectedRecoveryHash !== "string" ||
    !expectedRecoveryHash
  ) {
    return false;
  }

  const actualHash = hashRecoveryKey(recoveryKey, recoverySalt);
  return safeEqualString(actualHash, expectedRecoveryHash);
}

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

function ownershipError() {
  const error = new Error("Session ownership mismatch");
  error.code = "OWNERSHIP_MISMATCH";
  return error;
}

function normalizeSession(record) {
  const created =
    record.createdAt ||
    (record.created_at && typeof record.created_at.toISOString === "function"
      ? record.created_at.toISOString()
      : record.created_at);
  const updated =
    record.updatedAt ||
    (record.updated_at && typeof record.updated_at.toISOString === "function"
      ? record.updated_at.toISOString()
      : record.updated_at);

  return {
    sessionId: record.sessionId || record.session_id,
    ownerUserId: record.ownerUserId || record.owner_user_id,
    baseline: record.baseline ?? null,
    scenarioResults: record.scenarioResults || record.scenario_results || [],
    comparison: record.comparison ?? null,
    createdAt: created || new Date().toISOString(),
    updatedAt: updated || new Date().toISOString()
  };
}

function base64UrlEncode(input) {
  const value = typeof input === "string" ? Buffer.from(input) : input;
  return value
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(input) {
  const padded = input + "===".slice((input.length + 3) % 4);
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf8");
}

function signToken(payload) {
  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  const signature = base64UrlEncode(
    crypto.createHmac("sha256", authSecret).update(payloadEncoded).digest()
  );
  return `${payloadEncoded}.${signature}`;
}

function verifyToken(token) {
  if (!token || typeof token !== "string") {
    return null;
  }

  const [payloadEncoded, signature] = token.split(".");
  if (!payloadEncoded || !signature) {
    return null;
  }

  const expectedSignature = base64UrlEncode(
    crypto.createHmac("sha256", authSecret).update(payloadEncoded).digest()
  );
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(payloadEncoded));
    if (!payload || typeof payload !== "object") {
      return null;
    }
    if (typeof payload.uid !== "string" || !payload.uid) {
      return null;
    }
    if (typeof payload.exp !== "number" || Date.now() >= payload.exp * 1000) {
      return null;
    }
    return payload;
  } catch (_error) {
    return null;
  }
}

function createAuthPayload(userId) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + authTokenTtlSeconds;
  const payload = {
    uid: userId,
    iat: issuedAt,
    exp: expiresAt
  };
  return {
    payload,
    token: signToken(payload),
    expiresAt: new Date(expiresAt * 1000).toISOString()
  };
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({
      code: "UNAUTHORIZED",
      message: "Missing bearer token"
    });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({
      code: "UNAUTHORIZED",
      message: "Invalid or expired token"
    });
  }

  req.auth = {
    userId: payload.uid,
    expiresAt: new Date(payload.exp * 1000).toISOString()
  };
  return next();
}

function createMemoryStorage(kind = "memory") {
  const sessions = new Map();
  const identitiesByUserId = new Map();
  const userIdByPublicIdentityId = new Map();

  function issueRecoveryKey(userId, publicIdentityId) {
    const existing = identitiesByUserId.get(userId);
    const now = new Date().toISOString();
    const { recoveryKey, recoverySalt, recoveryHash } = buildRecoveryCredentials();

    let resolvedPublicIdentityId = publicIdentityId || existing?.publicIdentityId;
    if (!resolvedPublicIdentityId) {
      do {
        resolvedPublicIdentityId = makeId("pid");
      } while (userIdByPublicIdentityId.has(resolvedPublicIdentityId));
    }

    if (existing?.publicIdentityId && existing.publicIdentityId !== resolvedPublicIdentityId) {
      userIdByPublicIdentityId.delete(existing.publicIdentityId);
    }

    identitiesByUserId.set(userId, {
      userId,
      publicIdentityId: resolvedPublicIdentityId,
      recoverySalt,
      recoveryHash,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    });
    userIdByPublicIdentityId.set(resolvedPublicIdentityId, userId);

    return {
      userId,
      publicIdentityId: resolvedPublicIdentityId,
      recoveryKey
    };
  }

  return {
    kind,
    async init() {},
    async ping() {
      return { ok: true };
    },
    async createIdentity(userId) {
      return issueRecoveryKey(userId);
    },
    async getIdentityByUserId(userId) {
      const identity = identitiesByUserId.get(userId);
      if (!identity) {
        return null;
      }
      return {
        userId: identity.userId,
        publicIdentityId: identity.publicIdentityId
      };
    },
    async recoverIdentity(publicIdentityId, recoveryKey) {
      const userId = userIdByPublicIdentityId.get(publicIdentityId);
      if (!userId) {
        return null;
      }

      const identity = identitiesByUserId.get(userId);
      if (!identity) {
        return null;
      }

      if (
        !verifyRecoveryKey(recoveryKey, identity.recoverySalt, identity.recoveryHash)
      ) {
        return null;
      }

      return {
        userId: identity.userId,
        publicIdentityId: identity.publicIdentityId
      };
    },
    async rotateRecoveryKey(userId) {
      return issueRecoveryKey(userId);
    },
    async saveBaseline(ownerUserId, sessionId, baseline) {
      const existing = sessions.get(sessionId);
      if (existing && existing.ownerUserId !== ownerUserId) {
        throw ownershipError();
      }

      const now = new Date().toISOString();
      sessions.set(sessionId, {
        sessionId,
        ownerUserId,
        baseline,
        scenarioResults: existing?.scenarioResults || [],
        comparison: existing?.comparison || null,
        createdAt: existing?.createdAt || now,
        updatedAt: now
      });
    },
    async saveScenarioResults(ownerUserId, sessionId, baseline, scenarioResults) {
      const existing = sessions.get(sessionId);
      if (existing && existing.ownerUserId !== ownerUserId) {
        throw ownershipError();
      }

      const now = new Date().toISOString();
      sessions.set(sessionId, {
        sessionId,
        ownerUserId,
        baseline: baseline || existing?.baseline || null,
        scenarioResults: Array.isArray(scenarioResults) ? scenarioResults : [],
        comparison: existing?.comparison || null,
        createdAt: existing?.createdAt || now,
        updatedAt: now
      });
    },
    async saveComparison(ownerUserId, sessionId, baseline, scenarioResults, comparison) {
      const existing = sessions.get(sessionId);
      if (existing && existing.ownerUserId !== ownerUserId) {
        throw ownershipError();
      }

      const now = new Date().toISOString();
      sessions.set(sessionId, {
        sessionId,
        ownerUserId,
        baseline: baseline || existing?.baseline || null,
        scenarioResults:
          (Array.isArray(scenarioResults) && scenarioResults) ||
          existing?.scenarioResults ||
          [],
        comparison: comparison || null,
        createdAt: existing?.createdAt || now,
        updatedAt: now
      });
    },
    async getSession(ownerUserId, sessionId) {
      const session = sessions.get(sessionId);
      if (!session) {
        return null;
      }
      if (session.ownerUserId !== ownerUserId) {
        return null;
      }
      return session;
    },
    async listSessions(ownerUserId, limit = 20) {
      return Array.from(sessions.values())
        .filter((session) => session.ownerUserId === ownerUserId)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, limit);
    }
  };
}

function createPostgresStorage() {
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseSsl ? { rejectUnauthorized: false } : undefined
  });

  async function upsertIdentityAndIssueKey(userId) {
    let lastError = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const publicIdentityId = makeId("pid");
      const { recoveryKey, recoverySalt, recoveryHash } = buildRecoveryCredentials();

      try {
        const result = await pool.query(
          `
          INSERT INTO twin_identities (user_id, public_identity_id, recovery_salt, recovery_hash)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (user_id)
          DO UPDATE SET
            recovery_salt = EXCLUDED.recovery_salt,
            recovery_hash = EXCLUDED.recovery_hash,
            updated_at = NOW()
          RETURNING user_id, public_identity_id
        `,
          [userId, publicIdentityId, recoverySalt, recoveryHash]
        );

        return {
          userId: result.rows[0].user_id,
          publicIdentityId: result.rows[0].public_identity_id,
          recoveryKey
        };
      } catch (error) {
        if (error && error.code === "23505") {
          lastError = error;
          continue;
        }
        throw error;
      }
    }

    throw lastError || new Error("Unable to issue identity recovery key");
  }

  return {
    kind: "postgres",
    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS twin_sessions (
          session_id TEXT PRIMARY KEY,
          owner_user_id TEXT NOT NULL,
          baseline JSONB NOT NULL,
          scenario_results JSONB NOT NULL DEFAULT '[]'::jsonb,
          comparison JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await pool.query(`
        ALTER TABLE twin_sessions
        ADD COLUMN IF NOT EXISTS owner_user_id TEXT
      `);

      await pool.query(`
        UPDATE twin_sessions
        SET owner_user_id = 'legacy'
        WHERE owner_user_id IS NULL
      `);

      await pool.query(`
        ALTER TABLE twin_sessions
        ALTER COLUMN owner_user_id SET NOT NULL
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_twin_sessions_owner_updated
        ON twin_sessions(owner_user_id, updated_at DESC)
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS twin_identities (
          user_id TEXT PRIMARY KEY,
          public_identity_id TEXT UNIQUE NOT NULL,
          recovery_salt TEXT NOT NULL,
          recovery_hash TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_twin_identities_public_id
        ON twin_identities(public_identity_id)
      `);
    },
    async ping() {
      await pool.query("SELECT 1");
      return { ok: true };
    },
    async createIdentity(userId) {
      return upsertIdentityAndIssueKey(userId);
    },
    async getIdentityByUserId(userId) {
      const result = await pool.query(
        `
        SELECT user_id, public_identity_id
        FROM twin_identities
        WHERE user_id = $1
      `,
        [userId]
      );

      if (result.rowCount === 0) {
        return null;
      }

      return {
        userId: result.rows[0].user_id,
        publicIdentityId: result.rows[0].public_identity_id
      };
    },
    async recoverIdentity(publicIdentityId, recoveryKey) {
      const result = await pool.query(
        `
        SELECT user_id, public_identity_id, recovery_salt, recovery_hash
        FROM twin_identities
        WHERE public_identity_id = $1
      `,
        [publicIdentityId]
      );

      if (result.rowCount === 0) {
        return null;
      }

      const row = result.rows[0];
      if (!verifyRecoveryKey(recoveryKey, row.recovery_salt, row.recovery_hash)) {
        return null;
      }

      return {
        userId: row.user_id,
        publicIdentityId: row.public_identity_id
      };
    },
    async rotateRecoveryKey(userId) {
      return upsertIdentityAndIssueKey(userId);
    },
    async saveBaseline(ownerUserId, sessionId, baseline) {
      const result = await pool.query(
        `
        INSERT INTO twin_sessions (session_id, owner_user_id, baseline)
        VALUES ($1, $2, $3::jsonb)
        ON CONFLICT (session_id)
        DO UPDATE SET
          baseline = EXCLUDED.baseline,
          updated_at = NOW()
        WHERE twin_sessions.owner_user_id = EXCLUDED.owner_user_id
        RETURNING session_id
      `,
        [sessionId, ownerUserId, JSON.stringify(baseline)]
      );

      if (result.rowCount === 0) {
        throw ownershipError();
      }
    },
    async saveScenarioResults(ownerUserId, sessionId, baseline, scenarioResults) {
      const result = await pool.query(
        `
        INSERT INTO twin_sessions (session_id, owner_user_id, baseline, scenario_results)
        VALUES ($1, $2, $3::jsonb, $4::jsonb)
        ON CONFLICT (session_id)
        DO UPDATE SET
          baseline = EXCLUDED.baseline,
          scenario_results = EXCLUDED.scenario_results,
          updated_at = NOW()
        WHERE twin_sessions.owner_user_id = EXCLUDED.owner_user_id
        RETURNING session_id
      `,
        [sessionId, ownerUserId, JSON.stringify(baseline || {}), JSON.stringify(scenarioResults || [])]
      );

      if (result.rowCount === 0) {
        throw ownershipError();
      }
    },
    async saveComparison(ownerUserId, sessionId, baseline, scenarioResults, comparison) {
      const result = await pool.query(
        `
        INSERT INTO twin_sessions (session_id, owner_user_id, baseline, scenario_results, comparison)
        VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb)
        ON CONFLICT (session_id)
        DO UPDATE SET
          baseline = EXCLUDED.baseline,
          scenario_results = EXCLUDED.scenario_results,
          comparison = EXCLUDED.comparison,
          updated_at = NOW()
        WHERE twin_sessions.owner_user_id = EXCLUDED.owner_user_id
        RETURNING session_id
      `,
        [
          sessionId,
          ownerUserId,
          JSON.stringify(baseline || {}),
          JSON.stringify(scenarioResults || []),
          JSON.stringify(comparison || null)
        ]
      );

      if (result.rowCount === 0) {
        throw ownershipError();
      }
    },
    async getSession(ownerUserId, sessionId) {
      const result = await pool.query(
        `
        SELECT session_id, owner_user_id, baseline, scenario_results, comparison, created_at, updated_at
        FROM twin_sessions
        WHERE session_id = $1 AND owner_user_id = $2
      `,
        [sessionId, ownerUserId]
      );

      if (result.rowCount === 0) {
        return null;
      }

      return normalizeSession(result.rows[0]);
    },
    async listSessions(ownerUserId, limit = 20) {
      const result = await pool.query(
        `
        SELECT session_id, owner_user_id, baseline, scenario_results, comparison, created_at, updated_at
        FROM twin_sessions
        WHERE owner_user_id = $1
        ORDER BY updated_at DESC
        LIMIT $2
      `,
        [ownerUserId, limit]
      );

      return result.rows.map((row) => normalizeSession(row));
    }
  };
}

async function buildStorage() {
  if (!databaseUrl) {
    return createMemoryStorage("memory_no_database_url");
  }

  const candidate = createPostgresStorage();
  try {
    await candidate.init();
    return candidate;
  } catch (error) {
    console.error("Postgres init failed, falling back to memory storage.", error);
    return createMemoryStorage("memory_postgres_init_failed");
  }
}

const storage = await buildStorage();
const recoveryAttemptState = new Map();

function getRequesterIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || "unknown";
}

function getRecoveryAttemptKey(req, publicIdentityId) {
  return `${getRequesterIp(req)}::${publicIdentityId}`;
}

function isRecoveryRateLimited(attemptKey) {
  const record = recoveryAttemptState.get(attemptKey);
  if (!record) {
    return false;
  }

  if (record.resetAt <= Date.now()) {
    recoveryAttemptState.delete(attemptKey);
    return false;
  }

  return record.count >= recoveryThrottleMaxAttempts;
}

function registerRecoveryFailure(attemptKey) {
  const now = Date.now();
  const existing = recoveryAttemptState.get(attemptKey);

  if (!existing || existing.resetAt <= now) {
    recoveryAttemptState.set(attemptKey, {
      count: 1,
      resetAt: now + recoveryThrottleWindowMs
    });
    return;
  }

  recoveryAttemptState.set(attemptKey, {
    count: existing.count + 1,
    resetAt: existing.resetAt
  });
}

function clearRecoveryFailures(attemptKey) {
  recoveryAttemptState.delete(attemptKey);
}

app.get("/health", async (_req, res) => {
  let storageOk = true;
  try {
    await storage.ping();
  } catch (_error) {
    storageOk = false;
  }

  res.json({
    ok: storageOk,
    storage: storage.kind
  });
});

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "digital-twin-api",
    version: "0.4.0",
    storage: storage.kind
  });
});

app.post("/v1/auth/guest", async (_req, res) => {
  try {
    const userId = makeId("user");
    const identity = await storage.createIdentity(userId);
    const auth = createAuthPayload(userId);

    return res.json({
      token: auth.token,
      expiresAt: auth.expiresAt,
      user: {
        userId,
        publicIdentityId: identity.publicIdentityId,
        type: "guest"
      },
      recoveryKey: identity.recoveryKey,
      recoveryHint: "Store this recovery key offline. It is shown once."
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Failed to create guest identity"
    });
  }
});

app.post("/v1/auth/recover", async (req, res) => {
  const publicIdentityId =
    typeof req.body?.publicIdentityId === "string"
      ? req.body.publicIdentityId.trim()
      : "";
  const recoveryKey =
    typeof req.body?.recoveryKey === "string" ? req.body.recoveryKey.trim() : "";

  if (!publicIdentityId || !recoveryKey) {
    return res.status(400).json({
      code: "VALIDATION_ERROR",
      message: "publicIdentityId and recoveryKey are required"
    });
  }

  const attemptKey = getRecoveryAttemptKey(req, publicIdentityId);
  if (isRecoveryRateLimited(attemptKey)) {
    return res.status(429).json({
      code: "TOO_MANY_ATTEMPTS",
      message: "Too many recovery attempts. Try again later."
    });
  }

  try {
    const identity = await storage.recoverIdentity(publicIdentityId, recoveryKey);
    if (!identity) {
      registerRecoveryFailure(attemptKey);
      return res.status(401).json({
        code: "INVALID_RECOVERY",
        message: "Invalid identity or recovery key"
      });
    }

    clearRecoveryFailures(attemptKey);
    const auth = createAuthPayload(identity.userId);

    return res.json({
      token: auth.token,
      expiresAt: auth.expiresAt,
      user: {
        userId: identity.userId,
        publicIdentityId: identity.publicIdentityId,
        type: "guest"
      }
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Failed to recover identity"
    });
  }
});

app.post("/v1/auth/recovery-key/rotate", requireAuth, async (req, res) => {
  try {
    const rotated = await storage.rotateRecoveryKey(req.auth.userId);
    return res.json({
      publicIdentityId: rotated.publicIdentityId,
      recoveryKey: rotated.recoveryKey,
      recoveryHint: "Store this new recovery key offline. It replaces the previous key."
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Failed to rotate recovery key"
    });
  }
});

app.get("/v1/auth/me", requireAuth, async (req, res) => {
  try {
    const identity = await storage.getIdentityByUserId(req.auth.userId);
    return res.json({
      user: {
        userId: req.auth.userId,
        publicIdentityId: identity?.publicIdentityId || null,
        type: "guest"
      },
      recoveryConfigured: Boolean(identity?.publicIdentityId),
      expiresAt: req.auth.expiresAt
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Failed to read auth profile"
    });
  }
});

app.get("/v1/disclaimer", (_req, res) => {
  res.json({ text: DISCLAIMER });
});

app.post("/v1/baseline", requireAuth, async (req, res) => {
  try {
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
    const sessionId = makeId("sess");
    const ownerUserId = req.auth.userId;

    const baselinePayload = {
      sessionId,
      ownerUserId,
      baselineId: makeId("base"),
      input,
      relativeScore,
      factorScores,
      trendLabel: "stable",
      generatedAt: new Date().toISOString(),
      disclaimer: DISCLAIMER
    };

    await storage.saveBaseline(ownerUserId, sessionId, baselinePayload);
    return res.json(baselinePayload);
  } catch (error) {
    console.error(error);
    if (error.code === "OWNERSHIP_MISMATCH") {
      return res.status(403).json({
        code: "FORBIDDEN",
        message: "Session ownership mismatch"
      });
    }
    return res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Failed to generate baseline"
    });
  }
});

app.post("/v1/scenarios/run", requireAuth, async (req, res) => {
  try {
    const { baseline, scenarios } = req.body || {};
    if (
      !baseline ||
      typeof baseline !== "object" ||
      !baseline.input ||
      !baseline.sessionId ||
      !Array.isArray(scenarios)
    ) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "Request must include baseline (with sessionId) and scenarios[]"
      });
    }

    const ownerUserId = req.auth.userId;
    if (baseline.ownerUserId && baseline.ownerUserId !== ownerUserId) {
      return res.status(403).json({
        code: "FORBIDDEN",
        message: "Baseline does not belong to this user"
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

    await storage.saveScenarioResults(ownerUserId, baseline.sessionId, baseline, results);
    return res.json(results);
  } catch (error) {
    console.error(error);
    if (error.code === "OWNERSHIP_MISMATCH") {
      return res.status(403).json({
        code: "FORBIDDEN",
        message: "Session ownership mismatch"
      });
    }
    return res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Failed to run scenarios"
    });
  }
});

app.post("/v1/scenarios/compare", requireAuth, async (req, res) => {
  try {
    const { baseline, scenarioResults } = req.body || {};
    if (
      !baseline ||
      typeof baseline !== "object" ||
      !baseline.sessionId ||
      !Array.isArray(scenarioResults)
    ) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "Request must include baseline (with sessionId) and scenarioResults[]"
      });
    }

    const ownerUserId = req.auth.userId;
    if (baseline.ownerUserId && baseline.ownerUserId !== ownerUserId) {
      return res.status(403).json({
        code: "FORBIDDEN",
        message: "Baseline does not belong to this user"
      });
    }

    const normalized = scenarioResults
      .filter((item) => item && typeof item.relativeScore === "number")
      .map((item) => {
        const cue =
          item.trendDirection === "improving"
            ? "up"
            : item.trendDirection === "declining"
              ? "down"
              : "flat";
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

    const comparePayload = {
      baselineScore: baseline.relativeScore,
      scenarios: normalized,
      disclaimer: DISCLAIMER
    };

    await storage.saveComparison(
      ownerUserId,
      baseline.sessionId,
      baseline,
      scenarioResults,
      comparePayload
    );

    return res.json(comparePayload);
  } catch (error) {
    console.error(error);
    if (error.code === "OWNERSHIP_MISMATCH") {
      return res.status(403).json({
        code: "FORBIDDEN",
        message: "Session ownership mismatch"
      });
    }
    return res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Failed to compare scenarios"
    });
  }
});

app.get("/v1/sessions", requireAuth, async (req, res) => {
  try {
    const parsedLimit = Number(req.query.limit || 20);
    const limit = Number.isFinite(parsedLimit) ? clamp(parsedLimit, 1, 100) : 20;
    const sessions = await storage.listSessions(req.auth.userId, limit);

    const items = sessions.map((session) => ({
      sessionId: session.sessionId,
      baselineScore: session.baseline?.relativeScore ?? null,
      scenarioCount: Array.isArray(session.scenarioResults)
        ? session.scenarioResults.filter(
            (item) => item && typeof item.relativeScore === "number"
          ).length
        : 0,
      hasComparison: Boolean(session.comparison),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt
    }));

    return res.json({ items });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Failed to list sessions"
    });
  }
});

app.get("/v1/sessions/:sessionId", requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await storage.getSession(req.auth.userId, sessionId);
    if (!session) {
      return res.status(404).json({
        code: "NOT_FOUND",
        message: "Session not found"
      });
    }

    return res.json({
      ...session,
      disclaimer: DISCLAIMER
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Failed to load session"
    });
  }
});

app.listen(port, () => {
  console.log(`API running on port ${port} (storage=${storage.kind})`);
});
