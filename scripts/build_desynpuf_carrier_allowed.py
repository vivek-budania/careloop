#!/usr/bin/env python3
"""Rebuild the compact CMS DE-SynPUF carrier allowed-charge extract.

Streams official CMS Linkable 2008–2010 Medicare DE-SynPUF carrier-claim
zips (segments A and B) and writes
``backend/data/desynpuf_carrier_allowed.json``.

The full CMS files are huge and are not committed. Download them into a
cache directory, or pass ``--zip`` for files you already have.

Source of truth for column names is the CMS codebook downloaded with the
public files (Carrier Claims, 142 variables):

- ``CLM_FROM_DT`` — claims start date (year of the line)
- ``HCPCS_CD_1`` … ``HCPCS_CD_13`` — line procedure code
- ``LINE_ALOWD_CHRG_AMT_1`` … ``LINE_ALOWD_CHRG_AMT_13`` — line allowed charge

A line is kept only when the HCPCS code is one this app can price
(``backend/data/mock_fee_schedule.json``, the codes ``infer_service_codes``
emits) and the paired allowed charge is a number greater than zero.
Codes with no such rows are listed and left without dollar figures.
This script never invents amounts.

License: CMS synthetic public use file. Not real patients. Not a current
Medicare fee schedule. Allowed charges were coarsened as part of CMS
disclosure treatment and include beneficiary-paid deductible and coinsurance.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import sys
import urllib.request
import zipfile
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FEE_SCHEDULE_PATH = ROOT / "backend" / "data" / "mock_fee_schedule.json"
OUTPUT_PATH = ROOT / "backend" / "data" / "desynpuf_carrier_allowed.json"

CODEBOOK_URL = "https://www.cms.gov/files/document/de-10-codebook.pdf-0"
CODEBOOK_TITLE = "CMS Linkable 2008–2010 Medicare DE-SynPUF Codebook"
CODEBOOK_UPDATED = "2013-02-20"
USERS_GUIDE_URL = (
    "https://www.cms.gov/research-statistics-data-and-systems/"
    "downloadable-public-use-files/synpufs/downloads/synpuf_dug.pdf"
)
SAMPLE_PAGE = (
    "https://www.cms.gov/data-research/statistics-trends-and-reports/"
    "medicare-claims-synthetic-public-use-files/"
    "cms-2008-2010-data-entrepreneurs-synthetic-public-use-file-de-synpuf/"
    "de10-sample-{sample}"
)
ZIP_URL = (
    "https://downloads.cms.gov/files/"
    "DE1_0_2008_to_2010_Carrier_Claims_Sample_{sample}{segment}.zip"
)
YEARS = ("2008", "2009", "2010")
HCPCS_COLUMNS = [f"HCPCS_CD_{i}" for i in range(1, 14)]
ALLOWED_COLUMNS = [f"LINE_ALOWD_CHRG_AMT_{i}" for i in range(1, 14)]
N_LINES = 13


def _money(value: Decimal) -> float:
    quantized = value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return float(quantized)


def _percentile(sorted_values: list[Decimal], percent: Decimal) -> float:
    """Hyndman–Fan type 7 (NumPy ``percentile`` default).

    Index = (n - 1) * (percent / 100), linearly interpolated, then rounded
    half-up to cents. ``percent`` is 25, 50, or 75.
    """
    n = len(sorted_values)
    if n == 0:
        raise ValueError("percentile of empty data")
    if n == 1:
        return _money(sorted_values[0])
    rank = (Decimal(n - 1) * percent) / Decimal(100)
    low = int(rank)
    high = min(low + 1, n - 1)
    fraction = rank - Decimal(low)
    value = sorted_values[low] + (sorted_values[high] - sorted_values[low]) * fraction
    return _money(value)


def _stats(amounts: list[Decimal]) -> dict:
    ordered = sorted(amounts)
    return {
        "n": len(ordered),
        "p25": _percentile(ordered, Decimal(25)),
        "median": _percentile(ordered, Decimal(50)),
        "p75": _percentile(ordered, Decimal(75)),
    }


def _target_codes() -> list[str]:
    fee = json.loads(FEE_SCHEDULE_PATH.read_text())
    codes = sorted(str(code) for code in fee)
    if not codes:
        raise SystemExit(f"No codes in {FEE_SCHEDULE_PATH}")
    return codes


def _zip_name(sample: int, segment: str) -> str:
    return f"DE1_0_2008_to_2010_Carrier_Claims_Sample_{sample}{segment}.zip"


def _download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    print(f"downloading {url}", flush=True)
    try:
        with urllib.request.urlopen(url, timeout=120) as response, tmp.open("wb") as handle:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                handle.write(chunk)
    except Exception as exc:
        tmp.unlink(missing_ok=True)
        raise SystemExit(
            "Could not download the official CMS DE-SynPUF carrier file.\n"
            f"URL: {url}\n"
            f"Error: {exc}\n"
            "No dollar amounts were invented. Re-run when the CMS file is reachable, "
            "or pass --zip for a file you already downloaded from that URL."
        ) from exc
    tmp.replace(dest)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _resolve_zip(sample: int, segment: str, cache_dir: Path, explicit: dict[str, Path]) -> tuple[Path, str]:
    name = _zip_name(sample, segment)
    if name in explicit:
        path = explicit[name]
        if not path.is_file():
            raise SystemExit(f"Missing --zip file: {path}")
        return path, ZIP_URL.format(sample=sample, segment=segment)
    url = ZIP_URL.format(sample=sample, segment=segment)
    path = cache_dir / name
    if not path.is_file():
        _download(url, path)
    return path, url


def _scan_zip(path: Path, targets: set[str]) -> tuple[dict, dict, int]:
    """Return (positive amounts by code/year, exclusion counters, claim rows)."""
    amounts: dict[str, dict[str, list[Decimal]]] = {code: defaultdict(list) for code in targets}
    excluded = {
        code: {"nonpositive": 0, "blank": 0, "unparseable": 0, "year_outside": 0}
        for code in targets
    }
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != 1:
            raise SystemExit(f"{path.name} expected one CSV member, found {names}")
        csv_name = names[0]
        with archive.open(csv_name) as raw:
            text = io.TextIOWrapper(raw, encoding="utf-8", newline="")
            reader = csv.reader(text)
            header = next(reader)
            if header[2] != "CLM_FROM_DT":
                raise SystemExit(f"{csv_name} column 3 is {header[2]!r}, expected CLM_FROM_DT")
            if header[38:51] != HCPCS_COLUMNS:
                raise SystemExit(f"{csv_name} HCPCS columns do not match the CMS codebook")
            if header[103:116] != ALLOWED_COLUMNS:
                raise SystemExit(
                    f"{csv_name} LINE_ALOWD_CHRG_AMT columns do not match the CMS codebook"
                )
            if len(header) != 142:
                raise SystemExit(f"{csv_name} has {len(header)} columns, codebook says 142")
            claims = 0
            for row in reader:
                claims += 1
                if len(row) < 116:
                    continue
                year = (row[2] or "").strip()[:4]
                for index in range(N_LINES):
                    code = row[38 + index].strip()
                    if code not in targets:
                        continue
                    raw_amount = row[103 + index].strip()
                    if year not in YEARS:
                        excluded[code]["year_outside"] += 1
                        continue
                    if raw_amount == "":
                        excluded[code]["blank"] += 1
                        continue
                    try:
                        amount = Decimal(raw_amount)
                    except Exception:
                        excluded[code]["unparseable"] += 1
                        continue
                    if amount <= 0:
                        excluded[code]["nonpositive"] += 1
                        continue
                    amounts[code][year].append(amount)
                if claims % 500000 == 0:
                    print(f"  {csv_name} {claims} claims", flush=True)
    print(f"done {path.name} claims={claims}", flush=True)
    return amounts, excluded, claims


def build(samples: list[int], cache_dir: Path, explicit_zips: dict[str, Path]) -> dict:
    targets = _target_codes()
    target_set = set(targets)
    combined: dict[str, dict[str, list[Decimal]]] = {code: defaultdict(list) for code in targets}
    excluded = {
        code: {"nonpositive": 0, "blank": 0, "unparseable": 0, "year_outside": 0}
        for code in targets
    }
    files = []
    for sample in samples:
        for segment in ("A", "B"):
            path, url = _resolve_zip(sample, segment, cache_dir, explicit_zips)
            print(f"scanning {path}", flush=True)
            amounts, file_excluded, claims = _scan_zip(path, target_set)
            info = zipfile.ZipFile(path).infolist()[0]
            files.append(
                {
                    "file_name": path.name,
                    "csv_name": info.filename,
                    "url": url,
                    "sample_page": SAMPLE_PAGE.format(sample=sample),
                    "sample": sample,
                    "segment": segment,
                    "zip_bytes": path.stat().st_size,
                    "csv_bytes": info.file_size,
                    "sha256": _sha256(path),
                    "claim_rows": claims,
                }
            )
            for code in targets:
                for year, values in amounts[code].items():
                    combined[code][year].extend(values)
                for key, count in file_excluded[code].items():
                    excluded[code][key] += count

    codes_out = {}
    missing = []
    for code in targets:
        by_year_amounts = combined[code]
        all_amounts = [value for year in YEARS for value in by_year_amounts.get(year, [])]
        if not all_amounts:
            missing.append(code)
            continue
        by_year = {}
        for year in YEARS:
            year_amounts = by_year_amounts.get(year, [])
            if year_amounts:
                by_year[year] = _stats(year_amounts)
            else:
                by_year[year] = {"n": 0}
        codes_out[code] = {
            **_stats(all_amounts),
            "lines_excluded_nonpositive": excluded[code]["nonpositive"],
            "lines_excluded_blank": excluded[code]["blank"],
            "lines_excluded_unparseable": excluded[code]["unparseable"],
            "lines_excluded_year_outside_2008_2010": excluded[code]["year_outside"],
            "by_year": by_year,
        }

    return {
        "metadata": {
            "dataset": "CMS Linkable 2008-2010 Medicare Data Entrepreneurs' Synthetic Public Use File (DE-SynPUF)",
            "file_type": "Carrier Claims (physician/supplier Part B)",
            "license": (
                "Synthetic public use file published by CMS for software development "
                "and research training. No beneficiary in the DE-SynPUF is a real "
                "Medicare patient. These figures are not a current Medicare fee "
                "schedule, not a bill, and not a payment rate. CMS coarsened, "
                "imputed, and suppressed variables, including line allowed charges, "
                "so the file must not be used to infer actual Medicare payments."
            ),
            "source_pages": [SAMPLE_PAGE.format(sample=sample) for sample in samples],
            "dictionary": {
                "title": CODEBOOK_TITLE,
                "url": CODEBOOK_URL,
                "updated": CODEBOOK_UPDATED,
                "users_guide_url": USERS_GUIDE_URL,
                "carrier_variables": 142,
            },
            "years": list(YEARS),
            "year_column": "CLM_FROM_DT",
            "year_rule": (
                "Carrier files store 2008, 2009, and 2010 together. The year is the "
                "calendar year of CLM_FROM_DT (YYYYMMDD)."
            ),
            "columns": {
                "hcpcs": HCPCS_COLUMNS,
                "line_allowed_charge": ALLOWED_COLUMNS,
                "claim_start_date": "CLM_FROM_DT",
            },
            "column_labels": {
                "HCPCS_CD_1_to_13": "DESYNPUF: Line HCFA Common Procedure Coding System 1-13 (codebook variables 39-51)",
                "LINE_ALOWD_CHRG_AMT_1_to_13": "DESYNPUF: Line Allowed Charge Amount 1-13 (codebook variables 104-116)",
                "CLM_FROM_DT": "DESYNPUF: Claims start date (codebook variable 3)",
            },
            "allowed_charge_definition": (
                "Codebook CAR-104-116: the amount of allowed charges for the line "
                "item service on the noninstitutional claim. The amount includes "
                "beneficiary-paid amounts (deductible and coinsurance)."
            ),
            "inclusion_rule": (
                "A claim line is included when HCPCS_CD_n equals a target code, "
                "CLM_FROM_DT falls in 2008, 2009, or 2010, and the paired "
                "LINE_ALOWD_CHRG_AMT_n parses as a number greater than zero. "
                "Zero, blank, and unparseable allowed amounts are counted and excluded. "
                "No rows are fabricated when a code is absent."
            ),
            "allowed_low_high_inputs": (
                "For each code, n is the count of included lines. p25, median, and "
                "p75 are Hyndman-Fan type 7 percentiles of LINE_ALOWD_CHRG_AMT "
                "(index = (n - 1) * p / 100, linear interpolation), rounded half-up "
                "to cents. The same statistics are computed for each year. "
                "allowed_low / allowed_high sent to xAI must be chosen from these "
                "dollar figures (not from n)."
            ),
            "target_codes_from": "backend/data/mock_fee_schedule.json",
            "target_codes": targets,
            "codes_without_rows": missing,
            "files": files,
            "samples_required_note": (
                "CMS splits each carrier sample into segment A and segment B. "
                "Both segments of each requested sample are included."
            ),
        },
        "codes": codes_out,
    }


def _parse_samples(text: str) -> list[int]:
    samples: list[int] = []
    for part in text.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            start, end = part.split("-", 1)
            samples.extend(range(int(start), int(end) + 1))
        else:
            samples.append(int(part))
    if not samples or any(sample < 1 or sample > 20 for sample in samples):
        raise SystemExit("--samples must be CMS sample numbers 1-20")
    return list(dict.fromkeys(samples))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--samples",
        default="1",
        help="CMS sample numbers to read, e.g. 1 or 1-3. Default: 1 (segments A and B).",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=Path("/tmp/cms-desynpuf"),
        help="Where downloaded CMS zips are stored. They are not committed.",
    )
    parser.add_argument(
        "--zip",
        action="append",
        default=[],
        type=Path,
        help="Local CMS zip to use instead of downloading. Match the official file name.",
    )
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    args = parser.parse_args()
    explicit = {path.name: path for path in args.zip}
    artifact = build(_parse_samples(args.samples), args.cache_dir, explicit)
    missing = artifact["metadata"]["codes_without_rows"]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(artifact, indent=2) + "\n")
    print(f"wrote {args.output}", flush=True)
    for code, row in artifact["codes"].items():
        print(
            f"  {code} n={row['n']} p25={row['p25']} median={row['median']} p75={row['p75']}",
            flush=True,
        )
    if missing:
        print(
            "No DE-SynPUF rows for: "
            + ", ".join(missing)
            + ". Those codes were not given invented amounts.",
            file=sys.stderr,
        )
        raise SystemExit(2)


if __name__ == "__main__":
    main()
