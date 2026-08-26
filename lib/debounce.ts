export function debounce<Args extends unknown[]>(callback: (...args: Args) => void, delay: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const run = (...args: Args) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => callback(...args), delay);
  };
  run.cancel = () => {
    if (timeout) clearTimeout(timeout);
    timeout = undefined;
  };
  return run;
}
