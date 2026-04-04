let mediaRecorder = null;
let chunks = [];
let pendingFilename = null;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  if (message.action === 'startRecording') {
    startRecording(message.streamId, message.filename)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (message.action === 'stopRecording') {
    stopRecording()
      .then(filename => sendResponse({ filename }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

async function startRecording(streamId, filename) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
  });

  pendingFilename = filename;
  chunks = [];

  const mimeType = MediaRecorder.isTypeSupported('video/webm; codecs=vp9,opus')
    ? 'video/webm; codecs=vp9,opus'
    : 'video/webm';

  mediaRecorder = new MediaRecorder(stream, { mimeType });
  mediaRecorder.ondataavailable = e => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  mediaRecorder.start(1000); // flush a chunk every second
}

function stopRecording() {
  return new Promise((resolve, reject) => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      reject(new Error('Not recording'));
      return;
    }

    mediaRecorder.onstop = async () => {
      try {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);

        await chrome.downloads.download({
          url,
          filename: pendingFilename,
          saveAs: false,
          conflictAction: 'uniquify',
        });

        URL.revokeObjectURL(url);
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
        mediaRecorder = null;
        chunks = [];

        resolve(pendingFilename);
      } catch (err) {
        reject(err);
      }
    };

    mediaRecorder.stop();
  });
}
