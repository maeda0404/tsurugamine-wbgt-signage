#!/usr/bin/env python3

import csv
import io
import json
import os
import tempfile
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

JST = timezone(timedelta(hours=9))
BASE = "https://www.wbgt.env.go.jp"
POINT = "46106"
OUT = Path(__file__).resolve().parents[1] / "data" / "current.json"
MAX_BYTES = 2_000_000
TIMEOUT_SECONDS = 15


def fetch(path, encoding):
    allowed = (
        path == f"/prev15WG/dl/yohou_{POINT}.csv"
        or path.startswith(f"/est15WG/dl/wbgt_{POINT}_")
        or path.startswith("/alert/dl/")
    )
    if not allowed:
        raise ValueError("許可されていない取得先です")

    request = urllib.request.Request(
        BASE + path,
        headers={
            "User-Agent": "tsurugamine-wbgt-signage/1.0",
            "Accept": "text/csv,text/plain;q=0.9",
        },
    )

    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        content_type = (response.headers.get("Content-Type") or "").lower()
        raw = response.read(MAX_BYTES + 1)

        if response.status != 200:
            raise RuntimeError(f"HTTP {response.status}")
        if len(raw) > MAX_BYTES:
            raise RuntimeError("応答サイズ超過")
        if content_type and not any(
            value in content_type
            for value in ("text/csv", "text/plain", "application/octet-stream")
        ):
            raise RuntimeError(f"Content-Type不正: {content_type}")

    text = raw.decode(encoding).lstrip("\ufeff")
    if not text.strip() or "<html" in text.lower():
        raise RuntimeError("CSV本文不正")

    return text


def rows(text):
    return list(csv.reader(io.StringIO(text)))


def main():
    now = datetime.now(JST)
    year = now.strftime("%Y")
    year_month = now.strftime("%Y%m")
    year_month_day = now.strftime("%Y%m%d")

    forecast = fetch(f"/prev15WG/dl/yohou_{POINT}.csv", "ascii")
    forecast_rows = rows(forecast)
    if len(forecast_rows) < 2 or not any(
        row and row[0].strip() == POINT for row in forecast_rows[1:]
    ):
        raise RuntimeError("予測CSV形式不正")

    actual = fetch(
        f"/est15WG/dl/wbgt_{POINT}_{year_month}.csv",
        "ascii",
    )
    actual_rows = rows(actual)
    if (
        not actual_rows
        or actual_rows[0][:2] != ["Date", "Time"]
        or POINT not in actual_rows[0]
    ):
        raise RuntimeError("実況CSV形式不正")

    alerts = []
    warnings = []

    for hour in ("05", "10", "14", "17"):
        try:
            alert = fetch(
                f"/alert/dl/{year}/alert_{year_month_day}_{hour}.csv",
                "utf-8",
            )
            alert_rows = rows(alert)
            has_kanagawa = any(
                len(row) >= 8
                and (row[4].strip() == "神奈川県" or row[5].strip() == "14")
                for row in alert_rows
            )
            if not has_kanagawa:
                raise RuntimeError("アラートCSV形式不正")
            alerts.append(alert)
        except Exception as error:
            warnings.append(f"{hour}:{type(error).__name__}")

    # 日付変更直後など、当日のアラートCSVがまだ無い場合も
    # WBGT予測・実況データの更新は継続する。
    if not alerts:
        warnings.append("当日のアラートCSVはまだ生成されていません")

    payload = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc)
        .isoformat()
        .replace("+00:00", "Z"),
        "sourceHost": "www.wbgt.env.go.jp",
        "pointCode": POINT,
        "partialWarnings": warnings,
        "official": {
            "forecastCsv": forecast,
            "actualCsv": actual,
            "alertCsvs": alerts,
        },
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_path = tempfile.mkstemp(
        prefix="current-",
        suffix=".json",
        dir=OUT.parent,
    )

    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as file:
            json.dump(payload, file, ensure_ascii=False, separators=(",", ":"))
            file.write("\n")
        os.replace(temporary_path, OUT)
    finally:
        if os.path.exists(temporary_path):
            os.unlink(temporary_path)

    print(
        f"updated {OUT}; alerts={len(alerts)}; warnings={len(warnings)}"
    )


if __name__ == "__main__":
    main()
