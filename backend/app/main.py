import logging
from contextlib import asynccontextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, categories, face, finance, news, ride_misc, rides, stocks, system, transactions
from app.core.config import ROOT, settings
from app.core.ratelimit import RateLimitMiddleware

log = logging.getLogger("rubicore")


def migrate():
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "database" / "migrations"))
    cfg.attributes["configure_logger"] = False
    command.upgrade(cfg, "head")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.secret_key == "dev-insecure-change-me" and settings.environment != "development":
        raise RuntimeError("SECRET_KEY must be set outside development")
    migrate()
    yield


app = FastAPI(title=f"{settings.app_name} API", version="1.0.0", description=settings.tagline, lifespan=lifespan)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

api = APIRouter(prefix="/api")
for r in (auth.router, transactions.router, categories.router, finance.router, face.router, rides.router, rides.analytics, ride_misc.router, stocks.router, news.router, system.router):
    api.include_router(r)
app.include_router(api)


@app.get("/health")
def health():
    return {"status": "ok", "app": settings.app_name}
