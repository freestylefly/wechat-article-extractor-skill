# WeChat Article Extractor

[![Node.js](https://img.shields.io/badge/Node.js-14+-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

一个 Claude Code Skill，用于提取微信公众号文章的元数据和内容。支持多种文章类型，包括图文、视频、图片集、语音和转载文章。当用户需要提供微信公众号文章链接（mp.weixin.qq.com）时，Claude 会自动触发此 Skill 来提取文章信息。

## 功能特性

- 解析微信公众号文章 URL (`mp.weixin.qq.com`)
- 提取文章元数据：标题、作者、摘要、发布时间
- 获取公众号信息：名称、头像、微信号、功能介绍
- 提取文章内容（HTML 格式）
- 获取封面图片 URL
- 支持多种文章类型：图文、视频、图片集、语音、纯文字、转载
- 处理各种异常情况：内容删除、链接过期、访问限制、账号迁移等
- 支持搜狗微信搜索结果的解析 (`weixin.sogou.com`)
- 可选提取文章标签和内嵌链接

## 安装

这是一个 Claude Code Skill，可以通过以下方式安装：

### 通过 Claude Code 安装（推荐）

在 Claude Code 中运行：

```
/skill install wechat-article-extractor
```

或指定目录安装：

```
/skill install /path/to/wechat-article-extractor-skill
```

### 手动克隆安装

```bash
git clone https://github.com/yourusername/wechat-article-extractor-skill.git
cd wechat-article-extractor-skill
npm install
```

然后在 Claude Code 中将该目录作为 Skill 加载。

## 使用方法

### 基本用法 - 从 URL 提取

```javascript
const { extract } = require('./scripts/extract.js');

async function main() {
  const url = 'https://mp.weixin.qq.com/s?__biz=...&mid=...&idx=...&sn=...';
  const result = await extract(url);

  if (result.done) {
    console.log('文章标题:', result.data.msg_title);
    console.log('公众号:', result.data.account_name);
    console.log('发布时间:', result.data.msg_publish_time_str);
  } else {
    console.error('提取失败:', result.msg);
  }
}

main();
```

### 从 HTML 内容提取

如果你已经获取了页面 HTML，可以直接传入：

```javascript
const { extract } = require('./scripts/extract.js');

async function main() {
  const html = await fetch(url).then(r => r.text());
  const result = await extract(html, { url: sourceUrl });

  console.log(result);
}

main();
```

### 高级选项

```javascript
const result = await extract(url, {
  shouldReturnContent: true,      // 返回 HTML 内容（默认：true）
  shouldReturnRawMeta: false,     // 返回原始元数据（默认：false）
  shouldFollowTransferLink: true, // 自动跟随迁移后的公众号链接（默认：true）
  shouldExtractMpLinks: false,    // 提取内嵌的微信公众号链接（默认：false）
  shouldExtractTags: false,       // 提取文章标签（默认：false）
  shouldExtractRepostMeta: false  // 提取转载来源信息（默认：false）
});
```

## 响应格式

### 成功响应

```javascript
{
  done: true,
  code: 0,
  data: {
    // 公众号信息
    account_name: "公众号名称",
    account_alias: "微信号",
    account_avatar: "头像URL",
    account_description: "功能介绍",
    account_id: "原始ID",
    account_biz: "biz参数",
    account_biz_number: 1234567890,
    account_qr_code: "二维码URL",

    // 文章信息
    msg_title: "文章标题",
    msg_desc: "文章摘要",
    msg_content: "HTML内容",
    msg_cover: "封面图URL",
    msg_author: "作者",
    msg_type: "post", // post|video|image|voice|text|repost
    msg_has_copyright: true,
    msg_publish_time: Date,
    msg_publish_time_str: "2024/01/15 10:30:00",

    // 链接参数
    msg_link: "文章链接",
    msg_source_url: "阅读原文链接",
    msg_sn: "sn参数",
    msg_mid: 1234567890,
    msg_idx: 1
  }
}
```

### 错误响应

```javascript
{
  done: false,
  code: 1001,
  msg: "无法获取文章信息"
}
```

## 错误代码表

| 代码 | 错误信息 | 说明 |
|------|----------|------|
| 1000 | 文章获取失败 | 一般性失败 |
| 1001 | 无法获取文章信息 | 缺少标题或发布时间 |
| 1002 | 请求失败 | HTTP 请求失败 |
| 1003 | 响应为空 | 空响应 |
| 1004 | 访问过于频繁 | 被限流 |
| 1005 | 脚本解析失败 | 页面脚本解析错误 |
| 1006 | 公众号已迁移 | 账号已迁移，包含新链接 |
| 2001 | 请提供文章内容或链接 | 缺少输入参数 |
| 2002 | 链接已过期 | 链接已失效 |
| 2003 | 内容涉嫌侵权 | 内容因侵权被移除 |
| 2004 | 无法获取迁移后的链接 | 迁移链接获取失败 |
| 2005 | 内容已被发布者删除 | 作者已删除内容 |
| 2006 | 内容因违规无法查看 | 内容被平台屏蔽 |
| 2007 | 内容发送失败 | 发送失败 |
| 2008 | 系统出错 | 系统错误 |
| 2009 | 不支持的链接 | URL 格式不支持 |
| 2010 | 内容获取失败 | 内容获取失败 |
| 2011 | 涉嫌过度营销 | 营销/垃圾内容 |
| 2012 | 账号已被屏蔽 | 账号被封禁 |
| 2013 | 账号已自主注销 | 账号已注销 |
| 2014 | 内容被投诉 | 内容被举报 |
| 2015 | 账号处于迁移流程中 | 账号正在迁移 |
| 2016 | 冒名侵权 | 冒充侵权 |

## 支持的文章类型

| 类型 | 说明 | msg_type |
|------|------|----------|
| 图文 | 普通图文文章 | `post` |
| 视频 | 视频内容 | `video` |
| 图片集 | 多张图片展示 | `image` |
| 语音 | 音频内容 | `voice` |
| 纯文字 | 无标题文字内容 | `text` |
| 转载 | 转载他人文章 | `repost` |

## 项目结构

```
wechat-article-extractor-skill/
├── scripts/
│   ├── extract.js    # 核心提取逻辑
│   └── errors.js     # 错误代码定义
├── SKILL.md          # Skill 定义文件（Claude Skill 格式，包含触发条件和描述）
├── package.json      # 项目配置
└── README.md         # 本文件
```

## 依赖项

- `cheerio` - 服务端 HTML 解析
- `dayjs` - 日期格式化
- `request-promise` - HTTP 请求
- `qs` - 查询字符串解析
- `lodash.unescape` - HTML 实体解码

## 注意事项

1. **频率限制**: 频繁请求可能会导致 IP 被暂时封禁，建议添加适当的延迟
2. **页面结构**: 微信页面结构可能会变化，如遇问题请检查是否为最新版本
3. **Cookie**: 某些文章可能需要登录才能访问完整内容
4. **反爬措施**: 请遵守微信的使用条款，合理使用本工具

## 示例应用

### 批量提取文章

```javascript
const { extract } = require('./scripts/extract.js');

async function batchExtract(urls) {
  const results = [];

  for (const url of urls) {
    try {
      const result = await extract(url);
      if (result.done) {
        results.push({
          title: result.data.msg_title,
          author: result.data.account_name,
          publishTime: result.data.msg_publish_time_str
        });
      }
      // 添加延迟避免被限流
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.error(`提取失败: ${url}`, err.message);
    }
  }

  return results;
}

const urls = [
  'https://mp.weixin.qq.com/s?__biz=...',
  'https://mp.weixin.qq.com/s?__biz=...'
];

batchExtract(urls).then(console.log);
```

### 保存为 Markdown

```javascript
const { extract } = require('./scripts/extract.js');
const fs = require('fs');

async function saveAsMarkdown(url, filename) {
  const result = await extract(url);

  if (!result.done) {
    console.error('提取失败:', result.msg);
    return;
  }

  const { data } = result;
  const markdown = `
# ${data.msg_title}

> 作者: ${data.msg_author || data.account_name}
> 公众号: ${data.account_name}
> 发布时间: ${data.msg_publish_time_str}

${data.msg_content}

---
原文链接: [${data.msg_link}](${data.msg_link})
`;

  fs.writeFileSync(filename, markdown);
  console.log(`已保存: ${filename}`);
}

saveAsMarkdown('https://mp.weixin.qq.com/s?__biz=...', 'article.md');
```

## 许可证

[MIT](LICENSE)

## 贡献

欢迎提交 Issue 和 Pull Request！

## 更新日志

### v1.0.0
- 初始版本发布
- 支持基本的文章信息提取
- 支持多种文章类型
- 完善的错误处理机制
