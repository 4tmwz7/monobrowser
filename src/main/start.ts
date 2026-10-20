import path from "node:path";
import { app } from "electron";
import { applyPortableMode } from "./portable-mode.js";

// Tryb przenośny: ścieżki danych muszą być ustawione przed czymkolwiek, co czyta userData (i przed blokadą instancji).
applyPortableMode();

// Cache skompilowanego kodu V8 skraca ładowanie main.js i zależności przy kolejnych startach.
try {
  const { enableCompileCache } = require("node:module") as { enableCompileCache?: (dir?: string) => unknown };
  enableCompileCache?.(path.join(app.getPath("userData"), "compile-cache"));
} catch {
  // Brak cache nie wpływa na działanie aplikacji.
}

require("./main.js");
