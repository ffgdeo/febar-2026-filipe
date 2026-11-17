"""Authenticated smoke checks for PromoFlow API endpoints without printing tokens."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import urllib.request


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", required=True)
    parser.add_argument("--url", required=True)
    args = parser.parse_args()
    env = {**os.environ, "DATABRICKS_AUTH_STORAGE": "plaintext"}
    token_result = subprocess.run(
        ["databricks", "auth", "token", "--profile", args.profile, "--output", "json"],
        check=True,
        capture_output=True,
        text=True,
        env=env,
    )
    token = json.loads(token_result.stdout)["access_token"]
    checks: dict[str, dict[str, object]] = {}
    for path in ["/api/whoami", "/api/overview", "/api/promotion-history", "/api/upcoming-promotions", "/api/workbench/opportunities"]:
        request = urllib.request.Request(f"{args.url.rstrip('/')}{path}", headers={"Authorization": f"Bearer {token}"})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                body = json.load(response)
                if isinstance(body, dict) and isinstance(body.get("data"), list):
                    count = len(body["data"])
                elif path == "/api/overview" and isinstance(body, dict):
                    count = body.get("kpis", {}).get("totalUpcoming")
                else:
                    count = None
                checks[path] = {"status": response.status, "count": count}
                if path == "/api/overview" and isinstance(body, dict):
                    checks[path]["kpis"] = body.get("kpis")
        except Exception as error:
            checks[path] = {"status": "FAILED", "error": str(error)}
    print(json.dumps(checks, indent=2, sort_keys=True))
    if any(check["status"] != 200 for check in checks.values()):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
