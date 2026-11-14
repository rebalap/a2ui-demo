"""The agent: what the model is told, and how what it writes becomes A2UI.

One turn:
  1. The host turns the event (a receipt, a press, a message) into facts.
  2. The model (Gemini, or a scripted stand-in) writes prose plus A2UI Express.
  3. The A2UI agent SDK parses that stream as it arrives, validates every
     component against the catalog and emits A2UI v1.0 messages.
  4. When a surface is created, the host fills its data model with the real
     values (the private ones included) in `updateDataModel` messages.
"""

from __future__ import annotations

import asyncio
import json
import os
import pathlib
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

from a2ui.inference_formats import ExpressFormatFactory
from a2ui.parser import A2uiPart, ErrorPart, TextPart, to_message_dicts
from a2ui.processor import A2uiRequestProcessor, CatalogConfig
from a2ui.utils import RendererState

from . import host

ROOT = pathlib.Path(__file__).resolve().parent.parent
CATALOG = CatalogConfig.from_path(str(ROOT / "catalog" / "catalog.json"), protocol_version="1.0").transformed_catalog
ALLOWED = ["createSurface", "updateComponents", "updateDataModel", "deleteSurface"]
MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.8-flash")


def processor(surface_id: str) -> A2uiRequestProcessor:
    return A2uiRequestProcessor(
        [CATALOG],
        format_factory=ExpressFormatFactory(surface_id=surface_id, allowed_messages=ALLOWED, version="1.0"),
    )


ROLE = """\
You are Expense Copilot, the assistant inside Acme's expense app. You help an
employee file an expense and route it to their manager. You answer with one or
two short sentences of prose, then one A2UI block that draws the interface.

Each user turn starts with a tag from the host:
[receipt]  A receipt was scanned. Draw ONE card with, in order: a ReceiptCard
           (bind merchant, total, date and paidWith to host paths; category and
           items as static values from the facts), a PolicyCheck for every
           verdict the host computed (copy status, title and detail exactly),
           a BudgetMeter (label, spent and limit bound to $/budget/..., pending
           bound to $/receipt/amount). If it needs approval, add a TextField
           labelled "Business purpose" bound to $/form/purpose with a ?required
           check, then a Button "Submit for approval". Otherwise a Button
           "File expense". Either button's action is
           Event("submit", {purpose: $/form/purpose}).
[action submit]  The employee submitted. If it needs approval, draw ONE
           ApprovalCard for the manager: requester $/employee/name, amount
           $/receipt/total, a one-line summary, justification $/form/purpose,
           a flag for each warning or blocked verdict, status $/approval/status,
           approveAction Event("approve") and rejectAction Event("reject").
           Your prose tells the employee it was sent to their manager.
           If it needs no approval, draw a PolicyCheck("ok", ...) confirming it
           was filed.
[action approve] / [action reject]  The manager decided; the host has already
           recorded it. Draw ONE PolicyCheck: "ok" for approved, "blocked" for
           rejected, with a title and a one-sentence detail for the employee.
Any other message: answer briefly; draw a card only if it helps.

Rules: never type a value the host publishes; bind it. Never invent policy
verdicts or amounts. Draw only into the default surface; do not call surface().
"""


def system_prompt() -> str:
    return "\n\n".join([ROLE, host.BINDABLE_PATHS, processor("card").prompt_snippet])


# -- scripted model: the same Express a model would write, for a demo with no key --


def q(value: str) -> str:
    """A string as Express writes it. Non-ASCII stays as is: Express does not decode \\u escapes."""
    return json.dumps(value, ensure_ascii=False)


def _items(case: host.Case) -> str:
    return "[" + ", ".join(f'{{label: {q(i["label"])}, amount: {q(i["amount"])}}}' for i in case.receipt["items"]) + "]"


def scripted(tag: str, case: host.Case) -> str:
    checks = case.policy
    if tag == "receipt":
        names, lines = [], []
        for n, p in enumerate(checks):
            lines.append(f"p{n} = PolicyCheck({q(p['status'])}, {q(p['title'])}, detail={q(p['detail'])})")
            names.append(f"p{n}")
        if case.needs_approval:
            ask = 'why = TextField("Business purpose", value=$/form/purpose, checks=[?required("Add a business purpose")])\n'
            label, kids = "Submit for approval", ["why", "go"]
            intro = f"I read your {case.receipt['merchant'].split(',')[0]} receipt. It needs a business purpose before it can go to your manager."
        else:
            ask, label, kids = "", "File expense", ["go"]
            intro = f"I read your {case.receipt['merchant'].split(',')[0]} receipt. It meets policy, so you can file it now."
        return (
            f"{intro}\n<a2ui>\n"
            f"r = ReceiptCard($/receipt/merchant, $/receipt/total, date=$/receipt/date, category={q(case.receipt['category'])}, items={_items(case)}, paidWith=$/employee/card)\n"
            + "\n".join(lines) + "\n"
            + "b = BudgetMeter($/budget/name, $/budget/spent, $/budget/limit, pending=$/receipt/amount)\n"
            + ask
            + f'go = Button(Text({q(label)}), action=Event("submit", {{purpose: $/form/purpose}}), variant="primary")\n'
            + f"root = Column([r, {', '.join(names)}, b, {', '.join(kids)}])\n</a2ui>"
        )
    if tag == "submit":
        if not case.needs_approval:
            return ('Filed. It meets policy, so it was auto-approved.\n<a2ui>\n'
                    'root = PolicyCheck("ok", "Expense filed", detail="Auto-approved. It will be reimbursed in the next payroll run.")\n</a2ui>')
        flags = ", ".join(f'{{text: {q(p["title"])}}}' for p in checks if p["status"] != "ok")
        return (
            "Sent to your manager for approval. You'll see their decision here.\n<a2ui>\n"
            f'root = ApprovalCard($/employee/name, $/receipt/total, {q(case.receipt["hint"] + " · " + case.receipt["merchant"])}, '
            f'justification=$/form/purpose, flags=[{flags}], status=$/approval/status, approveAction=Event("approve"), rejectAction=Event("reject"))\n</a2ui>'
        )
    if tag == "approve":
        return ('Good news: your manager approved it.\n<a2ui>\n'
                'root = PolicyCheck("ok", "Approved by your manager", detail="It will be reimbursed in the next payroll run.")\n</a2ui>')
    if tag == "reject":
        return ('Your manager rejected this one.\n<a2ui>\n'
                'root = PolicyCheck("blocked", "Rejected by your manager", detail="Talk to them, or re-file it with a corrected amount.")\n</a2ui>')
    if case and case.status == "draft" and case.needs_approval and not case.purpose:
        return "Add a business purpose first. Your manager needs it to approve an exception."
    if case and case.status == "pending":
        return f"It's waiting on your manager, {host.EMPLOYEE['manager']}."
    if case and case.status in ("approved", "rejected"):
        return f"This expense is already {case.status}. Pick another receipt to file a new one."
    return "I'm running in scripted mode (no Gemini key), so I follow the expense flow only. Pick a receipt to start."


async def scripted_stream(text: str) -> AsyncIterator[str]:
    for i in range(0, len(text), 24):
        await asyncio.sleep(0.03)
        yield text[i : i + 24]


# -- Gemini --------------------------------------------------------------------


def gemini_key() -> str | None:
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    return key if key and key != "scripted" else None


async def gemini_stream(history: list[dict[str, Any]]) -> AsyncIterator[str]:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=gemini_key())
    stream = await client.aio.models.generate_content_stream(
        model=MODEL,
        contents=history,
        config=types.GenerateContentConfig(system_instruction=system_prompt(), temperature=0.2),
    )
    async for chunk in stream:
        if chunk.text:
            yield chunk.text


# -- a session and its turns -------------------------------------------------------


@dataclass
class Session:
    case: host.Case | None = None
    history: list[dict[str, Any]] = field(default_factory=list)
    state: RendererState = field(default_factory=lambda: RendererState([CATALOG]))
    cards: int = 0

    def next_surface(self, prefix: str) -> str:
        self.cards += 1
        return f"{prefix}-{self.cards}"


async def run_turn(session: Session, tag: str, text: str = "") -> AsyncIterator[dict[str, Any]]:
    """One turn, as events for the client: text, ui, context, wire, error, done."""
    case = session.case
    default = session.next_surface("approval" if tag == "submit" and case and case.needs_approval else "card")
    facts = case.facts_for_model() if case else "No receipt yet."
    user = f"[{'receipt' if tag == 'receipt' else 'action ' + tag if tag in ('submit', 'approve', 'reject') else 'message'}]\n{facts}"
    if text:
        user += f"\nEmployee says: {text}"
    session.history.append({"role": "user", "parts": [{"text": user}]})

    live = gemini_key() is not None
    yield {
        "type": "context",
        "mode": "gemini" if live else "scripted",
        "model": MODEL if live else "scripted",
        "modelSaw": user,
        "bindablePaths": host.BINDABLE_PATHS,
        "hostFilled": {p: _lookup(case, p) for p in host.PRIVATE_PATHS} if case else {},
    }

    for attempt in range(2):
        source: list[str] = []
        sent: list[dict[str, Any]] = []
        refused: str | None = None
        stream = processor(default).open_stream(wrapped=True, state=session.state, after_rejected_block="continue")
        chunks = gemini_stream(session.history) if live else scripted_stream(scripted(tag, case) if case else scripted("", None))  # type: ignore[arg-type]
        try:
            async for chunk in chunks:
                source.append(chunk)
                for event in _events(stream.feed(chunk), session, sent):
                    if event["type"] == "error":
                        refused = event["message"]
                    yield event
            for event in _events(stream.close(), session, sent):
                if event["type"] == "error":
                    refused = event["message"]
                yield event
        except Exception as error:  # noqa: BLE001 - say what went wrong, keep the server up
            yield {"type": "error", "message": f"{type(error).__name__}: {error}"}
            break
        written = "".join(source)
        session.history.append({"role": "model", "parts": [{"text": written}]})
        yield {"type": "wire", "express": written, "messages": sent}
        if not refused or not live:
            break
        # The catalog refused something. Tell the model why and let it draw again.
        default = session.next_surface("approval" if default.startswith("approval") else "card")
        session.history.append({"role": "user", "parts": [{"text": f"[host] Your A2UI block was refused: {refused} Write the whole block again, corrected."}]})
    yield {"type": "done"}


def _lookup(case: host.Case | None, path: str) -> Any:
    if case is None:
        return None
    root, key = path.rsplit("/", 1)
    return case.data_roots().get(root, {}).get(key)


def _events(parts: list[Any], session: Session, sent: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for part in parts:
        if isinstance(part, TextPart):
            if part.text:
                out.append({"type": "text", "text": part.text})
        elif isinstance(part, ErrorPart):
            out.append({"type": "error", "message": str(part.error)})
        elif isinstance(part, A2uiPart):
            messages = to_message_dicts(part.a2ui)
            for message in list(messages):
                created = message.get("createSurface", {}).get("surfaceId")
                if created and session.case:
                    # The host fills the surface's data: real values, server-side.
                    messages.extend(
                        {"version": "1.0", "updateDataModel": {"surfaceId": created, "path": root, "value": value}}
                        for root, value in session.case.data_roots().items()
                    )
            sent.extend(messages)
            out.append({"type": "ui", "messages": messages})
    return out


def status_update(session: Session) -> list[dict[str, Any]]:
    """The host's own data update after a decision: every live surface sees the new status and budget."""
    assert session.case
    out: list[dict[str, Any]] = []
    for sid in list(session.state.surface_ids):
        for path, value in (("/approval", {"status": session.case.status}), ("/budget", session.case.budget)):
            out.append({"version": "1.0", "updateDataModel": {"surfaceId": sid, "path": path, "value": value}})
    return out
