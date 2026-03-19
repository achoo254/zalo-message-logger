# Zalo Message Logger

Extension trình duyệt (Chrome/Edge) giúp ghi lại tin nhắn Zalo Web và gửi thông báo qua Telegram theo bộ lọc tùy chỉnh.

## Tính năng

- Tự động ghi lại tin nhắn từ cuộc trò chuyện đang mở và sidebar
- Lọc theo chiều (gửi/nhận), từ khóa, cuộc trò chuyện
- Xuất dữ liệu JSON để lưu trữ
- Gửi thông báo Telegram theo rules: user, keyword, conversation, content type

## Cài đặt

1. Tải mã nguồn: **Code → Download ZIP** hoặc `git clone`
2. Mở `chrome://extensions` → bật **Developer mode**
3. Nhấn **Load unpacked** → chọn thư mục `zalo-message-logger`

![Cài đặt extension](https://github.com/achoo254/zalo-message-logger/raw/main/docs/install.png)

## Sử dụng

1. Truy cập [chat.zalo.me](https://chat.zalo.me) — extension tự động ghi log
2. Click icon extension để xem tin nhắn, lọc và xuất JSON

![Giao diện popup](https://github.com/achoo254/zalo-message-logger/raw/main/docs/popup.png)

3. Tab **Telegram**: nhập Bot Token, Chat ID, thêm rules → **Save**

![Cài đặt Telegram](https://github.com/achoo254/zalo-message-logger/raw/main/docs/telegram.png)

## Yêu cầu

- Chrome hoặc Edge (Manifest v3)
- Đăng nhập [chat.zalo.me](https://chat.zalo.me)
