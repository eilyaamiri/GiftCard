/**
 * Shown while the catalog is being fetched.
 *
 * The same shape as the page it replaces — a sidebar beside a grid — so that
 * arriving content settles into place instead of pushing the page around.
 */
export default function GiftCardsLoading() {
  return (
    <main className="page container catalog-page" aria-busy="true">
      <span className="skeleton skeleton-line" style={{ width: 180 }} />
      <span className="skeleton skeleton-line" style={{ width: "min(460px, 80%)", height: 32 }} />
      <span className="skeleton skeleton-block" style={{ height: 56, marginBlock: 18 }} />
      <div className="catalog-layout">
        <div className="catalog-aside">
          <span className="skeleton skeleton-block" style={{ height: 320 }} />
          <span className="skeleton skeleton-block" style={{ height: 240 }} />
        </div>
        <div className="grid catalog-grid">
          {Array.from({ length: 6 }, (_, index) => (
            <span key={index} className="skeleton skeleton-card" />
          ))}
        </div>
      </div>
      <span className="skeleton-label">در حال بارگذاری کاتالوگ…</span>
    </main>
  );
}
