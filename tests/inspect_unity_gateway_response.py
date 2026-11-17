"""Print a credential-free sample Unity Gateway response for contract verification."""

from __future__ import annotations

import json
import os
import subprocess
import urllib.request


def main() -> None:
    token = json.loads(subprocess.run(
        ["databricks", "auth", "token", "--profile", "febar"], check=True,
        capture_output=True, text=True,
        env={**os.environ, "DATABRICKS_AUTH_STORAGE": "plaintext"},
    ).stdout)["access_token"]
    request = urllib.request.Request(
        "https://dbc-a947f70b-da71.cloud.databricks.com/ai-gateway/mlflow/v1/chat/completions",
        method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        data=json.dumps({
            "model": "promoflow.promoflow_ml.promo_decision_brief",
            "messages": [{"role": "user", "content": "Reply with exactly: governed promotion rationale"}],
            "max_tokens": 32,
        }).encode(),
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        print(json.dumps(json.loads(response.read()), indent=2))


if __name__ == "__main__":
    main()
