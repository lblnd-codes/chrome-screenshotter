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
      const el = document.querySelector('header a[role="link"], article header a, h2 a');
      const username = el ? sanitize(el.textContent.trim()) : 'unknown';
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
    // /posts/username_activityId-postId-type/
    const m = path.match(/\/posts\/([^/_]+)[_-]([a-zA-Z0-9]+)/);
    if (m) return { username: sanitize(m[1]), postId: sanitize(m[2]) };
    // /feed/update/urn:li:activity:id
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

function buildFilename(tab, socialInfo) {
  function pad(n) { return String(n).padStart(2, '0'); }

  if (socialInfo) {
    return `${socialInfo.username} - ${socialInfo.postId}.png`;
  }

  // Fallback: domain + timestamp
  const url = new URL(tab.url);
  const domain = url.hostname.replace(/^www\./, '');
  const now = new Date();
  const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
             `_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `screenshot - ${domain} - ${ts}.png`;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action !== 'screenshot') return;

  (async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) throw new Error('No active tab found');

      // Try to extract social media info from the page
      let socialInfo = null;
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: extractPageInfo,
        });
        socialInfo = result?.result ?? null;
      } catch {
        // Page may not allow scripting (e.g. chrome:// URLs) – that's fine
      }

      const filename = buildFilename(tab, socialInfo);

      // Capture visible area
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
  })();

  return true; // keep message channel open for async response
});
