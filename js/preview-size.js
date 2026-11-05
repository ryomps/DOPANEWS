(function () {
  function fitPreview() {
    const scale = Math.min(1, Math.max(.2, (window.innerHeight - 66) / 844));
    document.documentElement.style.setProperty('--phone-preview-scale', String(scale));
  }
  window.addEventListener('resize', fitPreview, {passive:true});
  fitPreview();
})();
