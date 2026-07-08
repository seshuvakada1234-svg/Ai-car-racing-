/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from "react";

export function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;
  const userAgent = navigator.userAgent || "";
  const isMobileUA = /Mobi|Android|iPhone|iPad|iPod/i.test(userAgent);
  const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  return isMobileUA || (isTouchDevice && window.innerWidth < 1024);
}

export function useDeviceOrientation(): boolean {
  const [isPortrait, setIsPortrait] = useState<boolean>(false);

  useEffect(() => {
    const checkOrientation = () => {
      const isPortraitMedia = window.matchMedia("(orientation: portrait)").matches;
      setIsPortrait(isPortraitMedia);
    };

    // Initial check
    checkOrientation();

    // Listeners for robust updates
    window.addEventListener("resize", checkOrientation);
    window.addEventListener("orientationchange", checkOrientation);

    // Modern matchMedia listener
    const portraitMedia = window.matchMedia("(orientation: portrait)");
    const handleMediaChange = (e: MediaQueryListEvent) => {
      setIsPortrait(e.matches);
    };

    if (portraitMedia.addEventListener) {
      portraitMedia.addEventListener("change", handleMediaChange);
    }

    return () => {
      window.removeEventListener("resize", checkOrientation);
      window.removeEventListener("orientationchange", checkOrientation);
      if (portraitMedia.removeEventListener) {
        portraitMedia.removeEventListener("change", handleMediaChange);
      }
    };
  }, []);

  return isPortrait;
}

export function requestFullscreenAndLockLandscape() {
  const docEl = document.documentElement;

  const tryLock = () => {
    const orientation = window.screen && (window.screen.orientation as any);
    if (orientation && orientation.lock) {
      orientation.lock("landscape").catch((err: any) => {
        console.warn("Screen orientation lock is not supported or was rejected:", err);
      });
    } else if ((window.screen as any).lockOrientation) {
      (window.screen as any).lockOrientation("landscape");
    }
  };

  if (docEl.requestFullscreen) {
    docEl
      .requestFullscreen()
      .then(tryLock)
      .catch(() => {
        // If fullscreen was rejected, still attempt orientation lock
        tryLock();
      });
  } else if ((docEl as any).webkitRequestFullscreen) {
    (docEl as any).webkitRequestFullscreen();
    setTimeout(tryLock, 100);
  } else if ((docEl as any).msRequestFullscreen) {
    (docEl as any).msRequestFullscreen();
    setTimeout(tryLock, 100);
  } else {
    tryLock();
  }
}

interface OrientationForceLandscapeProps {
  children: React.ReactNode;
  isAuthenticated: boolean;
}

export const OrientationForceLandscape: React.FC<OrientationForceLandscapeProps> = ({ children, isAuthenticated }) => {
  const isMobile = isMobileDevice();

  // Automatically request fullscreen and lock landscape orientation on mobile
  useEffect(() => {
    if (isMobile && isAuthenticated) {
      const handleUserGesture = () => {
        requestFullscreenAndLockLandscape();
      };

      // Trigger locking immediately on active
      requestFullscreenAndLockLandscape();

      // Lock on initial clicks or touches to be responsive
      window.addEventListener("click", handleUserGesture, { passive: true });
      window.addEventListener("touchstart", handleUserGesture, { passive: true });

      return () => {
        window.removeEventListener("click", handleUserGesture);
        window.removeEventListener("touchstart", handleUserGesture);
      };
    }
  }, [isMobile, isAuthenticated]);

  // Keep height/scrolling locked on body to prevent bounce and overflow
  useEffect(() => {
    if (isMobile && isAuthenticated) {
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
      document.documentElement.style.height = "100dvh";
      document.body.style.height = "100dvh";
      document.documentElement.style.width = "100vw";
      document.body.style.width = "100vw";
    } else {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
      document.documentElement.style.height = "";
      document.body.style.height = "";
      document.documentElement.style.width = "";
      document.body.style.width = "";
    }

    return () => {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
      document.documentElement.style.height = "";
      document.body.style.height = "";
      document.documentElement.style.width = "";
      document.body.style.width = "";
    };
  }, [isMobile, isAuthenticated]);

  // Render the children transparently. No portrait warnings, rotated HTML scale or overlays!
  return <>{children}</>;
};
