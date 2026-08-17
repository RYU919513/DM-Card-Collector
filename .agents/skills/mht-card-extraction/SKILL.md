---
name: mht-card-extraction
description: Use for extracting official Duel Masters card IDs, detail URLs, image URLs, and embedded original images from saved MHT/MHTML card-search pages.
---

# MHT Card Extraction

Use `tools/mht_extract.py` as the deterministic first-line extractor.

## Rules
- Work offline from the supplied MHT/MHTML whenever possible.
- Do not use OCR, image generation, super-resolution that invents detail, or image recompression when embedded original bytes exist.
- Preserve embedded image bytes exactly and record SHA-256.
- Determine saved extension from MIME/content type; do not trust a `.jpg` URL because Chrome MHT may contain WebP bytes.
- Extract official `/card/detail/?id=...` links and retain the official card ID as the primary join key.
- Record source MHT, detail URL, image URL, embedded status, MIME type, output path, SHA-256, and validation flags.
- Flag duplicates, malformed archives, missing images, and count mismatches. Never manufacture missing card data.
- For normal official search pages expect 50 card entries when the caller supplies `--expected-count 50`; do not assume the last page is 50.

## Recommended batch workflow
1. Put source MHT files outside Git.
2. Run the extractor into a separate output directory.
3. Use `--expected-count 50 --require-images` for full pages after all lazy-loaded images were displayed before saving.
4. Review `manifest.json`, `manifest.csv`, and the summary/exit status.
5. Re-save only pages with missing embedded images or count errors; do not redownload/rewrite successful images unnecessarily.
6. Join future card-information records to images by official card ID, retaining provenance from both sides.

## Validation
Run `python3 -m unittest discover -s test -p 'test_*.py'` after changing the extractor. Test JPEG/WebP MIME handling, byte preservation, missing images, duplicates, and expected-count behavior.
