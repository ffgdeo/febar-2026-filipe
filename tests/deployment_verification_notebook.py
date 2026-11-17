# Databricks notebook source
table = "promoflow.promoflow_raw.verify_notebook_20261116"
spark.sql(f"CREATE TABLE {table} (id INT, msg STRING)")
spark.sql(f"INSERT INTO {table} VALUES (3, 'notebook verified')")
rows = [row.asDict() for row in spark.sql(f"SELECT * FROM {table}").collect()]
spark.sql(f"DROP TABLE {table}")
dbutils.notebook.exit(str(rows))
