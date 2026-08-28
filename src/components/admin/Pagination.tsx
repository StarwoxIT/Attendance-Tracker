import Link from "next/link";

export const ADMIN_PAGE_SIZE = 25;

/** Shared Previous/Next pager for admin list pages. Preserves every existing query
 * param (filters, tabs) except `page` when linking to another page. */
export function Pagination({
  basePath,
  searchParams,
  page,
  pageSize,
  total,
}: {
  basePath: string;
  searchParams: Record<string, string | undefined>;
  page: number;
  pageSize: number;
  total: number;
}) {
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

  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground">
      <span>
        Page {page} of {totalPages} ({total} total)
      </span>
      <div className="flex gap-4">
        {page > 1 ? (
          <Link className="hover:underline" href={hrefForPage(page - 1)}>
            Previous
          </Link>
        ) : null}
        {page < totalPages ? (
          <Link className="hover:underline" href={hrefForPage(page + 1)}>
            Next
          </Link>
        ) : null}
      </div>
    </div>
  );
}
