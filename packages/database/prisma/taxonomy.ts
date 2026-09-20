/**
 * Where a catalog product belongs, and under which brand.
 *
 * The supplier feeds hand over two free-text columns — a brand name and a
 * category name of their own devising — and neither is fit to navigate a
 * storefront by. These rules turn them into the `Brand` and `Category` rows the
 * site reads, and they run on every import, so a product added next year lands
 * in the right place without anyone touching the front end.
 *
 * Migration `20260920120000_catalog_taxonomy` contains a SQL transcription of
 * the same rules, which it used once to backfill the 2406 products that were
 * imported before this module existed. A migration is a record of what was
 * done and never changes; this file is what happens from now on. Edit here.
 */

/** The category set. `iconKey` names an icon the web app already ships. */
export const CATEGORIES = [
  { slug: 'popular', name: 'Popular', nameFa: 'عمومی و پرکاربرد', iconKey: 'sparkles' },
  { slug: 'gaming', name: 'Gaming', nameFa: 'بازی و گیم', iconKey: 'gamepad-2' },
  { slug: 'console', name: 'Console', nameFa: 'کنسول', iconKey: 'joystick' },
  {
    slug: 'entertainment',
    name: 'Entertainment & Streaming',
    nameFa: 'سرگرمی و استریم',
    iconKey: 'clapperboard',
  },
  { slug: 'shopping', name: 'Shopping', nameFa: 'فروشگاهی و خرید', iconKey: 'shopping-bag' },
  { slug: 'mobile', name: 'Mobile & Connectivity', nameFa: 'موبایل و ارتباطات', iconKey: 'smartphone' },
  {
    slug: 'software',
    name: 'Software & Online Services',
    nameFa: 'نرم‌افزار و سرویس‌های آنلاین',
    iconKey: 'app-window',
  },
  { slug: 'education', name: 'Education & Books', nameFa: 'آموزش و کتاب', iconKey: 'book-open' },
  { slug: 'food', name: 'Food & Dining', nameFa: 'غذا و رستوران', iconKey: 'utensils' },
  { slug: 'travel', name: 'Travel', nameFa: 'سفر', iconKey: 'plane' },
  { slug: 'sports', name: 'Sports', nameFa: 'ورزش', iconKey: 'dumbbell' },
  { slug: 'electronics', name: 'Electronics', nameFa: 'الکترونیک', iconKey: 'cpu' },
  { slug: 'home', name: 'Home & Lifestyle', nameFa: 'خانه و سبک زندگی', iconKey: 'sofa' },
  { slug: 'beauty', name: 'Beauty & Health', nameFa: 'زیبایی و سلامت', iconKey: 'flower-2' },
  {
    slug: 'prepaid',
    name: 'Credit & Prepaid Cards',
    nameFa: 'کارت‌های اعتباری و Prepaid',
    iconKey: 'credit-card',
  },
  { slug: 'virtual', name: 'Virtual Cards', nameFa: 'کارت‌های مجازی', iconKey: 'wallet' },
  { slug: 'other', name: 'Other', nameFa: 'سایر', iconKey: 'ellipsis' },
] as const;

export type CategorySlug = (typeof CATEGORIES)[number]['slug'];

/** Where an unclassifiable product goes. It is shown, not hidden — but flagged. */
export const FALLBACK_CATEGORY: CategorySlug = 'other';

/**
 * Substring rules, most specific group first. The first group with a hit wins,
 * so `console` outranks `gaming` for an Xbox card and `food` outranks `travel`
 * for Uber Eats.
 */
const RULES: readonly (readonly [CategorySlug, readonly string[]])[] = [
  ['console', ['playstation', 'psn', 'xbox', 'nintendo', 'game pass']],
  [
    'gaming',
    [
      'steam', 'roblox', 'minecraft', 'pubg', 'free fire', 'riot', 'valorant',
      'league of legends', 'razer', 'blizzard', 'battle.net', 'epic games', 'ea play',
      'ubisoft', 'garena', 'mobile legends', 'jawaker', 'netdragon', 'molek', 'big point',
      'fortnite', 'genshin', 'call of duty', 'clash of', 'world of warcraft', 'diamond',
      'gaming', 'gamivo', 'nexon',
    ],
  ],
  [
    'entertainment',
    [
      'netflix', 'spotify', 'twitch', 'disney', 'hulu', 'hbo', 'paramount', 'starz',
      'anghami', 'deezer', 'tidal', 'apple music', 'youtube', 'crunchyroll', 'shahid',
      'cinema', 'theatre', 'theater', 'ticketmaster', 'atom tickets', 'tinder', 'bumble',
      'mubi', 'viu', 'osn ', 'abbonamenti',
    ],
  ],
  [
    'food',
    [
      'restaurant', 'pizza', 'grill', 'steakhouse', 'burger', 'coffee', 'starbucks',
      'dining', 'deliveroo', 'doordash', 'uber eats', 'wings', 'brewhouse', 'lobster',
      'applebee', 'outback', 'bahama breeze', 'bonefish', 'landry', 'brinker', "chili's",
      'olive garden', 'cheesecake', 'dunkin', 'domino', 'kfc', 'mcdonald', 'subway',
      'taco', 'sushi', 'bistro', 'bakery', 'panera', 'pizzaria', 'chifa', 'wagamama',
      'nando', 'papa john', 'popeyes', 'wendy', 'just eat', 'ifood',
    ],
  ],
  [
    'beauty',
    [
      'sephora', 'bath & body', 'cosmetic', 'beauty', 'perfum', 'skincare', 'ulta',
      'the body shop', 'douglas', 'yves rocher', 'pharmac', 'nocibe',
    ],
  ],
  [
    'sports',
    [
      'nike', 'adidas', 'decathlon', 'golf', 'sport', 'fitness', 'athlet', 'puma',
      'under armour', 'reebok', 'asics', 'bass pro', 'cabela', 'foot locker', 'intersport',
    ],
  ],
  [
    'education',
    [
      // Not 'book': that also catches Booking.com and Facebook.
      'barnes & noble', 'bookstore', 'bookshop', 'books', 'audible', 'kindle', 'udemy',
      'coursera', 'skillshare', 'kobo', 'scribd', 'waterstones', 'duolingo',
    ],
  ],
  [
    'mobile',
    [
      'airalo', 'esim', 'sim card', 'top-up', 'topup', 'recharge', 'airtime', 'vodafone',
      'lycamobile', 'lebara', 'giffgaff', 't-mobile', 'etisalat', 'telecom', 'mtn ',
    ],
  ],
  [
    'electronics',
    [
      'best buy', 'currys', 'media markt', 'mediamarkt', 'newegg', 'electronic', 'samsung',
      'huawei', 'xiaomi', 'lenovo', 'jb hi-fi', 'fnac', 'euronics', 'conrad',
    ],
  ],
  [
    'home',
    [
      'ikea', 'furniture', 'cb2', 'crate', 'wayfair', 'bed bath', 'homesense', 'garden',
      'leroy merlin', 'hornbach', 'castorama', 'b&q', 'maison', 'home depot',
    ],
  ],
  ['virtual', ['crypto', 'bitcoin', 'binance', 'usdt', 'bitfy', 'ethereum']],
  [
    'prepaid',
    [
      'mastercard', 'american express', 'amex', 'paysafe', 'prepaid', 'neosurf',
      'flexepin', 'cashlib', 'visa ',
    ],
  ],
  [
    'travel',
    [
      'airbnb', 'hotel', 'flight', 'airline', 'booking', 'expedia', 'travel', 'uber',
      'lyft', 'flixbus', 'rail', 'cruise', 'tours', 'rentacar', 'car rental', 'vacation',
      'holiday', 'atrapalo', 'best western', 'flystay',
    ],
  ],
  [
    'software',
    [
      'microsoft', 'office 365', 'adobe', 'norton', 'mcafee', 'kaspersky', 'antivirus',
      'vpn', 'hosting', 'canva', 'dropbox', 'google one', 'icloud', 'openai', 'github',
    ],
  ],
  // The store-credit brands that belong everywhere and nowhere.
  ['popular', ['apple', 'itunes', 'amazon', 'google play']],
];

/** The supplier's own category, when no rule above recognises the product. */
const SUPPLIER_CATEGORY: Readonly<Record<string, CategorySlug>> = {
  gaming: 'gaming',
  shopping: 'shopping',
  crypto: 'virtual',
  entertainment: 'entertainment',
  travel: 'travel',
  'payment cards': 'prepaid',
  software: 'software',
  'gift-card': 'popular',
  'gift cards': 'popular',
};

/**
 * The category a product belongs in.
 *
 * Returns `other` when neither the rules nor the supplier's category recognise
 * it. That is a real answer, not a failure: the product is still listed, and
 * `needsReview` is what tells an operator to look at it.
 */
export function classify(
  brand: string,
  title: string,
  supplierCategory: string | null | undefined,
): CategorySlug {
  const haystack = `${brand} ${title}`.toLowerCase();
  for (const [slug, patterns] of RULES) {
    if (patterns.some((pattern) => haystack.includes(pattern))) return slug;
  }
  return SUPPLIER_CATEGORY[(supplierCategory ?? '').trim().toLowerCase()] ?? FALLBACK_CATEGORY;
}

/**
 * The key two spellings of one brand agree on.
 *
 * The feeds ship both "NetFlix" and "Netflix"; without this the brand list
 * shows the same brand twice, each with half its products.
 */
export function brandKey(name: string): string {
  return name.trim().toLowerCase();
}

/** A URL-safe brand slug. Callers resolve collisions between distinct brands. */
export function brandSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 90) || 'brand'
  );
}
