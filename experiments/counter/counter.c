/* A shared counter, incremented by every worker.
 *
 * ch01 compiles `increment` and reads what it became. ch02 runs it on two workers and loses
 * increments. ch03 switches to `increment_atomic` and loses none, then splits it in two and loses
 * them again. ch21 runs it on one worker, then two, then more, and watches the rate fall. ch23
 * and ch24 take the kernel apart.
 */
#include "../cm.h"

/* The variable the workers share. Plain: the compiler and the processor owe it nothing. */
int counter = 0;

/* The same variable, declared atomic: every operation on it is one indivisible step. */
_Atomic int atomic_counter = 0;

/* One increment of the plain counter. What the source hides, the fragments show. */
CM_NOINLINE void increment(void) { counter++; }

/* The same increment, in a loop the compiler can see all of. */
CM_NOINLINE void increment_in_a_loop(int n) {
  for (int i = 0; i < n; i++) counter++;
}

/* One increment of the atomic counter: a read-modify-write the processor cannot split. */
CM_NOINLINE void increment_atomic(void) {
  atomic_fetch_add_explicit(&atomic_counter, 1, memory_order_relaxed);
}

/* Two atomic operations: a load, then a store of the sum. Each is indivisible; the pair is not. */
CM_NOINLINE void increment_split(void) {
  int seen = atomic_load_explicit(&atomic_counter, memory_order_relaxed);
  atomic_store_explicit(&atomic_counter, seen + 1, memory_order_relaxed);
}

/* a: increments per worker. b: which increment. 0 plain, 1 atomic, 2 the loop the compiler
   sees whole, 3 the atomic load and store. c: unused. */
CM_EXPORT("cm_run") void cm_run(int tid, int a, int b, int c) {
  (void)tid;
  (void)c;
  cm_barrier_wait();
  switch (b) {
  case 1:
    for (int i = 0; i < a; i++) increment_atomic();
    break;
  case 2:
    increment_in_a_loop(a);
    break;
  case 3:
    for (int i = 0; i < a; i++) increment_split();
    break;
  default:
    for (int i = 0; i < a; i++) increment();
  }
}

CM_EXPORT("cm_reset") void cm_reset(void) {
  counter = 0;
  atomic_store_explicit(&atomic_counter, 0, memory_order_relaxed);
  cm_barrier_reset();
}

/* Result 0: the plain counter. Result 1: the atomic counter. */
CM_EXPORT("cm_result") int cm_result(int i) {
  if (i == 0) return counter;
  if (i == 1) return atomic_load_explicit(&atomic_counter, memory_order_relaxed);
  return -1;
}
