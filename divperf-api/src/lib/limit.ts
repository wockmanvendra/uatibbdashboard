/**
 * Runs at most `max` tasks at once; the rest wait their turn in order. Keeps
 * background rebuilds from taking every Synapse slot from users.
 */
export function createLimiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];

  const next = () => {
    if (active >= max) return;
    const start = waiting.shift();
    if (start) {
      active++;
      start();
    }
  };

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        waiting.push(() => {
          task()
            .then(resolve, reject)
            .finally(() => {
              active--;
              next();
            });
        });
        next();
      });
    },
    /** Tasks running and waiting. */
    get size() {
      return active + waiting.length;
    },
  };
}
