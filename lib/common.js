/* Shared helpers — loaded by the background service worker (importScripts) and the panel. */
(function (root) {
  const SITE_NAMES = {
    etsy: 'Etsy',
    amazon: 'Amazon',
    ebay: 'eBay',
    redbubble: 'Redbubble',
    shein: 'SHEIN',
    aliexpress: 'AliExpress',
    tiktok: 'TikTok',
  };

  function normalizeTitle(title) {
    return String(title || '')
      .toLowerCase()
      .replace(/đ/g, 'd')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  // Keys of products that duplicate an older product (same normalized title or same main image).
  function findDuplicateKeys(products) {
    const seenTitles = new Set();
    const seenImages = new Set();
    const duplicates = [];
    // Products are stored newest first: walk oldest → newest so the oldest copy is kept.
    for (let i = products.length - 1; i >= 0; i--) {
      const p = products[i];
      const title = normalizeTitle(p.title);
      const image = (p.images && p.images[0]) || '';
      if ((title && seenTitles.has(title)) || (image && seenImages.has(image))) {
        duplicates.push(p.key);
        continue;
      }
      if (title) seenTitles.add(title);
      if (image) seenImages.add(image);
    }
    return duplicates;
  }

  function csvCell(value) {
    const s = value == null ? '' : String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function toCSV(products) {
    const maxImages = products.reduce((max, p) => Math.max(max, (p.images || []).length), 1);
    const imageCols = Array.from({ length: maxImages }, (_, i) => i);
    const header = [
      'Site', 'Product ID', 'Title', 'URL', 'Price', 'Currency', 'Price Text', 'Rating', 'Reviews',
      'Shop', 'Tags', 'Description', 'Created At', ...imageCols.map((i) => `Image ${i + 1}`),
    ];
    const rows = products.map((p) => [
      SITE_NAMES[p.site] || p.site,
      p.productId,
      p.title,
      p.url,
      p.price ?? '',
      p.currency || '',
      p.priceText || '',
      p.rating ?? '',
      p.reviews || '',
      p.shop || '',
      (p.tags || []).join(', '),
      p.description || '',
      p.createdAt ? new Date(p.createdAt).toISOString() : '',
      ...imageCols.map((i) => (p.images || [])[i] || ''),
    ]);
    // BOM so Excel opens UTF-8 (Vietnamese, emoji…) correctly.
    return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  }

  root.PCX = { SITE_NAMES, normalizeTitle, findDuplicateKeys, toCSV };
})(typeof self !== 'undefined' ? self : window);
