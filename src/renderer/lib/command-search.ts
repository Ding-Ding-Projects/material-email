import { createMatcher, validatePattern, type MatcherOptions } from "./regex";

export interface SearchableCommand {
  en: string;
  yue: string;
}

export const filterPaletteCommands = <T extends SearchableCommand>(
  commands: readonly T[],
  options: MatcherOptions,
): T[] => {
  if (!options.pattern) return [...commands];
  if (!validatePattern(options).valid) return [];
  const matches = createMatcher(options);
  return commands.filter(command => matches(`${command.en}\n${command.yue}`));
};
