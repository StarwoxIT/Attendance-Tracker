"use client";

import { createContext, useContext, useState } from "react";

interface SidebarVisibilityValue {
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
}

const SidebarVisibilityContext = createContext<SidebarVisibilityValue | null>(null);

/** Lets any page inside the admin dashboard layout hide the shared sidebar/mobile
 * top bar to reclaim horizontal space (e.g. the Analytics page's full-screen mode). */
export function SidebarVisibilityProvider({ children }: { children: React.ReactNode }) {
  const [hidden, setHidden] = useState(false);
  return <SidebarVisibilityContext.Provider value={{ hidden, setHidden }}>{children}</SidebarVisibilityContext.Provider>;
}

export function useSidebarVisibility(): SidebarVisibilityValue {
  const ctx = useContext(SidebarVisibilityContext);
  if (!ctx) throw new Error("useSidebarVisibility must be used within SidebarVisibilityProvider");
  return ctx;
}
