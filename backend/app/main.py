"""FastAPI application: middleware (request IDs, structured logs without bodies), error format."""
import json
import logging
import secrets
import time

import os

from fastapi import FastAPI, Request
from starlette.exceptions import HTTPException  # base class: also covers routing 404/405 raised by Starlette
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse

from .api.routes import router
from .api.saas import router as saas_router
from .api.licence import router as licence_router
from .api.web_auth import router as web_auth_router
from .config import get_settings
from .db import Base, engine

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("trustcode.http")


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="TrustCode API", version="0.1.0",
                  description="Evidence-grounded verification of AI-generated code. Never returns an aggregate correctness verdict.")
    if s.env != "production":
        Base.metadata.create_all(engine)  # production uses Alembic migrations
    if s.local_mode:
        from .local_secret import ensure_local_secret
        ensure_local_secret()  # create ~/.trustcode/local-secret at startup so the extension can sign in
    if s.cors_origins:
        app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in s.cors_origins.split(",")],
                           allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["Authorization", "Content-Type"])

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        rid = request.headers.get("x-request-id", "")
        rid = rid if rid.isalnum() and len(rid) <= 32 else secrets.token_hex(8)
        request.state.request_id = rid
        t0 = time.monotonic()
        response = await call_next(request)
        response.headers["X-Request-ID"] = rid
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store"
        # Never log request/response bodies: they may contain source code (NFR-P3).
        log.info(json.dumps({"rid": rid, "method": request.method, "path": request.url.path, "status": response.status_code,
                             "ms": int((time.monotonic() - t0) * 1000)}))
        return response

    def _err(request: Request, status: int, code: str, message, headers=None):
        return JSONResponse({"error": {"code": code, "message": message, "request_id": getattr(request.state, "request_id", None)}},
                            status_code=status, headers=headers)

    @app.exception_handler(HTTPException)
    async def http_exc(request: Request, exc: HTTPException):
        code = {400: "bad_request", 401: "unauthorized", 403: "forbidden", 404: "not_found", 405: "method_not_allowed",
                409: "conflict", 429: "rate_limited"}.get(exc.status_code, "error")
        return _err(request, exc.status_code, code, exc.detail, getattr(exc, "headers", None))

    @app.exception_handler(RequestValidationError)
    async def validation_exc(request: Request, exc: RequestValidationError):
        # Strip 'input' so submitted code is never echoed back in errors/logs.
        details = [{"loc": e["loc"], "msg": e["msg"]} for e in exc.errors()]
        return _err(request, 422, "validation_error", details)

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        log.exception("unhandled error rid=%s", getattr(request.state, "request_id", None))
        return _err(request, 500, "internal_error", "internal server error")

    app.include_router(router)
    app.include_router(web_auth_router)
    app.include_router(saas_router)
    app.include_router(licence_router)

    @app.get("/", include_in_schema=False)
    def root():
        # The API has no landing page of its own; send people to the website.
        return RedirectResponse(os.environ.get("TRUSTCODE_SITE_URL", "https://trustcode-app.vercel.app"), status_code=307)
    return app


app = create_app()
