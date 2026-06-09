/** F1 start sequence: 5 light columns at 1 s intervals, random 1–3 s hold, all out = GO. */
export class StartLights {
  private el: HTMLElement;
  private cols: HTMLElement[];
  private abort: AbortController | null = null;

  constructor() {
    this.el = document.getElementById('startLights')!;
    this.cols = Array.from(this.el.querySelectorAll('.lightCol'));
  }

  /** Resolves true when lights go out (GO), false if cancelled. */
  run(): Promise<boolean> {
    this.cancel();
    const abort = new AbortController();
    this.abort = abort;
    this.el.classList.remove('hidden');
    this.cols.forEach((c) => c.classList.remove('lit'));

    const sleep = (ms: number) =>
      new Promise<void>((resolve, reject) => {
        const id = setTimeout(resolve, ms);
        abort.signal.addEventListener('abort', () => { clearTimeout(id); reject(new Error('cancelled')); }, { once: true });
      });

    return (async () => {
      try {
        await sleep(800);
        for (const col of this.cols) {
          col.classList.add('lit');
          await sleep(1000);
        }
        await sleep(1000 + Math.random() * 2000); // random hold, then lights out
        this.cols.forEach((c) => c.classList.remove('lit'));
        await sleep(900); // keep the dark gantry on screen briefly
        this.el.classList.add('hidden');
        return true;
      } catch {
        this.el.classList.add('hidden');
        return false;
      }
    })();
  }

  cancel(): void {
    this.abort?.abort();
    this.abort = null;
  }
}
