/* The book's kernels at a desk: the same C the browser runs, on pthreads.
 *
 *   clang -O2 -pthread -DKERNEL='"../../experiments/counter/counter.c"' native/c/harness.c -o
 * counter
 *   ./counter WORKERS A B C
 *
 * `make native KERNEL=counter` builds it into native/build/. The arguments after WORKERS are the
 * kernel's a, b and c, whose meaning its experiment.json gives; missing ones are 0. The harness
 * prints every result the kernel reports, and the wall time from the start barrier opening to
 * the last worker finishing. Appendix A says what to make of the time.
 */
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>

#ifndef KERNEL
#error "compile with -DKERNEL='\"path/to/kernel.c\"'"
#endif
#include KERNEL

#define MAX_WORKERS 256

struct job {
  int tid, a, b, c;
};

static void *worker(void *p) {
  struct job *j = p;
  cm_run(j->tid, j->a, j->b, j->c);
  return NULL;
}

static double now_ms(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return ts.tv_sec * 1e3 + ts.tv_nsec / 1e6;
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: %s WORKERS [A [B [C]]]\n", argv[0]);
    return 2;
  }
  int workers = atoi(argv[1]);
  if (workers < 1 || workers > MAX_WORKERS) {
    fprintf(stderr, "WORKERS must be 1 to %d\n", MAX_WORKERS);
    return 2;
  }
  int a = argc > 2 ? atoi(argv[2]) : 0, b = argc > 3 ? atoi(argv[3]) : 0,
      c = argc > 4 ? atoi(argv[4]) : 0;
  static pthread_t threads[MAX_WORKERS];
  static struct job jobs[MAX_WORKERS];
  cm_reset();
  for (int i = 0; i < workers; i++) {
    jobs[i] = (struct job){i, a, b, c};
    if (pthread_create(&threads[i], NULL, worker, &jobs[i]) != 0) {
      perror("pthread_create");
      return 1;
    }
  }
  double t0 = now_ms();
  cm_go();
  for (int i = 0; i < workers; i++) pthread_join(threads[i], NULL);
  double ms = now_ms() - t0;
  printf("workers %d  a %d  b %d  c %d\n", workers, a, b, c);
  for (int i = 0;; i++) {
    int r = cm_result(i);
    if (r == -1) break;
    printf("result[%d] %d\n", i, r);
  }
  printf("elapsed %.3f ms\n", ms);
  return 0;
}
