#!/usr/bin/env python3
"""Build + sign the BAA Calendar Shortcut (requires macOS `shortcuts sign`)."""
from __future__ import annotations

import os
import plistlib
import subprocess
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "src-tauri" / "assets" / "shortcuts"
INV = "\ufffc"  # magic-variable placeholder used by Shortcuts


def action_output(uuid_str: str, name: str = "Content") -> dict:
    return {
        "Value": {
            "OutputName": name,
            "OutputUUID": uuid_str,
            "Type": "ActionOutput",
        },
        "WFSerializationType": "WFTextTokenAttachment",
    }


def text_token(string: str, attachments: dict | None = None) -> dict:
    return {
        "Value": {
            "string": string,
            "attachmentsByRange": attachments or {},
        },
        "WFSerializationType": "WFTextTokenString",
    }


def ext_input() -> dict:
    return {
        "Value": {"Type": "ExtensionInput"},
        "WFSerializationType": "WFTextTokenAttachment",
    }


def var_repeat_item() -> dict:
    return {
        "Value": {"Type": "Variable", "VariableName": "Repeat Item"},
        "WFSerializationType": "WFTextTokenAttachment",
    }


def build() -> dict:
    U_COMMENT = str(uuid.uuid4()).upper()
    U_URL = str(uuid.uuid4()).upper()
    U_DOWNLOAD = str(uuid.uuid4()).upper()
    U_DICT = str(uuid.uuid4()).upper()
    U_EVENTS = str(uuid.uuid4()).upper()
    U_COUNT = str(uuid.uuid4()).upper()
    U_REPEAT = str(uuid.uuid4()).upper()
    U_TITLE = str(uuid.uuid4()).upper()
    U_DATE = str(uuid.uuid4()).upper()
    U_TIME = str(uuid.uuid4()).upper()
    U_STARTTEXT = str(uuid.uuid4()).upper()
    U_STARTDATE = str(uuid.uuid4()).upper()
    U_ADDEVENT = str(uuid.uuid4()).upper()
    U_ENDREPEAT = str(uuid.uuid4()).upper()
    U_ALERT = str(uuid.uuid4()).upper()
    GROUP = str(uuid.uuid4()).upper()

    actions = [
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.comment",
            "WFWorkflowActionParameters": {
                "UUID": U_COMMENT,
                "WFCommentActionText": (
                    "BAA Calendar — marks Mac lightstick schedule on iPhone Calendar.\n"
                    "Input: schedule API URL from BAA Link iPhone (same Wi‑Fi).\n"
                    "Example: http://192.168.x.x:17832/api/schedule?token=XXXX"
                ),
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.url",
            "WFWorkflowActionParameters": {
                "UUID": U_URL,
                "WFURLActionURL": ext_input(),
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
            "WFWorkflowActionParameters": {
                "UUID": U_DOWNLOAD,
                "Advanced": False,
                "ShowHeaders": False,
                "WFHTTPMethod": "GET",
                "WFURL": action_output(U_URL, "URL"),
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.detect.dictionary",
            "WFWorkflowActionParameters": {
                "UUID": U_DICT,
                "WFInput": action_output(U_DOWNLOAD, "Contents of URL"),
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.getvalueforkey",
            "WFWorkflowActionParameters": {
                "UUID": U_EVENTS,
                "WFDictionaryKey": "events",
                "WFInput": action_output(U_DICT, "Dictionary"),
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.count",
            "WFWorkflowActionParameters": {
                "UUID": U_COUNT,
                "Input": action_output(U_EVENTS, "Dictionary Value"),
                "WFCountType": "Items",
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.repeat.each",
            "WFWorkflowActionParameters": {
                "UUID": U_REPEAT,
                "GroupingIdentifier": GROUP,
                "WFControlFlowMode": 0,
                "WFInput": action_output(U_EVENTS, "Dictionary Value"),
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.getvalueforkey",
            "WFWorkflowActionParameters": {
                "UUID": U_TITLE,
                "WFDictionaryKey": "title",
                "WFInput": var_repeat_item(),
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.getvalueforkey",
            "WFWorkflowActionParameters": {
                "UUID": U_DATE,
                "WFDictionaryKey": "date",
                "WFInput": var_repeat_item(),
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.getvalueforkey",
            "WFWorkflowActionParameters": {
                "UUID": U_TIME,
                "WFDictionaryKey": "time",
                "WFInput": var_repeat_item(),
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.gettext",
            "WFWorkflowActionParameters": {
                "UUID": U_STARTTEXT,
                "WFTextActionText": text_token(
                    f"{INV} {INV}",
                    {
                        "{0, 1}": {
                            "Type": "ActionOutput",
                            "OutputName": "Dictionary Value",
                            "OutputUUID": U_DATE,
                        },
                        "{2, 1}": {
                            "Type": "ActionOutput",
                            "OutputName": "Dictionary Value",
                            "OutputUUID": U_TIME,
                        },
                    },
                ),
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.detect.date",
            "WFWorkflowActionParameters": {
                "UUID": U_STARTDATE,
                "WFDateActionDate": action_output(U_STARTTEXT, "Text"),
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.addnewevent",
            "WFWorkflowActionParameters": {
                "UUID": U_ADDEVENT,
                "WFCalendarItemTitle": action_output(U_TITLE, "Dictionary Value"),
                "WFCalendarItemStartDate": action_output(U_STARTDATE, "Date"),
                "WFCalendarItemAllDay": False,
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.repeat.each",
            "WFWorkflowActionParameters": {
                "UUID": U_ENDREPEAT,
                "GroupingIdentifier": GROUP,
                "WFControlFlowMode": 2,
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.notification",
            "WFWorkflowActionParameters": {
                "UUID": U_ALERT,
                "WFNotificationActionTitle": "BAA Calendar",
                "WFNotificationActionBody": text_token(
                    f"Added {INV} events from your lightstick",
                    {
                        "{6, 1}": {
                            "Type": "ActionOutput",
                            "OutputName": "Count",
                            "OutputUUID": U_COUNT,
                        },
                    },
                ),
            },
        },
    ]

    return {
        "WFWorkflowActions": actions,
        "WFWorkflowClientRelease": "3.0",
        "WFWorkflowClientVersion": "2605.0.5",
        "WFWorkflowHasOutputFallback": False,
        "WFWorkflowHasShortcutInputVariables": True,
        "WFWorkflowIcon": {
            "WFWorkflowIconGlyphNumber": 59769,
            "WFWorkflowIconStartColor": 431817727,
        },
        "WFWorkflowImportQuestions": [],
        "WFWorkflowInputContentItemClasses": [
            "WFStringContentItem",
            "WFURLContentItem",
        ],
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowOutputContentItemClasses": [],
        "WFWorkflowTypes": [],
        "WFWorkflowName": "BAA Calendar",
    }


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    unsigned = OUT_DIR / "BAA-Calendar-unsigned.shortcut"
    signed = OUT_DIR / "BAA-Calendar.shortcut"
    with unsigned.open("wb") as f:
        plistlib.dump(build(), f, fmt=plistlib.FMT_BINARY)
    print(f"wrote {unsigned} ({unsigned.stat().st_size} bytes)")

    r = subprocess.run(
        [
            "shortcuts",
            "sign",
            "--mode",
            "anyone",
            "--input",
            str(unsigned),
            "--output",
            str(signed),
        ],
        capture_output=True,
        text=True,
    )
    if r.returncode != 0 and not signed.exists():
        print(r.stderr or r.stdout, file=sys.stderr)
        print("signing failed — unsigned file kept", file=sys.stderr)
        return 1
    print(f"signed {signed} ({signed.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
