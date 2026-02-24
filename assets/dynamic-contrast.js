(function () {
  const THRESHOLD = 140; // lower = more likely to classify as dark

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function extractUrl(value) {
    if (!value || value === 'none') return null;
    const m = value.match(/url\(["']?(.*?)["']?\)/i);
    return m ? m[1] : null;
  }

  function getBgImageUrl(el) {
    const computed = getComputedStyle(el);
    const before = getComputedStyle(el, '::before');
    const after = getComputedStyle(el, '::after');

    const candidates = [
      computed.backgroundImage,
      before.backgroundImage,
      after.backgroundImage,
      computed.getPropertyValue('--site-bg-image'),
      getComputedStyle(document.documentElement).getPropertyValue('--site-bg-image'),
      getComputedStyle(document.body).getPropertyValue('--site-bg-image'),
    ];

    for (const candidate of candidates) {
      const url = extractUrl(candidate && candidate.trim());
      if (url) return url;
    }

    return null;
  }

  function getCoverMapping(bgHost, img) {
    // Map viewport coords -> image coords for background-size: cover
    const hostRect =
      bgHost === document.body || bgHost === document.documentElement
        ? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
        : bgHost.getBoundingClientRect();

    const imgW = img.naturalWidth;
    const imgH = img.naturalHeight;

    const hostW = hostRect.width;
    const hostH = hostRect.height;

    // cover scale
    const scale = Math.max(hostW / imgW, hostH / imgH);
    const drawnW = imgW * scale;
    const drawnH = imgH * scale;

    // background-position (default 50% 50%)
    const pos = getComputedStyle(bgHost).backgroundPosition.split(' ');
    const posX = pos[0] || '50%';
    const posY = pos[1] || '50%';

    function parsePos(p, sizeDiff) {
      // p can be "50%", "left", "center", "right", or px
      if (p.endsWith('%')) return (parseFloat(p) / 100) * sizeDiff;
      if (p === 'left' || p === 'top') return 0;
      if (p === 'center') return 0.5 * sizeDiff;
      if (p === 'right' || p === 'bottom') return 1 * sizeDiff;
      const px = parseFloat(p);
      return Number.isFinite(px) ? px : 0.5 * sizeDiff;
    }

    const overflowX = drawnW - hostW;
    const overflowY = drawnH - hostH;

    const offsetX = -parsePos(posX, overflowX); // negative means the image is shifted left
    const offsetY = -parsePos(posY, overflowY);

    return { hostRect, scale, offsetX, offsetY, imgW, imgH };
  }

  function sampleLuminanceUnder(wrapper, bgHost, img) {
    const rect = wrapper.getBoundingClientRect();
    const map = getCoverMapping(bgHost, img);

    // sample a grid of points inside wrapper
    const samplesX = 5;
    const samplesY = 4;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // we only need a small canvas; we’ll draw the whole image once scaled down
    const MAX = 600;
    const scaleDown = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
    canvas.width = Math.max(1, Math.floor(img.naturalWidth * scaleDown));
    canvas.height = Math.max(1, Math.floor(img.naturalHeight * scaleDown));
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    let sum = 0;
    let count = 0;

    for (let y = 0; y < samplesY; y++) {
      for (let x = 0; x < samplesX; x++) {
        const px = rect.left + (x + 0.5) * (rect.width / samplesX);
        const py = rect.top + (y + 0.5) * (rect.height / samplesY);

        // convert viewport point -> point within bgHost
        const inHostX = px - map.hostRect.left;
        const inHostY = py - map.hostRect.top;

        // convert host point -> drawn background image coords
        const drawnX = inHostX - map.offsetX;
        const drawnY = inHostY - map.offsetY;

        // convert drawn coords -> natural image coords
        const imgX = drawnX / map.scale;
        const imgY = drawnY / map.scale;

        // clamp and scale down to our canvas
        const sx = clamp(Math.floor(imgX * scaleDown), 0, canvas.width - 1);
        const sy = clamp(Math.floor(imgY * scaleDown), 0, canvas.height - 1);

        const data = ctx.getImageData(sx, sy, 1, 1).data;
        const r = data[0], g = data[1], b = data[2];

        // perceived luminance
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;

        sum += lum;
        count++;
      }
    }

    return sum / Math.max(1, count);
  }

  function applyDynamicContrast(wrapper) {
    const bgCandidates = [
      wrapper.closest('[data-testid="product-information"]'),
      wrapper.closest('.shopify-section'),
      wrapper.closest('.product'),
      document.body,
      document.documentElement,
    ].filter(Boolean);

    let bgHost = bgCandidates[bgCandidates.length - 1];
    let url = null;
    for (const candidate of bgCandidates) {
      const candidateUrl = getBgImageUrl(candidate);
      if (candidateUrl) {
        bgHost = candidate;
        url = candidateUrl;
        break;
      }
    }

    if (!url) return;

    const img = new Image();
    img.crossOrigin = 'anonymous'; // works for same-origin Shopify assets; harmless otherwise
    img.onload = () => {
      try {
        const lum = sampleLuminanceUnder(wrapper, bgHost, img);
        const isDark = lum < THRESHOLD;

        wrapper.classList.toggle('is-dark', isDark);
        wrapper.classList.toggle('is-light', !isDark);
      } catch (e) {
        // If canvas sampling fails (rare), do nothing
      }
    };
    img.src = url;
  }

  function debounce(fn, t = 150) {
    let id;
    return (...args) => {
      clearTimeout(id);
      id = setTimeout(() => fn(...args), t);
    };
  }

  function init() {
    document.querySelectorAll('.dynamic-contrast').forEach(applyDynamicContrast);
  }

  const reapply = debounce(init, 150);

  document.addEventListener('DOMContentLoaded', init);
  window.addEventListener('resize', reapply);
  window.addEventListener('scroll', reapply, { passive: true });

  // Shopify theme editor / section reloads
  document.addEventListener('shopify:section:load', reapply);

  // If your media/gallery updates via custom events, you can also reapply after variant change:
  document.addEventListener('variant:change', reapply);
})();
