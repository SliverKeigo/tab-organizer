# Tab Organizer

🗂️ AI 智能标签管理 Chrome 扩展

## 功能

- **AI 智能分组** - 使用 Gemini AI 自动分析标签内容并分类
- **检测失效标签** - 扫描并找出无法访问的网页
- **一键取消分组** - 快速恢复原始状态

## 安装

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `tab-organizer` 文件夹

## 使用

1. 点击扩展图标打开面板
2. 输入你的 Gemini API Key（[获取地址](https://aistudio.google.com/apikey)）
3. 点击「AI 智能分组」自动整理标签
4. 点击「检测失效标签」找出无效链接

## 技术栈

- Chrome Extension Manifest V3
- Gemini 2.0 Flash API
- Vanilla JavaScript

## TODO

- [ ] 自定义分类规则
- [ ] 定时自动检测失效标签
- [ ] 导出/导入标签列表
- [ ] 历史记录功能
