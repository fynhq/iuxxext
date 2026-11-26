<a id="english"></a>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="src/icons/logo-dark-1024.png">
    <source media="(prefers-color-scheme: light)" srcset="src/icons/logo-light-1024.png">
    <img src="src/icons/logo-light-1024.png" alt="IUxx logo" width="128">
  </picture>
</p>

# IUxx

IUxx is a Firefox extension that hides any element on a web page. Click the element, widen or narrow the selection to the container you want gone, and confirm. IUxx stores a CSS selector for that host and applies it on every visit, so blocked elements stay hidden after reloads.

It supports Firefox 140+ on Windows, macOS and Linux, and Firefox for Android 142+.

English | [中文](#chinese)

## Install

**From addons.mozilla.org** — The AMO listing will be linked here once the first version is published.

## Usage

- Start the picker from the toolbar popup (**Select an element to block**), with `Ctrl+Alt+X` (`Ctrl+Cmd+X` on macOS), or from the right-click menu (**Block this element (IUxx)**).
- Hover to highlight an element and click to select it. Use **Expand** (`↑`), **Shrink** (`↓`), **Reselect**, and **Block** (`Enter`); press `Esc` or **Exit** to cancel. On touch screens the same buttons appear on a bottom panel.
- A toast offers **Undo** after blocking. Blocked elements stay hidden after reloads.
- The popup switch enables or disables blocking for the current site. Turning it off adds the site to the whitelist; turning it back on removes whitelist entries that cover the host.
- The popup lists the current site's rules; **Settings** opens the options page for the whitelist and all rules.
- Whitelist entries cover subdomains: `example.com` covers `www.example.com`. Rules are stored per host, up to 300 per host, and blocking applies to the top-level document.
- All settings stay local; there is no account, telemetry, or cloud service.

## Permissions

- `storage` — save rules and the whitelist locally.
- `menus` — add the right-click menu entry.
- `scripting` — inject the picker into an already-open tab when needed.
- `activeTab` — start the picker in the current tab from the popup or the shortcut.
- Host access — apply saved rules when pages load. The DOM is read locally only to highlight elements, generate selectors, and hide them; nothing is transmitted.
- Optional host access — if Firefox hasn't granted host access, the popup offers to grant it so the picker can run on an already-open page.

## Privacy

IUxx does not collect or transmit personal data. The manifest declares:

```json
"data_collection_permissions": {
  "required": ["none"]
}
```

Rules, the whitelist, and a small per-host selector cache stay in local storage. The cache is written to the site's own `localStorage` so rules apply before the extension finishes loading. The extension makes no network requests.

## Build from source

`src/` is the extension; there is no build or transpile step. Node.js is only needed for `web-ext`.

```sh
npx web-ext@10 lint --source-dir src
npx web-ext@10 run --source-dir src
npx web-ext@10 build --source-dir src --overwrite-dest
```

Packages are written to `web-ext-artifacts/`.

## License

Released under the MIT License. See [LICENSE](LICENSE).

---

<a id="chinese"></a>

# IUxx

IUxx 是一个 Firefox 扩展：点选网页上的任意元素，调整范围后确认屏蔽；扩展会为该网站保存一条 CSS 选择器，之后每次访问都会自动隐藏对应元素，刷新后依然生效。

支持 Firefox 140+ 的 Windows、macOS、Linux 桌面版，以及 Firefox for Android 142+。

[English](#english) | 中文

## 安装

**从 addons.mozilla.org 安装** — 首个版本发布后，这里会补上 AMO 链接。

## 使用

- 从工具栏弹窗点击 **选择要屏蔽的元素** 启动选择器，也可以按 `Ctrl+Alt+X`（macOS 为 `Ctrl+Cmd+X`），或在页面右键菜单中选择 **屏蔽此元素（IUxx）**。
- 移动鼠标高亮元素，点击选中；用 **扩大范围**（`↑`）、**缩小范围**（`↓`）、**重选**、**屏蔽**（`Enter`）操作，按 `Esc` 或 **退出** 取消。触屏设备上按钮显示在底部面板中。
- 屏蔽后会弹出 **撤销** 提示；已屏蔽元素刷新后仍然隐藏。
- 弹窗开关控制当前网站是否屏蔽。关闭会把网站加入白名单；重新打开会移除覆盖该主机的白名单条目。
- 弹窗列出当前网站的规则；**设置** 打开选项页，可管理白名单和全部规则。
- 白名单覆盖子域名：`example.com` 会覆盖 `www.example.com`。规则按主机保存，每个主机最多 300 条；屏蔽作用于顶层文档。
- 所有设置都保存在本地；没有账号、遥测或云服务。

## 权限

- `storage` — 本地保存屏蔽规则和白名单。
- `menus` — 添加右键菜单项。
- `scripting` — 需要时向已打开的标签页注入选择器。
- `activeTab` — 从弹窗或快捷键在当前标签页启动选择器。
- 主机权限 — 页面加载时应用已保存的规则。DOM 只在本地读取，用于高亮、生成选择器和隐藏元素，不会发送任何内容。
- 可选主机权限 — 如果 Firefox 尚未授予主机访问权限，弹窗会提供授权入口，以便在已打开的页面上运行选择器。

## 隐私

IUxx 不收集、不上传个人数据。manifest 中声明：

```json
"data_collection_permissions": {
  "required": ["none"]
}
```

规则、白名单和按主机保存的小型选择器缓存只保存在本地存储中；缓存会写入网站自己的 `localStorage`，以便在扩展加载完成前应用规则。扩展不发起网络请求。

## 从源码构建

`src/` 就是扩展本身，没有构建或转译步骤。Node.js 仅用于 `web-ext`。

```sh
npx web-ext@10 lint --source-dir src
npx web-ext@10 run --source-dir src
npx web-ext@10 build --source-dir src --overwrite-dest
```

打包结果输出到 `web-ext-artifacts/`。

## 许可

基于 MIT 许可发布，见 [LICENSE](LICENSE)。
