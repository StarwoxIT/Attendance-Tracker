import Link from "next/link";
import { pageNumbersFor } from "@/lib/pagination";

interface PaginationProps {
  basePath: string;
  searchParams: Record<string, string | undefined>;
  page: number;
  pageSize: number;
  total: number;
}

/** Shared numbered pager for admin list pages: Previous/Next plus a compact window
 * of page-number links (see pageNumbersFor). Preserves every existing query param
 * (filters, pageSize) except `page` when linking to another page. */
export function Pagination({ basePath, searchParams, page, pageSize, total }: PaginationProps) {
  if (total === 0) return null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function hrefForPage(targetPage: number): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (key === "page" || !value) continue;
      params.set(key, value);
    }
    if (targetPage > 1) params.set("page", String(targetPage));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  const pages = pageNumbersFor(page, totalPages);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      <span>
        Page {page} of {totalPages} ({total} total)
      </span>
      <div className="flex flex-wrap items-center gap-1">
        {page > 1 ? (
          <Link href={hrefForPage(page - 1)} className="rounded-md border border-input px-2 py-1 hover:bg-muted">
            Previous
          </Link>
        ) : (
          <span className="cursor-not-allowed rounded-md border border-input px-2 py-1 opacity-40">Previous</span>
        )}
        {pages.map((p, i) =>
          p === "…" ? (
            <span key={`gap-${i}`} className="px-1.5">
              …
            </span>
          ) : (
            <Link
              key={p}
              href={hrefForPage(p)}
              aria-current={p === page ? "page" : undefined}
              className={`min-w-[2.25rem] rounded-md border px-2 py-1 text-center ${
                p === page ? "border-primary bg-primary text-primary-foreground" : "border-input hover:bg-muted"
              }`}
            >
              {p}
            </Link>
          )
        )}
        {page < totalPages ? (
          <Link href={hrefForPage(page + 1)} className="rounded-md border border-input px-2 py-1 hover:bg-muted">
            Next
          </Link>
        ) : (
          <span className="cursor-not-allowed rounded-md border border-input px-2 py-1 opacity-40">Next</span>
        )}
      </div>
    </div>
  );
}
