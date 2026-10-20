/** Języki słownika dla języka interfejsu; tylko te, które Electron faktycznie udostępnia. */
export const spellcheckLanguagesFor = (appLanguage: "pl" | "en", available: readonly string[]): string[] => {
  const wanted = appLanguage === "pl" ? ["pl"] : ["en-US"];
  return wanted.filter((language) => available.includes(language));
};
