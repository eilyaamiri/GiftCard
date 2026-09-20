import { describe, expect, it } from 'vitest';

import { CATEGORIES, brandKey, brandSlug, classify } from './taxonomy';

const slugs = new Set(CATEGORIES.map((category) => category.slug));

describe('CATEGORIES', () => {
  it('has a unique slug per category', () => {
    expect(slugs.size).toBe(CATEGORIES.length);
  });

  it('gives every category a Persian name and an icon', () => {
    for (const category of CATEGORIES) {
      expect(category.nameFa.trim()).not.toBe('');
      expect(category.iconKey.trim()).not.toBe('');
    }
  });
});

describe('classify', () => {
  it('puts a console card under console rather than gaming', () => {
    expect(classify('PlayStation', 'PlayStation Store US', 'Gaming')).toBe('console');
    expect(classify('Xbox', 'Xbox Game Pass UK', 'Gaming')).toBe('console');
    expect(classify('Steam', 'Steam Wallet US', 'Gaming')).toBe('gaming');
  });

  it('reads the brand and the title together', () => {
    /* The supplier's brand for this one is the game, not the publisher. */
    expect(classify('Free Fire', 'Free Fire 100 + 10 Diamond AF', 'Gaming')).toBe('gaming');
    expect(classify('MOLEK-SYNTEZ', 'MOLEK-SYNTEZ AL', 'Gaming')).toBe('gaming');
  });

  it('sends Uber Eats to food and plain Uber to travel', () => {
    expect(classify('Uber', 'Uber Eats US', 'Shopping')).toBe('food');
    expect(classify('Uber', 'Uber US', 'Travel')).toBe('travel');
  });

  it('does not mistake Applebee’s for Apple', () => {
    expect(classify("Applebee's", "Applebee's US", 'Shopping')).toBe('food');
    expect(classify('Apple', 'App Store & iTunes UK', 'Entertainment')).toBe('popular');
  });

  it('does not mistake Booking.com or Facebook for a bookshop', () => {
    expect(classify('Booking.com', 'Booking.com NL', 'Travel')).toBe('travel');
    expect(classify('Facebook', 'Facebook Credits US', 'Shopping')).toBe('shopping');
    expect(classify('Barnes & Noble', 'Barnes & Noble US', 'Shopping')).toBe('education');
  });

  it('falls back to the supplier category when no rule recognises the product', () => {
    expect(classify('Zalando', 'Zalando DE', 'Shopping')).toBe('shopping');
    expect(classify('Crypto Voucher', 'Crypto Voucher EU', 'Crypto')).toBe('virtual');
    expect(classify('Paysafe Card', 'Paysafe Card AT', 'Payment Cards')).toBe('prepaid');
  });

  it('matches the supplier category whatever case it arrives in', () => {
    expect(classify('Zalando', 'Zalando DE', 'shopping')).toBe('shopping');
    expect(classify('Zalando', 'Zalando DE', ' SHOPPING ')).toBe('shopping');
  });

  it('answers "other" rather than nothing when it cannot tell', () => {
    /* Charity donations have no category of their own in this catalog, and the
     * brief is explicit that an unknown product stays visible and is flagged,
     * never dropped. */
    expect(classify('American Red Cross', 'American Red Cross US', 'Charity')).toBe('other');
    expect(classify('Anon', 'Anon', null)).toBe('other');
    expect(classify('Anon', 'Anon', undefined)).toBe('other');
  });

  it('only ever answers with a category that exists', () => {
    const samples = [
      ['Netflix', 'Netflix US', 'Entertainment'],
      ['Nike', 'Nike DE', 'Shopping'],
      ['IKEA', 'IKEA SE', 'Shopping'],
      ['Airalo', 'Airalo eSIM Global', 'Travel'],
      ['Mastercard', 'Mastercard Prepaid US', 'Payment Cards'],
      ['', '', ''],
    ] as const;
    for (const [brand, title, supplier] of samples) {
      expect(slugs.has(classify(brand, title, supplier))).toBe(true);
    }
  });
});

describe('brandKey', () => {
  it('collapses the spellings one brand arrives under', () => {
    expect(brandKey('NetFlix')).toBe(brandKey('Netflix'));
    expect(brandKey('Google play')).toBe(brandKey(' Google Play '));
  });

  it('keeps genuinely different brands apart', () => {
    expect(brandKey('Apple')).not.toBe(brandKey('Applebee’s'));
  });
});

describe('brandSlug', () => {
  it('makes a URL-safe slug', () => {
    expect(brandSlug('Bath & Body Works')).toBe('bath-body-works');
    expect(brandSlug('WINNERS/HomeSense/Marshalls')).toBe('winners-homesense-marshalls');
    expect(brandSlug('1-800-PetSupplies')).toBe('1-800-petsupplies');
  });

  it('never returns an empty slug', () => {
    expect(brandSlug('???')).toBe('brand');
    expect(brandSlug('')).toBe('brand');
  });

  it('agrees with brandKey on which names are the same brand', () => {
    expect(brandSlug('NetFlix')).toBe(brandSlug('Netflix'));
  });
});
