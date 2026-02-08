const STORAGE_KEY = "babycam-theme";
const DEFAULT_THEME = "dark";

initTheme();

function initTheme() {
  const currentTheme = getStoredTheme();
  applyTheme(currentTheme);
  bindToggleButtons();

  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) {
      return;
    }
    const theme = normalizeTheme(event.newValue);
    applyTheme(theme);
  });
}

function bindToggleButtons() {
  const buttons = document.querySelectorAll("[data-theme-toggle]");
  for (const button of buttons) {
    button.addEventListener("click", () => {
      const activeTheme = document.documentElement.getAttribute("data-theme") || DEFAULT_THEME;
      const nextTheme = activeTheme === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(STORAGE_KEY, nextTheme);
      } catch {
        /* no-op */
      }
      applyTheme(nextTheme);
    });
  }
  updateToggleButtons();
}

function applyTheme(theme) {
  const normalized = normalizeTheme(theme);
  document.documentElement.setAttribute("data-theme", normalized);
  updateToggleButtons();
}

function updateToggleButtons() {
  const theme = document.documentElement.getAttribute("data-theme") || DEFAULT_THEME;
  const label = theme === "dark" ? "Tema: Oscuro" : "Tema: Claro";
  const buttons = document.querySelectorAll("[data-theme-toggle]");
  for (const button of buttons) {
    button.textContent = label;
    button.setAttribute("aria-label", "Cambiar tema");
    button.setAttribute("aria-pressed", String(theme === "dark"));
    button.setAttribute("title", "Cambiar entre modo claro y oscuro");
  }
}

function getStoredTheme() {
  try {
    return normalizeTheme(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

function normalizeTheme(value) {
  return value === "light" ? "light" : "dark";
}
