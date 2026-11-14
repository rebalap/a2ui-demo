"""HTTP: one endpoint that streams a turn as server-sent events, plus the built web app.

    POST /api/turn   {sessionId, receiptId? | action? | text?}  →  SSE events
    GET  /api/meta   receipts to pick from, and whether a Gemini key is set

Run:  .venv/bin/python -m uvicorn server.app:app --port 8090
"""

from __future__ import annotations

import copy
import json
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import agent, host

app = FastAPI(title="Expense Copilot")
SESSIONS: dict[str, agent.Session] = {}
DIST = agent.ROOT / "web" / "dist"


@app.get("/api/meta")
def meta() -> dict[str, Any]:
    return {
        "mode": "gemini" if agent.gemini_key() else "scripted",
        "model": agent.MODEL,
        "receipts": [
            {"id": r["id"], "merchant": r["merchant"], "total": host.money(r["amount"]), "hint": r["hint"]}
            for r in host.RECEIPTS.values()
        ],
        "employee": {"name": host.EMPLOYEE["name"], "manager": host.EMPLOYEE["manager"]},
    }


@app.post("/api/turn")
async def turn(request: Request) -> StreamingResponse:
    body = await request.json()
    sid = str(body.get("sessionId") or "default")
    session = SESSIONS.get(sid)
    pre: list[dict[str, Any]] = []

    if body.get("receiptId"):
        receipt = host.RECEIPTS.get(body["receiptId"])
        if receipt is None:
            return JSONResponse({"error": "unknown receipt"}, status_code=400)  # type: ignore[return-value]
        session = SESSIONS[sid] = agent.Session(case=host.Case(receipt=copy.deepcopy(receipt)))
        tag, text = "receipt", ""
    else:
        session = session or SESSIONS.setdefault(sid, agent.Session())
        action = (body.get("action") or {})
        name = action.get("name")
        text = str(body.get("text") or "")
        tag = name if name in ("submit", "approve", "reject") else "message"
        case = session.case
        # The host records the decision before the model hears about it.
        if case and tag == "submit" and case.status != "draft":
            tag, text = "message", f"(I pressed submit again, but the expense is already {case.status}.)"
        elif case and tag == "submit":
            case.purpose = str((action.get("context") or {}).get("purpose") or "").strip()
            if case.needs_approval and not case.purpose:
                tag, text = "message", "(I pressed submit without a business purpose.)"
            else:
                case.status = "pending" if case.needs_approval else "approved"
                if case.status == "approved":
                    case.budget["spent"] += case.receipt["amount"]
        elif case and tag in ("approve", "reject"):
            if case.status != "pending":
                tag, text = "message", f"(The manager pressed {tag}, but the expense is {case.status}.)"
            else:
                case.status = "approved" if tag == "approve" else "rejected"
                if case.status == "approved":
                    case.budget["spent"] += case.receipt["amount"]
                pre = agent.status_update(session)
        elif tag in ("submit", "approve", "reject"):
            tag = "message"

    async def events():
        if pre:
            yield _sse({"type": "ui", "messages": pre, "source": "host"})
        async for event in agent.run_turn(session, tag, text):
            yield _sse(event)

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


def _sse(event: dict[str, Any]) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


@app.get("/api/healthz")
def healthz() -> dict[str, Any]:
    return {"ok": True, "sessions": len(SESSIONS)}


if (DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(DIST / "index.html")
