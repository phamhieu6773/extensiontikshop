/* Generic product extraction: finds product cards on listing pages and reads product detail pages. */
(() => {
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const textOf = (el) => clean(el && (el.innerText || el.textContent));

  function absUrl(u, base = location.href) {
    if (!u) return '';
    try {
      return new URL(u.trim(), base).href;
    } catch {
      return '';
    }
  }

  function bestFromSrcset(srcset) {
    let best = '';
    let bestSize = -1;
    for (const part of srcset.split(/,\s+/)) {
      const [url, size] = part.trim().split(/\s+/);
      const n = parseFloat(size) || 1;
      if (url && n > bestSize) {
        best = url;
        bestSize = n;
      }
    }
    return best;
  }

  function imgSrc(img) {
    const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset');
    const candidates = [
      img.getAttribute('data-zoom-src'),
      img.getAttribute('data-old-hires'),
      img.getAttribute('data-src-zoom-image'),
      srcset && bestFromSrcset(srcset),
      img.currentSrc,
      img.getAttribute('src'),
      img.getAttribute('data-src'),
      img.getAttribute('data-src-delay'),
      img.getAttribute('data-original'),
      img.getAttribute('data-lazy-src'),
    ];
    for (const c of candidates) {
      if (c && !c.startsWith('data:') && !/\.svg(\?|$)/i.test(c)) return absUrl(c);
    }
    return '';
  }

  // ---------- price ----------
  const NUM = '\\d(?:[\\d.,\\u00a0\\u202f]*\\d)?';
  const NUM_RE = new RegExp(NUM);
  const PRICE_RE = new RegExp(
    `(?:[A-Z]{1,3}\\s?)?[$€£¥₹₫]\\s?${NUM}|${NUM}\\s?(?:[$€£¥₹₫đ]|VND|USD|EUR|GBP)(?!\\p{L})|(?:USD|EUR|GBP|VND)\\s?${NUM}`,
    'u'
  );
  const CURRENCIES = [
    [/US\s?\$|USD/i, 'USD'],
    [/CA\$|CAD/i, 'CAD'],
    [/AU?\$|AUD/i, 'AUD'],
    [/₫|VND|đ/i, 'VND'],
    [/€|EUR/i, 'EUR'],
    [/£|GBP/i, 'GBP'],
    [/¥|JPY/i, 'JPY'],
    [/₹|INR/i, 'INR'],
    [/\$/, 'USD'],
  ];

  function parsePrice(raw) {
    const match = clean(raw).match(PRICE_RE);
    if (!match) return null;
    const priceText = match[0].trim();
    const currency = (CURRENCIES.find(([re]) => re.test(priceText)) || [])[1] || '';
    let num = (priceText.match(NUM_RE) || [''])[0].replace(/[\s  ]/g, '');
    const lastDot = num.lastIndexOf('.');
    const lastComma = num.lastIndexOf(',');
    if (lastDot > -1 && lastComma > -1) {
      // "1.299,99" or "1,299.99": the last separator is the decimal one
      const decimal = lastDot > lastComma ? '.' : ',';
      num = num.split(decimal === '.' ? ',' : '.').join('').replace(',', '.');
    } else if (lastDot > -1 || lastComma > -1) {
      const parts = num.split(lastDot > -1 ? '.' : ',');
      const tail = parts[parts.length - 1];
      const thousands = parts.length > 2 || tail.length === 3 || currency === 'VND' || currency === 'JPY';
      num = thousands ? parts.join('') : parts.join('.');
    }
    const price = parseFloat(num);
    return { priceText, price: Number.isFinite(price) ? price : null, currency };
  }

  function findPrice(root, selector) {
    if (selector) {
      for (const el of root.querySelectorAll(selector)) {
        const p = parsePrice(el.textContent);
        if (p) return p;
      }
    }
    for (const el of root.querySelectorAll('span, p, div, b, strong, ins, bdi')) {
      const t = clean(el.textContent);
      if (t && t.length <= 30) {
        const p = parsePrice(t);
        if (p) return p;
      }
    }
    return null;
  }

  // ---------- rating / reviews / shop / title ----------
  function findRating(root) {
    const el = root.querySelector('[aria-label*="out of 5" i], [title*="out of 5" i], [aria-label*="star" i], input[name="rating"]');
    if (el) {
      const s = el.getAttribute('aria-label') || el.getAttribute('title') || el.value || '';
      const m = String(s).match(/\b([0-5](?:[.,]\d+)?)\b/);
      if (m) return parseFloat(m[1].replace(',', '.'));
    }
    const text = textOf(root);
    const m =
      text.match(/\b([1-5](?:[.,]\d)?)\s*(?:★|⭐|out of 5|\/\s*5|stars?)/i) ||
      text.match(/\b([1-5][.,]\d)\s*\(\s*[\d.,]+\s*[kK]?\s*\)/);
    return m ? parseFloat(m[1].replace(',', '.')) : null;
  }

  function findReviews(text) {
    const m =
      text.match(/\b[1-5][.,]\d\s*\(\s*([\d.,]+\s*[kK]?)\s*\)/) ||
      text.match(/([\d.,]+\s*[kK]?)\s*(?:reviews|ratings|đánh giá)/i);
    return m ? m[1].replace(/\s/g, '') : '';
  }

  function findShop(text) {
    const matches = [...text.matchAll(/(?:^|\s)(?:Ad\s+)?by\s+([A-Za-z0-9][\w-]{2,})/gi)];
    return matches.length ? matches[matches.length - 1][1] : '';
  }

  function findTitle(root, selector, link) {
    if (selector) {
      const texts = [...root.querySelectorAll(selector)].map((el) => textOf(el) || el.getAttribute('aria-label') || '');
      const longest = texts.sort((a, b) => b.length - a.length)[0];
      if (longest && longest.length > 3) return clean(longest);
    }
    const candidates = [
      link && link.getAttribute('title'),
      link && link.getAttribute('aria-label'),
      ...[...root.querySelectorAll('[title]')].map((e) => e.getAttribute('title')),
      ...[...root.querySelectorAll('img[alt]')].map((i) => i.alt),
      link && textOf(link),
    ];
    return clean(candidates.find((c) => c && clean(c).length > 3) || '');
  }

  function mainImage(root) {
    let best = null;
    let bestArea = -1;
    for (const img of root.querySelectorAll('img')) {
      const src = imgSrc(img);
      if (!src) continue;
      const area = img.offsetWidth * img.offsetHeight;
      if (area > 0 && area < 2500) continue; // icons, avatars, badges
      if (area > bestArea) {
        best = src;
        bestArea = area;
      }
    }
    return best;
  }

  function build(site, id, data, base = location.href) {
    const images = [
      ...new Set(
        (data.images || [])
          .map((u) => absUrl(u, base))
          .filter(Boolean)
          .map((u) => (site.bigImage ? site.bigImage(u) : u))
      ),
    ];
    const url = absUrl(data.url, base) || base;
    return {
      key: `${site.key}:${id}`,
      site: site.key,
      productId: String(id),
      url: site.cleanUrl ? site.cleanUrl(url, id) : url,
      title: clean(data.title),
      price: data.price ?? null,
      currency: data.currency || '',
      priceText: data.priceText || '',
      rating: data.rating ?? null,
      reviews: data.reviews ? String(data.reviews) : '',
      shop: clean(data.shop),
      description: String(data.description || '').trim(),
      tags: data.tags || [],
      images,
      sourcePage: location.href,
    };
  }

  // ---------- listing cards ----------
  function extractCard(site, card, id) {
    const links = [...(card.matches('a[href]') ? [card] : []), ...card.querySelectorAll('a[href]')];
    // Only a link to THIS product may become the saved URL — the card's other links point at the
    // shop, an ad or a neighbouring listing, and would file the card under the wrong product.
    const link = links.find((a) => site.idFromUrl(a.href) === id) || null;
    const image = mainImage(card);
    const text = textOf(card);
    return build(site, id, {
      url: link ? link.href : (site.urlFromId ? site.urlFromId(id) : ''),
      title: findTitle(card, site.card && site.card.title, link),
      images: image ? [image] : [],
      ...(findPrice(card, site.card && site.card.price) || {}),
      rating: findRating(card),
      reviews: findReviews(text),
      shop: site.card && site.card.shop ? findShop(text) : '',
    });
  }

  function idsInside(site, el, cache) {
    let ids = cache.get(el);
    if (ids) return ids;
    ids = new Set();
    const anchors = [...(el.matches('a[href]') ? [el] : []), ...el.querySelectorAll('a[href]')];
    for (const a of anchors) {
      const id = site.idFromUrl(a.href);
      if (id) ids.add(id);
    }
    cache.set(el, ids);
    return ids;
  }

  // Returns [cardElement, productId] pairs for every product shown on the page.
  function findCards(site) {
    const found = new Map();
    const cache = new Map();
    if (site.cardSelector) {
      for (const el of document.querySelectorAll(site.cardSelector)) {
        const id = (site.idFromCard && site.idFromCard(el)) || [...idsInside(site, el, cache)][0];
        if (id) found.set(el, id);
      }
    }
    if (!found.size) {
      // Generic: from each product link climb to the largest ancestor that still holds only that product.
      const maxWidth = Math.max(320, Math.min(900, window.innerWidth * 0.7));
      for (const a of document.querySelectorAll('a[href]')) {
        const id = site.idFromUrl(a.href);
        if (!id) continue;
        let best = null;
        let el = a;
        for (let depth = 0; el && el !== document.body && depth < 12; depth++, el = el.parentElement) {
          if (idsInside(site, el, cache).size > 1) break;
          if (el.getBoundingClientRect().width > maxWidth) break;
          if (el.querySelector('img')) best = el;
        }
        if (best) found.set(best, id);
      }
    }
    const cards = [...found.keys()];
    return [...found].filter(([el]) => !cards.some((other) => other !== el && other.contains(el)));
  }

  // ---------- product detail page ----------
  function jsonLdProduct(doc) {
    const found = [];
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(walk);
      const types = [].concat(node['@type'] || []);
      if (types.some((t) => /^(Product|ProductGroup|IndividualProduct)$/i.test(t))) found.push(node);
      if (node['@graph']) walk(node['@graph']);
    };
    for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        walk(JSON.parse(s.textContent));
      } catch {
        // ignore malformed JSON-LD
      }
    }
    return found[0] || null;
  }

  const ldImages = (image) =>
    [].concat(image || []).map((i) => (typeof i === 'string' ? i : i && (i.contentUrl || i.contentURL || i.url))).filter(Boolean);

  function largeImages() {
    return [...document.images]
      .filter((img) => img.naturalWidth >= 300 && img.naturalHeight >= 300)
      .slice(0, 12)
      .map(imgSrc);
  }

  // `doc`/`baseUrl` default to the page we run in, but may also be a product page fetched in the
  // background (see enrichFromDetailPage in content.js) so a listing card can get the full gallery.
  function extractDetail(site, doc = document, baseUrl = location.href) {
    const id = site.idFromUrl(baseUrl);
    if (!id) return null;
    const d = site.detail || {};
    const ld = jsonLdProduct(doc) || {};
    const meta = (name) => {
      const el = doc.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
      return (el && el.content) || '';
    };
    const pick = (selector) => (selector ? [...doc.querySelectorAll(selector)].map(textOf).filter(Boolean) : []);

    const images = [...(d.images ? d.images(doc) : []), ...ldImages(ld.image), meta('og:image')].filter(Boolean);
    // Sizes only exist for images the browser actually laid out, so this fallback needs a live page.
    if (images.length < 2 && doc === document) images.push(...largeImages());

    const offer = [].concat(ld.offers || [])[0] || {};
    const amount = offer.price || offer.lowPrice || meta('product:price:amount');
    let priceInfo = null;
    if (amount) {
      const currency = offer.priceCurrency || meta('product:price:currency');
      priceInfo = { price: parseFloat(amount), currency, priceText: `${amount} ${currency}`.trim() };
    } else if (d.price) {
      priceInfo = findPrice(doc, d.price);
    }

    const rating = ld.aggregateRating || {};
    const brand = ld.brand;
    return build(site, id, {
      url: baseUrl,
      title: pick(d.title)[0] || ld.name || meta('og:title') || doc.title,
      images,
      ...(priceInfo || {}),
      rating: rating.ratingValue ? parseFloat(rating.ratingValue) : null,
      reviews: rating.reviewCount || rating.ratingCount || '',
      shop: pick(d.shop)[0] || (typeof brand === 'string' ? brand : brand && brand.name) || '',
      description: d.description ? pick(d.description).join('\n') : ld.description || meta('og:description'),
      tags: meta('keywords') ? meta('keywords').split(',').map(clean).filter(Boolean) : [],
    }, baseUrl);
  }

  globalThis.PCXExtract = { findCards, extractCard, extractDetail };
})();
