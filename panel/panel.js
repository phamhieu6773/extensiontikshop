const $ = (id) => document.getElementById(id);
const PAGE_SIZE = 100;

const state = {
  products: [],
  auth: null,
  query: '',
  site: '',
  limit: PAGE_SIZE,
  editing: null, // { key, images: [] }
};

// ---------- helpers ----------
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');

async function send(type, payload = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...payload });
  if (!res || !res.ok) throw new Error((res && res.error) || 'Lỗi không xác định');
  return res;
}

let toastTimer = null;
function toast(message, isError = false) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}

// Runs an async action while showing a busy label on the button.
async function withBusy(button, busyLabel, action) {
  button.dataset.busy = '1';
  button.disabled = true;
  button.textContent = busyLabel;
  try {
    await action();
  } catch (err) {
    toast(err.message, true);
  } finally {
    delete button.dataset.busy;
    render();
  }
}

// Updates a toolbar button unless it is showing a busy state.
function setButton(button, text, disabled) {
  if (button.dataset.busy) return;
  button.textContent = text;
  button.disabled = disabled;
}

function confirmBox(message, okLabel = 'Đồng ý') {
  return new Promise((resolve) => {
    const dialog = $('confirmDialog');
    $('confirmText').textContent = message;
    $('btnConfirmYes').textContent = okLabel;
    const done = (value) => {
      dialog.close();
      $('btnConfirmYes').onclick = $('btnConfirmNo').onclick = dialog.oncancel = null;
      resolve(value);
    };
    $('btnConfirmYes').onclick = () => done(true);
    $('btnConfirmNo').onclick = () => done(false);
    dialog.oncancel = () => done(false);
    dialog.showModal();
  });
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function imageExt(url) {
  const m = String(url).match(/\.(jpe?g|png|webp|gif|avif)(?:$|[?#])/i);
  return m ? m[1].toLowerCase() : 'jpg';
}

async function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

// ---------- rendering ----------
function visibleProducts() {
  const q = PCX.normalizeTitle(state.query);
  return state.products.filter(
    (p) =>
      (!state.site || p.site === state.site) &&
      (!q || PCX.normalizeTitle(`${p.title} ${p.shop} ${p.productId}`).includes(q))
  );
}

function starsHtml(rating) {
  if (rating == null || Number.isNaN(rating)) return '';
  const full = Math.max(0, Math.min(5, Math.round(rating)));
  return `<span class="stars" title="${rating}/5">${'★'.repeat(full)}${'☆'.repeat(5 - full)}</span> <span class="muted">${rating}</span>`;
}

function productHtml(p) {
  const image = (p.images || [])[0];
  const url = safeUrl(p.url);
  const rating = starsHtml(p.rating);
  return `
    <li class="product" data-key="${esc(p.key)}">
      <a class="thumb" href="${esc(url)}" target="_blank" rel="noopener">
        ${image ? `<img src="${esc(safeUrl(image))}" loading="lazy" referrerpolicy="no-referrer" alt="">` : 'Không có ảnh'}
      </a>
      <div class="info">
        <a class="title" href="${esc(url)}" target="_blank" rel="noopener" title="${esc(p.title)}">${esc(p.title || '(Không có tiêu đề)')}</a>
        <div class="meta">
          <span class="tag">${esc(PCX.SITE_NAMES[p.site] || p.site)}</span>
          ${p.priceText ? `<span class="price">${esc(p.priceText)}</span>` : ''}
          ${p.shop ? `<span class="muted">Shop: ${esc(p.shop)}</span>` : ''}
          <span class="muted">${(p.images || []).length} ảnh</span>
          ${p.editedAt ? '<span class="tag edited">Đã sửa</span>' : ''}
          ${p.syncedAt ? '<span class="tag ok">Đã đồng bộ</span>' : ''}
        </div>
        ${rating || p.reviews ? `<div class="rating-row">${rating}${p.reviews ? ` <span class="muted">(${esc(p.reviews)} đánh giá)</span>` : ''}</div>` : ''}
        <div class="row-actions">
          <button class="btn primary sm" data-action="edit">Sửa</button>
          <button class="btn danger sm" data-action="delete">Xoá</button>
        </div>
      </div>
    </li>`;
}

function renderWelcome() {
  const el = $('welcome');
  if (!state.auth) {
    el.innerHTML = '<span>👋 Xin chào, Khách</span><span class="muted">Đăng nhập để bắt đầu</span>';
    return;
  }
  const where = state.auth.offline ? 'Offline' : new URL(state.auth.serverUrl).host;
  el.innerHTML = `<span>👋 Chào mừng trở lại, <b>${esc(state.auth.name)}</b> <span class="muted">(${esc(where)})</span></span>
    <button class="link-btn" id="btnLogout" type="button">Đăng xuất</button>`;
  $('btnLogout').onclick = async () => {
    if (await confirmBox('Đăng xuất khỏi tài khoản? Sản phẩm đã lấy vẫn được giữ lại.', 'Đăng xuất')) send('LOGOUT');
  };
}

function renderSiteFilter() {
  const select = $('siteFilter');
  const sites = [...new Set(state.products.map((p) => p.site))];
  const options = ['<option value="">Tất cả sàn</option>']
    .concat(sites.map((s) => `<option value="${esc(s)}">${esc(PCX.SITE_NAMES[s] || s)} (${state.products.filter((p) => p.site === s).length})</option>`))
    .join('');
  if (select.innerHTML !== options) {
    select.innerHTML = options;
    if (!sites.includes(state.site)) state.site = '';
    select.value = state.site;
  }
}

function render() {
  const loggedIn = Boolean(state.auth);
  $('loginView').hidden = loggedIn;
  $('mainView').hidden = !loggedIn;
  $('footer').hidden = !loggedIn;
  renderWelcome();
  if (!loggedIn) return;

  renderSiteFilter();
  const items = visibleProducts();
  const filtered = Boolean(state.query || state.site);
  const duplicates = PCX.findDuplicateKeys(state.products).length;
  const pending = state.products.filter((p) => !p.syncedAt).length;

  setButton($('btnGetAll'), 'Lấy tất cả sản phẩm', false);
  setButton($('btnDeleteAll'), `${filtered ? 'Xoá đang lọc' : 'Xoá tất cả'} (${items.length})`, !items.length);
  setButton($('btnDedupe'), `Xoá trùng lặp (${duplicates})`, !duplicates);
  setButton($('btnExport'), `Xuất sản phẩm (${items.length}) ▾`, !items.length);
  setButton($('btnSync'), `Đồng bộ lên server (${pending})`, state.auth.offline || !pending);
  $('btnSync').title = state.auth.offline ? 'Đang dùng offline — đăng nhập với server để đồng bộ' : '';
  $('btnGetAll').title = 'Lấy mọi sản phẩm đang hiển thị trên trang';

  $('list').innerHTML = items.slice(0, state.limit).map(productHtml).join('');
  $('btnMore').hidden = items.length <= state.limit;
  $('btnMore').textContent = `Xem thêm (${items.length - state.limit})`;

  const empty = $('empty');
  empty.hidden = items.length > 0;
  empty.textContent = state.products.length
    ? 'Không có sản phẩm nào khớp bộ lọc.'
    : 'Chưa có sản phẩm. Mở trang Etsy, Amazon, eBay... rồi bấm "Get product" trên từng sản phẩm hoặc "Lấy tất cả sản phẩm".';
}

// ---------- login ----------
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = $('loginError');
  errorEl.hidden = true;
  const button = $('btnLogin');
  button.disabled = true;
  button.textContent = 'Đang đăng nhập...';
  try {
    await send('LOGIN', { apiKey: $('apiKey').value, serverUrl: $('serverUrl').value });
    $('apiKey').value = '';
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = 'Đăng nhập';
  }
});

$('btnOffline').addEventListener('click', () => send('LOGIN', { offline: true }).catch((err) => toast(err.message, true)));

// ---------- toolbar ----------
$('btnGetAll').addEventListener('click', (e) =>
  withBusy(e.currentTarget, 'Đang lấy...', async () => {
    const res = await send('COLLECT_IN_TAB');
    if (!res.found) return toast('Không tìm thấy sản phẩm nào trên trang này', true);
    toast(`Tìm thấy ${res.found} sản phẩm: thêm mới ${res.added}, cập nhật ${res.updated}`);
  })
);

$('btnDeleteAll').addEventListener('click', async (e) => {
  const button = e.currentTarget; // capture now: currentTarget is null once we await below
  const items = visibleProducts();
  if (!(await confirmBox(`Xoá ${items.length} sản phẩm? Không thể hoàn tác.`, 'Xoá'))) return;
  withBusy(button, 'Đang xoá...', async () => {
    const res = await send('DELETE_PRODUCTS', { keys: items.map((p) => p.key) });
    toast(`Đã xoá ${res.removed} sản phẩm`);
  });
});

$('btnDedupe').addEventListener('click', (e) =>
  withBusy(e.currentTarget, 'Đang xoá...', async () => {
    const res = await send('DELETE_DUPLICATES');
    toast(`Đã xoá ${res.removed} sản phẩm trùng lặp`);
  })
);

$('btnExport').addEventListener('click', (e) => {
  e.stopPropagation();
  $('exportMenu').hidden = !$('exportMenu').hidden;
});
document.addEventListener('click', () => ($('exportMenu').hidden = true));

$('exportMenu').addEventListener('click', async (e) => {
  const kind = e.target.closest('[data-export]')?.dataset.export;
  if (!kind) return;
  $('exportMenu').hidden = true;
  const items = visibleProducts();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  try {
    if (kind === 'csv') {
      await downloadBlob(new Blob([PCX.toCSV(items)], { type: 'text/csv;charset=utf-8' }), `products-${stamp}.csv`);
      toast(`Đã xuất ${items.length} sản phẩm ra CSV`);
    } else if (kind === 'json') {
      await downloadBlob(new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' }), `products-${stamp}.json`);
      toast(`Đã xuất ${items.length} sản phẩm ra JSON`);
    } else if (kind === 'images') {
      let count = 0;
      for (const p of items) {
        const folder = `pod-crawler/${[slugify(p.title), p.productId].filter(Boolean).join('-')}`;
        (p.images || []).forEach((url, i) => {
          if (safeUrl(url) === '#') return;
          chrome.downloads.download({ url, filename: `${folder}/${i + 1}.${imageExt(url)}`, conflictAction: 'uniquify', saveAs: false });
          count++;
        });
      }
      toast(`Đang tải ${count} ảnh vào thư mục Downloads/pod-crawler`);
    }
  } catch (err) {
    toast(`Lỗi xuất file: ${err.message}`, true);
  }
});

$('search').addEventListener('input', (e) => {
  state.query = e.target.value;
  state.limit = PAGE_SIZE;
  render();
});
$('siteFilter').addEventListener('change', (e) => {
  state.site = e.target.value;
  state.limit = PAGE_SIZE;
  render();
});
$('btnMore').addEventListener('click', () => {
  state.limit += PAGE_SIZE;
  render();
});
$('btnTop').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

$('btnSync').addEventListener('click', (e) =>
  withBusy(e.currentTarget, 'Đang đồng bộ...', async () => {
    const res = await send('SYNC');
    toast(`Đã đồng bộ ${res.synced} sản phẩm lên server`);
  })
);

// ---------- product list actions ----------
$('list').addEventListener('click', async (e) => {
  const button = e.target.closest('[data-action]');
  if (!button) return;
  const key = button.closest('.product').dataset.key;
  const product = state.products.find((p) => p.key === key);
  if (!product) return;
  if (button.dataset.action === 'delete') {
    if (await confirmBox(`Xoá sản phẩm "${product.title.slice(0, 80)}"?`, 'Xoá')) {
      send('DELETE_PRODUCTS', { keys: [key] }).catch((err) => toast(err.message, true));
    }
  } else if (button.dataset.action === 'edit') {
    openEditor(product);
  }
});

// ---------- editor ----------
function renderEditImages() {
  const images = state.editing.images;
  $('imgCount').textContent = images.length;
  $('editImages').innerHTML = images
    .map(
      (url, i) => `
      <div class="img-item ${i === 0 ? 'main' : ''}">
        <img src="${esc(safeUrl(url))}" referrerpolicy="no-referrer" alt="">
        <div class="img-actions">
          ${i === 0 ? '<button type="button" disabled>Chính</button>' : `<button type="button" data-main="${i}">Đặt chính</button>`}
          <button type="button" class="remove" data-remove="${i}" title="Xoá ảnh">✕</button>
        </div>
      </div>`
    )
    .join('');
}

function openEditor(product) {
  state.editing = { key: product.key, images: [...(product.images || [])], original: product };
  const f = $('editForm').elements;
  f.title.value = product.title || '';
  f.price.value = product.price ?? '';
  f.currency.value = product.currency || '';
  f.shop.value = product.shop || '';
  f.tags.value = (product.tags || []).join(', ');
  f.description.value = product.description || '';
  $('newImage').value = '';
  renderEditImages();
  $('editDialog').showModal();
}

$('editImages').addEventListener('click', (e) => {
  const images = state.editing.images;
  const main = e.target.closest('[data-main]');
  const remove = e.target.closest('[data-remove]');
  if (main) images.unshift(...images.splice(Number(main.dataset.main), 1));
  if (remove) images.splice(Number(remove.dataset.remove), 1);
  renderEditImages();
});

$('btnAddImage').addEventListener('click', () => {
  const url = $('newImage').value.trim();
  if (!/^https?:\/\//i.test(url)) return toast('Link ảnh phải bắt đầu bằng http:// hoặc https://', true);
  if (!state.editing.images.includes(url)) state.editing.images.push(url);
  $('newImage').value = '';
  renderEditImages();
});

$('btnCancelEdit').addEventListener('click', () => $('editDialog').close());

$('editForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget.elements;
  const { original, key, images } = state.editing;
  const price = f.price.value === '' ? null : Number(f.price.value);
  const currency = f.currency.value.trim();
  const priceChanged = price !== original.price || currency !== (original.currency || '');
  const changes = {
    title: f.title.value.trim(),
    price,
    currency,
    priceText: priceChanged ? (price == null ? '' : `${price.toLocaleString('en-US')} ${currency}`.trim()) : original.priceText,
    shop: f.shop.value.trim(),
    tags: f.tags.value.split(',').map((t) => t.trim()).filter(Boolean),
    description: f.description.value.trim(),
    images,
  };
  try {
    await send('UPDATE_PRODUCT', { key, changes });
    $('editDialog').close();
    toast('Đã lưu thay đổi');
  } catch (err) {
    toast(err.message, true);
  }
});

// ---------- init ----------
async function init() {
  $('version').textContent = `v${chrome.runtime.getManifest().version}`;
  const data = await chrome.storage.local.get(['products', 'auth', 'lastServerUrl']);
  state.products = data.products || [];
  state.auth = data.auth || null;
  if (data.lastServerUrl) $('serverUrl').value = data.lastServerUrl;
  render();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.products) state.products = changes.products.newValue || [];
  if (changes.auth) state.auth = changes.auth.newValue || null;
  if (changes.products || changes.auth) render();
});

init();
