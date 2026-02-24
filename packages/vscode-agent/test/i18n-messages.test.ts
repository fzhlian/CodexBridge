import { afterEach, describe, expect, it } from "vitest";
import { resetRuntimeLocaleOverride, syncRuntimeLocaleFromReplyText, t } from "../src/i18n/messages.js";

const originalUiLocale = process.env.CODEXBRIDGE_UI_LOCALE;
const originalUiLocaleMode = process.env.CODEXBRIDGE_UI_LOCALE_MODE;
const originalVscodeNlsConfig = process.env.VSCODE_NLS_CONFIG;
const originalLang = process.env.LANG;

function restoreEnv(): void {
  if (originalUiLocale === undefined) {
    delete process.env.CODEXBRIDGE_UI_LOCALE;
  } else {
    process.env.CODEXBRIDGE_UI_LOCALE = originalUiLocale;
  }
  if (originalUiLocaleMode === undefined) {
    delete process.env.CODEXBRIDGE_UI_LOCALE_MODE;
  } else {
    process.env.CODEXBRIDGE_UI_LOCALE_MODE = originalUiLocaleMode;
  }
  if (originalVscodeNlsConfig === undefined) {
    delete process.env.VSCODE_NLS_CONFIG;
  } else {
    process.env.VSCODE_NLS_CONFIG = originalVscodeNlsConfig;
  }
  if (originalLang === undefined) {
    delete process.env.LANG;
  } else {
    process.env.LANG = originalLang;
  }
}

describe("runtime locale override", () => {
  afterEach(() => {
    resetRuntimeLocaleOverride();
    restoreEnv();
  });

  it("follows codex reply language in auto mode", () => {
    process.env.CODEXBRIDGE_UI_LOCALE = "en";
    process.env.CODEXBRIDGE_UI_LOCALE_MODE = "auto";
    delete process.env.VSCODE_NLS_CONFIG;
    delete process.env.LANG;
    resetRuntimeLocaleOverride();

    const english = t("chat.warn.emptyMessage");
    expect(english).toBe("Cannot send an empty message.");

    syncRuntimeLocaleFromReplyText("\u8BF7\u5148\u68C0\u67E5\u8FD9\u4E2A\u6587\u4EF6\u3002");
    expect(t("chat.warn.emptyMessage")).not.toBe(english);

    syncRuntimeLocaleFromReplyText("Please check this file first.");
    expect(t("chat.warn.emptyMessage")).toBe(english);
  });

  it("does not override fixed ui locale", () => {
    process.env.CODEXBRIDGE_UI_LOCALE = "en";
    process.env.CODEXBRIDGE_UI_LOCALE_MODE = "fixed";
    delete process.env.VSCODE_NLS_CONFIG;
    delete process.env.LANG;
    resetRuntimeLocaleOverride();

    const english = t("chat.warn.emptyMessage");
    syncRuntimeLocaleFromReplyText("\u8BF7\u5148\u68C0\u67E5\u8FD9\u4E2A\u6587\u4EF6\u3002");

    expect(t("chat.warn.emptyMessage")).toBe(english);
  });
});
