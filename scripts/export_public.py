"""Create a new, audited public source tree without publishing or changing this checkout.

Only Git-tracked source files and the explicit public-documentation additions below
are candidates. User databases, old build evidence and machine-bound diagnostics
are never collected by walking the whole repository. Run --plan for a read-only
inventory; --destination requires a new directory outside the source checkout.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import posixpath
import re
import stat
import subprocess
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_ADDITIONS = {
    "README.en.md", "README.zh-CN.md", "LICENSE", "CONTRIBUTING.md", "SECURITY.md", "AUTHORS.md",
    "CODE_OF_CONDUCT.md", "scripts/export_public.py", "tests/test_public_export.py",
    "docs/ARCHITECTURE.md", "docs/USAGE.md",
    "docs/releases/1.2.0-STATUS.md", "docs/releases/1.2.0-BUILD_REPORT.md",
    "docs/releases/1.2.0.md",
    "product/apps/client/src/brand.ts", "product/scripts/build-windows-installer.ps1",
    "product/tests/e2e/public-release-smoke.cjs",
}
PUBLIC_ADDITION_PREFIXES = (".github/", "docs/media/")
REPORT_REPLACEMENTS = {
    "product/STATUS.md": "docs/releases/1.2.0-STATUS.md",
    "product/BUILD_REPORT.md": "docs/releases/1.2.0-BUILD_REPORT.md",
}
LOCAL_ONLY = {
    "AGENTS.md", "CODEX_START_HERE.md", "HANDOFF_STATUS.json", "CHECKSUMS.sha256",
    "产品级Codex开发任务书.md", "docs/参考测试结果.md",
    "product/docs/mobile-environment.json", "product/docs/mobile-tool-versions.json",
    "product/docs/mobile-validation.md", "product/docs/RELEASE_V1.1.md",
    "product/packaging/ARTIFACTS.json", "product/packaging/ARTIFACTS-V1.1.json",
    "product/packaging/SHA256SUMS.txt", "product/packaging/SHA256SUMS-V1.1.txt",
    "product/data/catalog/community-source-records-2026-09-21.json",
    "product/scripts/test-native.ps1", "product/scripts/clean-build-history.ps1",
}
LOCAL_PREFIXES = (
    "product/evidence/", "docs/archive/", "assets/references/",
    "product/packaging/installer/",
)
RUNTIME_PARTS = {
    ".git", ".tools", "node_modules", "target", "dist", ".local-preview",
    "__pycache__", ".pytest_cache", ".vite", ".vite-temp", "test-results",
    "playwright-report", ".venv", "venv",
}
RUNTIME_SUFFIXES = {
    ".exe", ".dll", ".pdb", ".obj", ".lib", ".exp", ".pyc", ".log",
    ".sqlite", ".sqlite-wal", ".sqlite-shm", ".db", ".timermix", ".pixelmix",
    ".gguf", ".safetensors", ".onnx", ".pfx", ".p12", ".pem", ".key",
    ".zip", ".7z", ".webm", ".mp4", ".tsbuildinfo",
}
MACHINE_PATH = re.compile(
    r"(?i)(?:[a-z]:[\\/]+Users[\\/]+(?!Public(?:[\\/]|$)|Default(?:[\\/]|$)|TEST user(?:[\\/]|$)|OTHER(?:[\\/]|$))"
    r"[^\\/\s<>\"']+|[a-z]:[\\/]+AI[\\/]+)"
)
SECRET_PATTERNS = {
    "github_token": re.compile(rb"(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})"),
    "api_secret": re.compile(rb"sk-[A-Za-z0-9_-]{20,}"),
    "aws_access_key": re.compile(rb"AKIA[A-Z0-9]{16}"),
    "private_key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
}
SOURCE_METADATA = {
    "product/data/dlc/xiaodong/source-manifest.json",
    "product/data/dlc/xiaodong/extracted.json",
}
DOCX_RELATIVE = "product/data/dlc/xiaodong/source.docx"
EXECUTABLE_TEXT = {".py", ".ps1", ".cmd", ".bat", ".cjs", ".mjs", ".sh", ".cpp", ".cc", ".c", ".h"}
SOURCE_EXTENSIONS = {".rs", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css"}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def safe_relative(name: str) -> str:
    path = PurePosixPath(name)
    if not name or "\\" in name or path.is_absolute() or any(p in {"", ".", ".."} for p in name.split("/")):
        raise ValueError("Unsafe repository-relative path")
    if ":" in name:
        raise ValueError("Unexpected drive or alternate stream in relative path")
    return path.as_posix()


def exclusion_reason(name: str) -> str | None:
    path = PurePosixPath(name)
    if name in LOCAL_ONLY:
        return "local handoff, historical machine report, or raw research response"
    if name.startswith(LOCAL_PREFIXES) or any(p.lower() in RUNTIME_PARTS for p in path.parts):
        return "runtime, local evidence, dependency cache, or handoff archive"
    if path.name.lower().startswith(".env") or path.name.lower() in {"credentials.json", "secrets.json", "hardware_report.json"}:
        return "local environment or credential file"
    if path.suffix.lower() in RUNTIME_SUFFIXES or ".sqlite" in path.name.lower():
        return "binary build output, user archive/database, model, credential, or execution log"
    if name.startswith("product/packaging/references/") and path.name not in {"TIMER32.ico", "TIMER_LOGO.png", "ASSET_MAP.md"}:
        return "supplied UI reference image, unnecessary for a source build"
    return None


def assert_ordinary_file(root: Path, name: str) -> Path:
    path = root.joinpath(*PurePosixPath(safe_relative(name)).parts)
    current = root
    for part in PurePosixPath(name).parts:
        current = current / part
        info = current.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 1024):
            raise ValueError(f"Refusing a symbolic link or reparse point: {name}")
    if not path.is_file() or not path.resolve().is_relative_to(root.resolve()):
        raise ValueError(f"Not an ordinary repository file: {name}")
    return path


def candidates(root: Path) -> list[str]:
    result = subprocess.run(["git", "-C", str(root), "ls-files", "-z"], check=True, stdout=subprocess.PIPE)
    names = {safe_relative(v.decode("utf-8")) for v in result.stdout.split(b"\0") if v}
    names.update(name for name in PUBLIC_ADDITIONS if (root / name).is_file())
    for prefix in PUBLIC_ADDITION_PREFIXES:
        folder = root / prefix
        if not folder.exists():
            continue
        for ancestor in [folder, *folder.parents]:
            if ancestor == root:
                break
            info = ancestor.lstat()
            if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 1024):
                raise ValueError(f"Refusing a reparse point in a public additions folder: {prefix}")
        for current, directories, filenames in os.walk(folder, followlinks=False):
            directories[:] = [name for name in directories if name.lower() not in RUNTIME_PARTS]
            for directory in directories:
                info = (Path(current) / directory).lstat()
                if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 1024):
                    raise ValueError("Refusing a reparse point beneath public additions")
            for filename in filenames:
                name = (Path(current) / filename).relative_to(root).as_posix()
                names.add(safe_relative(name))
    names.update(REPORT_REPLACEMENTS)
    return sorted(names)


def transform_metadata(name: str, data: bytes) -> tuple[bytes, list[str]]:
    """Change only the source location field, preserving recipe/source document bytes."""
    if name not in SOURCE_METADATA:
        return data, []
    text = data.decode("utf-8-sig")
    before = json.loads(text)
    if not isinstance(before, dict) or not isinstance(before.get("source_path"), str):
        raise ValueError(f"Unexpected source metadata structure: {name}")
    if not MACHINE_PATH.search(before["source_path"]):
        return data, []
    updated, count = re.subn(
        r'("source_path"\s*:\s*)"(?:\\.|[^"\\])*"',
        lambda match: match.group(1) + json.dumps(DOCX_RELATIVE), text, count=1,
    )
    after = json.loads(updated)
    expected = dict(before, source_path=DOCX_RELATIVE)
    if count != 1 or after != expected:
        raise ValueError(f"Source metadata transformation exceeded its declared field: {name}")
    encoded = updated.encode("utf-8")
    if data.startswith(b"\xef\xbb\xbf"):
        encoded = b"\xef\xbb\xbf" + encoded
    return encoded, ["source_path changed to repository-relative supplied DOCX location"]


def secret_categories(data: bytes) -> list[str]:
    return [name for name, pattern in SECRET_PATTERNS.items() if pattern.search(data)]


def decode_text(data: bytes) -> str | None:
    if b"\0" in data:
        return None
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return None


def validate_dependencies(files: dict[str, bytes]) -> list[str]:
    """Resolve static source embeds and relative front-end imports before writing."""
    missing: list[str] = []
    for name, data in files.items():
        extension = PurePosixPath(name).suffix.lower()
        if extension not in SOURCE_EXTENSIONS:
            continue
        text = decode_text(data)
        if text is None:
            continue
        if extension == ".rs":
            refs = re.findall(r'include_(?:str|bytes)!\(\s*"([^"\n]+)"\s*\)', text)
            for reference in refs:
                resolved = posixpath.normpath(posixpath.join(posixpath.dirname(name), reference))
                if resolved not in files:
                    missing.append(f"{name} -> {resolved}")
        if name.startswith("product/apps/client/") and extension in {".ts", ".tsx", ".js", ".jsx"}:
            refs = re.findall(r'(?:from\s*|import\s*)[\'\"](\.[^\'\"]+)[\'\"]', text)
            for reference in refs:
                resolved = posixpath.normpath(posixpath.join(posixpath.dirname(name), reference.split("?", 1)[0]))
                alternatives = [resolved] + [resolved + suffix for suffix in (".ts", ".tsx", ".js", ".jsx", ".json", ".css", "/index.ts", "/index.tsx")]
                if not any(path in files for path in alternatives):
                    missing.append(f"{name} -> {resolved}")
    config_name = "product/apps/client/src-tauri/tauri.conf.json"
    if config_name in files:
        config = json.loads(files[config_name])
        for resource in config.get("bundle", {}).get("resources", {}):
            resolved = posixpath.normpath(posixpath.join(posixpath.dirname(config_name), resource))
            if resolved not in files and not any(path.startswith(resolved.rstrip("/") + "/") for path in files):
                missing.append(f"{config_name} resource -> {resolved}")
    return sorted(set(missing))


def prepare(root: Path, allow_missing_reports: bool = False) -> tuple[dict[str, bytes], dict]:
    files: dict[str, bytes] = {}
    included, excluded, issues = [], [], []
    for name in candidates(root):
        reason = exclusion_reason(name)
        if reason:
            excluded.append({"path": name, "reason": reason})
            continue
        source = REPORT_REPLACEMENTS.get(name, name)
        if not (root / source).exists():
            if allow_missing_reports and name in REPORT_REPLACEMENTS:
                issues.append(f"Pending public report: {source}")
                continue
            raise ValueError(f"Required source or public report is missing: {source}")
        path = assert_ordinary_file(root, source)
        original = path.read_bytes()
        if len(original) >= 100 * 1024 * 1024:
            raise ValueError(f"File reaches the GitHub 100 MiB limit: {name}")
        transformed, changes = transform_metadata(name, original)
        categories = secret_categories(transformed)
        if categories:
            raise ValueError(f"Credential pattern detected in {name}: {', '.join(categories)}; values suppressed")
        text = decode_text(transformed)
        if text and MACHINE_PATH.search(text):
            if PurePosixPath(name).suffix.lower() in EXECUTABLE_TEXT:
                reason = "machine-bound executable helper; excluded instead of rewriting executable behavior"
            elif name.startswith(("product/docs/", "docs/")) or PurePosixPath(name).suffix.lower() == ".md":
                reason = "historical document with local machine paths"
            else:
                raise ValueError(f"Machine-specific location remains in required source/data: {name}; manual review needed")
            excluded.append({"path": name, "reason": reason})
            continue
        if source != name:
            changes.append("replaced local historical report with current public release report")
        files[name] = transformed
        included.append({"path": name, "source": source, "bytes": len(transformed),
                         "source_sha256": sha256(original), "export_sha256": sha256(transformed),
                         "transformations": changes})
    missing = validate_dependencies(files)
    if missing:
        raise ValueError("Export would break static source dependencies:\n" + "\n".join(missing))
    manifest = {"format": 1, "generated_at": datetime.now(timezone.utc).isoformat(),
                "source_commit": subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip(),
                "source_content_basis": "Working-tree bytes, including reviewed uncommitted changes; file hashes are authoritative.",
                "source_has_worktree_changes": bool(subprocess.check_output(["git", "-C", str(root), "status", "--porcelain"], text=True).strip()),
                "source_history_included": False, "source_untouched": True,
                "scope": "Current source plus explicitly allowed public documentation; authorized supplied notes and recipes included.",
                "credential_scan": "No configured strong credential pattern found; not a general security guarantee.",
                "static_dependency_check": "passed", "included_count": len(included),
                "excluded_count": len(excluded), "bytes": sum(len(data) for data in files.values()),
                "pending": issues, "included": included, "excluded": excluded}
    return files, manifest


def export(root: Path, destination: Path) -> dict:
    parent = destination.parent.resolve(strict=True)
    destination = parent / destination.name
    manifest_path = parent / (destination.name + "-export.json")
    if destination.name in {"", ".", ".."} or destination.exists() or destination.is_symlink():
        raise ValueError("Destination must be a new, nonexisting directory")
    if destination.is_relative_to(root.resolve()) or root.resolve().is_relative_to(destination):
        raise ValueError("Export destination must be separate from the source checkout")
    if manifest_path.exists() or manifest_path.is_symlink():
        raise ValueError("Export manifest already exists; choose a fresh destination")
    files, manifest = prepare(root)
    destination.mkdir()
    for name, data in files.items():
        output = destination.joinpath(*PurePosixPath(name).parts)
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open("xb") as stream:
            stream.write(data)
        if sha256(output.read_bytes()) != sha256(data):
            raise OSError(f"Written-file verification failed: {name}")
    manifest.update({"destination": str(destination), "written_file_hashes_verified": True})
    with manifest_path.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(manifest, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    return {"destination": str(destination), "manifest": str(manifest_path),
            "files": len(files), "bytes": manifest["bytes"], "excluded": manifest["excluded_count"]}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--destination", type=Path, help="New destination outside this checkout; parent must exist")
    mode.add_argument("--plan", action="store_true", help="Read-only inventory; no destination or manifest is created")
    args = parser.parse_args()
    if args.plan:
        _, manifest = prepare(ROOT, allow_missing_reports=True)
        print(json.dumps({key: manifest[key] for key in ("included_count", "excluded_count", "bytes", "pending", "excluded")}, ensure_ascii=False, indent=2))
    else:
        print(json.dumps(export(ROOT, args.destination), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
