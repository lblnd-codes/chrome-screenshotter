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

      // Strategy 0: img_index in URL (direct post view only)
      const imgIndex = new URL(window.location.href).searchParams.get('img_index');
      if (imgIndex) slide = parseInt(imgIndex);

      // DEBUG: dump li attributes + all aria-labels with numbers in dialog
      if (slide === null) {
        const _d = [];
        for (const ul of document.querySelectorAll('div[role="dialog"] ul, article ul')) {
          const items = [...ul.querySelectorAll(':scope > li')];
          if (items.length < 2) continue;
          items.forEach((li, i) => {
            const attrs = [...li.attributes].map(a => a.name + '="' + a.value + '"').join(' ');
            _d.push('li[' + i + ']: ' + (attrs || '(none)'));
          });
        }
        for (const el of document.querySelectorAll('div[role="dialog"] [aria-label], article [aria-label]')) {
          const v = el.getAttribute('aria-label');
          if (/\d/.test(v)) _d.push('aria-label: "' + v + '" <' + el.tagName + '>');
        }
        for (const el of document.querySelectorAll('div[role="dialog"] [aria-posinset], article [aria-posinset]')) {
          _d.push('aria-posinset=' + el.getAttribute('aria-posinset') + ' setsize=' + el.getAttribute('aria-setsize') + ' <' + el.tagName + '>');
        }
        for (const el of document.querySelectorAll('div[role="dialog"] [aria-current], article [aria-current]')) {
          _d.push('aria-current="' + el.getAttribute('aria-current') + '" label="' + el.getAttribute('aria-label') + '" <' + el.tagName + '>');
        }
        console.log('[ScreenshotExt]\n' + _d.join('\n'));
      }

      // Strategy 1: walk up from the UL to find the ancestor scroll container.
      // Instagram scrolls a wrapper div to advance slides (not the UL itself).
      // e.g. ancestor.offsetWidth=256, scrollWidth=3840, scrollLeft=256 → slide 2.
      // The scroll container has scrollWidth that is a whole-number multiple of offsetWidth.
      if (slide === null) {
        outer: for (const ul of document.querySelectorAll('div[role="dialog"] ul, article ul')) {
          const items = [...ul.querySelectorAll(':scope > li')];
          if (items.length < 2) continue;
          let node = ul.parentElement;
          while (node && node.tagName !== 'BODY') {
            const ow = node.offsetWidth;
            const sw = node.scrollWidth;
            if (ow > 50 && sw >= ow * 2 && sw % ow < 2) {
              slide = Math.round(node.scrollLeft / ow) + 1;
              break outer;
            }
            node = node.parentElement;
          }
        }
      }

      // Strategy 2: individual li transforms — the current slide has translateX≈0,
      // combined with the ancestor scroll position for the absolute index.
      if (slide === null) {
        for (const ul of document.querySelectorAll('div[role="dialog"] ul, article ul')) {
          const items = [...ul.querySelectorAll(':scope > li')];
          if (items.length < 2) continue;
          const slideWidth = items.find(li => li.offsetWidth > 50)?.offsetWidth;
          if (!slideWidth) continue;
          // Find the li whose translateX is closest to 0 (the visible one)
          let minTx = Infinity, minIdx = -1;
          items.forEach((li, i) => {
            const m = window.getComputedStyle(li).transform.match(/matrix\([^,]+,[^,]+,[^,]+,[^,]+,\s*(-?[\d.]+)/);
            if (!m) return;
            const tx = Math.abs(parseFloat(m[1]));
            if (tx < minTx) { minTx = tx; minIdx = i; }
          });
          if (minIdx < 0 || minTx > slideWidth * 0.5) continue;
          // Use ancestor scroll for absolute position if available, else use li index
          let node = ul.parentElement;
          while (node && node.tagName !== 'BODY') {
            const ow = node.offsetWidth;
            const sw = node.scrollWidth;
            if (ow > 50 && sw >= ow * 2 && sw % ow < 2) {
              slide = Math.round(node.scrollLeft / ow) + 1;
              break;
            }
            node = node.parentElement;
          }
          if (slide === null) slide = minIdx + 1;
          break;
        }
      }

      // Strategy 3: bounding rect — which li is centered in its clipping parent
      if (slide === null) {
        for (const ul of document.querySelectorAll('div[role="dialog"] ul, article ul')) {
          const items = [...ul.querySelectorAll(':scope > li')];
          if (items.length < 2) continue;
          const clip = ul.parentElement || ul;
          const clipRect = clip.getBoundingClientRect();
          const centerX = clipRect.left + clipRect.width / 2;
          for (let i = 0; i < items.length; i++) {
            const r = items[i].getBoundingClientRect();
            if (r.left <= centerX && r.right > centerX) { slide = i + 1; break; }
          }
          if (slide !== null) break;
        }
      }

      // Strategy 4: aria-label "X of Y" — visible elements only
      if (slide === null) {
        for (const el of document.querySelectorAll('[aria-label*=" of "]')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.right < 0 || r.left > window.innerWidth) continue;
          const am = el.getAttribute('aria-label').match(/(\d+)\s+of\s+\d+/i);
          if (am) { slide = parseInt(am[1]); break; }
        }
      }

      // Strategy 5: ARIA tablist dot indicators
      if (slide === null) {
        const tablist = document.querySelector('[role="tablist"]');
        if (tablist) {
          const tabs = [...tablist.querySelectorAll('[role="tab"]')];
          const idx = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true');
          if (idx >= 0) slide = idx + 1;
        }
      }

      // Strategy 6: aria-hidden (guarded — only when at least one li is explicitly hidden)
      if (slide === null) {
        for (const ul of document.querySelectorAll('div[role="dialog"] ul, article ul')) {
          const items = [...ul.querySelectorAll(':scope > li')];
          if (items.length < 2) continue;
          if (!items.some(li => li.getAttribute('aria-hidden') === 'true')) continue;
          const idx = items.findIndex(li => li.getAttribute('aria-hidden') !== 'true');
          if (idx >= 0) { slide = idx + 1; break; }
        }
      }

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
