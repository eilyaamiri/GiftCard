import { describe, expect, it } from "vitest";

import {
  HOME_INTRO_ARTICLE_SLUG,
  SITE_CONTENT_CATEGORY_SLUG,
  findHomeIntro,
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

describe("findHomeIntro", () => {
  it("returns the title and content of the reserved article", () => {
    expect(findHomeIntro([help, siteContent])).toEqual({
      title: `title ${HOME_INTRO_ARTICLE_SLUG}`,
      content: `body ${HOME_INTRO_ARTICLE_SLUG}`,
    });
  });

  it("is null when the category is missing", () => {
    expect(findHomeIntro([help])).toBeNull();
  });

  it("is null when the category exists without the reserved article", () => {
    expect(findHomeIntro([category(SITE_CONTENT_CATEGORY_SLUG, ["other"])])).toBeNull();
  });

  it("ignores a help article that happens to use the reserved slug", () => {
    expect(findHomeIntro([category("buying", [HOME_INTRO_ARTICLE_SLUG])])).toBeNull();
  });

  it("is null for an empty list, which is what an API failure produces", () => {
    expect(findHomeIntro([])).toBeNull();
  });
});
