import importlib.util
import tempfile
import unittest
from email.message import EmailMessage
from email import policy
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "tools" / "mht_extract.py"
spec = importlib.util.spec_from_file_location("mht_extract", MODULE_PATH)
mht_extract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mht_extract)


def make_mht(path: Path, include_second_image: bool = True) -> tuple[bytes, bytes]:
    jpg = b"\xff\xd8\xff\xe0fixture-jpeg\xff\xd9"
    webp = b"RIFF\x10\x00\x00\x00WEBPVP8 fixture"
    html = """<!doctype html><html><body>
    <a href="https://dm.takaratomy.co.jp/card/detail/?id=dm-test-001">
      <img src="https://dm.takaratomy.co.jp/wp-content/card/cardthumb/a.jpg">
    </a>
    <a href="/card/detail/?id=dm-test-002">
      <img src="https://dm.takaratomy.co.jp/wp-content/card/cardthumb/b.jpg?cache=1">
    </a>
    </body></html>"""

    root = EmailMessage(policy=policy.default)
    root["Subject"] = "fixture"
    root.make_related()

    page = EmailMessage(policy=policy.default)
    page.set_content(html, subtype="html", charset="utf-8")
    page["Content-Location"] = "https://dm.takaratomy.co.jp/card/"
    root.attach(page)

    image1 = EmailMessage(policy=policy.default)
    image1.set_content(jpg, maintype="image", subtype="jpeg", cte="base64")
    image1["Content-Location"] = "https://dm.takaratomy.co.jp/wp-content/card/cardthumb/a.jpg"
    root.attach(image1)

    if include_second_image:
        image2 = EmailMessage(policy=policy.default)
        image2.set_content(webp, maintype="image", subtype="webp", cte="base64")
        image2["Content-Location"] = "https://dm.takaratomy.co.jp/wp-content/card/cardthumb/b.jpg"
        root.attach(image2)

    path.write_bytes(root.as_bytes())
    return jpg, webp


class MhtExtractTests(unittest.TestCase):
    def test_preserves_original_bytes_and_uses_mime_extension(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "page.mht"
            output = root / "out"
            jpg, webp = make_mht(source)

            records, errors = mht_extract.extract([source], output, expected_count=2, require_images=True)

            self.assertEqual(errors, [])
            self.assertEqual([r.card_id for r in records], ["dm-test-001", "dm-test-002"])
            self.assertTrue(all(r.embedded for r in records))
            self.assertEqual(records[0].mime_type, "image/jpeg")
            self.assertEqual(records[1].mime_type, "image/webp")
            self.assertTrue(records[0].output_file.endswith(".jpg"))
            self.assertTrue(records[1].output_file.endswith(".webp"))
            self.assertEqual((output / records[0].output_file).read_bytes(), jpg)
            self.assertEqual((output / records[1].output_file).read_bytes(), webp)

    def test_require_images_reports_missing_embedded_image(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "page.mht"
            output = root / "out"
            make_mht(source, include_second_image=False)

            records, errors = mht_extract.extract([source], output, expected_count=2, require_images=True)

            self.assertEqual(len(records), 2)
            self.assertEqual(sum(r.embedded for r in records), 1)
            self.assertTrue(any("dm-test-002" in error and "not embedded" in error for error in errors))
            self.assertIn("image-not-embedded", records[1].validation)

    def test_expected_count_mismatch_is_validation_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "page.mht"
            output = root / "out"
            make_mht(source)

            _, errors = mht_extract.extract([source], output, expected_count=50, require_images=False)

            self.assertTrue(any("expected 50 cards, found 2" in error for error in errors))

    def test_spoofed_hostname_is_rejected(self):
        spoof = "https://dm.takaratomy.co.jp.example.com/card/detail/?id=fake"
        self.assertEqual(mht_extract.card_id_from_detail_url(spoof), "")


if __name__ == "__main__":
    unittest.main()
