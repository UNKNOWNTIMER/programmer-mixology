"""Read-only personal preview snapshot; never export private review or queue prose."""

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path


def inspect(database):
    database = database.resolve(strict=True)
    connection = sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)
    try:
        connection.execute("PRAGMA query_only=ON")
        connection.execute("BEGIN")
        # Check the real database structure rather than assuming a migration version.
        required = {"recipes": {"id", "json"}, "settings": {"key", "json"}}
        for table, columns in required.items():
            actual = {row[1] for row in connection.execute('PRAGMA table_info("' + table + '")')}
            if not columns.issubset(actual):
                raise RuntimeError("Unexpected " + table + " schema")
        integrity = [row[0] for row in connection.execute("PRAGMA integrity_check")]
        recipe_count = connection.execute("SELECT count(*) FROM recipes").fetchone()[0]
        row = connection.execute("SELECT CAST(json AS BLOB) FROM settings WHERE key='ui_state'").fetchone()
        content = row[0] if row else None
        state = json.loads(content.decode("utf-8")) if content is not None else {}
        if not isinstance(state, dict):
            raise RuntimeError("ui_state is not a JSON object")
        queue = state.get("archiveQueue")
        settings = state.get("settings", {})
        if queue is not None and not isinstance(queue, list):
            raise RuntimeError("archiveQueue is not an array")
        if not isinstance(settings, dict):
            raise RuntimeError("settings is not a JSON object")
        library_row = connection.execute("SELECT CAST(json AS BLOB) FROM settings WHERE key='recipe_library'").fetchone()
        library_content = library_row[0] if library_row else None
        library = json.loads(library_content.decode("utf-8")) if library_content is not None else {}
        return {
            "recipe_count": recipe_count,
            "integrity_check": integrity,
            "ui_state_sha256": hashlib.sha256(content).hexdigest() if content is not None else None,
            "recipe_library_sha256": hashlib.sha256(library_content).hexdigest() if library_content is not None else None,
            "recipe_library_counts": {key: len(library.get(key, [])) for key in ("custom", "hidden", "deleted")},
            "selected": state.get("selected"),
            "archive_queue_count": len(queue) if queue is not None else None,
            "settings": {key: settings.get(key) for key in ("language", "fontScale", "reducedMotion")},
        }
    finally:
        connection.close()


def main():
    product = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=product / ".local-preview" / "pixelmix.sqlite")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.resolve() == args.database.resolve():
        raise ValueError("Evidence must not overwrite the database")
    summary = inspect(args.database)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
