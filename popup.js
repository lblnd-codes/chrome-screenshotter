const btnScreenshot = document.getElementById('btn-screenshot');
const btnRecord     = document.getElementById('btn-record');
const recordText    = document.getElementById('record-text');
const statusEl      = document.getElementById('status');

function setStatus(text, type = '') {
  statusEl.className = type;
  statusEl.textContent = text;
}

function setRecordingUI(isRecording) {
  if (isRecording) {
    btnRecord.classList.add('recording');
    // Add pulsing dot
    const label = btnRecord.querySelector('.record-label');
    if (!label.querySelector('.dot')) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      label.prepend(dot);
    }
    recordText.textContent = 'Stop Recording';
  } else {
    btnRecord.classList.remove('recording');
    const dot = btnRecord.querySelector('.dot');
    if (dot) dot.remove();
    recordText.textContent = 'Start Recording';
  }
}

// Restore state when popup opens
chrome.runtime.sendMessage({ action: 'getState' }, response => {
  if (response?.recording) {
    setRecordingUI(true);
    setStatus(`Recording: ${response.filename}`, '');
  }
});

// Screenshot
btnScreenshot.addEventListener('click', async () => {
  btnScreenshot.disabled = true;
  setStatus('Taking screenshot…');
  try {
    const res = await chrome.runtime.sendMessage({ action: 'screenshot' });
    if (res.error) { setStatus(res.error, 'error'); }
    else           { setStatus(`Saved: ${res.filename}`, 'success'); }
  } catch (err) {
    setStatus(err.message, 'error');
  } finally {
    btnScreenshot.disabled = false;
  }
});

// Record / Stop
btnRecord.addEventListener('click', async () => {
  const isRecording = btnRecord.classList.contains('recording');
  btnRecord.disabled = true;

  if (!isRecording) {
    setStatus('Starting recording…');
    try {
      const res = await chrome.runtime.sendMessage({ action: 'startRecording' });
      if (res.error) { setStatus(res.error, 'error'); }
      else           { setRecordingUI(true); setStatus(`Recording: ${res.filename}`); }
    } catch (err) {
      setStatus(err.message, 'error');
    } finally {
      btnRecord.disabled = false;
    }
  } else {
    setStatus('Stopping…');
    try {
      const res = await chrome.runtime.sendMessage({ action: 'stopRecording' });
      if (res.error) { setStatus(res.error, 'error'); }
      else           { setRecordingUI(false); setStatus(`Saved: ${res.filename}`, 'success'); }
    } catch (err) {
      setStatus(err.message, 'error');
    } finally {
      btnRecord.disabled = false;
    }
  }
});
