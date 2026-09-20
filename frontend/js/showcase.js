(() => {
  const tabs = [...document.querySelectorAll('.journey-tab')];
  const screens = [...document.querySelectorAll('.screen')];
  const count = document.getElementById('step-count');
  let active = 0;

  function show(index) {
    active = (index + tabs.length) % tabs.length;

    tabs.forEach((tab, i) => {
      tab.classList.toggle('active', i === active);
      tab.setAttribute('aria-selected', String(i === active));
    });

    screens.forEach((screen, i) => {
      screen.classList.toggle('active', i === active);
    });

    count.textContent =
      `${String(active + 1).padStart(2, '0')} / 05`;
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => show(i));
  });

  document
    .getElementById('prev-step')
    .addEventListener('click', () => show(active - 1));

  document
    .getElementById('next-step')
    .addEventListener('click', () => show(active + 1));
})();
