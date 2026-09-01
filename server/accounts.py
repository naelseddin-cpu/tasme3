"""Frictionless-account helpers: code generation, normalization, hashing.

Per BUILD-PLAN.md "Frictionless accounts" spec: digits-only save code,
no email/phone/password, no PII. Only a SHA-256 hash of the digits is
ever stored — the raw code exists only in the HTTP response at creation
time and in the user's own WhatsApp message to themselves.
"""

from __future__ import annotations

import hashlib
import secrets

CODE_LENGTH = 10

# Arabic-Indic (٠-٩, U+0660-U+0669) and Extended Arabic-Indic / Persian
# (۰-۹, U+06F0-U+06F9) digits, both mapped to Western 0-9 so a user can
# dictate or type their code in either script.
_DIGIT_TRANSLATION = {}
for _i in range(10):
    _DIGIT_TRANSLATION[ord("٠") + _i] = str(_i)  # U+0660..U+0669
    _DIGIT_TRANSLATION[ord("۰") + _i] = str(_i)  # U+06F0..U+06F9


def generate_code_digits() -> str:
    """A random 10-digit code, digits only (~33 bits of entropy — the
    documented, deliberate security posture: fine for non-sensitive
    progress data, rate-limited against guessing)."""
    return "".join(secrets.choice("0123456789") for _ in range(CODE_LENGTH))


def format_code(digits: str) -> str:
    """Dictation-friendly grouping 3-3-4, e.g. '472 851 9036'."""
    return f"{digits[0:3]} {digits[3:6]} {digits[6:10]}"


def normalize_code(raw: str) -> str:
    """Strip spaces/dashes and convert Arabic-Indic digits to Western,
    so a code can be entered in any of those forms. Returns digits only;
    any other stray character is dropped."""
    if raw is None:
        return ""
    translated = raw.translate(_DIGIT_TRANSLATION)
    return "".join(ch for ch in translated if ch.isdigit())


def hash_code(digits: str) -> str:
    return hashlib.sha256(digits.encode("utf-8")).hexdigest()
