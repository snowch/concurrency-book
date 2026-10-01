/* The compiler is part of the story: a loop that waits for a flag, three ways.
 *
 * ch07 has one worker wait for a flag another worker sets. With a plain flag the compiler may
 * read the flag once, or never; with a volatile one it reads it every time; with an atomic one
 * it reads it every time and promises something about other threads too.
 */
#include "../cm.h"

/* The flag, three times over, so each loop below has its own. */
int flag = 0;
volatile int volatile_flag = 0;
_Atomic int atomic_flag_word = 0;

/* What the waiter saw when its loop ended, and whether it ended at all. */
_Atomic int seen = -1;
_Atomic int returned = 0;

/* Busy work the setter does before setting the flags: `steps` loop iterations. */
_Atomic int steps_done = 0;

/* Wait on a plain int. The language says a loop with no side effects may be assumed to finish,
   and that no other thread may be writing a plain variable this thread reads. */
CM_NOINLINE int wait_plain(void) {
  while (flag == 0) {}
  return flag;
}

/* Wait on a volatile int. Every read in the source is a read in the code, in order. Nothing
   is promised about other threads, the cache, or the order against other variables. */
CM_NOINLINE int wait_volatile(void) {
  while (volatile_flag == 0) {}
  return volatile_flag;
}

/* Wait on an atomic int. Every read is a read, and the language knows another thread writes it. */
CM_NOINLINE int wait_atomic(void) {
  while (atomic_load_explicit(&atomic_flag_word, memory_order_relaxed) == 0) {}
  return atomic_load_explicit(&atomic_flag_word, memory_order_relaxed);
}

/* Set all three flags, after `steps` steps of busy work. */
static void set_after(int steps) {
  int n = 0;
  for (volatile int i = 0; i < steps; i++) n++;
  atomic_store_explicit(&steps_done, n, memory_order_relaxed);
  flag = 1;
  volatile_flag = 1;
  atomic_store_explicit(&atomic_flag_word, 1, memory_order_relaxed);
}

/* Two workers. Worker 0 waits with loop `b` (0 plain, 1 volatile, 2 atomic); worker 1 sets the
   flags after `a` busy steps. c: unused. */
CM_EXPORT("cm_run") void cm_run(int tid, int a, int b, int c) {
  (void)c;
  cm_barrier_wait();
  if (tid == 0) {
    int value = b == 1 ? wait_volatile() : b == 2 ? wait_atomic() : wait_plain();
    atomic_store_explicit(&seen, value, memory_order_relaxed);
    atomic_store_explicit(&returned, 1, memory_order_relaxed);
  } else {
    set_after(a);
  }
}

CM_EXPORT("cm_reset") void cm_reset(void) {
  flag = 0;
  volatile_flag = 0;
  atomic_store_explicit(&atomic_flag_word, 0, memory_order_relaxed);
  atomic_store_explicit(&seen, -1, memory_order_relaxed);
  atomic_store_explicit(&returned, 0, memory_order_relaxed);
  atomic_store_explicit(&steps_done, 0, memory_order_relaxed);
  cm_barrier_reset();
}

/* Result 0: the value the waiter's loop ended on. Result 1: whether it ended. Result 2: the
   setter's busy steps. */
CM_EXPORT("cm_result") int cm_result(int i) {
  if (i == 0) return atomic_load_explicit(&seen, memory_order_relaxed);
  if (i == 1) return atomic_load_explicit(&returned, memory_order_relaxed);
  if (i == 2) return atomic_load_explicit(&steps_done, memory_order_relaxed);
  return -1;
}
