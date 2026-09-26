#!/usr/bin/env python3
"""Shared helpers for gha-ci-audit's GitHub API analysis scripts.

Null-guard convention (see issue #305): `parse_dt` always guards — a falsy
input (`None` or `""`) returns `None` rather than raising. Every caller that
needs a duration must check both endpoints for `None` itself before calling
`duration_minutes`, which requires two real `datetime` values and does not
guard. This matches the majority of the scripts this module was extracted
from; the one holdout (`compute_workflow_timing.py`) previously skipped the
guard and relied on `None.replace(...)` raising inside a broad `try/except`
to skip bad records — it now gets the same guarantees as the rest for free.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone


def parse_dt(s: str | None) -> datetime | None:
    """Parse an ISO-8601 datetime string from the GitHub API.

    Returns `None` for falsy input instead of raising, so callers can treat
    a missing timestamp (e.g. a run that hasn't finished) as "no data" rather
    than handling an exception.
    """
    if not s:
        return None
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def duration_minutes(start: datetime, end: datetime) -> float:
    """Minutes between two datetimes. Callers must ensure neither is `None`."""
    return (end - start).total_seconds() / 60


def thirty_days_ago() -> str:
    """UTC timestamp ~30 days before now, in the format the GitHub API's
    `created>=` run-search filter expects (e.g. "2024-01-15T00:00:00Z").

    Python equivalent of `common.sh`'s `thirty_days_ago_iso` shell function,
    for scripts that already run in Python rather than shelling out to `date`.
    """
    return (datetime.now(timezone.utc) - timedelta(days=30)).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
