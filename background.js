importScripts('lib/common.js');

// All writes to the product list go through this queue so concurrent saves can't overwrite each other.
let queue = Promise.resolve();
function serial(task) {
  const run = queue.then(task);
  queue = run.catch(() => {});
  return run;
}

const getProducts = async () => (await chrome.storage.local.get('products')).products || [];
const setProducts = (products) => chrome.storage.local.set({ products });
const getAuth = async () => (await chrome.storage.local.get('auth')).auth || null;

// Các route dành cho extension trên backend TikShop (xác thực bằng API key)
const API_BASE = '/api/v1/extension';

// Máy chủ nhận dữ liệu đồng bộ — cố định, người dùng không cần nhập. Đổi khi deploy.
const SERVER_URL = 'https://app.tiktrawl.com';

function isEmpty(value) {
  return value === '' || value == null || (Array.isArray(value) && value.length === 0);
}

function mergeProduct(old, incoming) {
  if (old.editedAt) return old; // never clobber manual edits
  const merged = { ...old };
  for (const [k, v] of Object.entries(incoming)) {
    if (!isEmpty(v)) merged[k] = v;
  }
  // A detail page yields more images than a listing card — keep the richer set.
  if ((old.images || []).length > (incoming.images || []).length) merged.images = old.images;
  merged.createdAt = old.createdAt;
  merged.updatedAt = Date.now();
  merged.syncedAt = null;
  return merged;
}

async function api(serverUrl, apiKey, path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(serverUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-API-Key': apiKey,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(`Không kết nối được server (${err.message})`);
  }
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    // non-JSON response
  }
  if (!res.ok) {
    // Backend NestJS: { message: 'mô tả' | ['...'], error: 'Unauthorized' } — message dễ hiểu hơn
    const message = Array.isArray(data.message) ? data.message.join(', ') : data.message;
    throw new Error(message || data.error || `Server trả về lỗi ${res.status}`);
  }
  return data;
}

const handlers = {
  SAVE_PRODUCTS({ products }) {
    return serial(async () => {
      const list = await getProducts();
      const index = new Map(list.map((p, i) => [p.key, i]));
      const fresh = new Map();
      const now = Date.now();
      let updated = 0;
      for (const p of products || []) {
        if (!p || !p.key) continue;
        if (index.has(p.key)) {
          const i = index.get(p.key);
          list[i] = mergeProduct(list[i], p);
          updated++;
        } else if (!fresh.has(p.key)) {
          fresh.set(p.key, { ...p, createdAt: now, syncedAt: null });
        }
      }
      await setProducts([...fresh.values(), ...list]);
      return { added: fresh.size, updated };
    });
  },

  UPDATE_PRODUCT({ key, changes }) {
    return serial(async () => {
      const list = await getProducts();
      const product = list.find((p) => p.key === key);
      if (!product) throw new Error('Không tìm thấy sản phẩm');
      Object.assign(product, changes, { editedAt: Date.now(), syncedAt: null });
      await setProducts(list);
      return {};
    });
  },

  DELETE_PRODUCTS({ keys }) {
    const remove = new Set(keys);
    return serial(async () => {
      const list = await getProducts();
      const next = list.filter((p) => !remove.has(p.key));
      await setProducts(next);
      return { removed: list.length - next.length };
    });
  },

  DELETE_DUPLICATES() {
    return serial(async () => {
      const list = await getProducts();
      const duplicates = new Set(PCX.findDuplicateKeys(list));
      await setProducts(list.filter((p) => !duplicates.has(p.key)));
      return { removed: duplicates.size };
    });
  },

  // Sent by the panel: ask the page to collect every product it shows.
  // From the in-page iframe that is the sender's tab; from Chrome's side panel it is the active tab.
  async COLLECT_IN_TAB(_msg, sender) {
    let tabId = sender.tab?.id;
    if (tabId == null) {
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      tabId = active?.id;
    }
    let res = null;
    try {
      res = await chrome.tabs.sendMessage(tabId, { type: 'COLLECT_ALL' }, { frameId: 0 });
    } catch {
      // no content script in this tab
    }
    if (!res) throw new Error('Trang này chưa được hỗ trợ hoặc cần tải lại trang (F5).');
    const products = res.products || [];
    if (!products.length) return { found: 0, added: 0, updated: 0 };
    return { found: products.length, ...(await handlers.SAVE_PRODUCTS({ products })) };
  },

  async LOGIN({ apiKey, offline }) {
    let auth;
    if (offline) {
      auth = { offline: true, name: 'Offline' };
    } else {
      apiKey = String(apiKey || '').trim();
      if (!apiKey) throw new Error('Vui lòng nhập API Key');
      const me = await api(SERVER_URL, apiKey, `${API_BASE}/me`);
      auth = { offline: false, apiKey, serverUrl: SERVER_URL, name: me.name || me.username || 'User', plan: me.plan || '' };
    }
    await chrome.storage.local.set({ auth });
    return { auth };
  },

  async LOGOUT() {
    await chrome.storage.local.remove('auth');
    return {};
  },

  async SYNC() {
    const auth = await getAuth();
    if (!auth || auth.offline) throw new Error('Cần đăng nhập với server để đồng bộ');
    const pending = (await getProducts()).filter((p) => !p.syncedAt);
    let synced = 0;
    for (let i = 0; i < pending.length; i += 50) {
      const batch = pending.slice(i, i + 50);
      await api(SERVER_URL, auth.apiKey, `${API_BASE}/products`, { method: 'POST', body: { products: batch } });
      const keys = new Set(batch.map((p) => p.key));
      const now = Date.now();
      await serial(async () => {
        const list = await getProducts();
        for (const p of list) if (keys.has(p.key)) p.syncedAt = now;
        await setProducts(list);
      });
      synced += batch.length;
    }
    return { synced };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = handlers[msg && msg.type];
  if (!handler) return false;
  Promise.resolve()
    .then(() => handler(msg, sender))
    .then(
      (result) => sendResponse({ ok: true, ...result }),
      (err) => sendResponse({ ok: false, error: String((err && err.message) || err) })
    );
  return true;
});

const CONTENT_SCRIPTS = ['content/sites.js', 'content/extract.js', 'content/content.js'];

// Pages where Chrome forbids injecting anything.
function canInject(url) {
  return /^https?:/i.test(url || '') && !/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i.test(url);
}

async function toggleOverlay(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_PANEL' }, { frameId: 0 });
    return;
  } catch {
    // Not injected yet: tab opened before install/reload, or a site not listed in the manifest.
  }
  await chrome.scripting.insertCSS({ target: { tabId }, files: ['content/content.css'] });
  await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_SCRIPTS });
  await chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_PANEL' }, { frameId: 0 });
}

chrome.action.onClicked.addListener((tab) => {
  if (!canInject(tab.url)) {
    // Must be called synchronously inside the click gesture.
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
    return;
  }
  toggleOverlay(tab.id).then(() => chrome.action.setBadgeText({ text: '', tabId: tab.id })).catch((err) => {
    console.warn('[POD Crawler] Không mở được panel trên trang này', err);
    chrome.action.setBadgeBackgroundColor({ color: '#dc2626', tabId: tab.id });
    chrome.action.setBadgeText({ text: '!', tabId: tab.id });
    chrome.action.setTitle({ title: 'POD Crawler không chạy được trên trang này', tabId: tab.id });
  });
});
