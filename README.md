# Bookmark Organizer

🔖 AI 智能书签管理 Chrome 扩展

## 功能

- **AI 智能分类**：批量分类书签，支持扁平/层级模式与分类上限控制
- **本地/自建 API**：支持 OpenAI Compatible 接口（如本地模型或自建服务）
- **检测失效书签**：并发检测失效链接，支持严格模式与自动删除
- **重建分类**：分类前先备份并清空旧结构，避免重复堆叠
- **AI 排序**：基于内容排序文件夹，常用在前、冷门在后
- **导出/导入**：JSON 格式备份与导入书签
- **书签去重**：按 URL 去重并自动清理重复项

## 安装

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `tab-organizer` 文件夹

## 配置

- `API 类型`：Gemini（官方）或 OpenAI Compatible（本地/自建）
- `API Base`：如 `http://127.0.0.1:2223/v1`
- `Model`：如 `gemini-2.5-flash` 或本地模型名
- `API Key`：本地接口可留空
- `严格检测`：强制 GET 校验，识别更多失效链接

## 使用

1. 点击扩展图标打开面板并保存设置
2. 可选勾选：`分类前清理`、`重建分类`、`扁平分类`、`AI 排序`
3. 点击「AI 智能分类」
4. 点击「检测失效书签」清理死链
5. 在工具区使用「导出/导入/去重」

## 构建与打包（含混淆）

```bash
npm install
npm run zip
```

生成 `bookmark-organizer.zip`，可直接用于 Chrome Web Store 上传。

## 测试

```bash
npm test
```

## 技术栈

- Chrome Extension Manifest V3
- Chrome Bookmarks API
- Vanilla JavaScript

## 隐私提示

分类时会将书签标题与域名发送到你配置的 API。请确认你的 API 提供方符合隐私要求。
