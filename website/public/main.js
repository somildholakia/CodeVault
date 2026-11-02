(() => {
  const menuButton = document.querySelector(".menu-toggle");
  const nav = document.querySelector("#main-nav");

  if (menuButton && nav) {
    menuButton.addEventListener("click", () => {
      const isOpen = menuButton.getAttribute("aria-expanded") === "true";
      menuButton.setAttribute("aria-expanded", String(!isOpen));
      menuButton.setAttribute("aria-label", isOpen ? "Open navigation" : "Close navigation");
      nav.classList.toggle("is-open", !isOpen);
    });

    nav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        menuButton.setAttribute("aria-expanded", "false");
        menuButton.setAttribute("aria-label", "Open navigation");
        nav.classList.remove("is-open");
      });
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && nav.classList.contains("is-open")) {
        menuButton.setAttribute("aria-expanded", "false");
        menuButton.setAttribute("aria-label", "Open navigation");
        nav.classList.remove("is-open");
        menuButton.focus();
      }
    });
  }

  const year = document.querySelector("[data-year]");
  if (year) year.textContent = String(new Date().getFullYear());

  const copyButton = document.querySelector("[data-copy]");
  if (copyButton) {
    copyButton.addEventListener("click", async () => {
      const command = copyButton.dataset.copy.replace(/&#10;/g, "\n");
      const original = copyButton.innerHTML;
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(command);
        } else {
          const helper = document.createElement("textarea");
          helper.value = command;
          helper.setAttribute("readonly", "");
          helper.style.position = "absolute";
          helper.style.left = "-9999px";
          document.body.appendChild(helper);
          helper.select();
          const copied = document.execCommand("copy");
          helper.remove();
          if (!copied) throw new Error("Clipboard is unavailable");
        }
        copyButton.textContent = "COPIED ✓";
        copyButton.setAttribute("aria-label", "Setup commands copied");
      } catch {
        copyButton.textContent = "SELECT COMMANDS";
        copyButton.setAttribute("aria-label", "Clipboard unavailable; select the commands manually");
      }
      window.setTimeout(() => {
        copyButton.innerHTML = original;
        copyButton.setAttribute("aria-label", "Copy setup commands");
      }, 1800);
    });
  }
})();