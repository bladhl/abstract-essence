import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

import httpx2
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from redis.asyncio import Redis
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import create_engine
from starlette.middleware.trustedhost import TrustedHostMiddleware

from essence.documents.router import router as documents_router
from essence.infra.limiter import ProviderLimiter
from essence.learning.router import router as learning_router
from essence.reading.ai import PydanticReadingAI, configured_choices
from essence.reading.router import router as reading_router
from essence.settings import Settings


class RequestBoundary:
    """Bound bytes before JSON parsing; reject cross-origin writes, including chunked bodies."""

    def __init__(self, app, origins: list[str]):
        self.app, self.origins = app, origins

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope["headers"])
        origin = headers.get(b"origin", b"").decode()
        if origin and origin not in self.origins:
            return await JSONResponse({"detail": "Origin is not allowed."}, 403)(
                scope, receive, send
            )
        if scope["method"] in {"POST", "PUT", "PATCH", "DELETE"}:
            if headers.get(b"x-essence-client") != b"workspace":
                return await JSONResponse({"detail": "Workspace request header is required."}, 403)(
                    scope, receive, send
                )
            data = bytearray()
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                data.extend(message.get("body", b""))
                if len(data) > 12_000_000:
                    return await JSONResponse({"detail": "Request too large."}, 413)(
                        scope, receive, send
                    )
                if not message.get("more_body", False):
                    break
            consumed = False

            async def buffered_receive():
                nonlocal consumed
                if not consumed:
                    consumed = True
                    return {"type": "http.request", "body": bytes(data), "more_body": False}
                return await receive()

            return await self.app(scope, buffered_receive, send)
        return await self.app(scope, receive, send)


def create_app(settings: Settings | None = None, engine=None, ai=None, limiter=None) -> FastAPI:
    settings = settings or Settings()
    db_engine = engine or create_engine(settings.database_url, pool_pre_ping=True)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        redis = Redis.from_url(
            settings.redis_url, max_connections=10, socket_connect_timeout=1, socket_timeout=2
        )
        async with httpx2.AsyncClient(timeout=45) as client:
            app.state.ai = ai or PydanticReadingAI(settings, client)
            app.state.limiter = limiter or ProviderLimiter(redis)
            app.state.ai_slots = asyncio.Semaphore(2)
            yield
        await redis.aclose()
        if engine is None:
            db_engine.dispose()

    app = FastAPI(title="Abstract Essence", lifespan=lifespan)
    app.state.engine, app.state.settings = db_engine, settings
    app.add_middleware(RequestBoundary, origins=settings.allowed_origins)
    app.add_middleware(
        TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "testserver"]
    )

    @app.exception_handler(SQLAlchemyError)
    async def database_unavailable(_request: Request, _exc: SQLAlchemyError):
        return JSONResponse(
            {"detail": "Database unavailable. Check PostgreSQL and run migrations."}, 503
        )

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_request: Request, _exc: RequestValidationError):
        # Pydantic error details normally echo submitted source text. Do not expose it.
        return JSONResponse(
            {"detail": "Invalid request. Check required fields, page scope and input limits."}, 422
        )

    @app.get("/api/config")
    def configuration() -> dict:
        return {
            "choices": configured_choices(settings),
            "local_workspace": True,
            "max_scope_pages": 20,
            "max_scope_characters": 60000,
        }

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok", "service": "abstract-essence"}

    app.include_router(documents_router)
    app.include_router(reading_router)
    app.include_router(learning_router)
    built_frontend = Path(__file__).resolve().parents[3] / "frontend/dist/frontend/browser"
    if built_frontend.is_dir():
        app.frontend("/", directory=str(built_frontend))
    return app


app = create_app()
