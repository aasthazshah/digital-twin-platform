import base64
import hashlib
import hmac
import json
import os
import secrets
import string
import time
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

try:
    import psycopg
    from psycopg.rows import dict_row
except Exception:
    psycopg = None
    dict_row = None


def clamp(value, minimum, maximum):
    return min(max(value, minimum), maximum)


PORT = int(os.getenv("PORT", "4000"))
CORS_ORIGIN = os.getenv("CORS_ORIGIN", "*")
DATABASE_URL = os.getenv("DATABASE_URL", "")
DATABASE_SSL = os.getenv("DATABASE_SSL", "").lower() == "true"
AUTH_SECRET = os.getenv("AUTH_SECRET", "dev-change-this-auth-secret")
AUTH_TOKEN_TTL_SECONDS = int(os.getenv("AUTH_TOKEN_TTL_SECONDS", str(60 * 60 * 24 * 30)))
RECOVERY_THROTTLE_WINDOW_MS = int(
    clamp(float(os.getenv("RECOVERY_THROTTLE_WINDOW_MS", str(10 * 60 * 1000))), 1000, 24 * 60 * 60 * 1000)
)
RECOVERY_THROTTLE_MAX_ATTEMPTS = int(
    clamp(float(os.getenv("RECOVERY_THROTTLE_MAX_ATTEMPTS", "8")), 1, 100)
)

DISCLAIMER = "Educational simulation only. This app does not provide medical diagnosis, treatment, or prescriptions."

TO_FACTOR = {
    "bodyCategory": {"underweight": 0.45, "healthy": 0.8, "overweight": 0.55, "obese": 0.35},
    "activityLevel": {"sedentary": 0.3, "light": 0.5, "moderate": 0.75, "high": 0.9},
    "dietCategory": {"poor": 0.3, "average": 0.55, "balanced": 0.85},
    "healthConditionCategory": {"poor": 0.3, "fair": 0.55, "good": 0.8},
    "ageRange": {"13-17": 0.75, "18-25": 0.8, "26-35": 0.78, "36-45": 0.72, "46-55": 0.65, "56-65": 0.58, "66+": 0.5},
    "medicationAdherence": {"adherent": 0.8, "partial": 0.5, "non_adherent": 0.25},
    "stressLevel": {"low": 0.8, "moderate": 0.6, "high": 0.4, "acute": 0.2},
}

BASE_WEIGHTS = {
    "sleepHours": 0.25,
    "activityLevel": 0.25,
    "dietCategory": 0.2,
    "bodyCategory": 0.1,
    "healthConditionCategory": 0.1,
    "ageRange": 0.05,
    "medicationAdherence": 0.03,
    "stressLevel": 0.02,
}


def now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def make_id(prefix):
    alphabet = string.ascii_lowercase + string.digits
    suffix = "".join(secrets.choice(alphabet) for _ in range(6))
    return f"{prefix}_{int(time.time() * 1000)}_{suffix}"


def base64_url_encode(value):
    return base64.urlsafe_b64encode(value).decode("utf-8").rstrip("=")


def base64_url_decode(value):
    padding = "=" * ((4 - len(value) % 4) % 4)
    return base64.urlsafe_b64decode(value + padding)


def generate_recovery_key():
    return base64_url_encode(secrets.token_bytes(24))


def hash_recovery_key(recovery_key, recovery_salt):
    digest = hashlib.scrypt(
        recovery_key.encode("utf-8"),
        salt=recovery_salt.encode("utf-8"),
        n=16384,
        r=8,
        p=1,
        dklen=32,
    )
    return base64_url_encode(digest)


def build_recovery_credentials():
    recovery_key = generate_recovery_key()
    recovery_salt = base64_url_encode(secrets.token_bytes(16))
    recovery_hash = hash_recovery_key(recovery_key, recovery_salt)
    return {"recoveryKey": recovery_key, "recoverySalt": recovery_salt, "recoveryHash": recovery_hash}


def verify_recovery_key(recovery_key, recovery_salt, expected_hash):
    if not recovery_key or not recovery_salt or not expected_hash:
        return False
    actual = hash_recovery_key(recovery_key, recovery_salt)
    return hmac.compare_digest(actual, expected_hash)


def validate_input(input_value):
    if not isinstance(input_value, dict):
        return {"valid": False, "errors": [{"field": "input", "message": "Input must be a JSON object"}]}
    required = ["ageRange", "bodyCategory", "sleepHours", "activityLevel", "dietCategory", "healthConditionCategory"]
    errors = []
    for field in required:
        val = input_value.get(field)
        if val is None or val == "":
            errors.append({"field": field, "message": "Field is required"})
    sleep_hours = input_value.get("sleepHours")
    if not isinstance(sleep_hours, (int, float)) or sleep_hours < 0 or sleep_hours > 24:
        errors.append({"field": "sleepHours", "message": "sleepHours must be between 0 and 24"})
    return {"valid": len(errors) == 0, "errors": errors}


def sleep_factor(sleep_hours):
    return clamp(1 - abs(8 - sleep_hours) / 8, 0, 1)


def compute_score(input_value):
    factors = {
        "sleepHours": sleep_factor(float(input_value["sleepHours"])),
        "bodyCategory": TO_FACTOR["bodyCategory"].get(input_value.get("bodyCategory"), 0.4),
        "activityLevel": TO_FACTOR["activityLevel"].get(input_value.get("activityLevel"), 0.4),
        "dietCategory": TO_FACTOR["dietCategory"].get(input_value.get("dietCategory"), 0.4),
        "healthConditionCategory": TO_FACTOR["healthConditionCategory"].get(input_value.get("healthConditionCategory"), 0.4),
        "ageRange": TO_FACTOR["ageRange"].get(input_value.get("ageRange"), 0.5),
    }
    if input_value.get("medicationAdherence"):
        factors["medicationAdherence"] = TO_FACTOR["medicationAdherence"].get(input_value.get("medicationAdherence"), 0.4)
    if input_value.get("stressLevel"):
        factors["stressLevel"] = TO_FACTOR["stressLevel"].get(input_value.get("stressLevel"), 0.4)
    keys = list(factors.keys())
    weight_total = sum(BASE_WEIGHTS.get(k, 0) for k in keys)
    weighted = sum(factors[k] * (BASE_WEIGHTS.get(k, 0) / weight_total) for k in keys)
    return {"relativeScore": round(weighted * 100, 2), "factorScores": factors}


def trend_from_delta(delta):
    if delta >= 3:
        return "improving"
    if delta <= -3:
        return "declining"
    return "stable"


def sign_token(payload):
    payload_encoded = base64_url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = base64_url_encode(hmac.new(AUTH_SECRET.encode("utf-8"), payload_encoded.encode("utf-8"), hashlib.sha256).digest())
    return f"{payload_encoded}.{signature}"


def verify_token(token):
    if not token or "." not in token:
        return None
    payload_encoded, signature = token.split(".", 1)
    expected = base64_url_encode(hmac.new(AUTH_SECRET.encode("utf-8"), payload_encoded.encode("utf-8"), hashlib.sha256).digest())
    if not hmac.compare_digest(signature, expected):
        return None
    try:
        payload = json.loads(base64_url_decode(payload_encoded).decode("utf-8"))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    if not isinstance(payload.get("uid"), str) or not payload.get("uid"):
        return None
    if not isinstance(payload.get("exp"), int) or time.time() >= payload["exp"]:
        return None
    return payload


def create_auth_payload(user_id):
    issued_at = int(time.time())
    expires_at = issued_at + AUTH_TOKEN_TTL_SECONDS
    payload = {"uid": user_id, "iat": issued_at, "exp": expires_at}
    return {
        "payload": payload,
        "token": sign_token(payload),
        "expiresAt": datetime.fromtimestamp(expires_at, tz=timezone.utc).isoformat().replace("+00:00", "Z"),
    }


class OwnershipMismatch(Exception):
    pass


def normalize_session(record):
    created = record.get("createdAt") or record.get("created_at")
    updated = record.get("updatedAt") or record.get("updated_at")
    if hasattr(created, "isoformat"):
        created = created.isoformat().replace("+00:00", "Z")
    if hasattr(updated, "isoformat"):
        updated = updated.isoformat().replace("+00:00", "Z")
    return {
        "sessionId": record.get("sessionId") or record.get("session_id"),
        "ownerUserId": record.get("ownerUserId") or record.get("owner_user_id"),
        "baseline": record.get("baseline"),
        "scenarioResults": record.get("scenarioResults") or record.get("scenario_results") or [],
        "comparison": record.get("comparison"),
        "createdAt": created or now_iso(),
        "updatedAt": updated or now_iso(),
    }


class MemoryStorage:
    def __init__(self, kind):
        self.kind = kind
        self.sessions = {}
        self.identities_by_user_id = {}
        self.user_id_by_public_identity_id = {}

    def init(self):
        return

    def ping(self):
        return {"ok": True}

    def _issue_recovery_key(self, user_id, public_identity_id=None):
        existing = self.identities_by_user_id.get(user_id)
        creds = build_recovery_credentials()
        resolved = public_identity_id or (existing.get("publicIdentityId") if existing else None)
        while not resolved or (resolved in self.user_id_by_public_identity_id and self.user_id_by_public_identity_id[resolved] != user_id):
            resolved = make_id("pid")
        if existing and existing.get("publicIdentityId") and existing["publicIdentityId"] != resolved:
            self.user_id_by_public_identity_id.pop(existing["publicIdentityId"], None)
        now = now_iso()
        self.identities_by_user_id[user_id] = {
            "userId": user_id,
            "publicIdentityId": resolved,
            "recoverySalt": creds["recoverySalt"],
            "recoveryHash": creds["recoveryHash"],
            "createdAt": existing.get("createdAt") if existing else now,
            "updatedAt": now,
        }
        self.user_id_by_public_identity_id[resolved] = user_id
        return {"userId": user_id, "publicIdentityId": resolved, "recoveryKey": creds["recoveryKey"]}

    def create_identity(self, user_id):
        return self._issue_recovery_key(user_id)

    def get_identity_by_user_id(self, user_id):
        identity = self.identities_by_user_id.get(user_id)
        if not identity:
            return None
        return {"userId": identity["userId"], "publicIdentityId": identity["publicIdentityId"]}

    def recover_identity(self, public_identity_id, recovery_key):
        user_id = self.user_id_by_public_identity_id.get(public_identity_id)
        if not user_id:
            return None
        identity = self.identities_by_user_id.get(user_id)
        if not identity:
            return None
        if not verify_recovery_key(recovery_key, identity["recoverySalt"], identity["recoveryHash"]):
            return None
        return {"userId": identity["userId"], "publicIdentityId": identity["publicIdentityId"]}

    def rotate_recovery_key(self, user_id):
        return self._issue_recovery_key(user_id)

    def save_baseline(self, owner_user_id, session_id, baseline):
        existing = self.sessions.get(session_id)
        if existing and existing["ownerUserId"] != owner_user_id:
            raise OwnershipMismatch()
        now = now_iso()
        self.sessions[session_id] = {
            "sessionId": session_id,
            "ownerUserId": owner_user_id,
            "baseline": baseline,
            "scenarioResults": existing.get("scenarioResults", []) if existing else [],
            "comparison": existing.get("comparison") if existing else None,
            "createdAt": existing.get("createdAt") if existing else now,
            "updatedAt": now,
        }

    def save_scenario_results(self, owner_user_id, session_id, baseline, scenario_results):
        existing = self.sessions.get(session_id)
        if existing and existing["ownerUserId"] != owner_user_id:
            raise OwnershipMismatch()
        now = now_iso()
        self.sessions[session_id] = {
            "sessionId": session_id,
            "ownerUserId": owner_user_id,
            "baseline": baseline or (existing.get("baseline") if existing else None),
            "scenarioResults": scenario_results or [],
            "comparison": existing.get("comparison") if existing else None,
            "createdAt": existing.get("createdAt") if existing else now,
            "updatedAt": now,
        }

    def save_comparison(self, owner_user_id, session_id, baseline, scenario_results, comparison):
        existing = self.sessions.get(session_id)
        if existing and existing["ownerUserId"] != owner_user_id:
            raise OwnershipMismatch()
        now = now_iso()
        self.sessions[session_id] = {
            "sessionId": session_id,
            "ownerUserId": owner_user_id,
            "baseline": baseline or (existing.get("baseline") if existing else None),
            "scenarioResults": scenario_results or (existing.get("scenarioResults") if existing else []),
            "comparison": comparison,
            "createdAt": existing.get("createdAt") if existing else now,
            "updatedAt": now,
        }

    def get_session(self, owner_user_id, session_id):
        session = self.sessions.get(session_id)
        if not session or session["ownerUserId"] != owner_user_id:
            return None
        return session

    def list_sessions(self, owner_user_id, limit=20):
        rows = [s for s in self.sessions.values() if s["ownerUserId"] == owner_user_id]
        rows.sort(key=lambda s: s.get("updatedAt", ""), reverse=True)
        return rows[:limit]


class PostgresStorage:
    def __init__(self, database_url, database_ssl):
        self.kind = "postgres"
        self.database_url = database_url
        self.conn_kwargs = {"autocommit": True}
        if database_ssl:
            self.conn_kwargs["sslmode"] = "require"

    def _connect(self):
        if psycopg is None:
            raise RuntimeError("psycopg is not installed")
        return psycopg.connect(self.database_url, **self.conn_kwargs)

    def init(self):
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("CREATE TABLE IF NOT EXISTS twin_sessions (session_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, baseline JSONB NOT NULL, scenario_results JSONB NOT NULL DEFAULT '[]'::jsonb, comparison JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())")
                cur.execute("ALTER TABLE twin_sessions ADD COLUMN IF NOT EXISTS owner_user_id TEXT")
                cur.execute("UPDATE twin_sessions SET owner_user_id = 'legacy' WHERE owner_user_id IS NULL")
                cur.execute("ALTER TABLE twin_sessions ALTER COLUMN owner_user_id SET NOT NULL")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_twin_sessions_owner_updated ON twin_sessions(owner_user_id, updated_at DESC)")
                cur.execute("CREATE TABLE IF NOT EXISTS twin_identities (user_id TEXT PRIMARY KEY, public_identity_id TEXT UNIQUE NOT NULL, recovery_salt TEXT NOT NULL, recovery_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())")
                cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_twin_identities_public_id ON twin_identities(public_identity_id)")

    def ping(self):
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
        return {"ok": True}

    def _upsert_identity_and_issue_key(self, user_id):
        last_error = None
        for _ in range(6):
            public_identity_id = make_id("pid")
            creds = build_recovery_credentials()
            try:
                with self._connect() as conn:
                    with conn.cursor(row_factory=dict_row) as cur:
                        cur.execute(
                            "INSERT INTO twin_identities (user_id, public_identity_id, recovery_salt, recovery_hash) VALUES (%s, %s, %s, %s) ON CONFLICT (user_id) DO UPDATE SET recovery_salt = EXCLUDED.recovery_salt, recovery_hash = EXCLUDED.recovery_hash, updated_at = NOW() RETURNING user_id, public_identity_id",
                            (user_id, public_identity_id, creds["recoverySalt"], creds["recoveryHash"]),
                        )
                        row = cur.fetchone()
                        return {"userId": row["user_id"], "publicIdentityId": row["public_identity_id"], "recoveryKey": creds["recoveryKey"]}
            except Exception as error:
                if getattr(error, "sqlstate", None) == "23505":
                    last_error = error
                    continue
                raise
        if last_error:
            raise last_error
        raise RuntimeError("Unable to issue identity recovery key")

    def create_identity(self, user_id):
        return self._upsert_identity_and_issue_key(user_id)

    def get_identity_by_user_id(self, user_id):
        with self._connect() as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute("SELECT user_id, public_identity_id FROM twin_identities WHERE user_id = %s", (user_id,))
                row = cur.fetchone()
                return {"userId": row["user_id"], "publicIdentityId": row["public_identity_id"]} if row else None

    def recover_identity(self, public_identity_id, recovery_key):
        with self._connect() as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute("SELECT user_id, public_identity_id, recovery_salt, recovery_hash FROM twin_identities WHERE public_identity_id = %s", (public_identity_id,))
                row = cur.fetchone()
                if not row:
                    return None
                if not verify_recovery_key(recovery_key, row["recovery_salt"], row["recovery_hash"]):
                    return None
                return {"userId": row["user_id"], "publicIdentityId": row["public_identity_id"]}

    def rotate_recovery_key(self, user_id):
        return self._upsert_identity_and_issue_key(user_id)

    def save_baseline(self, owner_user_id, session_id, baseline):
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("INSERT INTO twin_sessions (session_id, owner_user_id, baseline) VALUES (%s, %s, %s::jsonb) ON CONFLICT (session_id) DO UPDATE SET baseline = EXCLUDED.baseline, updated_at = NOW() WHERE twin_sessions.owner_user_id = EXCLUDED.owner_user_id RETURNING session_id", (session_id, owner_user_id, json.dumps(baseline)))
                if not cur.fetchone():
                    raise OwnershipMismatch()

    def save_scenario_results(self, owner_user_id, session_id, baseline, scenario_results):
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("INSERT INTO twin_sessions (session_id, owner_user_id, baseline, scenario_results) VALUES (%s, %s, %s::jsonb, %s::jsonb) ON CONFLICT (session_id) DO UPDATE SET baseline = EXCLUDED.baseline, scenario_results = EXCLUDED.scenario_results, updated_at = NOW() WHERE twin_sessions.owner_user_id = EXCLUDED.owner_user_id RETURNING session_id", (session_id, owner_user_id, json.dumps(baseline or {}), json.dumps(scenario_results or [])))
                if not cur.fetchone():
                    raise OwnershipMismatch()

    def save_comparison(self, owner_user_id, session_id, baseline, scenario_results, comparison):
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("INSERT INTO twin_sessions (session_id, owner_user_id, baseline, scenario_results, comparison) VALUES (%s, %s, %s::jsonb, %s::jsonb, %s::jsonb) ON CONFLICT (session_id) DO UPDATE SET baseline = EXCLUDED.baseline, scenario_results = EXCLUDED.scenario_results, comparison = EXCLUDED.comparison, updated_at = NOW() WHERE twin_sessions.owner_user_id = EXCLUDED.owner_user_id RETURNING session_id", (session_id, owner_user_id, json.dumps(baseline or {}), json.dumps(scenario_results or []), json.dumps(comparison)))
                if not cur.fetchone():
                    raise OwnershipMismatch()

    def get_session(self, owner_user_id, session_id):
        with self._connect() as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute("SELECT session_id, owner_user_id, baseline, scenario_results, comparison, created_at, updated_at FROM twin_sessions WHERE session_id = %s AND owner_user_id = %s", (session_id, owner_user_id))
                row = cur.fetchone()
                return normalize_session(row) if row else None

    def list_sessions(self, owner_user_id, limit=20):
        with self._connect() as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute("SELECT session_id, owner_user_id, baseline, scenario_results, comparison, created_at, updated_at FROM twin_sessions WHERE owner_user_id = %s ORDER BY updated_at DESC LIMIT %s", (owner_user_id, limit))
                return [normalize_session(row) for row in cur.fetchall()]


def build_storage():
    if not DATABASE_URL:
        return MemoryStorage("memory_no_database_url")
    if psycopg is None:
        print("psycopg unavailable, falling back to memory storage.")
        return MemoryStorage("memory_psycopg_not_installed")
    candidate = PostgresStorage(DATABASE_URL, DATABASE_SSL)
    try:
        candidate.init()
        return candidate
    except Exception as error:
        print("Postgres init failed, falling back to memory storage.", error)
        return MemoryStorage("memory_postgres_init_failed")


storage = build_storage()
recovery_attempt_state = {}


def get_requester_ip(request):
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def get_recovery_attempt_key(request, public_identity_id):
    return f"{get_requester_ip(request)}::{public_identity_id}"


def is_recovery_rate_limited(attempt_key):
    record = recovery_attempt_state.get(attempt_key)
    if not record:
        return False
    if record["resetAt"] <= time.time() * 1000:
        recovery_attempt_state.pop(attempt_key, None)
        return False
    return record["count"] >= RECOVERY_THROTTLE_MAX_ATTEMPTS


def register_recovery_failure(attempt_key):
    now_ms = time.time() * 1000
    existing = recovery_attempt_state.get(attempt_key)
    if not existing or existing["resetAt"] <= now_ms:
        recovery_attempt_state[attempt_key] = {"count": 1, "resetAt": now_ms + RECOVERY_THROTTLE_WINDOW_MS}
        return
    recovery_attempt_state[attempt_key] = {"count": existing["count"] + 1, "resetAt": existing["resetAt"]}


def clear_recovery_failures(attempt_key):
    recovery_attempt_state.pop(attempt_key, None)


def require_auth(request):
    auth_header = request.headers.get("authorization", "")
    parts = auth_header.split(" ")
    if len(parts) != 2 or parts[0] != "Bearer" or not parts[1]:
        return None, JSONResponse(status_code=401, content={"code": "UNAUTHORIZED", "message": "Missing bearer token"})
    payload = verify_token(parts[1])
    if not payload:
        return None, JSONResponse(status_code=401, content={"code": "UNAUTHORIZED", "message": "Invalid or expired token"})
    auth = {"userId": payload["uid"], "expiresAt": datetime.fromtimestamp(payload["exp"], tz=timezone.utc).isoformat().replace("+00:00", "Z")}
    return auth, None


app = FastAPI()
if CORS_ORIGIN == "*":
    allow_origins = ["*"]
else:
    allow_origins = [item.strip() for item in CORS_ORIGIN.split(",") if item.strip()]
app.add_middleware(CORSMiddleware, allow_origins=allow_origins, allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health():
    storage_ok = True
    try:
        storage.ping()
    except Exception:
        storage_ok = False
    return {"ok": storage_ok, "storage": storage.kind}


@app.get("/")
def root():
    return {"ok": True, "service": "digital-twin-api", "version": "0.5.0", "storage": storage.kind}


@app.post("/v1/auth/guest")
def auth_guest():
    try:
        user_id = make_id("user")
        identity = storage.create_identity(user_id)
        auth = create_auth_payload(user_id)
        return {"token": auth["token"], "expiresAt": auth["expiresAt"], "user": {"userId": user_id, "publicIdentityId": identity["publicIdentityId"], "type": "guest"}, "recoveryKey": identity["recoveryKey"], "recoveryHint": "Store this recovery key offline. It is shown once."}
    except Exception:
        return JSONResponse(status_code=500, content={"code": "INTERNAL_ERROR", "message": "Failed to create guest identity"})


@app.post("/v1/auth/recover")
async def auth_recover(request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    public_identity_id = str(body.get("publicIdentityId", "")).strip()
    recovery_key = str(body.get("recoveryKey", "")).strip()
    if not public_identity_id or not recovery_key:
        return JSONResponse(status_code=400, content={"code": "VALIDATION_ERROR", "message": "publicIdentityId and recoveryKey are required"})
    attempt_key = get_recovery_attempt_key(request, public_identity_id)
    if is_recovery_rate_limited(attempt_key):
        return JSONResponse(status_code=429, content={"code": "TOO_MANY_ATTEMPTS", "message": "Too many recovery attempts. Try again later."})
    try:
        identity = storage.recover_identity(public_identity_id, recovery_key)
        if not identity:
            register_recovery_failure(attempt_key)
            return JSONResponse(status_code=401, content={"code": "INVALID_RECOVERY", "message": "Invalid identity or recovery key"})
        clear_recovery_failures(attempt_key)
        auth = create_auth_payload(identity["userId"])
        return {"token": auth["token"], "expiresAt": auth["expiresAt"], "user": {"userId": identity["userId"], "publicIdentityId": identity["publicIdentityId"], "type": "guest"}}
    except Exception:
        return JSONResponse(status_code=500, content={"code": "INTERNAL_ERROR", "message": "Failed to recover identity"})


@app.post("/v1/auth/recovery-key/rotate")
def auth_rotate(request: Request):
    auth, response = require_auth(request)
    if response:
        return response
    try:
        rotated = storage.rotate_recovery_key(auth["userId"])
        return {"publicIdentityId": rotated["publicIdentityId"], "recoveryKey": rotated["recoveryKey"], "recoveryHint": "Store this new recovery key offline. It replaces the previous key."}
    except Exception:
        return JSONResponse(status_code=500, content={"code": "INTERNAL_ERROR", "message": "Failed to rotate recovery key"})


@app.get("/v1/auth/me")
def auth_me(request: Request):
    auth, response = require_auth(request)
    if response:
        return response
    try:
        identity = storage.get_identity_by_user_id(auth["userId"])
        return {"user": {"userId": auth["userId"], "publicIdentityId": identity["publicIdentityId"] if identity else None, "type": "guest"}, "recoveryConfigured": bool(identity and identity.get("publicIdentityId")), "expiresAt": auth["expiresAt"]}
    except Exception:
        return JSONResponse(status_code=500, content={"code": "INTERNAL_ERROR", "message": "Failed to read auth profile"})


@app.get("/v1/disclaimer")
def disclaimer():
    return {"text": DISCLAIMER}


@app.post("/v1/baseline")
async def baseline(request: Request):
    auth, response = require_auth(request)
    if response:
        return response
    try:
        body = await request.json()
    except Exception:
        body = {}
    input_value = body if isinstance(body, dict) else {}
    validation = validate_input(input_value)
    if not validation["valid"]:
        return JSONResponse(status_code=400, content={"code": "VALIDATION_ERROR", "message": "Invalid baseline input", "details": validation["errors"]})
    try:
        computed = compute_score(input_value)
        session_id = make_id("sess")
        owner_user_id = auth["userId"]
        payload = {"sessionId": session_id, "ownerUserId": owner_user_id, "baselineId": make_id("base"), "input": input_value, "relativeScore": computed["relativeScore"], "factorScores": computed["factorScores"], "trendLabel": "stable", "generatedAt": now_iso(), "disclaimer": DISCLAIMER}
        storage.save_baseline(owner_user_id, session_id, payload)
        return payload
    except OwnershipMismatch:
        return JSONResponse(status_code=403, content={"code": "FORBIDDEN", "message": "Session ownership mismatch"})
    except Exception:
        return JSONResponse(status_code=500, content={"code": "INTERNAL_ERROR", "message": "Failed to generate baseline"})


@app.post("/v1/scenarios/run")
async def run_scenarios(request: Request):
    auth, response = require_auth(request)
    if response:
        return response
    try:
        body = await request.json()
    except Exception:
        body = {}
    body = body if isinstance(body, dict) else {}
    baseline_value = body.get("baseline")
    scenarios = body.get("scenarios")
    if not isinstance(baseline_value, dict) or not baseline_value.get("input") or not baseline_value.get("sessionId") or not isinstance(scenarios, list):
        return JSONResponse(status_code=400, content={"code": "VALIDATION_ERROR", "message": "Request must include baseline (with sessionId) and scenarios[]"})
    owner_user_id = auth["userId"]
    if baseline_value.get("ownerUserId") and baseline_value.get("ownerUserId") != owner_user_id:
        return JSONResponse(status_code=403, content={"code": "FORBIDDEN", "message": "Baseline does not belong to this user"})
    baseline_score = float(baseline_value.get("relativeScore", 0))
    results = []
    for index, scenario in enumerate(scenarios):
        scenario_obj = scenario if isinstance(scenario, dict) else {}
        overrides = scenario_obj.get("overrides") if isinstance(scenario_obj.get("overrides"), dict) else {}
        effective_input = {**baseline_value["input"], **overrides}
        scenario_name = scenario_obj.get("scenarioName") or f"Scenario {index + 1}"
        validation = validate_input(effective_input)
        if not validation["valid"]:
            results.append({"scenarioId": f"scn_{index + 1}", "scenarioName": scenario_name, "error": validation["errors"], "disclaimer": DISCLAIMER})
            continue
        computed = compute_score(effective_input)
        delta = round(computed["relativeScore"] - baseline_score, 2)
        deviation_percent = round((abs(delta) / max(baseline_score, 1)) * 100, 2)
        results.append({"scenarioId": f"scn_{index + 1}", "scenarioName": scenario_name, "effectiveInput": effective_input, "relativeScore": computed["relativeScore"], "deltaFromBaseline": delta, "deviationPercent": deviation_percent, "trendDirection": trend_from_delta(delta), "generatedAt": now_iso(), "disclaimer": DISCLAIMER})
    try:
        storage.save_scenario_results(owner_user_id, baseline_value["sessionId"], baseline_value, results)
        return results
    except OwnershipMismatch:
        return JSONResponse(status_code=403, content={"code": "FORBIDDEN", "message": "Session ownership mismatch"})
    except Exception:
        return JSONResponse(status_code=500, content={"code": "INTERNAL_ERROR", "message": "Failed to run scenarios"})


@app.post("/v1/scenarios/compare")
async def compare_scenarios(request: Request):
    auth, response = require_auth(request)
    if response:
        return response
    try:
        body = await request.json()
    except Exception:
        body = {}
    body = body if isinstance(body, dict) else {}
    baseline_value = body.get("baseline")
    scenario_results = body.get("scenarioResults")
    if not isinstance(baseline_value, dict) or not baseline_value.get("sessionId") or not isinstance(scenario_results, list):
        return JSONResponse(status_code=400, content={"code": "VALIDATION_ERROR", "message": "Request must include baseline (with sessionId) and scenarioResults[]"})
    owner_user_id = auth["userId"]
    if baseline_value.get("ownerUserId") and baseline_value.get("ownerUserId") != owner_user_id:
        return JSONResponse(status_code=403, content={"code": "FORBIDDEN", "message": "Baseline does not belong to this user"})
    normalized = []
    for item in scenario_results:
        if not isinstance(item, dict) or not isinstance(item.get("relativeScore"), (int, float)):
            continue
        trend = item.get("trendDirection")
        cue = "up" if trend == "improving" else "down" if trend == "declining" else "flat"
        normalized.append({"scenarioId": item.get("scenarioId"), "scenarioName": item.get("scenarioName"), "score": item.get("relativeScore"), "delta": item.get("deltaFromBaseline"), "trendDirection": trend, "cue": cue, "summary": f"{item.get('scenarioName')}: {trend} ({item.get('deltaFromBaseline')} vs baseline)"})
    payload = {"baselineScore": baseline_value.get("relativeScore"), "scenarios": normalized, "disclaimer": DISCLAIMER}
    try:
        storage.save_comparison(owner_user_id, baseline_value["sessionId"], baseline_value, scenario_results, payload)
        return payload
    except OwnershipMismatch:
        return JSONResponse(status_code=403, content={"code": "FORBIDDEN", "message": "Session ownership mismatch"})
    except Exception:
        return JSONResponse(status_code=500, content={"code": "INTERNAL_ERROR", "message": "Failed to compare scenarios"})


@app.get("/v1/sessions")
def list_sessions(request: Request):
    auth, response = require_auth(request)
    if response:
        return response
    try:
        raw_limit = request.query_params.get("limit", "20")
        try:
            limit = int(clamp(float(raw_limit), 1, 100))
        except Exception:
            limit = 20
        sessions = storage.list_sessions(auth["userId"], limit)
        items = []
        for session in sessions:
            scenario_results = session.get("scenarioResults") if isinstance(session.get("scenarioResults"), list) else []
            scenario_count = len([item for item in scenario_results if isinstance(item, dict) and isinstance(item.get("relativeScore"), (int, float))])
            baseline_value = session.get("baseline")
            baseline_score = baseline_value.get("relativeScore") if isinstance(baseline_value, dict) else None
            items.append({"sessionId": session.get("sessionId"), "baselineScore": baseline_score, "scenarioCount": scenario_count, "hasComparison": bool(session.get("comparison")), "createdAt": session.get("createdAt"), "updatedAt": session.get("updatedAt")})
        return {"items": items}
    except Exception:
        return JSONResponse(status_code=500, content={"code": "INTERNAL_ERROR", "message": "Failed to list sessions"})


@app.get("/v1/sessions/{session_id}")
def get_session(session_id: str, request: Request):
    auth, response = require_auth(request)
    if response:
        return response
    try:
        session = storage.get_session(auth["userId"], session_id)
        if not session:
            return JSONResponse(status_code=404, content={"code": "NOT_FOUND", "message": "Session not found"})
        return {**session, "disclaimer": DISCLAIMER}
    except Exception:
        return JSONResponse(status_code=500, content={"code": "INTERNAL_ERROR", "message": "Failed to load session"})
