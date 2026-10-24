/**
 * Removes the slashes at the end of a path.
 *
 * The regular expression `/\/+$/` costs a time that grows with the square of
 * the length when the text holds many slashes and ends with another character.
 * The loop reads each character one time.
 */
export const withoutTrailingSlashes = (path: string): string => {
  let end = path.length;
  while (end > 0 && path[end - 1] === '/') end -= 1;
  return path.slice(0, end);
};
