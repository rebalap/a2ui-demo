"""The host: the company's own systems, and every rule that must not vary.

Nothing here is the model's. The employee record, the corporate card, the
budget and the policy verdicts are computed in code and published to the
renderer as A2UI data-model updates. The model is told only the *paths*
(`$/employee/card`), never the private values behind them.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any

#: Private: reaches the renderer, never the model.
EMPLOYEE = {
    "name": "Jordan Lee",
    "employeeId": "E-20417",
    "card": "Corporate Visa •• 4417",
    "costCenter": "CC-3120 · Field Sales West",
    "manager": "Sam Rivera",
}

DINNER_LIMIT_PER_PERSON = 50.0
HOTEL_LIMIT_PER_NIGHT = 275.0

BUDGET = {"name": "Q4 travel & entertainment", "spent": 2380.0, "limit": 3000.0}

RECEIPTS: dict[str, dict[str, Any]] = {
    "dinner": {
        "id": "dinner",
        "merchant": "Nopa, San Francisco",
        "date": "Tue 11 Nov 2026",
        "amount": 186.40,
        "category": "Client meals",
        "attendees": 3,
        "items": [
            {"label": "Dinner for 3", "amount": "$148.00"},
            {"label": "Tax", "amount": "$13.40"},
            {"label": "Tip", "amount": "$25.00"},
        ],
        "hint": "Client dinner, 3 people",
    },
    "ride": {
        "id": "ride",
        "merchant": "Lyft",
        "date": "Wed 12 Nov 2026",
        "amount": 42.18,
        "category": "Ground transport",
        "attendees": 1,
        "items": [{"label": "Ride to SFO", "amount": "$38.18"}, {"label": "Tip", "amount": "$4.00"}],
        "hint": "Ride to the airport",
    },
    "hotel": {
        "id": "hotel",
        "merchant": "Hotel Zephyr, Chicago",
        "date": "13–15 Nov 2026",
        "amount": 712.00,
        "category": "Lodging",
        "attendees": 1,
        "nights": 2,
        "items": [
            {"label": "2 nights × $310", "amount": "$620.00"},
            {"label": "Taxes & fees", "amount": "$92.00"},
        ],
        "hint": "Two nights for a customer visit",
    },
}


def money(value: float) -> str:
    return f"${value:,.2f}"


def check_policy(receipt: dict[str, Any], budget: dict[str, Any]) -> list[dict[str, str]]:
    """Every policy verdict for a receipt. Deterministic: a rule in code is a guarantee."""
    results: list[dict[str, str]] = []
    amount = receipt["amount"]
    if receipt["category"] == "Client meals":
        per_person = amount / receipt["attendees"]
        if per_person > DINNER_LIMIT_PER_PERSON:
            over = amount - DINNER_LIMIT_PER_PERSON * receipt["attendees"]
            results.append({
                "status": "warning",
                "title": "Over the dinner limit",
                "detail": f"{money(per_person)}/person against a {money(DINNER_LIMIT_PER_PERSON)} limit; {money(over)} over. Needs a business reason.",
            })
        else:
            results.append({"status": "ok", "title": "Within the dinner limit", "detail": f"{money(per_person)}/person."})
    if receipt["category"] == "Lodging":
        nightly = (amount / receipt.get("nights", 1))
        if nightly > HOTEL_LIMIT_PER_NIGHT:
            results.append({
                "status": "warning",
                "title": "Above the nightly hotel rate",
                "detail": f"{money(nightly)}/night with taxes against a {money(HOTEL_LIMIT_PER_NIGHT)} cap. Needs a business reason.",
            })
    left = budget["limit"] - budget["spent"]
    if amount > left:
        results.append({
            "status": "blocked" if amount > left * 2 else "warning",
            "title": "Goes over the quarterly budget",
            "detail": f"Only {money(left)} left in {budget['name']}; this is {money(amount)}. Your manager must approve the overage.",
        })
    if not any(r["status"] != "ok" for r in results):
        results.append({"status": "ok", "title": "Meets policy", "detail": "No exceptions. It can be auto-approved."})
    return results


@dataclass
class Case:
    """One expense being filed: the host's record of it."""

    receipt: dict[str, Any]
    budget: dict[str, Any] = field(default_factory=lambda: copy.deepcopy(BUDGET))
    purpose: str = ""
    status: str = "draft"  # draft → pending → approved | rejected

    @property
    def policy(self) -> list[dict[str, str]]:
        return check_policy(self.receipt, self.budget)

    @property
    def needs_approval(self) -> bool:
        return any(r["status"] != "ok" for r in self.policy)

    def data_roots(self) -> dict[str, Any]:
        """Everything the renderer may bind, by root. Filled in on the server."""
        r = self.receipt
        return {
            "/employee": EMPLOYEE,
            "/receipt": {
                "merchant": r["merchant"],
                "date": r["date"],
                "total": money(r["amount"]),
                "amount": r["amount"],
                "category": r["category"],
            },
            "/budget": self.budget,
            "/form": {"purpose": self.purpose},
            "/approval": {"status": self.status},
        }

    def facts_for_model(self) -> str:
        """What the model is told. Public facts and policy verdicts; no private values."""
        r = self.receipt
        lines = [
            f"Receipt: {r['merchant']}, {r['date']}, {money(r['amount'])}, category {r['category']}"
            + (f", {r['attendees']} people" if r.get("attendees", 1) > 1 else "")
            + ".",
            "Line items: " + "; ".join(f"{i['label']} {i['amount']}" for i in r["items"]) + ".",
            f"Budget: {money(self.budget['limit'] - self.budget['spent'])} left of {money(self.budget['limit'])}.",
            "Policy verdicts (computed by the host, show each as a PolicyCheck):",
            *[f"- {p['status']}: {p['title']}. {p['detail']}" for p in self.policy],
            f"Needs manager approval: {'yes' if self.needs_approval else 'no'}.",
            f"Status: {self.status}.",
        ]
        if self.purpose:
            lines.append(f"Business purpose given: {self.purpose!r}.")
        return "\n".join(lines)


#: The paths the model may bind, as it is told them. Values are withheld.
BINDABLE_PATHS = """\
The host publishes these values into every surface's data model. Bind them
with $ paths; you never see the values and must never type them out:
  $/employee/name, $/employee/card, $/employee/costCenter, $/employee/manager
  $/receipt/merchant, $/receipt/date, $/receipt/total, $/receipt/amount (number), $/receipt/category
  $/budget/name, $/budget/spent (number), $/budget/limit (number)
  $/form/purpose (the business-purpose text field binds here)
  $/approval/status (draft, pending, approved or rejected)"""

#: Which values are private, for the privacy view.
PRIVATE_PATHS = ["/employee/name", "/employee/employeeId", "/employee/card", "/employee/costCenter", "/employee/manager"]
