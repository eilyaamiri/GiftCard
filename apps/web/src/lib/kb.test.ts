import { describe, expect, it } from "vitest";

import {
  GAMES_PAGE_ARTICLE_SLUG,
  GIFT_CARDS_PAGE_ARTICLE_SLUG,
  HOME_INTRO_ARTICLE_SLUG,
  SITE_CONTENT_CATEGORY_SLUG,
  brandArticleSlug,
  categoryArticleSlug,
  findSiteArticle,
  withoutSiteContent,
  type KbCategory,
} from "./kb";

function category(slug: string, articleSlugs: readonly string[]): KbCategory {
  return {
    id: `cat_${slug}`,
    slug,
    name: slug,
    description: "",
    icon: "book-open",
    articles: articleSlugs.map((articleSlug) => ({
      id: `art_${slug}_${articleSlug}`,
      slug: articleSlug,
      title: `title ${articleSlug}`,
      excerpt: "",
      content: `body ${articleSlug}`,
      isPromoted: false,
    })),
  };
}

const help = category("buying", ["basics"]);
const siteContent = category(SITE_CONTENT_CATEGORY_SLUG, [HOME_INTRO_ARTICLE_SLUG, "other"]);

describe("withoutSiteContent", () => {
  it("drops the site-copy category and keeps the help ones in order", () => {
    const other = category("payments", ["fees"]);
    expect(withoutSiteContent([help, siteContent, other])).toEqual([help, other]);
  });

  it("is a no-op when the site-copy category does not exist", () => {
    expect(withoutSiteContent([help])).toEqual([help]);
  });
});

describe("findSiteArticle", () => {
  it("returns the title and content of the reserved article", () => {
    expect(findSiteArticle([help, siteContent], HOME_INTRO_ARTICLE_SLUG)).toEqual({
      title: `title ${HOME_INTRO_ARTICLE_SLUG}`,
      content: `body ${HOME_INTRO_ARTICLE_SLUG}`,
    });
  });

  it("is null when the category is missing", () => {
    expect(findSiteArticle([help], HOME_INTRO_ARTICLE_SLUG)).toBeNull();
  });

  it("is null when the category exists without the reserved article", () => {
    expect(findSiteArticle([category(SITE_CONTENT_CATEGORY_SLUG, ["other"])], HOME_INTRO_ARTICLE_SLUG)).toBeNull();
  });

  it("ignores a help article that happens to use the reserved slug", () => {
    expect(findSiteArticle([category("buying", [HOME_INTRO_ARTICLE_SLUG])], HOME_INTRO_ARTICLE_SLUG)).toBeNull();
  });

  it("is null for an empty list, which is what an API failure produces", () => {
    expect(findSiteArticle([], HOME_INTRO_ARTICLE_SLUG)).toBeNull();
  });
});

describe("page article slugs", () => {
  it("finds the catalogue, games and per-category articles by their own slugs", () => {
    const content = category(SITE_CONTENT_CATEGORY_SLUG, [
      GIFT_CARDS_PAGE_ARTICLE_SLUG,
      GAMES_PAGE_ARTICLE_SLUG,
      categoryArticleSlug("games"),
    ]);
    expect(findSiteArticle([content], GIFT_CARDS_PAGE_ARTICLE_SLUG)?.title).toBe(`title ${GIFT_CARDS_PAGE_ARTICLE_SLUG}`);
    expect(findSiteArticle([content], GAMES_PAGE_ARTICLE_SLUG)?.title).toBe(`title ${GAMES_PAGE_ARTICLE_SLUG}`);
    expect(findSiteArticle([content], "category-games")?.title).toBe("title category-games");
    expect(findSiteArticle([content], "category-other")).toBeNull();
  });

  it("keys a brand article by the brand slug", () => {
    expect(brandArticleSlug("apple")).toBe("brand-apple");
  });

  it("keys a category article by the category slug", () => {
    expect(categoryArticleSlug("utility-software")).toBe("category-utility-software");
  });
});
