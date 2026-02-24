(() => {
  const LUMINANCE_THRESHOLD = 160;
  const SAMPLE_GRID_SIZE = 10;
  const SCROLL_RESIZE_THROTTLE_MS = 120;

  const WRAPPER_SELECTORS = '.dynamic-contrast, .product__info-wrapper, .product-details';

  const MEDIA_IMAGE_SELECTORS = [
    '.group-block__media-wrapper .background-image-container img',
    '.custom-section-background .background-image-container img',
    '.background-image-container img',
    '.product-information__media img',
    '.product-media-gallery img',
    '.media-gallery img',
    '.product__media img',
    '.product img',
  ];

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const imageCache = new Map();

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

    if (overlapArea > 0) {
      const backgroundBonus = img.closest('.group-block__media-wrapper, .custom-section-background, .background-image-container')
        ? 300000
        : 0;
      return overlapArea + 100000 + backgroundBonus;
    }

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const wrapperCenterX = wrapperRect.left + wrapperRect.width / 2;
    const wrapperCenterY = wrapperRect.top + wrapperRect.height / 2;

    return Math.max(0, 50000 - Math.hypot(centerX - wrapperCenterX, centerY - wrapperCenterY));
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

  function extractUrl(backgroundImageValue) {
    const match = backgroundImageValue?.match(/url\((['"]?)(.*?)\1\)/i);
    return match && match[2] ? match[2] : null;
  }

  function loadImage(url) {
    if (!url) return Promise.resolve(null);
    if (imageCache.has(url)) return imageCache.get(url);

    const promise = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });

    imageCache.set(url, promise);
    return promise;
  }

  function computeLuminanceFromCoverImage(img, sampleRect, containerRect, positionX = 0.5, positionY = 0.5) {
    if (!img || !img.naturalWidth || !img.naturalHeight || !containerRect.width || !containerRect.height) return null;

    const scale = Math.max(containerRect.width / img.naturalWidth, containerRect.height / img.naturalHeight);
    const renderWidth = img.naturalWidth * scale;
    const renderHeight = img.naturalHeight * scale;
    const overflowX = Math.max(0, renderWidth - containerRect.width);
    const overflowY = Math.max(0, renderHeight - containerRect.height);

    const offsetX = overflowX * positionX;
    const offsetY = overflowY * positionY;

    try {
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

          const localX = vx - containerRect.left + offsetX;
          const localY = vy - containerRect.top + offsetY;

          const nx = clamp(localX / renderWidth, 0, 1);
          const ny = clamp(localY / renderHeight, 0, 1);

          const px = clamp(Math.floor(nx * (img.naturalWidth - 1)), 0, img.naturalWidth - 1);
          const py = clamp(Math.floor(ny * (img.naturalHeight - 1)), 0, img.naturalHeight - 1);

          const pixel = ctx.getImageData(px, py, 1, 1).data;
          total += luminanceFromRgb(pixel[0], pixel[1], pixel[2]);
          count += 1;
        }
      }

      return count ? total / count : null;
    } catch (_error) {
      return null;
    }
  }

  function parseBackgroundPosition(style, axis) {
    const value = axis === 'x' ? style.backgroundPositionX : style.backgroundPositionY;
    if (value?.includes('%')) return clamp(Number.parseFloat(value) / 100, 0, 1);
    if (value === 'left' || value === 'top') return 0;
    if (value === 'right' || value === 'bottom') return 1;
    return 0.5;
  }

  async function luminanceFromBodyBackground(sampleRect) {
    const pseudoStyle = window.getComputedStyle(document.body, '::before');
    const bodyStyle = window.getComputedStyle(document.body);

    const imageUrl = extractUrl(pseudoStyle.backgroundImage) || extractUrl(bodyStyle.backgroundImage);
    if (!imageUrl) return null;

    const bgImage = await loadImage(imageUrl);
    if (!bgImage) return null;

    const posX = parseBackgroundPosition(pseudoStyle, 'x');
    const posY = parseBackgroundPosition(pseudoStyle, 'y');

    const containerRect = {
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    };

    return computeLuminanceFromCoverImage(bgImage, sampleRect, containerRect, posX, posY);
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

  async function applyContrast() {
    if (!isProductPage()) return;

    const wrappers = getContrastWrappers();

    for (const wrapper of wrappers) {
      const wrapperRect = wrapper.getBoundingClientRect();
      if (wrapperRect.width < 4 || wrapperRect.height < 4) continue;

      const image = findBackgroundImageEl(wrapper);
      if (image && !image.complete) {
        image.addEventListener('load', () => {
          window.requestAnimationFrame(() => {
            applyContrast();
          });
        }, { once: true });
        continue;
      }

      let resolvedLuminance = image ? computeAverageLuminance(image, wrapperRect) : null;

      if (typeof resolvedLuminance !== 'number') {
        resolvedLuminance = await luminanceFromBodyBackground(wrapperRect);
      }

      if (typeof resolvedLuminance !== 'number') {
        resolvedLuminance = fallbackLuminance(wrapper);
      }

      if (typeof resolvedLuminance === 'number') {
        setWrapperContrast(wrapper, resolvedLuminance);
      }
    }
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
    window.addEventListener('load', schedule);
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
