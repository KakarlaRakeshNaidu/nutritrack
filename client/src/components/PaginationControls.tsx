import type { Pagination } from "../types";

export function PaginationControls({
  pagination,
  onPageChange,
}: {
  pagination: Pagination;
  onPageChange: (page: number) => void;
}) {
  const { page, page_size: pageSize, total_items: totalItems, total_pages: totalPages } =
    pagination;
  const firstItem = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, totalItems);

  return (
    <nav className="pagination" aria-label="Meal history pages">
      <p>
        Showing {firstItem}-{lastItem} of {totalItems}
      </p>
      <div className="button-row">
        <button
          className="button secondary"
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </button>
        <span aria-live="polite">
          Page {page} of {Math.max(totalPages, 1)}
        </span>
        <button
          className="button secondary"
          type="button"
          disabled={totalPages === 0 || page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </button>
      </div>
    </nav>
  );
}
