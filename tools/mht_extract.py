#!/usr/bin/env python3
"""Offline extractor for Duel Masters card-search MHT/MHTML archives.

The tool never downloads or reconstructs images. If an image is embedded in the
archive, its original bytes are copied unchanged and SHA-256 is recorded.
"""

from __future__ import annotations

import argparse
import csv
import glob
import hashlib
import json
import re
import sys
from dataclasses import asdict, dataclass
from email import policy
from email.parser import BytesParser
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable
from urllib.parse import parse_qs, urljoin, urlsplit, urlunsplit

OFFICIAL_ORIGIN = "https://dm.takaratomy.co.jp/"
CARD_DETAIL_RE = re.compile(r"/card/detail/?(?:\?|$)", re.IGNORECASE)


@dataclass
class CardRef:
    card_id: str
    detail_url: str
    image_url: str


@dataclass
class Record:
    source_mht: str
    position: int
    card_id: str
    detail_url: str
    image_url: str
    embedded: bool
    mime_type: str
    embedded_location: str
    output_file: str
    sha256: str
    duplicate_card_id: bool
    validation: str


def canonical_url(value: str, *, drop_query: bool = False) -> str:
    value = (value or "").strip().strip("<>")
    if not value:
        return ""
    absolute = urljoin(OFFICIAL_ORIGIN, value)
    parts = urlsplit(absolute)
    query = "" if drop_query else parts.query
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path, query, ""))


def is_official_url(value: str) -> bool:
    try:
        host = urlsplit(canonical_url(value)).hostname or ""
    except ValueError:
        return False
    return host == "dm.takaratomy.co.jp" or host.endswith(".dm.takaratomy.co.jp")


def card_id_from_detail_url(href: str) -> str:
    url = canonical_url(href)
    parts = urlsplit(url)
    if not is_official_url(url) or not CARD_DETAIL_RE.search(parts.path + ("?" if parts.query else "")):
        return ""
    values = parse_qs(parts.query).get("id", [])
    return values[0].strip() if values else ""


def first_srcset_url(value: str) -> str:
    if not value:
        return ""
    first = value.split(",", 1)[0].strip()
    return first.split()[0] if first else ""


class CardPageParser(HTMLParser):
    """Collect official card-detail anchors and their first useful image URL."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._active: dict[str, str] | None = None
        self._depth = 0
        self.cards: list[CardRef] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = {k.lower(): (v or "") for k, v in attrs}
        tag = tag.lower()
        if tag == "a":
            href = attr.get("href", "")
            card_id = card_id_from_detail_url(href)
            if card_id:
                self._active = {
                    "card_id": card_id,
                    "detail_url": canonical_url(href),
                    "image_url": "",
                }
                self._depth = 1
                return
            if self._active is not None:
                self._depth += 1
        elif self._active is not None:
            self._depth += 1
            if tag in {"img", "source"} and not self._active["image_url"]:
                candidates = [
                    attr.get("src", ""),
                    attr.get("data-src", ""),
                    attr.get("data-original", ""),
                    attr.get("data-lazy-src", ""),
                    first_srcset_url(attr.get("srcset", "")),
                    first_srcset_url(attr.get("data-srcset", "")),
                ]
                for candidate in candidates:
                    candidate = candidate.strip()
                    if candidate and not candidate.lower().startswith(("data:", "blob:", "javascript:")):
                        self._active["image_url"] = canonical_url(candidate)
                        break

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        # Treat <img /> without accidentally closing the surrounding anchor.
        attr = {k.lower(): (v or "") for k, v in attrs}
        if self._active is not None and tag.lower() in {"img", "source"} and not self._active["image_url"]:
            candidates = [
                attr.get("src", ""), attr.get("data-src", ""), attr.get("data-original", ""),
                attr.get("data-lazy-src", ""), first_srcset_url(attr.get("srcset", "")),
                first_srcset_url(attr.get("data-srcset", "")),
            ]
            for candidate in candidates:
                candidate = candidate.strip()
                if candidate and not candidate.lower().startswith(("data:", "blob:", "javascript:")):
                    self._active["image_url"] = canonical_url(candidate)
                    break

    def handle_endtag(self, tag: str) -> None:
        if self._active is None:
            return
        self._depth -= 1
        if tag.lower() == "a" or self._depth <= 0:
            self.cards.append(CardRef(**self._active))
            self._active = None
            self._depth = 0

    def close(self) -> None:
        super().close()
        if self._active is not None:
            self.cards.append(CardRef(**self._active))
            self._active = None
            self._depth = 0


def decode_html(part) -> str:
    raw = part.get_payload(decode=True) or b""
    charset = part.get_content_charset() or "utf-8"
    try:
        return raw.decode(charset, "replace")
    except LookupError:
        return raw.decode("utf-8", "replace")


def extension_for_mime(mime: str) -> str:
    mime = (mime or "").split(";", 1)[0].strip().lower()
    return {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/webp": ".webp",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/avif": ".avif",
    }.get(mime, ".bin")


def safe_card_id(card_id: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", card_id).strip("._")
    return cleaned or "unknown-card"


def resource_keys(url: str) -> tuple[str, ...]:
    exact = canonical_url(url)
    without_query = canonical_url(url, drop_query=True)
    return tuple(dict.fromkeys(k for k in (exact, without_query) if k))


def embedded_images(message) -> dict[str, tuple[str, bytes, str]]:
    result: dict[str, tuple[str, bytes, str]] = {}
    for part in message.walk():
        if part.get_content_maintype() != "image":
            continue
        payload = part.get_payload(decode=True)
        if payload is None:
            continue
        location = (part.get("Content-Location") or "").strip()
        if not location:
            continue
        value = (part.get_content_type().lower(), payload, canonical_url(location))
        for key in resource_keys(location):
            result.setdefault(key, value)
    return result


def find_embedded(image_url: str, resources: dict[str, tuple[str, bytes, str]]):
    for key in resource_keys(image_url):
        if key in resources:
            return resources[key]
    return None


def unique_output_path(image_dir: Path, card_id: str, ext: str, data: bytes) -> Path:
    base = image_dir / f"{safe_card_id(card_id)}{ext}"
    if not base.exists() or base.read_bytes() == data:
        return base
    digest = hashlib.sha256(data).hexdigest()[:12]
    return image_dir / f"{safe_card_id(card_id)}--{digest}{ext}"


def parse_archive(path: Path) -> tuple[list[CardRef], dict[str, tuple[str, bytes, str]]]:
    message = BytesParser(policy=policy.default).parsebytes(path.read_bytes())
    html_part = next((p for p in message.walk() if p.get_content_type() == "text/html"), None)
    if html_part is None:
        raise ValueError("MHT contains no text/html part")
    parser = CardPageParser()
    parser.feed(decode_html(html_part))
    parser.close()

    # Preserve page order but collapse duplicate anchor renderings of the same card ID.
    seen: set[str] = set()
    cards: list[CardRef] = []
    for card in parser.cards:
        if card.card_id in seen:
            continue
        seen.add(card.card_id)
        cards.append(card)
    return cards, embedded_images(message)


def expand_inputs(values: Iterable[str]) -> list[Path]:
    found: list[Path] = []
    for value in values:
        path = Path(value)
        if path.is_dir():
            found.extend(sorted(path.rglob("*.mht")))
            found.extend(sorted(path.rglob("*.mhtml")))
            continue
        matches = [Path(p) for p in glob.glob(value, recursive=True)]
        if matches:
            found.extend(p for p in matches if p.is_file())
        elif path.is_file():
            found.append(path)
    # Stable de-duplication by resolved path.
    unique: dict[str, Path] = {}
    for path in found:
        unique.setdefault(str(path.resolve()), path)
    return list(unique.values())


def extract(paths: list[Path], output_dir: Path, expected_count: int | None, require_images: bool) -> tuple[list[Record], list[str]]:
    output_dir.mkdir(parents=True, exist_ok=True)
    image_dir = output_dir / "images"
    image_dir.mkdir(parents=True, exist_ok=True)
    records: list[Record] = []
    errors: list[str] = []
    globally_seen: set[str] = set()

    for source in paths:
        try:
            cards, resources = parse_archive(source)
        except Exception as exc:  # Keep batch processing and report archive-level failures.
            errors.append(f"{source.name}: parse error: {exc}")
            continue

        if expected_count is not None and len(cards) != expected_count:
            errors.append(f"{source.name}: expected {expected_count} cards, found {len(cards)}")

        for position, card in enumerate(cards, start=1):
            duplicate = card.card_id in globally_seen
            globally_seen.add(card.card_id)
            match = find_embedded(card.image_url, resources) if card.image_url else None
            mime_type = embedded_location = output_file = sha256 = ""
            validation: list[str] = []
            if duplicate:
                validation.append("duplicate-card-id")
            if not card.image_url:
                validation.append("missing-image-url")

            if match is None:
                if card.image_url:
                    validation.append("image-not-embedded")
                if require_images:
                    errors.append(f"{source.name} #{position} {card.card_id}: image not embedded")
                embedded = False
            else:
                mime_type, data, embedded_location = match
                sha256 = hashlib.sha256(data).hexdigest()
                ext = extension_for_mime(mime_type)
                destination = unique_output_path(image_dir, card.card_id, ext, data)
                destination.write_bytes(data)
                output_file = destination.relative_to(output_dir).as_posix()
                embedded = True
                if ext == ".bin":
                    validation.append("unknown-image-mime")
                    errors.append(f"{source.name} #{position} {card.card_id}: unknown image MIME {mime_type}")

            records.append(Record(
                source_mht=source.name,
                position=position,
                card_id=card.card_id,
                detail_url=card.detail_url,
                image_url=card.image_url,
                embedded=embedded,
                mime_type=mime_type,
                embedded_location=embedded_location,
                output_file=output_file,
                sha256=sha256,
                duplicate_card_id=duplicate,
                validation=";".join(validation) if validation else "ok",
            ))

    return records, errors


def write_manifests(records: list[Record], output_dir: Path) -> None:
    rows = [asdict(record) for record in records]
    (output_dir / "manifest.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    fieldnames = list(Record.__dataclass_fields__)
    with (output_dir / "manifest.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Extract Duel Masters card refs and embedded original images from MHT/MHTML files.")
    parser.add_argument("inputs", nargs="+", help="MHT/MHTML files, directories, or glob patterns")
    parser.add_argument("-o", "--output", required=True, help="output directory")
    parser.add_argument("--expected-count", type=int, default=None, help="expected unique card count per archive")
    parser.add_argument("--require-images", action="store_true", help="return non-zero if any referenced card image is not embedded")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    paths = expand_inputs(args.inputs)
    if not paths:
        print("error: no MHT/MHTML input files found", file=sys.stderr)
        return 1

    output_dir = Path(args.output)
    records, errors = extract(paths, output_dir, args.expected_count, args.require_images)
    write_manifests(records, output_dir)

    embedded = sum(record.embedded for record in records)
    missing = len(records) - embedded
    duplicates = sum(record.duplicate_card_id for record in records)
    print(f"archives={len(paths)} cards={len(records)} embedded={embedded} missing={missing} duplicate_ids={duplicates}")
    print(f"manifest_json={output_dir / 'manifest.json'}")
    print(f"manifest_csv={output_dir / 'manifest.csv'}")
    if errors:
        for error in errors:
            print(f"validation-error: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
