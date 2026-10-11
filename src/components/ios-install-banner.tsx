"use client";

import { useSyncExternalStore } from "react";

const DISMISSED_KEY = "koirakartta-ios-install-dismissed";
const INSTALL_STATE_EVENT = "koirakartta-install-state-change";

function shouldShowInstallBanner(): boolean {
  const userAgent = navigator.userAgent;
  const isIOS =
    /iPhone|iPad|iPod/i.test(userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isSafari =
    /Safari/i.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(userAgent);
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

  return isIOS && isSafari && !isStandalone &&
    window.localStorage.getItem(DISMISSED_KEY) !== "true";
}

function subscribe(callback: () => void): () => void {
  window.addEventListener(INSTALL_STATE_EVENT, callback);
  window.addEventListener("pageshow", callback);
  return () => {
    window.removeEventListener(INSTALL_STATE_EVENT, callback);
    window.removeEventListener("pageshow", callback);
  };
}

function getServerSnapshot(): boolean {
  return false;
}

export function IOSInstallBanner() {
  const isVisible = useSyncExternalStore(
    subscribe,
    shouldShowInstallBanner,
    getServerSnapshot,
  );

  if (!isVisible) {
    return null;
  }

  function dismissBanner() {
    window.localStorage.setItem(DISMISSED_KEY, "true");
    window.dispatchEvent(new Event(INSTALL_STATE_EVENT));
  }

  return (
    <aside aria-label="Asenna Koirakartta" className="ios-install-banner">
      <div>
        <p>Lisää Koirakartta kotinäytölle</p>
        <span>Napauta Jaa ja valitse Lisää kotinäytölle.</span>
      </div>
      <button
        aria-label="Sulje asennusohje"
        className="ios-install-dismiss"
        onClick={dismissBanner}
        type="button"
      >
        <span aria-hidden="true">×</span>
      </button>
    </aside>
  );
}