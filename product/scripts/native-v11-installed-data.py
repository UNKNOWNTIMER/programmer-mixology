"""Private SQLite backup/restore helper for the installed V1.1 smoke test.

Never relocates release data. Restoration uses SQLite backup, only after offline
process/hash checks and only for the expected catalog/startup changes.
"""
import argparse
import base64
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def cell(value):
    if value is None:
        return ["null", None]
    if isinstance(value, bytes):
        return ["blob", base64.b64encode(value).decode()]
    if isinstance(value, float):
        return ["real", value.hex()]
    return ["integer" if isinstance(value, int) else "text", value]


def quote(name):
    return '"' + name.replace('"', '""') + '"'


def connect(path, mode="ro"):
    return sqlite3.connect(path.as_uri() + "?mode=" + mode, uri=True, timeout=3, isolation_level=None)


def inspect_connection(connection):
    integrity = [row[0] for row in connection.execute("PRAGMA integrity_check")]
    if integrity != ["ok"]:
        raise RuntimeError("SQLite integrity check failed")
    schema = list(connection.execute("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name"))
    tables = {}
    for (name,) in connection.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
        columns = list(connection.execute("PRAGMA table_xinfo(" + quote(name) + ")"))
        rows = sorted(digest([cell(value) for value in row]) for row in connection.execute("SELECT * FROM " + quote(name)))
        tables[name] = {"count": len(rows), "sha256": digest(rows), "schema_sha256": digest(columns)}
    result = {"schema_sha256": digest(schema), "user_version": connection.execute("PRAGMA user_version").fetchone()[0], "application_id": connection.execute("PRAGMA application_id").fetchone()[0], "tables": tables}
    result["logical_sha256"] = digest(result)
    return result


def inspect(path):
    with closing(connect(path)) as connection:
        connection.execute("PRAGMA query_only=ON")
        connection.execute("BEGIN")
        return inspect_connection(connection)


def databases(directory):
    result = {}
    for path in directory.iterdir():
        if path.suffix.lower() not in (".sqlite", ".sqlite3", ".db"):
            continue
        if not path.is_file() or path.is_symlink() or getattr(path.stat(), "st_file_attributes", 0) & 0x400:
            raise RuntimeError("Refuse nonregular/reparse database: " + path.name)
        physical_parent = path.resolve().parent
        if physical_parent != directory:
            # Codex's inherited Windows package context redirects individual
            # AppData files even when the directory itself resolves normally.
            # Permit only that explicit local package-cache shape and record it.
            try:
                redirected = physical_parent.relative_to(directory.parent / "Packages").parts
            except ValueError:
                redirected = ()
            if not (len(redirected) == 4 and redirected[0].startswith("OpenAI.Codex_") and redirected[1:] == ("LocalCache", "Local", directory.name)):
                raise RuntimeError("Database escaped the expected directory")
        # Use the one verified physical name for SQLite and its WAL/SHM sidecars.
        # Mixing a virtualized alias and its backing path can retain stale WAL views.
        result[path.name] = path.resolve()
    if "pixelmix.sqlite" not in result:
        raise RuntimeError("Existing normal pixelmix.sqlite is required; refuse first-use data creation")
    return result


def assert_no_app(names):
    if os.name != "nt":
        return
    script = "Get-CimInstance Win32_Process | Select-Object ProcessId,Name,ExecutablePath | ConvertTo-Json -Compress"
    raw = subprocess.check_output(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script], creationflags=subprocess.CREATE_NO_WINDOW)
    processes = json.loads(raw.decode("utf-8-sig"))
    if isinstance(processes, dict):
        processes = [processes]
    matches = [item for item in processes if item["Name"].lower() in {name.lower() for name in names}]
    if matches:
        raise RuntimeError("A TIMER process is active; refuse database mutation: " + json.dumps(matches))


def write_json(path, value):
    # Evidence files are per-run and exclusive; never replace an unknown file.
    with path.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")


def backup(directory, run, names):
    assert_no_app(names)
    files = databases(directory)
    manifest = {"data_dir": str(directory), "process_names": names, "databases": {}}
    for name, source_path in sorted(files.items()):
        destination_path = run / name
        # Reserve the new destination exclusively before the SQLite backup API opens it.
        with destination_path.open("xb"):
            pass
        with closing(connect(source_path)) as source, closing(sqlite3.connect(destination_path)) as destination:
            source.execute("BEGIN")
            before = inspect_connection(source)
            source.backup(destination)
        copied = inspect(destination_path)
        if copied != before or inspect(source_path) != before:
            raise RuntimeError("Database changed during backup: " + name)
        manifest["databases"][name] = {"snapshot": before, "file_id": source_path.stat().st_ino, "physical_path": str(source_path.resolve())}
    assert_no_app(names)
    if set(databases(directory)) != set(files):
        raise RuntimeError("Database inventory changed during backup")
    write_json(run / "manifest.json", manifest)
    return {"action": "backup", "databases": {name: entry["snapshot"] for name, entry in manifest["databases"].items()}, "physical_paths": {name: entry["physical_path"] for name, entry in manifest["databases"].items()}}


def rows(connection, table):
    return {row[0]: row for row in connection.execute("SELECT * FROM " + quote(table))}


def permitted_startup_change(original, current, runtime_state):
    old = inspect_connection(original)
    new = inspect_connection(current)
    if old["schema_sha256"] != new["schema_sha256"] or old["user_version"] != new["user_version"] or old["application_id"] != new["application_id"]:
        raise RuntimeError("Unexpected schema/version change; manual recovery required")
    append_only = {"recipes", "ingredients", "profiles", "sources", "metadata"}
    for table, before in old["tables"].items():
        if before == new["tables"][table]:
            continue
        if table in append_only:
            before_rows, after_rows = rows(original, table), rows(current, table)
            if any(after_rows.get(key) != row for key, row in before_rows.items()):
                raise RuntimeError("Existing catalog data changed unexpectedly: " + table)
        elif table == "settings":
            before_rows, after_rows = rows(original, table), rows(current, table)
            if {key: row for key, row in before_rows.items() if key != "ui_state"} != {key: row for key, row in after_rows.items() if key != "ui_state"}:
                raise RuntimeError("Non-UI personal settings changed; refuse restore")
            if runtime_state is None or "ui_state" not in after_rows or json.loads(after_rows["ui_state"][1]) != runtime_state:
                raise RuntimeError("Closed UI state differs from the read-only runtime snapshot; refuse restore")
        else:
            raise RuntimeError("Unexpected personal table mutation: " + table)


def restore(directory, run):
    manifest = json.loads((run / "manifest.json").read_text(encoding="utf-8"))
    if Path(manifest["data_dir"]).resolve() != directory:
        raise RuntimeError("Backup targets another data directory")
    assert_no_app(manifest["process_names"])
    files = databases(directory)
    if set(files) != set(manifest["databases"]):
        raise RuntimeError("Unexpected database created/deleted; preserve it and require manual recovery")
    runtime_file = run / "runtime-ui-state.json"
    runtime_state = json.loads(runtime_file.read_text(encoding="utf-8")) if runtime_file.exists() else None
    expected = {name: inspect(path) for name, path in files.items()}
    write_json(run / "after-close.json", expected)
    opened = []
    try:
        # Acquire retained exclusive locks before checking/rewriting any database.
        for name, path in sorted(files.items()):
            if path.stat().st_ino != manifest["databases"][name]["file_id"] or str(path.resolve()) != manifest["databases"][name]["physical_path"]:
                raise RuntimeError("Database file was replaced: " + name)
            connection = connect(path, "rw")
            opened.append((name, connection))
            connection.execute("PRAGMA locking_mode=EXCLUSIVE")
            connection.execute("BEGIN EXCLUSIVE")
            connection.execute("COMMIT")
            if inspect_connection(connection) != expected[name]:
                raise RuntimeError("Database changed after shutdown: " + name)
        assert_no_app(manifest["process_names"])
        # Validate the entire restore set before the first write.
        changed = []
        for name, destination in opened:
            saved = manifest["databases"][name]["snapshot"]
            if inspect(run / name) != saved:
                raise RuntimeError("Backup logical hash mismatch: " + name)
            if expected[name] == saved:
                continue
            if name != "pixelmix.sqlite":
                raise RuntimeError("Host or other normal database changed; refuse restore: " + name)
            with closing(connect(run / name)) as original:
                permitted_startup_change(original, destination, runtime_state)
            changed.append(name)
        for name, destination in opened:
            if name not in changed:
                continue
            with closing(connect(run / name)) as source:
                source.backup(destination)
            checkpoint = destination.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
            if checkpoint and checkpoint[0] != 0:
                raise RuntimeError("Restored WAL checkpoint is busy: " + name)
            if inspect_connection(destination) != manifest["databases"][name]["snapshot"]:
                raise RuntimeError("Restored logical hash mismatch: " + name)
        result = {"action": "restore", "restored_databases": changed, "all_logical_hashes_restored": True, "host_preserved": True}
    finally:
        for _, connection in reversed(opened):
            connection.close()
    final = {name: inspect(path) for name, path in files.items()}
    if any(final[name] != entry["snapshot"] for name, entry in manifest["databases"].items()):
        raise RuntimeError("Final original logical table hash verification failed")
    if any(inspect(directory / name) != entry["snapshot"] for name, entry in manifest["databases"].items()):
        raise RuntimeError("Logical AppData alias differs from restored physical database")
    write_json(run / "restored.json", final)
    return result | {"databases": final}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("backup", "restore"))
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--process-name", action="append", default=["pixel-mix.exe"])
    args = parser.parse_args()
    directory, run = args.data_dir.resolve(strict=True), args.run_dir.resolve(strict=True)
    if directory == run or directory in run.parents:
        raise RuntimeError("Backup must be outside normal user data")
    result = backup(directory, run, args.process_name) if args.action == "backup" else restore(directory, run)
    print(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    main()
