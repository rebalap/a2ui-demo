"""Builds the expense catalog: the A2UI v1.0 basic catalog plus four expense components.

The catalog is the guardrail. The agent can only draw what is listed here, the
server validates every message against it, and the React renderer implements
every entry. Run it after changing a component:

    .venv/bin/python catalog/build_catalog.py

Adapted from the Travel A2UI sample (github.com/a2ui-project/labs), Apache 2.0.
"""

from __future__ import annotations

import json
import pathlib
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "catalog.json"
COMMON = "https://a2ui.org/specification/v1_0/common_types.json#/$defs"
SDK_COMMON = "common_types.json#/$defs"
CATALOG_ID = "https://expense-copilot.dev/catalogs/expense/catalog.json"
PROTOCOL_VERSION = "1.0"

INSTRUCTIONS = """\
Expense components carry meaning the layout primitives do not:
- A receipt is a ReceiptCard, a policy result a PolicyCheck, a budget a
  BudgetMeter, and a request for a manager's decision an ApprovalCard. Never
  rebuild them from Row, Column and Text.
- Money is a preformatted display string ("$186.40").
- Values the host publishes in the data model (the employee, the card, the
  budget, the receipt) are bound with $ paths, never typed out.
- Every pressable thing has an action.
- One job per surface.\
"""


def dyn_str(desc: str) -> dict[str, Any]:
    return {"$ref": f"{COMMON}/DynamicString", "description": desc}


def dyn_num(desc: str) -> dict[str, Any]:
    return {"$ref": f"{COMMON}/DynamicNumber", "description": desc}


def action(desc: str) -> dict[str, Any]:
    return {"$ref": f"{COMMON}/Action", "description": desc}


def enum(desc: str, values: list[str]) -> dict[str, Any]:
    return {"type": "string", "description": desc, "enum": values}


def static_list_of(desc: str, keys: dict[str, str]) -> dict[str, Any]:
    return {
        "type": "array",
        "description": desc,
        "items": {
            "type": "object",
            "properties": {k: {"type": "string", "description": v} for k, v in keys.items()},
            "required": list(keys)[:1],
            "additionalProperties": False,
        },
    }


def component(name: str, description: str, props: dict[str, Any], required: list[str]) -> dict[str, Any]:
    # The component's own properties come first: their order is the positional
    # argument order the model is taught in Express.
    return {
        "type": "object",
        "allOf": [
            {
                "type": "object",
                "description": description,
                "properties": {"component": {"const": name}, **props},
                "required": ["component", *required],
            },
            {"$ref": f"{COMMON}/ComponentCommon"},
            {"$ref": "#/$defs/CatalogComponentCommon"},
        ],
        "unevaluatedProperties": False,
    }


EXPENSE_COMPONENTS: dict[str, dict[str, Any]] = {
    "ReceiptCard": component(
        "ReceiptCard",
        "A scanned receipt: who was paid, when, how much, and the line items.",
        {
            "merchant": dyn_str("Who was paid, e.g. `$/receipt/merchant`."),
            "total": dyn_str("Preformatted total, e.g. `$/receipt/total`."),
            "date": dyn_str("When, e.g. `$/receipt/date`."),
            "category": dyn_str("Expense category, e.g. 'Meals'."),
            "items": static_list_of(
                "Line items as read from the receipt. Static values only.",
                {"label": "What the line is, e.g. 'Tasting menu x3'.", "amount": "Preformatted, e.g. '$165.00'."},
            ),
            "paidWith": dyn_str("The card it was paid with. Always bind `$/employee/card`."),
        },
        ["merchant", "total"],
    ),
    "PolicyCheck": component(
        "PolicyCheck",
        "The result of one company-policy rule, as the host computed it.",
        {
            "status": enum("ok, warning (needs a reason) or blocked.", ["ok", "warning", "blocked"]),
            "title": dyn_str("The rule's verdict in a few words, e.g. 'Over the dinner limit'."),
            "detail": dyn_str("Why, in one sentence, e.g. '$62/person against a $50 limit.'"),
        },
        ["status", "title"],
    ),
    "BudgetMeter": component(
        "BudgetMeter",
        "How much of a budget is used, as a bar. Bind spent and limit to the host's numbers.",
        {
            "label": dyn_str("Which budget, e.g. `$/budget/name`."),
            "spent": dyn_num("Already spent, e.g. `$/budget/spent`."),
            "limit": dyn_num("The budget, e.g. `$/budget/limit`."),
            "pending": dyn_num("This expense's amount, drawn as a striped segment, e.g. `$/receipt/amount`."),
        },
        ["label", "spent", "limit"],
    ),
    "ApprovalCard": component(
        "ApprovalCard",
        "A request for a manager's decision on one expense, with approve and reject.",
        {
            "requester": dyn_str("Who is asking. Bind `$/employee/name`."),
            "amount": dyn_str("Preformatted amount, e.g. `$/receipt/total`."),
            "summary": dyn_str("What it was, one line, e.g. 'Client dinner at Nopa'."),
            "justification": dyn_str("The employee's reason, bound, e.g. `$/form/purpose`."),
            "flags": static_list_of(
                "Policy flags the manager should see. Static values only.",
                {"text": "One flag, e.g. 'Over dinner limit by $36'."},
            ),
            "status": dyn_str("pending, approved or rejected. Bind `$/approval/status`."),
            "approveAction": action("Pressed to approve."),
            "rejectAction": action("Pressed to reject."),
        },
        ["requester", "amount", "summary", "approveAction", "rejectAction"],
    ),
}

ACCESSIBILITY = {
    "type": "object",
    "description": "Attributes for assistive technologies like screen readers.",
    "properties": {
        "label": {"$ref": f"{COMMON}/DynamicString", "description": "A short purpose, 1 to 3 words."},
        "description": {"$ref": f"{COMMON}/DynamicString", "description": "More, where the label is not enough."},
        "live": {"type": "string", "enum": ["off", "polite", "assertive"], "default": "off"},
        "hidden": {"$ref": f"{COMMON}/DynamicBoolean", "description": "Decoration only."},
    },
    "additionalProperties": False,
}


def _absolute_refs(node: Any) -> Any:
    if isinstance(node, dict):
        return {
            k: (COMMON + v[len(SDK_COMMON):] if k == "$ref" and isinstance(v, str) and v.startswith(SDK_COMMON) else _absolute_refs(v))
            for k, v in node.items()
        }
    if isinstance(node, list):
        return [_absolute_refs(x) for x in node]
    return node


def _own_properties_lead(schema: dict[str, Any]) -> dict[str, Any]:
    out = json.loads(json.dumps(schema))
    all_of = out.get("allOf")
    if isinstance(all_of, list):
        own = [s for s in all_of if isinstance(s, dict) and isinstance(s.get("properties"), dict)]
        out["allOf"] = [*own, *[s for s in all_of if s not in own]]
    return out


def _formats_as_any_of(node: Any) -> Any:
    if isinstance(node, list):
        return [_formats_as_any_of(x) for x in node]
    if not isinstance(node, dict):
        return node
    out = {k: _formats_as_any_of(v) for k, v in node.items()}
    branches = out.get("oneOf")
    if isinstance(branches, list) and branches and all(isinstance(b, dict) and set(b) == {"format"} for b in branches):
        out["anyOf"] = out.pop("oneOf")
    return out


def build() -> dict[str, Any]:
    from a2ui.core.basic_catalog import BasicCatalog
    from a2ui.core.catalog import ComponentApi

    basic = BasicCatalog(PROTOCOL_VERSION)
    derived = basic.derive(
        catalog_id=CATALOG_ID,
        components=[
            *basic.components,
            *(ComponentApi(name, schema, from_document=True) for name, schema in EXPENSE_COMPONENTS.items()),
        ],
        functions=list(basic.functions),
        instructions=INSTRUCTIONS,
    ).to_json()

    defs = dict(derived["$defs"])
    defs["AccessibilityAttributes"] = ACCESSIBILITY
    shared = dict(defs.get("CatalogComponentCommon") or {"type": "object", "properties": {}})
    shared["properties"] = {
        "weight": {"$ref": "#/$defs/Weight"},
        **(shared.get("properties") or {}),
        "accessibility": {"$ref": "#/$defs/AccessibilityAttributes"},
    }
    defs["CatalogComponentCommon"] = shared

    catalog = {
        "$schema": derived["$schema"],
        "$id": CATALOG_ID,
        "catalogId": CATALOG_ID,
        "protocolVersion": PROTOCOL_VERSION,
        "title": "Expense Copilot Catalog",
        "description": "Files expenses as interactive UI: receipts, policy checks, budgets and approvals.",
        "instructions": INSTRUCTIONS,
        "components": {n: _own_properties_lead(s) for n, s in derived["components"].items()},
        "functions": derived["functions"],
        "$defs": defs,
    }
    return _formats_as_any_of(_absolute_refs(catalog))


if __name__ == "__main__":
    OUT.write_text(json.dumps(build(), indent=2, ensure_ascii=False) + "\n", "utf-8")
    print(f"wrote {OUT.relative_to(ROOT.parent)}")
