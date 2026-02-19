const qs = require('qs');
const dayjs = require('dayjs');
const request = require('request-promise');
const cheerio = require('cheerio');
const unescape = require('lodash.unescape');
const errors = require('./errors');

const defaultConfig = {
  shouldReturnRawMeta: false,
  shouldReturnContent: true,
  shouldFollowTransferLink: true,
  shouldExtractMpLinks: false,
  shouldExtractTags: false,
  shouldExtractRepostMeta: false
};

function getError(code) {
  return { done: false, code, msg: errors[code] };
}

function normalizeUrl(url = '') {
  const parts = url.replace(/&amp;/g, '&').split('?');
  const querys = qs.stringify(qs.parse(parts[1]));
  return querys ? `${parts[0]}?${querys}` : parts[0];
}

function getParameterByName(name, url) {
  name = name.replace(/[\[\]]/g, '\\$&');
  const regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)');
  const results = regex.exec(url);
  if (!results) return null;
  if (!results[2]) return '';
  return decodeURIComponent(results[2].replace(/\+/g, ' '));
}

function parseUrlParams(url) {
  if (!url) return {};
  const rs = require('querystring').parse(url.replace(/&amp;/g, '&').split('?')[1]);
  return {
    mid: rs.mid * 1,
    idx: rs.idx * 1,
    sn: rs.sn,
    biz: rs.__biz
  };
}

async function extract(input, options = {}) {
  const config = Object.assign({}, defaultConfig, options);
  const {
    shouldReturnRawMeta,
    shouldReturnContent,
    shouldFollowTransferLink,
    shouldExtractMpLinks,
    shouldExtractTags,
    shouldExtractRepostMeta
  } = config;

  if (!input) return getError(2001);

  let paramType = 'HTML';
  let url = options.url ? normalizeUrl(options.url) : null;
  let rawUrl = null;
  let html = input;
  let type = 'post';
  let hasCopyright = false;

  // Handle URL input
  if (/^http/.test(input)) {
    const normalized = normalizeUrl(input);
    if (!/https?:\/\/mp\.weixin\.qq\.com/.test(normalized) &&
        !/https?:\/\/weixin\.sogou\.com/.test(normalized)) {
      return getError(2009);
    }
    paramType = 'URL';
    rawUrl = normalized;
    if (!url) url = normalized;

    const host = /weixin\.sogou\.com/.test(normalized) ? 'weixin.sogou.com' : 'mp.weixin.qq.com';

    try {
      html = await request({
        uri: normalized,
        method: 'GET',
        headers: {
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/66.0.3359.181 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Host': host
        }
      });
    } catch (e) {
      return getError(1002);
    }
  } else {
    html = input.replace(/\\n/g, '');
  }

  if (!html) return getError(1003);

  // Check for error pages
  if (html.includes('访问过于频繁') && !html.includes('js_content')) {
    return paramType === 'URL' ? getError(1004) : getError(2010);
  }
  if (html.includes('链接已过期') && !html.includes('js_content')) return getError(2002);
  if (html.includes('被投诉且经审核涉嫌侵权，无法查看')) return getError(2003);
  if (html.includes('该公众号已迁移')) {
    const match = html.match(/var\stransferTargetLink\s=\s'(.*?)';/);
    if (match && match[1]) {
      if (shouldFollowTransferLink) {
        return await extract(match[1]);
      }
      return { ...getError(1006), url: match[1] };
    }
    return getError(2004);
  }
  if (html.includes('该内容已被发布者删除')) return getError(2005);
  if (html.includes('此内容因违规无法查看')) return getError(2006);
  if (html.includes('此内容发送失败无法查看')) return getError(2007);
  if (html.includes('由用户投诉并经平台审核，涉嫌过度营销')) return getError(2011);
  if (html.includes('此帐号已被屏蔽') && !html.includes('id="js_content"')) return getError(2012);
  if (html.includes('此帐号已自主注销') && !html.includes('id="js_content"')) return getError(2013);
  if (!html.includes('id="js_content"') && html.includes('此帐号处于帐号迁移流程中')) return getError(2015);
  if (html.includes('page_rumor') && !html.includes('id="js_content"')) return getError(2014);
  if (html.includes('投诉类型') && html.includes('冒名侵权')) return getError(2016);
  if (!html.includes('id="js_content"') && !html.includes('id=\\"js_content\\"')) {
    if (html.includes('cover_url')) {
      type = 'image';
    } else {
      return getError(1000);
    }
  }

  // Prepare HTML
  html = html.replace('>微信号', ' id="append-account-alias">微信号')
    .replace('>功能介绍', ' id="append-account-desc">功能介绍')
    .replace(/\n\s+<script/g, '\n\n<script');

  const $ = cheerio.load(html, { decodeEntities: false });

  // Detect type and copyright
  if ($('#copyright_logo')?.text().includes('原创')) hasCopyright = true;
  if (/video/.test($('body').attr('class'))) type = 'video';
  if ($('#js_content > #img_list').length) type = 'image';
  if ($('#js_share_content').length) type = 'repost';
  if ($('.page_share_audio').length || $('#voice_parent').length) type = 'voice';
  if (/share_media_text/.test(html)) type = 'text';

  // Check for expired link or system error
  if ($('.weui-msg .weui-msg__title').text().trim() === '链接已过期') return getError(2002);
  if ($('.global_error_msg.warn').text().trim().includes('系统出错')) return getError(2008);

  // Extract basic info
  const basic = {
    accountName: $('.profile_nickname').text() || null,
    accountBiz: null,
    accountBizNumber: null,
    accountId: null,
    accountAvatar: null
  };

  const accountAliasPrev = $('#append-account-alias');
  let accountAlias = accountAliasPrev.siblings('span').text() || null;

  const accountDescPrev = $('#append-account-desc');
  let accountDesc = accountDescPrev.siblings('span').text() || null;

  if (!accountDesc) {
    const $accountDesc = $('.profile_meta_value');
    if ($accountDesc[1]) {
      try {
        const text = $accountDesc[1].children[0].data;
        if (text?.length > 10) accountDesc = text;
      } catch (e) {}
    }
  }

  const post = {
    msg_has_copyright: hasCopyright,
    msg_content: shouldReturnContent ? $('#js_content').html() : null
  };

  // Extract author
  try {
    const author = $("meta[name='author']").attr('content');
    if (author) post.msg_author = author;
  } catch (e) {
    const $author = $('#js_author_name');
    if ($author.length) {
      const info = $author.text().trim();
      if (info) post.msg_author = info;
    }
  }

  // Extract from scripts
  const scripts = html.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/gi) || [];
  const extra = { biz: null, sn: null, mid: null, idx: null, msg_title: null, user_name: null, nick_name: null, hd_head_img: null };
  let picturePageInfoList = null;

  for (const script of scripts) {
    // Picture type
    if (script.includes('picture_page_info_list') && script.includes('https://mmbiz.qpic.cn')) {
      try {
        const lines = script.split('\n');
        const code = lines.slice(1, lines.length - 2).join('\n').trim()
          .replace(/^\(function\(\) {/, '').replace(/}\)\(\);$/, '');
        const fn = new Function(`var x = {}; ${code.replace(/window\./g, 'x.').replace('//g', '/\\n/g')}\nreturn x;`);
        const result = fn();
        if (result.picture_page_info_list) picturePageInfoList = result.picture_page_info_list;
      } catch (e) {}
    }

    // Voice type
    if (type === 'voice' && script.includes('voiceid')) {
      const lines = script.split(/\n|\r/).filter(one => one.includes('voiceid'))
        .sort((a, b) => a.length > b.length ? -1 : 1);
      if (lines.length) {
        const val = lines[0].replace(/['"|:,voiceid\s]/g, '');
        if (val) post.msg_source_url = `https://res.wx.qq.com/voice/getvoice?mediaid=${val.trim()}`;
      }
    }

    // Extract extra fields
    for (const field of Object.keys(extra)) {
      const reg = new RegExp(`var\\s+${field}\\s*=`);
      if (reg.test(script) && !extra[field]) {
        try {
          const line = script.split('\n').filter(one => reg.test(one))[0];
          const fn = new Function(`${line}\nreturn ${field};`);
          extra[field] = fn();
        } catch (e) {}
      }

      if (!extra[field]) {
        const reg2 = new RegExp(`window\\.${field}\\s*=`);
        if (reg2.test(script)) {
          try {
            const line = script.split('\n').filter(one => reg2.test(one))[0];
            const fn = new Function(`window = {}; ${line}\nreturn window.${field};`);
            extra[field] = fn();
          } catch (e) {}
        }
      }
    }

    // Data from d object (video/image/voice)
    if ((type === 'image' || type === 'voice') && script.includes('d.title =')) {
      try {
        const lines = script.split('\n').filter(line => !!line.trim());
        const codeLines = lines.filter((line, index) =>
          /d\./.test(line) || (lines[index - 1] && lines[index - 1].includes('d.') && !line.includes('}'))
        );
        let code = `var d = {}; function getXmlValue(path) { return false; }\n` +
          codeLines.join('\n').replace('var d = _g.cgiData;', 'var d = {}') +
          '\nreturn d;';
        code = `var _g = {}; ${code}`;
        const fn = new Function(code);
        const data = fn();

        basic.accountName = data.nick_name;
        basic.accountAvatar = data.hd_head_img;
        basic.accountId = data.user_name;

        if (!basic.accountBiz && data.biz) {
          basic.accountBiz = data.biz;
          basic.accountBizNumber = Buffer.from(data.biz, 'base64').toString() * 1;
        }

        post.msg_title = data.title;
        post.msg_desc = null;
        post.msg_cover = null;
        post.msg_link = data.msg_link || null;
        post.msg_sn = data.sn || null;
        post.msg_idx = data.idx ? data.idx * 1 : null;
        post.msg_mid = data.mid ? data.mid * 1 : null;

        if (type === 'video') {
          const vidMatch = html.match(/vid\s*:\s*'(.*?)'/);
          if (vidMatch) data.vid = vidMatch[1];
          post.msg_cover = $("meta[property='og:image']").attr('content');
        }

        if (type === 'video' || type === 'voice') {
          post.msg_content = $("meta[name='description']").attr('content');
        }

        if (data.create_time) {
          post.msg_publish_time = new Date(data.create_time * 1000);
          post.msg_publish_time_str = dayjs(post.msg_publish_time).format('YYYY/MM/DD HH:mm:ss');
        }

        if (shouldReturnRawMeta) post.raw_data = data;
      } catch (e) {
        return getError(1005);
      }
    }

    // Post/repost type
    if ((type === 'post' || type === 'repost') && script.includes('var msg_link =')) {
      try {
        const lines = script.split('\n');
        let code = lines.slice(1, lines.length - 1)
          .filter(line => !line.includes('var title'))
          .map(line => {
            if (/var\s+msg_desc/.test(line)) {
              line = line.replace(/`/g, "'").replace(/"/g, '`');
            }
            return line;
          }).join('\n');

        code = `var window = { location: { protocol: 'https' } };
var document = {
  addEventListener: function() {},
  getElementById: function() {
    return { classList: { remove: function() {}, add: function() {} } };
  }
};
var location = { protocol: "https" };\n${code}`;

        const vars = code.match(/var\s(.*?)\s=/g)?.map(key => key.split(' ')[1]).filter(k => k !== 'window') || [];
        let rs = ';\nvar rs = {';
        vars.forEach(key => {
          rs += `"${key}": typeof ${key} !== 'undefined' ? ${key} : null,`;
        });
        rs += '}\nreturn rs;';

        const stringProto = `String.prototype.html = function(encode) {
          var replace = ["&#39;", "'", "&quot;", '"', "&nbsp;", " ", "&gt;", ">", "&lt;", "<", "&yen;", "¥", "&amp;", "&"];
          var replaceReverse = ["&", "&amp;", "¥", "&yen;", "<", "&lt;", ">", "&gt;", " ", "&nbsp;", '"', "&quot;", "'", "&#39;"];
          var target = encode ? replaceReverse : replace;
          for (var i = 0, str = this; i < target.length; i += 2) {
            str = str.replace(new RegExp(target[i], 'g'), target[i + 1]);
          }
          return str;
        };`;

        const fn = new Function(stringProto + code + rs);
        const data = fn();

        // Fallback for biz
        if (!basic.accountBiz) {
          const reg = new RegExp(`var\\s+biz\\s*=`);
          const matched = html.split('\n').find(line => reg.test(line) && line.length > 10);
          if (matched) {
            try {
              const bizFn = new Function(`${matched}; return biz;`);
              const rs = bizFn();
              if (rs) {
                basic.accountBiz = rs;
                basic.accountBizNumber = Buffer.from(rs, 'base64').toString() * 1;
              }
            } catch (e) {}
          }
        }

        ['msg_title', 'msg_desc', 'msg_link', 'msg_source_url'].forEach(key => {
          post[key] = data[key] || null;
        });

        post.msg_cover = data.msg_cdn_url;
        post.msg_article_type = data._ori_article_type || null;
        post.msg_publish_time = new Date(data.ct * 1000);
        post.msg_publish_time_str = dayjs(post.msg_publish_time).format('YYYY/MM/DD HH:mm:ss');

        if (shouldReturnRawMeta) post.raw_data = data;

        basic.accountId = data.user_name;
        basic.accountAvatar = data.ori_head_img_url;
        if (!basic.accountName && data.nickname) basic.accountName = data.nickname;
      } catch (e) {
        return getError(1005);
      }
    }
  }

  // Set extracted extra fields
  if (extra.biz) {
    basic.accountBiz = extra.biz;
    basic.accountBizNumber = Buffer.from(extra.biz, 'base64').toString() * 1;
  }
  post.msg_sn = extra.sn || post.msg_sn || null;
  post.msg_idx = extra.idx ? extra.idx * 1 : post.msg_idx || null;
  post.msg_mid = extra.mid ? extra.mid * 1 : post.msg_mid || null;

  // Fallback for missing fields
  if (!post.msg_publish_time) {
    const date = $('#post-date').text() || $('#publish_time').text();
    if (date) post.msg_publish_time = new Date(date);
  }

  if (!post.msg_publish_time && html.includes('.ct')) {
    const line = html.split('\n').find(one => one.includes('.ct'));
    const matched = /'(\d+)'/g.exec(line);
    if (matched && matched[1]?.length >= 10) {
      post.msg_publish_time = new Date(matched[1] * 1000);
    }
  }

  if (!post.msg_title) {
    const title = $('.rich_media_title').text();
    if (title) post.msg_title = title.trim();
  }

  // Set account info from extra
  if (!basic.accountId && extra.user_name) basic.accountId = extra.user_name;
  if (!basic.accountName && extra.nick_name) basic.accountName = extra.nick_name;
  if (!basic.accountAvatar && extra.hd_head_img) basic.accountAvatar = extra.hd_head_img;

  if (!basic.accountName && $('.wx_follow_nickname')) {
    const name = $('.wx_follow_nickname').text();
    if (name) basic.accountName = name.trim();
  }

  // Build result
  const data = {
    account_name: basic.accountName,
    account_alias: accountAlias,
    account_avatar: basic.accountAvatar?.length > 10 ? basic.accountAvatar : null,
    account_description: accountDesc,
    account_id: basic.accountId,
    account_biz: basic.accountBiz,
    account_biz_number: basic.accountBizNumber,
    account_qr_code: `https://open.weixin.qq.com/qr/code?username=${basic.accountId || accountAlias}`,
    ...post,
    msg_type: type
  };

  // Clean empty strings to null
  for (const key in data) {
    if (data[key] === '') data[key] = null;
  }

  // Handle text type (no title)
  if (!data.msg_title && type === 'post') {
    data.msg_type = 'text';
    const title = $("meta[property='og:title']").attr('content');
    const desc = $("meta[property='og:description']").attr('content');
    if (title) {
      data.msg_title = title;
      const rawContent = $('#js_panel_like_title').html();
      data.msg_content = rawContent ? rawContent.trim().replace(/\n/g, '<br/>') : title;
    }
    if (!title && desc) data.msg_title = desc;
  }

  // Fallback for time
  if (!data.msg_publish_time) {
    const matched = html.match(/d\.ct\s*=\s*"(\d+)"/);
    if (matched && matched[1]) {
      data.msg_publish_time = new Date(matched[1] * 1000);
      data.msg_publish_time_str = dayjs(data.msg_publish_time).format('YYYY/MM/DD HH:mm:ss');
    }
  }

  // Fallback for link params
  if (!data.msg_mid || !data.msg_link) {
    let linkUrl = options?.url || rawUrl || $("meta[property='og:url']").attr('content');
    if (linkUrl && /^http/.test(linkUrl) && /mid/.test(linkUrl) && /__biz/.test(linkUrl)) {
      linkUrl = linkUrl.replace(/&amp;/g, '&');
      if (!data.msg_link) data.msg_link = linkUrl;
      if (!data.msg_mid) data.msg_mid = getParameterByName('mid', linkUrl);
      if (!data.msg_idx) data.msg_idx = getParameterByName('idx', linkUrl);
      if (!data.msg_sn) data.msg_sn = getParameterByName('sn', linkUrl);
    }
  }

  // Unescape title
  if (data.msg_title) data.msg_title = unescape(data.msg_title);

  // Handle video content
  if (data.msg_type === 'video') {
    if (!data.msg_content) {
      data.msg_content = data.msg_title;
    } else {
      data.msg_content = data.msg_content
        .replace(/\\x26/g, '&')
        .replace(/\\x0a/g, '<br/>');
    }
  }

  // Final fallback for title
  if (!data.msg_title) {
    const title = $("meta[property='og:title']").attr('content');
    if (title) data.msg_title = title;
  }

  // Fallback for description
  if (!data.msg_desc) {
    data.msg_desc = $("meta[property='og:description']").attr('content') ||
                    $("meta[name='description']").attr('content');
  }
  if (!data.msg_desc && data.msg_content) {
    const text = data.msg_content.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text.length > 0) {
      data.msg_desc = text.substring(0, 140) + (text.length > 140 ? '...' : '');
    }
  }

  // Handle script in content
  if (data.msg_content?.includes('<script') && data.msg_content.includes('script>') && data.msg_content.includes('nonce=')) {
    const desc = $("meta[property='og:description']").attr('content');
    if (desc) data.msg_content = desc;
  }

  // Validate result
  if (!data.msg_title || !data.msg_publish_time) return getError(1001);

  // Text type fallback
  if (type === 'text' && !data.msg_content && data.msg_title) {
    data.msg_content = data.msg_title;
  }

  // Image type with picture_page_info_list
  if (picturePageInfoList) {
    data.msg_type = 'image';
    data.msg_content = `${data.msg_title}<br>`;
    for (const one of picturePageInfoList) {
      data.msg_content += `<img src="${one.cdn_url}" style="max-width:100%"/><br><br>`;
    }
  }

  // Extract mp links
  if (shouldExtractMpLinks) {
    const mpLinks = [];
    $('a').each((i, ele) => {
      const href = $(ele).attr('href');
      if (href?.includes('mp.weixin.qq.com')) {
        mpLinks.push({ title: $(ele).text(), href });
      }
    });
    data.mp_links_count = mpLinks.length;
    data.mp_links = mpLinks;
  }

  // Extract tags
  if (shouldExtractTags) {
    const tags = [];
    $('.article-tag__item-wrp').each((i, ele) => {
      const $this = $(ele);
      try {
        const tagUrl = $this.attr('data-url');
        const name = $this.find('.article-tag__item').text();
        let count = $this.find('.article-tag__item-num').text();
        if (name) {
          if (!count && tags.length === 0) {
            const $count = $('.article-tag-card__right');
            if ($count.length) count = $count.text().replace('个', '');
          }
          tags.push({
            id: getParameterByName('album_id', tagUrl) || getParameterByName('tag_id', tagUrl) || null,
            url: tagUrl,
            name: name.replace(/^#/, ''),
            count: count?.replace(/\D/g, '') * 1 || 0
          });
        }
      } catch (e) {}
    });
    data.tags = tags;
  }

  // Extract repost meta
  if (shouldExtractRepostMeta && html.includes('copyright_info') && html.includes('original_primary_nickname')) {
    const name = $('.original_primary_nickname').text();
    if (name) data.repost_meta = { account_name: name };
  }

  // Clean up link
  if (data.msg_link?.includes('&amp;')) {
    data.msg_link = data.msg_link.replace(/&amp;/g, '&');
  }

  return { code: 0, done: true, data };
}

module.exports = { extract };
