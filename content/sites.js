/* Site definitions: how to recognise product links/cards on each marketplace and read their data.
 * Marketplaces change their HTML often — if a site stops working, adjust the selectors here. */
(() => {
  const decode = (s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  const stripQuery = (url) => {
    try {
      const u = new URL(url, location.href);
      return u.origin + u.pathname;
    } catch {
      return url;
    }
  };
  const scriptText = (doc) => [...doc.scripts].map((s) => s.textContent).join('\n');

  // The JS array literal starting at or after `from`, brackets balanced (image URLs hold no brackets).
  const arrayAt = (text, from) => {
    const start = text.indexOf('[', from);
    if (start < 0) return '';
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '[') depth++;
      else if (text[i] === ']' && --depth === 0) return text.slice(start, i + 1);
    }
    return '';
  };

  // Attributes marketplaces put image URLs in, including the lazy-loading ones.
  const IMG_ATTRS = [
    'src', 'data-src', 'data-src-delay', 'data-src-zoom-image', 'data-zoom-src', 'data-old-hires',
    'srcset', 'data-srcset',
  ];

  // Every image URL inside the first of `selectors` that matches something. Thumbnails are taken on
  // purpose: bigImage() maps them to the full-size URL and build() drops duplicates, so a carousel
  // the user never clicked through still yields the whole gallery.
  const galleryImages = (doc, selectors, pattern) => {
    for (const selector of selectors) {
      const urls = [];
      for (const scope of doc.querySelectorAll(selector)) {
        for (const el of [...(scope.matches('img') ? [scope] : []), ...scope.querySelectorAll('img, source')]) {
          for (const attr of IMG_ATTRS) {
            for (const part of (el.getAttribute(attr) || '').split(',')) {
              const url = part.trim().split(/\s+/)[0];
              if (url && !url.startsWith('data:') && (!pattern || pattern.test(url))) urls.push(url);
            }
          }
        }
      }
      if (urls.length) return urls;
    }
    return [];
  };

  const SITES = [
    {
      key: 'etsy',
      name: 'Etsy',
      host: /(^|\.)etsy\.com$/,
      idFromUrl: (u) => (u.match(/\/listing\/(\d+)/) || [])[1],
      cleanUrl: stripQuery,
      urlFromId: (id) => `${location.origin}/listing/${id}`,
      card: { title: 'h3, h2, .v2-listing-card__title', price: '.lc-price, .n-listing-card__price', shop: true },
      bigImage: (u) => u.replace(/\/il_[^/.]+\./, '/il_fullxfull.'),
      detail: {
        title: 'h1',
        // Scoped to the carousel so "you may also like" listings can't leak into the gallery.
        images: (doc) =>
          galleryImages(
            doc,
            [
              '[data-component="listing-page-image-carousel"]',
              '[data-appears-component-name="listing_page_image_carousel"]',
              '.listing-page-image-carousel-component',
              '.image-carousel-container',
              'ul.carousel-pane-list',
              '[data-carousel-pane-list]',
              '[data-listing-page-image-carousel]',
            ],
            /i\.etsystatic\.com\//
          ),
      },
    },
    {
      key: 'amazon',
      name: 'Amazon',
      host: /(^|\.)amazon\.[a-z.]+$/,
      idFromUrl: (u) => (decode(u).match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?=[/?#&]|$)/) || [])[1],
      cleanUrl: (url, id) => `${location.origin}/dp/${id}`,
      cardSelector: 'div[data-component-type="s-search-result"][data-asin]',
      idFromCard: (el) => el.getAttribute('data-asin') || null,
      card: { title: '[data-cy="title-recipe"] h2, h2', price: '.a-price:not(.a-text-price) .a-offscreen' },
      bigImage: (u) => u.replace(/\._[^/]*_\.(jpe?g|png|webp|gif)$/i, '.$1'),
      detail: {
        title: '#productTitle',
        price: '#corePrice_feature_div .a-offscreen, #corePriceDisplay_desktop_feature_div .a-offscreen, #apex_desktop .a-offscreen',
        shop: '#bylineInfo',
        description: '#feature-bullets li, #productDescription',
        // Amazon ships each gallery photo twice — once as "hiRes", once as a separately generated
        // "large" copy with a *different* image id — so taking both lists every photo twice. Take
        // hiRes and fall back to that entry's large only when the photo has no hiRes. Scoped to the
        // gallery of the variant on screen, or the recommendation carousels leak in too.
        images: (doc) => {
          const text = scriptText(doc);
          const at = text.match(/['"]colorImages['"]\s*:\s*\{\s*['"]initial['"]\s*:/);
          const gallery = (at && arrayAt(text, at.index + at[0].length)) || text;
          const urlsFor = (key) =>
            [...gallery.matchAll(new RegExp(`"${key}"\\s*:\\s*(?:"(https?:[^"]+)"|null)`, 'g'))].map((m) => m[1] || '');
          const hiRes = urlsFor('hiRes');
          const large = urlsFor('large');
          const urls = (hiRes.length ? hiRes : large).map((u, i) => u || large[i] || '');
          const main = doc.querySelector('#landingImage');
          if (main) urls.unshift(main.getAttribute('data-old-hires') || main.getAttribute('src'));
          return urls.filter((u) => u && !u.startsWith('data:'));
        },
      },
    },
    {
      key: 'ebay',
      name: 'eBay',
      host: /(^|\.)ebay\.[a-z.]+$/,
      idFromUrl: (u) => (u.match(/\/itm\/(?:[^/?#]+\/)?(\d{9,})/) || [])[1],
      cleanUrl: (url, id) => `${location.origin}/itm/${id}`,
      cardSelector: 'li.s-item, li.s-card',
      card: { title: '.s-item__title, .s-card__title', price: '.s-item__price, .s-card__price' },
      bigImage: (u) => u.replace(/\/s-l\d+\./, '/s-l1600.'),
      detail: {
        title: 'h1.x-item-title__mainTitle, h1',
        price: '.x-price-primary',
        images: (doc) => galleryImages(doc, ['.ux-image-carousel-item', '.ux-image-grid', '.ux-image-carousel']),
      },
    },
    {
      key: 'redbubble',
      name: 'Redbubble',
      host: /(^|\.)redbubble\.com$/,
      idFromUrl: (u) => {
        const m = u.match(/\/i\/[^/]+\/[^/]+\/(\d+)\.([A-Z0-9]+)/i);
        return m ? `${m[1]}.${m[2]}` : undefined;
      },
      cleanUrl: stripQuery,
      detail: { title: 'h1' },
    },
    {
      key: 'shein',
      name: 'SHEIN',
      host: /(^|\.)shein\.com$/,
      idFromUrl: (u) => (u.match(/-p-(\d+)(?:-cat-\d+)?\.html/) || [])[1],
      cleanUrl: stripQuery,
      cardSelector: 'section.product-card, .product-card',
      card: { title: '.goods-title-link, [class*="goods-title"]', price: '[class*="price"]' },
      bigImage: (u) => u.replace(/_thumbnail_\d+x\d*/, ''),
      detail: { title: 'h1' },
    },
    {
      key: 'aliexpress',
      name: 'AliExpress',
      host: /(^|\.)aliexpress\.(com|us)$/,
      idFromUrl: (u) => (u.match(/\/item\/(\d+)\.html/) || [])[1],
      cleanUrl: (url, id) => `${location.origin}/item/${id}.html`,
      bigImage: (u) => u.replace(/(\.(?:jpe?g|png|webp))_[^/]*$/i, '$1'),
      detail: { title: 'h1' },
    },
    {
      key: 'tiktok',
      name: 'TikTok',
      host: /(^|\.)tiktok\.com$/,
      idFromUrl: (u) => {
        const m = u.match(/\/(?:view\/product|product)\/(\d{8,})|\/pdp\/(?:[^/?#]+\/)?(\d{8,})/);
        return m ? m[1] || m[2] : undefined;
      },
      cleanUrl: stripQuery,
      detail: { title: 'h1' },
    },
  ];

  globalThis.PCXSites = {
    SITES,
    current: SITES.find((s) => s.host.test(location.hostname)) || null,
  };
})();
