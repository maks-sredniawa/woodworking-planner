const REFRESH_MS = 1000;
const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software|basic render/i;

export function createDebugPanel(panel, view) {
  let appMs = 0;
  let timerId = null;

  function line(label, value, bad = false) {
    const row = document.createElement('div');
    row.className = 'detail';
    const name = document.createElement('span');
    name.textContent = `${label.padEnd(10)} `;
    const text = document.createElement('span');
    text.textContent = value;
    if (bad) text.className = 'bad';
    row.append(name, text);
    return row;
  }

  function percent(ms, seconds) {
    return `${((ms / (seconds * 1000)) * 100).toFixed(1)} %`;
  }

  function refresh() {
    const stats = view.readStats();
    const spentInApp = appMs;
    appMs = 0;
    const software = SOFTWARE_GPU.test(stats.gpu);
    const perFrame = (ms, frames) => (frames ? `${(ms / frames).toFixed(2)} ms/frame` : 'idle');
    const memory = performance.memory?.usedJSHeapSize;
    const fps = (stats.frames / stats.seconds).toFixed(0);
    const gpuShare = software ? 'no GPU' : stats.gpuMs === null ? 'GPU ?' : `GPU ${percent(stats.gpuMs, stats.seconds)}`;
    const summary = document.createElement('div');
    summary.className = software ? 'summary bad' : 'summary';
    summary.textContent = `${fps} fps · CPU ${percent(stats.cpuMs + spentInApp, stats.seconds)} · ${gpuShare}`;
    panel.replaceChildren(
      summary,
      line('Graphics', software ? `${stats.gpu} (software, no GPU in use)` : stats.gpu, software),
      line('Frames', `${(stats.frames / stats.seconds).toFixed(0)} per second`),
      line(
        'GPU time',
        stats.gpuMs === null
          ? 'not measurable in this browser'
          : `${percent(stats.gpuMs, stats.seconds)} · ${perFrame(stats.gpuMs, stats.gpuFrames)}`,
      ),
      line('CPU 3D', `${percent(stats.cpuMs, stats.seconds)} of one core · ${perFrame(stats.cpuMs, stats.frames)}`),
      line('CPU app', `${percent(spentInApp, stats.seconds)} of one core`),
      line('Scene', `${stats.calls} draw calls · ${stats.triangles.toLocaleString('en-GB')} triangles · ${stats.textures} textures`),
      ...(memory ? [line('JS memory', `${(memory / 1048576).toFixed(1)} MB`)] : []),
      line('Note', 'the app’s own share, not your whole computer'),
    );
  }

  return {
    addAppTime(ms) {
      if (timerId !== null) appMs += ms;
    },
    show(on) {
      panel.hidden = !on;
      view.setMeasuring(on);
      clearInterval(timerId);
      timerId = null;
      appMs = 0;
      if (!on) return;
      timerId = setInterval(refresh, REFRESH_MS);
      refresh();
    },
  };
}
