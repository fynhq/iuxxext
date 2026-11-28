<a id="english"></a>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-white-1024.png">
    <source media="(prefers-color-scheme: light)" srcset="assets/logo-black-1024.png">
    <img src="assets/logo-black-1024.png" alt="IUxx logo" width="128">
  </picture>
</p>

# IUxx

**Less noise, more calm.**

IUxx is a Firefox extension that hides elements on web pages. Pick an element, choose whether to match just it or similar elements, optionally widen to a parent, preview the result, and confirm. Rules are saved per host, domain, path, or for all websites, and are applied on every visit.

It supports Firefox 140+ on Windows, macOS and Linux, and Firefox for Android 142+.

English | [中文](#chinese)

## Install

**From addons.mozilla.org** — [IUxx on Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/iuxx/)

## Usage

- Start the picker from the toolbar popup (**Select an element to block**), with `Ctrl+Alt+X` (`Ctrl+Cmd+X` on macOS), or from the right-click menu (**Block this element (IUxx)**).
- Hover to highlight an element and click to select it. Use **Expand** (`↑`), **Shrink** (`↓`), **Reselect**, and **Block** (`Enter`); press `Esc` or **Exit** to cancel. On touch screens the same buttons appear on a bottom panel.
- The panel shows how many elements the current selector matches. **Match similar elements** switches to a broader selector, **Only this element** returns to the unique one, and the selector text can be edited directly. **Preview** hides the current matches before saving. Choose a scope (this host only, host and subdomains, or all websites) and, optionally, **This path only**.
- A toast offers **Undo** after blocking. Blocked elements stay hidden after reloads.
- **Temporary hiding** works without saving a rule: open the popup and click **Hide temporarily**, or use **Temporarily hide this element (IUxx)** in the right-click menu. Click elements (or press `Delete` over the highlighted element) to remove them; use Undo in the toast. Reloading the page restores everything. Temporary hiding works even when the site is on the exceptions list.
- The popup switch enables or disables blocking for the current site. Turning it off adds the site to the exceptions; turning it back on removes exception entries that cover the host.
- The popup lists rules that apply to the current site, with scope and path badges. Enable or disable a rule with its checkbox, or delete it; deletion can be undone.
- **Settings** offers the exceptions list, manual rule creation and editing, search across rules, JSON import/export, and a **Keep the picker open after blocking** option. Nothing is uploaded or synced.
- Exception entries cover subdomains. A host rule applies to that exact host; a domain rule applies to the host and its subdomains; a global rule applies to every site. A path prefix limits a rule to that path and its subpaths. Rules per site anchor are capped at 1000 and 5000 in total, with warnings before the limits.
- Rules apply to the top-level document. Elements inside iframes cannot be targeted, although the iframe element itself can be hidden. Selecting an element inside an open shadow root hides its shadow host.
- All settings stay local; there is no account, telemetry, or cloud service.

## Permissions

- `storage` — save rules, exceptions, and settings locally.
- `menus` — add the right-click menu entries.
- `scripting` — inject the picker into an already-open tab, and apply saved rules as a user stylesheet when pages load.
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

Rules, exceptions, and settings are stored only in the extension's local storage; nothing is written into a website's own storage. Saved rules are applied as a browser user stylesheet when pages load, so page scripts cannot remove or override them. The extension makes no network requests. Import and export use local JSON files only; there is no cloud sync.

## Build from source

`src/` is the extension; there is no build or transpile step. Node.js is used for tests and `web-ext`.

```sh
npm test
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

**删繁就简，一页清欢。**

IUxx 是一个 Firefox 扩展：点选网页上的任意元素即可屏蔽，可以选择只屏蔽该元素，或匹配同类元素，也可以调整到上级容器；保存前可预览效果。规则可按主机、域名、路径或所有网站保存，之后每次访问都会自动生效。

支持 Firefox 140+ 的 Windows、macOS、Linux 桌面版，以及 Firefox for Android 142+。

[English](#english) | 中文

## 安装

**从 addons.mozilla.org 安装** — [Firefox 附加组件商店上的 IUxx](https://addons.mozilla.org/zh-CN/firefox/addon/iuxx/)

## 使用

- 从工具栏弹窗点击 **选择要屏蔽的元素** 启动选择器，也可以按 `Ctrl+Alt+X`（macOS 为 `Ctrl+Cmd+X`），或在页面右键菜单中选择 **屏蔽此元素（IUxx）**。
- 移动鼠标高亮元素，点击选中；用 **扩大范围**（`↑`）、**缩小范围**（`↓`）、**重选**、**屏蔽**（`Enter`）操作，按 `Esc` 或 **退出** 取消。触屏设备上按钮显示在底部面板中。
- 面板会显示当前选择器匹配多少个元素。**匹配相似元素** 会切换到范围更大的选择器，**仅匹配此元素** 可回到唯一选择器，选择器文本也可以直接编辑。**预览** 会在保存前临时隐藏命中的元素。可选择应用范围（仅本主机、本主机及子域名、所有网站），也可以勾选 **仅当前路径**。
- 屏蔽后会弹出 **撤销** 提示；已屏蔽元素刷新后仍然隐藏。
- **临时隐藏** 不会保存规则：在弹窗点击 **临时隐藏**，或在右键菜单选择 **临时隐藏此元素（IUxx）**。点击元素（或将鼠标悬停在元素上按 `Delete`）即可移除；提示条中可撤销。刷新页面后全部恢复。即使站点在例外列表中，临时隐藏仍可使用。
- 弹窗开关控制当前网站是否屏蔽。关闭会把网站加入例外列表；重新打开会移除覆盖该主机的例外条目。
- 弹窗列出适用于当前网站的规则，并显示范围与路径徽标。可用复选框启用或停用规则，也可删除；删除后可撤销。
- **设置** 页提供例外列表、手动添加与编辑规则、规则搜索、JSON 导入导出，以及 **屏蔽后保持选择器打开** 选项。不会上传或同步任何内容。
- 例外条目覆盖子域名。主机规则的匹配范围是当前主机；域名规则覆盖本主机及其子域名；全局规则在所有网站生效。路径前缀会把规则限制在该路径及其子路径。每个站点锚点最多 1000 条规则，总计最多 5000 条，接近上限时会提示。
- 规则只作用于顶层文档。iframe 内部的元素无法选中，但可以隐藏 iframe 元素本身。选中 open shadow root 内的元素时，会屏蔽它的宿主元素。
- 所有设置都保存在本地；没有账号、遥测或云服务。

## 权限

- `storage` — 本地保存规则、例外列表和设置。
- `menus` — 添加右键菜单项。
- `scripting` — 需要时向已打开的标签页注入选择器，并在页面加载时以用户样式表应用已保存的规则。
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

规则、例外列表和设置只保存在扩展自己的本地存储中，不会写入网站自身的存储。已保存的规则在页面加载时由浏览器以用户样式表注入，页面脚本无法移除或覆盖。扩展不发起网络请求；导入导出只使用本地 JSON 文件，没有云同步。

## 从源码构建

`src/` 就是扩展本身，没有构建或转译步骤。Node.js 用于运行测试和 `web-ext`。

```sh
npm test
npx web-ext@10 lint --source-dir src
npx web-ext@10 run --source-dir src
npx web-ext@10 build --source-dir src --overwrite-dest
```

打包结果输出到 `web-ext-artifacts/`。

## 许可

基于 MIT 许可发布，见 [LICENSE](LICENSE)。