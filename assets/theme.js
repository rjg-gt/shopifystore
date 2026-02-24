document.addEventListener('DOMContentLoaded', () => {
  try {
    const html = document.documentElement;
    const bg = getComputedStyle(html).backgroundImage;
    if (bg && bg !== 'none') {
      document.body.style.setProperty('--global-bg-image', bg);
    }
  } catch (e) {}
});
