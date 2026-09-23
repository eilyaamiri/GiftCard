"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, MapPin, Search, Store, Tag, X } from "lucide-react";
import { toPersianDigits } from "@barat/ui";
import type { Brand, Category } from "@/lib/catalog";
import type { CatalogFilters } from "../_lib/catalog-url";
import { BrandFacets, CategoryFacets } from "./catalog-facets";
import { RegionPicker } from "./catalog-sidebar";

type Level = "root" | "categories" | "brands" | "region";

/**
 * Browsing the catalog on a phone.
 *
 * Two buttons open one drawer at the level they name, and the drawer's own back
 * arrow steps up to the menu that lists both — so a customer who opened
 * «برندها» while meaning «دسته‌بندی‌ها» is one tap away, not one dismissal plus
 * one tap.
 *
 * A native `<dialog>`: `showModal()` brings the focus trap, the inert page
 * behind it and the Escape key for free, and it renders in the top layer, so it
 * sits above the bottom navigation bar without either of them knowing about the
 * other. `onClose` fires however it was dismissed, so the buttons never get
 * left looking open.
 */
export function CatalogBrowser({
  categories,
  brands,
  regions,
  filters,
}: Readonly<{
  categories: readonly Category[];
  brands: readonly Brand[];
  regions: readonly string[];
  filters: CatalogFilters;
}>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [level, setLevel] = useState<Level | null>(null);
  const [term, setTerm] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (level !== null && !dialog.open) dialog.showModal();
    if (level === null && dialog.open) dialog.close();
  }, [level]);

  function open(next: Level) {
    setTerm("");
    setLevel(next);
  }

  function close() {
    setLevel(null);
  }

  const matches = (haystack: readonly string[]): boolean => {
    const needle = term.trim().toLowerCase();
    if (needle === "") return true;
    return haystack.some((value) => value.toLowerCase().includes(needle));
  };

  const shownCategories = categories.filter((category) =>
    matches([category.nameFa, category.name, category.slug]),
  );
  const shownBrands = brands.filter((brand) => matches([brand.nameFa, brand.name, brand.slug]));

  const title =
    level === "categories"
      ? "دسته‌بندی‌ها"
      : level === "brands"
        ? "برندها"
        : level === "region"
          ? "منطقه"
          : "مرور کاتالوگ";

  return (
    <div className="catalog-paths">
      <button type="button" className="catalog-path" onClick={() => open("categories")}>
        <span className="catalog-path-icon" aria-hidden="true">
          <Tag size={19} />
        </span>
        <span className="catalog-path-copy">
          <strong>دسته‌بندی‌ها</strong>
          <small>{toPersianDigits(categories.length)} دسته</small>
        </span>
      </button>
      <button type="button" className="catalog-path" onClick={() => open("brands")}>
        <span className="catalog-path-icon" aria-hidden="true">
          <Store size={19} />
        </span>
        <span className="catalog-path-copy">
          <strong>برندها</strong>
          <small>{toPersianDigits(brands.length)} برند</small>
        </span>
      </button>
      <button type="button" className="catalog-path" onClick={() => open("region")}>
        <span className="catalog-path-icon" aria-hidden="true">
          <MapPin size={19} />
        </span>
        <span className="catalog-path-copy">
          <strong>منطقه</strong>
          <small>{toPersianDigits(regions.length)} منطقه</small>
        </span>
      </button>

      <dialog
        ref={dialogRef}
        className="catalog-drawer"
        aria-labelledby="catalog-drawer-title"
        onClose={close}
        onClick={(event) => {
          /* The dialog box fills the viewport and the panel sits inside it, so a
             click that lands on the dialog itself landed outside the panel. */
          if (event.target === event.currentTarget) close();
        }}
      >
        <div className="catalog-drawer-panel">
          <div className="catalog-drawer-head">
            {level === "root" ? null : (
              <button
                type="button"
                className="catalog-drawer-back"
                aria-label="بازگشت"
                onClick={() => setLevel("root")}
              >
                <ArrowRight size={19} aria-hidden="true" />
              </button>
            )}
            <h2 id="catalog-drawer-title">{title}</h2>
            <button
              autoFocus
              type="button"
              className="catalog-drawer-close"
              aria-label="بستن"
              onClick={close}
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>

          {level === "categories" || level === "brands" ? (
            <div className="catalog-drawer-search">
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder={level === "brands" ? "جست‌وجوی برند" : "جست‌وجوی دسته‌بندی"}
                aria-label={level === "brands" ? "جست‌وجوی برند" : "جست‌وجوی دسته‌بندی"}
              />
            </div>
          ) : null}

          <div className="catalog-drawer-body">
            {level === "root" ? (
              <ul className="facet-list">
                <li>
                  <button type="button" className="facet-item" onClick={() => open("categories")}>
                    <span className="facet-icon" aria-hidden="true">
                      <Tag size={17} />
                    </span>
                    <span className="facet-label">دسته‌بندی‌ها</span>
                    <span className="facet-count">{toPersianDigits(categories.length)}</span>
                  </button>
                </li>
                <li>
                  <button type="button" className="facet-item" onClick={() => open("brands")}>
                    <span className="facet-icon" aria-hidden="true">
                      <Store size={17} />
                    </span>
                    <span className="facet-label">برندها</span>
                    <span className="facet-count">{toPersianDigits(brands.length)}</span>
                  </button>
                </li>
                <li>
                  <button type="button" className="facet-item" onClick={() => open("region")}>
                    <span className="facet-icon" aria-hidden="true">
                      <MapPin size={17} />
                    </span>
                    <span className="facet-label">منطقه</span>
                    <span className="facet-count">{toPersianDigits(regions.length)}</span>
                  </button>
                </li>
              </ul>
            ) : level === "categories" ? (
              shownCategories.length === 0 ? (
                <p className="catalog-facet-empty">دسته‌بندی‌ای با این نام پیدا نشد.</p>
              ) : (
                <CategoryFacets
                  categories={shownCategories}
                  filters={filters}
                  onNavigate={close}
                />
              )
            ) : level === "brands" ? (
              shownBrands.length === 0 ? (
                <p className="catalog-facet-empty">برندی با این نام پیدا نشد.</p>
              ) : (
                <BrandFacets brands={shownBrands} filters={filters} onNavigate={close} />
              )
            ) : (
              <RegionPicker regions={regions} filters={filters} idPrefix="catalog-drawer" />
            )}
          </div>
        </div>
      </dialog>
    </div>
  );
}
