"""Verify the deployed promotion-only app without exposing OAuth credentials."""

from __future__ import annotations

import json
import os
import subprocess
import urllib.request


APP_URL = "https://promoflow-cleany-7474658488596447.aws.databricksapps.com"


def request(path: str, *, method: str = "GET") -> tuple[int, dict]:
    token_result = subprocess.run(
        ["databricks", "auth", "token", "--profile", "febar"],
        check=True, capture_output=True, text=True,
        env={**os.environ, "DATABRICKS_AUTH_STORAGE": "plaintext"},
    )
    token = json.loads(token_result.stdout)["access_token"]
    req = urllib.request.Request(
        f"{APP_URL}{path}", method=method,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as response:
        return response.status, json.loads(response.read())


def main() -> None:
    overview_status, overview = request("/api/overview")
    opportunities_status, opportunities = request("/api/workbench/opportunities")
    opportunity_id = opportunities["data"][0]["opportunity_id"]
    narrative_status, narrative = request(
        f"/api/workbench/opportunities/{opportunity_id}/narrative", method="POST"
    )
    refreshed_status, refreshed = request("/api/workbench/opportunities")
    generated = next(row for row in refreshed["data"] if row["opportunity_id"] == opportunity_id)
    print(json.dumps({
        "overview_status": overview_status,
        "opportunities_status": opportunities_status,
        "narrative_status": narrative_status,
        "refreshed_status": refreshed_status,
        "approved_promotions": overview["approved_promotions"],
        "opportunity_id": opportunity_id,
        "narrative_source": generated["narrative_source"],
        "model_service": narrative["modelService"],
        "prompt_version": narrative["promptVersion"],
        "response_id": narrative["responseId"],
        "latency_ms": narrative["latencyMs"],
        "narrative": narrative["narrative"],
    }, indent=2))


if __name__ == "__main__":
    main()
