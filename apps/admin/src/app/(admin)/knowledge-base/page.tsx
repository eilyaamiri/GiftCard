import { api } from "@/lib/api";
import { requireRole } from "@/lib/session";
import { KbPanel } from "./kb-panel";
import { kbListSchema, type KbCategory } from "./kb-schema";

export const metadata = { title: "پایگاه دانش | پنل ادمین برات پی" };

export default async function KnowledgeBasePage() {
  await requireRole(["ADMIN"]);

  let categories: readonly KbCategory[] = [];
  let loadError: string | null = null;

  try {
    const response = await api.get("/api/admin/knowledge-base", kbListSchema);
    categories = response.categories;
  } catch {
    loadError = "خواندن پایگاه دانش از سرویس ممکن نشد. صفحه را دوباره بارگذاری کنید.";
  }

  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">عملیات و بازرسی</p>
          <h1>پایگاه دانش</h1>
        </div>
      </div>

      {loadError ? (
        <p className="settings-message error" role="alert">
          {loadError}
        </p>
      ) : (
        <KbPanel initialCategories={categories} />
      )}
    </div>
  );
}
