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
    if (button.hasAttribute("data-theme-icon")) {
      const nextTheme = theme === "dark" ? "light" : "dark";
      const icon = theme === "dark" ? "theme-dark" : "theme-light";
      button.setAttribute("data-icon", icon);
      button.setAttribute("aria-label", `Cambiar a tema ${nextTheme === "dark" ? "oscuro" : "claro"}`);
      button.setAttribute(
        "title",
        `Tema actual: ${theme === "dark" ? "oscuro" : "claro"}. Tocar para cambiar.`
      );
    } else {
      button.textContent = label;
      button.setAttribute("aria-label", "Cambiar tema");
      button.setAttribute("title", "Cambiar entre modo claro y oscuro");
    }
    button.setAttribute("aria-pressed", String(theme === "dark"));
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
