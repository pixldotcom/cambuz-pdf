#!/usr/bin/env python3
"""Cambuz PDF Reader — Phase 5 encrypted fixtures.

pdf-lib cannot write encrypted PDFs, so the password-protected test fixtures
are produced here with pypdf. Run the Node generator first — it writes the
plain `secure-source.pdf` this script encrypts:

    node scripts/create-secure-samples.js && python3 scripts/create-secure-samples.py
    (or: npm run samples:secure)

Requires: pip install pypdf

Fixtures produced (all derived from scripts/fixtures/secure-source.pdf):

  secure-open-password.pdf     user password "cambuz", every permission granted
  secure-no-print.pdf          user password "cambuz", printing denied
  secure-locked.pdf            user password "cambuz", printing, copying,
                               editing, form filling and assembly denied
  secure-permissions-only.pdf  no user password, printing and copying denied
                               (opens without a prompt, restrictions still apply)

The passwords are test fixtures, never real secrets.
"""

import os
import sys

try:
    from pypdf import PdfReader, PdfWriter
    from pypdf.constants import UserAccessPermissions as UAP
except ImportError:
    print("ERROR: pypdf is required: pip install pypdf", file=sys.stderr)
    sys.exit(1)

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES_DIR = os.path.join(HERE, "fixtures")
SOURCE = os.path.join(FIXTURES_DIR, "secure-source.pdf")
USER_PASSWORD = "cambuz"
OWNER_PASSWORD = "owner-secret"

ALL = int(UAP.PRINT | UAP.MODIFY | UAP.EXTRACT | UAP.EXTRACT_TEXT_AND_GRAPHICS
          | UAP.ADD_OR_MODIFY | UAP.FILL_FORM_FIELDS | UAP.ASSEMBLE_DOC
          | UAP.PRINT_TO_REPRESENTATION)

# Every permission except printing (and high-quality printing).
NO_PRINT = ALL & ~int(UAP.PRINT) & ~int(UAP.PRINT_TO_REPRESENTATION)

# Nothing granted: no printing, no copying, no editing, no filling, no assembly.
# (The reader must treat an empty permission list as "everything denied".)
LOCKED = 0

# No password prompt, but printing and copying are denied.
PERMISSIONS_ONLY = (ALL & ~int(UAP.PRINT) & ~int(UAP.PRINT_TO_REPRESENTATION)
                    & ~int(UAP.EXTRACT) & ~int(UAP.EXTRACT_TEXT_AND_GRAPHICS))

FIXTURES = [
    ("secure-open-password.pdf", USER_PASSWORD, ALL,
     "user password 'cambuz', all permissions granted"),
    ("secure-no-print.pdf", USER_PASSWORD, NO_PRINT,
     "user password 'cambuz', printing denied"),
    ("secure-locked.pdf", USER_PASSWORD, LOCKED,
     "user password 'cambuz', printing/copying/editing/filling denied"),
    ("secure-permissions-only.pdf", "", PERMISSIONS_ONLY,
     "opens without a password, printing and copying denied"),
]


def build(name, user_password, permissions_flag, description):
    writer = PdfWriter(clone_from=PdfReader(SOURCE))
    writer.encrypt(
        user_password=user_password,
        owner_password=OWNER_PASSWORD,
        use_128bit=True,
        permissions_flag=permissions_flag,
    )
    target = os.path.join(FIXTURES_DIR, name)
    with open(target, "wb") as handle:
        writer.write(handle)
    size = os.path.getsize(target)
    print(f"Created: scripts/fixtures/{name} ({size} bytes) — {description}")


def main():
    if not os.path.exists(SOURCE):
        print(
            f"ERROR: missing {SOURCE}\n"
            "Run `node scripts/create-secure-samples.js` first.",
            file=sys.stderr,
        )
        sys.exit(1)

    print("Generating Phase 5 encrypted fixtures...")
    for name, user_password, permissions_flag, description in FIXTURES:
        build(name, user_password, permissions_flag, description)
    print(f"Done! User password for the protected fixtures is '{USER_PASSWORD}'.")


if __name__ == "__main__":
    main()
