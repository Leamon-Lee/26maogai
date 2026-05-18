#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Iterable

from bs4 import BeautifulSoup, NavigableString, Tag


QUIZ_ID = "test_001"
DEFAULT_SCORE = 5

# 题号可能出现在段落中间（例如标题后直接接第 1 题），所以用“任意位置”的模式。
QUESTION_START_RE = re.compile(r"(?<!\d)(\d{1,3})\s*[、,，．.]\s*")

# 允许全角括号，以及“多选 题”这种被拆开的情况。
TYPE_RE = re.compile(r"[（(]\s*(单选\s*题|多选\s*题|判断\s*题)\s*[)）]")

# 选项通常是 A、B、C、D，个别地方会被排版成“B、 xxx C、 yyy”。
OPTION_RE = re.compile(r"(?<!\w)([A-H])\s*[、.．]\s*")

WHITESPACE_RE = re.compile(r"\s+")


def normalize_text(text: str) -> str:
    """Collapse whitespace while keeping punctuation intact."""

    text = text.replace("\xa0", " ")
    return WHITESPACE_RE.sub(" ", text).strip()


def iter_visible_blocks(node: Tag) -> Iterable[str]:
    """
    Yield visible text blocks in document order.

    The source is mainly composed of <p> tags and a few <table> tags. We recurse
    through other containers so that nested structures are still discovered.
    """

    for child in node.children:
        if isinstance(child, NavigableString):
            continue
        if not isinstance(child, Tag):
            continue
        if child.name in {"p", "table"}:
            text = normalize_text(child.get_text(" ", strip=True))
            if text:
                yield text
            continue
        yield from iter_visible_blocks(child)


def question_type_from_marker(marker: str) -> str:
    marker = marker.replace(" ", "")
    if marker == "单选题":
        return "single"
    if marker == "多选题":
        return "multiple"
    return "judge"


def looks_like_standalone_question_block(text: str) -> bool:
    """
    Some questions in the source lose their leading number during conversion.

    These blocks usually begin with a question stem such as "（）。" and still
    carry an explicit question-type marker, so they are safe to treat as a new
    question boundary when no numbered start is present.
    """

    text = normalize_text(text)
    if not text:
        return False

    if QUESTION_START_RE.match(text):
        return True

    if TYPE_RE.search(text) and text[:1] in {"（", "("}:
        return True

    return False


def parse_options(text: str) -> list[dict[str, str]]:
    """
    Parse A/B/C/D options from a chunk of text.

    The input is typically everything after the question type marker, but the
    function is robust enough to handle long, wrapped option lines.
    """

    matches = list(OPTION_RE.finditer(text))
    if not matches:
        return []

    options: list[dict[str, str]] = []
    for idx, match in enumerate(matches):
        key = match.group(1)
        start = match.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        content = normalize_text(text[start:end])
        content = content.lstrip("：:，,。；;").strip()
        if content:
            options.append({"key": key, "content": content})
    return options


def parse_html_to_questions(html_path: Path) -> dict:
    html = html_path.read_text(encoding="utf-8", errors="ignore")
    soup = BeautifulSoup(html, "html.parser")

    body = soup.body or soup
    blocks = [block for block in iter_visible_blocks(body) if block]

    # Split the document into question candidates using numbered starts.
    candidates: list[dict[str, object]] = []
    current: dict[str, object] | None = None

    for block in blocks:
        starts = list(QUESTION_START_RE.finditer(block))
        if starts:
            prefix = block[: starts[0].start()].strip()
            if current is not None and prefix:
                current.setdefault("parts", []).append(prefix)

            for idx, match in enumerate(starts):
                if current is not None:
                    candidates.append(current)

                q_no = int(match.group(1))
                start = match.end()
                end = starts[idx + 1].start() if idx + 1 < len(starts) else len(block)
                segment = block[start:end].strip()
                current = {"source_no": q_no, "parts": [segment] if segment else []}
            continue

        if current is not None:
            current.setdefault("parts", []).append(block)

    if current is not None:
        candidates.append(current)

    source_numbers = [int(candidate["source_no"]) for candidate in candidates if candidate.get("source_no") is not None]
    missing_numbers = [n for n in range(1, 601) if n not in set(source_numbers)]

    parsed_by_source_no: dict[int, dict[str, object]] = {}
    for candidate in candidates:
        source_no = candidate.get("source_no")
        if source_no is None:
            continue

        raw = "\n".join(part for part in candidate.get("parts", []) if part).strip()

        type_match = TYPE_RE.search(raw)
        if type_match:
            q_type = question_type_from_marker(type_match.group(1))
            stem = raw[: type_match.start()]
            option_area = raw[type_match.end() :]
        else:
            # Fallback: if the type marker is malformed or missing, keep the
            # question text and infer the most likely type from options.
            stem = raw
            option_area = raw
            options_probe = parse_options(option_area)
            if options_probe:
                q_type = "multiple" if len(options_probe) > 4 else "single"
            else:
                q_type = "judge"

        stem = normalize_text(stem)
        stem = stem.lstrip("：:，,。；;").strip()
        options = parse_options(option_area) if q_type in {"single", "multiple"} else []

        parsed_by_source_no[int(source_no)] = {
            "id": f"q{int(source_no)}",
            "type": q_type,
            "question": stem,
            "options": options,
            "correct_answers": [],
            "score": DEFAULT_SCORE,
            "explanation": "",
        }

    questions: list[dict[str, object]] = []
    for source_no in range(1, 601):
        question = parsed_by_source_no.get(source_no)
        if question is None:
            question = {
                "id": f"q{source_no}",
                "type": "judge",
                "question": "[空题]",
                "options": [],
                "correct_answers": [],
                "score": DEFAULT_SCORE,
                "explanation": "",
            }
        questions.append(question)

    return {
        "quiz_id": QUIZ_ID,
        "title": html_path.stem,
        "questions": questions,
        "_debug_missing_source_numbers": missing_numbers,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Parse irregular HTML quiz bank into JSON.")
    parser.add_argument(
        "html",
        nargs="?",
        default="《毛概》2026春期末复习自测题库.html",
        help="Input HTML file path",
    )
    parser.add_argument(
        "-o",
        "--output",
        default="data.json",
        help="Output JSON file path",
    )
    args = parser.parse_args()

    html_path = Path(args.html)
    output_path = Path(args.output)

    data = parse_html_to_questions(html_path)
    missing = data.pop("_debug_missing_source_numbers", [])
    if missing:
        print(f"Missing source question numbers: {missing}")
    output_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Parsed {len(data['questions'])} questions -> {output_path}")


if __name__ == "__main__":
    main()
