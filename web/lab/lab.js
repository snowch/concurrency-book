// Mount every experiment on the page.
//
// A chapter marks an experiment with a fenced block in the language `lab`; tools/render.py turns
// it into <div class="lab" data-experiment=… data-…> holding the experiment's contract as JSON.
// This script reads the contract, builds the shell (shell.js), imports the experiment's own
// module (<name>.js) and hands it the shell. Paths are resolved from this script's own URL, so
// the book works wherever it is served from, including a GitHub Pages project path.
//
// Live runs need shared memory, which the browser grants only to a cross-origin isolated page
// (runtime.js, capabilities). Where it is withheld, the shell starts in trace mode and says why.

import { Shell } from "./shell.js";
import { capabilities } from "./runtime.js";

async function mount(root) {
  const config = { ...root.dataset };
  root.dataset.state = "loading";
  try {
    const contract = JSON.parse(root.querySelector("script.lab-contract").textContent);
    const module = await import(`./${config.experiment}.js`);
    const caps = capabilities();
    root.dataset.live = caps.live ? "true" : "false";
    const shell = new Shell(root, contract, config, caps);
    await module.mount(shell);
    if (root.dataset.state === "loading") root.dataset.state = "ready";
  } catch (error) {
    const message = document.createElement("p");
    message.className = "lab-error";
    message.textContent = `The experiment could not start: ${String(error.message || error)}`;
    root.replaceChildren(message);
    root.dataset.state = "error";
    throw error;
  }
}

for (const root of document.querySelectorAll(".lab[data-experiment]")) mount(root);
