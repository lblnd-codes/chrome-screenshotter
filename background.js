// Runs inside the page to extract social media post info from the URL + DOM
function extractPageInfo() {
  function sanitize(str) {
    return String(str).replace(/[<>:"/\\|?*\x00-\x1f]+/g, '').trim();
  }

  const urlObj = new URL(window.location.href);
  const hostname = urlObj.hostname.replace(/^www\./, '');
  const path = urlObj.pathname;

  // Twitter / X
  if (hostname === 'twitter.com' || hostname === 'x.com') {
    const m = path.match(/^\/([^/]+)\/status\/(\d+)/);
    if (m) return { username: sanitize(m[1]), postId: m[2] };
  }

  // Instagram – posts and reels
  if (hostname === 'instagram.com') {
    const m = path.match(/^\/(?:p|reel)\/([^/]+)/);
    if (m) {
      // Extract username from the profile link's href (works in both modal and direct views)
      const profileLink =
        document.querySelector('div[role="dialog"] header a[href^="/"]') ||
        document.querySelector('article header a[href^="/"]') ||
        document.querySelector('header a[href^="/"][role="link"]');
      let username = 'unknown';
      if (profileLink) {
        const hrefMatch = profileLink.getAttribute('href').match(/^\/([^/?]+)/);
        if (hrefMatch) username = sanitize(hrefMatch[1]) || 'unknown';
      }
      // Fallback: scan all links for the Instagram username pattern (/word/ or /word_.)
      if (username === 'unknown') {
        const reserved = new Set(['explore','reels','direct','accounts','p','reel','stories','tv','ar','about','legal','privacy','help','press','api','blog','jobs','branded','hashtag']);
        for (const a of document.querySelectorAll('a[href^="/"]')) {
          const um = a.getAttribute('href').match(/^\/([a-zA-Z0-9._]{2,30})\/?$/);
          if (um && !reserved.has(um[1])) { username = sanitize(um[1]); break; }
        }
      }

      // Detect carousel and current slide number
      let slide = null;
      const _dbg = [];

      // Strategy 0: Instagram sets ?img_index=N in the URL for direct post views
      const imgIndex = new URL(window.location.href).searchParams.get('img_index');
      if (imgIndex) { slide = parseInt(imgIndex); _dbg.push('s0:img_index=' + slide); }

      // Strategy 1: translateX via computed style
      if (slide === null) {
        for (const el of document.querySelectorAll('div[role="dialog"] ul, article ul, div[role="dialog"] > div > div, article > div > div')) {
          const items = [...el.querySelectorAll(':scope > li, :scope > div')].filter(c => c.offsetWidth > 50);
          if (items.length < 2) continue;
          const raw = window.getComputedStyle(el).transform;
          _dbg.push('s1:el=' + el.tagName + ' items=' + items.length + ' transform=' + raw);
          if (!raw || raw === 'none') continue;
          const tx = raw.match(/matrix\([^,]+,[^,]+,[^,]+,[^,]+,\s*(-?[\d.]+)/) ||
                     raw.match(/translateX\((-?[\d.]+)px\)/);
          if (!tx) continue;
          const slideWidth = el.parentElement ? el.parentElement.offsetWidth : el.offsetWidth;
          _dbg.push('s1:tx=' + tx[1] + ' slideWidth=' + slideWidth);
          if (!slideWidth) continue;
          const idx = Math.round(Math.abs(parseFloat(tx[1])) / slideWidth);
          if (idx >= 0 && idx < items.length) { slide = idx + 1; _dbg.push('s1:HIT slide=' + slide); break; }
        }
      }

      // Strategy 2: scrollLeft
      if (slide === null) {
        for (const el of document.querySelectorAll('div[role="dialog"] ul, article ul, div[role="dialog"] > div > div, article > div > div')) {
          const items = [...el.querySelectorAll(':scope > li, :scope > div')].filter(c => c.offsetWidth > 50);
          if (items.length < 2) continue;
          _dbg.push('s2:el=' + el.tagName + ' scrollLeft=' + el.scrollLeft + ' scrollWidth=' + el.scrollWidth + ' offsetWidth=' + el.offsetWidth);
          if (el.scrollLeft === 0 && el.scrollWidth <= el.offsetWidth) continue;
          const slideWidth = items[0].offsetWidth;
          if (!slideWidth) continue;
          const idx = Math.round(el.scrollLeft / slideWidth);
          if (idx >= 0 && idx < items.length) { slide = idx + 1; _dbg.push('s2:HIT slide=' + slide); break; }
        }
      }

      // Strategy 3: bounding rect center
      if (slide === null) {
        for (const el of document.querySelectorAll('div[role="dialog"] ul, article ul')) {
          const items = [...el.querySelectorAll(':scope > li')];
          if (items.length < 2) continue;
          const clip = el.parentElement || el;
          const clipRect = clip.getBoundingClientRect();
          const centerX = clipRect.left + clipRect.width / 2;
          _dbg.push('s3:ul items=' + items.length + ' clipRect=[' + Math.round(clipRect.left) + ',' + Math.round(clipRect.right) + '] centerX=' + Math.round(centerX));
          items.forEach((li, i) => {
            const r = li.getBoundingClientRect();
            _dbg.push('  li[' + i + '] left=' + Math.round(r.left) + ' right=' + Math.round(r.right));
          });
          for (let i = 0; i < items.length; i++) {
            const r = items[i].getBoundingClientRect();
            if (r.left <= centerX && r.right > centerX) { slide = i + 1; _dbg.push('s3:HIT slide=' + slide); break; }
          }
          if (slide !== null) break;
        }
      }

      // Strategy 4: aria-label "X of Y" — visible elements only
      if (slide === null) {
        for (const el of document.querySelectorAll('[aria-label*=" of "]')) {
          const r = el.getBoundingClientRect();
          _dbg.push('s4:label="' + el.getAttribute('aria-label') + '" rect=[' + Math.round(r.left) + ',' + Math.round(r.right) + ']');
          if (r.width === 0 || r.right < 0 || r.left > window.innerWidth) continue;
          const am = el.getAttribute('aria-label').match(/(\d+)\s+of\s+\d+/i);
          if (am) { slide = parseInt(am[1]); _dbg.push('s4:HIT slide=' + slide); break; }
        }
      }

      // Strategy 5: ARIA tablist
      if (slide === null) {
        const tablist = document.querySelector('[role="tablist"]');
        if (tablist) {
          const tabs = [...tablist.querySelectorAll('[role="tab"]')];
          const idx = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true');
          _dbg.push('s5:tablist tabs=' + tabs.length + ' selectedIdx=' + idx);
          if (idx >= 0) { slide = idx + 1; _dbg.push('s5:HIT slide=' + slide); }
        }
      }

      // Strategy 6: aria-hidden (guarded)
      if (slide === null) {
        for (const ul of document.querySelectorAll('div[role="dialog"] ul, article ul')) {
          const items = [...ul.querySelectorAll(':scope > li')];
          if (items.length < 2) continue;
          if (!items.some(li => li.getAttribute('aria-hidden') === 'true')) continue;
          const idx = items.findIndex(li => li.getAttribute('aria-hidden') !== 'true');
          if (idx >= 0) { slide = idx + 1; _dbg.push('s6:HIT slide=' + slide); break; }
        }
      }

      _dbg.push('FINAL slide=' + slide);
      console.log('[ScreenshotExt]', _dbg.join('\n'));

      return { username, postId: sanitize(m[1]), slide };
    }
  }

  // YouTube
  if (hostname === 'youtube.com' || hostname === 'youtu.be') {
    const videoId = hostname === 'youtu.be'
      ? path.slice(1).split('/')[0]
      : urlObj.searchParams.get('v');
    if (videoId) {
      const el = document.querySelector(
        '#channel-name a, ytd-channel-name a, #owner #channel-name a, #owner-name a'
      );
      const username = el ? sanitize(el.textContent.trim()) : 'unknown';
      return { username, postId: videoId };
    }
  }

  // TikTok
  if (hostname === 'tiktok.com') {
    const m = path.match(/^\/@([^/]+)\/video\/(\d+)/);
    if (m) return { username: sanitize(m[1]), postId: m[2] };
  }

  // Reddit
  if (hostname === 'reddit.com' || hostname === 'old.reddit.com') {
    const m = path.match(/^\/r\/([^/]+)\/comments\/([^/]+)/);
    if (m) return { username: `r/${sanitize(m[1])}`, postId: sanitize(m[2]) };
  }

  // LinkedIn
  if (hostname === 'linkedin.com') {
    const m = path.match(/\/posts\/([^/_]+)[_-]([a-zA-Z0-9]+)/);
    if (m) return { username: sanitize(m[1]), postId: sanitize(m[2]) };
    const a = path.match(/\/feed\/update\/urn:li:activity:(\d+)/);
    if (a) {
      const el = document.querySelector(
        '.feed-shared-actor__name, .update-components-actor__name'
      );
      const username = el ? sanitize(el.textContent.trim()) : 'unknown';
      return { username, postId: a[1] };
    }
  }

  // Facebook
  if (hostname === 'facebook.com') {
    const m = path.match(/^\/([^/]+)\/(?:posts|videos|photos)\/(\d+)/);
    if (m) return { username: sanitize(m[1]), postId: m[2] };
    const fbid = urlObj.searchParams.get('fbid') || urlObj.searchParams.get('story_fbid');
    if (fbid) {
      const pm = path.match(/^\/([^/]+)/);
      const slug = pm ? pm[1] : '';
      const username = slug && slug !== 'photo' && slug !== 'permalink'
        ? sanitize(slug) : 'unknown';
      return { username, postId: fbid };
    }
    const pl = path.match(/\/permalink\/(\d+)/);
    if (pl) {
      const el = document.querySelector('h2 a[href*="facebook.com"]');
      const username = el ? sanitize(el.textContent.trim()) : 'unknown';
      return { username, postId: pl[1] };
    }
  }

  return null;
}

function buildFilename(tab, socialInfo, ext = 'png') {
  function pad(n) { return String(n).padStart(2, '0'); }

  if (socialInfo) {
    const slideStr = socialInfo.slide != null ? ` - ${socialInfo.slide}` : '';
    return `${socialInfo.username} - ${socialInfo.postId}${slideStr}.${ext}`;
  }

  const url = new URL(tab.url);
  const domain = url.hostname.replace(/^www\./, '');
  const now = new Date();
  const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
             `_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const prefix = ext === 'mp4' ? 'recording' : 'screenshot';
  return `${prefix} - ${domain} - ${ts}.${ext}`;
}

async function getPageSocialInfo(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractPageInfo,
    });
    return result?.result ?? null;
  } catch {
    return null; // chrome:// or other restricted pages
  }
}

// ─── Recording state ───────────────────────────────────────────────────────────

let recording = { active: false, filename: null };

function getStreamId(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, streamId => {
      chrome.runtime.lastError
        ? reject(new Error(chrome.runtime.lastError.message))
        : resolve(streamId);
    });
  });
}

async function ensureOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Record tab video and audio via tabCapture stream',
    });
  }
}

// ─── Message handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Ignore messages routed to the offscreen document
  if (message.target === 'offscreen') return;

  switch (message.action) {
    case 'getState':
      sendResponse({ recording: recording.active, filename: recording.filename });
      break;

    case 'screenshot':
      handleScreenshot(sendResponse);
      return true;

    case 'startRecording':
      handleStartRecording(sendResponse);
      return true;

    case 'stopRecording':
      handleStopRecording(sendResponse);
      return true;
  }
});

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleScreenshot(sendResponse) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active tab found');

    const socialInfo = await getPageSocialInfo(tab.id);
    const filename = buildFilename(tab, socialInfo, 'png');
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });

    await chrome.downloads.download({
      url: dataUrl,
      filename,
      saveAs: false,
      conflictAction: 'uniquify',
    });

    sendResponse({ filename });
  } catch (err) {
    sendResponse({ error: err.message });
  }
}

async function handleStartRecording(sendResponse) {
  if (recording.active) {
    sendResponse({ error: 'Already recording' });
    return;
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active tab found');

    const socialInfo = await getPageSocialInfo(tab.id);
    const filename = buildFilename(tab, socialInfo, 'mp4');
    const streamId = await getStreamId(tab.id);

    await ensureOffscreenDocument();

    const result = await chrome.runtime.sendMessage({
      target: 'offscreen',
      action: 'startRecording',
      streamId,
      filename,
    });

    if (result?.error) throw new Error(result.error);

    recording = { active: true, filename };
    sendResponse({ filename });
  } catch (err) {
    sendResponse({ error: err.message });
  }
}

async function handleStopRecording(sendResponse) {
  if (!recording.active) {
    sendResponse({ error: 'Not recording' });
    return;
  }
  try {
    const result = await chrome.runtime.sendMessage({
      target: 'offscreen',
      action: 'stopRecording',
    });

    recording = { active: false, filename: null };

    try { await chrome.offscreen.closeDocument(); } catch { /* already closed */ }

    sendResponse(result);
  } catch (err) {
    sendResponse({ error: err.message });
  }
}
