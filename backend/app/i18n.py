"""İstek bazlı dil seçimi. Arayüz her istekte X-Lang başlığı gönderir (tr | en).

Sunucuda üretilen metinler L("Türkçe", "English") ile yazılır; o anki isteğin diline göre biri döner.
Zamanlayıcı gibi istek dışı kod varsayılan olarak Türkçe çalışır; bu yüzden kalıcı olarak saklanan
alanlarda metin yerine kod kullanılır (ör. olağandışı işlemde 'buy' / 'sell' / 'mid').
"""
from __future__ import annotations

from contextvars import ContextVar

lang_var: ContextVar[str] = ContextVar("lang", default="tr")


def L(tr: str, en: str) -> str:
    return en if lang_var.get() == "en" else tr


def set_lang(value: str | None) -> None:
    lang_var.set("en" if (value or "").lower().startswith("en") else "tr")
