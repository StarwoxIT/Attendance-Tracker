"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

// next-themes injects an inline <script> to set the theme before first paint. It
// only needs to run from the server-rendered HTML; on the client, React 19.2 warns
// about rendering <script> tags, so it's re-typed as inert JSON there.
const scriptProps = typeof window === "undefined" ? undefined : ({ type: "application/json" } as const);

export function ThemeProvider(props: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props} scriptProps={scriptProps} />;
}
