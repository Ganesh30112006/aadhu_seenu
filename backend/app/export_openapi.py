"""Writes contracts/openapi.json from the FastAPI app (`python -m app.export_openapi`).
The frontend generates its TypeScript types from that file."""

from __future__ import annotations

import json
from pathlib import Path

from app.api.main import create_app


def main() -> None:
    target = Path(__file__).resolve().parents[2] / "contracts" / "openapi.json"
    schema = create_app().openapi()
    target.write_text(json.dumps(schema, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {target} ({len(schema['paths'])} paths)")


if __name__ == "__main__":
    main()
