# POD Crawler — Chrome Extension

Lấy sản phẩm từ **Etsy, Amazon, eBay, Redbubble, SHEIN, AliExpress, TikTok Shop**, quản lý, sửa, xuất file và đồng bộ lên server của bạn.

## Cài vào Chrome

1. Mở `chrome://extensions`
2. Bật **Developer mode** (Chế độ nhà phát triển) ở góc trên bên phải
3. Bấm **Load unpacked** (Tải tiện ích đã giải nén) → chọn thư mục `C:\extension`
4. Ghim icon **P** màu xanh lên thanh công cụ cho tiện
5. **Tải lại (F5)** các tab Etsy/Amazon... đang mở sẵn

Sau khi sửa code: vào `chrome://extensions` → bấm nút ⟳ trên extension → F5 lại trang web.

## Cách dùng

- **Nút tròn xanh** ở góc phải trang: mở/đóng panel (hoặc bấm icon extension trên thanh công cụ).
  Panel luôn nổi ngay trên trang đang xem, trên mọi trang web. Riêng các trang của Chrome (`chrome://`, Chrome Web Store) không cho chèn giao diện nên panel mở ở thanh bên (Side Panel).
- **Đăng nhập**: nhập API Key (lấy trên web TikShop: menu **Tài khoản → API key extension**). Server URL được fix cứng trong hằng `SERVER_URL` ở `background.js` (`https://app.tiktrawl.com`; đổi sang `http://localhost:9000` khi chạy máy local), hoặc bấm **Dùng offline** nếu chỉ cần lấy và xuất file.
- **⬇ Get product** trên ảnh mỗi sản phẩm: lưu sản phẩm đó. Extension tự mở trang chi tiết ở nền để lấy **đủ bộ ảnh**, nên mất một hai giây.
- **⬇ Lấy sản phẩm này** (khi đang ở trang chi tiết sản phẩm): lưu ngay từ trang đang xem — đủ ảnh, mô tả.
- **Lấy tất cả sản phẩm**: lưu mọi sản phẩm đang hiển thị trên trang (cuộn hết trang trước để trang tải đủ). Cũng lấy đủ ảnh từng sản phẩm, mỗi lúc 3 sản phẩm để sàn không chặn — trang nhiều sản phẩm sẽ chờ lâu hơn.
- **Sửa**: đổi tiêu đề, giá, tags, mô tả, thêm/xoá ảnh, chọn ảnh chính.
- **Xoá trùng lặp**: xoá sản phẩm trùng tiêu đề hoặc trùng ảnh chính (giữ bản lấy trước).
- **Xuất sản phẩm**: CSV (mở bằng Excel), JSON, hoặc tải toàn bộ ảnh về `Downloads/pod-crawler/`.
- **Tìm kiếm / lọc theo sàn**: các nút Xoá / Xuất chỉ áp dụng cho danh sách đang lọc.
- **Đồng bộ lên server**: gửi các sản phẩm chưa đồng bộ lên server.

Lấy lại một sản phẩm đã có sẽ cập nhật dữ liệu mới, trừ khi bạn đã sửa tay sản phẩm đó.

## Server API

Extension gọi server của bạn với header `Authorization: Bearer <API_KEY>` và `X-API-Key: <API_KEY>`:

| Method | Đường dẫn | Mô tả | Trả về |
|---|---|---|---|
| GET | `/api/v1/extension/me` | Kiểm tra API key khi đăng nhập | `{ "name": "Tên hiển thị" }` (sai key → mã lỗi 401 + `{ "error": "..." }`) |
| POST | `/api/v1/extension/products` | Gửi sản phẩm, mỗi lần tối đa 50 | Mã 2xx bất kỳ |

Body của `POST /api/v1/extension/products`:

```json
{
  "products": [
    {
      "key": "etsy:1234567890",
      "site": "etsy",
      "productId": "1234567890",
      "url": "https://www.etsy.com/listing/1234567890/...",
      "title": "Freedom Hoodie",
      "price": 440496,
      "currency": "VND",
      "priceText": "440,496₫",
      "rating": 4.9,
      "reviews": "1.6k",
      "shop": "Nobleartgoods",
      "description": "",
      "tags": [],
      "images": ["https://i.etsystatic.com/.../il_fullxfull....jpg"],
      "createdAt": 1757900000000
    }
  ]
}
```

### Thử với server mẫu

```
node server-example/server.js
```

Sau đó đăng nhập trong panel với **Server URL** `http://localhost:3000` và **API Key** `demo-key`. Dữ liệu đồng bộ được lưu vào `server-example/products.json`. Có thể đổi bằng biến môi trường `PORT` và `API_KEY`.

## Cấu trúc

```
manifest.json          Cấu hình extension (Manifest V3)
background.js          Lưu trữ, đăng nhập, đồng bộ
lib/common.js          Hàm dùng chung: tìm trùng lặp, xuất CSV
content/sites.js       Quy tắc từng sàn (link sản phẩm, selector, link ảnh lớn)
content/extract.js     Đọc dữ liệu sản phẩm từ trang
content/content.js     Nút "Get product", nút tròn, panel
content/content.css    Giao diện nút "Get product"
panel/                 Giao diện panel (HTML/CSS/JS)
server-example/        Server mẫu để thử đồng bộ
```

## Khi một sàn không lấy được

Các sàn thường xuyên đổi giao diện. Mở `content/sites.js` và sửa quy tắc của sàn đó:

- `idFromUrl`: regex lấy ID sản phẩm từ link
- `cardSelector`: selector khung sản phẩm trên trang danh sách (bỏ trống thì extension tự dò theo link)
- `card.title` / `card.price`: selector tiêu đề và giá
- `bigImage`: đổi link ảnh nhỏ thành ảnh lớn
- `detail`: selector cho trang chi tiết sản phẩm
- `detail.images`: nơi lấy **toàn bộ ảnh** — trả về danh sách link ảnh trong khung carousel của sàn.
  Dùng `galleryImages(doc, [danh sách selector], /mẫu link ảnh/)`: nó thử từng selector đến khi có ảnh,
  đọc cả các thuộc tính lazy (`data-src-delay`...) và cả ảnh thumbnail (`bigImage` sẽ quy về ảnh gốc rồi
  khử trùng lặp). Phải bó vào đúng khung ảnh sản phẩm, nếu không ảnh của "sản phẩm tương tự" sẽ lẫn vào.

Bấm F12 → tab Console trên trang để xem lỗi (nếu có).
