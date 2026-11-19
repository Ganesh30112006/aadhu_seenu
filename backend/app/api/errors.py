"""Uniform error bodies: {code, message} (ErrorResponse)."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def not_found(what: str = "lecture") -> ApiError:
    return ApiError(404, f"{what}_not_found", f"This {what} does not exist.")


def forbidden(message: str = "You do not have permission to do this.") -> ApiError:
    return ApiError(403, "forbidden", message)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse({"code": exc.code, "message": exc.message}, status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        parts = [f"{'.'.join(str(p) for p in err['loc'][1:])}: {err['msg']}" for err in exc.errors()]
        return JSONResponse({"code": "validation_error", "message": "; ".join(parts)}, status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(
            {"code": f"http_{exc.status_code}", "message": str(exc.detail)}, status_code=exc.status_code
        )
