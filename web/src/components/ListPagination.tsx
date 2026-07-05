import "../styles/list-pagination.css";

type ListPaginationProps = {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPage: (p: number) => void;
  itemLabel?: string;
  /** When true, adds card footer padding and top border (History table style). */
  variant?: "standalone" | "card";
};

export function ListPagination({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPage,
  itemLabel = "items",
  variant = "standalone",
}: ListPaginationProps) {
  const start = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);

  const pages: (number | "ellipsis")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1, 2, 3, "ellipsis", totalPages);
  }

  return (
    <div className={`list-pagination-footer${variant === "card" ? " list-pagination-footer--card" : ""}`}>
      <span className="list-pagination-count">
        {start}–{end} of {totalItems} {itemLabel}
      </span>
      <div className="list-pagination">
        <button
          type="button"
          className="list-pagination-btn"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          ‹
        </button>
        {pages.map((p, i) =>
          p === "ellipsis" ? (
            <span key={`e-${i}`} className="px-1 text-zinc-400">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              className={`list-pagination-btn${p === page ? " list-pagination-btn--active" : ""}`}
              onClick={() => onPage(p)}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          className="list-pagination-btn"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          ›
        </button>
      </div>
    </div>
  );
}
