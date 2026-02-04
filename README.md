# Bookmark Organizer

🔖 AI 智能书签管理 Chrome 扩展

## 功能

- **AI 智能分类** - 使用 Gemini AI 自动分析书签并整理到文件夹
- **检测失效书签** - 扫描并找出无法访问的链接
- **一键删除失效** - 快速清理死链接

## 安装

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `tab-organizer` 文件夹

## 使用

1. 点击扩展图标打开面板
2. 输入你的 Gemini API Key（[获取地址](https://aistudio.google.com/apikey)）
3. 点击「AI 智能分类」自动整理书签
4. 点击「检测失效书签」找出死链接

## 技术栈

- Chrome Extension Manifest V3
- Gemini 2.5 Flash API
- Chrome Bookmarks API
- Vanilla JavaScript

## TODO

- [ ] 自定义分类规则
- [ ] 定时自动检测失效书签
- [ ] 导出/导入书签列表
- [ ] 书签去重功能
