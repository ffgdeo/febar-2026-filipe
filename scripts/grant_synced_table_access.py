"""Grant a Databricks App role least-privilege access to a Lakebase synced table.

The short-lived OAuth database credential is held in memory only.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess

import psycopg


def cli_json(*args: str, profile: str) -> dict:
    env = {**os.environ, "DATABRICKS_AUTH_STORAGE": "plaintext"}
    result = subprocess.run(
        ["databricks", *args, "--profile", profile, "--output", "json"],
        check=True,
        capture_output=True,
        text=True,
        env=env,
    )
    return json.loads(result.stdout)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", required=True)
    parser.add_argument("--project", required=True)
    parser.add_argument("--branch", required=True)
    parser.add_argument("--endpoint", required=True)
    parser.add_argument("--database", default="databricks_postgres")
    parser.add_argument("--schema", required=True)
    parser.add_argument("--table", required=True)
    parser.add_argument("--role", required=True)
    args = parser.parse_args()

    endpoint_name = f"projects/{args.project}/branches/{args.branch}/endpoints/{args.endpoint}"
    endpoint = cli_json("postgres", "get-endpoint", endpoint_name, profile=args.profile)
    credential = cli_json("postgres", "generate-database-credential", endpoint_name, profile=args.profile)
    identity = cli_json("current-user", "me", profile=args.profile)
    host = endpoint.get("status", {}).get("hosts", {}).get("host")
    token = credential.get("token")
    if not host or not token:
        raise RuntimeError("Lakebase endpoint host or database credential was unavailable")

    with psycopg.connect(host=host, port=5432, dbname=args.database, user=identity["userName"], password=token, sslmode="require") as conn:
        with conn.cursor() as cur:
            cur.execute(f'GRANT USAGE ON SCHEMA "{args.schema}" TO "{args.role}"')
            cur.execute(f'GRANT SELECT ON "{args.schema}"."{args.table}" TO "{args.role}"')
            cur.execute(f'SELECT count(*) FROM "{args.schema}"."{args.table}"')
            count = cur.fetchone()[0]
    print(json.dumps({"schema": args.schema, "table": args.table, "rows": count, "role": args.role, "status": "GRANTED"}))


if __name__ == "__main__":
    main()
