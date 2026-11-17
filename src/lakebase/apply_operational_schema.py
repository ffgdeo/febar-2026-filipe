"""Apply and verify the clean PromoFlow operational schema on a chosen project."""
from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path

import psycopg2

EXPECTED_TABLES = {
    "ai_decision_briefs", "audit_events", "promotion_decisions",
    "scenario_comparison_members", "scenario_comparisons", "scenario_versions", "scenarios",
}


def cli_json(*args: str, profile: str) -> dict:
    result = subprocess.run(
        ["databricks", *args, "--profile", profile, "-o", "json"], check=True,
        capture_output=True, text=True,
        env={**os.environ, "DATABRICKS_AUTH_STORAGE": "plaintext"},
    )
    return json.loads(result.stdout)


def quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", required=True)
    parser.add_argument("--endpoint", required=True, help="Full projects/.../endpoints/... path")
    parser.add_argument("--database", default="databricks_postgres")
    parser.add_argument("--user", required=True)
    parser.add_argument("--app-principal", help="Optional app service-principal application ID")
    args = parser.parse_args()

    endpoint = cli_json("postgres", "get-endpoint", args.endpoint, profile=args.profile)
    credential = cli_json("postgres", "generate-database-credential", args.endpoint, profile=args.profile)
    with psycopg2.connect(
        host=endpoint["status"]["hosts"]["host"], user=args.user,
        password=credential["token"], dbname=args.database, sslmode="require",
    ) as connection:
        with connection.cursor() as cursor:
            cursor.execute(Path(__file__).with_name("operational_schema.sql").read_text())
            if args.app_principal:
                principal = quote_identifier(args.app_principal)
                cursor.execute(f"GRANT USAGE ON SCHEMA promoflow_ops TO {principal}")
                cursor.execute(
                    f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA promoflow_ops TO {principal}"
                )
            cursor.execute("""
                SELECT c.relname,
                       CASE c.relreplident WHEN 'f' THEN 'full' ELSE c.relreplident::text END
                FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname='promoflow_ops' AND c.relkind='r' ORDER BY c.relname
            """)
            tables = cursor.fetchall()
    names = {row[0] for row in tables}
    if names != EXPECTED_TABLES or any(row[1] != "full" for row in tables):
        raise RuntimeError(f"Schema verification failed: {tables}")
    print("TABLE|REPLICA_IDENTITY")
    for name, identity in tables:
        print(f"{name}|{identity}")


if __name__ == "__main__":
    main()
