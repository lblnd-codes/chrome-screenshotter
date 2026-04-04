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
      return { username, postId: sanitize(m[1]) };
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
    return `${socialInfo.username} - ${socialInfo.postId}.${ext}`;
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
