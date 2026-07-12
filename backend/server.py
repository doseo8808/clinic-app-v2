from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, Request, WebSocket, WebSocketDisconnect, Query
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import aiosqlite
import asyncio
import os
import sys
import json
import logging
import secrets
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, constr, conint
from typing import List, Optional, Set
import uuid
from datetime import datetime, timezone
from contextlib import asynccontextmanager


def get_app_dir() -> Path:
    if getattr(sys, 'frozen', False):
        return Path(sys.executable).parent
    return Path(__file__).parent


def get_bundle_dir() -> Path:
    if getattr(sys, 'frozen', False):
        return Path(sys._MEIPASS)
    return Path(__file__).parent


APP_DIR = get_app_dir()
BUNDLE_DIR = get_bundle_dir()

env_file = APP_DIR / '.env'
if not env_file.exists():
    env_file = BUNDLE_DIR / '.env'
load_dotenv(env_file)

_default_db = APP_DIR / 'data' / 'clinic.db'
_default_db.parent.mkdir(parents=True, exist_ok=True)
_env_db = os.environ.get('DATABASE_PATH', '').strip()
DATABASE_PATH = _env_db if _env_db else str(_default_db)
Path(DATABASE_PATH).parent.mkdir(parents=True, exist_ok=True)
CLINIC_PIN = os.environ.get('CLINIC_PIN', '1234')
SECRETARY_PIN = os.environ.get('SECRETARY_PIN', '1234')
DOCTOR_PIN = os.environ.get('DOCTOR_PIN', '4321')
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get('CORS_ORIGINS', '*').split(',') if o.strip()]


def get_role_for_pin(pin: str) -> Optional[str]:
    """Return 'secretary' or 'doctor' if PIN matches, else None."""
    if not pin:
        return None
    if secrets.compare_digest(pin, SECRETARY_PIN):
        return 'secretary'
    if secrets.compare_digest(pin, DOCTOR_PIN):
        return 'doctor'
    # Legacy fallback (single PIN)
    if secrets.compare_digest(pin, CLINIC_PIN):
        return 'secretary'
    return None

limiter = Limiter(key_func=get_remote_address)


# ============ Schema migration helpers ============
async def ensure_column(db, table: str, column: str, coltype: str):
    """Add a column if it doesn't exist (idempotent migration)."""
    async with db.execute(f"PRAGMA table_info({table})") as cursor:
        cols = {row[1] async for row in cursor}
    if column not in cols:
        await db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {coltype}")


async def init_db():
    async with aiosqlite.connect(DATABASE_PATH) as db:
        # Base tables
        await db.execute('''
            CREATE TABLE IF NOT EXISTS patients (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                age INTEGER NOT NULL,
                date TEXT NOT NULL,
                right_eye_va TEXT DEFAULT '', right_eye_sph TEXT DEFAULT '',
                right_eye_cyl TEXT DEFAULT '', right_eye_ax TEXT DEFAULT '',
                right_eye_bcva TEXT DEFAULT '', right_eye_near TEXT DEFAULT '',
                left_eye_va TEXT DEFAULT '', left_eye_sph TEXT DEFAULT '',
                left_eye_cyl TEXT DEFAULT '', left_eye_ax TEXT DEFAULT '',
                left_eye_bcva TEXT DEFAULT '', left_eye_near TEXT DEFAULT '',
                notes TEXT DEFAULT '', diagnosis TEXT DEFAULT '',
                prescription TEXT DEFAULT '', status TEXT DEFAULT 'pending',
                created_at TEXT NOT NULL, updated_at TEXT
            )
        ''')
        await db.execute('''
            CREATE TABLE IF NOT EXISTS shortcuts (
                id TEXT PRIMARY KEY, text TEXT NOT NULL,
                sort_order INTEGER DEFAULT 0, created_at TEXT NOT NULL
            )
        ''')
        # New columns (idempotent) - extended exam fields
        for col in ['right_eye_ucva', 'left_eye_ucva',
                    'right_eye_iop', 'left_eye_iop',
                    'right_eye_lid', 'left_eye_lid',
                    'right_eye_cornea', 'left_eye_cornea',
                    'right_eye_lens', 'left_eye_lens',
                    'right_eye_retina', 'left_eye_retina']:
            await ensure_column(db, 'patients', col, 'TEXT DEFAULT ""')
        # Appointment scheduling (future bookings + follow-up dates)
        await ensure_column(db, 'patients', 'appointment_date', 'TEXT')
        await ensure_column(db, 'patients', 'appointment_note', 'TEXT DEFAULT ""')
        # Shortcut color
        await ensure_column(db, 'shortcuts', 'color', 'TEXT DEFAULT "#5B3A7D"')
        # Indexes
        await db.execute('CREATE INDEX IF NOT EXISTS idx_patients_status ON patients(status)')
        await db.execute('CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(name)')
        await db.execute('CREATE INDEX IF NOT EXISTS idx_patients_created ON patients(created_at)')
        await db.commit()


# ============ WebSocket connection manager ============
class ConnectionManager:
    def __init__(self):
        self.active: dict = {}  # {websocket: client_id}
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket, client_id: str = None):
        await ws.accept()
        async with self._lock:
            self.active[ws] = client_id or str(uuid.uuid4())

    async def disconnect(self, ws: WebSocket):
        async with self._lock:
            self.active.pop(ws, None)

    async def broadcast(self, event: str, data: dict = None):
        """Broadcast an event to all connected clients."""
        message = json.dumps({"event": event, "data": data or {}}, default=str)
        await self._send_all(message)

    async def broadcast_raw(self, payload: dict, exclude: str = None):
        """Broadcast a raw payload, optionally excluding one client_id."""
        message = json.dumps(payload, default=str)
        await self._send_all(message, exclude=exclude)

    async def _send_all(self, message: str, exclude: str = None):
        dead = []
        async with self._lock:
            connections = list(self.active.items())
        for ws, cid in connections:
            if exclude and cid == exclude:
                continue
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.disconnect(ws)


manager = ConnectionManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

api_router = APIRouter(prefix="/api")


async def verify_pin(x_clinic_pin: Optional[str] = Header(None)):
    if not get_role_for_pin(x_clinic_pin):
        raise HTTPException(status_code=401, detail="غير مصرح - PIN مطلوب")
    return True


# ============ Models ============
class EyeExamData(BaseModel):
    va: Optional[constr(max_length=50)] = ""
    sph: Optional[constr(max_length=50)] = ""
    cyl: Optional[constr(max_length=50)] = ""
    ax: Optional[constr(max_length=50)] = ""
    bcva: Optional[constr(max_length=50)] = ""
    near: Optional[constr(max_length=50)] = ""
    ucva: Optional[constr(max_length=50)] = ""
    iop: Optional[constr(max_length=50)] = ""
    lid: Optional[constr(max_length=200)] = ""
    cornea: Optional[constr(max_length=200)] = ""
    lens: Optional[constr(max_length=200)] = ""
    retina: Optional[constr(max_length=200)] = ""


class Patient(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: constr(min_length=1, max_length=200)
    age: conint(ge=0, le=150)
    date: constr(max_length=100)
    right_eye: EyeExamData = Field(default_factory=EyeExamData)
    left_eye: EyeExamData = Field(default_factory=EyeExamData)
    notes: Optional[constr(max_length=5000)] = ""
    diagnosis: Optional[constr(max_length=5000)] = ""
    prescription: Optional[constr(max_length=10000)] = ""
    status: str = "pending"
    appointment_date: Optional[constr(max_length=50)] = None
    appointment_note: Optional[constr(max_length=1000)] = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: Optional[datetime] = None


class PatientCreate(BaseModel):
    name: constr(min_length=1, max_length=200)
    age: conint(ge=0, le=150)
    date: constr(max_length=100)
    status: Optional[constr(max_length=50)] = "pending"
    appointment_date: Optional[constr(max_length=50)] = None
    appointment_note: Optional[constr(max_length=1000)] = ""


class PatientUpdate(BaseModel):
    right_eye: Optional[EyeExamData] = None
    left_eye: Optional[EyeExamData] = None
    notes: Optional[constr(max_length=5000)] = None
    diagnosis: Optional[constr(max_length=5000)] = None
    prescription: Optional[constr(max_length=10000)] = None
    status: Optional[constr(max_length=50)] = None
    appointment_date: Optional[constr(max_length=50)] = None
    appointment_note: Optional[constr(max_length=1000)] = None


class StatusUpdate(BaseModel):
    status: constr(min_length=1, max_length=50)


class ShortcutButton(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    text: str
    color: str = "#5B3A7D"
    order: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ShortcutCreate(BaseModel):
    text: constr(min_length=1, max_length=1000)
    color: Optional[constr(max_length=20)] = "#5B3A7D"


class ShortcutUpdate(BaseModel):
    text: constr(min_length=1, max_length=1000)
    color: Optional[constr(max_length=20)] = "#5B3A7D"


class PinVerification(BaseModel):
    pin: constr(min_length=1, max_length=50)


# ============ Helpers ============
EYE_FIELDS = ['va', 'sph', 'cyl', 'ax', 'bcva', 'near',
              'ucva', 'iop', 'lid', 'cornea', 'lens', 'retina']


def row_to_patient(row) -> dict:
    def eye(side: str) -> dict:
        return {f: row[f'{side}_eye_{f}'] or '' for f in EYE_FIELDS}
    return {
        'id': row['id'], 'name': row['name'], 'age': row['age'], 'date': row['date'],
        'right_eye': eye('right'), 'left_eye': eye('left'),
        'notes': row['notes'] or '', 'diagnosis': row['diagnosis'] or '',
        'prescription': row['prescription'] or '', 'status': row['status'],
        'appointment_date': row['appointment_date'] if 'appointment_date' in row.keys() else None,
        'appointment_note': (row['appointment_note'] if 'appointment_note' in row.keys() else '') or '',
        'created_at': datetime.fromisoformat(row['created_at']),
        'updated_at': datetime.fromisoformat(row['updated_at']) if row['updated_at'] else None,
    }


def row_to_shortcut(row) -> dict:
    return {
        'id': row['id'], 'text': row['text'],
        'color': row['color'] or '#5B3A7D',
        'order': row['sort_order'],
        'created_at': datetime.fromisoformat(row['created_at']),
    }


# ============ Public endpoints ============
@api_router.get("/")
async def root():
    return {"message": "Al-Siraj Eye Clinic API", "status": "running"}


@api_router.get("/health")
async def health():
    return {"status": "ok"}


@api_router.post("/verify-pin")
@limiter.limit("10/minute")
async def verify_pin_endpoint(request: Request, body: PinVerification):
    role = get_role_for_pin(body.pin)
    if not role:
        raise HTTPException(status_code=401, detail="PIN غير صحيح")
    return {"success": True, "role": role, "message": "تم التحقق بنجاح"}


# ============ WebSocket for real-time updates ============
@app.websocket("/ws/updates")
async def websocket_endpoint(websocket: WebSocket, pin: str = Query(...)):
    if not get_role_for_pin(pin):
        await websocket.close(code=1008)
        return
    client_id = str(uuid.uuid4())
    await manager.connect(websocket, client_id)
    try:
        while True:
            raw = await websocket.receive_text()
            # Relay client-side edits to all other clients
            try:
                payload = json.loads(raw)
                if payload.get("event") == "patient_field_edit":
                    payload["client_id"] = client_id
                    await manager.broadcast_raw(payload, exclude=client_id)
            except Exception:
                pass
    except WebSocketDisconnect:
        await manager.disconnect(websocket)
    except Exception:
        await manager.disconnect(websocket)


# ============ Patient CRUD ============
@api_router.post("/patients", response_model=Patient, dependencies=[Depends(verify_pin)])
@limiter.limit("60/minute")
async def create_patient(request: Request, input: PatientCreate):
    status = input.status if input.status in ("pending", "scheduled") else "pending"
    patient = Patient(
        name=input.name, age=input.age, date=input.date, status=status,
        appointment_date=input.appointment_date, appointment_note=input.appointment_note or "",
    )
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute(
            "INSERT INTO patients (id, name, age, date, status, appointment_date, appointment_note, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (patient.id, patient.name, patient.age, patient.date, patient.status,
             patient.appointment_date, patient.appointment_note, patient.created_at.isoformat())
        )
        await db.commit()
    event = "appointment_created" if status == "scheduled" else "patient_created"
    await manager.broadcast(event, {"id": patient.id, "name": patient.name})
    return patient


@api_router.get("/patients", response_model=List[Patient], dependencies=[Depends(verify_pin)])
@limiter.limit("240/minute")
async def get_patients(request: Request, status: Optional[str] = None, search: Optional[str] = None):
    query = "SELECT * FROM patients WHERE 1=1"
    params = []
    if status:
        query += " AND status = ?"
        params.append(status[:50])
    if search:
        escaped = search[:100].replace('%', r'\%').replace('_', r'\_')
        query += " AND name LIKE ? ESCAPE '\\'"
        params.append(f"%{escaped}%")
    query += " ORDER BY created_at DESC LIMIT 1000"
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(query, params) as cursor:
            rows = await cursor.fetchall()
    return [row_to_patient(row) for row in rows]


@api_router.get("/patients/{patient_id}", response_model=Patient, dependencies=[Depends(verify_pin)])
@limiter.limit("240/minute")
async def get_patient(request: Request, patient_id: str):
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM patients WHERE id = ?", (patient_id,)) as cursor:
            row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Patient not found")
    return row_to_patient(row)


@api_router.put("/patients/{patient_id}", response_model=Patient, dependencies=[Depends(verify_pin)])
@limiter.limit("120/minute")
async def update_patient(request: Request, patient_id: str, input: PatientUpdate):
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT id FROM patients WHERE id = ?", (patient_id,)) as cursor:
            if not await cursor.fetchone():
                raise HTTPException(status_code=404, detail="Patient not found")
        update_fields, params = [], []
        if input.right_eye:
            for f in EYE_FIELDS:
                update_fields.append(f"right_eye_{f} = ?")
                params.append(getattr(input.right_eye, f) or '')
        if input.left_eye:
            for f in EYE_FIELDS:
                update_fields.append(f"left_eye_{f} = ?")
                params.append(getattr(input.left_eye, f) or '')
        for name, val in [('notes', input.notes), ('diagnosis', input.diagnosis),
                          ('prescription', input.prescription), ('status', input.status),
                          ('appointment_date', input.appointment_date),
                          ('appointment_note', input.appointment_note)]:
            if val is not None:
                update_fields.append(f"{name} = ?")
                params.append(val)
        update_fields.append("updated_at = ?")
        params.append(datetime.now(timezone.utc).isoformat())
        params.append(patient_id)
        await db.execute(f"UPDATE patients SET {', '.join(update_fields)} WHERE id = ?", params)
        await db.commit()
        async with db.execute("SELECT * FROM patients WHERE id = ?", (patient_id,)) as cursor:
            updated = await cursor.fetchone()
    patient_data = row_to_patient(updated)
    await manager.broadcast("patient_updated", {
        "id": patient_id, "status": patient_data['status'], "name": patient_data['name']
    })
    return patient_data


@api_router.patch("/patients/{patient_id}/status", dependencies=[Depends(verify_pin)])
@limiter.limit("120/minute")
async def update_patient_status(request: Request, patient_id: str, body: StatusUpdate):
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute(
            "UPDATE patients SET status = ?, updated_at = ? WHERE id = ?",
            (body.status, datetime.now(timezone.utc).isoformat(), patient_id)
        )
        await db.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Patient not found")
    await manager.broadcast("patient_updated", {"id": patient_id, "status": body.status})
    return {"success": True, "status": body.status}


@api_router.delete("/patients/{patient_id}", dependencies=[Depends(verify_pin)])
@limiter.limit("30/minute")
async def delete_patient(request: Request, patient_id: str):
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute("DELETE FROM patients WHERE id = ?", (patient_id,))
        await db.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Patient not found")
    await manager.broadcast("patient_deleted", {"id": patient_id})
    return {"message": "Patient deleted"}


# ============ Shortcuts CRUD ============
@api_router.get("/shortcuts", response_model=List[ShortcutButton], dependencies=[Depends(verify_pin)])
@limiter.limit("240/minute")
async def get_shortcuts(request: Request):
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM shortcuts ORDER BY sort_order ASC") as cursor:
            rows = await cursor.fetchall()
    return [row_to_shortcut(row) for row in rows]


@api_router.post("/shortcuts", response_model=ShortcutButton, dependencies=[Depends(verify_pin)])
@limiter.limit("60/minute")
async def create_shortcut(request: Request, input: ShortcutCreate):
    async with aiosqlite.connect(DATABASE_PATH) as db:
        async with db.execute("SELECT COUNT(*) FROM shortcuts") as cursor:
            count = (await cursor.fetchone())[0]
        shortcut = ShortcutButton(text=input.text, color=input.color or "#5B3A7D", order=count)
        await db.execute(
            "INSERT INTO shortcuts (id, text, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?)",
            (shortcut.id, shortcut.text, shortcut.color, shortcut.order, shortcut.created_at.isoformat())
        )
        await db.commit()
    await manager.broadcast("shortcut_changed", {})
    return shortcut


@api_router.put("/shortcuts/{shortcut_id}", response_model=ShortcutButton, dependencies=[Depends(verify_pin)])
@limiter.limit("60/minute")
async def update_shortcut(request: Request, shortcut_id: str, input: ShortcutUpdate):
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "UPDATE shortcuts SET text = ?, color = ? WHERE id = ?",
            (input.text, input.color or "#5B3A7D", shortcut_id)
        )
        await db.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Shortcut not found")
        async with db.execute("SELECT * FROM shortcuts WHERE id = ?", (shortcut_id,)) as cur:
            row = await cur.fetchone()
    await manager.broadcast("shortcut_changed", {})
    return row_to_shortcut(row)


@api_router.delete("/shortcuts/{shortcut_id}", dependencies=[Depends(verify_pin)])
@limiter.limit("60/minute")
async def delete_shortcut(request: Request, shortcut_id: str):
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute("DELETE FROM shortcuts WHERE id = ?", (shortcut_id,))
        await db.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Shortcut not found")
    await manager.broadcast("shortcut_changed", {})
    return {"message": "Shortcut deleted"}


@api_router.get("/stats", dependencies=[Depends(verify_pin)])
@limiter.limit("120/minute")
async def get_stats(request: Request):
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT COUNT(*) as c FROM patients") as cur:
            total = (await cur.fetchone())['c']
        async with db.execute("SELECT COUNT(*) as c FROM patients WHERE status = 'pending'") as cur:
            pending = (await cur.fetchone())['c']
        async with db.execute("SELECT COUNT(*) as c FROM patients WHERE status = 'in_exam'") as cur:
            in_exam = (await cur.fetchone())['c']
        async with db.execute("SELECT COUNT(*) as c FROM patients WHERE status = 'completed'") as cur:
            completed = (await cur.fetchone())['c']
        today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
        async with db.execute(
            "SELECT COUNT(*) as c FROM patients WHERE substr(created_at, 1, 10) = ?", (today,)
        ) as cur:
            today_count = (await cur.fetchone())['c']
    return {
        'total_patients': total, 'pending_patients': pending,
        'in_exam_patients': in_exam, 'completed_patients': completed,
        'today_patients': today_count
    }


@api_router.get("/backup", dependencies=[Depends(verify_pin)])
@limiter.limit("10/minute")
async def download_backup(request: Request):
    """تحميل نسخة احتياطية من قاعدة البيانات (clinic.db) - مفيد خصوصاً عند النشر على خادم سحابي
    حيث لا يمكن استخدام أسلوب مزامنة Google Drive Desktop المحلي."""
    if not os.path.exists(DATABASE_PATH):
        raise HTTPException(status_code=404, detail="Database file not found")
    backup_name = f"clinic-backup-{datetime.now(timezone.utc).strftime('%Y-%m-%d')}.db"
    return FileResponse(DATABASE_PATH, filename=backup_name, media_type="application/octet-stream")


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["Content-Type", "X-Clinic-PIN"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Serve React frontend if built
FRONTEND_BUILD = BUNDLE_DIR / 'frontend_build'
if FRONTEND_BUILD.exists() and (FRONTEND_BUILD / 'index.html').exists():
    logger.info(f"Serving frontend from: {FRONTEND_BUILD}")
    static_dir = FRONTEND_BUILD / 'static'
    if static_dir.exists():
        app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    @app.get("/manifest.json", include_in_schema=False)
    async def manifest():
        return FileResponse(FRONTEND_BUILD / 'manifest.json')

    @app.get("/service-worker.js", include_in_schema=False)
    async def service_worker():
        return FileResponse(FRONTEND_BUILD / 'service-worker.js')

    @app.get("/favicon.ico", include_in_schema=False)
    async def favicon():
        f = FRONTEND_BUILD / 'favicon.ico'
        if f.exists():
            return FileResponse(f)
        raise HTTPException(status_code=404)

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_react(full_path: str):
        if full_path.startswith("api/") or full_path.startswith("ws/"):
            raise HTTPException(status_code=404, detail="Route not found")
        return FileResponse(FRONTEND_BUILD / 'index.html')
else:
    logger.info(f"Frontend build not found at {FRONTEND_BUILD} - running API-only mode")

    @app.get("/", include_in_schema=False)
    async def root_dev():
        return {"message": "Al-Siraj Clinic API", "mode": "development"}
