const btn = document.getElementById('btn');
const status = document.getElementById('status');

btn.addEventListener('click', async () => {
  btn.disabled = true;
  status.className = '';
  status.textContent = 'Taking screenshot...';

  try {
    const response = await chrome.runtime.sendMessage({ action: 'screenshot' });
    if (response.error) {
      status.className = 'error';
      status.textContent = response.error;
    } else {
      status.className = 'success';
      status.textContent = `Saved: ${response.filename}`;
    }
  } catch (err) {
    status.className = 'error';
    status.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});
