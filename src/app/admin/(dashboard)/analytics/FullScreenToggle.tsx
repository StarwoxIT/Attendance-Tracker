"use client";

import { useEffect } from "react";
import { useSidebarVisibility } from "../SidebarVisibilityContext";

/** Hides the shared admin sidebar to give the performance chart the full page
 * width. Scoped to this page: leaving Analytics (unmount) always restores the
 * sidebar, so no other page can be left stuck without navigation. */
export function FullScreenToggle() {
  const { hidden, setHidden } = useSidebarVisibility();

  useEffect(() => {
    return () => setHidden(false);
  }, [setHidden]);

  return (
    <button
      type="button"
      onClick={() => setHidden(!hidden)}
      className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
    >
      {hidden ? (
        <>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 9 4.5 4.5M9 9H5.25M9 9V5.25M15 9l4.5-4.5M15 9h3.75M15 9V5.25M9 15l-4.5 4.5M9 15H5.25M9 15v3.75M15 15l4.5 4.5M15 15h3.75M15 15v3.75" />
          </svg>
          Exit full screen
        </>
      ) : (
        <>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3.75H4.5a.75.75 0 0 0-.75.75v3.75M15.75 3.75h3.75a.75.75 0 0 1 .75.75v3.75M20.25 15.75v3.75a.75.75 0 0 1-.75.75h-3.75M8.25 20.25H4.5a.75.75 0 0 1-.75-.75v-3.75" />
          </svg>
          Full screen
        </>
      )}
    </button>
  );
}
