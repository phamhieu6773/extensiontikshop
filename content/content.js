/* Page integration: "Get product" buttons on product cards, floating toggle and the side panel iframe.
 * Runs automatically on supported marketplaces, and is injected on demand (toolbar icon) on any other page,
 * where only the floating panel is shown. */
(() => {
  if (window.top !== window) return;

  const extensionAlive = () => {
    try {
      return Boolean(chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  };
  if (window.__pcxAlive && window.__pcxAlive()) return; // already running
  window.__pcxAlive = extensionAlive;

  // Buttons are tagged with the instance that created them, so UI left behind by a reloaded
  // (now disconnected) copy of the extension can be told apart and cleaned up.
  const instance = Math.random().toString(36).slice(2);
  document.querySelectorAll('#pcx-root').forEach((el) => el.remove());

  const site = globalThis.PCXSites.current; // null → panel only, no product buttons
  const { findCards, extractCard, extractDetail } = globalThis.PCXExtract;

  const PANEL_WIDTH = 'min(780px, 100vw)';
  const BAG_ICON =
    '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>';

  const UI_CSS = `
    .panel { position: fixed; top: 0; right: 0; height: 100vh; width: ${PANEL_WIDTH}; border: 0; background: #fff;
      box-shadow: -8px 0 32px rgba(0,0,0,.18); transform: translateX(105%); transition: transform .25s ease;
      z-index: 2147483646; color-scheme: light; }
    .open .panel { transform: none; }
    .toggle { position: fixed; top: 64px; right: 16px; width: 48px; height: 48px; padding: 0; border: 0; border-radius: 50%;
      background: #0f9488; color: #fff; font: 600 22px/1 system-ui, sans-serif; cursor: pointer; display: grid; place-items: center;
      box-shadow: 0 4px 14px rgba(0,0,0,.25); z-index: 2147483647; transition: right .25s ease, background .15s; }
    .toggle:hover { background: #0d7c72; }
    .open .toggle { right: min(calc(${PANEL_WIDTH} - 24px), calc(100vw - 64px)); }
    .detail-btn { position: fixed; top: 124px; right: 16px; padding: 10px 16px; border: 0; border-radius: 999px; background: #111;
      color: #fff; font: 600 13px/1.2 system-ui, sans-serif; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.25); z-index: 2147483647; }
    .detail-btn:hover { background: #0f9488; }
    .detail-btn.saved { background: #0f766e; }
    .detail-btn:disabled { opacity: .6; cursor: progress; }
    .toast { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); max-width: min(90vw, 480px); padding: 10px 18px;
      border-radius: 8px; background: #0f766e; color: #fff; font: 500 14px/1.4 system-ui, sans-serif; text-align: center;
      box-shadow: 0 6px 20px rgba(0,0,0,.25); z-index: 2147483647; }
    .toast.error { background: #dc2626; }
    [hidden] { display: none !important; }
  `;

  // ---------- floating UI (in a closed shadow root so page CSS can't break it) ----------
  const host = document.createElement('div');
  host.id = 'pcx-root';
  host.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>${UI_CSS}</style>
    <div class="wrap">
      <iframe class="panel" title="POD Crawler"></iframe>
      <button class="toggle" type="button" title="Mở POD Crawler">${BAG_ICON}</button>
      <button class="detail-btn" type="button" hidden></button>
      <div class="toast" hidden></div>
    </div>`;
  document.documentElement.appendChild(host);

  const wrap = shadow.querySelector('.wrap');
  const panel = shadow.querySelector('.panel');
  const toggle = shadow.querySelector('.toggle');
  const detailBtn = shadow.querySelector('.detail-btn');
  const toastEl = shadow.querySelector('.toast');

  let isOpen = false;
  let savedKeys = new Set();
  let toastTimer = null;

  const currentPageId = () => (site && site.idFromUrl(location.href)) || null;
  const keyOf = (id) => `${site.key}:${id}`;

  function toast(message, isError = false) {
    toastEl.textContent = message;
    toastEl.classList.toggle('error', isError);
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), 3500);
  }

  function setOpen(open) {
    isOpen = open;
    if (open && !panel.getAttribute('src')) panel.src = chrome.runtime.getURL('panel/panel.html');
    wrap.classList.toggle('open', open);
    toggle.innerHTML = open ? '✕' : BAG_ICON;
    toggle.title = open ? 'Đóng' : 'Mở POD Crawler';
    updateDetailButton();
  }

  toggle.addEventListener('click', () => {
    if (!teardownIfOrphaned()) setOpen(!isOpen);
  });

  // Marketplaces throttle bursts of requests, so only a few product pages are loaded at a time.
  async function mapPooled(items, size, fn) {
    const out = new Array(items.length);
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
    return out;
  }

  // A listing card only shows one image. Fetch the product page and read its gallery so a card save
  // ends up with the same images as "Lấy sản phẩm này". Product URLs are same-origin with the
  // listing page, so this is an ordinary request the site already expects.
  async function enrichFromDetailPage(product) {
    if (!product || !/^https?:/i.test(product.url || '') || product.url === location.href) return product;
    let full = null;
    try {
      const res = await fetch(product.url); // same-origin, so the session cookie goes along
      if (!res.ok) return product;
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      full = extractDetail(site, doc, product.url);
    } catch (err) {
      console.warn('[POD Crawler] Không đọc được trang chi tiết', product.url, err);
      return product; // offline, blocked, or the marketplace answered with a captcha
    }
    if (!full) return product;
    return {
      ...product,
      images: full.images.length > product.images.length ? full.images : product.images,
      title: product.title || full.title,
      shop: product.shop || full.shop,
      description: product.description || full.description,
      tags: product.tags.length ? product.tags : full.tags,
    };
  }

  async function save(products, button, enrich = false) {
    if (button) {
      button.disabled = true;
      button.textContent = 'Đang lấy...';
    }
    try {
      if (enrich) products = await mapPooled(products, 3, enrichFromDetailPage);
      const res = await chrome.runtime.sendMessage({ type: 'SAVE_PRODUCTS', products });
      if (!res || !res.ok) throw new Error((res && res.error) || 'Lỗi không xác định');
      products.forEach((p) => savedKeys.add(p.key));
      toast(res.added ? `Đã lưu ${res.added} sản phẩm` : `Đã cập nhật ${res.updated} sản phẩm`);
    } catch (err) {
      const msg = /context invalidated/i.test(err.message)
        ? 'Extension vừa được cập nhật — hãy tải lại trang (F5)'
        : `Lỗi: ${err.message}`;
      toast(msg, true);
    } finally {
      if (button) button.disabled = false;
      refreshButtons();
    }
  }

  // ---------- "Get product" buttons on cards ----------
  function paintCardButton(btn) {
    const saved = savedKeys.has(btn.dataset.key);
    const label = saved ? '✓ Đã lấy sản phẩm' : '⬇ Get product';
    btn.classList.toggle('pcx-saved', saved);
    if (btn.textContent !== label) btn.textContent = label; // avoid needless DOM mutations
  }

  // Product ids the card itself points at right now. Marketplaces reuse a grid slot for a different
  // product when the list re-renders, so the id stored on the button can be out of date.
  function idsInCard(card) {
    const own = site.idFromCard && site.idFromCard(card);
    if (own) return new Set([own]);
    const anchors = [...(card.matches('a[href]') ? [card] : []), ...card.querySelectorAll('a[href]')];
    const ids = new Set();
    for (const a of anchors) {
      const id = site.idFromUrl(a.href);
      if (id) ids.add(id);
    }
    return ids;
  }

  function createCardButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pcx-get-btn';
    btn.dataset.pcxInstance = instance;
    // Keep the card's own link/handlers from reacting to our button.
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend']) {
      btn.addEventListener(type, (e) => e.stopPropagation());
    }
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const card = btn.parentElement;
      const ids = idsInCard(card);
      let id = btn.dataset.key.slice(site.key.length + 1);
      if (!ids.has(id) && ids.size) {
        if (ids.size > 1) return toast('Không xác định được sản phẩm này — hãy tải lại trang (F5)', true);
        id = [...ids][0]; // the slot now holds another product: follow the card, not the stale id
        btn.dataset.key = keyOf(id);
      }
      save([extractCard(site, card, id)], btn, true);
    });
    return btn;
  }

  function markCards() {
    if (!site) return;
    const pageId = currentPageId();
    const live = new Set();
    for (const [card, id] of findCards(site)) {
      if (id === pageId) continue;
      let btn = card.querySelector(':scope > .pcx-get-btn');
      if (btn && btn.dataset.pcxInstance !== instance) continue; // stale copy removes its own buttons
      if (!btn) {
        btn = createCardButton();
        // The button is overlaid on the card, so the card has to be the containing block.
        if (getComputedStyle(card).position === 'static') card.style.setProperty('position', 'relative', 'important');
        card.appendChild(btn);
      }
      if (btn.dataset.key !== keyOf(id)) btn.dataset.key = keyOf(id);
      live.add(btn);
      paintCardButton(btn);
    }
    // A button sitting on a card we no longer recognise is left over from an earlier render of that
    // slot — it would save whatever is in the slot now under the old product id.
    if (live.size) ownButtons().forEach((btn) => live.has(btn) || btn.remove());
  }

  // ---------- product detail page button ----------
  function updateDetailButton() {
    const id = currentPageId();
    detailBtn.hidden = isOpen || !id;
    if (!id || detailBtn.disabled) return;
    const saved = savedKeys.has(keyOf(id));
    detailBtn.classList.toggle('saved', saved);
    detailBtn.textContent = saved ? '✓ Đã lấy — cập nhật lại' : '⬇ Lấy sản phẩm này';
  }

  detailBtn.addEventListener('click', () => {
    const product = extractDetail(site);
    if (product) save([product], detailBtn);
  });

  const ownButtons = () => document.querySelectorAll(`.pcx-get-btn[data-pcx-instance="${instance}"]`);

  function refreshButtons() {
    ownButtons().forEach(paintCardButton);
    updateDetailButton();
  }

  async function collectAll() {
    if (!site) return [];
    const pageId = currentPageId();
    const products = [];
    const cards = [];
    const detail = extractDetail(site);
    if (detail) products.push(detail); // already read from the page itself, nothing to fetch
    for (const [card, id] of findCards(site)) {
      if (id === pageId) continue;
      try {
        cards.push(extractCard(site, card, id));
      } catch (err) {
        console.warn('[POD Crawler] Không đọc được sản phẩm', id, err);
      }
    }
    return products.concat(await mapPooled(cards, 3, enrichFromDetailPage));
  }

  // ---------- wiring ----------
  chrome.storage.local.get('products').then((r) => {
    savedKeys = new Set((r.products || []).map((p) => p.key));
    refreshButtons();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.products) return;
    savedKeys = new Set((changes.products.newValue || []).map((p) => p.key));
    refreshButtons();
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'TOGGLE_PANEL') {
      setOpen(!isOpen);
      sendResponse({ ok: true });
    } else if (msg.type === 'COLLECT_ALL') {
      collectAll().then((products) => sendResponse({ ok: true, products }));
      return true; // answered after the product pages have been fetched
    }
  });

  // Throttled rescans for infinite scroll / SPA navigation.
  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      if (!teardownIfOrphaned()) markCards();
    }, 800);
  }
  const observer = new MutationObserver(scheduleScan);
  if (site) observer.observe(document.body, { childList: true, subtree: true });

  let lastUrl = location.href;
  const urlTimer = setInterval(() => {
    if (teardownIfOrphaned() || location.href === lastUrl) return;
    lastUrl = location.href;
    updateDetailButton();
    scheduleScan();
  }, 1000);

  // After the extension is reloaded/updated this copy can no longer talk to it: remove its UI
  // so the fresh copy (injected on the next icon click or page load) takes over cleanly.
  function teardownIfOrphaned() {
    if (extensionAlive()) return false;
    observer.disconnect();
    clearInterval(urlTimer);
    clearTimeout(scanTimer);
    host.remove();
    ownButtons().forEach((btn) => btn.remove());
    return true;
  }

  markCards();
  updateDetailButton();
})();
