export function createCoalescedTask(task: () => Promise<void>): () => Promise<void> {
  let current: Promise<void> | null = null;
  let requestedAgain = false;

  return () => {
    if (current) {
      requestedAgain = true;
      return current;
    }

    const operation = Promise.resolve().then(async () => {
      let failed = false;
      let firstError: unknown;
      do {
        requestedAgain = false;
        try {
          await task();
        } catch (error) {
          if (!failed) {
            failed = true;
            firstError = error;
          }
        }
      } while (requestedAgain);
      current = null;
      if (failed) throw firstError;
    });
    current = operation;
    return current;
  };
}
