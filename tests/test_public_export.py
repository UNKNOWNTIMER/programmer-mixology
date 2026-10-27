"""Privacy and byte-preservation contracts for the public-source exporter."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("export_public", ROOT / "scripts" / "export_public.py")
EXPORT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EXPORT)


class PublicExportTests(unittest.TestCase):
    def test_runtime_data_is_excluded_but_authorized_original_notes_are_not(self):
        for path in ["product/evidence/run.json", "product/.local-preview/pixelmix.sqlite",
                     "product/apps/client/node_modules/a/package.json", "product/target/release/app.exe",
                     "list/drink.timermix", ".env.production", "product/.tools/cargo/config"]:
            self.assertIsNotNone(EXPORT.exclusion_reason(path), path)
        for path in ["product/data/dlc/xiaodong/source.docx", "product/data/dlc/xiaodong/catalog.json",
                     "product/data/personal/zhenglin-soup/source.txt", "product/apps/client/public/fonts/OFL.txt",
                     "product/tests/fixtures/taste-golden.json"]:
            self.assertIsNone(EXPORT.exclusion_reason(path), path)

    def test_metadata_rewrite_changes_only_source_path(self):
        machine_path = "C:" + "\\Users\\" + "example\\Desktop\\notes.docx"
        source = {"source_path": machine_path, "source_sha256": "a" * 64,
                  "content": {"recipe": "author supplied notes", "dose": 45}}
        raw = json.dumps(source, ensure_ascii=False, indent=2).encode()
        transformed, changes = EXPORT.transform_metadata("product/data/dlc/xiaodong/extracted.json", raw)
        self.assertEqual(json.loads(transformed), dict(source, source_path=EXPORT.DOCX_RELATIVE))
        self.assertEqual(len(changes), 1)
        self.assertEqual(EXPORT.transform_metadata("product/data/dlc/xiaodong/catalog.json", raw), (raw, []))

    def test_source_documents_and_immutable_recipe_facts_keep_original_bytes(self):
        for path in ["product/data/dlc/xiaodong/source.docx", "data/recipes.json",
                     "product/apps/client/public/seed/recipes.json",
                     "product/data/personal/zhenglin-soup/recipe.json"]:
            raw = b"original bytes\r\n\x00"
            self.assertEqual(EXPORT.transform_metadata(path, raw), (raw, []))

    def test_credentials_are_flagged_by_category_without_returning_secret(self):
        token = b"ghp" + b"_" + b"a" * 40
        self.assertEqual(EXPORT.secret_categories(token), ["github_token"])
        self.assertEqual(EXPORT.secret_categories(b"not a credential"), [])

    def test_relative_path_and_reparse_guards(self):
        for bad in ["../private", "/absolute", "folder/../private", "C:relative", "folder\\file", ".", "folder//file", "folder/./file"]:
            with self.assertRaises(ValueError):
                EXPORT.safe_relative(bad)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "source.txt").write_text("ok")
            self.assertEqual(EXPORT.assert_ordinary_file(root, "source.txt"), root / "source.txt")

    def test_compile_time_embeds_must_exist(self):
        files = {"product/src/lib.rs": b'const DATA: &str = include_str!("../data/catalog.json");'}
        self.assertEqual(EXPORT.validate_dependencies(files), ["product/src/lib.rs -> product/data/catalog.json"])
        files["product/data/catalog.json"] = b"{}"
        self.assertEqual(EXPORT.validate_dependencies(files), [])

    def test_imported_typescript_data_must_exist(self):
        files = {"product/apps/client/src/a.ts": b"import records from './records.json';"}
        self.assertEqual(len(EXPORT.validate_dependencies(files)), 1)
        files["product/apps/client/src/records.json"] = b"[]"
        self.assertEqual(EXPORT.validate_dependencies(files), [])

    def test_existing_destination_is_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            destination = Path(temp) / "existing"
            destination.mkdir()
            marker = destination / "keep.txt"
            marker.write_text("user data")
            with self.assertRaises(ValueError):
                EXPORT.export(ROOT, destination)
            self.assertEqual(marker.read_text(), "user data")


if __name__ == "__main__":
    unittest.main()
