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

  const mp4Type = ['video/mp4; codecs=avc1.42E01E,mp4a.40.2', 'video/mp4'].find(
    t => MediaRecorder.isTypeSupported(t)
  );
  const mimeType = mp4Type ?? (
    MediaRecorder.isTypeSupported('video/webm; codecs=vp9,opus')
      ? 'video/webm; codecs=vp9,opus'
      : 'video/webm'
  );

  // If MP4 isn't supported, fix the filename extension to .webm
  if (!mp4Type) {
    pendingFilename = pendingFilename.replace(/\.mp4$/, '.webm');
  }

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
        const blobType = pendingFilename.endsWith('.mp4') ? 'video/mp4' : 'video/webm';
        const blob = new Blob(chunks, { type: blobType });
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
