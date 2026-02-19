const cheerio = require('cheerio');
const fs = require('fs');

const htmlContent = fs.readFileSync('/Users/canghe/.claude/projects/-Users-canghe/1a7db960-136f-49cc-a1fc-983884c098fd/tool-results/b97eb13.txt', 'utf8');
const data = JSON.parse(htmlContent);

const $ = cheerio.load(data.msg_content, { decodeEntities: false });

let markdown = `---
title: "${data.msg_title}"
author: "${data.msg_author || data.account_name}"
date: "${data.msg_publish_time_str}"
source: "${data.account_name}"
original_url: "${data.msg_link}"
---

# ${data.msg_title}

**作者**: ${data.msg_author || data.account_name}  
**发布时间**: ${data.msg_publish_time_str}  
**公众号**: ${data.account_name}  
**原文链接**: ${data.msg_link}

---

`;

function processElement(elem, isRoot = false) {
  const $elem = $(elem);
  const tagName = elem.tagName?.toLowerCase();
  
  if (!tagName) return;
  
  if (tagName === 'h2') {
    markdown += '\n## ' + $elem.text().trim() + '\n\n';
  } else if (tagName === 'h3') {
    markdown += '\n### ' + $elem.text().trim() + '\n\n';
  } else if (tagName === 'p') {
    // Check for nested elements
    let text = '';
    $elem.contents().each((i, child) => {
      if (child.type === 'text') {
        text += child.data;
      } else if (child.type === 'tag') {
        const $child = $(child);
        if (child.tagName === 'strong' || child.tagName === 'b' || child.tagName === 'span') {
          const childText = $child.text().trim();
          if (childText.startsWith('「') && childText.endsWith('」')) {
            text += '**' + childText + '**';
          } else {
            text += childText;
          }
        } else if (child.tagName === 'br') {
          text += '\n';
        } else {
          text += $child.text();
        }
      }
    });
    text = text.trim();
    if (text) markdown += text + '\n\n';
  } else if (tagName === 'blockquote') {
    const text = $elem.text().trim();
    if (text) markdown += '> ' + text + '\n\n';
  } else if (tagName === 'ol') {
    $elem.children('li').each((i, li) => {
      const text = $(li).text().trim();
      if (text) markdown += (i + 1) + '. ' + text + '\n';
    });
    markdown += '\n';
  } else if (tagName === 'ul') {
    $elem.children('li').each((i, li) => {
      const text = $(li).text().trim();
      if (text) markdown += '- ' + text + '\n';
    });
    markdown += '\n';
  } else if (tagName === 'img') {
    const src = $elem.attr('data-src') || $elem.attr('src');
    if (src) markdown += '\n![图片](' + src + ')\n\n';
  } else if (tagName === 'code') {
    const text = $elem.text().trim();
    if (text) markdown += '`' + text + '`';
  } else if (tagName === 'pre' || (tagName === 'section' && $elem.hasClass('code-snippet__fix'))) {
    const codeText = $elem.find('code').text() || $elem.text();
    if (codeText.trim()) {
      markdown += '\n```\n' + codeText.trim() + '\n```\n\n';
    }
  } else if (tagName === 'section' || tagName === 'div' || tagName === 'center') {
    // 递归处理子元素
    $elem.children().each((i, child) => {
      processElement(child);
    });
  }
}

// 处理主要内容
const mainSection = $('section[data-plugin="note-to-mp"]');
if (mainSection.length) {
  mainSection.children().each((i, child) => {
    processElement(child, true);
  });
} else {
  // 如果没有找到主section，处理body
  $('body').children().each((i, child) => {
    processElement(child, true);
  });
}

// 清理多余的空行
markdown = markdown.replace(/\n{3,}/g, '\n\n');

// 保存文件
const outputPath = '/Users/canghe/Downloads/wechat/爆肝2天用GLM5开发OpenClaw接入微信bot.md';
fs.writeFileSync(outputPath, markdown, 'utf8');

console.log('文件已保存到:', outputPath);
console.log('文件大小:', (markdown.length / 1024).toFixed(2), 'KB');
