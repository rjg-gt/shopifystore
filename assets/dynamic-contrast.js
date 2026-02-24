(() => {
  const LUMINANCE_THRESHOLD = 160;
  const SAMPLE_GRID_SIZE = 10;
  const SCROLL_RESIZE_THROTTLE_MS = 120;

  const MEDIA_IMAGE_SELECTORS = [
    '.product-information__media img',
    '.product-media-gallery img',
    '.media-gallery img',
    '.product__media img',
    '.product img',
  ];

  const TEXT_SELECTOR =
    'h1,h2,h3,h4,h5,h6,p,span,li,dt,dd,small,strong,em,blockquote,a,label,legend';
  const WRAPPER_SELECTORS = '.dynamic-contrast, .product__info-wrapper, .product-details';

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function isProductPage() {
    if (document.body?.classList.contains('template-product')) return true;
    if (window.location.pathname.includes('/products/')) return true;
    return document.querySelector('main[data-template*="product"]') !== null;
  }

  function isElementVisible(el) {
    if (!(el instanceof HTMLElement) || !el.isConnected) return false;

    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (Number.parseFloat(style.opacity || '1') <= 0.1) return false;

    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    if (rect.bottom < 0 || rect.right < 0) return false;
    if (rect.top > window.innerHeight || rect.left > window.innerWidth) return false;

    return true;
  }

  function scoreImageForWrapper(img, wrapperRect) {
    const rect = img.getBoundingClientRect();
    const overlapX = Math.max(0, Math.min(rect.right, wrapperRect.right) - Math.max(rect.left, wrapperRect.left));
    const overlapY = Math.max(0, Math.min(rect.bottom, wrapperRect.bottom) - Math.max(rect.top, wrapperRect.top));
    const overlapArea = overlapX * overlapY;

    if (overlapArea > 0) return overlapArea + 100000;

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const wrapperCenterX = wrapperRect.left + wrapperRect.width / 2;
    const wrapperCenterY = wrapperRect.top + wrapperRect.height / 2;
    const dx = centerX - wrapperCenterX;
    const dy = centerY - wrapperCenterY;

    return Math.max(0, 50000 - Math.hypot(dx, dy));
  }

  function findBackgroundImageEl(wrapper) {
    const wrapperRect = wrapper.getBoundingClientRect();
    const root = wrapper.closest('[data-testid="product-information"], .product, .shopify-section, main') || document;

    const candidates = MEDIA_IMAGE_SELECTORS.flatMap((selector) => Array.from(root.querySelectorAll(selector)));
    const uniqueCandidates = Array.from(new Set(candidates)).filter((img) => img instanceof HTMLImageElement && isElementVisible(img));

    if (!uniqueCandidates.length) return null;

    uniqueCandidates.sort((a, b) => scoreImageForWrapper(b, wrapperRect) - scoreImageForWrapper(a, wrapperRect));
    return uniqueCandidates[0] || null;
  }

  function luminanceFromRgb(r, g, b) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function parseCssColor(colorValue) {
    if (!colorValue || colorValue === 'transparent') return null;

    const match = colorValue.match(/rgba?\(([^)]+)\)/i);
    if (!match) return null;

    const [r, g, b, a = '1'] = match[1].split(',').map((part) => part.trim());
    const alpha = Number.parseFloat(a);
    if (!Number.isFinite(alpha) || alpha <= 0.01) return null;

    return {
      r: clamp(Number.parseFloat(r), 0, 255),
      g: clamp(Number.parseFloat(g), 0, 255),
      b: clamp(Number.parseFloat(b), 0, 255),
    };
  }

  function fallbackLuminance(wrapper) {
    const nodes = [
      wrapper,
      wrapper.closest('[data-testid="product-information"]'),
      wrapper.closest('.shopify-section'),
      document.querySelector('main[data-template*="product"]'),
      document.body,
      document.documentElement,
    ].filter(Boolean);

    for (const node of nodes) {
      const color = parseCssColor(window.getComputedStyle(node).backgroundColor);
      if (color) return luminanceFromRgb(color.r, color.g, color.b);
    }

    return null;
  }

  function computeAverageLuminance(img, sampleRect) {
    try {
      if (!img?.naturalWidth || !img?.naturalHeight) return null;

      const imgRect = img.getBoundingClientRect();
      if (!imgRect.width || !imgRect.height) return null;

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;

      ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);

      let total = 0;
      let count = 0;

      for (let y = 0; y < SAMPLE_GRID_SIZE; y += 1) {
        for (let x = 0; x < SAMPLE_GRID_SIZE; x += 1) {
          const vx = sampleRect.left + ((x + 0.5) / SAMPLE_GRID_SIZE) * sampleRect.width;
          const vy = sampleRect.top + ((y + 0.5) / SAMPLE_GRID_SIZE) * sampleRect.height;

          const nx = (vx - imgRect.left) / imgRect.width;
          const ny = (vy - imgRect.top) / imgRect.height;

          const px = clamp(Math.floor(nx * img.naturalWidth), 0, img.naturalWidth - 1);
          const py = clamp(Math.floor(ny * img.naturalHeight), 0, img.naturalHeight - 1);

          const pixel = ctx.getImageData(px, py, 1, 1).data;
          total += luminanceFromRgb(pixel[0], pixel[1], pixel[2]);
          count += 1;
        }
      }

      if (!count) return null;
      return total / count;
    } catch (_error) {
      return null;
    }
  }


  function getContrastWrappers() {
    const wrappers = Array.from(document.querySelectorAll(WRAPPER_SELECTORS)).filter((el) => el instanceof HTMLElement);

    wrappers.forEach((wrapper) => {
      if (!wrapper.classList.contains('dynamic-contrast')) {
        wrapper.classList.add('dynamic-contrast');
      }
    });

    return wrappers;
  }

  function setWrapperContrast(wrapper, luminance) {
    const contrast = luminance > LUMINANCE_THRESHOLD ? 'dark' : 'light';
    if (wrapper.getAttribute('data-contrast') !== contrast) {
      wrapper.setAttribute('data-contrast', contrast);
    }
  }

  function applyContrast() {
    if (!isProductPage()) return;

    getContrastWrappers().forEach((wrapper) => {
      const wrapperRect = wrapper.getBoundingClientRect();
      if (wrapperRect.width < 4 || wrapperRect.height < 4) return;

      const image = findBackgroundImageEl(wrapper);
      if (image && !image.complete) {
        image.addEventListener('load', applyContrast, { once: true });
        return;
      }

      const luminance = image ? computeAverageLuminance(image, wrapperRect) : null;
      const resolvedLuminance = luminance ?? fallbackLuminance(wrapper);

      if (typeof resolvedLuminance === 'number') {
        setWrapperContrast(wrapper, resolvedLuminance);
      }
    });
  }

  function createScheduler(callback, delay = SCROLL_RESIZE_THROTTLE_MS) {
    let rafId = 0;
    let timeoutId = 0;
    let lastRun = 0;

    return () => {
      if (rafId) return;

      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        const now = Date.now();
        const wait = Math.max(0, delay - (now - lastRun));

        window.clearTimeout(timeoutId);
        timeoutId = window.setTimeout(() => {
          lastRun = Date.now();
          callback();
        }, wait);
      });
    };
  }

  function bindGalleryObservers(schedule) {
    const mediaRoot = document.querySelector('.product-information__media, .product-media-gallery, .media-gallery');
    if (!mediaRoot) return;

    const observer = new MutationObserver(schedule);
    observer.observe(mediaRoot, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'src', 'srcset', 'aria-hidden'],
    });
  }

  function init() {
    if (!isProductPage()) return;

    const schedule = createScheduler(applyContrast);

    schedule();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, { passive: true });
    document.addEventListener('DOMContentLoaded', schedule);
    document.addEventListener('shopify:section:load', schedule);
    document.addEventListener('variant:change', schedule);
    document.addEventListener('slideshow:slide_changed', schedule);
    document.addEventListener('media-gallery:change', schedule);

    const intersectionObserver = new IntersectionObserver(schedule, {
      root: null,
      threshold: [0, 0.2, 0.5, 0.8, 1],
    });

    getContrastWrappers().forEach((wrapper) => intersectionObserver.observe(wrapper));

    bindGalleryObservers(schedule);
  }

  init();
})();
