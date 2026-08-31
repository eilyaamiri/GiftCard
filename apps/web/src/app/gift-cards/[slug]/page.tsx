import Link from "next/link";
import { notFound } from "next/navigation";
import { ErrorState } from "@barat/ui";
import type { ProductDetailDto } from "@barat/contracts";
import { api, ApiClientError } from "@/lib/api";
import { ProductDetail } from "./product-detail";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let product: ProductDetailDto;
  try {
    ({ product } = await api.product(slug));
  } catch (error) {
    if (error instanceof ApiClientError && error.isNotFound) notFound();
    return (
      <main className="page container">
        <ErrorState
          title="این گیفت‌کارت در دسترس نیست"
          description={error instanceof ApiClientError ? error.message : "ارتباط با سرویس ممکن نیست. لطفاً دوباره تلاش کنید."}
          action={<Link className="btn btn-primary" href="/gift-cards">بازگشت به کاتالوگ</Link>}
        />
      </main>
    );
  }

  return <ProductDetail product={product} />;
}
