/*
 * Revela os blocos abaixo da dobra quando eles entram na tela.
 * O véu de abertura e a cascata de entrada ficam em /js/home-intro.js e home.css.
 */
(() => {
  const targets = document.querySelectorAll('.home-page .home-magazine');
  if (!targets.length) return;

  const reveal = (element) => element.classList.add('is-revealed');
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches
      || !('IntersectionObserver' in window)) {
    targets.forEach(reveal);
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      reveal(entry.target);
      observer.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });

  targets.forEach((element) => observer.observe(element));
})();
